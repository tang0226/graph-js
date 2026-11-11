/** @import { NodeData } from './typedefs/graph.js' */
/** @import { Canvas, View } from './typedefs/renderer.js' */
/** @import { GraphJSOpts, GraphJSHookType, GraphJSHook } from './typedefs/graphjs.js' */
/** @import { GraphJSEventMap, GraphJSEventType, GraphJSEvent, GraphJSListener } from './typedefs/graphjs.js' */
/** @import { TweenValue, TweenUnit, TweenOpts } from './typedefs/tween.js' */
/** @import { InteractionOpts, InteractionOptsInput } from './typedefs/interaction.js' */


import { Graph } from "./graph.js";
import { Simulation } from "./simulation.js";
import { Renderer } from "./renderer.js";
import { Tween } from "./tween.js";
import { Interaction } from "./interaction.js";


/**
 * Every event name, matching the keys of `GraphJSEventMap`
 * @type {readonly GraphJSEventType[]}
 */
const EVENT_TYPES = Object.freeze([
  "nodeenter", "nodeleave", "nodeclick", "nodedblclick",
  "nodedragstart", "nodedrag", "nodedragend",
  "backgroundclick",
  "panstart", "pan", "panend", "zoom",
]);


/**
 * Unified interface over the `Graph`, `Simulation`, and `Renderer` layers.
 */
export class GraphJS {
  /** @private @type {Graph} */
  _graph;
  /**
   * Underlying `Graph` instance.
   */
  get graph() { return this._graph; }


  /** @private @type {Simulation} */
  _simulation;
  /**
   * Underlying `Simulation` instance.
   */
  get simulation() { return this._simulation; }

  /** @private @type {Renderer} */
  _renderer;
  /**
   * Underlying `Renderer` instance.
   */
  get renderer() { return this._renderer; }


  /**
   * Hook functions by type, run by each frame of `start()` and by `step()`:
   * "preTick" before the simulation ticks, "postTick" between ticking and
   * rendering, and "postRender" after rendering
   * @type {Record<GraphJSHookType, Set<GraphJSHook>>}
   * @private
   */
  _hooks = {
    preTick: new Set(),
    postTick: new Set(),
    postRender: new Set(),
  };


  /**
   * Event listeners by event name, in the order they were added
   * @type {Map<GraphJSEventType, Set<GraphJSListener<any>>>}
   * @private
   */
  _listeners = new Map(EVENT_TYPES.map(type => [type, new Set()]));


  /**
   * Built-in pointer interaction, or `null` while it's off
   * @type {Interaction | null}
   * @private
   */
  _interaction = null;


  /**
   * Handle of the pending animation frame while `start()` is running, or
   * `null` when stopped
   * @type {number | null}
   * @private
   */
  _raf = null;


  /**
   * Active tweens by key. Keys default to a fresh symbol per tween.
   * @type {Map<any, Tween<any>>}
   * @private
   */
  _tweens = new Map();


  /**
   * Timestamp of the previous `stepTweens()`, or `null` when tween time
   * shouldn't count from it: before the first step, after `start()` or
   * `stop()`, and while no tweens are active
   * @type {number | null}
   * @private
   */
  _tweenClock = null;


  /**
   * Default unit of tweens that don't set one
   * @type {TweenUnit}
   * @private
   */
  _tweenUnit;


  /**
   * Initializes a GraphJS instance.
   * @param {GraphJSOpts} opts
   */
  constructor(opts = {}) {
    const tweenUnit = opts.tweenUnit ?? "ms";
    if (tweenUnit !== "ms" && tweenUnit !== "frames") {
      throw new RangeError(`GraphJS: unknown tweenUnit "${tweenUnit}"`);
    }
    this._tweenUnit = tweenUnit;

    this._graph = new Graph(opts.graph ?? {});
    this._simulation = new Simulation(this._graph, opts.simulation ?? {});

    // Build a local copy: writing back onto `opts` would mutate the caller's
    // object, which breaks reuse of a memoised options literal.
    const rendererOpts = opts.canvas
      ? { ...opts.renderer, canvas: opts.canvas }
      : opts.renderer ?? {};
    this._renderer = new Renderer(this._simulation, rendererOpts);

    if (opts.interaction) {
      this.enableInteraction(opts.interaction === true ? {} : opts.interaction);
    }
  }


  /**
   * The `Renderer`'s canvas
   * @type {Canvas | null}
   */
  get canvas() { return this._renderer.canvas; }


  /**
   * Attaches a canvas to the `Renderer`. If a canvas is already attached, it
   * will be removed before attaching the new canvas. If interaction is on,
   * starts listening for pointer input on the canvas.
   * @param {Canvas} canvas - canvas object to attach
   * @returns {this} self reference
   */
  attach(canvas) {
    if (this.canvas) this.detach();
    this._renderer.attach(canvas);
    this._interaction?.bind(canvas);
    return this;
  }


  /**
   * Detaches a canvas from the `Renderer`, if one is attached. Before
   * detaching, it calls `stop()` to stop the render loop, and stops
   * listening for pointer input.
   * @returns {this} self reference
   */
  detach() {
    if (!this.canvas) return this;
    this.stop();
    this._interaction?.unbind();
    this._renderer.detach();
    return this;
  }


  /**
   * Turns on built-in pointer interaction, or updates its options if it's
   * already on. While a canvas is attached, dragging a node moves it,
   * dragging the background pans, and the wheel zooms, each emitting events
   * (see `on()`) whose listeners can call `preventDefault()` to stop the
   * built-in response. Canvases that can't receive pointer input, such as an
   * `OffscreenCanvas`, are ignored.
   * @param {InteractionOptsInput} [opts={}] - options to set. Options left
   *    `undefined` keep their current value, or their default when turning
   *    interaction on.
   * @returns {this} self reference
   * @throws {TypeError | RangeError} throws if an option is invalid
   */
  enableInteraction(opts = {}) {
    if (this._interaction) {
      this._interaction.setOpts(opts);
      return this;
    }
    this._interaction = new Interaction(this, (type, data) => this._emit(type, data), opts);
    if (this.canvas) this._interaction.bind(this.canvas);
    return this;
  }


  /**
   * Turns off built-in pointer interaction. A drag in progress ends without
   * events, unpinning the dragged node. Turning interaction on again starts
   * from the default options.
   * @returns {this} self reference
   */
  disableInteraction() {
    this._interaction?.unbind();
    this._interaction = null;
    return this;
  }


  /**
   * Returns whether built-in pointer interaction is on.
   * @returns {boolean} whether interaction is on
   */
  isInteractive() { return this._interaction !== null; }


  /**
   * Current interaction options, or `null` while interaction is off
   * @type {Readonly<InteractionOpts> | null}
   */
  get interactionOpts() { return this._interaction?.opts ?? null; }


  /**
   * Updates the `Renderer`'s internal canvas dimensions. Delegates to
   * `Renderer.resize()`.
   * @returns {this} self reference
   */
  resize() { this._renderer.resize(); return this; }


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
    const frame = (/** @type {number} */ time) => {
      if (!this.canvas) { this._raf = null; return; }
      // Schedule first, so that a hook calling stop() cancels the next frame
      this._raf = requestAnimationFrame(frame);
      this._frame(time);
    };
    this._raf = requestAnimationFrame(frame);
    this._tweenClock = null;
    return this;
  }


  /**
   * Stops the `requestAnimationFrame()` loop if one is running.
   * @returns {this} self reference
   */
  stop() {
    if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._tweenClock = null;
    return this;
  }


  /**
   * Ticks the simulation and renders to the `Renderer`'s canvas, if possible
   * (see `Renderer.render()`), running hooks as a frame of `start()` would.
   * @returns {this} self reference
   */
  step() {
    this._frame(globalThis.performance?.now() ?? Date.now());
    return this;
  }


  /**
   * Returns whether the simulation and renderer animation loop is running.
   * @returns {boolean} whether the animation loop is running
   */
  isRunning() { return this._raf !== null; }


  /**
   * Adds a function to run each frame of `start()`, and on each `step()`.
   * "preTick" hooks run before the simulation ticks, "postTick" hooks between
   * ticking and rendering, and "postRender" hooks after rendering. Hooks of a
   * type run in the order they were added, and adding the same function again
   * has no effect. An error thrown by a hook is logged, and the frame carries
   * on.
   *
   * For drawing, use `Renderer.addHook()` instead: its hooks run at a fixed
   * point in the frame, with canvas state saved and restored around them.
   * @param {GraphJSHookType} type - hook type
   * @param {GraphJSHook} f - hook function, called with this instance and the
   *    frame's timestamp
   * @returns {this} self reference
   */
  addHook(type, f) {
    this._hooks[type].add(f);
    return this;
  }


  /**
   * Removes a hook. Returns whether the hook existed in its corresponding
   * type `Set`.
   * @param {GraphJSHookType} type - hook type
   * @param {GraphJSHook} f - hook function to remove
   * @returns {boolean} whether the hook existed
   */
  removeHook(type, f) {
    return this._hooks[type].delete(f);
  }


  /**
   * Runs all hooks of a specific type, with a timestamp. Iterates over a copy,
   * so hooks added or re-added during the run start on the next frame.
   * @param {GraphJSHookType} type - hook type
   * @param {number} time - frame timestamp
   * @returns {void}
   * @private
   */
  _runHooks(type, time) {
    const hooks = this._hooks[type];
    if (hooks.size === 0) return;
    for (const f of [...hooks]) {
      try { f(this, time); }
      catch (err) { console.error(`GraphJS: ${type} hook failed`, err); }
    }
  }


  /**
   * Runs one frame: ticks the simulation and renders, with hooks around each.
   * Shared by `start()` and `step()`.
   * @param {number} time - frame timestamp
   * @returns {void}
   * @private
   */
  _frame(time) {
    this.stepTweens(time);
    this._runHooks("preTick", time);
    this._simulation.tick();
    this._runHooks("postTick", time);
    this._renderer.render(time);
    this._runHooks("postRender", time);
  }


  /**
   * Adds a listener for an event. Listeners of an event run in the order they
   * were added, and adding the same function again has no effect. An error
   * thrown by a listener is logged, and the remaining listeners still run.
   * @template {GraphJSEventType} K
   * @param {K} type - event name
   * @param {GraphJSListener<K>} f - listener, called with the event
   * @returns {this} self reference
   * @throws {TypeError} throws if the event name is unknown or `f` isn't a
   *    function
   */
  on(type, f) {
    if (typeof f !== "function") {
      throw new TypeError(`GraphJS: "${type}" listener must be a function`);
    }
    this._listenersOf(type).add(f);
    return this;
  }


  /**
   * Removes a listener for an event. A listener removed while its event is
   * being emitted doesn't run for that event, if it hasn't already.
   * @template {GraphJSEventType} K
   * @param {K} type - event name
   * @param {GraphJSListener<K>} f - listener to remove
   * @returns {boolean} whether the listener was there
   * @throws {TypeError} throws if the event name is unknown
   */
  off(type, f) {
    return this._listenersOf(type).delete(f);
  }


  /**
   * Returns the listener set of an event.
   * @param {GraphJSEventType} type - event name
   * @returns {Set<GraphJSListener<any>>} the event's listeners
   * @throws {TypeError} throws if the event name is unknown
   * @private
   */
  _listenersOf(type) {
    const listeners = this._listeners.get(type);
    if (!listeners) throw new TypeError(`GraphJS: unknown event "${type}"`);
    return listeners;
  }


  /**
   * Emits an event: calls each of its listeners with one shared event object,
   * built from `data` plus the `type`, `target` and `preventDefault()` fields.
   * Iterates over a copy, so listeners added during the emit start on the
   * next one, and skips listeners removed during it.
   * @template {GraphJSEventType} K
   * @param {K} type - event name
   * @param {GraphJSEventMap[K]} data - the event's data
   * @returns {boolean} whether a listener called `preventDefault()`, in which
   *    case the caller should skip its own response to the event
   * @private
   */
  _emit(type, data) {
    const listeners = this._listenersOf(type);
    if (listeners.size === 0) return false;
    let prevented = false;
    /** @type {GraphJSEvent<K>} */
    const event = {
      ...data,
      type,
      target: this,
      get defaultPrevented() { return prevented; },
      preventDefault() { prevented = true; },
    };
    for (const f of [...listeners]) {
      if (!listeners.has(f)) continue;
      try { f(event); }
      catch (err) { console.error(`GraphJS: "${type}" listener failed`, err); }
    }
    return prevented;
  }


  /**
   * Starts a tween, which animates a number or an array of numbers by passing
   * each new value to `set`. Active tweens are advanced at the start of every
   * frame of `start()` and every `step()`, before the "preTick" hooks, or by
   * `stepTweens()`. Time only counts while frames run: the gap across a
   * `stop()` and `start()` is skipped.
   *
   * Starting a tween with the `key` of an active one cancels the old one, so
   * two tweens never fight over the same value.
   * @template {TweenValue} T
   * @param {TweenOpts<T> & { key?: any }} opts - tween options, plus an
   *    optional `key` to find, cancel or replace the tween by. The `unit`
   *    defaults to this instance's `tweenUnit`.
   * @returns {Tween<T>} the tween, which can be cancelled or finished directly
   * @throws {TypeError | RangeError} throws if an option is invalid (see
   *    `Tween`)
   */
  tween(opts) {
    const { key = Symbol("tween"), ...rest } = opts;
    /** @type {Tween<T>} */
    const tw = new Tween({ ...rest, unit: rest.unit ?? this._tweenUnit }, () => {
      // A tween started under this key by onFinish has already replaced it
      if (this._tweens.get(key) === tw) this._tweens.delete(key);
      if (this._tweens.size === 0) this._tweenClock = null;
    });
    this._tweens.get(key)?.cancel();
    this._tweens.set(key, tw);
    return tw;
  }


  /**
   * Returns the active tween with a key, or `null` if there is none.
   * @param {any} key - tween key
   * @returns {Tween<any> | null} the tween, or `null`
   */
  getTween(key) { return this._tweens.get(key) ?? null; }


  /**
   * Cancels the active tween with a key, leaving its value where it is.
   * @param {any} key - tween key
   * @returns {boolean} whether there was a tween to cancel
   */
  cancelTween(key) {
    const tw = this._tweens.get(key);
    tw?.cancel();
    return tw !== undefined;
  }


  /**
   * Cancels every active tween, leaving their values where they are.
   * @returns {this} self reference
   */
  cancelAllTweens() {
    for (const tw of [...this._tweens.values()]) tw.cancel();
    return this;
  }


  /**
   * Returns whether any tweens are active. Loops that only render on demand
   * can keep requesting frames while this is `true`.
   * @returns {boolean} whether any tweens are active
   */
  isTweening() { return this._tweens.size > 0; }


  /**
   * Advances every active tween to a timestamp, without ticking the
   * simulation or rendering. Frames of `start()` and `step()` already do
   * this; call it from loops that render on demand instead. Tweens started
   * during the call begin on the next one.
   * @param {number} [time] - frame timestamp in milliseconds. Defaults to
   *    `performance.now()`.
   * @returns {this} self reference
   */
  stepTweens(time = globalThis.performance?.now() ?? Date.now()) {
    if (this._tweens.size === 0) return this;
    const dt = this._tweenClock === null ? 0 : Math.max(time - this._tweenClock, 0);
    this._tweenClock = time;
    for (const tw of [...this._tweens.values()]) tw.step(dt);
    return this;
  }


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
    return this._renderer.simToCanvas(x, y);
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
    return this._renderer.canvasToSim(cx, cy);
  }


  /**
   * Returns the id of the node occupying a specific coordinate in canvas
   * space, or null if no node is there. Most commonly used for mouse UI
   * interactions.
   * @param {number} cx - canvas space x coordinate
   * @param {number} cy - canvas space y coordinate
   * @param {number} [slack] - extra hit radius around each node, in canvas
   *    pixels (defaults to the renderer's default)
   * @returns {any | null} id of node at coordinates, or `null` if no node
   *    was found
   * @throws {Error} throws if no canvas is attached
   */
  nodeAt(cx, cy, slack = undefined) {
    if (!this.canvas) throw new Error("GraphJS: no canvas attached");
    return this._renderer.nodeAt(cx, cy, slack);
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
    const p = this._simulation.getPosition(id);
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
    return this._simulation.pin(id, ...this.canvasToSim(cx, cy));
  }


  /**
   * Unpins a node by reverting `fixed` to its default. Delegates to
   * `Simulation.unpin()`.
   * @param {any} id - node id
   * @returns {this} self reference
   */
  unpin(id) { this._simulation.unpin(id); return this; }


  /**
   * [read-only, set with `setView()` or the methods below] The `Renderer`'s
   * current view: the simulation coordinates at the canvas centre, and the
   * zoom (canvas px per simulation px).
   *
   * The view methods delegate to the `Renderer`'s. They don't emit events,
   * and like other changes made from code, they show on the next render.
   * @type {Readonly<View>}
   */
  get view() { return this._renderer.view; }


  /**
   * Sets some or all of the view. Delegates to `Renderer.setView()`.
   * @param {Partial<View>} view - view values to set
   * @returns {this} self reference
   * @throws {RangeError} throws if a coordinate isn't finite, or the zoom
   *    isn't a finite number above 0
   */
  setView(view) { this._renderer.setView(view); return this; }


  /**
   * Returns the view moved so the graph shifts by a distance on the canvas,
   * without applying it. Delegates to `Renderer.viewPannedBy()`.
   * @param {number} dx - canvas px to shift the graph right
   * @param {number} dy - canvas px to shift the graph down
   * @returns {View} the panned view
   * @throws {RangeError} throws if `dx` or `dy` isn't finite
   */
  viewPannedBy(dx, dy) { return this._renderer.viewPannedBy(dx, dy); }


  /**
   * Shifts the graph by a distance on the canvas, as dragging the background
   * does. Delegates to `Renderer.panBy()`.
   * @param {number} dx - canvas px to shift the graph right
   * @param {number} dy - canvas px to shift the graph down
   * @returns {this} self reference
   * @throws {RangeError} throws if `dx` or `dy` isn't finite
   */
  panBy(dx, dy) { this._renderer.panBy(dx, dy); return this; }


  /**
   * Returns the view at a zoom, anchored at a canvas point or the centre,
   * without applying it. Delegates to `Renderer.viewZoomedTo()`.
   * @param {number} zoom - zoom (canvas px per simulation px)
   * @param {number} [cx] - canvas space x coordinate of the anchor
   * @param {number} [cy] - canvas space y coordinate of the anchor
   * @returns {View} the zoomed view
   * @throws {RangeError | TypeError | Error} throws as
   *    `Renderer.viewZoomedTo()` does
   */
  viewZoomedTo(zoom, cx = undefined, cy = undefined) {
    return this._renderer.viewZoomedTo(zoom, cx, cy);
  }


  /**
   * Sets the zoom, anchored at a canvas point or the centre. Delegates to
   * `Renderer.zoomTo()`.
   * @param {number} zoom - zoom (canvas px per simulation px)
   * @param {number} [cx] - canvas space x coordinate of the anchor
   * @param {number} [cy] - canvas space y coordinate of the anchor
   * @returns {this} self reference
   * @throws {RangeError | TypeError | Error} throws as
   *    `Renderer.viewZoomedTo()` does
   */
  zoomTo(zoom, cx = undefined, cy = undefined) {
    this._renderer.zoomTo(zoom, cx, cy);
    return this;
  }


  /**
   * Multiplies the zoom by a factor, anchored at a canvas point or the
   * centre. Delegates to `Renderer.zoomBy()`.
   * @param {number} factor - factor to multiply the zoom by
   * @param {number} [cx] - canvas space x coordinate of the anchor
   * @param {number} [cy] - canvas space y coordinate of the anchor
   * @returns {this} self reference
   * @throws {RangeError | TypeError | Error} throws as `Renderer.zoomBy()`
   *    does
   */
  zoomBy(factor, cx = undefined, cy = undefined) {
    this._renderer.zoomBy(factor, cx, cy);
    return this;
  }
}
