/** @import { Graph } from './graph.js' */
/** @import { NodeId, GraphNode, GraphEdge } from './typedefs/graph.js' */
/** @import { SimNode } from './typedefs/simulation.js' */
/**
 * @import {
 *  ResolvedNodeStyleConfig, ResolvedEdgeStyleConfig,
 *  ResolvedNodeStyleAccessors, ResolvedEdgeStyleAccessors,
 * } from './typedefs/internal/renderer.js'
 */
/**
 * @import {
 *  NodeStyle, EdgeStyle,
 *  NodeStyleConfig, EdgeStyleConfig,
 *  RendererOpts, RendererOptsInput, HighlightMode,
 *  RendererHookType, RendererHook,
 *  RendererEventMap, RendererEventType,
 *  Canvas, CanvasContext, Size, View, ImageEntry,
 * } from './typedefs/renderer.js'
 */


import { Simulation } from "./simulation.js";
import { circleRectCollision, keysOf, now } from "./utils.js";
import { ConfigCascade } from "./config-cascade.js";
import { ImageCache, pickSpriteSize } from "./image-cache.js";
import { Highlighter } from "./highlighter.js";
import { RENDERER_DEFAULTS, NODE_STYLE_DEFAULTS, EDGE_STYLE_DEFAULTS } from "./defaults.js";
import { checkBoolean, checkEach, checkKnownKeys, checkNumber, checkOneOf, checkString } from "./validate.js";
import { HookRegistry } from "./hook-registry.js";
import { Emitter } from "./emitter.js";


/**
 * Every renderer event name. The type requires exactly the keys of
 * `RendererEventMap`, so adding an event there without adding it here fails
 * type checking.
 * @type {Record<RendererEventType, true>}
 */
const RENDERER_EVENT_NAMES = { imageload: true, imageerror: true };
const RENDERER_EVENT_TYPES = keysOf(RENDERER_EVENT_NAMES);


/**
 * Every drawing hook type. The type requires exactly the members of
 * `RendererHookType`.
 * @type {Record<RendererHookType, true>}
 */
const HOOK_NAMES = { background: true, overlay: true };
const HOOK_TYPES = keysOf(HOOK_NAMES);

/** Every renderer option name, including the setup and config options */
const OPTION_NAMES = new Set([...Object.keys(RENDERER_DEFAULTS), "canvas", "nodeConfig", "edgeConfig"]);

/** Every `ReferrerPolicy` value, for `imageReferrerPolicy` */
const REFERRER_POLICIES = [
  "", "no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin",
  "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url",
];

/**
 * A check per renderer option
 * @type {Record<keyof RendererOpts, (v: any) => void>}
 */
const OPTION_RULES = {
  background:            v => checkString("Renderer", "background", v),
  renderEdges:           v => checkBoolean("Renderer", "renderEdges", v),
  renderLabels:          v => checkBoolean("Renderer", "renderLabels", v),
  labelFont:             v => checkString("Renderer", "labelFont", v),
  labelPosition:         v => checkOneOf("Renderer", "labelPosition", v, ["bottom", "top", "left", "right"]),
  labelMargin:           v => checkNumber("Renderer", "labelMargin", v),
  minLabelSize:          v => checkNumber("Renderer", "minLabelSize", v, { min: 0 }),
  maxLabelSize:          v => checkNumber("Renderer", "maxLabelSize", v, { min: 0, allowInfinity: true }),
  scaleStrokes:          v => checkBoolean("Renderer", "scaleStrokes", v),
  minEdgeWidth:          v => checkNumber("Renderer", "minEdgeWidth", v, { min: 0 }),
  maxEdgeWidth:          v => checkNumber("Renderer", "maxEdgeWidth", v, { min: 0, allowInfinity: true }),
  highlightMode:         v => checkOneOf("Renderer", "highlightMode", v, ["dim", "hide"]),
  highlightAlpha:        v => checkNumber("Renderer", "highlightAlpha", v, { min: 0, max: 1 }),
  highlightFadeDuration: v => checkNumber("Renderer", "highlightFadeDuration", v, { min: 0 }),
  imageReferrerPolicy:   v => checkOneOf("Renderer", "imageReferrerPolicy", v, REFERRER_POLICIES),
  crossOrigin:           v => checkOneOf("Renderer", "crossOrigin", v, ["anonymous", "use-credentials", null]),
  imageCacheMB:          v => checkNumber("Renderer", "imageCacheMB", v, { min: 0, allowInfinity: true }),
};

/**
 * Font size (px) labels are measured and drawn at. Each label is scaled to its
 * own size by transform, so the font only has to be set once per frame.
 * Widths are stored per px of font size, since text width scales roughly
 * linearly with it.
 */
const LABEL_REF_SIZE = 100;

/** Faintest an edge is drawn when it fades below `minEdgeWidth`, as a
    fraction of its normal alpha. Fainter edges are skipped. */
const MIN_EDGE_FADE = 0.05;

/** Thinnest scaled node outline drawn, in canvas px. Thinner ones are
    skipped. */
const MIN_OUTLINE_WIDTH = 0.05;

/** Below this on-screen diameter (device px), an image node is drawn as a
    circle in the image's average colour. */
const IMAGE_DOT_THRESHOLD = 6;


/**
 * Renders a graph simulation to a canvas. Caches node styles, edge styles, and node images.
 * Emits the events in `RendererEventMap`, through `on()` and `off()`.
 * @extends {Emitter<RendererEventMap, Renderer>}
 */
export class Renderer extends Emitter {
  /** @private @type {Graph} */
  _graph;
  /**
   * Underlying `Graph` instance.
   */
  get graph() { return this._graph; }


  /** @private @type {Simulation} */
  _simulation;
  /**
   * Underlying `Simulation` instance.
   */
  get simulation() { return this._simulation; }


  /** @private @type {Canvas | null} */
  _canvas = null;
  /**
   * Canvas element. Set with `attach()`, unset with `detach()`.
   */
  get canvas() { return this._canvas; }


  /** @private @type {CanvasContext | null} */
  _ctx = null;
  /**
   * Canvas context. Automatically set to correspond to `canvas`.
   */
  get ctx() { return this._ctx; }


  /** @private @type {RendererOpts} */
  _opts = { ...RENDERER_DEFAULTS };
  /**
   * [read-only, set with `setOpts()`] Renderer configuration options.
   * @returns {Readonly<RendererOpts>}
   */
  get opts() { return this._opts; }


  /** @private @type {Size | null} */
  _size = null;
  /**
   * [read-only] Logical canvas size in CSS pixels (`clientWidth`, `clientHeight`).
   * @returns {Readonly<Size> | null}
   */
  get size() { return this._size; }


  /** @private @type {View} */
  _view = { x: 0, y: 0, zoom: 1 };
  /**
   * Current viewing window of the `Renderer`. Contains center simulation
   * coordinates and a zoom factor (canvasPx/simPx). Assigning to it sets the
   * values given, checked as `setView()` checks them.
   * @returns {View}
   */
  get view() { return this._view; }
  /**
   * @param {Partial<View>} v - view props to assign
   * @throws {RangeError} throws as `setView()` does
   */
  set view(v) { this.setView(v); }


  /** @private @type {Map<NodeId, NodeStyle>} */
  _nodes = new Map();
  /**
   * [read-only] Cached map of resolved node styles, keyed by node id from the underlying
   * `Graph`. Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<NodeId, NodeStyle>}
   */
  get nodes() { return this._nodes; }


  /** @private @type {Map<GraphEdge, EdgeStyle>} */
  _edges = new Map();
  /**
   * Cached map of resolved edge styles, keyed by edge object from the
   * underlying `Graph`. Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<GraphEdge, EdgeStyle>}
   */
  get edges() { return this._edges; }


  /**
   * Node style config: the default node style config, and per-node overrides
   * keyed by node id. A node's own overrides take priority over the default
   * config, which takes priority over the global defaults.
   * @type {ConfigCascade<ResolvedNodeStyleConfig, ResolvedNodeStyleAccessors, NodeId>}
   * @private
   */
  _nodeConfig = new ConfigCascade(NODE_STYLE_DEFAULTS);
  /**
   * [read-only, set with `setDefaultNodeConfig()`]
   * Current default node style config. During style resolution, it takes
   * precedence over global config defaults, but can be overriden for specific
   * nodes using `setNodeConfig()`.
   * @returns {Readonly<ResolvedNodeStyleConfig>}
   */
  get defaultNodeConfig() { return this._nodeConfig.defaults; }


  /**
   * Edge style config: the default edge style config, and per-edge overrides
   * keyed by edge object. An edge's own overrides take priority over the
   * default config, which takes priority over the global defaults.
   * @type {ConfigCascade<ResolvedEdgeStyleConfig, ResolvedEdgeStyleAccessors, GraphEdge>}
   * @private
   */
  _edgeConfig = new ConfigCascade(EDGE_STYLE_DEFAULTS);
  /**
   * [read-only, set with `setDefaultEdgeConfig()`]
   * Current default edge style config. During style resolution, it takes
   * precedence over global config defaults, but can be overriden for specific
   * edges using `setEdgeConfig()`.
   * @returns {Readonly<ResolvedEdgeStyleConfig>}
   */
  get defaultEdgeConfig() { return this._edgeConfig.defaults; }


  /** @private @type {NodeStyle[]} */
  _nodeStyles = [];
  /**
   * [read-only]
   * Cached raw node styles for the hot render loop. Recreated in effective
   * `sync()` calls.
   * @returns {ReadonlyArray<NodeStyle>}
   */
  get nodeStyles() { return this._nodeStyles; }


  /** @private @type {EdgeStyle[]} */
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
   * @private
   */
  _edgeBow = new Int8Array(0);


  /**
   * Highlight state: highlighted elements, per-slot flags, and the alphas
   * that fade toward them
   * @type {Highlighter}
   * @private
   */
  _highlighter = new Highlighter();
  /**
   * Ids of highlighted nodes. Modified via `highlight()`.
   * @returns {ReadonlySet<NodeId>}
   */
  get highlightedNodes() { return this._highlighter.nodes; }
  /**
   * Highlighted edge objects. Modified via `highlight()`.
   * @returns {ReadonlySet<GraphEdge>}
   */
  get highlightedEdges() { return this._highlighter.edges; }


  /**
   * Width of each node's label per px of font size, parallel to
   * `Simulation.nodeList`. 0 for nodes without a label.
   * @type {Float64Array}
   * @private
   */
  _labelWidthRatio = new Float64Array(0);


  /**
   * Label width ratios keyed by label text, measured in the current
   * `labelFont`. Holds only the labels present at the last measure
   * (updated by `_measureLabels()`).
   * @type {Map<string, number>}
   * @private
   */
  _labelWidthCache = new Map();


  /**
   * Whether `_labelWidthRatio` must be remeasured before the next draw. Set
   * when styles are resolved or `labelFont` changes.
   * @type {boolean}
   * @private
   */
  _labelsDirty = true;


  /**
   * The canvas context's `globalAlpha` during the current faded draw.
   * @type {number}
   * @private
   */
  _frameAlpha = 1;


  /**
   * Node images and their cached sprites. Settled requests are emitted as
   * `imageload` and `imageerror` events.
   * @type {ImageCache}
   * @private
   */
  _imageCache = new ImageCache((src, entry) => {
    if (entry.image) this._emit("imageload", { src, image: entry.image });
    else this._emit("imageerror", { src });
  });
  /**
   * [read-only] Node images, keyed by source: each entry's load `status`,
   * and the `image` once it has loaded
   * @returns {ReadonlyMap<string, Readonly<ImageEntry>>}
   */
  get images() { return this._imageCache.images; }


  /**
   * Counter of deleted nodes with images. Controls periodic image garbage-
   * collection (`_garbageCollectImages()`). GC happens when it reaches 16, at
   * which point it is reset to 0.
   * @type {number}
   * @private
   */
  _imageDebt = 0;


  /**
   * Device pixel ratio applied by the last `resize()`. Sprites are chosen
   * by on-screen size in device pixels.
   * @type {number}
   * @private
   */
  _dpr = 1;


  /**
   * Hook functions by type, run by `render()`: "background" hooks after the
   * background fill, "overlay" hooks after everything else is drawn
   * @type {HookRegistry<RendererHookType, RendererHook>}
   * @private
   */
  _hooks = new HookRegistry(HOOK_TYPES, "Renderer");

  
  /**
   * Stores the latest synced `Simulation` version. Used to gate node and edge
   * style cache updates.
   * @private
   * @type {number} */
  _syncedSimulation = -1;

  /**
   * Stores the latest synced `Graph`-data version. Used to gate node and edge
   * style cache updates.
   * @private
   * @type {number} */
  _syncedDataVersion = -1;

  /** @private @type {number} */
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
    super(RENDERER_EVENT_TYPES, "Renderer");
    this._simulation = simulation;
    this._graph = simulation.graph;
    this.setOpts(opts);
    this.sync();
  }


  /**
   * Sets options. Options left `undefined` keep their current value. Nothing
   * changes if any option is invalid.
   * @param {RendererOptsInput} optsInput - options to set
   * @returns {this} self reference
   * @throws {TypeError | RangeError} throws if an option is invalid or unknown
   */
  setOpts(optsInput = {}) {
    checkKnownKeys("Renderer", optsInput, OPTION_NAMES);
    const { canvas, nodeConfig, edgeConfig, ...opts } = optsInput;
    checkEach(opts, OPTION_RULES);

    for (const key of /** @type {(keyof RendererOpts)[]} */ (Object.keys(opts))) {
      if (opts[key] !== undefined) /** @type {any} */ (this._opts)[key] = opts[key];
    }
    // Cached label widths were measured in the old font
    if (opts.labelFont !== undefined) {
      this._labelWidthCache.clear();
      this._labelsDirty = true;
    }
    // Mode and alpha set the dimmed target, so ease toward the new value
    if (opts.highlightAlpha !== undefined || opts.highlightMode !== undefined) this._highlighter.startFade();
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
    // Cast: tsc resolves `getContext` on the canvas union unreliably
    const ctx = /** @type {CanvasContext | null} */ (canvas.getContext("2d"));
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
    this._dpr = dpr;
    this._size = { w, h };
    return this;
  }


  /**
   * Modifies fields of the `Renderer`'s default node style config
   * @param {NodeStyleConfig} [config={}] - object of config parameters that will modify the default node config
   * @returns {this} self reference
   */
  setDefaultNodeConfig(config = {}) {
    this._nodeConfig.setDefaults(config);
    return this;
  }


  /**
   * Merges new config data into a node's current style overrides.
   * @param {NodeId} id - node id
   * @param {NodeStyleConfig} [config={}] - config fields to set
   * @returns {this} self reference
   */
  setNodeConfig(id, config = {}) {
    this._nodeConfig.set(id, config);
    return this;
  }


  /**
   * Clears all of a node's style overrides
   * @param {NodeId} id - node id
   * @returns {this} self reference
   */
  clearNodeConfig(id) {
    this._nodeConfig.clear(id);
    return this;
  }


  /**
   * Modifies fields of the `Renderer`'s default edge style config
   * @param {EdgeStyleConfig} [config={}] - config parameters that will modify the default edge config
   * @returns {this} self reference
   */
  setDefaultEdgeConfig(config = {}) {
    this._edgeConfig.setDefaults(config);
    return this;
  }


  /**
   * Merges new config data into an edge's current style overrides.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {EdgeStyleConfig} [config={}] - config fields to set
   * @returns {this} self reference
   * @throws {ReferenceError} throws if the edge doesn't exist
   */
  setEdgeConfig(srcId, destId, config = {}) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) throw new ReferenceError(`Renderer: no edge from "${srcId}" to "${destId}"`);
    this._edgeConfig.set(gEdge, config);
    return this;
  }


  /**
   * Clears all of an edge's style overrides.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {this} self reference
   */
  clearEdgeConfig(srcId, destId) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (gEdge) this._edgeConfig.clear(gEdge);
    return this;
  }


  /**
   * Updates a node's style config based on graph node.
   * @param {GraphNode} gNode - graph node
   * @param {NodeStyle} rNode - node style
   * @private
   */
  _resolveNode(gNode, rNode) {
    const acc = this._nodeConfig.accessors, g = this._graph, o = this._nodeConfig.overrides.get(gNode.id);
    rNode.color = o?.color?.(gNode, g) ?? acc.color(gNode, g);
    rNode.outlineColor = o?.outlineColor?.(gNode, g) ?? acc.outlineColor(gNode, g);
    rNode.outlineWidth = o?.outlineWidth?.(gNode, g) ?? acc.outlineWidth(gNode, g);
    rNode.image = o?.image?.(gNode, g) ?? acc.image(gNode, g);
    rNode.label = o?.label?.(gNode, g) ?? acc.label(gNode, g);
    rNode.renderLabel = o?.renderLabel?.(gNode, g) ?? acc.renderLabel(gNode, g);
    rNode.labelScale = o?.labelScale?.(gNode, g) ?? acc.labelScale(gNode, g);
    rNode.labelTextColor = o?.labelTextColor?.(gNode, g) ?? acc.labelTextColor(gNode, g);
  }


  /**
   * Updates an edge's style config based on graph node.
   * @param {GraphEdge} gEdge - graph edge
   * @param {EdgeStyle} rEdge - edge style
   * @private
   */
  _resolveEdge(gEdge, rEdge) {
    const acc = this._edgeConfig.accessors, g = this._graph, o = this._edgeConfig.overrides.get(gEdge);
    rEdge.color = o?.color?.(gEdge, g) ?? acc.color(gEdge, g);
    rEdge.width = o?.width?.(gEdge, g) ?? acc.width(gEdge, g);
    rEdge.arrowSize = o?.arrowSize?.(gEdge, g) ?? acc.arrowSize(gEdge, g);
    rEdge.bow = o?.bow?.(gEdge, g) ?? acc.bow(gEdge, g);

    // unset (null/undefined) means "whatever the graph is"
    const arrow = o?.arrow?.(gEdge, g) ?? acc.arrow(gEdge, g);
    rEdge.arrow = arrow === null || arrow === undefined ? g.directed : arrow === true;
  }


  /**
   * Overwrites highlighted elements and highlight options.
   * @param {object} params
   * @param {NodeId[]} [params.nodes=[]] - ids of nodes
   * @param {[NodeId, NodeId][]} [params.edges=[]] - list of edges as node id pairs
   * @param {HighlightMode} [params.mode] - highlight mode
   * @param {number} [params.alpha] - dim alpha
   * @returns {this} self reference
   */
  setHighlight({ nodes = [], edges = [], mode, alpha} = { nodes: [], edges: [] }) {
    const optsToSet = {};
    if (mode !== undefined) optsToSet.highlightMode = mode;
    if (alpha !== undefined) optsToSet.highlightAlpha = alpha;
    this.setOpts(optsToSet);
    this.clearHighlight();
    this.addHighlight({ nodes, edges });
    return this;
  }


  /**
   * Highlights selected elements.
   * @param {object} params
   * @param {NodeId[]} [params.nodes] - ids of nodes
   * @param {[NodeId, NodeId][]} [params.edges] - list of edges as node id pairs
   * @returns {this} self reference
   */
  addHighlight({ nodes = [], edges = [] } = {}) {
    // Sync graph structure first
    this.sync();

    const hl = this._highlighter;
    for (const id of nodes) {
      const i = this.simulation.nodeIndex.get(id);
      if (i !== undefined) hl.addNode(id, i);
    }
    for (const idPair of edges) {
      const edge = this.graph.getEdge(...idPair);
      if (!edge) continue;
      const i = this.simulation.edgeIndex.get(edge);
      if (i !== undefined) hl.addEdge(edge, i);
    }
    hl.startFade();
    return this;
  }


  /**
   * Clears highlights from selected elements, or all highlights if no inputs
   * are defined.
   * @param {object} params
   * @param {NodeId[]} [params.nodes] - ids of nodes
   * @param {[NodeId, NodeId][]} [params.edges] - list of edges as node id pairs
   * @returns {this} self reference
   */
  clearHighlight({ nodes, edges } = {}) {
    // Sync graph structure first
    this.sync();

    const hl = this._highlighter;
    hl.startFade();

    // Clear all if no elements are defined
    if (!nodes && !edges) {
      hl.clear();
      return this;
    }
    if (nodes) {
      for (const id of nodes) hl.removeNode(id, this.simulation.nodeIndex.get(id));
    }
    if (edges) {
      for (const idPair of edges) {
        const edge = this.graph.getEdge(...idPair);
        if (edge) hl.removeEdge(edge, this.simulation.edgeIndex.get(edge));
      }
    }
    return this;
  }


  /**
   * @returns {boolean} whether the renderer has any highlighted elements
   */
  hasHighlight() { return this._highlighter.has(); }


  /**
   * Whether highlight opacities are still changing. Loops that only render on
   * demand should keep calling `render()` while this is `true`.
   * @returns {boolean} whether a highlight fade is in progress
   */
  isFading() { return this._highlighter.isFading(); }


  /**
   * Seeds a node's style config based on its underlying `Graph` node.
   * @param {GraphNode} gNode - graph node to seed the node style from
   * @returns {NodeStyle} seeded node style
   * @private
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
   * @private
   */
  _seedEdge(gEdge) {
    const rEdge = {...EDGE_STYLE_DEFAULTS};
    this._resolveEdge(gEdge, rEdge);
    return rEdge;
  }


  /**
   * Starts loading an image into the cache, keyed by its source. Its entry in
   * `images` has the status "loading" until the request settles, then
   * "loaded" or "failed". Uses the renderer's current `crossOrigin` and
   * `imageReferrerPolicy`. A source that is loading or loaded is not requested
   * again; one that failed is. Failed images are only retried by calling this:
   * the renderer itself never requests them again. When the request settles,
   * an `imageload` or `imageerror` event is emitted.
   * @param {string} src - image source; also the cache key
   * @returns {boolean} `true` if a request was started, `false` if `src` is
   *    already loading or loaded
   */
  loadImage(src) {
    return this._imageCache.load(src, this._opts.crossOrigin, this._opts.imageReferrerPolicy, true);
  }


  /**
   * Find and delete images that are no longer used by any nodes.
   * @returns {void}
   * @private
   */
  _garbageCollectImages() {
    /** @type {Set<string>} */
    const live = new Set();
    for (const rNode of this._nodes.values()) if (rNode.image) live.add(rNode.image);
    this._imageCache.collect(live);
  }


  /**
   * Adds a function for `render()` to call each frame. "background" hooks run
   * after the background fill, beneath edges, nodes and labels; "overlay"
   * hooks run after everything else, on top. Hooks of a type run in the order
   * they were added, and adding the same function again has no effect.
   *
   * Hooks draw in canvas coordinates (CSS pixels) between `ctx.save()` and
   * `ctx.restore()` calls. An error thrown by a hook is logged, and the
   * render continues.
   * @param {RendererHookType} type - hook type
   * @param {RendererHook} f - hook function, called with the renderer and the
   *    frame's timestamp
   * @returns {this} self reference
   */
  addHook(type, f) {
    this._hooks.add(type, f);
    return this;
  }


  /**
   * Removes a hook. Returns whether the hook existed in its corresponding
   * type `Set`.
   * @param {RendererHookType} type - hook type
   * @param {RendererHook} f - hook function to remove
   * @returns {boolean} - whether the hook existed
   */
  removeHook(type, f) {
    return this._hooks.remove(type, f);
  }


  /**
   * Runs all hooks of a specific type, with a timestamp passed.
   * @param {RendererHookType} type - hook type
   * @param {number} time - timestamp from `render()`
   * @returns {void}
   * @private
   */
  _runHooks(type, time) {
    const ctx = this._ctx;
    if (!ctx) return;
    this._hooks.run(type, f => {
      ctx.save();
      try { f(this, time); }
      finally { ctx.restore(); }
    });
  }


  /**
   * Syncs internal nodes and edges to match the shape of underlying `Graph`.
   * Also resolves node and edge configs to apply overrides or defaults.
   * Gates on config changes, graph data changes, and graph shape changes.
   * @returns {boolean} whether cached node and edge render configs were modified
   */
  sync() {
    this._simulation.sync();

    if (this._syncedDataVersion !== this._graph.dataVersion) {
      this._nodeConfig.markDirty();
      this._edgeConfig.markDirty();
      this._syncedDataVersion = this._graph.dataVersion;
    }

    const stylesDirty = this._nodeConfig.dirty || this._edgeConfig.dirty;
    if (this._syncedSimulation === this._simulation.version && !stylesDirty) return false;
    
    // Update node styles and seed new ones
    for (const [id, gNode] of this._graph.nodes) {
      let rNode = this._nodes.get(id);
      if (rNode) this._resolveNode(gNode, rNode);
      else {
        rNode = this._seedNode(gNode);
        this._nodes.set(id, rNode);
      }
      // Load node image into cache. Failed images aren't retried here, or a
      // broken source would be requested again on every graph change.
      if (rNode.image) {
        this._imageCache.load(rNode.image, this._opts.crossOrigin, this._opts.imageReferrerPolicy);
      }
    }

    // Update edge styles and seed new ones
    for (const gEdge of this._graph.edges) {
      const rEdge = this._edges.get(gEdge);
      if (rEdge) this._resolveEdge(gEdge, rEdge);
      else this._edges.set(gEdge, this._seedEdge(gEdge));
    }

    this._nodeConfig.markClean();
    this._edgeConfig.markClean();
    this._labelsDirty = true;

    if (this._syncedSimulation === this._simulation.version) return true;

    /* Alphas are about to be re-slotted. While a highlight is shown or a fade
       is running, carry each surviving element's alpha across by its style
       object, which persists through syncs. Pruning below can also end the
       highlight, so this is decided first. */
    const hl = this._highlighter;
    const snap = hl.snapshot(this._nodeStyles, this._edgeStyles);

    // Delete old node styles
    for (const id of this._nodes.keys()) {
      if (!this._graph.nodes.has(id)) {
        if (this._nodes.get(id)?.image) this._imageDebt++;
        this._nodes.delete(id);
        this._nodeConfig.prune(id);
        hl.forgetNode(id);
      }
    }
    if (this._imageDebt > 16) { this._garbageCollectImages(); this._imageDebt = 0; }

    // Delete old edge styles
    for (const gEdge of this._edges.keys()) {
      if (!this._graph.edges.has(gEdge)) {
        this._edges.delete(gEdge);
        this._edgeConfig.prune(gEdge);
        hl.forgetEdge(gEdge);
      }
    }

    // Refresh caches

    // Node styles
    this._nodeStyles = [];
    for (const sNode of this._simulation.nodeList) {
      const rNode = this._nodes.get(sNode.id);
      if (rNode) this._nodeStyles.push(rNode);
    }

    const sim = this._simulation;

    // Edge pairs
    const refs = sim.edgeList;
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

    // Highlight flags and alphas: survivors keep theirs, new elements start at target
    hl.reslot(snap, sim.nodeList, sim.edgeList, this._nodeStyles, this._edgeStyles,
      this._opts.highlightMode, this._opts.highlightAlpha);

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
   * Sets some or all of the view. Nothing changes if any value is invalid.
   * Like other changes, it shows on the next render.
   * @param {Partial<View>} view - view values to set; `undefined` values are
   *    left alone
   * @returns {this} self reference
   * @throws {RangeError} throws if a coordinate isn't finite, or the zoom
   *    isn't a finite number above 0
   */
  setView(view) {
    const { x, y, zoom } = view;
    if (x !== undefined && !Number.isFinite(x)) throw new RangeError("Renderer: view `x` must be finite");
    if (y !== undefined && !Number.isFinite(y)) throw new RangeError("Renderer: view `y` must be finite");
    if (zoom !== undefined) checkZoom(zoom, "view `zoom`");
    const v = this._view;
    if (x !== undefined) v.x = x;
    if (y !== undefined) v.y = y;
    if (zoom !== undefined) v.zoom = zoom;
    return this;
  }


  /**
   * Returns the view moved so the graph shifts by a distance on the canvas,
   * as dragging the background does, without applying it.
   * @param {number} dx - canvas px to shift the graph right
   * @param {number} dy - canvas px to shift the graph down
   * @returns {View} the panned view
   * @throws {RangeError} throws if `dx` or `dy` isn't finite
   */
  viewPannedBy(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new RangeError("Renderer: pan distances must be finite");
    }
    const v = this._view;
    return { x: v.x - dx / v.zoom, y: v.y - dy / v.zoom, zoom: v.zoom };
  }


  /**
   * Shifts the graph by a distance on the canvas, as dragging the background
   * does.
   * @param {number} dx - canvas px to shift the graph right
   * @param {number} dy - canvas px to shift the graph down
   * @returns {this} self reference
   * @throws {RangeError} throws if `dx` or `dy` isn't finite
   */
  panBy(dx, dy) { return this.setView(this.viewPannedBy(dx, dy)); }


  /**
   * Returns the view at a zoom, without applying it. With an anchor point,
   * the graph under that point stays where it is, as zooming with the wheel
   * does; without one, the canvas centre stays.
   * @param {number} zoom - zoom (canvas px per simulation px)
   * @param {number} [cx] - canvas x coordinate of the anchor
   * @param {number} [cy] - canvas y coordinate of the anchor
   * @returns {View} the zoomed view
   * @throws {RangeError} throws if the zoom isn't a finite number above 0,
   *    or the anchor isn't finite
   * @throws {TypeError} throws if only one anchor coordinate is given
   * @throws {Error} throws if an anchor is given and no canvas is attached
   */
  viewZoomedTo(zoom, cx = undefined, cy = undefined) {
    checkZoom(zoom, "zoom");
    const v = this._view;
    if (cx === undefined && cy === undefined) return { x: v.x, y: v.y, zoom };
    if (cx === undefined || cy === undefined) {
      throw new TypeError("Renderer: a zoom anchor needs both coordinates");
    }
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      throw new RangeError("Renderer: zoom anchor must be finite");
    }
    const [sx, sy] = this.canvasToSim(cx, cy);
    const size = /** @type {Size} */ (this._size);
    return { x: sx - (cx - size.w / 2) / zoom, y: sy - (cy - size.h / 2) / zoom, zoom };
  }


  /**
   * Sets the zoom. With an anchor point, the graph under that point stays
   * where it is, as zooming with the wheel does; without one, the canvas
   * centre stays.
   * @param {number} zoom - zoom (canvas px per simulation px)
   * @param {number} [cx] - canvas x coordinate of the anchor
   * @param {number} [cy] - canvas y coordinate of the anchor
   * @returns {this} self reference
   * @throws {RangeError | TypeError | Error} throws as `viewZoomedTo()` does
   */
  zoomTo(zoom, cx = undefined, cy = undefined) {
    return this.setView(this.viewZoomedTo(zoom, cx, cy));
  }


  /**
   * Multiplies the zoom by a factor: above 1 zooms in, below 1 zooms out.
   * Anchored as `zoomTo()` is.
   * @param {number} factor - factor to multiply the zoom by
   * @param {number} [cx] - canvas x coordinate of the anchor
   * @param {number} [cy] - canvas y coordinate of the anchor
   * @returns {this} self reference
   * @throws {RangeError | TypeError | Error} throws as `viewZoomedTo()` does,
   *    or if the factor isn't a finite number above 0
   */
  zoomBy(factor, cx = undefined, cy = undefined) {
    checkZoom(factor, "zoom factor");
    return this.zoomTo(this._view.zoom * factor, cx, cy);
  }


  /**
   * Draws a node on the canvas, positioned and sized according to a `SimNode`
   * object and styled according to a `NodeStyle` object.
   * @param {SimNode} sNode - simulation's node body object
   * @param {NodeStyle} nodeStyle - node style
   * @returns {void}
   * @private
   */
  _drawNode(sNode, nodeStyle) {
    if (!this._ctx) return;
    const [cx, cy] = this.simToCanvas(sNode.x, sNode.y);
    const r = sNode.radius * this._view.zoom;
    this._ctx.beginPath();
    this._ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    const src = nodeStyle.image;
    const img = src ? this._imageCache.loaded(src) : null;
    if (src && img) {
      const needed = 2 * r * this._dpr;     // on-screen diameter, device px
      if (needed < IMAGE_DOT_THRESHOLD) {
        // Too small to show detail: a dot in the image's average colour
        this._ctx.fillStyle = this._imageCache.average(src, img) ?? nodeStyle.color;
        this._ctx.fill();
      } else {
        const side = Math.min(img.width, img.height);
        const size = pickSpriteSize(needed, side);
        // A sprite smaller than the node is stretched, which blurs it. When the
        // source has more detail than that sprite (past the largest sprite
        // size, or between two sizes), draw the source instead.
        const sprite = size < needed && size < side ? null : this._imageCache.sprite(src, img, size);
        if (sprite) {
          this._ctx.drawImage(sprite, cx - r, cy - r, 2 * r, 2 * r);
        } else {
          // Drawing the source: no sprite is sharp enough, none is available
          // (no canvas support), or this frame's build limit was reached
          const scale = r * 2 / Math.min(img.width, img.height);
          const dw = img.width * scale, dh = img.height * scale;
          this._ctx.save();
          this._ctx.clip();
          this._ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
          this._ctx.restore();
        }
      }
    } else {
      this._ctx.fillStyle = nodeStyle.color;
      this._ctx.fill();
    }
    if (nodeStyle.outlineWidth) {
      // Scaled outlines too thin to see are skipped
      const scale = this._opts.scaleStrokes;
      const width = scale ? nodeStyle.outlineWidth * this._view.zoom : nodeStyle.outlineWidth;
      if (scale && width < MIN_OUTLINE_WIDTH) return;
      this._ctx.strokeStyle = nodeStyle.outlineColor;
      this._ctx.lineWidth = width;
      this._ctx.stroke();
    }
  }

  
  /**
   * Draws a node's label. Whether it should be drawn (has a label, is
   * enabled, large enough, on screen) is decided by `_cull()`.
   *
   * Expects the context to hold the label font at `LABEL_REF_SIZE` and the
   * alignment for `labelPosition`, both set once per frame by `render()`. The
   * label is sized and placed by transform, which is left set; `render()`
   * restores the base transform after each label pass.
   * @param {SimNode} sNode - simulation node body object
   * @param {NodeStyle} nodeStyle - node style
   * @returns {void}
   * @private
   */
  _drawNodeLabel(sNode, nodeStyle) {
    if (!this._ctx) return;
    const zoom = this._view.zoom, dpr = this._dpr;
    let [x, y] = this.simToCanvas(sNode.x, sNode.y);
    const r = (sNode.radius + this._opts.labelMargin) * zoom;
    switch (this._opts.labelPosition) {
      case "top":   y -= r; break;
      case "right": x += r; break;
      case "left":  x -= r; break;
      default:      y += r; break;   // "bottom"
    }
    // Scale the reference-size font to this label's size, anchored at (x, y)
    const size = Math.min(nodeStyle.labelScale * zoom, this._opts.maxLabelSize);
    const s = dpr * size / LABEL_REF_SIZE;
    this._ctx.setTransform(s, 0, 0, s, dpr * x, dpr * y);
    this._ctx.fillStyle = nodeStyle.labelTextColor;
    this._ctx.fillText(String(nodeStyle.label), 0, 0);
  }


  /**
   * Draws an edge between two nodes, trimmed to their radii, with an
   * arrowhead if `style.arrow` is set. Delegates self-loops to `_drawSelfLoop`.
   * @param {SimNode} src - source node
   * @param {SimNode} dest - destination node
   * @param {EdgeStyle} style - resolved edge style
   * @param {number} bowDir - 1 to bow the edge (half of a reciprocal pair), 0 to draw it straight
   * @param {number} [alpha=1] - the edge's highlight alpha, which the caller
   *    has already set on the context. A faded edge (scaled below
   *    `minEdgeWidth`) is drawn fainter than this, then the context is reset
   *    to it.
   * @returns {void}
   * @private
   */
  _drawEdge(src, dest, style, bowDir, alpha = 1) {
    if (!this._ctx) return;
    const ctx = this._ctx, z = this._view.zoom;

    /* Stroke size in canvas px. A scaled edge follows the zoom, and `k` sizes
       its arrowhead and self-loop to match, so they shrink along with it
       while the line is capped at `maxEdgeWidth`. An edge thinner than
       `minEdgeWidth` is drawn at that width but fainter, instead of as a
       sub-pixel line, which browsers render inconsistently. */
    let width = style.width, k = 1, fade = 1;
    if (this._opts.scaleStrokes) {
      const { minEdgeWidth, maxEdgeWidth } = this._opts;
      width *= z;
      k = z;
      if (width > maxEdgeWidth) {
        k *= maxEdgeWidth / width;
        width = maxEdgeWidth;
      } else if (width < minEdgeWidth) {
        fade = width / minEdgeWidth;
        width = minEdgeWidth;
      }
      if (fade < MIN_EDGE_FADE || !(width > 0)) return;    // too faint to see
    }

    const [ax, ay] = this.simToCanvas(src.x, src.y);
    const [bx, by] = this.simToCanvas(dest.x, dest.y);
    const ra = src.radius * z, rb = dest.radius * z;

    if (src === dest) {
      if (fade < 1) ctx.globalAlpha = alpha * fade;
      this._drawSelfLoop(ax, ay, ra, style, width, k);
      if (fade < 1) ctx.globalAlpha = alpha;
      return;
    }

    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;

    const head = style.arrow ? style.arrowSize * k : 0;
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

    if (fade < 1) ctx.globalAlpha = alpha * fade;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    // Stop the stroke at the arrowhead's base so a thick line can't show
    // through the notch of the filled triangle.
    if (bow) ctx.quadraticCurveTo(cx, cy, ex - t1x * head, ey - t1y * head);
    else ctx.lineTo(ex - ux * head, ey - uy * head);
    ctx.stroke();

    if (style.arrow) this._drawArrowhead(ex, ey, t1x, t1y, head, style);
    if (fade < 1) ctx.globalAlpha = alpha;
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
   * @private
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
   * @param {number} width - line width, in canvas px
   * @param {number} k - canvas px per unit of `arrowSize`
   * @returns {void}
   * @private
   */
  _drawSelfLoop(cx, cy, r, style, width, k) {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const head = style.arrowSize * k;
    const lr = Math.max(r * 0.8, (style.arrow ? head : 6 * k) * 1.6);
    const a = -Math.PI / 4;
    const D = r + lr * 0.6;                      // node centre -> loop centre
    const ux = Math.cos(a), uy = Math.sin(a);
    const lx = cx + ux * D, ly = cy + uy * D;

    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
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
        this._drawArrowhead(tipX, tipY, tx, ty, head, style);
        return;
      }
    }
  }

  
  /**
   * Draws a node identified by cache index.
   * @param {number} i - cache index of node
   * @private
   */
  _renderNodeByIndex(i) {
    this._drawNode(this.simulation.nodeList[i], this._nodeStyles[i]);
  }

  /**
   * Draws a node's label, identified by cache index.
   * @param {number} i - cache index of node
   * @private
   */
  _renderNodeLabelByIndex(i) {
    this._drawNodeLabel(this.simulation.nodeList[i], this._nodeStyles[i]);
  }


  /**
   * Draws an edge identified by cache index.
   * @param {number} i - cache index of edge
   * @param {number} [alpha=1] - the edge's highlight alpha, which the caller
   *    has already set on the context
   * @private
   */
  _renderEdgeByIndex(i, alpha = 1) {
    const sim = this.simulation;
    const iDbl = 2 * i;
    this._drawEdge(
      sim.nodeList[sim.edgePairs[iDbl]],
      sim.nodeList[sim.edgePairs[iDbl + 1]],
      this._edgeStyles[i],
      this._edgeBow[i],
      alpha,
    );
  }


  /**
   * Measures each node's label width per px of font size into
   * `_labelWidthRatio`, reusing cached widths of unchanged label text.
   * @returns {void}
   * @private
   */
  _measureLabels() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const styles = this._nodeStyles;
    const prev = this._labelWidthCache, next = new Map();
    this._labelWidthRatio = new Float64Array(styles.length);
    let fontSet = false;     // only set the font once something needs measuring
    for (let i = 0; i < styles.length; i++) {
      const label = styles[i].label;
      if (label == null || label === "") continue;
      const text = String(label);
      let ratio = next.get(text) ?? prev.get(text);
      if (ratio === undefined) {
        if (!fontSet) { ctx.font = `${LABEL_REF_SIZE}px ${this._opts.labelFont}`; fontSet = true; }
        ratio = ctx.measureText(text).width / LABEL_REF_SIZE;
      }
      next.set(text, ratio);
      this._labelWidthRatio[i] = ratio;
    }
    this._labelWidthCache = next;
    this._labelsDirty = false;
  }


  /**
   * Culls all nodes, edges, and labels fully outside the current view.
   * Only keeps on-screen nodes, edges connected to at least one on-screen
   * node, and on-screen labels.
   * @returns {{nodesI: number[], edgesI: number[], labelsI: number[]}}
   * @private
   */
  _cull() {
    if (!this._size) return { nodesI: [], edgesI: [], labelsI: [] };
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

    const labelsI = [];
    if (this._opts.renderLabels) {
      const { labelMargin, labelPosition, minLabelSize, maxLabelSize } = this._opts;
      const zoom = this._view.zoom, ratios = this._labelWidthRatio;
      for (let i = 0; i < sim.nodeList.length; i++) {
        const style = this._nodeStyles[i];
        if (!ratios[i] || !style.renderLabel) continue;     // no label, or disabled
        const px = style.labelScale * zoom;
        if (px < minLabelSize) continue;                     // too small to read
        // Label bounds in world units
        const sNode = sim.nodeList[i];
        const h = Math.min(px, maxLabelSize) / zoom;
        const w = ratios[i] * h;
        const d = sNode.radius + labelMargin;
        let x0, y0;
        switch (labelPosition) {
          case "top":   x0 = sNode.x - w / 2; y0 = sNode.y - d - h; break;
          case "right": x0 = sNode.x + d;     y0 = sNode.y - h / 2; break;
          case "left":  x0 = sNode.x - d - w; y0 = sNode.y - h / 2; break;
          default:      x0 = sNode.x - w / 2; y0 = sNode.y + d;     break;
        }
        if (x0 < xMax && x0 + w > xMin && y0 < yMax && y0 + h > yMin) labelsI.push(i);
      }
    }

    return { nodesI, edgesI, labelsI };
  }


  /**
   * Sets the context alpha for the next element, writing it only when it
   * changes.
   * @param {number} alpha - element alpha
   * @returns {boolean} `false` when the element is invisible and can be skipped
   * @private
   */
  _useAlpha(alpha) {
    if (alpha === 0) return false;
    if (alpha !== this._frameAlpha) {
      /** @type {CanvasContext} */ (this._ctx).globalAlpha = alpha;
      this._frameAlpha = alpha;
    }
    return true;
  }


  /**
   * Renders the current view of the graph according to current styles and
   * highlight state.
   * @param {number} [time] - frame timestamp in milliseconds, used to advance
   *    highlight fades. Defaults to `performance.now()`; pass the
   *    `requestAnimationFrame` timestamp when rendering from a loop.
   * @returns {boolean} whether the `sync()` and render took place
   */
  render(time = now()) {
    if (!this._ctx || !this._size) return false;
    this.sync();
    // Eases every alpha toward its target, off-screen elements included, so
    // they don't come back into view mid-fade
    const opts = this._opts;
    this._highlighter.step(time, opts.highlightFadeDuration, opts.highlightMode, opts.highlightAlpha);
    this._imageCache.beginFrame();
    if (this._opts.renderLabels && this._labelsDirty) this._measureLabels();

    const inFrame = this._cull();

    this._ctx.fillStyle = this._opts.background;
    this._ctx.fillRect(0, 0, this._size.w, this._size.h);

    this._runHooks("background", time);

    // Text state shared by every label this frame; each label scales the font
    // to its own size by transform
    const hasLabels = inFrame.labelsI.length > 0;
    if (hasLabels) {
      this._ctx.font = `${LABEL_REF_SIZE}px ${this._opts.labelFont}`;
      switch (this._opts.labelPosition) {
        case "top":
          this._ctx.textAlign = "center";
          this._ctx.textBaseline = "bottom";
          break;
        case "right":
          this._ctx.textAlign = "left";
          this._ctx.textBaseline = "middle";
          break;
        case "left":
          this._ctx.textAlign = "right";
          this._ctx.textBaseline = "middle";
          break;
        default: // "bottom"
          this._ctx.textAlign = "center";
          this._ctx.textBaseline = "top";
          break;
      }
    }
    const dpr = this._dpr;

    const hl = this._highlighter;
    if (hl.has() || hl.isFading()) {
      const { nodeState, nodeAlpha, edgeState, edgeAlpha } = hl;
      this._frameAlpha = 1;
      for (const flag of [0, 1]) {
        for (const i of inFrame.edgesI) {
          if (edgeState[i] === flag && this._useAlpha(edgeAlpha[i]))
            this._renderEdgeByIndex(i, edgeAlpha[i]);
        }
        for (const i of inFrame.nodesI) {
          if (nodeState[i] === flag && this._useAlpha(nodeAlpha[i]))
            this._renderNodeByIndex(i);
        }
        for (const i of inFrame.labelsI) {
          if (nodeState[i] === flag && this._useAlpha(nodeAlpha[i]))
            this._renderNodeLabelByIndex(i);
        }
        // Highlighted nodes are drawn next, in canvas space
        if (hasLabels) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (this._frameAlpha !== 1) this._ctx.globalAlpha = 1;
    } else {
      for (const i of inFrame.edgesI) this._renderEdgeByIndex(i);
      for (const i of inFrame.nodesI) this._renderNodeByIndex(i);
      for (const i of inFrame.labelsI) this._renderNodeLabelByIndex(i);
      if (hasLabels) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this._runHooks("overlay", time);

    this._imageCache.endFrame(this._opts.imageCacheMB * 1024 * 1024);

    return true;
  }


  /**
   * Returns the id of a node at a specific point on the canvas. A node
   * removed from the graph isn't found, even before the simulation syncs.
   * @param {number} cx - canvas x coordinate
   * @param {number} cy - canvas y coordinate
   * @param {number} [slack] - slack, in canvas pixels
   * @returns {NodeId | null} node id
   * @throws {Error} throws when no canvas is attached
   */
  nodeAt(cx, cy, slack = 2) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    const [x, y] = this.canvasToSim(cx, cy);
    const nodes = this._simulation.nodeList;
    const s = Math.max(slack, 0) / this._view.zoom; // radius slack
    const graphNodes = this._graph.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], r = node.radius + s;
      // The node list lags the graph until the next sync: skip removed nodes
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r && graphNodes.has(node.id)) return node.id;
    }
    return null;
  }


  /**
   * Returns the canvas coordinates of the node with the specified id, or null
   * if the node does not exist
   * @param {NodeId} id - node id
   * @returns {[number, number] | null}
   * @throws {Error} throws when no canvas is attached
   */
  getPosition(id) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    const p = this._simulation.getPosition(id);
    return p ? this.simToCanvas(...p) : null;
  }
}

/**
 * Throws unless a zoom, or zoom factor, is a finite number above 0.
 * @param {number} zoom - value to check
 * @param {string} name - name for the error message
 * @returns {void}
 * @throws {RangeError} throws if the value is invalid
 */
function checkZoom(zoom, name) {
  if (!(zoom > 0 && Number.isFinite(zoom))) {
    throw new RangeError(`Renderer: ${name} must be a finite number above 0`);
  }
}
