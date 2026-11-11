# graph-js

Graph building, physics simulation, and canvas rendering for the browser.

```bash
npm install @tang0226/graph-js
```

## Contents

- [Getting started](#getting-started)
  - [Quick start](#quick-start)
  - [How it fits together](#how-it-fits-together)
  - [Creating a GraphJS instance](#creating-a-graphjs-instance)
  - [Changing options](#changing-options)
  - [Attaching and resizing the canvas](#attaching-and-resizing-the-canvas)
- [Building the graph](#building-the-graph)
  - [Adding and removing nodes and edges](#adding-and-removing-nodes-and-edges)
  - [Reading graph and simulation state](#reading-graph-and-simulation-state)
- [Configuring nodes and edges](#configuring-nodes-and-edges)
  - [Individual node and edge settings](#individual-node-and-edge-settings)
  - [Node charge](#node-charge)
  - [Node images](#node-images)
  - [Node labels](#node-labels)
  - [Edge and outline widths](#edge-and-outline-widths)
- [Running the animation](#running-the-animation)
  - [Starting and stopping](#starting-and-stopping)
  - [Loop hooks](#loop-hooks)
  - [Tweens](#tweens)
- [Interaction](#interaction)
  - [Built-in interaction](#built-in-interaction)
  - [Panning and zooming](#panning-and-zooming)
  - [Coordinates and hit-testing](#coordinates-and-hit-testing)
  - [Building your own interaction](#building-your-own-interaction)
- [Events](#events)
  - [Listening for events](#listening-for-events)
  - [Interaction events](#interaction-events)
  - [Graph events](#graph-events)
  - [Simulation events](#simulation-events)
- [Drawing](#drawing)
  - [Highlighting](#highlighting)
  - [Custom drawing](#custom-drawing)
- [Layout physics](#layout-physics)
  - [Settling](#settling)
  - [Barnes-Hut](#barnes-hut)
  - [Collisions](#collisions)
- [TypeScript](#typescript)
- [Upgrading](#upgrading)
  - [From 0.6](#from-06)
  - [From 0.5](#from-05)
  - [From 0.4](#from-04)
  - [From 0.2](#from-02)

## Getting started

### Quick start

```html
<canvas id="graph" style="width: 100%; height: 400px"></canvas>
```

```js
import { GraphJS } from "@tang0226/graph-js";

const canvas = document.getElementById("graph");
const gjs = new GraphJS({ canvas, interaction: true });   // drag nodes, pan and zoom

gjs.addNode({ id: "a" });
gjs.addNode({ id: "b" });
gjs.addNode({ id: "c" });
gjs.addEdge("a", "b");
gjs.addEdge("b", "c");

gjs.start();
```

### How it fits together

A `GraphJS` instance combines three layers, each of which can also be used on its own:

| Layer | Property | Holds |
|---|---|---|
| `Graph` | `gjs.graph` | nodes, edges, and their data |
| `Simulation` | `gjs.simulation` | the physics layout: positions, forces, and settling |
| `Renderer` | `gjs.renderer` | drawing: styles, the view, highlighting, and drawing hooks |

`GraphJS` adds the animation loop, tweens, and pointer interaction on top, along with shortcuts for common calls such as `addNode()` and `pin()`. `GraphJS`, the graph and the simulation each emit [events](#events).

### Creating a GraphJS instance

All parameters are optional. Each layer's options are passed under that layer's key.

```js
const gjs = new GraphJS({
  canvas,                           // or attach one later
  tweenUnit: "ms",                  // default unit of tweens: "ms" or "frames" (see "Tweens")
  interaction: false,               // true, or options, to drag, pan and zoom (see "Built-in interaction")

  graph: {
    directed: true,                 // default false; cannot be changed after instantiation
  },

  simulation: {                     // the following are the same as the default values
    friction: 0.9,                  // fraction of velocity kept each tick
    repulsion: 1000,                // how strongly nodes push apart
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
    edgeConfig: { length: 50, stiffness: 0.015 },  // default spring settings for edges
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
    scaleStrokes: true,             // edge and outline widths scale with zoom (see "Edge and outline widths")
    minEdgeWidth: 1,                // edges thinner than this on screen (px) fade out instead
    maxEdgeWidth: 8,                // edges stop growing at this width on screen (px)
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

`setOpts()` also accepts `nodeConfig` and `edgeConfig`, which are passed on to `setDefaultNodeConfig()` and `setDefaultEdgeConfig()`. The `opts` objects themselves are read-only: assigning to `gjs.simulation.opts.repulsion` directly won't wake a settled layout.

Interaction options are changed with `enableInteraction()` (see [Built-in interaction](#built-in-interaction)).

Options are checked when they're set, in the constructor and in `setOpts()`. An unknown option name throws a `TypeError`, and so does a value of the wrong type; a value outside its range throws a `RangeError`. Nothing changes if any option in the call is invalid, and options left `undefined` keep their current value.

```js
gjs.renderer.setOpts({ highlightAlpha: 1.5 });   // RangeError: Renderer: `highlightAlpha` must be a finite number from 0 to 1
gjs.simulation.setOpts({ frction: 0.8 });         // TypeError: Simulation: unknown option `frction`
```

Values worked out from your node and edge data are treated differently: a config function that returns an invalid value for one node, such as `NaN` for its radius, falls back to the default for that node, so one bad data point doesn't stop a frame.

### Attaching and resizing the canvas

A `GraphJS` instance can be created without a canvas. The canvas element can be attached any time after instantiation.

```js
const gjs = new GraphJS();
gjs.addNode({ id: "a" });

// once the canvas is on the page
gjs.attach(canvas).start();

// when the canvas goes away; this also stops the animation
gjs.detach();
```

GraphJS sizes the canvas when it's attached. If its CSS size changes later, call `resize()`:

```js
new ResizeObserver(() => gjs.resize()).observe(canvas);
```

`resize()` is safe to call even when no canvas is attached.

## Building the graph

### Adding and removing nodes and edges

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

### Reading graph and simulation state

The layers expose their internal state as read-only properties, for custom drawing, statistics, or hit-testing:

```js
gjs.graph.nodes;             // Map: id -> { id, data }
gjs.graph.edges;             // Set of { src, dest, data }
gjs.graph.directed;

gjs.simulation.nodes;        // Map: id -> { id, x, y, vx, vy, radius, mass, charge, fixed, ... }
gjs.simulation.nodeList;     // the same nodes as an array
```

These properties can't be reassigned, and their collections shouldn't be changed; use `addNode()`, `setNodeConfig()`, `setNodeData()`, and the other methods instead. The one exception is a simulation node's `x`, `y`, `vx` and `vy`, which can be set directly (followed by `heat()`). Its `radius`, `mass`, `charge` and `fixed` are recalculated from config, so set those with `setNodeConfig()`.

## Configuring nodes and edges

Every setting takes either a fixed value, or a function that yields a value for each node or edge:

```js
// Physical settings belong to the simulation.
gjs.simulation.setDefaultNodeConfig({
  radius: node => 10 + 2 * gjs.graph.degree(node.id),   // more connections = larger
  mass: 1,
});

gjs.simulation.setDefaultEdgeConfig({
  length: edge => edge.data.distance ?? 50,             // resting length per edge
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
| | `charge` | `1` | how strongly the node repels and is repelled; `0` for neither (see [Node charge](#node-charge)) |
| | `fixed` | `false` | `true` holds the node in place |
| Simulation (edges) | `length` | `50` | resting length of the edge |
| | `stiffness` | `0.015` | how strongly the edge holds its length; `0` for a loose edge |
| Renderer (nodes) | `color` | `"#ffffff"` | fill color |
| | `outlineColor` | `"#000000"` | |
| | `outlineWidth` | `1` | in simulation units; `0` for no outline |
| | `image` | `null` | image URL drawn inside the node (see [Node images](#node-images)) |
| | `label` | `null` | text drawn beside the node; a string or number (see [Node labels](#node-labels)) |
| | `renderLabel` | `true` | `false` hides this node's label |
| | `labelScale` | `15` | label font size, in simulation units |
| | `labelTextColor` | `"#000000"` | |
| Renderer (edges) | `color` | `"#000000"` | also used for the arrowhead |
| | `width` | `1` | in simulation units (see [Edge and outline widths](#edge-and-outline-widths)) |
| | `arrow` | `null` | `null` follows the graph: arrows only when it's directed |
| | `arrowSize` | `10` | arrowhead length, in simulation units |
| | `bow` | `14` | how far a pair of opposite directed edges curve apart |

A function receives the node or edge object with custom data stored in `.data`. Whenever the graph changes, the function is re-run and the results are cached. That keeps the `radius` above in step as connections are added.

To change a node's data, use `gjs.graph.setNodeData(id, data)` rather than editing `node.data` directly. Direct edits will not trigger a cache refresh, so the functions won't re-run. Same applies to `gjs.graph.setEdgeData(srcId, destId, data)`.

### Individual node and edge settings

```js
gjs.renderer.setNodeConfig("alice", { color: "gold", outlineWidth: 4 });
gjs.simulation.setNodeConfig("alice", { mass: 5 });

gjs.renderer.setEdgeConfig("alice", "bob", { color: "red" });
gjs.simulation.setEdgeConfig("alice", "bob", { length: 120, stiffness: 0.5 });

gjs.renderer.clearNodeConfig("alice");   // reset to defaults
```

Setting config properties merges them with previously set config. `setEdgeConfig` throws when the edge doesn't exist (in a directed graph, node id order matters).

In a directed graph, a pair of opposite edges (`"a"` to `"b"` and `"b"` to `"a"`) pulls on its nodes through a single spring. Its stiffness is the average of the two edges' stiffnesses, and its length is the average of their lengths, weighted by stiffness.

To read the spring settings an edge ends up with, use `gjs.simulation.getEdgeSpring(srcId, destId)`. It returns `{ length, stiffness }` (the combined settings for a pair of opposite directed edges), or `null` if the edge doesn't exist or connects a node to itself.

### Node charge

The repulsion between two nodes is multiplied by both of their charges, so two nodes with a charge of `2` push each other apart 4 times as hard as two with the default of `1`. Giving hubs a higher charge spreads their neighbourhoods out:

```js
gjs.simulation.setDefaultNodeConfig({ charge: node => 1 + gjs.graph.degree(node.id) / 4 });
```

A node with a charge of `0` neither repels nor is repelled, so only its edges, gravity and collisions place it. Negative charges are treated as `0`; nodes can't attract each other through charge.

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

Each requested image has an entry in `gjs.renderer.images`, keyed by its source:

```js
const entry = gjs.renderer.images.get("https://example.com/alice.png");
entry?.status;   // "loading", "loaded" or "failed"
entry?.image;    // the loaded HTMLImageElement, or null while loading or after a failure
```

For speed, each image is cached at the sizes nodes are actually drawn at (from 16 to 1024 pixels, already cropped to a circle), so large graphs of image nodes stay fast when zoomed out. Nodes drawn larger than 1024 pixels use the original image, so they stay as sharp as it allows. Nodes smaller than about 6 pixels are drawn as a dot in the image's average colour. The cache is limited by the renderer's `imageCacheMB` option: the least recently drawn sizes are discarded first, and images on screen are always kept. After a fast zoom, images may look slightly soft for a frame or two while their new sizes are prepared.

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

### Edge and outline widths

Edge `width`, `arrowSize` and node `outlineWidth` are in simulation units, so they scale with the view like nodes and labels do. Zoomed out, edges get thinner, which keeps large graphs from turning into a solid cloud of lines. Two renderer options keep them reasonable at the extremes:

- `minEdgeWidth`: an edge thinner than this on screen (px) is drawn at this width but fainter, in proportion. Edges too faint to see are skipped, which also speeds up drawing large zoomed-out graphs.
- `maxEdgeWidth`: edges stop getting thicker past this width on screen (px), and their arrowheads stop growing with them.

To keep widths fixed on screen at every zoom instead, set `scaleStrokes: false`. `width`, `arrowSize` and `outlineWidth` are then in screen pixels, and `minEdgeWidth` and `maxEdgeWidth` don't apply.

## Running the animation

### Starting and stopping

```js
gjs.start();        // simulate and redraw every frame
gjs.stop();         // pause
gjs.isRunning();    // true while running

gjs.step();         // tick the simulation once and draw one frame
```

`start()` does nothing until a canvas is attached.

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

### Tweens

A tween animates a number, or an array of numbers, from one value to another. You give it a `set` function, and it's called with each new value:

```js
// Zoom to 2x over 400 ms, around the canvas centre
gjs.tween({
  set: zoom => gjs.zoomTo(zoom),
  from: () => gjs.view.zoom,            // read when the tween starts
  to: 2,
  duration: 400,
  ease: "inOutQuad",
  key: "zoom",
});

// Pan to a node, with the x and y coordinates as one array value
gjs.tween({
  set: ([x, y]) => gjs.setView({ x, y }),
  from: () => [gjs.view.x, gjs.view.y],
  to: gjs.simulation.getPosition("alice"),
  duration: 600,
  ease: "outCubic",
  key: "pan",
});

// Pulse a node's outline forever
gjs.tween({
  set: w => gjs.renderer.setNodeConfig("alice", { outlineWidth: w }),
  from: 1, to: 5, duration: 500,
  repeat: Infinity, yoyo: true,
  key: "alice:outline",
});
```

| Option | Default | |
|---|---|---|
| `set` | | called with each new value |
| `from` | | start value: a number, an array of numbers, or a function returning one. A function is called once, when the tween starts moving. |
| `to` | | end value, the same shape as `from` |
| `duration` | | length of one play |
| `unit` | `"ms"` | `"ms"` or `"frames"`: what `duration` and `delay` count. Set the default for every tween with the `tweenUnit` option of `new GraphJS()`. |
| `ease` | `"linear"` | `"linear"`, `"inQuad"`, `"outQuad"`, `"inOutQuad"`, `"inCubic"`, `"outCubic"`, `"inOutCubic"`, `"outBack"`, or your own function from progress (0 to 1) to eased progress |
| `delay` | `0` | wait before the first play |
| `repeat` | `0` | extra plays after the first; `Infinity` loops |
| `yoyo` | `false` | every other play runs backwards |
| `onFinish` | | called when the tween finishes, but not when it's cancelled |
| `key` | | names the tween, so it can be looked up, cancelled or replaced |

`tween()` returns the tween. To stop it:

```js
const pulse = gjs.tween({ /* ... */ });
pulse.cancel();                   // stop where it is
pulse.finish();                   // jump to the end (of the current play, if it loops forever)
await pulse.finished;             // true if it finished, false if it was cancelled

gjs.cancelTween("zoom");          // by key; true if there was one
gjs.cancelAllTweens();
gjs.getTween("zoom");             // the active tween with that key, or null
gjs.isTweening();                 // true while any tween is active
```

Starting a tween with the key of an active one cancels the old one, so two tweens never fight over the same value. A `from` function then picks up wherever the old one stopped.

- **When they run:** tweens are advanced at the start of each frame of `start()` and each `step()`, before the `"preTick"` hooks. Time only counts while frames run, so a tween doesn't jump ahead after `stop()` and `start()`.
- **Without the loop:** if you draw only when something changes, call `gjs.stepTweens(time)` before `gjs.renderer.render(time)`, and keep requesting frames while `gjs.isTweening()` is true. It advances tweens without ticking the simulation.
- **With interaction:** a view tween keeps moving the view while the user pans or zooms. To let the user take over, cancel it from a `panstart` or `zoom` listener (see [Interaction events](#interaction-events)).
- **Errors:** a `set` function that throws is logged and the tween is cancelled. Cancel tweens whose node or edge you remove: `setEdgeConfig()` throws for a missing edge.
- **Speed:** each change to a node or edge config makes the renderer re-read every node's and edge's settings on the next frame, so style tweens get expensive on large graphs. Tweening the view or node positions doesn't have this cost.
- **Without GraphJS:** `Tween` is also exported from the package root and from `@tang0226/graph-js/tween`. `new Tween(opts)` takes the same options except `key`, and you advance it with `tween.step(ms)` from your own loop.

## Interaction

### Built-in interaction

Pointer interaction is off by default. Turn it on with the `interaction` option, or at any time with `enableInteraction()`:

```js
const gjs = new GraphJS({
  canvas,
  interaction: { maxZoom: 10 },                // or true, for the default options
});

gjs.enableInteraction({ dragThreshold: 8 });   // turn on, or change options while on
gjs.disableInteraction();
gjs.isInteractive();                           // true while on
gjs.interactionOpts;                           // the current options, or null while off
```

While it's on and a canvas is attached:

| Gesture | Response | Events |
|---|---|---|
| Press a node | | `nodepress` |
| Drag a node | the node follows the pointer | `nodedragstart`, `nodedrag`, `nodedragend` |
| Drag the background | the view pans | `panstart`, `pan`, `panend` |
| Turn the wheel | the view zooms around the pointer | `zoom` |
| Click a node, or the background | | `nodeclick`, `backgroundclick` |
| Double-click a node | | `nodedblclick` |
| Move onto or off a node | | `nodeenter`, `nodeleave` |

Listeners can change or cancel each response (see [Interaction events](#interaction-events)).

| Option | Default | |
|---|---|---|
| `dragNodes` | `true` | whether dragging a node moves it. When `false`, dragging a node pans instead, if `pan` is on. |
| `pan` | `true` | whether dragging the background pans the view |
| `zoom` | `true` | whether the wheel zooms. When `false`, the wheel scrolls the page as usual. |
| `dragThreshold` | `4` | how far (px) the pointer must move while pressed before a drag starts |
| `zoomSpeed` | `0.002` | each wheel event multiplies the zoom by `2 ** (-deltaY * zoomSpeed)`, which is about 1.15 per mouse wheel notch |
| `minZoom` | `0.01` | the wheel doesn't zoom out past this |
| `maxZoom` | `100` | the wheel doesn't zoom in past this |

`enableInteraction()` merges new options into the current ones, and throws for an invalid one. `disableInteraction()` forgets them, so turning interaction on again starts from the defaults.

- **Clicks and drags:** a press becomes a drag once the pointer moves more than `dragThreshold` pixels. Otherwise, releasing it is a click. A drag is never also a click, and a cancelled press (such as a touch interrupted by the browser) is neither.
- **Dragged nodes:** the node keeps its offset from the pointer, so it doesn't jump to centre on it. It's pinned while dragged and unpinned when dropped. A node that was already fixed stays fixed where it's dropped.
- **Hover:** while a press is held, the hovered node doesn't change, so a dragged node stays hovered even if the pointer outruns it. Hover updates when the press ends. Touch has no hover.
- **Pointers:** only the primary pointer's main button is used, and pinch-to-zoom isn't supported. While listening, the canvas's CSS `touch-action` is set to `none`, so touch drags don't scroll the page; the previous value is restored afterwards.
- **The wheel:** the page doesn't scroll while the wheel zooms, even at a zoom limit. Horizontal scrolling is left to the page. A view that code has set past `minZoom` or `maxZoom` isn't snapped back; the wheel only stops it going further.
- **Drawing:** while the animation runs, changes show on the next frame. While it's stopped, interaction draws one frame after each change. That frame doesn't advance tweens or finish highlight fades, so if you use those while stopped, keep drawing yourself (see [Tweens](#tweens) and [Highlighting](#highlighting)).
- **The canvas:** interaction listens on whichever canvas is attached, and stops when it's detached. A canvas that can't receive pointer input, such as an `OffscreenCanvas`, is ignored. Turning interaction off or detaching during a drag ends it without events, and unpins the node.

### Panning and zooming

The view holds the simulation coordinates at the center of the canvas, and a zoom factor (canvas pixels per simulation unit):

```js
gjs.view;                          // { x, y, zoom }
gjs.setView({ x: 0, y: 0, zoom: 1 });   // set some or all of it

gjs.panBy(100, 0);                 // shift the graph 100 px right on the canvas
gjs.zoomTo(2);                     // zoom to 2x around the canvas centre
gjs.zoomTo(2, 300, 200);           // ... or keep the point at (300, 200) on the canvas fixed
gjs.zoomBy(1.5, 300, 200);         // multiply the zoom, anchored the same way
```

`viewPannedBy()` and `viewZoomedTo()` take the same arguments as `panBy()` and `zoomTo()`, and return the view they would set without applying it. The `pan` and `zoom` events carry views worked out this way.

```js
const next = gjs.viewZoomedTo(2, 300, 200);   // { x, y, zoom }
gjs.setView(next);                            // the same as gjs.zoomTo(2, 300, 200)
```

To animate the view, set it from a tween. Zooming with `zoomTo()` keeps the anchor fixed the whole way:

```js
gjs.tween({
  set: zoom => gjs.zoomTo(zoom, 300, 200),
  from: () => gjs.view.zoom, to: 4, duration: 500, ease: "inOutCubic", key: "camera",
});
```

- **Checks:** a coordinate that isn't finite, or a zoom that isn't a finite number above 0, throws a `RangeError` and changes nothing. A zoom anchor needs both coordinates and an attached canvas.
- **Drawing:** like other changes made from code, view changes show on the next frame. If the animation is stopped, call `gjs.renderer.render()`.
- **On the renderer:** the same methods are on `gjs.renderer`, where they return the renderer. `gjs.view` is the renderer's `view`.
- **Assigning:** `gjs.renderer.view = { zoom: 2 }` is checked the same way as `setView()`. Writing a single field, as in `gjs.renderer.view.zoom = 2`, isn't checked, so prefer `setView()`.

### Coordinates and hit-testing

Canvas coordinates are CSS pixels from the canvas's top-left corner, at any device pixel ratio. Event positions, `getPosition()` and the drawing hooks all use them.

```js
gjs.nodeAt(100, 50);         // id of the node at (100, 50) on the canvas, or null
gjs.nodeAt(100, 50, 4);      // with 4 px of slack around each node (the default is 2)
gjs.getPosition("alice");    // [x, y] on the canvas, or null if the node doesn't exist
gjs.simToCanvas(0, 0);       // canvas coordinates of the simulation's center
gjs.canvasToSim(100, 50);    // converts (100, 50) on the canvas to simulation coordinates

gjs.pin("alice", 100, 50);   // holds a node at (100, 50) on the canvas
gjs.unpin("alice");          // allows the node to move freely again
```

These helpers, except `unpin()`, require an attached canvas and throw without one.

### Building your own interaction

With built-in interaction off, the helpers above are enough to handle DOM events yourself. To convert a DOM event's position to canvas coordinates:

```js
const toCanvas = e => {
  const { left, top } = canvas.getBoundingClientRect();
  return [e.clientX - left, e.clientY - top];
};
```

Dragging nodes:

```js
let dragging = null;

canvas.addEventListener("pointerdown", e => {
  const [x, y] = toCanvas(e);
  dragging = gjs.nodeAt(x, y, 4);       // node id, or null
  if (dragging !== null) canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", e => {
  if (dragging === null) return;
  const [x, y] = toCanvas(e);
  gjs.pin(dragging, x, y);    // holds the node under the pointer
});

canvas.addEventListener("pointerup", () => {
  if (dragging !== null) gjs.unpin(dragging);
  dragging = null;
});
```

Zooming toward the cursor:

```js
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const [x, y] = toCanvas(e);
  gjs.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, x, y);   // keeps the point under the cursor fixed
}, { passive: false });
```

Your own listeners can also run alongside built-in interaction, for input it doesn't handle, such as keyboard shortcuts that call `panBy()` and `zoomBy()`.

## Events

### Listening for events

`GraphJS`, the graph and the simulation each emit events. Listen with `on()` on the object that emits them, and stop with `off()`:

```js
function onClick(e) {
  console.log(`clicked ${e.id} at (${e.x}, ${e.y})`);
}
gjs.on("nodeclick", onClick);                    // an interaction event, on the GraphJS instance
gjs.off("nodeclick", onClick);                   // true if it was added

gjs.graph.on("nodeadd", e => console.log(`added ${e.id}`));   // a graph event, on the graph
gjs.simulation.on("settle", () => gjs.stop());   // a simulation event, on the simulation
```

Each object only takes its own event names: `gjs.on("settle", ...)` throws, because `settle` is a simulation event.

Every event has `type`, its name, and `target`, the object that emitted it, along with any data listed for that event. Every event also has `preventDefault()` and `defaultPrevented`, but what preventing does depends on where the event comes from:

- **Interaction events** are emitted before GraphJS responds to the user, so calling `preventDefault()` stops the response listed in the [interaction events](#interaction-events) table. The other listeners still run, and can read `defaultPrevented`.
- **Layer events,** from the graph and the simulation, report changes that have already happened. Their defaults can't be prevented: `preventDefault()` has no effect on them, and `defaultPrevented` only records whether a listener called it. To reverse a change, make another one, such as removing a node from a `nodeadd` listener, or calling `heat()` from a `settle` listener.

How listeners run is the same for every event:

- **Order:** listeners of an event run in the order they were added, and adding the same function twice has no effect. Removing a listener needs the same function, so keep a reference to it.
- **Errors:** a listener that throws is logged with `console.error`, and the remaining listeners still run.
- **During an event:** a listener added while an event is running starts with the next one. A listener removed while an event is running doesn't run for it, if it hasn't already.
- **Names:** an unknown event name throws a `TypeError`, so a misspelled name fails straight away instead of never firing.
- **Lifetime:** listeners belong to the object they're added to. GraphJS's stay through `detach()` and `attach()`, and through turning interaction off and on.

### Interaction events

[Built-in interaction](#built-in-interaction) emits these on the GraphJS instance, so listeners only hear them while it's on. They report what the user did: calling `setView()`, `panBy()`, `pin()` and the like doesn't emit them.

| Event | When | Data | `preventDefault()` |
|---|---|---|---|
| `nodeenter` | the pointer moves onto a node | pointer, `id` | |
| `nodeleave` | the pointer moves off a node, or leaves the canvas | pointer, `id` | |
| `nodepress` | the pointer is pressed on a node, before it's known whether the press is a click or a drag | pointer, `id` | the press is ignored: no drag or click follows |
| `nodeclick` | a node is clicked | pointer, `id` | |
| `nodedblclick` | a node is double-clicked | pointer, `id` | |
| `backgroundclick` | the canvas is clicked away from any node | pointer | |
| `nodedragstart` | a node starts being dragged | pointer, `id` | the node isn't dragged |
| `nodedrag` | a dragged node moves | pointer, `id`, `dx`, `dy` | the node doesn't move this time |
| `nodedragend` | a dragged node is dropped | pointer, `id` | the node stays pinned where it was dropped |
| `panstart` | the background starts being dragged | pointer, `view` | the view doesn't pan |
| `pan` | the dragged background moves | pointer, `view`, `dx`, `dy` | the view doesn't move this time |
| `panend` | the background is dropped | pointer, `view` | |
| `zoom` | the wheel zooms the view | pointer, `view` | the view doesn't zoom |

The data fields are:

- **pointer:** `x` and `y`, the pointer's position in canvas coordinates (see [Coordinates and hit-testing](#coordinates-and-hit-testing)), and `originalEvent`, the DOM event that caused this one. A drag's start event has the position where the press began.
- **`id`:** the node's id.
- **`dx`, `dy`:** how far the pointer moved, in canvas pixels, since the drag's previous event.
- **`view`:** a copy of the view. For `panstart` and `panend` it's the current view; for `pan` and `zoom`, it's the view the change moves to.

```js
// The root node can't be dragged
gjs.on("nodedragstart", e => { if (e.id === "root") e.preventDefault(); });

// Dropped nodes stay where they're put
gjs.on("nodedragend", e => e.preventDefault());

// Let the user take over from a camera tween
gjs.on("panstart", () => gjs.cancelTween("camera"));
gjs.on("zoom", () => gjs.cancelTween("camera"));
```

### Graph events

The graph emits these as nodes and edges change, whether through `gjs.addNode()` and the other shortcuts or on `gjs.graph` directly. Listen on `gjs.graph`, or on a standalone `Graph` instance (works in Node).

| Event | When | Data |
|---|---|---|
| `nodeadd` | a node is added | `id`, `node` |
| `noderemove` | a node is removed, after an `edgeremove` for each of its edges | `id`, `node` |
| `nodedatachange` | `setNodeData()` replaces a node's data | `id`, `node`, `prev` |
| `edgeadd` | an edge is added | `srcId`, `destId`, `edge` |
| `edgeremove` | an edge is removed, by `removeEdge()` or by removing one of its nodes | `srcId`, `destId`, `edge` |
| `edgedatachange` | `setEdgeData()` replaces an edge's data | `srcId`, `destId`, `edge`, `prev` |

- **`node`, `edge`:** the node or edge object, as in `gjs.graph.nodes` and `gjs.graph.edges`. A removed one is no longer in the graph, but its `data` is still there.
- **`srcId`, `destId`:** the ids the edge is stored with. In an undirected graph, an edge always reports the same pair, whichever order it's named in.
- **`prev`:** the data that was replaced. Setting the same object again still emits an event, so compare `prev` with the new data if that matters.

```js
// Keep a list of node names up to date
const names = new Map();
gjs.graph.on("nodeadd", e => names.set(e.id, e.node.data.name));
gjs.graph.on("noderemove", e => names.delete(e.id));
gjs.graph.on("nodedatachange", e => names.set(e.id, e.node.data.name));
```

- **Up to date:** each event is emitted once its change is complete, so the graph is current for listeners: `gjs.graph.nodes`, `degree()`, `hasEdge()` and the rest already reflect it.
- **The other layers catch up later:** the simulation and renderer read graph changes on their next tick or frame, so in a `nodeadd` listener, `gjs.simulation.nodes.get(e.id)` is still `undefined`. To read them straight away, call `gjs.simulation.sync()` first. It does nothing if nothing has changed, but it rebuilds the simulation's tables when something has, so avoid calling it from every event while building a large graph.
- **No-ops:** a change that doesn't happen emits nothing, such as adding an id that's already in use, adding an edge that exists, or removing something that doesn't.
- **Changes in listeners:** a listener can change the graph, and those changes emit their own events straight away, inside the event that's running.
- **Speed:** an event with no listeners costs almost nothing, so building a large graph isn't slowed down until you listen.

### Simulation events

The simulation emits these as the layout stops and starts (see [Settling](#settling)). Listen on `gjs.simulation`, or on a `Simulation` used on its own, including in Node.

| Event | When |
|---|---|
| `settle` | the layout stops: its temperature drops below `freezePoint`, or `heat(0)` is called while it's moving |
| `wake` | the layout starts moving again: `heat()` raises its temperature from 0 |

Neither event carries data; read `e.target.temp` for the temperature. Both report what has already happened, so their defaults can't be prevented.

```js
// Fit the view once the layout has stopped moving (fitView is your own function)
gjs.simulation.on("settle", () => fitView());

// Save power: stop the loop while nothing moves, and restart it when something does
gjs.simulation.on("settle", () => gjs.stop());
gjs.simulation.on("wake", () => gjs.start());
```

- **Final positions:** `settle` is emitted after the tick that froze the layout has finished, so positions are final and velocities are zero.
- **Every wake:** every change that wakes the layout, listed under [Settling](#settling), goes through `heat()`, so `wake` covers them all. It's emitted straight away, before the next tick. Heating a layout that's already moving doesn't emit it.
- **From code too:** unlike interaction events, simulation events report changes however they're made, including by your own calls to `heat()`, `setOpts()` or `pin()`.
- **A stopped loop:** if the loop is stopped, a change wakes the layout but nothing ticks it. That's what the `wake` listener above is for. While it's stopped, tweens and highlight fades don't advance either, so restart the loop for those too, or draw on demand (see [Tweens](#tweens)).

## Drawing

### Highlighting

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

With [built-in interaction](#built-in-interaction), the same function highlights whichever node is under the pointer:

```js
gjs.on("nodeenter", e => gjs.renderer.setHighlight(neighborhood(e.id)));
gjs.on("nodeleave", () => gjs.renderer.clearHighlight());
```

### Custom drawing

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

## Layout physics

### Settling

The layout cools as it runs. Each tick, the simulation's temperature is multiplied by `cooling`, and forces are scaled by it. Once it drops below `freezePoint`, the nodes stop and the simulation does no more work until something wakes it. The canvas is still redrawn every frame, so panning and zooming keep working.

The layout wakes on its own when:

- nodes or edges are added or removed
- a config or data change alters a node's `radius`, `mass`, `charge` or `fixed`
- options are changed with `setOpts()`
- a node is pinned somewhere new, including by dragging it

Changes the library can't see need a manual `heat()`:

```js
const node = gjs.simulation.nodes.get("alice");
node.vx += 20;                  // a direct change to a node's position or velocity
gjs.simulation.heat();          // full temperature: the layout moves again

gjs.simulation.heat(0.3);       // a gentler nudge
gjs.simulation.temp;            // current temperature; 0 means frozen
```

The simulation emits a `settle` event when the layout stops, and a `wake` event when it starts moving again (see [Simulation events](#simulation-events)):

```js
gjs.simulation.on("settle", () => console.log("the layout has stopped"));
```

To cover more ground in each tick, raise `dt`. Temperature still falls once per tick, so the layout freezes after the same number of ticks, but it gets closer to its final shape first, which helps most on large graphs. Values up to about 3 stay stable; above that, nodes start to jitter. Passing a value to `gjs.simulation.tick(dt)` overrides the option for that tick.

### Barnes-Hut

Every node repels every other node, so checking each pair takes 100 times as long when a graph gets 10 times larger. Barnes-Hut avoids most of that work: each tick, nodes are sorted into a quadtree (a tree of nested squares), and a distant group of nodes is treated as a single point, carrying the group's total charge at its charge-weighted center. It's on by default, and at 20,000 nodes it calculates repulsion about 40 times faster than checking every pair.

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

### Collisions

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

The package ships its own type declarations. Option, config, hook and event types can be imported from the package root:

```ts
import { GraphJS } from "@tang0226/graph-js";
import type { GraphJSOpts, SimNodeConfig, NodeStyleConfig, RendererHook, GraphJSEvent } from "@tang0226/graph-js";

const opts: GraphJSOpts = { simulation: { collision: "grid" } };
const sizes: SimNodeConfig = { radius: node => 5 + node.data.weight };
```

A listener's event is typed from the event name, so `gjs.on("nodedrag", e => e.dx)` needs no annotation. A function shared by several events can name them all, and use the fields they have in common:

```ts
function onMove(e: GraphJSEvent<"nodedrag" | "pan">) {
  console.log(e.dx, e.dy);
}
gjs.on("nodedrag", onMove).on("pan", onMove);
```

Simulation events have their own types, `SimEvent<K>` and `SimListener<K>`, used the same way:

```ts
import type { SimEvent } from "@tang0226/graph-js";

function onSettle(e: SimEvent<"settle">) {
  console.log("settled at temperature", e.target.temp);
}
gjs.simulation.on("settle", onSettle);
```

The graph and simulation layers can also be imported on their own, for layouts without a canvas. Their types, including their events, don't depend on the DOM, so they compile in a Node project without `"dom"` in `lib`:

```ts
import { Graph } from "@tang0226/graph-js/graph";
import { Simulation } from "@tang0226/graph-js/simulation";
```

Members whose names start with `_` are internal and declared `private`, so TypeScript rejects them. Types that aren't exported from the package root are internal too, and may change between versions.

## Upgrading

### From 0.6

- **Assigning `renderer.view` now checks its values.** Assigning a non-finite `x` or `y`, or a `zoom` that isn't a finite number above 0, throws a `RangeError` and leaves the view unchanged. These values already broke coordinate conversions and rendering. Writing a single field, as in `renderer.view.zoom = 0`, isn't checked.
- **Edge widths, arrowheads and node outlines now scale with zoom** (see [Edge and outline widths](#edge-and-outline-widths)). At zoom 1 they look the same as before. Zoomed out they get thinner and fade, and zoomed in they get thicker, up to `maxEdgeWidth`. Set `scaleStrokes: false` to keep the old fixed screen sizes.
- **Hand-written drag, pan and zoom code can be replaced** with `interaction: true` (see [Built-in interaction](#built-in-interaction)). Existing code keeps working, as long as interaction stays off.
- **Invalid options now throw instead of being clamped or accepted.** `new GraphJS()`, the layer constructors and every `setOpts()` check their options (see [Changing options](#changing-options)). Previously `Renderer` clamped some out-of-range values, such as a negative `minEdgeWidth` or a `highlightAlpha` above 1, and accepted others, such as an unknown `labelPosition`, while `Simulation` accepted anything. Values that were silently fixed before now throw a `RangeError`, and misspelled option names throw a `TypeError` instead of being ignored. To keep forgiving input, clamp values yourself before passing them in.
- **A missing edge in `setEdgeConfig()` throws a `ReferenceError`,** in both the simulation and the renderer, as a missing node or edge already did in the graph. It was a plain `Error`; `catch` blocks that check `instanceof Error` still match. The graph's error messages now start with `Graph:`, like the other layers', so code that matched the old wording (`Cannot find …`) needs updating.
- **`renderer.images` entries are objects with a status.** Each entry is `{ status, image }`, where `status` is `"loading"`, `"loaded"` or `"failed"` and `image` is the loaded image or `null` (see [Node images](#node-images)). Entries used to be the strings `"loading"` and `"failed"` or the image itself, and `Renderer.IMAGE_LOADING` and `Renderer.IMAGE_FAILED` are removed: compare `entry.status` instead.
- **`renderer.pin()` and `renderer.unpin()` are removed.** Pinning changes the simulation, which the renderer only draws. Use `gjs.pin(id, x, y)` and `gjs.unpin(id)`, which take canvas coordinates like the removed methods, or `gjs.simulation.pin()` with simulation coordinates.
- **`SIM_NODE_DEFAULTS` and `SIM_EDGE_DEFAULTS` are no longer exported** from `@tang0226/graph-js/simulation`. Read the defaults a simulation is using from `simulation.defaultNodeConfig` and `simulation.defaultEdgeConfig` instead, and change them with `setDefaultNodeConfig()` and `setDefaultEdgeConfig()`. Changing the exported objects changed defaults for every simulation at once, which was never supported.

### From 0.5

- **Internal members are `private` in the type declarations.** TypeScript code that reads or writes a member starting with `_` no longer compiles. Use the public equivalents: for example, `simulation._nodeList` is `simulation.nodeList`, `_springs` is `springs`, `_temp` is `temp`, and `_opts` is `opts`. Hooks are managed with `addHook()` and `removeHook()`. JavaScript code still runs, but internal members aren't supported and can change without notice.
- **Option and config types can be imported by name** (see [TypeScript](#typescript)). Code that extracted them with helpers like `ConstructorParameters<typeof GraphJS>[0]` can use `GraphJSOpts` and the other named types instead.

### From 0.4

- **The layout now settles and stops.** It wakes automatically after the changes listed under [Settling](#settling). If you move nodes or change their velocities directly, call `gjs.simulation.heat()` afterwards.
- **Repulsion now uses [Barnes-Hut](#barnes-hut) by default.** Forces are approximate, so the same graph can settle slightly differently. Set `useBarnesHut: false` to check every pair of nodes as before.
- **Collisions now use a grid by default, set by the new `collision` option** (see [Collisions](#collisions)). `useBarnesHut` no longer affects collisions. Set `collision: "pairs"` to check every pair of nodes as before.
- **Layer properties are read-only.** `opts`, `canvas`, `ctx`, `size`, `graph`, `simulation`, `renderer`, `nodes` and similar properties can no longer be reassigned; doing so throws a `TypeError` in modules and strict mode, and is silently ignored elsewhere. Use `setOpts()`, `attach()` and the config methods instead. `renderer.view` is the exception: it can still be assigned, and the given fields are merged in.
- **Former internal properties have public names.** For example, `simulation._nodeList` is now `simulation.nodeList`, `_edgePairs` is `edgePairs`, `renderer._nodeStyles` is `nodeStyles`, and `renderer._loadImage()` is `loadImage()`.
- **`JSON.stringify(graph)` no longer includes `directed`.** Read `graph.directed` instead.

### From 0.2

The constructor now takes a single options object, with the canvas inside it:

```js
// 0.2
new GraphJS(canvas, { graph: { directed: true } });

// 0.3
new GraphJS({ canvas, graph: { directed: true } });
```

The 0.2 form no longer works and won't throw: the canvas is read as the options object, so nothing is drawn. TypeScript reports it as an error.
