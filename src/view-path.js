/** @import { View } from './typedefs/renderer.js' */

/*
 * Camera paths between two views, for `GraphJS.fitView()` and `focusNode()`.
 *
 * Paths are worked out in terms of the visible width w = 1 / zoom (simulation
 * units per canvas px) and run over a progress p from 0 to 1:
 *
 *   ln w(p) = ln w0 + E(p),   E(p) = b p + 4 H p (1 - p),   b = ln(w1 / w0)
 *
 * With H = 0 the zoom changes at a steady exponential rate, so zooming 0.1 ->
 * 1 takes as long as 1 -> 10. H > 0 adds a bump that zooms out on the way and
 * back in, which shortens long pans.
 *
 * The pan is kept at a steady speed *on screen*. A step of the view centre in
 * simulation units moves the picture by that step / w canvas px, so the
 * centre moves at a rate proportional to w(p):
 *
 *   u(p) = integral of w from 0 to p / integral of w from 0 to 1
 *
 * which pans less while zoomed in, and more while zoomed out. With H = 0 this
 * is u(p) = (1 - r^-p) / (1 - r^-1) for a zoom ratio r.
 *
 * H trades the two kinds of motion off. It minimises
 *
 *   (zoom travel, in e-folds) + zoomOut * (pan travel on screen, in views)
 *
 * The pan travel on screen is the distance over the mean of w along the path,
 * so zooming out further makes it shorter, but adds zoom travel twice: out
 * and back in. Short moves don't zoom out at all, and the further the target
 * (relative to how much of the graph either end shows), the further it zooms
 * out. `zoomOut` = 0 never zooms out past the two ends.
 */


/** Steps used to integrate w(p) */
const STEPS = 64;

/** Golden-section iterations used to find H */
const SEARCH_ITERATIONS = 40;


/**
 * Integral over a step of length `h` of exp(e), where e runs linearly from
 * `e0` to `e1`. Exact for a linear exponent; `expm1` keeps it accurate when
 * the exponent barely changes. `h` may be negative, to integrate backwards.
 * @param {number} e0 - exponent at the start of the step
 * @param {number} e1 - exponent at the end of the step
 * @param {number} h - length of the step
 * @returns {number} the integral
 */
function expStep(e0, e1, h) {
  const de = e1 - e0;
  return de === 0 ? h * Math.exp(e0) : h * Math.exp(e0) * Math.expm1(de) / de;
}


/**
 * The exponent E(p) of the visible width, relative to the start.
 * @param {number} b - ln(w1 / w0)
 * @param {number} H - height of the zoom-out bump, in e-folds
 * @param {number} p - progress
 * @returns {number} E(p)
 */
const exponent = (b, H, p) => b * p + 4 * H * p * (1 - p);


/**
 * Integral of exp(E) from 0 to 1, in `STEPS` steps that are each exact for a
 * linear exponent (so exact when H = 0).
 * @param {number} b - ln(w1 / w0)
 * @param {number} H - bump height
 * @returns {number} the integral: the mean visible width over w0
 */
function meanWidth(b, H) {
  let sum = 0, e0 = 0;
  for (let i = 1; i <= STEPS; i++) {
    const e1 = exponent(b, H, i / STEPS);
    sum += expStep(e0, e1, 1 / STEPS);
    e0 = e1;
  }
  return sum;
}


/**
 * Total zoom travel in e-folds: how far ln w moves, out and back.
 * @param {number} b - ln(w1 / w0)
 * @param {number} H - bump height
 * @returns {number} zoom travel
 */
function zoomTravel(b, H) {
  if (H <= 0) return Math.abs(b);
  const p = (b + 4 * H) / (8 * H);           // where E stops rising
  if (p <= 0 || p >= 1) return Math.abs(b);  // no turn inside the path
  const peak = exponent(b, H, p);
  return Math.abs(peak) + Math.abs(b - peak);
}


/**
 * The bump height that best trades zoom travel for pan travel.
 * @param {number} b - ln(w1 / w0)
 * @param {number} dist - pan distance in views at the starting zoom
 * @param {number} zoomOut - weight of a view of pan against an e-fold of zoom
 * @returns {number} H, 0 or more
 */
function bumpHeight(b, dist, zoomOut) {
  if (!(zoomOut > 0) || !(dist > 0)) return 0;
  const cost = (/** @type {number} */ H) => zoomTravel(b, H) + zoomOut * dist / meanWidth(b, H);
  // The best bump zooms out by about zoomOut * (pan without one) / 2, so this
  // range holds it with room to spare. The cost has one minimum.
  let lo = 0, hi = Math.log(1 + zoomOut * dist / meanWidth(b, 0)) + 2;
  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const m1 = hi - (hi - lo) * 0.618034, m2 = lo + (hi - lo) * 0.618034;
    if (cost(m1) <= cost(m2)) hi = m2; else lo = m1;
  }
  const H = (lo + hi) / 2;
  return cost(0) <= cost(H) ? 0 : H;         // exactly 0 when no bump helps
}


/**
 * Plans a camera move from one view to another, returning the view at each
 * point of progress. Progress 0 and 1 give the two views exactly; values
 * outside that range, from easings that overshoot, continue the path.
 *
 * Distances are measured in views: a pan across the canvas's width, or its
 * height, counts as 1, whatever the canvas's shape.
 * @param {View} from - starting view
 * @param {View} to - ending view
 * @param {number} width - canvas width, in CSS px
 * @param {number} height - canvas height, in CSS px
 * @param {number} [zoomOut=0] - how readily the move zooms out to shorten a
 *    long pan: the weight of one view of pan against one e-fold of zoom. 0
 *    never zooms out past the two ends.
 * @returns {(p: number) => View} the view at progress `p`
 */
export function viewPath(from, to, width, height, zoomOut = 0) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const b = Math.log(from.zoom / to.zoom);   // ln(w1 / w0)
  // Pan distance in views at the starting zoom
  const dist = Math.hypot(dx / width, dy / height) * from.zoom;
  const H = bumpHeight(b, dist, zoomOut);

  // Exponent at each step, and the integral of exp(E) up to each step
  const e = new Float64Array(STEPS + 1), area = new Float64Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) e[i] = exponent(b, H, i / STEPS);
  for (let i = 1; i <= STEPS; i++) area[i] = area[i - 1] + expStep(e[i - 1], e[i], 1 / STEPS);
  const total = area[STEPS];

  return p => {
    if (p === 0) return { ...from };
    if (p === 1) return { ...to };
    // Integral of exp(E) up to p, exponent linear within the step. Progress
    // outside 0..1 extends the first or last step.
    const i = Math.min(Math.max(Math.floor(p * STEPS), 0), STEPS - 1);
    const t = p * STEPS - i;
    const u = (area[i] + expStep(e[i], e[i] + (e[i + 1] - e[i]) * t, t / STEPS)) / total;
    return {
      x: from.x + dx * u,
      y: from.y + dy * u,
      zoom: from.zoom * Math.exp(-exponent(b, H, p)),
    };
  };
}
