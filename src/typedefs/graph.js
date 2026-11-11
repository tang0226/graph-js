// GRAPH LAYER
// Types only. No DOM types here: the headless entry points depend on this file.
/** @import { Graph } from '../graph.js' */
/** @import { EmitterEvent, EmitterListener } from './emitter.js' */

/**
 * Id of a node. Any value works as a `Map` key, so ids may be strings,
 * numbers or objects; generated ids are strings.
 * @typedef {any} NodeId
 */

/**
 * Custom data for a node. Any fields are allowed; `id`, if present, becomes
 * the node's id when no explicit `id` argument is passed.
 * @typedef {{ id?: NodeId, [key: string]: any }} NodeData
 */

/**
 * @typedef {object} GraphNode
 * @property {NodeId} id - id of the node
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



// EVENTS

/**
 * Data of an event about a node
 * @typedef {object} GraphNodeEventData
 * @property {NodeId} id - id of the node
 * @property {GraphNode} node - the node
 */

/**
 * Data of an event about an edge. `srcId` and `destId` are the ids the edge
 * is stored with, so an undirected edge always reports the same pair,
 * whichever order it was added or removed with.
 * @typedef {object} GraphEdgeEventData
 * @property {NodeId} srcId - id of the edge's source node
 * @property {NodeId} destId - id of the edge's destination node
 * @property {GraphEdge} edge - the edge
 */

/**
 * Data of an event about changed custom data
 * @typedef {object} GraphDataChangeEventData
 * @property {any} prev - the data that was replaced
 */

/**
 * Graph event names, each mapped to the data its events carry on top of the
 * fields every event has. Each is emitted once its change is complete, so the
 * graph is up to date for listeners. These events report what happened, so
 * calling `preventDefault()` on them has no effect.
 * @typedef {object} GraphEventMap
 * @property {GraphNodeEventData} nodeadd - a node was added
 * @property {GraphNodeEventData} noderemove - a node was removed, after an
 *    `edgeremove` for each of its edges
 * @property {GraphNodeEventData & GraphDataChangeEventData} nodedatachange -
 *    `setNodeData()` replaced a node's data
 * @property {GraphEdgeEventData} edgeadd - an edge was added
 * @property {GraphEdgeEventData} edgeremove - an edge was removed, by
 *    `removeEdge()` or by removing one of its nodes
 * @property {GraphEdgeEventData & GraphDataChangeEventData} edgedatachange -
 *    `setEdgeData()` replaced an edge's data
 */

/**
 * Name of a graph event
 * @typedef {keyof GraphEventMap} GraphEventType
 */

/**
 * Event passed to graph listeners
 * @template {GraphEventType} [K=GraphEventType]
 * @typedef {EmitterEvent<GraphEventMap, K, Graph>} GraphEvent
 */

/**
 * Function called with each graph event of the type it was added for
 * @template {GraphEventType} [K=GraphEventType]
 * @typedef {EmitterListener<GraphEventMap, K, Graph>} GraphListener
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
