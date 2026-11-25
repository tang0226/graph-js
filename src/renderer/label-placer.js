// Greedy label placement for decluttering. Internal: not listed in
// package.json `exports`, so not part of the public API.


/** Canvas px per side of a grid cell */
const CELL = 32;


/**
 * Places boxes on the canvas one at a time, keeping each that doesn't come
 * within a padding of one already placed. Placed boxes are kept in a uniform
 * grid over the canvas, so each box is only tested against those near it.
 *
 * A placement runs from `begin()` to `end()`, with `tryPlace()` for each box
 * in between, best first. `placeAll()` does all three for one array of
 * boxes. Reused between placements: the grid's cells are kept, and emptied
 * by `end()`.
 */
export class LabelPlacer {
  /**
   * Indexes into `_boxes` of the boxes placed in each cell, row by row
   * @type {number[][]}
   * @private
   */
  _cells = [];


  /**
   * Indexes into `_cells` of the cells filled since `begin()`, to empty
   * @type {number[]}
   * @private
   */
  _used = [];


  /**
   * Each placed box's left, top, right and bottom edges in turn, in canvas px
   * @type {Float64Array}
   * @private
   */
  _boxes = new Float64Array(64);


  /** @private Boxes placed since `begin()` */
  _count = 0;


  /** @private Grid columns */
  _cols = 1;


  /** @private Grid rows */
  _rows = 1;


  /**
   * Starts a placement on a canvas of the given size, with nothing placed.
   * @param {number} w - canvas width, in canvas px
   * @param {number} h - canvas height, in canvas px
   * @returns {void}
   */
  begin(w, h) {
    this.end();
    this._cols = Math.max(1, Math.ceil(w / CELL));
    this._rows = Math.max(1, Math.ceil(h / CELL));
    while (this._cells.length < this._cols * this._rows) this._cells.push([]);
  }


  /**
   * Places a box unless it would overlap, or come within `pad` of, a box
   * already placed. Boxes may reach past the canvas; the grid clamps them to
   * its edge cells, which keeps any two boxes that come close in a shared
   * cell.
   * @param {number} x0 - left edge, in canvas px
   * @param {number} y0 - top edge
   * @param {number} x1 - right edge
   * @param {number} y1 - bottom edge
   * @param {number} pad - canvas px to keep from other boxes
   * @returns {boolean} whether the box was placed
   */
  tryPlace(x0, y0, x1, y1, pad) {
    const cells = this._cells, cols = this._cols, rows = this._rows, boxes = this._boxes;
    const px0 = x0 - pad, py0 = y0 - pad, px1 = x1 + pad, py1 = y1 + pad;
    // Any box placed within `pad` shares a cell with the padded box
    const c0 = cell(px0, cols), c1 = cell(px1, cols), r0 = cell(py0, rows), r1 = cell(py1, rows);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const q of cells[r * cols + c]) {
          const k = 4 * q;
          if (px0 < boxes[k + 2] && boxes[k] < px1 && py0 < boxes[k + 3] && boxes[k + 1] < py1) return false;
        }
      }
    }

    const q = this._count++;
    if (boxes.length < 4 * this._count) {
      this._boxes = new Float64Array(boxes.length * 2);
      this._boxes.set(boxes);
    }
    const k = 4 * q, b = this._boxes;
    b[k] = x0; b[k + 1] = y0; b[k + 2] = x1; b[k + 3] = y1;
    const d0 = cell(x0, cols), d1 = cell(x1, cols), e0 = cell(y0, rows), e1 = cell(y1, rows);
    for (let r = e0; r <= e1; r++) {
      for (let c = d0; c <= d1; c++) {
        const list = cells[r * cols + c];
        if (list.length === 0) this._used.push(r * cols + c);
        list.push(q);
      }
    }
    return true;
  }


  /**
   * Ends a placement, emptying the grid.
   * @returns {void}
   */
  end() {
    for (const i of this._used) this._cells[i].length = 0;
    this._used.length = 0;
    this._count = 0;
  }


  /**
   * Places boxes in order, keeping each that is at least `pad` from every
   * box kept before it.
   * @param {Float64Array} boxes - each box's left, top, right and bottom
   *    edges in turn, in canvas px
   * @param {ArrayLike<number>} order - the index of every box, best first
   * @param {number} pad - canvas px to keep between boxes
   * @param {number} w - canvas width, in canvas px
   * @param {number} h - canvas height, in canvas px
   * @returns {Uint8Array} 1 for each box kept, by index; as long as `order`
   */
  placeAll(boxes, order, pad, w, h) {
    this.begin(w, h);
    const placed = new Uint8Array(order.length);
    for (let o = 0; o < order.length; o++) {
      const j = order[o], b = 4 * j;
      if (this.tryPlace(boxes[b], boxes[b + 1], boxes[b + 2], boxes[b + 3], pad)) placed[j] = 1;
    }
    this.end();
    return placed;
  }
}


/**
 * The grid cell a coordinate falls in, clamped to the grid
 * @param {number} v - coordinate, in canvas px
 * @param {number} n - cells along that axis
 * @returns {number} cell index along the axis
 */
function cell(v, n) {
  return Math.min(Math.max(Math.floor(v / CELL), 0), n - 1);
}
