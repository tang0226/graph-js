/** @import { Graph } from './graph.js' */
/** @import { NodeId, GraphNode, GraphEdge } from './typedefs/graph.js' */
/** @import { SimNode } from './typedefs/simulation.js' */
/**
 * @import {
 *  ResolvedNodeStyleConfig, ResolvedEdgeStyleConfig,
 *  ResolvedNodeStyleAccessors, ResolvedEdgeStyleAccessors, EdgeLayout, LabelBox, Bounds,
 * } from './typedefs/internal/renderer.js'
 */
/**
 * @import {
 *  NodeStyle, EdgeStyle,
 *  NodeStyleConfig, EdgeStyleConfig,
 *  RendererOpts, RendererOptsInput, HighlightMode, ExportOpts, ExportBlobOpts,
 *  RendererHookType, RendererHook,
 *  RendererEventMap, RendererEventType,
 *  Canvas, CanvasContext, Size, View, ImageEntry, ImageCrossOrigin,
 * } from './typedefs/renderer.js'
 */


import { Simulation } from "./simulation.js";
import { circleRectCollision, keysOf, now, segmentDistance2 } from "./utils.js";
import { ConfigCascade } from "./config-cascade.js";
import { ImageCache } from "./image-cache.js";
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

/** Every `ImageCrossOrigin` value, for `crossOrigin` */
const CROSS_ORIGINS = ["anonymous", "use-credentials", null];

/**
 * Throws unless an image request option is one of `values`, or a function
 * giving it per image source. What such a function returns is checked when
 * it's called, in `_imageRequestOpts()`.
 * @param {string} name - option name
 * @param {unknown} value - value to check
 * @param {readonly unknown[]} values - allowed values
 * @returns {void}
 * @throws {RangeError} throws if the value is neither
 */
const checkImageRequestOpt = (name, value, values) => {
  if (typeof value === "function") return;
  try { checkOneOf("Renderer", name, value, values); }
  catch (err) { throw new RangeError(`${/** @type {Error} */ (err).message}, or a function of the image source`); }
};

/**
 * Throws unless a background is a string or `null`.
 * @param {unknown} v - value to check
 * @returns {void}
 * @throws {TypeError} throws if it's neither
 */
const checkBackground = v => {
  if (v !== null && typeof v !== "string") throw new TypeError("Renderer: `background` must be a string or null");
};

/**
 * A check per export option
 * @type {Record<keyof ExportOpts, (v: any) => void>}
 */
const EXPORT_RULES = {
  canvas: v => {
    if (typeof v?.getContext !== "function") throw new TypeError("Renderer: export `canvas` must be a canvas");
  },
  fit:        v => checkBoolean("Renderer", "fit", v),
  padding:    v => checkNumber("Renderer", "padding", v, { min: 0 }),
  width:      v => checkNumber("Renderer", "width", v, { min: 0, aboveMin: true }),
  height:     v => checkNumber("Renderer", "height", v, { min: 0, aboveMin: true }),
  pixelRatio: v => checkNumber("Renderer", "pixelRatio", v, { min: 0, aboveMin: true }),
  background: checkBackground,
  hooks:      v => checkBoolean("Renderer", "hooks", v),
};
const EXPORT_OPTION_NAMES = new Set(Object.keys(EXPORT_RULES));

/** A check per option `toBlob()` has on top of the export options */
const BLOB_RULES = {
  type:          (/** @type {unknown} */ v) => checkString("Renderer", "type", v),
  quality:       (/** @type {unknown} */ v) => checkNumber("Renderer", "quality", v, { min: 0, max: 1 }),
  waitForImages: (/** @type {unknown} */ v) => checkBoolean("Renderer", "waitForImages", v),
};
const BLOB_OPTION_NAMES = new Set([...EXPORT_OPTION_NAMES, ...Object.keys(BLOB_RULES)]);

/**
 * Makes a canvas to export onto: a canvas element where there's a document,
 * otherwise an `OffscreenCanvas`.
 * @returns {Canvas} the canvas
 * @throws {Error} throws if neither is available
 */
const makeExportCanvas = () => {
  if (typeof globalThis.document?.createElement === "function") return globalThis.document.createElement("canvas");
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(1, 1);
  throw new Error("Renderer: no canvas can be made here; pass one as the export's `canvas`");
};

/**
 * A check per renderer option
 * @type {Record<keyof RendererOpts, (v: any) => void>}
 */
const OPTION_RULES = {
  background:            checkBackground,
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
  imageReferrerPolicy:   v => checkImageRequestOpt("imageReferrerPolicy", v, REFERRER_POLICIES),
  crossOrigin:           v => checkImageRequestOpt("crossOrigin", v, CROSS_ORIGINS),
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
   * Layout of the last edge passed to `_layoutEdge()`, reused between edges
   * @type {EdgeLayout}
   * @private
   */
  _edgeLayout = {
    width: 0, fade: 1, loop: false, bowed: false,
    sx: 0, sy: 0, ex: 0, ey: 0, cx: 0, cy: 0, tx: 0, ty: 0,
    head: 0, r: 0, d: 0, lr: 0,
  };


  /**
   * Scratch flags for `_cull()`, by node index: 1 while a node is on screen.
   * Grown as needed and cleared before `_cull()` returns, so it can be reused
   * every frame without allocating.
   * @type {Uint8Array}
   * @private
   */
  _onScreen = new Uint8Array(0);


  /**
   * Box of the last label passed to `_layoutLabel()`, reused between labels
   * @type {LabelBox}
   * @private
   */
  _labelBox = { x0: 0, y0: 0, w: 0, h: 0 };


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
   * Counter of image sources that may have gone unused: one per deleted node
   * with an image, and one per node whose image changed. Controls periodic
   * image garbage-collection (`_garbageCollectImages()`). GC happens when it
   * exceeds 16, at which point it is reset to 0.
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
   * Whether `toCanvas()` is drawing, with the export's canvas, size, pixel
   * ratio and view swapped in.
   * @type {boolean}
   * @private
   */
  _exporting = false;


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
    // Images requested with other options are requested again
    if (opts.crossOrigin !== undefined || opts.imageReferrerPolicy !== undefined) this._refetchStaleImages();
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
   * Whether node image sizes are being prepared. Until they're ready, nodes
   * draw a nearby size or the original image. Loops that only render on
   * demand should keep calling `render()` while this is `true`.
   * @returns {boolean} whether node image sizes are being prepared
   */
  isPreparingImages() { return this._imageCache.busy; }


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
   * `imageReferrerPolicy` for `src`. A source that is loading or loaded with
   * those options is not requested again; one that failed is. Failed images
   * are only retried by calling this: the renderer itself never requests them
   * again. When the request settles, an `imageload` or `imageerror` event is
   * emitted.
   * @param {string} src - image source; also the cache key
   * @returns {boolean} `true` if a request was started, `false` if `src` is
   *    already loading or loaded with the current options
   */
  loadImage(src) {
    return this._imageCache.load(src, ...this._imageRequestOpts(src), true);
  }


  /**
   * Resolves the `crossOrigin` and `imageReferrerPolicy` options for an image
   * source. A function option that returns an invalid value falls back to the
   * option's default, as config functions do.
   * @param {string} src - image source
   * @returns {[ImageCrossOrigin, ReferrerPolicy]} the request's options
   * @private
   */
  _imageRequestOpts(src) {
    const { crossOrigin, imageReferrerPolicy } = this._opts;
    let co = typeof crossOrigin === "function" ? crossOrigin(src) : crossOrigin;
    let rp = typeof imageReferrerPolicy === "function" ? imageReferrerPolicy(src) : imageReferrerPolicy;
    // The defaults are plain values, not functions
    if (!CROSS_ORIGINS.includes(co)) co = /** @type {ImageCrossOrigin} */ (RENDERER_DEFAULTS.crossOrigin);
    if (!REFERRER_POLICIES.includes(rp)) rp = /** @type {ReferrerPolicy} */ (RENDERER_DEFAULTS.imageReferrerPolicy);
    return [co, rp];
  }


  /**
   * Requests every cached image again whose options no longer match the
   * renderer's, failed ones included. The rest are left as they are.
   * @returns {void}
   * @private
   */
  _refetchStaleImages() {
    for (const src of [...this._imageCache.images.keys()]) {
      const [co, rp] = this._imageRequestOpts(src);
      this._imageCache.load(src, co, rp);
    }
  }


  /**
   * Find and delete images that are no longer used by any nodes, once
   * `_imageDebt` exceeds 16.
   * @returns {void}
   * @private
   */
  _garbageCollectImages() {
    if (this._imageDebt <= 16) return;
    this._imageDebt = 0;
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
      if (rNode) {
        const prevImage = rNode.image;
        this._resolveNode(gNode, rNode);
        if (prevImage && rNode.image !== prevImage) this._imageDebt++;
      } else {
        rNode = this._seedNode(gNode);
        this._nodes.set(id, rNode);
      }
      // Load node image into cache. Failed images aren't retried here, or a
      // broken source would be requested again on every graph change.
      if (rNode.image) {
        this._imageCache.load(rNode.image, ...this._imageRequestOpts(rNode.image));
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

    if (this._syncedSimulation === this._simulation.version) {
      this._garbageCollectImages();
      return true;
    }

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
    this._garbageCollectImages();

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
    return [this._canvasX(x), this._canvasY(y)];
  }


  /**
   * Canvas x coordinate of a simulation x coordinate, as `simToCanvas()`
   * gives it, for drawing loops: it doesn't check for a canvas or allocate an
   * array. Expects a size, which drawing and hit tests already require.
   * @param {number} x - simulation x coordinate
   * @returns {number} canvas x coordinate
   * @private
   */
  _canvasX(x) {
    return /** @type {Size} */ (this._size).w / 2 + (x - this._view.x) * this._view.zoom;
  }


  /**
   * Canvas y coordinate of a simulation y coordinate; see `_canvasX()`.
   * @param {number} y - simulation y coordinate
   * @returns {number} canvas y coordinate
   * @private
   */
  _canvasY(y) {
    return /** @type {Size} */ (this._size).h / 2 + (y - this._view.y) * this._view.zoom;
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
   * Returns the view that frames the whole graph on the canvas, without
   * applying it: centred on the graph, at the largest zoom that fits it with
   * `padding` to spare on each side. The graph includes self-loops, bowed
   * edges and the labels shown at that zoom, as `toCanvas({ fit: true })`
   * frames it.
   * @param {number} [padding=16] - canvas px to leave around the graph
   * @returns {View | null} the fitted view, or `null` if the graph has no
   *    nodes
   * @throws {RangeError} throws if `padding` isn't a finite number, 0 or
   *    more, or leaves no room for the graph
   * @throws {Error} throws if no canvas is attached
   */
  viewFitted(padding = 16) {
    checkNumber("Renderer", "padding", padding, { min: 0 });
    if (!this._canvas || !this._size) throw new Error("Renderer: no canvas attached");
    this.sync();
    if (this._simulation.nodeList.length === 0) return null;
    if (this._opts.renderLabels && this._labelsDirty) this._measureLabels();
    const { w, h } = this._size;
    const zoom = this._fitZoom(w, h, padding);
    const b = this._graphBounds(zoom);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, zoom };
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
    const cx = this._canvasX(sNode.x), cy = this._canvasY(sNode.y);
    const r = sNode.radius * this._view.zoom;
    this._ctx.beginPath();
    this._ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    const src = nodeStyle.image;
    const img = src ? this._imageCache.loaded(src) : null;
    const side = img ? Math.min(img.naturalWidth, img.naturalHeight) : 0;
    if (src && img && side) {
      const needed = 2 * r * this._dpr;     // on-screen diameter, device px
      if (needed < IMAGE_DOT_THRESHOLD) {
        // Too small to show detail: a dot in the image's average colour
        this._ctx.fillStyle = this._imageCache.average(src) ?? nodeStyle.color;
        this._ctx.fill();
      } else {
        // Exports draw the image itself: sprites the size an export needs
        // aren't ready in time, and asking would build them for nothing
        const sprite = this._exporting ? null : this._imageCache.sprite(src, needed);
        if (sprite) {
          this._ctx.drawImage(sprite, cx - r, cy - r, 2 * r, 2 * r);
        } else {
          // No sprite yet (the first is being prepared, or sprites can't be
          // made here): the image itself, clipped to the node
          const scale = r * 2 / side;
          const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
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
    let x = this._canvasX(sNode.x), y = this._canvasY(sNode.y);
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
    const p = this._layoutEdge(src, dest, style, bowDir);
    if (!p) return;
    const ctx = this._ctx;

    if (p.fade < 1) ctx.globalAlpha = alpha * p.fade;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = p.width;
    if (p.loop) {
      this._drawSelfLoop(p, style);
    } else {
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy);
      // Stop the stroke at the arrowhead's base so a thick line can't show
      // through the notch of the filled triangle.
      const baseX = p.ex - p.tx * p.head, baseY = p.ey - p.ty * p.head;
      if (p.bowed) ctx.quadraticCurveTo(p.cx, p.cy, baseX, baseY);
      else ctx.lineTo(baseX, baseY);
      ctx.stroke();
      if (style.arrow) this._drawArrowhead(p.ex, p.ey, p.tx, p.ty, p.head, style);
    }
    if (p.fade < 1) ctx.globalAlpha = alpha;
  }


  /**
   * Lays out an edge as it's drawn at the current view, in canvas px. Shared
   * by `_drawEdge()` and the edge hit tests, so a hit always matches what's
   * on screen. Writes into one reused object, so the render loop doesn't
   * allocate: read it before laying out the next edge.
   * @param {SimNode} src - source node
   * @param {SimNode} dest - destination node
   * @param {EdgeStyle} style - resolved edge style
   * @param {number} bowDir - 1 to bow the edge (half of a reciprocal pair), 0 to draw it straight
   * @returns {EdgeLayout | null} the layout, or `null` when the edge isn't
   *    drawn: too thin and faint to see, or its nodes overlap
   * @private
   */
  _layoutEdge(src, dest, style, bowDir) {
    const p = this._edgeLayout, z = this._view.zoom;

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
      if (fade < MIN_EDGE_FADE || !(width > 0)) return null;    // too faint to see
    }
    p.width = width;
    p.fade = fade;

    const ax = this._canvasX(src.x), ay = this._canvasY(src.y);
    const ra = src.radius * z;

    if (src === dest) {
      // A circle overlapping the node's upper right
      const lr = Math.max(ra * 0.8, (style.arrow ? style.arrowSize * k : 6 * k) * 1.6);
      const D = ra + lr * 0.6;                     // node centre -> loop centre
      p.loop = true;
      p.sx = ax; p.sy = ay; p.r = ra; p.d = D;
      p.cx = ax + Math.SQRT1_2 * D; p.cy = ay - Math.SQRT1_2 * D; p.lr = lr;
      p.head = style.arrowSize * k;
      return p;
    }

    const bx = this._canvasX(dest.x), by = this._canvasY(dest.y);
    const rb = dest.radius * z;
    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return null;

    const head = style.arrow ? style.arrowSize * k : 0;
    if (d <= ra + rb + head) return null;

    const ux = dx / d, uy = dy / d;
    const bow = bowDir * style.bow * z;          // Scale bow with zoom

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

    p.loop = false;
    p.bowed = !!bow;
    p.sx = ax + t0x * ra; p.sy = ay + t0y * ra;
    p.ex = bx - t1x * rb; p.ey = by - t1y * rb;
    p.cx = cx; p.cy = cy;
    p.tx = t1x; p.ty = t1y;
    p.head = head;
    return p;
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
   * Draws a self-loop laid out by `_layoutEdge()`, with an arrowhead on the
   * node boundary if `style.arrow` is set. The caller sets the stroke.
   * @param {EdgeLayout} p - the loop's layout
   * @param {EdgeStyle} style - resolved edge style
   * @returns {void}
   * @private
   */
  _drawSelfLoop(p, style) {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const { sx: cx, sy: cy, r, d: D, cx: lx, cy: ly, lr, head } = p;
    const ux = Math.SQRT1_2, uy = -Math.SQRT1_2;   // node centre -> loop centre

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

    for (let s = 1; s >= -1; s -= 2) {           // pick the crossing that points inward
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
    const sim = this._simulation, n = sim.nodeList.length;
    if (this._onScreen.length < n) this._onScreen = new Uint8Array(n);
    const onScreen = this._onScreen;
    for (let i = 0; i < n; i++) {
      const sNode = sim.nodeList[i];
      if (circleRectCollision(sNode.x, sNode.y, sNode.radius, xMin, xMax, yMin, yMax)) {
        nodesI.push(i);
        onScreen[i] = 1;
      }
    }

    const edgesI = [];
    if (this._opts.renderEdges) {
      const ep = sim.edgePairs;
      for (let i = 0, j = 0; i < ep.length / 2; i++, j += 2) {
        if (onScreen[ep[j]] || onScreen[ep[j + 1]]) edgesI.push(i);
      }
    }
    for (let k = 0; k < nodesI.length; k++) onScreen[nodesI[k]] = 0;

    const labelsI = [];
    if (this._opts.renderLabels) {
      const { minLabelSize, maxLabelSize } = this._opts;
      const zoom = this._view.zoom, ratios = this._labelWidthRatio;
      for (let i = 0; i < sim.nodeList.length; i++) {
        const style = this._nodeStyles[i];
        if (!ratios[i] || !style.renderLabel) continue;     // no label, or disabled
        const px = style.labelScale * zoom;
        if (px < minLabelSize) continue;                     // too small to read
        // Label bounds in world units
        const { x0, y0, w, h } = this._layoutLabel(i, Math.min(px, maxLabelSize) / zoom);
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
    const opts = this._opts, hl = this._highlighter;
    hl.step(time, opts.highlightFadeDuration, opts.highlightMode, opts.highlightAlpha);
    this._imageCache.beginFrame();
    this._drawFrame(time, opts.background, hl.nodeAlpha, hl.edgeAlpha, true);
    this._imageCache.endFrame(opts.imageCacheMB * 1024 * 1024);
    return true;
  }


  /**
   * Draws a frame onto the current context, which holds the base transform,
   * at the current view and size.
   * @param {number} time - frame timestamp, passed to hooks
   * @param {string | null} background - background color, or `null` for none
   * @param {Float64Array} nodeAlpha - highlight alpha of each node slot
   * @param {Float64Array} edgeAlpha - highlight alpha of each edge slot
   * @param {boolean} hooks - whether to run the drawing hooks
   * @returns {void}
   * @private
   */
  _drawFrame(time, background, nodeAlpha, edgeAlpha, hooks) {
    if (!this._ctx || !this._size) return;
    if (this._opts.renderLabels && this._labelsDirty) this._measureLabels();

    const inFrame = this._cull();

    // Cleared first so a transparent or translucent background doesn't build
    // up over earlier frames
    this._ctx.clearRect(0, 0, this._size.w, this._size.h);
    if (background !== null) {
      this._ctx.fillStyle = background;
      this._ctx.fillRect(0, 0, this._size.w, this._size.h);
    }

    if (hooks) this._runHooks("background", time);

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
      const { nodeState, edgeState } = hl;
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

    if (hooks) this._runHooks("overlay", time);
  }


  /**
   * Draws the graph onto a new canvas, for saving as an image. By default
   * it's drawn as it is on screen: the current view, at the attached canvas's
   * size and pixel ratio. With `fit`, it's framed around the whole graph
   * instead.
   *
   * The attached canvas, its view and the render loop are left alone.
   * Highlights are drawn as they'll be once any fade ends, and node images at
   * full detail from the images themselves; images still loading are drawn
   * as their node's `color`. Hooks run unless `hooks` is `false`, and see the
   * export's canvas, `size` and `view` while they do.
   * @param {ExportOpts} [opts={}] - export options
   * @returns {Canvas} the canvas drawn on: `opts.canvas` if given, otherwise
   *    a new `HTMLCanvasElement`, or an `OffscreenCanvas` where there's no
   *    document
   * @throws {TypeError | RangeError} throws if an option is invalid or unknown
   * @throws {Error} throws if the size isn't given and can't be worked out
   *    (no canvas attached, and not `fit`ting a graph with nodes), or no
   *    canvas can be made
   */
  toCanvas(opts = {}) {
    checkKnownKeys("Renderer", opts, EXPORT_OPTION_NAMES);
    checkEach(opts, EXPORT_RULES);
    const { fit = false, padding = 16, hooks = true } = opts;
    const pixelRatio = opts.pixelRatio ?? this._dpr;
    const background = opts.background === undefined ? this._opts.background : opts.background;

    const canvas = opts.canvas ?? makeExportCanvas();
    // Cast: tsc resolves `getContext` on the canvas union unreliably
    const ctx = /** @type {CanvasContext | null} */ (canvas.getContext("2d"));
    if (!ctx) throw new TypeError("Renderer: export canvas has no 2D context");

    this.sync();
    const live = { canvas: this._canvas, ctx: this._ctx, size: this._size, dpr: this._dpr, view: this._view };
    try {
      this._exporting = true;
      this._canvas = canvas;
      this._ctx = ctx;
      this._dpr = pixelRatio;
      // Measured before framing, which needs label sizes, and with the
      // export's context, since a renderer without a canvas has none
      if (this._opts.renderLabels && this._labelsDirty) this._measureLabels();
      const { size, view } = this._exportFrame(fit, padding, opts.width, opts.height, live.size);
      this._size = size;
      this._view = view;
      canvas.width = Math.max(1, Math.round(size.w * pixelRatio));
      canvas.height = Math.max(1, Math.round(size.h * pixelRatio));
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const { nodeAlpha, edgeAlpha } = this._highlighter.settledAlphas(this._opts.highlightMode, this._opts.highlightAlpha);
      this._drawFrame(now(), background, nodeAlpha, edgeAlpha, hooks);
    } finally {
      this._exporting = false;
      this._canvas = live.canvas;
      this._ctx = live.ctx;
      this._size = live.size;
      this._dpr = live.dpr;
      this._view = live.view;
    }
    return canvas;
  }


  /**
   * Draws the graph as `toCanvas()` does and encodes it as an image file.
   * The graph is drawn when this is called, or with `waitForImages`, once
   * every node image has loaded or failed; only the waiting and encoding are
   * asynchronous.
   * @param {ExportBlobOpts} [opts={}] - export options, plus the image
   *    `type`, `quality` and `waitForImages`
   * @returns {Promise<Blob>} the image
   * @throws {TypeError | RangeError | Error} rejects as `toCanvas()` throws,
   *    or if the image can't be encoded (it may be larger than the browser
   *    allows). Rejects with a "SecurityError" `DOMException` if a node image
   *    was loaded without CORS (`crossOrigin: null`). Invalid options reject
   *    before any waiting.
   */
  async toBlob(opts = {}) {
    checkKnownKeys("Renderer", opts, BLOB_OPTION_NAMES);
    const { type, quality, waitForImages = false, ...canvasOpts } = opts;
    checkEach({ type, quality, waitForImages }, BLOB_RULES);
    checkEach(canvasOpts, EXPORT_RULES);
    if (waitForImages) await this._nodeImagesSettled();
    const canvas = this.toCanvas(canvasOpts);
    const blob = "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("Renderer: the image couldn't be encoded; it may be too large");
    return blob;
  }


  /**
   * Resolves once no node's image is still loading: each has loaded or
   * failed. Images of nodes added, or changed, while waiting are waited for
   * too.
   * @returns {Promise<void>}
   * @private
   */
  async _nodeImagesSettled() {
    for (;;) {
      this.sync();
      const images = this._imageCache.images;
      if (!this._nodeStyles.some(s => s.image && images.get(s.image)?.status === "loading")) return;
      // A settle, or the entry being collected once no node uses it
      await this._imageCache.changed();
    }
  }


  /**
   * The largest zoom at which the whole graph fits in a width and height,
   * leaving `padding` around it. Expects at least one node, and labels to be
   * measured.
   * @param {number | undefined} width - width to fit, in canvas px;
   *    `undefined` to fit the height only
   * @param {number | undefined} height - height to fit, in canvas px;
   *    `undefined` to fit the width only
   * @param {number} padding - canvas px to leave on each side
   * @returns {number} the zoom; the current zoom for a graph with no extent
   * @throws {RangeError} throws if `padding` leaves no room for the graph
   * @private
   */
  _fitZoom(width, height, padding) {
    /** @param {Bounds} b @returns {number} the largest zoom that fits `b` */
    const fitZoom = b => Math.min(
      width === undefined ? Infinity : (width - 2 * padding) / (b.x1 - b.x0),
      height === undefined ? Infinity : (height - 2 * padding) / (b.y1 - b.y0),
    );
    // Label sizes depend on the zoom: fit them at full size, then at the
    // size they are at that zoom. The second fit is closer, but labels
    // that only show once zoomed in could make it overflow, so it's only
    // kept if it still fits.
    const first = fitZoom(this._graphBounds(null));
    const second = fitZoom(this._graphBounds(first));
    let zoom = fitZoom(this._graphBounds(second)) >= second ? second : first;
    if (zoom === Infinity) zoom = this._view.zoom;    // a graph with no extent
    if (!(zoom > 0)) throw new RangeError("Renderer: `padding` leaves no room for the graph");
    return zoom;
  }


  /**
   * Works out an export's size and view.
   * @param {boolean} fit - whether to frame the whole graph
   * @param {number} padding - canvas px around a fitted graph
   * @param {number | undefined} width - requested width
   * @param {number | undefined} height - requested height
   * @param {Size | null} live - size of the attached canvas
   * @returns {{ size: Size, view: View }} size and view
   * @throws {Error} throws if the size can't be worked out
   * @throws {RangeError} throws if `padding` leaves no room for the graph
   * @private
   */
  _exportFrame(fit, padding, width, height, live) {
    const current = this._view;
    if (!fit || this._simulation.nodeList.length === 0) {
      const w = width ?? live?.w, h = height ?? live?.h;
      if (w === undefined || h === undefined) {
        throw new Error("Renderer: an export needs a `width` and `height` without a canvas attached, unless it fits a graph with nodes");
      }
      return { size: { w, h }, view: { ...current } };
    }

    const zoom = width !== undefined || height !== undefined ?
      this._fitZoom(width, height, padding) : current.zoom;
    const b = this._graphBounds(zoom);
    return {
      size: { w: width ?? (b.x1 - b.x0) * zoom + 2 * padding, h: height ?? (b.y1 - b.y0) * zoom + 2 * padding },
      view: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, zoom },
    };
  }


  /**
   * Bounds of the graph in simulation units: its nodes, self-loops, bowed
   * edges and labels. Stroke widths and arrowheads that stick out aren't
   * included. Expects at least one node, and labels to be measured.
   * @param {number | null} zoom - zoom to size labels at, which also hides
   *    those too small to read; `null` for every label at full size, which
   *    is as big as they get at any zoom
   * @returns {Bounds} bounds
   * @private
   */
  _graphBounds(zoom) {
    const sim = this._simulation, nodes = sim.nodeList, opts = this._opts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    /** @type {(xa: number, ya: number, xb: number, yb: number) => void} */
    const add = (xa, ya, xb, yb) => {
      if (xa < x0) x0 = xa;
      if (ya < y0) y0 = ya;
      if (xb > x1) x1 = xb;
      if (yb > y1) y1 = yb;
    };

    for (const n of nodes) add(n.x - n.radius, n.y - n.radius, n.x + n.radius, n.y + n.radius);

    if (opts.renderEdges) {
      const ep = sim.edgePairs;
      for (let i = 0; i < ep.length / 2; i++) {
        const a = nodes[ep[2 * i]], b = nodes[ep[2 * i + 1]], style = this._edgeStyles[i];
        if (a === b) {
          // As `_layoutEdge()` sizes it, with its arrowhead at full size
          const head = opts.scaleStrokes ? 1.6 * (style.arrow ? style.arrowSize : 6) : 0;
          const lr = Math.max(a.radius * 0.8, head);
          const d = (a.radius + lr * 0.6) * Math.SQRT1_2;
          add(a.x + d - lr, a.y - d - lr, a.x + d + lr, a.y - d + lr);
        } else if (this._edgeBow[i] && style.bow) {
          // A bowed edge strays farthest from the straight line at its middle,
          // by half its bow
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const off = this._edgeBow[i] * style.bow / 2;
          const mx = (a.x + b.x) / 2 - dy / len * off, my = (a.y + b.y) / 2 + dx / len * off;
          add(mx, my, mx, my);
        }
      }
    }

    if (opts.renderLabels) {
      for (let i = 0; i < nodes.length; i++) {
        const style = this._nodeStyles[i];
        if (!this._labelWidthRatio[i] || !style.renderLabel) continue;
        let h = style.labelScale;
        if (zoom !== null) {
          if (h * zoom < opts.minLabelSize) continue;
          h = Math.min(h * zoom, opts.maxLabelSize) / zoom;
        }
        const box = this._layoutLabel(i, h);
        add(box.x0, box.y0, box.x0 + box.w, box.y0 + box.h);
      }
    }

    return { x0, y0, x1, y1 };
  }


  /**
   * Places a node's label box, in simulation units, by `labelPosition`.
   * Writes into one reused object, so culling doesn't allocate per label.
   * @param {number} i - cache index of the node
   * @param {number} h - label height (font size) in simulation units
   * @returns {{ x0: number, y0: number, w: number, h: number }} the box
   * @private
   */
  _layoutLabel(i, h) {
    const sNode = this._simulation.nodeList[i], box = this._labelBox;
    const w = this._labelWidthRatio[i] * h, d = sNode.radius + this._opts.labelMargin;
    switch (this._opts.labelPosition) {
      case "top":   box.x0 = sNode.x - w / 2; box.y0 = sNode.y - d - h; break;
      case "right": box.x0 = sNode.x + d;     box.y0 = sNode.y - h / 2; break;
      case "left":  box.x0 = sNode.x - d - w; box.y0 = sNode.y - h / 2; break;
      default:      box.x0 = sNode.x - w / 2; box.y0 = sNode.y + d;     break;
    }
    box.w = w;
    box.h = h;
    return box;
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
   * Returns the edge drawn at a point on the canvas, or `null` if there is
   * none. When several edges are within reach, the one whose stroke is
   * nearest the point wins; among edges the point is right on (or equally
   * near), the one drawn on top wins. Use `edgesAt()` to get them all, for
   * example to let the user cycle through overlapping edges.
   *
   * Edges are drawn under nodes, but this doesn't check for nodes covering
   * the point: call `nodeAt()` first to give nodes priority. Syncs first,
   * like `render()`, so hits match the graph's current shape.
   * @param {number} cx - canvas x coordinate
   * @param {number} cy - canvas y coordinate
   * @param {number} [slack] - reach beyond the edge of each stroke, in canvas
   *    pixels
   * @returns {GraphEdge | null} the edge
   * @throws {Error} throws when no canvas is attached
   */
  edgeAt(cx, cy, slack = 3) {
    /** @type {GraphEdge | null} */
    let best = null;
    let bestGap = Infinity, bestOrder = -1;
    this._hitEdges(cx, cy, slack, (edge, gap, order) => {
      if (gap < bestGap || (gap === bestGap && order > bestOrder)) {
        best = edge; bestGap = gap; bestOrder = order;
      }
    });
    return best;
  }


  /**
   * Returns every edge drawn within reach of a point on the canvas, best
   * match first, in the order `edgeAt()` ranks them: nearest stroke first,
   * then the one drawn on top. Like `edgeAt()`, ignores nodes covering the
   * point.
   * @param {number} cx - canvas x coordinate
   * @param {number} cy - canvas y coordinate
   * @param {number} [slack] - reach beyond the edge of each stroke, in canvas
   *    pixels
   * @returns {GraphEdge[]} the edges, in a new array; empty if none are in reach
   * @throws {Error} throws when no canvas is attached
   */
  edgesAt(cx, cy, slack = 3) {
    /** @type {{ edge: GraphEdge, gap: number, order: number }[]} */
    const hits = [];
    this._hitEdges(cx, cy, slack, (edge, gap, order) => hits.push({ edge, gap, order }));
    hits.sort((a, b) => a.gap - b.gap || b.order - a.order);
    return hits.map(h => h.edge);
  }


  /**
   * Finds every visible edge within reach of a canvas point, laid out exactly
   * as `render()` draws it.
   * @param {number} cx - canvas x coordinate
   * @param {number} cy - canvas y coordinate
   * @param {number} slack - reach beyond each stroke, in canvas px; negative
   *    values count as 0
   * @param {(edge: GraphEdge, gap: number, order: number) => void} visit -
   *    called per hit with the distance from the point to the stroke (0 when
   *    the point is on it) and the edge's draw order (higher is drawn later)
   * @returns {void}
   * @throws {Error} throws when no canvas is attached
   * @private
   */
  _hitEdges(cx, cy, slack, visit) {
    if (!this._canvas) throw new Error("Renderer: no canvas attached");
    this.sync();
    if (!this._opts.renderEdges) return;

    const sim = this._simulation, nodes = sim.nodeList, ep = sim.edgePairs;
    const edges = sim.edgeList, styles = this._edgeStyles, n = edges.length;
    const s = Math.max(slack, 0);
    // While highlighting, highlighted edges are drawn after the rest, and
    // fully faded ones not at all
    const hl = this._highlighter, layered = hl.has() || hl.isFading();
    const { edgeState, edgeAlpha } = hl;

    for (let i = 0; i < n; i++) {
      if (layered && edgeAlpha[i] === 0) continue;
      const p = this._layoutEdge(nodes[ep[2 * i]], nodes[ep[2 * i + 1]], styles[i], this._edgeBow[i]);
      if (!p) continue;
      const gap = edgeDistance(p, cx, cy, p.width / 2 + s) - p.width / 2;
      if (gap <= s) visit(edges[i], Math.max(gap, 0), layered ? edgeState[i] * n + i : i);
    }
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

/** Straight pieces a bowed edge is split into for hit testing. A curve
    bowed by `b` px strays at most about b / (2 * n^2) px from them. */
const BOW_HIT_SEGMENTS = 16;

/**
 * Distance from a point to the centre line of an edge laid out by
 * `_layoutEdge()`, through its arrowhead to the tip. Returns `Infinity` early
 * when the point is clearly farther than `reach`.
 * @param {EdgeLayout} p - edge layout, in canvas px
 * @param {number} x - point x, in canvas px
 * @param {number} y - point y, in canvas px
 * @param {number} reach - farthest distance the caller cares about
 * @returns {number} the distance, in canvas px
 */
function edgeDistance(p, x, y, reach) {
  if (p.loop) return Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.lr);

  // A curve stays inside the hull of its end and control points
  const minX = Math.min(p.sx, p.ex, p.bowed ? p.cx : p.sx) - reach;
  const maxX = Math.max(p.sx, p.ex, p.bowed ? p.cx : p.sx) + reach;
  const minY = Math.min(p.sy, p.ey, p.bowed ? p.cy : p.sy) - reach;
  const maxY = Math.max(p.sy, p.ey, p.bowed ? p.cy : p.sy) + reach;
  if (x < minX || x > maxX || y < minY || y > maxY) return Infinity;

  if (!p.bowed) return Math.sqrt(segmentDistance2(x, y, p.sx, p.sy, p.ex, p.ey));

  // The stroke curves to the arrowhead's base, then runs straight to the tip
  const bx = p.ex - p.tx * p.head, by = p.ey - p.ty * p.head;
  let best = segmentDistance2(x, y, bx, by, p.ex, p.ey);
  let px = p.sx, py = p.sy;
  for (let k = 1; k <= BOW_HIT_SEGMENTS; k++) {
    const t = k / BOW_HIT_SEGMENTS, u = 1 - t;
    const qx = u * u * p.sx + 2 * u * t * p.cx + t * t * bx;
    const qy = u * u * p.sy + 2 * u * t * p.cy + t * t * by;
    best = Math.min(best, segmentDistance2(x, y, px, py, qx, qy));
    px = qx; py = qy;
  }
  return Math.sqrt(best);
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
