/* Compile-only test of the headless entry points, built without the DOM lib
   (see tsconfig.headless.json), the way a Node-only consumer would. Fails if
   the graph or simulation declarations reach any DOM type. */
import { Graph } from "@tang0226/graph-js/graph";
import { Simulation } from "@tang0226/graph-js/simulation";
import { Tween, easings } from "@tang0226/graph-js/tween";

const graph = new Graph({ directed: false });
graph.addNode({ id: "a" });
graph.addNode({ id: "b" });
graph.addEdge("a", "b");

const sim = new Simulation(graph, { collision: "grid", nodeConfig: { radius: n => 5 } });
sim.tick().tick();
const temp: number = sim.temp;
const pos: [number, number] | null = sim.getPosition("a");

// Tweens run without a canvas, driven by any loop
const node = sim.nodes.get("a");
const tween = new Tween({
  set: ([x, y]) => { if (node) { node.x = x; node.y = y; } },
  from: [0, 0], to: [100, 50], duration: 500, ease: easings.outQuad,
});
const done: boolean = tween.step(16);

export {};
