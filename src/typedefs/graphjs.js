// GRAPHJS LAYER
/** @import { GraphJS } from '../graphjs.js' */
/** @import { GraphOpts } from './graph.js' */
/** @import { SimOptsInput } from './simulation.js' */
/** @import { RendererOptsInput, Canvas } from './renderer.js' */
/** @import { TweenUnit } from './tween.js' */

/**
 * @typedef {object} GraphJSOpts
 * @property {GraphOpts} [graph] - options for the `Graph`
 * @property {SimOptsInput} [simulation] - options for the `Simulation`
 * @property {RendererOptsInput} [renderer] - options for the `Renderer`
 * @property {Canvas} [canvas] - canvas to render to
 * @property {TweenUnit} [tweenUnit] - unit of tweens that don't set one:
 *    `"ms"` (the default) or `"frames"`
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

export {};
