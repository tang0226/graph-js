// INTERNAL SIMULATION TYPES
// Not exported from the package root, so they may change between versions.
// No DOM types here: the headless entry points depend on this file.
/** @import { NodeAccessor, EdgeAccessor } from '../graph.js' */
/** @import { SimNode, SimNodeConfig, SimEdge, SimEdgeConfig } from '../simulation.js' */

/**
 * Node config with every field set, after merging with the defaults
 * @typedef {Required<SimNodeConfig>} ResolvedSimNodeConfig
 */

/**
 * Node config with every field as a function
 * @typedef {{ [K in keyof SimNodeConfig]-?: NodeAccessor<SimNode[K]> }} ResolvedSimNodeAccessors
 */

/**
 * Edge config with every field set, after merging with the defaults
 * @typedef {Required<SimEdgeConfig>} ResolvedSimEdgeConfig
 */

/**
 * Edge config with every field as a function
 * @typedef {{ [K in keyof SimEdgeConfig]-?: EdgeAccessor<SimEdge[K]> }} ResolvedSimEdgeAccessors
 */

export {};
