/** @import { NodeId, GraphEdge } from './typedefs/graph.js' */
/** @import { HighlightMode } from './typedefs/renderer.js' */


/**
 * Moves each alpha toward its target (1 when highlighted, `dim` otherwise) by
 * at most `step`.
 * @param {Float64Array} alphas - current alphas, updated in place
 * @param {Uint8Array} flags - highlight flags parallel to `alphas`
 * @param {number} dim - target alpha for non-highlighted elements
 * @param {number} step - largest alpha change allowed
 * @returns {boolean} whether every alpha has reached its target
 */
const stepAlphas = (alphas, flags, dim, step) => {
  let settled = true;
  for (let i = 0; i < alphas.length; i++) {
    const target = flags[i] ? 1 : dim, a = alphas[i];
    if (a === target) continue;
    let next = a < target ? Math.min(a + step, target) : Math.max(a - step, target);
    if (Math.abs(next - target) < 1e-9) next = target;   // absorb float drift
    alphas[i] = next;
    if (next !== target) settled = false;
  }
  return settled;
};


/**
 * Each element's alpha before a re-slot, keyed by its style object, which
 * survives re-slotting. `null` when alphas don't need carrying over.
 * @typedef {{ nodeAlpha: Map<object, number>, edgeAlpha: Map<object, number> } | null} HighlightSnapshot
 */


/**
 * Highlight state for the renderer: which nodes and edges are highlighted, a
 * flag per slot (parallel to the simulation's node and edge lists), and each
 * slot's current drawing alpha, which fades toward its target over time.
 *
 * Slots are resolved by the renderer, which passes them in, so this holds no
 * reference to the graph or simulation.
 */
export class Highlighter {
  /** @private @type {Set<NodeId>} */
  _nodes = new Set();
  /**
   * Ids of highlighted nodes
   * @returns {ReadonlySet<NodeId>}
   */
  get nodes() { return this._nodes; }


  /** @private @type {Set<GraphEdge>} */
  _edges = new Set();
  /**
   * Highlighted edge objects
   * @returns {ReadonlySet<GraphEdge>}
   */
  get edges() { return this._edges; }


  /** @private @type {Uint8Array} */
  _nodeState = new Uint8Array(0);
  /**
   * Highlight flag of each node slot, parallel to `Simulation.nodeList`
   * @returns {Uint8Array}
   */
  get nodeState() { return this._nodeState; }


  /** @private @type {Uint8Array} */
  _edgeState = new Uint8Array(0);
  /**
   * Highlight flag of each edge slot, parallel to `Simulation.edgeList`
   * @returns {Uint8Array}
   */
  get edgeState() { return this._edgeState; }


  /** @private @type {Float64Array} */
  _nodeAlpha = new Float64Array(0);
  /**
   * Current drawing alpha of each node slot, eased toward its target
   * @returns {Float64Array}
   */
  get nodeAlpha() { return this._nodeAlpha; }


  /** @private @type {Float64Array} */
  _edgeAlpha = new Float64Array(0);
  /**
   * Current drawing alpha of each edge slot
   * @returns {Float64Array}
   */
  get edgeAlpha() { return this._edgeAlpha; }


  /**
   * Whether any element's alpha may still differ from its target. Set by
   * anything that changes targets; cleared once a step finds all settled.
   * @type {boolean}
   * @private
   */
  _fadeActive = false;


  /**
   * Timestamp of the previous `step()`, or `null` when a fade has just
   * started.
   * @type {number | null}
   * @private
   */
  _lastFrameTime = null;


  /**
   * Returns whether anything is highlighted.
   * @returns {boolean} whether any node or edge is highlighted
   */
  has() { return this._nodes.size > 0 || this._edges.size > 0; }


  /**
   * Returns whether alphas are still changing.
   * @returns {boolean} whether a fade is in progress
   */
  isFading() { return this._fadeActive; }


  /**
   * Marks alpha targets as changed. Restarts the frame clock if no fade was
   * running, so time spent idle isn't applied to the first step.
   * @returns {void}
   */
  startFade() {
    if (this._fadeActive) return;
    this._fadeActive = true;
    this._lastFrameTime = null;
  }


  /**
   * Target alpha for non-highlighted elements: 1 with no highlight, 0 when
   * hiding, otherwise `alpha`.
   * @param {HighlightMode} mode - highlight mode
   * @param {number} alpha - alpha of dimmed elements
   * @returns {number} target alpha
   */
  dimmedAlpha(mode, alpha) {
    if (!this.has()) return 1;
    return mode === "hide" ? 0 : alpha;
  }


  /**
   * Highlights a node.
   * @param {NodeId} id - node id
   * @param {number} i - the node's slot
   * @returns {void}
   */
  addNode(id, i) {
    this._nodeState[i] = 1;
    this._nodes.add(id);
  }


  /**
   * Highlights an edge.
   * @param {GraphEdge} edge - edge object
   * @param {number} i - the edge's slot
   * @returns {void}
   */
  addEdge(edge, i) {
    this._edgeState[i] = 1;
    this._edges.add(edge);
  }


  /**
   * Unhighlights a node.
   * @param {NodeId} id - node id
   * @param {number | undefined} i - the node's slot, if it has one
   * @returns {void}
   */
  removeNode(id, i) {
    this._nodes.delete(id);
    if (i !== undefined) this._nodeState[i] = 0;
  }


  /**
   * Unhighlights an edge.
   * @param {GraphEdge} edge - edge object
   * @param {number | undefined} i - the edge's slot, if it has one
   * @returns {void}
   */
  removeEdge(edge, i) {
    this._edges.delete(edge);
    if (i !== undefined) this._edgeState[i] = 0;
  }


  /**
   * Unhighlights everything.
   * @returns {void}
   */
  clear() {
    this._nodes.clear();
    this._nodeState.fill(0);
    this._edges.clear();
    this._edgeState.fill(0);
  }


  /**
   * Records each element's alpha before a re-slot, so survivors keep theirs.
   * Only needed while something is highlighted or fading; otherwise every
   * alpha equals its target anyway.
   * @param {ReadonlyArray<object>} nodeStyles - node style objects, in slot order
   * @param {ReadonlyArray<object>} edgeStyles - edge style objects, in slot order
   * @returns {HighlightSnapshot} alphas keyed by style object, or `null`
   */
  snapshot(nodeStyles, edgeStyles) {
    if (!this._fadeActive && !this.has()) return null;
    return {
      nodeAlpha: new Map(nodeStyles.map((s, i) => [s, this._nodeAlpha[i]])),
      edgeAlpha: new Map(edgeStyles.map((s, i) => [s, this._edgeAlpha[i]])),
    };
  }


  /**
   * Forgets a node that no longer exists.
   * @param {NodeId} id - node id
   * @returns {void}
   */
  forgetNode(id) { this._nodes.delete(id); }


  /**
   * Forgets an edge that no longer exists.
   * @param {GraphEdge} edge - edge object
   * @returns {void}
   */
  forgetEdge(edge) { this._edges.delete(edge); }


  /**
   * Rebuilds the per-slot flags and alphas after the simulation's slots
   * changed. Survivors keep their alpha from `snap`; new elements start at
   * their target.
   * @param {HighlightSnapshot} snap - alphas from `snapshot()`
   * @param {ReadonlyArray<{ id: NodeId }>} nodeList - the simulation's nodes, in slot order
   * @param {ReadonlyArray<GraphEdge>} edgeList - the simulation's edges, in slot order
   * @param {ReadonlyArray<object>} nodeStyles - node style objects, in slot order
   * @param {ReadonlyArray<object>} edgeStyles - edge style objects, in slot order
   * @param {HighlightMode} mode - highlight mode
   * @param {number} alpha - alpha of dimmed elements
   * @returns {void}
   */
  reslot(snap, nodeList, edgeList, nodeStyles, edgeStyles, mode, alpha) {
    this._nodeState = new Uint8Array(nodeList.length);
    for (const [i, node] of nodeList.entries()) {
      this._nodeState[i] = this._nodes.has(node.id) ? 1 : 0;
    }
    this._edgeState = new Uint8Array(edgeList.length);
    for (const [i, edge] of edgeList.entries()) {
      this._edgeState[i] = this._edges.has(edge) ? 1 : 0;
    }

    const dim = this.dimmedAlpha(mode, alpha);
    this._nodeAlpha = new Float64Array(nodeStyles.length);
    for (const [i, style] of nodeStyles.entries()) {
      this._nodeAlpha[i] = snap?.nodeAlpha.get(style) ?? (this._nodeState[i] ? 1 : dim);
    }
    this._edgeAlpha = new Float64Array(edgeStyles.length);
    for (const [i, style] of edgeStyles.entries()) {
      this._edgeAlpha[i] = snap?.edgeAlpha.get(style) ?? (this._edgeState[i] ? 1 : dim);
    }
    if (snap) this.startFade();
  }


  /**
   * Every alpha as it will be once fading ends, leaving the current alphas
   * alone. The current arrays when no fade is running, otherwise new ones.
   * @param {HighlightMode} mode - highlight mode
   * @param {number} alpha - alpha of dimmed elements
   * @returns {{ nodeAlpha: Float64Array, edgeAlpha: Float64Array }} alphas,
   *    parallel to `nodeState` and `edgeState`
   */
  settledAlphas(mode, alpha) {
    if (!this._fadeActive) return { nodeAlpha: this._nodeAlpha, edgeAlpha: this._edgeAlpha };
    const dim = this.dimmedAlpha(mode, alpha);
    return {
      nodeAlpha: Float64Array.from(this._nodeState, f => (f ? 1 : dim)),
      edgeAlpha: Float64Array.from(this._edgeState, f => (f ? 1 : dim)),
    };
  }


  /**
   * Advances every alpha toward its target.
   * @param {number} time - frame timestamp in milliseconds
   * @param {number} duration - milliseconds to fade fully between 0 and 1;
   *    0 switches instantly
   * @param {HighlightMode} mode - highlight mode
   * @param {number} alpha - alpha of dimmed elements
   * @returns {void}
   */
  step(time, duration, mode, alpha) {
    const dt = this._lastFrameTime === null ? 0 : time - this._lastFrameTime;
    this._lastFrameTime = time;
    if (!this._fadeActive) return;

    const stepSize = duration > 0 ? Math.max(dt, 0) / duration : Infinity;
    const dim = this.dimmedAlpha(mode, alpha);
    const nodesSettled = stepAlphas(this._nodeAlpha, this._nodeState, dim, stepSize);
    const edgesSettled = stepAlphas(this._edgeAlpha, this._edgeState, dim, stepSize);
    if (nodesSettled && edgesSettled) this._fadeActive = false;
  }
}
