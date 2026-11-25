import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LabelPlacer } from "../src/label-placer.js";

/** Boxes as [x0, y0, x1, y1] each, flattened as `place()` takes them */
const flat = boxes => Float64Array.from(boxes.flat());

/** Places boxes in the order given, on an 800x600 canvas */
function place(boxes, order = boxes.map((_, i) => i), pad = 0, placer = new LabelPlacer()) {
  return [...placer.placeAll(flat(boxes), order, pad, 800, 600)];
}

describe("LabelPlacer", () => {
  test("keeps boxes that don't overlap", () => {
    assert.deepEqual(place([[0, 0, 10, 10], [20, 0, 30, 10], [0, 20, 10, 30]]), [1, 1, 1]);
  });

  test("drops a box overlapping one placed before it, in the order given", () => {
    const boxes = [[0, 0, 50, 10], [40, 5, 90, 15]];
    assert.deepEqual(place(boxes), [1, 0]);
    assert.deepEqual(place(boxes, [1, 0]), [0, 1], "the second goes first");
  });

  test("a dropped box doesn't block later ones", () => {
    // 1 overlaps 0 and is dropped; 2 overlaps only 1, so it's kept
    assert.deepEqual(place([[0, 0, 50, 10], [40, 0, 90, 10], [80, 0, 130, 10]]), [1, 0, 1]);
  });

  test("boxes that only touch don't overlap", () => {
    assert.deepEqual(place([[0, 0, 10, 10], [10, 0, 20, 10], [0, 10, 10, 20]]), [1, 1, 1]);
  });

  test("padding keeps boxes at least that far apart", () => {
    const boxes = [[0, 0, 10, 10], [13, 0, 23, 10]];     // 3 apart
    assert.deepEqual(place(boxes, undefined, 3), [1, 1], "exactly the padding apart");
    assert.deepEqual(place(boxes, undefined, 4), [1, 0]);
  });

  test("finds overlaps across grid cells and in boxes larger than a cell", () => {
    // A wide box spanning many cells, and a small one far along it
    assert.deepEqual(place([[5, 100, 700, 120], [650, 110, 660, 130]]), [1, 0]);
    // Two boxes meeting across a cell boundary (cells are 32 px)
    assert.deepEqual(place([[20, 20, 33, 30], [31, 25, 40, 35]]), [1, 0]);
  });

  test("boxes reaching past the canvas still collide", () => {
    assert.deepEqual(place([[-100, -50, 10, 10], [-60, -20, -40, 5]]), [1, 0], "past the top left");
    assert.deepEqual(place([[780, 590, 900, 700], [850, 650, 950, 750]]), [1, 0], "past the bottom right");
  });

  test("the grid is emptied between calls", () => {
    const placer = new LabelPlacer();
    place([[0, 0, 100, 100]], undefined, 0, placer);
    assert.deepEqual(place([[50, 50, 60, 60]], undefined, 0, placer), [1]);
  });

  test("a canvas resized between calls is handled", () => {
    const placer = new LabelPlacer();
    assert.deepEqual([...placer.placeAll(flat([[0, 0, 10, 10]]), [0], 0, 64, 64)], [1]);
    assert.deepEqual([...placer.placeAll(flat([[1000, 1000, 1010, 1010], [1005, 1005, 1020, 1020]]), [0, 1], 0, 2000, 2000)],
      [1, 0]);
    assert.deepEqual([...placer.placeAll(flat([[5, 5, 15, 15]]), [0], 0, 0, 0)], [1], "an empty canvas has one cell");
  });

  test("boxes can be placed one at a time, from anywhere", () => {
    const placer = new LabelPlacer();
    placer.begin(800, 600);
    assert.equal(placer.tryPlace(0, 0, 50, 10, 0), true);
    assert.equal(placer.tryPlace(40, 5, 90, 15, 0), false);
    assert.equal(placer.tryPlace(52, 0, 60, 10, 3), false, "within the padding");
    assert.equal(placer.tryPlace(53, 0, 60, 10, 3), true);
    placer.end();
    placer.begin(800, 600);
    assert.equal(placer.tryPlace(40, 5, 90, 15, 0), true, "end() forgets every box");
    placer.end();
  });

  test("any number of boxes can be placed", () => {
    const placer = new LabelPlacer();
    placer.begin(800, 600);
    for (let k = 0; k < 200; k++) assert.equal(placer.tryPlace(4 * k, 0, 4 * k + 3, 3, 0), true);
    assert.equal(placer.tryPlace(797, 1, 799, 2, 0), false, "the last box placed is still there");
    assert.equal(placer.tryPlace(1, 1, 2, 2, 0), false, "and so is the first");
    placer.end();
  });
});
