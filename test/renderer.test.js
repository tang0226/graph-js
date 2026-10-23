import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";
import { Simulation } from "../src/simulation.js";
import { Renderer } from "../src/renderer.js";
import { makeCanvas, installImage, installWindow, opsNamed, flush, r2 } from "./helpers/stubs.js";

/* Two nodes of radius 20, placed 200 world units apart on the x axis. With an
   800x600 canvas at zoom 1 they land at canvas (300,300) and (500,300), so a
   trimmed edge runs 320 -> 480 and every expectation below is a round number. */
function scene(directed, edges, { radius = 20, nodeCfg, edgeCfg, opts } = {}) {
  const canvas = makeCanvas();
  const g = new Graph({ directed });
  g.addNode({ id: "a", group: 0 });
  g.addNode({ id: "b", group: 1 });
  for (const [s, d] of edges) g.addEdge(s, d);

  const sim = new Simulation(g, {});
  sim.setDefaultNodeConfig({ radius });
  sim.sync();
  const A = sim.nodes.get("a"), B = sim.nodes.get("b");
  A.x = -100; A.y = 0; B.x = 100; B.y = 0;

  const r = new Renderer(sim, { canvas, nodeConfig: nodeCfg, edgeConfig: edgeCfg, ...opts });
  r.sync();
  canvas.ctx.ops.length = 0;
  return { g, sim, r, ctx: canvas.ctx, canvas };
}

describe("Renderer: construction", () => {
  test("rejects anything that is not a Simulation", () => {
    assert.throws(() => new Renderer({}, { canvas: makeCanvas() }), { name: "TypeError" });
    assert.throws(() => new Renderer(null, { canvas: makeCanvas() }), { name: "TypeError" });
  });
});

describe("Renderer: undirected edge geometry", () => {
  test("the line is trimmed to both node radii", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);
    r.render();
    assert.deepEqual(opsNamed(ctx, "moveTo")[0].slice(1).map(r2), [320, 300]);
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [480, 300]);
  });

  test("no arrowhead is filled", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);
    r.render();
    assert.equal(opsNamed(ctx, "closePath").length, 0, "closePath only comes from arrowheads");
  });

  test("nothing is drawn when the nodes overlap", () => {
    const { sim, r, ctx } = scene(false, [["a", "b"]], { radius: 200 });
    sim.sync();
    r.render();
    assert.equal(opsNamed(ctx, "lineTo").length, 0);
  });
});

describe("Renderer: directed edge geometry", () => {
  test("the stroke stops at the arrowhead base", () => {
    const { r, ctx } = scene(true, [["a", "b"]]);
    r.render();
    assert.deepEqual(opsNamed(ctx, "moveTo")[0].slice(1).map(r2), [320, 300]);
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [470, 300],
      "a thick line would show through the arrowhead notch");
  });

  test("the arrowhead tip sits on the destination boundary", () => {
    const { r, ctx } = scene(true, [["a", "b"]]);
    r.render();
    const tip = opsNamed(ctx, "moveTo")[1].slice(1).map(r2);
    assert.deepEqual(tip, [480, 300]);
    assert.equal(opsNamed(ctx, "closePath").length, 1);
    assert.equal(opsNamed(ctx, "fill").length >= 1, true);
  });

  test("the arrowhead is symmetric about the edge axis", () => {
    const { r, ctx } = scene(true, [["a", "b"]]);
    r.render();
    const [p, q] = opsNamed(ctx, "lineTo").slice(1, 3).map(o => o.slice(1).map(r2));
    assert.equal(p[0], q[0], "both base corners share an x on a horizontal edge");
    assert.equal(r2(p[1] + q[1]), 600, "base corners straddle y=300");
  });
});

describe("Renderer: reciprocal bowing", () => {
  test("mutual directed edges bow to opposite sides", () => {
    const { r, ctx } = scene(true, [["a", "b"], ["b", "a"]]);
    r.render();
    const quads = opsNamed(ctx, "quadraticCurveTo").map(o => o.slice(1).map(r2));
    assert.equal(quads.length, 2);
    assert.equal(quads[0][0], quads[1][0], "control points share the midpoint x");
    assert.equal(r2(quads[0][1] + quads[1][1]), 600,
      "control points must straddle the chord, not stack on one side");
  });

  test("bow flags: set only for reciprocal directed pairs", () => {
    assert.deepEqual([...scene(true, [["a", "b"], ["b", "a"]]).r._edgeBow], [1, 1]);
    assert.deepEqual([...scene(true, [["a", "b"]]).r._edgeBow], [0]);
    assert.deepEqual([...scene(false, [["a", "b"]]).r._edgeBow], [0],
      "hasEdge is symmetric on undirected graphs, so every edge would bow");
    assert.deepEqual([...scene(true, [["a", "a"]]).r._edgeBow], [0], "self-loops must not bow");
  });

  test("a bowed arrowhead follows the curve tangent, not the chord", () => {
    const { r, ctx } = scene(true, [["a", "b"], ["b", "a"]]);
    r.render();
    const [p, q] = opsNamed(ctx, "lineTo").slice(0, 2).map(o => o.slice(1).map(r2));
    assert.notEqual(p[0], q[0], "a chord-aligned head would share an x here");
  });
});

describe("Renderer: self-loops", () => {
  test("a loop circle is stroked", () => {
    const { r, ctx } = scene(true, [["a", "a"]]);
    r.render();
    const arcs = opsNamed(ctx, "arc");
    assert.ok(arcs.length >= 2, "one arc for the loop, one per node");
  });

  test("the arrowhead tip lands on the node boundary, not inside it", () => {
    const { r, ctx } = scene(true, [["a", "a"]]);
    r.render();
    // node 'a' is at canvas (300,300) with radius 20
    const tip = opsNamed(ctx, "moveTo")[0].slice(1);
    const dist = Math.hypot(tip[0] - 300, tip[1] - 300);
    assert.ok(Math.abs(dist - 20) < 0.01,
      `tip is ${dist.toFixed(2)} from the centre; inside the node it is painted over`);
  });

  test("undirected self-loops draw no arrowhead", () => {
    const { r, ctx } = scene(false, [["a", "a"]]);
    r.render();
    assert.equal(opsNamed(ctx, "closePath").length, 0);
  });
});

describe("Renderer: style cascade", () => {
  test("arrow defaults to the graph's directedness", () => {
    assert.equal(scene(true, [["a", "b"]]).r._edgeStyles[0].arrow, true);
    assert.equal(scene(false, [["a", "b"]]).r._edgeStyles[0].arrow, false);
  });

  test("arrow can be forced on an undirected graph", () => {
    const { r } = scene(false, [["a", "b"]], { edgeCfg: { arrow: true } });
    assert.equal(r._edgeStyles[0].arrow, true);
  });

  test("a per-edge override suppresses the arrow", () => {
    const { r } = scene(true, [["a", "b"]]);
    r.setEdgeConfig("a", "b", { arrow: false });
    r.sync();
    assert.equal(r._edgeStyles[0].arrow, false);
  });

  test("setEdgeConfig throws for a missing edge rather than dropping the config", () => {
    const { r } = scene(true, [["a", "b"]]);
    // Reversed ids on a directed graph: the mistake a silent no-op would hide.
    assert.throws(() => r.setEdgeConfig("b", "a", { color: "red" }), /Renderer:/);
    assert.throws(() => r.setEdgeConfig("a", "nope", { color: "red" }), /Renderer:/);
  });

  test("setEdgeConfig accepts either id order in an undirected graph", () => {
    const { r } = scene(false, [["a", "b"]]);
    r.setEdgeConfig("b", "a", { color: "#123456" });
    r.sync();
    assert.equal(r._edgeStyles[0].color, "#123456");
  });

  test("node accessors resolve against graph data", () => {
    const { r } = scene(false, [["a", "b"]], {
      nodeCfg: { color: n => (n.data.group === 0 ? "#ff0000" : "#00ff00") },
    });
    assert.equal(r.nodes.get("a").color, "#ff0000");
    assert.equal(r.nodes.get("b").color, "#00ff00");
  });

  test("partial overrides do not disturb other fields", () => {
    const { r } = scene(false, [["a", "b"]]);
    r.setNodeConfig("a", { color: "#123456" });
    r.sync();
    const style = r.nodes.get("a");
    assert.equal(style.color, "#123456");
    assert.equal(style.outlineColor, "#000000", "sibling fields must keep resolving");
  });
});

describe("Renderer: cache alignment", () => {
  test("style arrays stay parallel to the simulation slot space", () => {
    const canvas = makeCanvas();
    const g = new Graph();
    for (let i = 0; i < 10; i++) {
      g.addNode({ id: "n" + i });
      if (i) g.addEdge("n" + (i - 1), "n" + i);
    }
    const sim = new Simulation(g, {});
    const r = new Renderer(sim, { canvas });

    for (const id of ["n3", "n7", "n0"]) {
      g.removeNode(id);
      sim.sync();
      r.sync();
      assert.equal(r._nodeStyles.length, sim.nodeList.length);
      assert.equal(r._edgeStyles.length, g.edges.size);
      assert.equal(r._nodeStyles.filter(s => !s).length, 0, "a slot resolved to no style");
      assert.equal(r._edgeStyles.filter(s => !s).length, 0);
      assert.equal(r._edgeBow.length, g.edges.size);
    }
  });

  test("slots line up with the right nodes after removals", () => {
    const canvas = makeCanvas();
    const g = new Graph();
    for (let i = 0; i < 6; i++) g.addNode({ id: "n" + i });
    const sim = new Simulation(g, {});
    const r = new Renderer(sim, { canvas });
    g.removeNode("n2");
    sim.sync();
    r.sync();
    for (let i = 0; i < sim.nodeList.length; i++)
      assert.equal(r._nodeStyles[i].id, sim.nodeList[i].id);
  });

  test("a config-only change reuses the cached style objects", () => {
    const { r } = scene(false, [["a", "b"]]);
    const style = r.nodes.get("a");
    r.setDefaultNodeConfig({ color: "#abcdef" });
    r.sync();
    assert.equal(r.nodes.get("a"), style, "resolve mutates in place rather than reallocating");
    assert.equal(style.color, "#abcdef");
  });

  test("edge styles are pruned with their edges", () => {
    const { g, sim, r } = scene(false, [["a", "b"]]);
    const edge = g.getEdge("a", "b");
    g.removeEdge("a", "b");
    sim.sync();
    r.sync();
    assert.equal(r.edges.has(edge), false);
  });
});

describe("Renderer: viewport culling", () => {
  test("off-screen nodes are skipped", () => {
    const { sim, r, ctx } = scene(false, [["a", "b"]]);
    sim.nodes.get("b").x = 100000;
    r.render();
    const arcs = opsNamed(ctx, "arc");
    assert.equal(arcs.length, 1, "only the on-screen node should be drawn");
  });

  test("an edge is kept while either endpoint is visible", () => {
    const { sim, r, ctx } = scene(false, [["a", "b"]]);
    sim.nodes.get("b").x = 100000;
    r.render();
    assert.ok(opsNamed(ctx, "lineTo").length >= 1, "the edge should still be stroked");
  });
});

describe("Renderer: images", () => {
  function imageScene(fail = () => false) {
    const restore = installImage({ fail });
    const canvas = makeCanvas();
    const g = new Graph();
    g.addNode({ id: "a", img: "a.png" });
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ radius: 20 });
    sim.sync();
    const r = new Renderer(sim, { canvas, nodeConfig: { image: n => n.data.img ?? null } });
    r.sync();
    return { g, sim, r, ctx: canvas.ctx, restore };
  }

  test("the source is cached as loading, then replaced by the image", async () => {
    const { r, restore } = imageScene();
    try {
      assert.equal(r._images.get("a.png"), Renderer.IMAGE_LOADING);
      await flush();
      assert.notEqual(r._images.get("a.png"), Renderer.IMAGE_LOADING);
      assert.equal(typeof r._images.get("a.png"), "object");
    } finally { restore(); }
  });

  test("a node falls back to its colour while loading", () => {
    const { r, ctx, restore } = imageScene();
    try {
      ctx.ops.length = 0;
      r.render();
      assert.equal(opsNamed(ctx, "drawImage").length, 0);
      assert.ok(opsNamed(ctx, "fill").length >= 1);
    } finally { restore(); }
  });

  test("a loaded image is clipped to the node circle", async () => {
    const { r, ctx, restore } = imageScene();
    try {
      await flush();
      ctx.ops.length = 0;
      r.render();
      assert.equal(opsNamed(ctx, "clip").length, 1);
      const [, , ...box] = opsNamed(ctx, "drawImage")[0];
      for (const v of box) assert.ok(Number.isFinite(v));
    } finally { restore(); }
  });

  test("a failed load does not reach drawImage", async () => {
    const { r, ctx, restore } = imageScene(() => true);
    try {
      await flush();
      assert.equal(r._images.get("a.png"), Renderer.IMAGE_FAILED);
      ctx.ops.length = 0;
      // The stub ctx throws on a non-image source, matching the browser.
      r.render();
      assert.equal(opsNamed(ctx, "drawImage").length, 0);
      assert.ok(opsNamed(ctx, "fill").length >= 1, "should fall back to the colour fill");
    } finally { restore(); }
  });

  test("dead entries are collected once the debt threshold is passed", async () => {
    const restore = installImage();
    try {
      const canvas = makeCanvas();
      const g = new Graph();
      const sim = new Simulation(g, {});
      const r = new Renderer(sim, { canvas, nodeConfig: { image: n => n.data.img ?? null } });

      for (let i = 0; i < 40; i++) {
        g.addNode({ id: "u" + i, img: "u" + i + ".png" });
        sim.sync(); r.sync();
        g.removeNode("u" + i);
        sim.sync(); r.sync();
      }
      await flush();

      const live = new Set();
      for (const style of r.nodes.values()) if (style.image) live.add(style.image);
      const dead = [...r._images.keys()].filter(src => !live.has(src));
      assert.ok(dead.length <= 17, `cache retained ${dead.length} dead entries`);
    } finally { restore(); }
  });

  test("a swept entry is not resurrected by a late load", async () => {
    const restore = installImage();
    try {
      const canvas = makeCanvas();
      const g = new Graph();
      g.addNode({ id: "a", img: "late.png" });
      const sim = new Simulation(g, {});
      const r = new Renderer(sim, { canvas, nodeConfig: { image: n => n.data.img ?? null } });
      r.sync();
      assert.equal(r._images.get("late.png"), Renderer.IMAGE_LOADING);

      r._images.delete("late.png");          // simulate the sweep landing first
      await flush();                          // then the load completes
      assert.equal(r._images.has("late.png"), false,
        "an in-flight load must not re-add an entry for a node that is gone");
    } finally { restore(); }
  });
});

describe("Renderer: attach lifecycle", () => {
  function headless() {
    const g = new Graph();
    g.addNode({ id: "a" });
    g.addNode({ id: "b" });
    g.addEdge("a", "b");
    const sim = new Simulation(g, {});
    return new Renderer(sim, {});
  }

  test("constructs with no canvas and still resolves styles", () => {
    const r = headless();
    assert.equal(r.canvas, null);
    assert.equal(r.ctx, null);
    assert.equal(r.size, null);
    assert.equal(r.nodes.size, 2, "style resolution must not depend on a canvas");
    assert.equal(r._nodeStyles.length, 2);
  });

  test("render reports that it did nothing", () => {
    assert.equal(headless().render(), false);
  });

  test("attach wires up canvas, context and size together", () => {
    const r = headless();
    const canvas = makeCanvas({ w: 640, h: 480 });
    r.attach(canvas);
    assert.equal(r.canvas, canvas);
    assert.equal(r.ctx, canvas.ctx);
    assert.deepEqual(r.size, { w: 640, h: 480 });
    assert.equal(r.render(), true, "render should now proceed and report that it drew");
    assert.ok(canvas.ctx.ops.some(o => o[0] === "fillRect"));
  });

  test("detach clears all three fields together", () => {
    const r = headless();
    r.attach(makeCanvas());
    r.detach();
    assert.deepEqual([r.canvas, r.ctx, r.size], [null, null, null],
      "a partial detach would leave render() dereferencing null");
  });

  test("detach is idempotent", () => {
    const r = headless();
    assert.doesNotThrow(() => { r.detach(); r.detach(); });
  });

  test("styles and caches survive a detach/attach cycle", () => {
    const r = headless();
    r.setNodeConfig("a", { color: "#abcdef" });
    r.sync();
    const style = r.nodes.get("a");

    r.attach(makeCanvas());
    r.detach();
    r.attach(makeCanvas());
    r.sync();
    assert.equal(r.nodes.get("a"), style, "the style cache should not be rebuilt by attaching");
    assert.equal(style.color, "#abcdef");
  });

  test("the view is preserved across attach", () => {
    const r = headless();
    r.view = { x: 10, y: -20, zoom: 3 };
    r.attach(makeCanvas());
    assert.deepEqual(r.view, { x: 10, y: -20, zoom: 3 });
  });
});

describe("Renderer: resize and canvas kinds", () => {
  const sim = () => new Simulation(new Graph(), {});

  /* Removes the DPR globals for one test, restoring them exactly afterwards. */
  function withoutWindow(fn) {
    const had = { window: "window" in globalThis, dpr: "devicePixelRatio" in globalThis };
    const prev = [globalThis.window, globalThis.devicePixelRatio];
    delete globalThis.window;
    delete globalThis.devicePixelRatio;
    try { fn(); } finally {
      if (had.window) globalThis.window = prev[0];
      if (had.dpr) globalThis.devicePixelRatio = prev[1];
    }
  }

  test("works with no window at all, as in a worker or Node", () => {
    // Regression: `window?.devicePixelRatio` throws a ReferenceError when
    // `window` is undeclared; `?.` only guards a null value.
    withoutWindow(() => {
      const canvas = makeCanvas({ w: 400, h: 300 });
      const r = new Renderer(sim(), { canvas });
      assert.deepEqual([canvas.width, canvas.height], [400, 300], "DPR should fall back to 1");
      assert.deepEqual(r.size, { w: 400, h: 300 });
    });
  });

  test("an on-screen canvas before layout reads as 0x0, not the 300x150 default", () => {
    // Regression: a truthiness check on clientWidth sent unlaid-out canvases
    // down the OffscreenCanvas path, giving a plausible but wrong size.
    const canvas = makeCanvas();
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    canvas.width = 300;
    canvas.height = 150;
    const r = new Renderer(sim(), { canvas });
    assert.deepEqual(r.size, { w: 0, h: 0 });
  });

  test("an OffscreenCanvas is used as-is, with an identity transform", () => {
    const restoreWindow = installWindow(2);
    try {
      const canvas = makeCanvas({ w: 640, h: 480 });
      delete canvas.clientWidth;          // OffscreenCanvas has no layout size
      delete canvas.clientHeight;
      const r = new Renderer(sim(), { canvas });
      assert.deepEqual(r.size, { w: 640, h: 480 });
      assert.deepEqual([canvas.width, canvas.height], [640, 480],
        "the caller owns an OffscreenCanvas's backing store; DPR must not rescale it");
      assert.deepEqual(opsNamed(canvas.ctx, "setTransform").pop(), ["setTransform", 1, 0, 0, 1, 0, 0]);
    } finally { restoreWindow(); }
  });

  test("attach rejects a canvas without a 2D context and stays detached", () => {
    const r = new Renderer(sim(), {});
    const canvas = { ...makeCanvas(), getContext: () => null };
    assert.throws(() => r.attach(canvas), { name: "TypeError", message: /2D context/ });
    assert.equal(r.canvas, null, "a failed attach must not leave a canvas without a context");
    assert.equal(r.ctx, null);
  });

  test("resize does nothing while detached", () => {
    const r = new Renderer(sim(), {});
    assert.equal(r.resize(), r);
    assert.equal(r.size, null);
  });

  test("attach resizes exactly once", () => {
    const canvas = makeCanvas();
    new Renderer(sim(), {}).attach(canvas);
    assert.equal(opsNamed(canvas.ctx, "setTransform").length, 1);
  });
});

describe("Renderer: options", () => {
  const sim = () => new Simulation(new Graph(), {});

  test("opts keeps only persistent settings, not setup values", () => {
    // Regression: spreading the input copied canvas/nodeConfig into opts,
    // where they went stale after attach() or setDefaultNodeConfig().
    const r = new Renderer(sim(), {
      canvas: makeCanvas(), nodeConfig: { color: "red" }, edgeConfig: { width: 3 }, background: "#000",
    });
    for (const setup of ["canvas", "nodeConfig", "edgeConfig"])
      assert.equal(setup in r.opts, false, `${setup} is applied once, not stored`);
    assert.equal(r.opts.background, "#000");
  });

  test("a forwarded undefined background falls back to the default", () => {
    // e.g. React's background={props.bg} when the prop is unset
    const r = new Renderer(sim(), { background: undefined });
    assert.equal(r.opts.background, "#ffffff");
  });

  test("the background is painted from opts", () => {
    const canvas = makeCanvas();
    const r = new Renderer(sim(), { canvas, background: "#123456" });
    r.render();
    assert.equal(canvas.ctx.fillStyle, "#123456");
  });
});

describe("Renderer: renderEdges", () => {
  // Every edge shape in one scene: a bowed reciprocal pair with arrowheads,
  // plus a self-loop. Nodes contribute exactly one arc each.
  const ALL_EDGES = [["a", "b"], ["b", "a"], ["a", "a"]];
  const EDGE_OPS = ["moveTo", "lineTo", "quadraticCurveTo", "closePath"];

  function edgeOps(ctx) { return EDGE_OPS.flatMap(name => opsNamed(ctx, name)); }

  test("defaults to true, including for a forwarded undefined", () => {
    assert.equal(scene(false, []).r.opts.renderEdges, true);
    assert.equal(scene(false, [], { opts: { renderEdges: undefined } }).r.opts.renderEdges, true);
  });

  test("edges are drawn by default", () => {
    const { r, ctx } = scene(true, ALL_EDGES);
    r.render();
    assert.ok(edgeOps(ctx).length > 0);
    assert.equal(opsNamed(ctx, "arc").length, 3, "two nodes plus the self-loop");
  });

  test("false skips every edge shape but still draws the nodes", () => {
    const { r, ctx } = scene(true, ALL_EDGES, { opts: { renderEdges: false } });
    r.render();
    assert.deepEqual(edgeOps(ctx), [], "lines, curves and arrowheads must all be skipped");
    assert.equal(opsNamed(ctx, "arc").length, 2, "only the node circles remain; no self-loop");
    assert.equal(opsNamed(ctx, "fillRect").length, 1, "the background is still painted");
  });

  test("setOpts toggles edges on a live renderer", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);

    r.setOpts({ renderEdges: false });
    r.render();
    assert.deepEqual(edgeOps(ctx), []);

    ctx.ops.length = 0;
    r.setOpts({ renderEdges: true });
    r.render();
    assert.deepEqual(opsNamed(ctx, "moveTo")[0].slice(1).map(r2), [320, 300]);
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [480, 300]);
  });

  test("hidden edges keep their styles in sync with the graph", () => {
    const { g, sim, r, ctx } = scene(false, [["a", "b"]], { opts: { renderEdges: false } });
    g.addNode({ id: "c" });
    g.addEdge("b", "c");
    sim.sync();
    r.render();
    assert.equal(r.edgeStyles.length, 2, "caches must stay aligned while edges are hidden");

    ctx.ops.length = 0;
    r.setOpts({ renderEdges: true });
    r.render();
    assert.ok(opsNamed(ctx, "lineTo").length >= 1, "re-enabling draws from the up-to-date cache");
  });
});

describe("Renderer: image request options", () => {
  /* A renderer with one image node per source. `requests` records each load
     as it was sent; see installImage. */
  function load(opts = {}, srcs = ["a.png"]) {
    const restore = installImage();
    const g = new Graph();
    srcs.forEach((src, i) => g.addNode({ id: "n" + i, img: src }));
    const sim = new Simulation(g, {});
    const r = new Renderer(sim, {
      canvas: makeCanvas(),
      nodeConfig: { image: n => n.data.img ?? null },
      ...opts,
    });
    return { r, g, sim, requests: restore.requests, restore };
  }

  test("requests use crossOrigin \"anonymous\" and no referrer by default", () => {
    const { requests, restore } = load();
    try {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].crossOrigin, "anonymous");
      assert.equal(requests[0].referrerPolicy, "no-referrer");
    } finally { restore(); }
  });

  test("constructor options are applied to the request", () => {
    const { requests, restore } = load({ crossOrigin: "use-credentials", imageReferrerPolicy: "origin" });
    try {
      assert.deepEqual([requests[0].crossOrigin, requests[0].referrerPolicy], ["use-credentials", "origin"],
        "options must be in place before src is assigned, or the request goes out without them");
    } finally { restore(); }
  });

  test("an explicit null crossOrigin is kept, not replaced by the default", () => {
    // Regression guard: `??` treats null as missing, which would silently turn
    // a deliberate "no CORS" back into "anonymous".
    const { r, requests, restore } = load({ crossOrigin: null });
    try {
      assert.equal(r.opts.crossOrigin, null);
      assert.equal(requests[0].crossOrigin, null);
    } finally { restore(); }
  });

  test("an undefined option falls back to its default", () => {
    // e.g. a framework prop forwarded while unset
    const { r, restore } = load({ crossOrigin: undefined, imageReferrerPolicy: undefined });
    try {
      assert.equal(r.opts.crossOrigin, "anonymous");
      assert.equal(r.opts.imageReferrerPolicy, "no-referrer");
    } finally { restore(); }
  });

  test("changing the options affects later loads only", () => {
    const { r, g, sim, requests, restore } = load({}, ["a.png"]);
    try {
      r.opts.imageReferrerPolicy = "origin";
      g.addNode({ id: "late", img: "b.png" });
      sim.sync();
      r.sync();
      assert.deepEqual(requests.map(q => [q.src, q.referrerPolicy]),
        [["a.png", "no-referrer"], ["b.png", "origin"]],
        "a.png is already cached, so it is not requested again with the new policy");
    } finally { restore(); }
  });
});
