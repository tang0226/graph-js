import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkKnownKeys, checkEach, checkBoolean, checkString, checkOneOf, checkNumber } from "../src/validate.js";

describe("validate", () => {
  test("checkKnownKeys rejects unknown names and non-objects, naming the owner", () => {
    const known = new Set(["a", "b"]);
    assert.doesNotThrow(() => checkKnownKeys("Thing", { a: 1, b: undefined }, known));
    assert.throws(() => checkKnownKeys("Thing", { a: 1, c: 2 }, known), /^TypeError: Thing: unknown option `c`$/);
    assert.throws(() => checkKnownKeys("Thing", { c: 2 }, known, "nested."), /unknown option `nested\.c`$/);
    assert.throws(() => checkKnownKeys("Thing", null, known), /^TypeError: Thing: options must be an object$/);
    assert.throws(() => checkKnownKeys("Thing", 5, known, "nested."), /^TypeError: Thing: `nested` must be an object$/);
  });

  test("checkEach runs the rule of each defined value", () => {
    const seen = [];
    checkEach({ a: 1, b: undefined }, { a: v => seen.push(["a", v]), b: v => seen.push(["b", v]) });
    assert.deepEqual(seen, [["a", 1]], "undefined values aren't checked");
  });

  test("checkBoolean, checkString and checkOneOf", () => {
    assert.throws(() => checkBoolean("T", "on", 1), /^TypeError: T: `on` must be a boolean$/);
    assert.throws(() => checkString("T", "font", 12), /^TypeError: T: `font` must be a string$/);
    assert.throws(() => checkOneOf("T", "mode", "x", ["a", null]), /^RangeError: T: `mode` must be one of "a", null$/);
    assert.doesNotThrow(() => checkOneOf("T", "mode", null, ["a", null]));
  });

  test("checkNumber rejects non-numbers as TypeError and bad numbers as RangeError", () => {
    assert.throws(() => checkNumber("T", "n", "1"), /^TypeError: T: `n` must be a finite number$/);
    for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => checkNumber("T", "n", bad), RangeError);
    assert.doesNotThrow(() => checkNumber("T", "n", -5));
  });

  test("checkNumber ranges, with their messages", () => {
    const fails = (v, rule) => { try { checkNumber("T", "n", v, rule); return null; } catch (e) { return e.message; } };
    assert.equal(fails(-1, { min: 0 }), "T: `n` must be a finite number, 0 or more");
    assert.equal(fails(0, { min: 0 }), null);
    assert.equal(fails(0, { min: 0, aboveMin: true }), "T: `n` must be a finite number above 0");
    assert.equal(fails(1.5, { min: 0, max: 1 }), "T: `n` must be a finite number from 0 to 1");
    assert.equal(fails(2.5, { min: 0, integer: true }), "T: `n` must be an integer, 0 or more");
    assert.equal(fails(5, { max: 3 }), "T: `n` must be a finite number, 3 or less");
    assert.equal(fails(Infinity, { min: 0, allowInfinity: true }), null);
    assert.equal(fails(NaN, { min: 0, allowInfinity: true }), "T: `n` must be a number, 0 or more");
  });
});
