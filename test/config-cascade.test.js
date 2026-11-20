import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConfigCascade } from "../src/config-cascade.js";
import { numberField, STRING_FIELD } from "../src/validate.js";

describe("ConfigCascade", () => {
  const BASE = { size: 1, color: "red" };
  const RULES = { size: numberField({ min: 0 }), color: STRING_FIELD };
  const make = () => new ConfigCascade(BASE, RULES, "Test", "node");
  const node = { id: "a" };

  test("starts from the base defaults, with every field callable", () => {
    const c = make();
    assert.deepEqual(c.defaults, BASE);
    assert.notEqual(c.defaults, BASE, "the base object is copied, not shared");
    assert.equal(c.accessors.size(node), 1);
    assert.equal(c.accessors.color(node), "red");
    assert.equal(c.dirty, false);
  });

  test("setDefaults merges fields, keeps accessors as given, and marks dirty", () => {
    const c = make();
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
    const c = make();
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
    const c = make();
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
    const c = make();
    c.markDirty();
    assert.equal(c.dirty, true);
    c.markClean();
    assert.equal(c.dirty, false);
  });

  test("configs set are checked, and an invalid one changes nothing", () => {
    const c = make();
    assert.throws(() => c.setDefaults({ size: -1 }), /^RangeError: Test: `size` must be a finite number, 0 or more, or a function of the node$/);
    assert.throws(() => c.set("a", { color: 3 }), /^TypeError: Test: `color` must be a string, or a function of the node$/);
    assert.throws(() => c.set("a", { colour: "red" }), /^TypeError: Test: unknown node config field `colour`$/);
    assert.throws(() => c.set("a", null), /^TypeError: Test: node config must be an object$/);
    assert.throws(() => c.check([], "`nodeConfig`"), /^TypeError: Test: `nodeConfig` must be an object$/);
    assert.equal(c.defaults.size, 1);
    assert.equal(c.overrides.has("a"), false);
    assert.equal(c.dirty, false);
    assert.doesNotThrow(() => c.set("a", { size: () => -1, color: undefined }), "functions and undefined aren't checked");
  });

  test("resolve takes the override, then the default, through the field's rule", () => {
    const c = make();
    c.setDefaults({ size: n => n.size });
    c.set("a", { color: "blue", size: () => null });
    assert.equal(c.resolve("color", "a", node), "blue");
    assert.equal(c.resolve("color", "b", node), "red");
    assert.equal(c.resolve("size", "a", { size: 4 }), 4, "an override giving null falls through to the default");
    assert.equal(c.resolve("size", "a", { size: -4 }), 0, "a function's number is clamped");
    assert.equal(c.resolve("size", "a", { size: "4" }), 1, "anything else falls back to the base default");
    c.set("b", { color: () => 7 });
    assert.equal(c.resolve("color", "b", node), "red");
  });
});
