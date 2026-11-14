import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewPath } from "../src/view-path.js";
import { assertClose } from "./helpers/bodies.js";

const W = 800, H = 600;
const ps = Array.from({ length: 21 }, (_, i) => i / 20);

// The demo's flyTo(): zoom exponential in p, pan u = (1 - r^-p) / (1 - r^-1)
function demoView(a, b, p) {
  const k = Math.log(b.zoom / a.zoom);
  const u = Math.abs(k) < 1e-9 ? p : (1 - Math.exp(-k * p)) / (1 - Math.exp(-k));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, zoom: a.zoom * Math.exp(k * p) };
}

// Smallest zoom along a path: below both ends means it zoomed out on the way
const minZoom = path => Math.min(...Array.from({ length: 401 }, (_, i) => path(i / 400).zoom));

describe("viewPath", () => {
  test("progress 0 and 1 give the two views exactly", () => {
    const a = { x: 3, y: -7, zoom: 0.37 }, b = { x: 9123.5, y: 41.25, zoom: 5.1 };
    for (const zoomOut of [0, 1, 4]) {
      const path = viewPath(a, b, W, H, zoomOut);
      assert.deepEqual(path(0), a);
      assert.deepEqual(path(1), b);
    }
  });

  test("with zoomOut 0, it's the demo's path", () => {
    const pairs = [
      [{ x: 0, y: 0, zoom: 1 }, { x: 500, y: -200, zoom: 8 }],
      [{ x: 0, y: 0, zoom: 4 }, { x: -3000, y: 900, zoom: 0.05 }],
      [{ x: 10, y: 10, zoom: 2 }, { x: 4000, y: 10, zoom: 2 }],
    ];
    for (const [a, b] of pairs) {
      const path = viewPath(a, b, W, H, 0);
      for (const p of ps) {
        const got = path(p), want = demoView(a, b, p);
        assertClose(got.x, want.x, 1e-9 * Math.abs(b.x - a.x) + 1e-9);
        assertClose(got.y, want.y, 1e-9 * Math.abs(b.y - a.y) + 1e-9);
        assertClose(Math.log(got.zoom), Math.log(want.zoom), 1e-12);
      }
    }
  });

  for (const zoomOut of [0, 1, 3]) {
    test(`the pan keeps a steady speed on screen (zoomOut ${zoomOut})`, () => {
      // A long pan while zooming in 20x, which zooms out first when allowed
      const a = { x: 0, y: 0, zoom: 0.5 }, b = { x: 40000, y: 15000, zoom: 10 };
      const path = viewPath(a, b, W, H, zoomOut);
      const dist = Math.hypot(b.x - a.x, b.y - a.y), h = 1e-5;
      // On-screen speed: simulation units per unit of progress, times zoom
      const speeds = ps.slice(1, -1).map(p => {
        const d = Math.hypot(path(p + h).x - path(p - h).x, path(p + h).y - path(p - h).y);
        return d / (2 * h) * path(p).zoom / dist;
      });
      const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
      for (const s of speeds) assertClose(s / mean, 1, 2e-3);
    });
  }

  test("short pans don't zoom out", () => {
    const a = { x: 0, y: 0, zoom: 1 }, b = { x: W, y: 0, zoom: 1 };     // one view across
    const path = viewPath(a, b, W, H, 1);
    for (const p of ps) assert.equal(path(p).zoom, 1);
  });

  test("long pans zoom out, further the longer they are", () => {
    const at = views => minZoom(viewPath({ x: 0, y: 0, zoom: 1 }, { x: views * W, y: 0, zoom: 1 }, W, H, 1));
    const z5 = at(5), z10 = at(10), z50 = at(50);
    assert.ok(z5 < 1, `5 views: ${z5}`);
    assert.ok(z10 < z5 && z50 < z10, `${z5}, ${z10}, ${z50}`);
  });

  test("a higher zoomOut zooms out further, and 0 doesn't at all", () => {
    const a = { x: 0, y: 0, zoom: 1 }, b = { x: 10 * W, y: 0, zoom: 1 };
    const zs = [0, 0.5, 1, 2].map(k => minZoom(viewPath(a, b, W, H, k)));
    assert.equal(zs[0], 1);
    for (let i = 1; i < zs.length; i++) assert.ok(zs[i] < zs[i - 1], zs.join(", "));
  });

  test("zooming in on a far node zooms out first", () => {
    const a = { x: 0, y: 0, zoom: 1 }, b = { x: 5 * W, y: 0, zoom: 8 };
    assert.ok(minZoom(viewPath(a, b, W, H, 1)) < 1);
    assert.equal(minZoom(viewPath(a, b, W, H, 0)), 1);
  });

  test("distance counts views on each axis, whatever the canvas's shape", () => {
    const a = { x: 0, y: 0, zoom: 1 };
    const across = viewPath(a, { x: 10 * W, y: 0, zoom: 1 }, W, H, 1);
    const down = viewPath(a, { x: 0, y: 10 * H, zoom: 1 }, W, H, 1);
    for (const p of ps) assertClose(across(p).zoom, down(p).zoom, 1e-12);
  });

  test("with no pan, it zooms at a steady exponential rate and stays put", () => {
    const a = { x: 5, y: 6, zoom: 0.2 }, b = { x: 5, y: 6, zoom: 20 };
    const path = viewPath(a, b, W, H, 2);
    for (const p of ps) {
      const v = path(p);
      assert.equal(v.x, 5);
      assert.equal(v.y, 6);
      assertClose(Math.log(v.zoom), Math.log(0.2) + p * Math.log(100), 1e-12);
    }
  });

  test("progress past either end continues the path", () => {
    const a = { x: 0, y: 0, zoom: 1 }, b = { x: 2000, y: 0, zoom: 4 };
    for (const zoomOut of [0, 1]) {
      const path = viewPath(a, b, W, H, zoomOut);
      assert.ok(path(-0.1).x < 0, `back past the start (zoomOut ${zoomOut})`);
      assert.ok(path(1.1).x > 2000, `on past the end (zoomOut ${zoomOut})`);
    }
    // Without a bump, the zoom carries on at the same exponential rate
    const path = viewPath(a, b, W, H, 0);
    assertClose(Math.log(path(-0.1).zoom), -0.1 * Math.log(4), 1e-12);
    assertClose(Math.log(path(1.1).zoom), 1.1 * Math.log(4), 1e-12);
  });

  test("extreme zoom ratios and distances stay finite", () => {
    const a = { x: 0, y: 0, zoom: 1e-4 }, b = { x: 1e9, y: -1e9, zoom: 1e4 };
    for (const zoomOut of [0, 1, 10]) {
      const path = viewPath(a, b, W, H, zoomOut);
      for (const p of ps) {
        const v = path(p);
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0 && Number.isFinite(v.zoom), `p ${p}`);
      }
      assert.deepEqual(path(1), b);
    }
  });
});
