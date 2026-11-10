/**
 * @import {
 *  TweenValue, TweenSetValue, TweenUnit, Easing, EasingName, TweenOpts,
 * } from './typedefs/tween.js'
 */


/**
 * Built-in easing functions, by name. Each maps 0 to 0 and 1 to 1.
 * @type {Readonly<Record<EasingName, Easing>>}
 */
export const easings = Object.freeze({
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2),
  inCubic: t => t ** 3,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2),
  // Overshoots past 1 before settling
  outBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
});


/**
 * Whether a value is a tween value: a finite number, or an array of them.
 * @param {unknown} v - value to check
 * @returns {v is TweenValue} whether `v` is a tween value
 */
const isTweenValue = v =>
  Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v);

/**
 * Converts a tween value to the array form tweens work in internally: a
 * number becomes a one-element array, and an array is copied, so later
 * changes by the caller don't affect the tween.
 * @param {TweenValue} v - value to convert
 * @returns {number[]} array form
 */
const toArray = v => (Array.isArray(v) ? [...v] : [v]);

/**
 * Interpolates between two arrays of the same length.
 * @param {number[]} a - start values
 * @param {number[]} b - end values
 * @param {number} e - eased progress, usually from 0 to 1
 * @returns {number[]} interpolated values
 */
const lerp = (a, b, e) => a.map((v, i) => v + (b[i] - v) * e);


/**
 * Animates a number, or an array of numbers, from one value to another,
 * passing each new value to a setter. Advanced by `step()`: a `GraphJS`
 * instance steps the tweens it creates with `tween()` every frame.
 * @template {TweenValue} [T=TweenValue]
 */
export class Tween {
  /** @private @type {(value: TweenSetValue<T>) => void} */
  _set;
  /**
   * Values are kept as arrays internally, a number as a one-element array, so
   * one code path handles both. `_scalar` says which form the setter gets.
   * @private @type {boolean}
   */
  _scalar;
  /** @private @type {number[] | (() => TweenValue)} */
  _fromInput;
  /** @private @type {number[]} */
  _to;
  /** @private @type {number} */
  _duration;
  /** @private @type {TweenUnit} */
  _unit;
  /** @private @type {Easing} */
  _ease;
  /** @private @type {number} */
  _delay;
  /** @private @type {number} */
  _repeat;
  /** @private @type {boolean} */
  _yoyo;
  /** @private @type {(() => void) | undefined} */
  _onFinish;
  /** @private @type {(() => void) | undefined} */
  _onSettle;

  /**
   * Units elapsed since the first step, or `null` before it
   * @private @type {number | null}
   */
  _elapsed = null;

  /**
   * Start value, set once the tween starts moving, or `null` before then
   * @private @type {number[] | null}
   */
  _from = null;

  /** @private @type {boolean} */
  _done = false;
  /**
   * Whether the tween has ended, by finishing or being cancelled.
   */
  get done() { return this._done; }

  /** @private @type {(finished: boolean) => void} */
  _resolve = () => {};

  /**
   * Resolves when the tween ends: `true` if it finished, by reaching its end
   * or through `finish()`, and `false` if it was cancelled. Never rejects.
   * @type {Promise<boolean>}
   */
  finished = new Promise(resolve => { this._resolve = resolve; });


  /**
   * Initializes a tween. It doesn't move until stepped.
   * @param {TweenOpts<T>} opts - tween options
   * @param {() => void} [onSettle] - internal: called once when the tween
   *    ends, whether it finished or was cancelled, before `onFinish`
   * @throws {TypeError} throws if `set`, `from`, `to` or `ease` is invalid
   * @throws {RangeError} throws if `duration`, `delay`, `repeat` or `unit` is
   *    out of range
   */
  constructor(opts, onSettle = undefined) {
    const {
      set, from, to, duration, unit = "ms", ease = "linear",
      delay = 0, repeat = 0, yoyo = false, onFinish,
    } = opts;

    if (typeof set !== "function") throw new TypeError("Tween: `set` must be a function");
    if (!isTweenValue(to)) {
      throw new TypeError("Tween: `to` must be a finite number or an array of them");
    }
    this._scalar = !Array.isArray(to);
    this._to = toArray(to);
    if (typeof from !== "function") {
      if (!isTweenValue(from)) {
        throw new TypeError("Tween: `from` must be a finite number, an array of them, or a function");
      }
      if (!this._fits(from)) {
        throw new TypeError("Tween: `from` and `to` must both be numbers, or arrays of the same length");
      }
    }
    if (!(duration >= 0 && duration < Infinity)) {
      throw new RangeError("Tween: `duration` must be a finite number, 0 or more");
    }
    if (!(delay >= 0 && delay < Infinity)) {
      throw new RangeError("Tween: `delay` must be a finite number, 0 or more");
    }
    if (!(Number.isInteger(repeat) && repeat >= 0) && repeat !== Infinity) {
      throw new RangeError("Tween: `repeat` must be a whole number, 0 or more, or Infinity");
    }
    if (repeat === Infinity && duration === 0) {
      throw new RangeError("Tween: a tween that repeats forever needs a `duration` above 0");
    }
    if (unit !== "ms" && unit !== "frames") {
      throw new RangeError(`Tween: unknown unit "${unit}"`);
    }
    const easeFn = typeof ease === "function" ? ease : easings[ease];
    if (typeof easeFn !== "function") throw new TypeError(`Tween: unknown easing "${ease}"`);

    this._set = set;
    this._fromInput = typeof from === "function" ? from : toArray(from);
    this._duration = duration;
    this._unit = unit;
    this._ease = easeFn;
    this._delay = delay;
    this._repeat = repeat;
    this._yoyo = yoyo;
    this._onFinish = onFinish;
    this._onSettle = onSettle;
  }


  /**
   * Advances the tween and applies its new value. The first step starts the
   * tween's clock, so it counts as no time. A `"frames"` tween advances one
   * frame per step and ignores `dt`.
   * @param {number} [dt=0] - milliseconds since the previous step
   * @returns {boolean} whether the tween has ended
   */
  step(dt = 0) {
    if (this._done) return true;

    // Frame tweens count this step, so a 10-frame tween ends on its 10th step
    if (this._unit === "frames") this._elapsed = (this._elapsed ?? 0) + 1;
    else this._elapsed = this._elapsed === null ? 0 : this._elapsed + Math.max(dt, 0);

    const t = this._elapsed - this._delay;
    if (t < 0 || (t === 0 && this._unit === "frames" && this._delay > 0)) return false;
    const from = this._startMoving();
    if (!from) return true;

    const plays = this._repeat + 1, D = this._duration;
    if (t >= plays * D) {
      this._end(from, this._endsForward(plays - 1));
      return true;
    }

    const cycle = Math.floor(t / D);
    let p = t / D - cycle;
    if (this._yoyo && cycle % 2 === 1) p = 1 - p;
    return !this._apply(lerp(from, this._to, this._ease(p)));
  }


  /**
   * Ends the tween where it is. Its `finished` promise resolves `false`, and
   * `onFinish` isn't called. No-ops if the tween has already ended.
   * @returns {this} self reference
   */
  cancel() {
    this._settle(false);
    return this;
  }


  /**
   * Jumps the tween to its end value and ends it. With `repeat: Infinity`,
   * that is the end of the current play. Its `finished` promise resolves
   * `true`, and `onFinish` is called. No-ops if the tween has already ended.
   * @returns {this} self reference
   */
  finish() {
    if (this._done) return this;
    let cycle = this._repeat;                        // the last play
    if (this._repeat === Infinity) {
      const t = Math.max((this._elapsed ?? 0) - this._delay, 0);
      cycle = this._duration > 0 ? Math.floor(t / this._duration) : 0;
    }
    const from = this._startMoving();
    if (from) this._end(from, this._endsForward(cycle));
    return this;
  }


  /**
   * Resolves `from` the first time the tween moves. A function `from` is
   * called, and its result checked against `to`.
   * @returns {number[] | null} the start values, or `null` if `from` failed,
   *    in which case the tween is cancelled
   * @private
   */
  _startMoving() {
    if (this._from) return this._from;
    const input = this._fromInput;
    if (typeof input !== "function") return (this._from = input);
    try {
      const from = input();
      if (!isTweenValue(from) || !this._fits(from)) {
        throw new TypeError("Tween: `from` returned a value that doesn't match the shape of `to`");
      }
      return (this._from = toArray(from));
    } catch (err) {
      console.error("Tween: `from` failed", err);
      this._settle(false);
      return null;
    }
  }


  /**
   * Whether a value has the same shape as `to`: both numbers, or arrays of
   * the same length.
   * @param {TweenValue} v - value to check
   * @returns {boolean} whether it can be interpolated with `to`
   * @private
   */
  _fits(v) {
    return Array.isArray(v) ? !this._scalar && v.length === this._to.length : this._scalar;
  }


  /**
   * Whether a play runs forwards, from `from` to `to`.
   * @param {number} cycle - index of the play
   * @returns {boolean} whether the play runs forwards
   * @private
   */
  _endsForward(cycle) {
    return !this._yoyo || cycle % 2 === 0;
  }


  /**
   * Applies an exact end value and finishes the tween.
   * @param {number[]} from - start values
   * @param {boolean} forward - whether to end on `to` rather than `from`
   * @returns {void}
   * @private
   */
  _end(from, forward) {
    if (this._apply(forward ? this._to : from)) this._settle(true);
  }


  /**
   * Passes values to the setter: a number for a number tween, otherwise a
   * copy of the array. A setter that throws is logged, and the tween is
   * cancelled.
   * @param {number[]} values - values to apply
   * @returns {boolean} whether the setter succeeded
   * @private
   */
  _apply(values) {
    const value = this._scalar ? values[0] : [...values];
    try {
      // `_scalar` matches T, which TypeScript can't follow, hence the cast
      this._set(/** @type {TweenSetValue<T>} */ (value));
      return true;
    } catch (err) {
      console.error("Tween: setter failed", err);
      this._settle(false);
      return false;
    }
  }


  /**
   * Ends the tween once: resolves `finished`, then calls the internal
   * `onSettle`, then `onFinish` if it finished.
   * @param {boolean} finished - whether the tween finished, rather than
   *    being cancelled
   * @returns {void}
   * @private
   */
  _settle(finished) {
    if (this._done) return;
    this._done = true;
    this._resolve(finished);
    this._onSettle?.();
    if (!finished || !this._onFinish) return;
    try { this._onFinish(); }
    catch (err) { console.error("Tween: onFinish failed", err); }
  }
}
