import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ImageCache, pickSpriteSize, MAX_SOURCE_SIDE } from "../src/image-cache.js";
import { installImage, installOffscreenCanvas, flush } from "./helpers/stubs.js";

describe("ImageCache", () => {
  test("load requests a source once per set of request options, and records them", async () => {
    const restore = installImage({ fail: src => src === "bad.png" });
    try {
      const cache = new ImageCache();
      assert.equal(cache.load("a.png", "use-credentials", "origin"), true);
      assert.equal(cache.load("a.png", "use-credentials", "origin"), false, "already cached with these options");
      assert.deepEqual(restore.requests, [{ src: "a.png", crossOrigin: "use-credentials", referrerPolicy: "origin" }]);
      assert.deepEqual(cache.images.get("a.png"),
        { status: "loading", image: null, crossOrigin: "use-credentials", referrerPolicy: "origin" });
      assert.ok(Object.isFrozen(cache.images.get("a.png")), "entries are replaced, not changed");
      assert.equal(cache.loaded("a.png"), null, "not loaded yet");

      cache.load("bad.png", null, "no-referrer");
      await flush();
      assert.equal(typeof cache.loaded("a.png"), "object");
      assert.deepEqual(cache.images.get("a.png"),
        { status: "loaded", image: cache.loaded("a.png"), crossOrigin: "use-credentials", referrerPolicy: "origin" });
      assert.deepEqual(cache.images.get("bad.png"),
        { status: "failed", image: null, crossOrigin: null, referrerPolicy: "no-referrer" });
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
      assert.equal(cache.images.get("a.png")?.status, "loading");
      assert.equal(cache.load("a.png", null, "no-referrer", true), false, "a loading source isn't retried");
      await flush();
      assert.equal(cache.images.get("a.png")?.status, "failed", "a retry can fail again");

      assert.equal(cache.load("a.png", null, "no-referrer", true), true);
      await flush();
      assert.equal(cache.images.get("a.png")?.status, "loaded");
      assert.ok(cache.loaded("a.png"));

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
      const built = srcs.map(src => cache.sprite(src, 32));
      assert.equal(built.filter(Boolean).length, 16, "the rest wait for a later frame");
      cache.endFrame(Infinity);

      cache.beginFrame();
      for (const src of srcs.slice(16)) assert.ok(cache.sprite(src, 32));
      cache.endFrame(0);
      assert.equal(cache._spriteLru.size, 4, "sprites drawn this frame survive even a zero budget");

      cache.beginFrame();
      cache.endFrame(0);
      assert.equal(cache._spriteBytes, 0, "next frame, unused sprites are evicted");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("scratch canvases are kept between frames, unless grown past half the source cap", async () => {
    const restoreCanvas = installOffscreenCanvas();
    try {
      // A bitmap, capped at MAX_SOURCE_SIDE: its scratches are reused by later frames
      let restoreImage = installImage({ size: 4000 });
      try {
        const cache = new ImageCache();
        for (const src of ["a.png", "b.png"]) cache.load(src, null, "no-referrer");
        await flush();
        cache.beginFrame();
        assert.ok(cache.sprite("a.png", 16));
        cache.endFrame(Infinity);
        const scratch = [...cache._imgScratch];
        assert.deepEqual(scratch.map(s => s?.width), [MAX_SOURCE_SIDE / 2, MAX_SOURCE_SIDE / 4]);
        const created = restoreCanvas.created.length;

        cache.beginFrame();
        assert.ok(cache.sprite("b.png", 16));
        cache.endFrame(Infinity);
        assert.equal(restoreCanvas.created.length, created, "a later frame's build allocates no canvas");
        assert.deepEqual(cache._imgScratch, scratch);
      } finally { restoreImage(); }

      // An uncapped element: the oversized scratch is dropped, the other kept
      restoreImage = installImage({ size: 4000, bitmap: false });
      try {
        const cache = new ImageCache();
        cache.load("a.png", null, "no-referrer");
        await flush();
        cache.beginFrame();
        assert.ok(cache.sprite("a.png", 16));
        assert.deepEqual(cache._imgScratch.map(s => s?.width), [2000, 1000]);
        cache.endFrame(Infinity);
        assert.deepEqual(cache._imgScratch.map(s => s?.width), [undefined, 1000]);
      } finally { restoreImage(); }
    } finally { restoreCanvas(); }
  });

  test("sprite and average return null for a source that hasn't loaded", async () => {
    const restoreImage = installImage({ size: 64, fail: src => src === "bad.png" });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      cache.load("bad.png", null, "no-referrer");
      cache.beginFrame();
      assert.equal(cache.sprite("a.png", 32), null, "still loading");
      assert.equal(cache.average("a.png"), null);
      await flush();
      assert.equal(cache.sprite("bad.png", 32), null, "failed");
      assert.equal(cache.average("unknown.png"), null, "never requested");
      assert.ok(cache.sprite("a.png", 32), "loaded");
      assert.equal(cache._spriteCache.has("bad.png"), false, "no entry is made for an unloaded source");
      cache.endFrame(Infinity);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("load with other options requests a source again, replacing what it had", async () => {
    const restoreImage = installImage({ size: 64, fail: src => src === "bad.png" });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const calls = [];
      const cache = new ImageCache(src => calls.push(src));
      for (const src of ["a.png", "b.png", "bad.png"]) cache.load(src, null, "no-referrer");
      await flush();
      cache.load("slow.png", null, "no-referrer");     // still in flight when replaced
      cache.beginFrame();
      cache.sprite("a.png", 32);
      cache.sprite("b.png", 32);
      cache.endFrame(Infinity);
      const oldA = cache.loaded("a.png"), oldB = cache.loaded("b.png");
      calls.length = 0;

      for (const src of ["a.png", "bad.png", "slow.png"]) {
        assert.equal(cache.load(src, "anonymous", "no-referrer"), true, `${src}: a new crossOrigin`);
      }
      assert.equal(cache.load("b.png", null, "origin"), true, "a new referrer policy");
      assert.deepEqual(restoreImage.requests.slice(-4).map(q => [q.src, q.crossOrigin, q.referrerPolicy]), [
        ["a.png", "anonymous", "no-referrer"],
        ["bad.png", "anonymous", "no-referrer"],
        ["slow.png", "anonymous", "no-referrer"],
        ["b.png", null, "origin"],
      ], "failed and in-flight sources are requested again too, without retry");
      assert.deepEqual(cache.images.get("a.png"),
        { status: "loading", image: null, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
      assert.equal(oldA.closed, true, "the old image is freed");
      assert.equal(oldB.closed, true);
      assert.equal(cache._spriteBytes, 0, "and its sprites dropped");
      assert.equal(cache._spriteCache.has("a.png"), false, "average colour included");

      await flush();
      assert.deepEqual(calls.sort(), ["a.png", "b.png", "bad.png", "slow.png"],
        "each source settles once, by its new request");
      assert.equal(cache.images.get("slow.png")?.crossOrigin, "anonymous", "the stale request didn't overwrite it");
      assert.notEqual(cache.loaded("a.png"), oldA);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("pickSpriteSize picks the smallest size covering the need, capped by the source", () => {
    assert.equal(pickSpriteSize(20, 1000), 32);
    assert.equal(pickSpriteSize(64, 1000), 64);
    assert.equal(pickSpriteSize(2000, 1000), 512, "never larger than the source");
    assert.equal(pickSpriteSize(5, 10), 10, "a source smaller than the smallest size is used as is");
  });
});
