import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CollisionGrid } from "../src/collision-grid.js";
import {
  rng, scatter, bruteCollide, overlapDepth, assertClose, assertAllClose,
} from "./helpers/bodies.js";

const none = n => new Uint8Array(n);

/* Bodies in well-separated pairs, so push order can't matter and the result
   has to match brute force exactly. Any pair the grid wrongly skips shows up. */
function isolatedPairs({ pairCount = 150, seed = 7, spacing = 500, bigEvery = 7 } = {}) {
  const r = rng(seed), n = pairCount * 2;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const xs = new Float64Array(n), ys = new Float64Array(n), radii = new Float64Array(n);
  for (let p = 0; p < pairCount; p++) {
    const a = order[2 * p], b = order[2 * p + 1];
    const big = 3 + r() * (p % bigEvery === 0 ? 150 : 20), small = 1 + r() * 5;
    const angle = r() * 2 * Math.PI, gap = (big + small) * (0.2 + 0.7 * r());
    xs[a] = (p % 15) * spacing; ys[a] = Math.floor(p / 15) * spacing;
    xs[b] = xs[a] + Math.cos(angle) * gap; ys[b] = ys[a] + Math.sin(angle) * gap;
    radii[a] = big; radii[b] = small;
  }
  return { xs, ys, radii, n };
}

// Returns the grid, so a test can check which bucket mode it used
function assertMatchesBrute(xs, ys, radii, fixed = none(xs.length)) {
  const gx = xs.slice(), gy = ys.slice(), grid = new CollisionGrid();
  grid.collide(gx, gy, radii, fixed);
  bruteCollide(xs, ys, radii, fixed);
  assertAllClose(gx, xs);
  assertAllClose(gy, ys);
  return grid;
}

// A compact layout gets one bucket per cell; a spread-out one is hashed
const MODES = [["dense buckets", true], ["hashed buckets", false]];

describe("CollisionGrid: pairs", () => {
  test("an overlapping pair is pushed apart until it just touches", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new CollisionGrid().collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [-5, 15]);
    assertAllClose(ys, [0, 0]);
  });

  test("the push follows the line between the two bodies", () => {
    const xs = new Float64Array([0, 3]), ys = new Float64Array([0, 4]);
    new CollisionGrid().collide(xs, ys, [5, 5], none(2));
    assertClose(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]), 10);
    assertClose((ys[1] - ys[0]) / (xs[1] - xs[0]), 4 / 3);
  });

  test("bodies that only touch are left alone", () => {
    const xs = new Float64Array([0, 20]), ys = new Float64Array([0, 0]);
    new CollisionGrid().collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [0, 20]);
  });

  test("zero-radius bodies never collide, even when coincident", () => {
    const xs = new Float64Array([4, 4]), ys = new Float64Array([4, 4]);
    new CollisionGrid().collide(xs, ys, [0, 0], none(2));
    assertAllClose(xs, [4, 4]);
  });

  test("a zero-radius body inside a sized one is pushed to its edge", () => {
    const xs = new Float64Array([0, 4]), ys = new Float64Array([0, 0]);
    new CollisionGrid().collide(xs, ys, [10, 0], none(2));
    assertClose(xs[1] - xs[0], 10);
  });

  for (const [name, i, j] of [["first", 0, 1], ["second", 1, 0]]) {
    test(`a fixed ${name} body holds still while the other takes the whole push`, () => {
      const xs = new Float64Array(2), ys = new Float64Array(2), fixed = new Uint8Array(2);
      xs[j] = 10; fixed[i] = 1;
      new CollisionGrid().collide(xs, ys, [10, 10], fixed);
      assert.equal(xs[i], 0);
      assertClose(xs[j], 20);
    });
  }

  test("two fixed bodies are left overlapping", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new CollisionGrid().collide(xs, ys, [10, 10], new Uint8Array([1, 1]));
    assertAllClose(xs, [0, 10]);
  });

  test("boolean and numeric fixed arrays behave the same", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new CollisionGrid().collide(xs, ys, [10, 10], [true, false]);
    assertAllClose(xs, [0, 20]);
  });

  test("coincident bodies separate along a random axis", () => {
    const xs = new Float64Array(2).fill(7), ys = new Float64Array(2).fill(7);
    new CollisionGrid().collide(xs, ys, [10, 10], none(2));
    assert.ok([...xs, ...ys].every(Number.isFinite));
    assert.ok(Math.hypot(xs[0] - xs[1], ys[0] - ys[1]) > 1);
  });

  // Every cell boundary direction, including diagonals and negative coordinates
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    test(`a pair split across a cell boundary is found (direction ${dx},${dy})`, () => {
      // Cells are 20 wide here: (10,10) is a cell's centre, so 15 away is always the next cell
      const xs = new Float64Array([10, 10 + dx * 15]), ys = new Float64Array([10, 10 + dy * 15]);
      assertMatchesBrute(xs, ys, [10, 10]);
      assert.ok(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]) >= 20 - 1e-9);
    });
  }
});

describe("CollisionGrid: finding overlaps", () => {
  test("every isolated overlap is found, whatever the radii and body order", () => {
    const { xs, ys, radii } = isolatedPairs();
    assert.equal(assertMatchesBrute(xs, ys, radii)._dense, false);
  });

  for (const [mode, dense] of MODES) {
    test(`every isolated overlap is found with similar radii (${mode})`, () => {
      const { xs, ys, n } = isolatedPairs({ bigEvery: Infinity, spacing: dense ? 60 : 500 });
      const radii = Float64Array.from({ length: n }, (_, i) => (i % 2 ? 10 : 12));
      assert.equal(assertMatchesBrute(xs, ys, radii)._dense, dense);
    });
  }

  test("overlaps are found far from the origin, where cell coordinates wrap", () => {
    // 1e12 / 20 is well past the int32 range of the cell coordinates. The
    // layout is compact, but too far out for dense buckets.
    const { xs, ys, n } = isolatedPairs({ pairCount: 60, bigEvery: Infinity, spacing: 60 });
    const radii = Float64Array.from({ length: n }, (_, i) => (i % 2 ? 10 : 12));
    for (let i = 0; i < n; i++) { xs[i] += 1e12; ys[i] -= 3e11; }
    assert.equal(assertMatchesBrute(xs, ys, radii)._dense, false);
  });

  test("a far outlier doesn't stop nearby overlaps from being found", () => {
    const { xs, ys, n } = isolatedPairs({ pairCount: 40, bigEvery: Infinity, spacing: 60 });
    const radii = Float64Array.from({ length: n }, (_, i) => (i % 2 ? 10 : 12));
    xs[0] = 1e9; ys[0] = -1e9;
    assert.equal(assertMatchesBrute(xs, ys, radii)._dense, false);
  });

  for (const [name, hub, tiny] of [["lower", 0, 1], ["higher", 1, 0]]) for (const [mode, dense] of MODES) {
    test(`a large body with the ${name} index reaches a small one three cells away (${mode})`, () => {
      // A lattice of non-overlapping bodies keeps the grid busy, so the hub
      // looks up the cells in its reach rather than scanning every body
      const n = 2002, xs = new Float64Array(n), ys = new Float64Array(n), radii = new Float64Array(n).fill(5);
      const at = dense ? 200 : 1e6;
      for (let i = 2; i < n; i++) { xs[i] = at + (i % 50) * 20; ys[i] = at + Math.floor(i / 50) * 20; }
      xs[hub] = 0; ys[hub] = 0; radii[hub] = 60;
      xs[tiny] = 0; ys[tiny] = -62;

      const grid = new CollisionGrid(), bx = xs.slice(), by = ys.slice();
      grid.collide(xs, ys, radii, none(n));
      const cs = grid._cellSize, span = Math.ceil((2 * (60 + cs / 2)) / cs) + 1;
      assert.ok(span * span < n - 1, "the hub should look up cells, not scan");
      assert.ok(62 > 1.5 * cs, "the small body should lie beyond the hub's 3x3 block");
      assert.equal(grid._dense, dense);
      bruteCollide(bx, by, radii, none(n));
      assertAllClose(xs, bx);
      assertAllClose(ys, by);
    });

  }

  for (const [name, hub, tiny] of [["lower", 0, 1], ["higher", 1, 0]]) {
    test(`a large body with the ${name} index reaches a small one when scanning every body`, () => {
      const { xs, ys } = scatter(40, 1000, 3);
      const radii = new Float64Array(40).fill(1);
      for (let i = 0; i < 40; i++) { xs[i] += 1000; ys[i] += 1000; }
      xs[hub] = 0; ys[hub] = 0; radii[hub] = 300;
      xs[tiny] = 250; ys[tiny] = 0;

      const grid = new CollisionGrid();
      grid.collide(xs, ys, radii, none(40));
      assert.ok(grid._cellSize < 300, "the hub should be kept out of the grid");
      assertClose(Math.hypot(xs[hub] - xs[tiny], ys[hub] - ys[tiny]), 301, 1e-9);
    });
  }

  for (const [mode, dense] of MODES) test(`a body pushed several cells by a large one is found in its new cell (${mode})`, () => {
    // Cells are about 20 wide. The fixed hub pushes j from y=-15 to y=-65,
    // three cells down, where it now overlaps k.
    const n = 2003, xs = new Float64Array(n), ys = new Float64Array(n);
    const radii = new Float64Array(n).fill(5), fixed = new Uint8Array(n);
    const at = dense ? 200 : 1e6;
    for (let i = 3; i < n; i++) { xs[i] = at + (i % 50) * 20; ys[i] = at + Math.floor(i / 50) * 20; }
    const hub = 0, j = 1, k = 2;
    radii[hub] = 60; fixed[hub] = 1;
    ys[j] = -15; ys[k] = -73;

    const grid = new CollisionGrid();
    grid.collide(xs, ys, radii, fixed);
    assert.ok(58 > 2 * grid._cellSize, "j and k should start more than a cell apart");
    assert.ok(Math.hypot(xs[j] - xs[k], ys[j] - ys[k]) >= 10 - 1e-9, "j and k were left overlapping");
    assert.equal(grid._dense, dense);
  });

  test("two large bodies overlapping each other are separated", () => {
    const xs = new Float64Array(52), ys = new Float64Array(52), radii = new Float64Array(52).fill(1);
    for (let i = 2; i < 52; i++) { xs[i] = 5000 + i * 10; ys[i] = 5000; }
    xs[0] = 0; xs[1] = 100; radii[0] = 200; radii[1] = 150;
    assertMatchesBrute(xs, ys, radii);
    assertClose(xs[1] - xs[0], 350, 1e-9);
  });

  test("a body far larger than the rest still finds the one it overlaps", () => {
    // The hub's reach spans far more cells than there are grid bodies, so it scans them all
    const n = 30, xs = new Float64Array(n), ys = new Float64Array(n), radii = new Float64Array(n).fill(1);
    for (let i = 2; i < n; i++) { xs[i] = 6000 + i * 300; ys[i] = (i % 3) * 300; }
    radii[0] = 5000;
    xs[1] = 4500; ys[1] = 1000;
    assertMatchesBrute(xs, ys, radii);
    assertClose(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]), 5001, 1e-9);
  });

  test("repeated passes clear the overlaps of a sparse layout", () => {
    const { xs, ys } = scatter(2000, 4000);
    const radii = new Float64Array(2000).fill(10);
    const before = overlapDepth(xs, ys, radii);
    const grid = new CollisionGrid();
    for (let pass = 0; pass < 30; pass++) grid.collide(xs, ys, radii, none(2000));
    assert.ok(before > 100, "the layout should start out overlapping");
    assert.ok(overlapDepth(xs, ys, radii) < 1);
  });

  test("repeated passes clear the overlaps of a layout with mixed radii", () => {
    // Push order differs from brute force, so single passes aren't compared
    const { xs, ys } = scatter(800, 2000, 9);
    const r = rng(4), radii = Float64Array.from({ length: 800 }, (_, i) => (i % 50 === 0 ? 80 : 5 + r() * 15));
    const before = overlapDepth(xs, ys, radii);
    const grid = new CollisionGrid();
    for (let pass = 0; pass < 30; pass++) grid.collide(xs, ys, radii, none(800));
    assert.ok(before > 1000, "the layout should start out overlapping");
    assert.ok(overlapDepth(xs, ys, radii) < 1);
  });

  test("fixed bodies stay put over repeated passes in a crowded layout", () => {
    const { xs, ys } = scatter(500, 800);
    const startX = xs.slice(), startY = ys.slice();
    const radii = new Float64Array(500).fill(10), fixed = new Uint8Array(500);
    for (let i = 0; i < 500; i += 5) fixed[i] = 1;
    radii[3] = 120;   // a large body as well

    const grid = new CollisionGrid();
    for (let pass = 0; pass < 10; pass++) grid.collide(xs, ys, radii, fixed);
    for (let i = 0; i < 500; i += 5) {
      assert.equal(xs[i], startX[i]);
      assert.equal(ys[i], startY[i]);
    }
  });
});

describe("CollisionGrid: binning", () => {
  for (const [name, radii] of [
    ["equal radii", new Float64Array(300).fill(8)],
    ["mixed radii", Float64Array.from({ length: 300 }, (_, i) => (i % 25 === 0 ? 200 : 1 + (i % 9)))],
  ]) for (const [mode, dense] of MODES) {
    test(`every grid body is listed once, in its cell's bucket (${name}, ${mode})`, () => {
      const { xs, ys } = scatter(300, dense ? 300 : 3000, 2);
      const grid = new CollisionGrid();
      grid.collide(xs.slice(), ys.slice(), radii, none(300));

      // Re-bin the same positions, then inspect the arrays
      const limit = grid._cellSize / 2;
      const largeCount = grid._bin(xs, ys, radii, limit, 1 / grid._cellSize);
      assert.equal(grid._dense, dense);
      const start = grid._bucketStart, order = grid._order;
      const gridBodies = [], large = [...grid._large.subarray(0, largeCount)];
      for (let b = 0; b < grid._bucketCount; b++) {
        for (let k = start[b]; k < start[b + 1]; k++) {
          const j = order[k];
          assert.equal(grid._bucket[j], b, `body ${j} filed under the wrong bucket`);
          assert.equal(grid._cellX[j], Math.floor(xs[j] * (1 / grid._cellSize)));
          assert.equal(grid._cellY[j], Math.floor(ys[j] * (1 / grid._cellSize)));
          gridBodies.push(j);
        }
      }
      for (let i = 0; i < 300; i++) assert.equal(radii[i] > limit, large.includes(i), `body ${i}`);
      assert.deepEqual([...gridBodies, ...large].sort((a, b) => a - b), [...Array(300).keys()]);
    });
  }

  test("cells are sized by the largest radius when radii are equal", () => {
    const grid = new CollisionGrid();
    const { xs, ys } = scatter(50);
    grid.collide(xs, ys, new Float64Array(50).fill(12), none(50));
    assert.equal(grid._cellSize, 24);
  });

  test("an outlier radius doesn't set the cell size", () => {
    const grid = new CollisionGrid();
    const { xs, ys } = scatter(100);
    const radii = new Float64Array(100).fill(10);
    radii[50] = 10000;
    grid.collide(xs, ys, radii, none(100));
    assert.ok(grid._cellSize < 1000, `cell size ${grid._cellSize}`);
  });
});

describe("CollisionGrid: reuse and input", () => {
  test("one grid can serve different body counts", () => {
    const grid = new CollisionGrid();
    const big = scatter(1000);
    grid.collide(big.xs, big.ys, new Float64Array(1000).fill(1), none(1000));
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    grid.collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [-5, 15]);
    const { xs: x2, ys: y2, radii } = isolatedPairs({ pairCount: 600 });
    const bx = x2.slice(), by = y2.slice();
    grid.collide(x2, y2, radii, none(1200));
    bruteCollide(bx, by, radii, none(1200));
    assertAllClose(x2, bx);
  });

  test("mismatched array lengths throw", () => {
    const grid = new CollisionGrid();
    const xs = new Float64Array(2), ys = new Float64Array(2);
    assert.throws(() => grid.collide(xs, ys, [1], [0, 0]), /mismatching/);
    assert.throws(() => grid.collide(xs, ys, [1, 1], [0]), /mismatching/);
    assert.throws(() => grid.collide(xs, new Float64Array(1), [1, 1], [0, 0]), /mismatching/);
  });

  test("a lone body stays put, and no bodies is a no-op", () => {
    const grid = new CollisionGrid();
    const xs = new Float64Array([5]), ys = new Float64Array([6]);
    grid.collide(xs, ys, [10], [0]);
    assertAllClose(xs, [5]);
    assertAllClose(ys, [6]);
    grid.collide(new Float64Array(), new Float64Array(), [], []);
  });
});
