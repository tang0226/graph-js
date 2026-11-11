import { asFn } from "./utils.js";


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
 * Stores config only: the layer that owns it resolves each element's values,
 * reading `accessors` and `overrides`, so it can validate them its own way.
 * Changes mark the cascade `dirty` until the layer calls `markClean()`.
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

  /** @type {boolean} @private */
  _dirty = false;


  /**
   * @param {C} base - base defaults: every field, used where the default
   *    config doesn't set one
   */
  constructor(base) {
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
   * Merges fields into the default config.
   * @param {Partial<C>} config - fields to set
   * @returns {void}
   */
  setDefaults(config) {
    this._defaults = { ...this._base, ...this._defaults, ...config };
    this._accessors = toAccessors(this._defaults);
    this._dirty = true;
  }


  /**
   * Merges fields into an element's overrides.
   * @param {K} key - element key
   * @param {Partial<C>} config - fields to set
   * @returns {void}
   */
  set(key, config) {
    this._overrides.set(key, toAccessors({ ...this._overrides.get(key), ...config }));
    this._dirty = true;
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
