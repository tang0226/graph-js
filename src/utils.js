export const asFn = v => (typeof v === "function" ? v: () => v);
export const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
export const circleRectCollision = (cx, cy, cr, xMin, xMax, yMin, yMax) =>
  (cx - clamp(cx, xMin, xMax)) ** 2 + (cy - clamp(cy, yMin, yMax)) ** 2 < cr * cr;
