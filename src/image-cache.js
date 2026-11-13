/** @import { Canvas, CanvasContext, ImageCrossOrigin, ImageEntry } from './typedefs/renderer.js' */


/** Standard sprite sizes (device px). */
const SPRITE_SIZES = [16, 32, 64, 128, 256, 512, 1024];

/** Largest sprite (px). Nodes drawn past the standard sizes get a sprite this
    big, or as big as the source if it's smaller. */
const MAX_SIDE = 2048;

/** Most sprite builds in flight at once, fallbacks included, so finished
    builds don't pile their masking work onto the main thread at once. */
const MAX_IN_FLIGHT = 16;

/** Most estimated memory (bytes) that builds in flight may hold at once (see
    `buildCost()`). One build always runs, however large. */
const MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024;

/** Size (px) of the sprite each image gets as it loads. Nodes draw it while
    their own size is built, and the average colour is read from it. It's kept
    as long as its image, outside the LRU and the budget (16 KB each). */
const FALLBACK_SIZE = 64;

/**
 * One cached copy of a node image at one size: square, centre-cropped and
 * already clipped to a circle, so drawing it is a single `drawImage()`. An
 * `ImageBitmap` where `OffscreenCanvas` is available, otherwise a canvas.
 * @typedef {ImageBitmap | Canvas} Sprite
 */

/**
 * A cached sprite and its place in the LRU order. The fallback sprite isn't
 * in the LRU.
 * @typedef {object} SpriteSlot
 * @property {string} src - image source
 * @property {number} size - sprite size in px
 * @property {Sprite} bitmap - the sprite
 * @property {number} bytes - memory it holds
 * @property {number} frame - last frame it was drawn in
 */

/**
 * The sprites of one image source: cached ones by size, sizes being built,
 * and its average colour (`undefined` until computed, `null` if unreadable,
 * e.g. a cross-origin image). `failed` stops further builds after one from
 * the image fails.
 * @typedef {object} ImageRec
 * @property {Map<number, SpriteSlot>} slots - cached sprites, by size, the
 *    fallback included
 * @property {Set<number>} pending - sizes being built
 * @property {string | null | undefined} avg - average colour
 * @property {boolean} failed - whether a build failed
 */


/**
 * Picks the sprite size to draw an image at: the smallest standard size that
 * covers the on-screen size without exceeding the source, otherwise the
 * source's own side (capped at `MAX_SIDE`).
 * @param {number} needed - on-screen diameter in device px
 * @param {number} side - shorter side of the source image
 * @returns {number} sprite size in px
 */
export const pickSpriteSize = (needed, side) => {
  const cap = Math.max(1, Math.floor(Math.min(side, MAX_SIDE)));
  for (const t of SPRITE_SIZES) if (t >= needed && t <= cap) return t;
  return cap;
};


/**
 * Shorter side of a loaded image, which is what its sprites are cropped to.
 * @param {HTMLImageElement} img - image
 * @returns {number} side in px; 0 for an image without a size
 */
const sideOf = img => Math.min(img.naturalWidth, img.naturalHeight);


/**
 * The smallest cached sprite larger than `size`, to build it from.
 * @param {Map<number, SpriteSlot>} slots - cached sprites, by size
 * @param {number} size - wanted size
 * @returns {SpriteSlot | null} that sprite, or `null` if there's none
 */
const largerThan = (slots, size) => {
  /** @type {SpriteSlot | null} */
  let from = null;
  for (const slot of slots.values()) {
    if (slot.size > size && (!from || slot.size < from.size)) from = slot;
  }
  return from;
};


/**
 * Estimated memory a build holds while it runs: its first step's result, plus,
 * for a build from the image, the image's decoded pixels.
 * @param {HTMLImageElement} img - loaded image
 * @param {SpriteSlot | null} from - cached sprite it's built from, if any
 * @param {number} size - sprite size in px
 * @returns {number} bytes
 */
const buildCost = (img, from, size) => {
  const side = from ? from.size : sideOf(img);
  const first = side >= 2 * size ? Math.floor(side / 2) : size;
  return first * first * 4 + (from ? 0 : img.naturalWidth * img.naturalHeight * 4);
};


/**
 * The cached sprite nearest `size`: the smallest larger one, otherwise the
 * largest smaller one.
 * @param {Map<number, SpriteSlot>} slots - cached sprites, by size
 * @param {number} size - wanted size
 * @returns {SpriteSlot | null} nearest sprite, or `null` if there are none
 */
const nearest = (slots, size) => {
  /** @type {SpriteSlot | null} */
  let best = null;
  for (const slot of slots.values()) {
    const t = slot.size, b = best?.size ?? 0;
    if (!best || (t >= size && (b < size || t < b)) || (t < size && b < size && t > b)) best = slot;
  }
  return best;
};


/**
 * Shrinks a square region of `source` to `size` px across, off the main
 * thread. While it's more than twice too big, it's halved in exact 2x steps,
 * which average each 2x2 block of pixels; an odd side drops its last row and
 * column first. One last step then resizes to `size`. The first step crops
 * and halves in one call, so no full-size copy is made.
 *
 * Browsers' own resizes can alias when shrinking by more than 2x at once
 * (Chrome's `createImageBitmap` does, whatever its `resizeQuality`), since
 * they blend only a few source pixels per output pixel. Exact 2x steps can't.
 * @param {ImageBitmapSource} source - image or sprite to shrink
 * @param {number} sx - left of the square, in `source` px
 * @param {number} sy - top of the square, in `source` px
 * @param {number} side - side of the square, in `source` px
 * @param {number} size - side of the result in px
 * @param {() => boolean} wanted - checked between steps; when it returns
 *    `false`, the steps stop and `null` is returned
 * @returns {Promise<ImageBitmap | null>} the shrunk bitmap; rejects if a step fails
 */
export const shrink = async (source, sx, sy, side, size, wanted) => {
  /** @param {number} to @returns {ImageBitmapOptions} */
  const resize = to => ({ resizeWidth: to, resizeHeight: to, resizeQuality: "high" });
  /** @type {ImageBitmap | null} */
  let cur = null;    // the last step's result, ours to close
  try {
    while (side >= 2 * size) {
      const even = side - (side % 2);
      /** @type {ImageBitmap} */
      const next = await createImageBitmap(cur ?? source, sx, sy, even, even, resize(even / 2));
      cur?.close();
      cur = next;
      sx = sy = 0;
      side = even / 2;
      if (!wanted()) { next.close(); return null; }
    }
    if (cur && side === size) return cur;
    const out = await createImageBitmap(cur ?? source, sx, sy, side, side, resize(size));
    cur?.close();
    return out;
  } catch (err) {
    cur?.close();
    throw err;
  }
};


/**
 * Gets a canvas's 2D context. Typed through a cast because `getContext` on a
 * `HTMLCanvasElement | OffscreenCanvas` union resolves unreliably in tsc.
 * @param {Canvas} canvas - canvas
 * @returns {CanvasContext | null} 2D context
 */
const ctx2d = canvas => /** @type {CanvasContext | null} */ (canvas.getContext("2d"));


/**
 * Whether sprites can be built here: needs `createImageBitmap` and a canvas
 * (missing in Node, where images are drawn uncached).
 * @returns {boolean}
 */
const canBuild = () => typeof createImageBitmap === "function"
  && (typeof OffscreenCanvas !== "undefined" || typeof globalThis.document?.createElement === "function");


/**
 * Node images and their sprites. Each image is kept as its `<img>` element,
 * whose decoded pixels the browser may discard while unused, plus a small
 * fallback sprite made as it loads. Other sizes are built on demand, off the
 * main thread, and cached within a memory budget. The renderer brackets each
 * frame with `beginFrame()` and `endFrame()`, which evicts the least recently
 * drawn sprites.
 */
export class ImageCache {
  /** @private @type {Map<string, Readonly<ImageEntry>>} */
  _images = new Map();
  /**
   * Node images, keyed by source. Each entry is replaced, not changed, when
   * its request settles.
   * @returns {ReadonlyMap<string, Readonly<ImageEntry>>}
   */
  get images() { return this._images; }

  /** Sprites of each image source. @private @type {Map<string, ImageRec>} */
  _recs = new Map();

  /** Cached sprites, least recently drawn first. @private @type {Set<SpriteSlot>} */
  _lru = new Set();

  /** Total bytes held by the sprites in the LRU. @private */
  _bytes = 0;

  /** Counter incremented once per `beginFrame()`. @private */
  _frameId = 0;

  /** Sprite builds in flight. @private */
  _inFlight = 0;

  /** Estimated bytes held by the builds in flight. @private */
  _inFlightBytes = 0;

  /**
   * Fallback builds waiting for room under the in-flight limits, first in
   * first out. They start before any build asked for by `sprite()`.
   * @private @type {{ cost: number, build: () => Promise<void> }[]}
   */
  _queue = [];

  /** Whether a build asked for this frame was turned away by the limits. @private */
  _turnedAway = false;

  /**
   * Reusable canvases sprites are masked in, one per standard size. Only used
   * with `OffscreenCanvas`, whose results are handed off as `ImageBitmap`s.
   * @private @type {Map<number, OffscreenCanvas>}
   */
  _spriteCanvases = new Map();

  /**
   * Called when a request settles, after its entry is updated. Not called
   * for a request whose entry was collected or replaced before it settled.
   * @private @type {((src: string, entry: Readonly<ImageEntry>) => void) | undefined}
   */
  _onSettle;


  /**
   * @param {(src: string, entry: Readonly<ImageEntry>) => void} [onSettle] -
   *    called with the source and its new entry when a request settles
   */
  constructor(onSettle = undefined) {
    this._onSettle = onSettle;
  }


  /**
   * Whether sprites are being built or waiting to be, or a build asked for
   * this frame was turned away by the in-flight limits (the next frame asks
   * again). Drawing again shows what they change, so a caller drawing on
   * demand keeps drawing while this is `true`.
   * @returns {boolean}
   */
  get busy() { return this._inFlight > 0 || this._queue.length > 0 || this._turnedAway; }


  /**
   * Starts loading an image, keyed by its source. Each entry records the
   * options it was requested with, and a source requested with different
   * options is requested again: its entry and sprites are replaced, and a
   * request still in flight is ignored when it settles. With the same
   * options, a source that is loading or loaded is not requested again, and
   * neither is one that failed unless `retry` is set. A loaded image settles
   * once it's decoded and its fallback sprite is made; fallback builds wait
   * their turn under the in-flight limits.
   * @param {string} src - image source; also the cache key
   * @param {ImageCrossOrigin} crossOrigin - the request's `crossOrigin`
   * @param {ReferrerPolicy} referrerPolicy - the request's `referrerPolicy`
   * @param {boolean} [retry=false] - whether to request a failed source again
   * @returns {boolean} `true` if a request was started, `false` if `src` was
   *    already cached with these options and not retried
   */
  load(src, crossOrigin, referrerPolicy, retry = false) {
    const prev = this._images.get(src);
    if (prev && prev.crossOrigin === crossOrigin && prev.referrerPolicy === referrerPolicy) {
      if (prev.status !== "failed" || !retry) return false;
    }
    this._drop(src);

    /** @type {Readonly<ImageEntry>} */
    const loading = Object.freeze({ status: "loading", image: null, crossOrigin, referrerPolicy });
    this._images.set(src, loading);
    const img = new Image();
    img.crossOrigin = crossOrigin;
    img.referrerPolicy = referrerPolicy;
    // Only if this request's entry is still there: an entry collected or
    // replaced in the meantime mustn't be overwritten by a late result
    /** @param {Readonly<ImageEntry>} entry */
    const settle = entry => {
      if (this._images.get(src) !== loading) return;
      this._images.set(src, entry);
      this._onSettle?.(src, entry);
    };
    // Settled once decoded and its fallback sprite is made, so nodes never
    // need to draw the image itself. A failed decode leaves decoding to the
    // build or to drawing.
    img.onload = async () => {
      if (typeof img.decode === "function") await img.decode().catch(() => {});
      if (this._images.get(src) !== loading) return;
      if (canBuild() && sideOf(img)) {
        const rec = this._rec(src), size = pickSpriteSize(FALLBACK_SIZE, sideOf(img));
        await this._whenFree(buildCost(img, null, size), () => this._build(src, img, rec, size, null, true));
      }
      settle(Object.freeze({ status: "loaded", image: img, crossOrigin, referrerPolicy }));
    };
    img.onerror = () => settle(Object.freeze({ status: "failed", image: null, crossOrigin, referrerPolicy }));
    img.src = src;
    return true;
  }


  /**
   * Returns an image if it has loaded.
   * @param {string} src - image source
   * @returns {HTMLImageElement | null} the loaded image, or `null` if it's
   *    loading, failed or unknown
   */
  loaded(src) {
    return this._images.get(src)?.image ?? null;
  }


  /**
   * Deletes every image, and its sprites, whose source isn't in `live`.
   * @param {ReadonlySet<string>} live - sources still in use
   * @returns {void}
   */
  collect(live) {
    for (const src of [...this._images.keys()]) {
      if (live.has(src)) continue;
      this._images.delete(src);
      this._drop(src);
    }
  }


  /**
   * Starts a frame.
   * @returns {void}
   */
  beginFrame() {
    this._frameId++;
    this._turnedAway = false;
  }


  /**
   * Ends a frame: evicts the least recently drawn sprites until within the
   * budget, stopping at the first one drawn this frame, so what is on screen
   * always stays cached.
   * @param {number} budgetBytes - memory budget for cached sprites
   * @returns {void}
   */
  endFrame(budgetBytes) {
    for (const slot of this._lru) {
      if (this._bytes <= budgetBytes || slot.frame === this._frameId) break;
      this._deleteSlot(slot);
    }
  }


  /**
   * Returns the sprite to draw `src` at an on-screen diameter of `needed`.
   * If that size isn't cached, starts building it and returns the nearest
   * cached size meanwhile. Marks the returned sprite as drawn this frame.
   * @param {string} src - image source
   * @param {number} needed - on-screen diameter in device px
   * @returns {Sprite | null} sprite, or `null` if `src` hasn't loaded or has
   *    no sprite yet
   */
  sprite(src, needed) {
    const img = this.loaded(src);
    if (!img || !sideOf(img)) return null;
    const rec = this._rec(src);
    const size = pickSpriteSize(needed, sideOf(img));
    let slot = rec.slots.get(size);
    if (!slot) {
      this._request(src, img, rec, size);
      slot = nearest(rec.slots, size) ?? undefined;
    }
    if (!slot) return null;
    if (slot.frame !== this._frameId) {
      // Move to the most recently drawn end (the fallback isn't in the LRU)
      if (this._lru.delete(slot)) this._lru.add(slot);
      slot.frame = this._frameId;
    }
    return slot.bitmap;
  }


  /**
   * Average colour of an image, for drawing it as a dot. Read from its
   * fallback sprite as it loads.
   * @param {string} src - image source
   * @returns {string | null} CSS colour, or `null` if unavailable (not
   *    loaded, unreadable, or no sprite could be made)
   */
  average(src) {
    return this._recs.get(src)?.avg ?? null;
  }


  /**
   * Returns the sprite record of a source, creating it if needed.
   * @param {string} src - image source
   * @returns {ImageRec} record
   * @private
   */
  _rec(src) {
    let rec = this._recs.get(src);
    if (!rec) {
      rec = { slots: new Map(), pending: new Set(), avg: undefined, failed: false };
      this._recs.set(src, rec);
    }
    return rec;
  }


  /**
   * Starts building a sprite on demand, unless it's cached, being built, or
   * can't be built. A build that doesn't fit under the in-flight limits, or
   * would go ahead of queued fallbacks, isn't queued: the next frame asks for
   * whatever size it needs then.
   * @param {string} src - image source
   * @param {HTMLImageElement} img - loaded image
   * @param {ImageRec} rec - its record
   * @param {number} size - sprite size in px
   * @returns {void}
   * @private
   */
  _request(src, img, rec, size) {
    if (rec.failed || rec.slots.has(size) || rec.pending.has(size) || !canBuild()) return;
    const from = largerThan(rec.slots, size);
    const build = () => this._build(src, img, rec, size, from, false).finally(() => rec.pending.delete(size));
    if (this._queue.length || !this._tryStart(buildCost(img, from, size), build)) {
      this._turnedAway = true;
      return;
    }
    rec.pending.add(size);
  }


  /**
   * Starts a build if it fits under the in-flight limits: fewer than
   * `MAX_IN_FLIGHT` builds, and `MAX_IN_FLIGHT_BYTES` with its cost. One build
   * always fits when none is running.
   * @param {number} cost - its estimated bytes (see `buildCost()`)
   * @param {() => Promise<void>} build - starts it; must not reject
   * @returns {boolean} whether it started
   * @private
   */
  _tryStart(cost, build) {
    const fits = this._inFlight === 0
      || (this._inFlight < MAX_IN_FLIGHT && this._inFlightBytes + cost <= MAX_IN_FLIGHT_BYTES);
    if (!fits) return false;
    this._inFlight++;
    this._inFlightBytes += cost;
    build().finally(() => {
      this._inFlight--;
      this._inFlightBytes -= cost;
      // Room freed: queued fallbacks go first
      while (this._queue.length && this._tryStart(this._queue[0].cost, this._queue[0].build)) this._queue.shift();
    });
    return true;
  }


  /**
   * Runs a build once it fits under the in-flight limits, after any builds
   * already queued.
   * @param {number} cost - its estimated bytes (see `buildCost()`)
   * @param {() => Promise<void>} build - starts it; must not reject
   * @returns {Promise<void>} settles when the build has run
   * @private
   */
  _whenFree(cost, build) {
    return new Promise(resolve => {
      const run = () => build().finally(resolve);
      if (!this._queue.length && this._tryStart(cost, run)) return;
      this._queue.push({ cost, build: run });
    });
  }


  /**
   * Builds a sprite and caches it. `shrink()` decodes, crops and resizes off
   * the main thread, from a larger cached sprite if given (fewer, cheaper
   * steps), otherwise from the image's centre square; the result is then
   * masked to a circle. A build whose record is dropped before or while it
   * runs stops, or is discarded. A fallback sprite is kept out of the LRU,
   * and gives the record its average colour.
   * @param {string} src - image source
   * @param {HTMLImageElement} img - loaded image
   * @param {ImageRec} rec - its record
   * @param {number} size - sprite size in px
   * @param {SpriteSlot | null} from - larger cached sprite to build from, if any
   * @param {boolean} fallback - whether it's the image's fallback sprite
   * @returns {Promise<void>} settles when it's cached or discarded; never rejects
   * @private
   */
  async _build(src, img, rec, size, from, fallback) {
    const wanted = () => this._recs.get(src) === rec;
    if (!wanted()) return;   // e.g. collected while queued
    const side = sideOf(img);
    let resized;
    try {
      // A source is copied when the first step is called, so evicting `from`
      // meanwhile is fine
      resized = await (from
        ? shrink(from.bitmap, 0, 0, from.size, size, wanted)
        : shrink(img, Math.floor((img.naturalWidth - side) / 2), Math.floor((img.naturalHeight - side) / 2),
          side, size, wanted));
    } catch {
      // E.g. an SVG without a size: drawn uncached from now on
      if (!from) rec.failed = true;
      return;
    }
    if (!resized) return;
    const sprite = wanted() ? this._mask(resized, rec, size, fallback) : null;
    resized.close();
    if (!sprite) return;
    const slot = { src, size, bitmap: sprite, bytes: size * size * 4, frame: this._frameId };
    rec.slots.set(size, slot);
    if (fallback) return;
    this._lru.add(slot);
    this._bytes += slot.bytes;
  }


  /**
   * Masks a resized image to a circle, reading the record's average colour
   * from it if asked.
   * @param {ImageBitmap} resized - image, cropped and resized to `size`
   * @param {ImageRec} rec - its record
   * @param {number} size - sprite size in px
   * @param {boolean} readAverage - whether to set `rec.avg` from it
   * @returns {Sprite | null} the sprite, or `null` if no canvas could be made
   * @private
   */
  _mask(resized, rec, size, readAverage) {
    const out = this._spriteCanvas(size);
    const ctx = out && ctx2d(out);
    if (!out || !ctx) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    // Scaled, in case the browser ignored the resize options
    ctx.drawImage(resized, 0, 0, size, size);
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // Pixels can only be read before the hand-off below
    if (readAverage) rec.avg = this._averageColor(out);
    return "transferToImageBitmap" in out ? out.transferToImageBitmap() : out;
  }


  /**
   * Returns the canvas to mask a sprite of `size` in. With `OffscreenCanvas`,
   * one canvas per standard size is reused: each sprite is handed off with
   * `transferToImageBitmap()`. Other sizes follow each source's side, so
   * keeping a canvas for each would hold memory without bound; they get a
   * one-off canvas instead. Without `OffscreenCanvas`, each sprite is its own
   * canvas.
   * @param {number} size - sprite size
   * @returns {Canvas | null} canvas, or `null` where none can be made
   * @private
   */
  _spriteCanvas(size) {
    if (typeof OffscreenCanvas === "undefined") {
      const doc = globalThis.document;
      if (typeof doc?.createElement !== "function") return null;
      const canvas = doc.createElement("canvas");
      canvas.width = canvas.height = size;
      return canvas;
    }
    if (!SPRITE_SIZES.includes(size)) return new OffscreenCanvas(size, size);
    let canvas = this._spriteCanvases.get(size);
    if (!canvas) {
      canvas = new OffscreenCanvas(size, size);
      this._spriteCanvases.set(size, canvas);
    }
    return canvas;
  }


  /**
   * Alpha-weighted average colour of a small canvas, or `null` when its
   * pixels can't be read (a canvas tainted by a cross-origin image throws)
   * or it's fully transparent.
   * @param {Canvas} canvas - canvas (at most `FALLBACK_SIZE` px)
   * @returns {string | null} CSS colour
   * @private
   */
  _averageColor(canvas) {
    try {
      const ctx = ctx2d(canvas);
      if (!ctx) return null;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < data.length; i += 4) {
        const w = data[i + 3];
        r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += w;
      }
      if (!a) return null;
      return `rgb(${Math.round(r / a)}, ${Math.round(g / a)}, ${Math.round(b / a)})`;
    } catch {
      return null;
    }
  }


  /**
   * Removes one sprite from the cache and frees its pixels.
   * @param {SpriteSlot} slot - sprite
   * @returns {void}
   * @private
   */
  _deleteSlot(slot) {
    if ("close" in slot.bitmap) slot.bitmap.close();   // frees now, not at GC
    this._recs.get(slot.src)?.slots.delete(slot.size);
    if (this._lru.delete(slot)) this._bytes -= slot.bytes;
  }


  /**
   * Drops every sprite of an image source. Builds still in flight for it
   * are discarded when they finish.
   * @param {string} src - image source
   * @returns {void}
   * @private
   */
  _drop(src) {
    const rec = this._recs.get(src);
    if (!rec) return;
    for (const slot of [...rec.slots.values()]) this._deleteSlot(slot);
    this._recs.delete(src);
  }
}
