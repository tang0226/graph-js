import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ImageCache, pickSpriteSize, MAX_SOURCE_SIDE } from "../src/image-cache.js";
import { installImage, installOffscreenCanvas, flush } from "./helpers/stubs.js";

describe("ImageCache", () => {
  test("load requests a source once, with the given request options", async () => {
    const restore = installImage({ fail: src => src === "bad.png" });
    try {
      const cache = new ImageCache();
      assert.equal(cache.load("a.png", "use-credentials", "origin"), true);
      assert.equal(cache.load("a.png", null, "no-referrer"), false, "already cached");
      assert.deepEqual(restore.requests, [{ src: "a.png", crossOrigin: "use-credentials", referrerPolicy: "origin" }]);
      assert.deepEqual(cache.images.get("a.png"), { status: "loading", image: null });
      assert.ok(Object.isFrozen(cache.images.get("a.png")), "entries are replaced, not changed");
      assert.equal(cache.loaded("a.png"), null, "not loaded yet");

      cache.load("bad.png", null, "no-referrer");
      await flush();
      assert.equal(typeof cache.loaded("a.png"), "object");
      assert.deepEqual(cache.images.get("bad.png"), { status: "failed", image: null });
      assert.equal(cache.images.get("a.png")?.status, "loaded");
      assert.equal(cache.loaded("bad.png"), null);
      assert.equal(cache.loaded("unknown.png"), null);
    } finally { restore(); }
  });

  test("load requests a failed source again only with retry, until it loads", async () => {
    let fails = 2;
    const restore = installImage({ fail: () => fails-- > 0 });
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      await flush();
      assert.equal(cache.images.get("a.png")?.status, "failed");

      assert.equal(cache.load("a.png", null, "no-referrer"), false, "not retried by default");
      assert.equal(restore.requests.length, 1);

      assert.equal(cache.load("a.png", null, "no-referrer", true), true, "a failed source is retried");
      assert.deepEqual(cache.images.get("a.png"), { status: "loading", image: null });
      assert.equal(cache.load("a.png", null, "no-referrer", true), false, "a loading source isn't retried");
      await flush();
      assert.equal(cache.images.get("a.png")?.status, "failed", "a retry can fail again");

      assert.equal(cache.load("a.png", "anonymous", "origin", true), true);
      await flush();
      assert.equal(cache.images.get("a.png")?.status, "loaded");
      assert.ok(cache.loaded("a.png"));
      assert.deepEqual(restore.requests.at(-1), { src: "a.png", crossOrigin: "anonymous", referrerPolicy: "origin" },
        "a retry uses the options it is given");

      assert.equal(cache.load("a.png", null, "no-referrer", true), false, "a loaded source isn't requested again");
      assert.equal(restore.requests.length, 3);
    } finally { restore(); }
  });

  test("onSettle is called once per settled request, after the entry is updated", async () => {
    const restore = installImage({ fail: src => src === "bad.png" });
    try {
      const calls = [];
      const cache = new ImageCache((src, entry) => {
        calls.push({ src, entry, current: cache.images.get(src) });
      });
      cache.load("a.png", null, "no-referrer");
      cache.load("bad.png", null, "no-referrer");
      assert.deepEqual(calls, [], "not before the request settles");
      await flush();
      // A load settles after decoding, so not necessarily in request order
      assert.deepEqual(calls.map(c => [c.src, c.entry.status]).sort(), [["a.png", "loaded"], ["bad.png", "failed"]]);
      for (const c of calls) assert.equal(c.current, c.entry, "the entry is in `images` when called");
      assert.equal(calls.find(c => c.src === "a.png").entry.image, cache.loaded("a.png"));

      cache.load("bad.png", null, "no-referrer", true);
      await flush();
      assert.equal(calls.length, 3, "a retry settles again");
    } finally { restore(); }
  });

  test("onSettle isn't called for a source collected before it settled", async () => {
    const restore = installImage();
    try {
      const calls = [];
      const cache = new ImageCache(src => calls.push(src));
      cache.load("a.png", null, "no-referrer");
      cache.load("b.png", null, "no-referrer");
      cache.collect(new Set(["b.png"]));
      await flush();
      assert.deepEqual(calls, ["b.png"]);
      assert.equal(cache.images.has("a.png"), false);
    } finally { restore(); }
  });

  test("collect deletes images whose source isn't live", async () => {
    const restore = installImage();
    try {
      const cache = new ImageCache();
      for (const src of ["a.png", "b.png", "c.png"]) cache.load(src, null, "no-referrer");
      await flush();
      cache.collect(new Set(["b.png"]));
      assert.deepEqual([...cache.images.keys()], ["b.png"]);
    } finally { restore(); }
  });

  test("a loaded image is decoded, then kept as an ImageBitmap", async () => {
    const restore = installImage({ size: 64 });
    try {
      const decoded = [];
      const decode = globalThis.Image.prototype.decode;
      globalThis.Image.prototype.decode = function () {
        decoded.push(this._src);
        return decode.call(this);
      };
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      await flush();
      assert.deepEqual(decoded, ["a.png"]);
      const [bitmap] = restore.sources;
      assert.equal(cache.loaded("a.png"), bitmap);
      assert.equal(bitmap.image.src, "a.png", "a snapshot of the loaded element");
      assert.deepEqual(bitmap.crop, [0, 0, 64, 64]);
      assert.equal(bitmap.opts, undefined, "a source within the cap isn't resized");
    } finally { restore(); }
  });

  test("a bitmap is centre-cropped to a square and capped in size", async () => {
    const restore = installImage({ width: 3000, height: 4001 });
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      await flush();
      const [bitmap] = restore.sources;
      assert.deepEqual(bitmap.crop, [0, 500, 3000, 3000]);
      assert.deepEqual(bitmap.opts, { resizeWidth: MAX_SOURCE_SIDE, resizeHeight: MAX_SOURCE_SIDE, resizeQuality: "high" });
      assert.equal(cache.loaded("a.png")?.width, 2048);
    } finally { restore(); }
  });

  test("the element is kept where a bitmap can't be made", async () => {
    for (const opts of [{ bitmap: false }, { bitmapFails: () => true }]) {
      const restore = installImage(opts);
      try {
        const cache = new ImageCache();
        cache.load("a.png", null, "no-referrer");
        await flush();
        assert.equal(cache.images.get("a.png")?.status, "loaded");
        assert.ok(cache.loaded("a.png") instanceof globalThis.Image, JSON.stringify(Object.keys(opts)));
      } finally { restore(); }
    }
  });

  test("an image that loads but fails to decode() still loads", async () => {
    const restore = installImage({ decodeFails: () => true });
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      await flush();
      assert.equal(cache.loaded("a.png"), restore.sources[0], "drawing decodes it instead");
    } finally { restore(); }
  });

  test("collecting an image closes its bitmap, even one that settles later", async () => {
    const restore = installImage();
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      await flush();
      cache.load("b.png", null, "no-referrer");
      cache.collect(new Set());                        // a.png loaded, b.png loading
      await flush();
      assert.deepEqual(restore.sources.map(b => [b.image.src, b.closed]), [["a.png", true], ["b.png", true]]);
      assert.equal(cache.images.size, 0);
    } finally { restore(); }
  });

  test("a frame builds at most 16 sprites, and endFrame evicts to the budget", async () => {
    const restoreImage = installImage({ size: 64 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = new ImageCache();
      const srcs = Array.from({ length: 20 }, (_, i) => `n${i}.png`);
      for (const src of srcs) cache.load(src, null, "no-referrer");
      await flush();

      cache.beginFrame();
      const built = srcs.map(src => cache.sprite(src, /** @type {any} */ (cache.loaded(src)), 32));
      assert.equal(built.filter(Boolean).length, 16, "the rest wait for a later frame");
      cache.endFrame(Infinity);

      cache.beginFrame();
      for (const src of srcs.slice(16)) assert.ok(cache.sprite(src, /** @type {any} */ (cache.loaded(src)), 32));
      cache.endFrame(0);
      assert.equal(cache._spriteLru.size, 4, "sprites drawn this frame survive even a zero budget");

      cache.beginFrame();
      cache.endFrame(0);
      assert.equal(cache._spriteBytes, 0, "next frame, unused sprites are evicted");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("pickSpriteSize picks the smallest size covering the need, capped by the source", () => {
    assert.equal(pickSpriteSize(20, 1000), 32);
    assert.equal(pickSpriteSize(64, 1000), 64);
    assert.equal(pickSpriteSize(2000, 1000), 512, "never larger than the source");
    assert.equal(pickSpriteSize(5, 10), 10, "a source smaller than the smallest size is used as is");
  });
});
