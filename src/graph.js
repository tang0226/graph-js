export class Graph {
  constructor(opts = {}) {
    this.nodes = new Map();
    this.edges = new Set();
    this.adjacency = new Map();
    Object.defineProperty(this, "directed", { value: opts.directed ?? false, writable: false, enumerable: true });
    this._version = 1;
    this._dataVersion = 1;
  }

  degree(id) { return this.adjacency.get(id)?.size ?? 0; }

  addNode(data = {}, id = data.id || crypto.randomUUID()) {
    if (this.nodes.has(id)) return id;
    this.nodes.set(id, { id, data });
    this.adjacency.set(id, new Map());
    this._version++;
    return id;
  }

  removeNode(id) {
    const adj = this.adjacency.get(id);
    if (!adj) return false;
    for (const destId of adj.keys()) this.removeEdge(id, destId);
    if (this.directed) for (const [srcId, srcMap] of this.adjacency.entries()) {
      if (srcMap.has(id)) this.removeEdge(srcId, id);
    }
    this.adjacency.delete(id);
    this.nodes.delete(id);
    this._version++;
    return true;
  }

  setNodeData(id, data) {
    const node = this.nodes.get(id);
    if (!node) throw new ReferenceError(`Cannot find node with id "${id}"`);
    node.data = data;
    this._dataVersion++;
  }

  addEdge(srcId, destId, data = {}) {
    const src = this.nodes.get(srcId);
    const dest = this.nodes.get(destId);
    if (!src) throw new ReferenceError(`Cannot find source node with id "${srcId}"`);
    if (!dest) throw new ReferenceError(`Cannot find destination node with id "${destId}"`);
    if (this.adjacency.get(srcId).get(destId)) return false;
    const edge = { src, dest, data };
    this.edges.add(edge);
    this.adjacency.get(srcId).set(destId, edge);
    if (!this.directed) this.adjacency.get(destId).set(srcId, edge);
    this._version++;
    return true;
  }

  removeEdge(srcId, destId) {
    const edge = this.adjacency.get(srcId)?.get(destId);
    if (!edge) return false;
    this.edges.delete(edge);
    this.adjacency.get(srcId)?.delete(destId);
    if (!this.directed) this.adjacency.get(destId)?.delete(srcId);
    this._version++;
    return true;
  }

  getEdge(srcId, destId) { return this.adjacency.get(srcId)?.get(destId); }
  hasEdge(srcId, destId) { return this.adjacency.get(srcId)?.has(destId) ?? false; }

  setEdgeData(srcId, destId, data) {
    const edge = this.adjacency.get(srcId)?.get(destId);
    if (!edge) throw new ReferenceError(`Cannot find edge with srcId "${srcId}" and destId "${destId}"`);
    edge.data = data;
    this._dataVersion++;
  }
}