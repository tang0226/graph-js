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
  NodeAccessor, NodeOption, EdgeAccessor, EdgeOption,
  SimOpts, SimOptsInput, CollisionMethod, SimNode, SimNodeConfig, SimEdge, SimEdgeConfig,
  BarnesHutOpts, BarnesHutOptsInput,
  Canvas, CanvasContext, LabelPosition, HighlightMode,
  RendererOptsInput, RendererOpts, Size, View,
  NodeStyle, EdgeStyle, NodeStyleConfig, EdgeStyleConfig,
  RendererHookType, RendererHook,
  GraphJSOpts, GraphJSHookType, GraphJSHook,
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

// Internal members are private, so consumers can't depend on them
// @ts-expect-error -- private
gjs.simulation._temp;
// @ts-expect-error -- private
r._hooks;
// @ts-expect-error -- private
gjs._frame(0);

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
