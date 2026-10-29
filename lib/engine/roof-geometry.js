import * as THREE from "three";

function polygonArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function geometryFromFaces(faces) {
  const positions = [];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      let a = face[0], b = face[i], c = face[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      if (ab[2] * ac[0] - ab[0] * ac[2] < 0) [b, c] = [c, b];
      positions.push(...a, ...b, ...c);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function principalAxes(ring) {
  const center = ring.reduce((sum, p) => [sum[0] + p[0] / ring.length, sum[1] + p[1] / ring.length], [0, 0]);
  let xx = 0, zz = 0, xz = 0;
  for (const p of ring) {
    const x = p[0] - center[0], z = p[1] - center[1];
    xx += x * x; zz += z * z; xz += x * z;
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  let u = [Math.cos(angle), Math.sin(angle)];
  let v = [-u[1], u[0]];
  const project = (axis, point) => (point[0] - center[0]) * axis[0] + (point[1] - center[1]) * axis[1];
  const extent = (axis) => {
    const values = ring.map((p) => project(axis, p));
    return Math.max(...values) - Math.min(...values);
  };
  if (extent(v) > extent(u)) [u, v] = [v, u];
  const us = ring.map((p) => project(u, p));
  const vs = ring.map((p) => project(v, p));
  return {
    center,
    u,
    v,
    minU: Math.min(...us), maxU: Math.max(...us),
    minV: Math.min(...vs), maxV: Math.max(...vs),
  };
}

function roofPoint(axes, along, across, y) {
  return [
    axes.center[0] + axes.u[0] * along + axes.v[0] * across,
    y,
    axes.center[1] + axes.u[1] * along + axes.v[1] * across,
  ];
}

function axisRoof(ring, roofY, roofHeight, shape) {
  const axes = principalAxes(ring);
  const { minU, maxU, minV, maxV } = axes;
  const width = maxV - minV;
  const length = maxU - minU;
  if (width < 0.1 || length < 0.1) return null;
  const low = (p) => [p[0], roofY, p[1]];
  const faces = [];

  if (shape === "skillion") {
    const vertices = ring.map((p) => {
      const across = (p[0] - axes.center[0]) * axes.v[0] + (p[1] - axes.center[1]) * axes.v[1];
      const t = Math.max(0, Math.min(1, (across - minV) / width));
      return [p[0], roofY + roofHeight * t, p[1]];
    });
    const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    if (polygonArea(ring) < 0) { contour.reverse(); vertices.reverse(); }
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const triangle of triangles) faces.push(triangle.map((index) => vertices[index]));
    return geometryFromFaces(faces);
  }

  const ridgeStart = shape === "pyramidal" ? (minU + maxU) / 2
    : shape === "hipped" ? minU + Math.min(width / 2, length / 2) : minU;
  const ridgeEnd = shape === "pyramidal" ? ridgeStart
    : shape === "hipped" ? maxU - Math.min(width / 2, length / 2) : maxU;
  const ridgeA = roofPoint(axes, ridgeStart, 0, roofY + roofHeight);
  const ridgeB = roofPoint(axes, ridgeEnd, 0, roofY + roofHeight);
  const corners = new Map();
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const targetU = su < 0 ? minU : maxU;
      const targetV = sv < 0 ? minV : maxV;
      let best = ring[0], bestDistance = Infinity;
      for (const p of ring) {
        const du = (p[0] - axes.center[0]) * axes.u[0] + (p[1] - axes.center[1]) * axes.u[1] - targetU;
        const dv = (p[0] - axes.center[0]) * axes.v[0] + (p[1] - axes.center[1]) * axes.v[1] - targetV;
        const distance = du * du + dv * dv;
        if (distance < bestDistance) { best = p; bestDistance = distance; }
      }
      corners.set(`${su}/${sv}`, low(best));
    }
  }

  const leftLow = corners.get("-1/-1"), leftHigh = corners.get("-1/1");
  const rightLow = corners.get("1/-1"), rightHigh = corners.get("1/1");
  faces.push([leftLow, rightLow, ridgeB, ridgeA]);
  faces.push([leftHigh, rightHigh, ridgeB, ridgeA]);
  if (shape === "gabled") {
    faces.push([leftLow, leftHigh, ridgeA]);
    faces.push([rightLow, rightHigh, ridgeB]);
  } else {
    faces.push([leftLow, leftHigh, ridgeA]);
    faces.push([rightLow, rightHigh, ridgeB]);
  }
  return geometryFromFaces(faces);
}

function domeRoof(ring, roofY, roofHeight) {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  // Same layout as geometryFromFaces (non-indexed, position + normal only) so
  // domes merge into one roof batch with gabled/hipped roofs of the same colour.
  const geometry = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  geometry.deleteAttribute("uv");
  geometry.scale((maxX - minX) / 2, roofHeight, (maxZ - minZ) / 2);
  geometry.translate((minX + maxX) / 2, roofY, (minZ + maxZ) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Build one deterministic roof mesh above a building's flat roof cap. */
export function createRoofGeometry(ring, roofY, roofHeight, shape) {
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > 128 || roofHeight <= 0) return null;
  const clean = ring.filter((point, index) => index === 0 ||
    Math.hypot(point[0] - ring[index - 1][0], point[1] - ring[index - 1][1]) > 1e-4);
  if (clean.length > 3 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-4) clean.pop();
  if (clean.length < 3) return null;
  if (shape === "dome") return domeRoof(clean, roofY, roofHeight);
  if (["gabled", "hipped", "pyramidal", "skillion"].includes(shape)) {
    return axisRoof(clean, roofY, roofHeight, shape);
  }
  return null;
}
