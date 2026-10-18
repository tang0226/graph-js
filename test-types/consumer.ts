/* Compile-only test of the published declarations, written the way a
   TypeScript consumer would use the package. Nothing here runs: it passes if
   `tsc` accepts every line, and each `@ts-expect-error` must really error.

   Catches regressions that runtime tests cannot, because the JS behaves
   correctly while the emitted types are wrong. */
import { GraphJS, Graph, Renderer } from "../types/index.js";
import { Simulation } from "../types/simulation.js";   // headless subpath

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

// Graph mutators forward their results; an id can be passed through the facade
const a: any = gjs.addNode({ label: "a" });
gjs.addNode({ id: "b", group: 1 }, "b");
const added: boolean = gjs.addEdge(a, "b");
const removed: boolean = gjs.removeEdge(a, "b");
const directed: boolean = gjs.graph.directed;

// Chainable methods return the facade, never an inner layer
gjs.resize().stop().step();
gjs.unpin("b").stop();

// getPosition may be null for an unknown id
const p = gjs.getPosition("b");
// @ts-expect-error -- possibly null
p[0];
if (p) { const [x, y]: [number, number] = p; }

// Config cascade: constants or accessors receiving the graph element
gjs.simulation.setDefaultNodeConfig({ mass: 2, radius: n => 5 + n.data.group, fixed: false });
gjs.simulation.setNodeConfig("b", { fixed: true });
gjs.renderer.setDefaultNodeConfig({ color: n => (n.data.group === 1 ? "#f00" : "#0f0") });
gjs.renderer.setDefaultEdgeConfig({ width: e => (e.src.id === "a" ? 2 : 1) });

// Renderer stores persistent settings only; setup values are not kept
const r: Renderer = gjs.renderer;
const bg: string = r.opts.background;
// @ts-expect-error -- canvas is a setup value, not stored in opts
r.opts.canvas;

// Layers are usable on their own
const sim: Simulation = new Simulation(new Graph(), {});
sim.tick().tick();

// Image request options use the DOM's own types, so invalid values are rejected
new GraphJS({ renderer: { crossOrigin: null, imageReferrerPolicy: "origin" } });
// @ts-expect-error -- misspelled policy (the HTTP header is "Referer", the values aren't)
new GraphJS({ renderer: { imageReferrerPolicy: "no-referer" } });
// @ts-expect-error -- not a crossOrigin value
new GraphJS({ renderer: { crossOrigin: "anon" } });

export {};
