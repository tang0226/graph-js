import { Graph } from "./graph.js";
import { Simulation } from "./simulation.js";
import { Renderer } from "./renderer.js";

export class GraphJS {
  constructor(canvas, opts = {}) {
    this.graph = new Graph(opts.graph ?? {});
    this.simulation = new Simulation(this.graph, opts.simulation ?? {});
    this.renderer = new Renderer(this.simulation, canvas, opts.renderer ?? {});
    this.canvas = canvas;

    this._raf = null;
  }

  resize() {
    const dpr = window.devicePixelRatio ?? 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.size = { w, h };
    return this;
  }

  // Defaults mirror Graph's, so forwarding does not make optional arguments
  // required for callers (which TypeScript consumers see as an arity error).
  addNode(data = {}, id = undefined)        { return this.graph.addNode(data, id); }
  addEdge(srcId, destId, data = {})         { return this.graph.addEdge(srcId, destId, data); }
  removeNode(id)                            { return this.graph.removeNode(id); }
  removeEdge(srcId, destId)                 { return this.graph.removeEdge(srcId, destId); }

  start() {
    if (this._raf !== null) return this;
    const frame = () => {
      this.simulation.tick();
      this.renderer.render();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
    return this;
  }

  stop() {
    if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
    return this;
  }

  step() { this.simulation.tick(); this.renderer.render(); return this; }

  isRunning() { return this._raf !== null; }

  simToCanvas(x, y) { return this.renderer.simToCanvas(x, y); }
  canvasToSim(cx, cy) { return this.renderer.canvasToSim(cx, cy); }

  nodeAt(cx, cy) {
    const [x, y] = this.canvasToSim(cx, cy);
    const nodes = this.simulation._nodeList;
    const slack = 4 / this.renderer.view.zoom; // 4 world-coordinate radius slack
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], r = node.radius + slack;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r) return node.id;
    }
    return null;
  }

  getPosition(id) {
    const p = this.simulation.getPosition(id);
    return p ? this.simToCanvas(...p) : null;
  }

  pin(id, cx, cy) { return this.simulation.pin(id, ...this.canvasToSim(cx, cy)); }

  unpin(id) { return this.simulation.unpin(id); }
}
