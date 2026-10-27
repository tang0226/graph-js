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
    minDistSq: 100,                 // squared distance below which repulsion stops growing
    maxSpeed: 100,                  // speed limit per tick
    cooling: 0.98,                  // fraction of temperature kept each tick (see "Settling")
    freezePoint: 0.01,              // temperature at which the layout stops moving
    nodeConfig: { radius: 20 },     // default physical settings for nodes
  },

  renderer: {                       // the following are the same as the default values
    background: "#ffffff",
    renderEdges: true,              // set false to draw nodes only
    crossOrigin: "anonymous",       // crossOrigin for node image requests
    imageReferrerPolicy: "no-referrer", // referrerPolicy for node image requests
    highlightMode: "dim",           // how non-highlighted items are drawn: "dim" or "hide"
    highlightAlpha: 0.15,           // opacity of dimmed items, from 0 to 1
    highlightFadeDuration: 150,     // ms to fade fully in or out when highlighting changes; 0 for instant
    imageCacheMB: 64,               // soft memory budget for cached node image sizes
    nodeConfig: { color: "#ffffff" },
    edgeConfig: { color: "#000000", width: 1 },
  },
});
```

### Changing options

Both layers have `setOpts()`, which apply new values for specific options:

```js
gjs.simulation.setOpts({ repulsion: 2000, gravity: 0.005 });  // also wakes the layout
gjs.renderer.setOpts({ background: "#15171c", renderEdges: false });
```

`setOpts()` also accepts `nodeConfig` (and `edgeConfig` on the renderer), which are passed on to `setDefaultNodeConfig()` and `setDefaultEdgeConfig()`. The `opts` objects themselves are read-only: assigning to `gjs.simulation.opts.repulsion` directly won't wake a settled layout.

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

All the available settings:

| Layer | Setting | Default | |
|---|---|---|---|
| Simulation (nodes) | `radius` | `20` | physical and drawn radius |
| | `mass` | `1` | heavier nodes are pushed around less |
| | `fixed` | `false` | `true` holds the node in place |
| Renderer (nodes) | `color` | `"#ffffff"` | fill color |
| | `outlineColor` | `"#000000"` | |
| | `outlineWidth` | `1` | `0` for no outline |
| | `image` | `null` | image URL drawn inside the node (see below) |
| Renderer (edges) | `color` | `"#000000"` | also used for the arrowhead |
| | `width` | `1` | |
| | `arrow` | `null` | `null` follows the graph: arrows only when it's directed |
| | `arrowSize` | `10` | |
| | `bow` | `14` | how far a pair of opposite directed edges curve apart |

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

### Node images

```js
gjs.renderer.setDefaultNodeConfig({ image: node => node.data.avatar ?? null });
```

The image is scaled to cover the node and clipped to its circle. Until it loads, or if it fails to load, the node is filled with its `color` instead. Images are fetched with the renderer's `crossOrigin` and `imageReferrerPolicy` options.

To avoid nodes appearing before their images do, start the requests early:

```js
gjs.renderer.loadImage("https://example.com/alice.png");
```

Unused images are cleaned up periodically as nodes are removed, so preload shortly before the nodes that use them are added.

For speed, each image is cached at the sizes nodes are actually drawn at (from 16 to 512 pixels, already cropped to a circle), so large graphs of image nodes stay fast when zoomed out. Nodes smaller than about 6 pixels are drawn as a dot in the image's average colour. The cache is limited by the renderer's `imageCacheMB` option: the least recently drawn sizes are discarded first, and images on screen are always kept. After a fast zoom, images may look slightly soft for a frame or two while their new sizes are prepared.

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

## Panning and zooming

The renderer's `view` holds the simulation coordinates at the center of the canvas, and a zoom factor (canvas pixels per simulation unit):

```js
gjs.renderer.view.zoom = 2;                     // change one field
gjs.renderer.view = { x: 0, y: 0, zoom: 1 };    // or several at once
```

Zooming toward the cursor means keeping the point under it fixed:

```js
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const [x, y] = toCanvas(e);
  const [bx, by] = gjs.canvasToSim(x, y);
  gjs.renderer.view.zoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const [ax, ay] = gjs.canvasToSim(x, y);
  gjs.renderer.view.x += bx - ax;
  gjs.renderer.view.y += by - ay;
}, { passive: false });
```

## Highlighting

Highlighting draws selected nodes and edges normally, and everything else dimmed (or hidden). Edges are given as `[srcId, destId]` pairs.

```js
gjs.renderer.setHighlight({ nodes: ["alice", "bob"], edges: [["alice", "bob"]] });  // replaces the selection
gjs.renderer.addHighlight({ nodes: ["carol"] });                                    // adds to it

gjs.renderer.clearHighlight({ nodes: ["bob"] });   // removes only what's listed
gjs.renderer.clearHighlight();                     // removes everything: normal drawing again

gjs.renderer.hasHighlight();                       // true while anything is highlighted
gjs.renderer.highlightedNodes;                     // read-only Set of ids
```

How the rest is drawn comes from the renderer's `highlightMode` and `highlightAlpha` options. `setHighlight()` can also set them, and they stay set for later highlights:

```js
gjs.renderer.setHighlight({ nodes: results, mode: "hide" });
gjs.renderer.setOpts({ highlightMode: "dim", highlightAlpha: 0.3 });
```

Changes fade rather than switching instantly, so a quickly moving hover highlight doesn't flash the whole canvas. Each item takes up to `highlightFadeDuration` milliseconds to reach its new opacity; in `"hide"` mode, items fade out until they're invisible. Set the option to `0` to switch instantly.

`gjs.start()` keeps rendering, so fades finish on their own. If you render only on demand instead, keep calling `render()` while a fade is in progress:

```js
function redraw() {
  gjs.renderer.render();
  if (gjs.renderer.isFading()) requestAnimationFrame(redraw);
}
```

Highlights follow the graph: they survive other nodes and edges being added or removed, and a highlighted node or edge that is removed drops out of the highlight.

Edges aren't highlighted along with their nodes, so list them explicitly. For example, to highlight a node with its neighbours:

```js
function neighborhood(id) {
  const nodes = new Set([id]), edges = [];
  for (const e of gjs.graph.edges) {
    if (e.src.id !== id && e.dest.id !== id) continue;
    nodes.add(e.src.id);
    nodes.add(e.dest.id);
    edges.push([e.src.id, e.dest.id]);
  }
  return { nodes: [...nodes], edges };
}

gjs.renderer.setHighlight(neighborhood("alice"));
```

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

### Settling

The layout cools as it runs. Each tick, the simulation's temperature is multiplied by `cooling`, and forces are scaled by it. Once it drops below `freezePoint`, the nodes stop and the simulation does no more work until something wakes it. The canvas is still redrawn every frame, so panning and zooming keep working.

The layout wakes on its own when:

- nodes or edges are added or removed
- a config or data change alters a node's `radius`, `mass` or `fixed`
- options are changed with `setOpts()`
- a node is pinned somewhere new

Changes the library can't see need a manual `heat()`:

```js
const node = gjs.simulation.nodes.get("alice");
node.vx += 20;                  // a direct change to a node's position or velocity
gjs.simulation.heat();          // full temperature: the layout moves again

gjs.simulation.heat(0.3);       // a gentler nudge
gjs.simulation.temp;            // current temperature; 0 means frozen
```

## Reading graph and simulation state

The layers expose their internal state as read-only properties, for custom drawing, statistics, or hit-testing:

```js
gjs.graph.nodes;             // Map: id -> { id, data }
gjs.graph.edges;             // Set of { src, dest, data }
gjs.graph.directed;

gjs.simulation.nodes;        // Map: id -> { id, x, y, vx, vy, radius, mass, fixed, ... }
gjs.simulation.nodeList;     // the same nodes as an array
```

These properties can't be reassigned, and their collections shouldn't be changed; use `addNode()`, `setNodeConfig()`, `setNodeData()`, and the other methods instead. The one exception is a simulation node's `x`, `y`, `vx` and `vy`, which can be set directly (followed by `heat()`). Its `radius`, `mass` and `fixed` are recalculated from config, so set those with `setNodeConfig()`.

## Upgrading from 0.4

- **The layout now settles and stops.** It wakes automatically after the changes listed under [Settling](#settling). If you move nodes or change their velocities directly, call `gjs.simulation.heat()` afterwards.
- **Layer properties are read-only.** `opts`, `canvas`, `ctx`, `size`, `graph`, `simulation`, `renderer`, `nodes` and similar properties can no longer be reassigned; doing so throws a `TypeError` in modules and strict mode, and is silently ignored elsewhere. Use `setOpts()`, `attach()` and the config methods instead. `renderer.view` is the exception: it can still be assigned, and the given fields are merged in.
- **Former internal properties have public names.** For example, `simulation._nodeList` is now `simulation.nodeList`, `_edgePairs` is `edgePairs`, `renderer._nodeStyles` is `nodeStyles`, and `renderer._loadImage()` is `loadImage()`.
- **`JSON.stringify(graph)` no longer includes `directed`.** Read `graph.directed` instead.

## Upgrading from 0.2

The constructor now takes a single options object, with the canvas inside it:

```js
// 0.2
new GraphJS(canvas, { graph: { directed: true } });

// 0.3
new GraphJS({ canvas, graph: { directed: true } });
```

The 0.2 form no longer works and won't throw: the canvas is read as the options object, so nothing is drawn. TypeScript reports it as an error.
