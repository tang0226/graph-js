// RENDERER LAYER
/** @import { Renderer } from '../renderer.js' */
/** @import { NodeOption, NodeAccessor, EdgeOption, EdgeAccessor } from './graph.js' */

/** @typedef {HTMLCanvasElement | OffscreenCanvas} Canvas */
/** @typedef {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} CanvasContext */

/** @typedef {"top" | "bottom" | "left" | "right"} LabelPosition */
/** @typedef {"dim" | "hide"} HighlightMode */

/**
 * @typedef {object} RendererOptsInput
 * @property {Canvas} [canvas] - canvas to render to
 * @property {string} [background] - background color
 * @property {NodeStyleConfig} [nodeConfig] - default node config
 * @property {EdgeStyleConfig} [edgeConfig] - default edge config
 * @property {boolean} [renderEdges] - whether to render edges
 * @property {boolean} [renderLabels] - whether to render node labels
 * @property {string} [labelFont] - label font
 * @property {LabelPosition} [labelPosition] - where to render labels
 * @property {number} [labelMargin] - world px margin between a node and its label
 * @property {number} [minLabelSize] - canvas px font size below which scaled
 *    labels are hidden
 * @property {number} [maxLabelSize] - canvas px font size that scaled labels
 *    are capped at
 * @property {boolean} [scaleStrokes] - whether edge `width`, `arrowSize` and
 *    node `outlineWidth` are in world px and scale with zoom. When `false`
 *    they are in canvas px and stay the same size at every zoom.
 * @property {number} [minEdgeWidth] - canvas px width below which scaled
 *    edges are drawn at this width, faded in proportion
 * @property {number} [maxEdgeWidth] - canvas px width that scaled edges are
 *    capped at; their arrowheads shrink to match
 * @property {HighlightMode} [highlightMode] - highlight mode
 * @property {number} [highlightAlpha] - highlight alpha
 * @property {number} [highlightFadeDuration] - milliseconds for an element to
 *    fade fully between opacity 0 and 1 when highlighting changes; 0 disables
 *    fading
 * @property {ReferrerPolicy} [imageReferrerPolicy] - default referrer policy
 *    for image requests.
 * @property {"anonymous" | "use-credentials" | null} [crossOrigin] - default
 *    cross-origin parameter for image requests.
 * @property {number} [imageCacheMB] - soft memory budget, in megabytes, for
 *    cached node image sizes; images on screen are always kept
 */

/** @typedef {Required<Omit<RendererOptsInput, "canvas" | "nodeConfig" | "edgeConfig">>} RendererOpts */

/**
 * @typedef {object} Size
 * @property {number} w
 * @property {number} h
 */

/**
 * Generic viewport container specifying center coordinates and zoom scale.
 * Shape and aspect ratio are separately applied by the viewing container.
 * @typedef {object} View
 * @property {number} x - x coordinate of view center
 * @property {number} y - y coordinate of view center
 * @property {number} zoom - zoom amount (canvas px / simulation px)
 */

/**
 * @typedef {object} NodeStyle
 * @property {string} color - node fill color
 * @property {string} outlineColor - node outline color
 * @property {number} outlineWidth - node outline width, in world px (canvas
 *    px when the renderer's `scaleStrokes` is off)
 * @property {string | null} image - node image source
 * @property {string | number | null} label - text label
 * @property {boolean} renderLabel - whether to render the label, if it exists
 * @property {number} labelScale - label font size, in world px
 * @property {string} labelTextColor - label text color
 */

/**
 * @typedef {object} EdgeStyle
 * @property {string} color - edge color
 * @property {number} width - edge width/thickness, in world px (canvas px
 *    when the renderer's `scaleStrokes` is off)
 * @property {boolean | null} arrow - whether to draw an arrow (`null` follows
 *    from an undirected graph)
 * @property {number} arrowSize - length of the arrowhead, if drawn, in world
 *    px (canvas px when the renderer's `scaleStrokes` is off)
 * @property {number} bow - world px of perpendicular bow for reciprocal
 *    directed pairs
 */

/**
 * Partial node config specifier
 * @typedef {{ [K in keyof NodeStyle]?: NodeOption<NodeStyle[K]> }} NodeStyleConfig
 */

/**
 * Partial edge config specifier
 * @typedef {{ [K in keyof EdgeStyle]?: EdgeOption<EdgeStyle[K]> }} EdgeStyleConfig
 */

/**
 * Fully resolved node config specifier
 * @typedef {Required<NodeStyleConfig>} ResolvedNodeStyleConfig
 */

/**
 * Fully resolved edge config specifier
 * @typedef {Required<EdgeStyleConfig>} ResolvedEdgeStyleConfig
 */

/**
 * Partial node config accessor functions
 * @typedef {{ [K in keyof NodeStyle]?: NodeAccessor<NodeStyle[K]> }} NodeStyleAccessors
 */

/**
 * Partial edge config accessor functions
 * @typedef {{ [K in keyof EdgeStyle]?: EdgeAccessor<EdgeStyle[K]> }} EdgeStyleAccessors
 */

/**
 * Fully resolved node config accessor functions
 * @typedef {Required<NodeStyleAccessors>} ResolvedNodeStyleAccessors
 */

/**
 * Fully resolved edge config accessor functions
 * @typedef {Required<EdgeStyleAccessors>} ResolvedEdgeStyleAccessors
 */


/**
 * When a hook runs during `render()`: "background" after the background fill,
 * beneath everything else; "overlay" after everything else, on top
 * @typedef {"background" | "overlay"} RendererHookType
 */

/**
 * Function called by `render()` to draw on the canvas, in canvas coordinates
 * (CSS pixels). `time` is the frame timestamp passed to `render()`.
 * @typedef {(r: Renderer, time: number) => void} RendererHook
 */

export {};
