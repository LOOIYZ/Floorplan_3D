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
  BRIDGES,
  CATEGORIES,
  classify,
  PLAN_SCALE,
  WALL_HEIGHT,
  FLOOR_HEIGHT,
  SLAB_THICKNESS,
  WALL_THICKNESS,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  getRoomPhoto,
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

  // Rank levels by real-world elevation so the exploded view keeps floors that
  // sit at the same height (and the bridge between them) aligned.
  const elevations = [...new Set(levels.map((l) => l.restY))].sort((a, b) => a - b);
  for (const level of levels) level.rank = elevations.indexOf(level.restY);

  const upperDef = BRIDGES[0] || BRIDGE;
  const upperBridge = buildBridge(content, upperDef);
  upperBridge.userData.restY = upperDef.elevation;
  upperBridge.userData.rank = elevations.indexOf(upperDef.elevation) >= 0 ? elevations.indexOf(upperDef.elevation) : 2;
  upperBridge.userData.levels = upperDef.levels || ['A2', 'B3'];

  const groundBridge = buildGroundBridge(content);

  // Centre the model horizontally so orbiting feels natural. The measured box
  // is in world units, so convert back to plan units before offsetting.
  const box = new THREE.Box3().setFromObject(content);
  const centre = box.getCenter(new THREE.Vector3());
  content.position.x -= centre.x / PLAN_SCALE;
  content.position.z -= centre.z / PLAN_SCALE;

  return { root, content, rooms, levels, bridge: upperBridge, bridges: [upperBridge], groundBridge };
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
  const colour = new THREE.Color(def.color ?? CATEGORIES[category].color);
  const points = def.poly;

  const roomGroup = new THREE.Group();
  group.add(roomGroup);

  // Floor plate — this is the click/hover target.
  const floorMat = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: def.opacity ?? (def.open ? 0.65 : 0.85),
  });
  const floor = new THREE.Mesh(extrudePlan(points, 1.2), floorMat);
  floor.position.y = def.elevation ?? (def.open ? 0.1 : 0.5);
  floor.receiveShadow = true;
  roomGroup.add(floor);

  if (def.trees && Array.isArray(def.trees)) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.7 });
    for (const [tx, ty] of def.trees) {
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, 0, ty);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 7, 8), trunkMat);
      trunk.position.y = 3.5;
      trunk.castShadow = true;
      treeGroup.add(trunk);
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(5.5, 10, 8), foliageMat);
      foliage.position.y = 9;
      foliage.scale.set(1, 1.15, 1);
      foliage.castShadow = true;
      treeGroup.add(foliage);
      roomGroup.add(treeGroup);
    }
  }

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
    photo: def.photo ?? getRoomPhoto(def),
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

  const isStair = /stair|tangga/i.test(room.name);
  const isLift = /lift|elevator/i.test(room.name);
  if (isStair) el.classList.add('is-stair');
  if (isLift) el.classList.add('is-lift');

  const iconHtml = isStair
    ? '<span class="room-label__icon" aria-hidden="true">🪜</span> '
    : isLift
    ? '<span class="room-label__icon" aria-hidden="true">🛗</span> '
    : '';

  el.innerHTML = room.code
    ? `<span class="room-label__name">${iconHtml}${room.name}</span><span class="room-label__code">${room.code}</span>`
    : `<span class="room-label__name">${iconHtml}${room.name}</span>`;
  const label = new CSS2DObject(el);
  label.center.set(0.5, 0.5);
  return label;
}

function buildBridge(content, bridgeDef) {
  const bDef = bridgeDef || BRIDGE;
  const group = new THREE.Group();
  group.name = bDef.name;
  group.position.y = bDef.elevation;
  content.add(group);

  const deck = new THREE.Mesh(extrudePlan(bDef.poly, SLAB_THICKNESS), SLAB_MATERIAL);
  deck.position.y = -SLAB_THICKNESS;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const rails = wallGeometry(bDef.poly, {
    height: 26,
    thickness: 4,
    doors: [
      [1, 0.5, 45],
      [3, 0.5, 45],
    ],
    doorHeight: 26,
    doorWidth: 45,
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

function buildGroundBridge(content) {
  const group = new THREE.Group();
  group.name = 'Bridge · Block A Level 1 ↔ Block B Level 1';
  content.add(group);

  const deckMaterial = SLAB_MATERIAL;
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8d5cc,
    roughness: 0.8,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8c5bc,
    roughness: 0.7,
  });

  const deckGeom = new THREE.BufferGeometry();
  const deckMesh = new THREE.Mesh(deckGeom, deckMaterial);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  group.add(deckMesh);

  const railsGeom = new THREE.BufferGeometry();
  const railsMesh = new THREE.Mesh(railsGeom, railMaterial);
  railsMesh.castShadow = true;
  railsMesh.receiveShadow = true;
  group.add(railsMesh);

  const roofGeom = new THREE.BufferGeometry();
  const roofMesh = new THREE.Mesh(roofGeom, roofMaterial);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  const x0 = -40, z0 = 420;
  const x1 = 80,  z1 = 560;
  const x2 = 80,  z2 = 605;
  const x3 = -40, z3 = 463;
  const T = 4;
  const H = 26;
  const W = 3.5;
  const Hroof = 36;

  function update(yA, yB) {
    // Deck
    const p0 = [x0, yB, z0];
    const p1 = [x1, yA, z1];
    const p2 = [x2, yA, z2];
    const p3 = [x3, yB, z3];

    const p4 = [x0, yB - T, z0];
    const p5 = [x1, yA - T, z1];
    const p6 = [x2, yA - T, z2];
    const p7 = [x3, yB - T, z3];

    const deckVerts = [
      // Top
      ...p0, ...p1, ...p2,  ...p0, ...p2, ...p3,
      // Bottom
      ...p4, ...p6, ...p5,  ...p4, ...p7, ...p6,
      // North
      ...p0, ...p4, ...p5,  ...p0, ...p5, ...p1,
      // South
      ...p3, ...p2, ...p6,  ...p3, ...p6, ...p7,
    ];

    deckGeom.setAttribute('position', new THREE.Float32BufferAttribute(deckVerts, 3));
    deckGeom.computeVertexNormals();
    deckGeom.computeBoundingBox();
    deckGeom.computeBoundingSphere();

    // Rails
    const dxN = x1 - x0, dzN = z1 - z0;
    const lenN = Math.hypot(dxN, dzN);
    const nxN = (-dzN / lenN) * W, nzN = (dxN / lenN) * W;

    const dxS = x3 - x2, dzS = z3 - z2;
    const lenS = Math.hypot(dxS, dzS);
    const nxS = (dzS / lenS) * W, nzS = (-dxS / lenS) * W;

    const n0 = p0;
    const n1 = p1;
    const n2 = [x1, yA + H, z1];
    const n3 = [x0, yB + H, z0];
    const n4 = [x0 + nxN, yB, z0 + nzN];
    const n5 = [x1 + nxN, yA, z1 + nzN];
    const n6 = [x1 + nxN, yA + H, z1 + nzN];
    const n7 = [x0 + nxN, yB + H, z0 + nzN];

    const s0 = p3;
    const s1 = p2;
    const s2 = [x2, yA + H, z2];
    const s3 = [x3, yB + H, z3];
    const s4 = [x3 + nxS, yB, z3 + nzS];
    const s5 = [x2 + nxS, yA, z2 + nzS];
    const s6 = [x2 + nxS, yA + H, z2 + nzS];
    const s7 = [x3 + nxS, yB + H, z3 + nzS];

    const railVerts = [
      // North rail inner
      ...n0, ...n1, ...n2,  ...n0, ...n2, ...n3,
      // North rail outer
      ...n5, ...n4, ...n7,  ...n5, ...n7, ...n6,
      // North rail top
      ...n3, ...n2, ...n6,  ...n3, ...n6, ...n7,
      // North rail end B
      ...n4, ...n0, ...n3,  ...n4, ...n3, ...n7,
      // North rail end A
      ...n1, ...n5, ...n6,  ...n1, ...n6, ...n2,

      // South rail inner
      ...s1, ...s0, ...s3,  ...s1, ...s3, ...s2,
      // South rail outer
      ...s4, ...s5, ...s6,  ...s4, ...s6, ...s7,
      // South rail top
      ...s3, ...s7, ...s6,  ...s3, ...s6, ...s2,
      // South rail end B
      ...s0, ...s4, ...s7,  ...s0, ...s7, ...s3,
      // South rail end A
      ...s5, ...s1, ...s2,  ...s5, ...s2, ...s6,
    ];

    railsGeom.setAttribute('position', new THREE.Float32BufferAttribute(railVerts, 3));
    railsGeom.computeVertexNormals();
    railsGeom.computeBoundingBox();
    railsGeom.computeBoundingSphere();

    // Canopy Roof
    const r0 = [x0, yB + Hroof, z0];
    const r1 = [x1, yA + Hroof, z1];
    const r2 = [x2, yA + Hroof, z2];
    const r3 = [x3, yB + Hroof, z3];
    const r4 = [x0, yB + Hroof - 2, z0];
    const r5 = [x1, yA + Hroof - 2, z1];
    const r6 = [x2, yA + Hroof - 2, z2];
    const r7 = [x3, yB + Hroof - 2, z3];

    const roofVerts = [
      // Top
      ...r0, ...r1, ...r2,  ...r0, ...r2, ...r3,
      // Bottom
      ...r4, ...r6, ...r5,  ...r4, ...r7, ...r6,
      // North
      ...r0, ...r4, ...r5,  ...r0, ...r5, ...r1,
      // South
      ...r3, ...r2, ...r6,  ...r3, ...r6, ...r7,
    ];

    roofGeom.setAttribute('position', new THREE.Float32BufferAttribute(roofVerts, 3));
    roofGeom.computeVertexNormals();
    roofGeom.computeBoundingBox();
    roofGeom.computeBoundingSphere();
  }

  // Initialize at standard stack positions
  update(0, -96);

  return {
    group,
    update,
    userData: {
      levels: ['A1', 'B1'],
    },
  };
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export { CATEGORIES };
