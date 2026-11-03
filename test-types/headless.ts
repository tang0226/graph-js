/* Compile-only test of the headless entry points, built without the DOM lib
   (see tsconfig.headless.json), the way a Node-only consumer would. Fails if
   the graph or simulation declarations reach any DOM type. */
import { Graph } from "@tang0226/graph-js/graph";
import { Simulation } from "@tang0226/graph-js/simulation";

const graph = new Graph({ directed: false });
graph.addNode({ id: "a" });
graph.addNode({ id: "b" });
graph.addEdge("a", "b");

const sim = new Simulation(graph, { collision: "grid", nodeConfig: { radius: n => 5 } });
sim.tick().tick();
const temp: number = sim.temp;
const pos: [number, number] | null = sim.getPosition("a");

export {};
