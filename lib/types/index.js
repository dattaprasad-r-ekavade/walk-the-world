/**
 * @typedef {Object} EngineStatus
 * @property {'fly'|'walk'} mode
 * @property {'first'|'third'} view
 * @property {number|null} elevation
 * @property {boolean} locked
 * @property {number} [lat]
 * @property {number} [lon]
 * @property {number} [heading]
 * @property {number} [height]
 * @property {number} [fps]
 */

/**
 * @typedef {Object} GameSettings
 * @property {number} hour
 * @property {number} weather
 * @property {'low'|'medium'|'high'} quality
 * @property {'street'|'classic'} engine
 * @property {'osm'|'satellite'} [groundSource]
 * @property {boolean} [music]
 */

/**
 * @typedef {Object} CityElement
 * @property {'node'|'way'|'relation'} type
 * @property {number} id
 * @property {number} [lat]
 * @property {number} [lon]
 * @property {Record<string,string>} [tags]
 * @property {{lat:number,lon:number}[]} [geometry]
 */

/**
 * @typedef {Object} CityData
 * @property {CityElement[]} elements
 * @property {boolean} [partial] Incomplete cells must not enter persistent caches.
 */

export {};

/**
 * @typedef {Object} CityBuildRequest
 * @property {CityElement[]} elements
 * @property {number} lat0
 * @property {number} lon0
 * @property {Map} terrainTiles
 * @property {AbortSignal} [signal]
 * @property {(done:number,total:number)=>void} [onProgress]
 */
/**
 * @typedef {Object} CellOwner
 * @property {string} cellKey Shared by meshes, collision entries and runtime metadata.
 * @property {number} lat
 * @property {number} lon
 */
