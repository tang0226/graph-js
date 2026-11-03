// GRAPH LAYER
// Types only. No DOM types here: the headless entry points depend on this file.
/** @import { Graph } from '../graph.js' */

/**
 * @typedef {any} NodeId
 */

/**
 * Custom data for a node. Any fields are allowed; `id`, if present, becomes
 * the node's id when no explicit `id` argument is passed.
 * @typedef {{ id?: any, [key: string]: any }} NodeData
 */

/**
 * @typedef {object} GraphNode
 * @property {any} id - id of the node
 * @property {any} data - custom data associated with the node
 */

/**
 * @typedef {object} GraphEdge
 * @property {GraphNode} src - source node (order does not matter in an undirected graph)
 * @property {GraphNode} dest - destination node (order does not matter in an undirected graph)
 * @property {any} data - custom data associated with the edge
*/

/**
 * @typedef {object} GraphOpts
 * @property {boolean} [directed=false] - whether the graph is directed; fixed at instantiation
 */



// CONFIG VALUES (shared by the simulation and renderer layers)

/**
 * A config value derived per node. Can accept a `GraphNode` parameter and a
 * `Graph` parameter.`
 * @template T
 * @typedef {(node: GraphNode, graph: Graph) => T} NodeAccessor
 */

/**
 * A config value, either supplied directly or derived per node.
 * `asFn` normalizes both forms into a function.
 * @template T
 * @typedef {T | NodeAccessor<T>} NodeOption
 */

/**
 * A config value derived per edge. Can accept a `GraphEdge` parameter and a
 * `Graph` parameter.`
 * @template T
 * @typedef {(node: GraphEdge, graph: Graph) => T} EdgeAccessor
 */

/**
 * A config value, either supplied directly or derived per edge.
 * `asFn` normalizes both forms into a function.
 * @template T
 * @typedef {T | EdgeAccessor<T>} EdgeOption
 */

export {};
