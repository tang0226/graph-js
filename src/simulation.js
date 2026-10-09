import { asFn } from "./utils.js";

const NODE_SIM_DEFAULTS = { mass: 1, radius: 20, fixed: false };


export class Simulation {
  constructor(graph, opts = {}) {
    this.graph = graph;

    this.opts = {
      friction:        opts.friction ?? 0.9,
      gravity:         opts.gravity ?? 0.01,
      repulsion:       opts.repulsion ?? 100,
      springStiffness: opts.springStiffness ?? 0.5,
      springLength:    opts.springLength ?? 60,
      minDistSq:       opts.minDistSq ?? 1,
    };

    this.setDefaultNodeConfig();
    this._overrides = new Map();

    this.nodes = new Map();
    this._list = [];
    this._index = new Map();
    this._springs = [];


    // Self version
    this._version = 1;

    // Graph sync
    this._syncedVersion = -1;
    this._syncedDataVersion = -1;
    this.sync();
  }

  setDefaultNodeConfig(config = {}) {
    this._defaultNodeConfig = { ...NODE_SIM_DEFAULTS, ...this._defaultNodeConfig, ...config };
    this._accessors = {
      mass: asFn(this._defaultNodeConfig.mass),
      radius: asFn(this._defaultNodeConfig.radius),
      fixed: asFn(this._defaultNodeConfig.fixed),
    };
    this._configDirty = true;
  }

  setNodeConfig(id, config = {}) {
    const merged = { ...this._overrides.get(id), ...config };
    for (const k in merged) merged[k] = asFn(merged[k]);
    this._overrides.set(id, merged);
    this._configDirty = true;
  }

  clearNodeConfig(id) {
    this._overrides.delete(id);
    this._configDirty = true;
  }

  // Update sim-node config based on graph node
  _resolve(gNode, sNode) {
    const acc = this._accessors, g = this.graph, o = this._overrides.get(gNode.id);
    const mass   = o?.mass?.(gNode, g)   ??  acc.mass(gNode, g);
    const radius = o?.radius?.(gNode, g) ??  acc.radius(gNode, g);
    sNode.mass   = Number.isFinite(mass)   ? Math.max(mass, 1e-6) : 1;
    sNode.radius = Number.isFinite(radius) ? Math.max(radius, 0)  : 20;
    sNode.fixed  = (o?.fixed?.(gNode, g) ??  acc.fixed(gNode, g)) === true;
  }

  // Create a sim-node object based on the given graph node
  _seedNode(gNode) {
    const pos = this._seedPos(gNode);
    const sNode = {
      id: gNode.id,
      ...NODE_SIM_DEFAULTS,
      ...pos,
      fx: 0, fy: 0,
    };
    this._resolve(gNode, sNode);
    return sNode;
  }

  _seedPos(gNode) {
    const neighbors = this.graph.adjacency.get(gNode.id);
    let sx = 0, sy = 0, n = 0;
    if (neighbors) for (const id of neighbors.keys()) {
      const sNode = this.nodes.get(id);
      if (sNode) { sx += sNode.x; sy += sNode.y; n++; }
    }
    const jitter = () => (Math.random() - 0.5) * 2;
    return n ? {
      x: sx / n + jitter(), y: sy / n + jitter(),
      vx: 0, vy: 0,
    } : {
      x: jitter() * 100, y: jitter() * 100,
      vx: 0, vy: 0,
    };
  }

  // Update physics tables to match graph
  sync() {
    if (this._syncedDataVersion !== this.graph._dataVersion) {
      this._configDirty = true;
      this._syncedDataVersion = this.graph._dataVersion;
    }
    if (this._syncedVersion === this.graph._version && !this._configDirty) return false;

    // Update and add nodes
    for (const [id, gNode] of this.graph.nodes) {
      const sNode = this.nodes.get(id);
      if (sNode) this._resolve(gNode, sNode);
      else this.nodes.set(id, this._seedNode(gNode));
    }
    this._configDirty = false;

    if (this._syncedVersion === this.graph._version) {
      return true;
    }

    // Delete old nodes
    for (const id of this.nodes.keys()) {
      if (!this.graph.nodes.has(id)) {
        this.nodes.delete(id);
        this._overrides.delete(id);
      }
    }

    this._list = [];
    this._index = new Map();
    for (const [id, sNode] of this.nodes) {
      this._index.set(id, this._list.length);
      this._list.push(sNode);
    }

    const pairs = [];
    for (const edge of this.graph.edges)
      pairs.push(this._index.get(edge.src.id), this._index.get(edge.dest.id));
    this._springs = Int32Array.from(pairs);

    this._syncedVersion = this.graph._version;
    this._version++;

    return true;
  }

  _apply_repulsion() {
    const list = this._list;
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const n1 = list[i], n2 = list[j];
        let dx = n1.x - n2.x, dy = n1.y - n2.y;
        let dSq = dx * dx + dy * dy;

        // Randomize force axis for very close distances
        if (dSq < 1e-12) {
          dx = Math.random() - 0.5; dy = Math.random() - 0.5;
          dSq = dx * dx + dy * dy;
        }
        dSq = Math.max(dSq, this.opts.minDistSq); // short-range clamp

        const s = this.opts.repulsion / (dSq * Math.sqrt(dSq));
        const fx = s * dx, fy = s * dy;
        n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
      }
    }
  }

  _apply_springs() {
    const list = this._list;
    const springs = this._springs;
    for (let i = 0; i < springs.length; i += 2) {
      const n1 = list[springs[i]], n2 = list[springs[i + 1]];
      const dx = n1.x - n2.x, dy = n1.y - n2.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const s = -this.opts.springStiffness * (d - this.opts.springLength) / d;
      const fx = s * dx, fy = s * dy;
      n1.fx += fx; n2.fx -= fx; n1.fy += fy; n2.fy -= fy;
    }
  }

  _apply_gravity() {
    const list = this._list;
    const g = this.opts.gravity;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      n.fx -= g * n.x;
      n.fy -= g * n.y;
    }
  }

  _enforce_radius() {
    const list = this._list;
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const n1 = list[i], n2 = list[j];
        let dx = n1.x - n2.x, dy = n1.y - n2.y;
        const dSq = dx * dx + dy * dy;
        const minD = n1.radius + n2.radius;
        if (dSq >= minD * minD) continue;

        let d = Math.sqrt(dSq);
        if (d < 1e-7) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }


        const pushCoeff = (minD - d) / d;
        const s1 = n1.fixed ? 0 : (n2.fixed ? 1 : 0.5);
        const s2 = n2.fixed ? 0 : (n1.fixed ? 1 : 0.5);

        n1.x += dx * pushCoeff * s1;  n1.y += dy * pushCoeff * s1;
        n2.x -= dx * pushCoeff * s2;  n2.y -= dy * pushCoeff * s2;
      }
    }
  }

  tick(dt = 1) {
    this.sync();

    // reset force totals
    const list = this._list;
    for (let i = 0; i < list.length; i++) { list[i].fx = 0; list[i].fy = 0; }

    this._apply_repulsion();
    this._apply_springs();
    this._apply_gravity();

    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.fixed) { r.vx = 0; r.vy = 0; continue; }
      r.vx = (r.vx + (r.fx / r.mass) * dt) * this.opts.friction;
      r.vy = (r.vy + (r.fy / r.mass) * dt) * this.opts.friction;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }

    // Enforce radius
    this._enforce_radius();
  }
}
