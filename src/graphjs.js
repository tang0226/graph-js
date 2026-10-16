import { Graph } from "./graph.js";
import { Simulation } from "./simulation.js";
import { Renderer } from "./renderer.js";

/** @typedef {import("./types.js").Canvas} Canvas */
/** @typedef {import("./graph.js").NodeData} NodeData */

/**
 * @typedef {object} GraphJSOpts
 * @property {ConstructorParameters<typeof Graph>[0]} [graph] - options for the `Graph`
 * @property {ConstructorParameters<typeof Simulation>[1]} [simulation] - options for the `Simulation`
 * @property {ConstructorParameters<typeof Renderer>[1]} [renderer] - options for the `Renderer`
 * @property {Canvas} [canvas] - canvas to render to
 */

/**
 * Unified interface over the `Graph`, `Simulation`, and `Renderer` layers.
 */
export class GraphJS {
  /**
   * Initializes a GraphJS instance.
   * @param {GraphJSOpts} opts
   */
  constructor(opts = {}) {
    this.graph = new Graph(opts.graph ?? {});
    this.simulation = new Simulation(this.graph, opts.simulation ?? {});

    // Build a local copy: writing back onto `opts` would mutate the caller's
    // object, which breaks reuse of a memoised options literal.
    const rendererOpts = opts.canvas
      ? { ...opts.renderer, canvas: opts.canvas }
      : opts.renderer ?? {};
    this.renderer = new Renderer(this.simulation, rendererOpts);
    
    this._raf = null;
  }


  /**
   * The `Renderer`'s canvas
   * @type {Canvas | null}
   */
  get canvas() { return this.renderer.canvas; }


  /**
   * Attaches a canvas to the `Renderer`. If a canvas is already attached, it
   * will be removed before attaching the new canvas.
   * @param {Canvas} canvas - canvas object to attach
   * @returns {this} self reference
   */
  attach(canvas) {
    if (this.canvas) this.detach();
    this.renderer.attach(canvas);
    return this;
  }


  /**
   * Detaches a canvas from the `Renderer`, if one is attached. Before
   * detaching, it calls `stop()` to stop the render loop.
   * @returns {this} self reference
   */
  detach() {
    if (!this.canvas) return this;
    this.stop();
    this.renderer.detach();
    return this;
  }


  /**
   * Updates the `Renderer`'s internal canvas dimensions. Delegates to
   * `Renderer.resize()`.
   * @returns {this} self reference
   */
  resize() { this.renderer.resize(); return this; }


  /**
   * Adds a node to the `Graph`. Delegates to `Graph.addNode()`.
   * @param {NodeData} [data={}] - data for the node
   * @param {any} [id=undefined] - node id
   * @returns {any} - id of the node added
   */
  addNode(data = {}, id = undefined) { return this.graph.addNode(data, id); }


  /**
   * Adds an edge to the `Graph` based on source and destination node ids.
   * Delegates to `Graph.addEdge()`.
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @param {any} data - data for the edge
   * @returns {boolean} - whether the edge was successfully added
   */
  addEdge(srcId, destId, data = {}) { return this.graph.addEdge(srcId, destId, data); }


  /**
   * Removes a node from the `Graph`. Delegates to `Graph.removeNode()`.
   * @param {any} id - node id
   * @returns {boolean} success of the removal
   */
  removeNode(id) { return this.graph.removeNode(id); }


  /**
   * Removes an edge from the `Graph` based on source and destination id.
   * Delegates to `Graph.removeEdge()`.
   * @param {any} srcId - source node id
   * @param {any} destId - destination node id
   * @returns {boolean} success of the removal
   */
  removeEdge(srcId, destId) { return this.graph.removeEdge(srcId, destId); }


  /**
   * Starts the `requestAnimationFrame()` loop. No-ops if a loop is already
   * running or if no canvas is attached.
   * @returns {this} self reference
   */
  start() {
    if (this._raf !== null || !this.canvas) return this;
    const frame = () => {
      if (!this.canvas) { this._raf = null; return; }
      this.simulation.tick();
      this.renderer.render();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
    return this;
  }


  /**
   * Stops the `requestAnimationFrame()` loop if one is running.
   * @returns {this} self reference
   */
  stop() {
    if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
    return this;
  }


  /**
   * Ticks the simulation and renders to the `Renderer`'s canvas, if possible.
   * (see `Renderer.render()`)
   * @returns {this} self reference
   */
  step() { this.simulation.tick(); this.renderer.render(); return this; }


  /**
   * Returns whether the simulation and renderer animation loop is running.
   * @returns {boolean} whether the animation loop is running
   */
  isRunning() { return this._raf !== null; }


  /**
   * Converts simulation space coordinates to canvas space coordinates based on
   * the `Renderer`'s current `view`. Delegates to `Renderer.simToCanvas()`.
   * @param {number} x - simulation space x coordinate
   * @param {number} y - simulation space y coordinate
   * @returns {[number, number]} canvas space coordinates
   * @throws {Error} throws if no canvas is attached
   */
  simToCanvas(x, y) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    return this.renderer.simToCanvas(x, y);
  }


  /**
   * Converts canvas space coordinates to simulation space coordinates based on
   * the `Renderer`'s current `view`. Delegates to `Renderer.canvasToSim()`.
   * @param {number} cx - canvas space x coordinate
   * @param {number} cy - canvas space y coordinate
   * @returns {[number, number]} - simulation space coordinates
   * @throws {Error} throws if no canvas is attached
   */
  canvasToSim(cx, cy) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    return this.renderer.canvasToSim(cx, cy);
  }


  /**
   * Returns the id of the node occupying a specific coordinate in canvas
   * space, or null if no node is there. Most commonly used for mouse UI
   * interactions.
   * @param {number} cx - canvas space x coordinate
   * @param {number} cy - canvas space y coordinate
   * @returns {any | null} id of node at coordinates, or `null` if no node
   *    was found
   * @throws {Error} throws if no canvas is attached
   */
  nodeAt(cx, cy) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    const [x, y] = this.canvasToSim(cx, cy);
    const nodes = this.simulation._nodeList;
    const slack = 4 / this.renderer.view.zoom;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], r = node.radius + slack;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 < r * r) return node.id;
    }
    return null;
  }


  /**
   * Returns the canvas space coordinates of a node based on id, or `null` if
   * the node id was not found. Delegates to `Simulation.getPosition()`.
   * @param {any} id - node id
   * @returns {[number, number] | null} canvas space coordinates of the node,
   *    or `null` if the node id was not found
   * @throws {Error} throws if no canvas is attached
   */
  getPosition(id) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    const p = this.simulation.getPosition(id);
    return p ? this.simToCanvas(...p) : null;
  }


  /**
   * Fixes the node with the specified id to a point in canvas space. Delegates
   * to `Simulation.pin()`.
   * @param {any} id - node id
   * @param {number} cx - canvas space x coordinate
   * @param {number} cy - canvas space y coordinate
   * @returns {boolean} whether the node was pinned (`false` if node not found)
   * @throws {Error} throws if no canvas is attached
   */
  pin(id, cx, cy) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    return this.simulation.pin(id, ...this.canvasToSim(cx, cy));
  }


  /**
   * Unpins a node by reverting `fixed` to its default. Delegates to
   * `Simulation.unpin()`.
   * @param {any} id - node id
   * @returns {this} self reference
   */
  unpin(id) { this.simulation.unpin(id); return this; }
}
