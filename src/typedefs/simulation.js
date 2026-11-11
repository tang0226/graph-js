// SIMULATION LAYER
// Types only. No DOM types here: the headless entry points depend on this file.
/** @import { NodeId, NodeOption, EdgeOption } from './graph.js' */
/** @import { EmitterEvent, EmitterListener } from './emitter.js' */
/** @import { Simulation } from '../simulation.js' */

/**
 * @typedef {object} SimOpts
 * @property {number} friction - friction coefficient to apply to all node
 *    velocities each tick
 * @property {number} gravity - strength of pull toward (0, 0), applied as a
 *    force proportional to distance
 * @property {number} repulsion - coefficient for inverse-square repulsion
 *    calculations
 * @property {number} minDistSq - minimum distance to clamp to before applying
 *    repulsive force between two nodes (to avoid extreme velocities from the
 *    inverse-square law)
 * @property {number} maxSpeed - maximum speed of each node (clamped to at the
 *    end of each tick)
 * @property {number} dt - time step used by `tick()` when it isn't given one.
 *    Friction and cooling still apply once per tick, regardless of `dt`.
 * @property {number} cooling - coefficient to decay temperature by each tick
 * @property {number} freezePoint - temperature value below which temp is set
 *    to 0
 * @property {boolean} useBarnesHut - whether to use Barnes-Hut for repulsion
 * @property {CollisionMethod} collision - how overlapping nodes are found
 */

/**
 * How the simulation finds overlapping nodes. `"grid"` sorts nodes into a
 * uniform grid, `"barnesHut"` reuses the Barnes-Hut quadtree, and `"pairs"`
 * checks every pair. All three resolve the same overlaps, though in different
 * orders.
 * @typedef {"grid" | "barnesHut" | "pairs"} CollisionMethod
 */

/**
 * @typedef {Partial<SimOpts> & {
 *    nodeConfig?: SimNodeConfig,
 *    edgeConfig?: SimEdgeConfig,
 *    barnesHut?: BarnesHutOptsInput,
 * }} SimOptsInput
 */

/**
 * Full simulation node object. Position and velocity props can be set directly,
 * but `mass`, `radius`, and `fixed` must be set using `setNodeConfig()`.
 * @typedef {object} SimNode
 * @property {NodeId} id - node id (matches corresponding `GraphNode`)
 * @property {number} mass - physical mass of the node
 * @property {number} radius - physical (and rendered) radius of the node
 * @property {number} charge - charge of the node for electrostatic repulsion
 * @property {boolean} fixed - whether the node is immovable
 * @property {number} x - x coordinate
 * @property {number} y - y coordinate
 * @property {number} vx - x velocity
 * @property {number} vy - y velocity
 * @property {number} fx - [temp] x force total, reset and populated every tick
 * @property {number} fy - [temp] y force total, reset and populated every tick
 */

/**
 * Partial config specifier: each field a value, or a function of the node
 * @typedef {{
 *    [K in "mass" | "radius" | "charge" | "fixed"]?: NodeOption<SimNode[K]>
 * }} SimNodeConfig
 */


/**
 * Physical spring settings of an edge.
 * @typedef {object} SimEdge
 * @property {number} length - resting length of the edge's spring
 * @property {number} stiffness - how strongly the spring holds its length
 */

/**
 * Partial edge config specifier: each field a value, or a function of the edge
 * @typedef {{ [K in keyof SimEdge]?: EdgeOption<SimEdge[K]> }} SimEdgeConfig
 */



// BARNES-HUT

/**
 * @typedef {object} BarnesHutOpts
 * @property {number} capacity - initial allocation size for cell arrays
 * @property {number} maxDepth - max depth of quadtree
 * @property {number} theta - Barnes-Hut theta value
 */

/** @typedef {Partial<BarnesHutOpts>} BarnesHutOptsInput */



// EVENTS

/**
 * Simulation event names, each mapped to the data its events carry on top of
 * the fields every event has. These events report what happened, so calling
 * `preventDefault()` on them has no effect.
 * @typedef {object} SimEventMap
 * @property {{}} settle - the layout stopped moving: its temperature cooled
 *    below `freezePoint` at the end of a tick, or `heat(0)` set it to 0.
 *    Emitted after the tick has finished, so positions are final.
 * @property {{}} wake - the layout started moving again: `heat()` raised its
 *    temperature from 0. Graph and config changes, `setOpts()` and pinning a
 *    node somewhere new all call `heat()`.
 */

/**
 * Name of a simulation event
 * @typedef {keyof SimEventMap} SimEventType
 */

/**
 * Event passed to simulation listeners
 * @template {SimEventType} [K=SimEventType]
 * @typedef {EmitterEvent<SimEventMap, K, Simulation>} SimEvent
 */

/**
 * Function called with each simulation event of the type it was added for
 * @template {SimEventType} [K=SimEventType]
 * @typedef {EmitterListener<SimEventMap, K, Simulation>} SimListener
 */

export {};
