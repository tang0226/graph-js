/* Compile-only test of the headless entry points, built without the DOM lib
   (see tsconfig.headless.json), the way a Node-only consumer would. Fails if
   the graph or simulation declarations reach any DOM type. */
import { Graph } from "@tang0226/graph-js/graph";
import { Simulation } from "@tang0226/graph-js/simulation";
import { Tween, easings } from "@tang0226/graph-js/tween";
// Internal, so not a package subpath: imported by path to check it stays DOM-free
// for the headless layers that will extend it
import { Emitter } from "../types/emitter.js";

const graph = new Graph({ directed: false });

// Graph events work without the DOM, and are typed by name
graph.on("nodeadd", e => { const n: number = e.target.nodes.size; e.node.data; })
  .on("edgeremove", e => { e.srcId; e.destId; e.edge.src.id; })
  .on("nodedatachange", e => { const before: unknown = e.prev; });
// @ts-expect-error -- node events have no edge
graph.on("noderemove", e => { e.edge; });
// @ts-expect-error -- not a graph event
graph.on("settle", () => {});
graph.addNode({ id: "a" });
graph.addNode({ id: "b" });
graph.addEdge("a", "b");

const sim = new Simulation(graph, { collision: "grid", nodeConfig: { radius: n => 5 } });
sim.tick().tick();
const temp: number = sim.temp;

// Simulation events work without the DOM, and are typed by name
sim.on("settle", e => { const s: Simulation = e.target; const t: number = s.temp; }).on("wake", e => {});
const offRemoved: boolean = sim.off("settle", () => {});
// @ts-expect-error -- not a simulation event
sim.on("nodeclick", () => {});
const pos: [number, number] | null = sim.getPosition("a");

// Tweens run without a canvas, driven by any loop
const node = sim.nodes.get("a");
const tween = new Tween({
  set: ([x, y]) => { if (node) { node.x = x; node.y = y; } },
  from: [0, 0], to: [100, 50], duration: 500, ease: easings.outQuad,
});
const done: boolean = tween.step(16);

// A headless class can emit typed events
class Counter extends Emitter<{ change: { to: number } }, Counter> {
  constructor() { super(["change"], "Counter"); }
  set(to: number) { return this._emit("change", { to }); }
}
const counter = new Counter().on("change", e => { const to: number = e.to; const self: Counter = e.target; });
// @ts-expect-error -- not one of its events
counter.on("reset", () => {});
// @ts-expect-error -- emitting is for the subclass only
counter._emit("change", { to: 1 });

export {};
