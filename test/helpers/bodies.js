/* Helpers for tests that work on raw body arrays (Barnes-Hut and collision grid) */
import assert from "node:assert/strict";

// Seeded, so a failure reproduces
export function rng(seed = 1) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

export function scatter(n, size = 1000, seed = 1) {
  const r = rng(seed), xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = r() * size; ys[i] = r() * size; }
  return { xs, ys };
}

// Mirrors Simulation._enforceRadius, on arrays
export function bruteCollide(xs, ys, radii, fixed) {
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
      const dSq = dx * dx + dy * dy, minD = radii[i] + radii[j];
      if (dSq >= minD * minD) continue;
      const d = Math.sqrt(dSq), push = (minD - d) / d;
      const s1 = fixed[i] ? 0 : (fixed[j] ? 1 : 0.5);
      const s2 = fixed[j] ? 0 : (fixed[i] ? 1 : 0.5);
      xs[i] += dx * push * s1; ys[i] += dy * push * s1;
      xs[j] -= dx * push * s2; ys[j] -= dy * push * s2;
    }
  }
}

export function overlapDepth(xs, ys, radii) {
  let depth = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      depth += Math.max(radii[i] + radii[j] - Math.hypot(xs[i] - xs[j], ys[i] - ys[j]), 0);
    }
  }
  return depth;
}

export function assertClose(actual, expected, tol = 1e-9, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, msg ?? `${actual} is not within ${tol} of ${expected}`);
}

export function assertAllClose(actual, expected, tol = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assertClose(actual[i], expected[i], tol, `index ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}
