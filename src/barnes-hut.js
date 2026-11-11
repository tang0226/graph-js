/** @import {BarnesHutOpts, BarnesHutOptsInput} from './typedefs/simulation.js' */

import { growF64, growI32 } from "./utils.js";
import { BARNES_HUT_DEFAULTS } from "./defaults.js";
import { checkEach, checkKnownKeys, checkNumber } from "./validate.js";


/** Every Barnes-Hut option name */
const OPTION_NAMES = new Set(Object.keys(BARNES_HUT_DEFAULTS));


/**
 * Throws if Barnes-Hut options are invalid, without changing anything.
 * @param {string} owner - name that starts the error message
 * @param {BarnesHutOptsInput} opts - options to check
 * @param {string} [prefix] - prefix for option names in the message, such as
 *    "barnesHut."
 * @returns {void}
 * @throws {TypeError | RangeError} throws if an option is invalid
 */
export function checkBarnesHutOpts(owner, opts, prefix = "") {
  checkKnownKeys(owner, opts, OPTION_NAMES, prefix);
  /** @type {Record<keyof BarnesHutOpts, (v: any) => void>} */
  const rules = {
    // 0 is allowed: the cell pool grows from any capacity
    capacity: v => checkNumber(owner, prefix + "capacity", v, { min: 0, integer: true }),
    maxDepth: v => checkNumber(owner, prefix + "maxDepth", v, { min: 0, integer: true }),
    theta: v => checkNumber(owner, prefix + "theta", v, { min: 0 }),
  };
  checkEach(opts, rules);
}





/**
 * Internal Barnes-Hut class
 */
export class BarnesHutContext {
  /** @private @type {number} */
  _capacity = BARNES_HUT_DEFAULTS.capacity;
  /**
   * Cell pool capacity
   */
  get capacity() { return this._capacity; }

  /** @private @type {number} */
  _maxDepth = BARNES_HUT_DEFAULTS.maxDepth;
  /**
   * Max depth of quadtree
   */
  get maxDepth() { return this._maxDepth; }

  /** @private @type {number} */
  _theta = BARNES_HUT_DEFAULTS.theta;
  /**
   * Barnes-Hut theta value
   */
  get theta() { return this._theta; }

  /**
   * Current number of allocated cells
   * @type {number}
   * @private
   */
  _cellCount = 0;

  /**
   * Center x coordinate of cells
   * @type {Float64Array}
   * @private
   */
  _centerX = new Float64Array();

  /**
   * Center y coordinate of cells
   * @type {Float64Array}
   * @private
   */
  _centerY = new Float64Array();

  /**
   * Orthogonal distance from a cell's center to its edge
   * @type {Float64Array}
   * @private
   */
  _halfSize = new Float64Array();

  /**
   * Charge-weighted centroid x of a cell's bodies, or the cell's center x if
   * their total charge is 0. While `_build()` runs, it holds the sum of
   * charge * x, which is divided by total charge at the end.
   * @type {Float64Array}
   * @private
   */
  _centroidX = new Float64Array();

  /**
   * Charge-weighted centroid y of a cell's bodies, or the cell's center y if
   * their total charge is 0. While `_build()` runs, it holds the sum of
   * charge * y, which is divided by total charge at the end.
   * @type {Float64Array}
   * @private
   */
  _centroidY = new Float64Array();

  /**
   * Total charge of a cell's bodies.
   * @type {Float64Array}
   * @private
   */
  _centroidCharge = new Float64Array();

  /**
   * Number of bodies contained in a cell
   * @type {Int32Array}
   * @private
   */
  _bodyCount = new Int32Array();

  /**
   * Index of the cell's first child, or -1 if the cell is a leaf
   * @type {Int32Array}
   * @private
   */
  _childIndex = new Int32Array();

  /**
   * Body index of first body in a leaf cell, or -1 if the cell contains no bodies or is not a leaf.
   * @type {Int32Array}
   * @private
   */
  _bodyIndex = new Int32Array();

  /**
   * Largest radius of a cell's bodies. Only valid during `collide()`.
   * @type {Float64Array}
   * @private
   */
  _maxRadius = new Float64Array();

  /**
   * -1 for a normal body alone or last in a cell. If the body is in a multi-body leaf cell, its entry is a non-negative index pointing to the next body in the cell.
   * @type {Int32Array}
   * @private
   */
  _nextBody = new Int32Array();

  /**
   * Stack of cells to explore; used in `repel()` and `collide()`
   * @type {Int32Array}
   * @private
   */
  _cellStack = new Int32Array();


  /**
   * Initializes a Barnes-Hut context
   * @param {BarnesHutOptsInput} [opts={}] - options
   */
  constructor(opts = {}) {
    this.setOpts(opts);
    if (this._centerX.length === 0) this._reallocate();
  }


  /**
   * Sets options. Options left `undefined` keep their current value, and
   * nothing changes if any option is invalid.
   * @param {BarnesHutOptsInput} [opts={}] - options to set
   * @returns {void}
   * @throws {TypeError | RangeError} throws if an option is invalid
   */
  setOpts(opts = {}) {
    checkBarnesHutOpts("BarnesHutContext", opts);
    if (opts.capacity !== undefined) {
      this._capacity = opts.capacity;
      this._reallocate();
    }
    if (opts.maxDepth !== undefined) this._maxDepth = opts.maxDepth;
    if (opts.theta !== undefined) this._theta = opts.theta;
  }


  /**
   * Reallocates arrays according to a new capacity value.
   * @returns {void}
   * @private
   */
  _reallocate() {
    const c = this._capacity;
    this._cellCount = 0;
    this._centerX = new Float64Array(c);
    this._centerY = new Float64Array(c);
    this._halfSize = new Float64Array(c);
    this._centroidX = new Float64Array(c);
    this._centroidY = new Float64Array(c);
    this._centroidCharge = new Float64Array(c);
    this._bodyCount = new Int32Array(c);
    this._childIndex = new Int32Array(c);
    this._bodyIndex = new Int32Array(c);
    this._maxRadius = new Float64Array(c);
  }


  /**
   * Doubles size of cell arrays, preserving current values.
   * @returns {void}
   * @private
   */
  _doubleCapacity() {
    const n = Math.max(2 * this._capacity, 1);   // a capacity of 0 would never grow
    this._centerX = growF64(this._centerX, n);
    this._centerY = growF64(this._centerY, n);
    this._halfSize = growF64(this._halfSize, n);
    this._centroidX = growF64(this._centroidX, n);
    this._centroidY = growF64(this._centroidY, n);
    this._centroidCharge = growF64(this._centroidCharge, n);
    this._bodyCount = growI32(this._bodyCount, n);
    this._childIndex = growI32(this._childIndex, n);
    this._bodyIndex = growI32(this._bodyIndex, n);
    this._maxRadius = growF64(this._maxRadius, n);
    this._capacity = n;
  }


  /**
   * Adds a cell with the given data and returns the cell's index
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} halfSize
   * @returns {number} the index of the new cell
   * @private
   */
  _addCell(
    centerX, centerY, halfSize,
  ) {
    if (this._cellCount == this._capacity) this._doubleCapacity();
    const i = this._cellCount;
    this._centerX[i] = centerX;
    this._centerY[i] = centerY;
    this._halfSize[i] = halfSize;
    this._centroidX[i] = 0;
    this._centroidY[i] = 0;
    this._centroidCharge[i] = 0;
    this._bodyCount[i] = 0;
    this._childIndex[i] = -1;
    this._bodyIndex[i] = -1;
    this._cellCount++;
    return i;
  }


  /**
   * Gets the quadrant number for a point in a particular cell.
   * @param {number} x - x coordinate
   * @param {number} y - y coordinate
   * @param {number} i - index of cell
   * @returns {number} quadrant number (0-3)
   * @private
   */
  _getQuadrant(x, y, i) {
    return (y > this._centerY[i] ? 2 : 0) | (x > this._centerX[i] ? 1 : 0);
  }


  /**
   * Splits a leaf cell. Assumes that the cell is a splittable leaf
   * (not max-depth) containing one body. The existing body is moved to the
   * corresponding subcell. The function returns the subcell where the passed
   * coordinates belong.
   * @param {number} i - cell to split
   * @param {number} x - x coordinate of new body
   * @param {number} y - y coordinate of new body
   * @param {ArrayLike<number>} xs - x coordinates of all bodies
   * @param {ArrayLike<number>} ys - y coordinates of all bodies
   * @returns {number} cell to insert the body into
   * @private
   */
  _splitCell(i, x, y, xs, ys) {
    const cx = this._centerX[i],
          cy = this._centerY[i],
          half = this._halfSize[i] / 2;

    const childI = this._addCell(cx - half, cy - half, half);
    this._addCell(cx + half, cy - half, half);
    this._addCell(cx - half, cy + half, half);
    this._addCell(cx + half, cy + half, half);

    this._childIndex[i] = childI;

    // Subcell for the body already in the original cell. Its position is read
    // from the input: the cell's sums are weighted by charge, so they only
    // give the position back when its charge is 1.
    const b = this._bodyIndex[i];
    const otherI = childI + this._getQuadrant(xs[b], ys[b], i);
    this._bodyCount[otherI] = 1;
    this._centroidX[otherI] = this._centroidX[i];
    this._centroidY[otherI] = this._centroidY[i];
    this._centroidCharge[otherI] = this._centroidCharge[i];

    this._bodyIndex[otherI] = this._bodyIndex[i];
    this._bodyIndex[i] = -1;

    return childI + this._getQuadrant(x, y, i);
  }


  /**
   * Adds a body to the quadtree, splitting cells as necessary
   * @param {number} b - body index
   * @param {ArrayLike<number>} xs - x coordinates of all bodies
   * @param {ArrayLike<number>} ys - y coordinates of all bodies
   * @param {number} c - body charge
   * @returns {void}
   * @private
   */
  _addBody(b, xs, ys, c) {
    const x = xs[b], y = ys[b];
    let depth = 0;
    let i = 0;
    // Walk to leaf node
    while (this._childIndex[i] !== -1) {
      i = this._childIndex[i] + this._getQuadrant(x, y, i);
      depth++;
    }

    // Split cells until the two bodies are separate, or until max depth.
    while (depth < this._maxDepth && this._bodyCount[i] !== 0) {
      i = this._splitCell(i, x, y, xs, ys);
      depth++;
    }

    this._centroidX[i] += c * x;
    this._centroidY[i] += c * y;
    this._centroidCharge[i] += c;
    this._bodyCount[i]++;
    this._nextBody[b] = this._bodyIndex[i];
    this._bodyIndex[i] = b;
  }


  /**
   * Builds a quadtree from coordinate and charge lists. Each cell gets its
   * body count, total charge, and charge-weighted centroid.
   * @param {ArrayLike<number>} xs - x coordinates
   * @param {ArrayLike<number>} ys - y coordinates
   * @param {ArrayLike<number>} [cs] - non-negative charges; each defaults to 1
   * @throws {Error} throws when x, y, and charge arrays are not the same length
   * @returns {void}
   * @private
   */
  _build(xs, ys, cs) {
    if (xs.length !== ys.length || (cs && xs.length !== cs.length)) {
      throw new Error("BarnesHutContext: mismatching x, y, and/or charge array lengths");
    }

    this._cellCount = 0;
    if (xs.length === 0) return;

    if (this._nextBody.length !== xs.length) {
      this._nextBody = new Int32Array(xs.length);
    }
    // Opening a cell pops 1 and pushes 4, and only depths below maxDepth can open
    const stackSize = 3 * this._maxDepth + 1;
    if (this._cellStack.length !== stackSize) {
      this._cellStack = new Int32Array(stackSize);
    }


    let minX, maxX, minY, maxY;
    minX = maxX = xs[0];
    minY = maxY = ys[0];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i];
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
    }

    // Seed depth-0 cell
    const halfSize = Math.max(maxX - minX, maxY - minY, 1) / 2;
    this._addCell(minX + halfSize, minY + halfSize, halfSize);


    // Add bodies and create the quadtree structure
    for (let i = 0; i < xs.length; i++) {
      this._addBody(i, xs, ys, cs?.[i] ?? 1);
    }

    // Bottom-up sums
    for (let c = this._cellCount - 1; c >= 0; c--) {
      const k = this._childIndex[c];
      if (k === -1) continue;
      let n = 0, sx = 0, sy = 0, sc = 0;
      for (let q = k; q < k + 4; q++) {
        n += this._bodyCount[q];
        sx += this._centroidX[q];
        sy += this._centroidY[q];
        sc += this._centroidCharge[q];
      }
      this._bodyCount[c] = n;
      this._centroidX[c] = sx;
      this._centroidY[c] = sy;
      this._centroidCharge[c] = sc;
    }

    /* Divide weighted sums by total charge to get centroids. A cell with no
       charge exerts no far-field force, so any point inside it works for the
       theta test; its center is always defined. */
    for (let c = 0; c < this._cellCount; c++) {
      const q = this._centroidCharge[c];
      if (q > 0) {
        this._centroidX[c] /= q;
        this._centroidY[c] /= q;
      } else {
        this._centroidX[c] = this._centerX[c];
        this._centroidY[c] = this._centerY[c];
      }
    }
  }


  /**
   * Adds to force values for a series of bodies
   * @param {ArrayLike<number>} xs - x coordinates
   * @param {ArrayLike<number>} ys - y coordinates
   * @param {ArrayLike<number>} cs - non-negative charges
   * @param {Float64Array} fx - x force array to write to
   * @param {Float64Array} fy - y force array to write to
   * @param {object} params - parameters
   * @param {number} params.strength - repulsion strength
   * @param {number} params.minDistSq - min distance-squared clamp
   */
  repel(xs, ys, cs, fx, fy, { strength, minDistSq }) {
    this._build(xs, ys, cs);
    if (this._cellCount === 0) return;

    const cx = this._centerX, cy = this._centerY, hs = this._halfSize,
      cnx = this._centroidX, cny = this._centroidY, cnc = this._centroidCharge,
      bc = this._bodyCount, ci = this._childIndex, bi = this._bodyIndex,
      nb = this._nextBody;
    // Cached theta-comparison value that saves half-size calculations
    const th = (this._theta / 2) ** 2;
    const stack = this._cellStack;

    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i], ch = cs[i];
      let fxi = 0, fyi = 0;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const c = stack[--top];
        if (bc[c] === 0) continue;

        // Is the body outside of the current cell?
        if (Math.abs(x - cx[c]) > hs[c] || Math.abs(y - cy[c]) > hs[c]) {
          const dx = x - cnx[c], dy = y - cny[c];
          const dSq = dx ** 2 + dy ** 2;

          // Barnes-Hut criterion
          if (hs[c] ** 2 < th * dSq) {
            const d2 = Math.max(dSq, minDistSq);
            const s = ch * cnc[c] * strength / (d2 * Math.sqrt(d2));
            fxi += s * dx;
            fyi += s * dy;
            continue;
          }
        }

        // Open the cell if possible
        const k = ci[c];
        if (k !== -1) {
          stack[top++] = k;
          stack[top++] = k + 1;
          stack[top++] = k + 2;
          stack[top++] = k + 3;
          continue;
        }

        // Leaf cell
        for (let j = bi[c]; j !== -1; j = nb[j]) {
          if (j === i) continue;
          let dx = x - xs[j], dy = y - ys[j];
          let dSq = dx * dx + dy * dy;
          if (dSq < 1e-12) {
            dx = Math.random() - 0.5; dy = Math.random() - 0.5;
            dSq = dx * dx + dy * dy;
          }
          dSq = Math.max(dSq, minDistSq);
          const s = ch * cs[j] * strength / (dSq * Math.sqrt(dSq));
          fxi += s * dx; fyi += s * dy;
        }
      }

      fx[i] += fxi;
      fy[i] += fyi;
    }
  }


  /**
   * Sets each cell's largest body radius. Assumes the tree is already built.
   * @param {ArrayLike<number>} radii - body radii
   * @returns {void}
   * @private
   */
  _aggregateRadii(radii) {
    // Reverse order visits a cell's children before the cell itself
    for (let c = this._cellCount - 1; c >= 0; c--) {
      let max = 0;
      const k = this._childIndex[c];
      if (k === -1) {
        for (let b = this._bodyIndex[c]; b !== -1; b = this._nextBody[b]) {
          if (radii[b] > max) max = radii[b];
        }
      }
      else {
        for (let q = k; q < k + 4; q++) {
          if (this._maxRadius[q] > max) max = this._maxRadius[q];
        }
      }
      this._maxRadius[c] = max;
    }
  }


  /**
   * Pushes overlapping bodies apart, writing new positions to `xs` and `ys`.
   * Fixed bodies don't move, and a body overlapping a fixed one takes the whole
   * push. Each pair is resolved once, so a push can create overlaps that last
   * until the next call.
   * @param {Float64Array} xs - x coordinates, updated in place
   * @param {Float64Array} ys - y coordinates, updated in place
   * @param {ArrayLike<number>} radii - body radii
   * @param {ArrayLike<number | boolean>} fixed - whether each body is immovable
   * @throws {Error} throws when the input arrays are not all the same length
   * @returns {void}
   */
  collide(xs, ys, radii, fixed) {
    if (radii.length !== xs.length || fixed.length !== xs.length) {
      throw new Error("BarnesHutContext: mismatching body array lengths");
    }

    this._build(xs, ys);
    if (this._cellCount === 0) return;
    this._aggregateRadii(radii);

    const cx = this._centerX, cy = this._centerY, hs = this._halfSize,
      bc = this._bodyCount, ci = this._childIndex, bi = this._bodyIndex,
      nb = this._nextBody, mr = this._maxRadius;
    const stack = this._cellStack;

    for (let i = 0; i < xs.length; i++) {
      let x = xs[i], y = ys[i];
      const r = radii[i];
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const c = stack[--top];
        if (bc[c] === 0) continue;

        // Skip the cell if the gap to it is too wide for any of its bodies to reach
        const gapX = Math.max(Math.abs(x - cx[c]) - hs[c], 0);
        const gapY = Math.max(Math.abs(y - cy[c]) - hs[c], 0);
        const reach = r + mr[c];
        if (gapX * gapX + gapY * gapY >= reach * reach) continue;

        // Open the cell if possible
        const k = ci[c];
        if (k !== -1) {
          stack[top++] = k;
          stack[top++] = k + 1;
          stack[top++] = k + 2;
          stack[top++] = k + 3;
          continue;
        }

        // Leaf cell
        for (let j = bi[c]; j !== -1; j = nb[j]) {
          if (j <= i) continue;   // each pair is handled by its lower index
          let dx = x - xs[j], dy = y - ys[j];
          const dSq = dx * dx + dy * dy;
          const minD = r + radii[j];
          if (dSq >= minD * minD) continue;

          let d = Math.sqrt(dSq);
          if (d < 1e-7) {
            const a = Math.random() * Math.PI * 2;
            dx = Math.cos(a); dy = Math.sin(a); d = 1;
          }

          const pushCoeff = (minD - d) / d;
          const s1 = fixed[i] ? 0 : (fixed[j] ? 1 : 0.5);
          const s2 = fixed[j] ? 0 : (fixed[i] ? 1 : 0.5);

          x += dx * pushCoeff * s1;
          y += dy * pushCoeff * s1;
          xs[j] -= dx * pushCoeff * s2;
          ys[j] -= dy * pushCoeff * s2;
        }
      }

      xs[i] = x;
      ys[i] = y;
    }
  }
}

