/**
 * @import { Graph } from './graph.js'
 */
/** @import { NodeId, GraphNode, GraphEdge } from './typedefs/graph.js' */
/**
 * @import {
 *  SimNodeConfig, SimEdge, SimEdgeConfig,
 *  SimOpts, SimOptsInput,
 *  SimEventMap, SimEventType, SimForce,
 * } from './typedefs/simulation.js'
 */
/**
 * @import {
 *  ResolvedSimNodeConfig, ResolvedSimNodeAccessors,
 *  ResolvedSimEdgeConfig, ResolvedSimEdgeAccessors,
 * } from './typedefs/internal/simulation.js'
 */

import { BarnesHutContext, checkBarnesHutOpts } from "./barnes-hut.js";
import { ConfigCascade } from "./config-cascade.js";
import { CollisionGrid } from "./collision-grid.js";
import { Emitter } from "./emitter.js";
import { HookRegistry } from "./hook-registry.js";
import { keysOf } from "./utils.js";
import { SIM_DEFAULTS, SIM_NODE_DEFAULTS, SIM_EDGE_DEFAULTS } from "./defaults.js";
import { checkBoolean, checkEach, checkKnownKeys, checkNumber, checkOneOf } from "./validate.js";


/** Every simulation option name, including the nested config and Barnes-Hut options */
const OPTION_NAMES = new Set([...Object.keys(SIM_DEFAULTS), "nodeConfig", "edgeConfig", "barnesHut"]);

/**
 * A check per simulation option
 * @type {Record<keyof SimOpts, (v: any) => void>}
 */
const OPTION_RULES = {
  friction:     v => checkNumber("Simulation", "friction", v, { min: 0, max: 1 }),
  gravity:      v => checkNumber("Simulation", "gravity", v, { min: 0 }),
  repulsion:    v => checkNumber("Simulation", "repulsion", v, { min: 0 }),
  minDistSq:    v => checkNumber("Simulation", "minDistSq", v, { min: 0 }),
  maxSpeed:     v => checkNumber("Simulation", "maxSpeed", v, { min: 0, aboveMin: true, allowInfinity: true }),
  dt:           v => checkNumber("Simulation", "dt", v, { min: 0, aboveMin: true }),
  cooling:      v => checkNumber("Simulation", "cooling", v, { min: 0, max: 1, aboveMin: true }),
  freezePoint:  v => checkNumber("Simulation", "freezePoint", v, { min: 0 }),
  useBarnesHut: v => checkBoolean("Simulation", "useBarnesHut", v),
  collision:    v => checkOneOf("Simulation", "collision", v, ["grid", "barnesHut", "pairs"]),
};


/**
 * Every simulation event name. The type requires exactly the keys of
 * `SimEventMap`, so adding an event there without adding it here fails type
 * checking.
 * @type {Record<SimEventType, true>}
 */
const SIM_EVENT_NAMES = { settle: true, wake: true };
const SIM_EVENT_TYPES = keysOf(SIM_EVENT_NAMES);


/**
 * Moves a `SimNode` view to another node slot. Set by `SimNode`'s static block,
 * so the node slot stays private to the class and this module.
 * @type {(node: SimNode, i: number) => void}
 */
let setNodeSlot;


/**
 * Live view of one simulation node. It stores nothing but its id and slot:
 * every field reads or writes the simulation's `node*` arrays, so it is always
 * current. A node keeps the same view while it stays in the graph.
 *
 * `x`, `y`, `vx` and `vy` can be set directly (followed by `heat()`). The
 * other fields are read-only: `mass`, `radius`, `charge` and `fixed` are
 * resolved from config, so set them with `setNodeConfig()`. Once its node is
 * removed and the simulation syncs, a view's numeric fields read `undefined`,
 * `fixed` reads `false`, and writes do nothing.
 *
 * Created by `Simulation`; not meant to be constructed directly.
 */
export class SimNode {
  /** @type {Simulation} */
  #sim;
  /** @type {number} */
  #i;

  /**
   * Node id (matches corresponding `GraphNode`)
   * @readonly
   * @type {NodeId}
   */
  id;

  static {
    setNodeSlot = (node, i) => { node.#i = i; };
  }

  /**
   * @param {Simulation} sim - owning simulation
   * @param {NodeId} id - node id
   * @param {number} i - slot in the simulation's `node*` arrays
   */
  constructor(sim, id, i) {
    this.#sim = sim;
    this.id = id;
    this.#i = i;
  }

  /** x coordinate */
  get x() { return this.#sim.nodeX[this.#i]; }
  set x(v) { this.#sim.nodeX[this.#i] = v; }

  /** y coordinate */
  get y() { return this.#sim.nodeY[this.#i]; }
  set y(v) { this.#sim.nodeY[this.#i] = v; }

  /** x velocity */
  get vx() { return this.#sim.nodeVx[this.#i]; }
  set vx(v) { this.#sim.nodeVx[this.#i] = v; }

  /** y velocity */
  get vy() { return this.#sim.nodeVy[this.#i]; }
  set vy(v) { this.#sim.nodeVy[this.#i] = v; }

  /** [read-only] x force total, reset and accumulated every tick */
  get fx() { return this.#sim.nodeFx[this.#i]; }

  /** [read-only] y force total, reset and accumulated every tick */
  get fy() { return this.#sim.nodeFy[this.#i]; }

  /** [read-only, set with `setNodeConfig()`] physical mass of the node */
  get mass() { return this.#sim.nodeMass[this.#i]; }

  /** [read-only, set with `setNodeConfig()`] physical (and rendered) radius */
  get radius() { return this.#sim.nodeRadius[this.#i]; }

  /** [read-only, set with `setNodeConfig()`] charge for electrostatic repulsion */
  get charge() { return this.#sim.nodeCharge[this.#i]; }

  /** [read-only, set with `setNodeConfig()`] whether the node is immovable */
  get fixed() { return this.#sim.nodeFixed[this.#i] === 1; }
}


/**
 * Simulates repulsion, springs, friction, gravity,
 * and collision resolution for an underlying `Graph` instance.
 * Emits the events in `SimEventMap`, through `on()` and `off()`.
 * @extends {Emitter<SimEventMap, Simulation>}
 */
export class Simulation extends Emitter {
  /** @private @type {Graph} */
  _graph;
  get graph() { return this._graph; }


  /** @private @type {SimOpts} */
  _opts = { ...SIM_DEFAULTS };
  /**
   * [read-only, set with `setOpts()`]
   * Simulation physics options
   * @returns {Readonly<SimOpts>}
   */
  get opts() { return this._opts; }


  /** @private @type {Map<NodeId, SimNode>} */
  _nodes = new Map();
  /**
   * Map of live node views, keyed by keys used in the underlying `graph`
   * (mirrors Map shape of `Graph.nodes`). A node keeps the same view while it
   * stays in the graph.
   * @returns {ReadonlyMap<NodeId, SimNode>}
   */
  get nodes() { return this._nodes; }


  /** @private @type {SimNode[]} */
  _nodeList = [];
  /**
   * Cached array of live node views, in slot order. Recreated in effective
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
   * Cached map connecting node ids to their slots in `nodeList` and the
   * `node*` arrays. Recreated in effective `sync()` calls.
   * @returns {ReadonlyMap<NodeId, number>}
   */
  get nodeIndex() { return this._nodeIndex; }


  /*
   * Node state, one slot per node, parallel to `nodeList`. These arrays are the
   * only store of node state: `SimNode` views read and write them. Replaced
   * whenever `version` changes, so re-read them after a structural sync rather
   * than keeping them.
   */

  /** @private @type {NodeId[]} */
  _nodeId = [];
  /**
   * [read-only] Id of the node in each slot
   * @returns {ReadonlyArray<NodeId>}
   */
  get nodeId() { return this._nodeId; }

  /** @private @type {Float64Array} */
  _nodeX = new Float64Array(0);
  /**
   * x coordinate of each node. Elements can be set (followed by `heat()`).
   * @returns {Float64Array}
   */
  get nodeX() { return this._nodeX; }

  /** @private @type {Float64Array} */
  _nodeY = new Float64Array(0);
  /**
   * y coordinate of each node. Elements can be set (followed by `heat()`).
   * @returns {Float64Array}
   */
  get nodeY() { return this._nodeY; }

  /** @private @type {Float64Array} */
  _nodeVx = new Float64Array(0);
  /**
   * x velocity of each node. Elements can be set (followed by `heat()`).
   * @returns {Float64Array}
   */
  get nodeVx() { return this._nodeVx; }

  /** @private @type {Float64Array} */
  _nodeVy = new Float64Array(0);
  /**
   * y velocity of each node. Elements can be set (followed by `heat()`).
   * @returns {Float64Array}
   */
  get nodeVy() { return this._nodeVy; }

  /** @private @type {Float64Array} */
  _nodeFx = new Float64Array(0);
  /**
   * x force total of each node, reset and accumulated every tick. Forces
   * added with `addForce()` add to it.
   * @returns {Float64Array}
   */
  get nodeFx() { return this._nodeFx; }

  /** @private @type {Float64Array} */
  _nodeFy = new Float64Array(0);
  /**
   * y force total of each node, reset and accumulated every tick. Forces
   * added with `addForce()` add to it.
   * @returns {Float64Array}
   */
  get nodeFy() { return this._nodeFy; }

  /** @private @type {Float64Array} */
  _nodeMass = new Float64Array(0);
  /**
   * [read-only, set with `setNodeConfig()`] Resolved mass of each node.
   * Updated in effective `sync()` calls.
   * @returns {Readonly<Float64Array>}
   */
  get nodeMass() { return this._nodeMass; }

  /** @private @type {Float64Array} */
  _nodeRadius = new Float64Array(0);
  /**
   * [read-only, set with `setNodeConfig()`] Resolved radius of each node.
   * Updated in effective `sync()` calls.
   * @returns {Readonly<Float64Array>}
   */
  get nodeRadius() { return this._nodeRadius; }

  /** @private @type {Float64Array} */
  _nodeCharge = new Float64Array(0);
  /**
   * [read-only, set with `setNodeConfig()`] Resolved charge of each node.
   * Updated in effective `sync()` calls.
   * @returns {Readonly<Float64Array>}
   */
  get nodeCharge() { return this._nodeCharge; }

  /** @private @type {Uint8Array} */
  _nodeFixed = new Uint8Array(0);
  /**
   * [read-only, set with `setNodeConfig()`] Resolved fixed flag of each node:
   * 1 if fixed, 0 if not. Updated in effective `sync()` calls.
   * @returns {Readonly<Uint8Array>}
   */
  get nodeFixed() { return this._nodeFixed; }


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
   * Node config: the default node config, and per-node overrides keyed by
   * node id. A node's own overrides take priority over the default config,
   * which takes priority over `SIM_NODE_DEFAULTS`.
   * @type {ConfigCascade<ResolvedSimNodeConfig, ResolvedSimNodeAccessors, NodeId>}
   * @private
   */
  _nodeConfig = new ConfigCascade(SIM_NODE_DEFAULTS);
  /**
   * [read-only, set with `setDefaultNodeConfig()` or `setOpts()`]
   * Current default node config. Takes precedence over the global default config,
   * but can be overridden for specific nodes using `setNodeConfig()`.
   * @returns {Readonly<ResolvedSimNodeConfig>}
   */
  get defaultNodeConfig() { return this._nodeConfig.defaults; }

  /**
   * Edge config: the default edge config, and per-edge overrides keyed by
   * edge object. An edge's own overrides take priority over the default
   * config, which takes priority over `SIM_EDGE_DEFAULTS`.
   * @type {ConfigCascade<ResolvedSimEdgeConfig, ResolvedSimEdgeAccessors, GraphEdge>}
   * @private
   */
  _edgeConfig = new ConfigCascade(SIM_EDGE_DEFAULTS);
  /**
   * [read-only, set with `setDefaultEdgeConfig()` or `setOpts()`]
   * Current default edge config. Takes precedence over the global default
   * config, but can be overridden for specific edges using `setEdgeConfig()`.
   * @returns {Readonly<ResolvedSimEdgeConfig>}
   */
  get defaultEdgeConfig() { return this._edgeConfig.defaults; }

  /** @private @type {number} */
  _temp = 0;
  /**
   * [read-only, reset with `heat()`]
   * Temperature value that forces are multiplied by. Decays each tick
   * according to the rate of `opts.cooling`. Once it is lower than
   * `opts.freezePoint`, it is set to zero. Reset by the `heat()` function,
   * which is called after config or settings changes. The `settle` and
   * `wake` events report it reaching zero and leaving it.
   */
  get temp() { return this._temp; }

  /**
   * Always initialized
   * @type {BarnesHutContext}
   * @private
   */
  _barnesHutCtx = new BarnesHutContext();

  /**
   * Grid used when `opts.collision` is `"grid"`
   * @type {CollisionGrid}
   * @private
   */
  _collisionGrid = new CollisionGrid();

  /**
   * Custom forces, run each tick after the built-in ones
   * @type {HookRegistry<"force", SimForce>}
   * @private
   */
  _forces = new HookRegistry(["force"], "Simulation");

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
    super(SIM_EVENT_TYPES, "Simulation");
    this._graph = graph;

    this.setOpts(opts);
    this.sync();
  }


  /**
   * Sets options, and wakes the layout. Options left `undefined` keep their
   * current value. Nothing changes if any option is invalid.
   * @param {SimOptsInput} [optsInput={}] - options to set
   * @returns {this} self reference
   * @throws {TypeError | RangeError} throws if an option is invalid or unknown
   */
  setOpts(optsInput = {}) {
    checkKnownKeys("Simulation", optsInput, OPTION_NAMES);
    const { nodeConfig, edgeConfig, barnesHut, ...opts } = optsInput;
    checkEach(opts, OPTION_RULES);
    if (barnesHut !== undefined) checkBarnesHutOpts("Simulation", barnesHut, "barnesHut.");

    for (const key of /** @type {(keyof SimOpts)[]} */ (Object.keys(opts))) {
      if (opts[key] !== undefined) /** @type {any} */ (this._opts)[key] = opts[key];
    }
    if (nodeConfig) this.setDefaultNodeConfig(nodeConfig);
    if (edgeConfig) this.setDefaultEdgeConfig(edgeConfig);
    if (barnesHut) this._barnesHutCtx.setOpts(barnesHut);
    this.heat();
    return this;
  }


  /**
   * Sets the simulation's temp value. Emits `wake` if that starts a frozen
   * layout moving, or `settle` if setting 0 stops a moving one.
   * @param {number} [t=1] - temperature to set; values below 0 set 0
   * @returns {this} self reference
   */
  heat(t = 1) {
    const wasFrozen = this._temp === 0;
    this._temp = t >= 0 ? t : 0;
    if (wasFrozen && this._temp > 0) this._emit("wake", {});
    else if (!wasFrozen && this._temp === 0) this._emit("settle", {});
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
    this._nodeConfig.setDefaults(config);
    return this;
  }


  /**
   * Merges new config data into the current overrides of a specific node
   * @param {NodeId} id - node id
   * @param {SimNodeConfig} [config] - sim-node config
   * @returns {this} self reference
   */
  setNodeConfig(id, config = {}) {
    this._nodeConfig.set(id, config);
    return this;
  }


  /**
   * Clears all config overrides for a specific node
   * @param {NodeId} id - node id
   * @returns {this} self reference
   */
  clearNodeConfig(id) {
    this._nodeConfig.clear(id);
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
    this._edgeConfig.setDefaults(config);
    return this;
  }


  /**
   * Merges new config data into the current overrides of a specific edge
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {SimEdgeConfig} [config] - edge config
   * @returns {this} self reference
   * @throws {ReferenceError} throws if the edge doesn't exist
   */
  setEdgeConfig(srcId, destId, config = {}) {
    const gEdge = this._graph.getEdge(srcId, destId);
    if (!gEdge) throw new ReferenceError(`Simulation: no edge from "${srcId}" to "${destId}"`);
    this._edgeConfig.set(gEdge, config);
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
    if (gEdge) this._edgeConfig.clear(gEdge);
    return this;
  }


  /**
   * Resolves a node's config from its graph node into its slot of the mass,
   * radius, charge and fixed arrays.
   * @param {GraphNode} gNode - graph node
   * @param {number} i - the node's slot
   * @returns {boolean} whether resolved physical values changed
   * @private
   */
  _resolveNode(gNode, i) {
    const acc = this._nodeConfig.accessors,
          g = this._graph,
          o = this._nodeConfig.overrides.get(gNode.id);
    let mass   = o?.mass?.(gNode, g)   ?? acc.mass(gNode, g);
    let radius = o?.radius?.(gNode, g) ?? acc.radius(gNode, g);
    let charge = o?.charge?.(gNode, g) ?? acc.charge(gNode, g);
    mass   = Number.isFinite(mass)   ? Math.max(mass, 1e-6) : SIM_NODE_DEFAULTS.mass;
    radius = Number.isFinite(radius) ? Math.max(radius, 0)  : SIM_NODE_DEFAULTS.radius;
    charge = Number.isFinite(charge) ? Math.max(charge, 0)  : SIM_NODE_DEFAULTS.charge;
    const fixed = (o?.fixed?.(gNode, g) ?? acc.fixed(gNode, g)) === true ? 1 : 0;

    const changed = this._nodeMass[i] !== mass || this._nodeRadius[i] !== radius ||
      this._nodeCharge[i] !== charge || this._nodeFixed[i] !== fixed;
    this._nodeMass[i] = mass;
    this._nodeRadius[i] = radius;
    this._nodeCharge[i] = charge;
    this._nodeFixed[i] = fixed;
    return changed;
  }


  /**
   * Resolves an edge's spring settings from its overrides and the defaults.
   * @param {GraphEdge} gEdge - graph edge
   * @returns {[number, number]} resolved `[length, stiffness]`
   * @private
   */
  _resolveEdge(gEdge) {
    const acc = this._edgeConfig.accessors,
          g = this._graph,
          o = this._edgeConfig.overrides.get(gEdge);
    const length    = o?.length?.(gEdge, g)    ?? acc.length(gEdge, g);
    const stiffness = o?.stiffness?.(gEdge, g) ?? acc.stiffness(gEdge, g);
    return [
      Number.isFinite(length)    ? Math.max(length, 0)    : SIM_EDGE_DEFAULTS.length,
      Number.isFinite(stiffness) ? Math.max(stiffness, 0) : SIM_EDGE_DEFAULTS.stiffness,
    ];
  }


  /**
   * Resolves every node's config into the mass, radius, charge and fixed
   * arrays.
   * @returns {boolean} whether any resolved value changed
   * @private
   */
  _packNodeConfig() {
    const ids = this._nodeId, gNodes = this._graph.nodes;
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const gNode = /** @type {GraphNode} */ (gNodes.get(ids[i]));
      if (this._resolveNode(gNode, i)) changed = true;
    }
    this._nodeConfig.markClean();
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
    this._edgeConfig.markClean();
    return changed;
  }


  /**
   * Seeds a new node's slot: config at the global defaults (resolved later by
   * `_packNodeConfig()`), zero velocity, and a position near the average of
   * its already-placed graph neighbors. With no placed neighbors, it gets a
   * random position within +/-75 of the origin.
   * @param {NodeId} id - node id
   * @param {number} i - the node's slot
   * @param {Uint8Array} placed - 1 for each slot that already has a position;
   *    set for `i` on return
   * @returns {void}
   * @private
   */
  _seedNodeSlot(id, i, placed) {
    const neighbors = this._graph.adjacency.get(id);
    let sx = 0, sy = 0, n = 0;
    if (neighbors) for (const nid of neighbors.keys()) {
      const j = this._nodeIndex.get(nid);
      if (j !== undefined && placed[j]) { sx += this._nodeX[j]; sy += this._nodeY[j]; n++; }
    }
    const jitter = () => (Math.random() - 0.5) * 30;
    if (n) {
      this._nodeX[i] = sx / n + jitter();
      this._nodeY[i] = sy / n + jitter();
    } else {
      this._nodeX[i] = jitter() * 5;
      this._nodeY[i] = jitter() * 5;
    }
    this._nodeMass[i] = SIM_NODE_DEFAULTS.mass;
    this._nodeRadius[i] = SIM_NODE_DEFAULTS.radius;
    this._nodeCharge[i] = SIM_NODE_DEFAULTS.charge;
    this._nodeFixed[i] = SIM_NODE_DEFAULTS.fixed ? 1 : 0;
    placed[i] = 1;
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
      this._nodeConfig.markDirty();
      this._edgeConfig.markDirty();
      this._syncedGraphDataVersion = this._graph.dataVersion;
    }
    const structural = this._syncedGraphVersion !== this._graph.version;
    if (!structural && !this._nodeConfig.dirty && !this._edgeConfig.dirty)
      return false;

    if (structural) this._syncStructure();

    const nodesChanged = this._nodeConfig.dirty && this._packNodeConfig();
    const edgesChanged = this._edgeConfig.dirty && this._packEdgeConfig();
    if (structural || nodesChanged || edgesChanged) this.heat();
    return true;
  }


  /**
   * Rebuilds node, edge, and spring tables to match the shape of `this.graph`,
   * seeding new nodes and pruning the overrides of removed nodes and edges.
   * Surviving nodes keep their views and state, in new slots. Marks node and
   * edge config dirty, since new slots need resolving and accessors may depend
   * on graph shape.
   * @returns {void}
   * @private
   */
  _syncStructure() {
    // Delete old nodes and their overrides, detaching their views
    for (const [id, sNode] of this._nodes) {
      if (!this._graph.nodes.has(id)) {
        setNodeSlot(sNode, -1);
        this._nodes.delete(id);
        this._nodeConfig.prune(id);
      }
    }

    // Add views for new nodes, after the survivors
    for (const id of this._graph.nodes.keys()) {
      if (!this._nodes.has(id)) this._nodes.set(id, new SimNode(this, id, -1));
    }

    const oldIndex = this._nodeIndex;
    const oldX = this._nodeX, oldY = this._nodeY, oldVx = this._nodeVx, oldVy = this._nodeVy,
      oldMass = this._nodeMass, oldRadius = this._nodeRadius,
      oldCharge = this._nodeCharge, oldFixed = this._nodeFixed;

    const nodeCount = this._nodes.size;
    this._nodeList = [];
    this._nodeIndex = new Map();
    this._nodeId = [];
    for (const [id, sNode] of this._nodes) {
      setNodeSlot(sNode, this._nodeList.length);
      this._nodeIndex.set(id, this._nodeList.length);
      this._nodeList.push(sNode);
      this._nodeId.push(id);
    }

    this._nodeX = new Float64Array(nodeCount);
    this._nodeY = new Float64Array(nodeCount);
    this._nodeVx = new Float64Array(nodeCount);
    this._nodeVy = new Float64Array(nodeCount);
    this._nodeFx = new Float64Array(nodeCount);
    this._nodeFy = new Float64Array(nodeCount);
    this._nodeMass = new Float64Array(nodeCount);
    this._nodeRadius = new Float64Array(nodeCount);
    this._nodeCharge = new Float64Array(nodeCount);
    this._nodeFixed = new Uint8Array(nodeCount);

    // Carry survivors' state into their new slots, then seed new nodes in slot
    // order, so each can be placed near neighbors placed before it
    const placed = new Uint8Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      const j = oldIndex.get(this._nodeId[i]);
      if (j === undefined) continue;
      this._nodeX[i] = oldX[j];        this._nodeY[i] = oldY[j];
      this._nodeVx[i] = oldVx[j];      this._nodeVy[i] = oldVy[j];
      this._nodeMass[i] = oldMass[j];  this._nodeRadius[i] = oldRadius[j];
      this._nodeCharge[i] = oldCharge[j];
      this._nodeFixed[i] = oldFixed[j];
      placed[i] = 1;
    }
    for (let i = 0; i < nodeCount; i++) {
      if (!placed[i]) this._seedNodeSlot(this._nodeId[i], i, placed);
    }

    // Delete overrides of old edges
    for (const gEdge of this._edgeConfig.overrides.keys()) {
      if (!this._graph.edges.has(gEdge)) this._edgeConfig.prune(gEdge);
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

    this._nodeConfig.markDirty();
    this._edgeConfig.markDirty();
    this._syncedGraphVersion = this._graph.version;
    this._version++;
  }


  /**
   * Applies repulsive forces with O(n^2) pairwise force accumulation.
   * Uses Coulomb's law, scaled by each pair's charges.
   * @returns {void}
   * @private
   */
  _applyRepulsion() {
    if (this._opts.useBarnesHut) { this._repelBarnesHut(); return; }

    const xs = this._nodeX, ys = this._nodeY, qs = this._nodeCharge;
    const fxs = this._nodeFx, fys = this._nodeFy, n = xs.length;
    const { repulsion, minDistSq } = this._opts;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
        let dSq = dx * dx + dy * dy;

        // Randomize force axis for very close distances
        if (dSq < 1e-12) {
          dx = Math.random() - 0.5; dy = Math.random() - 0.5;
          dSq = dx * dx + dy * dy;
        }
        dSq = Math.max(dSq, minDistSq); // short-range clamp

        const s = qs[i] * qs[j] * repulsion / (dSq * Math.sqrt(dSq));
        const fx = s * dx, fy = s * dy;
        fxs[i] += fx; fxs[j] -= fx; fys[i] += fy; fys[j] -= fy;
      }
    }
  }


  /**
   * Applies spring forces between nodes connected by edges.
   * @returns {void}
   * @private
   */
  _applySprings() {
    const xs = this._nodeX, ys = this._nodeY, fxs = this._nodeFx, fys = this._nodeFy;
    const springs = this._springs;
    const lens = this._springLength, ks = this._springStiffness;
    for (let i = 0, k = 0; i < springs.length; i += 2, k++) {
      const a = springs[i], b = springs[i + 1];
      const dx = xs[a] - xs[b], dy = ys[a] - ys[b];
      const d = Math.hypot(dx, dy) || 1e-6;
      const s = -ks[k] * (d - lens[k]) / d;
      const fx = s * dx, fy = s * dy;
      fxs[a] += fx; fxs[b] -= fx; fys[a] += fy; fys[b] -= fy;
    }
  }


  /**
   * Applies graviational acceleration towards the origin
   * @returns {void}
   * @private
   */
  _applyGravity() {
    const xs = this._nodeX, ys = this._nodeY, fxs = this._nodeFx, fys = this._nodeFy;
    const g = this._opts.gravity;
    for (let i = 0; i < xs.length; i++) {
      fxs[i] -= g * xs[i];
      fys[i] -= g * ys[i];
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

    const xs = this._nodeX, ys = this._nodeY, rs = this._nodeRadius, fixed = this._nodeFixed;
    const n = xs.length;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
        const dSq = dx * dx + dy * dy;
        const minD = rs[i] + rs[j];
        if (dSq >= minD * minD) continue;

        let d = Math.sqrt(dSq);
        if (d < 1e-7) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }

        const pushCoeff = (minD - d) / d;
        const s1 = fixed[i] ? 0 : (fixed[j] ? 1 : 0.5);
        const s2 = fixed[j] ? 0 : (fixed[i] ? 1 : 0.5);

        xs[i] += dx * pushCoeff * s1;  ys[i] += dy * pushCoeff * s1;
        xs[j] -= dx * pushCoeff * s2;  ys[j] -= dy * pushCoeff * s2;
      }
    }
  }


  /** @private */
  _repelBarnesHut() {
    // repel() adds to the force totals
    this._barnesHutCtx.repel(this._nodeX, this._nodeY, this._nodeCharge, this._nodeFx, this._nodeFy, {
      strength: this._opts.repulsion, minDistSq: this._opts.minDistSq,
    });
  }

  /** @private */
  _collideBarnesHut() {
    this._barnesHutCtx.collide(this._nodeX, this._nodeY, this._nodeRadius, this._nodeFixed);
  }

  /** @private */
  _collideGrid() {
    this._collisionGrid.collide(this._nodeX, this._nodeY, this._nodeRadius, this._nodeFixed);
  }


  /**
   * Simulates the graph's physics for one tick, after syncing graph shape and
   * node config.
   * @param {number} [dt=opts.dt] - time step, scaling both velocity and position
   *    updates. Tuned for dt=1. Friction applies once per tick.
   * @returns {this} self reference
   */
  tick(dt = this._opts.dt) {
    this.sync();

    // reset force totals
    this._nodeFx.fill(0);
    this._nodeFy.fill(0);

    if (!this._temp) return this;

    this._applyRepulsion();
    this._applySprings();
    this._applyGravity();
    this._forces.run("force", f => f(this));

    const xs = this._nodeX, ys = this._nodeY, vxs = this._nodeVx, vys = this._nodeVy;
    const fxs = this._nodeFx, fys = this._nodeFy, ms = this._nodeMass, fixed = this._nodeFixed;
    const { maxSpeed: maxV, friction } = this._opts, temp = this._temp;
    for (let i = 0; i < xs.length; i++) {
      if (fixed[i]) { vxs[i] = 0; vys[i] = 0; continue; }
      let vx = (vxs[i] + (fxs[i] / ms[i]) * dt * temp) * friction;
      let vy = (vys[i] + (fys[i] / ms[i]) * dt * temp) * friction;

      // Limit speed
      const v = Math.hypot(vx, vy);
      if (v > maxV) { vx *= maxV / v; vy *= maxV / v; }

      vxs[i] = vx; vys[i] = vy;
      xs[i] += vx * dt;
      ys[i] += vy * dt;
    }

    this._temp *= this._opts.cooling;
    const settled = this._temp < this._opts.freezePoint;
    if (settled) {
      this._temp = 0;
      // Drop residual velocities
      vxs.fill(0);
      vys.fill(0);
    }

    // Enforce radius
    this._enforceRadius();
    // Last, so listeners see the tick's final positions
    if (settled) this._emit("settle", {});
    return this;
  }


  /**
   * Gets the simulation coordinates of a node by id.
   * @param {NodeId} id - node id
   * @returns {[number, number] | null} the node's simulation coordinates, or
   *    `null` if it was not found
   */
  getPosition(id) {
    const i = this._nodeIndex.get(id);
    if (i === undefined) return null;
    return [this._nodeX[i], this._nodeY[i]];
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
    const i = this._nodeIndex.get(id);
    if (i === undefined) return false;
    this.setNodeConfig(id, { fixed: true });
    if (this._nodeX[i] !== x || this._nodeY[i] !== y) this.heat();
    this._nodeX[i] = x;
    this._nodeY[i] = y;
    return true;
  }


  /**
   * Unpins a node by id by reverting `fixed` to its default. Does nothing for
   * a node that isn't in the graph, so unpinning a removed node doesn't leave
   * an override behind for a later node with the same id.
   * @param {NodeId} id - node id
   * @returns {this} self reference
   */
  unpin(id) {
    if (this._graph.nodes.has(id)) this.setNodeConfig(id, { fixed: undefined });
    return this;
  }


  /**
   * Adds a custom force, and wakes the layout. Each tick, after the built-in
   * forces, it's called with the simulation and adds to `nodeFx` and
   * `nodeFy`. Forces run in the order they were added; adding the same
   * function again has no effect.
   * @param {SimForce} f - force function
   * @returns {this} self reference
   */
  addForce(f) {
    this._forces.add("force", f);
    return this.heat();
  }


  /**
   * Removes a custom force, and wakes the layout if it was there.
   * @param {SimForce} f - force function to remove
   * @returns {boolean} whether the force was there
   */
  removeForce(f) {
    const removed = this._forces.remove("force", f);
    if (removed) this.heat();
    return removed;
  }
}
