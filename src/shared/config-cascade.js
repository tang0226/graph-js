/** @import { FieldRule } from './validate.js' */
import { asFn } from "./utils.js";
import { checkConfig } from "./validate.js";


/**
 * Turns every field of a config into a function, so values and accessors can
 * be called the same way.
 * @template {object} C
 * @template {object} A
 * @param {C} config - config to convert
 * @returns {A} accessors
 */
const toAccessors = config => {
  /** @type {Record<string, Function>} */
  const accessors = {};
  // A plain loop: this runs for every override set, so it's kept cheap
  for (const key in config) accessors[key] = asFn(/** @type {any} */ (config)[key]);
  return /** @type {A} */ (/** @type {unknown} */ (accessors));
};


/**
 * The config cascade for one kind of element (such as the simulation's nodes,
 * or the renderer's edges). A field resolves to the element's own override if
 * it has one, otherwise the default config, which starts from the base
 * defaults.
 *
 * Each field has a `FieldRule`, given by the layer that owns the cascade.
 * Configs set are checked against them and throw if invalid, and `resolve()`
 * makes what a config function returns usable, falling back to the field's
 * base default. Changes mark the cascade `dirty` until the layer calls
 * `markClean()`.
 *
 * Doesn't use the DOM, so it works in any environment.
 * @template {object} C - full config: every field, each a value or accessor
 * @template {object} A - full accessors: every field as a function
 * @template K - key of an element's overrides, such as a node id
 */
export class ConfigCascade {
  /** @type {Readonly<C>} @private */
  _base;

  /** @type {C} @private */
  _defaults;

  /** @type {A} @private */
  _accessors;

  /** @type {Map<K, Partial<A>>} @private */
  _overrides = new Map();

  /** @type {Readonly<Record<keyof C, FieldRule<any>>>} @private */
  _rules;

  /** @type {string} @private */
  _owner;

  /** @type {"node" | "edge"} @private */
  _kind;

  /** @type {boolean} @private */
  _dirty = false;


  /**
   * @param {C} base - base defaults: every field, used where the default
   *    config doesn't set one, and where a config function's result is
   *    invalid
   * @param {Readonly<Record<keyof C, FieldRule<any>>>} rules - a rule per
   *    field, which also lists the fields a config may set
   * @param {string} owner - name that starts error messages, such as
   *    "Renderer"
   * @param {"node" | "edge"} kind - element the config is for
   */
  constructor(base, rules, owner, kind) {
    this._rules = rules;
    this._owner = owner;
    this._kind = kind;
    this._base = Object.freeze({ ...base });
    this._defaults = { ...base };
    this._accessors = toAccessors(this._defaults);
  }


  /**
   * Current default config
   * @returns {Readonly<C>}
   */
  get defaults() { return this._defaults; }

  /**
   * Current default config, with every field as a function
   * @returns {Readonly<A>}
   */
  get accessors() { return this._accessors; }

  /**
   * Per-element overrides, with every field as a function
   * @returns {ReadonlyMap<K, Readonly<Partial<A>>>}
   */
  get overrides() { return this._overrides; }

  /**
   * Whether the config changed since the last `markClean()`
   * @returns {boolean}
   */
  get dirty() { return this._dirty; }


  /**
   * Throws unless a config is valid to set: an object of known fields, each
   * value valid for its field or a function.
   * @param {unknown} config - config to check
   * @param {string} [label] - what the config is called in messages, such
   *    as "`nodeConfig`"
   * @returns {void}
   * @throws {TypeError | RangeError} throws as `checkConfig()` does
   */
  check(config, label = undefined) {
    checkConfig(this._owner, this._kind, config, this._rules, label);
  }


  /**
   * Merges fields into the default config. Nothing changes if the config is
   * invalid.
   * @param {Partial<C>} config - fields to set
   * @returns {void}
   * @throws {TypeError | RangeError} throws as `check()` does
   */
  setDefaults(config) {
    this.check(config);
    this._defaults = { ...this._base, ...this._defaults, ...config };
    this._accessors = toAccessors(this._defaults);
    this._dirty = true;
  }


  /**
   * Merges fields into an element's overrides. Nothing changes if the config
   * is invalid.
   * @param {K} key - element key
   * @param {Partial<C>} config - fields to set
   * @returns {void}
   * @throws {TypeError | RangeError} throws as `check()` does
   */
  set(key, config) {
    this.check(config);
    this._overrides.set(key, toAccessors({ ...this._overrides.get(key), ...config }));
    this._dirty = true;
  }


  /**
   * Resolves one field for an element: its own override if that gives a
   * value, otherwise the default config's, made usable by the field's rule.
   * @template {keyof A & keyof C} F
   * @param {F} field - field to resolve
   * @param {K} key - element key, for its overrides
   * @param {unknown} element - the element, passed to config functions
   * @param {unknown} graph - the graph, passed to config functions
   * @returns {A[F] extends (...args: any[]) => infer R ? R : never} the
   *    value
   */
  resolve(field, key, element, graph) {
    const own = /** @type {any} */ (this._overrides.get(key))?.[field];
    const value = own?.(element, graph) ?? /** @type {any} */ (this._accessors)[field](element, graph);
    return this._rules[field].resolve(value, this._base[field]);
  }


  /**
   * Removes all of an element's overrides.
   * @param {K} key - element key
   * @returns {void}
   */
  clear(key) {
    this._overrides.delete(key);
    this._dirty = true;
  }


  /**
   * Forgets the overrides of an element that no longer exists. Unlike
   * `clear()`, doesn't mark the cascade dirty, since no element's values
   * change.
   * @param {K} key - element key
   * @returns {void}
   */
  prune(key) {
    this._overrides.delete(key);
  }


  /**
   * Marks the cascade as changed, such as when data its accessors read has
   * changed.
   * @returns {void}
   */
  markDirty() { this._dirty = true; }


  /**
   * Marks the cascade's changes as applied.
   * @returns {void}
   */
  markClean() { this._dirty = false; }
}
