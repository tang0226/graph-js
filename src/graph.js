/** @import {NodeData, GraphNode, GraphEdge} from './typedefs.js' */

/**
 * Represents the shape of a directed or undirected graph and stores custom data for nodes and edges.
 */
export class Graph {
  /** @type {Map<any, GraphNode>} */
  _nodes = new Map();
  /**
   * [read-only]
   * Map of nodes, keyed by id.
   * @returns {ReadonlyMap<any, GraphNode>}
   */
  get nodes() { return this._nodes; }


  /** @type {Set<GraphEdge>} */
  _edges = new Set();
  /**
   * [read-only]
   * All edges of the graph, each appearing exactly once.
   * Keyed by Edge object (go through `adjacency` or `getEdge`)
   * @returns {ReadonlySet<GraphEdge>}
   */
  get edges() { return this._edges; }


  /** @type {Map<any, Map<any, GraphEdge>>} */
  _adjacency = new Map();
  /**
   * [read-only]
   * Nested lookup map (`srcId -> destId -> Edge`).
   * Symmetric in an undirected graph: both directions reference the *same* Edge object.
   * @returns {ReadonlyMap<any, ReadonlyMap<any, GraphEdge>>}
   */
  get adjacency() { return this._adjacency; }


  /** @type {boolean} */
  _directed = false;
  /**
   * [read-only constant] Boolean indicating whether the graph is directed or
   * undirected.
   */
  get directed() { return this._directed; }


  /** @type {number} */
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

  /** @type {number} */
  _dataVersion = 1;
  /**
   * Monotonic counter for *payload* change: bumped only by `setNodeData` and
   * `setEdgeData`. Structural mutations leave it untouched.
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
    this._directed = opts.directed ?? false;
  }


  /**
   * Returns the degree (out-degree in a digraph) of a node based on node id, or 0 if the node is not found.
   * @param {any} id - id of the node
   * @returns {number} degree (out-degree in a digraph) of the corresponding node, or 0 if the node was not found
   */
  degree(id) { return this._adjacency.get(id)?.size ?? 0; }


  /**
   * Adds a node to the graph if the id is not already in use.
   * If an id is not specified in the data object or id field, addNode will generate an id automatically using crypto.randomUUID().
   * If the id is already in use, no node is added and the existing id is returned.
   * @param {NodeData} [data] - custom data to associate with the node
   * @param {any} [id] - id of the new node; defaults to `data.id`, then a random UUID
   * @returns {any} id of the node
   */
  addNode(data = {}, id = data.id ?? crypto.randomUUID()) {
    if (this._nodes.has(id)) return id;
    this._nodes.set(id, { id, data });
    this._adjacency.set(id, new Map());
    this._version++;
    return id;
  }


  /**
   * Removes a node from the graph by id and deletes all connected edges. Returns false if the node does not exist.
   * @param {any} id - id of target node
   * @returns {boolean} success of the removal
   */
  removeNode(id) {
    const adj = this._adjacency.get(id);
    if (!adj) return false;
    for (const destId of adj.keys()) this.removeEdge(id, destId);
    if (this._directed) for (const [srcId, srcMap] of this._adjacency.entries()) {
      if (srcMap.has(id)) this.removeEdge(srcId, id);
    }
    this._adjacency.delete(id);
    this._nodes.delete(id);
    this._version++;
    return true;
  }


  /**
   * Sets the custom data of a node by id.
   * @param {any} id - id of target node
   * @param {any} data - data to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if given id matches no existing node
   */
  setNodeData(id, data) {
    const node = this._nodes.get(id);
    if (!node) throw new ReferenceError(`Cannot find node with id "${id}"`);
    node.data = data;
    this._dataVersion++;
    return this;
  }


  /**
   * Adds an edge to the graph based on two node ids (order does not matter in an undirected graph).
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @param {any} [data={}] - custom data to associate with the edge
   * @returns {boolean} whether the edge was successfully added
   * @throws {ReferenceError} thrown if either id matches no existing node
   */
  addEdge(srcId, destId, data = {}) {
    const src = this._nodes.get(srcId);
    const dest = this._nodes.get(destId);
    if (!src) throw new ReferenceError(`Cannot find source node with id "${srcId}"`);
    if (!dest) throw new ReferenceError(`Cannot find destination node with id "${destId}"`);
    if (this._adjacency.get(srcId)?.get(destId)) return false;
    const edge = { src, dest, data };
    this._edges.add(edge);
    this._adjacency.get(srcId)?.set(destId, edge);
    if (!this._directed) this._adjacency.get(destId)?.set(srcId, edge);
    this._version++;
    return true;
  }


  /**
   * Removes an edge from the graph based on two node ids (order does not matter in an undirected graph).
   * Unknown node ids are treated as "no such edge" and return false (no throws).
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @returns {boolean} whether the edge was successfully removed
   */
  removeEdge(srcId, destId) {
    const edge = this._adjacency.get(srcId)?.get(destId);
    if (!edge) return false;
    this._edges.delete(edge);
    this._adjacency.get(srcId)?.delete(destId);
    if (!this._directed) this._adjacency.get(destId)?.delete(srcId);
    this._version++;
    return true;
  }


  /**
   * Get an edge based on two node ids (order does not matter in an undirected graph).
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @returns {GraphEdge|undefined} corresponding edge, or undefined if not found
   */
  getEdge(srcId, destId) { return this._adjacency.get(srcId)?.get(destId); }


  /**
   * Checks if the graph contains an edge with particular source and destination ids (order does not matter in an undirected graph).
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @returns {boolean} whether the graph contains the edge
   */
  hasEdge(srcId, destId) { return this._adjacency.get(srcId)?.has(destId) ?? false; }


  /**
   * Sets the custom data field of an edge, selected by node ids.
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @param {any} data - custom data to set
   * @returns {this} self reference
   * @throws {ReferenceError} thrown if no edge exists between the given nodes
   */
  setEdgeData(srcId, destId, data) {
    const edge = this._adjacency.get(srcId)?.get(destId);
    if (!edge) throw new ReferenceError(`Cannot find edge with srcId "${srcId}" and destId "${destId}"`);
    edge.data = data;
    this._dataVersion++;
    return this;
  }
}