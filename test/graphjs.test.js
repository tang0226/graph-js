import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphJS } from "../src/graphjs.js";
import * as pkg from "../src/index.js";
import { makeCanvas, installWindow, installRaf, r2 } from "./helpers/stubs.js";

function build({ dpr = 1, directed = false, w = 800, h = 600 } = {}) {
  const restoreWindow = installWindow(dpr);
  const canvas = makeCanvas({ w, h });
  const gjs = new GraphJS(canvas, { graph: { directed } });
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
      const gjs = new GraphJS(makeCanvas(), {
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
