/** @typedef {HTMLCanvasElement | OffscreenCanvas} Canvas */
/** @typedef {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} CanvasContext */

/**
 * A config value derived per node. Can accept a `GraphNode` parameter and a
 * `Graph` parameter.`
 * @template T
 * @typedef {(node: import("./graph.js").GraphNode, graph: import("./graph.js").Graph) => T} NodeAccessor
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
 * @typedef {(node: import("./graph.js").GraphEdge, graph: import("./graph.js").Graph) => T} EdgeAccessor
 */

/**
 * A config value, either supplied directly or derived per edge.
 * `asFn` normalizes both forms into a function.
 * @template T
 * @typedef {T | EdgeAccessor<T>} EdgeOption
 */

export {};
