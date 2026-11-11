import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Highlighter } from "../src/highlighter.js";

/* Three node slots (a, b, c) and one edge slot, with a style object per slot.
   Starts re-slotted with nothing highlighted, so every alpha is 1. */
function setup() {
  const hl = new Highlighter();
  const nodeList = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const edge = { src: nodeList[0], dest: nodeList[1], data: {} };
  const edgeList = [edge];
  const nodeStyles = nodeList.map(() => ({})), edgeStyles = [{}];
  hl.reslot(null, nodeList, edgeList, nodeStyles, edgeStyles, "dim", 0.2);
  return { hl, nodeList, edge, edgeList, nodeStyles, edgeStyles };
}

describe("Highlighter", () => {
  test("adding and removing sets flags and the highlighted sets", () => {
    const { hl, edge } = setup();
    assert.equal(hl.has(), false);
    hl.addNode("b", 1);
    hl.addEdge(edge, 0);
    assert.equal(hl.has(), true);
    assert.deepEqual([...hl.nodeState], [0, 1, 0]);
    assert.deepEqual([...hl.edgeState], [1]);
    hl.removeNode("b", 1);
    hl.removeEdge(edge, undefined);           // a slot isn't needed to forget it
    assert.deepEqual([...hl.nodes], []);
    assert.deepEqual([...hl.edges], []);
    assert.deepEqual([...hl.nodeState], [0, 0, 0]);
    hl.addNode("a", 0);
    hl.clear();
    assert.equal(hl.has(), false);
    assert.deepEqual([...hl.nodeState], [0, 0, 0]);
  });

  test("the dimmed target depends on mode and alpha, and is 1 with no highlight", () => {
    const { hl } = setup();
    assert.equal(hl.dimmedAlpha("dim", 0.2), 1);
    hl.addNode("a", 0);
    assert.equal(hl.dimmedAlpha("dim", 0.2), 0.2);
    assert.equal(hl.dimmedAlpha("hide", 0.2), 0);
  });

  test("alphas fade toward their targets over the duration, then stop", () => {
    const { hl } = setup();
    hl.addNode("a", 0);
    hl.startFade();
    hl.step(1000, 100, "dim", 0.2);           // first step after starting: no time passes
    assert.deepEqual([...hl.nodeAlpha], [1, 1, 1]);
    hl.step(1040, 100, "dim", 0.2);           // 40% of the way
    assert.deepEqual([...hl.nodeAlpha].map(a => +a.toFixed(2)), [1, 0.6, 0.6]);
    assert.equal(hl.isFading(), true);
    hl.step(1200, 100, "dim", 0.2);
    assert.deepEqual([...hl.nodeAlpha].map(a => +a.toFixed(2)), [1, 0.2, 0.2]);
    assert.equal(hl.isFading(), false);
  });

  test("a duration of 0 switches instantly", () => {
    const { hl } = setup();
    hl.addNode("a", 0);
    hl.startFade();
    hl.step(0, 0, "hide", 0.2);
    assert.deepEqual([...hl.nodeAlpha], [1, 0, 0]);
  });

  test("re-slotting keeps survivors' alphas by style and starts new ones at target", () => {
    const { hl, nodeList, edgeList, nodeStyles, edgeStyles } = setup();
    hl.addNode("c", 2);
    hl.startFade();
    hl.step(0, 100, "dim", 0.2);
    hl.step(50, 100, "dim", 0.2);             // a and b down by 0.5, from 1 to 0.5
    const snap = hl.snapshot(nodeStyles, edgeStyles);
    assert.ok(snap, "a snapshot is taken while highlighting");

    // b is removed; c moves to slot 1; d is new in slot 2
    hl.forgetNode("b");
    const next = [nodeList[0], nodeList[2], { id: "d" }];
    const nextStyles = [nodeStyles[0], nodeStyles[2], {}];
    hl.reslot(snap, next, edgeList, nextStyles, edgeStyles, "dim", 0.2);
    assert.deepEqual([...hl.nodeState], [0, 1, 0]);
    assert.deepEqual([...hl.nodeAlpha].map(a => +a.toFixed(2)), [0.5, 1, 0.2]);
    assert.equal(hl.isFading(), true);
  });

  test("no snapshot is needed with nothing highlighted or fading", () => {
    const { hl, nodeStyles, edgeStyles } = setup();
    assert.equal(hl.snapshot(nodeStyles, edgeStyles), null);
  });
});
