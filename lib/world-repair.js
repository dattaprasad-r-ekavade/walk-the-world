const ROAD_TAGS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'living_street', 'pedestrian', 'footway', 'path']);

export function summarizeCityElements(elements = []) {
  const summary = {
    elements: 0,
    buildings: 0,
    roads: 0,
    bridges: 0,
    water: 0,
    namedPlaces: 0,
    shopsAndAmenities: 0,
    treesAndParks: 0,
    heightTaggedBuildings: 0,
    materialTaggedBuildings: 0,
    relationPolygons: 0,
  };

  for (const element of Array.isArray(elements) ? elements : []) {
    const tags = element?.tags || {};
    summary.elements += 1;
    const building = Boolean(tags.building || tags['building:part']);
    if (building) {
      summary.buildings += 1;
      if (tags.height || tags['building:levels']) summary.heightTaggedBuildings += 1;
      if (tags['building:material'] || tags['building:colour'] || tags['roof:material'] || tags['roof:colour']) summary.materialTaggedBuildings += 1;
    }
    if (ROAD_TAGS.has(tags.highway)) summary.roads += 1;
    if (tags.bridge && tags.bridge !== 'no') summary.bridges += 1;
    if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water) summary.water += 1;
    if (tags.name) summary.namedPlaces += 1;
    if (tags.shop || tags.amenity) summary.shopsAndAmenities += 1;
    if (tags.natural === 'tree' || tags.leisure === 'park' || tags.landuse === 'forest') summary.treesAndParks += 1;
    if (element?.type === 'relation' && (building || tags.natural === 'water' || tags.landuse)) summary.relationPolygons += 1;
  }

  const heightCoverage = summary.buildings ? summary.heightTaggedBuildings / summary.buildings : 0;
  const materialCoverage = summary.buildings ? summary.materialTaggedBuildings / summary.buildings : 0;
  return {
    ...summary,
    heightCoverage: Number(heightCoverage.toFixed(3)),
    materialCoverage: Number(materialCoverage.toFixed(3)),
  };
}

export function deterministicWorldRepair(summary, context = {}) {
  const findings = [];
  if (summary.buildings > 20 && summary.heightCoverage < 0.25) {
    findings.push({
      id: 'height-coverage',
      title: 'Recover skyline variation',
      action: 'Estimate height bands from footprint area, nearby tagged buildings, and land-use context; keep collision geometry unchanged.',
      evidence: `${Math.round(summary.heightCoverage * 100)}% of ${summary.buildings} buildings include height or level tags.`,
      confidence: 0.88,
      risk: 'medium',
    });
  }
  if (summary.buildings > 15 && summary.materialCoverage < 0.18) {
    findings.push({
      id: 'facade-coverage',
      title: 'Diversify facade families',
      action: 'Propose restrained facade and roof families from land use and local tagged examples, with provenance retained per building.',
      evidence: `${Math.round(summary.materialCoverage * 100)}% of buildings include material or colour tags.`,
      confidence: 0.82,
      risk: 'low',
    });
  }
  if (summary.roads > 12 && summary.shopsAndAmenities < 4) {
    findings.push({
      id: 'street-life',
      title: 'Flag low street-life coverage',
      action: 'Do not invent businesses; raise a review flag and use only generic, non-branded street furniture where land-use evidence supports it.',
      evidence: `${summary.roads} road features but only ${summary.shopsAndAmenities} shop or amenity features were found.`,
      confidence: 0.75,
      risk: 'low',
    });
  }
  if (summary.bridges > 0 && summary.water === 0) {
    findings.push({
      id: 'bridge-water',
      title: 'Audit bridge context',
      action: 'Check relation-based waterways and adjacent cells before changing bridge clearance or ground geometry.',
      evidence: `${summary.bridges} bridge feature(s) are present without a water polygon in this cell summary.`,
      confidence: 0.91,
      risk: 'high',
    });
  }
  if (!findings.length) {
    findings.push({
      id: 'healthy-cell',
      title: 'Preserve mapped detail',
      action: 'No high-confidence repair is recommended. Prefer the source data and review only visible anomalies.',
      evidence: 'The cell passes the current coverage and topology heuristics.',
      confidence: 0.94,
      risk: 'low',
    });
  }

  return {
    version: 1,
    engine: 'rules',
    model: null,
    place: context.place || null,
    summary: 'A deterministic safety pass identified data gaps for review. Nothing is silently written to the map or world geometry.',
    findings: findings.slice(0, 4),
    provenance: ['OpenStreetMap element/tag summary', 'Walk the World deterministic safety rules'],
    generatedAt: new Date().toISOString(),
  };
}

export function isValidWorldRepair(value) {
  return Boolean(
    value &&
      value.version === 1 &&
      typeof value.summary === 'string' &&
      Array.isArray(value.findings) &&
      value.findings.length > 0 &&
      value.findings.every((f) =>
        f &&
        typeof f.id === 'string' &&
        typeof f.title === 'string' &&
        typeof f.action === 'string' &&
        typeof f.evidence === 'string' &&
        Number.isFinite(f.confidence) &&
        ['low', 'medium', 'high'].includes(f.risk)
      )
  );
}

