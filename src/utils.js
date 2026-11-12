/**
 * Normalizes a value into a function: a function passes through, anything
 * else becomes a function that returns it.
 * @template T
 * @template {any[]} A
 * @param {T | ((...args: A) => T)} v
 * @returns {(...args: A) => T}
 */
export const asFn = v =>
  typeof v === "function" ?
    /** @type {(...args: A) => T} */ (v) :
    () => v;


/**
 * Clamps a value to a given range.
 * @param {number} val - value to clamp
 * @param {number} min - min of clamp range
 * @param {number} max - max of clamp range
 * @returns {number} clamped value
 */
export const clamp = (val, min, max) => Math.min(Math.max(val, min), max);


/**
 * Lists a record's keys, typed as its key type, in a frozen array. Declaring
 * the record as `Record<Name, true>` makes the type checker require every
 * name, and reject any other, so the list can't fall out of step with `Name`.
 * @template {string} K
 * @param {Record<K, true>} record - one key per name
 * @returns {readonly K[]} the names
 */
export const keysOf = record => Object.freeze(/** @type {K[]} */ (Object.keys(record)));


/**
 * Whether a value is a plain object: made by an object literal or
 * `Object.create(null)`, so spreading it copies everything that matters.
 * @param {unknown} v - value to check
 * @returns {v is Record<string, any>} whether `v` is a plain object
 */
export const isPlainObject = v => {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};


/**
 * Current time in milliseconds, for frame timestamps: `performance.now()`
 * where it exists, otherwise `Date.now()`.
 * @returns {number} timestamp in milliseconds
 */
export const now = () => globalThis.performance?.now() ?? Date.now();


/**
 * Copies a typed array into a new, larger one of the same type.
 * @param {Float64Array} a - array to copy
 * @param {number} n - new length
 * @returns {Float64Array} new array
 */
export const growF64 = (a, n) => { const b = new Float64Array(n); b.set(a); return b; };


/**
 * Copies a typed array into a new, larger one of the same type.
 * @param {Int32Array} a - array to copy
 * @param {number} n - new length
 * @returns {Int32Array} new array
 */
export const growI32 = (a, n) => { const b = new Int32Array(n); b.set(a); return b; };


/**
 * Determines if a circle and rectangle in the coordinate plane are colliding.
 * @param {number} cx - x coordinate of circle
 * @param {number} cy - y coordinate of circle
 * @param {number} cr - radius of circle
 * @param {number} xMin - min x of rect
 * @param {number} xMax - max x of rect
 * @param {number} yMin - min y of rect
 * @param {number} yMax - max y of tect
 * @returns {boolean} whether the circle and rectangle are colliding
 */
export const circleRectCollision = (cx, cy, cr, xMin, xMax, yMin, yMax) =>
  (cx - clamp(cx, xMin, xMax)) ** 2 + (cy - clamp(cy, yMin, yMax)) ** 2 < cr * cr;
