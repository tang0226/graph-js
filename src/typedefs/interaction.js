// INTERACTION
/** @import { GraphJSEventMap, GraphJSEventType } from './graphjs.js' */
/** @import { NodeId } from './graph.js' */

/**
 * Options for built-in pointer interaction
 * @typedef {object} InteractionOptsInput
 * @property {boolean} [dragNodes] - whether dragging a node moves it (default
 *    `true`). When `false`, dragging a node pans instead, if `pan` is on.
 * @property {boolean} [pan] - whether dragging the background pans the view
 *    (default `true`)
 * @property {boolean} [zoom] - whether the wheel zooms the view, anchored at
 *    the pointer (default `true`). When `false`, the wheel scrolls the page
 *    as usual.
 * @property {number} [dragThreshold] - canvas px the pointer must move while
 *    pressed before a drag starts (default 4). A press that moves no further
 *    is a click.
 * @property {number} [zoomSpeed] - how fast the wheel zooms (default 0.002):
 *    each wheel event multiplies the zoom by `2 ** (-deltaY * zoomSpeed)`,
 *    with `deltaY` in px
 * @property {number} [minZoom] - smallest zoom the wheel zooms out to
 *    (default 0.01)
 * @property {number} [maxZoom] - largest zoom the wheel zooms in to (default
 *    100)
 */

/**
 * Interaction options with every value resolved
 * @typedef {Required<InteractionOptsInput>} InteractionOpts
 */

/**
 * Function GraphJS hands to `Interaction` to emit its events with. Returns
 * whether a listener called `preventDefault()`.
 * @typedef {<K extends GraphJSEventType>(type: K, data: GraphJSEventMap[K]) => boolean} InteractionEmit
 */

/**
 * State of the pointer press being tracked
 * @typedef {object} InteractionPress
 * @property {number} pointerId - id of the pressed pointer
 * @property {NodeId | null} id - node pressed, or `null` for the background
 * @property {number} startX - canvas x coordinate of the press
 * @property {number} startY - canvas y coordinate of the press
 * @property {number} lastX - canvas x coordinate of the previous move
 * @property {number} lastY - canvas y coordinate of the previous move
 * @property {"node" | "pan" | "none" | null} drag - what the press drags:
 *    `null` until it passes the drag threshold, then "none" if nothing
 * @property {number} grabX - simulation x offset from the pointer to the
 *    dragged node's centre
 * @property {number} grabY - simulation y offset from the pointer to the
 *    dragged node's centre
 * @property {boolean} unpin - whether the drag pinned a node it should unpin
 *    when it ends
 */

export {};
