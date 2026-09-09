import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Plans are authored in "plan units" (pixels read off the source drawings) with
 * x pointing east and y pointing south. A plan point (x, y) maps to the world
 * position (x, elevation, y) so that looking down the -Y axis reproduces the
 * original drawing orientation.
 */

export function rect(x1, y1, x2, y2) {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

export function arcPts(cx, cy, radius, aStart, aEnd, segments = 16) {
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const a = ((aStart + (aEnd - aStart) * (i / segments)) * Math.PI) / 180;
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

/** Ring segment between two radii — used for the curved tutorial rooms in Block B. */
export function wedge(cx, cy, rInner, rOuter, aStart, aEnd, segments = 6) {
  return poly(
    arcPts(cx, cy, rInner, aStart, aEnd, segments),
    arcPts(cx, cy, rOuter, aEnd, aStart, segments),
  );
}

/** Concatenate point lists / points into one closed contour without duplicates. */
export function poly(...parts) {
  const flat = [];
  for (const part of parts) {
    if (typeof part[0] === 'number') flat.push(part);
    else flat.push(...part);
  }
  const out = [];
  for (const p of flat) {
    const prev = out[out.length - 1];
    if (prev && near(prev, p)) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 2 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

function near(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
}

export function toShape(points) {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** Flat horizontal slab: base at y=0, top face at y=depth. */
export function extrudePlan(points, depth) {
  const geo = new THREE.ExtrudeGeometry(toShape(points), {
    depth,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Outline of a contour as a thin ribbon, used for the 2D-style edge lines. */
export function outlineGeometry(points, closed = true) {
  const verts = [];
  for (const [x, y] of points) verts.push(x, 0, y);
  if (closed && points.length) verts.push(points[0][0], 0, points[0][1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geo;
}

/**
 * Walls centred on each polygon edge. Rooms that share an edge therefore share
 * one wall instead of producing two parallel slivers.
 *
 * `doors` entries are [edgeIndex, tAlongEdge, width?]; each punches an opening
 * and leaves a lintel above it.
 */
export function wallGeometry(points, opts) {
  const {
    height,
    thickness,
    doors = [],
    doorHeight = height * 0.7,
    doorWidth = thickness * 4,
  } = opts;

  const byEdge = new Map();
  for (const [edge, t, w] of doors) {
    if (!byEdge.has(edge)) byEdge.set(edge, []);
    byEdge.get(edge).push({ t, w: w ?? doorWidth });
  }

  const parts = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;

    const rotation = Math.atan2(-dy, dx);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;

    const addBox = (from, to, bottom, top) => {
      const span = to - from;
      if (span < 0.25 || top - bottom < 0.25) return;
      const box = new THREE.BoxGeometry(span, top - bottom, thickness);
      box.translate((from + to) / 2 - len / 2, (bottom + top) / 2, 0);
      box.applyMatrix4(new THREE.Matrix4().makeRotationY(rotation));
      box.translate(midX, 0, midY);
      parts.push(box);
    };

    const openings = (byEdge.get(i) ?? [])
      .map(({ t, w }) => [
        THREE.MathUtils.clamp(t * len - w / 2, 0, len),
        THREE.MathUtils.clamp(t * len + w / 2, 0, len),
      ])
      .filter(([a, b]) => b - a > 0.5)
      .sort((a, b) => a[0] - b[0]);

    let cursor = 0;
    for (const [a, b] of openings) {
      if (a > cursor) addBox(cursor, a, 0, height);
      cursor = Math.max(cursor, b);
      addBox(a, b, doorHeight, height);
    }
    if (cursor < len) addBox(cursor, len, 0, height);
  }

  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** Area-weighted centroid, used to place room labels. */
export function centroid(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}

export function planArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area) / 2;
}
