/** @import { Canvas, CanvasContext, ImageEntry } from './typedefs/renderer.js' */


/** Sizes (device px) that sprites of node images are made at. */
const SPRITE_SIZES = [16, 32, 64, 128, 256, 512, 1024];

/** Most sprites built in one frame. Nodes past the limit reuse a nearby
    sprite (or the uncached path) until a later frame builds theirs. */
const MAX_SPRITE_BUILDS_PER_FRAME = 16;

/**
 * A sprite is one cached copy of a node image at one size from
 * `SPRITE_SIZES`: square, centre-cropped and already clipped to a circle, so
 * drawing it is a single `drawImage()`. Each image can have several sprites,
 * one per size it has been drawn at. An `ImageBitmap` where `OffscreenCanvas`
 * is available, otherwise a canvas.
 * @typedef {ImageBitmap | Canvas} Sprite
 */

/**
 * Cached sprites of one image source, keyed by size, and its average
 * colour: `undefined` until computed, `null` if unreadable (e.g. a
 * cross-origin image).
 * @typedef {{ sprites: Map<number, Sprite>, avg: string | null | undefined }} SpriteEntry
 */

/**
 * Picks the sprite size to draw an image at: the smallest size at least
 * as large as the on-screen size, but never larger than the source.
 * @param {number} needed - on-screen diameter in device px
 * @param {number} side - shorter side of the source image
 * @returns {number} sprite size in px
 */
export const pickSpriteSize = (needed, side) => {
  let max = side < SPRITE_SIZES[0] ? Math.max(1, Math.floor(side)) : SPRITE_SIZES[0];
  for (const t of SPRITE_SIZES) if (t <= side) max = t;
  for (const t of SPRITE_SIZES) if (t >= needed) return Math.min(t, max);
  return max;
};

/**
 * Gets a canvas's 2D context. Typed through a cast because `getContext` on a
 * `HTMLCanvasElement | OffscreenCanvas` union resolves unreliably in tsc.
 * @param {Canvas} canvas - canvas
 * @returns {CanvasContext | null} 2D context
 */
const ctx2d = canvas => /** @type {CanvasContext | null} */ (canvas.getContext("2d"));


/**
 * Node images and their sprites: loads images by source, and caches each at
 * the sizes it's drawn at, pre-clipped to a circle, within a memory budget.
 * The renderer brackets each frame with `beginFrame()` and `endFrame()`, which
 * limit how many sprites a frame builds and evict the least recently drawn.
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


  /**
   * Pre-clipped sprites and average colours, keyed by image source.
   * @type {Map<string, SpriteEntry>}
   * @private
   */
  _spriteCache = new Map();


  /**
   * Recency order of cached sprites, least recently used first, keyed
   * `size:src`. `frame` is the last frame the sprite was drawn in.
   * @type {Map<string, { src: string, size: number, bytes: number, frame: number }>}
   * @private
   */
  _spriteLru = new Map();


  /** Total bytes held by cached sprites. @type {number} @private */
  _spriteBytes = 0;


  /** Counter incremented once per `beginFrame()`. @type {number} @private */
  _frameId = 0;


  /** Sprites built during the current frame. @type {number} @private */
  _spriteBuilds = 0;


  /**
   * Reusable canvases sprites are built in, one per size. Only used with
   * `OffscreenCanvas`, whose builds are handed off as `ImageBitmap`s.
   * @type {Map<number, OffscreenCanvas>}
   * @private
   */
  _spriteCanvases = new Map();


  /**
   * Scratch canvases for shrinking images by halves. Dropped after a frame
   * that used them, so large sources don't pin memory.
   * @type {Canvas[]}
   * @private
   */
  _imgScratch = [];


  /**
   * Called when a request settles, after its entry is updated. Not called
   * for a request whose entry was collected before it settled.
   * @type {((src: string, entry: Readonly<ImageEntry>) => void) | undefined}
   * @private
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
   * Starts loading an image, keyed by its source. A source that is loading
   * or loaded is not requested again, and neither is one that failed unless
   * `retry` is set.
   * @param {string} src - image source; also the cache key
   * @param {"anonymous" | "use-credentials" | null} crossOrigin - the request's
   *    `crossOrigin`
   * @param {ReferrerPolicy} referrerPolicy - the request's `referrerPolicy`
   * @param {boolean} [retry=false] - whether to request a failed source again
   * @returns {boolean} `true` if a request was started, `false` if `src` was
   *    already cached and not retried
   */
  load(src, crossOrigin, referrerPolicy, retry = false) {
    const status = this._images.get(src)?.status;
    if (status === "loading" || status === "loaded") return false;
    if (status === "failed" && !retry) return false;

    /** @type {Readonly<ImageEntry>} */
    const loading = Object.freeze({ status: "loading", image: null });
    this._images.set(src, loading);
    const img = new Image();
    img.crossOrigin = crossOrigin;
    img.referrerPolicy = referrerPolicy;
    // Only if this request's entry is still there: an entry collected in the
    // meantime mustn't be brought back by a late load
    /** @param {Readonly<ImageEntry>} entry */
    const settle = entry => {
      if (this._images.get(src) !== loading) return;
      this._images.set(src, entry);
      this._onSettle?.(src, entry);
    };
    img.onload  = () => settle(Object.freeze({ status: "loaded", image: img }));
    img.onerror = () => settle(Object.freeze({ status: "failed", image: null }));
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
    for (const src of this._images.keys()) {
      if (live.has(src)) continue;
      this._images.delete(src);
      this._dropSprites(src);
    }
  }


  /**
   * Starts a frame: resets the frame's sprite build limit.
   * @returns {void}
   */
  beginFrame() {
    this._frameId++;
    this._spriteBuilds = 0;
  }


  /**
   * Ends a frame: evicts sprites to fit the budget, and drops the scratch
   * canvases if this frame built sprites.
   * @param {number} budgetBytes - memory budget for cached sprites
   * @returns {void}
   */
  endFrame(budgetBytes) {
    this._evictSprites(budgetBytes);
    if (this._spriteBuilds) this._imgScratch = [];
  }


  /**
   * Returns a sprite of `src` to draw at `size`, building it if this
   * frame's build limit allows, otherwise the nearest cached sprite
   * (larger first). Marks the returned sprite as used this frame.
   * @param {string} src - image source
   * @param {HTMLImageElement} img - loaded source image
   * @param {number} size - wanted sprite size
   * @returns {Sprite | null} sprite, or `null` if none is available
   */
  sprite(src, img, size) {
    let entry = this._spriteCache.get(src);
    if (!entry) {
      entry = { sprites: new Map(), avg: undefined };
      this._spriteCache.set(src, entry);
    }

    let sprite = entry.sprites.get(size);
    if (!sprite && this._spriteBuilds < MAX_SPRITE_BUILDS_PER_FRAME) {
      const built = this._buildSprite(img, entry, size);
      if (built) {
        this._spriteBuilds++;
        sprite = built;
        entry.sprites.set(size, built);
        const bytes = size * size * 4;
        this._spriteLru.set(`${size}:${src}`, { src, size, bytes, frame: this._frameId });
        this._spriteBytes += bytes;
      }
    }

    // Over the build limit: the nearest cached sprite, preferring larger
    if (!sprite) {
      let best = 0;
      for (const t of entry.sprites.keys()) {
        const better = !best
          || (t >= size && (best < size || t < best))   // smallest larger
          || (t < size && best < size && t > best);     // else largest smaller
        if (better) best = t;
      }
      if (!best) return null;
      size = best;
      sprite = entry.sprites.get(best);
    }

    const key = `${size}:${src}`;
    const rec = this._spriteLru.get(key);
    if (rec) {
      this._spriteLru.delete(key);
      rec.frame = this._frameId;
      this._spriteLru.set(key, rec);
    }
    return sprite ?? null;
  }


  /**
   * Average colour of an image for drawing it as a dot, building its
   * smallest sprite first if needed. `null` if unavailable.
   * @param {string} src - image source
   * @param {HTMLImageElement} img - loaded source image
   * @returns {string | null} CSS colour
   */
  average(src, img) {
    const avg = this._spriteCache.get(src)?.avg;
    if (avg !== undefined) return avg;
    this.sprite(src, img, pickSpriteSize(0, Math.min(img.width, img.height)));
    return this._spriteCache.get(src)?.avg ?? null;
  }


  /**
   * Creates a canvas for building sprites, or returns `null` where no
   * canvas can be made (e.g. Node), in which case images are drawn uncached.
   * @param {number} w - width
   * @param {number} h - height
   * @returns {Canvas | null} new canvas
   * @private
   */
  _createCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const doc = globalThis.document;
    if (typeof doc?.createElement !== "function") return null;
    const canvas = doc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }


  /**
   * Returns scratch canvas `i`, grown to at least `size` square.
   * @param {number} i - scratch slot (0 or 1)
   * @param {number} size - minimum side
   * @returns {Canvas | null} scratch canvas
   * @private
   */
  _scratchCanvas(i, size) {
    const s = this._imgScratch[i];
    if (s && s.width >= size && s.height >= size) return s;
    const c = this._createCanvas(size, size);
    if (c) this._imgScratch[i] = c;
    return c;
  }


  /**
   * Returns the canvas to build a sprite of `size` in. With
   * `OffscreenCanvas`, one canvas per size is reused: each build is handed
   * off with `transferToImageBitmap()`, which also leaves the canvas blank.
   * Otherwise each sprite needs its own canvas.
   * @param {number} size - sprite size
   * @returns {Canvas | null} build canvas
   * @private
   */
  _spriteCanvas(size) {
    if (typeof OffscreenCanvas === "undefined") return this._createCanvas(size, size);
    let canvas = this._spriteCanvases.get(size);
    if (!canvas) {
      canvas = new OffscreenCanvas(size, size);
      this._spriteCanvases.set(size, canvas);
    }
    return canvas;
  }


  /**
   * Builds a pre-clipped square sprite: centre-cropped, shrunk by halves
   * (each step at most 2x, to avoid aliasing), then masked to a circle.
   * Starts from the smallest cached sprite larger than `size` when there
   * is one, rather than the full source. Also fills in the entry's average
   * colour from the first sprite of 64 px or less.
   * @param {HTMLImageElement} img - loaded source image
   * @param {SpriteEntry} entry - cache entry for `img`
   * @param {number} size - sprite size in px
   * @returns {Sprite | null} the sprite, or `null` if no canvas could be made
   * @private
   */
  _buildSprite(img, entry, size) {
    const out = this._spriteCanvas(size);
    const outCtx = out && ctx2d(out);
    if (!out || !outCtx) return null;

    /** @type {CanvasImageSource} */
    let src = img;
    let cur = Math.min(img.width, img.height);
    let sx = (img.width - cur) / 2, sy = (img.height - cur) / 2;
    for (const [t, sprite] of entry.sprites) {
      if (t > size && t < cur) { src = sprite; cur = t; sx = sy = 0; }
    }

    for (let k = 0; cur > 2 * size; k ^= 1) {
      const half = Math.ceil(cur / 2);
      const scratch = this._scratchCanvas(k, half);
      const sCtx = scratch && ctx2d(scratch);
      if (!sCtx) return null;
      sCtx.clearRect(0, 0, half, half);
      sCtx.imageSmoothingQuality = "high";
      sCtx.drawImage(src, sx, sy, cur, cur, 0, 0, half, half);
      src = /** @type {Canvas} */ (scratch);
      sx = sy = 0;
      cur = half;
    }

    outCtx.clearRect(0, 0, size, size);
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(src, sx, sy, cur, cur, 0, 0, size, size);

    // Pre-clip: keep only the pixels inside the circle
    outCtx.globalCompositeOperation = "destination-in";
    outCtx.beginPath();
    outCtx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
    outCtx.fill();
    outCtx.globalCompositeOperation = "source-over";

    // Pixels can only be read before the hand-off below
    if (size <= 64 && entry.avg === undefined) entry.avg = this._averageColor(out);

    return "transferToImageBitmap" in out ? out.transferToImageBitmap() : out;
  }


  /**
   * Alpha-weighted average colour of a small canvas, or `null` when its
   * pixels can't be read (a canvas tainted by a cross-origin image throws).
   * @param {Canvas} canvas - canvas (at most 64 px)
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
   * @param {string} src - image source
   * @param {number} size - sprite size
   * @returns {void}
   * @private
   */
  _deleteSprite(src, size) {
    const entry = this._spriteCache.get(src);
    const sprite = entry?.sprites.get(size);
    if (sprite && "close" in sprite) sprite.close();   // frees now, not at GC
    entry?.sprites.delete(size);
    const key = `${size}:${src}`;
    const rec = this._spriteLru.get(key);
    if (rec) this._spriteBytes -= rec.bytes;
    this._spriteLru.delete(key);
  }


  /**
   * Evicts least recently used sprites until within the budget, stopping at
   * the first one drawn this frame: what is on screen always stays cached.
   * @param {number} budgetBytes - memory budget for cached sprites
   * @returns {void}
   * @private
   */
  _evictSprites(budgetBytes) {
    for (const rec of this._spriteLru.values()) {
      if (this._spriteBytes <= budgetBytes || rec.frame === this._frameId) break;
      this._deleteSprite(rec.src, rec.size);
    }
  }


  /**
   * Drops every cached sprite of an image source.
   * @param {string} src - image source
   * @returns {void}
   * @private
   */
  _dropSprites(src) {
    const entry = this._spriteCache.get(src);
    if (!entry) return;
    for (const size of [...entry.sprites.keys()]) this._deleteSprite(src, size);
    this._spriteCache.delete(src);
  }
}
