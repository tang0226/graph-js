// Default options and configs for every layer, in one place. Internal: not
// listed in package.json `exports`, so not part of the public API. Each is
// frozen, so nothing can change a default for every instance at once.
/** @import { SimOpts, BarnesHutOpts } from './typedefs/simulation.js' */
/** @import { RendererOpts, NodeStyle, EdgeStyle } from './typedefs/renderer.js' */
/** @import { InteractionOpts } from './typedefs/interaction.js' */


// SIMULATION

/**
 * Default simulation options
 * @type {Readonly<SimOpts>}
 */
export const SIM_DEFAULTS = Object.freeze({
  friction: 0.9,
  gravity: 0.002,
  repulsion: 1000,
  minDistSq: 100,
  maxSpeed: 100,
  dt: 1,
  cooling: 0.98,
  freezePoint: 0.01,
  useBarnesHut: true,
  collision: "grid",
});

/**
 * Default physical config of every node
 * @type {Readonly<{ mass: number, radius: number, charge: number, fixed: boolean }>}
 */
export const SIM_NODE_DEFAULTS = Object.freeze({ mass: 1, radius: 20, charge: 1, fixed: false });

/**
 * Default spring config of every edge
 * @type {Readonly<{ length: number, stiffness: number }>}
 */
export const SIM_EDGE_DEFAULTS = Object.freeze({ length: 50, stiffness: 0.015 });

/**
 * Default Barnes-Hut options
 * @type {Readonly<BarnesHutOpts>}
 */
export const BARNES_HUT_DEFAULTS = Object.freeze({
  capacity: 1024,
  theta: 0.9,
  maxDepth: 20,
});


// RENDERER

/**
 * Default renderer options
 * @type {Readonly<RendererOpts>}
 */
export const RENDERER_DEFAULTS = Object.freeze({
  background: "#ffffff",
  renderEdges: true,
  renderLabels: true,
  labelFont: "Arial",
  labelPosition: "bottom",
  labelMargin: 2,
  minLabelSize: 6,
  maxLabelSize: Infinity,
  scaleStrokes: true,
  minEdgeWidth: 1,
  maxEdgeWidth: 8,
  highlightMode: "dim",
  highlightAlpha: 0.15,
  highlightFadeDuration: 150,
  imageReferrerPolicy: "no-referrer",
  crossOrigin: "anonymous",
  imageCacheMB: 64,
});

/**
 * Default style config of every node
 * @type {Readonly<NodeStyle>}
 */
export const NODE_STYLE_DEFAULTS = Object.freeze({
  color: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 1,
  image: null,
  label: null,
  renderLabel: true,
  labelScale: 15,
  labelTextColor: "#000000",
});

/**
 * Default style config of every edge
 * @type {Readonly<EdgeStyle>}
 */
export const EDGE_STYLE_DEFAULTS = Object.freeze({
  color: "#000000",
  width: 1,
  arrow: null,
  arrowSize: 10,
  bow: 14,
});


// INTERACTION

/**
 * Default interaction options
 * @type {Readonly<InteractionOpts>}
 */
export const INTERACTION_DEFAULTS = Object.freeze({
  dragNodes: true,
  pan: true,
  zoom: true,
  dragThreshold: 4,
  zoomSpeed: 0.002,
  minZoom: 0.01,
  maxZoom: 100,
});
