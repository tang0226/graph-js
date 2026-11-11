import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HookRegistry } from "../src/hook-registry.js";

describe("HookRegistry", () => {
  const make = () => new HookRegistry(["before", "after"], "Thing");

  test("hooks of a type run in the order added, through the given call", () => {
    const hooks = make();
    const log = [];
    hooks.add("before", x => log.push(["a", x]));
    hooks.add("before", x => log.push(["b", x]));
    hooks.add("after", x => log.push(["c", x]));
    hooks.run("before", f => f(42));
    assert.deepEqual(log, [["a", 42], ["b", 42]]);
  });

  test("adding a hook twice runs it once, and remove reports whether it was there", () => {
    const hooks = make();
    let calls = 0;
    const f = () => { calls++; };
    hooks.add("before", f);
    hooks.add("before", f);
    hooks.run("before", g => g());
    assert.equal(calls, 1);
    assert.equal(hooks.remove("after", f), false, "types keep separate hooks");
    assert.equal(hooks.remove("before", f), true);
    assert.equal(hooks.remove("before", f), false);
    hooks.run("before", g => g());
    assert.equal(calls, 1);
  });

  test("an unknown type throws a TypeError naming the owner", () => {
    const hooks = make();
    assert.throws(() => hooks.add("during", () => {}), /^TypeError: Thing: unknown hook type "during"$/);
    assert.throws(() => hooks.remove("during", () => {}), TypeError);
    assert.throws(() => hooks.run("during", () => {}), TypeError);
  });

  test("a throwing hook is logged under the owner's name, and the rest still run", t => {
    const error = t.mock.method(console, "error", () => {});
    const hooks = make();
    const failure = new Error("boom");
    const log = [];
    hooks.add("after", () => { throw failure; });
    hooks.add("after", () => log.push("next"));
    hooks.run("after", f => f());
    assert.deepEqual(log, ["next"]);
    assert.equal(error.mock.callCount(), 1);
    assert.deepEqual(error.mock.calls[0].arguments, ["Thing: after hook failed", failure]);
  });

  test("hooks added during a run start on the next run", () => {
    const hooks = make();
    const log = [];
    const late = () => log.push("late");
    hooks.add("before", () => { log.push("first"); hooks.add("before", late); });
    hooks.run("before", f => f());
    assert.deepEqual(log, ["first"]);
    hooks.run("before", f => f());
    assert.deepEqual(log, ["first", "first", "late"]);
  });
});
