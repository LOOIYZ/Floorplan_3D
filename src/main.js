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
  if (!Number.isFinite(lowest)) lowest = 0;
  shadowCatcher.position.y = lowest * PLAN_SCALE - 0.06;
  grid.position.y = shadowCatcher.position.y - 0.01;
}

// ---------------------------------------------------------------- framing

const box = new THREE.Box3();
const sphere = new THREE.Sphere();

/** Gets screen space (px) occupied by the panel. */
function getPanelOcclusion() {
  if (currentTab === 'home') {
    return { left: 0, bottom: 0 };
  }
  const panelEl = document.querySelector('.panel');
  if (!panelEl) return { left: 0, bottom: 0 };
  const rect = panelEl.getBoundingClientRect();
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

/** Distance at which a sphere of `radius` fits comfortably. */
function distanceFor(radius) {
  const occ = getPanelOcclusion();
  const usableW = Math.max(260, window.innerWidth - occ.left - 40);
  const usableH = Math.max(260, window.innerHeight - occ.bottom - 40);
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (usableW / usableH));
  return radius / Math.sin(Math.min(fovV, fovH) / 2);
}

function offsetForPanel(position, target, dist) {
  const occ = getPanelOcclusion();
  const worldPerPx =
    (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;

  const shiftX = (occ.left / 2) * worldPerPx;
  const shiftY = (occ.bottom / 2) * worldPerPx;

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
  select(pickAt(event));
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

let currentTab = 'home';

function switchTab(name) {
  currentTab = name;

  if (name === 'home') {
    if (homeScreen) homeScreen.classList.remove('is-hidden');
    if (mainPanel) mainPanel.classList.add('is-hidden');
    if (viewportHud) viewportHud.hidden = true;
    if (labelLayer) labelLayer.style.display = 'none';
  } else {
    if (homeScreen) homeScreen.classList.add('is-hidden');
    if (mainPanel) mainPanel.classList.remove('is-hidden');
    if (viewportHud) viewportHud.hidden = false;
    if (labelLayer) labelLayer.style.display = state.labels ? '' : 'none';

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

    // Reset route floor isolation when user explicitly switches back to Explore
    if (name === 'explore' && state.routeLevelKeys) {
      state.routeLevelKeys = null;
      state.hiddenLevels.clear();
      state.activeLevels = new Set(campus.levels.map((l) => l.key));
      applyLayout();
      renderLevelList();
      updateLabels();
    } else if (name === 'directions' && directions.hasRoute()) {
      directions.refresh();
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

// Camera Presets
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
  frameAll(0.7);
});

// ---------------------------------------------------------------- room info card

function showInfo(room) {
  infoCard.hidden = false;
  document.getElementById('info-where').textContent =
    `${room.building.name} · ${room.level.name}`;
  document.getElementById('info-name').textContent = room.name;

  const codeEl = document.getElementById('info-code');
  codeEl.hidden = !room.code;
  codeEl.textContent = room.code ?? '';

  const badgeEl = document.getElementById('info-badge');
  if (badgeEl) badgeEl.textContent = CATEGORIES[room.category]?.label ?? 'Room';

  document.getElementById('info-type').textContent = CATEGORIES[room.category].label;
  document.getElementById('info-area').textContent = `${Math.round(room.area)} m²`;
}

document.getElementById('info-close')?.addEventListener('click', () => select(null));
document.getElementById('info-focus')?.addEventListener('click', () => {
  if (state.selected) focusRoom(state.selected);
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
  setMode(button.dataset.mode);
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
      const allBuildingActive = buildingLevels.every((l) => state.activeLevels?.has(l.key));

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
          for (const l of buildingLevels) {
            state.activeLevels.delete(l.key);
          }
        } else {
          for (const l of buildingLevels) {
            state.activeLevels.add(l.key);
            state.hiddenLevels.delete(l.key);
          }
        }
        renderLevelList();
        applyLayout();
        updateLabels();
      });

      levelList.append(heading);
    }
    const button = document.createElement('button');
    const on =
      state.mode === 'single'
        ? level.key === state.activeLevel
        : !state.hiddenLevels.has(level.key);
    const isTarget = Boolean(on && state.activeLevels?.has(level.key));
    button.className = (on ? 'is-on' : 'is-off') + (isTarget ? ' is-target' : '');
    button.innerHTML =
      `<span class="swatch"></span>` +
      `<span class="levels__name">${escapeHtml(level.level.name)}</span>` +
      (isTarget ? `<span class="levels__active-pill">Active</span>` : '') +
      `<span class="count">${level.rooms.length} rooms</span>`;
    button.addEventListener('click', () => {
      if (state.mode === 'single') {
        if (level.key === state.activeLevel) return;
        state.activeLevel = level.key;
        state.activeLevels.clear();
        state.activeLevels.add(level.key);
        applyLayout();
        frameAll(0.6);
        return;
      }
      // Toggle this level active or inactive
      if (state.activeLevels.has(level.key)) {
        state.activeLevels.delete(level.key);
        if (state.activeLevel === level.key) {
          state.activeLevel = Array.from(state.activeLevels)[0] || null;
        }
      } else {
        if (state.hiddenLevels.has(level.key)) {
          state.hiddenLevels.delete(level.key);
        }
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
    const activeCount = state.activeLevels.size;
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
    // Deactivate all floors
    state.activeLevels.clear();
    state.activeLevel = null;
  } else {
    // Activate ALL the floors for whole building
    for (const l of campus.levels) {
      state.activeLevels.add(l.key);
      state.hiddenLevels.delete(l.key);
    }
    state.activeLevel = campus.levels[1].key;
  }
  renderLevelList();
  applyLayout();
  updateLabels();
});

// Toggles ---------------------------------------------------------

document.getElementById('toggle-labels')?.addEventListener('change', (event) => {
  state.labels = event.target.checked;
  labelLayer.style.display = state.labels ? '' : 'none';
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

      li.innerHTML =
        `<span class="dot" style="background:#${dotColor}"></span>` +
        `<span class="name">${highlightedName}</span>` +
        codeHtml +
        `<span class="where">${room.building.name.replace('Block ', '')} · ${room.level.name.replace('Level ', 'L')}</span>`;

      li.addEventListener('click', () => {
        revealRoom(room);
        resultsEl.hidden = true;
        inputEl.value = room.code ? `${room.name} (${room.code})` : room.name;
        if (homeSearchClear) homeSearchClear.hidden = false;
        if (onSelect) onSelect(room);
      });
      resultsEl.append(li);
    }
  }

  inputEl.addEventListener('input', (e) => {
    performSearch(e.target.value);
    if (homeSearchClear) homeSearchClear.hidden = !e.target.value;
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
}

// Attach home search (auto-switches to explore view on select)
attachRoomSearch(homeSearchInput, homeResultsList, () => {
  switchTab('explore');
});

homeSearchClear?.addEventListener('click', () => {
  if (homeSearchInput) {
    homeSearchInput.value = '';
    homeSearchInput.focus();
  }
  if (homeResultsList) homeResultsList.hidden = true;
  homeSearchClear.hidden = true;
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
  if (room.building && state.activeLevels) {
    state.activeLevels[room.building.id] = room.levelKey;
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
  if (event.key === 'Escape') select(null);
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

  for (const room of campus.rooms) {
    if (!isRoomReadable(room)) {
      room.label.visible = false;
      if (room.label.element) room.label.element.style.display = 'none';
      continue;
    }

    // Option 1: Per-Building Active Floor Filtering
    // Only show room labels on each building's active focus level to eliminate cross-floor overlap
    if (state.mode === 'explode') {
      const isTargetLevel = targetLevels.has(room.levelKey);
      if (!isTargetLevel && room !== state.selected) {
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
    // 1. Selected room or route endpoints (origin/destination) always have absolute priority
    const aEndpoint = a.room === state.selected || Boolean(state.routeEndpoints?.has(a.room.code));
    const bEndpoint = b.room === state.selected || Boolean(state.routeEndpoints?.has(b.room.code));
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

    const isEndpoint = Boolean(state.routeEndpoints?.has(item.room.code));
    const clashes =
      item.room !== state.selected &&
      !isEndpoint &&
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
    if (routeLevels.size > 1 && state.mode === 'single') {
      setMode('explode');
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
    if (origRoom?.code) state.routeEndpoints.add(origRoom.code);
    if (destRoom?.code) state.routeEndpoints.add(destRoom.code);

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
  },
  onRouteCleared() {
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
  switchTab('home');
  state.routeEndpoints = null;
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
  directions.setDestination(state.selected);
  switchTab('directions');
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

document.getElementById('fit')?.addEventListener('click', () => frameAll());
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
