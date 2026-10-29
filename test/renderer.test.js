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

describe("Renderer: sprites", () => {
  /* Image nodes of radius 20 at the canvas centre (400, 300), so each is 40 px
     across at zoom 1, with a stubbed OffscreenCanvas so sprites can be built.
     Node `id` uses the image `${id}.png`. */
  async function spriteScene({ ids = ["a"], size = 256, width, height, dpr, oc, opts, color } = {}) {
    const restores = [];
    if (dpr !== undefined) restores.push(installWindow(dpr));
    restores.push(installImage({ size, width, height }));
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
      restore: () => restores.reverse().forEach(f => f()),
    };
  }

  // Sprite bitmaps drawn onto the main canvas, in draw order
  const drawnSprites = ctx =>
    opsNamed(ctx, "drawImage").map(([, src]) => src).filter(s => "close" in s);

  describe("choosing a sprite", () => {
    test("draws the smallest sprite covering the on-screen size, with no clip", async () => {
      const s = await spriteScene();
      try {
        s.r.render();
        const [[, sprite, ...box]] = opsNamed(s.ctx, "drawImage");
        assert.equal(sprite.width, 64, "40 px on screen picks the 64 sprite");
        assert.deepEqual(box, [380, 280, 40, 40]);
        for (const op of ["clip", "save", "restore"])
          assert.equal(opsNamed(s.ctx, op).length, 0, `a cached sprite needs no ${op}()`);
      } finally { s.restore(); }
    });

    test("zooming in picks a larger sprite", async () => {
      const s = await spriteScene();
      try {
        s.r.view.zoom = 2;
        s.r.render();
        assert.equal(drawnSprites(s.ctx)[0].width, 128);
      } finally { s.restore(); }
    });

    test("the device pixel ratio counts toward the size", async () => {
      const s = await spriteScene({ dpr: 2 });
      try {
        s.r.render();
        assert.equal(drawnSprites(s.ctx)[0].width, 128, "40 CSS px at 2x is 80 device px");
      } finally { s.restore(); }
    });

    test("sprites are never larger than the source", async () => {
      const s = await spriteScene({ size: 64 });
      try {
        s.r.view.zoom = 4;
        s.r.render();
        assert.equal(drawnSprites(s.ctx)[0].width, 64);
        assert.ok(s.created.every(c => c.width <= 64), "no sprite above the source size is built");
      } finally { s.restore(); }
    });

    test("below 6 device px a node is a dot in the image's average colour", async () => {
      const s = await spriteScene();
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
        s.r.render();
        assert.equal(s.ctx.fillStyle, "#ff0000", "a cross-origin image taints the canvas");
      } finally { s.restore(); }
    });
  });

  describe("building sprites", () => {
    test("sprites are bitmaps, built in one reused canvas per size", async () => {
      const s = await spriteScene({ ids: ["a", "b", "c"] });
      try {
        s.r.render();
        assert.equal(drawnSprites(s.ctx).length, 3, "every node draws an ImageBitmap");
        assert.equal(s.bitmaps.length, 3);
        assert.equal(s.created.filter(c => c.width === 64).length, 1,
          "the build canvas is handed off and reused, not one canvas per sprite");
      } finally { s.restore(); }
    });

    test("a sprite is masked to a circle before it is handed off", async () => {
      const s = await spriteScene();
      try {
        s.r.render();
        const { ctx } = drawnSprites(s.ctx)[0].source;
        const ops = ctx.ops.map(([n, v]) => n === "globalCompositeOperation" ? v : n);
        assert.deepEqual(ops.slice(ops.indexOf("drawImage")),
          ["drawImage", "destination-in", "beginPath", "arc", "fill", "source-over"]);
        assert.deepEqual(opsNamed(ctx, "arc")[0].slice(1, 4), [32, 32, 32]);
      } finally { s.restore(); }
    });

    test("large sources shrink in steps of at most 2x", async () => {
      const s = await spriteScene({ size: 2048 });
      try {
        s.r.render();
        const steps = s.created.flatMap(c => opsNamed(c.ctx, "drawImage"))
          .map(([, , , , sw, , , , dw]) => [sw, dw]);
        for (const [sw, dw] of steps) assert.ok(sw / dw <= 2, `a ${sw} -> ${dw} step aliases`);
        assert.deepEqual(steps.map(([, dw]) => dw).sort((a, b) => b - a), [1024, 512, 256, 128, 64]);
      } finally { s.restore(); }
    });

    test("a smaller sprite is shrunk from a cached larger one, not the source", async () => {
      const s = await spriteScene({ size: 2048 });
      try {
        s.r.view.zoom = 3;                               // 120 px: the 128 sprite
        s.r.render();
        const before = s.created.length;
        s.r.view.zoom = 1;                               // 40 px: the 64 sprite
        s.r.render();
        const fresh = s.created.slice(before).flatMap(c => opsNamed(c.ctx, "drawImage"));
        assert.equal(fresh.length, 1, "128 -> 64 is a single step");
        assert.equal(fresh[0][1].width, 128);
      } finally { s.restore(); }
    });

    test("non-square sources are centre-cropped", async () => {
      const s = await spriteScene({ width: 200, height: 100 });
      try {
        s.r.render();
        const [draw] = opsNamed(drawnSprites(s.ctx)[0].source.ctx, "drawImage");
        assert.deepEqual(draw.slice(2), [50, 0, 100, 100, 0, 0, 64, 64]);
      } finally { s.restore(); }
    });

    test("sprites are reused across frames", async () => {
      const s = await spriteScene();
      try {
        s.r.render();
        const canvases = s.created.length, bitmaps = s.bitmaps.length;
        s.r.render();
        assert.equal(s.created.length, canvases);
        assert.equal(s.bitmaps.length, bitmaps, "nothing is rebuilt");
      } finally { s.restore(); }
    });

    test("at most 16 sprites are built per frame; the rest use the uncached path", async () => {
      const ids = Array.from({ length: 40 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids, size: 64 });
      try {
        for (const [built, clipped] of [[16, 24], [32, 8], [40, 0]]) {
          s.ctx.ops.length = 0;
          s.r.render();
          assert.equal(s.bitmaps.length, built);
          assert.equal(opsNamed(s.ctx, "clip").length, clipped);
        }
      } finally { s.restore(); }
    });

    test("over the build limit, a nearby cached sprite is used", async () => {
      const ids = Array.from({ length: 17 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids });
      try {
        s.r.render();
        s.r.render();                                    // every node has its 64 sprite
        s.r.view.zoom = 2;                               // all want 128; 16 can be built
        s.ctx.ops.length = 0;
        s.r.render();
        assert.equal(opsNamed(s.ctx, "clip").length, 0, "the 17th node reuses its 64 sprite");
        assert.deepEqual(drawnSprites(s.ctx).map(t => t.width).sort((a, b) => a - b)[0], 64);
      } finally { s.restore(); }
    });
  });

  describe("cache", () => {
    const SPRITE_64 = 64 * 64 * 4;

    test("defaults to 64 MB; negative budgets are clamped to 0", async () => {
      const s = await spriteScene({ opts: { imageCacheMB: -1 } });
      try {
        assert.equal(s.r.opts.imageCacheMB, 0);
        s.r.setOpts({ imageCacheMB: 64 });
        assert.equal(scene(false, []).r.opts.imageCacheMB, 64);
      } finally { s.restore(); }
    });

    test("sprites on screen are kept even over budget; unused ones are evicted and closed", async () => {
      const s = await spriteScene({ opts: { imageCacheMB: 0.001 } });
      try {
        s.r.render();
        assert.equal(s.r._spriteBytes, SPRITE_64, "the visible sprite stays despite the budget");
        const [sprite64] = s.bitmaps;
        s.r.view.zoom = 2;
        s.r.render();
        assert.deepEqual([...s.r._spriteCache.get("a.png").sprites.keys()], [128]);
        assert.equal(s.r._spriteBytes, 128 * 128 * 4);
        assert.equal(sprite64.closed, true, "eviction must free the pixels, not wait for GC");
        assert.equal(s.bitmaps[1].closed, false);
      } finally { s.restore(); }
    });

    test("the least recently drawn sprite is evicted first", async () => {
      const s = await spriteScene({ ids: ["a", "b"] });
      try {
        s.r.render();                                    // a and b both cached
        s.sim.nodes.get("b").x = 1e5;                    // b goes off screen
        s.r.render();
        s.r.setOpts({ imageCacheMB: SPRITE_64 / 1024 / 1024 });
        s.r.render();
        assert.equal(s.r._spriteCache.get("a.png").sprites.size, 1);
        assert.equal(s.r._spriteCache.get("b.png").sprites.size, 0);
        assert.equal(s.r._spriteBytes, SPRITE_64);
      } finally { s.restore(); }
    });

    test("collecting an unused image drops and closes its sprites", async () => {
      const ids = Array.from({ length: 17 }, (_, i) => "n" + i);
      const s = await spriteScene({ ids, size: 64 });
      try {
        s.r.render();
        s.r.render();
        assert.equal(s.r._spriteBytes, 17 * SPRITE_64);
        for (const id of ids) s.g.removeNode(id);        // 17 removals pass the GC threshold
        s.r.sync();
        assert.equal(s.r._spriteBytes, 0);
        assert.equal(s.r._spriteLru.size, 0);
        assert.equal(s.r._spriteCache.size, 0);
        assert.ok(s.bitmaps.every(b => b.closed), "every dropped sprite is closed");
      } finally { s.restore(); }
    });

    test("a dimmed image node draws its sprite at the dimmed alpha", async () => {
      const s = await spriteScene({ ids: ["a", "b"], opts: { highlightFadeDuration: 0 } });
      try {
        const alphas = [];
        const drawImage = s.ctx.drawImage;
        s.ctx.drawImage = (...args) => { alphas.push(s.ctx.globalAlpha); return drawImage(...args); };
        s.r.setHighlight({ nodes: ["b"] });
        s.r.render();
        assert.deepEqual(alphas, [0.15, 1]);
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

    test("negative label sizes are clamped to 0, in the constructor and setOpts", () => {
      const { r } = scene(false, [], { opts: { minLabelSize: -1, maxLabelSize: -1 } });
      assert.equal(r.opts.minLabelSize, 0);
      assert.equal(r.opts.maxLabelSize, 0);
      r.setOpts({ minLabelSize: -5, maxLabelSize: -5 });
      assert.equal(r.opts.minLabelSize, 0);
      assert.equal(r.opts.maxLabelSize, 0);
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
      ["sideways", [300, 322], "center", "top"],
    ]) {
      test(`position "${position}" anchors the label at ${at}`, () => {
        const { r, ctx } = lscene({ opts: { labelPosition: position } });
        r.render();
        assert.deepEqual(texts(ctx)[0], ["a", ...at]);
        assert.equal(textState(ctx)[0].textAlign, textAlign);
        assert.equal(textState(ctx)[0].textBaseline, textBaseline);
      });
    }

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
      const flags = r._nodeHighlightState;
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

    test("a negative highlightFadeDuration is clamped to 0", () => {
      assert.equal(hscene({ highlightFadeDuration: -5 }).r.opts.highlightFadeDuration, 0);
      const { r } = hscene();
      r.setOpts({ highlightFadeDuration: -1 });
      assert.equal(r.opts.highlightFadeDuration, 0);
    });

    test("highlightAlpha is clamped to [0, 1] on every path", () => {
      assert.equal(hscene({ highlightAlpha: 5 }).r.opts.highlightAlpha, 1);
      const { r } = hscene();
      r.setOpts({ highlightAlpha: -1 });
      assert.equal(r.opts.highlightAlpha, 0);
      r.setHighlight({ nodes: ["a"], alpha: 2 });
      assert.equal(r.opts.highlightAlpha, 1);
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
