/* Minimal DOM stubs so the library can be exercised under `node --test`.
   No jsdom: the renderer only needs a 2D context, and the only browser
   globals touched are Image (loading) and window.devicePixelRatio (resize). */

/* A recording 2D context. `ops` is an ordered log of [name, ...args], which
   lets tests assert on geometry rather than on pixels.

   drawImage deliberately mimics the browser's strictness: passing a non-image
   or a non-finite coordinate throws, which is how a sentinel string leaking
   into the draw path gets caught. */
export function makeCtx() {
  const ops = [];
  const log = name => (...args) => { ops.push([name, ...args]); };
  return {
    ops,
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    beginPath: log("beginPath"),
    closePath: log("closePath"),
    moveTo: log("moveTo"),
    lineTo: log("lineTo"),
    quadraticCurveTo: log("quadraticCurveTo"),
    arc: log("arc"),
    stroke: log("stroke"),
    fill: log("fill"),
    fillRect: log("fillRect"),
    clip: log("clip"),
    save: log("save"),
    restore: log("restore"),
    setTransform: log("setTransform"),
    drawImage(src, ...rest) {
      ops.push(["drawImage", src, ...rest]);
      if (typeof src === "string" || src == null)
        throw new TypeError(`drawImage: argument 1 is not a CanvasImageSource (got ${JSON.stringify(src)})`);
      for (const v of rest)
        if (!Number.isFinite(v)) throw new TypeError(`drawImage: non-finite argument ${v}`);
    },
  };
}

export function makeCanvas({ w = 800, h = 600 } = {}) {
  const ctx = makeCtx();
  return {
    width: w, height: h, clientWidth: w, clientHeight: h,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    ctx,
  };
}

/* Installs a fake Image whose load resolves on a microtask. `fail(src)`
   decides which sources error. Returns a restore function. */
export function installImage({ fail = () => false, size = 64 } = {}) {
  const prev = globalThis.Image;
  globalThis.Image = class {
    constructor() { this.width = size; this.height = size; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; queueMicrotask(() => (fail(v) ? this.onerror?.() : this.onload?.())); }
    get src() { return this._src; }
  };
  return () => { globalThis.Image = prev; };
}

export function installWindow(devicePixelRatio = 1) {
  const prev = globalThis.window;
  globalThis.window = { devicePixelRatio };
  return () => { globalThis.window = prev; };
}

/* requestAnimationFrame that never actually fires, so start()/stop() can be
   tested without running frames. `frames` collects the queued callbacks. */
export function installRaf() {
  const prev = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  const pending = new Map();
  let next = 1;
  globalThis.requestAnimationFrame = cb => { const id = next++; pending.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  return {
    pending,
    restore() { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = prev; },
  };
}

export const opsNamed = (ctx, name) => ctx.ops.filter(o => o[0] === name);
export const flush = () => new Promise(r => setTimeout(r, 0));
export const r2 = n => Number(n.toFixed(2));
