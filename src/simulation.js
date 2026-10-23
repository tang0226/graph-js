import { asFn } from "./utils.js";

/** @typedef {import("./graph.js").Graph} Graph */
/** @typedef {import("./graph.js").GraphNode} GraphNode */
/** @typedef {import("./graph.js").GraphEdge} GraphEdge */
/**
 * @template T
 * @typedef {import("./types.js").NodeAccessor<T>} NodeAccessor
 */
/**
 * @template T
 * @typedef {import("./types.js").NodeOption<T>} NodeOption
 */


/**
 * @typedef {object} SimOpts
 * @property {number} friction - friction coefficient to apply to all node
 *    velocities each tick
 * @property {number} gravity - strength of pull toward (0, 0), applied as a
 *    force proportional to distance
 * @property {number} repulsion - coefficient for inverse-square repulsion
 *    calculations
 * @property {number} springStiffness - coefficient for spring forces
 * @property {number} springLength - target length of edges/springs between nodes
 * @property {number} minDistSq - minimum distance to clamp to before applying
 *    repulsive force between two nodes (to avoid extreme velocities from the
 *    inverse-square law)
 * @property {number} maxSpeed - maximum speed of each node (clamped to at the
 *    end of each tick)
 * @property {number} cooling - coefficient to decay temperature by each tick
 * @property {number} freezePoint - temperature value below which temp is set
 *    to 0
 */
/** @typedef {Partial<SimOpts> & { nodeConfig?: SimNodeConfig }} SimOptsInput */

/**
 * Full simulation node object
 * @typedef {object} SimNode
 * @property {any} id - node id (matches corresponding `GraphNode`)
 * @property {number} mass - physical mass of the node
 * @property {number} radius - physical (and rendered) radius of the node
 * @property {boolean} fixed - whether the node is immovable
 * @property {number} x - x coordinate
 * @property {number} y - y coordinate
 * @property {number} vx - x velocity
 * @property {number} vy - y velocity
 * @property {number} fx - [temp] x force total, reset and populated every tick
 * @property {number} fy - [temp] y force total, reset and populated every tick
 */

/**
 * Partial config specifier
 * @typedef {object} SimNodeConfig
 * @property {NodeOption<number>} [mass] - physical mass of the node
 * @property {NodeOption<number>} [radius] - physical (and rendered) radius of the node
 * @property {NodeOption<boolean>} [fixed] - whether the node is immovable
 */

/**
 * Fully populated config after merging with defaults.
 * @typedef {Required<SimNodeConfig>} ResolvedSimNodeConfig
 */

/**
 * Sim-node options collapsed into functions
 * @typedef {object} SimNodeAccessors
 * @property {NodeAccessor<number>} [mass] - function returning the physical
 *    mass of a node
 * @property {NodeAccessor<number>} [radius] - function returning the radius of
 *    a node
 * @property {NodeAccessor<boolean>} [fixed] - function returning whether a node
 *    is immovable
 */

/**
 * Fully populated config accessors
 * @typedef {Required<SimNodeAccessors>} ResolvedSimNodeAccessors
 */


/** @type {{ mass: number, radius: number, fixed: boolean }} */
const SIM_NODE_DEFAULTS = { mass: 1, radius: 20, fixed: false };

/**
 * @param {ResolvedSimNodeConfig} config
 * @returns {ResolvedSimNodeAccessors}
 */
const toAccessors = config => ({
  mass: asFn(config.mass),
  radius: asFn(config.radius),
  fixed: asFn(config.fixed),
});


/**
 * Simulates repulsion, springs, friction, gravity,
 * and collision resolution for an underlying `Graph` instance.
 */
export class Simulation {
  /** @type {Graph} */
  graph;

  /** @type {SimOpts} */
  opts;

  /**
   * Map of physical node body data, keyed by keys used in the underlying
   * `graph` (mirrors Map shape of `Graph.nodes`)
   * @type {Map<any, SimNode>}
   */
  nodes = new Map();

  /**
   * Temperature value that forces are multiplied by. Decays each tick
   * according to the rate of `opts.cooling`. Once it is lower than
   * `opts.freezePoint`, it is set to zero. Reset by the `heat()` function,
   * which is called after config or settings changes.
   */
  temp = 0;

  /**
   * Cached array of simulation nodes, recreated in effective `sync()` calls.
   * @type {SimNode[]}
   */
  _nodeList = [];

  /**
   * Cached map connecting node ids to indices in `_nodeList`. Recreated in
   * effective `sync()` calls.
   * @type {Map<any, number>}
   */
  _nodeIndex = new Map();

  /**
   * Cached flattened array of index pairs for applying spring forces.
   * Recreated in effective `sync()` calls.
   * Because it is used in force application, it does not contain
   * reverse-twin pairs, unlike `_edgePairs`.
   * @type {Int32Array}
   */
  _springs = new Int32Array(0);

  /**
   * Cached flattened array of index pairs for drawing edges. Recreated in
   * effective `sync()` calls. Used for drawing edges, so it can contain
   * reverse-twin pairs in digraphs (unlike `_springs`).
   * @type {Int32Array}
   */
  _edgePairs = new Int32Array(0);

  /**
   * Cached edge objects, parallel to `_edgePairs` by edge slot.
   * @type {GraphEdge[]}
   */
  _edgeRefs = [];

  /**
   * Node-specific config overrides.
   * Node props specified here get first priority over the simulation's current
   * default config and the global default config.
   * @type {Map<any, SimNodeAccessors>}
   */
  _overrides = new Map();

  /**
   * Current default node config. Takes precedence over the global default config,
   * but can be overridden for specific nodes in `_overrides`.
   * @type {ResolvedSimNodeConfig}
   */
  _defaultNodeConfig = {...SIM_NODE_DEFAULTS};

  /**
   * `_defaultNodeConfig` as cached functions. Used to apply the simulation's
   * default config when resolving a `SimNode`'s raw configuration.
   * @type {ResolvedSimNodeAccessors}
   */
  _accessors = toAccessors(SIM_NODE_DEFAULTS);

  /**
   * Set to `true` whenever any node config (default or override) is changed.
   * Set back to `false` once those changes are applied in `sync()`.
   * @type {boolean} */
  _configDirty = false;

  /**
   * Monotonic counter for *structural* changes to the node and edge tables.
   * Incremented in `sync()` only when graph shape changes.
   * Higher layers rebuild slot-indexed caches on it.
   * @type {number}
   */
  _version = 1;

  /**
   * Stores the latest synced `Graph` version. Used to gate node and edge
   * cache updates.
   * @type {number}
   */
  _syncedVersion = -1;

  /**
   * Stores the latest synced `Graph` *data* version. Used to efficiently
   * update physical node config based on underlying graph node payloads.
   * @type {number} */
  _syncedDataVersion = -1;


  /**
   * Initializes a `Simulation` instance.
   * @param {Graph} graph - `Graph` instance to simulate on top of
   * @param {SimOptsInput} [opts={}] - physics engine and node body options
   */
  constructor(graph, opts = {}) {
    this.graph = graph;

    this.opts = {
      friction:        opts.friction ?? 0.9,
      gravity:         opts.gravity ?? 0.002,
      repulsion:       opts.repulsion ?? 1000,
      springStiffness: opts.springStiffness ?? 0.15,
      springLength:    opts.springLength ?? 50,
      minDistSq:       opts.minDistSq ?? 100,
      maxSpeed:        opts.maxSpeed ?? 100,
      cooling:         opts.cooling ?? 0.98,
      freezePoint:     opts.freezePoint ?? 0.01,
    };

    this.setDefaultNodeConfig(opts.nodeConfig ?? {});
    this.sync();
  }


  /**
   * Sets properties of `opts` using a partial object.
   * @param {SimOptsInput} opts - options to set
   * @returns {this} self reference
   */
  setOpts({nodeConfig, ...opts} = {}) {
    Object.assign(this.opts, opts);
    if (nodeConfig) this.setDefaultNodeConfig(nodeConfig);
    this.heat();
    return this;
  }


  /**
   * Sets the simulation's temp value
   * @param {number} [t=1] - temperature to set
   * @returns {this} self reference
   */
  heat(t = 1) {
    if (t >= 0) this.temp = t;
    else this.temp = 0;
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
    this._accessors = toAccessors(this._defaultNodeConfig);
    this._configDirty = true;
    return this;
  }


  /**
   * Merges new config data into the current overrides of a specific node
   * @param {any} id - node id
   * @param {SimNodeConfig} [config] - sim-node config
   * @returns {this} self reference
   */
  setNodeConfig(id, config = {}) {
    /** @type {Record<string, any>} */
    const merged = { ...this._overrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._overrides.set(
      id,
      /** @type {SimNodeAccessors} */
      merged,
    );
    this._configDirty = true;
    return this;
  }


  /**
   * Clears all config overrides for a specific node
   * @param {any} id - node id
   * @returns {this} self reference
   */
  clearNodeConfig(id) {
    this._overrides.delete(id);
    this._configDirty = true;
    return this;
  }


  /**
   * Updates a sim-node's config based on its corresponding graph node.
   * @param {GraphNode} gNode - graph node
   * @param {SimNode} sNode - matching sim-node
   * @returns {boolean} whether resolved physical values changed
   */
  _resolve(gNode, sNode) {
    const acc = this._accessors,
          g = this.graph,
          o = this._overrides.get(gNode.id);
    const mass   = o?.mass?.(gNode, g)   ??  acc.mass(gNode, g);
    const radius = o?.radius?.(gNode, g) ??  acc.radius(gNode, g);

    const prevMass = sNode.mass, prevRadius = sNode.radius, prevFixed = sNode.fixed;

    sNode.mass   = Number.isFinite(mass)   ?
      Math.max(mass, 1e-6) : SIM_NODE_DEFAULTS.mass;
    sNode.radius = Number.isFinite(radius) ?
      Math.max(radius, 0)  : SIM_NODE_DEFAULTS.radius;
    sNode.fixed  = (o?.fixed?.(gNode, g) ??  acc.fixed(gNode, g)) === true;

    return sNode.mass !== prevMass || sNode.radius !== prevRadius || sNode.fixed !== prevFixed;
  }


  /**
   * Creates a sim-node object based on the given graph node
   * @param {GraphNode} gNode - graph node to seed sim-node from
   * @returns {SimNode} resulting sim-node
   */
  _seedNode(gNode) {
    const pos = this._seedPos(gNode);
    const sNode = {
      id: gNode.id,
      ...SIM_NODE_DEFAULTS,
      ...pos,
      fx: 0, fy: 0,
    };
    this._resolve(gNode, sNode);
    return sNode;
  }


  /**
   * Seeds a sim-node's position based on the simulated positions of its graph
   * neighbors. With no graph neighbors, it defaults to a random position
   * within +/-75 of the origin
   * @param {GraphNode} gNode - graph node
   * @returns {{ x: number, y: number, vx: number, vy: number }} - initial
   *    position and velocity of sim-node
   */
  _seedPos(gNode) {
    const neighbors = this.graph.adjacency.get(gNode.id);
    let sx = 0, sy = 0, n = 0;
    if (neighbors) for (const id of neighbors.keys()) {
      const sNode = this.nodes.get(id);
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
   * Also resolves node configs to apply new overrides or defaults.
   * Gates on config changes, graph data changes, and graph shape changes.
   * @returns {boolean} whether graph shape or node configs were updated
   */
  sync() {
    if (this._syncedDataVersion !== this.graph._dataVersion) {
      this._configDirty = true;
      this._syncedDataVersion = this.graph._dataVersion;
    }
    if (this._syncedVersion === this.graph._version && !this._configDirty)
      return false;

    // Update and add nodes
    let changed = false;
    for (const [id, gNode] of this.graph.nodes) {
      const sNode = this.nodes.get(id);
      if (sNode) changed = this._resolve(gNode, sNode) || changed;
      else { this.nodes.set(id, this._seedNode(gNode)); changed = true; }
    }
    this._configDirty = false;
    if (changed) this.heat();

    if (this._syncedVersion === this.graph._version) return true;

    this.heat(); // Structural change

    // Delete old nodes
    for (const id of this.nodes.keys()) {
      if (!this.graph.nodes.has(id)) {
        this.nodes.delete(id);
        this._overrides.delete(id);
      }
    }

    this._nodeList = [];
    this._nodeIndex = new Map();
    for (const [id, sNode] of this.nodes) {
      this._nodeIndex.set(id, this._nodeList.length);
      this._nodeList.push(sNode);
    }

    const pairs = [], springs = [], refs = [], n = this.nodes.size;
    const seen = this.graph.directed ? new Set() : null;

    for (const edge of this.graph.edges) {
      const i = this._nodeIndex.get(edge.src.id);
      const j = this._nodeIndex.get(edge.dest.id);
      if (i === undefined || j === undefined) continue;
      pairs.push(i, j);
      refs.push(edge);
      if (i === j) continue;
      if (seen) {
        const key = i < j ? i * n + j : j * n + i;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      springs.push(i, j);
    }

    this._edgeRefs = refs;
    this._edgePairs = Int32Array.from(pairs);
    this._springs   = this.graph.directed ?
      Int32Array.from(springs) :
      this._edgePairs;

    this._syncedVersion = this.graph._version;
    this._version++;

    return true;
  }


  /**
   * Applies repulsive forces with O(n^2) pairwise force accumulation.
   * Uses Coulomb's law, without any charge parameters.
   * @returns {void}
   */
  _apply_repulsion() {
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
        dSq = Math.max(dSq, this.opts.minDistSq); // short-range clamp

        const s = this.opts.repulsion / (dSq * Math.sqrt(dSq));
        const fx = s * dx, fy = s * dy;
        n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
      }
    }
  }


  /**
   * Applies spring forces between nodes connected by edges.
   * @returns {void}
   */
  _apply_springs() {
    const list = this._nodeList;
    const springs = this._springs;
    for (let i = 0; i < springs.length; i += 2) {
      const n1 = list[springs[i]], n2 = list[springs[i + 1]];
      const dx = n1.x - n2.x, dy = n1.y - n2.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const s = -this.opts.springStiffness * (d - this.opts.springLength) / d;
      const fx = s * dx, fy = s * dy;
      n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
    }
  }


  /**
   * Applies graviational acceleration towards the origin
   * @returns {void}
   */
  _apply_gravity() {
    const list = this._nodeList;
    const g = this.opts.gravity;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      n.fx -= g * n.x;
      n.fy -= g * n.y;
    }
  }

  /**
   * Pushes intersecting nodes apart.
   * @returns {void}
   */
  _enforce_radius() {
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

  
  /**
   * Simulates the graph's physics for one tick, after syncing graph shape and
   * sim-node config.
   * @param {number} [dt=1] - time step, scaling both velocity and position
   *    updates. Tuned for dt=1. Friction applies once per tick.
   * @returns {this} self reference
   */
  tick(dt = 1) {
    this.sync();

    // reset force totals
    const list = this._nodeList;
    for (let i = 0; i < list.length; i++) { list[i].fx = 0; list[i].fy = 0; }

    if (!this.temp) return this;

    this._apply_repulsion();
    this._apply_springs();
    this._apply_gravity();

    const maxV = this.opts.maxSpeed;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.fixed) { r.vx = 0; r.vy = 0; continue; }
      r.vx = (r.vx + (r.fx / r.mass) * dt * this.temp) * this.opts.friction;
      r.vy = (r.vy + (r.fy / r.mass) * dt * this.temp) * this.opts.friction;
      
      // Limit speed
      const v = Math.hypot(r.vx, r.vy);
      if (v > maxV) { r.vx *= maxV / v; r.vy *= maxV / v; }

      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }

    this.temp *= this.opts.cooling;
    if (this.temp < this.opts.freezePoint) {
      this.temp = 0;
      // Drop residual velocities
      for (let i = 0; i < list.length; i++) { list[i].vx = 0; list[i].vy = 0; }
    }

    // Enforce radius
    this._enforce_radius();
    return this;
  }


  /**
   * Gets the simulation coordinates of a node by id.
   * @param {any} id - node id
   * @returns {[number, number] | null} the node's simulation coordinates, or
   *    `null` if it was not found
   */
  getPosition(id) {
    const node = this.nodes.get(id);
    if (node) return [node.x, node.y];
    return null;
  }


  /**
   * Finds a node by id and pins it to specified coordinates in simulation space.
   * @param {any} id - node id
   * @param {number} x - simulation x coordinate to pin to
   * @param {number} y - simulation y coordinate
   * @returns {boolean} whether the node was pinned (`false` if node not found)
   */
  pin(id, x, y) {
    const node = this.nodes.get(id);
    if (!node) return false;
    this.setNodeConfig(id, { fixed: true });
    if (node.x !== x || node.y !== y) this.heat();
    [node.x, node.y] = [x, y];
    return true;
  }


  /**
   * Unpins a node by id by reverting `fixed` to its default.
   * @param {any} id - node id
   * @returns {this} self reference
   */
  unpin(id) { this.setNodeConfig(id, { fixed: undefined }); return this; }
}
