/** @import {NodeId, NodeData, GraphNode, GraphEdge, EdgeDirection, GraphEventMap, GraphEventType} from './typedefs/graph.js' */

import { Emitter } from "./emitter.js";
import { keysOf, isPlainObject } from "./utils.js";


/**
 * Every graph event name. The type requires exactly the keys of
 * `GraphEventMap`, so adding an event there without adding it here fails
 * type checking.
 * @type {Record<GraphEventType, true>}
 */
const GRAPH_EVENT_NAMES = {
  nodeadd: true, noderemove: true, nodedatachange: true,
  edgeadd: true, edgeremove: true, edgedatachange: true,
};
const GRAPH_EVENT_TYPES = keysOf(GRAPH_EVENT_NAMES);


/**
 * Every edge direction. The type requires exactly the members of
 * `EdgeDirection`.
 * @type {Record<EdgeDirection, true>}
 */
const EDGE_DIRECTIONS = { out: true, in: true, both: true };


/**
 * Represents the shape of a directed or undirected graph and stores custom data for nodes and edges.
 * Emits the events in `GraphEventMap`, through `on()` and `off()`, once each
 * change is complete.
 * @extends {Emitter<GraphEventMap, Graph>}
 */
export class Graph extends Emitter {
  /** @private @type {Map<NodeId, GraphNode>} */
  _nodes = new Map();
  /**
   * [read-only]
   * Map of nodes, keyed by id.
   * @returns {ReadonlyMap<NodeId, GraphNode>}
   */
  get nodes() { return this._nodes; }


  /** @private @type {Set<GraphEdge>} */
  _edges = new Set();
  /**
   * [read-only]
   * All edges of the graph, each appearing exactly once.
   * Keyed by Edge object (go through `adjacency` or `getEdge`)
   * @returns {ReadonlySet<GraphEdge>}
   */
  get edges() { return this._edges; }


  /** @private @type {Map<NodeId, Map<NodeId, GraphEdge>>} */
  _adjacency = new Map();
  /**
   * [read-only]
   * Nested lookup map (`srcId -> destId -> Edge`).
   * Symmetric in an undirected graph: both directions reference the *same* Edge object.
   * In a directed graph it lists outgoing edges only; use `neighbors()` or
   * `edgesOf()` for incoming ones.
   * @returns {ReadonlyMap<NodeId, ReadonlyMap<NodeId, GraphEdge>>}
   */
  get adjacency() { return this._adjacency; }


  /**
   * Reverse lookup map (`destId -> srcId -> Edge`), for incoming edges in a
   * directed graph. Null in an undirected graph, where `_adjacency` already
   * lists every edge from both ends.
   * @private @type {Map<NodeId, Map<NodeId, GraphEdge>> | null}
   */
  _inAdjacency = null;


  /** @private @type {boolean} */
  _directed = false;
  /**
   * [read-only constant] Boolean indicating whether the graph is directed or
   * undirected.
   */
  get directed() { return this._directed; }


  /** @private @type {number} */
  _version = 1;
  /**
   * [read-only]
   * Monotonic counter for *structural* change: bumped whenever a node or edge
   * is added or removed (not on no-ops).
   *
   * Higher layers gate cache rebuilds on this. Anything keyed by a node's or
   * edge's position (slot arrays, index maps, edge pair lists) is invalid once
   * it changes.
   *
   * Compare for inequality only; never assume a step of 1.
   */
  get version() { return this._version; }

  /** @private @type {number} */
  _dataVersion = 1;
  /**
   * Monotonic counter for *payload* change: bumped only by `setNodeData` and
   * `setEdgeData` (and the `update` methods, which call them). Structural
   * mutations leave it untouched.
   *
   * Higher layers use it to re-resolve values derived from node or edge `data`
   * — accessor-driven simulation config and render styles — without rebuilding
   * slot-indexed caches.
   *
   * Compare for inequality only.
   */
  get dataVersion() { return this._dataVersion; }


  /**
   * Initialize a `Graph` instance.
   * @param {object} [opts={}] - options object
   * @param {boolean} [opts.directed] - whether the graph is directed or undirected
   */
  constructor(opts = {}) {
    super(GRAPH_EVENT_TYPES, "Graph");
    this._directed = opts.directed ?? false;
    if (this._directed) this._inAdjacency = new Map();
  }



  // NODES

  /**
   * Adds a node to the graph if the id is not already in use.
   * If an id is not specified in the data object or id field, addNode will generate an id automatically using crypto.randomUUID().
   * If the id is already in use, no node is added and the existing id is returned.
   * Emits `nodeadd` when a node is added.
   * @param {NodeData} [data] - custom data to associate with the node
   * @param {NodeId} [id] - id of the new node; defaults to `data.id`, then a random UUID
   * @returns {NodeId} id of the node
   */
  addNode(data = {}, id = data.id ?? crypto.randomUUID()) {
    if (this._nodes.has(id)) return id;
    const node = { id, data };
    this._nodes.set(id, node);
    this._adjacency.set(id, new Map());
    this._inAdjacency?.set(id, new Map());
    this._version++;
    if (this._hasListeners("nodeadd")) this._emit("nodeadd", { id, node });
    return id;
  }


  /**
   * Removes a node from the graph by id and deletes all connected edges. Returns false if the node does not exist.
   * Emits `edgeremove` for each of its edges, then `noderemove`.
   * @param {NodeId} id - id of target node
   * @returns {boolean} success of the removal
   */
  removeNode(id) {
    const adj = this._adjacency.get(id);
    if (!adj) return false;
    for (const destId of adj.keys()) this.removeEdge(id, destId);
    // Missing if an edgeremove listener above removed this node
    const inAdj = this._inAdjacency?.get(id);
    if (inAdj) for (const srcId of inAdj.keys()) this.removeEdge(srcId, id);
    // An edgeremove listener may have removed this node already
    if (this._adjacency.get(id) !== adj) return true;
    const node = /** @type {GraphNode} */ (this._nodes.get(id));
    this._adjacency.delete(id);
    this._inAdjacency?.delete(id);
    this._nodes.delete(id);
    this._version++;
    if (this._hasListeners("noderemove")) this._emit("noderemove", { id, node });
    return true;
  }


  /**
   * Checks if the graph contains a node with a particular id.
   * @param {NodeId} id - id of the node
   * @returns {boolean} whether the graph contains the node
   */
  hasNode(id) { return this._nodes.has(id); }


  /**
   * Get a node by id.
   * @param {NodeId} id - id of the node
   * @returns {GraphNode | undefined} corresponding node, or undefined if not found
   */
  getNode(id) { return this._nodes.get(id); }


  /**
   * Sets the custom data of a node by id. Emits `nodedatachange`.
   * @param {NodeId} id - id of target node
   * @param {any} data - data to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if given id matches no existing node
   */
  setNodeData(id, data) {
    const node = this._nodes.get(id);
    if (!node) throw new ReferenceError(`Graph: no node with id "${id}"`);
    const prev = node.data;
    node.data = data;
    this._dataVersion++;
    if (this._hasListeners("nodedatachange")) this._emit("nodedatachange", { id, node, prev });
    return this;
  }


  /**
   * Shallowly merges fields into the custom data of a node, through
   * `setNodeData()`: the node gets a new data object, and the previous one is
   * left unchanged. Emits `nodedatachange`.
   * @param {NodeId} id - id of target node
   * @param {Record<string, any>} patch - fields to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if given id matches no existing node
   * @throws {TypeError} thrown if `patch` or the node's current data isn't a
   *    plain object
   */
  updateNodeData(id, patch) {
    const node = this._nodes.get(id);
    if (!node) throw new ReferenceError(`Graph: no node with id "${id}"`);
    checkMerge(patch, node.data, `node "${id}"`);
    return this.setNodeData(id, { ...node.data, ...patch });
  }



  // EDGES

  /**
   * Adds an edge to the graph based on two node ids (order does not matter in an undirected graph).
   * Emits `edgeadd` when an edge is added.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {any} [data={}] - custom data to associate with the edge
   * @returns {boolean} whether the edge was successfully added
   * @throws {ReferenceError} thrown if either id matches no existing node
   */
  addEdge(srcId, destId, data = {}) {
    const src = this._nodes.get(srcId);
    const dest = this._nodes.get(destId);
    if (!src) throw new ReferenceError(`Graph: no source node with id "${srcId}"`);
    if (!dest) throw new ReferenceError(`Graph: no destination node with id "${destId}"`);
    if (this._adjacency.get(srcId)?.get(destId)) return false;
    const edge = { src, dest, data };
    this._edges.add(edge);
    this._adjacency.get(srcId)?.set(destId, edge);
    if (this._inAdjacency) this._inAdjacency.get(destId)?.set(srcId, edge);
    else this._adjacency.get(destId)?.set(srcId, edge);
    this._version++;
    if (this._hasListeners("edgeadd")) this._emit("edgeadd", { srcId, destId, edge });
    return true;
  }


  /**
   * Removes an edge from the graph based on two node ids (order does not matter in an undirected graph).
   * Unknown node ids are treated as "no such edge" and return false (no throws).
   * Emits `edgeremove` when an edge is removed.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {boolean} whether the edge was successfully removed
   */
  removeEdge(srcId, destId) {
    const edge = this._adjacency.get(srcId)?.get(destId);
    if (!edge) return false;
    this._edges.delete(edge);
    this._adjacency.get(srcId)?.delete(destId);
    if (this._inAdjacency) this._inAdjacency.get(destId)?.delete(srcId);
    else this._adjacency.get(destId)?.delete(srcId);
    this._version++;
    // The stored ids, so an undirected edge reports the same pair both ways
    if (this._hasListeners("edgeremove")) this._emit("edgeremove", { srcId: edge.src.id, destId: edge.dest.id, edge });
    return true;
  }


  /**
   * Checks if the graph contains an edge with particular source and destination ids (order does not matter in an undirected graph).
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {boolean} whether the graph contains the edge
   */
  hasEdge(srcId, destId) { return this._adjacency.get(srcId)?.has(destId) ?? false; }


  /**
   * Get an edge based on two node ids (order does not matter in an undirected graph).
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @returns {GraphEdge | undefined} corresponding edge, or undefined if not found
   */
  getEdge(srcId, destId) { return this._adjacency.get(srcId)?.get(destId); }


  /**
   * Sets the custom data field of an edge, selected by node ids. Emits
   * `edgedatachange`.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {any} data - custom data to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if no edge exists between the given nodes
   */
  setEdgeData(srcId, destId, data) {
    const edge = this._adjacency.get(srcId)?.get(destId);
    if (!edge) throw new ReferenceError(`Graph: no edge from "${srcId}" to "${destId}"`);
    const prev = edge.data;
    edge.data = data;
    this._dataVersion++;
    if (this._hasListeners("edgedatachange")) this._emit("edgedatachange", { srcId: edge.src.id, destId: edge.dest.id, edge, prev });
    return this;
  }


  /**
   * Shallowly merges fields into the custom data of an edge, through
   * `setEdgeData()`: the edge gets a new data object, and the previous one is
   * left unchanged. Emits `edgedatachange`.
   * @param {NodeId} srcId - source node id
   * @param {NodeId} destId - destination node id
   * @param {Record<string, any>} patch - fields to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if no edge exists between the given nodes
   * @throws {TypeError} thrown if `patch` or the edge's current data isn't a
   *    plain object
   */
  updateEdgeData(srcId, destId, patch) {
    const edge = this._adjacency.get(srcId)?.get(destId);
    if (!edge) throw new ReferenceError(`Graph: no edge from "${srcId}" to "${destId}"`);
    checkMerge(patch, edge.data, `edge from "${srcId}" to "${destId}"`);
    return this.setEdgeData(srcId, destId, { ...edge.data, ...patch });
  }



  // NEIGHBORHOODS
  // Unknown ids read as nodes with no edges: degrees are 0 and lists are empty.

  /**
   * Returns the number of edges touching a node, or 0 if the node is not
   * found. In a directed graph, this is `inDegree() + outDegree()`, so a
   * self-loop counts twice, once in each direction. In an undirected graph, a
   * self-loop counts once.
   * @param {NodeId} id - id of the node
   * @returns {number} degree of the node
   */
  degree(id) { return this.outDegree(id) + (this._inAdjacency ? this.inDegree(id) : 0); }


  /**
   * Returns the number of edges leaving a node, or 0 if the node is not
   * found. In an undirected graph, the same as `degree()` and `inDegree()`.
   * @param {NodeId} id - id of the node
   * @returns {number} out-degree of the node
   */
  outDegree(id) { return this._adjacency.get(id)?.size ?? 0; }


  /**
   * Returns the number of edges entering a node, or 0 if the node is not
   * found. In an undirected graph, the same as `degree()` and `outDegree()`.
   * @param {NodeId} id - id of the node
   * @returns {number} in-degree of the node
   */
  inDegree(id) { return (this._inAdjacency ?? this._adjacency).get(id)?.size ?? 0; }


  /**
   * Lists the ids of the nodes a node shares an edge with, each once. A node
   * with a self-loop is its own neighbor.
   *
   * In a directed graph, `dir` picks which edges count: `"out"` for the nodes
   * it points to, `"in"` for the nodes pointing to it, or `"both"`. In an
   * undirected graph every edge goes both ways, so `dir` makes no difference.
   * @param {NodeId} id - id of the node
   * @param {EdgeDirection} [dir="both"] - which edges to follow
   * @returns {NodeId[]} ids of the neighboring nodes, in a new array; empty
   *    if the node is not found
   * @throws {RangeError} thrown if `dir` isn't `"out"`, `"in"` or `"both"`
   */
  neighbors(id, dir = "both") {
    const [first, second] = this._sides(id, dir);
    if (!first) return [];
    if (!second) return [...first.keys()];
    return [...new Set([...first.keys(), ...second.keys()])];
  }


  /**
   * Lists the edges touching a node, each once, including any self-loop.
   *
   * In a directed graph, `dir` picks which edges count: `"out"` for edges
   * leaving it, `"in"` for edges entering it, or `"both"`. In an undirected
   * graph every edge goes both ways, so `dir` makes no difference.
   * @param {NodeId} id - id of the node
   * @param {EdgeDirection} [dir="both"] - which edges to list
   * @returns {GraphEdge[]} the edges, in a new array; empty if the node is not
   *    found
   * @throws {RangeError} thrown if `dir` isn't `"out"`, `"in"` or `"both"`
   */
  edgesOf(id, dir = "both") {
    const [first, second] = this._sides(id, dir);
    if (!first) return [];
    const edges = [...first.values()];
    // A self-loop is in both maps; it was listed with the outgoing edges
    if (second) for (const [srcId, edge] of second) if (srcId !== id) edges.push(edge);
    return edges;
  }


  /**
   * The adjacency maps to read for a node's edges in a direction: one map, or
   * outgoing then incoming for `"both"` in a directed graph. Empty if the node
   * is not found.
   * @private
   * @param {NodeId} id - id of the node
   * @param {EdgeDirection} dir - which edges to read
   * @returns {Map<NodeId, GraphEdge>[]} the maps to read
   * @throws {RangeError} thrown if `dir` isn't a direction
   */
  _sides(id, dir) {
    if (!Object.hasOwn(EDGE_DIRECTIONS, dir)) {
      throw new RangeError(`Graph: direction must be "out", "in" or "both", not "${dir}"`);
    }
    const out = this._adjacency.get(id);
    if (!out) return [];
    if (dir === "out" || !this._inAdjacency) return [out];
    const inc = /** @type {Map<NodeId, GraphEdge>} */ (this._inAdjacency.get(id));
    return dir === "in" ? [inc] : [out, inc];
  }



  // WHOLE GRAPH

  /**
   * Removes every node and edge, through `removeNode()`, so each removal emits
   * its usual events. Nodes added by listeners while it runs are kept.
   * @returns {this} self reference
   */
  clear() {
    for (const id of [...this._nodes.keys()]) this.removeNode(id);
    return this;
  }
}


/**
 * Throws if a data merge can't be done safely: `patch` and the current data
 * must both be plain objects, so spreading them doesn't drop a prototype or
 * turn a string or array into numbered fields.
 * @param {unknown} patch - fields to merge in
 * @param {unknown} data - current data
 * @param {string} target - what owns the data, for the message
 * @returns {void}
 * @throws {TypeError} thrown if either isn't a plain object
 */
function checkMerge(patch, data, target) {
  if (!isPlainObject(patch)) throw new TypeError(`Graph: the patch for ${target} must be a plain object`);
  if (!isPlainObject(data)) throw new TypeError(`Graph: the data of ${target} isn't a plain object, so it can't be merged into; use a set method instead`);
}
