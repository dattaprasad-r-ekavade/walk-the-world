import * as THREE from "three";

const DEFAULT_RADIUS = 70;
const SAMPLE_SPACING = 3.5;
const CURB_WIDTH = 0.16;
const CURB_RISE = 0.15;
const SIDEWALK_WIDTH = 1.6;

const SIDEWALK_ROADS = new Set([
  "primary", "secondary", "tertiary", "residential", "unclassified",
  "living_street", "service",
]);

function tagBool(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["no", "none", "separate"].includes(normalized)) return false;
  return true;
}

function sidewalkSides(tags) {
  const all = String(tags.sidewalk || "").trim().toLowerCase();
  if (["no", "none", "separate"].includes(all)) return { left: false, right: false };

  const defaultBoth = SIDEWALK_ROADS.has(tags.highway);
  const globalLeft = all === "left" ? true : all === "right" ? false : tagBool(all);
  const globalRight = all === "right" ? true : all === "left" ? false : tagBool(all);
  const bothTag = tagBool(tags["sidewalk:both"]);
  const fallback = bothTag ?? globalLeft ?? defaultBoth;
  return {
    left: tagBool(tags["sidewalk:left"]) ?? fallback,
    right: tagBool(tags["sidewalk:right"]) ?? (bothTag ?? globalRight ?? defaultBoth),
  };
}

function sidewalkWidth(tags) {
  const raw = String(tags["sidewalk:width"] ?? tags["width:sidewalk"] ?? "");
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/i);
  if (!match) return SIDEWALK_WIDTH;
  const width = Number(match[1]);
  return Number.isFinite(width) ? THREE.MathUtils.clamp(width, 0.8, 5) : SIDEWALK_WIDTH;
}

function addQuad(positions, indices, a, b, c, d, uvs = null, uvPoints = null) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  if (uvs && uvPoints) {
    for (const point of uvPoints) uvs.push(point.x / 2, point.z / 2);
  }
}

function makeGeometry(positions, indices, uvs = null) {
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uvs?.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Build sidewalk and 15 cm kerb geometry for road paths. The initial cell uses
 * a bounded radius around the player; streamed cells pass Infinity so their
 * treatment stays inside the cell group and follows its normal eviction path.
 */
export async function buildNearStreetTreatmentGeometry({
  roadPaths = [],
  player,
  groundHeight = () => 0,
  radius = DEFAULT_RADIUS,
  checkpoint,
} = {}) {
  if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.z))
    return { sidewalks: null, curbs: null };

  const sidewalkPositions = [], sidewalkIndices = [], sidewalkUvs = [];
  const curbPositions = [], curbIndices = [];
  let work = 0;
  const playerX = player.x, playerZ = player.z;

  for (const road of roadPaths) {
    const tags = road.tags || {};
    const sides = sidewalkSides(tags);
    if ((!sides.left && !sides.right) || !SIDEWALK_ROADS.has(tags.highway)) continue;
    const source = road.pts || [];
    if (source.length < 2) continue;

    const samples = [{ x: source[0].x, z: source[0].y }];
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(length / SAMPLE_SPACING));
      for (let j = 1; j <= steps; j++) {
        const t = j / steps;
        samples.push({ x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t });
      }
    }

    const width = sidewalkWidth(tags);
    const halfRoad = Math.max(1.25, Number(road.width) || 6) / 2;
    const isLeft = sides.left;
    const isRight = sides.right;
    for (let i = 0; i < samples.length - 1; i++) {
      if ((work++ & 127) === 0) {
        const pause = checkpoint?.("near-street-treatment");
        if (pause) await pause;
      }
      const a = samples[i], b = samples[i + 1];
      const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
      if (Math.hypot(midX - playerX, midZ - playerZ) > radius + SAMPLE_SPACING) continue;

      const direction = (pointIndex) => {
        const p0 = samples[Math.max(0, pointIndex - 1)];
        const p1 = samples[Math.min(samples.length - 1, pointIndex + 1)];
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        const length = Math.hypot(dx, dz) || 1;
        return { x: -dz / length, z: dx / length };
      };
      const na = direction(i), nb = direction(i + 1);

      for (const [enabled, side] of [[isLeft, 1], [isRight, -1]]) {
        if (!enabled) continue;
        const curbEdge = halfRoad;
        const curbOuter = curbEdge + CURB_WIDTH;
        const sidewalkOuter = curbOuter + width;
        const offsetPoint = (p, normal, distance) => ({
          x: p.x + normal.x * side * distance,
          z: p.z + normal.z * side * distance,
        });
        const lowA = offsetPoint(a, na, curbEdge);
        const lowB = offsetPoint(b, nb, curbEdge);
        const capInnerA = offsetPoint(a, na, curbEdge);
        const capInnerB = offsetPoint(b, nb, curbEdge);
        const capOuterA = offsetPoint(a, na, curbOuter);
        const capOuterB = offsetPoint(b, nb, curbOuter);
        const walkInnerA = capOuterA;
        const walkInnerB = capOuterB;
        const walkOuterA = offsetPoint(a, na, sidewalkOuter);
        const walkOuterB = offsetPoint(b, nb, sidewalkOuter);
        const ground = (p) => Number(groundHeight(p.x, p.z)) || 0;
        const curbBaseA = ground(lowA) + 0.1;
        const curbBaseB = ground(lowB) + 0.1;
        const curbTopA = ground(capInnerA) + 0.1 + CURB_RISE;
        const curbTopB = ground(capInnerB) + 0.1 + CURB_RISE;
        const sidewalkYInnerA = ground(walkInnerA) + 0.1 + CURB_RISE;
        const sidewalkYInnerB = ground(walkInnerB) + 0.1 + CURB_RISE;
        const sidewalkYOuterA = ground(walkOuterA) + 0.1 + CURB_RISE;
        const sidewalkYOuterB = ground(walkOuterB) + 0.1 + CURB_RISE;

        // Kerb face and cap form a low, raised concrete edge above the asphalt.
        addQuad(curbPositions, curbIndices,
          [lowA.x, curbBaseA, lowA.z], [capInnerA.x, curbTopA, capInnerA.z],
          [capInnerB.x, curbTopB, capInnerB.z], [lowB.x, curbBaseB, lowB.z]);
        addQuad(curbPositions, curbIndices,
          [capInnerA.x, curbTopA, capInnerA.z], [capOuterA.x, ground(capOuterA) + 0.1 + CURB_RISE, capOuterA.z],
          [capOuterB.x, ground(capOuterB) + 0.1 + CURB_RISE, capOuterB.z], [capInnerB.x, curbTopB, capInnerB.z]);

        // Paved walkway, level with the kerb cap.
        addQuad(sidewalkPositions, sidewalkIndices,
          [walkInnerA.x, sidewalkYInnerA, walkInnerA.z], [walkOuterA.x, sidewalkYOuterA, walkOuterA.z],
          [walkOuterB.x, sidewalkYOuterB, walkOuterB.z], [walkInnerB.x, sidewalkYInnerB, walkInnerB.z],
          sidewalkUvs, [walkInnerA, walkOuterA, walkOuterB, walkInnerB]);
      }
    }
  }

  return {
    sidewalks: makeGeometry(sidewalkPositions, sidewalkIndices, sidewalkUvs),
    curbs: makeGeometry(curbPositions, curbIndices),
  };
}
