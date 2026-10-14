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
