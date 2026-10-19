import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildCampus } from './lib/build.js';
import { buildNavGraph } from './lib/graph.js';
import { RouteLayer } from './lib/route3d.js';
import { setupDirections } from './lib/directions.js';
import { CATEGORIES, PLAN_SCALE, getRoomPhoto } from './data/floorplans.js';
import { createFacilityReportManager } from './lib/facilityReports.js';

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
scene.background = new THREE.Color(0xf8f9fa);
scene.fog = new THREE.Fog(0xf8f9fa, 190, 560);

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

const grid = new THREE.GridHelper(400, 80, 0x152238, 0x152238);
grid.material.transparent = true;
grid.material.opacity = 0.05;
scene.add(grid);

// ---------------------------------------------------------------- state

const state = {
  mode: 'explode',
  spread: 0.45,
  activeLevel: campus.levels[1].key,
  activeLevels: new Set(campus.levels.map((l) => l.key)),
  hiddenLevels: new Set(),
  selectedCategories: new Set(),
  labels: true,
  walls: true,
  topDown: false,
  shadows: true,
  selected: null,
  hovered: null,
  focusedStep: null,
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

let currentTab = 'home';

// ---------------------------------------------------------------- layout

function applyLayout() {
  const gap = state.mode === 'explode' ? state.spread * 900 : 0;

  // When actively viewing a route in directions mode, isolate the route's passing floors!
  const isRouting =
    currentTab === 'directions' &&
    state.routeLevelKeys instanceof Set &&
    state.routeLevelKeys.size > 0;

  // If a specific route step is currently focused, isolate its floor(s) so upper floors never block the view!
  let stepVisibleLevels = null;
  if (isRouting && state.focusedStep) {
    const s = state.focusedStep;
    stepVisibleLevels = new Set([s.levelKey]);
    if (s.toLevelKey) stepVisibleLevels.add(s.toLevelKey);
  }

  for (const level of campus.levels) {
    level.group.position.y = level.restY + gap * level.rank;
    const visible = isRouting
      ? (stepVisibleLevels ? stepVisibleLevels.has(level.key) : state.routeLevelKeys.has(level.key))
      : state.mode === 'single'
      ? level.key === state.activeLevel
      : !state.hiddenLevels.has(level.key);
    level.group.visible = visible;
  }

  const bridges = campus.bridges || (campus.bridge ? [campus.bridge] : []);
  for (const b of bridges) {
    b.position.y = b.userData.restY + gap * b.userData.rank;
    const [l1, l2] = b.userData.levels || ['A2', 'B3'];
    const bridgeVisible = isRouting
      ? (stepVisibleLevels ? stepVisibleLevels.has(l1) && stepVisibleLevels.has(l2) : state.routeLevelKeys.has(l1) && state.routeLevelKeys.has(l2))
      : state.mode === 'single'
      ? state.activeLevel === l1 || state.activeLevel === l2
      : !state.hiddenLevels.has(l1) && !state.hiddenLevels.has(l2);
    b.visible = bridgeVisible;
  }

  const levelA1 = campus.levels.find((l) => l.key === 'A1');
  const levelB1 = campus.levels.find((l) => l.key === 'B1');
  if (campus.groundBridge && levelA1 && levelB1) {
    const yA = levelA1.group.position.y;
    const yB = levelB1.group.position.y;
    campus.groundBridge.update(yA, yB);
    const visible = isRouting
      ? (stepVisibleLevels ? stepVisibleLevels.has('A1') && stepVisibleLevels.has('B1') : state.routeLevelKeys.has('A1') && state.routeLevelKeys.has('B1'))
      : state.mode === 'single'
      ? state.activeLevel === 'A1' || state.activeLevel === 'B1'
      : !state.hiddenLevels.has('A1') && !state.hiddenLevels.has('B1');
    campus.groundBridge.group.visible = visible;
  }

  const isCatFiltered = state.selectedCategories.size > 0;
  for (const room of campus.rooms) {
    const isCatVisible =
      !isCatFiltered ||
      state.selectedCategories.has(room.category) ||
      (state.selected && state.selected.code === room.code);
    room.group.visible = isCatVisible;
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
  const hasVisible = Number.isFinite(lowest) && lowest !== Infinity;
  shadowCatcher.visible = hasVisible;
  if (!hasVisible) lowest = 0;
  shadowCatcher.position.y = lowest * PLAN_SCALE - 0.06;
  grid.position.y = shadowCatcher.position.y - 0.01;
}

// ---------------------------------------------------------------- framing

const box = new THREE.Box3();
const sphere = new THREE.Sphere();

/** Gets screen space (px) occupied by the panel and info card. */
function getPanelOcclusion() {
  if (currentTab === 'home') {
    return { left: 0, right: 0, bottom: 0 };
  }

  let left = 0;
  let right = 0;
  let bottom = 0;

  const panelEl = document.querySelector('.panel');
  if (panelEl && !panelEl.classList.contains('is-collapsed') && !panelEl.classList.contains('is-hidden') && !panelEl.hidden) {
    const rect = panelEl.getBoundingClientRect();
    if (window.innerWidth <= 768) {
      bottom = Math.max(0, window.innerHeight - rect.top + 10);
    } else {
      left = Math.max(0, rect.right + 20);
    }
  }

  // Account for floating room info card on bottom-right
  const infoEl = document.getElementById('info');
  if (infoEl && !infoEl.hidden) {
    const infoRect = infoEl.getBoundingClientRect();
    if (window.innerWidth <= 768) {
      bottom = Math.max(bottom, window.innerHeight - infoRect.top + 12);
    } else {
      right = Math.max(0, window.innerWidth - infoRect.left + 20);
      bottom = Math.max(bottom, window.innerHeight - infoRect.top + 12);
    }
  }

  return { left, right, bottom };
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

/** Distance at which a sphere of `radius` fits comfortably. */
function distanceFor(radius) {
  const occ = getPanelOcclusion();
  const usableW = Math.max(260, window.innerWidth - occ.left - occ.right - 40);
  const usableH = Math.max(260, window.innerHeight - occ.bottom - 40);
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (usableW / usableH));
  return radius / Math.sin(Math.min(fovV, fovH) / 2);
}

function offsetForPanel(position, target, dist) {
  const occ = getPanelOcclusion();
  const worldPerPx =
    (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;

  // Center horizontally between the left panel and right info card/HUD
  const shiftX = ((occ.left - occ.right) / 2) * worldPerPx;
  // Gentle vertical offset so bottom UI doesn't clip the target room
  const shiftY = (window.innerWidth <= 768 ? occ.bottom / 1.8 : occ.bottom / 2.5) * worldPerPx;

  const forward = target.clone().sub(position).normalize();
  let right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
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

function framePoints(points, duration = 0.9) {
  if (points.length < 2) return;
  box.makeEmpty();
  for (const point of points) box.expandByPoint(campus.content.localToWorld(point.clone()));
  frameSphere(box.getBoundingSphere(sphere), 0.9, duration);
}

function focusRoom(room, { direct = true } = {}) {
  campus.root.updateWorldMatrix(true, true);

  // 1. Get true 3D bounding box of the room (floor + walls) in world space
  const roomBox = new THREE.Box3();
  if (room.floor) roomBox.setFromObject(room.floor);
  if (room.walls) roomBox.expandByObject(room.walls);

  const target = roomBox.isEmpty()
    ? room.group.localToWorld(room.centre.clone())
    : roomBox.getCenter(new THREE.Vector3());

  const size = roomBox.isEmpty()
    ? new THREE.Vector3(Math.sqrt(room.area || 36), 3, Math.sqrt(room.area || 36))
    : roomBox.getSize(new THREE.Vector3());

  // 2. Compute camera distance tailored for direct viewing:
  // Fills a comfortable 40%-50% of screen height/width so the room is large, clear, and perfectly framed
  const maxHorizDim = Math.max(size.x, size.z, Math.sqrt(room.area || 25) * 1.05, 8);
  const roomRadius = Math.max(maxHorizDim * 1.05 + 3, 10);
  const dist = distanceFor(roomRadius);

  // 3. Camera angle:
  // - If top-down mode: straight down (90°)
  // - If 3D mode: elevated direct viewing angle (~63° pitch) looking directly into the room
  //   so walls never block the room floor and the user doesn't need to manually adjust the view!
  const dir = state.topDown
    ? new THREE.Vector3(0, 1, 0.002).normalize()
    : new THREE.Vector3(0.20, 0.88, 0.42).normalize();

  const position = target.clone().addScaledVector(dir, dist);
  offsetForPanel(position, target, dist);
  flyTo(position, target, 0.85);
}

function frameRooms(rooms, duration = 0.85) {
  if (!rooms || rooms.length === 0) return;
  if (rooms.length === 1) {
    focusRoom(rooms[0]);
    return;
  }
  campus.root.updateWorldMatrix(true, true);
  box.makeEmpty();
  for (const r of rooms) {
    const target = r.group.localToWorld(r.centre.clone());
    box.expandByPoint(target);
  }
  box.getBoundingSphere(sphere);
  sphere.radius = Math.max(sphere.radius * 1.6, 18);
  frameSphere(sphere, 0.9, duration);
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

  // If selecting a different room or deselecting, restore labels
  if (state.focusOnlyRooms && (!room || !state.focusOnlyRooms.has(room))) {
    state.focusOnlyRooms = null;
    for (const r of campus.rooms) {
      r.label.element?.classList.remove('is-highlighted', 'is-selected');
      paint(r, 'base');
    }
  }

  state.selected = room;
  if (!room) {
    infoCard.hidden = true;
    for (const r of campus.rooms) {
      r.label.element?.classList.remove('is-highlighted', 'is-selected');
      paint(r, 'base');
    }
    updateLabels();
    return;
  }
  state.activeLevel = room.levelKey;
  if (room.levelKey && state.activeLevels) {
    state.activeLevels.add(room.levelKey);
  }
  paint(room, 'selected');
  showInfo(room);
  if (fly) focusRoom(room);
  renderLevelList();
  updateLabels();
}

function restoreNormalMode() {
  select(null);
  state.focusOnlyRooms = null;
  infoCard.classList.remove('is-minimized');
  infoCard.hidden = true;
  for (const r of campus.rooms) {
    paint(r, 'base');
    r.label.element?.classList.remove('is-highlighted', 'is-selected');
  }

  // If actively viewing a route in directions mode, preserve the route and its isolated floors!
  if (currentTab === 'directions' && state.routeLevelKeys && state.routeLevelKeys.size > 0) {
    updateLabels();
    return;
  }

  if (isMobile() && mainPanel) {
    mainPanel.classList.remove('is-collapsed');
  }

  // Restore default exploded view with all floors active
  setMode('explode');
  state.hiddenLevels.clear();
  state.activeLevels = new Set(campus.levels.map((l) => l.key));
  applyLayout();
  renderLevelList();
  renderLegend();
  updateLabels();
  frameAll(0.85);
}

function hover(room) {
  if (state.hovered === room) return;
  if (state.hovered && state.hovered !== state.selected) paint(state.hovered, 'base');
  state.hovered = room;
  if (room && room !== state.selected) paint(room, 'hovered');

  if (room) {
    tooltip.hidden = false;
    tooltip.innerHTML = `${escapeHtml(room.name)}${room.code ? `<small>${escapeHtml(room.code)}</small>` : ''}`;
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
  const picked = pickAt(event);
  if (picked) {
    select(picked);
  } else {
    // If viewing route in directions mode, tapping blank space collapses panel on mobile but preserves route floor isolation
    if (currentTab === 'directions' && state.routeLevelKeys && state.routeLevelKeys.size > 0) {
      select(null);
      if (isMobile()) collapsePanel();
      return;
    }
    // Clicked on blank space: restore default exploded mode with all floors active
    if (state.selected || state.focusOnlyRooms || state.mode === 'single') {
      restoreNormalMode();
    } else {
      select(null);
    }
  }
});

canvas.addEventListener('dblclick', (event) => {
  const room = pickAt(event);
  if (room) select(room, { fly: true });
});

// ---------------------------------------------------------------- UI wiring

const infoCard = document.getElementById('info');
const tooltip = document.getElementById('tooltip');
const toastEl = document.getElementById('toast');
const levelList = document.getElementById('levels');
const legendList = document.getElementById('legend');
const spreadField = document.getElementById('spread-field');
const spreadVal = document.getElementById('spread-val');
const viewportHud = document.getElementById('viewport-hud');
const compassNeedle = document.getElementById('compass-needle');
const compassBtn = document.getElementById('compass-btn');

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(regex, '<span class="highlight">$1</span>');
}

// ---------------------------------------------------------------- tabs & navigation

const homeScreen = document.getElementById('home-screen');
const mainPanel = document.getElementById('main-panel');
const tabExplore = document.getElementById('tab-explore');
const tabDirections = document.getElementById('tab-directions');
const navBtnExplore = document.getElementById('nav-btn-explore');
const navBtnDirections = document.getElementById('nav-btn-directions');

currentTab = 'home';

function switchTab(name, { refocus = true, autoExpand = true } = {}) {
  currentTab = name;

  if (name === 'home') {
    if (homeScreen) homeScreen.classList.remove('is-hidden');
    if (mainPanel) mainPanel.classList.add('is-hidden');
    if (viewportHud) viewportHud.hidden = true;
    if (labelLayer) labelLayer.style.display = 'none';
    if (panelReopenFab) panelReopenFab.hidden = true;
    if (isMobile()) collapsePanel();

    // Hide direction route when returning to home
    routeLayer.setVisible(false);

    // Reset focused destination labels and active selection when returning to home
    select(null);
    state.focusOnlyRooms = null;
    for (const r of campus.rooms) {
      r.label.element?.classList.remove('is-highlighted', 'is-selected');
      paint(r, 'base');
    }
  } else {
    if (homeScreen) homeScreen.classList.add('is-hidden');
    if (mainPanel) {
      mainPanel.classList.remove('is-hidden');
      mainPanel.classList.remove('is-collapsed');
    }
    if (panelReopenFab) panelReopenFab.hidden = true;
    if (viewportHud) viewportHud.hidden = false;
    if (labelLayer) labelLayer.style.display = state.labels ? '' : 'none';

    if (autoExpand && isMobile()) {
      setTimeout(expandPanel, 60);
    }

    if (navBtnExplore) {
      navBtnExplore.classList.toggle('is-active', name === 'explore');
      navBtnExplore.setAttribute('aria-selected', name === 'explore');
    }
    if (navBtnDirections) {
      navBtnDirections.classList.toggle('is-active', name === 'directions');
      navBtnDirections.setAttribute('aria-selected', name === 'directions');
    }

    if (tabExplore) tabExplore.hidden = name !== 'explore';
    if (tabDirections) tabDirections.hidden = name !== 'directions';

    // Animate entrance for active panel tab
    const entering = name === 'explore' ? tabExplore : tabDirections;
    if (entering) {
      entering.classList.remove('is-entering');
      void entering.offsetWidth; // force reflow
      entering.classList.add('is-entering');
    }

    // Hide direction route and reset route floor isolation when user toggles to Explore / View Floorplan
    if (name === 'explore') {
      routeLayer.setVisible(false);
      state.routeEndpoints = null;
      if (state.routeLevelKeys) {
        state.routeLevelKeys = null;
        state.hiddenLevels.clear();
        state.activeLevels = new Set(campus.levels.map((l) => l.key));
        applyLayout();
        renderLevelList();
        updateLabels();
      }
    } else if (name === 'directions') {
      routeLayer.setVisible(true);
      if (directions.hasRoute()) {
        directions.refresh();
      }
    }

    // Refocus camera for panel layout if requested (skip if directions already framed a route)
    if (refocus && (name !== 'directions' || !directions.hasRoute())) {
      setTimeout(() => {
        frameAll(0.6);
      }, 50);
    }
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

// ---------------------------------------------------------------- mobile guide welcome popup
const guidePopupModal = document.getElementById('guide-popup-modal');
const guidePopupClose = document.getElementById('guide-popup-close');
const guidePopupBackdrop = document.getElementById('guide-popup-backdrop');
const guidePopupCta = document.getElementById('guide-popup-cta');
const mobileGuideOpenBtn = document.getElementById('mobile-guide-open-btn');

function openGuidePopup() {
  if (!guidePopupModal) return;
  guidePopupModal.hidden = false;
  guidePopupModal.classList.remove('is-leaving');
}

function closeGuidePopup() {
  if (!guidePopupModal || guidePopupModal.hidden) return;
  guidePopupModal.classList.add('is-leaving');
  setTimeout(() => {
    guidePopupModal.hidden = true;
    guidePopupModal.classList.remove('is-leaving');
  }, 260);
  try {
    sessionStorage.setItem('guide_popup_seen', '1');
  } catch (e) {}
}

guidePopupClose?.addEventListener('click', closeGuidePopup);
guidePopupBackdrop?.addEventListener('click', closeGuidePopup);
guidePopupCta?.addEventListener('click', closeGuidePopup);
mobileGuideOpenBtn?.addEventListener('click', openGuidePopup);

// Escape key to dismiss guide popup
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && guidePopupModal && !guidePopupModal.hidden) {
    closeGuidePopup();
  }
});

// For phone mode: user should see the popup message for the person, then see the main page
function checkMobileGuidePopup() {
  if (isMobile()) {
    try {
      const alreadySeen = sessionStorage.getItem('guide_popup_seen');
      if (!alreadySeen) {
        openGuidePopup();
      }
    } catch (e) {
      openGuidePopup();
    }
  }
}

// Trigger initial check for phone mode
checkMobileGuidePopup();

// ---------------------------------------------------------------- widget expand / collapse (desktop & mobile)

const panelHandle = document.getElementById('panel-handle');
const panelCollapseBtn = document.getElementById('panel-collapse-btn');
const panelReopenFab = document.getElementById('panel-reopen-fab');

function isMobile() {
  return window.innerWidth <= 768;
}

// Mobile bottom-sheet: expand to show content
function expandPanel() {
  if (!mainPanel) return;
  mainPanel.classList.add('is-expanded');
  if (panelHandle) panelHandle.setAttribute('aria-expanded', 'true');
  if (panelCollapseBtn) {
    panelCollapseBtn.setAttribute('aria-expanded', 'true');
    panelCollapseBtn.setAttribute('title', 'Collapse menu');
    panelCollapseBtn.setAttribute('aria-label', 'Collapse menu');
  }
}

// Mobile bottom-sheet: collapse to bottom bar
function collapsePanel() {
  if (!mainPanel) return;
  mainPanel.classList.remove('is-expanded');
  if (panelHandle) panelHandle.setAttribute('aria-expanded', 'false');
  if (panelCollapseBtn) {
    panelCollapseBtn.setAttribute('aria-expanded', 'false');
    panelCollapseBtn.setAttribute('title', 'Expand menu');
    panelCollapseBtn.setAttribute('aria-label', 'Expand menu');
  }
}

// Mobile bottom-sheet: toggle between full drawer and compact bottom bar
function togglePanel() {
  if (!mainPanel) return;
  if (mainPanel.classList.contains('is-expanded')) {
    collapsePanel();
  } else {
    expandPanel();
  }
}

// Desktop sidebar: collapse out of view to the left
function collapseWidget() {
  if (!mainPanel) return;
  mainPanel.classList.add('is-collapsed');
  if (panelCollapseBtn) {
    panelCollapseBtn.setAttribute('aria-expanded', 'false');
    panelCollapseBtn.setAttribute('title', 'Show controls');
    panelCollapseBtn.setAttribute('aria-label', 'Show controls');
  }
  // Reveal floating reopen pill
  if (panelReopenFab) {
    setTimeout(() => {
      panelReopenFab.hidden = false;
      panelReopenFab.classList.remove('is-entering');
      void panelReopenFab.offsetWidth;
      panelReopenFab.classList.add('is-entering');
    }, 150);
  }
}

// Desktop sidebar: reopen sidebar and frame camera
function expandWidget() {
  if (!mainPanel) return;
  mainPanel.classList.remove('is-collapsed');
  if (panelCollapseBtn) {
    panelCollapseBtn.setAttribute('aria-expanded', 'true');
    panelCollapseBtn.setAttribute('title', 'Collapse panel (Shortcut: [)');
    panelCollapseBtn.setAttribute('aria-label', 'Collapse panel');
  }
  if (panelReopenFab) {
    panelReopenFab.hidden = true;
    panelReopenFab.classList.remove('is-entering');
  }
  setTimeout(() => {
    frameAll(0.5);
  }, 250);
}

// Universal toggle button handler (adapts automatically to phone or computer mode)
function toggleWidget() {
  if (!mainPanel) return;
  if (isMobile()) {
    togglePanel();
  } else {
    if (mainPanel.classList.contains('is-collapsed')) {
      expandWidget();
    } else {
      collapseWidget();
    }
  }
}

// Wire the collapse/expand button in the panel header
panelCollapseBtn?.addEventListener('click', toggleWidget);

// Wire the floating FAB to reopen the widget
panelReopenFab?.addEventListener('click', () => {
  if (isMobile()) {
    mainPanel.classList.remove('is-collapsed');
    panelReopenFab.hidden = true;
    expandPanel();
  } else {
    expandWidget();
  }
});

// Tap the mobile pill handle to expand or collapse
panelHandle?.addEventListener('click', togglePanel);

// Touch swipe gesture on mobile handle bar / panel header to slide up/down
let touchStartY = 0;
let touchStartTime = 0;
const panelHead = document.getElementById('panel-head');

[panelHandle, panelHead].forEach((el) => {
  el?.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  el?.addEventListener('touchend', (e) => {
    if (!isMobile()) return;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartY;
    const deltaTime = Date.now() - touchStartTime;

    // Swipe down: collapse if expanded
    if (deltaY > 40 && deltaTime < 400) {
      collapsePanel();
    }
    // Swipe up: expand if collapsed
    else if (deltaY < -40 && deltaTime < 400) {
      expandPanel();
    }
  }, { passive: true });
});

// Desktop keyboard shortcut: press '[' or Ctrl+B to toggle the panel
window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement?.tagName.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
  if (currentTab === 'home') return;

  if (e.key === '[' || (e.ctrlKey && e.key === 'b') || (e.metaKey && e.key === 'b')) {
    e.preventDefault();
    toggleWidget();
  }
});

// Mobile: collapse sheet when user taps anywhere on the 3D canvas
const appContainer = document.getElementById('app');
appContainer?.addEventListener('touchstart', (e) => {
  if (!isMobile() || !mainPanel || !mainPanel.classList.contains('is-expanded')) return;
  if (mainPanel.contains(e.target)) return;
  if (viewportHud && viewportHud.contains(e.target)) return;
  if (panelReopenFab && panelReopenFab.contains(e.target)) return;
  collapsePanel();
}, { passive: true });

// ---------------------------------------------------------------- viewport HUD controls

// North Compass: smoothly reset camera azimuth to face North
compassBtn?.addEventListener('click', () => {
  const radius = camera.position.distanceTo(controls.target);
  const polar = Math.max(0.15, controls.getPolarAngle());
  const target = controls.target.clone();
  const dir = state.topDown
    ? new THREE.Vector3(0, 1, 0.002).normalize()
    : new THREE.Vector3(0, Math.cos(polar), Math.sin(polar)).normalize();
  const position = target.clone().addScaledVector(dir, radius);
  offsetForPanel(position, target, radius);
  flyTo(position, target, 0.7);
});

// Camera Presets & HUD Quick Controls
const hudLabelsBtn = document.getElementById('preset-labels');
hudLabelsBtn?.addEventListener('click', () => {
  state.labels = !state.labels;
  const toggleLabels = document.getElementById('toggle-labels');
  if (toggleLabels) toggleLabels.checked = state.labels;
  hudLabelsBtn.classList.toggle('is-active', state.labels);
  labelLayer.style.display = state.labels ? '' : 'none';
  updateLabels();
});

document.getElementById('preset-iso')?.addEventListener('click', () => {
  state.topDown = false;
  const toggleTop = document.getElementById('toggle-top');
  if (toggleTop) toggleTop.checked = false;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minPolarAngle = 0;
  frameAll(0.7);
});

document.getElementById('preset-top')?.addEventListener('click', () => {
  state.topDown = true;
  const toggleTop = document.getElementById('toggle-top');
  if (toggleTop) toggleTop.checked = true;
  controls.maxPolarAngle = 0.02;
  controls.minPolarAngle = 0;
  frameAll(0.7);
});

document.getElementById('preset-fit')?.addEventListener('click', () => {
  if (currentTab === 'directions' && state.routeLevelKeys && directions?.hasRoute()) {
    directions.refresh();
  } else {
    restoreNormalMode();
  }
});

// ---------------------------------------------------------------- facility reporting & maintenance

const facilityManager = createFacilityReportManager({
  campus,
  onSelectRoom: (room) => {
    focusSingleDestination(room);
  },
  showToast,
});

// ---------------------------------------------------------------- room info card

function showInfo(room) {
  infoCard.hidden = false;
  infoCard.classList.remove('is-minimized');
  if (isMobile() && mainPanel) {
    mainPanel.classList.add('is-collapsed');
  }
  document.getElementById('info-where').textContent =
    `${room.building.name} · ${room.level.name}`;
  document.getElementById('info-name').textContent = room.name;

  const codeEl = document.getElementById('info-code');
  codeEl.hidden = !room.code;
  codeEl.textContent = room.code ?? '';

  const badgeEl = document.getElementById('info-badge');
  if (badgeEl) badgeEl.textContent = CATEGORIES[room.category]?.label ?? 'Room';

  document.getElementById('info-type').textContent = CATEGORIES[room.category].label;

  // Active Broken Facility Issue Alert
  const issueAlert = document.getElementById('info-issue-alert');
  const issueReports = facilityManager ? facilityManager.getReportsForRoom(room) : [];
  if (issueAlert) {
    if (issueReports.length > 0) {
      const activeRep = issueReports.find((r) => r.status !== 'Resolved') || issueReports[0];
      const titleEl = document.getElementById('info-issue-title');
      const descEl = document.getElementById('info-issue-desc');
      if (titleEl) {
        titleEl.textContent = `${issueReports.length} Facility Issue${issueReports.length > 1 ? 's' : ''} Reported`;
      }
      if (descEl) {
        descEl.textContent = `${activeRep.facilityIcon || '⚠️'} ${activeRep.facilityType} · ${activeRep.status}`;
      }
      issueAlert.hidden = false;
      const viewBtn = document.getElementById('info-issue-view-btn');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          facilityManager.openReportsListModal(room);
        };
      }
    } else {
      issueAlert.hidden = true;
    }
  }

  // Photo Reference Preview
  const photoUrl = room.photo ?? getRoomPhoto(room);
  const photoCard = document.getElementById('info-photo-card');
  const photoImg = document.getElementById('info-photo');
  const photoBadge = document.getElementById('info-photo-badge');

  if (photoCard && photoImg) {
    if (photoUrl) {
      photoImg.src = photoUrl;
      photoImg.alt = `${room.name} Photo Reference`;
      photoCard.hidden = false;
      if (photoBadge) {
        photoBadge.innerHTML = '<span class="photo-badge-icon">✓</span> Verified Photo';
        photoBadge.classList.add('is-verified');
      }
    } else {
      photoCard.hidden = true;
    }
  }
}

// Photo Lightbox modal handlers
function openPhotoLightbox(room) {
  if (!room) return;
  const photoUrl = room.photo ?? getRoomPhoto(room);
  if (!photoUrl) return;

  const modal = document.getElementById('photo-lightbox');
  const imgEl = document.getElementById('photo-lightbox-img');
  const titleEl = document.getElementById('photo-lightbox-title');
  const subtitleEl = document.getElementById('photo-lightbox-subtitle');
  const badgeEl = document.getElementById('photo-lightbox-badge');

  if (!modal || !imgEl) return;

  imgEl.src = photoUrl;
  imgEl.alt = `${room.name} Photo Reference`;
  if (titleEl) {
    titleEl.textContent = room.code ? `${room.name} (${room.code})` : room.name;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `${room.building.name} · ${room.level.name} · ${CATEGORIES[room.category]?.label ?? 'Room'}`;
  }
  if (badgeEl) {
    badgeEl.textContent = '✓ Verified Location Photo';
    badgeEl.classList.add('is-verified');
  }

  modal.hidden = false;
}

function closePhotoLightbox() {
  const modal = document.getElementById('photo-lightbox');
  if (modal) modal.hidden = true;
}

document.getElementById('info-photo-wrap')?.addEventListener('click', () => {
  if (state.selected) openPhotoLightbox(state.selected);
});
document.getElementById('info-photo-wrap')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (state.selected) openPhotoLightbox(state.selected);
  }
});
document.getElementById('photo-lightbox-close')?.addEventListener('click', closePhotoLightbox);
document.getElementById('photo-lightbox-backdrop')?.addEventListener('click', closePhotoLightbox);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePhotoLightbox();
  }
});

document.getElementById('info-handle')?.addEventListener('click', () => {
  infoCard.classList.toggle('is-minimized');
  if (state.selected) {
    setTimeout(() => {
      focusRoom(state.selected, { direct: true });
    }, 150);
  }
});

document.getElementById('info-close')?.addEventListener('click', () => {
  restoreNormalMode();
});
document.getElementById('info-focus')?.addEventListener('click', () => {
  if (state.selected) focusRoom(state.selected);
});

// "Report Broken Facility" button on Info Card
document.getElementById('info-report-btn')?.addEventListener('click', () => {
  if (state.selected) {
    facilityManager.openReportModal(state.selected);
  } else {
    facilityManager.openReportModal();
  }
});

// "Report Broken Facility" card on Home Screen
document.getElementById('card-go-report')?.addEventListener('click', () => {
  facilityManager.openReportModal(state.selected || null);
});

// "Found a Broken Facility" CTA in Explore tab
document.getElementById('explore-btn-report')?.addEventListener('click', () => {
  facilityManager.openReportModal(state.selected || null);
});

// Viewport HUD Reports Log button
document.getElementById('btn-hud-reports')?.addEventListener('click', () => {
  facilityManager.openReportsListModal();
});

// Share room location via link
document.getElementById('info-share')?.addEventListener('click', () => {
  if (!state.selected) return;
  const code = state.selected.code || state.selected.name;
  const url = new URL(window.location.href);
  url.hash = `room=${encodeURIComponent(code)}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url.toString()).then(() => {
      showToast('✓ Link copied to clipboard!');
    }).catch(() => {
      showToast(`Location: ${code}`);
    });
  } else {
    showToast(`Location: ${code}`);
  }
});

// View mode -------------------------------------------------------

document.getElementById('view-mode')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  const newMode = button.dataset.mode;
  if (newMode === 'explode' && state.mode === 'single') {
    // When returning to exploded view, re-activate levels that are not explicitly hidden
    for (const l of campus.levels) {
      if (!state.hiddenLevels.has(l.key)) {
        state.activeLevels.add(l.key);
      }
    }
  }
  setMode(newMode);
  applyLayout();
  frameAll();
});

document.getElementById('spread')?.addEventListener('input', (event) => {
  const val = Number(event.target.value);
  state.spread = val / 100;
  if (spreadVal) spreadVal.textContent = `${val}%`;
  applyLayout();
});

// Level list ------------------------------------------------------

function renderLevelList() {
  levelList.replaceChildren();
  let currentBuilding = null;
  for (const level of campus.levels) {
    if (level.building.id !== currentBuilding) {
      currentBuilding = level.building.id;
      const bId = level.building.id;
      const buildingLevels = campus.levels.filter((l) => l.building.id === bId);
      const allBuildingActive = buildingLevels.every(
        (l) => state.activeLevels?.has(l.key) && !state.hiddenLevels?.has(l.key)
      );

      const heading = document.createElement('div');
      heading.className = 'levels__group';
      heading.innerHTML =
        `<span>${escapeHtml(level.building.name)}</span>` +
        `<button type="button" class="levels__group-toggle" title="Toggle all floors for ${escapeHtml(level.building.name)}">` +
        `${allBuildingActive ? 'Deactivate All' : 'Activate All'}` +
        `</button>`;

      heading.querySelector('.levels__group-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allBuildingActive) {
          // Deactivate all floors in this building and hide their 3D models
          for (const l of buildingLevels) {
            state.activeLevels.delete(l.key);
            state.hiddenLevels.add(l.key);
          }
          if (buildingLevels.some((l) => l.key === state.activeLevel)) {
            state.activeLevel = Array.from(state.activeLevels)[0] || null;
          }
        } else {
          // Activate all floors in this building and show their 3D models
          for (const l of buildingLevels) {
            state.activeLevels.add(l.key);
            state.hiddenLevels.delete(l.key);
          }
          if (!state.activeLevel || !state.activeLevels.has(state.activeLevel)) {
            state.activeLevel = buildingLevels[0].key;
          }
        }
        applyLayout();
        updateLabels();
      });

      levelList.append(heading);
    }
    const button = document.createElement('button');
    const isLevelActive =
      state.mode === 'single'
        ? level.key === state.activeLevel
        : state.activeLevels.has(level.key) && !state.hiddenLevels.has(level.key);

    button.className = isLevelActive ? 'is-on is-target' : 'is-off';
    button.innerHTML =
      `<span class="swatch"></span>` +
      `<span class="levels__name">${escapeHtml(level.level.name)}</span>` +
      (isLevelActive ? `<span class="levels__active-pill">Active</span>` : '') +
      `<span class="count">${level.rooms.length} rooms</span>`;
    button.addEventListener('click', () => {
      if (state.mode === 'single') {
        if (level.key === state.activeLevel) return;
        state.activeLevel = level.key;
        state.activeLevels.clear();
        state.activeLevels.add(level.key);
        state.hiddenLevels.delete(level.key);
        applyLayout();
        frameAll(0.6);
        return;
      }
      // Toggle this level active or inactive (and show or hide 3D floor)
      const currentlyActive = state.activeLevels.has(level.key) && !state.hiddenLevels.has(level.key);
      if (currentlyActive) {
        // Deactivate this level and hide its 3D floor
        state.activeLevels.delete(level.key);
        state.hiddenLevels.add(level.key);
        if (state.activeLevel === level.key) {
          state.activeLevel = Array.from(state.activeLevels)[0] || null;
        }
      } else {
        // Activate this level and show its 3D floor
        state.hiddenLevels.delete(level.key);
        state.activeLevels.add(level.key);
        state.activeLevel = level.key;
      }
      applyLayout();
      updateLabels();
    });
    levelList.append(button);
  }

  // Sync Animated Toggle Switch state for Activate / Deactivate All
  const toggleLevels = document.getElementById('toggle-levels-all');
  const toggleStatus = document.getElementById('toggle-levels-all-status');
  const toggleWrapper = document.getElementById('toggle-levels-all-label');
  if (toggleLevels) {
    const totalLevels = campus.levels.length;
    const activeCount = campus.levels.filter(
      (l) => state.activeLevels.has(l.key) && !state.hiddenLevels.has(l.key)
    ).length;
    const hasAnyActive = activeCount > 0;
    const isAllActive = activeCount === totalLevels;

    toggleLevels.checked = hasAnyActive;
    if (toggleStatus) {
      if (isAllActive) {
        toggleStatus.textContent = 'All Active';
      } else if (hasAnyActive) {
        toggleStatus.textContent = `${activeCount} Active`;
      } else {
        toggleStatus.textContent = 'Inactive';
      }
    }
    if (toggleWrapper) {
      toggleWrapper.classList.toggle('is-active', hasAnyActive);
    }
  }
}

// Legend ----------------------------------------------------------

function renderLegend() {
  legendList.replaceChildren();
  const counts = new Map();
  for (const room of campus.rooms) {
    counts.set(room.category, (counts.get(room.category) ?? 0) + 1);
  }
  const isFiltered = state.selectedCategories.size > 0;
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const li = document.createElement('li');
    const isSelected = isFiltered && state.selectedCategories.has(key);
    li.className = isFiltered ? (isSelected ? 'is-active' : 'is-off') : '';
    li.innerHTML =
      `<span class="chip" style="background:#${meta.color
        .toString(16)
        .padStart(6, '0')}"></span>` +
      `${escapeHtml(meta.label)}<span class="count">${counts.get(key) ?? 0}</span>`;
    li.title = isSelected
      ? `Click to deselect ${meta.label}`
      : `Click to show only ${meta.label}`;
    li.addEventListener('click', () => {
      if (state.selectedCategories.size === 0) {
        // Click to show: isolate to this category
        state.selectedCategories.add(key);
      } else if (state.selectedCategories.has(key)) {
        // Toggle off if already selected
        state.selectedCategories.delete(key);
      } else {
        // Add to selected visible categories
        state.selectedCategories.add(key);
      }
      // If all categories are selected, return to default (show all)
      if (state.selectedCategories.size === Object.keys(CATEGORIES).length) {
        state.selectedCategories.clear();
      }
      renderLegend();
      applyLayout();
      updateLabels();
    });
    legendList.append(li);
  }

  // Update Show All button state
  const showAllBtn = document.getElementById('btn-show-all-categories');
  if (showAllBtn) {
    showAllBtn.disabled = !isFiltered;
    showAllBtn.classList.toggle('is-disabled', !isFiltered);
  }
}

// Show All Categories button
document.getElementById('btn-show-all-categories')?.addEventListener('click', () => {
  state.selectedCategories.clear();
  renderLegend();
  applyLayout();
  updateLabels();
});

// Animated Toggle Switch to Activate / Deactivate All Floors for Whole Building
document.getElementById('toggle-levels-all')?.addEventListener('change', (event) => {
  const activate = event.target.checked;
  if (!activate) {
    // Deactivate all floors: hide all 3D floors
    state.activeLevels.clear();
    state.activeLevel = null;
    for (const l of campus.levels) {
      state.hiddenLevels.add(l.key);
    }
  } else {
    // Activate ALL the floors for whole building: show all 3D floors
    for (const l of campus.levels) {
      state.activeLevels.add(l.key);
      state.hiddenLevels.delete(l.key);
    }
    state.activeLevel = campus.levels[1].key;
  }
  applyLayout();
  updateLabels();
});

// Toggles ---------------------------------------------------------

document.getElementById('toggle-labels')?.addEventListener('change', (event) => {
  state.labels = event.target.checked;
  hudLabelsBtn?.classList.toggle('is-active', state.labels);
  labelLayer.style.display = state.labels ? '' : 'none';
  updateLabels();
});

document.getElementById('toggle-walls')?.addEventListener('change', (event) => {
  state.walls = event.target.checked;
  applyLayout();
});

document.getElementById('toggle-top')?.addEventListener('change', (event) => {
  state.topDown = event.target.checked;
  controls.maxPolarAngle = state.topDown ? 0.02 : Math.PI * 0.495;
  controls.minPolarAngle = state.topDown ? 0 : 0;
  frameAll(0.7);
});

document.getElementById('toggle-shadows')?.addEventListener('change', (event) => {
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
  haystack: `${room.name} ${room.code ?? ''} ${room.note ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
}));

const homeSearchInput = document.getElementById('home-search');
const homeResultsList = document.getElementById('home-results');
const homeSearchClear = document.getElementById('home-search-clear');

function attachRoomSearch(inputEl, resultsEl, onSelect, clearBtnEl) {
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
      li.innerHTML =
        `<span class="empty-icon">🔍</span>` +
        `<span>No rooms matching "<strong>${escapeHtml(q)}</strong>"</span>` +
        `<span style="font-size:11px;opacity:0.8;">Try searching for MM2, Surau, or CCNA</span>`;
      resultsEl.append(li);
      return;
    }

    for (const { room } of matches) {
      const li = document.createElement('li');
      const dotColor = (CATEGORIES[room.category]?.color ?? 0x152238).toString(16).padStart(6, '0');
      const highlightedName = highlightMatch(room.name, q);
      const codeHtml = room.code ? `<span class="code-pill">${escapeHtml(room.code)}</span>` : '';
      const photoUrl = room.photo ?? getRoomPhoto(room);
      const thumbHtml = photoUrl
        ? `<div class="results__thumb"><img src="${photoUrl}" alt="" loading="lazy" /></div>`
        : `<span class="dot" style="background:#${dotColor}"></span>`;

      li.innerHTML =
        thumbHtml +
        `<span class="name">${highlightedName}</span>` +
        codeHtml +
        `<span class="where">${room.building.name.replace('Block ', '')} · ${room.level.name.replace('Level ', 'L')}</span>`;

      li.addEventListener('click', () => {
        resultsEl.hidden = true;
        inputEl.value = room.code ? `${room.name} (${room.code})` : room.name;
        if (clearBtnEl) clearBtnEl.hidden = false;
        if (onSelect) {
          onSelect(room);
        } else {
          highlightDestination(room.code || room.name);
        }
      });
      resultsEl.append(li);
    }
  }

  inputEl.addEventListener('input', (e) => {
    performSearch(e.target.value);
    if (clearBtnEl) clearBtnEl.hidden = !e.target.value;
  });
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

  if (clearBtnEl) {
    clearBtnEl.addEventListener('click', () => {
      inputEl.value = '';
      inputEl.focus();
      resultsEl.hidden = true;
      clearBtnEl.hidden = true;
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!inputEl.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.hidden = true;
    }
  });
}

// Attach home search (auto-switches to explore view on select & highlights location)
attachRoomSearch(homeSearchInput, homeResultsList, (room) => {
  focusSingleDestination(room);
}, homeSearchClear);

// Attach view floorplan tab search
const exploreSearchInput = document.getElementById('explore-search');
const exploreResultsList = document.getElementById('explore-results');
const exploreSearchClear = document.getElementById('explore-search-clear');

attachRoomSearch(exploreSearchInput, exploreResultsList, (room) => {
  focusSingleDestination(room);
}, exploreSearchClear);

// Destination Disambiguation Modal (when multiple rooms share the same front name/category)
function openDestinationPicker(title, rooms) {
  const modal = document.getElementById('destination-picker-modal');
  const titleEl = document.getElementById('destination-picker-title');
  const subtitleEl = document.getElementById('destination-picker-subtitle');
  const listEl = document.getElementById('destination-picker-list');
  if (!modal || !listEl) return;

  if (titleEl) titleEl.textContent = `Select ${title}`;
  if (subtitleEl) subtitleEl.textContent = `${rooms.length} locations found. Choose which one to view:`;
  listEl.replaceChildren();

  for (const r of rooms) {
    const li = document.createElement('li');
    const dotColor = (CATEGORIES[r.category]?.color ?? 0x2563eb).toString(16).padStart(6, '0');
    const codePill = r.code ? `<span class="code-pill">${escapeHtml(r.code)}</span>` : '';
    const photoUrl = r.photo ?? getRoomPhoto(r);
    const thumbHtml = photoUrl
      ? `<div class="destination-picker-item__thumb"><img src="${photoUrl}" alt="" loading="lazy"/></div>`
      : `<div class="destination-picker-item__thumb destination-picker-item__thumb--fallback"><span class="dot" style="background:#${dotColor};width:8px;height:8px;border-radius:50%;display:inline-block;"></span></div>`;

    li.innerHTML = `
      <button class="destination-picker-item" type="button">
        ${thumbHtml}
        <div class="destination-picker-item__info">
          <div class="destination-picker-item__name">
            ${escapeHtml(r.name)} ${codePill}
          </div>
          <div class="destination-picker-item__meta">${escapeHtml(r.building.name)} · ${escapeHtml(r.level.name)}</div>
        </div>
        <span class="destination-picker-item__arrow">→</span>
      </button>
    `;
    li.querySelector('button')?.addEventListener('click', () => {
      closeDestinationPicker();
      focusSingleDestination(r);
    });
    listEl.append(li);
  }

  modal.hidden = false;
}

function closeDestinationPicker() {
  const modal = document.getElementById('destination-picker-modal');
  if (modal) modal.hidden = true;
}

document.getElementById('destination-picker-close')?.addEventListener('click', closeDestinationPicker);
document.getElementById('destination-picker-backdrop')?.addEventListener('click', closeDestinationPicker);

/**
 * Focus and highlight ONLY one single destination room.
 * All other rooms (even if sharing the same front name) WILL DISAPPEAR!
 */
function focusSingleDestination(targetRoom) {
  if (!targetRoom) return;

  // 1. Collapse all other labels: ONLY this specific destination room will show!
  // Any other room with the same front name (e.g. Surau Mens when Surau Ladies is chosen) WILL DISAPPEAR!
  state.focusOnlyRooms = new Set([targetRoom]);

  // 2. Ensure labels layer is visible and active
  state.labels = true;
  const toggleLabels = document.getElementById('toggle-labels');
  if (toggleLabels) toggleLabels.checked = true;
  labelLayer.style.display = '';

  // 3. Switch to explore view without resetting camera or expanding mobile sheet
  switchTab('explore', { refocus: false, autoExpand: false });
  if (isMobile()) {
    collapsePanel();
  }

  // 4. Ensure target level is isolated in Single Floor mode so upper/lower levels don't block
  state.hiddenLevels.clear();
  state.activeLevel = targetRoom.levelKey;
  if (state.activeLevels instanceof Set) {
    state.activeLevels.clear();
    state.activeLevels.add(targetRoom.levelKey);
  }
  setMode('single');

  // 5. Highlight ONLY this specific room in 3D scene & its label; clean all other labels
  for (const r of campus.rooms) {
    if (r === targetRoom) {
      paint(r, 'selected');
      r.label.element?.classList.add('is-highlighted');
    } else {
      paint(r, 'base');
      r.label.element?.classList.remove('is-highlighted', 'is-selected');
    }
  }

  // 6. Select the target room and show Info Card
  state.selected = targetRoom;
  showInfo(targetRoom);

  // 7. Update UI
  renderLevelList();
  renderLegend();
  applyLayout();
  updateLabels();

  // 8. Direct camera smoothly to directly show this place
  setTimeout(() => {
    focusRoom(targetRoom, { direct: true });
  }, 40);
}

function highlightDestination(query, labelTitle = '') {
  if (typeof query === 'object' && query.name) {
    focusSingleDestination(query);
    return;
  }

  const q = String(query).toLowerCase().trim();

  // Exact room name or code match first
  const exactMatch = campus.rooms.find(
    (r) => (r.code && r.code.toLowerCase() === q) || r.name.toLowerCase() === q
  );
  if (exactMatch) {
    focusSingleDestination(exactMatch);
    return;
  }

  // Find all rooms matching this query
  const matchingRooms = campus.rooms.filter((room) => {
    const haystack = `${room.name} ${room.code ?? ''} ${room.note ?? ''} ${room.category} ${room.building.name} ${room.level.name}`.toLowerCase();
    return haystack.includes(q);
  });

  if (!matchingRooms.length) return;

  if (matchingRooms.length === 1) {
    focusSingleDestination(matchingRooms[0]);
    return;
  }

  // If there is more than one place that has the same front name (e.g. Surau Ladies vs Surau Mens, or Makmal Mikro 1..8):
  // Show the destination picker modal so user selects exactly which one they want!
  openDestinationPicker(labelTitle || query, matchingRooms);
}

// Attach popular destination chips on Home: direct highlight location & collapse other labels
document.getElementById('home-chips')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip-btn');
  if (!btn) return;
  const q = btn.dataset.query;
  const title = btn.textContent.trim();
  if (q) {
    highlightDestination(q, title);
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search')) {
    if (homeResultsList) homeResultsList.hidden = true;
  }
});

// Global keyboard shortcut: Ctrl+K / Cmd+K focuses search
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (currentTab === 'home') {
      homeSearchInput?.focus();
      homeSearchInput?.select();
    } else {
      const input = currentTab === 'directions'
        ? (document.getElementById('dest') || document.getElementById('origin'))
        : homeSearchInput;
      input?.focus();
      input?.select();
    }
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
  if (state.activeLevels instanceof Set) {
    state.activeLevels.add(room.levelKey);
  }

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
  if (event.key === 'Escape') {
    if (state.selected || state.focusOnlyRooms || state.mode === 'single') {
      restoreNormalMode();
    } else {
      select(null);
    }
  }
  if (event.key === 'f' || event.key === 'F') frameAll();
});

// ---------------------------------------------------------------- declutter

const CATEGORY_PRIORITY = {
  teaching: 60, // Dewan Kuliah, Bilik Kuliah, Seminar
  lab: 50,      // Makmal Mikro, CCNA
  social: 40,   // The Cube, Lounge
  office: 30,   // Lecturer's Room, Office
  amenity: 20,  // Surau, Toilet
  circulation: 10, // Main Entrance, Foyer, Lobby, Stairs
  service: 5,
};

const projected = new THREE.Vector3();

function getTargetLevels() {
  const targets = new Set();
  if (state.activeLevels instanceof Set) {
    for (const level of campus.levels) {
      if (state.activeLevels.has(level.key) && !state.hiddenLevels.has(level.key)) {
        targets.add(level.key);
      }
    }
  }
  return targets;
}

function updateLabels() {
  if (!state.labels) {
    for (const room of campus.rooms) {
      room.label.visible = false;
      if (room.label.element) room.label.element.style.display = 'none';
    }
    return;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const leftEdge = getPanelOcclusion().left;
  const bottomEdge = getPanelOcclusion().bottom;
  const candidates = [];

  // Detect if camera is looking from top-down or elevated overhead angle
  const polar = controls.getPolarAngle();
  const isTopView = state.topDown || polar < 1.05;

  // In top-down / elevated view with exploded floors, multiple floors project to overlapping screen areas.
  // We prioritize the target level for each building (Block A & Block B) so floors don't stack illegibly.
  const targetLevels = getTargetLevels();

  // Route Focus Mode: When a route is actively displayed in Directions tab,
  // suppress ambient/unrelated room labels so they never occlude or block the route path!
  const isNavigating =
    (currentTab === 'directions' && typeof directions !== 'undefined' && directions?.hasRoute()) ||
    Boolean(state.routeEndpoints && state.routeEndpoints.size > 0);

  for (const room of campus.rooms) {
    const isStairsOrLift =
      /stair|tangga/i.test(room.name) ||
      /lift|elevator/i.test(room.name) ||
      (room.category === 'circulation' && /stair|tangga|lift|elevator/i.test(room.note ?? ''));

    // In Route Focus Mode (while viewing an active route):
    // Suppress ambient room labels so they never block the route line,
    // BUT NEVER HIDE stairs or elevator labels!
    if (isNavigating) {
      const isEndpoint =
        room === state.selected ||
        Boolean(
          state.routeEndpoints && (
            (room.code && state.routeEndpoints.has(room.code)) ||
            state.routeEndpoints.has(room.name)
          )
        );
      if (!isEndpoint && !isStairsOrLift) {
        room.label.visible = false;
        if (room.label.element) room.label.element.style.display = 'none';
        continue;
      }
    }

    // If a specific destination is highlighted from Popular Destinations, collapse other labels (except stairs/lifts)
    if (state.focusOnlyRooms && !state.focusOnlyRooms.has(room)) {
      if (!isStairsOrLift) {
        room.label.visible = false;
        if (room.label.element) room.label.element.style.display = 'none';
        continue;
      }
    }

    if (!isRoomReadable(room)) {
      room.label.visible = false;
      if (room.label.element) room.label.element.style.display = 'none';
      continue;
    }

    // Option 1: Per-Building Active Floor Filtering
    // Only show room labels on each building's active focus level to eliminate cross-floor overlap (skip during navigation)
    if (state.mode === 'explode' && !state.focusOnlyRooms && !isNavigating) {
      const isTargetLevel = targetLevels.has(room.levelKey);
      if (!isTargetLevel && room !== state.selected && !isStairsOrLift) {
        room.label.visible = false;
        if (room.label.element) room.label.element.style.display = 'none';
        continue;
      }
    }

    room.label.getWorldPosition(projected);
    projected.project(camera);
    if (projected.z < -1 || projected.z > 1) {
      room.label.visible = false;
      if (room.label.element) room.label.element.style.display = 'none';
      continue;
    }
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    if (x < leftEdge || x > width - 10 || y < 10 || y > height - bottomEdge - 10) {
      room.label.visible = false;
      if (room.label.element) room.label.element.style.display = 'none';
      continue;
    }
    candidates.push({ room, x, y, depth: projected.z });
  }

  candidates.sort((a, b) => {
    // 1. Selected room, focused destination rooms, route endpoints, OR stairs/elevators on route have top priority
    const aStairsOrLift = /stair|tangga|lift|elevator/i.test(a.room.name);
    const bStairsOrLift = /stair|tangga|lift|elevator/i.test(b.room.name);

    const aEndpoint =
      a.room === state.selected ||
      Boolean(state.focusOnlyRooms && state.focusOnlyRooms.has(a.room)) ||
      Boolean(
        state.routeEndpoints && (
          (a.room.code && state.routeEndpoints.has(a.room.code)) ||
          state.routeEndpoints.has(a.room.name)
        )
      ) ||
      (isNavigating && aStairsOrLift);

    const bEndpoint =
      b.room === state.selected ||
      Boolean(state.focusOnlyRooms && state.focusOnlyRooms.has(b.room)) ||
      Boolean(
        state.routeEndpoints && (
          (b.room.code && state.routeEndpoints.has(b.room.code)) ||
          state.routeEndpoints.has(b.room.name)
        )
      ) ||
      (isNavigating && bStairsOrLift);

    if (aEndpoint !== bEndpoint) return aEndpoint ? -1 : 1;

    // 2. Active / target level priority per building
    const aTarget = targetLevels.has(a.room.levelKey);
    const bTarget = targetLevels.has(b.room.levelKey);
    if (aTarget !== bTarget) return aTarget ? -1 : 1;

    // 3. Higher floors appear over lower floors
    if (a.room.level.rank !== b.room.level.rank) {
      return b.room.level.rank - a.room.level.rank;
    }

    // 4. Room category priority (e.g. labs and lecture halls over stairs and toilets)
    const aPrio = CATEGORY_PRIORITY[a.room.category] ?? 0;
    const bPrio = CATEGORY_PRIORITY[b.room.category] ?? 0;
    if (aPrio !== bPrio) return bPrio - aPrio;

    // 5. Room area as tie-breaker
    return b.room.area - a.room.area || a.depth - b.depth;
  });

  const placed = [];
  if (!infoCard.hidden) {
    const card = infoCard.getBoundingClientRect();
    placed.push({
      x0: card.left - 12,
      x1: card.right + 12,
      y0: card.top - 12,
      y1: card.bottom + 12,
    });
  }

  for (const item of candidates) {
    const el = item.room.label.element;
    let w = el && el.offsetWidth > 0 ? el.offsetWidth : 0;
    let h = el && el.offsetHeight > 0 ? el.offsetHeight : 0;

    if (!w || !h) {
      if (item.room.labelSize && item.room.labelSize[0] > 0) {
        [w, h] = item.room.labelSize;
      } else {
        const nameLen = item.room.name ? item.room.name.length : 0;
        const codeLen = item.room.code ? item.room.code.length : 0;
        w = Math.max(90, Math.max(nameLen * 8, codeLen * 10) + 26);
        h = item.room.code ? 38 : 26;
        item.room.labelSize = [w, h];
      }
    } else {
      item.room.labelSize = [w, h];
    }

    // Generous collision margins so labels never touch or overlap
    const padX = isTopView ? 12 : 8;
    const padY = isTopView ? 8 : 6;
    const rect = {
      x0: item.x - w / 2 - padX,
      x1: item.x + w / 2 + padX,
      y0: item.y - h / 2 - padY,
      y1: item.y + h / 2 + padY,
    };

    const isFocused = Boolean(state.focusOnlyRooms && state.focusOnlyRooms.has(item.room));
    const isEndpoint = Boolean(
      state.routeEndpoints && (
        (item.room.code && state.routeEndpoints.has(item.room.code)) ||
        state.routeEndpoints.has(item.room.name)
      )
    );
    const isStairsOrLift = isNavigating && /stair|tangga|lift|elevator/i.test(item.room.name);

    const clashes =
      item.room !== state.selected &&
      !isFocused &&
      !isEndpoint &&
      !isStairsOrLift &&
      placed.some((p) => p.x0 < rect.x1 && p.x1 > rect.x0 && p.y0 < rect.y1 && p.y1 > rect.y0);

    item.room.label.visible = !clashes;
    if (el) {
      el.style.display = clashes ? 'none' : '';
    }
    if (!clashes) placed.push(rect);
  }
}

// Update labels smoothly during camera controls
controls.addEventListener('change', () => {
  updateLabels();
});

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

  // Sync North Compass needle with camera azimuth
  if (compassNeedle) {
    const azimuth = controls.getAzimuthalAngle();
    compassNeedle.style.transform = `rotate(${azimuth}rad)`;
  }

  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------- helpers

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
    state.focusedStep = null;
    // Extract every unique floor level that this route passes through
    const routeLevels = new Set(route.path.map((node) => node.levelKey).filter(Boolean));
    if (routeLevels.size === 0) return;

    // Track active route levels
    state.routeLevelKeys = routeLevels;

    // ONLY show the floors that the user will walk by:
    // Hide all floors NOT on the route, unhide all floors ON the route
    state.hiddenLevels.clear();
    for (const level of campus.levels) {
      if (!routeLevels.has(level.key)) {
        state.hiddenLevels.add(level.key);
      }
    }

    // Automatically activate the label for every floor that will be passing by
    state.activeLevels = new Set(routeLevels);

    // Automatically turn labels ON if they were toggled off
    if (!state.labels) {
      state.labels = true;
      const toggleLabels = document.getElementById('toggle-labels');
      if (toggleLabels) toggleLabels.checked = true;
      labelLayer.style.display = '';
    }

    // If the route traverses multiple floors, ensure exploded view so all passing floors are visible
    if (routeLevels.size > 1) {
      setMode('explode');
    } else {
      setMode('single');
      state.activeLevel = [...routeLevels][0];
    }

    // Set activeLevel to destination level
    const destNode = route.path[route.path.length - 1];
    if (destNode?.levelKey) {
      state.activeLevel = destNode.levelKey;
    }

    // Track endpoints so their room labels are guaranteed to appear
    state.routeEndpoints = new Set();
    const origNode = route.path[0];
    const origRoom = campus.rooms.find((r) => r.navNode === origNode?.id);
    const destRoom = campus.rooms.find((r) => r.navNode === destNode?.id);
    if (origRoom) {
      if (origRoom.code) state.routeEndpoints.add(origRoom.code);
      state.routeEndpoints.add(origRoom.name);
    }
    if (destRoom) {
      if (destRoom.code) state.routeEndpoints.add(destRoom.code);
      state.routeEndpoints.add(destRoom.name);
    }

    // Apply layout, update level sidebar pills & toggle, and refresh labels immediately
    applyLayout();
    renderLevelList();
    updateLabels();

    if (frame) {
      const points = route.path.map((node) => {
        const level = campus.levels.find((l) => l.key === node.levelKey);
        const y = level ? level.group.position.y + 14 : 14;
        return new THREE.Vector3(node.x, y, node.z);
      });
      framePoints(points, 0.9);
    }

    // On mobile phone mode: auto-collapse panel so the 3D route gets the full screen!
    if (isMobile()) {
      collapsePanel();
    }
  },
  onStepSelected(step, index) {
    if (!step) return;

    // 1. Highlight step marker in 3D route layer
    routeLayer.setStepMarker(step, index);

    // 2. Set focused step state so upper floors are immediately hidden and don't block the lower floor
    state.focusedStep = step;
    state.activeLevel = step.levelKey;
    if (state.activeLevels) {
      state.activeLevels.add(step.levelKey);
    }
    if (step.toLevelKey && state.activeLevels) {
      state.activeLevels.add(step.toLevelKey);
    }

    applyLayout();
    renderLevelList();
    updateLabels();

    // 3. Smoothly fly camera to directly show the step location on that floor
    if (step.position) {
      campus.root.updateWorldMatrix(true, true);
      const level = campus.levels.find((l) => l.key === step.levelKey);
      const y = (level ? level.group.position.y : 0) + 14;

      let targetX = step.position.x;
      let targetZ = step.position.z;
      let targetY = y;

      const isTransition = Boolean(step.toPosition && step.toLevelKey && step.toLevelKey !== step.levelKey);
      if (isTransition) {
        const toLevel = campus.levels.find((l) => l.key === step.toLevelKey);
        const toY = (toLevel ? toLevel.group.position.y : 0) + 14;
        targetX = (step.position.x + step.toPosition.x) / 2;
        targetZ = (step.position.z + step.toPosition.z) / 2;
        targetY = (y + toY) / 2;
      }

      const targetLocal = new THREE.Vector3(targetX, targetY, targetZ);
      const targetWorld = campus.content.localToWorld(targetLocal);

      // Elevated direct viewing angle (~63° pitch) looking directly down into the floor
      // With upper floors hidden, this provides a 100% unobstructed, direct view of the floor!
      const dist = isTransition ? 46 : 34;
      const dir = state.topDown
        ? new THREE.Vector3(0, 1, 0.002).normalize()
        : new THREE.Vector3(0.18, 0.89, 0.42).normalize();

      const camPos = targetWorld.clone().addScaledVector(dir, dist);
      offsetForPanel(camPos, targetWorld, dist);
      flyTo(camPos, targetWorld, 0.75);
    }

    // 4. In mobile phone mode: auto-collapse panel so user gets full floorplan view
    if (isMobile()) {
      collapsePanel();
    }
  },
  onShowFullRoute() {
    state.focusedStep = null;
    routeLayer.clearStepMarker();
    applyLayout();
    renderLevelList();
    updateLabels();

    const activeRoute = directions.getActiveRoute?.();
    if (activeRoute) {
      const points = activeRoute.path.map((node) => {
        const level = campus.levels.find((l) => l.key === node.levelKey);
        const y = level ? level.group.position.y + 14 : 14;
        return new THREE.Vector3(node.x, y, node.z);
      });
      framePoints(points, 0.9);
    } else {
      frameAll(0.85);
    }
  },
  onStepCleared() {
    state.focusedStep = null;
    routeLayer.clearStepMarker();
    applyLayout();
    renderLevelList();
    updateLabels();
  },
  onRouteCleared() {
    state.focusedStep = null;
    routeLayer.clearStepMarker();
    state.routeEndpoints = null;
    state.routeLevelKeys = null;
    // When directions are cleared, restore all floors visible & active
    state.hiddenLevels.clear();
    state.activeLevels = new Set(campus.levels.map((l) => l.key));
    applyLayout();
    renderLevelList();
    updateLabels();
    frameAll(0.8);
  },
});

document.addEventListener('directions-restarted', () => {
  state.focusedStep = null;
  routeLayer.clearStepMarker();
  switchTab('home');
  state.routeEndpoints = null;
  state.routeLevelKeys = null;
  state.selectedCategories.clear();
  state.hiddenLevels.clear();
  state.activeLevels = new Set(campus.levels.map((l) => l.key));
  state.activeLevel = campus.levels[1].key;
  setMode('explode');
  renderLegend();
  renderLevelList();
  applyLayout();
  frameAll();
});

// "Directions to here" button in the info card
document.getElementById('info-directions')?.addEventListener('click', () => {
  if (!state.selected) return;
  const targetRoom = state.selected;
  for (const r of campus.rooms) {
    r.label.element?.classList.remove('is-highlighted');
  }
  state.focusOnlyRooms = null;
  select(null);
  infoCard.hidden = true;

  // Switch to directions tab without auto-expanding or overriding route framing
  switchTab('directions', { refocus: false, autoExpand: false });
  // Set destination and compute route
  directions.setDestination(targetRoom);

  // In mobile phone mode, collapse panel so the route gets full screen
  if (isMobile()) {
    collapsePanel();
  }
});

// ---------------------------------------------------------------- URL hash deep link

function checkUrlHash() {
  const hash = window.location.hash;
  if (!hash) return;
  const match = hash.match(/room=([^&]+)/);
  if (match) {
    const query = decodeURIComponent(match[1]).toLowerCase();
    const target = searchIndex.find(
      (e) =>
        (e.room.code && e.room.code.toLowerCase() === query) ||
        e.room.name.toLowerCase() === query ||
        e.haystack.includes(query)
    );
    if (target) {
      setTimeout(() => {
        switchTab('explore');
        revealRoom(target.room);
      }, 300);
    }
  }
}

// ---------------------------------------------------------------- boot

document.getElementById('fit')?.addEventListener('click', () => {
  if (currentTab === 'directions' && state.routeLevelKeys && directions?.hasRoute()) {
    state.focusedStep = null;
    directions.clearStepSelection?.();
    routeLayer.clearStepMarker();
    applyLayout();
    renderLevelList();
    updateLabels();
    const activeRoute = directions.getActiveRoute?.();
    if (activeRoute) {
      const points = activeRoute.path.map((node) => {
        const level = campus.levels.find((l) => l.key === node.levelKey);
        const y = level ? level.group.position.y + 14 : 14;
        return new THREE.Vector3(node.x, y, node.z);
      });
      framePoints(points, 0.9);
    } else {
      directions.refresh();
    }
  } else {
    restoreNormalMode();
  }
});
scene.add(sun.target);

resize();
renderLegend();
applyLayout();
frameAll(0.001);
switchTab('home');
checkUrlHash();
animate();

const loading = document.getElementById('loading');
requestAnimationFrame(() => {
  loading.classList.add('is-hidden');
  setTimeout(() => loading.remove(), 500);
});

if (!pointerInside) canvas.style.cursor = 'grab';
