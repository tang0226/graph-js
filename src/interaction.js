/** @import { GraphJS } from './graphjs.js' */
/** @import { NodeId, GraphEdge, GraphEvent } from './typedefs/graph.js' */
/** @import { Canvas } from './typedefs/renderer.js' */
/** @import { InteractionOpts, InteractionOptsInput } from './typedefs/interaction.js' */
/** @import { InteractionEmit, InteractionPress } from './typedefs/internal/interaction.js' */


import { INTERACTION_DEFAULTS } from "./defaults.js";
import { checkBoolean, checkKnownKeys, checkNumber } from "./validate.js";


/** Every interaction option name */
const OPTION_NAMES = new Set(Object.keys(INTERACTION_DEFAULTS));


/**
 * Built-in pointer interaction for a `GraphJS` instance: turns DOM pointer and
 * wheel events on its canvas into GraphJS events, then applies the built-in
 * response to each (dragging nodes, panning, zooming) unless a listener calls
 * `preventDefault()`. Edge events have no built-in response: a press on an
 * edge goes on as a press on the background. Owned by `GraphJS`, which binds
 * it to the canvas on attach and unbinds it on detach.
 */
export class Interaction {
  /** @private @type {GraphJS} */
  _gjs;

  /** @private @type {InteractionEmit} */
  _emit;

  /** @private @type {InteractionOpts} */
  _opts = { ...INTERACTION_DEFAULTS };
  /**
   * [read-only, set with `setOpts()`] Interaction options
   * @returns {Readonly<InteractionOpts>}
   */
  get opts() { return this._opts; }

  /**
   * Canvas the DOM listeners are on, or `null` when unbound
   * @type {HTMLCanvasElement | null}
   * @private
   */
  _canvas = null;

  /**
   * Removes every DOM listener at once when aborted
   * @type {AbortController | null}
   * @private
   */
  _abort = null;

  /**
   * The canvas's `touch-action` before binding, restored on unbind
   * @type {string}
   * @private
   */
  _prevTouchAction = "";

  /** @private @type {InteractionPress | null} */
  _press = null;

  /**
   * Node under the pointer, or `null`. Frozen while a press is held.
   * @type {NodeId | null}
   * @private
   */
  _hoveredNode = null;

  /**
   * Edge under the pointer, or `null`. Only set while no node is hovered,
   * since nodes are drawn over edges. Frozen while a press is held.
   * @type {GraphEdge | null}
   * @private
   */
  _hoveredEdge = null;


  /**
   * Canvas position and DOM event of the latest pointer input, or `null`
   * before any. Events caused by a node's removal report these, since no
   * pointer input caused them.
   * @type {{ x: number, y: number, event: PointerEvent } | null}
   * @private
   */
  _last = null;


  /**
   * Graph listener that ends a drag or hover on a node when it's removed.
   * Kept as a field so `unbind()` can remove it.
   * @type {(e: GraphEvent<"noderemove">) => void}
   * @private
   */
  _onGraphNodeRemove = e => this._nodeRemoved(e.id);


  /**
   * Graph listener that ends a press or hover on an edge when it's removed.
   * Kept as a field so `unbind()` can remove it.
   * @type {(e: GraphEvent<"edgeremove">) => void}
   * @private
   */
  _onGraphEdgeRemove = e => this._edgeRemoved(e.edge);


  /**
   * @param {GraphJS} gjs - instance to interact with
   * @param {InteractionEmit} emit - emits a GraphJS event
   * @param {InteractionOptsInput} [opts] - options
   * @throws {TypeError | RangeError} throws if an option is invalid
   */
  constructor(gjs, emit, opts = {}) {
    this._gjs = gjs;
    this._emit = emit;
    this.setOpts(opts);
  }


  /**
   * Merges options into the current ones. Options left `undefined` keep
   * their current value. Nothing changes if any option is invalid.
   * @param {InteractionOptsInput} opts - options to set
   * @returns {this} self reference
   * @throws {TypeError | RangeError} throws if an option is invalid
   */
  setOpts(opts) {
    const owner = "Interaction";
    checkKnownKeys(owner, opts, OPTION_NAMES);
    const next = { ...this._opts };
    for (const key of /** @type {(keyof InteractionOpts)[]} */ ([...OPTION_NAMES])) {
      if (opts[key] !== undefined) /** @type {any} */ (next)[key] = opts[key];
    }
    for (const key of /** @type {const} */ (["dragNodes", "pan", "zoom"])) checkBoolean(owner, key, next[key]);
    checkNumber(owner, "dragThreshold", next.dragThreshold, { min: 0 });
    checkNumber(owner, "zoomSpeed", next.zoomSpeed, { min: 0, aboveMin: true });
    checkNumber(owner, "minZoom", next.minZoom, { min: 0, aboveMin: true });
    checkNumber(owner, "maxZoom", next.maxZoom, { min: 0, aboveMin: true, allowInfinity: true });
    if (next.maxZoom < next.minZoom) throw new RangeError("Interaction: `maxZoom` must be at least `minZoom`");
    this._opts = next;
    return this;
  }


  /**
   * Whether the DOM listeners are on a canvas
   * @returns {boolean}
   */
  isBound() { return this._canvas !== null; }


  /**
   * Adds the DOM listeners to a canvas, unbinding from any previous one
   * first. Canvases that can't receive pointer input, such as an
   * `OffscreenCanvas`, are skipped.
   * @param {Canvas} canvas - canvas to listen on
   * @returns {boolean} whether the listeners were added
   */
  bind(canvas) {
    this.unbind();
    if (!("getBoundingClientRect" in canvas) || typeof canvas.addEventListener !== "function") return false;
    const el = canvas;
    const abort = new AbortController();
    const signal = abort.signal;
    this._canvas = el;
    this._abort = abort;

    el.addEventListener("pointerdown", e => this._onPointerDown(e), { signal });
    el.addEventListener("pointermove", e => this._onPointerMove(e), { signal });
    el.addEventListener("pointerup", e => this._endPress(e, true), { signal });
    el.addEventListener("pointercancel", e => this._endPress(e, false), { signal });
    el.addEventListener("pointerleave", e => { if (!this._press) this._clearHover(e); }, { signal });
    el.addEventListener("dblclick", e => this._onDblClick(e), { signal });
    // Not passive, so preventDefault() can stop the page scrolling
    el.addEventListener("wheel", e => this._onWheel(e), { signal, passive: false });

    this._gjs.graph.on("noderemove", this._onGraphNodeRemove);
    this._gjs.graph.on("edgeremove", this._onGraphEdgeRemove);

    // Stops touch drags from scrolling the page instead
    if (el.style) {
      this._prevTouchAction = el.style.touchAction;
      el.style.touchAction = "none";
    }
    return true;
  }


  /**
   * Removes the DOM listeners, if bound. Ends a press without emitting
   * events, unpinning a node it was dragging, and forgets the hovered node or
   * edge.
   * @returns {this} self reference
   */
  unbind() {
    const el = this._canvas;
    if (!el) return this;
    this._abort?.abort();
    this._abort = null;
    this._canvas = null;
    this._gjs.graph.off("noderemove", this._onGraphNodeRemove);
    this._gjs.graph.off("edgeremove", this._onGraphEdgeRemove);
    if (el.style) el.style.touchAction = this._prevTouchAction;
    if (this._press?.unpin) this._gjs.simulation.unpin(this._press.id);
    this._press = null;
    this._hoveredNode = null;
    this._hoveredEdge = null;
    this._last = null;
    return this;
  }


  /**
   * Converts a DOM event's client coordinates to canvas space.
   * @param {MouseEvent} e - DOM event
   * @param {HTMLCanvasElement} el - bound canvas
   * @returns {[number, number]} canvas space coordinates
   * @private
   */
  _toCanvas(e, el) {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }


  /**
   * Finds what's under a canvas point: a node, else an edge, since nodes are
   * drawn over edges.
   * @param {number} x - canvas x coordinate
   * @param {number} y - canvas y coordinate
   * @returns {{ id: NodeId | null, edge: GraphEdge | null }} the node's id,
   *    or the edge, or neither
   * @private
   */
  _pick(x, y) {
    const id = this._gjs.nodeAt(x, y);
    return { id, edge: id === null ? this._gjs.edgeAt(x, y) : null };
  }


  /**
   * Edge event data for an edge
   * @param {GraphEdge} edge - the edge
   * @returns {{ srcId: NodeId, destId: NodeId, edge: GraphEdge }} the data
   * @private
   */
  _edgeData(edge) {
    return { srcId: edge.src.id, destId: edge.dest.id, edge };
  }


  /**
   * Starts tracking a press of the primary pointer's main button, after
   * emitting `nodepress` or `edgepress` for a press on a node or edge.
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _onPointerDown(e) {
    const el = this._canvas;
    if (!el || this._press || !e.isPrimary || e.button !== 0) return;
    const [x, y] = this._toCanvas(e, el);
    this._last = { x, y, event: e };
    const { id, edge } = this._pick(x, y);
    // Preventing nodepress ignores the press; a listener may also have unbound
    if (id !== null && (this._emit("nodepress", { x, y, id, originalEvent: e }) || this._canvas !== el)) return;
    // edgepress has nothing to prevent, but a listener may have unbound
    if (edge !== null) {
      this._emit("edgepress", { x, y, ...this._edgeData(edge), originalEvent: e });
      if (this._canvas !== el) return;
    }
    this._press = {
      pointerId: e.pointerId, id, edge,
      startX: x, startY: y, lastX: x, lastY: y,
      drag: null, grabX: 0, grabY: 0, unpin: false,
    };
    // Keeps the moves coming if the pointer leaves the canvas mid-drag
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }


  /**
   * Updates hovering, or the press's drag once it passes the threshold.
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _onPointerMove(e) {
    const el = this._canvas;
    if (!el) return;
    const [x, y] = this._toCanvas(e, el);
    const press = this._press;
    if (!press) { this._last = { x, y, event: e }; this._hover(x, y, e); return; }
    if (e.pointerId !== press.pointerId) return;
    this._last = { x, y, event: e };

    if (press.drag === null) {
      if (Math.hypot(x - press.startX, y - press.startY) <= this._opts.dragThreshold) return;
      this._startDrag(press, e);
      if (this._press !== press) return;
    }
    const dx = x - press.lastX, dy = y - press.lastY;
    press.lastX = x;
    press.lastY = y;
    if (press.drag === "node") this._dragNode(press, x, y, dx, dy, e);
    else if (press.drag === "pan") this._pan(press, x, y, dx, dy, e);
  }


  /**
   * Decides what a press drags once it passes the threshold, and emits the
   * drag's start event at the press position.
   * @param {InteractionPress} press - press passing the threshold
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _startDrag(press, e) {
    const { startX: x, startY: y, id } = press;
    const gjs = this._gjs;
    if (id !== null && this._opts.dragNodes) {
      press.drag = "none";
      if (this._emit("nodedragstart", { x, y, id, originalEvent: e }) || this._press !== press) return;
      // Brings `fixed` up to date with config set since the last tick
      gjs.simulation.sync();
      const node = gjs.simulation.nodes.get(id);
      if (!node) return; // removed since the press
      const [px, py] = gjs.canvasToSim(x, y);
      press.grabX = node.x - px;
      press.grabY = node.y - py;
      // A node that was already fixed stays fixed where it's dropped
      press.unpin = !node.fixed;
      gjs.simulation.pin(id, node.x, node.y);
      press.drag = "node";
    } else if (this._opts.pan) {
      press.drag = "none";
      if (this._emit("panstart", { x, y, view: { ...gjs.view }, originalEvent: e })) return;
      press.drag = "pan";
    } else {
      press.drag = "none";
    }
  }


  /**
   * Emits `nodedrag`, then pins the node under the pointer.
   * @param {InteractionPress} press - press dragging a node
   * @param {number} x - canvas x coordinate of the pointer
   * @param {number} y - canvas y coordinate of the pointer
   * @param {number} dx - canvas x movement since the previous event
   * @param {number} dy - canvas y movement since the previous event
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _dragNode(press, x, y, dx, dy, e) {
    if (this._emit("nodedrag", { x, y, dx, dy, id: press.id, originalEvent: e }) || this._press !== press) return;
    const [sx, sy] = this._gjs.canvasToSim(x, y);
    this._gjs.simulation.pin(press.id, sx + press.grabX, sy + press.grabY);
    this._requestRender();
  }


  /**
   * Emits `pan`, then moves the view with the pointer.
   * @param {InteractionPress} press - press panning
   * @param {number} x - canvas x coordinate of the pointer
   * @param {number} y - canvas y coordinate of the pointer
   * @param {number} dx - canvas x movement since the previous event
   * @param {number} dy - canvas y movement since the previous event
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _pan(press, x, y, dx, dy, e) {
    const view = this._gjs.viewPannedBy(dx, dy);
    if (this._emit("pan", { x, y, dx, dy, view, originalEvent: e }) || this._press !== press) return;
    this._gjs.setView(view);
    this._requestRender();
  }


  /**
   * Ends the press: emits the drag's end event, or a click if the press
   * never passed the threshold and `click` is set.
   * @param {PointerEvent} e - DOM event
   * @param {boolean} click - whether a press that didn't drag is a click
   *    (`false` for `pointercancel`)
   * @returns {void}
   * @private
   */
  _endPress(e, click) {
    const el = this._canvas, press = this._press;
    if (!el || !press || e.pointerId !== press.pointerId) return;
    this._press = null;
    const [x, y] = this._toCanvas(e, el);
    this._last = { x, y, event: e };
    const gjs = this._gjs;

    if (press.drag === "node") {
      const prevented = this._emit("nodedragend", { x, y, id: press.id, originalEvent: e });
      // Preventing the end leaves the node pinned where it was dropped
      if (press.unpin && !prevented) gjs.simulation.unpin(press.id);
    } else if (press.drag === "pan") {
      this._emit("panend", { x, y, view: { ...gjs.view }, originalEvent: e });
    } else if (press.drag === null && click) {
      if (press.id !== null) this._emit("nodeclick", { x, y, id: press.id, originalEvent: e });
      else if (press.edge !== null) this._emit("edgeclick", { x, y, ...this._edgeData(press.edge), originalEvent: e });
      else this._emit("backgroundclick", { x, y, originalEvent: e });
    }

    if (this._canvas !== el) return;
    // Touch has no hover, and a cancelled pointer has gone
    if (click && e.pointerType !== "touch") this._hover(x, y, e);
    else this._clearHover(e);
  }


  /**
   * When the node or edge under the pointer changes, emits the leave event of
   * the one it was on, then the enter event of the one it's on now.
   * @param {number} x - canvas x coordinate of the pointer
   * @param {number} y - canvas y coordinate of the pointer
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _hover(x, y, e) {
    const { id, edge } = this._pick(x, y);
    const prevId = this._hoveredNode, prevEdge = this._hoveredEdge;
    if (id === prevId && edge === prevEdge) return;
    this._hoveredNode = id;
    this._hoveredEdge = edge;
    if (prevId !== null && prevId !== id) this._emit("nodeleave", { x, y, id: prevId, originalEvent: e });
    if (prevEdge !== null && prevEdge !== edge) {
      this._emit("edgeleave", { x, y, ...this._edgeData(prevEdge), originalEvent: e });
    }
    // A leave listener may have unbound, or moved the hover on
    if (id !== null && id !== prevId && this._hoveredNode === id) {
      this._emit("nodeenter", { x, y, id, originalEvent: e });
    } else if (edge !== null && edge !== prevEdge && this._hoveredEdge === edge) {
      this._emit("edgeenter", { x, y, ...this._edgeData(edge), originalEvent: e });
    }
  }


  /**
   * Ends what the pointer was doing with a node that has just been removed:
   * a drag of it ends with `nodedragend`, a press on it is cancelled so no
   * click or drag follows, and hovering it ends with `nodeleave`. Without
   * this, those would wait for the next pointer input, and a drag would keep
   * reporting a node that's gone. The events report the latest pointer input.
   * @param {NodeId} id - id of the removed node
   * @returns {void}
   * @private
   */
  _nodeRemoved(id) {
    const last = this._last, press = this._press;
    if (!last) return;
    if (press && press.id === id && press.drag !== "none") {
      const dragging = press.drag === "node";
      // The rest of the press does nothing, and there's no node left to unpin
      press.drag = "none";
      press.unpin = false;
      if (dragging) this._emit("nodedragend", { x: last.x, y: last.y, id, originalEvent: last.event });
    }
    // A listener above may have unbound, which clears the hover
    if (this._hoveredNode === id) {
      this._hoveredNode = null;
      this._emit("nodeleave", { x: last.x, y: last.y, id, originalEvent: last.event });
    }
  }


  /**
   * Ends what the pointer was doing with an edge that has just been removed:
   * a press on it that hasn't become a drag is cancelled, so no click or pan
   * follows, and hovering it ends with `edgeleave`, reporting the latest
   * pointer input. A pan the press already started goes on.
   * @param {GraphEdge} edge - the removed edge
   * @returns {void}
   * @private
   */
  _edgeRemoved(edge) {
    const last = this._last, press = this._press;
    if (!last) return;
    if (press && press.edge === edge && press.drag === null) press.drag = "none";
    if (this._hoveredEdge === edge) {
      this._hoveredEdge = null;
      this._emit("edgeleave", { x: last.x, y: last.y, ...this._edgeData(edge), originalEvent: last.event });
    }
  }


  /**
   * Emits `nodeleave` or `edgeleave` for the hovered node or edge, if any,
   * and forgets it.
   * @param {PointerEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _clearHover(e) {
    const el = this._canvas, prevId = this._hoveredNode, prevEdge = this._hoveredEdge;
    if (!el || (prevId === null && prevEdge === null)) return;
    this._hoveredNode = null;
    this._hoveredEdge = null;
    const [x, y] = this._toCanvas(e, el);
    if (prevId !== null) this._emit("nodeleave", { x, y, id: prevId, originalEvent: e });
    if (prevEdge !== null) this._emit("edgeleave", { x, y, ...this._edgeData(prevEdge), originalEvent: e });
  }


  /**
   * Emits `nodedblclick` or `edgedblclick` for a double-click on a node or
   * edge.
   * @param {MouseEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _onDblClick(e) {
    const el = this._canvas;
    if (!el) return;
    const [x, y] = this._toCanvas(e, el);
    const { id, edge } = this._pick(x, y);
    if (id !== null) this._emit("nodedblclick", { x, y, id, originalEvent: e });
    else if (edge !== null) this._emit("edgedblclick", { x, y, ...this._edgeData(edge), originalEvent: e });
  }


  /**
   * Emits `zoom`, then zooms the view, keeping the point under the pointer
   * fixed.
   * @param {WheelEvent} e - DOM event
   * @returns {void}
   * @private
   */
  _onWheel(e) {
    const el = this._canvas;
    const gjs = this._gjs, size = gjs.renderer.size;
    // Horizontal scrolling is left to the page
    if (!el || !size || !this._opts.zoom || e.deltaY === 0) return;
    // Even at a zoom limit, so the page doesn't start scrolling instead
    e.preventDefault();

    const { zoomSpeed, minZoom, maxZoom } = this._opts;
    // deltaMode 1 is lines and 2 is pages; convert both to px
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1);
    const current = gjs.view.zoom, factor = 2 ** (-px * zoomSpeed);
    // Never zoom past a limit, but don't snap a view already past it either
    const zoom = factor > 1 ?
      Math.min(current * factor, Math.max(maxZoom, current)) :
      Math.max(current * factor, Math.min(minZoom, current));
    if (zoom === current) return;

    const [x, y] = this._toCanvas(e, el);
    const view = gjs.viewZoomedTo(zoom, x, y);
    if (this._emit("zoom", { x, y, view, originalEvent: e }) || this._canvas !== el) return;
    gjs.setView(view);
    this._requestRender();
  }


  /**
   * Shows a change while the loop isn't running, including any fade or
   * tween it starts (see `GraphJS.requestRender()`).
   * @returns {void}
   * @private
   */
  _requestRender() {
    this._gjs.requestRender();
  }
}
