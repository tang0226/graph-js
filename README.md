# graph-js

Graph building, physics simulation, and canvas rendering for the browser.

```bash
npm install @tang0226/graph-js
```

## Quick start

```html
<canvas id="graph" style="width: 100%; height: 400px"></canvas>
```

```js
import { GraphJS } from "@tang0226/graph-js";

const canvas = document.getElementById("graph");
const gjs = new GraphJS({ canvas });

gjs.addNode({ id: "a" });
gjs.addNode({ id: "b" });
gjs.addNode({ id: "c" });
gjs.addEdge("a", "b");
gjs.addEdge("b", "c");

gjs.start();
```

## Creating a GraphJS

All parameters are optional. Each layer's options are passed under that layer's key.

```js
const gjs = new GraphJS({
  canvas,                           // or attach one later

  graph: {
    directed: true,                 // default false; cannot be changed after instantiation
  },

  simulation: {                     // the following are the same as the default values
    friction: 0.9,                  // fraction of velocity kept each tick
    repulsion: 1000,                // how strongly nodes push apart
    springLength: 50,               // resting length of edges
    springStiffness: 0.15,          // how strongly edges hold their resting length
    gravity: 0.002,                 // pull toward the center
    nodeConfig: { radius: 20 },     // default physical settings for nodes
  },

  renderer: {
    background: "#ffffff",
    nodeConfig: { color: "#61afef" },
    edgeConfig: { color: "#999999", width: 2 },
  },
});
```

### Attaching a canvas

A `GraphJS` instance can be created without a canvas. The canvas element can be attached any time after instantiation.

```js
const gjs = new GraphJS();
gjs.addNode({ id: "a" });

// once the canvas is on the page
gjs.attach(canvas).start();

// when the canvas goes away; this also stops the animation
gjs.detach();
```

## Adding and removing nodes and edges

```js
// Provide an id in the data object, or as the second argument.
gjs.addNode({ id: "alice", group: 1 });
gjs.addNode({ name: "Bob" }, "bob");

// With neither, an id is generated and returned.
const carol = gjs.addNode({ name: "Carol" });

gjs.addEdge("alice", "bob");       // true
gjs.addEdge("alice", "bob");       // false: that edge already exists
gjs.addEdge("bob", carol);

gjs.removeEdge("bob", carol);
gjs.removeNode(carol);             // also removes any edges it still has
```

`addEdge` throws if either node doesn't exist. Removing a node or edge that doesn't exist returns `false`.

In an undirected graph, `"a"` to `"b"` and `"b"` to `"a"` are the same edge. In a directed graph they're two edges, drawn as a pair of curved arrows.

## Configuring nodes and edges

Every setting takes either a fixed value, or a function that yields a value for each node or edge:

```js
// Physical settings belong to the simulation.
gjs.simulation.setDefaultNodeConfig({
  radius: node => 10 + 2 * gjs.graph.degree(node.id),   // more connections = larger
  mass: 1,
});

// Style settings belong to the renderer.
gjs.renderer.setDefaultNodeConfig({
  color: node => (node.data.group === 1 ? "#e06c75" : "#61afef"),
  outlineColor: "#222222",
  outlineWidth: 2,
});

gjs.renderer.setDefaultEdgeConfig({
  color: "#999999",
  width: edge => edge.data.weight ?? 1,
});
```

A function receives the node or edge object with custom data stored in `.data`. Whenever the graph changes, the function is re-run and the results are cached. That keeps the `radius` above in step as connections are added.

To change a node's data, use `gjs.graph.setNodeData(id, data)` rather than editing `node.data` directly. Direct edits will not trigger a cache refresh, so the functions won't re-run. Same applies to `gjs.graph.setEdgeData(srcId, destId, data)`.

### Individual node and edge settings

```js
gjs.renderer.setNodeConfig("alice", { color: "gold", outlineWidth: 4 });
gjs.simulation.setNodeConfig("alice", { mass: 5 });

gjs.renderer.setEdgeConfig("alice", "bob", { color: "red" });

gjs.renderer.clearNodeConfig("alice");   // reset to defaults
```

Setting config properties merges them with previously set config. `setEdgeConfig` throws when the edge doesn't exist (in a directed graph, node id order matters).

## Dragging nodes

```js
let dragging = null;

const toCanvas = e => {
  const { left, top } = canvas.getBoundingClientRect();
  return [e.clientX - left, e.clientY - top];
};

canvas.addEventListener("pointerdown", e => {
  const [x, y] = toCanvas(e);
  dragging = gjs.nodeAt(x, y);       // node id, or null
  if (dragging !== null) canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", e => {
  if (dragging === null) return;
  const [x, y] = toCanvas(e);
  gjs.pin(dragging, x, y);    // holds the node under the pointer
});

canvas.addEventListener("pointerup", () => {
  if (dragging !== null) gjs.unpin(dragging);  // allows the node to move freely again
  dragging = null;
});
```

Other position helpers:

```js
gjs.getPosition("alice");    // [x, y] on the canvas, or null if the node doesn't exist
gjs.simToCanvas(0, 0);       // canvas coordinates of the simulation's center
gjs.canvasToSim(100, 50);    // converts the coordinates (100, 50) on the canvas to simulation space coordinates
```

These helpers, and `nodeAt()` and `pin()` above, require an attached canvas and throw without one.

## Running the animation

```js
gjs.start();        // simulate and redraw every frame
gjs.stop();         // pause
gjs.isRunning();    // true while running

gjs.step();         // tick the simulation once and draw one frame
```

`start()` does nothing until a canvas is attached.

GraphJS sizes the canvas when it's attached. If its CSS size changes later, call `resize()`:

```js
new ResizeObserver(() => gjs.resize()).observe(canvas);
```

`resize()` is safe to call even when no canvas is attached.

## Upgrading from 0.2

The constructor now takes a single options object, with the canvas inside it:

```js
// 0.2
new GraphJS(canvas, { graph: { directed: true } });

// 0.3
new GraphJS({ canvas, graph: { directed: true } });
```

The 0.2 form no longer works and won't throw: the canvas is read as the options object, so nothing is drawn. TypeScript reports it as an error.
