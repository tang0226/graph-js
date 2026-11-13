// RENDERER LAYER
/** @import { Renderer } from '../renderer.js' */
/** @import { NodeOption, EdgeOption } from './graph.js' */
/** @import { EmitterEvent, EmitterListener } from './emitter.js' */

/** @typedef {HTMLCanvasElement | OffscreenCanvas} Canvas */
/** @typedef {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} CanvasContext */

/** @typedef {"top" | "bottom" | "left" | "right"} LabelPosition */
/** @typedef {"dim" | "hide"} HighlightMode */

/**
 * @typedef {object} RendererOptsInput
 * @property {Canvas} [canvas] - canvas to render to
 * @property {string | null} [background] - background color, or `null` to
 *    leave the canvas transparent
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
 * @property {ReferrerPolicy | ((src: string) => ReferrerPolicy)} [imageReferrerPolicy] -
 *    referrer policy for image requests, or a function giving it per image
 *    source
 * @property {ImageCrossOrigin | ((src: string) => ImageCrossOrigin)} [crossOrigin] -
 *    cross-origin setting for image requests, or a function giving it per
 *    image source
 * @property {number} [imageCacheMB] - soft memory budget, in megabytes, for
 *    the cached sizes of node images; sizes on screen are always kept
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
 * Options for `Renderer.toCanvas()` and `toBlob()`. Sizes are in CSS pixels,
 * like `size`; the image is `pixelRatio` times as many pixels across.
 * @typedef {object} ExportOpts
 * @property {boolean} [fit=false] - whether to frame the whole graph, rather
 *    than export the current view
 * @property {number} [padding=16] - with `fit`, CSS px of space around the
 *    graph
 * @property {number} [width] - image width. Defaults to the attached
 *    canvas's width; with `fit`, to the graph's width at the current zoom,
 *    or the width that keeps its shape when only `height` is given. With
 *    `fit` and a `width` or `height`, the graph is zoomed to fit inside.
 * @property {number} [height] - image height, defaulting as `width` does
 * @property {number} [pixelRatio] - image pixels per CSS px. Defaults to the
 *    attached canvas's device pixel ratio, or 1.
 * @property {string | null} [background] - background color, or `null` for
 *    a transparent background. Defaults to the renderer's `background`.
 * @property {boolean} [hooks=true] - whether to run the drawing hooks
 * @property {Canvas} [canvas] - canvas to draw onto, resized to fit the
 *    image; a new one by default
 */

/**
 * Options for `Renderer.toBlob()`: the export options, plus how to encode it
 * and whether to wait for node images
 * @typedef {object} ExportEncodeOpts
 * @property {string} [type="image/png"] - image MIME type, such as
 *    "image/jpeg" or "image/webp"; browsers fall back to PNG for types they
 *    can't encode
 * @property {number} [quality] - quality from 0 to 1, for lossy types
 * @property {boolean} [waitForImages=false] - whether to wait until every
 *    node image has loaded or failed before drawing, so none are missing
 */
/** @typedef {ExportOpts & ExportEncodeOpts} ExportBlobOpts */

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
 * An image request's `crossOrigin`. `null` sends no CORS request, so images
 * from hosts without CORS headers load, but their pixels can't be read.
 * @typedef {"anonymous" | "use-credentials" | null} ImageCrossOrigin
 */

/**
 * A node image in the renderer's cache: whether it has loaded, the image once
 * it has, and the options it was requested with
 * @typedef {object} ImageEntry
 * @property {"loading" | "loaded" | "failed"} status - `"loading"` until the
 *    request settles, then `"loaded"` or `"failed"`
 * @property {HTMLImageElement | null} image - the loaded image, or `null`
 *    while loading or after a failure
 * @property {ImageCrossOrigin} crossOrigin - the `crossOrigin` it was
 *    requested with
 * @property {ReferrerPolicy} referrerPolicy - the `referrerPolicy` it was
 *    requested with
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

// EVENTS

/**
 * Renderer event names, each mapped to the data its events carry on top of
 * the fields every event has. Each is emitted once the image's entry in
 * `images` is updated. These events report what happened, so calling
 * `preventDefault()` on them has no effect.
 * @typedef {object} RendererEventMap
 * @property {{ src: string, image: HTMLImageElement }} imageload - a node
 *    image loaded: `src` is its source, `image` the loaded image
 * @property {{ src: string }} imageerror - a node image failed to load:
 *    `src` is its source
 */

/**
 * Name of a renderer event
 * @typedef {keyof RendererEventMap} RendererEventType
 */

/**
 * Event passed to renderer listeners
 * @template {RendererEventType} [K=RendererEventType]
 * @typedef {EmitterEvent<RendererEventMap, K, Renderer>} RendererEvent
 */

/**
 * Function called with each renderer event of the type it was added for
 * @template {RendererEventType} [K=RendererEventType]
 * @typedef {EmitterListener<RendererEventMap, K, Renderer>} RendererListener
 */

export {};
