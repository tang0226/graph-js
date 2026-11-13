// INTERNAL RENDERER TYPES
// Not exported from the package root, so they may change between versions.
/** @import { NodeAccessor, EdgeAccessor } from '../graph.js' */
/** @import { NodeStyle, NodeStyleConfig, EdgeStyle, EdgeStyleConfig } from '../renderer.js' */

/**
 * Node style config with every field set, after merging with the defaults
 * @typedef {Required<NodeStyleConfig>} ResolvedNodeStyleConfig
 */

/**
 * Node style config with every field as a function
 * @typedef {{ [K in keyof NodeStyle]-?: NodeAccessor<NodeStyle[K]> }} ResolvedNodeStyleAccessors
 */

/**
 * Edge style config with every field set, after merging with the defaults
 * @typedef {Required<EdgeStyleConfig>} ResolvedEdgeStyleConfig
 */

/**
 * Edge style config with every field as a function
 * @typedef {{ [K in keyof EdgeStyle]-?: EdgeAccessor<EdgeStyle[K]> }} ResolvedEdgeStyleAccessors
 */

/**
 * An edge as drawn at the current view, from `Renderer._layoutEdge()`. All
 * lengths and coordinates are in canvas px. Some fields mean different things
 * for a self-loop (`loop` set) than for a line or curve between two nodes.
 * @typedef {object} EdgeLayout
 * @property {number} width - stroke width
 * @property {number} fade - extra alpha for an edge drawn at `minEdgeWidth`
 *    instead of its own, thinner width (1 otherwise)
 * @property {boolean} loop - whether the edge is a self-loop
 * @property {boolean} bowed - whether a non-loop edge is a curve
 * @property {number} sx - start x: the trimmed start, or a loop's node centre
 * @property {number} sy - start y: the trimmed start, or a loop's node centre
 * @property {number} ex - x of the trimmed end, where the arrow tip goes
 * @property {number} ey - y of the trimmed end, where the arrow tip goes
 * @property {number} cx - x of a curve's control point, or a loop's centre
 * @property {number} cy - y of a curve's control point, or a loop's centre
 * @property {number} tx - x of the unit tangent at the end
 * @property {number} ty - y of the unit tangent at the end
 * @property {number} head - arrowhead length (0 when an edge has none)
 * @property {number} r - a loop's node radius
 * @property {number} d - distance from a loop's node centre to its centre
 * @property {number} lr - a loop's radius
 */

export {};
