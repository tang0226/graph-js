import { Graph } from "./graph.js";
import { Simulation } from "./simulation.js";
import { Renderer } from "./renderer.js";

export class GraphJS {
  constructor(canvas, opts = {}) {
    this.graph = new Graph(opts.graph ?? {});
    this.simulation = new Simulation(this.graph, opts.simulation ?? {});
    this.renderer = new Renderer(this.simulation, canvas, opts.render ?? {});
    this.canvas = canvas;

    this._raf = null;
  }

  resize() {
    const dpr = window.devicePixelRatio ?? 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this;
  }

  addNode(data, id)        { return this.graph.addNode(data, id); }
  addEdge(src, dest, data) { return this.graph.addEdge(src, dest, data); }
  removeNode(id)           { return this.graph.removeNode(id); }
  removeEdge(src, dest)    { return this.graph.removeEdge(src, dest); }

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
}
