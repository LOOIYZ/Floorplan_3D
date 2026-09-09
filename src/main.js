import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildCampus } from './lib/build.js';
import { buildNavGraph } from './lib/graph.js';
import { RouteLayer } from './lib/route3d.js';
import { setupDirections } from './lib/directions.js';
import { CATEGORIES, PLAN_SCALE } from './data/floorplans.js';

const canvas = document.getElementById('scene');
const labelLayer = document.getElementById('labels');

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const labelRenderer = new CSS2DRenderer({ element: labelLayer });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6f5f1);
scene.fog = new THREE.Fog(0xf6f5f1, 190, 560);

const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1200);
camera.position.set(46, 52, 74);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 6;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 3, 0);

// ---------------------------------------------------------------- lighting

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bcc4, 1.55));

const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
sun.position.set(-46, 78, 52);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
const shadowCam = sun.shadow.camera;
shadowCam.left = -70;
shadowCam.right = 70;
shadowCam.top = 60;
shadowCam.bottom = -60;
shadowCam.near = 1;
shadowCam.far = 260;
shadowCam.updateProjectionMatrix();
scene.add(sun);

const fill = new THREE.DirectionalLight(0xdfe7ff, 0.5);
fill.position.set(60, 30, -50);
scene.add(fill);

// ---------------------------------------------------------------- model

const campus = buildCampus();
scene.add(campus.root);

const navGraph = buildNavGraph(campus);
const routeLayer = new RouteLayer(campus.content, campus);

const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.ShadowMaterial({ opacity: 0.14 }),
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

const grid = new THREE.GridHelper(400, 80, 0x1b2a4a, 0x1b2a4a);
grid.material.transparent = true;
grid.material.opacity = 0.05;
scene.add(grid);

// ---------------------------------------------------------------- state

const state = {
  mode: 'explode',
  spread: 0.45,
  activeLevel: campus.levels[1].key,
  hiddenLevels: new Set(),
  hiddenCategories: new Set(),
  labels: true,
  walls: true,
  topDown: false,
  shadows: true,
  selected: null,
  hovered: null,
};

// ---------------------------------------------------------------- camera tween

const tween = {
  active: false,
  t: 0,
  duration: 0.85,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
};

function flyTo(position, target, duration = 0.85) {
  tween.fromPos.copy(camera.position);
  tween.toPos.copy(position);
  tween.fromTarget.copy(controls.target);
  tween.toTarget.copy(target);
  tween.t = 0;
  tween.duration = duration;
  tween.active = true;
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// ---------------------------------------------------------------- layout

function applyLayout() {
  const gap = state.mode === 'explode' ? state.spread * 900 : 0;

  for (const level of campus.levels) {
    level.group.position.y = level.restY + gap * level.rank;
    const visible =
      state.mode === 'single'
        ? level.key === state.activeLevel
        : !state.hiddenLevels.has(level.key);
    level.group.visible = visible;
  }

  campus.bridge.position.y =
    campus.bridge.userData.restY + gap * campus.bridge.userData.rank;
  campus.bridge.visible =
    state.mode === 'single'
      ? state.activeLevel === 'A2' || state.activeLevel === 'B3'
      : !state.hiddenLevels.has('A2') && !state.hiddenLevels.has('B3');

  for (const room of campus.rooms) {
    room.group.visible = !state.hiddenCategories.has(room.category);
    if (room.walls) room.walls.visible = state.walls;
  }

  readable = readableLevels();
  updateShadowCatcher();
  renderLevelList();
  routeLayer.rebuild();
}

function updateShadowCatcher() {
  let lowest = Infinity;
  for (const level of campus.levels) {
    if (!level.group.visible) continue;
    lowest = Math.min(lowest, level.group.position.y);
  }
  if (!Number.isFinite(lowest)) lowest = 0;
  shadowCatcher.position.y = lowest * PLAN_SCALE - 0.06;
  grid.position.y = shadowCatcher.position.y - 0.01;
}

// ---------------------------------------------------------------- framing

const box = new THREE.Box3();
const sphere = new THREE.Sphere();

/** Gets the amount of screen space (in pixels) taken up by the panel. */
function getPanelOcclusion() {
  if (currentTab === 'home') {
    return { left: 0, bottom: 0 };
  }
  const rect = document.querySelector('.panel').getBoundingClientRect();
  if (window.innerWidth <= 768) {
    return { left: 0, bottom: window.innerHeight - rect.top + 10 };
  } else {
    return { left: rect.right + 24, bottom: 0 };
  }
}

function visibleBounds() {
  box.makeEmpty();
  campus.root.updateWorldMatrix(true, true);
  for (const level of campus.levels) {
    if (!level.group.visible) continue;
    box.expandByObject(level.group);
  }
  if (box.isEmpty()) box.expandByObject(campus.root);
  return box;
}

/** Distance at which a sphere of `radius` fits in the usable area. */
function distanceFor(radius) {
  const occ = getPanelOcclusion();
  const usableW = Math.max(260, window.innerWidth - occ.left - 40);
  const usableH = Math.max(260, window.innerHeight - occ.bottom - 40);
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (usableW / usableH));
  return radius / Math.sin(Math.min(fovV, fovH) / 2);
}

/**
 * Nudges camera and target so the model is centred in the usable space.
 */
function offsetForPanel(position, target, dist) {
  const occ = getPanelOcclusion();
  const worldPerPx =
    (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;
  
  const shiftX = (occ.left / 2) * worldPerPx;
  const shiftY = (occ.bottom / 2) * worldPerPx;
  
  const forward = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  position.addScaledVector(right, -shiftX);
  target.addScaledVector(right, -shiftX);
  
  position.addScaledVector(up, -shiftY);
  target.addScaledVector(up, -shiftY);
}

function frameSphere(source, padding, duration) {
  const dist = distanceFor(source.radius * padding);
  const centre = source.center.clone();
  // A pure (0,1,0) direction leaves the orbit azimuth undefined, so keep a
  // sliver of +Z to guarantee north stays at the top of the screen.
  const dir = state.topDown
    ? new THREE.Vector3(0, 1, 0.002).normalize()
    : new THREE.Vector3(0.34, 0.6, 0.72).normalize();
  const position = centre.clone().addScaledVector(dir, dist);
  offsetForPanel(position, centre, dist);
  flyTo(position, centre, duration);
}

function frameAll(duration = 0.9) {
  frameSphere(visibleBounds().getBoundingSphere(sphere), 0.82, duration);
}

/** Frames an arbitrary set of scene-space points, used for routes. */
function framePoints(points, duration = 0.9) {
  if (points.length < 2) return;
  box.makeEmpty();
  for (const point of points) box.expandByPoint(campus.content.localToWorld(point.clone()));
  frameSphere(box.getBoundingSphere(sphere), 0.9, duration);
}

function focusRoom(room) {
  campus.root.updateWorldMatrix(true, true);
  const target = room.group.localToWorld(room.centre.clone());
  const dist = distanceFor(Math.max(Math.sqrt(room.area) * 2.1, 9));
  const dir = state.topDown
    ? new THREE.Vector3(0, 1, 0.002).normalize()
    : new THREE.Vector3(0.28, 0.68, 0.68).normalize();
  const position = target.clone().addScaledVector(dir, dist);
  offsetForPanel(position, target, dist);
  flyTo(position, target, 0.8);
}

// ---------------------------------------------------------------- selection

function paint(room, mode) {
  const mat = room.floorMat;
  if (mode === 'selected') {
    mat.color.copy(room.baseColour).lerp(new THREE.Color(0xffffff), 0.25);
    mat.emissive.copy(room.baseColour).multiplyScalar(0.55);
    mat.opacity = 1;
  } else if (mode === 'hovered') {
    mat.color.copy(room.baseColour).lerp(new THREE.Color(0xffffff), 0.16);
    mat.emissive.copy(room.baseColour).multiplyScalar(0.28);
    mat.opacity = room.open ? 0.75 : 0.95;
  } else {
    mat.color.copy(room.baseColour);
    mat.emissive.setRGB(0, 0, 0);
    mat.opacity = room.open ? 0.55 : 0.85;
  }
  room.label.element.classList.toggle('is-selected', mode === 'selected');
}

function select(room, { fly = false } = {}) {
  if (state.selected && state.selected !== room) paint(state.selected, 'base');
  state.selected = room;
  if (!room) {
    infoCard.hidden = true;
    return;
  }
  paint(room, 'selected');
  showInfo(room);
  if (fly) focusRoom(room);
}

function hover(room) {
  if (state.hovered === room) return;
  if (state.hovered && state.hovered !== state.selected) paint(state.hovered, 'base');
  state.hovered = room;
  if (room && room !== state.selected) paint(room, 'hovered');

  if (room) {
    tooltip.hidden = false;
    tooltip.innerHTML = `${room.name}${room.code ? `<small>${room.code}</small>` : ''}`;
  } else {
    tooltip.hidden = true;
  }
  canvas.style.cursor = room ? 'pointer' : 'grab';
}

// ---------------------------------------------------------------- raycasting

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerInside = false;
let dragged = false;

const pickTargets = campus.rooms.map((room) => room.floor);

function pickAt(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickTargets, false);
  for (const hit of hits) {
    const room = hit.object.userData.room;
    if (room && isRoomReadable(room)) return room;
  }
  return null;
}

function isRoomVisible(room) {
  let node = room.group;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * Levels the user can actually see the inside of. In stacked mode only the top
 * visible level of each block qualifies — everything below is roofed over, so
 * labelling or picking it would be misleading.
 */
function readableLevels() {
  const keys = new Set();
  if (state.mode === 'stack') {
    const top = new Map();
    for (const level of campus.levels) {
      if (!level.group.visible) continue;
      const current = top.get(level.building.id);
      if (!current || level.rank > current.rank) top.set(level.building.id, level);
    }
    for (const level of top.values()) keys.add(level.key);
  } else {
    for (const level of campus.levels) {
      if (level.group.visible) keys.add(level.key);
    }
  }
  return keys;
}

let readable = new Set();

function isRoomReadable(room) {
  return isRoomVisible(room) && readable.has(room.levelKey);
}

canvas.addEventListener('pointermove', (event) => {
  pointerInside = true;
  if (event.buttons !== 0) {
    dragged = true;
    hover(null);
    return;
  }
  const room = pickAt(event);
  hover(room);
  if (room) {
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
  }
});

canvas.addEventListener('pointerdown', () => {
  dragged = false;
});

canvas.addEventListener('pointerleave', () => {
  pointerInside = false;
  hover(null);
});

canvas.addEventListener('click', (event) => {
  if (dragged) return;
  select(pickAt(event));
});

canvas.addEventListener('dblclick', (event) => {
  const room = pickAt(event);
  if (room) select(room, { fly: true });
});

// ---------------------------------------------------------------- UI wiring

const infoCard = document.getElementById('info');
const tooltip = document.getElementById('tooltip');
const levelList = document.getElementById('levels');
const legendList = document.getElementById('legend');
const spreadField = document.getElementById('spread-field');

// ---------------------------------------------------------------- tabs & navigation

const homeScreen = document.getElementById('home-screen');
const mainPanel = document.getElementById('main-panel');
const tabExplore = document.getElementById('tab-explore');
const tabDirections = document.getElementById('tab-directions');
const navBtnExplore = document.getElementById('nav-btn-explore');
const navBtnDirections = document.getElementById('nav-btn-directions');

let currentTab = 'home';

function switchTab(name) {
  currentTab = name;

  if (name === 'home') {
    if (homeScreen) homeScreen.classList.remove('is-hidden');
    if (mainPanel) mainPanel.classList.add('is-hidden');
    if (labelLayer) labelLayer.style.display = 'none';
  } else {
    if (homeScreen) homeScreen.classList.add('is-hidden');
    if (mainPanel) mainPanel.classList.remove('is-hidden');
    if (labelLayer) labelLayer.style.display = state.labels ? '' : 'none';

    if (navBtnExplore) navBtnExplore.classList.toggle('is-active', name === 'explore');
    if (navBtnDirections) navBtnDirections.classList.toggle('is-active', name === 'directions');

    if (tabExplore) tabExplore.hidden = name !== 'explore';
    if (tabDirections) tabDirections.hidden = name !== 'directions';

    // Animate entrance for active panel tab
    const entering = name === 'explore' ? tabExplore : tabDirections;
    if (entering) {
      entering.classList.remove('is-entering');
      void entering.offsetWidth; // force reflow
      entering.classList.add('is-entering');
    }

    // Refocus camera for panel layout
    setTimeout(() => {
      frameAll(0.6);
    }, 50);
  }
}

// Wire Home Mode Cards
document.getElementById('card-go-directions')?.addEventListener('click', () => switchTab('directions'));
document.getElementById('card-go-explore')?.addEventListener('click', () => switchTab('explore'));

// Wire Back to Home buttons
document.getElementById('btn-back-home')?.addEventListener('click', () => switchTab('home'));
document.getElementById('explore-bottom-home')?.addEventListener('click', () => switchTab('home'));

// Wire Subnav Mode Switcher
navBtnExplore?.addEventListener('click', () => switchTab('explore'));
navBtnDirections?.addEventListener('click', () => switchTab('directions'));

function showInfo(room) {
  infoCard.hidden = false;
  document.getElementById('info-where').textContent =
    `${room.building.name} · ${room.level.name}`;
  document.getElementById('info-name').textContent = room.name;
  const codeEl = document.getElementById('info-code');
  codeEl.hidden = !room.code;
  codeEl.textContent = room.code ?? '';
  document.getElementById('info-type').textContent = CATEGORIES[room.category].label;
  document.getElementById('info-area').textContent = `${Math.round(room.area)} m²`;
}

document.getElementById('info-close').addEventListener('click', () => select(null));
document.getElementById('info-focus').addEventListener('click', () => {
  if (state.selected) focusRoom(state.selected);
});

// View mode -------------------------------------------------------

document.getElementById('view-mode').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  setMode(button.dataset.mode);
  applyLayout();
  frameAll();
});

document.getElementById('spread').addEventListener('input', (event) => {
  state.spread = Number(event.target.value) / 100;
  applyLayout();
});

// Level list ------------------------------------------------------

function renderLevelList() {
  levelList.replaceChildren();
  let currentBuilding = null;
  for (const level of campus.levels) {
    if (level.building.id !== currentBuilding) {
      currentBuilding = level.building.id;
      const heading = document.createElement('div');
      heading.className = 'levels__group';
      heading.textContent = level.building.name;
      levelList.append(heading);
    }
    const button = document.createElement('button');
    const on =
      state.mode === 'single'
        ? level.key === state.activeLevel
        : !state.hiddenLevels.has(level.key);
    button.className = on ? 'is-on' : 'is-off';
    button.innerHTML =
      `<span class="swatch"></span>${level.level.name}` +
      `<span class="count">${level.rooms.length} rooms</span>`;
    button.addEventListener('click', () => {
      if (state.mode === 'single') {
        if (level.key === state.activeLevel) return;
        state.activeLevel = level.key;
        applyLayout();
        frameAll(0.6);
        return;
      }
      if (state.hiddenLevels.has(level.key)) state.hiddenLevels.delete(level.key);
      else state.hiddenLevels.add(level.key);
      applyLayout();
    });
    levelList.append(button);
  }
}

// Legend ----------------------------------------------------------

function renderLegend() {
  legendList.replaceChildren();
  const counts = new Map();
  for (const room of campus.rooms) {
    counts.set(room.category, (counts.get(room.category) ?? 0) + 1);
  }
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const li = document.createElement('li');
    li.className = state.hiddenCategories.has(key) ? 'is-off' : '';
    li.innerHTML =
      `<span class="chip" style="background:#${meta.color
        .toString(16)
        .padStart(6, '0')}"></span>` +
      `${meta.label}<span class="count">${counts.get(key) ?? 0}</span>`;
    li.title = 'Click to show or hide';
    li.addEventListener('click', () => {
      if (state.hiddenCategories.has(key)) state.hiddenCategories.delete(key);
      else state.hiddenCategories.add(key);
      renderLegend();
      applyLayout();
    });
    legendList.append(li);
  }
}

// Toggles ---------------------------------------------------------

document.getElementById('toggle-labels').addEventListener('change', (event) => {
  state.labels = event.target.checked;
  labelLayer.style.display = state.labels ? '' : 'none';
});

document.getElementById('toggle-walls').addEventListener('change', (event) => {
  state.walls = event.target.checked;
  applyLayout();
});

document.getElementById('toggle-top').addEventListener('change', (event) => {
  state.topDown = event.target.checked;
  controls.maxPolarAngle = state.topDown ? 0.02 : Math.PI * 0.495;
  controls.minPolarAngle = state.topDown ? 0 : 0;
  frameAll(0.7);
});

document.getElementById('toggle-shadows').addEventListener('change', (event) => {
  state.shadows = event.target.checked;
  renderer.shadowMap.enabled = state.shadows;
  sun.castShadow = state.shadows;
  shadowCatcher.visible = state.shadows;
  scene.traverse((obj) => {
    if (obj.material) obj.material.needsUpdate = true;
  });
});

// Search ----------------------------------------------------------

const searchIndex = campus.rooms.map((room) => ({
  room,
  haystack: `${room.name} ${room.code ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
}));

const homeSearchInput = document.getElementById('home-search');
const homeResultsList = document.getElementById('home-results');

function attachRoomSearch(inputEl, resultsEl, onSelect) {
  if (!inputEl || !resultsEl) return;

  function performSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      resultsEl.hidden = true;
      return;
    }
    const matches = searchIndex
      .filter((entry) => entry.haystack.includes(q))
      .slice(0, 12);

    resultsEl.replaceChildren();
    resultsEl.hidden = false;

    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No rooms found';
      resultsEl.append(li);
      return;
    }

    for (const { room } of matches) {
      const li = document.createElement('li');
      li.innerHTML =
        `<span class="dot" style="background:#${CATEGORIES[room.category].color
          .toString(16)
          .padStart(6, '0')}"></span>` +
        `<span>${room.name}${room.code ? ` (${room.code})` : ''}</span>` +
        `<span class="where">${room.building.name.replace('Block ', '')} · ${room.level.name.replace(
          'Level ',
          'L',
        )}</span>`;
      li.addEventListener('click', () => {
        revealRoom(room);
        resultsEl.hidden = true;
        inputEl.value = room.code ? `${room.name} (${room.code})` : room.name;
        if (onSelect) onSelect(room);
      });
      resultsEl.append(li);
    }
  }

  inputEl.addEventListener('input', (e) => performSearch(e.target.value));
  inputEl.addEventListener('focus', (e) => performSearch(e.target.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      resultsEl.hidden = true;
      inputEl.blur();
    }
    if (e.key === 'Enter') {
      const first = resultsEl.querySelector('li:not(.empty)');
      if (first) first.click();
    }
  });
}

// Attach home search (auto-switches to explore view on select)
attachRoomSearch(homeSearchInput, homeResultsList, () => {
  switchTab('explore');
});

// Attach popular destination chips on Home
document.getElementById('home-chips')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip-btn');
  if (!btn) return;
  const q = btn.dataset.query.toLowerCase();
  const match = searchIndex.find((entry) => entry.haystack.includes(q));
  if (match) {
    revealRoom(match.room);
    switchTab('explore');
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search')) {
    if (homeResultsList) homeResultsList.hidden = true;
  }
});

function setMode(mode) {
  state.mode = mode;
  for (const button of document.querySelectorAll('#view-mode button')) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  }
  spreadField.hidden = mode !== 'explode';
}

function revealRoom(room) {
  state.hiddenCategories.delete(room.category);
  state.hiddenLevels.delete(room.levelKey);
  state.activeLevel = room.levelKey;

  // A room buried under the floors above it can't be seen in stacked mode.
  if (state.mode === 'stack') {
    applyLayout();
    if (!readable.has(room.levelKey)) setMode('single');
  }

  renderLegend();
  applyLayout();
  select(room, { fly: true });
}

window.addEventListener('keydown', (event) => {
  if (event.target.matches('input')) return;
  if (event.key === 'Escape') select(null);
  if (event.key === 'f' || event.key === 'F') frameAll();
});

// ---------------------------------------------------------------- declutter

/**
 * Screen-space declutter: project every room label, then keep the important
 * ones (selected, then largest, then nearest) and drop any that would overlap
 * something already placed or fall behind the panel.
 */
const projected = new THREE.Vector3();
let labelTick = 0;

function updateLabels() {
  if (!state.labels) return;
  if (labelTick++ % 3 !== 0) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const leftEdge = getPanelOcclusion().left;
  const bottomEdge = getPanelOcclusion().bottom;
  const candidates = [];

  for (const room of campus.rooms) {
    if (!isRoomReadable(room)) {
      room.label.visible = false;
      continue;
    }
    projected.copy(room.labelPoint);
    room.group.localToWorld(projected);
    projected.project(camera);
    if (projected.z < -1 || projected.z > 1) {
      room.label.visible = false;
      continue;
    }
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    if (x < leftEdge || x > width - 10 || y < 10 || y > height - bottomEdge - 10) {
      room.label.visible = false;
      continue;
    }
    candidates.push({ room, x, y, depth: projected.z });
  }

  candidates.sort((a, b) => {
    const aSel = a.room === state.selected;
    const bSel = b.room === state.selected;
    if (aSel !== bSel) return aSel ? -1 : 1;
    return b.room.area - a.room.area || a.depth - b.depth;
  });

  // Treat the info card as already occupied so labels never hide behind it.
  const placed = [];
  if (!infoCard.hidden) {
    const card = infoCard.getBoundingClientRect();
    placed.push({
      x0: card.left - 8,
      x1: card.right + 8,
      y0: card.top - 8,
      y1: card.bottom + 8,
    });
  }

  for (const item of candidates) {
    const el = item.room.label.element;
    if (el.offsetWidth) item.room.labelSize = [el.offsetWidth, el.offsetHeight];
    const [w, h] = item.room.labelSize ?? [72, 18];
    const rect = {
      x0: item.x - w / 2 - 3,
      x1: item.x + w / 2 + 3,
      y0: item.y - h / 2 - 2,
      y1: item.y + h / 2 + 2,
    };
    const clashes =
      item.room !== state.selected &&
      placed.some((p) => p.x0 < rect.x1 && p.x1 > rect.x0 && p.y0 < rect.y1 && p.y1 > rect.y0);
    item.room.label.visible = !clashes;
    if (!clashes) placed.push(rect);
  }
}

// ---------------------------------------------------------------- loop

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  routeLayer.setResolution(width, height);
}

window.addEventListener('resize', resize);

let last = performance.now();

function animate() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (tween.active) {
    tween.t = Math.min(1, tween.t + dt / tween.duration);
    const k = easeInOut(tween.t);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween.active = false;
  }

  controls.update();
  updateLabels();
  routeLayer.update(dt);
  renderer.render(scene, camera);
  if (state.labels) labelRenderer.render(scene, camera);

  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------- helpers

/** Y position (in scene units) of the lowest visible floor slab. */
function groundElevation() {
  let lowest = Infinity;
  for (const level of campus.levels) {
    if (!level.group.visible) continue;
    lowest = Math.min(lowest, level.group.position.y);
  }
  if (!Number.isFinite(lowest)) lowest = 0;
  return lowest * PLAN_SCALE;
}

// ---------------------------------------------------------------- directions

const directions = setupDirections({
  campus,
  graph: navGraph,
  routeLayer,
  groundElevation,
  onRouteShown(route, { frame }) {
    // Make all levels used by the route visible.
    const routeLevels = new Set(route.path.map((node) => node.levelKey));
    for (const key of routeLevels) {
      state.hiddenLevels.delete(key);
    }
    // In single mode, switch to the destination level.
    if (state.mode === 'single') {
      const dest = route.path[route.path.length - 1];
      state.activeLevel = dest.levelKey;
    }
    applyLayout();
    if (frame) {
      const points = route.path.map((node) => {
        const level = campus.levels.find((l) => l.key === node.levelKey);
        const y = level ? level.group.position.y + 14 : 14;
        return new THREE.Vector3(node.x, y, node.z);
      });
      framePoints(points, 0.9);
    }
  },
});

document.addEventListener('directions-restarted', () => {
  switchTab('home');
  // Reset visibility of all categories and levels
  state.hiddenCategories.clear();
  state.hiddenLevels.clear();
  setMode('explode'); // Reset to exploded view
  renderLegend();
  applyLayout();
  frameAll();
});

// "Directions to here" button in the info card
document.getElementById('info-directions').addEventListener('click', () => {
  if (!state.selected) return;
  directions.setDestination(state.selected);
  switchTab('directions');
});

// ---------------------------------------------------------------- boot

document.getElementById('fit').addEventListener('click', () => frameAll());
scene.add(sun.target);

resize();
renderLegend();
applyLayout();
frameAll(0.001);
switchTab('home');
animate();

const loading = document.getElementById('loading');
requestAnimationFrame(() => {
  loading.classList.add('is-hidden');
  setTimeout(() => loading.remove(), 500);
});

if (!pointerInside) canvas.style.cursor = 'grab';
