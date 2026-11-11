/* Compile-only test of the published declarations, written the way a
   TypeScript consumer would use the package. Nothing here runs: it passes if
   `tsc` accepts every line, and each `@ts-expect-error` must really error.

   Catches regressions that runtime tests cannot, because the JS behaves
   correctly while the emitted types are wrong.

   Imports use the package's own name, so they resolve through the `exports`
   map in package.json, as they would for a real consumer. */
import { GraphJS, Graph, Renderer, Tween, easings } from "@tang0226/graph-js";
import { Simulation } from "@tang0226/graph-js/simulation";   // headless subpath
// Public types, re-exported from the package root
import type {
  NodeId, NodeData, GraphNode, GraphEdge, GraphOpts,
  GraphNodeEventData, GraphEdgeEventData, GraphDataChangeEventData,
  GraphEventMap, GraphEventType, GraphEvent, GraphListener,
  NodeAccessor, NodeOption, EdgeAccessor, EdgeOption,
  SimOpts, SimOptsInput, CollisionMethod, SimNode, SimNodeConfig, SimEdge, SimEdgeConfig,
  BarnesHutOpts, BarnesHutOptsInput,
  SimEventMap, SimEventType, SimEvent, SimListener,
  Canvas, CanvasContext, LabelPosition, HighlightMode,
  RendererOptsInput, RendererOpts, Size, View,
  NodeStyle, EdgeStyle, NodeStyleConfig, EdgeStyleConfig,
  RendererHookType, RendererHook,
  GraphJSOpts, GraphJSHookType, GraphJSHook,
  GraphJSPointerEventData, GraphJSNodeEventData, GraphJSMoveEventData, GraphJSViewEventData, GraphJSEventMap, GraphJSEventType, GraphJSEvent, GraphJSListener,
  InteractionOptsInput, InteractionOpts,
  TweenValue, TweenUnit, Easing, EasingName, TweenOpts,
} from "@tang0226/graph-js";

// Constructor: every argument optional, options are each layer's input shape
new GraphJS();
const gjs = new GraphJS({
  graph: { directed: true },
  simulation: { friction: 0.8, nodeConfig: { mass: 2 } },
  renderer: { background: "#000", nodeConfig: { color: "red" } },
});
// @ts-expect-error -- unknown option
new GraphJS({ graph: { notAnOption: 1 } });

// @ts-expect-error -- simulation options are type-checked too
new GraphJS({ simulation: { friction: "high" } });

// The collision method is one of three names
gjs.simulation.setOpts({ collision: "grid" });
gjs.simulation.setOpts({ collision: "barnesHut", useBarnesHut: false });
const method: "grid" | "barnesHut" | "pairs" = gjs.simulation.opts.collision;
// @ts-expect-error -- not a collision method
gjs.simulation.setOpts({ collision: "quadtree" });

// Graph mutators forward their results; an id can be passed through the facade
const a: any = gjs.addNode({ label: "a" });
gjs.addNode({ id: "b", group: 1 }, "b");
const added: boolean = gjs.addEdge(a, "b");
const removed: boolean = gjs.removeEdge(a, "b");
const directed: boolean = gjs.graph.directed;

// Chainable methods return the facade, never an inner layer
gjs.resize().stop().step();
gjs.unpin("b").stop();

// nodeAt takes an optional slack in canvas pixels, on the facade and the renderer
gjs.nodeAt(10, 10);
gjs.nodeAt(10, 10, 12);
gjs.renderer.nodeAt(10, 10, 12);
// @ts-expect-error -- slack is a number
gjs.nodeAt(10, 10, "12");

// getPosition may be null for an unknown id
const p = gjs.getPosition("b");
// @ts-expect-error -- possibly null
p[0];
if (p) { const [x, y]: [number, number] = p; }

// Config cascade: constants or accessors receiving the graph element
gjs.simulation.setDefaultNodeConfig({ mass: 2, radius: n => 5 + n.data.group, fixed: false });
gjs.simulation.setNodeConfig("b", { fixed: true });
gjs.simulation.setDefaultEdgeConfig({ length: e => 30 + e.data.weight, stiffness: 0.3 });
gjs.simulation.setEdgeConfig("a", "b", { stiffness: 0.5 });
const edgeSpring = gjs.simulation.getEdgeSpring("a", "b");
// @ts-expect-error -- possibly null
edgeSpring.length;
if (edgeSpring) { const { length, stiffness }: SimEdge = edgeSpring; }
gjs.simulation.setOpts({ edgeConfig: { length: 80 } });
const springLen: EdgeOption<number> = gjs.simulation.defaultEdgeConfig.length;
// @ts-expect-error -- spring settings moved from opts to edgeConfig
gjs.simulation.setOpts({ springLength: 80 });
gjs.renderer.setDefaultNodeConfig({ color: n => (n.data.group === 1 ? "#f00" : "#0f0") });
gjs.renderer.setDefaultEdgeConfig({ width: e => (e.src.id === "a" ? 2 : 1) });

// Renderer stores persistent settings only; setup values are not kept
const r: Renderer = gjs.renderer;
const bg: string = r.opts.background;
// @ts-expect-error -- canvas is a setup value, not stored in opts
r.opts.canvas;

// The view reads back complete, though it can be assigned in part
const zoom: number = r.view.zoom;
r.view = { zoom: 2 };

// Hooks: typed arguments, chainable add, boolean remove, and only known types
const ring = (hr: Renderer, time: number) => { hr.ctx?.arc(0, 0, time, 0, 1); };
const stillAdded: boolean = r.addHook("overlay", ring).addHook("background", ring).removeHook("overlay", ring);
r.addHook("overlay", (hr, time) => { const t: number = time; const zoom: number = hr.view.zoom; });
// @ts-expect-error -- not a hook type
r.addHook("foreground", ring);
// @ts-expect-error -- a hook receives a renderer, not a context
r.addHook("overlay", (ctx: CanvasRenderingContext2D) => {});

// Loop hooks: typed arguments, chainable add, boolean remove, and only known types
const timed = (g: GraphJS, time: number) => { const running: boolean = g.isRunning(); };
const loopRemoved: boolean = gjs.addHook("preTick", timed).addHook("postRender", timed).removeHook("preTick", timed);
gjs.addHook("postTick", (g, time) => { const t: number = time; const temp: number = g.simulation.temp; });
// @ts-expect-error -- renderer hook types aren't loop hook types
gjs.addHook("overlay", timed);
// @ts-expect-error -- a loop hook receives the GraphJS instance, not a renderer
gjs.addHook("postRender", (hr: Renderer) => { hr.view.zoom; });

// Events: the listener's event is typed by its name, on chains, off returns a boolean
const onClick = (e: GraphJSEvent<"nodeclick">) => {
  const id: NodeId = e.id;
  const [x, y]: [number, number] = [e.x, e.y];
  const dom: MouseEvent = e.originalEvent;
  const type: "nodeclick" = e.type;
  const owner: GraphJS = e.target;
  if (!e.defaultPrevented) e.preventDefault();
};
const listenerRemoved: boolean = gjs.on("nodeclick", onClick).on("nodedrag", e => { e.id; }).off("nodeclick", onClick);
gjs.on("backgroundclick", e => { const x: number = e.x; });
// @ts-expect-error -- background clicks have no node
gjs.on("backgroundclick", e => { e.id; });
// View events carry the view they move to; pan also carries the pointer's movement
gjs.on("pan", e => { const [dx, dy]: [number, number] = [e.dx, e.dy]; const z: number = e.view.zoom; e.preventDefault(); });
gjs.on("panstart", e => { const v: Readonly<View> = e.view; });
gjs.on("zoom", e => { const wheel: MouseEvent = e.originalEvent; const z: number = e.view.zoom; });
// @ts-expect-error -- only pan events carry movement
gjs.on("panend", e => { e.dx; });
gjs.on("nodedrag", e => { const [dx, dy]: [number, number] = [e.dx, e.dy]; const id: NodeId = e.id; });
// @ts-expect-error -- only drag moves carry movement, not their start
gjs.on("nodedragstart", e => { e.dx; });
gjs.on("nodepress", e => { const pressed: NodeId = e.id; const at: number = e.x; e.preventDefault(); });
// @ts-expect-error -- a press has no movement
gjs.on("nodepress", e => { e.dx; });
// @ts-expect-error -- the event's view is read-only
gjs.on("zoom", e => { e.view.zoom = 2; });
// @ts-expect-error -- not an event name
gjs.on("click", () => {});
// @ts-expect-error -- a nodeclick listener can't be added for another event's type
gjs.on("backgroundclick", onClick);
// @ts-expect-error -- the event is read-only
gjs.on("nodeclick", e => { e.type = "nodeclick"; });

// View: read-only view, chainable changes, and computed views to apply later
const viewNow: Readonly<View> = gjs.view;
// @ts-expect-error -- the view is changed through setView and the view methods
gjs.view.zoom = 2;
gjs.setView({ zoom: 2 }).panBy(10, -5).zoomTo(1.5).zoomTo(2, 100, 100).zoomBy(1.2).zoomBy(0.8, 50, 50).stop();
const target: View = gjs.viewZoomedTo(3, 400, 300);
const panned: View = gjs.viewPannedBy(20, 0);
gjs.tween({ set: ([x, y, z]) => gjs.setView({ x, y, zoom: z }), from: [viewNow.x, viewNow.y, viewNow.zoom], to: [target.x, target.y, target.zoom], duration: 400 });
// @ts-expect-error -- a pan needs both distances
gjs.panBy(10);
// The same methods on the Renderer chain the Renderer
const rChained: Renderer = r.setView({ x: 1 }).panBy(1, 1).zoomTo(2).zoomBy(1.1, 10, 10);
const rTarget: View = r.viewZoomedTo(2, 10, 10);
const rPanned: View = r.viewPannedBy(5, 5);

// Interaction: opt-in by option or method, with typed options
new GraphJS({ interaction: true });
new GraphJS({ interaction: { dragNodes: false, dragThreshold: 6, maxZoom: Infinity } });
// @ts-expect-error -- not an interaction option
new GraphJS({ interaction: { scrollZoom: true } });
// @ts-expect-error -- a threshold is a number
gjs.enableInteraction({ dragThreshold: "4px" });
const interactive: boolean = gjs.enableInteraction({ zoom: false }).disableInteraction().isInteractive();
const iOpts: Readonly<InteractionOpts> | null = gjs.interactionOpts;
// @ts-expect-error -- possibly null while interaction is off
gjs.interactionOpts.zoom;
const iInput: InteractionOptsInput = { pan: false };
// @ts-expect-error -- the Interaction instance is internal
gjs._interaction;

// Graph events live on the graph, and are typed by name
const onAdd = (e: GraphEvent<"nodeadd">) => { const id: NodeId = e.id; const node: GraphNode = e.node; const g: Graph = e.target; };
const onEdge: GraphListener<"edgeadd" | "edgeremove"> = e => { const edge: GraphEdge = e.edge; const t: GraphEventType = e.type; };
gjs.graph.on("nodeadd", onAdd).on("edgeadd", onEdge).on("edgeremove", onEdge);
gjs.graph.on("edgedatachange", e => { const d: GraphEdgeEventData & GraphDataChangeEventData = e; });
const nodeEventData: GraphNodeEventData = { id: "a", node: { id: "a", data: {} } };
const graphMap: GraphEventMap["nodedatachange"] = { ...nodeEventData, prev: {} };
// @ts-expect-error -- a removed node has no previous data
gjs.graph.on("noderemove", e => { e.prev; });
// @ts-expect-error -- graph events aren't on the facade
gjs.on("nodeadd", () => {});

// Simulation events live on the simulation, not the facade
const onSettle = (e: SimEvent<"settle">) => { const s: Simulation = e.target; };
const simListener: SimListener<"wake"> = e => { const k: SimEventType = e.type; };
gjs.simulation.on("settle", onSettle).on("wake", simListener);
const simEvents: SimEventMap = { settle: {}, wake: {} };
// @ts-expect-error -- the facade's events are interaction events
gjs.on("settle", () => {});
// @ts-expect-error -- emitting is internal to the simulation
gjs.simulation._emit("settle", {});

// Internal members are private, so consumers can't depend on them
// @ts-expect-error -- private
gjs.simulation._temp;
// @ts-expect-error -- private
r._hooks;
// @ts-expect-error -- private
gjs._frame(0);
// @ts-expect-error -- private
gjs._emit("nodeclick", { id: "a", x: 0, y: 0, originalEvent: new MouseEvent("click") });

// Layers are usable on their own
const sim: Simulation = new Simulation(new Graph(), {});
sim.tick().tick();

// Public types are importable from the package root, and match what the API uses
const opts: GraphJSOpts = { simulation: { collision: "pairs" }, renderer: { background: "#fff" } };
new GraphJS(opts);
const collision: CollisionMethod = "grid";
// @ts-expect-error -- not a collision method
const badCollision: CollisionMethod = "quadtree";
const radius: NodeOption<number> = n => n.data.size;
const width: EdgeOption<number> = 2;
const nodeConfig: SimNodeConfig = { radius, fixed: false };
const edgeConfig: SimEdgeConfig = { length: e => e.data.distance, stiffness: 0.2 };
const style: NodeStyleConfig = { color: "red" };
const edgeStyle: EdgeStyleConfig = { width };
const simOpts: Readonly<SimOpts> = gjs.simulation.opts;
const rendererOpts: Readonly<RendererOpts> = r.opts;
const view: View = r.view;
const simNode: SimNode | undefined = gjs.simulation.nodes.get("b");
const hookType: RendererHookType = "overlay";
const hook: RendererHook = ring;
const loopType: GraphJSHookType = "postTick";
const loopHook: GraphJSHook = timed;
const eventType: GraphJSEventType = "nodedragend";
// Event data pieces each hold one concern, and events combine them
const pointerData: GraphJSPointerEventData = { x: 0, y: 0, originalEvent: new MouseEvent("click") };
const nodeData: GraphJSNodeEventData = { id: "a" };
const move: GraphJSMoveEventData = { dx: 1, dy: 2 };
const viewData: GraphJSViewEventData = { view: { x: 0, y: 0, zoom: 1 } };
// @ts-expect-error -- pieces don't overlap: movement has no pointer position
const movePosition: GraphJSMoveEventData = { x: 0, y: 0, dx: 1, dy: 2 };
const clickData: GraphJSEventMap["nodeclick"] = { ...pointerData, ...nodeData };
const panData: GraphJSEventMap["pan"] = { ...pointerData, ...viewData, ...move };
const nodeDragData: GraphJSEventMap["nodedrag"] = { ...pointerData, ...nodeData, ...move };
// @ts-expect-error -- a drag event needs its movement
const stillData: GraphJSEventMap["nodedrag"] = clickData;
const bgClickData: GraphJSEventMap["backgroundclick"] = pointerData;
// @ts-expect-error -- a background click has no node
const bgClick: GraphJSEventMap["backgroundclick"] = { x: 0, y: 0, originalEvent: new MouseEvent("click"), id: "a" };
// One handler can serve both drags through the shared movement piece
const onMove = (e: GraphJSEvent<"pan" | "nodedrag">) => { const m: GraphJSMoveEventData = e; const p: GraphJSPointerEventData = e; };
gjs.on("pan", onMove).on("nodedrag", onMove);
// A handler for every node event reads the node piece
const onNode = (e: GraphJSEvent<"nodeenter" | "nodeleave" | "nodeclick">) => { const id: NodeId = e.id; };
gjs.on("nodeenter", onNode).on("nodeleave", onNode).on("nodeclick", onNode);
const listener: GraphJSListener<"nodeclick"> = onClick;
const anyListener: GraphJSListener = e => { const t: GraphJSEventType = e.type; const ev: GraphJSEvent = e; };

// Tweens: the setter gets a number for number tweens, an array for array tweens
new GraphJS({ tweenUnit: "frames" });
// @ts-expect-error -- not a tween unit
new GraphJS({ tweenUnit: "seconds" });
const zoomTween: Tween<number> = gjs.tween({
  set: z => { const n: number = z; r.view = { zoom: n }; },
  from: () => r.view.zoom, to: 2, duration: 300, ease: "outCubic", key: "zoom",
});
gjs.tween({
  set: v => { const xy: number[] = v; },
  from: [0, 0], to: [10, 10], duration: 30, unit: "frames", repeat: Infinity, yoyo: true,
  onFinish: () => {},
});
// @ts-expect-error -- from and to must have the same shape
gjs.tween({ set: () => {}, from: [0, 0], to: 1, duration: 10 });
// @ts-expect-error -- not a built-in easing
gjs.tween({ set: () => {}, from: 0, to: 1, duration: 10, ease: "bouncy" });
const ended: Promise<boolean> = zoomTween.cancel().finish().finished;
const isDone: boolean = zoomTween.done;
const active: Tween<any> | null = gjs.getTween("zoom");
const cancelled: boolean = gjs.cancelTween("zoom");
const tweening: boolean = gjs.cancelAllTweens().stepTweens(16).isTweening();
const ease: Easing = easings.inOutQuad;
const easeName: EasingName = "outBack";
const unit: TweenUnit = "ms";
const value: TweenValue = [1, 2];
const tweenOpts: TweenOpts<number> = { set: n => {}, from: 0, to: 1, duration: 10 };
new Tween(tweenOpts).step(16);

// Image request options use the DOM's own types, so invalid values are rejected
new GraphJS({ renderer: { crossOrigin: null, imageReferrerPolicy: "origin" } });
// @ts-expect-error -- misspelled policy (the HTTP header is "Referer", the values aren't)
new GraphJS({ renderer: { imageReferrerPolicy: "no-referer" } });
// @ts-expect-error -- not a crossOrigin value
new GraphJS({ renderer: { crossOrigin: "anon" } });

export {};
