import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/graph.js";
import { Simulation } from "../src/simulation.js";
import { Renderer } from "../src/renderer.js";
import {
  makeCanvas, installImage, installOffscreenCanvas, installWindow, opsNamed, flush, r2,
} from "./helpers/stubs.js";

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

describe("Renderer: stroke scaling", () => {
  /* Logs each stroke and fill with the line width and alpha it was drawn at.
     Edges are drawn first, then node a (fill, outline), then node b. */
  function recordStrokes(ctx) {
    ctx.globalAlpha = 1;
    ctx.stroke = () => ctx.ops.push(["stroke", ctx.lineWidth, ctx.globalAlpha]);
    ctx.fill = () => ctx.ops.push(["fill", ctx.lineWidth, ctx.globalAlpha]);
  }
  const strokes = ctx => opsNamed(ctx, "stroke").map(o => o.slice(1).map(r2));

  test("edge and outline widths scale with zoom", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);
    recordStrokes(ctx);
    r.view.zoom = 2;
    r.render();
    assert.deepEqual(strokes(ctx), [[2, 1], [2, 1], [2, 1]], "edge, then both outlines");
  });

  test("zoom 1 draws at the configured widths", () => {
    const { r, ctx } = scene(true, [["a", "b"]], { edgeCfg: { width: 3 } });
    recordStrokes(ctx);
    r.render();
    assert.equal(strokes(ctx)[0][0], 3);
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [470, 300], "10px arrowhead");
  });

  test("edges are capped at maxEdgeWidth, and their arrowheads shrink to match", () => {
    // Nodes land at canvas (0,300) and (800,300) with radius 80
    const { r, ctx } = scene(true, [["a", "b"]], { edgeCfg: { width: 4 } });
    recordStrokes(ctx);
    r.view.zoom = 4;                                  // 16 px wide, capped at 8
    r.render();
    assert.equal(strokes(ctx)[0][0], 8);
    // Tip at 720; the width was halved by the cap, so the head is 10 * 4 / 2
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [700, 300]);
  });

  test("edges thinner than minEdgeWidth are drawn at it, fainter", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);
    recordStrokes(ctx);
    r.view.zoom = 0.25;
    r.render();
    const [edge, ...rest] = opsNamed(ctx, "stroke").map(o => o.slice(1));
    assert.deepEqual(edge, [1, 0.25]);
    for (const [, alpha] of rest) assert.equal(alpha, 1, "alpha is restored for the nodes");
    for (const [, , alpha] of opsNamed(ctx, "fill")) assert.equal(alpha, 1);
  });

  test("edges and outlines too faint to see are skipped", () => {
    const { r, ctx } = scene(false, [["a", "b"]]);
    recordStrokes(ctx);
    r.view.zoom = 0.04;                               // 0.04 px edges and outlines
    r.render();
    assert.equal(opsNamed(ctx, "stroke").length, 0);
    assert.equal(opsNamed(ctx, "fill").length, 2, "nodes are still filled");
  });

  test("a short directed edge stays visible when zoomed out", () => {
    // Centres 20 px apart with radius 6: the 8 px gap fits a 1 px arrowhead,
    // but a fixed 10 px one would hide the edge
    const { r, ctx } = scene(true, [["a", "b"]], { radius: 60 });
    r.view.zoom = 0.1;
    r.render();
    assert.equal(opsNamed(ctx, "closePath").length, 1, "the arrowhead is drawn");
  });

  test("the fade multiplies the highlight alpha", () => {
    const { r, ctx } = scene(false, [["a", "b"]], { opts: { highlightFadeDuration: 0 } });
    recordStrokes(ctx);
    r.addHighlight({ nodes: ["a"] });
    r.view.zoom = 0.5;
    r.render();
    const [edge, aOutline, bOutline] = strokes(ctx).map(([, alpha]) => alpha);
    assert.equal(edge, r2(0.15 * 0.5));
    assert.equal(bOutline, 1, "highlighted node a is drawn last");
    assert.equal(aOutline, 0.15, "dimmed node b keeps the highlight alpha");
  });

  test("self-loops shrink with zoom", () => {
    const { r, ctx } = scene(true, [["a", "a"]]);
    r.view.zoom = 0.5;                                // node radius 10
    r.render();
    const loop = opsNamed(ctx, "arc")[0];
    assert.equal(r2(loop[3]), 8, "a 5 px arrowhead no longer forces a 16 px loop");
  });

  test("scaleStrokes: false keeps screen-px widths at every zoom", () => {
    const { r, ctx } = scene(true, [["a", "b"]], { opts: { scaleStrokes: false } });
    recordStrokes(ctx);
    r.view.zoom = 4;
    r.render();
    assert.deepEqual(strokes(ctx).map(([w]) => w), [1, 1, 1]);
    // Tip at 720 with a 10 px head
    assert.deepEqual(opsNamed(ctx, "lineTo")[0].slice(1).map(r2), [710, 300]);
    ctx.ops.length = 0;
    r.view.zoom = 0.25;
    r.render();
    assert.deepEqual(strokes(ctx)[0], [1, 1], "no fade");
  });

  test("setOpts rejects negative edge width limits, and changes nothing", () => {
    const { r } = scene(false, []);
    assert.throws(() => r.setOpts({ minEdgeWidth: -1, scaleStrokes: false }), RangeError);
    assert.throws(() => r.setOpts({ maxEdgeWidth: -5 }), RangeError);
    assert.deepEqual([r.opts.minEdgeWidth, r.opts.maxEdgeWidth, r.opts.scaleStrokes], [1, 8, true]);
    r.setOpts({ minEdgeWidth: 0, maxEdgeWidth: Infinity });
    assert.deepEqual([r.opts.minEdgeWidth, r.opts.maxEdgeWidth], [0, Infinity]);
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
    assert.throws(() => r.setEdgeConfig("b", "a", { color: "red" }), /^ReferenceError: Renderer: no edge from "b" to "a"$/);
    assert.throws(() => r.setEdgeConfig("a", "nope", { color: "red" }), { name: "ReferenceError", message: /^Renderer:/ });
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

  test("a node seen in one frame doesn't keep its edges in the next", () => {
    const { sim, r, ctx } = scene(false, [["a", "b"]]);
    r.render();
    assert.ok(opsNamed(ctx, "lineTo").length >= 1, "drawn while both nodes are on screen");

    // Both off screen on the same side, so the edge can't cross the view
    sim.nodes.get("a").x = 100000;
    sim.nodes.get("b").x = 100100;
    ctx.ops.length = 0;
    r.render();
    assert.equal(opsNamed(ctx, "lineTo").length, 0, "the edge should be culled");
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
      assert.deepEqual(r.images.get("a.png"), { status: "loading", image: null, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
      await flush();
      const entry = r.images.get("a.png");
      assert.equal(entry.status, "loaded");
      assert.equal(typeof entry.image, "object");
      assert.ok(entry.image);
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
      assert.deepEqual(r.images.get("a.png"), { status: "failed", image: null, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
      ctx.ops.length = 0;
      // The stub ctx throws on a non-image source, matching the browser.
      r.render();
      assert.equal(opsNamed(ctx, "drawImage").length, 0);
      assert.ok(opsNamed(ctx, "fill").length >= 1, "should fall back to the colour fill");
    } finally { restore(); }
  });

  test("a failed image is retried by loadImage, not by sync, and drawn once it loads", async () => {
    let down = true;
    const { g, r, ctx, restore } = imageScene(() => down);
    try {
      await flush();
      assert.equal(r.images.get("a.png")?.status, "failed");

      down = false;
      g.addNode({ id: "b" });
      r.sync();
      assert.equal(r.images.get("a.png")?.status, "failed", "a graph change doesn't retry it");

      assert.equal(r.loadImage("a.png"), true);
      assert.equal(r.images.get("a.png")?.status, "loading");
      await flush();
      assert.equal(r.images.get("a.png")?.status, "loaded");

      ctx.ops.length = 0;
      r.render();
      assert.equal(opsNamed(ctx, "drawImage").length, 1);
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
      const dead = [...r._imageCache._images.keys()].filter(src => !live.has(src));
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
      assert.equal(r.images.get("late.png").status, "loading");

      r._imageCache._images.delete("late.png");          // simulate the sweep landing first
      await flush();                          // then the load completes
      assert.equal(r._imageCache._images.has("late.png"), false,
        "an in-flight load must not re-add an entry for a node that is gone");
    } finally { restore(); }
  });
});

describe("Renderer: image events", () => {
  /* A renderer whose node images are requested on construction, with every
     image event recorded along with the `images` entry seen by the listener. */
  function eventScene(srcs, fail = () => false) {
    const restore = installImage({ fail });
    const g = new Graph();
    for (const src of srcs) g.addNode({ img: src });
    const sim = new Simulation(g, {});
    const r = new Renderer(sim, { canvas: makeCanvas(), nodeConfig: { image: n => n.data.img ?? null } });
    const events = [];
    const record = e => events.push({ ...e, status: r.images.get(e.src)?.status });
    r.on("imageload", record).on("imageerror", record);
    return { r, events, restore };
  }

  test("imageload carries the source and image; imageerror the source", async () => {
    const { r, events, restore } = eventScene(["a.png", "bad.png"], src => src === "bad.png");
    try {
      assert.deepEqual(events, [], "nothing until a request settles");
      await flush();
      assert.equal(events.length, 2);
      const load = events.find(e => e.type === "imageload");
      const error = events.find(e => e.type === "imageerror");
      assert.equal(load.src, "a.png");
      assert.equal(load.image, r.images.get("a.png")?.image);
      assert.equal(load.target, r);
      assert.equal(load.status, "loaded", "`images` is updated before the event");
      assert.equal(error.src, "bad.png");
      assert.equal("image" in error, false);
      assert.equal(error.status, "failed");
    } finally { restore(); }
  });

  test("a retry by loadImage emits again", async () => {
    let down = true;
    const { r, events, restore } = eventScene(["a.png"], () => down);
    try {
      await flush();
      down = false;
      r.loadImage("a.png");
      await flush();
      assert.deepEqual(events.map(e => e.type), ["imageerror", "imageload"]);
    } finally { restore(); }
  });

  test("a source collected before it settles emits nothing", async () => {
    const { r, events, restore } = eventScene(["a.png"]);
    try {
      r._imageCache.collect(new Set());
      await flush();
      assert.deepEqual(events, []);
    } finally { restore(); }
  });

  test("unknown event names throw", () => {
    const { r, restore } = eventScene([]);
    try {
      assert.throws(() => r.on("settle", () => {}), TypeError);
    } finally { restore(); }
  });
});

describe("Renderer: sprites", () => {
  /* Image nodes of radius 20 at the canvas centre (400, 300), so each is 40 px
     across at zoom 1, with a stubbed OffscreenCanvas so sprites can be built.
     Node `id` uses the image `${id}.png`. `sources` lists the bitmaps
     createImageBitmap made; `bitmaps` the finished sprites. */
  async function spriteScene({ ids = ["a"], size = 256, width, height, bitmap, dpr, oc, opts, color } = {}) {
    const restores = [];
    if (dpr !== undefined) restores.push(installWindow(dpr));
    const restoreImage = installImage({ size, width, height, bitmap });
    restores.push(restoreImage);
    const restoreCanvas = installOffscreenCanvas(oc);
    restores.push(restoreCanvas);

    const canvas = makeCanvas();
    const g = new Graph();
    for (const id of ids) g.addNode({ id, img: id + ".png" });
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ radius: 20 });
    sim.sync();
    for (const n of sim.nodeList) { n.x = 0; n.y = 0; }
    const nodeConfig = { image: n => n.data.img, ...(color && { color }) };
    const r = new Renderer(sim, { canvas, nodeConfig, ...opts });
    await flush();                                     // images load
    return {
      g, sim, r, ctx: canvas.ctx, created: restoreCanvas.created, bitmaps: restoreCanvas.bitmaps,
      sources: restoreImage.sources,
      restore: () => restores.reverse().forEach(f => f()),
    };
  }

  /* Renders until a frame starts no sprite builds, waiting for each round of
     builds. The last frame's ops are left in the log. */
  async function renderBuilt(s) {
    for (;;) {
      s.ctx.ops.length = 0;
      s.r.render();
      if (!s.r.isPreparingImages()) return;
      await flush();
    }
  }

  // Sprites drawn onto the main canvas, in draw order. Sprites record the
  // canvas they were masked in.
  const drawnSprites = ctx =>
    opsNamed(ctx, "drawImage").map(([, src]) => src).filter(s => "source" in s);

  describe("choosing a sprite", () => {
    test("a loaded image draws as a sprite from its first frame", async () => {
      const s = await spriteScene();
      try {
        s.r.render();
        const [[, sprite, ...box]] = opsNamed(s.ctx, "drawImage");
        assert.equal(sprite, s.bitmaps[0], "the fallback sprite made as it loaded");
        assert.equal(sprite.width, 64, "40 px on screen picks the 64 sprite");
        assert.deepEqual(box, [380, 280, 40, 40]);
        for (const op of ["clip", "save", "restore"])
          assert.equal(opsNamed(s.ctx, op).length, 0, `a cached sprite needs no ${op}()`);
        assert.equal(s.r.isPreparingImages(), false, "nothing else to build");
      } finally { s.restore(); }
    });

    test("zooming in draws the cached sprite until the larger one is built", async () => {
      const s = await spriteScene();
      try {
        await renderBuilt(s);
        s.r.view.zoom = 2;
        s.ctx.ops.length = 0;
        s.r.render();
        assert.equal(drawnSprites(s.ctx)[0].width, 64, "stretched meanwhile, not clipped");
        assert.equal(opsNamed(s.ctx, "clip").length, 0);
        await renderBuilt(s);
        assert.equal(drawnSprites(s.ctx)[0].width, 128);
      } finally { s.restore(); }
    });

    test("the device pixel ratio counts toward the size", async () => {
      const s = await spriteScene({ dpr: 2 });
      try {
        await renderBuilt(s);
        assert.equal(drawnSprites(s.ctx)[0].width, 128, "40 CSS px at 2x is 80 device px");
      } finally { s.restore(); }
    });

    // [source size, zoom, dpr, sprite drawn]
    for (const [size, zoom, dpr, want, why] of [
      [64, 4, 1, 64, "never larger than the source"],
      [2048, 16, 1, 1024, "the largest standard size covers nodes up to 1024 px"],
      [4000, 32, 1, 2048, "past 1024 px, the source's side, capped at 2048"],
      [2048, 16, 2, 2048, "the device pixel ratio counts toward that too"],
      [400, 7.5, 1, 400, "between standard sizes, the source's side when it has more detail"],
      [256, 10, 1, 256, "a source smaller than the node, at its own side"],
    ]) {
      test(`a ${size} px source at zoom ${zoom}, ${dpr}x: ${why}`, async () => {
        const s = await spriteScene({ size, dpr });
        try {
          s.r.view.zoom = zoom;
          await renderBuilt(s);
          assert.equal(drawnSprites(s.ctx)[0].width, want);
          assert.equal(opsNamed(s.ctx, "clip").length, 0);
          assert.ok(s.created.every(c => c.width <= want), "no larger sprite is built");
        } finally { s.restore(); }
      });
    }

    test("below 6 device px a node is a dot in the image's average colour", async () => {
      const s = await spriteScene({ color: "#ff0000" });
      try {
        s.r.view.zoom = 0.1;                             // 4 px across
        s.r.render();
        assert.equal(opsNamed(s.ctx, "drawImage").length, 0);
        assert.equal(s.ctx.fillStyle, "rgb(10, 20, 30)");
      } finally { s.restore(); }
    });

    test("a dot falls back to the node colour when pixels can't be read", async () => {
      const s = await spriteScene({ oc: { tainted: true }, color: "#ff0000" });
      try {
        s.r.view.zoom = 0.1;
        await renderBuilt(s);
        assert.equal(s.ctx.fillStyle, "#ff0000", "a cross-origin image taints the canvas");
      } finally { s.restore(); }
    });

    test("an image without a size is drawn as the node colour", async () => {
      const s = await spriteScene({ size: 0, color: "#ff0000" });
      try {
        await renderBuilt(s);
        assert.equal(opsNamed(s.ctx, "drawImage").length, 0);
        assert.equal(s.ctx.fillStyle, "#ff0000");
      } finally { s.restore(); }
    });
  });

  describe("building sprites", () => {
    test("sprites are bitmaps, masked in one reused canvas per size", async () => {
      const s = await spriteScene({ ids: ["a", "b", "c"] });
      try {
        await renderBuilt(s);
        assert.equal(drawnSprites(s.ctx).length, 3, "every node draws an ImageBitmap");
        assert.equal(s.bitmaps.length, 3);
        assert.equal(s.created.filter(c => c.width === 64).length, 1,
          "the canvas is handed off and reused, not one canvas per sprite");
      } finally { s.restore(); }
    });

    test("a sprite is cropped and resized from the element, then masked to a circle", async () => {
      const s = await spriteScene({ width: 200, height: 100 });
      try {
        await renderBuilt(s);
        const [resized] = s.sources;
        assert.equal(resized.image, s.r.images.get("a.png")?.image, "made from the loaded element");
        assert.deepEqual(resized.crop, [50, 0, 100, 100], "its centre square");
        assert.deepEqual(resized.opts, { resizeWidth: 64, resizeHeight: 64, resizeQuality: "high" });
        assert.equal(resized.closed, true);

        const { ctx } = drawnSprites(s.ctx)[0].source;
        const ops = ctx.ops.map(([n, v]) => n === "globalCompositeOperation" ? v : n);
        assert.deepEqual(ops.slice(ops.indexOf("drawImage")),
          ["drawImage", "destination-in", "beginPath", "arc", "fill", "source-over"]);
        assert.deepEqual(opsNamed(ctx, "drawImage")[0].slice(1), [resized, 0, 0, 64, 64]);
        assert.deepEqual(opsNamed(ctx, "arc")[0].slice(1, 4), [32, 32, 32]);
      } finally { s.restore(); }
    });

    test("sprites are reused across frames", async () => {
      const s = await spriteScene();
      try {
        await renderBuilt(s);
        const sources = s.sources.length, bitmaps = s.bitmaps.length;
        s.r.render();
        assert.equal(s.sources.length, sources);
        assert.equal(s.bitmaps.length, bitmaps, "nothing is rebuilt");
        assert.equal(s.r.isPreparingImages(), false);
      } finally { s.restore(); }
    });

    test("at most 16 sprites are built at once; until theirs is ready, nodes draw their fallback", async () => {
      const ids = Array.from({ length: 40 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids });
      try {
        s.r.view.zoom = 2;                               // 80 px: the 128 sprite
        for (const sharp of [0, 16, 32, 40]) {
          s.ctx.ops.length = 0;
          s.r.render();
          const widths = drawnSprites(s.ctx).map(t => t.width);
          assert.equal(widths.filter(w => w === 128).length, sharp);
          assert.equal(widths.filter(w => w === 64).length, 40 - sharp);
          assert.equal(opsNamed(s.ctx, "clip").length, 0, "the image itself is never drawn");
          await flush();
        }
        assert.equal(s.r.isPreparingImages(), false);
      } finally { s.restore(); }
    });

    test("without createImageBitmap, images are always drawn clipped", async () => {
      const s = await spriteScene({ bitmap: false });
      try {
        await renderBuilt(s);
        assert.equal(opsNamed(s.ctx, "clip").length, 1);
        assert.ok(opsNamed(s.ctx, "drawImage")[0][1] instanceof globalThis.Image);
      } finally { s.restore(); }
    });
  });

  describe("cache", () => {
    const SPRITE_128 = 128 * 128 * 4;

    test("defaults to 64 MB; negative budgets are rejected", () => {
      assert.equal(scene(false, []).r.opts.imageCacheMB, 64);
      assert.throws(() => scene(false, [], { opts: { imageCacheMB: -1 } }), RangeError);
      const { r } = scene(false, []);
      assert.throws(() => r.setOpts({ imageCacheMB: NaN }), RangeError);
      r.setOpts({ imageCacheMB: 0 });
      assert.equal(r.opts.imageCacheMB, 0);
    });

    test("sprites on screen are kept even over budget; unused ones are evicted and closed", async () => {
      const s = await spriteScene({ opts: { imageCacheMB: 0.001 } });
      try {
        s.r.view.zoom = 2;                               // 80 px: the 128 sprite
        await renderBuilt(s);
        assert.equal(s.r._imageCache._bytes, SPRITE_128, "the visible sprite stays despite the budget");
        const [fallback, sprite128] = s.bitmaps;
        s.r.view.zoom = 4;                               // 160 px: the 256 sprite
        await renderBuilt(s);
        assert.deepEqual([...s.r._imageCache._recs.get("a.png").slots.keys()], [64, 256]);
        assert.equal(s.r._imageCache._bytes, 256 * 256 * 4, "the fallback isn't counted");
        assert.equal(sprite128.closed, true, "eviction must free the pixels, not wait for GC");
        assert.equal(fallback.closed, false, "the fallback is never evicted");
        assert.equal(s.bitmaps[2].closed, false);
      } finally { s.restore(); }
    });

    test("the least recently drawn sprite is evicted first", async () => {
      const s = await spriteScene({ ids: ["a", "b"] });
      try {
        s.r.view.zoom = 2;
        await renderBuilt(s);                            // a and b both have a 128
        s.sim.nodes.get("b").x = 1e5;                    // b goes off screen
        s.r.render();
        s.r.setOpts({ imageCacheMB: SPRITE_128 / 1024 / 1024 });
        s.r.render();
        assert.deepEqual([...s.r._imageCache._recs.get("a.png").slots.keys()], [64, 128]);
        assert.deepEqual([...s.r._imageCache._recs.get("b.png").slots.keys()], [64], "only its fallback is left");
        assert.equal(s.r._imageCache._bytes, SPRITE_128);
      } finally { s.restore(); }
    });

    test("collecting an unused image drops and closes its sprites", async () => {
      const ids = Array.from({ length: 17 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids, size: 64 });
      try {
        await renderBuilt(s);
        assert.equal(s.r._imageCache._recs.size, 17);
        for (const id of ids) s.g.removeNode(id);        // 17 removals pass the GC threshold
        s.r.sync();
        assert.equal(s.r._imageCache._bytes, 0);
        assert.equal(s.r._imageCache._lru.size, 0);
        assert.equal(s.r._imageCache._recs.size, 0);
        assert.ok(s.bitmaps.every(b => b.closed), "every dropped sprite is closed");
      } finally { s.restore(); }
    });

    test("images that nodes stop using are collected", async () => {
      const ids = Array.from({ length: 17 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids, size: 64 });
      try {
        await renderBuilt(s);
        s.r.setDefaultNodeConfig({ image: n => n.id + "-new.png" });
        s.r.sync();                                      // 17 changes pass the GC threshold
        assert.deepEqual([...s.r.images.keys()].sort(), ids.map(id => id + "-new.png").sort());
        assert.ok(s.bitmaps.every(b => b.closed));
      } finally { s.restore(); }
    });

    test("a dimmed image node draws its sprite at the dimmed alpha", async () => {
      const s = await spriteScene({ ids: ["a", "b"], opts: { highlightFadeDuration: 0 } });
      try {
        s.r.setHighlight({ nodes: ["b"] });
        await renderBuilt(s);
        const alphas = [];
        const drawImage = s.ctx.drawImage;
        s.ctx.drawImage = (...args) => { alphas.push(s.ctx.globalAlpha); return drawImage(...args); };
        s.ctx.ops.length = 0;
        s.r.render();
        assert.deepEqual(alphas, [0.15, 1]);
        assert.equal(drawnSprites(s.ctx).length, 2);
      } finally { s.restore(); }
    });
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

describe("Renderer: option checks", () => {
  test("invalid options throw, naming the option, and change nothing", () => {
    const { r } = scene(false, []);
    const before = { ...r.opts };
    for (const [bad, pattern] of [
      [{ background: 0 }, /^TypeError: Renderer: `background` must be a string or null$/],
      [{ renderEdges: 1 }, /renderEdges/],
      [{ labelMargin: NaN }, /labelMargin/],
      [{ highlightMode: "fade" }, /highlightMode/],
      [{ highlightAlpha: NaN }, /^RangeError: Renderer: `highlightAlpha`/],
      [{ crossOrigin: "anon" }, /^RangeError: Renderer: `crossOrigin` must be one of .*, or a function of the image source$/],
      [{ imageReferrerPolicy: "no-referer" }, /imageReferrerPolicy/],
      [{ colour: "red" }, /^TypeError: Renderer: unknown option `colour`$/],
      [{ background: "#000", highlightAlpha: 2 }, /highlightAlpha/],
    ]) assert.throws(() => r.setOpts(bad), pattern, JSON.stringify(bad));
    assert.deepEqual(r.opts, before, "a rejected call changes nothing, including its valid options");
  });

  test("the constructor checks options too", () => {
    assert.throws(() => scene(false, [], { opts: { labelPosition: "middle" } }), RangeError);
    assert.throws(() => scene(false, [], { opts: { bg: "#000" } }), TypeError);
  });

  test("a null crossOrigin and undefined values are accepted", () => {
    const { r } = scene(false, []);
    r.setOpts({ crossOrigin: null, background: undefined });
    assert.equal(r.opts.crossOrigin, null);
    assert.equal(r.opts.background, "#ffffff", "undefined keeps the current value");
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

  test("each frame clears the whole canvas before painting the background", () => {
    const canvas = makeCanvas({ w: 300, h: 200 });
    const r = new Renderer(sim(), { canvas, background: "#12345680" });
    r.render();
    const ops = canvas.ctx.ops.filter(o => o[0] === "clearRect" || o[0] === "fillRect");
    assert.deepEqual(ops.map(o => o[0]), ["clearRect", "fillRect"]);
    assert.deepEqual(ops[0].slice(1), [0, 0, 300, 200]);
  });

  test("a null background clears the canvas without painting it", () => {
    const canvas = makeCanvas();
    const r = new Renderer(sim(), { canvas, background: null });
    assert.equal(r.opts.background, null);
    r.render();
    assert.equal(opsNamed(canvas.ctx, "clearRect").length, 1);
    assert.equal(opsNamed(canvas.ctx, "fillRect").length, 0);
    r.setOpts({ background: "#000" });
    assert.equal(r.opts.background, "#000", "a color can be set again");
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

describe("Renderer: labels", () => {
  /* The two-node scene, labelled with node ids. At zoom 1 with the default
     15px labels and 2px margin, a label starts 22px from its node's centre:
     a sits at canvas (300,300), so its bottom label is drawn at (300,322).
     The stub measures each glyph at half the font size. */
  function lscene({ nodeCfg, opts } = {}) {
    return scene(false, [], { nodeCfg: { label: n => n.id, ...nodeCfg }, opts });
  }

  const texts = ctx => opsNamed(ctx, "fillText").map(([, t, x, y]) => [t, r2(x), r2(y)]);
  // Text state per label, with the on-screen size rounded (it comes from a scale factor)
  const textState = ctx => opsNamed(ctx, "fillText").map(op => ({ ...op[4], size: r2(op[4].size) }));
  const measures = ctx => opsNamed(ctx, "measureText").map(([, t, font]) => [t, font]);

  describe("options", () => {
    test("defaults", () => {
      const { r } = scene(false, []);
      assert.equal(r.opts.renderLabels, true);
      assert.equal(r.opts.labelFont, "Arial");
      assert.equal(r.opts.labelPosition, "bottom");
      assert.equal(r.opts.labelMargin, 2);
      assert.equal(r.opts.minLabelSize, 6);
      assert.equal(r.opts.maxLabelSize, Infinity);
      const style = r.nodeStyles[0];
      assert.equal(style.label, null);
      assert.equal(style.renderLabel, true);
      assert.equal(style.labelScale, 15);
    });

    test("negative label sizes are rejected, in the constructor and setOpts", () => {
      assert.throws(() => scene(false, [], { opts: { minLabelSize: -1 } }), RangeError);
      const { r } = scene(false, []);
      assert.throws(() => r.setOpts({ maxLabelSize: -5 }), RangeError);
      assert.equal(r.opts.maxLabelSize, Infinity);
      r.setOpts({ minLabelSize: 0, maxLabelSize: 0 });
      assert.deepEqual([r.opts.minLabelSize, r.opts.maxLabelSize], [0, 0]);
    });
  });

  describe("drawing", () => {
    test("nodes without labels draw no text and measure nothing", () => {
      const { r, ctx } = scene(false, []);
      r.render();
      assert.deepEqual(opsNamed(ctx, "fillText"), []);
      assert.deepEqual(opsNamed(ctx, "measureText"), []);
    });

    test("a label is drawn below its node in the label font and color", () => {
      const { r, ctx } = lscene({ nodeCfg: { labelTextColor: "red" } });
      r.render();
      assert.deepEqual(texts(ctx), [["a", 300, 322], ["b", 500, 322]]);
      assert.deepEqual(textState(ctx)[0],
        { font: "100px Arial", size: 15, fillStyle: "red", textAlign: "center", textBaseline: "top" });
    });

    test("labels are drawn after every node, so no node covers a label", () => {
      const { r, ctx } = lscene();
      r.render();
      const names = ctx.ops.map(op => op[0]);
      assert.ok(names.indexOf("fillText") > names.lastIndexOf("arc"));
    });

    for (const [position, at, textAlign, textBaseline] of [
      ["top", [300, 278], "center", "bottom"],
      ["right", [322, 300], "left", "middle"],
      ["left", [278, 300], "right", "middle"],
      ["bottom", [300, 322], "center", "top"],
    ]) {
      test(`position "${position}" anchors the label at ${at}`, () => {
        const { r, ctx } = lscene({ opts: { labelPosition: position } });
        r.render();
        assert.deepEqual(texts(ctx)[0], ["a", ...at]);
        assert.equal(textState(ctx)[0].textAlign, textAlign);
        assert.equal(textState(ctx)[0].textBaseline, textBaseline);
      });
    }

    test("an unknown position is rejected", () => {
      assert.throws(() => lscene({ opts: { labelPosition: "sideways" } }),
        /^RangeError: Renderer: `labelPosition` must be one of "bottom", "top", "left", "right"$/);
    });

    test("position and margin can be changed with setOpts", () => {
      const { r, ctx } = lscene();
      r.setOpts({ labelPosition: "top", labelMargin: 10 });
      r.render();
      assert.deepEqual(texts(ctx)[0], ["a", 300, 270]);
    });

    test("a label of 0 is drawn; null and the empty string are not", () => {
      const { r, ctx } = lscene({ nodeCfg: { label: n => (n.id === "a" ? 0 : "") } });
      r.render();
      assert.deepEqual(texts(ctx), [["0", 300, 322]]);
    });

    test("labels follow changes to graph data", () => {
      const { g, r, ctx } = lscene({ nodeCfg: { label: n => n.data.name ?? null } });
      r.render();
      assert.deepEqual(texts(ctx), []);

      g.setNodeData("a", { name: "Alice" });
      ctx.ops.length = 0;
      r.render();
      assert.deepEqual(texts(ctx), [["Alice", 300, 322]]);
    });
  });

  describe("toggling", () => {
    test("renderLabel: false hides only that node's label", () => {
      const { r, ctx } = lscene({ nodeCfg: { renderLabel: n => n.id !== "b" } });
      r.render();
      assert.deepEqual(texts(ctx).map(([t]) => t), ["a"]);
    });

    test("renderLabels: false hides every label and skips measuring", () => {
      const { r, ctx } = lscene({ opts: { renderLabels: false } });
      r.render();
      assert.deepEqual(opsNamed(ctx, "fillText"), []);
      assert.deepEqual(opsNamed(ctx, "measureText"), []);
      assert.equal(opsNamed(ctx, "arc").length, 2, "nodes are still drawn");
    });

    test("setOpts toggles labels on a live renderer", () => {
      const { r, ctx } = lscene({ opts: { renderLabels: false } });
      r.render();
      r.setOpts({ renderLabels: true });
      r.render();
      assert.deepEqual(texts(ctx).map(([t]) => t), ["a", "b"]);
    });

    test("renderLabels overrides a node's renderLabel: true", () => {
      const { r, ctx } = lscene({ nodeCfg: { renderLabel: true }, opts: { renderLabels: false } });
      r.render();
      assert.deepEqual(opsNamed(ctx, "fillText"), []);
    });
  });

  describe("sizing", () => {
    test("label size scales with zoom", () => {
      const { r, ctx } = lscene();
      r.view.zoom = 0.5;
      r.render();
      assert.equal(textState(ctx)[0].size, 7.5);
    });

    test("labels smaller than minLabelSize on screen are hidden, not enlarged", () => {
      const { r, ctx } = lscene();
      r.view.zoom = 0.3;                              // 15 * 0.3 = 4.5px < 6px
      r.render();
      assert.deepEqual(opsNamed(ctx, "fillText"), []);
      assert.equal(opsNamed(ctx, "arc").length, 2, "nodes are still drawn");
    });

    test("minLabelSize is compared to each node's own scaled size", () => {
      const { r, ctx } = lscene({ nodeCfg: { labelScale: n => (n.id === "a" ? 30 : 5) } });
      r.view.zoom = 0.5;                              // a: 15px, b: 2.5px
      r.render();
      assert.deepEqual(texts(ctx).map(([t]) => t), ["a"]);
    });

    test("labels larger than maxLabelSize on screen are capped, not hidden", () => {
      const { r, ctx } = lscene({ opts: { maxLabelSize: 20 } });
      r.view.x = -100;                                // centre on a
      r.view.zoom = 4;                                // 15 * 4 = 60px > 20px
      r.render();
      assert.equal(textState(ctx)[0].size, 20);
    });
  });

  describe("culling", () => {
    /* At zoom 1 the view spans x in [-400, 400] and y in [-300, 300]. */
    test("a label stays drawn while its node is just off screen", () => {
      const { sim, r, ctx } = lscene();
      sim.nodes.get("a").y = -325;                    // circle -345..-305; label -303..-288
      r.render();
      assert.equal(opsNamed(ctx, "arc").length, 1, "a's circle is culled");
      assert.deepEqual(texts(ctx), [["a", 300, -3], ["b", 500, 322]]);
    });

    test("a label fully off screen is culled", () => {
      const { sim, r, ctx } = lscene();
      sim.nodes.get("a").y = -345;                    // label -323..-308
      r.render();
      assert.deepEqual(texts(ctx).map(([t]) => t), ["b"]);
    });

    test("culling uses the label's measured width", () => {
      // a's circle spans x -450..-410; a right label starts at -408
      const run = label => {
        const { sim, r, ctx } = lscene({
          nodeCfg: { label: n => (n.id === "a" ? label : n.id) }, opts: { labelPosition: "right" },
        });
        sim.nodes.get("a").x = -430;
        r.render();
        return texts(ctx).map(([t]) => t);
      };
      assert.deepEqual(run("a"), ["b"], "7.5 wide: ends at -400.5, off screen");
      assert.deepEqual(run("abcdefgh"), ["abcdefgh", "b"], "60 wide: reaches into view");
    });
  });

  describe("scaling by transform", () => {
    /* Logs writes to ctx.font into the op stream, so tests can count them. */
    function trackFont(ctx) {
      let font = ctx.font;
      Object.defineProperty(ctx, "font", {
        get: () => font,
        set: v => { font = v; ctx.ops.push(["font", v]); },
        configurable: true,
      });
    }

    test("labels of different sizes share one font write per frame", () => {
      const { r, ctx } = lscene({ nodeCfg: { labelScale: n => (n.id === "a" ? 30 : 10) } });
      r.render();                                     // first frame also measures
      trackFont(ctx);
      ctx.ops.length = 0;
      r.render();
      assert.deepEqual(opsNamed(ctx, "font"), [["font", "100px Arial"]]);
      assert.deepEqual(textState(ctx).map(s => s.size), [30, 10]);
    });

    test("no text state or transform is touched when no label is on screen", () => {
      const { r, ctx } = scene(false, []);
      trackFont(ctx);
      r.render();
      assert.deepEqual(opsNamed(ctx, "font"), []);
      assert.deepEqual(opsNamed(ctx, "setTransform"), []);
    });

    test("the base transform is restored after the label pass", () => {
      const { r, ctx } = lscene();
      r.render();
      assert.deepEqual(ctx.transform, [1, 0, 0, 1, 0, 0]);
    });

    test("labels are placed and sized in device px under a DPR transform", () => {
      const restore = installWindow(2);
      try {
        const { r, ctx } = lscene();
        r.render();
        assert.deepEqual(texts(ctx)[0], ["a", 600, 644], "canvas (300,322) at DPR 2");
        assert.equal(textState(ctx)[0].size, 30, "15 CSS px at DPR 2");
        assert.deepEqual(ctx.transform, [2, 0, 0, 2, 0, 0], "the DPR transform is restored");
      } finally { restore(); }
    });
  });

  describe("measuring", () => {
    test("each distinct label is measured once, at the reference size", () => {
      const { r, ctx } = lscene({ nodeCfg: { label: "same" } });
      r.render();
      assert.deepEqual(measures(ctx), [["same", "100px Arial"]]);
      ctx.ops.length = 0;
      r.render();
      assert.deepEqual(measures(ctx), [], "nothing changed, so nothing is remeasured");
    });

    test("a restyle reuses cached widths and measures only new text", () => {
      const { r, ctx } = lscene();
      r.render();
      ctx.ops.length = 0;
      r.setDefaultNodeConfig({ labelTextColor: "red" });
      r.render();
      assert.deepEqual(measures(ctx), []);
      assert.equal(textState(ctx)[0].fillStyle, "red");

      ctx.ops.length = 0;
      r.setNodeConfig("a", { label: "new" });
      r.render();
      assert.deepEqual(measures(ctx), [["new", "100px Arial"]]);
    });

    test("changing labelFont remeasures in the new font", () => {
      const { r, ctx } = lscene();
      r.render();
      ctx.ops.length = 0;
      r.setOpts({ labelFont: "serif" });
      r.render();
      assert.deepEqual(measures(ctx), [["a", "100px serif"], ["b", "100px serif"]]);
      assert.deepEqual([textState(ctx)[0].font, textState(ctx)[0].size], ["100px serif", 15]);
    });

    test("labels added while renderLabels is off are measured once it is turned on", () => {
      const { g, sim, r, ctx } = lscene({ opts: { renderLabels: false } });
      r.render();
      g.addNode({ id: "c" });
      sim.sync();
      sim.nodes.get("c").x = 0;
      sim.nodes.get("c").y = 0;
      r.render();
      r.setOpts({ renderLabels: true });
      r.render();
      assert.deepEqual(measures(ctx).map(([t]) => t), ["a", "b", "c"]);
      assert.deepEqual(texts(ctx).map(([t]) => t).sort(), ["a", "b", "c"]);
    });
  });
});

describe("Renderer: highlighting", () => {
  /* The stub context doesn't record state, so log globalAlpha writes into the
     op stream. `draws()` then pairs each node circle (by its x: a=300, b=500)
     and edge line with the alpha it was drawn at, in draw order. */
  function trackAlpha(ctx) {
    let alpha = 1;
    Object.defineProperty(ctx, "globalAlpha", {
      get: () => alpha,
      set: v => { alpha = v; ctx.ops.push(["globalAlpha", v]); },
      configurable: true,
    });
  }

  function draws(ctx) {
    const out = [];
    let alpha = 1;
    for (const [name, ...args] of ctx.ops) {
      if (name === "globalAlpha") alpha = args[0];
      else if (name === "arc") out.push([args[0] === 300 ? "a" : args[0] === 500 ? "b" : "?", alpha]);
      else if (name === "lineTo") out.push(["edge", alpha]);
    }
    return out;
  }

  // Fading is off by default here so drawing tests see the settled result;
  // the "fading" suite turns it on.
  function hscene(opts) {
    const s = scene(false, [["a", "b"]], { opts: { highlightFadeDuration: 0, ...opts } });
    trackAlpha(s.ctx);
    return s;
  }

  function render(r, ctx, time) { ctx.ops.length = 0; r.render(time); return draws(ctx); }

  describe("drawing", () => {
    test("with nothing highlighted, everything is drawn at full alpha", () => {
      const { r, ctx } = hscene();
      assert.deepEqual(render(r, ctx), [["edge", 1], ["a", 1], ["b", 1]]);
      assert.equal(opsNamed(ctx, "globalAlpha").length, 0, "the plain path must not touch alpha");
    });

    test("dim: the rest is drawn first at highlightAlpha, highlighted items on top", () => {
      const { r, ctx } = hscene();
      r.setHighlight({ nodes: ["a"] });
      assert.deepEqual(render(r, ctx), [["edge", 0.15], ["b", 0.15], ["a", 1]]);
      assert.equal(ctx.globalAlpha, 1, "alpha must be restored after the frame");
    });

    test("dim: a highlighted edge is drawn over dimmed nodes", () => {
      const { r, ctx } = hscene();
      r.setHighlight({ edges: [["a", "b"]] });
      assert.deepEqual(render(r, ctx), [["a", 0.15], ["b", 0.15], ["edge", 1]]);
    });

    test("dim uses the configured alpha", () => {
      const { r, ctx } = hscene({ highlightAlpha: 0.4 });
      r.setHighlight({ nodes: ["a"] });
      assert.deepEqual(render(r, ctx), [["edge", 0.4], ["b", 0.4], ["a", 1]]);
    });

    test("hide: only highlighted items are drawn", () => {
      const { r, ctx } = hscene({ highlightMode: "hide" });
      r.setHighlight({ nodes: ["a"] });
      assert.deepEqual(render(r, ctx), [["a", 1]]);

      r.setHighlight({ nodes: ["a", "b"], edges: [["a", "b"]] });
      assert.deepEqual(render(r, ctx), [["edge", 1], ["a", 1], ["b", 1]]);
    });

    test("renderEdges: false still hides highlighted edges", () => {
      const { r, ctx } = hscene({ renderEdges: false });
      r.setHighlight({ edges: [["a", "b"]] });
      assert.deepEqual(render(r, ctx), [["a", 0.15], ["b", 0.15]]);
    });

    test("an undirected edge can be highlighted from either end", () => {
      const { r, ctx } = hscene();
      r.setHighlight({ edges: [["b", "a"]] });
      assert.deepEqual(render(r, ctx).find(([k]) => k === "edge"), ["edge", 1]);
    });

    /* Node circles and labels in draw order, each with the alpha it was
       drawn at: ["a", alpha] for a circle, ["label a", alpha] for a label. */
    function nodeAndLabelDraws(ctx) {
      const out = [];
      let alpha = 1;
      for (const [name, ...args] of ctx.ops) {
        if (name === "globalAlpha") alpha = args[0];
        else if (name === "arc") out.push([args[0] === 300 ? "a" : "b", alpha]);
        else if (name === "fillText") out.push(["label " + args[0], alpha]);
      }
      return out;
    }

    test("labels take their node's alpha and sit under highlighted nodes", () => {
      const s = scene(false, [["a", "b"]], {
        nodeCfg: { label: n => n.id }, opts: { highlightFadeDuration: 0 },
      });
      trackAlpha(s.ctx);
      s.r.setHighlight({ nodes: ["a"] });
      s.r.render();
      assert.deepEqual(nodeAndLabelDraws(s.ctx),
        [["b", 0.15], ["label b", 0.15], ["a", 1], ["label a", 1]]);

      // b's label leaves a scaled transform; a must be drawn back in canvas space
      const ops = s.ctx.ops, arcA = ops.findIndex(([n, x]) => n === "arc" && x === 300);
      const lastTransform = ops.slice(0, arcA).findLast(([n]) => n === "setTransform");
      assert.deepEqual(lastTransform.slice(1), [1, 0, 0, 1, 0, 0]);
    });

    test("hide: labels of hidden nodes are skipped", () => {
      const s = scene(false, [["a", "b"]], {
        nodeCfg: { label: n => n.id }, opts: { highlightFadeDuration: 0, highlightMode: "hide" },
      });
      trackAlpha(s.ctx);
      s.r.setHighlight({ nodes: ["a"] });
      s.r.render();
      assert.deepEqual(nodeAndLabelDraws(s.ctx), [["a", 1], ["label a", 1]]);
    });
  });

  describe("state", () => {
    test("hasHighlight follows the highlighted sets", () => {
      const { r } = hscene();
      assert.equal(r.hasHighlight(), false);
      r.setHighlight({ nodes: ["a"] });
      assert.equal(r.hasHighlight(), true);
      r.clearHighlight({ nodes: ["a"] });
      assert.equal(r.hasHighlight(), false, "removing the last element ends highlighting");
    });

    test("setHighlight replaces the selection; addHighlight extends it", () => {
      const { r } = hscene();
      r.setHighlight({ nodes: ["a"] });
      r.setHighlight({ nodes: ["b"] });
      assert.deepEqual([...r.highlightedNodes], ["b"]);
      r.addHighlight({ nodes: ["a"], edges: [["a", "b"]] });
      assert.deepEqual([...r.highlightedNodes].sort(), ["a", "b"]);
      assert.equal(r.highlightedEdges.size, 1);
    });

    test("clearHighlight() with no argument clears everything", () => {
      const { r } = hscene();
      r.setHighlight({ nodes: ["a", "b"], edges: [["a", "b"]] });
      r.clearHighlight();
      assert.equal(r.highlightedNodes.size, 0);
      assert.equal(r.highlightedEdges.size, 0);
      assert.equal(r.hasHighlight(), false);
    });

    test("partial clears remove only what is listed; an empty list removes nothing", () => {
      const { r } = hscene();
      r.setHighlight({ nodes: ["a", "b"], edges: [["a", "b"]] });
      r.clearHighlight({ nodes: [] });
      assert.equal(r.highlightedNodes.size, 2, "an empty list must not mean 'clear all'");
      r.clearHighlight({ nodes: ["a"] });
      assert.deepEqual([...r.highlightedNodes], ["b"]);
      assert.equal(r.highlightedEdges.size, 1, "edges were not listed, so they stay");
      r.clearHighlight({ edges: [["b", "a"]] });
      assert.equal(r.highlightedEdges.size, 0);
    });

    test("clearing everything keeps the same Set instances", () => {
      const { r } = hscene();
      const nodes = r.highlightedNodes, edges = r.highlightedEdges;
      r.setHighlight({ nodes: ["a"], edges: [["a", "b"]] });
      r.clearHighlight();
      assert.equal(r.highlightedNodes, nodes, "a held reference must not go stale");
      assert.equal(r.highlightedEdges, edges);
    });

    test("unknown nodes and edges are ignored", () => {
      const { r } = hscene();
      assert.doesNotThrow(() => r.setHighlight({ nodes: ["nope"], edges: [["a", "nope"], ["b", "b"]] }));
      assert.equal(r.hasHighlight(), false);
      assert.doesNotThrow(() => r.clearHighlight({ nodes: ["nope"], edges: [["a", "nope"]] }));
    });

    test("the highlight methods chain", () => {
      const { r } = hscene();
      assert.equal(r.setHighlight({}).addHighlight({}).clearHighlight({}), r);
    });
  });

  describe("syncing with the graph", () => {
    test("a node added to the graph can be highlighted before any tick", () => {
      const { g, r } = hscene();
      g.addNode({ id: "c" });
      r.setHighlight({ nodes: ["c"] });
      assert.deepEqual([...r.highlightedNodes], ["c"]);
    });

    test("highlights stay on the right nodes when slots shift", () => {
      const { g, sim, r } = hscene();
      r.setHighlight({ nodes: ["b"] });
      g.removeNode("a");                 // b moves from slot 1 to slot 0
      g.addNode({ id: "c" });
      r.render();
      const flags = r._highlighter.nodeState;
      assert.equal(flags.length, sim.nodeList.length);
      assert.equal(flags[sim.nodeIndex.get("b")], 1);
      assert.equal(flags[sim.nodeIndex.get("c")], 0);
    });

    test("removed nodes and edges are pruned from the highlight", () => {
      const { g, r } = hscene();
      r.setHighlight({ nodes: ["a"], edges: [["a", "b"]] });
      g.removeNode("a");                 // also removes the a-b edge
      r.render();
      assert.equal(r.highlightedNodes.size, 0);
      assert.equal(r.highlightedEdges.size, 0);
      assert.equal(r.hasHighlight(), false);

      g.addNode({ id: "a" });
      r.render();
      assert.equal(r.highlightedNodes.size, 0, "a re-added id must not come back highlighted");
    });
  });

  describe("fading", () => {
    /* 100 ms per full 0 <-> 1 change, so alpha moves 0.01 per ms. Alphas are
       rounded to 2 places to keep the expectations readable. */
    function fscene(opts) { return hscene({ highlightFadeDuration: 100, ...opts }); }
    function frame(r, ctx, time) { return render(r, ctx, time).map(([k, a]) => [k, r2(a)]); }

    test("dims gradually and settles at highlightAlpha", () => {
      const { r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      assert.deepEqual(frame(r, ctx, 1000), [["edge", 1], ["b", 1], ["a", 1]], "a fade starts from where it was");
      assert.equal(r.isFading(), true);
      assert.deepEqual(frame(r, ctx, 1050), [["edge", 0.5], ["b", 0.5], ["a", 1]]);
      assert.deepEqual(frame(r, ctx, 1085), [["edge", 0.15], ["b", 0.15], ["a", 1]]);
      assert.equal(r.isFading(), false, "settled exactly at the target");
    });

    test("time spent idle before a fade starts isn't applied to it", () => {
      const { r, ctx } = fscene();
      r.render(0);
      r.setHighlight({ nodes: ["a"] });
      assert.deepEqual(frame(r, ctx, 60000), [["edge", 1], ["b", 1], ["a", 1]]);
      assert.deepEqual(frame(r, ctx, 60050), [["edge", 0.5], ["b", 0.5], ["a", 1]]);
    });

    test("hide fades out, then stops drawing", () => {
      const { r, ctx } = fscene({ highlightMode: "hide" });
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      assert.deepEqual(frame(r, ctx, 50), [["edge", 0.5], ["b", 0.5], ["a", 1]]);
      assert.deepEqual(frame(r, ctx, 100), [["a", 1]], "alpha 0 must not be drawn at all");
    });

    test("clearing fades back up, then returns to the plain path", () => {
      const { r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      frame(r, ctx, 100);
      r.clearHighlight();                        // nothing is highlighted, so plain draw order
      assert.deepEqual(frame(r, ctx, 200), [["edge", 0.15], ["a", 1], ["b", 0.15]]);
      assert.deepEqual(frame(r, ctx, 250), [["edge", 0.65], ["a", 1], ["b", 0.65]]);
      assert.deepEqual(frame(r, ctx, 300), [["edge", 1], ["a", 1], ["b", 1]]);
      assert.equal(r.isFading(), false);
      assert.equal(opsNamed(ctx, "globalAlpha").length, 0, "a settled, cleared frame must not touch alpha");
    });

    test("switching highlight mid-fade continues from the current alphas", () => {
      const { r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      frame(r, ctx, 50);                         // b and the edge at 0.5
      r.setHighlight({ nodes: ["b"] });
      assert.deepEqual(frame(r, ctx, 60), [["edge", 0.4], ["a", 0.9], ["b", 0.6]],
        "a leaving the highlight fades down rather than snapping");
    });

    test("changing highlightAlpha mid-highlight fades to the new value", () => {
      const { r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      frame(r, ctx, 100);
      r.setOpts({ highlightAlpha: 0.55 });
      frame(r, ctx, 500);
      assert.deepEqual(frame(r, ctx, 520), [["edge", 0.35], ["b", 0.35], ["a", 1]]);
    });

    test("a structural change mid-fade keeps each element's alpha", () => {
      const { g, r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      frame(r, ctx, 50);
      g.addNode({ id: "c" });                    // re-slots every cache
      const drawn = frame(r, ctx, 50);
      assert.deepEqual(drawn.filter(([k]) => k === "b"), [["b", 0.5]], "b must not restart its fade");
      assert.deepEqual(drawn.filter(([k]) => k === "?"), [["?", 0.15]], "a new node starts at its target");
    });

    test("removing the last highlighted node fades the rest back up", () => {
      const { g, r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      frame(r, ctx, 100);
      g.removeNode("a");
      assert.deepEqual(frame(r, ctx, 100), [["b", 0.15]], "no snap back to full");
      assert.deepEqual(frame(r, ctx, 150), [["b", 0.65]]);
    });

    test("a long gap between frames completes the fade", () => {
      const { r, ctx } = fscene();
      r.setHighlight({ nodes: ["a"] });
      frame(r, ctx, 0);
      assert.deepEqual(frame(r, ctx, 1e6), [["edge", 0.15], ["b", 0.15], ["a", 1]]);
      assert.equal(r.isFading(), false);
    });
  });

  describe("options", () => {
    test("defaults to dim at 0.15, fading over 150 ms", () => {
      const { r } = scene(false, []);
      assert.equal(r.opts.highlightMode, "dim");
      assert.equal(r.opts.highlightAlpha, 0.15);
      assert.equal(r.opts.highlightFadeDuration, 150);
    });

    test("a negative highlightFadeDuration is rejected", () => {
      assert.throws(() => hscene({ highlightFadeDuration: -5 }), RangeError);
      const { r } = hscene();
      assert.throws(() => r.setOpts({ highlightFadeDuration: -1 }), RangeError);
      assert.equal(r.opts.highlightFadeDuration, 0, "unchanged from the scene's 0");
    });

    test("highlightAlpha outside [0, 1] is rejected on every path", () => {
      assert.throws(() => hscene({ highlightAlpha: 5 }), RangeError);
      const { r } = hscene();
      assert.throws(() => r.setOpts({ highlightAlpha: -1 }), RangeError);
      assert.throws(() => r.setHighlight({ nodes: ["a"], alpha: 2 }), RangeError);
      assert.equal(r.opts.highlightAlpha, 0.15);
      assert.equal(r.hasHighlight(), false, "a rejected setHighlight changes nothing");
    });

    test("setHighlight's mode and alpha are kept; omitting them leaves the options alone", () => {
      const { r } = hscene();
      r.setHighlight({ nodes: ["a"], mode: "hide", alpha: 0.5 });
      r.setHighlight({ nodes: ["b"] });
      assert.equal(r.opts.highlightMode, "hide", "an omitted mode must not reset or erase the option");
      assert.equal(r.opts.highlightAlpha, 0.5);
    });

    test("clearing the highlight leaves the options alone", () => {
      const { r } = hscene({ highlightMode: "hide", highlightAlpha: 0.3 });
      r.setHighlight({ nodes: ["a"] }).clearHighlight();
      assert.equal(r.opts.highlightMode, "hide");
      assert.equal(r.opts.highlightAlpha, 0.3);
    });
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

  test("changing a request option requests cached images again with it", async () => {
    const { r, g, sim, requests, restore } = load({}, ["a.png"]);
    try {
      r.loadImage("preloaded.png");
      await flush();
      r.setOpts({ crossOrigin: null });
      assert.deepEqual(requests.slice(2).map(q => [q.src, q.crossOrigin, q.referrerPolicy]),
        [["a.png", null, "no-referrer"], ["preloaded.png", null, "no-referrer"]],
        "images on nodes and preloaded images alike");
      assert.equal(r.images.get("a.png")?.status, "loading");

      r.setOpts({ imageReferrerPolicy: "origin" });
      assert.equal(requests.length, 6, "the referrer policy counts too");
      g.addNode({ id: "late", img: "b.png" });
      sim.sync();
      r.sync();
      assert.deepEqual(requests.at(-1), { src: "b.png", crossOrigin: null, referrerPolicy: "origin" });
      await flush();
      assert.equal(r.images.get("a.png")?.status, "loaded");
    } finally { restore(); }
  });

  test("setting a request option to its current value requests nothing", () => {
    const { r, requests, restore } = load({ crossOrigin: null });
    try {
      r.setOpts({ crossOrigin: null, imageReferrerPolicy: "no-referrer", background: "#000" });
      assert.equal(requests.length, 1);
    } finally { restore(); }
  });

  test("function options give each source its own request options", async () => {
    const cdn = src => src.startsWith("cdn/");
    const { r, requests, restore } = load({
      crossOrigin: src => (cdn(src) ? "anonymous" : null),
      imageReferrerPolicy: src => (cdn(src) ? "no-referrer" : "origin"),
    }, ["cdn/a.png", "own/b.png"]);
    try {
      assert.deepEqual(requests.map(q => [q.src, q.crossOrigin, q.referrerPolicy]), [
        ["cdn/a.png", "anonymous", "no-referrer"],
        ["own/b.png", null, "origin"],
      ]);
      r.loadImage("own/c.png");
      assert.deepEqual(requests.at(-1), { src: "own/c.png", crossOrigin: null, referrerPolicy: "origin" },
        "loadImage resolves them too");
      await flush();
      assert.equal(r.images.get("own/b.png")?.crossOrigin, null, "each entry records its options");
      assert.equal(r.images.get("own/b.png")?.referrerPolicy, "origin");
    } finally { restore(); }
  });

  test("changing a request option requests only the images whose options change", async () => {
    const { r, requests, restore } = load({}, ["cdn/a.png", "own/b.png"]);
    try {
      await flush();
      const cdnImage = r.images.get("cdn/a.png")?.image;
      r.setOpts({ crossOrigin: src => (src.startsWith("cdn/") ? "anonymous" : null) });
      assert.deepEqual(requests.slice(2).map(q => [q.src, q.crossOrigin]), [["own/b.png", null]]);
      assert.equal(r.images.get("cdn/a.png")?.image, cdnImage, "an image whose options didn't change is kept");
    } finally { restore(); }
  });

  test("setting the same function again re-evaluates it", async () => {
    let anonymous = new Set(["a.png"]);
    const crossOrigin = src => (anonymous.has(src) ? "anonymous" : null);
    const { r, requests, restore } = load({ crossOrigin }, ["a.png", "b.png"]);
    try {
      await flush();
      anonymous = new Set(["a.png", "b.png"]);
      r.setOpts({ crossOrigin });
      assert.deepEqual(requests.slice(2).map(q => [q.src, q.crossOrigin]), [["b.png", "anonymous"]]);
    } finally { restore(); }
  });

  test("a function option returning an invalid value falls back to the default", () => {
    const { r, requests, restore } = load({
      crossOrigin: () => /** @type {any} */ ("anon"),
      imageReferrerPolicy: () => /** @type {any} */ (undefined),
    });
    try {
      assert.deepEqual(requests[0], { src: "a.png", crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
      assert.equal(typeof r.opts.crossOrigin, "function", "the option itself is kept");
    } finally { restore(); }
  });
});

describe("Renderer: hooks", () => {
  /* Hooks push a ["hook", label] marker into the op stream, and `order()`
     reduces a frame to what was drawn when: the background fill, the edge
     line, each node circle, each label, and the hook markers. */
  /** @type {Record<string, string>} */
  const KIND = { fillRect: "background", lineTo: "edge", arc: "node", fillText: "label" };
  const order = ctx => ctx.ops.flatMap(([name, ...args]) =>
    name === "hook" ? [args[0]] : KIND[name] ? [KIND[name]] : []);
  const mark = (ctx, label) => () => { ctx.ops.push(["hook", label]); };

  // The two-node scene, with an edge and labels so every layer of the frame is drawn
  function kscene(opts) {
    return scene(false, [["a", "b"]], { nodeCfg: { label: n => n.id }, opts });
  }

  /* The stub context doesn't keep state across save() and restore(), so give
     it a real state stack for the properties a hook is likely to change. */
  const STATE = ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "transform"];
  function trackState(ctx) {
    let alpha = 1;
    Object.defineProperty(ctx, "globalAlpha", { get: () => alpha, set: v => { alpha = v; }, configurable: true });
    const stack = [];
    ctx.save = () => { ctx.ops.push(["save"]); stack.push(STATE.map(k => ctx[k])); };
    ctx.restore = () => {
      ctx.ops.push(["restore"]);
      const saved = stack.pop();
      if (saved) STATE.forEach((k, i) => { ctx[k] = saved[i]; });
    };
    return stack;
  }

  describe("adding and removing", () => {
    test("addHook chains, and removeHook reports whether the hook was there", () => {
      const { r } = kscene();
      const f = () => {};
      assert.equal(r.addHook("overlay", f), r);
      assert.equal(r.removeHook("background", f), false, "types keep separate hooks");
      assert.equal(r.removeHook("overlay", f), true);
      assert.equal(r.removeHook("overlay", f), false);
    });

    test("a removed hook no longer runs", () => {
      const { r } = kscene();
      let calls = 0;
      const f = () => { calls++; };
      r.addHook("overlay", f);
      r.render();
      r.removeHook("overlay", f);
      r.render();
      assert.equal(calls, 1);
    });

    test("adding a function twice runs it once per frame; adding it to both types runs it in each", () => {
      const { r } = kscene();
      const seen = [];
      const f = (_, time) => { seen.push(time); };
      r.addHook("overlay", f).addHook("overlay", f).addHook("background", f);
      r.render(5);
      assert.deepEqual(seen, [5, 5]);
    });

    test("an unknown type throws instead of being ignored", () => {
      const { r } = kscene();
      assert.throws(() => r.addHook("foreground", () => {}), TypeError);
      assert.throws(() => r.removeHook("foreground", () => {}), TypeError);
    });
  });

  describe("running", () => {
    test("background hooks run after the background fill, overlay hooks after everything else", () => {
      const { r, ctx } = kscene();
      r.addHook("overlay", mark(ctx, "overlay"));
      r.addHook("background", mark(ctx, "background hook"));
      r.render();
      assert.deepEqual(order(ctx),
        ["background", "background hook", "edge", "node", "node", "label", "label", "overlay"]);
    });

    test("hooks of a type run in the order they were added", () => {
      const { r, ctx } = kscene();
      for (const label of ["1", "2", "3"]) r.addHook("overlay", mark(ctx, label));
      r.render();
      assert.deepEqual(order(ctx).slice(-3), ["1", "2", "3"]);
    });

    test("hooks receive the renderer and the frame's timestamp", () => {
      const { r } = kscene();
      const calls = [];
      r.addHook("background", (who, time) => { calls.push(["background", who === r, time]); });
      r.addHook("overlay", (who, time) => { calls.push(["overlay", who === r, time]); });
      r.render(1234);
      assert.deepEqual(calls, [["background", true, 1234], ["overlay", true, 1234]]);

      calls.length = 0;
      r.render();
      assert.equal(typeof calls[0][2], "number", "render() without a timestamp still passes one");
      assert.equal(calls[0][2], calls[1][2], "both types see the same timestamp");
    });

    test("hooks don't run when there is no canvas to draw on", () => {
      const g = new Graph();
      g.addNode({ id: "a" });
      const r = new Renderer(new Simulation(g, {}));
      let calls = 0;
      r.addHook("background", () => { calls++; }).addHook("overlay", () => { calls++; });
      assert.equal(r.render(), false);
      assert.equal(calls, 0);
    });

    test("a hook that removes and re-adds itself runs once per frame", () => {
      const { r } = kscene();
      let calls = 0;
      // Stops re-adding itself at 100, so a regression fails rather than hangs
      const f = () => { calls++; if (calls < 100) { r.removeHook("overlay", f); r.addHook("overlay", f); } };
      r.addHook("overlay", f);
      r.render();
      assert.equal(calls, 1);
      r.render();
      assert.equal(calls, 2);
    });

    test("a hook added by another hook starts on the next frame", () => {
      const { r } = kscene();
      let lateCalls = 0;
      const late = () => { lateCalls++; };
      r.addHook("overlay", () => { r.addHook("overlay", late); });
      r.render();
      assert.equal(lateCalls, 0);
      r.render();
      assert.equal(lateCalls, 1);
    });
  });

  describe("canvas state", () => {
    test("each hook runs between its own save() and restore()", () => {
      const { r, ctx } = kscene();
      r.addHook("overlay", mark(ctx, "1")).addHook("overlay", mark(ctx, "2"));
      r.render();
      const tail = ctx.ops.filter(([name]) => name === "save" || name === "restore" || name === "hook").slice(-6);
      assert.deepEqual(tail.map(([name, label]) => label ?? name), ["save", "1", "restore", "save", "2", "restore"]);
    });

    test("state a hook changes doesn't leak into the frame or the next one", () => {
      const { r, ctx } = kscene();
      const stack = trackState(ctx);
      const base = [...ctx.transform];
      const leaky = ({ ctx }) => {
        ctx.globalAlpha = 0.3;
        ctx.setTransform(2, 0, 0, 2, 50, 50);
      };
      r.addHook("background", leaky).addHook("overlay", leaky);

      const atNodes = [];
      const arc = ctx.arc;
      ctx.arc = (...args) => { atNodes.push([ctx.globalAlpha, ctx.transform.join()]); arc(...args); };
      r.render();
      r.render();
      assert.deepEqual(atNodes, Array(4).fill([1, base.join()]), "nodes drawn after a background hook");
      assert.equal(ctx.globalAlpha, 1, "alpha left for the next frame");
      assert.deepEqual(ctx.transform, base, "transform left for the next frame");
      assert.equal(stack.length, 0, "every save() was matched by a restore()");
    });

    test("overlay hooks see the base transform and full alpha after labels and dimming", () => {
      const { r, ctx } = kscene({ highlightFadeDuration: 0 });
      trackState(ctx);
      const base = [...ctx.transform];
      r.setHighlight({ nodes: ["a"] });
      const seen = [];
      r.addHook("overlay", ({ ctx }) => { seen.push({ alpha: ctx.globalAlpha, transform: [...ctx.transform] }); });
      r.render();
      assert.ok(opsNamed(ctx, "fillText").length > 0, "labels must be drawn for this test to mean anything");
      assert.deepEqual(seen, [{ alpha: 1, transform: base }], "once per frame, after the dimmed and highlighted passes");
    });
  });

  describe("errors", () => {
    test("a throwing hook is logged, and the frame and the other hooks still run", t => {
      const error = t.mock.method(console, "error", () => {});
      const { r, ctx } = kscene();
      const stack = trackState(ctx);
      const failure = new Error("hook failed");
      r.addHook("background", () => { throw failure; });
      r.addHook("background", mark(ctx, "next background hook"));
      r.addHook("overlay", mark(ctx, "overlay"));

      assert.equal(r.render(), true);
      assert.deepEqual(order(ctx),
        ["background", "next background hook", "edge", "node", "node", "label", "label", "overlay"]);
      assert.equal(error.mock.callCount(), 1);
      const [message, logged] = error.mock.calls[0].arguments;
      assert.match(message, /background/, "the message names the hook type");
      assert.equal(logged, failure);
      assert.equal(stack.length, 0, "the failed hook's save() was still restored");
    });
  });
});

describe("Renderer: picking", () => {
  /* Node "a" (radius 20) sits at canvas (300,300) at zoom 1. Probes go straight
     down from its centre, away from "b", so only "a" can be hit. */
  const EPS = 0.01;
  const below = (r, id, px) => {
    const [x, y] = r.simToCanvas(r.simulation.nodes.get(id).x, r.simulation.nodes.get(id).y);
    return [x, y + px];
  };

  test("a node removed from the graph isn't found, even before the simulation syncs", () => {
    const { g, sim, r } = scene(false, []);
    assert.equal(r.nodeAt(300, 300), "a");
    g.removeNode("a");
    assert.ok(sim.nodes.has("a"), "the simulation hasn't synced yet");
    assert.equal(r.nodeAt(300, 300), null);
  });

  test("the default slack is 2 canvas pixels at every zoom", () => {
    const { r } = scene(false, []);
    for (const zoom of [0.5, 1, 4]) {
      r.view = { x: 0, y: 0, zoom };
      const edge = 20 * zoom + 2;
      assert.equal(r.nodeAt(...below(r, "a", edge - EPS)), "a", `inside miss at zoom ${zoom}`);
      assert.equal(r.nodeAt(...below(r, "a", edge + EPS)), null, `outside hit at zoom ${zoom}`);
    }
  });

  test("a custom slack is measured in canvas pixels, not world units", () => {
    const { r } = scene(false, []);
    for (const zoom of [0.5, 1, 4]) {
      r.view = { x: 0, y: 0, zoom };
      const edge = 20 * zoom + 12;
      assert.equal(r.nodeAt(...below(r, "a", edge - EPS), 12), "a", `inside miss at zoom ${zoom}`);
      assert.equal(r.nodeAt(...below(r, "a", edge + EPS), 12), null, `outside hit at zoom ${zoom}`);
    }
  });

  test("zero slack hits exactly the drawn radius", () => {
    const { r } = scene(false, []);
    assert.equal(r.nodeAt(...below(r, "a", 20 - EPS), 0), "a");
    assert.equal(r.nodeAt(...below(r, "a", 20 + EPS), 0), null);
  });

  test("negative slack is treated as zero instead of growing the hit area", () => {
    const { r } = scene(false, []);
    // Unclamped, -60 would give r = -40, and r * r would match a radius of 40
    assert.equal(r.nodeAt(...below(r, "a", 30), -60), null);
    assert.equal(r.nodeAt(...below(r, "a", 20 - EPS), -60), "a");
    assert.equal(r.nodeAt(...below(r, "a", 20 + EPS), -60), null);
  });

  test("when slack makes hit areas overlap, the node drawn last wins", () => {
    const { r } = scene(false, []);
    // Canvas (400,300) is 100px from both nodes; 80px of slack reaches both
    assert.equal(r.nodeAt(400, 300), null);
    assert.equal(r.nodeAt(400, 300, 80 + EPS), "b");
  });
});

describe("Renderer: edge picking", () => {
  /* In `scene()`, edge a-b runs along canvas y = 300, trimmed to x 320..480.
     At the default width of 1 and slack of 3, it reaches 3.5px either side. */
  const EPS = 0.01;

  /* Edges a-b along y = 0 and c-d along y = `gap` (world units = canvas px
     at zoom 1), so canvas y 300 and 300 + gap. c-d is added second, so it's
     drawn on top. */
  function parallel(gap, opts = {}) {
    const g = new Graph();
    for (const id of ["a", "b", "c", "d"]) g.addNode({ id });
    g.addEdge("a", "b");
    g.addEdge("c", "d");
    const sim = new Simulation(g, {});
    sim.setDefaultNodeConfig({ radius: 20 });
    sim.sync();
    const at = { a: [-100, 0], b: [100, 0], c: [-100, gap], d: [100, gap] };
    for (const [id, [x, y]] of Object.entries(at)) Object.assign(sim.nodes.get(id), { x, y });
    const r = new Renderer(sim, { canvas: makeCanvas(), ...opts });
    r.sync();
    return { g, r, ab: g.getEdge("a", "b"), cd: g.getEdge("c", "d") };
  }

  test("returns the edge object, or null off the edge", () => {
    const { g, r } = scene(false, [["a", "b"]]);
    assert.equal(r.edgeAt(400, 300), g.getEdge("a", "b"));
    assert.equal(r.edgeAt(400, 350), null);
    assert.deepEqual(r.edgesAt(400, 350), []);
  });

  test("the default reach is half the stroke plus 3 canvas pixels, on both sides", () => {
    const { r } = scene(false, [["a", "b"]]);
    for (const dy of [3.5 - EPS, -(3.5 - EPS)]) assert.ok(r.edgeAt(400, 300 + dy), `miss at ${dy}`);
    for (const dy of [3.5 + EPS, -(3.5 + EPS)]) assert.equal(r.edgeAt(400, 300 + dy), null, `hit at ${dy}`);
  });

  test("slack is in canvas pixels at every zoom, and negative slack counts as 0", () => {
    const { r } = scene(false, [["a", "b"]], { opts: { scaleStrokes: false } });
    for (const zoom of [0.5, 1, 4]) {
      r.view = { x: 0, y: 0, zoom };
      assert.ok(r.edgeAt(400, 300 + 10.5 - EPS, 10), `miss at zoom ${zoom}`);
      assert.equal(r.edgeAt(400, 300 + 10.5 + EPS, 10), null, `hit at zoom ${zoom}`);
    }
    r.view = { x: 0, y: 0, zoom: 1 };
    assert.ok(r.edgeAt(400, 300.5 - EPS, -5));
    assert.equal(r.edgeAt(400, 300.5 + EPS, -5), null);
  });

  test("a thicker stroke reaches farther", () => {
    const { r } = scene(false, [["a", "b"]], { edgeCfg: { width: 6 } });
    assert.ok(r.edgeAt(400, 306 - EPS));
    assert.equal(r.edgeAt(400, 306 + EPS), null);
  });

  test("the part of an edge hidden under its nodes isn't hit", () => {
    const { r } = scene(false, [["a", "b"]]);
    assert.equal(r.edgeAt(305, 300), null, "15px inside node a, past the trimmed end");
    assert.ok(r.edgeAt(317, 300), "3px short of the trimmed end");
  });

  test("an edge that isn't drawn can't be hit", () => {
    assert.equal(scene(false, [["a", "b"]], { radius: 200 }).r.edgeAt(400, 300), null,
      "overlapping nodes draw no edge");
    assert.equal(scene(false, [["a", "b"]], { opts: { renderEdges: false } }).r.edgeAt(400, 300), null);
  });

  test("each half of a bowed pair is hit along its own curve", () => {
    const { g, r } = scene(true, [["a", "b"], ["b", "a"]]);
    const ab = g.getEdge("a", "b"), ba = g.getEdge("b", "a");
    // a->b bows toward +y; its curve passes (400, ~308.4) at the midpoint
    assert.equal(r.edgeAt(400, 308.4, 0), ab);
    assert.equal(r.edgeAt(400, 300 - 8.4, 0), ba);
    assert.equal(r.edgeAt(400, 300, 0), null, "the straight chord between them is empty");
    assert.deepEqual(new Set(r.edgesAt(400, 300, 10)), new Set([ab, ba]));
  });

  test("a self-loop is hit on its circle, not inside it", () => {
    const { g, r } = scene(true, [["a", "a"]]);
    // Loop radius 16, centred 29.6px from node a towards the upper right
    const lx = 300 + Math.SQRT1_2 * 29.6, ly = 300 - Math.SQRT1_2 * 29.6;
    assert.equal(r.edgeAt(lx, ly - 16), g.getEdge("a", "a"));
    assert.equal(r.edgeAt(lx, ly), null);
  });

  test("the nearest stroke wins, even when another is drawn on top", () => {
    const { r, ab, cd } = parallel(2);
    assert.equal(r.edgeAt(400, 300.4), ab);
    assert.equal(r.edgeAt(400, 301.6), cd);
    assert.deepEqual(r.edgesAt(400, 300.4), [ab, cd]);
  });

  test("among strokes equally near, the one drawn on top wins", () => {
    const { r, ab, cd } = parallel(0);
    assert.equal(r.edgeAt(400, 300), cd);
    assert.deepEqual(r.edgesAt(400, 300), [cd, ab]);
    // Both strokes cover y 300.5..301.5 when 2px apart, so both are 0 away
    const two = parallel(1);
    assert.deepEqual(two.r.edgesAt(400, 300.5), [two.cd, two.ab]);
  });

  test("a highlighted edge is drawn on top, so it wins ties", () => {
    const { r, ab, cd } = parallel(0, { highlightFadeDuration: 0 });
    r.setHighlight({ edges: [["a", "b"]] });
    r.render();
    assert.deepEqual(r.edgesAt(400, 300), [ab, cd]);
  });

  test("edges hidden by highlighting can't be hit", () => {
    const { r, ab } = parallel(0, { highlightFadeDuration: 0, highlightMode: "hide" });
    r.setHighlight({ edges: [["a", "b"]] });
    r.render();
    assert.deepEqual(r.edgesAt(400, 300), [ab]);
  });

  test("a removed edge isn't found, even before the next render", () => {
    const { g, r } = scene(false, [["a", "b"]]);
    assert.ok(r.edgeAt(400, 300));
    g.removeEdge("a", "b");
    assert.equal(r.edgeAt(400, 300), null);
  });

  test("throws without a canvas", () => {
    const r = new Renderer(new Simulation(new Graph(), {}), {});
    assert.throws(() => r.edgeAt(0, 0), /no canvas attached/);
    assert.throws(() => r.edgesAt(0, 0), /no canvas attached/);
  });
});

describe("Renderer: view", () => {
  const plain = () => new Renderer(new Simulation(new Graph(), {}), {});
  // 800x600 canvas, so canvas (400, 300) is the view centre
  const attached = () => {
    const r = plain();
    r.attach(makeCanvas());
    return r;
  };
  const view = r => ({ ...r.view });

  test("setView sets part or all of the view, in place", () => {
    const r = plain();
    const live = r.view;
    assert.equal(r.setView({ zoom: 2 }), r);
    assert.deepEqual(view(r), { x: 0, y: 0, zoom: 2 });
    r.setView({ x: 5, y: -5, zoom: 0.5 });
    assert.deepEqual(view(r), { x: 5, y: -5, zoom: 0.5 });
    r.setView({ x: undefined });
    assert.deepEqual(view(r), { x: 5, y: -5, zoom: 0.5 }, "undefined values are left alone");
    assert.equal(r.view, live, "the view object is updated, not replaced");
  });

  test("setView rejects bad values and changes nothing", () => {
    const r = plain();
    for (const bad of [{ x: NaN }, { y: Infinity }, { zoom: 0 }, { zoom: -1 }, { zoom: Infinity }, { x: 1, zoom: 0 }]) {
      assert.throws(() => r.setView(bad), RangeError, JSON.stringify(bad));
    }
    assert.deepEqual(view(r), { x: 0, y: 0, zoom: 1 });
  });

  test("assigning the view is checked the same way", () => {
    const r = plain();
    r.view = { x: 3, zoom: 2 };
    assert.deepEqual(view(r), { x: 3, y: 0, zoom: 2 });
    assert.throws(() => { r.view = { zoom: 0 }; }, RangeError);
    assert.throws(() => { r.view = { x: 1, y: NaN }; }, RangeError);
    assert.deepEqual(view(r), { x: 3, y: 0, zoom: 2 }, "a rejected assignment changes nothing");
  });

  test("panBy shifts the graph on the canvas by the distance given, at any zoom", () => {
    const r = attached();
    for (const zoom of [1, 2, 0.5]) {
      r.setView({ x: 10, y: 20, zoom });
      const before = r.simToCanvas(0, 0);
      assert.equal(r.panBy(30, -40), r);
      const after = r.simToCanvas(0, 0);
      assert.deepEqual([after[0] - before[0], after[1] - before[1]].map(r2), [30, -40]);
    }
  });

  test("viewPannedBy returns the panned view without applying it", () => {
    const r = plain();
    r.setView({ zoom: 2 });
    const v = r.viewPannedBy(10, 20);
    assert.deepEqual(v, { x: -5, y: -10, zoom: 2 });
    assert.notEqual(v, r.view);
    assert.deepEqual(view(r), { x: 0, y: 0, zoom: 2 });
    assert.throws(() => r.viewPannedBy(NaN, 0), RangeError);
    assert.throws(() => r.panBy(0, Infinity), RangeError);
  });

  test("zoomTo keeps the anchor point fixed, or the centre without one", () => {
    const r = attached();
    r.setView({ x: 10, y: 20, zoom: 1 });
    const anchor = r.canvasToSim(100, 500);
    assert.equal(r.zoomTo(3, 100, 500), r);
    assert.equal(r.view.zoom, 3);
    assert.deepEqual(r.simToCanvas(...anchor).map(r2), [100, 500]);

    const centre = r.canvasToSim(400, 300);
    r.zoomTo(0.5);
    assert.equal(r.view.zoom, 0.5);
    assert.deepEqual(r.simToCanvas(...centre).map(r2), [400, 300], "the centre stays");
  });

  test("zoomBy multiplies the zoom, anchored the same way", () => {
    const r = attached();
    r.setView({ x: 0, y: 0, zoom: 2 });
    const anchor = r.canvasToSim(700, 100);
    assert.equal(r.zoomBy(1.5, 700, 100), r);
    assert.equal(r.view.zoom, 3);
    assert.deepEqual(r.simToCanvas(...anchor).map(r2), [700, 100]);
    r.zoomBy(0.5);
    assert.equal(r.view.zoom, 1.5);
    for (const bad of [0, -2, NaN]) assert.throws(() => r.zoomBy(bad), RangeError);
  });

  test("viewZoomedTo returns the zoomed view without applying it", () => {
    const r = attached();
    const v = r.viewZoomedTo(2, 600, 300);
    assert.deepEqual(v, { x: 100, y: 0, zoom: 2 }, "sim (200, 0) stays at canvas (600, 300)");
    assert.deepEqual(view(r), { x: 0, y: 0, zoom: 1 });
  });

  test("zooming rejects bad zooms and half or non-finite anchors", () => {
    const r = attached();
    for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => r.zoomTo(bad), RangeError);
    assert.throws(() => r.zoomTo(2, 100), TypeError);
    assert.throws(() => r.zoomTo(2, undefined, 100), TypeError);
    assert.throws(() => r.zoomTo(2, NaN, 100), RangeError);
    assert.equal(r.view.zoom, 1);
  });

  test("without a canvas, panning and centre zooms work, but anchored zooms throw", () => {
    const r = plain();
    r.panBy(10, 0).zoomTo(2).zoomBy(2);
    assert.deepEqual(view(r), { x: -10, y: 0, zoom: 4 });
    assert.throws(() => r.zoomTo(2, 0, 0), /no canvas/);
  });
});

describe("Renderer: export", () => {
  /* In `scene()`, nodes a and b (radius 20) sit at world (-100, 0) and
     (100, 0), so the graph spans x -120..120 and y -20..20: 240 x 40. With
     the default 16px padding, a fitted export at zoom 1 is 272 x 72. */
  const arcs = ctx => opsNamed(ctx, "arc").map(([, x, y, r]) => [r2(x), r2(y), r2(r)]);
  const out = () => makeCanvas({ w: 1, h: 1 });

  describe("the current view", () => {
    test("is drawn at the attached canvas's size and pixel ratio, leaving it alone", () => {
      const restoreWindow = installWindow(2);
      try {
        const { r, ctx, canvas } = scene(false, [["a", "b"]]);
        r.resize();
        ctx.ops.length = 0;
        r.panBy(10, 0);
        const before = { view: { ...r.view }, size: r.size, ctx: r.ctx, canvas: r.canvas };

        const target = out();
        assert.equal(r.toCanvas({ canvas: target }), target, "returns the canvas drawn on");
        assert.equal(target.width, 1600);
        assert.equal(target.height, 1200);
        assert.deepEqual(opsNamed(target.ctx, "setTransform")[0].slice(1), [2, 0, 0, 2, 0, 0]);
        assert.deepEqual(arcs(target.ctx), [[310, 300, 20], [510, 300, 20]], "as on screen");

        assert.deepEqual(ctx.ops, [], "the attached canvas isn't drawn on");
        assert.equal(canvas.width, 1600);
        assert.deepEqual({ view: { ...r.view }, size: r.size, ctx: r.ctx, canvas: r.canvas }, before);
        assert.equal(r.toCanvas({ canvas: target }).width, 1600, "the size is the canvas's, not the last export's");
      } finally { restoreWindow(); }
    });

    test("a width, height and pixel ratio of its own keep the view's centre and zoom", () => {
      const { r } = scene(false, []);
      const target = r.toCanvas({ canvas: out(), width: 400, height: 100, pixelRatio: 3 });
      assert.equal(target.width, 1200);
      assert.equal(target.height, 300);
      assert.deepEqual(arcs(target.ctx), [[100, 50, 20], [300, 50, 20]]);
    });

    test("without a canvas attached, it needs a width and height", () => {
      const sim = new Simulation(new Graph(), {});
      const r = new Renderer(sim, { nodeConfig: { label: n => n.id } });
      sim.graph.addNode({ id: "a" });
      sim.sync();
      Object.assign(sim.nodeList[0], { x: 0, y: 0 });
      assert.throws(() => r.toCanvas({ canvas: out() }), /^Error: Renderer: an export needs a `width` and `height`/);
      assert.throws(() => r.toCanvas({ canvas: out(), width: 100 }), /`height`/);
      const target = r.toCanvas({ canvas: out(), width: 100, height: 80 });
      assert.equal(target.width, 100, "a pixel ratio of 1");
      assert.equal(opsNamed(target.ctx, "fillText").length, 1, "labels are measured with the export's context");
      assert.equal(r.canvas, null);
      assert.equal(r.ctx, null);
    });
  });

  describe("fit", () => {
    test("without a size, the image is the graph's size at the current zoom, plus padding", () => {
      const { r } = scene(false, [["a", "b"]]);
      r.setView({ x: 500, y: -300, zoom: 1 });
      const target = r.toCanvas({ canvas: out(), fit: true });
      assert.equal(target.width, 272);
      assert.equal(target.height, 72);
      assert.deepEqual(arcs(target.ctx), [[36, 36, 20], [236, 36, 20]], "centred on the graph");

      r.setView({ zoom: 0.5 });
      const half = r.toCanvas({ canvas: out(), fit: true, padding: 0, pixelRatio: 2 });
      assert.deepEqual([half.width, half.height], [240, 40], "120 x 20 CSS px at 2x");
      assert.deepEqual(r.view, { x: 500, y: -300, zoom: 0.5 }, "the view is left alone");
    });

    test("with a width and height, the graph is zoomed to fit inside, centred", () => {
      const { r } = scene(false, []);
      const target = r.toCanvas({ canvas: out(), fit: true, width: 512, height: 512 });
      assert.deepEqual([target.width, target.height], [512, 512]);
      // min(480 / 240, 480 / 40) = 2
      assert.deepEqual(arcs(target.ctx), [[56, 256, 40], [456, 256, 40]]);
    });

    test("with only a width or height, the other keeps the graph's shape", () => {
      const { r } = scene(false, []);
      const wide = r.toCanvas({ canvas: out(), fit: true, width: 512 });
      assert.deepEqual([wide.width, wide.height], [512, 112], "zoom 2: 40 * 2 + 32");
      const tall = r.toCanvas({ canvas: out(), fit: true, height: 112 });
      assert.deepEqual([tall.width, tall.height], [512, 112]);
    });

    test("labels are included, unless they're too small to show", () => {
      const { r } = scene(false, [], { nodeCfg: { label: n => n.id } });
      // A bottom label runs from 22 to 37 below its node's centre
      assert.equal(r.toCanvas({ canvas: out(), fit: true }).height, 89, "37 + 20 + 32");
      r.setView({ zoom: 0.2 });   // 3px labels, under minLabelSize
      assert.equal(r.toCanvas({ canvas: out(), fit: true, padding: 0 }).height, 8, "40 * 0.2");
    });

    test("labels capped by maxLabelSize are fitted at their capped size", () => {
      const { r } = scene(false, [], { nodeCfg: { label: n => n.id }, opts: { maxLabelSize: 15 } });
      // Uncapped, labels need 57 world units of height: zoom 1000 / 57 = 17.5,
      // a node radius of 351. Capped at 15px, they need under 1 unit, so the
      // graph is about 43 high, and zooms to about 23.
      const target = r.toCanvas({ canvas: out(), fit: true, padding: 0, width: 10000, height: 1000 });
      const [[y, size]] = opsNamed(target.ctx, "fillText").map(([, , , ty, s]) => [ty, s.size]);
      assert.equal(r2(size), 15);
      assert.ok(y + size <= 1000, "the label fits");
      assert.ok(arcs(target.ctx)[0][2] > 450, "zoomed past what uncapped labels would allow");
    });

    test("self-loops and bowed edges are included", () => {
      const loop = scene(true, [["a", "a"]]).r.toCanvas({ canvas: out(), fit: true, padding: 0 });
      assert.ok(loop.height > 40, "the loop rises above its node");
      const bowed = scene(true, [["a", "b"], ["b", "a"]], { edgeCfg: { bow: 100 } })
        .r.toCanvas({ canvas: out(), fit: true, padding: 0 });
      assert.equal(bowed.height, 100, "each curve strays 50 either side of the line");
    });

    test("an empty graph exports the current view", () => {
      const r = new Renderer(new Simulation(new Graph(), {}), { canvas: makeCanvas() });
      const target = r.toCanvas({ canvas: out(), fit: true });
      assert.deepEqual([target.width, target.height], [800, 600]);
    });

    test("padding that leaves no room throws, and changes nothing", () => {
      const { r, canvas } = scene(false, []);
      assert.throws(() => r.toCanvas({ canvas: out(), fit: true, width: 30, padding: 15 }),
        /^RangeError: Renderer: `padding` leaves no room/);
      assert.equal(r.canvas, canvas, "the attached canvas is restored");
      assert.equal(r.size.w, 800);
    });
  });

  describe("drawing", () => {
    test("the background can be overridden, or left out", () => {
      const { r } = scene(false, [], { opts: { background: "#123456" } });
      const fills = c => opsNamed(c.ctx, "fillRect").length;
      const plain = r.toCanvas({ canvas: out() });
      assert.equal(plain.ctx.fillStyle !== undefined && fills(plain), 1);
      const clear = r.toCanvas({ canvas: out(), background: null });
      assert.equal(fills(clear), 0);
      assert.equal(opsNamed(clear.ctx, "clearRect").length, 1);
      assert.equal(r.opts.background, "#123456");
    });

    test("hooks run against the export, unless turned off", () => {
      const { r, canvas } = scene(false, []);
      const seen = [];
      r.addHook("overlay", who => seen.push([who.canvas, { ...who.size }]));
      const target = r.toCanvas({ canvas: out(), fit: true });
      assert.deepEqual(seen, [[target, { w: 272, h: 72 }]]);
      r.toCanvas({ canvas: out(), hooks: false });
      assert.equal(seen.length, 1);
      r.render();
      assert.equal(seen[1][0], canvas);
    });

    test("highlights are drawn as they'll be once faded, without advancing the fade", () => {
      const { r, ctx } = scene(false, [], { opts: { highlightFadeDuration: 1000 } });
      const alphas = c => {
        let alpha = 1;
        Object.defineProperty(c.ctx, "globalAlpha", {
          get: () => alpha, set: v => { alpha = v; c.ctx.ops.push(["arc-alpha", v]); }, configurable: true,
        });
        return c;
      };
      r.setHighlight({ nodes: ["a"] });
      r.render(0);
      r.render(100);    // 10% of the way
      const target = r.toCanvas({ canvas: alphas(out()) });
      assert.deepEqual(opsNamed(target.ctx, "arc-alpha").map(o => o[1]), [0.15, 1]);
      assert.equal(r.isFading(), true);
      alphas({ ctx });
      ctx.ops.length = 0;
      r.render(100);
      assert.ok(opsNamed(ctx, "arc-alpha")[0][1] > 0.8, "the live fade carries on where it was");
    });

    test("node images are drawn from the image itself, without building sprites", async () => {
      const restoreImage = installImage({ size: 256 });
      const restoreCanvas = installOffscreenCanvas();
      try {
        const g = new Graph();
        g.addNode({ id: "a" });
        const sim = new Simulation(g, {});
        const r = new Renderer(sim, { canvas: makeCanvas(), nodeConfig: { image: "a.png" } });
        await flush();
        const built = restoreCanvas.created.length;
        const target = r.toCanvas({ canvas: out(), fit: true, width: 1000, height: 1000 });
        const [[, img]] = opsNamed(target.ctx, "drawImage");
        assert.equal(img, r.images.get("a.png").image);
        assert.equal(opsNamed(target.ctx, "clip").length, 1);
        assert.equal(restoreCanvas.created.length, built, "no sprite was asked for");
        assert.equal(r.isPreparingImages(), false);
      } finally { restoreCanvas(); restoreImage(); }
    });
  });

  describe("canvases and options", () => {
    test("makes an OffscreenCanvas where there's no document, and throws where there's neither", () => {
      const { r } = scene(false, []);
      assert.throws(() => r.toCanvas(), /^Error: Renderer: no canvas can be made here/);
      const restore = installOffscreenCanvas();
      try {
        const target = r.toCanvas({ pixelRatio: 0.5 });
        assert.ok(target instanceof globalThis.OffscreenCanvas);
        assert.deepEqual([target.width, target.height], [400, 300]);
      } finally { restore(); }
    });

    test("invalid options throw before anything is drawn", () => {
      const { r } = scene(false, []);
      const target = out();
      for (const [bad, pattern] of [
        [{ size: 2 }, /^TypeError: Renderer: unknown option `size`$/],
        [{ width: 0 }, /^RangeError: Renderer: `width`/],
        [{ height: "10" }, /^TypeError: Renderer: `height`/],
        [{ pixelRatio: -1 }, /pixelRatio/],
        [{ padding: -1 }, /padding/],
        [{ fit: 1 }, /fit/],
        [{ hooks: "no" }, /hooks/],
        [{ background: 0 }, /^TypeError: Renderer: `background` must be a string or null$/],
        [{ canvas: {} }, /^TypeError: Renderer: export `canvas` must be a canvas$/],
      ]) assert.throws(() => r.toCanvas({ canvas: target, ...bad }), pattern, JSON.stringify(bad));
      assert.deepEqual(target.ctx.ops, []);
      assert.throws(() => r.toCanvas({ canvas: { getContext: () => null } }), /no 2D context/);
    });
  });

  describe("toBlob", () => {
    test("encodes with the canvas's toBlob, passing the type and quality", async () => {
      const { r } = scene(false, []);
      const target = Object.assign(out(), {
        toBlob(cb, type, quality) { this.encoded = [type, quality]; queueMicrotask(() => cb("blob")); },
      });
      assert.equal(await r.toBlob({ canvas: target, type: "image/jpeg", quality: 0.8 }), "blob");
      assert.deepEqual(target.encoded, ["image/jpeg", 0.8]);
    });

    test("uses convertToBlob on an OffscreenCanvas", async () => {
      const { r } = scene(false, []);
      const target = Object.assign(out(), {
        async convertToBlob(opts) { this.encoded = opts; return "blob"; },
      });
      assert.equal(await r.toBlob({ canvas: target, fit: true }), "blob");
      assert.deepEqual(target.encoded, { type: undefined, quality: undefined });
    });

    test("draws when called, before encoding", async () => {
      const { r } = scene(false, []);
      const target = Object.assign(out(), { toBlob(cb) { setTimeout(() => cb("blob"), 0); } });
      const pending = r.toBlob({ canvas: target });
      assert.equal(opsNamed(target.ctx, "arc").length, 2);
      await pending;
    });

    describe("waitForImages", () => {
      /* One node using a.png and one using b.png, whose requests start as the
         renderer syncs and settle on the next flush. Each export's encoding
         records whether the node images were drawn. */
      async function imageExport(opts, { fail = () => false, before } = {}) {
        const restoreImage = installImage({ fail });
        const restoreCanvas = installOffscreenCanvas();
        try {
          const g = new Graph();
          g.addNode({ id: "a", img: "a.png" });
          g.addNode({ id: "b", img: "b.png" });
          const r = new Renderer(new Simulation(g, {}), { canvas: makeCanvas(), nodeConfig: { image: n => n.data.img } });
          const target = Object.assign(out(), { toBlob(cb) { cb("blob"); } });
          before?.(r, g);
          assert.equal(await r.toBlob({ canvas: target, fit: true, ...opts }), "blob");
          return { r, drawn: opsNamed(target.ctx, "drawImage").map(([, img]) => img.src) };
        } finally { restoreCanvas(); restoreImage(); }
      }

      test("off by default: images still loading are drawn as their node's color", async () => {
        const { r, drawn } = await imageExport({});
        assert.deepEqual(drawn, []);
        assert.equal(r.images.get("a.png")?.status, "loaded", "they did load, after the drawing");
      });

      test("on: drawn once every node image has loaded", async () => {
        const { drawn } = await imageExport({ waitForImages: true });
        assert.deepEqual(drawn.sort(), ["a.png", "b.png"]);
      });

      test("images that fail don't hold it up", async () => {
        const { r, drawn } = await imageExport({ waitForImages: true }, { fail: src => src === "b.png" });
        assert.deepEqual(drawn, ["a.png"]);
        assert.equal(r.images.get("b.png")?.status, "failed");
      });

      test("a node added while waiting is waited for too", async () => {
        const { drawn } = await imageExport({ waitForImages: true }, {
          before: (r, g) => r.on("imageload", e => {
            if (e.src === "a.png") g.addNode({ id: "c", img: "c.png" });
          }),
        });
        assert.deepEqual(drawn.sort(), ["a.png", "b.png", "c.png"]);
      });

      test("an image collected while waiting stops being waited for", async () => {
        // b.png never loads. Once its node is removed and its entry collected,
        // no request is left to settle, so only the collection can end the wait.
        const restoreImage = installImage();
        const Stub = globalThis.Image;
        globalThis.Image = class extends Stub {
          set src(v) { if (v !== "b.png") super.src = v; }
          get src() { return super.src; }
        };
        try {
          const g = new Graph();
          g.addNode({ id: "a", img: "a.png" });
          g.addNode({ id: "b", img: "b.png" });
          const r = new Renderer(new Simulation(g, {}), { nodeConfig: { image: n => n.data.img } });
          const target = Object.assign(out(), { toBlob(cb) { cb("blob"); } });
          let done = false;
          const pending = r.toBlob({ canvas: target, fit: true, waitForImages: true }).then(b => { done = true; return b; });
          await flush();
          assert.equal(r.images.get("a.png")?.status, "loaded");
          assert.equal(done, false, "still waiting for b.png");

          g.removeNode("b");
          r._imageDebt = 100;     // collect unused images on the next sync
          r.sync();
          assert.equal(r.images.has("b.png"), false);
          assert.equal(await pending, "blob");
          assert.deepEqual(opsNamed(target.ctx, "drawImage").map(([, img]) => img.src), ["a.png"]);
        } finally { restoreImage(); }
      });

      test("invalid options reject before any waiting", async () => {
        // An image that never loads, so a toBlob() that waits never settles
        const prevImage = globalThis.Image;
        globalThis.Image = class { set src(v) {} };
        try {
          const g = new Graph();
          g.addNode({ id: "a" });
          const r = new Renderer(new Simulation(g, {}), { nodeConfig: { image: "a.png" } });
          r.sync();
          for (const [bad, pattern] of [
            [{ waitForImages: "yes" }, /^TypeError: Renderer: `waitForImages` must be a boolean$/],
            [{ waitForImages: true, width: -1 }, /^RangeError: Renderer: `width`/],
            [{ waitForImages: true, colour: "red" }, /^TypeError: Renderer: unknown option `colour`$/],
          ]) {
            let result = "pending";
            r.toBlob(bad).then(() => { result = "resolved"; }, e => { result = e; });
            await flush();
            assert.equal(r.images.get("a.png")?.status, "loading");
            assert.match(String(result), pattern, JSON.stringify(bad));
          }
          let waited = "pending";
          r.toBlob({ waitForImages: true, width: 10, height: 10 }).then(() => { waited = "settled"; }, () => { waited = "settled"; });
          await flush();
          assert.equal(waited, "pending", "valid options do wait");
        } finally { globalThis.Image = prevImage; }
      });
    });

    test("rejects when encoding fails or an option is invalid", async () => {
      const { r } = scene(false, []);
      const failing = Object.assign(out(), { toBlob(cb) { cb(null); } });
      await assert.rejects(r.toBlob({ canvas: failing }), /^Error: Renderer: the image couldn't be encoded/);
      await assert.rejects(r.toBlob({ canvas: failing, quality: 2 }), /^RangeError: Renderer: `quality`/);
      await assert.rejects(r.toBlob({ canvas: failing, type: 1 }), /^TypeError: Renderer: `type`/);
      await assert.rejects(r.toBlob({ canvas: failing, width: -1 }), RangeError);
    });
  });
});
