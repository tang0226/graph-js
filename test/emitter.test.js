import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../src/emitter.js";

/* A minimal emitter, standing in for a layer: no DOM, no GraphJS. `fire()`
   exposes the protected `_emit()` the way a subclass method would use it. */
class Counter extends Emitter {
  constructor() { super(["change", "reset"], "Counter"); this.value = 0; }
  add(n) {
    const prevented = this._emit("change", { from: this.value, to: this.value + n });
    if (!prevented) this.value += n;
    return this;
  }
  fire(type, data) { return this._emit(type, data); }
  listening(type) { return this._hasListeners(type); }
}

describe("Emitter", () => {
  test("a subclass emits its own events, with itself as the target", () => {
    const c = new Counter();
    const seen = [];
    assert.equal(c.on("change", e => seen.push(e)), c, "on chains the subclass");
    c.add(2);
    assert.equal(seen.length, 1);
    const [e] = seen;
    assert.equal(e.type, "change");
    assert.equal(e.target, c);
    assert.deepEqual([e.from, e.to], [0, 2]);
    assert.equal(c.value, 2);
  });

  test("preventDefault reaches the subclass, which skips its response", () => {
    const c = new Counter();
    c.on("change", e => { if (e.to > 5) e.preventDefault(); });
    c.add(3).add(3);
    assert.equal(c.value, 3);
  });

  test("each instance has its own listeners", () => {
    const a = new Counter(), b = new Counter();
    let calls = 0;
    a.on("change", () => { calls++; });
    b.add(1);
    assert.equal(calls, 0);
    a.add(1);
    assert.equal(calls, 1);
  });

  test("event names are the ones given to the constructor", () => {
    const c = new Counter();
    assert.doesNotThrow(() => c.on("reset", () => {}));
    assert.throws(() => c.on("nodeclick", () => {}), /^TypeError: Counter: unknown event "nodeclick"$/);
    assert.throws(() => c.off("hasOwnProperty", () => {}), TypeError);
    assert.throws(() => c.fire("other", {}), TypeError);
    assert.throws(() => c.listening("other"), TypeError);
  });

  test("errors are reported under the subclass's name", t => {
    const error = t.mock.method(console, "error", () => {});
    const c = new Counter();
    assert.throws(() => c.on("change", "f"), /Counter: "change" listener must be a function/);
    c.on("change", () => { throw new Error("boom"); });
    c.on("change", e => e.preventDefault());
    assert.equal(c.fire("change", { from: 0, to: 1 }), true, "the next listener still runs");
    assert.match(error.mock.calls[0].arguments[0], /^Counter: "change" listener failed$/);
  });

  test("_hasListeners reports whether an event has listeners", () => {
    const c = new Counter();
    const f = () => {};
    assert.equal(c.listening("change"), false);
    c.on("change", f);
    assert.equal(c.listening("change"), true);
    assert.equal(c.listening("reset"), false, "per event");
    c.off("change", f);
    assert.equal(c.listening("change"), false);
  });

  test("emitting with no listeners builds no event and reports no preventDefault", () => {
    const c = new Counter();
    let read = false;
    const data = { get from() { read = true; return 0; }, to: 1 };
    assert.equal(c.fire("change", data), false);
    assert.equal(read, false, "the data isn't copied when nobody listens");
  });

  test("data can't override type or target, and isn't modified", () => {
    const c = new Counter();
    let seen;
    c.on("change", e => { seen = e; });
    const data = { from: 0, to: 1, type: "reset", target: null };
    c.fire("change", data);
    assert.equal(seen.type, "change");
    assert.equal(seen.target, c);
    assert.deepEqual(data, { from: 0, to: 1, type: "reset", target: null });
  });

  test("listeners added during an emit wait for the next; removed ones are skipped", () => {
    const c = new Counter();
    const log = [];
    const late = () => log.push("late");
    const removed = () => log.push("removed");
    c.on("change", e => { log.push("first"); e.target.on("change", late).off("change", removed); });
    c.on("change", removed);
    c.add(1);
    assert.deepEqual(log, ["first"]);
    c.add(1);
    assert.deepEqual(log, ["first", "first", "late"]);
  });
});
