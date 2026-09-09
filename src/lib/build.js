import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  extrudePlan,
  wallGeometry,
  outlineGeometry,
  centroid,
  planArea,
} from './geometry.js';
import {
  BUILDINGS,
  BRIDGE,
  CATEGORIES,
  classify,
  PLAN_SCALE,
  WALL_HEIGHT,
  FLOOR_HEIGHT,
  SLAB_THICKNESS,
  WALL_THICKNESS,
  DOOR_HEIGHT,
  DOOR_WIDTH,
} from '../data/floorplans.js';

const SLAB_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xe8e6df,
  roughness: 0.95,
  metalness: 0,
});

const EDGE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x1b2a4a,
  transparent: true,
  opacity: 0.45,
});

/**
 * Builds the whole campus model. Returns the root group (already scaled to
 * metres and centred on the origin) plus flat registries for interaction.
 */
export function buildCampus() {
  const root = new THREE.Group();
  const content = new THREE.Group();
  root.add(content);
  root.scale.setScalar(PLAN_SCALE);

  const rooms = [];
  const levels = [];

  for (const building of BUILDINGS) {
    const buildingGroup = new THREE.Group();
    buildingGroup.name = building.name;
    content.add(buildingGroup);

    const [ox, oz] = building.origin;

    building.levels.forEach((level, index) => {
      const group = new THREE.Group();
      group.name = `${building.name} · ${level.name}`;
      group.position.set(ox, building.baseElevation + index * FLOOR_HEIGHT, oz);
      buildingGroup.add(group);

      const record = {
        key: `${building.id}${index + 1}`,
        building,
        level,
        index,
        group,
        restY: group.position.y,
        rooms: [],
      };

      buildSlab(group, level.outline);
      for (const roomDef of level.rooms) {
        const room = buildRoom(group, roomDef, building, level, record.key);
        rooms.push(room);
        record.rooms.push(room);
      }

      levels.push(record);
    });
  }

  const bridge = buildBridge(content);

  // Rank levels by real-world elevation so the exploded view keeps floors that
  // sit at the same height (and the bridge between them) aligned.
  const elevations = [...new Set(levels.map((l) => l.restY))].sort((a, b) => a - b);
  for (const level of levels) level.rank = elevations.indexOf(level.restY);
  bridge.userData.restY = BRIDGE.elevation;
  bridge.userData.rank = elevations.indexOf(BRIDGE.elevation);

  // Centre the model horizontally so orbiting feels natural. The measured box
  // is in world units, so convert back to plan units before offsetting.
  const box = new THREE.Box3().setFromObject(content);
  const centre = box.getCenter(new THREE.Vector3());
  content.position.x -= centre.x / PLAN_SCALE;
  content.position.z -= centre.z / PLAN_SCALE;

  return { root, content, rooms, levels, bridge };
}

function buildSlab(group, outline) {
  const geo = extrudePlan(outline, SLAB_THICKNESS);
  const mesh = new THREE.Mesh(geo, SLAB_MATERIAL);
  mesh.position.y = -SLAB_THICKNESS;
  mesh.receiveShadow = true;
  mesh.userData.pickable = false;
  group.add(mesh);

  const line = new THREE.Line(outlineGeometry(outline), EDGE_MATERIAL);
  line.position.y = 0.6;
  group.add(line);
}

function buildRoom(group, def, building, level, levelKey) {
  const category = def.category ?? classify(def.name);
  const colour = new THREE.Color(CATEGORIES[category].color);
  const points = def.poly;

  const roomGroup = new THREE.Group();
  group.add(roomGroup);

  // Floor plate — this is the click/hover target.
  const floorMat = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: def.open ? 0.55 : 0.85,
  });
  const floor = new THREE.Mesh(extrudePlan(points, 1.2), floorMat);
  floor.position.y = def.open ? 0.1 : 0.5;
  floor.receiveShadow = true;
  roomGroup.add(floor);

  let walls = null;
  if (!def.open) {
    const geo = wallGeometry(points, {
      height: WALL_HEIGHT,
      thickness: WALL_THICKNESS,
      doors: def.doors ?? [],
      doorHeight: DOOR_HEIGHT,
      doorWidth: DOOR_WIDTH,
    });
    if (geo) {
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0xf7f6f2,
        roughness: 0.8,
        metalness: 0,
      });
      walls = new THREE.Mesh(geo, wallMat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      roomGroup.add(walls);
    }
  }

  const [cx, cy] = centroid(points);
  const areaM2 = planArea(points) * PLAN_SCALE * PLAN_SCALE;

  const room = {
    id: `${levelKey}-${slug(def.code ?? def.name)}-${Math.round(cx)}`,
    name: def.name,
    code: def.code ?? null,
    note: def.note ?? null,
    category,
    open: Boolean(def.open),
    area: areaM2,
    points,
    doors: def.doors ?? [],
    building,
    level,
    levelKey,
    group: roomGroup,
    floor,
    walls,
    floorMat,
    baseColour: colour.clone(),
    centre: new THREE.Vector3(cx, 0, cy),
  };

  floor.userData.room = room;
  if (walls) walls.userData.room = room;

  const [lx, ly] = def.labelAt ?? [cx, cy];
  room.labelPoint = new THREE.Vector3(lx, def.open ? 6 : WALL_HEIGHT * 0.55, ly);
  room.label = makeLabel(room);
  room.label.position.copy(room.labelPoint);
  roomGroup.add(room.label);

  return room;
}

function makeLabel(room) {
  const el = document.createElement('div');
  el.className = 'room-label';
  el.dataset.category = room.category;
  el.innerHTML = room.code
    ? `<span class="room-label__name">${room.name}</span><span class="room-label__code">${room.code}</span>`
    : `<span class="room-label__name">${room.name}</span>`;
  const label = new CSS2DObject(el);
  label.center.set(0.5, 0.5);
  return label;
}

function buildBridge(content) {
  const group = new THREE.Group();
  group.position.y = BRIDGE.elevation;
  content.add(group);

  const deck = new THREE.Mesh(extrudePlan(BRIDGE.poly, SLAB_THICKNESS), SLAB_MATERIAL);
  deck.position.y = -SLAB_THICKNESS;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const rails = wallGeometry(BRIDGE.poly, {
    height: 26,
    thickness: 4,
    doors: [
      [1, 0.5, 44],
      [3, 0.5, 44],
    ],
    doorHeight: 26,
    doorWidth: 44,
  });
  if (rails) {
    group.add(
      new THREE.Mesh(
        rails,
        new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.8 }),
      ),
    );
  }
  return group;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export { CATEGORIES };
