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

## Creating a GraphJS instance

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
    dt: 1,                          // how far each tick advances the layout (see "Settling")
    cooling: 0.98,                  // fraction of temperature kept each tick (see "Settling")
    freezePoint: 0.01,              // temperature at which the layout stops moving
    useBarnesHut: true,             // speed up repulsion on large graphs (see "Barnes-Hut")
    barnesHut: { theta: 0.9, maxDepth: 20, capacity: 1024 },  // tuning for Barnes-Hut
    collision: "grid",              // how overlapping nodes are found (see "Collisions")
    nodeConfig: { radius: 20 },     // default physical settings for nodes
  },

  renderer: {                       // the following are the same as the default values
    background: "#ffffff",
    renderEdges: true,              // set false to draw nodes only
    renderLabels: true,             // set false to hide every node label (see "Node labels")
    labelFont: "Arial",             // font family for labels
    labelPosition: "bottom",        // where node labels sit: "bottom", "top", "left" or "right"
    labelMargin: 2,                 // gap between a node and its label, in simulation units
    minLabelSize: 6,                // labels smaller than this on screen (px) are hidden
    maxLabelSize: Infinity,         // labels stop growing at this size on screen (px)
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
| | `label` | `null` | text drawn beside the node; a string or number (see below) |
| | `renderLabel` | `true` | `false` hides this node's label |
| | `labelScale` | `15` | label font size, in simulation units |
| | `labelTextColor` | `"#000000"` | |
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

### Node labels

```js
gjs.renderer.setDefaultNodeConfig({
  label: node => node.data.name ?? node.id,
  labelTextColor: "#333333",
});
gjs.renderer.setOpts({ labelPosition: "right", labelFont: "Georgia, serif" });
```

A node with a `label` of `null` or `""` has no label; `0` is drawn. `labelFont` is a font family name or list, as in CSS `font-family`.

Labels scale with the view like the nodes do: `labelScale` is the font size in simulation units. Two renderer options keep them readable at the extremes:

- `minLabelSize`: the renderer skips drawing labels at any font size below this threshold.
- `maxLabelSize`: for large labels or high zoom levels, the renderer limits a label's canvas font size to this cap.

To label only some nodes, set `renderLabel` per node. Setting `renderLabels: false` in renderer options hides all nodes, ignoring the `renderLabel` config of individual nodes.

```js
gjs.renderer.setDefaultNodeConfig({ renderLabel: node => gjs.graph.degree(node.id) >= 3 });  // only hubs
gjs.renderer.setOpts({ renderLabels: false });                                             // none at all
```

Labels are drawn on top of the nodes. When highlighting, a label fades with its node, and highlighted nodes are drawn over dimmed labels. A label stays visible while its node is just off the edge of the canvas.

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

## Dragging nodes

```js
let dragging = null;

const toCanvas = e => {
  const { left, top } = canvas.getBoundingClientRect();
  return [e.clientX - left, e.clientY - top];
};

canvas.addEventListener("pointerdown", e => {
  const [x, y] = toCanvas(e);
  dragging = gjs.nodeAt(x, y, 4);       // node id, or null; 4 CSS px of slack (default is 2)
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

## Custom drawing

Renderer hooks draw your own content as part of each frame. A `"background"` hook runs after the background is filled, beneath edges, nodes and labels. An `"overlay"` hook runs after everything else, on top. Each hook is called with the renderer and the frame's timestamp. For non-drawing per-frame code, use [loop hooks](#loop-hooks).

```js
// A grid behind the graph that pans and zooms with it, 100 simulation units apart
gjs.renderer.addHook("background", (renderer) => {
  const { ctx, size, view } = renderer;
  const step = 100 * view.zoom;
  const [x0, y0] = renderer.simToCanvas(0, 0);
  ctx.strokeStyle = "#e5e5e5";
  ctx.beginPath();
  for (let x = x0 % step; x < size.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, size.h); }
  for (let y = y0 % step; y < size.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(size.w, y); }
  ctx.stroke();
});

// A pulsing ring around one node, drawn on top
let selected = "alice";
function drawSelection(renderer, time) {
  const node = gjs.simulation.nodes.get(selected);
  if (!node) return;
  const { ctx, view } = renderer;
  const [x, y] = renderer.simToCanvas(node.x, node.y);
  ctx.strokeStyle = "#e33";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, node.radius * view.zoom + 6 + 2 * Math.sin(time / 200), 0, 2 * Math.PI);
  ctx.stroke();
}
gjs.renderer.addHook("overlay", drawSelection);

gjs.renderer.removeHook("overlay", drawSelection);   // true if it was added
```

- **Coordinates:** hooks draw in canvas coordinates (CSS pixels), the same space as `simToCanvas()` and `getPosition()`. To draw at a node or point in the graph, convert its position with `simToCanvas()` and multiply sizes by `view.zoom`.
- **Canvas state:** each hook runs between `ctx.save()` and `ctx.restore()`, so its changes to the transform, alpha, colours and so on don't affect the rest of the frame. Hooks start with the base transform and full alpha, but other properties are left over from drawing, so set every one you use.
- **Errors:** a hook that throws is logged with `console.error`, and the rest of the frame is still drawn.
- **Order:** hooks of the same type run in the order they were added, and adding the same function twice has no effect. Removing a hook needs the same function, so keep a reference to it.
- **When they run:** every time a frame is drawn, which `start()` keeps doing after the layout settles. If the animation is stopped, call `gjs.renderer.render()` after changing something a hook draws. Nothing is drawn, and no hooks run, without a canvas.
- **Only draw:** don't call `render()` or `step()` from a hook, since that runs the hooks again. Changes to the graph, config or highlighting made from a hook may not fully show until the next frame.

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

### Loop hooks

Each frame of `start()`, and each `step()`, ticks the simulation once and then draws. Loop hooks run your own code around those two steps:

| Hook | Runs |
|---|---|
| `"preTick"` | before the simulation ticks |
| `"postTick"` | after the tick, before drawing |
| `"postRender"` | after the frame is drawn |

```js
// Time each tick
let tickStart = 0, tickMs = 0;
gjs.addHook("preTick", () => { tickStart = performance.now(); });
gjs.addHook("postTick", () => { tickMs = performance.now() - tickStart; });

// Keep every node inside a 1000 x 1000 box
function keepInBox(gjs) {
  for (const node of gjs.simulation.nodeList) {
    node.x = Math.max(-500, Math.min(500, node.x));
    node.y = Math.max(-500, Math.min(500, node.y));
  }
}
gjs.addHook("postTick", keepInBox);

gjs.removeHook("postTick", keepInBox);   // true if it existed and was removed
```

- **Arguments:** each hook is called with the GraphJS instance and the frame's timestamp. That's the `requestAnimationFrame` time in the loop, or `performance.now()` for `step()`, and the renderer is given the same one.
- **When they run:** on every frame, including after the layout settles. The tick does nothing then, but `"preTick"` and `"postTick"` hooks still run.
- **Stopping:** a hook can call `stop()`. The current frame finishes, and no more are run. Don't call `step()` from a hook, since that runs the hooks again.
- **Errors and order:** these work as they do for [renderer hooks](#custom-drawing). A hook that throws is logged and the frame carries on, and hooks of a type run in the order they were added.
- **Drawing:** use renderer hooks instead. They run at a fixed point in the frame with canvas state saved and restored, while a `"postRender"` hook's changes to canvas state carry into the next frame.

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

To cover more ground in each tick, raise `dt`. Temperature still falls once per tick, so the layout freezes after the same number of ticks, but it gets closer to its final shape first, which helps most on large graphs. Values up to about 3 stay stable; above that, nodes start to jitter. Passing a value to `gjs.simulation.tick(dt)` overrides the option for that tick.

## Barnes-Hut

Every node repels every other node, so checking each pair takes 100 times as long when a graph gets 10 times larger. Barnes-Hut avoids most of that work: each tick, nodes are sorted into a quadtree (a tree of nested squares), and a distant group of nodes is treated as a single point. It's on by default, and at 20,000 nodes it calculates repulsion about 40 times faster than checking every pair.

It's controlled by two simulation options:

```js
const gjs = new GraphJS({
  simulation: {
    useBarnesHut: true,
    barnesHut: { theta: 0.9, maxDepth: 20, capacity: 1024 },  // the default values
  },
});

gjs.simulation.setOpts({ barnesHut: { theta: 0.5 } });  // can be tuned at any time
gjs.simulation.setOpts({ useBarnesHut: false });        // or switched off
```

Like other options, these wake the layout when changed. Setting `barnesHut` tunes the algorithm but doesn't turn it on; only `useBarnesHut` does that.

- **`theta`** sets how far away a group must be before it's treated as a single point. Lower values are more accurate but slower.
- **`maxDepth`** limits how many times the tree can subdivide. Nodes in a square at this depth are compared with each other directly.
- **`capacity`** is the number of tree cells allocated up front; the Barnes-Hut instance grows it automatically as needed.

For exact repulsion, set `useBarnesHut: false` instead of `theta: 0`, which gives the same forces but runs several times slower.

Only repulsion uses Barnes-Hut. Collisions have their own option (see [Collisions](#collisions)), and springs and gravity don't use the tree at all.

Graphs of up to about 20,000 nodes stay usable. Ticks are slowest at the start, while new nodes are still bunched together, and speed up as the layout spreads out. Raising `dt` (see [Settling](#settling)) helps large graphs spread further before they freeze. With `useBarnesHut: false`, a graph that size takes over a second per tick, which is enough to freeze the page.

## Collisions

After each tick, nodes that overlap are pushed apart until they just touch. A fixed or pinned node doesn't move, and the other node takes the whole push. The `collision` option chooses how overlapping nodes are found:

```js
gjs.simulation.setOpts({ collision: "grid" });       // the default
gjs.simulation.setOpts({ collision: "barnesHut" });  // recreate the Barnes-Hut quadtree
gjs.simulation.setOpts({ collision: "pairs" });      // check every pair of nodes
```

- **`"grid"`** sorts nodes into square cells about two radii wide, so each node is only checked against the cells around it. Nodes much larger than average are left out of the cells and check the area they could reach instead, so a few big nodes don't slow everything else down.
- **`"barnesHut"`** finds nearby nodes by walking the same kind of tree that repulsion uses. It works whether or not `useBarnesHut` is on, and `theta` has no effect on it.
- **`"pairs"`** checks every pair of nodes. It's the slowest on large graphs.

All three find the same overlaps, but they resolve them in a different order, so the same graph can settle slightly differently. Each tick resolves each overlapping pair once. A push can create a new overlap, which is left until the next tick, so a crowded layout can still show some overlap while it's moving.

## TypeScript

The package ships its own type declarations. Option, config, and hook types can be imported from the package root:

```ts
import { GraphJS } from "@tang0226/graph-js";
import type { GraphJSOpts, SimNodeConfig, NodeStyleConfig, RendererHook } from "@tang0226/graph-js";

const opts: GraphJSOpts = { simulation: { collision: "grid" } };
const sizes: SimNodeConfig = { radius: node => 5 + node.data.weight };
```

The graph and simulation layers can also be imported on their own, for layouts without a canvas. Their types don't depend on the DOM, so they compile in a Node project without `"dom"` in `lib`:

```ts
import { Graph } from "@tang0226/graph-js/graph";
import { Simulation } from "@tang0226/graph-js/simulation";
```

Members whose names start with `_` are internal and declared `private`, so TypeScript rejects them. Types that aren't exported from the package root are internal too, and may change between versions.

## Upgrading from 0.5

- **Internal members are `private` in the type declarations.** TypeScript code that reads or writes a member starting with `_` no longer compiles. Use the public equivalents: for example, `simulation._nodeList` is `simulation.nodeList`, `_springs` is `springs`, `_temp` is `temp`, and `_opts` is `opts`. Hooks are managed with `addHook()` and `removeHook()`. JavaScript code still runs, but internal members aren't supported and can change without notice.
- **Option and config types can be imported by name** (see [TypeScript](#typescript)). Code that extracted them with helpers like `ConstructorParameters<typeof GraphJS>[0]` can use `GraphJSOpts` and the other named types instead.

## Upgrading from 0.4

- **The layout now settles and stops.** It wakes automatically after the changes listed under [Settling](#settling). If you move nodes or change their velocities directly, call `gjs.simulation.heat()` afterwards.
- **Repulsion now uses [Barnes-Hut](#barnes-hut) by default.** Forces are approximate, so the same graph can settle slightly differently. Set `useBarnesHut: false` to check every pair of nodes as before.
- **Collisions now use a grid by default, set by the new `collision` option** (see [Collisions](#collisions)). `useBarnesHut` no longer affects collisions. Set `collision: "pairs"` to check every pair of nodes as before.
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
