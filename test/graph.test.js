import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";

const pair = (directed = false) => {
  const g = new Graph({ directed });
  g.addNode({ id: "a" });
  g.addNode({ id: "b" });
  return g;
};

describe("Graph: nodes", () => {
  test("addNode returns the id, generating one when absent", () => {
    const g = new Graph();
    assert.equal(g.addNode({ id: "a" }), "a");
    const generated = g.addNode({ label: "x" });
    assert.equal(typeof generated, "string");
    assert.ok(generated.length > 0);
    assert.equal(g.nodes.size, 2);
  });

  test("duplicate addNode is a no-op that still reports the id", () => {
    const g = new Graph();
    g.addNode({ id: "a" });
    const v = g._version;
    assert.equal(g.addNode({ id: "a", label: "replaced" }), "a");
    assert.equal(g.nodes.size, 1);
    assert.equal(g._version, v, "version must not bump when nothing changed");
    assert.equal(g.nodes.get("a").data.label, undefined, "existing data is kept");
  });

  test("removeNode reports whether it removed anything", () => {
    const g = pair();
    assert.equal(g.removeNode("a"), true);
    assert.equal(g.removeNode("a"), false);
    assert.equal(g.removeNode("nope"), false);
  });

  test("adjacency entry is created and dropped with the node", () => {
    const g = pair();
    assert.ok(g.adjacency.has("a"));
    g.removeNode("a");
    assert.equal(g.adjacency.has("a"), false);
  });

  test("degree counts neighbours, 0 for unknown ids", () => {
    const g = pair();
    g.addNode({ id: "c" });
    g.addEdge("a", "b");
    g.addEdge("a", "c");
    assert.equal(g.degree("a"), 2);
    assert.equal(g.degree("b"), 1);
    assert.equal(g.degree("nope"), 0);
  });
});

describe("Graph: edges", () => {
  test("addEdge throws a ReferenceError naming the missing endpoint", () => {
    const g = new Graph();
    g.addNode({ id: "a" });
    assert.throws(() => g.addEdge("zz", "a"), { name: "ReferenceError", message: /^Graph: no source node with id "zz"$/ });
    assert.throws(() => g.addEdge("a", "zz"), { name: "ReferenceError", message: /^Graph: no destination node with id "zz"$/ });
  });

  test("duplicate addEdge is rejected and leaves one edge", () => {
    const g = pair();
    assert.equal(g.addEdge("a", "b"), true);
    assert.equal(g.addEdge("a", "b"), false);
    assert.equal(g.edges.size, 1, "a second edge object would be unreachable and leak");
  });

  test("edges is a Set of edge objects, iterable once each", () => {
    const g = pair();
    g.addEdge("a", "b");
    const seen = [...g.edges];
    assert.equal(seen.length, 1);
    assert.deepEqual(Object.keys(seen[0]).sort(), ["data", "dest", "src"]);
  });

  test("removeEdge reports whether it removed anything, without spurious version bumps", () => {
    const g = pair();
    g.addEdge("a", "b");
    const v = g._version;
    assert.equal(g.removeEdge("a", "nope"), false);
    assert.equal(g._version, v, "a no-op removal must not force a resync");
    assert.equal(g.removeEdge("a", "b"), true);
    assert.ok(g._version > v);
  });
});

describe("Graph: undirected semantics", () => {
  test("lookup is order-independent and yields the same edge object", () => {
    const g = pair();
    g.addEdge("a", "b");
    assert.ok(g.getEdge("a", "b"));
    assert.equal(g.getEdge("a", "b"), g.getEdge("b", "a"));
    assert.equal(g.hasEdge("b", "a"), true);
  });

  test("removeEdge accepts the endpoints in either order", () => {
    const g = pair();
    g.addEdge("a", "b");
    assert.equal(g.removeEdge("b", "a"), true);
    assert.equal(g.edges.size, 0);
    assert.equal(g.hasEdge("a", "b"), false);
  });

  test("removeNode clears the edge from both adjacency directions", () => {
    const g = pair();
    g.addEdge("a", "b");
    g.removeNode("a");
    assert.equal(g.edges.size, 0);
    assert.equal(g.adjacency.get("b").has("a"), false);
  });
});

describe("Graph: directed semantics", () => {
  test("direction is respected by lookup", () => {
    const g = pair(true);
    g.addEdge("a", "b");
    assert.ok(g.getEdge("a", "b"));
    assert.equal(g.getEdge("b", "a"), undefined);
    assert.equal(g.hasEdge("b", "a"), false);
  });

  test("reciprocal edges are two independent edges", () => {
    const g = pair(true);
    g.addEdge("a", "b");
    g.addEdge("b", "a");
    assert.equal(g.edges.size, 2);
    assert.notEqual(g.getEdge("a", "b"), g.getEdge("b", "a"));
    g.removeEdge("a", "b");
    assert.equal(g.hasEdge("a", "b"), false);
    assert.equal(g.hasEdge("b", "a"), true, "the reverse edge must survive");
  });

  test("removeNode cleans up INCOMING edges", () => {
    // Regression: adjacency only lists outgoing neighbours, so a->b left a
    // dangling edge in `edges` and in a's adjacency when b was removed.
    const g = pair(true);
    g.addEdge("a", "b");
    g.removeNode("b");
    assert.equal(g.edges.size, 0, "incoming edge left behind");
    assert.equal(g.adjacency.get("a").has("b"), false, "stale adjacency entry");
  });
});

describe("Graph: versions", () => {
  test("structural mutations bump _version only", () => {
    const g = new Graph();
    const d = g._dataVersion;
    g.addNode({ id: "a" });
    g.addNode({ id: "b" });
    g.addEdge("a", "b");
    g.removeEdge("a", "b");
    g.removeNode("a");
    assert.equal(g._dataVersion, d, "structure must not invalidate data caches");
  });

  test("setNodeData bumps _dataVersion only", () => {
    const g = pair();
    const v = g._version, d = g._dataVersion;
    g.setNodeData("a", { x: 1 });
    assert.equal(g._version, v, "a data change must not force a structural rebuild");
    assert.equal(g._dataVersion, d + 1);
    assert.deepEqual(g.nodes.get("a").data, { x: 1 });
  });

  test("setEdgeData bumps _dataVersion only", () => {
    const g = pair();
    g.addEdge("a", "b");
    const v = g._version, d = g._dataVersion;
    g.setEdgeData("a", "b", { w: 2 });
    assert.equal(g._version, v);
    assert.equal(g._dataVersion, d + 1);
    assert.deepEqual(g.getEdge("a", "b").data, { w: 2 });
  });

  test("data setters throw on unknown targets", () => {
    const g = pair();
    assert.throws(() => g.setNodeData("zz", {}), { name: "ReferenceError" });
    assert.throws(() => g.setEdgeData("a", "b", {}), { name: "ReferenceError" });
  });
});

describe("Graph: misc", () => {
  test("directed is frozen after construction", () => {
    const g = new Graph({ directed: true });
    assert.throws(() => { g.directed = false; }, { name: "TypeError" });
    assert.equal(g.directed, true);
  });

  test("self-loops add and remove cleanly", () => {
    const g = new Graph();
    g.addNode({ id: "a" });
    assert.equal(g.addEdge("a", "a"), true);
    assert.equal(g.edges.size, 1);
    assert.equal(g.removeEdge("a", "a"), true);
    assert.equal(g.edges.size, 0);
  });
});

describe("Graph: events", () => {
  const ALL = ["nodeadd", "noderemove", "nodedatachange", "edgeadd", "edgeremove", "edgedatachange"];
  // Records every event as [type, ...ids], plus the full events in `events`
  function recorded(directed = false) {
    const g = new Graph({ directed });
    const log = [], events = [];
    for (const type of ALL) g.on(type, e => {
      events.push(e);
      log.push(e.srcId !== undefined ? [type, e.srcId, e.destId] : [type, e.id]);
    });
    return { g, log, events };
  }

  test("adding nodes and edges emits nodeadd and edgeadd with the new items", () => {
    const { g, log, events } = recorded();
    const data = { label: "A" };
    g.addNode(data, "a");
    g.addNode({}, "b");
    g.addEdge("a", "b", { w: 2 });
    assert.deepEqual(log, [["nodeadd", "a"], ["nodeadd", "b"], ["edgeadd", "a", "b"]]);
    assert.equal(events[0].node, g.nodes.get("a"));
    assert.equal(events[0].node.data, data);
    assert.equal(events[2].edge, g.getEdge("a", "b"));
    assert.equal(events[2].target, g);
  });

  test("a generated id is reported", () => {
    const { g, events } = recorded();
    const id = g.addNode({ label: "x" });
    assert.equal(events[0].id, id);
  });

  test("no-ops emit nothing", () => {
    const { g, log } = recorded();
    g.addNode({}, "a");
    g.addNode({}, "b");
    g.addEdge("a", "b");
    log.length = 0;
    g.addNode({}, "a");                        // id in use
    assert.equal(g.addEdge("a", "b"), false);  // duplicate
    assert.equal(g.addEdge("b", "a"), false);  // the same undirected edge
    assert.equal(g.removeEdge("a", "zzz"), false);
    assert.equal(g.removeNode("zzz"), false);
    assert.deepEqual(log, []);
  });

  test("failed changes that throw emit nothing", () => {
    const { g, log } = recorded();
    g.addNode({}, "a");
    log.length = 0;
    assert.throws(() => g.addEdge("a", "missing"), ReferenceError);
    assert.throws(() => g.setNodeData("missing", {}), ReferenceError);
    assert.throws(() => g.setEdgeData("a", "missing", {}), ReferenceError);
    assert.deepEqual(log, []);
  });

  test("listeners see the graph after the change", () => {
    const g = pair();
    const seen = [];
    g.on("nodeadd", e => seen.push(["nodeadd", e.target.nodes.has(e.id), e.target.version]));
    g.on("edgeadd", e => seen.push(["edgeadd", e.target.hasEdge(e.srcId, e.destId), e.target.degree(e.srcId)]));
    g.on("noderemove", e => seen.push(["noderemove", e.target.nodes.has(e.id), e.target.degree(e.id)]));
    g.on("edgeremove", e => seen.push(["edgeremove", e.target.hasEdge(e.srcId, e.destId), e.target.edges.has(e.edge)]));
    g.addNode({}, "c");
    const v = g.version;
    g.addEdge("a", "c");
    g.removeEdge("a", "c");
    g.removeNode("c");
    assert.deepEqual(seen, [
      ["nodeadd", true, v],
      ["edgeadd", true, 1],
      ["edgeremove", false, false],
      ["noderemove", false, 0],
    ]);
  });

  test("removing a node emits edgeremove for each of its edges, then noderemove", () => {
    const { g, log } = recorded();
    for (const id of ["a", "b", "c", "d"]) g.addNode({}, id);
    g.addEdge("a", "b");
    g.addEdge("c", "a");
    g.addEdge("b", "d");
    log.length = 0;
    g.removeNode("a");
    assert.deepEqual(log.map(e => e[0]), ["edgeremove", "edgeremove", "noderemove"]);
    assert.deepEqual(new Set(log.slice(0, 2).map(e => e.slice(1).join("-"))), new Set(["a-b", "c-a"]));
    assert.deepEqual(log[2], ["noderemove", "a"]);
  });

  test("in a directed graph, removing a node also reports its incoming edges", () => {
    const { g, log } = recorded(true);
    for (const id of ["a", "b", "c"]) g.addNode({}, id);
    g.addEdge("a", "b");
    g.addEdge("c", "a");
    g.addEdge("a", "c");
    log.length = 0;
    g.removeNode("a");
    assert.deepEqual(log.filter(e => e[0] === "edgeremove").map(e => e.slice(1).join(">")).sort(), ["a>b", "a>c", "c>a"]);
    assert.equal(log.at(-1)[0], "noderemove");
  });

  test("an undirected edge reports the pair it was stored with, whichever way it's named", () => {
    const { g, log } = recorded();
    g.addNode({}, "a");
    g.addNode({}, "b");
    g.addEdge("a", "b");
    g.setEdgeData("b", "a", { w: 1 });
    g.removeEdge("b", "a");
    assert.deepEqual(log.slice(2), [["edgeadd", "a", "b"], ["edgedatachange", "a", "b"], ["edgeremove", "a", "b"]]);
  });

  test("data changes carry the new and previous data", () => {
    const { g, events } = recorded();
    const old = { v: 1 }, next = { v: 2 };
    g.addNode(old, "a");
    g.addNode({}, "b");
    const oldEdge = { w: 1 };
    g.addEdge("a", "b", oldEdge);
    events.length = 0;
    g.setNodeData("a", next);
    g.setEdgeData("a", "b", { w: 2 });
    const [nodeChange, edgeChange] = events;
    assert.equal(nodeChange.type, "nodedatachange");
    assert.equal(nodeChange.prev, old);
    assert.equal(nodeChange.node.data, next);
    assert.equal(edgeChange.type, "edgedatachange");
    assert.equal(edgeChange.prev, oldEdge);
    assert.deepEqual(edgeChange.edge.data, { w: 2 });
  });

  test("setting the same data again still reports a change", () => {
    const { g, events } = recorded();
    const data = { v: 1 };
    g.addNode(data, "a");
    events.length = 0;
    g.setNodeData("a", data);
    assert.equal(events.length, 1, "like dataVersion, it counts calls, not differences");
    assert.equal(events[0].prev, data);
  });

  test("a listener can change the graph, and those changes report their own events", () => {
    const { g, log } = recorded();
    g.on("nodeadd", e => { if (e.id !== "hub") e.target.addEdge("hub", e.id); });
    g.addNode({}, "hub");
    g.addNode({}, "a");
    assert.deepEqual(log, [["nodeadd", "hub"], ["nodeadd", "a"], ["edgeadd", "hub", "a"]]);
    assert.ok(g.hasEdge("hub", "a"));
  });

  test("a node removed by its own edgeremove listener is reported once", () => {
    const { g, log } = recorded();
    for (const id of ["a", "b", "c"]) g.addNode({}, id);
    g.addEdge("a", "b");
    g.addEdge("a", "c");
    g.on("edgeremove", e => { e.target.removeNode("a"); });
    log.length = 0;
    assert.equal(g.removeNode("a"), true);
    assert.equal(log.filter(e => e[0] === "noderemove").length, 1);
    assert.equal(log.filter(e => e[0] === "edgeremove").length, 2);
    assert.equal(g.nodes.has("a"), false);
    assert.equal(g.edges.size, 0);
  });

  test("preventDefault has no effect on graph events", () => {
    const g = new Graph();
    for (const type of ALL) g.on(type, e => e.preventDefault());
    g.addNode({}, "a");
    g.addNode({}, "b");
    g.addEdge("a", "b");
    g.setNodeData("a", { v: 1 });
    g.removeNode("b");
    assert.deepEqual([...g.nodes.keys()], ["a"]);
    assert.deepEqual(g.nodes.get("a").data, { v: 1 });
    assert.equal(g.edges.size, 0);
  });

  test("only graph event names are accepted", () => {
    const g = new Graph();
    assert.throws(() => g.on("settle", () => {}), /^TypeError: Graph: unknown event "settle"$/);
  });
});
