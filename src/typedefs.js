// GRAPH LAYER
/** @typedef {import("./graph").Graph} Graph */

/**
 * @typedef {any} NodeId
 */

/**
 * Custom data for a node. Any fields are allowed; `id`, if present, becomes
 * the node's id when no explicit `id` argument is passed.
 * @typedef {{ id?: any, [key: string]: any }} NodeData
 */

/**
 * @typedef {object} GraphNode
 * @property {any} id - id of the node
 * @property {any} data - custom data associated with the node
 */

/**
 * @typedef {object} GraphEdge
 * @property {GraphNode} src - source node (order does not matter in an undirected graph)
 * @property {GraphNode} dest - destination node (order does not matter in an undirected graph)
 * @property {any} data - custom data associated with the edge
*/

/**
 * @typedef {object} GraphOpts
 * @property {boolean} [directed=false] - whether the graph is directed; fixed at instantiation
 */



// SIMULATION LAYER

/**
 * A config value derived per node. Can accept a `GraphNode` parameter and a
 * `Graph` parameter.`
 * @template T
 * @typedef {(node: GraphNode, graph: Graph) => T} NodeAccessor
 */

/**
 * A config value, either supplied directly or derived per node.
 * `asFn` normalizes both forms into a function.
 * @template T
 * @typedef {T | NodeAccessor<T>} NodeOption
 */

/**
 * A config value derived per edge. Can accept a `GraphEdge` parameter and a
 * `Graph` parameter.`
 * @template T
 * @typedef {(node: GraphEdge, graph: Graph) => T} EdgeAccessor
 */

/**
 * A config value, either supplied directly or derived per edge.
 * `asFn` normalizes both forms into a function.
 * @template T
 * @typedef {T | EdgeAccessor<T>} EdgeOption
 */

/**
 * @typedef {object} SimOpts
 * @property {number} friction - friction coefficient to apply to all node
 *    velocities each tick
 * @property {number} gravity - strength of pull toward (0, 0), applied as a
 *    force proportional to distance
 * @property {number} repulsion - coefficient for inverse-square repulsion
 *    calculations
 * @property {number} springStiffness - coefficient for spring forces
 * @property {number} springLength - target length of edges/springs between nodes
 * @property {number} minDistSq - minimum distance to clamp to before applying
 *    repulsive force between two nodes (to avoid extreme velocities from the
 *    inverse-square law)
 * @property {number} maxSpeed - maximum speed of each node (clamped to at the
 *    end of each tick)
 * @property {number} cooling - coefficient to decay temperature by each tick
 * @property {number} freezePoint - temperature value below which temp is set
 *    to 0
 */
/** @typedef {Partial<SimOpts> & { nodeConfig?: SimNodeConfig }} SimOptsInput */

/**
 * Full simulation node object. Position and velocity props can be set directly,
 * but `mass`, `radius`, and `fixed` must be set using `setNodeConfig()`.
 * @typedef {object} SimNode
 * @property {any} id - node id (matches corresponding `GraphNode`)
 * @property {number} mass - physical mass of the node
 * @property {number} radius - physical (and rendered) radius of the node
 * @property {boolean} fixed - whether the node is immovable
 * @property {number} x - x coordinate
 * @property {number} y - y coordinate
 * @property {number} vx - x velocity
 * @property {number} vy - y velocity
 * @property {number} fx - [temp] x force total, reset and populated every tick
 * @property {number} fy - [temp] y force total, reset and populated every tick
 */

/**
 * @typedef { "mass" | "radius" | "fixed" } ConfigurableSimNodeProps
 */

/**
 * Partial config specifier
 * @typedef {{
 *    [K in keyof Pick<SimNode, ConfigurableSimNodeProps>]?: NodeOption<SimNode[K]>
 * }} SimNodeConfig
 */

/**
 * Fully populated config after merging with defaults.
 * @typedef {Required<SimNodeConfig>} ResolvedSimNodeConfig
 */

/**
 * Sim-node options collapsed into functions
 * @typedef {{
 *    [K in keyof Pick<SimNode, ConfigurableSimNodeProps>]?: NodeAccessor<SimNode[K]>
 * }} SimNodeAccessors
 */

/**
 * Fully populated config accessors
 * @typedef {Required<SimNodeAccessors>} ResolvedSimNodeAccessors
 */



// RENDERER LAYER

/** @typedef {HTMLCanvasElement | OffscreenCanvas} Canvas */
/** @typedef {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} CanvasContext */

/** @typedef {"top" | "bottom" | "left" | "right"} LabelPosition */
/** @typedef {"dim" | "hide"} HighlightMode */

/**
 * @typedef {object} RendererOptsInput
 * @property {Canvas} [canvas] - canvas to render to
 * @property {string} [background] - background color
 * @property {NodeStyleConfig} [nodeConfig] - default node config
 * @property {EdgeStyleConfig} [edgeConfig] - default edge config
 * @property {boolean} [renderEdges] - whether to render edges
 * @property {boolean} [renderLabels] - whether to render node labels
 * @property {string} [labelFont] - label font
 * @property {LabelPosition} [labelPosition] - where to render labels
 * @property {number} [labelMargin] - world px margin between a node and its label
 * @property {number} [minLabelSize] - canvas px font size below which scaled
 *    labels are hidden
 * @property {number} [maxLabelSize] - canvas px font size that scaled labels
 *    are capped at
 * @property {HighlightMode} [highlightMode] - highlight mode
 * @property {number} [highlightAlpha] - highlight alpha
 * @property {number} [highlightFadeDuration] - milliseconds for an element to
 *    fade fully between opacity 0 and 1 when highlighting changes; 0 disables
 *    fading
 * @property {ReferrerPolicy} [imageReferrerPolicy] - default referrer policy
 *    for image requests.
 * @property {"anonymous" | "use-credentials" | null} [crossOrigin] - default
 *    cross-origin parameter for image requests.
 * @property {number} [imageCacheMB] - soft memory budget, in megabytes, for
 *    cached node image sizes; images on screen are always kept
 */

/** @typedef {Required<Omit<RendererOptsInput, "canvas" | "nodeConfig" | "edgeConfig">>} RendererOpts */

/**
 * @typedef {object} Size
 * @property {number} w
 * @property {number} h
 */

/**
 * Generic viewport container specifying center coordinates and zoom scale.
 * Shape and aspect ratio are separately applied by the viewing container.
 * @typedef {object} View
 * @property {number} x - x coordinate of view center
 * @property {number} y - y coordinate of view center
 * @property {number} zoom - zoom amount (canvas px / simulation px)
 */

/**
 * @typedef {object} NodeStyle
 * @property {string} color - node fill color
 * @property {string} outlineColor - node outline color
 * @property {number} outlineWidth - node outline width
 * @property {string | null} image - node image source
 * @property {string | number | null} label - text label
 * @property {boolean} renderLabel - whether to render the label, if it exists
 * @property {number} labelScale - label font size, in world px
 * @property {string} labelTextColor - label text color
 */

/**
 * @typedef {object} EdgeStyle
 * @property {string} color - edge color
 * @property {number} width - edge width/thickness
 * @property {boolean | null} arrow - whether to draw an arrow (`null` follows
 *    from an undirected graph)
 * @property {number} arrowSize - size of arrow, if drawn
 * @property {number} bow - world px of perpendicular bow for reciprocal
 *    directed pairs
 */

/**
 * Partial node config specifier
 * @typedef {{ [K in keyof NodeStyle]?: NodeOption<NodeStyle[K]> }} NodeStyleConfig
 */

/**
 * Partial edge config specifier
 * @typedef {{ [K in keyof EdgeStyle]?: EdgeOption<EdgeStyle[K]> }} EdgeStyleConfig
 */

/**
 * Fully resolved node config specifier
 * @typedef {Required<NodeStyleConfig>} ResolvedNodeStyleConfig
 */

/**
 * Fully resolved edge config specifier
 * @typedef {Required<EdgeStyleConfig>} ResolvedEdgeStyleConfig
 */

/**
 * Partial node config accessor functions
 * @typedef {{ [K in keyof NodeStyle]?: NodeAccessor<NodeStyle[K]> }} NodeStyleAccessors
 */

/**
 * Partial edge config accessor functions
 * @typedef {{ [K in keyof EdgeStyle]?: EdgeAccessor<EdgeStyle[K]> }} EdgeStyleAccessors
 */

/**
 * Fully resolved node config accessor functions
 * @typedef {Required<NodeStyleAccessors>} ResolvedNodeStyleAccessors
 */

/**
 * Fully resolved edge config accessor functions
 * @typedef {Required<EdgeStyleAccessors>} ResolvedEdgeStyleAccessors
 */



// GRAPHJS LAYER
/**
 * @typedef {object} GraphJSOpts
 * @property {GraphOpts} [graph] - options for the `Graph`
 * @property {SimOptsInput} [simulation] - options for the `Simulation`
 * @property {RendererOptsInput} [renderer] - options for the `Renderer`
 * @property {Canvas} [canvas] - canvas to render to
 */

export {};
