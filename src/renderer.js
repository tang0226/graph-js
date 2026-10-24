/** @import { Graph } from './graph.js' */
/**
 * @import {
 *  GraphNode, GraphEdge, SimNode,
 *  NodeStyle, EdgeStyle,
 *  NodeStyleConfig, EdgeStyleConfig,
 *  ResolvedNodeStyleConfig, ResolvedEdgeStyleConfig,
 *  NodeStyleAccessors, EdgeStyleAccessors,
 *  ResolvedNodeStyleAccessors, ResolvedEdgeStyleAccessors,
 *  RendererOpts, RendererOptsInput,
 *  Canvas, CanvasContext, Size, View
 * } from './typedefs.js'
 */


import { Simulation } from "./simulation.js";
import { asFn, circleRectCollision } from "./utils.js";


/** @type {RendererOpts} */
const RENDERER_DEFAULTS = {
  background: "#ffffff",
  renderEdges: true,
  imageReferrerPolicy: "no-referrer",
  crossOrigin: "anonymous",
};

/** @type {NodeStyle} */
const NODE_STYLE_DEFAULTS = {
  color: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 1,
  image: null,
};

/** @type {EdgeStyle} */
const EDGE_STYLE_DEFAULTS = {
  color: "#000000",
  width: 1,
  arrow: null,
  arrowSize: 10,
  bow: 14,
};

/**
 * Converts a full node config object to accessor functions
 * @param {ResolvedNodeStyleConfig} config - config to convert
 * @returns {ResolvedNodeStyleAccessors} accessors
 */
const toNodeAccessors = config => ({
  color: asFn(config.color),
  outlineColor: asFn(config.outlineColor),
  outlineWidth: asFn(config.outlineWidth),
  image: asFn(config.image),
});

/**
 * Converts a full edge config object to accessor functions
 * @param {ResolvedEdgeStyleConfig} config - config to convert
 * @returns {ResolvedEdgeStyleAccessors} accessors
 */
const toEdgeAccessors = config => ({
  color: asFn(config.color),
  width: asFn(config.width),
  arrow: asFn(config.arrow),
  arrowSize: asFn(config.arrowSize),
  bow: asFn(config.bow),
});

/**
 * Renders a graph simulation to a canvas. Caches node styles, edge styles, and node images.
 */
export class Renderer {
  static IMAGE_LOADING = "loading";
  static IMAGE_FAILED = "failed";


  /** @type {Graph} */
  _graph;
  /**
   * Underlying `Graph` instance.
   */
  get graph() { return this._graph; }


  /** @type {Simulation} */
  _simulation;
  /**
   * Underlying `Simulation` instance.
   */
  get simulation() { return this._simulation; }


  /** @type {Canvas | null} */
  _canvas = null;
  /**
   * Canvas element. Set with `attach()`, unset with `detach()`.
   */
  get canvas() { return this._canvas; }


  /** @type {CanvasContext | null} */
  _ctx = null;
  /**
   * Canvas context. Automatically set to correspond to `canvas`.
   */
  get ctx() { return this._ctx; }


  /** @type {RendererOpts} */
  _opts = { ...RENDERER_DEFAULTS };
  /**
   * [read-only, set with `setOpts()`] Renderer configuration options.
   * @returns {Readonly<RendererOpts>}
   */
  get opts() { return this._opts; }


  /** @type {Size | null} */
  _size = null;
  /**
   * [read-only] Logical canvas size in CSS pixels (`clientWidth`, `clientHeight`).
   * @returns {Readonly<Size> | null}
   */
  get size() { return this._size; }


  /** @type {View} */
  _view = { x: 0, y: 0, zoom: 1 };
  /**
   * Current viewing window of the `Renderer`. Directly mutable. Contains
   * center simulation coordinates and a zoom factor (canvasPx/simPx).
   */
  get view() { return this._view; }
  /**
   * @param {Partial<View>} v - view props to assign
   */
  set view(v) { Object.assign(this._view, v); }


  /** @type {Map<any, NodeStyle>} */
  _nodes = new Map();
  /**
   * [read-only] Cached map of resolved node styles, keyed by node id from the underlying
   * `Graph`. Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<any, NodeStyle>}
   */
  get nodes() { return this._nodes; }


  /** @type {Map<GraphEdge, EdgeStyle>} */
  _edges = new Map();
  /**
   * Cached map of resolved edge styles, keyed by edge object from the
   * underlying `Graph`. Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<GraphEdge, EdgeStyle>}
   */
  get edges() { return this._edges; }


  /** @type {ResolvedNodeStyleConfig} */
  _defaultNodeConfig = {...NODE_STYLE_DEFAULTS};
  /**
   * [read-only, set with `setDefaultNodeConfig()`]
   * Current default node style config. During style resolution, it takes
   * precedence over global config defaults, but can be overriden for specific
   * nodes using `setNodeConfig()`.
   * @returns {Readonly<ResolvedNodeStyleConfig>}
   */
  get defaultNodeConfig() { return this._defaultNodeConfig; }


  /** @type {ResolvedEdgeStyleConfig} */
  _defaultEdgeConfig = {...EDGE_STYLE_DEFAULTS};
  /**
   * Current default edge style config. During style resolution, it takes
   * precedence over global config defaults, but can be overriden for specific
   * edges in `_edgeOverrides`.
   * @returns {Readonly<ResolvedEdgeStyleConfig>}
   */
  get defaultEdgeConfig() { return this._defaultEdgeConfig; }


  /**
   * Node-specific style config overrides. Node style config here takes
   * precedence over global defaults and the `Renderer`'s current
   * `_defaultNodeConfig`
   * @type {Map<any, NodeStyleAccessors>}
   */
  _nodeOverrides = new Map();

  /**
   * Edge-specific style config overrides. Edge style config here takes
   * precedence over global defaults and the `Renderer`'s current
   * `_defaultEdgeConfig`
   * @type {Map<GraphEdge, EdgeStyleAccessors>}
   */
  _edgeOverrides = new Map();

  /**
   * `_defaultNodeConfig` as cached functions. Used to apply the `Renderer`'s
   * default config when resolving a node's raw style.
   * @type {ResolvedNodeStyleAccessors}
   */
  _nodeAccessors = toNodeAccessors(NODE_STYLE_DEFAULTS);

  /**
   * `_defaultEdgeConfig` as cached functions. Used to apply the `Renderer`'s
   * default config when resolving a edge's raw style.
   * @type {ResolvedEdgeStyleAccessors}
   */
  _edgeAccessors = toEdgeAccessors(EDGE_STYLE_DEFAULTS);

  /** @type {NodeStyle[]} */
  _nodeStyles = [];
  /**
   * [read-only]
   * Cached raw node styles for the hot render loop. Recreated in effective
   * `sync()` calls.
   * @returns {ReadonlyArray<NodeStyle>}
   */
  get nodeStyles() { return this._nodeStyles; }


  /** @type {EdgeStyle[]} */
  _edgeStyles = [];
  /**
   * [read_only]
   * Cached raw edge styles for the hot render loop. Recreated in effective
   * `sync()` calls.
   * @returns {ReadonlyArray<EdgeStyle>}
   */
  get edgeStyles() { return this._edgeStyles; }


  /**
   * Cached edge bowing coefficient (0 or 1) for digraphs. Recreated in
   * effective `sync()` calls.
   * @type {Int8Array}
   */
  _edgeBow = new Int8Array(0);


  /** @type {Map<string, HTMLImageElement | string>} */
  _images = new Map();
  /**
   * Cache of node image elements, keyed by source string.
   * @returns {ReadonlyMap<string, HTMLImageElement | string>}
   */
  get images () { return this._images; }


  /**
   * Counter of deleted nodes with images. Controls periodic image garbage-
   * collection (`_garbageCollectImages()`). GC happens when it reaches 16, at
   * which point it is reset to 0.
   * @type {number}
   */
  _imageDebt = 0;

  /**
   * Stores the latest synced `Simulation` version. Used to gate node and edge
   * style cache updates.
   * @type {number} */
  _syncedSimulation = -1;

  /**
   * Stores the latest synced `Graph`-data version. Used to gate node and edge
   * style cache updates.
   * @type {number} */
  _syncedDataVersion = -1;

  /** @type {number} */
  _version = 1;
  /**
   * Monotonic counter for *structural* modifications adopted from the
   * underlying `Graph` instance.
   */
  get version() { return this._version; }

  /**
   * Initializes a Renderer instance
   * @param {Simulation} simulation - simulation instance to render
   * @param {RendererOptsInput} [opts={}] - renderer options
   */
  constructor(simulation, opts = {}) {
    this._simulation = simulation;
    this._graph = simulation.graph;

    this._opts = {
      background: opts.background ?? RENDERER_DEFAULTS.background,
      renderEdges: opts.renderEdges ?? RENDERER_DEFAULTS.renderEdges,
      imageReferrerPolicy:
        opts.imageReferrerPolicy ?? RENDERER_DEFAULTS.imageReferrerPolicy,
      
      crossOrigin: opts.crossOrigin === undefined ?
        RENDERER_DEFAULTS.crossOrigin : opts.crossOrigin,
    };

    if (opts.canvas) this.attach(opts.canvas);

    this.setDefaultNodeConfig(opts.nodeConfig ?? {});
    this.setDefaultEdgeConfig(opts.edgeConfig ?? {});
    
    this.sync();
  }


  /**
   * Sets properties of `opts` using a partial object.
   * @param {RendererOptsInput} optsInput - options to set
   * @returns {this} self reference
   */
  setOpts({canvas, nodeConfig, edgeConfig, ...opts} = {}) {
    Object.assign(this._opts, opts);
    if (canvas) this.attach(canvas);
    if (nodeConfig) this.setDefaultNodeConfig(nodeConfig);
    if (edgeConfig) this.setDefaultEdgeConfig(edgeConfig);
    return this;
  }


  /**
   * Sets the `Renderer`'s canvas, overwriting previous element, context, and size data.
   * @param {Canvas} canvas - canvas element
   * @returns {this} self reference
   * @throws {TypeError} throws if the canvas has no 2D context
   */
  attach(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new TypeError("Renderer: canvas has no 2D context");
    this._canvas = canvas;
    this._ctx = ctx;
    this.resize();
    return this;
  }


  /**
   * Unsets the `Renderer`'s canvas, setting the canvas element, context, and size to `null`.
   * @returns {this} self reference
   */
  detach() {
    if (!this._canvas) return this;
    this._canvas = null;
    this._ctx = null;
    this._size = null;
    return this;
  }


  /**
   * Resizes internal canvas dimensions based on DPR (defaults to DPR = 1).
   * Also updates cached `size` dimensions object.
   * @returns {this} self reference
   */
  resize() {
    if (!this._canvas || !this._ctx) return this;
    const canvas = this._canvas;
    let w, h, dpr;
    // Check that canvas is not an OffscreenCanvas
    if ("clientWidth" in canvas) { // DPR only applies to on-screen canvases
      w = canvas.clientWidth, h = canvas.clientHeight;
      dpr = globalThis.devicePixelRatio ?? 1;
      this._canvas.width = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
    }
    // OffscreenCanvas: fall back to canvas.width and canvas.height and set DPR to one
    // (DPR doesn't apply to OffscreenCanvas)
    else {
      w = canvas.width; h = canvas.height;
      dpr = 1;
    }
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._size = { w, h };
    return this;
  }


  /**
   * Modifies fields of the `Renderer`'s default node style config
   * @param {NodeStyleConfig} [config={}] - object of config parameters that will modify the default node config
   * @returns {this} self reference
   */
  setDefaultNodeConfig(config = {}) {
    this._defaultNodeConfig = { ...NODE_STYLE_DEFAULTS, ...this._defaultNodeConfig, ...config };
    this._nodeAccessors = toNodeAccessors(this._defaultNodeConfig);
    this._stylesDirty = true;
    return this;
  }


  /**
   * Merges new config data into a node's current style overrides.
   * @param {any} id - node id
   * @param {NodeStyleConfig} [config={}] - config fields to set
   * @returns {this} self reference
   */
  setNodeConfig(id, config = {}) {
    /** @type {Record<string, any>} */
    const merged = { ...this._nodeOverrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._nodeOverrides.set(
      id,
      /** @type {NodeStyleAccessors} */
      merged
    );
    this._stylesDirty = true;
    return this;
  }


  /**
   * Clears all of a node's style overrides
   * @param {any} id - node id
   * @returns {this} self reference
   */
  clearNodeConfig(id) {
    this._nodeOverrides.delete(id);
    this._stylesDirty = true;
    return this;
  }


  /**
   * Modifies fields of the `Renderer`'s default edge style config
   * @param {EdgeStyleConfig} [config={}] - config parameters that will modify the default edge config
   * @returns {this} self reference
   */
  setDefaultEdgeConfig(config = {}) {
    this._defaultEdgeConfig = { ...EDGE_STYLE_DEFAULTS, ...this._defaultEdgeConfig, ...config };
    this._edgeAccessors = toEdgeAccessors(this._defaultEdgeConfig);
    this._stylesDirty = true;
    return this;
  }


  /**
   * Merges new config data into an edge's current style overrides.
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @param {EdgeStyleConfig} [config={}] - config fields to set
   * @returns {this} self reference
   * @throws {Error} throws if edge not found
   */
  setEdgeConfig(srcId, destId, config = {}) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) throw new Error(`Renderer: no edge from "${srcId}" to "${destId}"`);
    /** @type {Record<string, any>} */
    const merged = { ...this._edgeOverrides.get(gEdge), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._edgeOverrides.set(
      gEdge,
      /** @type {EdgeStyleAccessors} */
      merged
    );
    this._stylesDirty = true;
    return this;
  }


  /**
   * Clears all of an edge's style overrides.
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @returns {this} self reference
   */
  clearEdgeConfig(srcId, destId) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) return this;
    this._edgeOverrides.delete(gEdge);
    this._stylesDirty = true;
    return this;
  }


  /**
   * Updates a node's style config based on graph node.
   * @param {GraphNode} gNode - graph node
   * @param {NodeStyle} rNode - node style
   */
  _resolveNode(gNode, rNode) {
    const acc = this._nodeAccessors, g = this._graph, o = this._nodeOverrides.get(gNode.id);
    rNode.color = o?.color?.(gNode, g) ?? acc.color(gNode, g);
    rNode.outlineColor = o?.outlineColor?.(gNode, g) ?? acc.outlineColor(gNode, g);
    rNode.outlineWidth = o?.outlineWidth?.(gNode, g) ?? acc.outlineWidth(gNode, g);
    rNode.image = o?.image?.(gNode, g) ?? acc.image(gNode, g);
  }


  /**
   * Updates an edge's style config based on graph node.
   * @param {GraphEdge} gEdge - graph edge
   * @param {EdgeStyle} rEdge - edge style
   */
  _resolveEdge(gEdge, rEdge) {
    const acc = this._edgeAccessors, g = this._graph, o = this._edgeOverrides.get(gEdge);
    rEdge.color = o?.color?.(gEdge, g) ?? acc.color(gEdge, g);
    rEdge.width = o?.width?.(gEdge, g) ?? acc.width(gEdge, g);
    rEdge.arrowSize = o?.arrowSize?.(gEdge, g) ?? acc.arrowSize(gEdge, g);
    rEdge.bow = o?.bow?.(gEdge, g) ?? acc.bow(gEdge, g);

    // unset (null/undefined) means "whatever the graph is"
    const arrow = o?.arrow?.(gEdge, g) ?? acc.arrow(gEdge, g);
    rEdge.arrow = arrow === null || arrow === undefined ? g.directed : arrow === true;
  }


  /**
   * Seeds a node's style config based on its underlying `Graph` node.
   * @param {GraphNode} gNode - graph node to seed the node style from
   * @returns {NodeStyle} seeded node style
   */
  _seedNode(gNode) {
    const rNode = {
      id: gNode.id,
      ...NODE_STYLE_DEFAULTS
    };
    this._resolveNode(gNode, rNode);
    return rNode;
  }


  /**
   * Seeds an edge's style config based on its underlying `Graph` edge.
   * @param {GraphEdge} gEdge - graph edge to seed the edge style from
   * @returns {EdgeStyle} seeded edge style
   */
  _seedEdge(gEdge) {
    const rEdge = {...EDGE_STYLE_DEFAULTS};
    this._resolveEdge(gEdge, rEdge);
    return rEdge;
  }


  /**
   * Starts loading an image into the cache, keyed by its source. The entry
   * holds `IMAGE_LOADING` until the request settles, then the loaded image or
   * `IMAGE_FAILED`. Uses the renderer's current `crossOrigin` and
   * `imageReferrerPolicy`. A source that is already cached is not requested again.
   * @param {string} src - image source; also the cache key
   * @returns {boolean} `true` if a request was started, `false` if `src` was already cached
   */
  loadImage(src) {
    if (this._images.has(src)) return false;
    this._images.set(src, Renderer.IMAGE_LOADING);
    const img = new Image();
    img.crossOrigin = this._opts.crossOrigin;
    img.referrerPolicy = this._opts.imageReferrerPolicy;
    img.onload  = () => { if (this._images.get(src) === Renderer.IMAGE_LOADING) this._images.set(src, img); };
    img.onerror = () => { if (this._images.get(src) === Renderer.IMAGE_LOADING) this._images.set(src, Renderer.IMAGE_FAILED); };
    img.src = src;
    return true;
  }


  /**
   * Find and delete images that are no longer used by any nodes.
   * @returns {void}
   */
  _garbageCollectImages() {
    const live = new Set();
    for (const rNode of this._nodes.values()) if (rNode.image) live.add(rNode.image);
    for (const src of this._images.keys()) if (!live.has(src)) this._images.delete(src);
  }


  /**
   * Syncs internal nodes and edges to match the shape of underlying `Graph`.
   * Also resolves node and edge configs to apply overrides or defaults.
   * Gates on config changes, graph data changes, and graph shape changes.
   * @returns {boolean} whether cached node and edge render configs were modified
   */
  sync() {
    if (this._syncedDataVersion !== this._graph.dataVersion) {
      this._stylesDirty = true;
      this._syncedDataVersion = this._graph.dataVersion;
    }

    if (this._syncedSimulation === this._simulation.version && !this._stylesDirty) return false;
    
    // Update node styles and seed new ones
    for (const [id, gNode] of this._graph.nodes) {
      let rNode = this._nodes.get(id);
      if (rNode) this._resolveNode(gNode, rNode);
      else {
        rNode = this._seedNode(gNode);
        this._nodes.set(id, rNode);
      }
      // Load node image into cache
      if (rNode.image) {
        const img = this._images.get(rNode.image)
        if (!img)
          this.loadImage(rNode.image);
      }
    }

    // Update edge styles and seed new ones
    for (const gEdge of this._graph.edges) {
      const rEdge = this._edges.get(gEdge);
      if (rEdge) this._resolveEdge(gEdge, rEdge);
      else this._edges.set(gEdge, this._seedEdge(gEdge));
    }

    this._stylesDirty = false;

    if (this._syncedSimulation === this._simulation.version) return true;
    
    // Delete old node styles
    for (const id of this._nodes.keys()) {
      if (!this._graph.nodes.has(id)) {
        if (this._nodes.get(id)?.image) this._imageDebt++;
        this._nodes.delete(id);
        this._nodeOverrides.delete(id);
      }
    }
    if (this._imageDebt > 16) { this._garbageCollectImages(); this._imageDebt = 0; }

    // Delete old edge styles
    for (const gEdge of this._edges.keys()) {
      if (!this._graph.edges.has(gEdge)) {
        this._edges.delete(gEdge);
        this._edgeOverrides.delete(gEdge);
      }
    }

    // Refresh style caches
    // Node styles
    this._nodeStyles = [];
    for (const sNode of this._simulation.nodeList) {
      const rNode = this._nodes.get(sNode.id);
      if (rNode) this._nodeStyles.push(rNode);
    }

    const sim = this._simulation;

    // Edge pairs
    const refs = sim.edgeRefs;
    this._edgeStyles = [];
    for (let k = 0; k < refs.length; k++) {
      const edge = this._edges.get(refs[k]);
      if (edge) this._edgeStyles.push(edge);
    }

    /* Edge bow: 1 when this edge is one half of a reciprocal directed pair, so
       it should curve instead of overlapping its twin. No sign is needed — the
       bow is offset along the edge's own perpendicular, which already points
       the opposite way for the reverse edge. */
    const ep = sim.edgePairs;
    const sNodes = sim.nodeList;
    this._edgeBow = new Int8Array(ep.length / 2);
    for (let k = 0, i = 0; i < ep.length; k++, i += 2) {
      const a = ep[i], b = ep[i + 1];
      if (a === b || !this._graph.directed) { this._edgeBow[k] = 0; continue; }
      this._edgeBow[k] = this._graph.hasEdge(sNodes[b].id, sNodes[a].id) ? 1 : 0;
    }

    this._syncedSimulation = this._simulation.version;
    this._version++;
    return true;
  }

  
  /**
   * Converts simulation space coordinates to canvas coordinates based on the
   * current view.
   * @param {number} x - simulation x coordinate
   * @param {number} y - simulation y coordinate
   * @returns {[number, number]} - canvas coordinates
   * @throws {Error} throws when no canvas is attached
   */
  simToCanvas(x, y) {
    if (!this._canvas || !this._size) throw new Error("Renderer: no canvas attached");
    const v = this._view;
    return [this._size.w / 2 + (x - v.x) * v.zoom, this._size.h / 2 + (y - v.y) * v.zoom];
  }


  /**
   * Converts canvas coordinates to simulation space coordinates based on the
   * current view.
   * @param {number} x - canvas x coordinate
   * @param {number} y - canvas y coordinate
   * @returns {[number, number]} - simulation coordinates
   * @throws {Error} throws when no canvas is attached
   */
  canvasToSim(x, y) {
    if (!this._canvas || !this._size) throw new Error("Renderer: no canvas attached");
    const v = this._view;
    return [(x - this._size.w / 2) / v.zoom + v.x, (y - this._size.h / 2) / v.zoom + v.y];
  }


  /**
   * Culls all nodes and edges fully outside the current view.
   * Only keeps on-screen nodes and edges connected to at least
   * one on-screen node.
   * @returns {{nodesI: number[], edgesI: number[]}}
   */
  _cull() {
    if (!this._size) return { nodesI: [], edgesI: [] };
    const [xMin, yMin] = this.canvasToSim(0, 0);
    const [xMax, yMax] = this.canvasToSim(this._size.w, this._size.h);

    const nodesI = [];
    const shouldRender = new Set();
    const sim = this._simulation;
    for (let i = 0; i < sim.nodeList.length; i++) {
      const sNode = sim.nodeList[i];
      if (circleRectCollision(sNode.x, sNode.y, sNode.radius, xMin, xMax, yMin, yMax)) {
        nodesI.push(i);
        shouldRender.add(i);
      }
    }

    const edgesI = [];
    if (this._opts.renderEdges) {
      const ep = sim.edgePairs;
      for (let i = 0, j = 0; i < ep.length / 2; i++, j += 2) {
        if (shouldRender.has(ep[j]) || shouldRender.has(ep[j + 1])) 
          edgesI.push(i);
      }
    }

    return { nodesI, edgesI };
  }


  /**
   * @returns {boolean} whether the `sync()` and render took place
   */
  render() {
    if (!this._ctx || !this._size) return false;
    this.sync();

    const toRender = this._cull();
    const sim = this._simulation;

    this._ctx.fillStyle = this._opts.background;
    this._ctx.fillRect(0, 0, this._size.w, this._size.h);

    // Render edges
    if (this._opts.renderEdges) {
      for (const i of toRender.edgesI) {
        const iDbl = 2 * i;
        this._drawEdge(
          sim.nodeList[sim.edgePairs[iDbl]],
          sim.nodeList[sim.edgePairs[iDbl + 1]],
          this._edgeStyles[i],
          this._edgeBow[i],
        );
      }
    }

    // Render nodes
    for (const i of toRender.nodesI) {
      this._drawNode(sim.nodeList[i], this._nodeStyles[i])
    }

    return true;
  }


  /**
   * Draws a node on the canvas, positioned and sized according to a `SimNode`
   * object and styled according to a `NodeStyle` object.
   * @param {SimNode} sNode - simulation's node body object
   * @param {NodeStyle} nodeStyle - node style
   * @returns {void}
   */
  _drawNode(sNode, nodeStyle) {
    if (!this._ctx) return;
    const [cx, cy] = this.simToCanvas(sNode.x, sNode.y);
    const r = sNode.radius * this._view.zoom;
    this._ctx.beginPath();
    this._ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    const img = nodeStyle.image && this._images.get(nodeStyle.image);
    if (img && typeof img !== "string") {
      const scale = r * 2 / Math.min(img.width, img.height);
      const dw = img.width * scale, dh = img.height * scale;
      this._ctx.save();
      this._ctx.clip();
      this._ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      this._ctx.restore();
    } else {
      this._ctx.fillStyle = nodeStyle.color;
      this._ctx.fill();
    }
    if (nodeStyle.outlineWidth) {
      this._ctx.strokeStyle = nodeStyle.outlineColor;
      this._ctx.lineWidth = nodeStyle.outlineWidth;
      this._ctx.stroke();
    }
  }


  /**
   * Draws an edge between two nodes, trimmed to their radii, with an
   * arrowhead if `style.arrow` is set. Delegates self-loops to `_drawSelfLoop`.
   * @param {SimNode} src - source node
   * @param {SimNode} dest - destination node
   * @param {EdgeStyle} style - resolved edge style
   * @param {number} bowDir - 1 to bow the edge (half of a reciprocal pair), 0 to draw it straight
   * @returns {void}
   */
  _drawEdge(src, dest, style, bowDir) {
    if (!this._ctx) return;
    const ctx = this._ctx, z = this._view.zoom;
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
    const bow = bowDir * style.bow * this._view.zoom;  // Scale bow with zoom

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


  /**
   * Draws a filled triangular arrowhead pointing along a tangent.
   * @param {number} tipX - canvas x of the arrow tip
   * @param {number} tipY - canvas y of the arrow tip
   * @param {number} tx - x component of the unit tangent the arrow points along
   * @param {number} ty - y component of the unit tangent the arrow points along
   * @param {number} size - arrowhead length, in canvas px
   * @param {EdgeStyle} style - resolved edge style (supplies the fill color)
   * @returns {void}
   */
  _drawArrowhead(tipX, tipY, tx, ty, size, style) {
    if (!this._ctx) return;
    const ctx = this._ctx;
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


  /**
   * Draws a self-loop as a circle overlapping the node's upper right, with an
   * arrowhead on the node boundary if `style.arrow` is set.
   * @param {number} cx - canvas x of the node center
   * @param {number} cy - canvas y of the node center
   * @param {number} r - node radius, in canvas px
   * @param {EdgeStyle} style - resolved edge style
   * @returns {void}
   */
  _drawSelfLoop(cx, cy, r, style) {
    if (!this._ctx) return;
    const ctx = this._ctx;
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


  /**
   * Returns the id of a node at a specific point on the canvas
   * @param {number} cx - canvas x coordinate
   * @param {number} cy - canvas y coordinate
   * @returns {any | null} node id
   * @throws {Error} throws when no canvas is attached
   */
  nodeAt(cx, cy) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    const [x, y] = this.canvasToSim(cx, cy);
    const nodes = this._simulation.nodeList;
    const slack = 4 / this._view.zoom; // 4 world-coordinate radius slack
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], r = node.radius + slack;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r) return node.id;
    }
    return null;
  }


  /**
   * Returns the canvas coordinates of the node with the specified id, or null
   * if the node does not exist
   * @param {any} id - node id
   * @returns {[number, number] | null}
   * @throws {Error} throws when no canvas is attached
   */
  getPosition(id) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    const p = this._simulation.getPosition(id);
    return p ? this.simToCanvas(...p) : null;
  }


  /**
   * Finds a node by id and pins it to specified coordinates in canvas space
   * @param {any} id - node id
   * @param {number} cx - canvas x coordinate to pin to
   * @param {number} cy - canvas y coordinate to pin to
   * @returns {boolean} whether the node was pinned (`false` if node not found)
   * @throws {Error} throws when no canvas is attached
   */
  pin(id, cx, cy) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    return this._simulation.pin(id, ...this.canvasToSim(cx, cy));
  }


  /**
   * Unpins a node by id by reverting `fixed` to its default.
   * @param {any} id - node id
   * @returns {this} self reference
   */
  unpin(id) { this._simulation.unpin(id); return this; }
}
