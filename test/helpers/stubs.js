/* Minimal DOM stubs so the library can be exercised under `node --test`.
   No jsdom: the renderer only needs a 2D context, and the only browser
   globals touched are Image (loading) and window.devicePixelRatio (resize). */

/* A recording 2D context. `ops` is an ordered log of [name, ...args], which
   lets tests assert on geometry rather than on pixels.

   drawImage deliberately mimics the browser's strictness: passing a non-image
   or a non-finite coordinate throws, which is how a sentinel string leaking
   into the draw path gets caught.

   setTransform is logged and also kept in `transform` as [a, b, c, d, e, f].

   Text is deterministic: every glyph is half the font's px size wide, so a
   label's width is `text.length * size / 2`. fillText logs where the text
   lands and how big it is after the current transform (device px), plus the
   text state it was drawn with: [ "fillText", text, x, y, { font, size,
   fillStyle, textAlign, textBaseline } ]. measureText logs the text and font,
   so tests can count measurements. */
export function makeCtx() {
  const ops = [];
  const log = name => (...args) => { ops.push([name, ...args]); };
  return {
    ops,
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
    transform: [1, 0, 0, 1, 0, 0],
    setTransform(...m) {
      ops.push(["setTransform", ...m]);
      this.transform = m;
    },
    fillText(text, x, y) {
      const [a, b, c, d, e, f] = this.transform;
      ops.push(["fillText", text, a * x + c * y + e, b * x + d * y + f, {
        font: this.font, size: parseFloat(this.font) * Math.hypot(a, b),
        fillStyle: this.fillStyle, textAlign: this.textAlign, textBaseline: this.textBaseline,
      }]);
    },
    measureText(text) {
      ops.push(["measureText", text, this.font]);
      return { width: text.length * parseFloat(this.font) / 2 };
    },
    beginPath: log("beginPath"),
    closePath: log("closePath"),
    moveTo: log("moveTo"),
    lineTo: log("lineTo"),
    quadraticCurveTo: log("quadraticCurveTo"),
    arc: log("arc"),
    stroke: log("stroke"),
    fill: log("fill"),
    fillRect: log("fillRect"),
    clearRect: log("clearRect"),
    clip: log("clip"),
    save: log("save"),
    restore: log("restore"),
    drawImage(src, ...rest) {
      ops.push(["drawImage", src, ...rest]);
      if (typeof src === "string" || src == null)
        throw new TypeError(`drawImage: argument 1 is not a CanvasImageSource (got ${JSON.stringify(src)})`);
      for (const v of rest)
        if (!Number.isFinite(v)) throw new TypeError(`drawImage: non-finite argument ${v}`);
    },
  };
}

/* An on-screen canvas. It's a real EventTarget, so interaction tests can
   dispatch events at it (see `dispatchPointer()`), and `listenerCount()`
   shows how many listeners are on it. `left`/`top` offset its bounding rect,
   so client and canvas coordinates differ. `captured` holds the pointer ids
   currently captured. */
export function makeCanvas({ w = 800, h = 600, left = 0, top = 0 } = {}) {
  const ctx = makeCtx();
  const target = new EventTarget();
  const listeners = new Map();
  const captured = new Set();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  return Object.assign(target, {
    width: w, height: h, clientWidth: w, clientHeight: h,
    style: { touchAction: "" },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left, top, width: w, height: h }),
    ctx,
    captured,
    setPointerCapture(id) { captured.add(id); },
    releasePointerCapture(id) { captured.delete(id); },
    // Tracks listeners by type, dropping them when their signal aborts. Sets,
    // because Node also calls removeEventListener itself on abort.
    addEventListener(type, f, opts) {
      add(type, f, opts);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(f);
      opts?.signal?.addEventListener("abort", () => listeners.get(type).delete(f));
    },
    removeEventListener(type, f, opts) {
      remove(type, f, opts);
      listeners.get(type)?.delete(f);
    },
    listenerCount(type) {
      if (type) return listeners.get(type)?.size ?? 0;
      return [...listeners.values()].reduce((n, set) => n + set.size, 0);
    },
  });
}

/* Dispatches a DOM-like event at a canvas: a cancelable Event with the mouse,
   pointer and wheel fields the library reads. `x`/`y` are client
   coordinates. Returns the event, so tests can check `defaultPrevented`. */
export function dispatchPointer(canvas, type, {
  x = 0, y = 0, pointerId = 1, button = 0, isPrimary = true, pointerType = "mouse",
  deltaY = 0, deltaMode = 0,
} = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId, button, isPrimary, pointerType, deltaY, deltaMode });
  canvas.dispatchEvent(e);
  return e;
}

/* Installs a fake Image whose load resolves on a microtask. `fail(src)`
   decides which sources error. Returns a restore function. */
/* `restore.requests` lists every load as it was sent: `crossOrigin` and
   `referrerPolicy` are read when `src` is assigned, because that is when a
   browser starts the request. Anything set afterwards doesn't affect it, so a
   test asserting on this list also catches options applied too late. */
/* Also installs a fake createImageBitmap, unless `bitmap` is false (as in
   Node, which lacks it). It returns a fake bitmap of the cropped, resized
   region, recording the `image` it came from, the `crop` [sx, sy, sw, sh]
   (null when called without one, as `createImageBitmap(image, opts)`) and
   whether close() was called; `restore.sources` lists them in creation order.
   `bitmapFails(src)` decides which sources it rejects, and `decodeFails(src)`
   which ones `decode()` rejects. */
export function installImage({
  fail = () => false, size = 64, width = size, height = size,
  bitmap = true, bitmapFails = () => false, decodeFails = () => false,
} = {}) {
  const prev = globalThis.Image;
  const hadBitmap = "createImageBitmap" in globalThis, prevBitmap = globalThis.createImageBitmap;
  const requests = [], sources = [];
  globalThis.Image = class {
    constructor() {
      this.width = this.naturalWidth = width;
      this.height = this.naturalHeight = height;
      this.onload = null; this.onerror = null;
    }
    set src(v) {
      this._src = v;
      requests.push({ src: v, crossOrigin: this.crossOrigin, referrerPolicy: this.referrerPolicy });
      queueMicrotask(() => (fail(v) ? this.onerror?.() : this.onload?.()));
    }
    get src() { return this._src; }
    decode() {
      return decodeFails(this._src)
        ? Promise.reject(new DOMException("The source image cannot be decoded.", "EncodingError"))
        : Promise.resolve();
    }
  };
  if (bitmap) {
    globalThis.createImageBitmap = async (image, ...args) => {
      if (bitmapFails(image._src)) throw new DOMException("The source image could not be decoded.", "InvalidStateError");
      const crop = args.length >= 4 ? args.slice(0, 4) : null;
      const opts = crop ? args[4] : args[0];
      const b = {
        width: opts?.resizeWidth ?? crop?.[2] ?? image.width, height: opts?.resizeHeight ?? crop?.[3] ?? image.height,
        image, crop, opts, closed: false,
        close() { this.closed = true; this.width = this.height = 0; },
      };
      sources.push(b);
      return b;
    };
  } else delete globalThis.createImageBitmap;
  const restore = () => {
    globalThis.Image = prev;
    if (hadBitmap) globalThis.createImageBitmap = prevBitmap;
    else delete globalThis.createImageBitmap;
  };
  restore.requests = requests;
  restore.sources = sources;
  return restore;
}

/* Installs a fake OffscreenCanvas, which Node lacks, so the renderer can build
   sprites. Each canvas gets its own recording context; writes to
   globalCompositeOperation are logged into its ops so tests can check the
   pre-clip mask. getImageData returns one pixel of `avg` (enough for an
   average), or throws like a cross-origin-tainted canvas when `tainted`.
   `restore.created` lists every canvas in creation order.

   transferToImageBitmap() returns a fake bitmap recording the canvas it came
   from (`source`) and whether close() was called; `restore.bitmaps` lists
   them in creation order. */
export function installOffscreenCanvas({ avg = [10, 20, 30, 255], tainted = false } = {}) {
  const had = "OffscreenCanvas" in globalThis, prev = globalThis.OffscreenCanvas;
  const created = [], bitmaps = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      const ctx = makeCtx();
      let gco = "source-over";
      Object.defineProperty(ctx, "globalCompositeOperation", {
        get: () => gco,
        set: v => { gco = v; ctx.ops.push(["globalCompositeOperation", v]); },
      });
      ctx.imageSmoothingQuality = "low";
      ctx.getImageData = () => {
        if (tainted) throw new DOMException("The canvas has been tainted", "SecurityError");
        return { data: Uint8ClampedArray.from(avg) };
      };
      this.ctx = ctx;
      created.push(this);
    }
    getContext() { return this.ctx; }
    transferToImageBitmap() {
      const bitmap = {
        width: this.width, height: this.height, source: this, closed: false,
        close() { this.closed = true; },
      };
      bitmaps.push(bitmap);
      return bitmap;
    }
  };
  const restore = () => {
    if (had) globalThis.OffscreenCanvas = prev;
    else delete globalThis.OffscreenCanvas;
  };
  restore.created = created;
  restore.bitmaps = bitmaps;
  return restore;
}

/* In a browser `window` *is* the global object, so `window.devicePixelRatio`
   and `globalThis.devicePixelRatio` are the same value. Mirror that, so code
   reading either form sees the stubbed ratio. Code should read the
   `globalThis` form: `window` does not exist in workers or Node. */
export function installWindow(devicePixelRatio = 1) {
  const prev = [globalThis.window, globalThis.devicePixelRatio];
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = devicePixelRatio;
  return () => { [globalThis.window, globalThis.devicePixelRatio] = prev; };
}

/* A manually driven requestAnimationFrame. Nothing runs until `flushFrame()`
   is called, so loop behaviour is deterministic: `pending.size` shows whether
   a frame is queued, and each flush advances the loop exactly one step. */
export function installRaf() {
  const prev = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  const pending = new Map();
  let next = 1;
  globalThis.requestAnimationFrame = cb => { const id = next++; pending.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  return {
    pending,
    /* Runs every queued callback once. Callbacks that re-queue land in the
       next flush rather than looping forever. Frame i is passed the timestamp
       `t0 + i * dt`, like the ms timestamp a browser hands to rAF callbacks. */
    flushFrame(times = 1, { t0 = 0, dt = 1 } = {}) {
      for (let i = 0; i < times; i++) {
        const due = [...pending.entries()];
        pending.clear();
        for (const [, cb] of due) cb(t0 + i * dt);
      }
    },
    restore() { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = prev; },
  };
}

export const opsNamed = (ctx, name) => ctx.ops.filter(o => o[0] === name);
export const flush = () => new Promise(r => setTimeout(r, 0));
export const r2 = n => Number(n.toFixed(2));
