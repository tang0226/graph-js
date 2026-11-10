import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Tween, easings } from "../src/tween.js";
import { r2 } from "./helpers/stubs.js";

/* A tween whose setter records every value it is given. */
function recorded(opts) {
  const values = [];
  const tw = new Tween({ set: v => { values.push(v); }, ...opts });
  return { tw, values, last: () => values.at(-1) };
}

/* Steps a tween `n` times by `dt` and returns whether it has ended. */
function stepN(tw, n, dt = 0) {
  let done = false;
  for (let i = 0; i < n; i++) done = tw.step(dt);
  return done;
}

describe("Tween: interpolation", () => {
  test("a number tween moves linearly by elapsed time, starting at from", () => {
    const { tw, values } = recorded({ from: 0, to: 100, duration: 100 });
    tw.step(16);                                   // the first step counts as no time
    tw.step(25);
    tw.step(25);
    assert.deepEqual(values, [0, 25, 50]);
  });

  test("an array tween interpolates each element", () => {
    const { tw, last } = recorded({ from: [0, 10], to: [100, -10], duration: 100 });
    tw.step();
    tw.step(25);
    assert.deepEqual(last(), [25, 5]);
  });

  test("it ends on exactly the end value, and reports that it ended", () => {
    const { tw, last } = recorded({ from: 0, to: 1, duration: 30, ease: t => t * 0.999 });
    tw.step();
    assert.equal(tw.step(29), false);
    assert.equal(tw.step(5), true);
    assert.equal(last(), 1, "not ease(1), which this easing misses");
    assert.equal(tw.done, true);
    assert.equal(tw.step(10), true, "stepping an ended tween does nothing");
  });

  test("arrays passed in are copied", () => {
    const from = [0, 0], to = [10, 10];
    const { tw, last } = recorded({ from, to, duration: 10 });
    from[0] = 99; to[0] = 99;
    tw.step(); tw.step(10);
    assert.deepEqual(last(), [10, 10]);
  });

  test("every built-in easing maps 0 to 0 and 1 to 1", () => {
    for (const [name, ease] of Object.entries(easings)) {
      assert.equal(r2(ease(0)), 0, name);
      assert.equal(r2(ease(1)), 1, name);
    }
  });

  test("outBack overshoots", () => {
    assert.ok(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easings.outBack)) > 1);
  });

  test("ease accepts a name or a function", () => {
    const named = recorded({ from: 0, to: 1, duration: 10, ease: "inQuad" });
    const fn = recorded({ from: 0, to: 1, duration: 10, ease: t => t * t });
    for (const { tw } of [named, fn]) { tw.step(); tw.step(5); }
    assert.equal(named.last(), 0.25);
    assert.equal(fn.last(), 0.25);
  });
});

describe("Tween: units and delay", () => {
  test("a frames tween ignores dt and reaches to on its duration-th step", () => {
    const { tw, values } = recorded({ from: 0, to: 4, duration: 4, unit: "frames" });
    assert.equal(stepN(tw, 3, 1000), false);
    assert.equal(tw.step(1000), true);
    assert.deepEqual(values, [1, 2, 3, 4]);
  });

  test("an ms tween waits out its delay before moving", () => {
    const { tw, values } = recorded({ from: 0, to: 10, duration: 10, delay: 20 });
    tw.step(); tw.step(10); tw.step(5);
    assert.deepEqual(values, [], "still inside the delay");
    tw.step(5);
    tw.step(5);
    assert.deepEqual(values, [0, 5]);
  });

  test("a frames delay waits that many steps", () => {
    const { tw, values } = recorded({ from: 0, to: 2, duration: 2, delay: 2, unit: "frames" });
    stepN(tw, 2);
    assert.deepEqual(values, []);
    assert.equal(stepN(tw, 2), true);
    assert.deepEqual(values, [1, 2]);
  });

  test("a function from is read when the tween starts moving, after the delay", () => {
    let current = 0, reads = 0;
    const { tw, values } = recorded({
      from: () => { reads++; return current; }, to: 100, duration: 10, delay: 10,
    });
    tw.step(); tw.step(5);
    current = 50;
    tw.step(5);
    tw.step(5);
    assert.equal(reads, 1);
    assert.deepEqual(values, [50, 75]);
  });

  test("duration 0 jumps to the end on the first step", () => {
    const { tw, values } = recorded({ from: 0, to: 7, duration: 0 });
    assert.equal(tw.step(), true);
    assert.deepEqual(values, [7]);
  });
});

describe("Tween: repeat and yoyo", () => {
  test("repeat counts extra plays, and the last play ends on to", () => {
    const { tw, values } = recorded({ from: 0, to: 4, duration: 4, unit: "frames", repeat: 1 });
    assert.equal(stepN(tw, 8), true);
    assert.deepEqual(values, [1, 2, 3, 0, 1, 2, 3, 4]);
  });

  test("yoyo runs every other play backwards", () => {
    const { tw, values } = recorded({ from: 0, to: 2, duration: 2, unit: "frames", repeat: 2, yoyo: true });
    assert.equal(stepN(tw, 6), true);
    assert.deepEqual(values, [1, 2, 1, 0, 1, 2]);
  });

  test("an odd number of yoyo plays ends on from", () => {
    const { tw, last } = recorded({ from: 0, to: 2, duration: 2, unit: "frames", repeat: 1, yoyo: true });
    assert.equal(stepN(tw, 4), true);
    assert.equal(last(), 0);
  });

  test("time past a play boundary carries into the next play", () => {
    const { tw, last } = recorded({ from: 0, to: 10, duration: 10, repeat: Infinity });
    tw.step();
    tw.step(23);
    assert.equal(r2(last()), 3);
  });

  test("repeat: Infinity keeps going", () => {
    const { tw } = recorded({ from: 0, to: 1, duration: 1, unit: "frames", repeat: Infinity });
    assert.equal(stepN(tw, 1000), false);
  });
});

describe("Tween: cancel and finish", () => {
  test("cancel leaves the value, skips onFinish, and resolves false", async () => {
    let finished = 0;
    const { tw, values } = recorded({ from: 0, to: 10, duration: 10, onFinish: () => finished++ });
    tw.step(); tw.step(5);
    tw.cancel();
    assert.equal(tw.step(5), true);
    assert.deepEqual(values, [0, 5]);
    assert.equal(finished, 0);
    assert.equal(await tw.finished, false);
  });

  test("finish jumps to the end, calls onFinish once, and resolves true", async () => {
    let finished = 0;
    const { tw, last } = recorded({ from: 0, to: 10, duration: 10, onFinish: () => finished++ });
    tw.step();
    tw.finish().finish().cancel();
    assert.equal(last(), 10);
    assert.equal(finished, 1);
    assert.equal(await tw.finished, true);
  });

  test("reaching the end calls onFinish and resolves true", async () => {
    let finished = 0;
    const { tw } = recorded({ from: 0, to: 1, duration: 1, unit: "frames", onFinish: () => finished++ });
    tw.step();
    assert.equal(finished, 1);
    assert.equal(await tw.finished, true);
  });

  test("finish before the first step still applies the end value", () => {
    const { tw, values } = recorded({ from: () => 3, to: 10, duration: 10, delay: 50, repeat: 1, yoyo: true });
    tw.finish();
    assert.deepEqual(values, [3], "two yoyo plays end on from");
  });

  test("finish on an endless tween ends its current play", () => {
    const fwd = recorded({ from: 0, to: 2, duration: 2, unit: "frames", repeat: Infinity, yoyo: true });
    stepN(fwd.tw, 1);
    fwd.tw.finish();
    assert.equal(fwd.last(), 2, "first play runs forwards");

    const back = recorded({ from: 0, to: 2, duration: 2, unit: "frames", repeat: Infinity, yoyo: true });
    stepN(back.tw, 3);
    back.tw.finish();
    assert.equal(back.last(), 0, "second play runs backwards");
  });
});

describe("Tween: errors", () => {
  test("invalid options throw", () => {
    const ok = { set: () => {}, from: 0, to: 1, duration: 1 };
    assert.throws(() => new Tween({ ...ok, set: 1 }), TypeError);
    assert.throws(() => new Tween({ ...ok, to: "1" }), TypeError);
    assert.throws(() => new Tween({ ...ok, to: NaN }), TypeError);
    assert.throws(() => new Tween({ ...ok, from: [0] }), TypeError);
    assert.throws(() => new Tween({ ...ok, from: [0, 1], to: [1] }), TypeError);
    assert.throws(() => new Tween({ ...ok, ease: "bouncy" }), TypeError);
    assert.throws(() => new Tween({ ...ok, duration: -1 }), RangeError);
    assert.throws(() => new Tween({ ...ok, duration: Infinity }), RangeError);
    assert.throws(() => new Tween({ ...ok, delay: -1 }), RangeError);
    assert.throws(() => new Tween({ ...ok, repeat: 1.5 }), RangeError);
    assert.throws(() => new Tween({ ...ok, repeat: Infinity, duration: 0 }), RangeError);
    assert.throws(() => new Tween({ ...ok, unit: "seconds" }), RangeError);
    assert.doesNotThrow(() => new Tween({ ...ok, repeat: Infinity }));
  });

  test("a throwing setter is logged and the tween cancelled", async t => {
    const error = t.mock.method(console, "error", () => {});
    const tw = new Tween({ set: () => { throw new Error("boom"); }, from: 0, to: 1, duration: 10 });
    assert.equal(tw.step(), true);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(await tw.finished, false);
  });

  test("a function from that returns the wrong shape is logged and the tween cancelled", async t => {
    const error = t.mock.method(console, "error", () => {});
    const { tw, values } = recorded({ from: () => [0, 0], to: 1, duration: 10 });
    assert.equal(tw.step(), true);
    assert.deepEqual(values, []);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(await tw.finished, false);
  });

  test("a throwing onFinish is logged, and the tween still counts as finished", async t => {
    const error = t.mock.method(console, "error", () => {});
    const { tw } = recorded({ from: 0, to: 1, duration: 0, onFinish: () => { throw new Error("boom"); } });
    assert.equal(tw.step(), true);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(await tw.finished, true);
  });
});
