/**
 * @import { Graph } from './graph.js'
 */
/** @import { NodeId, GraphNode, GraphEdge } from './typedefs/graph.js' */
/**
 * @import {
 *  SimNode, SimNodeConfig, SimNodeAccessors,
 *  ResolvedSimNodeConfig, ResolvedSimNodeAccessors,
 *  SimEdge, SimEdgeConfig, SimEdgeAccessors,
 *  ResolvedSimEdgeConfig, ResolvedSimEdgeAccessors,
 *  SimOpts, SimOptsInput,
 * } from './typedefs/simulation.js'
 */

import { asFn } from "./utils.js";
import { BarnesHutContext } from "./barnes-hut.js";
import { CollisionGrid } from "./collision-grid.js";


/** @type {{ mass: number, radius: number, charge: number, fixed: boolean }} */
export const SIM_NODE_DEFAULTS = { mass: 1, radius: 20, charge: 1, fixed: false };

/**
 * @param {ResolvedSimNodeConfig} config
 * @returns {ResolvedSimNodeAccessors}
 */
const toNodeAccessors = config => ({
  mass: asFn(config.mass),
  radius: asFn(config.radius),
  charge: asFn(config.charge),
  fixed: asFn(config.fixed),
});


/** @type {{ length: number, stiffness: number }} */
export const SIM_EDGE_DEFAULTS = { length: 50, stiffness: 0.015 };

/**
 * @param {ResolvedSimEdgeConfig} config
 * @returns {ResolvedSimEdgeAccessors}
 */
const toEdgeAccessors = config => ({
  length: asFn(config.length),
  stiffness: asFn(config.stiffness),
});


/**
 * Simulates repulsion, springs, friction, gravity,
 * and collision resolution for an underlying `Graph` instance.
 */
export class Simulation {
  /** @private @type {Graph} */
  _graph;
  get graph() { return this._graph; }


  /** @private @type {SimOpts} */
  _opts;
  /**
   * [read-only, set with `setOpts()`]
   * Simulation physics options
   * @returns {Readonly<SimOpts>}
   */
  get opts() { return this._opts; }


  /** @private @type {Map<NodeId, SimNode>} */
  _nodes = new Map();
  /**
   * Map of mutable physical node objects, keyed by keys used in the
   * underlying `graph` (mirrors Map shape of `Graph.nodes`).
   * @returns {ReadonlyMap<NodeId, SimNode>}
   */
  get nodes() { return this._nodes; }


  /** @private @type {SimNode[]} */
  _nodeList = [];
  /**
   * Cached array of mutable simulation nodes, recreated in effective
   * `sync()` calls.
   * @returns {ReadonlyArray<SimNode>}
   */
  get nodeList() { return this._nodeList; }


  /**
   * @type {Map<NodeId, number>}
   * @private
   */
  _nodeIndex = new Map();
  /**
   * Cached map connecting node ids to indices in `nodeList`.
   * Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<NodeId, number>}
   */
  get nodeIndex() { return this._nodeIndex; }


  /**
   * Cached array of resolved node radius values.
   * Updated in effective `sync()` calls.
   * @type {Float64Array}
   * @private
   */
  _nodeRadius = new Float64Array();


  /**
   * Cached array of resolved node charge values.
   * Updated in effective `sync()` calls.
   * @type {Float64Array}
   * @private
   */
  _nodeCharge = new Float64Array();

  
  /**
   * Cached array of resolved node fixed flags.
   * Updated in effective `sync()` calls.
   * @type {Uint8Array}
   * @private
   */
  _nodeFixed = new Uint8Array();


  /**
   * Cached array of resolved node x coordinates. Resized when `sync()`
   * updates the node count. Updated by `_packPositions()`
   * @type {Float64Array}
   * @private
   */
  _nodeX = new Float64Array();


  /**
   * Cached array of resolved node y coordinates. Resized when `sync()`
   * updates the node count. Updated by `_packPositions()`
   * @type {Float64Array}
   * @private
   */
  _nodeY = new Float64Array();


  /**
   * Scratch array for accumulating x force values in Barnes-Hut repulsion
   * before applying them to SimNode objects.
   * @type {Float64Array}
   * @private
   */
  _nodeFx = new Float64Array();


  /**
   * Scratch array for accumulating x force values in Barnes-Hut repulsion
   * before applying them to SimNode objects.
   * @type {Float64Array}
   * @private
   */
  _nodeFy = new Float64Array();


  /** @private @type {Int32Array} */
  _springs = new Int32Array(0);
  /**
   * Cached flattened array of index pairs for applying spring
   * forces. Recreated in effective `sync()` calls.
   * Because it is used in force application, it does not contain
   * self-loops or reverse-twin pairs, unlike `edgePairs`.
   * @returns {Readonly<Int32Array>}
   */
  get springs() { return this._springs; }


  /**
   * Edge indices (into `edgeList`) behind each spring, two slots per spring:
   * the spring's edge, and its reverse twin in a directed graph (or -1).
   * Recreated in effective `sync()` calls.
   * @type {Int32Array}
   * @private
   */
  _springEdges = new Int32Array(0);


  /** @private @type {Float64Array} */
  _springLength = new Float64Array(0);
  /**
   * Cached resolved resting length of each spring, parallel to the pairs in
   * `springs`. Updated in effective `sync()` calls.
   * @returns {Readonly<Float64Array>}
   */
  get springLength() { return this._springLength; }


  /** @private @type {Float64Array} */
  _springStiffness = new Float64Array(0);
  /**
   * Cached resolved stiffness of each spring, parallel to the pairs in
   * `springs`. Updated in effective `sync()` calls.
   * @returns {Readonly<Float64Array>}
   */
  get springStiffness() { return this._springStiffness; }

  
  /** @private @type {Int32Array} */
  _edgePairs = new Int32Array(0);
  /**
   * Cached flattened array of index pairs for drawing edges. Recreated in
   * effective `sync()` calls. Used for drawing edges, so it can contain
   * reverse-twin pairs in digraphs (unlike `springs`).
   * @returns {Readonly<Int32Array>}
   */
  get edgePairs() { return this._edgePairs; }


  /** @private @type {GraphEdge[]} */
  _edgeList = [];
  /**
   * Cached edge objects, parallel to index pairs in `edgePairs`.
   * @returns {ReadonlyArray<GraphEdge>}
   */
  get edgeList() { return this._edgeList; }


  /** @private @type {Map<GraphEdge, number>} */
  _edgeIndex = new Map();
  /**
   * Cached map connecting edge objects to indices in `edgeList`.
   * Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<GraphEdge, number>}
   */
  get edgeIndex() { return this._edgeIndex; }


  /**
   * Node-specific config overrides, keyed by node id.
   * Node props specified here get first priority over the simulation's current
   * default node config and the global default node config.
   * @type {Map<NodeId, SimNodeAccessors>}
   * @private
   */
  _nodeOverrides = new Map();


  /** @private @type {ResolvedSimNodeConfig} */
  _defaultNodeConfig = {...SIM_NODE_DEFAULTS};
  /**
   * [read-only, set with `setDefaultNodeConfig()` or `setOpts()`]
   * Current default node config. Takes precedence over the global default config,
   * but can be overridden for specific nodes using `setNodeConfig()`.
   * @returns {Readonly<ResolvedSimNodeConfig>}
   */
  get defaultNodeConfig() { return this._defaultNodeConfig; }


  /**
   * `defaultNodeConfig` as cached functions. Used to apply the simulation's
   * default node config when resolving a `SimNode`'s raw configuration.
   * @type {ResolvedSimNodeAccessors}
   * @private
   */
  _nodeAccessors = toNodeAccessors(SIM_NODE_DEFAULTS);


  /**
   * Set to `true` whenever any node config (default or override) is changed.
   * Set back to `false` once those changes are applied in `sync()`.
   * @private
   * @type {boolean} */
  _nodeConfigDirty = false;


  /**
   * Edge-specific config overrides, keyed by edge object.
   * Edge props specified here get first priority over the simulation's current
   * default edge config and the global default edge config.
   * @type {Map<GraphEdge, SimEdgeAccessors>}
   * @private
   */
  _edgeOverrides = new Map();


  /** @private @type {ResolvedSimEdgeConfig} */
  _defaultEdgeConfig = {...SIM_EDGE_DEFAULTS};
  /**
   * [read-only, set with `setDefaultEdgeConfig()` or `setOpts()`]
   * Current default edge config. Takes precedence over the global default
   * config, but can be overridden for specific edges using `setEdgeConfig()`.
   * @returns {Readonly<ResolvedSimEdgeConfig>}
   */
  get defaultEdgeConfig() { return this._defaultEdgeConfig; }


  /**
   * `defaultEdgeConfig` as cached functions. Used to apply the simulation's
   * default edge config when resolving an edge's spring settings.
   * @type {ResolvedSimEdgeAccessors}
   * @private
   */
  _edgeAccessors = toEdgeAccessors(SIM_EDGE_DEFAULTS);


  /**
   * Set to `true` whenever any edge config (default or override) is changed.
   * Set back to `false` once those changes are applied in `sync()`.
   * @private
   * @type {boolean} */
  _edgeConfigDirty = false;


  /** @private @type {number} */
  _temp = 0;
  /**
   * [read-only, reset with `heat()`]
   * Temperature value that forces are multiplied by. Decays each tick
   * according to the rate of `opts.cooling`. Once it is lower than
   * `opts.freezePoint`, it is set to zero. Reset by the `heat()` function,
   * which is called after config or settings changes.
   */
  get temp() { return this._temp; }


  /**
   * Always initialized
   * @type {BarnesHutContext}
   * @private
   */
  _barnesHutCtx;

  /**
   * Grid used when `opts.collision` is `"grid"`
   * @type {CollisionGrid}
   * @private
   */
  _collisionGrid = new CollisionGrid();


  /** @private @type {number} */
  _version = 1;
  /**
   * Monotonic counter for *structural* changes to the node and edge tables.
   * Incremented in `sync()` only when graph shape changes.
   * Higher layers rebuild slot-indexed caches on it.
   */
  get version() { return this._version; }


  /**
   * Stores the latest synced `Graph` version. Used to gate node and edge
   * cache updates.
   * @type {number}
   * @private
   */
  _syncedGraphVersion = -1;


  /**
   * Stores the latest synced `Graph` *data* version. Used to efficiently
   * update physical node config based on underlying graph node payloads.
   * @private
   * @type {number} */
  _syncedGraphDataVersion = -1;


  /**
   * Initializes a `Simulation` instance.
   * @param {Graph} graph - `Graph` instance to simulate on top of
   * @param {SimOptsInput} [opts={}] - physics engine and node body options
   */
  constructor(graph, opts = {}) {
    this._graph = graph;

    this._opts = {
      friction:        opts.friction ?? 0.9,
      gravity:         opts.gravity ?? 0.002,
      repulsion:       opts.repulsion ?? 1000,
      minDistSq:       opts.minDistSq ?? 100,
      maxSpeed:        opts.maxSpeed ?? 100,
      dt:              opts.dt ?? 1,
      cooling:         opts.cooling ?? 0.98,
      freezePoint:     opts.freezePoint ?? 0.01,
      useBarnesHut:    opts.useBarnesHut ?? true,
      collision:       opts.collision ?? "grid",
    };

    this.setDefaultNodeConfig(opts.nodeConfig ?? {});
    this.setDefaultEdgeConfig(opts.edgeConfig ?? {});
    this._barnesHutCtx = new BarnesHutContext(opts.barnesHut ?? {});
    this.sync();
  }


  /**
   * Sets properties of `opts` using a partial object.
   * @param {SimOptsInput} [optsInput={}] - options to set
   * @returns {this} self reference
   */
  setOpts({nodeConfig, edgeConfig, barnesHut, ...opts} = {}) {
    Object.assign(this._opts, opts);
    if (nodeConfig) this.setDefaultNodeConfig(nodeConfig);
    if (edgeConfig) this.setDefaultEdgeConfig(edgeConfig);
    if (barnesHut) this._barnesHutCtx.setOpts(barnesHut);
    this.heat();
    return this;
  }


  /**
   * Sets the simulation's temp value
   * @param {number} [t=1] - temperature to set
   * @returns {this} self reference
   */
  heat(t = 1) {
    if (t >= 0) this._temp = t;
    else this._temp = 0;
    return this;
  }


  /**
   * Sets the default physical attributes for all nodes.
   * `sync()` will update all nodes with the new defaults, except for
   * specific overrides
   * @param {SimNodeConfig} config 
   * @returns {this} self reference
   */
  setDefaultNodeConfig(config = {}) {
    this._defaultNodeConfig = {
      ...SIM_NODE_DEFAULTS,
      ...this._defaultNodeConfig,
      ...config
    };
    this._nodeAccessors = toNodeAccessors(this._defaultNodeConfig);
    this._nodeConfigDirty = true;
    return this;
  }


  /**
   * Merges new config data into the current overrides of a specific node
   * @param {NodeId} id - node id
   * @param {SimNodeConfig} [config] - sim-node config
   * @returns {this} self reference
   */
  setNodeConfig(id, config = {}) {
    /** @type {Record<string, any>} */
    const merged = { ...this._nodeOverrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._nodeOverrides.set(
      id,
      /** @type {SimNodeAccessors} */
      merged,
    );
    this._nodeConfigDirty = true;
    return this;
  }


  /**
   * Clears all config overrides for a specific node
   * @param {NodeId} id - node id
   * @returns {this} self reference
   */
  clearNodeConfig(id) {
    this._nodeOverrides.delete(id);
    this._nodeConfigDirty = true;
    return this;
  }


  /**
   * Sets the default spring settings for all edges.
   * `sync()` will update all edges with the new defaults, except for
   * specific overrides
   * @param {SimEdgeConfig} config
   * @returns {this} self reference
   */
  setDefaultEdgeConfig(config = {}) {
    this._defaultEdgeConfig = {
      ...SIM_EDGE_DEFAULTS,
      ...this._defaultEdgeConfig,
      ...config
    };
    this._edgeAccessors = toEdgeAccessors(this._defaultEdgeConfig);
    this._edgeConfigDirty = true;
    return this;
  }


  /**
   * Merges new config data into the current overrides of a specific edge
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {SimEdgeConfig} [config] - edge config
   * @returns {this} self reference
   * @throws {Error} throws if edge not found
   */
  setEdgeConfig(srcId, destId, config = {}) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) throw new Error(`Simulation: no edge from "${srcId}" to "${destId}"`);
    /** @type {Record<string, any>} */
    const merged = { ...this._edgeOverrides.get(gEdge), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._edgeOverrides.set(
      gEdge,
      /** @type {SimEdgeAccessors} */
      merged,
    );
    this._edgeConfigDirty = true;
    return this;
  }


  /**
   * Clears all config overrides for a specific edge
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {this} self reference
   */
  clearEdgeConfig(srcId, destId) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) return this;
    this._edgeOverrides.delete(gEdge);
    this._edgeConfigDirty = true;
    return this;
  }


  /**
   * Updates a sim-node's config based on its corresponding graph node.
   * @param {GraphNode} gNode - graph node
   * @param {SimNode} sNode - matching sim-node
   * @returns {boolean} whether resolved physical values changed
   * @private
   */
  _resolveNode(gNode, sNode) {
    const acc = this._nodeAccessors,
          g = this._graph,
          o = this._nodeOverrides.get(gNode.id);
    const mass   = o?.mass?.(gNode, g)   ?? acc.mass(gNode, g);
    const radius = o?.radius?.(gNode, g) ?? acc.radius(gNode, g);
    const charge = o?.charge?.(gNode, g) ?? acc.charge(gNode, g);
    const prevMass = sNode.mass, prevRadius = sNode.radius,
      prevCharge = sNode.charge, prevFixed = sNode.fixed;

    sNode.mass   = Number.isFinite(mass)   ?
      Math.max(mass, 1e-6) : SIM_NODE_DEFAULTS.mass;
    sNode.radius = Number.isFinite(radius) ?
      Math.max(radius, 0)  : SIM_NODE_DEFAULTS.radius;
    sNode.charge = Number.isFinite(charge) ?
      Math.max(charge, 0)  : SIM_NODE_DEFAULTS.charge;
    sNode.fixed  = (o?.fixed?.(gNode, g) ??  acc.fixed(gNode, g)) === true;

    return sNode.mass !== prevMass || sNode.radius !== prevRadius ||
      sNode.charge !== prevCharge || sNode.fixed !== prevFixed;
  }


  /**
   * Resolves an edge's spring settings from its overrides and the defaults.
   * @param {GraphEdge} gEdge - graph edge
   * @returns {[number, number]} resolved `[length, stiffness]`
   * @private
   */
  _resolveEdge(gEdge) {
    const acc = this._edgeAccessors,
          g = this._graph,
          o = this._edgeOverrides.get(gEdge);
    const length    = o?.length?.(gEdge, g)    ?? acc.length(gEdge, g);
    const stiffness = o?.stiffness?.(gEdge, g) ?? acc.stiffness(gEdge, g);
    return [
      Number.isFinite(length)    ? Math.max(length, 0)    : SIM_EDGE_DEFAULTS.length,
      Number.isFinite(stiffness) ? Math.max(stiffness, 0) : SIM_EDGE_DEFAULTS.stiffness,
    ];
  }


  /**
   * Resolves every sim-node's config, and copies node radii, charges, and
   * fixed flags into their typed arrays.
   * @returns {boolean} whether any resolved value changed
   * @private
   */
  _packNodeConfig() {
    const list = this._nodeList, gNodes = this._graph.nodes;
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const sNode = list[i];
      const gNode = /** @type {GraphNode} */ (gNodes.get(sNode.id));
      if (this._resolveNode(gNode, sNode)) changed = true;
      this._nodeRadius[i] = sNode.radius;
      this._nodeCharge[i] = sNode.charge;
      this._nodeFixed[i] = sNode.fixed ? 1 : 0;
    }
    this._nodeConfigDirty = false;
    return changed;
  }


  /**
   * Resolves the settings of the spring behind an edge. A spring shared by a
   * directed edge and its reverse twin acts as both edges' springs at half
   * strength: their stiffnesses are averaged, and their lengths averaged
   * weighted by stiffness.
   * @param {GraphEdge} gEdge - graph edge
   * @param {GraphEdge} [twin] - the edge's reverse twin, if it has one
   * @returns {[number, number]} resolved `[length, stiffness]`
   * @private
   */
  _resolveSpring(gEdge, twin) {
    const [len, k] = this._resolveEdge(gEdge);
    if (!twin) return [len, k];
    const [len2, k2] = this._resolveEdge(twin);
    const kSum = k + k2;
    return [kSum > 0 ? (k * len + k2 * len2) / kSum : (len + len2) / 2, kSum / 2];
  }


  /**
   * Resolves every spring's length and stiffness into `_springLength` and
   * `_springStiffness`.
   * @returns {boolean} whether any resolved value changed
   * @private
   */
  _packEdgeConfig() {
    const edges = this._edgeList, se = this._springEdges;
    const lens = this._springLength, ks = this._springStiffness;
    let changed = false;
    for (let s = 0; s < lens.length; s++) {
      const twin = se[2 * s + 1];
      const [len, k] = this._resolveSpring(
        edges[se[2 * s]], twin >= 0 ? edges[twin] : undefined);
      if (lens[s] !== len || ks[s] !== k) changed = true;
      lens[s] = len; ks[s] = k;
    }
    this._edgeConfigDirty = false;
    return changed;
  }


  /**
   * Creates a sim-node object based on the given graph node. Its config
   * starts at the global defaults, and is resolved by `_packNodeConfig()`.
   * @param {GraphNode} gNode - graph node to seed sim-node from
   * @returns {SimNode} resulting sim-node
   * @private
   */
  _seedNode(gNode) {
    return {
      id: gNode.id,
      ...SIM_NODE_DEFAULTS,
      ...this._seedPos(gNode),
      fx: 0, fy: 0,
    };
  }


  /**
   * Seeds a sim-node's position based on the simulated positions of its graph
   * neighbors. With no graph neighbors, it defaults to a random position
   * within +/-75 of the origin
   * @param {GraphNode} gNode - graph node
   * @returns {{ x: number, y: number, vx: number, vy: number }} - initial
   *    position and velocity of sim-node
   * @private
   */
  _seedPos(gNode) {
    const neighbors = this._graph.adjacency.get(gNode.id);
    let sx = 0, sy = 0, n = 0;
    if (neighbors) for (const id of neighbors.keys()) {
      const sNode = this._nodes.get(id);
      if (sNode) { sx += sNode.x; sy += sNode.y; n++; }
    }
    const jitter = () => (Math.random() - 0.5) * 30;
    return n ? {
      x: sx / n + jitter(), y: sy / n + jitter(),
      vx: 0, vy: 0,
    } : {
      x: jitter() * 5, y: jitter() * 5,
      vx: 0, vy: 0,
    };
  }


  // Update physics tables to match graph
  /**
   * Updates internal node and edge storage to match the shape of `this.graph`.
   * Also resolves node and edge configs to apply new overrides or defaults.
   * Gates on config changes, graph data changes, and graph shape changes.
   * Reheats on shape changes, and on config changes that alter resolved values.
   * @returns {boolean} whether graph shape or node or edge configs were updated
   */
  sync() {
    if (this._syncedGraphDataVersion !== this._graph.dataVersion) {
      this._nodeConfigDirty = true;
      this._edgeConfigDirty = true;
      this._syncedGraphDataVersion = this._graph.dataVersion;
    }
    const structural = this._syncedGraphVersion !== this._graph.version;
    if (!structural && !this._nodeConfigDirty && !this._edgeConfigDirty)
      return false;

    if (structural) this._syncStructure();

    const nodesChanged = this._nodeConfigDirty && this._packNodeConfig();
    const edgesChanged = this._edgeConfigDirty && this._packEdgeConfig();
    if (structural || nodesChanged || edgesChanged) this.heat();
    return true;
  }


  /**
   * Rebuilds node, edge, and spring tables to match the shape of `this.graph`,
   * seeding new sim-nodes and pruning the overrides of removed nodes and edges.
   * Marks node and edge config dirty, since new slots need resolving and
   * accessors may depend on graph shape.
   * @returns {void}
   * @private
   */
  _syncStructure() {
    // Add new nodes
    for (const [id, gNode] of this._graph.nodes) {
      if (!this._nodes.has(id)) this._nodes.set(id, this._seedNode(gNode));
    }

    // Delete old nodes and their overrides
    for (const id of this._nodes.keys()) {
      if (!this._graph.nodes.has(id)) {
        this._nodes.delete(id);
        this._nodeOverrides.delete(id);
      }
    }

    const prevNodeCount = this._nodeList.length;

    this._nodeList = [];
    this._nodeIndex = new Map();
    for (const [id, sNode] of this._nodes) {
      this._nodeIndex.set(id, this._nodeList.length);
      this._nodeList.push(sNode);
    }

    const nodeCount = this._nodeList.length;
    if (nodeCount !== prevNodeCount) {
      this._nodeRadius = new Float64Array(nodeCount);
      this._nodeCharge = new Float64Array(nodeCount);
      this._nodeFixed = new Uint8Array(nodeCount);
      this._nodeX = new Float64Array(nodeCount);
      this._nodeY = new Float64Array(nodeCount);
      this._nodeFx = new Float64Array(nodeCount);
      this._nodeFy = new Float64Array(nodeCount);
    }

    // Delete overrides of old edges
    for (const gEdge of this._edgeOverrides.keys()) {
      if (!this._graph.edges.has(gEdge)) this._edgeOverrides.delete(gEdge);
    }

    const pairs = [], springs = [], springEdges = [], n = this._nodes.size;
    this._edgeList = [], this._edgeIndex = new Map();
    /** @type {Map<number, number> | null} spring index by node pair key */
    const seen = this._graph.directed ? new Map() : null;

    for (const edge of this._graph.edges) {
      const i = this._nodeIndex.get(edge.src.id);
      const j = this._nodeIndex.get(edge.dest.id);
      if (i === undefined || j === undefined) continue;
      const e = this._edgeList.length;
      pairs.push(i, j);
      this._edgeIndex.set(edge, e);
      this._edgeList.push(edge);

      if (i === j) continue; // self-loops have no spring
      if (seen) {
        const key = i < j ? i * n + j : j * n + i;
        const s = seen.get(key);
        if (s !== undefined) { springEdges[2 * s + 1] = e; continue; } // reverse twin
        seen.set(key, springs.length / 2);
      }
      springs.push(i, j);
      springEdges.push(e, -1);
    }

    this._edgePairs = Int32Array.from(pairs);
    // Share edgePairs when no self-loop or reverse twin was filtered out
    this._springs  = springs.length === pairs.length ?
      this._edgePairs :
      Int32Array.from(springs);
    this._springEdges = Int32Array.from(springEdges);
    this._springLength = new Float64Array(this._springs.length / 2);
    this._springStiffness = new Float64Array(this._springs.length / 2);

    this._nodeConfigDirty = true;
    this._edgeConfigDirty = true;
    this._syncedGraphVersion = this._graph.version;
    this._version++;
  }


  /**
   * Applies repulsive forces with O(n^2) pairwise force accumulation.
   * Uses Coulomb's law, without any charge parameters.
   * @returns {void}
   * @private
   */
  _applyRepulsion() {
    if (this._opts.useBarnesHut) { this._repelBarnesHut(); return; }

    const list = this._nodeList;
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const n1 = list[i], n2 = list[j];
        let dx = n1.x - n2.x, dy = n1.y - n2.y;
        let dSq = dx * dx + dy * dy;

        // Randomize force axis for very close distances
        if (dSq < 1e-12) {
          dx = Math.random() - 0.5; dy = Math.random() - 0.5;
          dSq = dx * dx + dy * dy;
        }
        dSq = Math.max(dSq, this._opts.minDistSq); // short-range clamp

        const s = n1.charge * n2.charge * this._opts.repulsion / (dSq * Math.sqrt(dSq));
        const fx = s * dx, fy = s * dy;
        n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
      }
    }
  }


  /**
   * Applies spring forces between nodes connected by edges.
   * @returns {void}
   * @private
   */
  _applySprings() {
    const list = this._nodeList;
    const springs = this._springs;
    const lens = this._springLength, ks = this._springStiffness;
    for (let i = 0, k = 0; i < springs.length; i += 2, k++) {
      const n1 = list[springs[i]], n2 = list[springs[i + 1]];
      const dx = n1.x - n2.x, dy = n1.y - n2.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const s = -ks[k] * (d - lens[k]) / d;
      const fx = s * dx, fy = s * dy;
      n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
    }
  }


  /**
   * Applies graviational acceleration towards the origin
   * @returns {void}
   * @private
   */
  _applyGravity() {
    const list = this._nodeList;
    const g = this._opts.gravity;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      n.fx -= g * n.x;
      n.fy -= g * n.y;
    }
  }

  /**
   * Pushes intersecting nodes apart.
   * @returns {void}
   * @private
   */
  _enforceRadius() {
    if (this._opts.collision === "barnesHut") { this._collideBarnesHut(); return; }
    if (this._opts.collision !== "pairs") { this._collideGrid(); return; }

    const list = this._nodeList;
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const n1 = list[i], n2 = list[j];
        let dx = n1.x - n2.x, dy = n1.y - n2.y;
        const dSq = dx * dx + dy * dy;
        const minD = n1.radius + n2.radius;
        if (dSq >= minD * minD) continue;

        let d = Math.sqrt(dSq);
        if (d < 1e-7) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }


        const pushCoeff = (minD - d) / d;
        const s1 = n1.fixed ? 0 : (n2.fixed ? 1 : 0.5);
        const s2 = n2.fixed ? 0 : (n1.fixed ? 1 : 0.5);

        n1.x += dx * pushCoeff * s1;  n1.y += dy * pushCoeff * s1;
        n2.x -= dx * pushCoeff * s2;  n2.y -= dy * pushCoeff * s2;
      }
    }
  }


  /** @private */
  _repelBarnesHut() {
    this._packPositions();
    const list = this._nodeList, fx = this._nodeFx, fy = this._nodeFy;
    fx.fill(0); fy.fill(0);   // repel() adds to these
    this._barnesHutCtx.repel(this._nodeX, this._nodeY, this._nodeCharge, fx, fy, {
      strength: this._opts.repulsion, minDistSq: this._opts.minDistSq,
    });
    for (let i = 0; i < list.length; i++) { list[i].fx += fx[i]; list[i].fy += fy[i]; }
  }

  /** @private */
  _collideBarnesHut() {
    this._packPositions();
    this._barnesHutCtx.collide(this._nodeX, this._nodeY, this._nodeRadius, this._nodeFixed);
    this._unpackPositions();
  }

  /** @private */
  _collideGrid() {
    this._packPositions();
    this._collisionGrid.collide(this._nodeX, this._nodeY, this._nodeRadius, this._nodeFixed);
    this._unpackPositions();
  }


  /** @private */
  _packPositions() {
    for (let i = 0; i < this._nodeList.length; i++) {
      this._nodeX[i] = this._nodeList[i].x;
      this._nodeY[i] = this._nodeList[i].y;
    }
  }

  /** @private */
  _unpackPositions() {
    const list = this._nodeList;
    for (let i = 0; i < list.length; i++) { list[i].x = this._nodeX[i]; list[i].y = this._nodeY[i]; }
  }

  
  /**
   * Simulates the graph's physics for one tick, after syncing graph shape and
   * sim-node config.
   * @param {number} [dt=opts.dt] - time step, scaling both velocity and position
   *    updates. Tuned for dt=1. Friction applies once per tick.
   * @returns {this} self reference
   */
  tick(dt = this._opts.dt) {
    this.sync();

    // reset force totals
    const list = this._nodeList;
    for (let i = 0; i < list.length; i++) { list[i].fx = 0; list[i].fy = 0; }

    if (!this._temp) return this;

    this._applyRepulsion();
    this._applySprings();
    this._applyGravity();

    const maxV = this._opts.maxSpeed;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.fixed) { r.vx = 0; r.vy = 0; continue; }
      r.vx = (r.vx + (r.fx / r.mass) * dt * this._temp) * this._opts.friction;
      r.vy = (r.vy + (r.fy / r.mass) * dt * this._temp) * this._opts.friction;
      
      // Limit speed
      const v = Math.hypot(r.vx, r.vy);
      if (v > maxV) { r.vx *= maxV / v; r.vy *= maxV / v; }

      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }

    this._temp *= this._opts.cooling;
    if (this._temp < this._opts.freezePoint) {
      this._temp = 0;
      // Drop residual velocities
      for (let i = 0; i < list.length; i++) { list[i].vx = 0; list[i].vy = 0; }
    }

    // Enforce radius
    this._enforceRadius();
    return this;
  }


  /**
   * Gets the simulation coordinates of a node by id.
   * @param {NodeId} id - node id
   * @returns {[number, number] | null} the node's simulation coordinates, or
   *    `null` if it was not found
   */
  getPosition(id) {
    const node = this._nodes.get(id);
    if (node) return [node.x, node.y];
    return null;
  }


  /**
   * Gets the settings of the spring acting along an edge, resolved from the
   * current config (even before the next `sync()`). In a directed graph, an
   * edge and its reverse share one spring, so both return the same combined
   * settings. Self-loops have no spring.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {SimEdge | null} the spring's length and stiffness, or `null` if
   *    the edge was not found or is a self-loop
   */
  getEdgeSpring(srcId, destId) {
    const g = this._graph, gEdge = g.getEdge(srcId, destId);
    if (!gEdge || gEdge.src === gEdge.dest) return null;
    const twin = g.directed ? g.getEdge(destId, srcId) : undefined;
    const [length, stiffness] = this._resolveSpring(gEdge, twin);
    return { length, stiffness };
  }


  /**
   * Finds a node by id and pins it to specified coordinates in simulation space.
   * @param {NodeId} id - node id
   * @param {number} x - simulation x coordinate to pin to
   * @param {number} y - simulation y coordinate
   * @returns {boolean} whether the node was pinned (`false` if node not found)
   */
  pin(id, x, y) {
    const node = this._nodes.get(id);
    if (!node) return false;
    this.setNodeConfig(id, { fixed: true });
    if (node.x !== x || node.y !== y) this.heat();
    [node.x, node.y] = [x, y];
    return true;
  }


  /**
   * Unpins a node by id by reverting `fixed` to its default.
   * @param {NodeId} id - node id
   * @returns {this} self reference
   */
  unpin(id) { this.setNodeConfig(id, { fixed: undefined }); return this; }
}
