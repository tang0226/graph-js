import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ImageCache, pickSpriteSize } from "../src/image-cache.js";
import { installImage, installOffscreenCanvas, flush, opsNamed } from "./helpers/stubs.js";

/* Loads `srcs` into a new cache and waits for them to settle. */
const loadAll = async (srcs, onSettle) => {
  const cache = new ImageCache(onSettle);
  for (const src of srcs) cache.load(src, null, "no-referrer");
  await flush();
  return cache;
};

/* Asks for a sprite in a frame of its own. */
const frame = (cache, f, budget = Infinity) => {
  cache.beginFrame();
  const out = f();
  cache.endFrame(budget);
  return out;
};

describe("ImageCache", () => {
  test("changed() resolves when a request settles or an entry is collected, not when one is replaced", async () => {
    const restore = installImage({ fail: src => src === "bad.png" });
    try {
      const cache = new ImageCache();
      const resolved = p => Promise.race([p.then(() => true), flush().then(() => false)]);

      cache.load("a.png", null, "no-referrer");
      assert.equal(await resolved(cache.changed()), true, "a.png loaded");
      cache.load("bad.png", null, "no-referrer");
      assert.equal(await resolved(cache.changed()), true, "bad.png failed");

      // Replaced while loading: the first request's settle is ignored, the second's counts
      cache.load("c.png", null, "no-referrer");
      const replaced = cache.changed();
      cache.load("c.png", "anonymous", "no-referrer");
      assert.equal(await resolved(replaced), true);
      assert.equal(cache.images.get("c.png")?.crossOrigin, "anonymous");

      assert.equal(await resolved(cache.changed()), false, "nothing left to settle");

      cache.load("d.png", null, "no-referrer");
      const collected = cache.changed();
      let collectedNow = false;
      collected.then(() => { collectedNow = true; });
      cache.collect(new Set(["a.png", "bad.png", "c.png"]));
      await null; await null;
      assert.equal(collectedNow, true, "a collected entry is a change straight away");
      assert.equal(await resolved(cache.changed()), false, "d.png's late settle is ignored");
      const unchanged = cache.changed();
      cache.collect(new Set(["a.png", "bad.png", "c.png"]));
      assert.equal(await resolved(unchanged), false, "collecting nothing isn't a change");
    } finally { restore(); }
  });

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
      assert.deepEqual(cache.images.get("a.png"),
        { status: "loaded", image: cache.loaded("a.png"), crossOrigin: "use-credentials", referrerPolicy: "origin" });
      assert.deepEqual(cache.images.get("bad.png"),
        { status: "failed", image: null, crossOrigin: null, referrerPolicy: "no-referrer" });
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

      cache.load("bad.png", null, "no-referrer", true);
      await flush();
      assert.equal(calls.length, 3, "a retry settles again");
    } finally { restore(); }
  });

  test("a source collected before it settled stays collected", async () => {
    const restore = installImage();
    try {
      const calls = [];
      const cache = new ImageCache(src => calls.push(src));
      cache.load("a.png", null, "no-referrer");
      cache.load("b.png", null, "no-referrer");
      cache.collect(new Set(["b.png"]));
      await flush();
      assert.deepEqual(calls, ["b.png"]);
      assert.deepEqual([...cache.images.keys()], ["b.png"]);
    } finally { restore(); }
  });

  test("a loaded image is decoded and gets its fallback sprite before it settles", async () => {
    const restoreImage = installImage({ width: 3000, height: 4001 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const decoded = [];
      const decode = globalThis.Image.prototype.decode;
      globalThis.Image.prototype.decode = function () {
        decoded.push(this._src);
        return decode.call(this);
      };
      const calls = [];
      const cache = new ImageCache(src => calls.push([src, restoreCanvas.bitmaps.length]));
      cache.load("a.png", null, "no-referrer");
      await flush();
      assert.deepEqual(decoded, ["a.png"]);
      assert.deepEqual(calls, [["a.png", 1]], "settled once the fallback was made");
      assert.ok(cache.loaded("a.png") instanceof globalThis.Image, "the image is kept as its element");

      const steps = restoreImage.sources;
      assert.equal(steps[0].image, cache.loaded("a.png"));
      assert.deepEqual(steps[0].crop, [0, 500, 3000, 3000], "the centre square, cropped and halved at once");
      assert.deepEqual(steps[0].opts, { resizeWidth: 1500, resizeHeight: 1500, resizeQuality: "high" });
      assert.deepEqual(steps.map(b => b.opts.resizeWidth), [1500, 750, 375, 187, 93, 64],
        "exact 2x steps (an odd side drops a pixel), then one last step");
      for (let i = 1; i < steps.length; i++) assert.equal(steps[i].image, steps[i - 1], "each from the last");
      assert.deepEqual(steps[3].crop, [0, 0, 374, 374], "375 is evened to 374 before halving");
      assert.ok(steps.every(b => b.closed), "the intermediate bitmaps are freed");
      const resized = steps.at(-1);

      const [canvas] = restoreCanvas.created;
      assert.deepEqual(opsNamed(canvas.ctx, "drawImage"), [["drawImage", resized, 0, 0, 64, 64]]);
      assert.deepEqual(opsNamed(canvas.ctx, "globalCompositeOperation").map(o => o[1]), ["destination-in", "source-over"]);
      assert.deepEqual(opsNamed(canvas.ctx, "arc")[0].slice(1, 4), [32, 32, 32], "masked to a circle");

      assert.equal(frame(cache, () => cache.sprite("a.png", 20)), restoreCanvas.bitmaps[0],
        "drawable from the first frame");
      assert.equal(cache._bytes, 0, "the fallback isn't counted in the budget");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("an image smaller than the fallback size gets a fallback of its own size", async () => {
    const restoreImage = installImage({ size: 10 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      await loadAll(["a.png"]);
      assert.equal(restoreImage.sources[0].opts.resizeWidth, 10);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("without a canvas, an image loads with no sprite", async () => {
    const restore = installImage();
    try {
      const cache = await loadAll(["a.png"]);
      assert.equal(cache.images.get("a.png")?.status, "loaded");
      assert.equal(restore.sources.length, 0);
      assert.equal(frame(cache, () => cache.sprite("a.png", 32)), null, "drawn uncached");
      assert.equal(cache.busy, false);
    } finally { restore(); }
  });

  test("an image that loads but fails to decode() still loads", async () => {
    const restore = installImage({ decodeFails: () => true });
    try {
      const cache = await loadAll(["a.png"]);
      assert.ok(cache.loaded("a.png") instanceof globalThis.Image, "drawing decodes it instead");
    } finally { restore(); }
  });

  test("a size is built from the image, or from the smallest larger cached sprite", async () => {
    const restoreImage = installImage({ width: 3000, height: 4001 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = await loadAll(["a.png"]);
      const [fallback] = restoreCanvas.bitmaps;
      const built = () => restoreImage.sources.at(-1);

      frame(cache, () => cache.sprite("a.png", 1000));
      assert.equal(built().image, cache.loaded("a.png"), "no larger sprite: from the image");
      assert.deepEqual(built().crop, [0, 500, 3000, 3000]);
      await flush();
      const s1024 = frame(cache, () => cache.sprite("a.png", 1000));
      assert.equal(s1024.width, 1024);

      frame(cache, () => cache.sprite("a.png", 200));
      assert.equal(built().image, s1024, "from the cached 1024");
      assert.deepEqual(built().crop, [0, 0, 1024, 1024], "all of it");
      assert.equal(built().opts.resizeWidth, 512, "halved first");
      await flush();
      assert.equal(built().opts.resizeWidth, 256, "then halved again");

      frame(cache, () => cache.sprite("a.png", 20));
      assert.equal(built().image, fallback, "the fallback is the smallest larger one");
      await flush();
      assert.equal(frame(cache, () => cache.sprite("a.png", 20)).width, 32);
      assert.ok(restoreImage.sources.every(b => b.closed));
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("while a size is built, the nearest cached one is drawn, larger first", async () => {
    const restoreImage = installImage({ size: 1000 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = await loadAll(["a.png"]);
      const [fallback] = restoreCanvas.bitmaps;
      assert.equal(frame(cache, () => cache.sprite("a.png", 100)), fallback, "only a smaller one is cached");
      await flush();
      const s128 = frame(cache, () => cache.sprite("a.png", 100));
      assert.equal(s128.width, 128);
      assert.equal(frame(cache, () => cache.sprite("a.png", 20)), fallback, "of 64 and 128, the nearer larger");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("only standard sizes keep a canvas; others get a one-off", async () => {
    const restoreImage = installImage({ size: 1000 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = await loadAll(["a.png", "b.png"]);
      frame(cache, () => { cache.sprite("a.png", 600); cache.sprite("b.png", 600); });   // the 1000 sprite
      frame(cache, () => { cache.sprite("a.png", 100); cache.sprite("b.png", 100); });   // 128
      await flush();
      assert.deepEqual([...cache._spriteCanvases.keys()].sort((x, y) => x - y), [64, 128]);
      assert.equal(restoreCanvas.created.filter(c => c.width === 1000).length, 2, "one each, not kept");
      assert.equal(restoreCanvas.created.filter(c => c.width === 128).length, 1, "reused");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("at most 16 builds are in flight; later frames ask for the rest", async () => {
    const restoreImage = installImage({ size: 256 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const srcs = Array.from({ length: 20 }, (_, i) => `n${i}.png`);
      const cache = await loadAll(srcs);
      const loaded = restoreImage.sources.length;
      assert.equal(loaded, 40, "every fallback was made, outside the limit, in two 2x steps");
      frame(cache, () => srcs.forEach(src => cache.sprite(src, 100)));
      assert.equal(restoreImage.sources.length - loaded, 16);
      frame(cache, () => srcs.forEach(src => cache.sprite(src, 100)));
      assert.equal(restoreImage.sources.length - loaded, 16, "the same sizes aren't asked for twice");

      await flush();
      const drawn = frame(cache, () => srcs.map(src => cache.sprite(src, 100).width));
      assert.deepEqual(drawn.filter(w => w === 128).length, 16, "the rest draw their fallback");
      assert.equal(cache.busy, true, "the other 4 are now being built");
      await flush();
      assert.ok(frame(cache, () => srcs.every(src => cache.sprite(src, 100).width === 128)));
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("endFrame evicts the least recently drawn sprites, keeping those drawn this frame and fallbacks", async () => {
    const restoreImage = installImage({ size: 256 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const srcs = ["a.png", "b.png", "c.png"];
      const cache = await loadAll(srcs);
      const fallbacks = [...restoreCanvas.bitmaps];
      frame(cache, () => srcs.forEach(src => cache.sprite(src, 100)));
      await flush();
      const SPRITE = 128 * 128 * 4;
      frame(cache, () => srcs.forEach(src => cache.sprite(src, 100)));
      frame(cache, () => cache.sprite("a.png", 100));      // a.png drawn most recently

      frame(cache, () => cache.sprite("c.png", 100), 2 * SPRITE);
      assert.equal(cache._bytes, 2 * SPRITE, "evicted down to the budget");
      assert.deepEqual([...cache._recs.get("b.png").slots.keys()], [64], "b.png's 128, least recently drawn, went first");

      frame(cache, () => cache.sprite("c.png", 100), 0);
      assert.deepEqual([...cache._lru].map(s => s.src), ["c.png"], "drawn this frame: kept even over budget");
      frame(cache, () => {}, 0);
      assert.equal(cache._bytes, 0);
      const built = restoreCanvas.bitmaps.filter(b => !fallbacks.includes(b));
      assert.ok(built.every(b => b.closed), "evicted sprites are closed");
      assert.ok(fallbacks.every(b => !b.closed), "fallbacks are never evicted");
      assert.ok(srcs.every(src => frame(cache, () => cache.sprite(src, 20))));
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("a build that finishes after its image was collected or reloaded is discarded", async () => {
    const restoreImage = installImage({ size: 256 });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = await loadAll(["a.png", "b.png"]);
      const fallbacks = [...restoreCanvas.bitmaps];
      frame(cache, () => { cache.sprite("a.png", 100); cache.sprite("b.png", 100); });
      cache.collect(new Set(["b.png"]));
      cache.load("b.png", "anonymous", "no-referrer");     // other options: reloaded
      assert.ok(fallbacks.every(b => b.closed), "their fallbacks are freed");
      await flush();
      assert.equal(cache.busy, false);
      assert.ok(restoreImage.sources.every(b => b.closed));
      assert.ok(restoreCanvas.bitmaps.every(b => b.width === 64), "no 128 was masked");
      assert.equal(cache._bytes, 0);
      assert.equal(cache._recs.has("a.png"), false);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("an image whose fallback fails isn't built again", async () => {
    const restoreImage = installImage({ bitmapFails: () => true });
    const restoreCanvas = installOffscreenCanvas();
    let calls = 0;
    const make = globalThis.createImageBitmap;
    globalThis.createImageBitmap = (...args) => { calls++; return make(...args); };
    try {
      const cache = await loadAll(["a.png"]);
      assert.equal(cache.images.get("a.png")?.status, "loaded", "it still loads");
      assert.equal(frame(cache, () => cache.sprite("a.png", 128)), null, "drawn uncached");
      assert.equal(cache.busy, false);
      assert.equal(cache.average("a.png"), null);
      assert.equal(calls, 1);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("without createImageBitmap, no sprite is built", async () => {
    const restoreImage = installImage({ bitmap: false });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = await loadAll(["a.png"]);
      assert.equal(frame(cache, () => cache.sprite("a.png", 32)), null);
      assert.equal(cache.busy, false);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("average is read from the fallback sprite as the image loads", async () => {
    const restoreImage = installImage({ size: 1000 });
    const restoreCanvas = installOffscreenCanvas({ avg: [10, 20, 30, 255] });
    try {
      const cache = await loadAll(["a.png"]);
      assert.equal(cache.average("a.png"), "rgb(10, 20, 30)");
      assert.equal(cache.average("unknown.png"), null);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("average is null when the pixels can't be read", async () => {
    const restoreImage = installImage();
    const restoreCanvas = installOffscreenCanvas({ tainted: true });
    try {
      const cache = await loadAll(["a.png"]);
      assert.equal(cache.average("a.png"), null);
      assert.equal(cache._recs.get("a.png").avg, null, "known to be unreadable");
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("sprite and average return null for a source that hasn't loaded", async () => {
    const restoreImage = installImage({ fail: src => src === "bad.png" });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const cache = new ImageCache();
      cache.load("a.png", null, "no-referrer");
      cache.load("bad.png", null, "no-referrer");
      assert.equal(frame(cache, () => cache.sprite("a.png", 32)), null, "still loading");
      assert.equal(cache.average("a.png"), null);
      await flush();
      assert.equal(frame(cache, () => cache.sprite("bad.png", 32)), null, "failed");
      assert.equal(cache._recs.has("bad.png"), false, "no record is made for an unloaded source");
      assert.equal(cache.busy, false);
    } finally { restoreCanvas(); restoreImage(); }
  });

  test("load with other options requests a source again, dropping its sprites", async () => {
    const restoreImage = installImage({ size: 64, fail: src => src === "bad.png" });
    const restoreCanvas = installOffscreenCanvas();
    try {
      const calls = [];
      const cache = await loadAll(["a.png", "b.png", "bad.png"], src => calls.push(src));
      cache.load("slow.png", null, "no-referrer");     // still in flight when replaced
      frame(cache, () => { cache.sprite("a.png", 32); cache.sprite("b.png", 32); });
      await flush();
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
      assert.ok(restoreCanvas.bitmaps.every(b => b.closed), "the old sprites are freed");
      assert.equal(cache._bytes, 0);
      assert.equal(cache._recs.size, 0, "average colours included");

      await flush();
      assert.deepEqual(calls.sort(), ["a.png", "b.png", "bad.png", "slow.png"],
        "each source settles once, by its new request");
      assert.equal(cache.images.get("slow.png")?.crossOrigin, "anonymous", "the stale request didn't overwrite it");
    } finally { restoreCanvas(); restoreImage(); }
  });

  describe("in-flight limits", () => {
    /* Holds every createImageBitmap call until `release()`, so builds stay in
       flight. `calls` counts the calls made. */
    const holdBitmaps = () => {
      const make = globalThis.createImageBitmap;
      const held = [];
      const gate = { calls: 0 };
      globalThis.createImageBitmap = (...args) => {
        gate.calls++;
        return new Promise((resolve, reject) => held.push(() => make(...args).then(resolve, reject)));
      };
      gate.release = async () => {
        while (held.length) { held.splice(0).forEach(f => f()); await flush(); }
      };
      gate.releaseOnce = async () => { held.splice(0).forEach(f => f()); await flush(); };
      return gate;
    };
    const statuses = (cache, srcs) => srcs.map(src => cache.images.get(src)?.status);

    test("at most 16 builds run at once; fallbacks past that wait their turn, in order", async () => {
      const restoreImage = installImage({ size: 64 });
      const restoreCanvas = installOffscreenCanvas();
      const gate = holdBitmaps();
      try {
        const settled = [];
        const srcs = Array.from({ length: 20 }, (_, i) => `n${i}.png`);
        const cache = await loadAll(srcs, src => settled.push(src));
        assert.equal(gate.calls, 16);
        assert.equal(cache._inFlight, 16);
        assert.equal(cache._queue.length, 4);
        assert.equal(cache.busy, true, "queued builds count as busy");
        assert.ok(statuses(cache, srcs).every(s => s === "loading"), "settled only once the fallback is made");

        await gate.releaseOnce();
        assert.deepEqual(settled, srcs.slice(0, 16));
        assert.equal(gate.calls, 20, "the queued 4 started as room freed");
        await gate.release();
        assert.deepEqual(settled, srcs, "in the order they loaded");
        assert.equal(cache.busy, false);
        assert.equal(cache._inFlightBytes, 0);
      } finally { restoreCanvas(); restoreImage(); }
    });

    test("estimated bytes are limited too, and one build always runs", async () => {
      const restoreCanvas = installOffscreenCanvas();
      for (const [size, running, why] of [
        [2000, 3, "2000 px: 16 MB decoded + 4 MB halved, so 3 fit in 64 MB"],
        [4000, 1, "4000 px: 80 MB, over the budget alone, still runs one at a time"],
      ]) {
        const restoreImage = installImage({ size });
        const gate = holdBitmaps();
        try {
          const cache = await loadAll(["a.png", "b.png", "c.png", "d.png"]);
          assert.equal(cache._inFlight, running, why);
          assert.equal(cache._queue.length, 4 - running);
          await gate.release();
          assert.ok(statuses(cache, ["a.png", "b.png", "c.png", "d.png"]).every(s => s === "loaded"));
        } finally { restoreImage(); }
      }
      restoreCanvas();
    });

    test("sprite() builds don't go ahead of queued fallbacks; the next frame asks again", async () => {
      const restoreImage = installImage({ size: 256 });
      const restoreCanvas = installOffscreenCanvas();
      try {
        const cache = await loadAll(["a.png"]);
        const gate = holdBitmaps();
        const srcs = Array.from({ length: 17 }, (_, i) => `n${i}.png`);
        for (const src of srcs) cache.load(src, null, "no-referrer");
        await flush();
        assert.equal(cache._queue.length, 1);

        const calls = gate.calls;
        frame(cache, () => cache.sprite("a.png", 128));
        assert.equal(gate.calls, calls, "turned away, not queued");
        assert.equal(cache.busy, true);

        await gate.release();
        assert.equal(gate.calls, 17 * 2, "every fallback ran, in two 2x steps each");
        assert.equal(cache.busy, true, "until a frame no longer turns it away");
        frame(cache, () => cache.sprite("a.png", 128));
        assert.equal(gate.calls, 17 * 2 + 1, "asked again, and started");
        await gate.release();
        assert.equal(frame(cache, () => cache.sprite("a.png", 128)).width, 128);
        assert.equal(cache.busy, false);
      } finally { restoreCanvas(); restoreImage(); }
    });

    test("a queued fallback whose image was collected or reloaded is skipped", async () => {
      const restoreImage = installImage({ size: 64 });
      const restoreCanvas = installOffscreenCanvas();
      const gate = holdBitmaps();
      try {
        const settled = [];
        const srcs = Array.from({ length: 18 }, (_, i) => `n${i}.png`);
        const cache = await loadAll(srcs, src => settled.push(src));
        cache.collect(new Set(srcs.slice(0, 17)));                       // n17 was queued
        cache.load("n16.png", "anonymous", "no-referrer");                // so was n16
        await gate.release();
        assert.equal(gate.calls, 17, "16, then the reloaded n16; n17 and the stale n16 never ran");
        assert.equal(cache.images.has("n17.png"), false);
        assert.deepEqual(settled.slice(0, 16), srcs.slice(0, 16));
        assert.equal(cache.images.get("n16.png")?.crossOrigin, "anonymous");
        assert.equal(cache.busy, false);
      } finally { restoreCanvas(); restoreImage(); }
    });
  });

  test("pickSpriteSize picks the smallest standard size covering the need, else the source's side", () => {
    assert.equal(pickSpriteSize(20, 1000), 32);
    assert.equal(pickSpriteSize(64, 1000), 64);
    assert.equal(pickSpriteSize(0, 1000), 16);
    assert.equal(pickSpriteSize(600, 1000), 1000, "1024 is larger than the source: the source's side");
    assert.equal(pickSpriteSize(520, 600), 600, "between sizes, the source has more detail than 512");
    assert.equal(pickSpriteSize(3000, 4000), 2048, "capped at 2048");
    assert.equal(pickSpriteSize(1500, 4000), 2048);
    assert.equal(pickSpriteSize(5, 10), 10, "a source smaller than the smallest size is used as is");
    assert.equal(pickSpriteSize(5, 10.5), 10);
  });
});
