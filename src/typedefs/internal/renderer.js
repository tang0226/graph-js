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

export {};
