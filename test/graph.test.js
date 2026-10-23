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
    assert.throws(() => g.addEdge("zz", "a"), { name: "ReferenceError", message: /"zz"/ });
    assert.throws(() => g.addEdge("a", "zz"), { name: "ReferenceError", message: /"zz"/ });
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
