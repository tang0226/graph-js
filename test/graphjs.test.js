import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphJS } from "../src/graphjs.js";
import * as pkg from "../src/index.js";
import { makeCanvas, installWindow, installRaf, installImage, flush, r2 } from "./helpers/stubs.js";

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
    assert.deepEqual(Object.keys(pkg).sort(), ["Graph", "GraphJS", "Renderer", "Simulation", "Tween", "easings"]);
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

  test("nodeAt forwards slack to the renderer, and keeps its default when omitted", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.simulation.setDefaultNodeConfig({ radius: 20 });
      gjs.pin("a", 400, 300);
      gjs.pin("b", 100, 100);
      gjs.step();
      // 30px below the centre of "a": 10px outside its radius
      assert.equal(gjs.nodeAt(400, 330), null);
      assert.equal(gjs.nodeAt(400, 330, 11), "a");
      assert.equal(gjs.nodeAt(400, 330, 9), null);
      for (const dy of [21.99, 22.01]) {
        assert.equal(gjs.nodeAt(400, 300 + dy), gjs.renderer.nodeAt(400, 300 + dy),
          `facade and renderer defaults disagree ${dy}px out`);
      }
    } finally { restoreWindow(); }
  });

  test("edgeAt and edgesAt take canvas coordinates and forward slack", () => {
    const { gjs, restoreWindow } = build();
    try {
      gjs.simulation.setDefaultNodeConfig({ radius: 20 });
      gjs.pin("a", 200, 300);
      gjs.pin("b", 600, 300);
      gjs.step();
      const ab = gjs.graph.getEdge("a", "b");
      assert.equal(gjs.edgeAt(400, 300), ab);
      assert.deepEqual(gjs.edgesAt(400, 300), [ab]);
      // 10px off the line: outside the default reach, inside 10px of slack
      assert.equal(gjs.edgeAt(400, 310), null);
      assert.equal(gjs.edgeAt(400, 310, 10), ab);
      assert.deepEqual(gjs.edgesAt(400, 310, 10), [ab]);
      for (const dy of [3.49, 3.51]) {
        assert.equal(gjs.edgeAt(400, 300 + dy), gjs.renderer.edgeAt(400, 300 + dy),
          `facade and renderer defaults disagree ${dy}px out`);
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

  test("the loop passes each frame's timestamp to render", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      const seen = [];
      const render = gjs.renderer.render.bind(gjs.renderer);
      gjs.renderer.render = t => { seen.push(t); return render(t); };
      gjs.start();
      raf.flushFrame(3, { t0: 1000, dt: 16 });
      assert.deepEqual(seen, [1000, 1016, 1032], "highlight fades are timed from these");
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("a render hook that throws doesn't stop the loop", t => {
    const error = t.mock.method(console, "error", () => {});
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      let frames = 0;
      gjs.renderer.addHook("overlay", () => { frames++; throw new Error("hook failed"); });
      gjs.start();
      raf.flushFrame(3);
      assert.equal(frames, 3);
      assert.equal(error.mock.callCount(), 3);
      assert.equal(raf.pending.size, 1, "the next frame must still be scheduled");
      assert.equal(gjs.isRunning(), true);
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

describe("GraphJS: loop hooks", () => {
  /* A running-capable instance whose tick() and render() also write into
     `log`, so tests can see where hooks ran relative to each phase. */
  function hooked() {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    const log = [];
    const tick = gjs.simulation.tick.bind(gjs.simulation);
    gjs.simulation.tick = (...args) => { log.push("tick"); return tick(...args); };
    const render = gjs.renderer.render.bind(gjs.renderer);
    gjs.renderer.render = (...args) => { log.push("render"); return render(...args); };
    const cleanup = () => { gjs.stop(); restoreWindow(); raf.restore(); };
    return { gjs, raf, log, cleanup };
  }
  const mark = (log, label) => () => { log.push(label); };
  const FRAME = ["preTick", "tick", "postTick", "render", "postRender"];

  test("addHook chains, and removeHook reports whether the hook was there", () => {
    const { gjs, cleanup } = hooked();
    try {
      const f = () => {};
      assert.equal(gjs.addHook("postTick", f), gjs);
      assert.equal(gjs.removeHook("preTick", f), false, "types keep separate hooks");
      assert.equal(gjs.removeHook("postTick", f), true);
      assert.equal(gjs.removeHook("postTick", f), false);
    } finally { cleanup(); }
  });

  test("an unknown type throws instead of being ignored", () => {
    const { gjs, cleanup } = hooked();
    try {
      assert.throws(() => gjs.addHook("tick", () => {}), TypeError);
      assert.throws(() => gjs.removeHook("tick", () => {}), TypeError);
    } finally { cleanup(); }
  });

  test("each frame runs preTick, tick, postTick, render and postRender, in that order", () => {
    const { gjs, raf, log, cleanup } = hooked();
    try {
      // Added out of order: the type decides where a hook runs
      for (const type of ["postRender", "postTick", "preTick"]) gjs.addHook(type, mark(log, type));
      gjs.start();
      raf.flushFrame(2);
      assert.deepEqual(log, [...FRAME, ...FRAME]);
    } finally { cleanup(); }
  });

  test("step() runs the same sequence once, without starting the loop", () => {
    const { gjs, raf, log, cleanup } = hooked();
    try {
      for (const type of ["preTick", "postTick", "postRender"]) gjs.addHook(type, mark(log, type));
      gjs.step();
      assert.deepEqual(log, FRAME);
      assert.equal(gjs.isRunning(), false);
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  test("step() runs every hook even without a canvas", () => {
    const gjs = new GraphJS();
    const log = [];
    for (const type of ["preTick", "postTick", "postRender"]) gjs.addHook(type, mark(log, type));
    gjs.step();
    assert.deepEqual(log, ["preTick", "postTick", "postRender"]);
  });

  test("hooks receive the instance and the frame's timestamp, which render also gets", () => {
    const { gjs, raf, cleanup } = hooked();
    try {
      const seen = [];
      for (const type of ["preTick", "postTick", "postRender"])
        gjs.addHook(type, (who, time) => { seen.push([type, who === gjs, time]); });
      const render = gjs.renderer.render;
      gjs.renderer.render = time => { seen.push(["render", true, time]); return render(time); };

      gjs.start();
      raf.flushFrame(2, { t0: 1000, dt: 16 });
      gjs.stop();
      const frame = t => [["preTick", true, t], ["postTick", true, t], ["render", true, t], ["postRender", true, t]];
      assert.deepEqual(seen, [...frame(1000), ...frame(1016)]);

      seen.length = 0;
      gjs.step();
      const t = seen[0][2];
      assert.equal(typeof t, "number", "step() passes a timestamp too");
      assert.deepEqual(seen, frame(t), "and every phase of the step sees the same one");
    } finally { cleanup(); }
  });

  test("isRunning() is true inside hooks while the loop runs, and false inside step()", () => {
    const { gjs, raf, cleanup } = hooked();
    try {
      const seen = [];
      gjs.addHook("postRender", g => { seen.push(g.isRunning()); });
      gjs.step();
      gjs.start();
      raf.flushFrame();
      assert.deepEqual(seen, [false, true]);
    } finally { cleanup(); }
  });

  test("a hook can stop the loop", () => {
    const { gjs, raf, cleanup } = hooked();
    try {
      let frames = 0;
      gjs.addHook("postRender", g => { if (++frames === 2) g.stop(); });
      gjs.start();
      raf.flushFrame(5);
      assert.equal(frames, 2);
      assert.equal(gjs.isRunning(), false);
      assert.equal(raf.pending.size, 0, "no frame may be left scheduled");
    } finally { cleanup(); }
  });

  test("a frame stopped from preTick still finishes, then no more run", () => {
    const { gjs, raf, log, cleanup } = hooked();
    try {
      gjs.addHook("preTick", g => { log.push("preTick"); g.stop(); });
      gjs.addHook("postRender", mark(log, "postRender"));
      gjs.start();
      raf.flushFrame(3);
      assert.deepEqual(log, ["preTick", "tick", "render", "postRender"]);
    } finally { cleanup(); }
  });

  test("a hook can restart the loop after stopping it", () => {
    const { gjs, raf, cleanup } = hooked();
    try {
      let frames = 0;
      gjs.addHook("postRender", g => { frames++; g.stop().start(); });
      gjs.start();
      raf.flushFrame(3);
      assert.equal(frames, 3);
      assert.equal(raf.pending.size, 1, "exactly one loop keeps running");
    } finally { cleanup(); }
  });

  test("a throwing hook is logged, and the frame and the loop carry on", t => {
    const error = t.mock.method(console, "error", () => {});
    const { gjs, raf, log, cleanup } = hooked();
    try {
      const failure = new Error("hook failed");
      gjs.addHook("preTick", () => { throw failure; });
      gjs.addHook("preTick", mark(log, "next preTick hook"));
      gjs.addHook("postRender", mark(log, "postRender"));
      gjs.start();
      raf.flushFrame(2);
      const frame = ["next preTick hook", "tick", "render", "postRender"];
      assert.deepEqual(log, [...frame, ...frame]);
      assert.equal(error.mock.callCount(), 2);
      const [message, logged] = error.mock.calls[0].arguments;
      assert.match(message, /preTick/, "the message names the hook type");
      assert.equal(logged, failure);
      assert.equal(gjs.isRunning(), true);
      assert.equal(raf.pending.size, 1);
    } finally { cleanup(); }
  });

  test("hooks of a type run in the order they were added, and a duplicate runs once", () => {
    const { gjs, log, cleanup } = hooked();
    try {
      const one = mark(log, "1");
      gjs.addHook("postTick", one).addHook("postTick", mark(log, "2")).addHook("postTick", one);
      gjs.step();
      assert.deepEqual(log, ["tick", "1", "2", "render"]);
    } finally { cleanup(); }
  });

  test("a removed hook no longer runs", () => {
    const { gjs, cleanup } = hooked();
    try {
      let calls = 0;
      const f = () => { calls++; };
      gjs.addHook("postTick", f);
      gjs.step();
      gjs.removeHook("postTick", f);
      gjs.step();
      assert.equal(calls, 1);
    } finally { cleanup(); }
  });

  test("a hook that removes and re-adds itself runs once per frame", () => {
    const { gjs, cleanup } = hooked();
    try {
      let calls = 0;
      // Stops re-adding itself at 100, so a regression fails rather than hangs
      const f = g => { calls++; if (calls < 100) { g.removeHook("preTick", f); g.addHook("preTick", f); } };
      gjs.addHook("preTick", f);
      gjs.step();
      assert.equal(calls, 1);
      gjs.step();
      assert.equal(calls, 2);
    } finally { cleanup(); }
  });

  test("a hook added by another hook of its type starts on the next frame", () => {
    const { gjs, cleanup } = hooked();
    try {
      let lateCalls = 0;
      const late = () => { lateCalls++; };
      gjs.addHook("postRender", g => { g.addHook("postRender", late); });
      gjs.step();
      assert.equal(lateCalls, 0);
      gjs.step();
      assert.equal(lateCalls, 1);
    } finally { cleanup(); }
  });
});

describe("GraphJS: view", () => {
  // The view math is tested in renderer.test.js; these check the forwarding
  test("view is the renderer's view", () => {
    const gjs = new GraphJS();
    assert.equal(gjs.view, gjs.renderer.view);
  });

  test("the view methods delegate to the renderer, and chain the facade", () => {
    const { gjs, restoreWindow } = build();
    try {
      const r = gjs.renderer;
      const calls = [];
      for (const name of ["setView", "panBy", "zoomTo", "zoomBy", "viewPannedBy", "viewZoomedTo"]) {
        const f = r[name].bind(r);
        r[name] = (...args) => { calls.push([name, ...args]); return f(...args); };
      }
      // Each forwarder's first renderer call is its own method, with its arguments
      const check = (run, expected) => { calls.length = 0; run(); assert.deepEqual(calls[0], expected); };
      check(() => assert.equal(gjs.setView({ x: 1 }), gjs), ["setView", { x: 1 }]);
      check(() => assert.equal(gjs.panBy(2, 3), gjs), ["panBy", 2, 3]);
      check(() => assert.equal(gjs.zoomTo(2, 10, 20), gjs), ["zoomTo", 2, 10, 20]);
      check(() => assert.equal(gjs.zoomBy(0.5), gjs), ["zoomBy", 0.5, undefined, undefined]);
      const panned = r.viewPannedBy(4, 5), zoomed = r.viewZoomedTo(3, 30, 40);
      check(() => assert.deepEqual(gjs.viewPannedBy(4, 5), panned), ["viewPannedBy", 4, 5]);
      check(() => assert.deepEqual(gjs.viewZoomedTo(3, 30, 40), zoomed), ["viewZoomedTo", 3, 30, 40]);
    } finally { restoreWindow(); }
  });

  test("the view methods throw as the renderer's do", () => {
    const gjs = new GraphJS();
    assert.throws(() => gjs.setView({ zoom: 0 }), RangeError);
    assert.throws(() => gjs.panBy(NaN, 0), RangeError);
    assert.throws(() => gjs.zoomTo(2, 10), TypeError);
    assert.throws(() => gjs.zoomBy(-1), RangeError);
    assert.throws(() => gjs.zoomTo(2, 0, 0), /no canvas/);
  });

  test("view methods don't emit events", () => {
    const { gjs, restoreWindow } = build();
    try {
      const seen = [];
      for (const type of ["pan", "zoom", "panstart", "panend"]) gjs.on(type, e => seen.push(e.type));
      gjs.panBy(5, 5).zoomTo(2, 10, 10).zoomBy(2).setView({ x: 0 });
      assert.deepEqual(seen, []);
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: events", () => {
  // _emit is private: the interaction layer calls it, so tests stand in for it
  const pointer = (id = "a") => ({ id, x: 1, y: 2, originalEvent: { type: "pointerdown" } });

  test("on chains, and off reports whether the listener was there", () => {
    const gjs = new GraphJS();
    const f = () => {};
    assert.equal(gjs.on("nodeclick", f), gjs);
    assert.equal(gjs.off("nodedblclick", f), false, "events keep separate listeners");
    assert.equal(gjs.off("nodeclick", f), true);
    assert.equal(gjs.off("nodeclick", f), false);
  });

  test("an unknown event name throws instead of being ignored", () => {
    const gjs = new GraphJS();
    assert.throws(() => gjs.on("click", () => {}), TypeError);
    assert.throws(() => gjs.off("click", () => {}), TypeError);
    assert.throws(() => gjs._emit("click", {}), TypeError);
    assert.throws(() => gjs.on("toString", () => {}), TypeError, "inherited keys aren't event names");
  });

  test("a listener must be a function", () => {
    const gjs = new GraphJS();
    for (const bad of [null, undefined, "f", {}]) assert.throws(() => gjs.on("nodeclick", bad), TypeError);
  });

  test("listeners get the event's data with its type and target", () => {
    const gjs = new GraphJS();
    const seen = [];
    gjs.on("nodeclick", e => seen.push(e));
    const data = pointer("b");
    gjs._emit("nodeclick", data);
    assert.equal(seen.length, 1);
    const [e] = seen;
    assert.equal(e.type, "nodeclick");
    assert.equal(e.target, gjs);
    assert.equal(e.id, "b");
    assert.deepEqual([e.x, e.y], [1, 2]);
    assert.equal(e.originalEvent, data.originalEvent);
    assert.notEqual(e, data, "the caller's data object isn't mutated into the event");
    assert.equal("type" in data, false);
  });

  test("data can't override type or target", () => {
    const gjs = new GraphJS();
    let seen;
    gjs.on("nodeclick", e => { seen = e; });
    gjs._emit("nodeclick", { ...pointer(), type: "nodeleave", target: null });
    assert.equal(seen.type, "nodeclick");
    assert.equal(seen.target, gjs);
  });

  test("every interaction event name is accepted", () => {
    const gjs = new GraphJS();
    const names = [
      "nodeenter", "nodeleave", "nodepress", "nodeclick", "nodedblclick",
      "nodedragstart", "nodedrag", "nodedragend", "backgroundclick",
      "panstart", "pan", "panend", "zoom",
    ];
    const seen = [];
    for (const name of names) gjs.on(name, e => seen.push(e.type));
    for (const name of names) gjs._emit(name, {});
    assert.deepEqual(seen, names);
  });

  test("view events pass their view and movement through", () => {
    const gjs = new GraphJS();
    let seen;
    gjs.on("pan", e => { seen = e; });
    const view = { x: 5, y: -5, zoom: 2 };
    gjs._emit("pan", { x: 10, y: 20, dx: 3, dy: -4, view, originalEvent: {} });
    assert.deepEqual([seen.dx, seen.dy], [3, -4]);
    assert.equal(seen.view, view);
  });

  test("node drag events pass their node and movement through", () => {
    const gjs = new GraphJS();
    let seen;
    gjs.on("nodedrag", e => { seen = e; });
    gjs._emit("nodedrag", { ...pointer("b"), dx: -1, dy: 6 });
    assert.equal(seen.id, "b");
    assert.deepEqual([seen.dx, seen.dy], [-1, 6]);
  });

  test("only listeners of the emitted event run", () => {
    const gjs = new GraphJS();
    const log = [];
    gjs.on("nodeclick", () => log.push("click"));
    gjs.on("nodedblclick", () => log.push("dblclick"));
    gjs._emit("nodedblclick", pointer());
    assert.deepEqual(log, ["dblclick"]);
  });

  test("listeners run in the order they were added, share one event, and a duplicate runs once", () => {
    const gjs = new GraphJS();
    const log = [], events = new Set();
    const one = e => { log.push("1"); events.add(e); };
    gjs.on("nodeclick", one).on("nodeclick", e => { log.push("2"); events.add(e); }).on("nodeclick", one);
    gjs._emit("nodeclick", pointer());
    assert.deepEqual(log, ["1", "2"]);
    assert.equal(events.size, 1);
  });

  test("preventDefault is seen by later listeners and reported to the emitter", () => {
    const gjs = new GraphJS();
    const seen = [];
    gjs.on("nodedrag", e => { seen.push(e.defaultPrevented); e.preventDefault(); });
    gjs.on("nodedrag", e => { seen.push(e.defaultPrevented); });
    assert.equal(gjs._emit("nodedrag", pointer()), true);
    assert.deepEqual(seen, [false, true], "and it doesn't stop the remaining listeners");
    assert.equal(gjs._emit("nodedragend", pointer()), false, "each event starts not prevented");
  });

  test("emitting with no listeners reports no preventDefault", () => {
    assert.equal(new GraphJS()._emit("backgroundclick", { x: 0, y: 0, originalEvent: {} }), false);
  });

  test("a throwing listener is logged, and the remaining listeners still run", t => {
    const error = t.mock.method(console, "error", () => {});
    const gjs = new GraphJS();
    const failure = new Error("listener failed");
    const log = [];
    gjs.on("nodeenter", () => { throw failure; });
    gjs.on("nodeenter", e => { log.push("next"); e.preventDefault(); });
    assert.equal(gjs._emit("nodeenter", pointer()), true);
    assert.deepEqual(log, ["next"]);
    assert.equal(error.mock.callCount(), 1);
    const [message, logged] = error.mock.calls[0].arguments;
    assert.match(message, /nodeenter/, "the message names the event");
    assert.equal(logged, failure);
  });

  test("a removed listener no longer runs", () => {
    const gjs = new GraphJS();
    let calls = 0;
    const f = () => { calls++; };
    gjs.on("nodeclick", f);
    gjs._emit("nodeclick", pointer());
    gjs.off("nodeclick", f);
    gjs._emit("nodeclick", pointer());
    assert.equal(calls, 1);
  });

  test("a listener removed by an earlier one during an emit doesn't run for it", () => {
    const gjs = new GraphJS();
    let calls = 0;
    const later = () => { calls++; };
    gjs.on("nodeclick", g => { g.target.off("nodeclick", later); }).on("nodeclick", later);
    gjs._emit("nodeclick", pointer());
    assert.equal(calls, 0);
  });

  test("a listener added during an emit starts on the next one", () => {
    const gjs = new GraphJS();
    let lateCalls = 0;
    const late = () => { lateCalls++; };
    gjs.on("nodeclick", e => { e.target.on("nodeclick", late); });
    gjs._emit("nodeclick", pointer());
    assert.equal(lateCalls, 0);
    gjs._emit("nodeclick", pointer());
    assert.equal(lateCalls, 1);
  });

  test("a listener that removes and re-adds itself runs once per emit", () => {
    const gjs = new GraphJS();
    let calls = 0;
    // Stops re-adding itself at 100, so a regression fails rather than hangs
    const f = e => { calls++; if (calls < 100) { e.target.off("nodeclick", f); e.target.on("nodeclick", f); } };
    gjs.on("nodeclick", f);
    gjs._emit("nodeclick", pointer());
    assert.equal(calls, 1);
    gjs._emit("nodeclick", pointer());
    assert.equal(calls, 2);
  });

  test("listeners belong to the instance, and survive detach and reattach", () => {
    const { gjs, restoreWindow } = build();
    try {
      let calls = 0;
      gjs.on("nodeclick", () => { calls++; });
      const other = new GraphJS();
      other._emit("nodeclick", pointer());
      gjs.detach().attach(makeCanvas());
      gjs._emit("nodeclick", pointer());
      assert.equal(calls, 1);
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: graph events", () => {
  test("the shortcuts emit graph events, on the graph", () => {
    const gjs = new GraphJS();
    const log = [];
    for (const type of ["nodeadd", "edgeadd", "edgeremove", "noderemove"]) gjs.graph.on(type, e => log.push(type));
    gjs.addNode({}, "a");
    gjs.addNode({}, "b");
    gjs.addEdge("a", "b");
    gjs.removeNode("a");
    assert.deepEqual(log, ["nodeadd", "nodeadd", "edgeadd", "edgeremove", "noderemove"]);
    assert.throws(() => gjs.on("nodeadd", () => {}), TypeError, "graph events aren't on the facade");
  });

  test("in a listener the graph is current, the simulation catches up on sync()", () => {
    const gjs = new GraphJS();
    const seen = [];
    gjs.graph.on("nodeadd", e => {
      seen.push(gjs.graph.nodes.has(e.id));
      seen.push(gjs.simulation.nodes.has(e.id));
      gjs.simulation.sync();
      seen.push(gjs.simulation.nodes.has(e.id));
    });
    gjs.addNode({}, "a");
    assert.deepEqual(seen, [true, false, true]);
  });
});

describe("GraphJS: simulation events", () => {
  test("stopping on settle and starting on wake runs the loop only while the layout moves", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      gjs.simulation.on("settle", () => gjs.stop());
      gjs.simulation.on("wake", () => gjs.start());
      gjs.simulation.setOpts({ cooling: 0.5 });      // settles within a few frames
      gjs.start();
      let frames = 0;
      while (gjs.isRunning() && frames < 100) { raf.flushFrame(); frames++; }
      assert.equal(gjs.isRunning(), false, "settling stopped the loop");
      assert.ok(frames < 20, `stopped after ${frames} frames`);
      assert.equal(raf.pending.size, 0);

      gjs.simulation.heat();                         // as any change would
      assert.equal(gjs.isRunning(), true, "waking restarted it");
      assert.equal(raf.pending.size, 1);
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("the facade doesn't take simulation event names", () => {
    const gjs = new GraphJS();
    assert.throws(() => gjs.on("settle", () => {}), TypeError);
    assert.doesNotThrow(() => gjs.simulation.on("settle", () => {}));
  });
});

describe("GraphJS: requestRender", () => {
  /* A stopped instance with manual frames. `renders` records each
     render's timestamp; the simulation must never tick. */
  function onDemand() {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    const renders = [];
    const render = gjs.renderer.render.bind(gjs.renderer);
    gjs.renderer.render = time => { renders.push(time); return render(time); };
    let ticks = 0;
    const tick = gjs.simulation.tick.bind(gjs.simulation);
    gjs.simulation.tick = (...a) => { ticks++; return tick(...a); };
    const cleanup = () => { gjs.stop(); restoreWindow(); raf.restore(); };
    return { gjs, raf, renders, ticks: () => ticks, cleanup };
  }

  test("draws once on the next frame, without ticking; requests in one frame draw once", () => {
    const { gjs, raf, renders, ticks, cleanup } = onDemand();
    try {
      assert.equal(gjs.requestRender(), gjs);
      gjs.requestRender().requestRender();
      assert.equal(raf.pending.size, 1);
      assert.deepEqual(renders, [], "nothing until the frame");
      raf.flushFrame(1, { t0: 500 });
      assert.deepEqual(renders, [500]);
      assert.equal(raf.pending.size, 0, "nothing is moving, so it stops");
      assert.equal(ticks(), 0, "the simulation doesn't tick");
    } finally { cleanup(); }
  });

  test("keeps drawing while a tween runs, advancing it, then stops", () => {
    const { gjs, raf, renders, cleanup } = onDemand();
    try {
      const values = [];
      gjs.tween({ set: v => values.push(v), from: 0, to: 1, duration: 100 });
      gjs.requestRender();
      raf.flushFrame(6, { t0: 1000, dt: 25 });
      assert.deepEqual(values.map(v => +v.toFixed(2)), [0, 0.25, 0.5, 0.75, 1]);
      assert.equal(gjs.isTweening(), false);
      assert.equal(renders.length, 5, "one frame per tween step, then no more");
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  test("keeps drawing while a highlight fades, then stops", () => {
    const { gjs, raf, renders, cleanup } = onDemand();
    try {
      gjs.renderer.setOpts({ highlightFadeDuration: 100 });
      gjs.renderer.setHighlight({ nodes: ["a"] });
      gjs.requestRender();
      raf.flushFrame(10, { t0: 0, dt: 30 });
      assert.equal(gjs.renderer.isFading(), false, "the fade finished");
      assert.ok(renders.length >= 4 && renders.length < 10, `drew ${renders.length} frames, then stopped`);
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  test("keeps drawing while node image sizes are being prepared, then stops", () => {
    const { gjs, raf, renders, cleanup } = onDemand();
    try {
      let preparing = 3;
      gjs.renderer.isPreparingImages = () => preparing-- > 0;
      gjs.requestRender();
      raf.flushFrame(10);
      assert.equal(renders.length, 4, "one frame per check that found sizes in preparation, plus the last");
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  test("does nothing while the loop runs, or without a canvas", () => {
    const { gjs, raf, cleanup } = onDemand();
    try {
      gjs.start();
      gjs.requestRender();
      assert.equal(raf.pending.size, 1, "only the loop's own frame");
      gjs.stop();
      gjs.detach();
      gjs.requestRender();
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  test("a frame still pending when the loop starts is left to the loop", () => {
    const { gjs, raf, renders, cleanup } = onDemand();
    try {
      gjs.requestRender();
      gjs.start();
      raf.flushFrame(1, { t0: 100 });
      assert.deepEqual(renders, [100], "drawn once, by the loop");
    } finally { cleanup(); }
  });

  test("detach cancels a pending frame", () => {
    const { gjs, raf, cleanup } = onDemand();
    try {
      gjs.requestRender();
      gjs.detach();
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); }
  });

  /* Gives nodes "a" and "b" the images `a.png` and `b.png`, and starts their
     requests. */
  function requestImages(gjs) {
    gjs.renderer.setDefaultNodeConfig({ image: n => `${n.id}.png` });
    gjs.renderer.sync();
  }

  test("images settling while the loop is stopped draw on one frame", async () => {
    const restoreImage = installImage({ fail: src => src === "b.png" });
    const { gjs, raf, renders, ticks, cleanup } = onDemand();
    try {
      requestImages(gjs);
      assert.equal(raf.pending.size, 0, "nothing until a request settles");
      await flush();
      assert.equal(gjs.renderer.images.get("a.png")?.status, "loaded");
      assert.equal(gjs.renderer.images.get("b.png")?.status, "failed");
      assert.equal(raf.pending.size, 1, "a load and an error in one go queue one frame");
      raf.flushFrame(1, { t0: 200 });
      assert.deepEqual(renders, [200]);
      assert.equal(ticks(), 0);
      assert.equal(raf.pending.size, 0);
    } finally { cleanup(); restoreImage(); }
  });

  test("a failed image alone also queues a frame", async () => {
    const restoreImage = installImage({ fail: () => true });
    const { gjs, raf, cleanup } = onDemand();
    try {
      requestImages(gjs);
      await flush();
      assert.equal(raf.pending.size, 1);
    } finally { cleanup(); restoreImage(); }
  });

  test("images settling while the loop runs queue no extra frame", async () => {
    const restoreImage = installImage();
    const { gjs, raf, cleanup } = onDemand();
    try {
      gjs.start();
      requestImages(gjs);
      await flush();
      assert.equal(raf.pending.size, 1, "only the loop's own frame");
    } finally { cleanup(); restoreImage(); }
  });

  test("without requestAnimationFrame, draws straight away and advances tweens", () => {
    const { gjs, restoreWindow } = build();
    try {
      let renders = 0;
      const render = gjs.renderer.render.bind(gjs.renderer);
      gjs.renderer.render = time => { renders++; return render(time); };
      const values = [];
      gjs.tween({ set: v => values.push(v), from: 0, to: 1, duration: 100 });
      gjs.requestRender();
      assert.equal(renders, 1);
      assert.deepEqual(values, [0], "the tween's first step ran");
    } finally { restoreWindow(); }
  });
});

describe("GraphJS: tweens", () => {
  /* A headless instance (no canvas needed) and a tween that records values. */
  function tweened(gjs, opts) {
    const values = [];
    const tw = gjs.tween({ set: v => { values.push(v); }, from: 0, to: 100, duration: 100, ...opts });
    return { tw, values };
  }

  test("tweens step at the start of each frame, before preTick hooks", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      const log = [];
      gjs.addHook("preTick", () => log.push("preTick"));
      gjs.tween({ set: () => log.push("tween"), from: 0, to: 1, duration: 1000 });
      gjs.start();
      raf.flushFrame(2);
      assert.deepEqual(log, ["tween", "preTick", "tween", "preTick"]);
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("the loop advances tweens by frame time", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      const { values } = tweened(gjs);
      gjs.start();
      raf.flushFrame(3, { t0: 5000, dt: 25 });
      assert.deepEqual(values, [0, 25, 50]);
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("time between stop() and start() doesn't count", () => {
    const raf = installRaf();
    const { gjs, restoreWindow } = build();
    try {
      const { values } = tweened(gjs);
      gjs.start();
      raf.flushFrame(2, { t0: 0, dt: 10 });           // 0, 10
      gjs.stop();
      gjs.start();
      raf.flushFrame(2, { t0: 60000, dt: 10 });       // a minute later: 10, 20
      assert.deepEqual(values, [0, 10, 10, 20]);
    } finally { gjs.stop(); restoreWindow(); raf.restore(); }
  });

  test("step() advances tweens by performance.now()", t => {
    let now = 1000;
    t.mock.method(performance, "now", () => now);
    const gjs = new GraphJS();
    const { values } = tweened(gjs);
    gjs.step();
    now += 40;
    gjs.step();
    assert.deepEqual(values, [0, 40]);
  });

  test("stepTweens() advances tweens without ticking the simulation", () => {
    const gjs = new GraphJS();
    let ticks = 0;
    gjs.simulation.tick = () => { ticks++; return gjs.simulation; };
    const { values } = tweened(gjs);
    gjs.stepTweens(0).stepTweens(50);
    assert.deepEqual(values, [0, 50]);
    assert.equal(ticks, 0);
  });

  test("tweenUnit sets the default unit, and a tween can override it", () => {
    const gjs = new GraphJS({ tweenUnit: "frames" });
    const frames = tweened(gjs, { duration: 4 });
    const ms = tweened(gjs, { duration: 100, unit: "ms" });
    gjs.stepTweens(0).stepTweens(1000);
    assert.deepEqual(frames.values, [25, 50]);
    assert.deepEqual(ms.values, [0, 100]);
    assert.throws(() => new GraphJS({ tweenUnit: "s" }), RangeError);
  });

  test("an ended tween is forgotten, and isTweening() reflects that", async () => {
    const gjs = new GraphJS();
    assert.equal(gjs.isTweening(), false);
    const { tw } = tweened(gjs, { key: "k", duration: 10 });
    assert.equal(gjs.isTweening(), true);
    assert.equal(gjs.getTween("k"), tw);
    gjs.stepTweens(0).stepTweens(10);
    assert.equal(await tw.finished, true);
    assert.equal(gjs.isTweening(), false);
    assert.equal(gjs.getTween("k"), null);
  });

  test("a tween cancelled through its handle is forgotten too", () => {
    const gjs = new GraphJS();
    const { tw } = tweened(gjs, { key: "k" });
    tw.cancel();
    assert.equal(gjs.getTween("k"), null);
    assert.equal(gjs.isTweening(), false);
  });

  test("a tween with an active key replaces it, cancelling the old one", async () => {
    const gjs = new GraphJS();
    const old = tweened(gjs, { key: "zoom" });
    const next = tweened(gjs, { key: "zoom", from: 1, to: 2 });
    gjs.stepTweens(0);
    assert.equal(await old.tw.finished, false);
    assert.deepEqual(old.values, []);
    assert.deepEqual(next.values, [1]);
    assert.equal(gjs.getTween("zoom"), next.tw);
  });

  test("tweens without a key never replace each other", () => {
    const gjs = new GraphJS();
    tweened(gjs);
    tweened(gjs);
    gjs.stepTweens(0);
    assert.equal(gjs._tweens.size, 2);
  });

  test("cancelTween and cancelAllTweens", async () => {
    const gjs = new GraphJS();
    const a = tweened(gjs, { key: "a" }), b = tweened(gjs), c = tweened(gjs);
    assert.equal(gjs.cancelTween("a"), true);
    assert.equal(gjs.cancelTween("a"), false);
    assert.equal(await a.tw.finished, false);
    assert.equal(gjs.cancelAllTweens(), gjs);
    assert.equal(gjs.isTweening(), false);
    assert.deepEqual(await Promise.all([b.tw.finished, c.tw.finished]), [false, false]);
  });

  test("a tween started under the same key by onFinish survives", () => {
    const gjs = new GraphJS();
    let second;
    gjs.tween({
      key: "pulse", set: () => {}, from: 0, to: 1, duration: 10,
      onFinish: () => { second = gjs.tween({ key: "pulse", set: () => {}, from: 1, to: 0, duration: 10 }); },
    });
    gjs.stepTweens(0).stepTweens(10);
    assert.ok(second);
    assert.equal(gjs.getTween("pulse"), second);
  });

  test("a tween started during stepTweens begins on the next call", () => {
    const gjs = new GraphJS();
    let inner;
    gjs.tween({
      set: () => { inner ??= tweened(gjs); }, from: 0, to: 1, duration: 100,
    });
    gjs.stepTweens(0);
    assert.deepEqual(inner.values, []);
    gjs.stepTweens(30);
    assert.deepEqual(inner.values, [0], "its first step counts as no time");
  });

  test("a tween started mid-run counts from its own first step", () => {
    const gjs = new GraphJS();
    tweened(gjs);
    gjs.stepTweens(0).stepTweens(40);
    const late = tweened(gjs);
    gjs.stepTweens(50).stepTweens(60);
    assert.deepEqual(late.values, [0, 10]);
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

      for (const r of gjs.simulation.nodeList)
        assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
      assert.equal(gjs.renderer._nodeStyles.length, gjs.simulation.nodeList.length);
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
      () => gjs.edgeAt(0, 0),
      () => gjs.edgesAt(0, 0),
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

  test("toCanvas and toBlob forward to the renderer, with or without a canvas attached", async () => {
    const gjs = new GraphJS();
    gjs.addNode({ id: "a" });
    const target = makeCanvas({ w: 1, h: 1 });
    assert.equal(gjs.toCanvas({ canvas: target, fit: true, padding: 0 }), target);
    assert.deepEqual([target.width, target.height], [40, 40]);
    target.toBlob = cb => cb("blob");
    assert.equal(await gjs.toBlob({ canvas: target, fit: true }), "blob");
    assert.throws(() => gjs.toCanvas({ canvas: target }), /needs a `width` and `height`/);
  });
});
