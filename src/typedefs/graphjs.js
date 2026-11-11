// GRAPHJS LAYER
/** @import { GraphJS } from '../graphjs.js' */
/** @import { GraphOpts, NodeId } from './graph.js' */
/** @import { SimOptsInput } from './simulation.js' */
/** @import { RendererOptsInput, Canvas, View } from './renderer.js' */
/** @import { TweenUnit } from './tween.js' */
/** @import { InteractionOptsInput } from './interaction.js' */

/**
 * @typedef {object} GraphJSOpts
 * @property {GraphOpts} [graph] - options for the `Graph`
 * @property {SimOptsInput} [simulation] - options for the `Simulation`
 * @property {RendererOptsInput} [renderer] - options for the `Renderer`
 * @property {Canvas} [canvas] - canvas to render to
 * @property {TweenUnit} [tweenUnit] - unit of tweens that don't set one:
 *    `"ms"` (the default) or `"frames"`
 * @property {boolean | InteractionOptsInput} [interaction] - turns on
 *    built-in pointer interaction (see `enableInteraction()`): `true` for the
 *    default options, or the options to use. Off by default.
 */

/**
 * When a hook runs in each frame of `start()` and each `step()`: "preTick"
 * before the simulation ticks, "postTick" between ticking and rendering, and
 * "postRender" after rendering
 * @typedef {"preTick" | "postTick" | "postRender"} GraphJSHookType
 */

/**
 * Function called during each frame of `start()` and each `step()`. `time` is
 * the frame timestamp: the `requestAnimationFrame` time in a `start()` loop,
 * or `performance.now()` for `step()`.
 * @typedef {(gjs: GraphJS, time: number) => void} GraphJSHook
 */

// EVENT DATA
// Each piece holds one concern and no field of another, so every field is
// defined once. Events combine the pieces in `GraphJSEventMap`.

/**
 * Event data of the pointer, for events the pointer caused
 * @typedef {object} GraphJSPointerEventData
 * @property {number} x - canvas space x coordinate of the pointer
 * @property {number} y - canvas space y coordinate of the pointer
 * @property {MouseEvent} originalEvent - the DOM event that caused this one
 */

/**
 * Event data of the node an event is about
 * @typedef {object} GraphJSNodeEventData
 * @property {NodeId} id - id of the node
 */

/**
 * Event data of movement during a drag
 * @typedef {object} GraphJSMoveEventData
 * @property {number} dx - the pointer's x movement in canvas px since the
 *    drag's previous event
 * @property {number} dy - the pointer's y movement in canvas px since the
 *    drag's previous event
 */

/**
 * Event data of the view. Which view it is depends on the event: see
 * `GraphJSEventMap`.
 * @typedef {object} GraphJSViewEventData
 * @property {Readonly<View>} view - the view
 */

/**
 * Event names, each mapped to the data its events carry on top of the fields
 * every event has (see `GraphJSEvent`). Events are emitted before GraphJS
 * responds to them, so where `view` is "the view it moves to", calling
 * `preventDefault()` keeps the current one.
 * @typedef {object} GraphJSEventMap
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodeenter - the
 *    pointer moved onto a node
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodeleave - the
 *    pointer moved off a node
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodepress - the
 *    pointer was pressed on a node, before it's known whether the press is a
 *    click or a drag. Calling `preventDefault()` ignores the press: no drag
 *    or click follows.
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodeclick - a
 *    node was clicked
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodedblclick - a
 *    node was double-clicked
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodedragstart - a
 *    node started being dragged
 * @property {GraphJSPointerEventData & GraphJSNodeEventData & GraphJSMoveEventData} nodedrag
 *    - a dragged node moved
 * @property {GraphJSPointerEventData & GraphJSNodeEventData} nodedragend - a
 *    node stopped being dragged
 * @property {GraphJSPointerEventData} backgroundclick - the canvas was clicked
 *    away from any node
 * @property {GraphJSPointerEventData & GraphJSViewEventData} panstart - the
 *    background started being dragged; `view` is the current view
 * @property {GraphJSPointerEventData & GraphJSViewEventData & GraphJSMoveEventData} pan
 *    - the dragged background moved; `view` is the view it pans to
 * @property {GraphJSPointerEventData & GraphJSViewEventData} panend - the
 *    background stopped being dragged; `view` is the current view
 * @property {GraphJSPointerEventData & GraphJSViewEventData} zoom - the view
 *    zoomed, anchored at the pointer (`x`, `y`); `view` is the view it zooms
 *    to
 */

/**
 * Name of an event that `on()` and `off()` accept
 * @typedef {keyof GraphJSEventMap} GraphJSEventType
 */

/**
 * Event passed to listeners: the event's data, plus its `type`, the `target`
 * instance, and `preventDefault()`, which stops GraphJS's own response to the
 * event (such as moving a dragged node) without stopping other listeners
 * @template {GraphJSEventType} [K=GraphJSEventType]
 * @typedef {GraphJSEventMap[K] & {
 *   readonly type: K,
 *   readonly target: GraphJS,
 *   readonly defaultPrevented: boolean,
 *   preventDefault: () => void,
 * }} GraphJSEvent
 */

/**
 * Function called with each event of the type it was added for by `on()`
 * @template {GraphJSEventType} [K=GraphJSEventType]
 * @typedef {(event: GraphJSEvent<K>) => void} GraphJSListener
 */

export {};
