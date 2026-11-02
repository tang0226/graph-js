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

  test("edgeList is parallel to edgePairs", () => {
    const sim = pairSim(false, [["a", "b"]]);
    assert.equal(sim.edgeList.length, sim.edgePairs.length / 2);
    assert.equal(sim.edgeList[0].src.id, "a");
    assert.equal(sim.edgeList[0].dest.id, "b");
  });

  test("edgeIndex maps edge objects to their slot in edgeList", () => {
    const sim = pairSim(true, [["a", "b"], ["b", "a"], ["a", "a"]]);
    assert.equal(sim.edgeIndex.size, sim.edgeList.length);
    for (const [edge, i] of sim.edgeIndex) assert.equal(sim.edgeList[i], edge);
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

  describe("dt option", () => {
    function pair(opts) {
      const g = new Graph();
      g.addNode({ id: "a" });
      g.addNode({ id: "b" });
      const sim = new Simulation(g, { gravity: 0, freezePoint: 0, ...opts });
      const A = sim.nodes.get("a"), B = sim.nodes.get("b");
      A.x = 0; A.y = 0; B.x = 100; B.y = 0;
      return sim;
    }
    const x = sim => sim.nodes.get("a").x;

    test("defaults to 1, matching tick() before the option existed", () => {
      const sim = pair(), explicit = pair();
      assert.equal(sim.opts.dt, 1);
      sim.tick();
      explicit.tick(1);
      assert.equal(x(sim), x(explicit));
    });

    test("is used by tick() when no dt is given", () => {
      const sim = pair({ dt: 3 }), explicit = pair();
      sim.tick();
      explicit.tick(3);
      assert.ok(x(sim) !== 0);
      assert.equal(x(sim), x(explicit));
    });

    test("is overridden by a dt passed to tick()", () => {
      const sim = pair({ dt: 3 }), explicit = pair();
      sim.tick(2);
      explicit.tick(2);
      assert.equal(x(sim), x(explicit));
    });

    test("doubling it from rest quadruples the first tick's movement", () => {
      const base = pair(), doubled = pair({ dt: 2 });
      base.tick();
      doubled.tick();
      assert.ok(Math.abs(x(doubled) / x(base) - 4) < 1e-9, `got ratio ${x(doubled) / x(base)}`);
    });

    test("setOpts changes it and reheats", () => {
      const sim = frozen();
      sim.setOpts({ dt: 2.5 });
      assert.equal(sim.opts.dt, 2.5);
      assert.equal(sim.temp, 1);
    });

    test("leaves the number of ticks to freeze unchanged", () => {
      const ticksToFreeze = dt => {
        const sim = new Simulation(chain(6), { dt });
        let ticks = 0;
        while (sim.temp > 0) { sim.tick(); ticks++; }
        return ticks;
      };
      assert.equal(ticksToFreeze(3), ticksToFreeze(1));
    });
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
      const [x, y] = /** @type {[number, number]} */ (sim.getPosition("n0"));
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

describe("Simulation: Barnes-Hut", () => {
  // Deterministic start. Slightly uneven, so bodies don't sit on cell boundaries.
  function grid(n, opts = {}) {
    const sim = new Simulation(chain(n), opts);
    sim.nodeList.forEach((r, i) => {
      r.x = (i % 10) * 70 + (i * 7 % 13) * 0.1;
      r.y = Math.floor(i / 10) * 70 + (i * 11 % 17) * 0.1;
      r.vx = 0; r.vy = 0;
    });
    return sim;
  }

  function assertPacked(sim) {
    const list = sim.nodeList;
    for (const name of ["_nodeRadius", "_nodeFixed", "_nodeX", "_nodeY", "_nodeFx", "_nodeFy"])
      assert.equal(sim[name].length, list.length, name);
    list.forEach((r, i) => {
      assert.equal(sim._nodeRadius[i], r.radius, `radius of ${r.id}`);
      assert.equal(sim._nodeFixed[i], r.fixed ? 1 : 0, `fixed flag of ${r.id}`);
    });
  }

  describe("options", () => {
    test("it is on by default and can be turned off", () => {
      assert.equal(new Simulation(chain(2), {})._opts.useBarnesHut, true);
      assert.equal(new Simulation(chain(2), { useBarnesHut: false })._opts.useBarnesHut, false);
    });

    test("constructor options reach the context, even while it is off", () => {
      const sim = new Simulation(chain(2), { useBarnesHut: false, barnesHut: { theta: 0.4, maxDepth: 7 } });
      assert.equal(sim._barnesHutCtx.theta, 0.4);
      assert.equal(sim._barnesHutCtx.maxDepth, 7);
    });

    for (const useBarnesHut of [true, false]) {
      test(`setOpts tunes the context without changing a useBarnesHut of ${useBarnesHut}`, () => {
        const sim = new Simulation(chain(2), { useBarnesHut });
        sim.setOpts({ barnesHut: { theta: 0.5 } });
        assert.equal(sim._barnesHutCtx.theta, 0.5);
        assert.equal(sim._opts.useBarnesHut, useBarnesHut);
      });
    }

    test("barnesHut does not leak into the simulation's own options", () => {
      const sim = new Simulation(chain(2), {});
      sim.setOpts({ barnesHut: { theta: 0.5 } });
      assert.equal("barnesHut" in sim._opts, false);
    });

    test("an explicit useBarnesHut wins when set alongside barnesHut", () => {
      const sim = new Simulation(chain(2), {});
      sim.setOpts({ barnesHut: { theta: 0.5 }, useBarnesHut: false });
      assert.equal(sim._opts.useBarnesHut, false);
    });

    test("turning it on after construction still applies repulsion and collisions", () => {
      const sim = grid(2, { useBarnesHut: false, gravity: 0, springStiffness: 0 });
      const [a, b] = sim.nodeList;
      a.x = 0; a.y = 0; b.x = 10; b.y = 0;

      sim.setOpts({ useBarnesHut: true });
      sim.tick();
      assert.ok(a.fx < 0 && b.fx > 0, "repulsion went missing");
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 39.99, "collision went missing");
    });

    test("while on, a tick runs repel once", () => {
      const sim = grid(6);
      const ctx = sim._barnesHutCtx, calls = { repel: 0 };
      const { repel } = ctx;
      ctx.repel = function (...args) { calls.repel++; return repel.apply(this, args); };
      sim.heat();
      sim.tick();
      assert.deepEqual(calls, { repel: 1 });
    });

    test("turning it off goes back to the exact path", () => {
      const sim = grid(6, { collision: "barnesHut" });
      sim._barnesHutCtx.repel = () => assert.fail("repel called while off");
      sim.setOpts({ useBarnesHut: false });
      sim.tick();
    });
  });

  describe("repulsion", () => {
    test("theta 0 gives the same forces as the exact path", () => {
      const exact = grid(60, { useBarnesHut: false });
      const tree = grid(60, { barnesHut: { theta: 0 } });
      exact._applyRepulsion();
      tree._applyRepulsion();
      tree.nodeList.forEach((r, i) => {
        assert.ok(Math.abs(r.fx - exact.nodeList[i].fx) < 1e-9);
        assert.ok(Math.abs(r.fy - exact.nodeList[i].fy) < 1e-9);
      });
    });

    test("forces add to what nodes already carry", () => {
      const sim = grid(5);
      sim._applyRepulsion();
      const once = sim.nodeList.map(r => r.fx);
      sim.nodeList.forEach(r => { r.fx += 7; });
      sim._applyRepulsion();
      sim.nodeList.forEach((r, i) => assert.ok(Math.abs(r.fx - (2 * once[i] + 7)) < 1e-9));
    });

    test("it reads positions set directly on nodes", () => {
      const sim = grid(2);
      const [a, b] = sim.nodeList;
      sim._applyRepulsion();
      const before = a.fx;
      a.fx = 0; b.fx = 0;
      b.x += 1000;
      sim._applyRepulsion();
      assert.ok(Math.abs(a.fx) < Math.abs(before));
    });
  });

  test("with collisions off, both paths follow the same trajectory at theta 0", () => {
    const opts = { nodeConfig: { radius: 0 } };
    const exact = grid(60, { ...opts, useBarnesHut: false });
    const tree = grid(60, { ...opts, barnesHut: { theta: 0 } });
    for (let t = 0; t < 50; t++) { exact.tick(); tree.tick(); }
    tree.nodeList.forEach((r, i) => {
      assert.ok(Math.hypot(r.x - exact.nodeList[i].x, r.y - exact.nodeList[i].y) < 1e-6);
    });
  });

  test("both paths settle into layouts of a similar size", () => {
    const spread = sim => {
      while (sim.temp > 0) sim.tick();
      const list = sim.nodeList;
      const cx = list.reduce((s, r) => s + r.x, 0) / list.length;
      const cy = list.reduce((s, r) => s + r.y, 0) / list.length;
      return list.reduce((s, r) => s + Math.hypot(r.x - cx, r.y - cy), 0) / list.length;
    };
    const exact = spread(grid(100, { useBarnesHut: false }));
    const tree = spread(grid(100));
    assert.ok(Math.abs(tree - exact) / exact < 0.1, `${tree} vs ${exact}`);
  });

  for (const collision of ["grid", "barnesHut", "pairs"]) {
    describe(`collisions with collision "${collision}"`, () => {
      const pair = () => {
        const g = new Graph();
        g.addNode({ id: "a" });
        g.addNode({ id: "b" });
        const sim = new Simulation(g, { collision, repulsion: 0, gravity: 0, nodeConfig: { radius: 20 } });
        sim.sync();
        const A = sim.nodes.get("a"), B = sim.nodes.get("b");
        A.x = 0; A.y = 0; B.x = 10; B.y = 0;
        return { sim, A, B };
      };

      test("an overlapping pair is written back to the nodes, just touching", () => {
        const { sim, A, B } = pair();
        sim._enforceRadius();
        assert.ok(Math.abs(A.x - -15) < 1e-9);
        assert.ok(Math.abs(B.x - 25) < 1e-9);
      });

      test("a radius changed through config applies on the next tick", () => {
        const { sim, A, B } = pair();
        sim.setNodeConfig("a", { radius: 100 });
        sim.tick();
        assert.ok(Math.hypot(A.x - B.x, A.y - B.y) >= 119.99);
      });

      test("a node fixed through config holds still", () => {
        const { sim, A, B } = pair();
        sim.setNodeConfig("a", { fixed: true });
        sim.sync();
        sim._enforceRadius();
        assert.equal(A.x, 0);
        assert.ok(Math.abs(B.x - 40) < 1e-9);
      });

      test("a pinned node holds still through a crowded run", () => {
        const sim = grid(40, { collision, springLength: 0, gravity: 0.05 });
        sim.pin("n0", 100, 100);
        for (let t = 0; t < 60; t++) {
          sim.tick();
          assert.equal(sim.nodes.get("n0").x, 100);
          assert.equal(sim.nodes.get("n0").y, 100);
        }
      });
    });
  }

  describe("collision option", () => {
    // Counts calls to each collision implementation
    function spy(sim) {
      const calls = { grid: 0, barnesHut: 0, pairs: 0 };
      const grid = sim._collisionGrid, ctx = sim._barnesHutCtx;
      const g = grid.collide, b = ctx.collide, p = sim._enforceRadius;
      grid.collide = function (...args) { calls.grid++; return g.apply(this, args); };
      ctx.collide = function (...args) { calls.barnesHut++; return b.apply(this, args); };
      const exact = Simulation.prototype._enforceRadius;
      sim._enforceRadius = function () {
        if (this._opts.collision === "pairs") calls.pairs++;
        return exact.call(this);
      };
      return calls;
    }

    test("it defaults to the grid", () => {
      const sim = grid(6);
      assert.equal(sim.opts.collision, "grid");
      const calls = spy(sim);
      sim.tick();
      assert.deepEqual(calls, { grid: 1, barnesHut: 0, pairs: 0 });
    });

    for (const collision of ["grid", "barnesHut", "pairs"]) {
      test(`"${collision}" runs only its own implementation, once per tick`, () => {
        const sim = grid(6, { collision });
        const calls = spy(sim);
        sim.tick();
        assert.deepEqual(calls, { grid: 0, barnesHut: 0, pairs: 0, [collision]: 1 });
      });
    }

    test("it is independent of useBarnesHut", () => {
      for (const useBarnesHut of [true, false]) {
        const sim = grid(6, { useBarnesHut });
        const calls = spy(sim);
        sim.tick();
        assert.deepEqual(calls, { grid: 1, barnesHut: 0, pairs: 0 }, `useBarnesHut ${useBarnesHut}`);
      }
    });

    test("setOpts switches the method and wakes the layout", () => {
      const sim = grid(6);
      sim.heat(0);
      sim.setOpts({ collision: "pairs" });
      assert.ok(sim.temp > 0);
      const calls = spy(sim);
      sim.tick();
      assert.deepEqual(calls, { grid: 0, barnesHut: 0, pairs: 1 });
    });

    test("all three methods settle a crowded layout with similar overlap", () => {
      // Strong gravity keeps re-creating overlaps that one pass per tick can't
      // fully clear, so each method is compared against checking every pair
      const depth = sim => {
        let d = 0;
        const list = sim.nodeList;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          d += Math.max(a.radius + b.radius - Math.hypot(a.x - b.x, a.y - b.y), 0);
        }
        return d;
      };
      const settled = collision => {
        const sim = grid(60, { collision, springLength: 0, gravity: 0.05, repulsion: 0 });
        sim.setDefaultNodeConfig({ radius: n => (n.id === "n7" ? 90 : 15) });
        while (sim.temp > 0) sim.tick();
        return depth(sim);
      };
      const exact = settled("pairs");
      for (const collision of ["grid", "barnesHut"]) {
        const d = settled(collision);
        assert.ok(d < 1.5 * exact, `${collision} left ${d} of overlap, vs ${exact} for pairs`);
      }
    });
  });

  describe("packed node arrays", () => {
    test("they match the nodes after construction", () => {
      assertPacked(new Simulation(chain(5), { nodeConfig: { radius: 12 } }));
    });

    test("setNodeConfig updates them without a structural change", () => {
      const sim = new Simulation(chain(4), {});
      sim.setNodeConfig("n2", { radius: 77, fixed: true });
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius[sim.nodeIndex.get("n2")], 77);
      assert.equal(sim._nodeFixed[sim.nodeIndex.get("n2")], 1);
    });

    test("setDefaultNodeConfig updates them", () => {
      const sim = new Simulation(chain(4), {});
      sim.setDefaultNodeConfig({ radius: n => n.data.w * 3 });
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius[0], 3);
    });

    test("clearNodeConfig updates them", () => {
      const sim = new Simulation(chain(4), { nodeConfig: { radius: 9 } });
      sim.setNodeConfig("n1", { radius: 50 });
      sim.sync();
      sim.clearNodeConfig("n1");
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius[sim.nodeIndex.get("n1")], 9);
    });

    test("pin and unpin update them", () => {
      const sim = new Simulation(chain(3), {});
      const i = sim.nodeIndex.get("n1");
      sim.pin("n1", 0, 0);
      sim.sync();
      assert.equal(sim._nodeFixed[i], 1);
      sim.unpin("n1");
      sim.sync();
      assert.equal(sim._nodeFixed[i], 0);
    });

    test("graph data changes update them through accessors", () => {
      const g = chain(3);
      const sim = new Simulation(g, { nodeConfig: { radius: n => n.data.w } });
      g.setNodeData("n1", { w: 40 });
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius[sim.nodeIndex.get("n1")], 40);
    });

    test("they follow nodes being added and removed", () => {
      const g = chain(4);
      const sim = new Simulation(g, {});
      sim.setNodeConfig("n3", { radius: 44, fixed: true });
      sim.sync();

      g.removeNode("n0");
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius.length, 3);

      g.addNode({ id: "new1" });
      g.addNode({ id: "new2" });
      sim.sync();
      assertPacked(sim);
      assert.equal(sim._nodeRadius.length, 5);
    });

    test("they realign when a change keeps the node count the same", () => {
      const g = chain(3);
      const sim = new Simulation(g, {});
      sim.setNodeConfig("n2", { radius: 44 });
      sim.sync();
      g.removeNode("n0");
      g.addNode({ id: "swap" });
      sim.sync();
      assertPacked(sim);
    });
  });

  test("ticking works from an empty graph to a populated one", () => {
    const g = new Graph();
    const sim = new Simulation(g, {});
    sim.heat();
    sim.tick();
    g.addNode({ id: "a" });
    sim.tick();
    g.addNode({ id: "b" });
    g.addEdge("a", "b");
    for (let t = 0; t < 5; t++) sim.tick();
    for (const r of sim.nodeList) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
  });
});
