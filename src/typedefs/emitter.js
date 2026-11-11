// EVENTS
// Shared by every class that emits events. Nothing here may reach a DOM type,
// so the layers that work without a browser can emit events too.

/**
 * Fields every event has on top of its data: its `type`, the `target` that
 * emitted it, and `preventDefault()`, which asks the emitter to skip its own
 * response to the event. Whether there is a response to skip depends on the
 * event; the other listeners still run either way.
 * @template K, T
 * @typedef {{
 *   readonly type: K,
 *   readonly target: T,
 *   readonly defaultPrevented: boolean,
 *   preventDefault: () => void,
 * }} EmitterEventBase
 */

/**
 * Event passed to listeners: the event's data from the event map `M`, plus
 * the fields every event has
 * @template {object} M - event map: each event name mapped to its data
 * @template {keyof M} K - event name
 * @template T - type of the emitter, which events report as their `target`
 * @typedef {M[K] & EmitterEventBase<K, T>} EmitterEvent
 */

/**
 * Function called with each event of the name it was added for
 * @template {object} M - event map: each event name mapped to its data
 * @template {keyof M} K - event name
 * @template T - type of the emitter
 * @typedef {(event: EmitterEvent<M, K, T>) => void} EmitterListener
 */

export {};
