import {
  BUILDINGS,
  PLAN_SCALE,
  FLOOR_HEIGHT,
} from '../data/floorplans.js';
import {
  NAV,
  LINKS,
  VERTICAL_LINKS,
  WALK_SPEED,
  LEVEL_CHANGE_SECONDS,
} from '../data/navigation.js';

/**
 * Builds a walkable graph from the floor plans plus the hand-authored corridor
 * skeleton. Node positions are world plan units; elevation is looked up from
 * the level at render time so the graph survives the exploded view.
 */

/** Extra cost, in plan units, applied per unit of vertical travel. */
const STAIR_CLIMB_COST = 2.4;
const LIFT_CLIMB_COST = 0.4;
const LIFT_WAIT_COST = 260; // ≈ 11 m of walking
const MAX_DOOR_SNAP = 420; // plan units (~17 m)

export function buildNavGraph(campus) {
  const nodes = new Map();
  const adj = new Map();
  const levelsByKey = new Map(campus.levels.map((level) => [level.key, level]));

  const add = (node) => {
    nodes.set(node.id, node);
    adj.set(node.id, []);
    return node;
  };

  const connect = (a, b, cost, meta = {}) => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    adj.get(a).push({ to: b, cost, ...meta });
    adj.get(b).push({ to: a, cost, ...meta });
  };

  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // --- corridor skeleton ----------------------------------------------------

  const byLink = new Map();

  for (const [levelKey, plan] of Object.entries(NAV)) {
    const level = levelsByKey.get(plan.elevationLevel ?? levelKey);
    const [ox, oz] = plan.world || !level ? [0, 0] : level.building.origin;

    for (const [name, [x, y, opts = {}]] of Object.entries(plan.nodes)) {
      const node = add({
        id: `${levelKey}:${name}`,
        x: x + ox,
        z: y + oz,
        levelKey: plan.elevationLevel ?? levelKey,
        planKey: levelKey,
        kind: opts.entrance ? 'entrance' : opts.link ? 'connector' : 'corridor',
        name: opts.entrance ?? name,
        entrance: opts.entrance ?? null,
        link: opts.link ?? null,
        outdoor: Boolean(plan.world),
      });
      if (opts.link) {
        if (!byLink.has(opts.link)) byLink.set(opts.link, []);
        byLink.get(opts.link).push(node);
      }
    }

    for (const [a, b] of plan.edges) {
      const from = nodes.get(`${levelKey}:${a}`);
      const to = nodes.get(`${levelKey}:${b}`);
      connect(from.id, to.id, distance(from, to), { kind: 'walk' });
    }
  }

  // --- vertical connectors --------------------------------------------------

  for (const [linkId, group] of byLink) {
    const meta = VERTICAL_LINKS[linkId] ?? { kind: 'stairs', label: 'the stairs' };
    const ordered = group
      .map((node) => ({ node, elevation: levelsByKey.get(node.levelKey).restY }))
      .sort((a, b) => a.elevation - b.elevation);

    for (let i = 0; i < ordered.length - 1; i++) {
      const lower = ordered[i];
      const upper = ordered[i + 1];
      const rise = upper.elevation - lower.elevation;
      const climb = meta.kind === 'lift' ? LIFT_CLIMB_COST : STAIR_CLIMB_COST;
      const wait = meta.kind === 'lift' ? LIFT_WAIT_COST : 0;
      connect(lower.node.id, upper.node.id, distance(lower.node, upper.node) + rise * climb + wait, {
        kind: meta.kind,
        label: meta.label,
        stepFree: meta.kind === 'lift',
      });
    }
  }

  // --- explicit links (bridge, outdoor) -------------------------------------

  for (const link of LINKS) {
    const a = nodes.get(link.a);
    const b = nodes.get(link.b);
    if (!a || !b) {
      console.warn(`[nav] link references a missing node: ${link.a} → ${link.b}`);
      continue;
    }
    connect(a.id, b.id, distance(a, b), { kind: link.kind, label: link.label, stepFree: true });
  }

  // --- rooms, doors and their connection to the corridors -------------------

  const corridorsByLevel = new Map();
  for (const node of nodes.values()) {
    if (node.kind === 'room' || node.kind === 'door') continue;
    if (!corridorsByLevel.has(node.levelKey)) corridorsByLevel.set(node.levelKey, []);
    corridorsByLevel.get(node.levelKey).push(node);
  }

  const wallsByLevel = new Map();
  for (const level of campus.levels) {
    wallsByLevel.set(
      level.key,
      level.rooms
        .filter((room) => !room.open)
        .map((room) => ({ room, points: worldPoints(room) })),
    );
  }

  const orphans = [];

  for (const room of campus.rooms) {
    const [ox, oz] = room.building.origin;
    const roomNode = add({
      id: `room:${room.id}`,
      x: room.centre.x + ox,
      z: room.centre.z + oz,
      levelKey: room.levelKey,
      planKey: room.levelKey,
      kind: 'room',
      name: room.name,
      room,
    });
    room.navNode = roomNode.id;

    const candidates = corridorsByLevel.get(room.levelKey) ?? [];
    const walls = wallsByLevel.get(room.levelKey) ?? [];
    let joined = 0;

    for (const [index, point] of doorPoints(room).entries()) {
      const door = add({
        id: `door:${room.id}:${index}`,
        x: point[0] + ox,
        z: point[1] + oz,
        levelKey: room.levelKey,
        planKey: room.levelKey,
        kind: 'door',
        name: `${room.name} door`,
        room,
      });
      connect(roomNode.id, door.id, distance(roomNode, door), { kind: 'walk' });

      const target = nearestReachable(door, candidates, walls, room);
      if (target) {
        connect(door.id, target.id, distance(door, target), { kind: 'walk' });
        joined++;
      }
    }

    if (joined === 0) {
      // Open zones and rooms whose doors are all on an outside wall fall back to
      // a straight link from the room centre.
      const target =
        nearestReachable(roomNode, candidates, walls, room, Infinity) ??
        nearest(roomNode, candidates);
      if (target) connect(roomNode.id, target.id, distance(roomNode, target), { kind: 'walk' });
      else orphans.push(room);
    }
  }

  const graph = {
    nodes,
    adj,
    levelsByKey,
    entrances: [...nodes.values()].filter((node) => node.kind === 'entrance'),
    orphans,
  };

  if (import.meta.env?.DEV) audit(graph, campus);
  return graph;
}

// ---------------------------------------------------------------- geometry

function worldPoints(room) {
  const [ox, oz] = room.building.origin;
  return room.points.map(([x, y]) => [x + ox, y + oz]);
}

/** Absolute positions of every door on a room, derived from its wall openings. */
function doorPoints(room) {
  const points = room.points;
  return (room.doors ?? []).map(([edge, t]) => {
    const [x0, y0] = points[edge % points.length];
    const [x1, y1] = points[(edge + 1) % points.length];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  });
}

function nearest(from, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of candidates) {
    const d = Math.hypot(from.x - node.x, from.z - node.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return best;
}

/** Closest corridor node reachable in a straight line without passing through a wall. */
function nearestReachable(from, candidates, walls, ownRoom, maxDistance = MAX_DOOR_SNAP) {
  const sorted = candidates
    .map((node) => ({ node, d: Math.hypot(from.x - node.x, from.z - node.z) }))
    .filter((entry) => entry.d <= maxDistance)
    .sort((a, b) => a.d - b.d);

  for (const { node } of sorted) {
    if (!blocked(from, node, walls, ownRoom)) return node;
  }
  return null;
}

function blocked(from, to, walls, ownRoom) {
  for (const wall of walls) {
    if (wall.room === ownRoom) continue;
    const points = wall.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (segmentsCross(from.x, from.z, to.x, to.z, a[0], a[1], b[0], b[1])) return true;
    }
  }
  return false;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function cross(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// ---------------------------------------------------------------- routing

/**
 * Dijkstra from `startId` to `goalId`.
 * `stepFree` forbids stairs so the route only uses lifts, bridges and ramps.
 */
export function findRoute(graph, startId, goalId, { stepFree = false } = {}) {
  if (startId === goalId) return null;
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) return null;

  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = [{ id: startId, cost: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { id } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === goalId) break;

    for (const edge of graph.adj.get(id) ?? []) {
      if (stepFree && edge.kind === 'stairs') continue;
      if (visited.has(edge.to)) continue;
      const next = dist.get(id) + edge.cost;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, { from: id, edge });
        queue.push({ id: edge.to, cost: next });
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return null;

  const path = [];
  const edges = [];
  let cursor = goalId;
  while (cursor !== startId) {
    const step = prev.get(cursor);
    if (!step) return null;
    path.unshift(graph.nodes.get(cursor));
    edges.unshift(step.edge);
    cursor = step.from;
  }
  path.unshift(graph.nodes.get(startId));

  let metres = 0;
  let levelChanges = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].kind === 'stairs' || edges[i].kind === 'lift') {
      levelChanges++;
      continue;
    }
    metres += Math.hypot(path[i].x - path[i + 1].x, path[i].z - path[i + 1].z) * PLAN_SCALE;
  }

  return {
    path,
    edges,
    metres,
    levelChanges,
    seconds: metres / WALK_SPEED + levelChanges * LEVEL_CHANGE_SECONDS,
  };
}

// ---------------------------------------------------------------- directions

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Plan coordinates run x east, y south, so -y is north. */
function bearing(from, to) {
  return (Math.atan2(to.x - from.x, from.z - to.z) * 180) / Math.PI;
}

function normalise(angle) {
  return ((angle + 540) % 360) - 180;
}

function compass(angle) {
  return COMPASS[Math.round(((angle % 360) + 360) % 360 / 45) % 8];
}

function turnPhrase(delta) {
  const a = Math.abs(delta);
  if (a < 25) return null;
  const side = delta > 0 ? 'right' : 'left';
  if (a > 150) return 'turn around';
  if (a > 115) return `turn sharply ${side}`;
  if (a > 55) return `turn ${side}`;
  return `bear ${side}`;
}

/** Converts a route into readable steps, one per turn or level change. */
export function describeRoute(route, { startLabel, endLabel }) {
  const { path, edges } = route;
  const steps = [];
  let run = 0;
  let heading = null;
  let pending = `Start at ${startLabel}`;

  const flush = (extra) => {
    if (run > 0.8) {
      const metres = Math.round(run);
      steps.push({
        icon: 'walk',
        text: `${pending}${pending.endsWith(',') ? '' : ','} head ${compass(heading)} for ${metres} m.`,
      });
    } else if (pending && pending !== 'Continue') {
      steps.push({ icon: 'walk', text: `${pending}.` });
    }
    run = 0;
    pending = extra ?? 'Continue';
  };

  for (let i = 0; i < edges.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    const edge = edges[i];

    if (edge.kind === 'stairs' || edge.kind === 'lift') {
      flush();
      const fromLevel = levelLabel(from);
      const toLevel = levelLabel(to);
      const up = to.levelKey !== from.levelKey && levelRank(to) > levelRank(from);
      steps.push({
        icon: edge.kind,
        text: `Take ${edge.label ?? (edge.kind === 'lift' ? 'the lift' : 'the stairs')} ${
          up ? 'up' : 'down'
        } from ${fromLevel} to ${toLevel}.`,
      });
      heading = null;
      pending = 'Leaving the ' + (edge.kind === 'lift' ? 'lift' : 'stairs') + ',';
      continue;
    }

    if (edge.kind === 'bridge') {
      flush();
      steps.push({ icon: 'bridge', text: `Cross ${edge.label ?? 'the bridge'}.` });
      heading = null;
      pending = 'On the other side,';
      continue;
    }

    const segmentBearing = bearing(from, to);
    const length = Math.hypot(to.x - from.x, to.z - from.z) * PLAN_SCALE;

    if (heading === null) {
      heading = segmentBearing;
      run = length;
      continue;
    }

    const turn = turnPhrase(normalise(segmentBearing - heading));
    if (turn) {
      flush(`${turn[0].toUpperCase()}${turn.slice(1)},`);
      heading = segmentBearing;
      run = length;
    } else {
      run += length;
    }
  }

  flush();
  if (steps.length && steps[steps.length - 1].text.startsWith('Continue')) steps.pop();
  steps.push({ icon: 'flag', text: `Arrive at ${endLabel}.` });
  return steps;
}

function levelLabel(node) {
  const building = BUILDINGS.find((b) => b.id === node.levelKey[0]);
  const index = Number(node.levelKey[1]);
  return `${building?.name ?? 'Block'} level ${index}`;
}

function levelRank(node) {
  const building = BUILDINGS.find((b) => b.id === node.levelKey[0]);
  const index = Number(node.levelKey[1]) - 1;
  return (building?.baseElevation ?? 0) + index * FLOOR_HEIGHT;
}

// ---------------------------------------------------------------- dev audit

function audit(graph, campus) {
  if (graph.orphans.length) {
    console.warn(
      '[nav] rooms with no connection to the walkable network:',
      graph.orphans.map((room) => `${room.levelKey} ${room.name}`),
    );
  }

  // Reachability from the first entrance.
  const start = graph.entrances[0];
  if (!start) return;
  const seen = new Set([start.id]);
  const stack = [start.id];
  while (stack.length) {
    const id = stack.pop();
    for (const edge of graph.adj.get(id) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  const unreachable = campus.rooms.filter((room) => !seen.has(`room:${room.id}`));
  if (unreachable.length) {
    console.warn(
      '[nav] rooms unreachable from an entrance:',
      unreachable.map((room) => `${room.levelKey} ${room.name}`),
    );
  }
}
