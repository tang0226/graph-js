import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphJS } from "../src/graphjs.js";
import * as pkg from "../src/index.js";
import { makeCanvas, installWindow, installRaf, r2 } from "./helpers/stubs.js";

function build({ dpr = 1, directed = false, w = 800, h = 600 } = {}) {
  const restoreWindow = installWindow(dpr);
  const canvas = makeCanvas({ w, h });
  const gjs = new GraphJS({ canvas, graph: { directed } });
  gjs.addNode({ id: "a" });
  gjs.addNode({ id: "b" });
  gjs.addEdge("a", "b");
  gjs.resize();
  gjs.step();
  return { gjs, canvas, restoreWindow };
}

describe("package entry", () => {
  test("the barrel exports every public class", () => {
    assert.deepEqual(Object.keys(pkg).sort(), ["Graph", "GraphJS", "Renderer", "Simulation"]);
  });
});

describe("GraphJS: composition", () => {
  test("the three layers are wired in dependency order", () => {
    const { gjs, restoreWindow } = build();
    try {
      assert.equal(gjs.simulation.graph, gjs.graph);
      assert.equal(gjs.renderer.simulation, gjs.simulation);
      assert.equal(gjs.renderer.graph, gjs.graph);
    } finally { restoreWindow(); }
  });

  test("options are namespaced per layer", () => {
    const restoreWindow = installWindow(1);
    try {
      const gjs = new GraphJS({
        canvas: makeCanvas(),
        graph: { directed: true },
        simulation: { friction: 0.5 },
        renderer: { background: "#123456" },
      });
      assert.equal(gjs.graph.directed, true);
      assert.equal(gjs.simulation.opts.friction, 0.5);
      assert.equal(gjs.renderer.opts.background, "#123456");
    } finally { restoreWindow(); }
  });

  test("graph mutators are forwarded and return their results", () => {
    const { gjs, restoreWindow } = build();
    try {
      assert.equal(gjs.addNode({ id: "c" }), "c");
      assert.equal(typeof gjs.addNode({}), "string", "a generated id must reach the caller");
      assert.equal(gjs.addEdge("a", "c"), true);
      assert.equal(gjs.addEdge("a", "c"), false);
      assert.equal(gjs.removeEdge("a", "c"), true);
      assert.equal(gjs.removeNode("c"), true);
      assert.equal(gjs.removeNode("c"), false);
    } finally { restoreWindow(); }
  });

  test("chainable forwarders return the facade, not the layer they delegate to", () => {
    const { gjs, restoreWindow } = build();
    const raf = installRaf();
    try {
      // Simulation.unpin returns the Simulation, so forwarding it verbatim
      // would hand callers an object without start/stop/attach on it.
      assert.equal(gjs.unpin("a"), gjs);
      assert.doesNotThrow(() => gjs.unpin("a").stop());

      for (const [name, call] of [
        ["attach", () => gjs.attach(makeCanvas())],
        ["resize", () => gjs.resize()],
        ["start", () => gjs.start()],
        ["stop", () => gjs.stop()],
        ["step", () => gjs.step()],
        ["detach", () => gjs.detach()],
      ]) assert.equal(call(), gjs, `${name}() should return the GraphJS instance`);
    } finally { raf.restore(); restoreWindow(); }
  });
});

describe("GraphJS: resize and dpr", () => {
  test("the backing store scales with dpr while the logical size does not", () => {
    for (const dpr of [1, 2, 3]) {
      const { gjs, canvas, restoreWindow } = build({ dpr });
      try {
        assert.deepEqual([canvas.width, canvas.height], [800 * dpr, 600 * dpr]);
        assert.deepEqual(gjs.renderer.size, { w: 800, h: 600 });
      } finally { restoreWindow(); }
    }
  });

  test("the context transform is set once per resize", () => {
    const { canvas, restoreWindow } = build({ dpr: 2 });
    try {
      const t = canvas.ctx.ops.filter(o => o[0] === "setTransform").pop();
      assert.deepEqual(t, ["setTransform", 2, 0, 0, 2, 0, 0]);
    } finally { restoreWindow(); }
  });

  test("world-to-canvas mapping is identical at every dpr", () => {
    for (const dpr of [1, 2, 3]) {
      const { gjs, restoreWindow } = build({ dpr });
      try {
        gjs.renderer.view = { x: 0, y: 0, zoom: 1 };
        assert.deepEqual(gjs.simToCanvas(0, 0).map(r2), [400, 300],
          "the view must be expressed in CSS pixels, not device pixels");
      } finally { restoreWindow(); }
    }
  });
});

describe("GraphJS: coordinates", () => {
  test("canvasToSim inverts simToCanvas exactly", () => {
    const { gjs, restoreWindow } = build({ dpr: 2 });
    try {
      for (const view of [
        { x: 0, y: 0, zoom: 1 },
        { x: 120, y: -40, zoom: 2.5 },
        { x: -900, y: 600, zoom: 0.05 },
      ]) {
        gjs.renderer.view = { ...view };
        const [bx, by] = gjs.canvasToSim(...gjs.simToCanvas(37, -58));
        assert.ok(Math.abs(bx - 37) < 1e-9 && Math.abs(by + 58) < 1e-9,
          `round trip failed at zoom ${view.zoom}`);
      }
    } finally { restoreWindow(); }
  });

  test("zoom scales distance from the view centre", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.renderer.view = { x: 0, y: 0, zoom: 2 };
      assert.deepEqual(gjs.simToCanvas(100, 0).map(r2), [600, 300]);
    } finally { restoreWindow(); }
  });

  test("panning the view shifts the mapping", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.renderer.view = { x: 100, y: 0, zoom: 1 };
      assert.deepEqual(gjs.simToCanvas(100, 0).map(r2), [400, 300],
        "the view centre should map to the canvas centre");
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: picking and pinning", () => {
  test("nodeAt takes canvas coordinates and returns an id", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.pin("a", 400, 300);
      gjs.step();
      assert.equal(gjs.nodeAt(400, 300), "a");
      assert.equal(gjs.nodeAt(10, 10), null);
    } finally { restoreWindow(); }
  });

  test("picking tolerance holds at different zooms", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.simulation.setDefaultNodeConfig({ radius: 20 });
      gjs.pin("a", 400, 300);
      gjs.step();
      for (const zoom of [0.5, 1, 4]) {
        gjs.renderer.view = { x: 0, y: 0, zoom };
        const p = gjs.simToCanvas(...gjs.simulation.getPosition("a"));
        assert.equal(gjs.nodeAt(...p), "a", `centre miss at zoom ${zoom}`);
      }
    } finally { restoreWindow(); }
  });

  test("pin accepts canvas coordinates and getPosition returns them", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.pin("a", 450, 250);
      gjs.step();
      assert.deepEqual(gjs.getPosition("a").map(r2), [450, 250]);
      assert.equal(gjs.getPosition("nope"), null);
    } finally { restoreWindow(); }
  });

  test("a pinned node stays put across ticks, and moves again once unpinned", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.pin("a", 450, 250);
      for (let t = 0; t < 30; t++) gjs.step();
      assert.deepEqual(gjs.getPosition("a").map(r2), [450, 250]);

      gjs.unpin("a");
      for (let t = 0; t < 60; t++) gjs.step();
      assert.notDeepEqual(gjs.getPosition("a").map(r2), [450, 250]);
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: loop control", () => {
  test("isRunning tracks start and stop", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      assert.equal(gjs.isRunning(), false);
      gjs.start();
      assert.equal(gjs.isRunning(), true, "start() must actually schedule a frame");
      gjs.stop();
      assert.equal(gjs.isRunning(), false);
    } finally { restoreWindow(); raf.restore(); }
  });

  test("start is idempotent", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      gjs.start();
      gjs.start();
      assert.equal(raf.pending.size, 1, "a second start would run two loops at once");
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("stop is safe before start", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      assert.doesNotThrow(() => gjs.stop());
      assert.equal(gjs.isRunning(), false);
    } finally { restoreWindow(); raf.restore(); }
  });

  test("step advances the simulation and draws one frame", () => {
    const { gjs, canvas, restoreWindow } = build();
    try {
      const before = gjs.simulation.getPosition("a");
      canvas.ctx.ops.length = 0;
      gjs.step();
      assert.notDeepEqual(gjs.simulation.getPosition("a"), before);
      assert.ok(canvas.ctx.ops.some(o => o[0] === "fillRect"), "the background was not painted");
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: end to end", () => {
  test("mutating during a running layout stays finite", () => {
    const { gjs, restoreWindow } = build({ directed: true });
    try {
      for (let i = 0; i < 25; i++) {
        gjs.addNode({ id: "n" + i });
        gjs.addEdge(i % 2 ? "a" : "b", "n" + i);
        if (i > 3) gjs.addEdge("n" + (i - 3), "n" + i);
        gjs.step();
      }
      for (let i = 0; i < 25; i += 3) { gjs.removeNode("n" + i); gjs.step(); }
      for (let t = 0; t < 100; t++) gjs.step();

      for (const r of gjs.simulation._nodeList)
        assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
      assert.equal(gjs.renderer._nodeStyles.length, gjs.simulation._nodeList.length);
      assert.equal(gjs.renderer._edgeStyles.length, gjs.graph.edges.size);
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: detached lifecycle", () => {
  test("constructs with no canvas", () => {
    const gjs = new GraphJS({});
    assert.equal(gjs.canvas, null);
    assert.equal(gjs.renderer.ctx, null);
    assert.equal(gjs.renderer.size, null);
  });

  test("the simulation still runs headless", () => {
    const gjs = new GraphJS({});
    gjs.addNode({ id: "a" });
    gjs.addNode({ id: "b" });
    gjs.addEdge("a", "b");
    const before = gjs.simulation.getPosition("a");
    for (let t = 0; t < 20; t++) gjs.step();
    assert.notDeepEqual(gjs.simulation.getPosition("a"), before,
      "step() should advance the layout without a canvas");
  });

  test("render is a no-op rather than a crash", () => {
    const gjs = new GraphJS({});
    gjs.addNode({ id: "a" });
    assert.equal(gjs.renderer.render(), false);
  });

  test("start refuses without a canvas", () => {
    const raf = installRaf();
    try {
      const gjs = new GraphJS({});
      gjs.start();
      assert.equal(gjs.isRunning(), false);
      assert.equal(raf.pending.size, 0, "no frame should be queued");
    } finally { raf.restore(); }
  });

  test("canvas-space methods throw a named error", () => {
    const gjs = new GraphJS({});
    gjs.addNode({ id: "a" });
    for (const call of [
      () => gjs.simToCanvas(0, 0),
      () => gjs.canvasToSim(0, 0),
      () => gjs.getPosition("a"),
    ]) assert.throws(call, /no canvas attached/);
  });

  test("every canvas-space method throws, so null keeps its own meaning", () => {
    const gjs = new GraphJS({});
    gjs.addNode({ id: "a" });
    for (const call of [
      () => gjs.nodeAt(0, 0),
      () => gjs.pin("a", 0, 0),
    ]) assert.throws(call, /no canvas attached/);
  });

  test("simulation-only methods still work detached", () => {
    const gjs = new GraphJS({});
    gjs.addNode({ id: "a" });
    assert.doesNotThrow(() => gjs.unpin("a"));

    // A node has no position until sync() seeds a record for it.
    assert.equal(gjs.simulation.getPosition("a"), null);
    gjs.simulation.sync();
    assert.equal(gjs.simulation.getPosition("a").length, 2,
      "world-space queries need no canvas");
  });

  test("the error names the class that threw", () => {
    const gjs = new GraphJS({});
    assert.throws(() => gjs.nodeAt(0, 0), /^Error: GraphJS:/);
    assert.throws(() => gjs.renderer.nodeAt(0, 0), /^Error: Renderer:/);
  });
});

describe("GraphJS: attach and detach", () => {
  test("canvas is a view onto the renderer, not a second copy", () => {
    const restoreWindow = installWindow(1);
    try {
      const gjs = new GraphJS({});
      const canvas = makeCanvas();
      gjs.attach(canvas);
      assert.equal(gjs.canvas, canvas);
      assert.equal(gjs.canvas, gjs.renderer.canvas, "the two must never diverge");

      gjs.renderer.detach();
      assert.equal(gjs.canvas, null, "detaching the renderer must be visible on the facade");
    } finally { restoreWindow(); }
  });

  test("attach applies the dpr transform and logical size", () => {
    const restoreWindow = installWindow(2);
    try {
      const gjs = new GraphJS({});
      const canvas = makeCanvas({ w: 500, h: 400 });
      gjs.attach(canvas);
      assert.deepEqual([canvas.width, canvas.height], [1000, 800]);
      assert.deepEqual(gjs.renderer.size, { w: 500, h: 400 },
        "attach must resize, or geometry is wrong at dpr != 1");
    } finally { restoreWindow(); }
  });

  test("attach makes rendering work again after a detach", () => {
    const restoreWindow = installWindow(1);
    try {
      const gjs = new GraphJS({ canvas: makeCanvas() });
      gjs.addNode({ id: "a" });
      gjs.detach();
      assert.equal(gjs.renderer.render(), false);

      const next = makeCanvas();
      gjs.attach(next);
      gjs.step();
      assert.ok(next.ctx.ops.some(o => o[0] === "fillRect"), "the new canvas was not painted");
    } finally { restoreWindow(); }
  });

  test("attach over an existing canvas releases the old one", () => {
    const restoreWindow = installWindow(1);
    try {
      const first = makeCanvas(), second = makeCanvas({ w: 400, h: 300 });
      const gjs = new GraphJS({ canvas: first });
      gjs.attach(second);
      assert.equal(gjs.canvas, second);
      gjs.addNode({ id: "a" });
      first.ctx.ops.length = 0;
      gjs.step();
      assert.equal(first.ctx.ops.length, 0, "the replaced canvas must not keep receiving draws");
    } finally { restoreWindow(); }
  });

  test("detach stops the loop", () => {
    const restoreWindow = installWindow(1);
    const raf = installRaf();
    try {
      const gjs = new GraphJS({ canvas: makeCanvas() });
      gjs.start();
      assert.equal(gjs.isRunning(), true);
      gjs.detach();
      assert.equal(gjs.isRunning(), false);
      assert.equal(raf.pending.size, 0);
    } finally { raf.restore(); restoreWindow(); }
  });

  test("stop works while detached", () => {
    const restoreWindow = installWindow(1);
    const raf = installRaf();
    try {
      const gjs = new GraphJS({ canvas: makeCanvas() });
      gjs.start();
      gjs.renderer.detach();          // bypasses gjs.detach(), so the loop is still queued
      gjs.stop();
      assert.equal(gjs.isRunning(), false, "stop() must not depend on a canvas being present");
      assert.equal(raf.pending.size, 0);
    } finally { raf.restore(); restoreWindow(); }
  });

  test("the loop ends itself when the renderer is detached behind its back", () => {
    const restoreWindow = installWindow(1);
    const raf = installRaf();
    try {
      const gjs = new GraphJS({ canvas: makeCanvas() });
      gjs.addNode({ id: "a" });
      gjs.start();
      raf.flushFrame();
      assert.equal(raf.pending.size, 1, "the loop should re-queue while attached");

      gjs.renderer.detach();          // no notification reaches GraphJS
      raf.flushFrame();
      assert.equal(raf.pending.size, 0, "the frame callback should not re-queue");
      assert.equal(gjs.isRunning(), false, "isRunning must reflect the ended chain");
    } finally { raf.restore(); restoreWindow(); }
  });

  test("detach is idempotent", () => {
    const restoreWindow = installWindow(1);
    try {
      const gjs = new GraphJS({ canvas: makeCanvas() });
      assert.doesNotThrow(() => { gjs.detach(); gjs.detach(); });
      assert.equal(gjs.canvas, null);
    } finally { restoreWindow(); }
  });

  test("resize is a no-op while detached", () => {
    const gjs = new GraphJS({});
    assert.doesNotThrow(() => gjs.resize());
    assert.equal(gjs.renderer.size, null);
  });

  test("opts.canvas and opts.renderer.canvas are equivalent", () => {
    const restoreWindow = installWindow(1);
    try {
      const a = makeCanvas(), b = makeCanvas();
      assert.equal(new GraphJS({ canvas: a }).canvas, a);
      assert.equal(new GraphJS({ renderer: { canvas: b } }).canvas, b);
    } finally { restoreWindow(); }
  });

  test("the constructor does not mutate the options object it is given", () => {
    const restoreWindow = installWindow(1);
    try {
      const opts = { canvas: makeCanvas(), graph: { directed: true } };
      const snapshot = Object.keys(opts).sort();
      new GraphJS(opts);
      assert.deepEqual(Object.keys(opts).sort(), snapshot,
        "a reused or memoised options object must survive construction unchanged");
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: resize", () => {
  test("attach resizes exactly once", () => {
    // Regression: GraphJS.attach called resize() after Renderer.attach had
    // already done so.
    const restoreWindow = installWindow(2);
    try {
      const canvas = makeCanvas();
      new GraphJS({}).attach(canvas);
      assert.equal(canvas.ctx.ops.filter(o => o[0] === "setTransform").length, 1);
    } finally { restoreWindow(); }
  });

  test("resize forwards to the renderer and returns the facade", () => {
    const restoreWindow = installWindow(1);
    try {
      const canvas = makeCanvas({ w: 500, h: 400 });
      const gjs = new GraphJS({ canvas });
      canvas.clientWidth = 700;
      canvas.clientHeight = 300;
      assert.equal(gjs.resize(), gjs);
      assert.deepEqual(gjs.renderer.size, { w: 700, h: 300 });
    } finally { restoreWindow(); }
  });
});
