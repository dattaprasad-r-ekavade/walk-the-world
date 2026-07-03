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
 */

/**
 * @typedef {Object} CityElement
 * @property {'node'|'way'} type
 * @property {number} id
 * @property {number} [lat]
 * @property {number} [lon]
 * @property {Record<string,string>} [tags]
 * @property {{lat:number,lon:number}[]} [geometry]
 */

/**
 * @typedef {Object} CityData
 * @property {CityElement[]} elements
 */

export {};
