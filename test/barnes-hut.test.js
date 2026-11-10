import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BarnesHutContext } from "../src/barnes-hut.js";
import {
  rng, scatter, bruteCollide, overlapDepth, assertClose, assertAllClose,
} from "./helpers/bodies.js";

const STRENGTH = 1000, MIN_DIST_SQ = 1;
const CELL_ARRAYS = [
  "_centerX", "_centerY", "_halfSize", "_centroidX", "_centroidY", "_centroidCharge",
  "_bodyCount", "_childIndex", "_bodyIndex", "_maxRadius",
];

const ones = n => new Float64Array(n).fill(1);

// Uneven charges from 0 to 3, with every fifth body uncharged
function charges(n, seed = 2) {
  const r = rng(seed), cs = new Float64Array(n);
  for (let i = 0; i < n; i++) cs[i] = i % 5 === 0 ? 0 : r() * 3;
  return cs;
}

function repelForces(ctx, xs, ys, { cs = ones(xs.length), ...params } = {}) {
  const fx = new Float64Array(xs.length), fy = new Float64Array(xs.length);
  ctx.repel(xs, ys, cs, fx, fy, { strength: STRENGTH, minDistSq: MIN_DIST_SQ, ...params });
  return { fx, fy };
}

function bruteRepel(xs, ys, { cs = ones(xs.length), strength = STRENGTH, minDistSq = MIN_DIST_SQ } = {}) {
  const n = xs.length, fx = new Float64Array(n), fy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
      const dSq = Math.max(dx * dx + dy * dy, minDistSq);
      const s = cs[i] * cs[j] * strength / (dSq * Math.sqrt(dSq));
      fx[i] += s * dx; fy[i] += s * dy;
    }
  }
  return { fx, fy };
}

// Bodies stored in a cell's own bucket
function bucket(ctx, c) {
  const bodies = [];
  for (let b = ctx._bodyIndex[c]; b !== -1; b = ctx._nextBody[b]) bodies.push(b);
  return bodies;
}

// Bodies anywhere below a cell
function bodiesUnder(ctx, c) {
  const k = ctx._childIndex[c];
  if (k === -1) return bucket(ctx, c);
  return [k, k + 1, k + 2, k + 3].flatMap(q => bodiesUnder(ctx, q));
}

describe("BarnesHutContext: options", () => {
  test("defaults apply when no options are given", () => {
    const ctx = new BarnesHutContext();
    assert.equal(ctx.capacity, 1024);
    assert.equal(ctx.maxDepth, 20);
    assert.equal(ctx.theta, 0.9);
  });

  test("constructor options override the defaults", () => {
    const ctx = new BarnesHutContext({ capacity: 8, maxDepth: 5, theta: 0.4 });
    assert.equal(ctx.capacity, 8);
    assert.equal(ctx.maxDepth, 5);
    assert.equal(ctx.theta, 0.4);
  });

  test("setOpts clamps negatives to zero and leaves omitted options alone", () => {
    const ctx = new BarnesHutContext({ theta: 0.4 });
    ctx.setOpts({ capacity: -5, maxDepth: -1 });
    assert.equal(ctx.capacity, 0);
    assert.equal(ctx.maxDepth, 0);
    assert.equal(ctx.theta, 0.4);
    ctx.setOpts({ theta: -1 });
    assert.equal(ctx.theta, 0);
  });

  test("every cell array is allocated to capacity", () => {
    const ctx = new BarnesHutContext({ capacity: 16 });
    for (const name of CELL_ARRAYS) assert.equal(ctx[name].length, 16, name);
  });

  test("changing capacity discards the existing tree", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(10);
    ctx._build(xs, ys);
    ctx.setOpts({ capacity: 64 });
    assert.equal(ctx._cellCount, 0);
    for (const name of CELL_ARRAYS) assert.equal(ctx[name].length, 64, name);
  });
});

describe("BarnesHutContext: tree", () => {
  test("mismatched coordinate lengths throw", () => {
    assert.throws(() => new BarnesHutContext()._build([1, 2], [1]), /mismatching/);
  });

  test("a mismatched charge length throws", () => {
    assert.throws(() => new BarnesHutContext()._build([1, 2], [1, 2], [1]), /mismatching/);
  });

  test("an empty build leaves no cells, even after a previous tree", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(10);
    ctx._build(xs, ys);
    assert.ok(ctx._cellCount > 0);
    ctx._build([], []);
    assert.equal(ctx._cellCount, 0);
  });

  test("a single body gets a root with a non-zero size", () => {
    const ctx = new BarnesHutContext();
    ctx._build([5], [7]);
    assert.equal(ctx._cellCount, 1);
    assert.equal(ctx._halfSize[0], 0.5);
    assert.equal(ctx._bodyCount[0], 1);
    assert.equal(ctx._centroidX[0], 5);
    assert.equal(ctx._centroidY[0], 7);
  });

  test("the root covers every body", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(300);
    ctx._build(xs, ys);
    for (let i = 0; i < xs.length; i++) {
      assert.ok(Math.abs(xs[i] - ctx._centerX[0]) <= ctx._halfSize[0] + 1e-9);
      assert.ok(Math.abs(ys[i] - ctx._centerY[0]) <= ctx._halfSize[0] + 1e-9);
    }
  });

  function assertLeavesHoldTheirBodies(ctx, xs, ys) {
    const seen = new Array(xs.length).fill(0);
    for (let c = 0; c < ctx._cellCount; c++) {
      const bodies = bucket(ctx, c);
      if (ctx._childIndex[c] !== -1) { assert.equal(bodies.length, 0, "buckets belong to leaves"); continue; }
      assert.equal(bodies.length, ctx._bodyCount[c]);
      for (const b of bodies) {
        seen[b]++;
        assert.ok(Math.abs(xs[b] - ctx._centerX[c]) <= ctx._halfSize[c] + 1e-9);
        assert.ok(Math.abs(ys[b] - ctx._centerY[c]) <= ctx._halfSize[c] + 1e-9);
      }
    }
    assert.ok(seen.every(count => count === 1));
  }

  test("every body lands in exactly one leaf, inside that leaf's square", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(500);
    ctx._build(xs, ys);
    assertLeavesHoldTheirBodies(ctx, xs, ys);
  });

  // Splitting a leaf moves its body by position, which its weighted sums
  // don't give back unless its charge is 1
  test("bodies land in the right leaves whatever their charge", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(500);
    ctx._build(xs, ys, charges(500));
    assertLeavesHoldTheirBodies(ctx, xs, ys);
  });

  test("each cell's count and centroid describe the bodies beneath it", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(500);
    ctx._build(xs, ys);
    for (let c = 0; c < ctx._cellCount; c++) {
      const bodies = bodiesUnder(ctx, c);
      assert.equal(ctx._bodyCount[c], bodies.length);
      if (bodies.length === 0) continue;
      assert.equal(ctx._centroidCharge[c], bodies.length, "a default charge of 1 each");
      assertClose(ctx._centroidX[c], bodies.reduce((s, b) => s + xs[b], 0) / bodies.length);
      assertClose(ctx._centroidY[c], bodies.reduce((s, b) => s + ys[b], 0) / bodies.length);
    }
  });

  test("each cell holds its total charge and charge-weighted centroid", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(500);
    const cs = charges(500);
    ctx._build(xs, ys, cs);
    for (let c = 0; c < ctx._cellCount; c++) {
      const bodies = bodiesUnder(ctx, c);
      const q = bodies.reduce((s, b) => s + cs[b], 0);
      assertClose(ctx._centroidCharge[c], q);
      if (q === 0) continue;
      assertClose(ctx._centroidX[c], bodies.reduce((s, b) => s + cs[b] * xs[b], 0) / q);
      assertClose(ctx._centroidY[c], bodies.reduce((s, b) => s + cs[b] * ys[b], 0) / q);
    }
  });

  test("a cell with no charge puts its centroid at its center", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(50);
    ctx._build(xs, ys, new Float64Array(50));
    for (let c = 0; c < ctx._cellCount; c++) {
      assert.equal(ctx._centroidCharge[c], 0);
      assert.equal(ctx._centroidX[c], ctx._centerX[c]);
      assert.equal(ctx._centroidY[c], ctx._centerY[c]);
    }
  });

  test("children are allocated together after their parent", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(200);
    ctx._build(xs, ys);
    for (let c = 0; c < ctx._cellCount; c++) {
      const k = ctx._childIndex[c];
      if (k === -1) continue;
      assert.ok(k > c, "the bottom-up pass relies on this order");
      assert.ok(k + 3 < ctx._cellCount);
      for (let q = k; q < k + 4; q++) assert.equal(ctx._halfSize[q], ctx._halfSize[c] / 2);
    }
  });

  test("coincident bodies stop splitting at maxDepth and share a bucket", () => {
    const ctx = new BarnesHutContext({ maxDepth: 4 });
    ctx._build(new Float64Array(5).fill(3), new Float64Array(5).fill(3));
    assert.equal(ctx._cellCount, 17, "the root plus 4 cells for each of 4 splits");
    const buckets = [];
    for (let c = 0; c < ctx._cellCount; c++) if (bucket(ctx, c).length) buckets.push(bucket(ctx, c));
    assert.deepEqual(buckets.map(b => b.length), [5]);
  });

  test("maxDepth 0 keeps every body in the root", () => {
    const ctx = new BarnesHutContext({ maxDepth: 0 });
    const { xs, ys } = scatter(20);
    ctx._build(xs, ys);
    assert.equal(ctx._cellCount, 1);
    assert.equal(bucket(ctx, 0).length, 20);
  });

  for (const capacity of [0, 1]) {
    test(`the cell pool grows from a capacity of ${capacity}`, () => {
      const ctx = new BarnesHutContext({ capacity });
      const { xs, ys } = scatter(500);
      ctx._build(xs, ys);
      assert.ok(ctx.capacity >= ctx._cellCount);
      for (const name of CELL_ARRAYS) assert.equal(ctx[name].length, ctx.capacity, name);
      assert.equal(ctx._bodyCount[0], 500);
    });
  }

  test("a rebuild reads new positions from new arrays of the same length", () => {
    const ctx = new BarnesHutContext();
    ctx._build(new Float64Array([0, 10]), new Float64Array([0, 10]));
    ctx._build(new Float64Array([100, 110]), new Float64Array([200, 210]));
    assert.equal(ctx._centroidX[0], 105);
    assert.equal(ctx._centroidY[0], 205);
  });

  test("a rebuild handles a smaller and then a larger body count", () => {
    const ctx = new BarnesHutContext();
    for (const n of [100, 3, 250]) {
      const { xs, ys } = scatter(n);
      ctx._build(xs, ys);
      assert.equal(ctx._bodyCount[0], n);
      assert.equal(bodiesUnder(ctx, 0).length, n);
    }
  });
});

describe("BarnesHutContext: repel", () => {
  for (const n of [2, 3, 4, 5, 500]) {
    test(`theta 0 matches brute force for ${n} bodies`, () => {
      const { xs, ys } = scatter(n);
      const { fx, fy } = repelForces(new BarnesHutContext({ theta: 0 }), xs, ys);
      const brute = bruteRepel(xs, ys);
      assertAllClose(fx, brute.fx);
      assertAllClose(fy, brute.fy);
    });
  }

  for (const n of [2, 5, 500]) {
    test(`theta 0 matches brute force for ${n} bodies with uneven charges`, () => {
      const { xs, ys } = scatter(n);
      const cs = charges(n);
      const { fx, fy } = repelForces(new BarnesHutContext({ theta: 0 }), xs, ys, { cs });
      const brute = bruteRepel(xs, ys, { cs });
      assertAllClose(fx, brute.fx);
      assertAllClose(fy, brute.fy);
    });
  }

  test("a deep tree over few bodies fits the cell stack", () => {
    const xs = new Float64Array([0, 1e-3, 1000]), ys = new Float64Array([0, 1e-3, 1000]);
    const ctx = new BarnesHutContext({ theta: 0 });
    const { fx, fy } = repelForces(ctx, xs, ys);
    assert.ok(ctx._cellCount > 4 * 10, "the two close bodies should force many splits");
    const brute = bruteRepel(xs, ys);
    assertAllClose(fx, brute.fx);
    assertAllClose(fy, brute.fy);
  });

  test("the cell stack follows a maxDepth change between builds", () => {
    const xs = new Float64Array([0, 1e-6, 1000]), ys = new Float64Array([0, 1e-6, 1000]);
    const ctx = new BarnesHutContext({ theta: 0, maxDepth: 2 });
    repelForces(ctx, xs, ys);
    ctx.setOpts({ maxDepth: 30 });
    const { fx } = repelForces(ctx, xs, ys);
    assertAllClose(fx, bruteRepel(xs, ys).fx);
  });

  test("maxDepth 0 falls back to exact forces from the root bucket", () => {
    const { xs, ys } = scatter(50);
    const { fx } = repelForces(new BarnesHutContext({ maxDepth: 0 }), xs, ys);
    assertAllClose(fx, bruteRepel(xs, ys).fx);
  });

  test("a distant group acts as one body at its centroid, weighted by count", () => {
    const xs = new Float64Array([0, 1, 0, 1, 1000]), ys = new Float64Array([0, 0, 1, 1, 1000]);
    const { fx, fy } = repelForces(new BarnesHutContext({ theta: 0.5 }), xs, ys);

    const dx = 1000 - 0.5, dSq = 2 * dx * dx;
    const expected = STRENGTH * 4 * dx / (dSq * Math.sqrt(dSq));
    assertClose(fx[4], expected, 1e-15);
    assertClose(fy[4], expected, 1e-15);
    assert.notEqual(fx[4], bruteRepel(xs, ys).fx[4], "this should be the approximation, not the exact sum");
  });

  test("a distant group acts as one body at its charge-weighted centroid, with its total charge", () => {
    const xs = new Float64Array([0, 1, 0, 1, 1000]), ys = new Float64Array([0, 0, 1, 1, 1000]);
    const cs = new Float64Array([1, 1, 1, 5, 2]);
    const { fx, fy } = repelForces(new BarnesHutContext({ theta: 0.5 }), xs, ys, { cs });

    // Centroid (6 / 8, 6 / 8), total charge 8, acting on a body of charge 2
    const dx = 1000 - 0.75, dSq = 2 * dx * dx;
    const expected = 2 * 8 * STRENGTH * dx / (dSq * Math.sqrt(dSq));
    assertClose(fx[4], expected, 1e-15);
    assertClose(fy[4], expected, 1e-15);
  });

  test("an uncharged body neither pushes nor is pushed", () => {
    const { xs, ys } = scatter(200);
    const cs = ones(200);
    cs[7] = 0;
    const ctx = new BarnesHutContext({ theta: 0.9 });
    const { fx, fy } = repelForces(ctx, xs, ys, { cs });
    assert.equal(fx[7], 0);
    assert.equal(fy[7], 0);

    // Removing it outright gives everyone else the same forces
    const keep = [...xs.keys()].filter(i => i !== 7);
    const without = repelForces(ctx, Float64Array.from(keep, i => xs[i]), Float64Array.from(keep, i => ys[i]));
    assertAllClose(keep.map(i => fx[i]), without.fx);
    assertAllClose(keep.map(i => fy[i]), without.fy);
  });

  test("a body is never repelled by a cell containing it, at any theta", () => {
    const xs = new Float64Array([0, 100, 40]), ys = new Float64Array([0, 100, 70]);
    const { fx, fy } = repelForces(new BarnesHutContext({ theta: 1000 }), xs, ys);
    const brute = bruteRepel(xs, ys);
    assertAllClose(fx, brute.fx);
    assertAllClose(fy, brute.fy);
  });

  test("error stays small and shrinks with theta", () => {
    const { xs, ys } = scatter(2000, 2000);
    const brute = bruteRepel(xs, ys);
    const meanError = theta => {
      const { fx, fy } = repelForces(new BarnesHutContext({ theta }), xs, ys);
      let error = 0, total = 0;
      for (let i = 0; i < xs.length; i++) {
        error += Math.hypot(fx[i] - brute.fx[i], fy[i] - brute.fy[i]);
        total += Math.hypot(brute.fx[i], brute.fy[i]);
      }
      return error / total;
    };
    const coarse = meanError(0.9), fine = meanError(0.5);
    assert.ok(coarse < 0.03, `theta 0.9 mean error was ${coarse}`);
    assert.ok(fine < coarse);
  });

  test("forces are added to the output arrays rather than replacing them", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    const fx = new Float64Array([5, 5]), fy = new Float64Array([-2, -2]);
    new BarnesHutContext().repel(xs, ys, ones(2), fx, fy, { strength: STRENGTH, minDistSq: MIN_DIST_SQ });
    const brute = bruteRepel(xs, ys);
    assertAllClose(fx, [5 + brute.fx[0], 5 + brute.fx[1]]);
    assertAllClose(fy, [-2, -2]);
  });

  test("distances are clamped to minDistSq", () => {
    const xs = new Float64Array([0, 3]), ys = new Float64Array([0, 0]);
    const { fx } = repelForces(new BarnesHutContext(), xs, ys, { minDistSq: 100 });
    assertAllClose(fx, [-3, 3]);   // 1000 / 100^1.5 = 1, along a separation of 3
  });

  test("coincident bodies get finite, non-zero forces", () => {
    const xs = new Float64Array(3).fill(4), ys = new Float64Array(3).fill(4);
    const { fx, fy } = repelForces(new BarnesHutContext(), xs, ys);
    for (let i = 0; i < 3; i++) {
      assert.ok(Number.isFinite(fx[i]) && Number.isFinite(fy[i]));
      assert.ok(fx[i] !== 0 || fy[i] !== 0);
    }
  });

  test("a lone body feels nothing, and no bodies is a no-op", () => {
    assertAllClose(repelForces(new BarnesHutContext(), [5], [5]).fx, [0]);
    assert.equal(repelForces(new BarnesHutContext(), [], []).fx.length, 0);
  });
});

describe("BarnesHutContext: collide", () => {
  const none = n => new Uint8Array(n);

  test("an overlapping pair is pushed apart until it just touches", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new BarnesHutContext().collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [-5, 15]);
    assertAllClose(ys, [0, 0]);
  });

  test("the push follows the line between the two bodies", () => {
    const xs = new Float64Array([0, 3]), ys = new Float64Array([0, 4]);
    new BarnesHutContext().collide(xs, ys, [5, 5], none(2));
    assertClose(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]), 10);
    assertClose((ys[1] - ys[0]) / (xs[1] - xs[0]), 4 / 3);
  });

  test("bodies that only touch are left alone", () => {
    const xs = new Float64Array([0, 20]), ys = new Float64Array([0, 0]);
    new BarnesHutContext().collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [0, 20]);
  });

  test("zero-radius bodies never collide, even when coincident", () => {
    const xs = new Float64Array([4, 4]), ys = new Float64Array([4, 4]);
    new BarnesHutContext().collide(xs, ys, [0, 0], none(2));
    assertAllClose(xs, [4, 4]);
  });

  for (const [name, i, j] of [["first", 0, 1], ["second", 1, 0]]) {
    test(`a fixed ${name} body holds still while the other takes the whole push`, () => {
      const xs = new Float64Array(2), ys = new Float64Array(2), fixed = new Uint8Array(2);
      xs[j] = 10; fixed[i] = 1;
      new BarnesHutContext().collide(xs, ys, [10, 10], fixed);
      assert.equal(xs[i], 0);
      assertClose(xs[j], 20);
    });
  }

  test("two fixed bodies are left overlapping", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new BarnesHutContext().collide(xs, ys, [10, 10], new Uint8Array([1, 1]));
    assertAllClose(xs, [0, 10]);
  });

  test("boolean and numeric fixed arrays behave the same", () => {
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    new BarnesHutContext().collide(xs, ys, [10, 10], [true, false]);
    assertAllClose(xs, [0, 20]);
  });

  test("coincident bodies separate along a random axis", () => {
    const xs = new Float64Array(2).fill(7), ys = new Float64Array(2).fill(7);
    new BarnesHutContext().collide(xs, ys, [10, 10], none(2));
    assert.ok([...xs, ...ys].every(Number.isFinite));
    assert.ok(Math.hypot(xs[0] - xs[1], ys[0] - ys[1]) > 1);
  });

  test("every isolated overlap is found, whatever the radii and body order", () => {
    // Pairs are far enough apart that push order can't matter, so the result
    // has to match brute force exactly. Any pair the tree wrongly skips shows up.
    const r = rng(7), pairCount = 150, n = pairCount * 2;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const xs = new Float64Array(n), ys = new Float64Array(n), radii = new Float64Array(n);
    for (let p = 0; p < pairCount; p++) {
      const a = order[2 * p], b = order[2 * p + 1];
      const big = 3 + r() * (p % 7 === 0 ? 150 : 20), small = 1 + r() * 5;
      const angle = r() * 2 * Math.PI, gap = (big + small) * (0.2 + 0.7 * r());
      xs[a] = (p % 15) * 500; ys[a] = Math.floor(p / 15) * 500;
      xs[b] = xs[a] + Math.cos(angle) * gap; ys[b] = ys[a] + Math.sin(angle) * gap;
      radii[a] = big; radii[b] = small;
    }

    const treeX = xs.slice(), treeY = ys.slice();
    new BarnesHutContext().collide(treeX, treeY, radii, none(n));
    bruteCollide(xs, ys, radii, none(n));
    assertAllClose(treeX, xs);
    assertAllClose(treeY, ys);
  });

  for (const [name, hub, tiny] of [["lower", 0, 1], ["higher", 1, 0]]) {
    test(`a large body with the ${name} index reaches a small one in a far cell`, () => {
      const { xs, ys } = scatter(40, 1000, 3);
      const radii = new Float64Array(40).fill(1);
      for (let i = 0; i < 40; i++) { xs[i] += 1000; ys[i] += 1000; }
      xs[hub] = 0; ys[hub] = 0; radii[hub] = 300;
      xs[tiny] = 250; ys[tiny] = 0;

      new BarnesHutContext().collide(xs, ys, radii, none(40));
      assertClose(Math.hypot(xs[hub] - xs[tiny], ys[hub] - ys[tiny]), 301, 1e-9);
    });
  }

  test("repeated passes clear the overlaps of a sparse layout", () => {
    const { xs, ys } = scatter(2000, 4000);
    const radii = new Float64Array(2000).fill(10);
    const before = overlapDepth(xs, ys, radii);
    const ctx = new BarnesHutContext();
    for (let pass = 0; pass < 30; pass++) ctx.collide(xs, ys, radii, none(2000));
    assert.ok(before > 100, "the layout should start out overlapping");
    assert.ok(overlapDepth(xs, ys, radii) < 1);
  });

  test("fixed bodies stay put over repeated passes in a crowded layout", () => {
    const { xs, ys } = scatter(500, 800);
    const startX = xs.slice(), startY = ys.slice();
    const radii = new Float64Array(500).fill(10), fixed = new Uint8Array(500);
    for (let i = 0; i < 500; i += 5) fixed[i] = 1;

    const ctx = new BarnesHutContext();
    for (let pass = 0; pass < 10; pass++) ctx.collide(xs, ys, radii, fixed);
    for (let i = 0; i < 500; i += 5) {
      assert.equal(xs[i], startX[i]);
      assert.equal(ys[i], startY[i]);
    }
  });

  // A low maxDepth leaves several bodies in each leaf's bucket
  for (const maxDepth of [20, 2]) {
    test(`each cell's max radius covers the bodies beneath it at maxDepth ${maxDepth}`, () => {
      const { xs, ys } = scatter(300);
      const r = rng(5), radii = Float64Array.from({ length: 300 }, () => r() * 30);
      const ctx = new BarnesHutContext({ maxDepth });
      ctx._build(xs, ys);
      ctx._aggregateRadii(radii);
      for (let c = 0; c < ctx._cellCount; c++) {
        assert.equal(ctx._maxRadius[c], Math.max(0, ...bodiesUnder(ctx, c).map(b => radii[b])));
      }
    });
  }

  test("max radii are recomputed on each call", () => {
    const ctx = new BarnesHutContext();
    const { xs, ys } = scatter(30);
    ctx.collide(xs, ys, new Float64Array(30).fill(100), none(30));
    ctx.collide(xs, ys, new Float64Array(30).fill(0.001), none(30));
    assert.equal(ctx._maxRadius[0], 0.001);
  });

  test("works when the cell pool has to grow", () => {
    const { xs, ys } = scatter(300);
    const ctx = new BarnesHutContext({ capacity: 1 });
    ctx.collide(xs, ys, new Float64Array(300).fill(7), none(300));
    assert.equal(ctx._maxRadius[0], 7);
  });

  test("one context can serve different body counts", () => {
    const ctx = new BarnesHutContext();
    const big = scatter(100);
    ctx.collide(big.xs, big.ys, new Float64Array(100).fill(1), none(100));
    const xs = new Float64Array([0, 10]), ys = new Float64Array([0, 0]);
    ctx.collide(xs, ys, [10, 10], none(2));
    assertAllClose(xs, [-5, 15]);
  });

  test("mismatched radii or fixed lengths throw", () => {
    const ctx = new BarnesHutContext();
    const xs = new Float64Array(2), ys = new Float64Array(2);
    assert.throws(() => ctx.collide(xs, ys, [1], [0, 0]), /mismatching/);
    assert.throws(() => ctx.collide(xs, ys, [1, 1], [0]), /mismatching/);
  });

  test("a lone body stays put, and no bodies is a no-op", () => {
    const ctx = new BarnesHutContext();
    const xs = new Float64Array([5]), ys = new Float64Array([6]);
    ctx.collide(xs, ys, [10], [0]);
    assertAllClose(xs, [5]);
    assertAllClose(ys, [6]);
    ctx.collide(new Float64Array(), new Float64Array(), [], []);
  });
});
