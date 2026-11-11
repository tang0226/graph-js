// INTERNAL INTERACTION TYPES
// Not exported from the package root, so they may change between versions.
/** @import { GraphJSEventMap, GraphJSEventType } from '../graphjs.js' */
/** @import { NodeId } from '../graph.js' */

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
