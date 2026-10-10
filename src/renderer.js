import { Simulation } from "./simulation.js";
import { asFn, circleRectCollision } from "./utils.js";

const NODE_RENDER_DEFAULTS = {
  color: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 0,
  image: false,
};

const EDGE_RENDER_DEFAULTS = {
  color: "#000000",
  width: 1,
};

export class Renderer {
  constructor(simulation, canvas, opts = {}) {
    if (!(simulation instanceof Simulation)) throw new TypeError("simulation argument is not a Simulation instance");
    this.simulation = simulation;
    this.graph = simulation.graph;

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.opts = {
      background: opts.background ?? "#ffffff",
    };

    this.view = { x: 0, y: 0, zoom: 1 };

    this.nodes = new Map();
    this.edges = new Map();
    this._nodeOverrides = new Map();
    this._edgeOverrides = new Map();

    this.setDefaultNodeConfig(opts.nodeConfig ?? {});
    this.setDefaultEdgeConfig(opts.edgeConfig ?? {});
    

    // sync with simulation
    this._syncedSimulation = -1;
    this._syncedDataVersion = -1
    this._version = 1;
    this.sync();
  }

  // Style management functions
  setDefaultNodeConfig(config = {}) {
    this._defaultNodeConfig = { ...NODE_RENDER_DEFAULTS, ...this._defaultNodeConfig, ...config };
    this._nodeAccessors = {
      color: asFn(this._defaultNodeConfig.color),
      outlineColor: asFn(this._defaultNodeConfig.outlineColor),
      outlineWidth: asFn(this._defaultNodeConfig.outlineWidth),
      image: asFn(this._defaultNodeConfig.image),
    };
    this._stylesDirty = true;
  }

  setNodeConfig(id, config = {}) {
    const merged = { ...this._nodeOverrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._nodeOverrides.set(id, merged);
    this._stylesDirty = true;
  }

  clearNodeConfig(id) {
    this._nodeOverrides.delete(id);
    this._stylesDirty = true;
  }

  setDefaultEdgeConfig(config = {}) {
    this._defaultEdgeConfig = { ...EDGE_RENDER_DEFAULTS, ...this._defaultEdgeConfig, ...config };
    this._edgeAccessors = {
      color: asFn(this._defaultEdgeConfig.color),
      width: asFn(this._defaultEdgeConfig.width),
    };
    this._stylesDirty = true;
  }

  setEdgeConfig(gEdge, config = {}) {
    const merged = { ...this._edgeOverrides.get(gEdge), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._edgeOverrides.set(gEdge, merged);
    this._stylesDirty = true;
  }

  clearEdgeConfig(gEdge) {
    this._edgeOverrides.delete(gEdge);
    this._stylesDirty = true;
  }

  // Update render-node config based on graph node
  _resolveNode(gNode, rNode) {
    const acc = this._nodeAccessors, g = this.graph, o = this._nodeOverrides.get(gNode.id);
    rNode.color = o?.color?.(gNode, g) ?? acc.color(gNode, g);
    rNode.outlineColor = o?.outlineColor?.(gNode, g) ?? acc.outlineColor(gNode, g);
    rNode.outlineWidth = o?.outlineWidth?.(gNode, g) ?? acc.outlineWidth(gNode, g);
    rNode.image = o?.image?.(gNode, g) ?? acc.image(gNode, g);
  }

  // Update rendered edge config based on graph edge
  _resolveEdge(gEdge, rEdge) {
    const acc = this._edgeAccessors, g = this.graph, o = this._edgeOverrides.get(gEdge);
    rEdge.color = o?.color?.(gEdge, g) ?? acc.color(gEdge, g);
    rEdge.width = o?.width?.(gEdge, g) ?? acc.width(gEdge, g);
  }

  // Create a node based on a new graph node
  _seedNode(gNode) {
    const rNode = {
      id: gNode.id,
      ...NODE_RENDER_DEFAULTS
    };
    this._resolveNode(gNode, rNode);
    return rNode;
  }

  _seedEdge(gEdge) {
    const rEdge = {...EDGE_RENDER_DEFAULTS};
    this._resolveEdge(gEdge, rEdge);
    return rEdge;
  }

  simToCanvas(x, y) {
    const v = this.view;
    return [this.canvas.width / 2 + (x - v.x) * v.zoom, this.canvas.height / 2 + (y - v.y) * v.zoom];
  }

  canvasToSim(x, y) {
    const v = this.view;
    return [(x - this.canvas.width / 2) / v.zoom + v.x, (y - this.canvas.height / 2) / v.zoom + v.y];
  }

  // Update 
  sync() {
    if (this._syncedDataVersion !== this.graph._dataVersion) {
      this._stylesDirty = true;
      this._syncedDataVersion = this.graph._dataVersion;
    }

    if (this._syncedSimulation === this.simulation._version && !this._stylesDirty) return false;
    
    // Update node styles and seed new ones
    for (const [id, gNode] of this.graph.nodes) {
      const rNode = this.nodes.get(id);
      if (rNode) this._resolveNode(gNode, rNode);
      else this.nodes.set(id, this._seedNode(gNode));
    }

    // Update edge styles and seed new ones
    for (const gEdge of this.graph.edges) {
      const rEdge = this.edges.get(gEdge);
      if (rEdge) this._resolveEdge(gEdge, rEdge);
      else this.edges.set(gEdge, this._seedEdge(gEdge));
    }

    this._stylesDirty = false;

    if (this._syncedSimulation === this.simulation._version) return true;
    
    // Delete old node styles
    for (const id of this.nodes.keys()) {
      if (!this.graph.nodes.has(id)) {
        this.nodes.delete(id);
        this._nodeOverrides.delete(id);
      }
    }

    // Delete old edge styles
    for (const gEdge of this.edges.keys()) {
      if (!this.graph.edges.has(gEdge)) {
        this.edges.delete(gEdge);
        this._edgeOverrides.delete(gEdge);
      }
    }

    // Refresh style caches
    // Node styles
    this._nodeStyles = [];
    for (const sNode of this.simulation._nodeList)
      this._nodeStyles.push(this.nodes.get(sNode.id));

    const sim = this.simulation;

    // Edge pairs
    const refs = sim._edgeRefs;
    this._edgeStyles = [];
    for (let k = 0; k < refs.length; k++)
      this._edgeStyles.push(this.edges.get(refs[k]));

    // Edge bow
    const ep = sim._edgePairs;
    const sNodes = sim._nodeList;
    this._edgeBow = new Int8Array(ep.length / 2);
    for (let k = 0, i = 0; i < ep.length; k++, i += 2) {
      const a = ep[i], b = ep[i + 1];
      if (a === b || !this.graph.directed) { this._edgeBow[k] = 0; continue; }
      const aId = sNodes[a].id, bId = sNodes[b].id;
      this._edgeBow[k] = this.graph.hasEdge(bId, aId) ? (aId < bId ? 1 : -1) : 0;
    }

    this._syncedSimulation = this.simulation._version;
    this._version++;
    return true;
  }

  _cull() {
    const [xMin, yMin] = this.canvasToSim(0, 0);
    const [xMax, yMax] = this.canvasToSim(this.canvas.width, this.canvas.height);

    const nodesI = [];
    const shouldRender = new Set();
    const sim = this.simulation;
    for (let i = 0; i < sim._nodeList.length; i++) {
      const sNode = sim._nodeList[i];
      if (circleRectCollision(sNode.x, sNode.y, sNode.radius, xMin, xMax, yMin, yMax)) {
        nodesI.push(i);
        shouldRender.add(i);
      }
    }

    const edgesI = [];
    const ep = sim._edgePairs;
    for (let i = 0, j = 0; i < ep.length / 2; i++, j += 2) {
      if (shouldRender.has(ep[j]) || shouldRender.has(ep[j + 1])) 
        edgesI.push(i);
    }

    return { nodesI, edgesI };
  }

  render() {
    this.sync();

    const toRender = this._cull();
    const sim = this.simulation;

    this.ctx.fillStyle = this.opts.background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Render edges
    for (const i of toRender.edgesI) {
      const edgeStyle = this._edgeStyles[i];
      const iDbl = 2 * i;
      const srcNode = sim._nodeList[sim._edgePairs[iDbl]];
      const destNode = sim._nodeList[sim._edgePairs[iDbl + 1]];
      if (this.graph.directed) {

      } else {
        this.ctx.strokeStyle = edgeStyle.color;
        this.ctx.lineWidth = edgeStyle.width;
        this.ctx.beginPath();
        this.ctx.moveTo(...this.simToCanvas(srcNode.x, srcNode.y));
        this.ctx.lineTo(...this.simToCanvas(destNode.x, destNode.y));
        this.ctx.stroke();
      }
    }

    // Render n6des
    for (const i of toRender.nodesI) {
      const nodeStyle = this._nodeStyles[i];
      const sNode = sim._nodeList[i];
      this.ctx.beginPath();
      this.ctx.arc(...this.simToCanvas(sNode.x, sNode.y), sNode.radius * this.view.zoom, 0, 2 * Math.PI);
      this.ctx.fillStyle = nodeStyle.color;
      this.ctx.fill();
      if (nodeStyle.outlineWidth) {
        this.ctx.strokeStyle = nodeStyle.outlineColor;
        this.ctx.lineWidth = nodeStyle.outlineWidth;
        this.ctx.stroke();
      }
    }
  }
}
