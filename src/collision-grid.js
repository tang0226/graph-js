/**
 * Copies a typed array into a new, larger one of the same type.
 * @param {Int32Array} a - array to copy
 * @param {number} n - new length
 * @returns {Int32Array} new array
 */
const growI32 = (a, n) => { const b = new Int32Array(n); b.set(a); return b; };

/**
 * Hashes integer cell coordinates into a bucket index.
 * @param {number} cx - cell x coordinate, as an int32
 * @param {number} cy - cell y coordinate, as an int32
 * @param {number} mask - bucket count minus one (bucket count is a power of two)
 * @returns {number} bucket index
 */
const hashCell = (cx, cy, mask) => {
  let h = Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca77);
  h ^= h >>> 15;
  return h & mask;
};

/**
 * Pushes bodies i and j apart if they overlap, in place.
 * @param {Float64Array} xs - x coordinates
 * @param {Float64Array} ys - y coordinates
 * @param {ArrayLike<number>} radii - body radii
 * @param {ArrayLike<number | boolean>} fixed - whether each body is immovable
 * @param {number} i - first body
 * @param {number} j - second body
 * @returns {void}
 */
const resolvePair = (xs, ys, radii, fixed, i, j) => {
  let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
  const dSq = dx * dx + dy * dy;
  const minD = radii[i] + radii[j];
  if (dSq >= minD * minD) return;

  let d = Math.sqrt(dSq);
  if (d < 1e-7) {
    const a = Math.random() * Math.PI * 2;
    dx = Math.cos(a); dy = Math.sin(a); d = 1;
  }

  const pushCoeff = (minD - d) / d;
  const s1 = fixed[i] ? 0 : (fixed[j] ? 1 : 0.5);
  const s2 = fixed[j] ? 0 : (fixed[i] ? 1 : 0.5);

  xs[i] += dx * pushCoeff * s1;
  ys[i] += dy * pushCoeff * s1;
  xs[j] -= dx * pushCoeff * s2;
  ys[j] -= dy * pushCoeff * s2;
};

/** Cell coordinates beyond this could wrap when stored as int32 */
const MAX_DENSE_COORD = 2 ** 30;



/**
 * Internal collision class. Resolves overlaps between bodies using a uniform
 * grid, so each body is only checked against bodies in neighboring cells.
 *
 * Cells are sized to the "small" bodies: bodies whose radius is well above the
 * average are kept out of the grid and look up the cells they could reach
 * instead, so one oversized body can't make every cell large.
 *
 * When the bodies' bounding box needs only a few cells per body, each cell gets
 * its own bucket. Otherwise (a spread-out layout, or a far outlier), cells are
 * hashed into a table sized to the body count, so memory never depends on how
 * far apart bodies are.
 */
export class CollisionGrid {
  /**
   * Bucket index of each grid body, or -1 for a large body
   * @type {Int32Array}
   */
  _bucket = new Int32Array();

  /**
   * Cell x coordinate of each grid body (int32, wraps for very distant bodies)
   * @type {Int32Array}
   */
  _cellX = new Int32Array();

  /**
   * Cell y coordinate of each grid body (int32, wraps for very distant bodies)
   * @type {Int32Array}
   */
  _cellY = new Int32Array();

  /**
   * Grid body indices, sorted by bucket
   * @type {Int32Array}
   */
  _order = new Int32Array();

  /**
   * Indices of large bodies, which are not in the grid
   * @type {Int32Array}
   */
  _large = new Int32Array();

  /**
   * Offset of each bucket's first body in `_order`, plus a final end offset.
   * Only the first `_bucketCount + 1` entries are in use.
   * @type {Int32Array}
   */
  _bucketStart = new Int32Array();

  /**
   * Write cursor per bucket, used while filling `_order`
   * @type {Int32Array}
   */
  _fill = new Int32Array();

  /**
   * Side length of a cell, from the last `collide()` call
   * @type {number}
   */
  _cellSize = 0;

  /**
   * Number of buckets in use
   * @type {number}
   */
  _bucketCount = 0;

  /**
   * Whether each cell has its own bucket (true), or cells are hashed (false)
   * @type {boolean}
   */
  _dense = false;

  /**
   * Cell x coordinate of the dense grid's first column
   * @type {number}
   */
  _originX = 0;

  /**
   * Cell y coordinate of the dense grid's first row
   * @type {number}
   */
  _originY = 0;

  /**
   * Width of the dense grid, in cells
   * @type {number}
   */
  _width = 0;

  /**
   * Height of the dense grid, in cells
   * @type {number}
   */
  _height = 0;


  /**
   * Pushes overlapping bodies apart so that they just touch, splitting each
   * push evenly. Fixed bodies don't move, and a body overlapping a fixed one
   * takes the whole push. Each pair is resolved once, so a push can create
   * overlaps that last until the next call.
   * @param {Float64Array} xs - x coordinates, updated in place
   * @param {Float64Array} ys - y coordinates, updated in place
   * @param {ArrayLike<number>} radii - body radii
   * @param {ArrayLike<number | boolean>} fixed - whether each body is immovable
   * @throws {Error} throws when the input arrays are not all the same length
   * @returns {void}
   */
  collide(xs, ys, radii, fixed) {
    const n = xs.length;
    if (ys.length !== n || radii.length !== n || fixed.length !== n) {
      throw new Error("CollisionGrid: mismatching body array lengths");
    }

    let maxR = 0, sumR = 0;
    for (let i = 0; i < n; i++) {
      const r = radii[i];
      sumR += r;
      if (r > maxR) maxR = r;
    }
    if (maxR <= 0) return;

    /* Grid bodies have radius <= limit, so two of them can only touch if they
       are within one cell (2 * limit) of each other on each axis. */
    const limit = Math.min(maxR, 2 * sumR / n);
    const cs = 2 * limit, inv = 1 / cs;
    this._cellSize = cs;

    const largeCount = this._bin(xs, ys, radii, limit, inv);

    /* Large bodies go first. Their pushes can move grid bodies several cells,
       so the grid is rebuilt before grid bodies are checked against each other. */
    if (largeCount > 0) {
      this._collideLarge(xs, ys, radii, fixed, largeCount, limit, inv);
      this._bin(xs, ys, radii, limit, inv);
    }

    const bucket = this._bucket, cellX = this._cellX, cellY = this._cellY,
      order = this._order, start = this._bucketStart, shared = !this._dense;

    // Each grid body checks the 3x3 block of cells around its own, higher indices only
    for (let i = 0; i < n; i++) {
      if (bucket[i] === -1) continue;
      const gx = cellX[i], gy = cellY[i];
      for (let oy = -1; oy <= 1; oy++) {
        const cy = (gy + oy) | 0;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = (gx + ox) | 0, b = this._bucketOf(cx, cy);
          if (b === -1) continue;
          for (let k = start[b]; k < start[b + 1]; k++) {
            const j = order[k];
            // Hashed buckets can hold other cells that hash to the same index
            if (j <= i || (shared && (cellX[j] !== cx || cellY[j] !== cy))) continue;
            resolvePair(xs, ys, radii, fixed, i, j);
          }
        }
      }
    }
  }


  /**
   * Resolves every pair that includes a large body: each large body against
   * the grid bodies it could reach, and against the other large bodies.
   * @param {Float64Array} xs - x coordinates, updated in place
   * @param {Float64Array} ys - y coordinates, updated in place
   * @param {ArrayLike<number>} radii - body radii
   * @param {ArrayLike<number | boolean>} fixed - whether each body is immovable
   * @param {number} largeCount - number of large bodies in `_large`
   * @param {number} limit - largest radius of a grid body
   * @param {number} inv - inverse cell size
   * @returns {void}
   */
  _collideLarge(xs, ys, radii, fixed, largeCount, limit, inv) {
    const cellX = this._cellX, cellY = this._cellY, order = this._order,
      start = this._bucketStart, large = this._large, shared = !this._dense;
    const gridCount = xs.length - largeCount;

    for (let m = 0; m < largeCount; m++) {
      const i = large[m];
      // The cell range is taken from the body's position at the start of its turn
      const x = xs[i], y = ys[i], reach = radii[i] + limit;
      let x0 = Math.floor((x - reach) * inv), x1 = Math.floor((x + reach) * inv);
      let y0 = Math.floor((y - reach) * inv), y1 = Math.floor((y + reach) * inv);
      if (!shared) {
        // Only cells inside the dense grid can hold bodies
        x0 = Math.max(x0, this._originX); x1 = Math.min(x1, this._originX + this._width - 1);
        y0 = Math.max(y0, this._originY); y1 = Math.min(y1, this._originY + this._height - 1);
      }

      if ((x1 - x0 + 1) * (y1 - y0 + 1) > gridCount) {
        // Covers more cells than there are grid bodies, so scanning them all is cheaper
        for (let k = 0; k < gridCount; k++) resolvePair(xs, ys, radii, fixed, i, order[k]);
      } else {
        for (let gy = y0; gy <= y1; gy++) {
          const cy = gy | 0;
          for (let gx = x0; gx <= x1; gx++) {
            const cx = gx | 0, b = this._bucketOf(cx, cy);
            if (b === -1) continue;
            for (let k = start[b]; k < start[b + 1]; k++) {
              const j = order[k];
              if (shared && (cellX[j] !== cx || cellY[j] !== cy)) continue;
              resolvePair(xs, ys, radii, fixed, i, j);
            }
          }
        }
      }

      for (let k = m + 1; k < largeCount; k++) resolvePair(xs, ys, radii, fixed, i, large[k]);
    }
  }


  /**
   * Gets the bucket holding a cell.
   * @param {number} cx - cell x coordinate, as an int32
   * @param {number} cy - cell y coordinate, as an int32
   * @returns {number} bucket index, or -1 if the cell is outside the dense grid
   */
  _bucketOf(cx, cy) {
    if (!this._dense) return hashCell(cx, cy, this._bucketCount - 1);
    const x = cx - this._originX, y = cy - this._originY;
    if (x < 0 || y < 0 || x >= this._width || y >= this._height) return -1;
    return y * this._width + x;
  }


  /**
   * Sorts bodies with radius <= `limit` into cells, and lists the rest in
   * `_large`.
   * @param {ArrayLike<number>} xs - x coordinates
   * @param {ArrayLike<number>} ys - y coordinates
   * @param {ArrayLike<number>} radii - body radii
   * @param {number} limit - largest radius of a grid body
   * @param {number} inv - inverse cell size
   * @returns {number} number of large bodies
   */
  _bin(xs, ys, radii, limit, inv) {
    const n = xs.length;
    if (this._bucket.length < n) {
      const size = Math.max(n, this._bucket.length * 2);
      this._bucket = growI32(this._bucket, size);
      this._cellX = growI32(this._cellX, size);
      this._cellY = growI32(this._cellY, size);
      this._order = growI32(this._order, size);
      this._large = growI32(this._large, size);
    }
    const bucket = this._bucket, cellX = this._cellX, cellY = this._cellY,
      order = this._order, large = this._large;

    // Find each grid body's cell, and the range of cells in use
    let largeCount = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (radii[i] > limit) { bucket[i] = -1; large[largeCount++] = i; continue; }
      const fx = Math.floor(xs[i] * inv), fy = Math.floor(ys[i] * inv);
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
      cellX[i] = fx | 0; cellY[i] = fy | 0;
    }

    // One bucket per cell, if that takes at most about 4 buckets per body
    const gridCount = n - largeCount, w = maxX - minX + 1, h = maxY - minY + 1;
    this._dense = w * h <= 4 * gridCount + 16
      && Math.max(-minX, maxX, -minY, maxY) < MAX_DENSE_COORD;
    let buckets;
    if (this._dense) {
      this._originX = minX; this._originY = minY;
      this._width = w; this._height = h;
      buckets = w * h;
    } else {
      // Power-of-two bucket count, at least 2 per body to keep sharing low
      buckets = 16;
      while (buckets < 2 * gridCount) buckets *= 2;
    }
    this._bucketCount = buckets;

    if (this._bucketStart.length < buckets + 1) {
      const size = Math.max(buckets + 1, this._bucketStart.length * 2);
      this._bucketStart = new Int32Array(size);
      this._fill = new Int32Array(size);
    }
    const start = this._bucketStart, fill = this._fill;

    // Count bodies per bucket, shifted by one so the prefix sum gives offsets
    start.fill(0, 0, buckets + 1);
    for (let i = 0; i < n; i++) {
      if (radii[i] > limit) continue;
      const b = this._bucketOf(cellX[i], cellY[i]);
      bucket[i] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < buckets; b++) start[b + 1] += start[b];

    fill.set(start.subarray(0, buckets));
    for (let i = 0; i < n; i++) if (bucket[i] !== -1) order[fill[bucket[i]]++] = i;

    return largeCount;
  }
}
