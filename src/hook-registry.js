/**
 * Hook functions grouped by type, for classes that call user code at fixed
 * points (such as each frame). Hooks of a type run in the order they were
 * added, and adding the same function again has no effect. An error thrown by
 * a hook is logged, and the remaining hooks still run.
 *
 * Doesn't use the DOM, so it works in any environment.
 * @template {string} T - hook type names
 * @template {Function} F - hook function type
 */
export class HookRegistry {
  /**
   * Hooks by type, in the order they were added
   * @type {Map<T, Set<F>>}
   * @private
   */
  _hooks;

  /**
   * Name that starts error messages, such as "GraphJS"
   * @type {string}
   * @private
   */
  _name;


  /**
   * @param {readonly T[]} types - every hook type
   * @param {string} name - name that starts error messages
   */
  constructor(types, name) {
    this._hooks = new Map(types.map(type => [type, new Set()]));
    this._name = name;
  }


  /**
   * Adds a hook.
   * @param {T} type - hook type
   * @param {F} f - hook function
   * @returns {void}
   * @throws {TypeError} throws if the hook type is unknown
   */
  add(type, f) {
    this._setOf(type).add(f);
  }


  /**
   * Removes a hook.
   * @param {T} type - hook type
   * @param {F} f - hook function to remove
   * @returns {boolean} whether the hook was there
   * @throws {TypeError} throws if the hook type is unknown
   */
  remove(type, f) {
    return this._setOf(type).delete(f);
  }


  /**
   * Runs every hook of a type through `call`, which decides how each one is
   * called. Iterates over a copy, so hooks added or re-added during the run
   * start on the next one. An error thrown by `call` is logged, and the
   * remaining hooks still run.
   * @param {T} type - hook type
   * @param {(f: F) => void} call - calls one hook
   * @returns {void}
   * @throws {TypeError} throws if the hook type is unknown
   */
  run(type, call) {
    const hooks = this._setOf(type);
    if (hooks.size === 0) return;
    for (const f of [...hooks]) {
      try { call(f); }
      catch (err) { console.error(`${this._name}: ${type} hook failed`, err); }
    }
  }


  /**
   * Returns the hook set of a type.
   * @param {T} type - hook type
   * @returns {Set<F>} the type's hooks
   * @throws {TypeError} throws if the hook type is unknown
   * @private
   */
  _setOf(type) {
    const hooks = this._hooks.get(type);
    if (!hooks) throw new TypeError(`${this._name}: unknown hook type "${type}"`);
    return hooks;
  }
}
