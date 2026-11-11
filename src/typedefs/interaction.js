// INTERACTION

/**
 * Options for built-in pointer interaction
 * @typedef {object} InteractionOptsInput
 * @property {boolean} [dragNodes] - whether dragging a node moves it (default
 *    `true`). When `false`, dragging a node pans instead, if `pan` is on.
 * @property {boolean} [pan] - whether dragging the background pans the view
 *    (default `true`)
 * @property {boolean} [zoom] - whether the wheel zooms the view, anchored at
 *    the pointer (default `true`). When `false`, the wheel scrolls the page
 *    as usual.
 * @property {number} [dragThreshold] - canvas px the pointer must move while
 *    pressed before a drag starts (default 4). A press that moves no further
 *    is a click.
 * @property {number} [zoomSpeed] - how fast the wheel zooms (default 0.002):
 *    each wheel event multiplies the zoom by `2 ** (-deltaY * zoomSpeed)`,
 *    with `deltaY` in px
 * @property {number} [minZoom] - smallest zoom the wheel zooms out to
 *    (default 0.01)
 * @property {number} [maxZoom] - largest zoom the wheel zooms in to (default
 *    100)
 */

/**
 * Interaction options with every value resolved
 * @typedef {Required<InteractionOptsInput>} InteractionOpts
 */

export {};
