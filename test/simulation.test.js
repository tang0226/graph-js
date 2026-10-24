import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";
import { Simulation } from "../src/simulation.js";

const RECORD_FIELDS = ["id", "mass", "radius", "fixed", "x", "y", "vx", "vy", "fx", "fy"];

function chain(n, { directed = false, extra = [] } = {}) {
  const g = new Graph({ directed });
  for (let i = 0; i < n; i++) {
    g.addNode({ id: "n" + i, w: i + 1 });
    if (i > 0) g.addEdge("n" + (i - 1), "n" + i);
  }
  for (const [a, b] of extra) g.addEdge(a, b);
  return g;
}

function pairSim(directed, edges) {
  const g = new Graph({ directed });
  g.addNode({ id: "a" });
  g.addNode({ id: "b" });
  for (const [s, d] of edges) g.addEdge(s, d);
  const sim = new Simulation(g, {});
  sim.sync();
  return sim;
}

describe("Simulation: records", () => {
  test("every record carries the full field set in a stable order", () => {
    const sim = new Simulation(chain(3), {});
    for (const rec of sim.nodeList) assert.deepEqual(Object.keys(rec), RECORD_FIELDS);
  });

  test("seeded positions are finite and jittered apart", () => {
    const sim = new Simulation(chain(12), {});
    const seen = new Set();
    for (const r of sim.nodeList) {
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
      seen.add(r.x + "," + r.y);
    }
    assert.equal(seen.size, 12, "coincident seeds produce NaN repulsion forces");
  });

  test("nodeIndex maps ids to their slot in nodeList", () => {
    const sim = new Simulation(chain(5), {});
    for (const [id, i] of sim.nodeIndex) assert.equal(sim.nodeList[i].id, id);
  });

  test("getPosition returns a copy, not the live record", () => {
    const sim = new Simulation(chain(2), {});
    const p = sim.getPosition("n0");
    p[0] = 9999;
    assert.notEqual(sim.nodes.get("n0").x, 9999);
    assert.equal(sim.getPosition("nope"), null);
  });
});

describe("Simulation: config cascade", () => {
  function build() {
    const g = new Graph();
    g.addNode({ id: "a", w: 7 });
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ mass: n => n.data.w, radius: 20, fixed: false });
    const resolve = () => { sim._configDirty = true; sim.sync(); return sim.nodes.get("a"); };
    return [sim, resolve];
  }

  test("accessors resolve against the graph node", () => {
    const [, resolve] = build();
    assert.equal(resolve().mass, 7);
    assert.equal(resolve().radius, 20);
  });

  test("a constant override wins over the accessor", () => {
    const [sim, resolve] = build();
    sim.setNodeConfig("a", { mass: 99 });
    assert.equal(resolve().mass, 99);
  });

  test("overrides merge rather than replace", () => {
    const [sim, resolve] = build();
    sim.setNodeConfig("a", { mass: 99 });
    sim.setNodeConfig("a", { fixed: true });
    assert.equal(resolve().mass, 99, "the earlier override was clobbered");
    assert.equal(resolve().fixed, true);
  });

  test("function-valued overrides are supported", () => {
    const [sim, resolve] = build();
    sim.setNodeConfig("a", { radius: n => n.data.w * 2 });
    assert.equal(resolve().radius, 14);
  });

  test("undefined reverts one field to the accessor", () => {
    const [sim, resolve] = build();
    sim.setNodeConfig("a", { mass: 99 });
    sim.setNodeConfig("a", { mass: undefined });
    assert.equal(resolve().mass, 7);
  });

  test("a false override survives the ?? fallthrough", () => {
    const [sim, resolve] = build();
    sim.setDefaultNodeConfig({ fixed: true });
    sim.setNodeConfig("a", { fixed: false });
    assert.equal(resolve().fixed, false, "falsy overrides must not fall through to the default");
  });

  test("clearNodeConfig drops every override for that node", () => {
    const [sim, resolve] = build();
    sim.setNodeConfig("a", { mass: 99, radius: 1 });
    sim.clearNodeConfig("a");
    assert.equal(resolve().mass, 7);
    assert.equal(resolve().radius, 20);
  });

  test("overrides are pruned when the node is removed", () => {
    const g = chain(3);
    const sim = new Simulation(g, {});
    sim.setNodeConfig("n1", { mass: 50 });
    sim.sync();
    g.removeNode("n1");
    sim.sync();
    assert.equal(sim._overrides.has("n1"), false, "a stale override would reapply if n1 returns");
  });
});

describe("Simulation: validation", () => {
  function resolved(cfg) {
    const g = new Graph();
    g.addNode({ id: "a" });
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig(cfg);
    sim.sync();
    return sim.nodes.get("a");
  }

  test("mass is clamped away from zero", () => {
    assert.ok(resolved({ mass: 0 }).mass > 0, "mass 0 makes fx/mass infinite");
  });

  test("non-finite params fall back to defaults", () => {
    assert.equal(resolved({ mass: NaN }).mass, 1);
    assert.equal(resolved({ radius: undefined }).radius, 20);
    assert.equal(resolved({ radius: () => "big" }).radius, 20);
  });

  test("radius cannot go negative", () => {
    assert.equal(resolved({ radius: -5 }).radius, 0);
  });

  test("fixed is coerced to a real boolean", () => {
    assert.equal(resolved({ fixed: "yes" }).fixed, false);
    assert.equal(resolved({ fixed: 1 }).fixed, false);
    assert.equal(resolved({ fixed: true }).fixed, true);
  });
});

describe("Simulation: sync paths", () => {
  test("an unchanged graph short-circuits", () => {
    const sim = new Simulation(chain(4), {});
    assert.equal(sim.sync(), false);
  });

  test("a config-only change re-resolves without rebuilding the slot space", () => {
    const sim = new Simulation(chain(4), {});
    const list = sim.nodeList, index = sim.nodeIndex, version = sim.version;
    sim.setDefaultNodeConfig({ radius: 33 });
    assert.equal(sim.sync(), true);
    assert.equal(sim.nodeList, list, "slots must not be rebuilt for a config change");
    assert.equal(sim.nodeIndex, index);
    assert.equal(sim.version, version, "version signals structural change only");
    assert.equal(sim.nodes.get("n0").radius, 33);
  });

  test("a topology change rebuilds the slot space and bumps _version", () => {
    const g = chain(4);
    const sim = new Simulation(g, {});
    const version = sim.version;
    g.addNode({ id: "extra" });
    assert.equal(sim.sync(), true);
    assert.ok(sim.version > version);
    assert.equal(sim.nodeList.length, 5);
  });

  test("a data change re-resolves accessors", () => {
    const g = chain(2);
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ mass: n => n.data.w });
    sim.sync();
    assert.equal(sim.nodes.get("n0").mass, 1);
    g.setNodeData("n0", { w: 42 });
    sim.sync();
    assert.equal(sim.nodes.get("n0").mass, 42, "setNodeData must invalidate resolved config");
  });

  test("removed nodes leave the slot space; survivors keep their positions", () => {
    const g = chain(4);
    const sim = new Simulation(g, {});
    for (let t = 0; t < 20; t++) sim.tick();
    const before = sim.getPosition("n0");
    g.removeNode("n2");
    sim.sync();
    assert.equal(sim.nodeList.length, 3);
    assert.equal(sim.nodes.has("n2"), false);
    assert.deepEqual(sim.getPosition("n0"), before, "a rebuild must not teleport survivors");
  });

  test("accessors derived from degree refresh when edges change", () => {
    const g = chain(3);
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ radius: n => 10 + g.degree(n.id) });
    sim.sync();
    assert.equal(sim.nodes.get("n0").radius, 11);
    g.addEdge("n0", "n2");
    sim.sync();
    assert.equal(sim.nodes.get("n0").radius, 12);
  });
});

describe("Simulation: springs and edge pairs", () => {
  test("undirected: one pair, one spring", () => {
    const sim = pairSim(false, [["a", "b"]]);
    assert.deepEqual([...sim.edgePairs], [0, 1]);
    assert.deepEqual([...sim.springs], [0, 1]);
  });

  test("edgeRefs is parallel to edgePairs", () => {
    const sim = pairSim(false, [["a", "b"]]);
    assert.equal(sim.edgeRefs.length, sim.edgePairs.length / 2);
    assert.equal(sim.edgeRefs[0].src.id, "a");
    assert.equal(sim.edgeRefs[0].dest.id, "b");
  });

  test("directed: reciprocal edges draw twice but pull once", () => {
    const sim = pairSim(true, [["a", "b"], ["b", "a"]]);
    assert.equal(sim.edgePairs.length / 2, 2, "both directions must stay drawable");
    assert.equal(sim.springs.length / 2, 1, "a mutual link must not double the stiffness");
  });

  test("spring force on a mutual pair equals the single-edge force", () => {
    function force(sim) {
      const A = sim.nodes.get("a"), B = sim.nodes.get("b");
      A.x = 0; A.y = 0; B.x = 200; B.y = 0;
      A.fx = 0; A.fy = 0; B.fx = 0; B.fy = 0;
      sim._applySprings();
      return A.fx;
    }
    assert.equal(force(pairSim(true, [["a", "b"], ["b", "a"]])),
                 force(pairSim(true, [["a", "b"]])));
  });

  test("directed: self-loops are excluded from springs", () => {
    const sim = pairSim(true, [["a", "a"]]);
    assert.deepEqual([...sim.edgePairs], [0, 0]);
    assert.equal(sim.springs.length, 0);
  });

  test("undirected: self-loops are excluded from springs", {
    todo: "the undirected path aliases springs to edgePairs, re-admitting the "
        + "self-loop the build loop filtered out. Fix: alias only when nothing "
        + "was filtered (springs.length === pairs.length).",
  }, () => {
    const sim = pairSim(false, [["a", "a"]]);
    assert.equal(sim.springs.length, 0);
  });
});

describe("Simulation: integration", () => {
  // Deterministic start: seeding is random, and some seeds land in a limit
  // cycle (see the todo below), so a fixed ring keeps this test meaningful.
  function ring(n, radius = 20) {
    const sim = new Simulation(chain(n, { extra: [["n0", "n" + ((n / 2) | 0)]] }), {});
    sim.setDefaultNodeConfig({ radius });
    sim.sync();
    sim.nodeList.forEach((r, i) => {
      const a = (i / n) * 2 * Math.PI;
      r.x = Math.cos(a) * 300; r.y = Math.sin(a) * 300; r.vx = 0; r.vy = 0;
    });
    return sim;
  }

  test("a connected graph settles from a spread start", () => {
    const sim = ring(25);
    for (let t = 0; t < 3000; t++) sim.tick();
    let maxV = 0;
    for (const r of sim.nodeList) {
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), "position went non-finite");
      maxV = Math.max(maxV, Math.hypot(r.vx, r.vy));
    }
    assert.ok(maxV < 0.01, `expected the layout to come to rest, max speed was ${maxV}`);
  });

  test("stays finite and bounded from the library's own seeding", () => {
    for (let trial = 0; trial < 10; trial++) {
      const sim = new Simulation(chain(30, { extra: [["n0", "n15"]] }), {});
      for (let t = 0; t < 2000; t++) sim.tick();
      for (const r of sim.nodeList) {
        assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), "position went non-finite");
        assert.ok(Math.hypot(r.vx, r.vy) < sim.opts.maxSpeed + 1e-9, "maxSpeed was exceeded");
      }
    }
  });

  // Collision resolution alone can hold overlapping pairs in a limit cycle;
  // cooling is what guarantees convergence for every seed.
  test("always comes to rest, whatever the seed", () => {
    for (let trial = 0; trial < 20; trial++) {
      const sim = new Simulation(chain(40, { extra: [["n0", "n20"]] }), {});
      for (let t = 0; t < 4000; t++) sim.tick();
      const maxV = Math.max(...sim.nodeList.map(r => Math.hypot(r.vx, r.vy)));
      assert.ok(maxV < 0.01, `seed ${trial} never settled, max speed ${maxV}`);
    }
  });

  test("coincident nodes separate instead of producing NaN", () => {
    const sim = new Simulation(chain(4), {});
    for (const r of sim.nodeList) { r.x = 0; r.y = 0; r.vx = 0; r.vy = 0; }
    for (let t = 0; t < 50; t++) sim.tick();
    for (const r of sim.nodeList) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
  });

  test("fixed nodes never move and hold zero velocity", () => {
    const sim = new Simulation(chain(5), {});
    sim.setNodeConfig("n2", { fixed: true });
    sim.sync();
    const rec = sim.nodes.get("n2");
    rec.x = 11; rec.y = 22;
    for (let t = 0; t < 40; t++) sim.tick();
    assert.deepEqual([rec.x, rec.y], [11, 22]);
    assert.deepEqual([rec.vx, rec.vy], [0, 0]);
  });

  test("maxSpeed bounds the per-step velocity", () => {
    const sim = new Simulation(chain(3), { maxSpeed: 2 });
    for (const r of sim.nodeList) { r.vx = 500; r.vy = 500; }
    sim.tick();
    for (const r of sim.nodeList)
      if (!r.fixed) assert.ok(Math.hypot(r.vx, r.vy) <= 2 + 1e-9);
  });

  test("overlapping nodes are pushed apart until they touch", () => {
    const g = new Graph();
    g.addNode({ id: "a" });
    g.addNode({ id: "b" });
    const sim = new Simulation(g, { repulsion: 0, gravity: 0 });
    sim.setDefaultNodeConfig({ radius: 20 });
    sim.sync();
    const A = sim.nodes.get("a"), B = sim.nodes.get("b");
    A.x = 0; A.y = 0; B.x = 5; B.y = 0;
    sim._enforceRadius();
    assert.ok(Math.hypot(A.x - B.x, A.y - B.y) >= 39.99);
  });
});

describe("Simulation: temperature", () => {
  // Synced, then frozen: any later reheat must come from the code under test.
  function frozen(g = chain(3), opts = {}) {
    const sim = new Simulation(g, opts);
    sim.sync();
    sim.heat(0);
    return sim;
  }

  function snapshot(sim) { return sim.nodeList.map(r => [r.x, r.y, r.vx, r.vy]); }

  test("a new simulation starts hot with default cooling", () => {
    const sim = new Simulation(chain(2), {});
    assert.equal(sim.temp, 1);
    assert.equal(sim.opts.cooling, 0.98);
    assert.equal(sim.opts.freezePoint, 0.01);
  });

  test("heat() defaults to 1 and clamps invalid values to 0", () => {
    const sim = frozen();
    assert.equal(sim.heat().temp, 1);
    assert.equal(sim.heat(0.4).temp, 0.4);
    assert.equal(sim.heat(-1).temp, 0);
    assert.equal(sim.heat(NaN).temp, 0);
  });

  test("each tick decays temp by opts.cooling", () => {
    const sim = new Simulation(chain(3), { cooling: 0.5, freezePoint: 0.01 });
    sim.tick();
    assert.equal(sim.temp, 0.5);
    sim.tick();
    assert.equal(sim.temp, 0.25);
  });

  test("temp drops to 0 below freezePoint and zeroes residual velocity", () => {
    const sim = new Simulation(chain(5), { cooling: 0.5, freezePoint: 0.1 });
    for (let t = 0; t < 4; t++) sim.tick();       // 1 -> .5 -> .25 -> .125 -> .0625
    assert.equal(sim.temp, 0);
    for (const r of sim.nodeList) assert.deepEqual([r.vx, r.vy], [0, 0],
      "leftover velocity would be replayed by the next heat()");
  });

  test("a frozen tick moves nothing", () => {
    const sim = frozen(chain(5));
    for (const r of sim.nodeList) { r.vx = 3; r.vy = -3; }
    const before = snapshot(sim);
    for (let t = 0; t < 10; t++) sim.tick();
    assert.deepEqual(snapshot(sim), before);
    assert.equal(sim.temp, 0);
  });

  test("temp scales forces, not displacement", () => {
    function velocityAfterOneTick(t) {
      const g = new Graph();
      g.addNode({ id: "a" });
      g.addNode({ id: "b" });
      const sim = new Simulation(g, { gravity: 0, freezePoint: 0 });
      const A = sim.nodes.get("a"), B = sim.nodes.get("b");
      A.x = 0; A.y = 0; B.x = 100; B.y = 0;
      sim.heat(t).tick();
      return A.vx;
    }
    const full = velocityAfterOneTick(1), half = velocityAfterOneTick(0.5);
    assert.ok(full !== 0);
    assert.ok(Math.abs(half / full - 0.5) < 1e-12, `expected half the velocity, got ratio ${half / full}`);
  });

  test("setOpts merges options and reheats", () => {
    const sim = frozen();
    sim.setOpts({ repulsion: 1234 });
    assert.equal(sim.opts.repulsion, 1234);
    assert.equal(sim.opts.friction, 0.9, "unrelated options must survive the merge");
    assert.equal(sim.temp, 1);
  });

  describe("sync() reheats only on physical changes", () => {
    test("structural changes reheat", () => {
      const g = chain(3);
      const sim = frozen(g);
      g.addNode({ id: "extra" });
      sim.sync();
      assert.equal(sim.temp, 1, "addNode");

      sim.heat(0);
      g.removeEdge("n0", "n1");
      sim.sync();
      assert.equal(sim.temp, 1, "removeEdge");
    });

    test("a config change that alters resolved values reheats", () => {
      const sim = frozen();
      sim.setDefaultNodeConfig({ radius: 35 });
      assert.equal(sim.temp, 0, "the setter defers to sync()");
      sim.sync();
      assert.equal(sim.temp, 1);
    });

    test("a config change that resolves to the same values does not", () => {
      const sim = frozen();
      sim.setDefaultNodeConfig({ radius: 20, mass: 1, fixed: false });
      sim.setNodeConfig("n0", { radius: 20 });
      assert.equal(sim.sync(), true, "config was re-resolved");
      assert.equal(sim.temp, 0);
    });

    test("a data change that does not affect physics does not", () => {
      const g = chain(3);
      const sim = frozen(g);
      g.setNodeData("n0", { label: "renamed" });
      assert.equal(sim.sync(), true, "data changes still re-resolve accessors");
      assert.equal(sim.temp, 0);
    });

    test("a data change that resolves to a new radius does", () => {
      const g = chain(3);
      const sim = new Simulation(g, { nodeConfig: { radius: n => 10 * n.data.w } });
      sim.sync();
      sim.heat(0);
      g.setNodeData("n0", { w: 5 });
      sim.sync();
      assert.equal(sim.nodes.get("n0").radius, 50);
      assert.equal(sim.temp, 1);
    });

    test("clearNodeConfig reheats when it changes resolved values", () => {
      const sim = frozen();
      sim.setNodeConfig("n0", { mass: 9 });
      sim.sync();
      sim.heat(0);
      sim.clearNodeConfig("n0");
      sim.sync();
      assert.equal(sim.nodes.get("n0").mass, 1);
      assert.equal(sim.temp, 1);
    });
  });

  describe("pin and unpin", () => {
    test("pinning to a new position reheats immediately", () => {
      const sim = frozen();
      sim.pin("n0", 500, 500);
      assert.equal(sim.temp, 1);
    });

    test("re-pinning a fixed node in place stays frozen", () => {
      const sim = frozen();
      const [x, y] = sim.getPosition("n0");
      sim.pin("n0", x, y);
      sim.sync();
      assert.equal(sim.temp, 1, "fixed went false -> true, which is a physical change");

      sim.heat(0);
      sim.pin("n0", x, y);
      sim.sync();
      assert.equal(sim.temp, 0, "nothing moved and fixed was already true");
    });

    test("unpin reheats once fixed is released", () => {
      const sim = frozen();
      sim.pin("n0", 10, 10);
      sim.sync();
      sim.heat(0);
      sim.unpin("n0");
      sim.sync();
      assert.equal(sim.nodes.get("n0").fixed, false);
      assert.equal(sim.temp, 1);
    });

    test("a dragged node's neighbours keep responding while it is held", () => {
      const sim = frozen(chain(3), { cooling: 0.5 });
      sim.pin("n0", 0, 0);
      for (let t = 0; t < 20; t++) { sim.pin("n0", t * 10, 0); sim.tick(); }
      assert.ok(sim.temp > 0, "each move must keep the simulation awake");
    });
  });
});

describe("Simulation: pin and unpin", () => {
  test("pin fixes the node at the given point", () => {
    const sim = new Simulation(chain(3), {});
    sim.pin("n0", 70, -30);
    sim.tick();
    assert.deepEqual(sim.getPosition("n0"), [70, -30]);
    assert.equal(sim.nodes.get("n0").fixed, true);
  });

  test("pin on an unknown id returns false instead of throwing", () => {
    const sim = new Simulation(chain(2), {});
    assert.equal(sim.pin("nope", 0, 0), false);
  });

  test("unpin reverts to the configured accessor rather than forcing false", () => {
    const g = new Graph();
    g.addNode({ id: "p", locked: true });
    g.addNode({ id: "q", locked: false });
    g.addEdge("p", "q");
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ fixed: n => n.data.locked === true });
    sim.sync();
    assert.equal(sim.nodes.get("p").fixed, true);

    sim.pin("p", 5, 5);
    sim.tick();
    sim.unpin("p");
    sim.tick();
    assert.equal(sim.nodes.get("p").fixed, true,
      "unpin must not write a sticky false that defeats the accessor");
  });
});
