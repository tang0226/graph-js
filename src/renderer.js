import { Simulation } from "./simulation.js";
import { asFn, circleRectCollision } from "./utils.js";

const NODE_RENDER_DEFAULTS = {
  color: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 1,
  image: null,
};

const EDGE_RENDER_DEFAULTS = {
  color: "#000000",
  width: 1,
  arrow: null,     // null follows graph.directed; true/false forces it per edge
  arrowSize: 10,   // canvas px — like width, does not scale with zoom
  bow: 14,         // world px of perpendicular bow for reciprocal directed pairs
};

export class Renderer {
  static IMAGE_LOADING = "loading";
  static IMAGE_FAILED = "failed";

  constructor(simulation, opts = {}) {
    if (!(simulation instanceof Simulation)) throw new TypeError("simulation argument is not a Simulation instance");
    this.simulation = simulation;
    this.graph = simulation.graph;

    this.canvas = opts.canvas ?? null;
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;

    this.opts = {
      background: opts.background ?? "#ffffff",
    };

    this.size = this.canvas ?
      { w: this.canvas.width, h: this.canvas.height }
      : null;
    this.view = { x: 0, y: 0, zoom: 1 };

    this.nodes = new Map();
    this.edges = new Map();
    this._nodeOverrides = new Map();
    this._edgeOverrides = new Map();
    this._images = new Map();
    this._imageDebt = 0;

    this.setDefaultNodeConfig(opts.nodeConfig ?? {});
    this.setDefaultEdgeConfig(opts.edgeConfig ?? {});
    

    // sync with simulation
    this._syncedSimulation = -1;
    this._syncedDataVersion = -1
    this._version = 1;
    this.sync();
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.size = { w: this.canvas.width, h: this.canvas.height };
    return this;
  }

  detach() {
    if (!this.canvas) return this;
    this.canvas = null;
    this.ctx = null;
    this.size = null;
    return this;
  }

  // Style management functions
  setDefaultNodeConfig(config = {}) {
    this._defaultNodeConfig = { ...NODE_RENDER_DEFAULTS, ...this._defaultNodeConfig, ...config };
    this._nodeAccessors = {
      color: asFn(this._defaultNodeConfig.color),
      outlineColor: asFn(this._defaultNodeConfig.outlineColor),
      outlineWidth: asFn(this._defaultNodeConfig.outlineWidth),
      image: asFn(this._defaultNodeConfig.image),
    };
    this._stylesDirty = true;
    return this;
  }

  setNodeConfig(id, config = {}) {
    const merged = { ...this._nodeOverrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._nodeOverrides.set(id, merged);
    this._stylesDirty = true;
    return this;
  }

  clearNodeConfig(id) {
    this._nodeOverrides.delete(id);
    this._stylesDirty = true;
    return this;
  }

  setDefaultEdgeConfig(config = {}) {
    this._defaultEdgeConfig = { ...EDGE_RENDER_DEFAULTS, ...this._defaultEdgeConfig, ...config };
    this._edgeAccessors = {
      color: asFn(this._defaultEdgeConfig.color),
      width: asFn(this._defaultEdgeConfig.width),
      arrow: asFn(this._defaultEdgeConfig.arrow),
      arrowSize: asFn(this._defaultEdgeConfig.arrowSize),
      bow: asFn(this._defaultEdgeConfig.bow),
    };
    this._stylesDirty = true;
    return this;
  }

  setEdgeConfig(gEdge, config = {}) {
    const merged = { ...this._edgeOverrides.get(gEdge), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._edgeOverrides.set(gEdge, merged);
    this._stylesDirty = true;
    return this;
  }

  clearEdgeConfig(gEdge) {
    this._edgeOverrides.delete(gEdge);
    this._stylesDirty = true;
    return this;
  }

  // Update render-node config based on graph node
  _resolveNode(gNode, rNode) {
    const acc = this._nodeAccessors, g = this.graph, o = this._nodeOverrides.get(gNode.id);
    rNode.color = o?.color?.(gNode, g) ?? acc.color(gNode, g);
    rNode.outlineColor = o?.outlineColor?.(gNode, g) ?? acc.outlineColor(gNode, g);
    rNode.outlineWidth = o?.outlineWidth?.(gNode, g) ?? acc.outlineWidth(gNode, g);
    rNode.image = o?.image?.(gNode, g) ?? acc.image(gNode, g);
  }

  // Update rendered edge config based on graph edge
  _resolveEdge(gEdge, rEdge) {
    const acc = this._edgeAccessors, g = this.graph, o = this._edgeOverrides.get(gEdge);
    rEdge.color = o?.color?.(gEdge, g) ?? acc.color(gEdge, g);
    rEdge.width = o?.width?.(gEdge, g) ?? acc.width(gEdge, g);
    rEdge.arrowSize = o?.arrowSize?.(gEdge, g) ?? acc.arrowSize(gEdge, g);
    rEdge.bow = o?.bow?.(gEdge, g) ?? acc.bow(gEdge, g);

    // unset (null/undefined) means "whatever the graph is"
    const arrow = o?.arrow?.(gEdge, g) ?? acc.arrow(gEdge, g);
    rEdge.arrow = arrow === null || arrow === undefined ? g.directed : arrow === true;
  }

  // Create a node based on a new graph node
  _seedNode(gNode) {
    const rNode = {
      id: gNode.id,
      ...NODE_RENDER_DEFAULTS
    };
    this._resolveNode(gNode, rNode);
    return rNode;
  }

  _seedEdge(gEdge) {
    const rEdge = {...EDGE_RENDER_DEFAULTS};
    this._resolveEdge(gEdge, rEdge);
    return rEdge;
  }

  _loadImage(src) {
    if (this._images.has(src)) return false;
    this._images.set(src, Renderer.IMAGE_LOADING);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => { if (this._images.get(src) === Renderer.IMAGE_LOADING) this._images.set(src, img); };
    img.onerror = () => { if (this._images.get(src) === Renderer.IMAGE_LOADING) this._images.set(src, Renderer.IMAGE_FAILED); };
    img.src = src;
    return true;
  }

  // Find and delete images that are no longer used by any nodes
  _garbageCollectImages() {
    const live = new Set();
    for (const rNode of this.nodes.values()) if (rNode.image) live.add(rNode.image);
    for (const src of this._images.keys()) if (!live.has(src)) this._images.delete(src);
  }

  // Update 
  sync() {
    if (this._syncedDataVersion !== this.graph._dataVersion) {
      this._stylesDirty = true;
      this._syncedDataVersion = this.graph._dataVersion;
    }

    if (this._syncedSimulation === this.simulation._version && !this._stylesDirty) return false;
    
    // Update node styles and seed new ones
    for (const [id, gNode] of this.graph.nodes) {
      let rNode = this.nodes.get(id);
      if (rNode) this._resolveNode(gNode, rNode);
      else {
        rNode = this._seedNode(gNode);
        this.nodes.set(id, rNode);
      }
      // Load node image into cache
      if (rNode.image) {
        const img = this._images.get(rNode.image)
        if (!img)
          this._loadImage(rNode.image);
      }
    }

    // Update edge styles and seed new ones
    for (const gEdge of this.graph.edges) {
      const rEdge = this.edges.get(gEdge);
      if (rEdge) this._resolveEdge(gEdge, rEdge);
      else this.edges.set(gEdge, this._seedEdge(gEdge));
    }

    this._stylesDirty = false;

    if (this._syncedSimulation === this.simulation._version) return true;
    
    // Delete old node styles
    for (const id of this.nodes.keys()) {
      if (!this.graph.nodes.has(id)) {
        if (this.nodes.get(id).image) this._imageDebt++;
        this.nodes.delete(id);
        this._nodeOverrides.delete(id);
      }
    }
    if (this._imageDebt > 16) { this._garbageCollectImages(); this._imageDebt = 0; }

    // Delete old edge styles
    for (const gEdge of this.edges.keys()) {
      if (!this.graph.edges.has(gEdge)) {
        this.edges.delete(gEdge);
        this._edgeOverrides.delete(gEdge);
      }
    }

    // Refresh style caches
    // Node styles
    this._nodeStyles = [];
    for (const sNode of this.simulation._nodeList)
      this._nodeStyles.push(this.nodes.get(sNode.id));

    const sim = this.simulation;

    // Edge pairs
    const refs = sim._edgeRefs;
    this._edgeStyles = [];
    for (let k = 0; k < refs.length; k++)
      this._edgeStyles.push(this.edges.get(refs[k]));

    /* Edge bow: 1 when this edge is one half of a reciprocal directed pair, so
       it should curve instead of overlapping its twin. No sign is needed — the
       bow is offset along the edge's own perpendicular, which already points
       the opposite way for the reverse edge. */
    const ep = sim._edgePairs;
    const sNodes = sim._nodeList;
    this._edgeBow = new Int8Array(ep.length / 2);
    for (let k = 0, i = 0; i < ep.length; k++, i += 2) {
      const a = ep[i], b = ep[i + 1];
      if (a === b || !this.graph.directed) { this._edgeBow[k] = 0; continue; }
      this._edgeBow[k] = this.graph.hasEdge(sNodes[b].id, sNodes[a].id) ? 1 : 0;
    }

    this._syncedSimulation = this.simulation._version;
    this._version++;
    return true;
  }

  simToCanvas(x, y) {
    if (!this.canvas) throw new Error("Renderer: no canvas attached");
    const v = this.view;
    return [this.size.w / 2 + (x - v.x) * v.zoom, this.size.h / 2 + (y - v.y) * v.zoom];
  }

  canvasToSim(x, y) {
    if (!this.canvas) throw new Error("Renderer: no canvas attached");
    const v = this.view;
    return [(x - this.size.w / 2) / v.zoom + v.x, (y - this.size.h / 2) / v.zoom + v.y];
  }

  _cull() {
    const [xMin, yMin] = this.canvasToSim(0, 0);
    const [xMax, yMax] = this.canvasToSim(this.size.w, this.size.h);

    const nodesI = [];
    const shouldRender = new Set();
    const sim = this.simulation;
    for (let i = 0; i < sim._nodeList.length; i++) {
      const sNode = sim._nodeList[i];
      if (circleRectCollision(sNode.x, sNode.y, sNode.radius, xMin, xMax, yMin, yMax)) {
        nodesI.push(i);
        shouldRender.add(i);
      }
    }

    const edgesI = [];
    const ep = sim._edgePairs;
    for (let i = 0, j = 0; i < ep.length / 2; i++, j += 2) {
      if (shouldRender.has(ep[j]) || shouldRender.has(ep[j + 1])) 
        edgesI.push(i);
    }

    return { nodesI, edgesI };
  }

  render() {
    if (!this.ctx) return false;
    this.sync();

    const toRender = this._cull();
    const sim = this.simulation;

    this.ctx.fillStyle = this.opts.background;
    this.ctx.fillRect(0, 0, this.size.w, this.size.h);

    // Render edges
    for (const i of toRender.edgesI) {
      const iDbl = 2 * i;
      this._drawEdge(
        sim._nodeList[sim._edgePairs[iDbl]],
        sim._nodeList[sim._edgePairs[iDbl + 1]],
        this._edgeStyles[i],
        this._edgeBow[i],
      );
    }

    // Render nodes
    for (const i of toRender.nodesI) {
      const nodeStyle = this._nodeStyles[i];
      const sNode = sim._nodeList[i];
      const [cx, cy] = this.simToCanvas(sNode.x, sNode.y);
      const r = sNode.radius * this.view.zoom;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      const img = nodeStyle.image && this._images.get(nodeStyle.image);
      if (img && typeof img !== "string") {
        const scale = r * 2 / Math.min(img.width, img.height);
        const dw = img.width * scale, dh = img.height * scale;
        this.ctx.save();
        this.ctx.clip();
        this.ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        this.ctx.restore();
      } else {
        this.ctx.fillStyle = nodeStyle.color;
        this.ctx.fill();
      }
      if (nodeStyle.outlineWidth) {
        this.ctx.strokeStyle = nodeStyle.outlineColor;
        this.ctx.lineWidth = nodeStyle.outlineWidth;
        this.ctx.stroke();
      }
    }

    return true;
  }

  _drawEdge(src, dest, style, bowDir) {
    const ctx = this.ctx, z = this.view.zoom;
    const [ax, ay] = this.simToCanvas(src.x, src.y);
    const [bx, by] = this.simToCanvas(dest.x, dest.y);
    const ra = src.radius * z, rb = dest.radius * z;

    if (src === dest) return this._drawSelfLoop(ax, ay, ra, style);

    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;

    const head = style.arrow ? style.arrowSize : 0;
    if (d <= ra + rb + head) return;

    const ux = dx / d, uy = dy / d;
    const bow = bowDir * style.bow * this.view.zoom;  // Scale bow with zoom

    // Tangents at each end, and the trimmed endpoints along them.
    let t0x = ux, t0y = uy, t1x = ux, t1y = uy, cx = 0, cy = 0;
    if (bow) {
      cx = (ax + bx) / 2 - uy * bow;            // (-uy, ux) is the perpendicular
      cy = (ay + by) / 2 + ux * bow;
      const l0 = Math.hypot(cx - ax, cy - ay) || 1;
      const l1 = Math.hypot(bx - cx, by - cy) || 1;
      t0x = (cx - ax) / l0; t0y = (cy - ay) / l0;
      t1x = (bx - cx) / l1; t1y = (by - cy) / l1;
    }

    const sx = ax + t0x * ra, sy = ay + t0y * ra;
    const ex = bx - t1x * rb, ey = by - t1y * rb;

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    // Stop the stroke at the arrowhead's base so a thick line can't show
    // through the notch of the filled triangle.
    if (bow) ctx.quadraticCurveTo(cx, cy, ex - t1x * head, ey - t1y * head);
    else ctx.lineTo(ex - ux * head, ey - uy * head);
    ctx.stroke();

    if (style.arrow) this._drawArrowhead(ex, ey, t1x, t1y, head, style);
  }

  _drawArrowhead(tipX, tipY, tx, ty, size, style) {
    const ctx = this.ctx;
    const halfW = size * 0.45;
    const baseX = tipX - tx * size, baseY = tipY - ty * size;
    const px = -ty, py = tx;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * halfW, baseY + py * halfW);
    ctx.lineTo(baseX - px * halfW, baseY - py * halfW);
    ctx.closePath();
    ctx.fillStyle = style.color;
    ctx.fill();
  }

  /* Self-loop: a circle overlapping the node, up and to the right. Nodes are
     painted after edges, so the inner part of the loop is covered. */
  _drawSelfLoop(cx, cy, r, style) {
    const ctx = this.ctx;
    const lr = Math.max(r * 0.8, (style.arrow ? style.arrowSize : 6) * 1.6);
    const a = -Math.PI / 4;
    const D = r + lr * 0.6;                      // node centre -> loop centre
    const ux = Math.cos(a), uy = Math.sin(a);
    const lx = cx + ux * D, ly = cy + uy * D;

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.stroke();

    if (!style.arrow) return;

    /* Put the tip where the loop crosses the node's boundary. The loop's
       nearest point to the node centre lies *inside* the node, so an
       arrowhead there would be painted over by the node's fill. */
    const t = (D * D + r * r - lr * lr) / (2 * D);
    const h2 = r * r - t * t;
    if (h2 <= 0) return;                         // circles don't intersect
    const h = Math.sqrt(h2);
    const px = -uy, py = ux;

    for (const s of [1, -1]) {                   // pick the crossing that points inward
      const tipX = cx + ux * t + px * h * s;
      const tipY = cy + uy * t + py * h * s;
      let tx = -(tipY - ly), ty = tipX - lx;     // counter-clockwise tangent on the loop
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      if (tx * (cx - tipX) + ty * (cy - tipY) > 0) {
        this._drawArrowhead(tipX, tipY, tx, ty, style.arrowSize, style);
        return;
      }
    }
  }

  nodeAt(cx, cy) {
    if (!this.canvas) throw new Error("Renderer: no canvas attached");
    const [x, y] = this.canvasToSim(cx, cy);
    const nodes = this.simulation._nodeList;
    const slack = 4 / this.view.zoom; // 4 world-coordinate radius slack
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], r = node.radius + slack;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r) return node.id;
    }
    return null;
  }

  getPosition(id) {
    if (!this.canvas) throw new Error("Renderer: no canvas attached");
    const p = this.simulation.getPosition(id);
    return p ? this.simToCanvas(...p) : null;
  }

  pin(id, cx, cy) {
    if (!this.canvas) throw new Error("Renderer: no canvas attached");
    return this.simulation.pin(id, ...this.canvasToSim(cx, cy));
  }

  unpin(id) { this.simulation.unpin(id); return this; }
}
