/** @import { EmitterEvent, EmitterListener } from './typedefs/emitter.js' */


/**
 * Base class for emitting events. A subclass passes its event names to the
 * constructor, and emits with `_emit()`; its users listen with `on()` and
 * `off()`.
 *
 * Doesn't use the DOM, so classes that work without a browser can extend it.
 * @template {object} M - event map: each event name mapped to the data its
 *    events carry
 * @template T - type of the subclass, which events report as their `target`
 */
export class Emitter {
  /**
   * Listeners by event name, in the order they were added
   * @type {Map<keyof M, Set<EmitterListener<M, any, T>>>}
   * @private
   */
  _listeners;

  /**
   * Name that starts error messages, such as "GraphJS"
   * @type {string}
   * @private
   */
  _emitterName;


  /**
   * @param {readonly (keyof M)[]} types - every event name, matching the keys
   *    of the event map
   * @param {string} name - name that starts error messages
   */
  constructor(types, name) {
    this._listeners = new Map(types.map(type => [type, new Set()]));
    this._emitterName = name;
  }


  /**
   * Adds a listener for an event. Listeners of an event run in the order they
   * were added, and adding the same function again has no effect. An error
   * thrown by a listener is logged, and the remaining listeners still run.
   * @template {keyof M} K
   * @param {K} type - event name
   * @param {EmitterListener<M, K, T>} f - listener, called with the event
   * @returns {this} self reference
   * @throws {TypeError} throws if the event name is unknown or `f` isn't a
   *    function
   */
  on(type, f) {
    if (typeof f !== "function") {
      throw new TypeError(`${this._emitterName}: "${String(type)}" listener must be a function`);
    }
    this._listenersOf(type).add(f);
    return this;
  }


  /**
   * Removes a listener for an event. A listener removed while its event is
   * being emitted doesn't run for that event, if it hasn't already.
   * @template {keyof M} K
   * @param {K} type - event name
   * @param {EmitterListener<M, K, T>} f - listener to remove
   * @returns {boolean} whether the listener was there
   * @throws {TypeError} throws if the event name is unknown
   */
  off(type, f) {
    return this._listenersOf(type).delete(f);
  }


  /**
   * Returns whether an event has any listeners. Lets code that emits often
   * skip building event data nobody will read.
   * @param {keyof M} type - event name
   * @returns {boolean} whether the event has listeners
   * @throws {TypeError} throws if the event name is unknown
   * @protected
   */
  _hasListeners(type) {
    return this._listenersOf(type).size > 0;
  }


  /**
   * Emits an event: calls each of its listeners with one shared event object,
   * built from `data` plus the `type`, `target` and `preventDefault()` fields.
   * Iterates over a copy, so listeners added during the emit start on the
   * next one, and skips listeners removed during it.
   * @template {keyof M} K
   * @param {K} type - event name
   * @param {M[K]} data - the event's data
   * @returns {boolean} whether a listener called `preventDefault()`, in which
   *    case the caller should skip its own response to the event
   * @throws {TypeError} throws if the event name is unknown
   * @protected
   */
  _emit(type, data) {
    const listeners = this._listenersOf(type);
    if (listeners.size === 0) return false;
    let prevented = false;
    /** @type {EmitterEvent<M, K, T>} */
    const event = {
      ...data,
      type,
      target: /** @type {T} */ (/** @type {unknown} */ (this)),
      get defaultPrevented() { return prevented; },
      preventDefault() { prevented = true; },
    };
    for (const f of [...listeners]) {
      if (!listeners.has(f)) continue;
      try { f(event); }
      catch (err) { console.error(`${this._emitterName}: "${String(type)}" listener failed`, err); }
    }
    return prevented;
  }


  /**
   * Returns the listener set of an event.
   * @param {keyof M} type - event name
   * @returns {Set<EmitterListener<M, any, T>>} the event's listeners
   * @throws {TypeError} throws if the event name is unknown
   * @private
   */
  _listenersOf(type) {
    const listeners = this._listeners.get(type);
    if (!listeners) throw new TypeError(`${this._emitterName}: unknown event "${String(type)}"`);
    return listeners;
  }
}
