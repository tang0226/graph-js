// TWEENS
// Types only. No DOM types here: `Tween` works headlessly.

/**
 * A tweened value: a single number, or an array of numbers interpolated
 * element by element.
 * @typedef {number | number[]} TweenValue
 */

/**
 * The value type a setter receives: `number` for number tweens (not the
 * literal types of `from` and `to`), otherwise the array type.
 * @template T
 * @typedef {T extends number ? number : T} TweenSetValue
 */

/**
 * What a tween's `duration` and `delay` count: milliseconds, or frames
 * (calls to `step()`).
 * @typedef {"ms" | "frames"} TweenUnit
 */

/**
 * An easing function. Maps progress from 0 to 1 onto eased progress, which
 * should start at 0 and end at 1 but may leave that range in between (for
 * overshoot).
 * @typedef {(t: number) => number} Easing
 */

/**
 * Name of a built-in easing in `easings`.
 * @typedef {"linear" | "inQuad" | "outQuad" | "inOutQuad" | "inCubic" |
 *    "outCubic" | "inOutCubic" | "outBack"} EasingName
 */

/**
 * Options for a tween.
 * @template {TweenValue} [T=TweenValue]
 * @typedef {object} TweenOpts
 * @property {(value: TweenSetValue<T>) => void} set - applies each new value
 *    to whatever is being animated
 * @property {T | (() => T)} from - start value. A function is called once,
 *    when the tween starts moving (after `delay`), so the tween can start from
 *    whatever the value is at that moment.
 * @property {T} to - end value. Must have the same shape as `from`: both
 *    numbers, or arrays of the same length.
 * @property {number} duration - length of one play, in `unit`s. `0` jumps
 *    straight to the end value.
 * @property {TweenUnit} [unit] - what `duration` and `delay` count. Defaults
 *    to `"ms"`, or to the `GraphJS` instance's `tweenUnit`.
 * @property {Easing | EasingName} [ease] - easing function, or the name of a
 *    built-in one. Defaults to `"linear"`.
 * @property {number} [delay] - wait before the first play, in `unit`s.
 *    Defaults to `0`.
 * @property {number} [repeat] - number of extra plays: `0` (the default)
 *    plays once, `Infinity` loops until cancelled or finished
 * @property {boolean} [yoyo] - whether every other play runs backwards, from
 *    `to` to `from`. Defaults to `false`.
 * @property {() => void} [onFinish] - called when the tween finishes, by
 *    reaching its end or through `finish()`. Not called when cancelled.
 */

export {};
