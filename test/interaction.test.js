import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphJS } from "../src/graphjs.js";
import { makeCanvas, installWindow, installRaf, dispatchPointer, r2 } from "./helpers/stubs.js";

// Every event but nodepress, which would start most logs; its tests listen to it
const EVENTS = [
  "nodeenter", "nodeleave", "nodeclick", "nodedblclick",
  "nodedragstart", "nodedrag", "nodedragend", "backgroundclick",
  "panstart", "pan", "panend", "zoom",
];

/* An 800x600 canvas whose bounding rect sits at (10, 20) on the page, with
   node "a" at sim (0, 0) = canvas (400, 300) and "b" at sim (200, 0) =
   canvas (600, 300). `log` records every GraphJS event. The pointer helpers
   take canvas coordinates and send client ones, so a test that forgets the
   rect offset fails. */
function setup(interaction = true, { left = 10, top = 20 } = {}) {
  const restoreWindow = installWindow(1);
  const canvas = makeCanvas({ left, top });
  const gjs = new GraphJS({ canvas, interaction });
  gjs.addNode({ id: "a" });
  gjs.addNode({ id: "b" });
  gjs.addEdge("a", "b");
  gjs.step();
  place(gjs, "a", 0, 0);
  place(gjs, "b", 200, 0);
  const log = [];
  for (const type of EVENTS) gjs.on(type, e => log.push(e));
  const send = (type, cx, cy, opts) => dispatchPointer(canvas, type, { x: cx + left, y: cy + top, ...opts });
  const ptr = {
    down: (cx, cy, opts) => send("pointerdown", cx, cy, opts),
    move: (cx, cy, opts) => send("pointermove", cx, cy, opts),
    up: (cx, cy, opts) => send("pointerup", cx, cy, opts),
    cancel: (cx, cy, opts) => send("pointercancel", cx, cy, opts),
    leave: (cx, cy, opts) => send("pointerleave", cx, cy, opts),
    dblclick: (cx, cy, opts) => send("dblclick", cx, cy, opts),
    wheel: (cx, cy, opts) => send("wheel", cx, cy, opts),
  };
  return { gjs, canvas, log, ptr, restoreWindow };
}

function place(gjs, id, x, y) {
  const node = gjs.simulation.nodes.get(id);
  node.x = x; node.y = y; node.vx = 0; node.vy = 0;
}

const types = log => log.map(e => e.type);
// Event types without hover, for tests that press without moving there first
const acts = log => types(log).filter(t => t !== "nodeenter" && t !== "nodeleave");
const pos = (gjs, id) => gjs.simulation.getPosition(id).map(r2);
const fixed = (gjs, id) => { gjs.simulation.sync(); return gjs.simulation.nodes.get(id).fixed; };
const view = gjs => ({ ...gjs.renderer.view });

describe("Interaction: enabling", () => {
  test("interaction is off by default: no listeners, no events", () => {
    const { gjs, canvas, log, ptr, restoreWindow } = setup(false);
    try {
      assert.equal(gjs.isInteractive(), false);
      assert.equal(gjs.interactionOpts, null);
      assert.equal(canvas.listenerCount(), 0);
      ptr.down(400, 300); ptr.up(400, 300);
      assert.deepEqual(log, []);
    } finally { restoreWindow(); }
  });

  test("the interaction option turns it on, with defaults or given options", () => {
    const { gjs, canvas, restoreWindow } = setup(true);
    try {
      assert.equal(gjs.isInteractive(), true);
      assert.ok(canvas.listenerCount() > 0);
      assert.deepEqual(gjs.interactionOpts, {
        dragNodes: true, pan: true, zoom: true,
        dragThreshold: 4, zoomSpeed: 0.002, minZoom: 0.01, maxZoom: 100,
      });
    } finally { restoreWindow(); }
    const custom = setup({ dragThreshold: 10, pan: false });
    try {
      assert.equal(custom.gjs.interactionOpts.dragThreshold, 10);
      assert.equal(custom.gjs.interactionOpts.pan, false);
      assert.equal(custom.gjs.interactionOpts.zoom, true);
    } finally { custom.restoreWindow(); }
  });

  test("enableInteraction binds to an attached canvas, and updates options when already on", () => {
    const { gjs, canvas, log, ptr, restoreWindow } = setup(false);
    try {
      assert.equal(gjs.enableInteraction({ dragThreshold: 8 }), gjs);
      ptr.down(400, 300); ptr.up(400, 300);
      assert.deepEqual(acts(log), ["nodeclick"]);
      const count = canvas.listenerCount();
      gjs.enableInteraction({ zoom: false });
      assert.equal(canvas.listenerCount(), count, "updating options doesn't add listeners");
      assert.equal(gjs.interactionOpts.dragThreshold, 8, "options left out keep their value");
      assert.equal(gjs.interactionOpts.zoom, false);
    } finally { restoreWindow(); }
  });

  test("disableInteraction removes every listener and restores touch-action", () => {
    const { gjs, canvas, log, ptr, restoreWindow } = setup(false);
    try {
      canvas.style.touchAction = "pan-y";
      gjs.enableInteraction();
      assert.equal(canvas.style.touchAction, "none", "touch drags mustn't scroll the page");
      assert.equal(gjs.disableInteraction(), gjs);
      assert.equal(gjs.isInteractive(), false);
      assert.equal(canvas.listenerCount(), 0);
      assert.equal(canvas.style.touchAction, "pan-y");
      ptr.down(400, 300); ptr.up(400, 300);
      assert.deepEqual(log, []);
    } finally { restoreWindow(); }
  });

  test("turning interaction on again starts from the default options", () => {
    const { gjs, restoreWindow } = setup({ dragThreshold: 10 });
    try {
      gjs.disableInteraction().enableInteraction();
      assert.equal(gjs.interactionOpts.dragThreshold, 4);
    } finally { restoreWindow(); }
  });

  test("detach unbinds, and attach binds the new canvas", () => {
    const { gjs, canvas, restoreWindow } = setup(true);
    try {
      gjs.detach();
      assert.equal(canvas.listenerCount(), 0);
      assert.equal(canvas.style.touchAction, "");
      const next = makeCanvas();
      gjs.attach(next);
      assert.ok(next.listenerCount() > 0);
      assert.equal(canvas.listenerCount(), 0, "the old canvas gets nothing back");
      gjs.attach(canvas);
      assert.equal(next.listenerCount(), 0, "attaching another canvas unbinds the previous one");
    } finally { restoreWindow(); }
  });

  test("interaction turned on without a canvas binds once one is attached", () => {
    const restoreWindow = installWindow(1);
    try {
      const gjs = new GraphJS({ interaction: true });
      assert.equal(gjs.isInteractive(), true);
      const canvas = makeCanvas();
      gjs.attach(canvas);
      assert.ok(canvas.listenerCount() > 0);
    } finally { restoreWindow(); }
  });

  test("a canvas that can't receive pointer input is rendered to, but not listened on", () => {
    const restoreWindow = installWindow(1);
    try {
      const { ctx } = makeCanvas();
      let added = 0;
      // Like an OffscreenCanvas: an EventTarget without layout
      const offscreen = { width: 800, height: 600, getContext: () => ctx, addEventListener() { added++; } };
      const gjs = new GraphJS({ canvas: offscreen, interaction: true });
      assert.equal(gjs.canvas, offscreen);
      assert.equal(added, 0);
      assert.doesNotThrow(() => gjs.detach());
    } finally { restoreWindow(); }
  });

  test("invalid options throw and change nothing", () => {
    const { gjs, restoreWindow } = setup(true);
    try {
      for (const bad of [
        { dragNodes: "yes" }, { pan: 1 }, { zoom: null },
        { dragThreshold: -1 }, { dragThreshold: NaN }, { dragThreshold: "4" },
        { zoomSpeed: 0 }, { zoomSpeed: Infinity },
        { minZoom: 0 }, { minZoom: 2, maxZoom: 1 },
      ]) {
        assert.throws(() => gjs.enableInteraction(bad), /Interaction:/, JSON.stringify(bad));
      }
      assert.equal(gjs.interactionOpts.dragThreshold, 4);
      assert.throws(() => new GraphJS({ interaction: { zoomSpeed: -1 } }), RangeError);
    } finally { restoreWindow(); }
  });

  test("maxZoom may be Infinity", () => {
    const { gjs, restoreWindow } = setup({ maxZoom: Infinity });
    try { assert.equal(gjs.interactionOpts.maxZoom, Infinity); } finally { restoreWindow(); }
  });
});

describe("Interaction: clicks", () => {
  test("a press and release on a node is a nodeclick, in canvas coordinates", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300);
      const up = ptr.up(400, 300);
      assert.deepEqual(types(log), ["nodeclick", "nodeenter"], "a mouse release updates hover");
      const [e] = log;
      assert.equal(e.id, "a");
      assert.deepEqual([e.x, e.y], [400, 300], "client coordinates minus the canvas's rect");
      assert.equal(e.originalEvent, up);
      assert.equal(e.target, gjs);
    } finally { restoreWindow(); }
  });

  test("a press and release on the background is a backgroundclick", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(100, 100); ptr.up(100, 100);
      assert.deepEqual(types(log), ["backgroundclick"]);
      assert.equal("id" in log[0], false);
    } finally { restoreWindow(); }
  });

  test("moving no further than the threshold is still a click", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300); ptr.move(403, 300); ptr.move(400, 304); ptr.up(400, 304);
      assert.deepEqual(acts(log), ["nodeclick"]);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
    } finally { restoreWindow(); }
  });

  test("the node clicked is the one pressed, even if released over another", () => {
    const { log, ptr, restoreWindow } = setup({ dragThreshold: 1000 });
    try {
      ptr.down(400, 300); ptr.up(600, 300);
      assert.deepEqual(log.map(e => [e.type, e.id]), [["nodeclick", "a"], ["nodeenter", "b"]]);
    } finally { restoreWindow(); }
  });

  test("a cancelled press isn't a click", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300); ptr.cancel(400, 300);
      assert.deepEqual(log, []);
    } finally { restoreWindow(); }
  });

  test("only the primary pointer's main button presses", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300, { button: 2 }); ptr.up(400, 300, { button: 2 });
      ptr.down(400, 300, { isPrimary: false, pointerId: 2 }); ptr.up(400, 300, { pointerId: 2 });
      assert.deepEqual(log, []);
    } finally { restoreWindow(); }
  });

  test("other pointers don't move or end the press", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300);
      ptr.move(500, 300, { pointerId: 2 });
      ptr.up(500, 300, { pointerId: 2 });
      assert.deepEqual(log, []);
      ptr.up(400, 300);
      assert.deepEqual(acts(log), ["nodeclick"]);
    } finally { restoreWindow(); }
  });

  test("a press captures the pointer", () => {
    const { canvas, ptr, restoreWindow } = setup();
    try {
      ptr.down(100, 100, { pointerId: 7 });
      assert.ok(canvas.captured.has(7));
    } finally { restoreWindow(); }
  });

  test("pressing a node emits nodepress straight away, before the click or drag", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodepress", e => log.push(e));
      const down = ptr.down(600, 300);
      assert.deepEqual(types(log), ["nodepress"], "emitted on press, not release");
      const [e] = log;
      assert.equal(e.id, "b");
      assert.deepEqual([e.x, e.y], [600, 300]);
      assert.equal(e.originalEvent, down);
      ptr.up(600, 300);
      assert.deepEqual(acts(log), ["nodepress", "nodeclick"]);
      log.length = 0;
      ptr.down(600, 300); ptr.move(650, 300); ptr.up(650, 300);
      assert.deepEqual(acts(log), ["nodepress", "nodedragstart", "nodedrag", "nodedragend"]);
    } finally { restoreWindow(); }
  });

  test("pressing the background, or with another button, emits no nodepress", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      let presses = 0;
      gjs.on("nodepress", () => { presses++; });
      ptr.down(100, 100); ptr.up(100, 100);
      ptr.down(400, 300, { button: 2 }); ptr.up(400, 300, { button: 2 });
      ptr.down(400, 300, { isPrimary: false, pointerId: 2 }); ptr.up(400, 300, { pointerId: 2 });
      assert.equal(presses, 0);
    } finally { restoreWindow(); }
  });

  test("preventing nodepress ignores the press: no drag, click or capture", () => {
    const { gjs, canvas, log, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodepress", e => e.preventDefault());
      ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300);
      ptr.down(400, 300, { pointerId: 3 }); ptr.up(400, 300, { pointerId: 3 });
      assert.deepEqual(acts(log), []);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
      assert.equal(fixed(gjs, "a"), false);
      assert.equal(canvas.captured.size, 0);
    } finally { restoreWindow(); }
  });

  test("after an ignored press, hover carries on as if nothing was pressed", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodepress", e => e.preventDefault());
      ptr.move(400, 300);
      ptr.down(400, 300);
      ptr.move(600, 300);
      assert.deepEqual(log.map(e => [e.type, e.id]), [["nodeenter", "a"], ["nodeleave", "a"], ["nodeenter", "b"]]);
    } finally { restoreWindow(); }
  });

  test("a nodepress listener that turns interaction off stops the press cleanly", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodepress", e => e.target.disableInteraction());
      assert.doesNotThrow(() => { ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300); });
      assert.deepEqual(log, []);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
    } finally { restoreWindow(); }
  });

  test("a double-click on a node is a nodedblclick; on the background it's nothing", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.dblclick(600, 300);
      ptr.dblclick(100, 100);
      assert.deepEqual(log.map(e => [e.type, e.id]), [["nodedblclick", "b"]]);
    } finally { restoreWindow(); }
  });
});

describe("Interaction: hover", () => {
  test("moving onto and off nodes emits nodeenter and nodeleave", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.move(100, 100);
      ptr.move(400, 300);
      ptr.move(401, 300);
      ptr.move(600, 300);
      ptr.move(100, 100);
      assert.deepEqual(log.map(e => [e.type, e.id]), [
        ["nodeenter", "a"], ["nodeleave", "a"], ["nodeenter", "b"], ["nodeleave", "b"],
      ]);
    } finally { restoreWindow(); }
  });

  test("leaving the canvas leaves the hovered node", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.move(400, 300);
      ptr.leave(-5, 300);
      assert.deepEqual(log.map(e => [e.type, e.id]), [["nodeenter", "a"], ["nodeleave", "a"]]);
    } finally { restoreWindow(); }
  });

  test("hover is held during a press, and updated on release", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.move(400, 300);
      ptr.down(400, 300);
      ptr.move(600, 300);
      ptr.leave(900, 300);
      assert.equal(log.some(e => e.type === "nodeleave"), false);
      ptr.up(600, 300);
      assert.deepEqual(log.slice(-2).map(e => [e.type, e.id]), [["nodeleave", "a"], ["nodeenter", "b"]]);
    } finally { restoreWindow(); }
  });

  test("a touch release doesn't leave a node hovered", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300, { pointerType: "touch" });
      ptr.up(400, 300, { pointerType: "touch" });
      assert.deepEqual(types(log), ["nodeclick"]);
    } finally { restoreWindow(); }
  });
});

describe("Interaction: dragging nodes", () => {
  test("dragging a node pins it under the pointer, then unpins it", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300);
      ptr.move(420, 310);
      assert.deepEqual(pos(gjs, "a"), [20, 10]);
      assert.equal(fixed(gjs, "a"), true);
      ptr.move(430, 310);
      ptr.up(430, 310);
      assert.deepEqual(pos(gjs, "a"), [30, 10]);
      assert.equal(fixed(gjs, "a"), false);
      assert.deepEqual(types(log), ["nodedragstart", "nodedrag", "nodedrag", "nodedragend", "nodeenter"]);
    } finally { restoreWindow(); }
  });

  test("drag events carry the node, positions, and movement since the previous event", () => {
    const { log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300); ptr.move(402, 300); ptr.move(420, 310); ptr.move(430, 305); ptr.up(431, 305);
      const drag = log.filter(e => e.type.startsWith("nodedrag"));
      assert.deepEqual(drag.map(e => [e.type, e.id, e.x, e.y]), [
        ["nodedragstart", "a", 400, 300],     // where the press started
        ["nodedrag", "a", 420, 310],
        ["nodedrag", "a", 430, 305],
        ["nodedragend", "a", 431, 305],
      ]);
      assert.deepEqual(drag.filter(e => e.type === "nodedrag").map(e => [e.dx, e.dy]), [[20, 10], [10, -5]]);
    } finally { restoreWindow(); }
  });

  test("the node keeps its offset from the pointer, so it doesn't jump", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      ptr.down(403, 302);                     // grabbed off-centre
      ptr.move(423, 312);
      assert.deepEqual(pos(gjs, "a"), [20, 10]);
    } finally { restoreWindow(); }
  });

  test("dragging follows the view's zoom", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.renderer.view = { zoom: 2 };       // a at canvas (400, 300), b at (800, 300)
      ptr.down(400, 300);
      ptr.move(440, 300);
      assert.deepEqual(pos(gjs, "a"), [20, 0], "40 canvas px is 20 sim px at zoom 2");
    } finally { restoreWindow(); }
  });

  test("a node that was already fixed stays fixed where it's dropped", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.simulation.setNodeConfig("a", { fixed: true });
      ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300);
      assert.equal(fixed(gjs, "a"), true);
      assert.deepEqual(pos(gjs, "a"), [50, 0]);
    } finally { restoreWindow(); }
  });

  test("preventing nodedragstart leaves the node alone for the whole press", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodedragstart", e => e.preventDefault());
      ptr.down(400, 300); ptr.move(450, 300); ptr.move(460, 300); ptr.up(460, 300);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
      assert.equal(fixed(gjs, "a"), false);
      assert.deepEqual(types(log), ["nodedragstart"], "and it isn't a click either");
    } finally { restoreWindow(); }
  });

  test("preventing nodedrag holds the node, and the drag goes on", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      const stop = e => e.preventDefault();
      gjs.on("nodedrag", stop);
      ptr.down(400, 300); ptr.move(450, 300);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
      gjs.off("nodedrag", stop);
      ptr.move(460, 300);
      assert.deepEqual(pos(gjs, "a"), [60, 0], "the pointer's offset is kept, not the skipped move");
      ptr.up(460, 300);
      assert.ok(types(log).includes("nodedragend"));
    } finally { restoreWindow(); }
  });

  test("preventing nodedragend leaves the node pinned where it was dropped", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodedragend", e => e.preventDefault());
      ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300);
      assert.equal(fixed(gjs, "a"), true);
    } finally { restoreWindow(); }
  });

  test("a cancelled drag ends with nodedragend and unpins", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300); ptr.move(450, 300); ptr.cancel(450, 300);
      assert.deepEqual(types(log), ["nodedragstart", "nodedrag", "nodedragend"]);
      assert.equal(fixed(gjs, "a"), false);
    } finally { restoreWindow(); }
  });

  test("detaching mid-drag unpins the node without events", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      ptr.down(400, 300); ptr.move(450, 300);
      log.length = 0;
      gjs.detach();
      assert.equal(fixed(gjs, "a"), false);
      assert.deepEqual(log, []);
    } finally { restoreWindow(); }
  });

  test("a listener that turns interaction off mid-drag stops it cleanly", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.on("nodedrag", e => e.target.disableInteraction());
      ptr.down(400, 300);
      assert.doesNotThrow(() => ptr.move(450, 300));
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
      assert.equal(fixed(gjs, "a"), false);
    } finally { restoreWindow(); }
  });

  test("with dragNodes off, dragging a node pans instead", () => {
    const { gjs, log, ptr, restoreWindow } = setup({ dragNodes: false });
    try {
      ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300);
      assert.deepEqual(acts(log), ["panstart", "pan", "panend"]);
      assert.deepEqual(pos(gjs, "a"), [0, 0]);
    } finally { restoreWindow(); }
  });

  test("with dragNodes and pan off, a drag does nothing and isn't a click", () => {
    const { gjs, log, ptr, restoreWindow } = setup({ dragNodes: false, pan: false });
    try {
      const before = view(gjs);
      ptr.down(400, 300); ptr.move(450, 300); ptr.up(450, 300);
      assert.deepEqual(acts(log), []);
      assert.deepEqual(view(gjs), before);
    } finally { restoreWindow(); }
  });
});

describe("Interaction: panning", () => {
  test("dragging the background pans the view with the pointer", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      gjs.renderer.view = { zoom: 2 };
      ptr.down(100, 100); ptr.move(120, 90); ptr.move(140, 90); ptr.up(140, 90);
      assert.deepEqual(types(log), ["panstart", "pan", "pan", "panend"]);
      // 40 canvas px right and 10 up is 20 and 5 sim px at zoom 2; the view moves the other way
      assert.deepEqual(view(gjs), { x: -20, y: 5, zoom: 2 });
    } finally { restoreWindow(); }
  });

  test("pan events carry the view: current at the ends, the one it pans to in between", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      let current;
      gjs.on("pan", () => { current = view(gjs); });
      ptr.down(100, 100); ptr.move(110, 100); ptr.up(110, 100);
      const [start, pan, end] = log;
      assert.deepEqual([start.x, start.y], [100, 100]);
      assert.deepEqual(start.view, { x: 0, y: 0, zoom: 1 });
      assert.deepEqual(pan.view, { x: -10, y: 0, zoom: 1 });
      assert.deepEqual([pan.dx, pan.dy], [10, 0]);
      assert.deepEqual(current, { x: 0, y: 0, zoom: 1 }, "the view changes after listeners run");
      assert.deepEqual(end.view, { x: -10, y: 0, zoom: 1 });
      assert.notEqual(end.view, gjs.renderer.view, "events get a copy of the view");
    } finally { restoreWindow(); }
  });

  test("preventing pan keeps the view; preventing panstart stops the whole pan", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      const stop = e => e.preventDefault();
      gjs.on("pan", stop);
      ptr.down(100, 100); ptr.move(150, 100); ptr.up(150, 100);
      assert.deepEqual(view(gjs), { x: 0, y: 0, zoom: 1 });
      gjs.off("pan", stop);
      gjs.on("panstart", stop);
      log.length = 0;
      ptr.down(100, 100); ptr.move(150, 100); ptr.up(150, 100);
      assert.deepEqual(types(log), ["panstart"]);
      assert.deepEqual(view(gjs), { x: 0, y: 0, zoom: 1 });
    } finally { restoreWindow(); }
  });

  test("with pan off, dragging the background does nothing", () => {
    const { gjs, log, ptr, restoreWindow } = setup({ pan: false });
    try {
      ptr.down(100, 100); ptr.move(150, 100); ptr.up(150, 100);
      assert.deepEqual(log, []);
      assert.deepEqual(view(gjs), { x: 0, y: 0, zoom: 1 });
    } finally { restoreWindow(); }
  });
});

describe("Interaction: zooming", () => {
  test("the wheel zooms, keeping the point under the pointer fixed", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      const anchor = gjs.canvasToSim(500, 250);
      const e = ptr.wheel(500, 250, { deltaY: -100 });
      assert.equal(e.defaultPrevented, true, "the page doesn't scroll");
      assert.ok(gjs.renderer.view.zoom > 1);
      assert.equal(r2(gjs.renderer.view.zoom), r2(2 ** 0.2));
      assert.deepEqual(gjs.simToCanvas(...anchor).map(r2), [500, 250]);
      assert.deepEqual(types(log), ["zoom"]);
      assert.deepEqual([log[0].x, log[0].y], [500, 250]);
      assert.deepEqual(log[0].view, view(gjs));
      ptr.wheel(500, 250, { deltaY: 100 });
      assert.equal(r2(gjs.renderer.view.zoom), 1, "the same delta back undoes it");
    } finally { restoreWindow(); }
  });

  test("line and page wheel deltas are converted to px", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      ptr.wheel(400, 300, { deltaY: -3, deltaMode: 1 });
      assert.equal(r2(gjs.renderer.view.zoom), r2(2 ** (48 * 0.002)));
      gjs.renderer.view = { zoom: 1 };
      ptr.wheel(400, 300, { deltaY: -1, deltaMode: 2 });
      assert.equal(r2(gjs.renderer.view.zoom), r2(2 ** (600 * 0.002)));
    } finally { restoreWindow(); }
  });

  test("zoomSpeed scales the zoom per wheel px", () => {
    const { gjs, ptr, restoreWindow } = setup({ zoomSpeed: 0.01 });
    try {
      ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(r2(gjs.renderer.view.zoom), 2);
    } finally { restoreWindow(); }
  });

  test("preventing zoom keeps the view, and the page still doesn't scroll", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.on("zoom", e => e.preventDefault());
      const e = ptr.wheel(400, 300, { deltaY: -100 });
      assert.deepEqual(view(gjs), { x: 0, y: 0, zoom: 1 });
      assert.equal(e.defaultPrevented, true);
    } finally { restoreWindow(); }
  });

  test("zoom stops at the limits, without snapping a view already past one", () => {
    const { gjs, log, ptr, restoreWindow } = setup({ minZoom: 0.5, maxZoom: 1.05 });
    try {
      ptr.wheel(400, 300, { deltaY: -1000 });
      assert.equal(gjs.renderer.view.zoom, 1.05);
      const e = ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(log.length, 1, "no event when the zoom can't change");
      assert.equal(e.defaultPrevented, true, "the page doesn't scroll at a limit either");
      ptr.wheel(400, 300, { deltaY: 10000 });
      assert.equal(gjs.renderer.view.zoom, 0.5);

      gjs.renderer.view = { zoom: 3 };          // set past maxZoom by code
      ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(gjs.renderer.view.zoom, 3, "zooming in further does nothing");
      ptr.wheel(400, 300, { deltaY: 100 });
      assert.ok(gjs.renderer.view.zoom < 3 && gjs.renderer.view.zoom > 1.05, "zooming out works from where it is");
    } finally { restoreWindow(); }
  });

  test("with zoom off, or a horizontal scroll, the wheel is left to the page", () => {
    const { gjs, log, ptr, restoreWindow } = setup();
    try {
      assert.equal(ptr.wheel(400, 300, { deltaY: 0 }).defaultPrevented, false);
      gjs.enableInteraction({ zoom: false });
      assert.equal(ptr.wheel(400, 300, { deltaY: -100 }).defaultPrevented, false);
      assert.deepEqual(log, []);
      assert.equal(gjs.renderer.view.zoom, 1);
    } finally { restoreWindow(); }
  });
});

describe("Interaction: rendering", () => {
  function counted(gjs) {
    const calls = [];
    const render = gjs.renderer.render.bind(gjs.renderer);
    gjs.renderer.render = time => { calls.push(time); return render(time); };
    return calls;
  }

  test("while the loop is stopped, changes render once on the next frame", () => {
    const raf = installRaf();
    const { gjs, ptr, restoreWindow } = setup();
    try {
      const calls = counted(gjs);
      ptr.down(100, 100); ptr.move(150, 100); ptr.move(160, 100);
      ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(calls.length, 0);
      assert.equal(raf.pending.size, 1, "several changes share one frame");
      raf.flushFrame(1, { t0: 500 });
      assert.deepEqual(calls, [500]);
    } finally { restoreWindow(); raf.restore(); }
  });

  test("while the loop runs, interaction leaves rendering to it", () => {
    const raf = installRaf();
    const { gjs, ptr, restoreWindow } = setup();
    try {
      gjs.start();
      ptr.down(100, 100); ptr.move(150, 100);
      assert.equal(raf.pending.size, 1, "only the loop's own frame");
      gjs.stop();
    } finally { restoreWindow(); raf.restore(); }
  });

  test("detaching cancels a pending render", () => {
    const raf = installRaf();
    const { gjs, ptr, restoreWindow } = setup();
    try {
      ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(raf.pending.size, 1);
      gjs.detach();
      assert.equal(raf.pending.size, 0);
    } finally { restoreWindow(); raf.restore(); }
  });

  test("without requestAnimationFrame, changes render straight away", () => {
    const { gjs, ptr, restoreWindow } = setup();
    try {
      const calls = counted(gjs);
      ptr.wheel(400, 300, { deltaY: -100 });
      assert.equal(calls.length, 1);
    } finally { restoreWindow(); }
  });
});
