import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConfigCascade } from "../src/config-cascade.js";

describe("ConfigCascade", () => {
  const BASE = { size: 1, color: "red" };
  const node = { id: "a" };

  test("starts from the base defaults, with every field callable", () => {
    const c = new ConfigCascade(BASE);
    assert.deepEqual(c.defaults, BASE);
    assert.notEqual(c.defaults, BASE, "the base object is copied, not shared");
    assert.equal(c.accessors.size(node), 1);
    assert.equal(c.accessors.color(node), "red");
    assert.equal(c.dirty, false);
  });

  test("setDefaults merges fields, keeps accessors as given, and marks dirty", () => {
    const c = new ConfigCascade(BASE);
    const size = n => n.id.length * 10;
    c.setDefaults({ size });
    assert.equal(c.defaults.size, size);
    assert.equal(c.defaults.color, "red", "fields left out keep their value");
    assert.equal(c.accessors.size(node), 10);
    assert.equal(c.dirty, true);
    c.setDefaults({ color: "blue" });
    assert.equal(c.defaults.size, size, "earlier defaults are kept");
  });

  test("set merges an element's overrides into accessors", () => {
    const c = new ConfigCascade(BASE);
    c.set("a", { size: 5 });
    c.markClean();
    c.set("a", { color: () => "green" });
    const o = c.overrides.get("a");
    assert.equal(o.size(node), 5, "earlier overrides are kept");
    assert.equal(o.color(node), "green");
    assert.equal("size" in (c.overrides.get("b") ?? {}), false);
    assert.equal(c.dirty, true);
  });

  test("clear removes an element's overrides and marks dirty; prune doesn't mark dirty", () => {
    const c = new ConfigCascade(BASE);
    c.set("a", { size: 5 });
    c.set("b", { size: 6 });
    c.markClean();
    c.clear("a");
    assert.equal(c.overrides.has("a"), false);
    assert.equal(c.dirty, true);
    c.markClean();
    c.prune("b");
    assert.equal(c.overrides.has("b"), false);
    assert.equal(c.dirty, false, "a removed element changes no element's values");
  });

  test("markDirty and markClean set the flag", () => {
    const c = new ConfigCascade(BASE);
    c.markDirty();
    assert.equal(c.dirty, true);
    c.markClean();
    assert.equal(c.dirty, false);
  });
});
