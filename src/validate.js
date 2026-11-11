/*
 * Checks for values passed in from outside. Every layer follows one rule for
 * invalid values, so new options should too:
 *
 * 1. Values a caller passes in directly (options, view values, tween
 *    settings) throw: a TypeError for the wrong type or an unknown option
 *    name, a RangeError for a value outside its range. Check every value
 *    before changing anything, so a rejected call changes nothing.
 * 2. Values the library works out per element during sync() (config
 *    functions run against node and edge data) fall back to the default or
 *    clamp, since one bad data point mustn't stop a frame.
 * 3. Limits that are part of a gesture (wheel zoom reaching minZoom or
 *    maxZoom) clamp: reaching them isn't an error.
 *
 * Meaningless values (a negative duration) throw; valid but unusual ones (a
 * friction of 0) are accepted.
 *
 * Doesn't use the DOM, so it works in any environment.
 */


/**
 * Throws if an options object has a key that isn't an option.
 * @param {string} owner - name that starts the error message, such as "Renderer"
 * @param {object} opts - options to check
 * @param {ReadonlySet<string>} known - every option name
 * @param {string} [prefix] - prefix for option names in the message, such as
 *    "barnesHut." for nested options
 * @returns {void}
 * @throws {TypeError} throws if a key is unknown, or `opts` isn't an object
 */
export function checkKnownKeys(owner, opts, known, prefix = "") {
  if (typeof opts !== "object" || opts === null) {
    throw new TypeError(`${owner}: ${prefix ? `\`${prefix.slice(0, -1)}\`` : "options"} must be an object`);
  }
  for (const key of Object.keys(opts)) {
    if (!known.has(key)) throw new TypeError(`${owner}: unknown option \`${prefix}${key}\``);
  }
}


/**
 * Checks each defined value of an options object against its rule. Throws for
 * the first invalid one; values left `undefined` aren't checked.
 * @template {string} K
 * @param {Partial<Record<K, unknown>>} opts - options to check
 * @param {Record<K, (value: any) => void>} rules - a check per option name
 * @returns {void}
 * @throws {TypeError | RangeError} throws as the failing rule does
 */
export function checkEach(opts, rules) {
  for (const key of /** @type {K[]} */ (Object.keys(opts))) {
    const value = opts[key];
    if (value !== undefined) rules[key](value);
  }
}


/**
 * Throws unless a value is a boolean.
 * @param {string} owner - name that starts the error message
 * @param {string} name - option name
 * @param {unknown} value - value to check
 * @returns {void}
 * @throws {TypeError} throws if the value isn't a boolean
 */
export function checkBoolean(owner, name, value) {
  if (typeof value !== "boolean") throw new TypeError(`${owner}: \`${name}\` must be a boolean`);
}


/**
 * Throws unless a value is a string.
 * @param {string} owner - name that starts the error message
 * @param {string} name - option name
 * @param {unknown} value - value to check
 * @returns {void}
 * @throws {TypeError} throws if the value isn't a string
 */
export function checkString(owner, name, value) {
  if (typeof value !== "string") throw new TypeError(`${owner}: \`${name}\` must be a string`);
}


/**
 * Throws unless a value is one of a fixed set.
 * @param {string} owner - name that starts the error message
 * @param {string} name - option name
 * @param {unknown} value - value to check
 * @param {readonly unknown[]} values - allowed values
 * @returns {void}
 * @throws {RangeError} throws if the value isn't allowed
 */
export function checkOneOf(owner, name, value, values) {
  if (values.includes(value)) return;
  const list = values.map(v => (typeof v === "string" ? `"${v}"` : String(v))).join(", ");
  throw new RangeError(`${owner}: \`${name}\` must be one of ${list}`);
}


/**
 * @typedef {object} NumberRule
 * @property {number} [min] - smallest allowed value
 * @property {number} [max] - largest allowed value
 * @property {boolean} [aboveMin] - whether `min` itself is excluded
 * @property {boolean} [integer] - whether only integers are allowed
 * @property {boolean} [allowInfinity] - whether `Infinity` is allowed
 */


/**
 * Throws unless a value is a number within a range. `NaN` is never allowed.
 * @param {string} owner - name that starts the error message
 * @param {string} name - option name
 * @param {unknown} value - value to check
 * @param {NumberRule} [rule] - the allowed range
 * @returns {void}
 * @throws {TypeError} throws if the value isn't a number
 * @throws {RangeError} throws if the value is outside the range
 */
export function checkNumber(owner, name, value, rule = {}) {
  const { min = -Infinity, max = Infinity, aboveMin = false, integer = false, allowInfinity = false } = rule;
  const describe = () => {
    const kind = integer ? "an integer" : allowInfinity ? "a number" : "a finite number";
    const hasMin = min !== -Infinity, hasMax = max !== Infinity;
    if (hasMin && hasMax) return `${kind} from ${min} to ${max}`;
    if (hasMin) return aboveMin ? `${kind} above ${min}` : `${kind}, ${min} or more`;
    if (hasMax) return `${kind}, ${max} or less`;
    return kind;
  };
  if (typeof value !== "number") throw new TypeError(`${owner}: \`${name}\` must be ${describe()}`);
  const ok = !Number.isNaN(value)
    && (allowInfinity || Number.isFinite(value))
    && (!integer || Number.isInteger(value) || (allowInfinity && value === Infinity))
    && (aboveMin ? value > min : value >= min)
    && value <= max;
  if (!ok) throw new RangeError(`${owner}: \`${name}\` must be ${describe()}`);
}
