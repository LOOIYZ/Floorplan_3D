import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { PLAN_SCALE } from '../data/floorplans.js';

const PATH_HEIGHT = 14; // plan units above the floor slab

/**
 * Draws the active route as a ribbon through the model, following the levels as
 * they move in the exploded view.
 */
export class RouteLayer {
  constructor(parent, campus) {
    this.campus = campus;
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    parent.add(this.group);

    this.material = new LineMaterial({
      color: 0xf4364c,
      linewidth: 5,
      worldUnits: false,
      dashed: true,
      dashSize: 14,
      gapSize: 9,
      transparent: true,
      depthTest: false,
      toneMapped: false,
    });
    this.material.resolution.set(window.innerWidth, window.innerHeight);

    this.glow = new LineMaterial({
      color: 0xffffff,
      linewidth: 11,
      worldUnits: false,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      toneMapped: false,
    });
    this.glow.resolution.copy(this.material.resolution);

    this.line = null;
    this.halo = null;
    this.markers = new THREE.Group();
    this.group.add(this.markers);
    this.stepMarkerGroup = new THREE.Group();
    this.group.add(this.stepMarkerGroup);
    this.route = null;
    this.activeStep = null;
    this.stepMarkerMesh = null;
  }

  setResolution(width, height) {
    this.material.resolution.set(width, height);
    this.glow.resolution.set(width, height);
  }

  clearMarkers() {
    this.markers.traverse((obj) => {
      if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
        obj.element.parentNode.removeChild(obj.element);
      }
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    // Safety cleanup: remove any orphaned route-marker DOM elements
    document.querySelectorAll('.route-marker').forEach((el) => el.remove());
    this.markers.clear();
  }

  setStepMarker(step, index) {
    this.clearStepMarker();
    if (!step || !step.position) return;
    this.activeStep = { step, index };

    const level = this.campus.levels.find((entry) => entry.key === step.levelKey);
    const y = (level ? level.group.position.y : 0) + PATH_HEIGHT;
    const pos = new THREE.Vector3(step.position.x, y, step.position.z);

    const group = new THREE.Group();
    group.position.copy(pos);

    // Glowing ground disc
    const discGeo = new THREE.CircleGeometry(16, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.25,
      depthTest: false,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -PATH_HEIGHT + 2;
    disc.renderOrder = 20;
    group.add(disc);

    // Expanding pulsing ring
    const ringGeo = new THREE.RingGeometry(11, 15, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -PATH_HEIGHT + 2.5;
    ring.renderOrder = 21;
    group.add(ring);

    // Vertical guide beam
    const stemGeo = new THREE.CylinderGeometry(1.2, 1.2, 16, 8);
    const stemMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      toneMapped: false,
    });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 8;
    stem.renderOrder = 21;
    group.add(stem);

    // Glowing sphere pin
    const pinGeo = new THREE.SphereGeometry(6, 20, 14);
    const pinMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      depthTest: false,
      toneMapped: false,
    });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.y = 16;
    pin.renderOrder = 22;
    group.add(pin);

    // CSS2D badge
    const badgeEl = document.createElement('div');
    badgeEl.className = 'step-beacon-badge';
    const num = index + 1;
    const label = step.shortText || step.text;
    badgeEl.innerHTML = `<span class="step-beacon-num">Step ${num}</span><span class="step-beacon-desc">${escapeHtml(label)}</span>`;
    const tag = new CSS2DObject(badgeEl);
    tag.position.y = 32;
    tag.center.set(0.5, 0.5);
    group.add(tag);

    this.stepMarkerGroup.add(group);
    this.stepMarkerMesh = { group, ring, ringMat, pin };
    this.stepMarkerGroup.visible = this.group.visible;
  }

  clearStepMarker() {
    this.activeStep = null;
    this.stepMarkerMesh = null;
    this.stepMarkerGroup.traverse((obj) => {
      if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
        obj.element.parentNode.removeChild(obj.element);
      }
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    document.querySelectorAll('.step-beacon-badge').forEach((el) => el.remove());
    this.stepMarkerGroup.clear();
  }

  clear() {
    this.route = null;
    for (const mesh of [this.line, this.halo]) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.line = null;
    this.halo = null;
    this.clearMarkers();
    this.clearStepMarker();
    this.group.visible = false;
    this.markers.visible = false;
    this.stepMarkerGroup.visible = false;
  }

  setVisible(visible) {
    const isVisible = Boolean(visible);
    this.group.visible = isVisible;
    this.markers.visible = isVisible;
    this.stepMarkerGroup.visible = isVisible;
    this.markers.traverse((obj) => {
      if (obj.isCSS2DObject && obj.element) {
        obj.element.style.display = isVisible ? '' : 'none';
      }
    });
    this.stepMarkerGroup.traverse((obj) => {
      if (obj.isCSS2DObject && obj.element) {
        obj.element.style.display = isVisible ? '' : 'none';
      }
    });
    document.querySelectorAll('.route-marker, .step-beacon-badge').forEach((el) => {
      el.style.display = isVisible ? '' : 'none';
    });
  }

  show(route, { startLabel, endLabel }) {
    this.clear();
    this.route = { route, startLabel, endLabel };
    this.group.visible = true;
    this.markers.visible = true;
    this.stepMarkerGroup.visible = true;
    this.rebuild();
  }

  /** Recomputes the polyline; call whenever levels move. */
  rebuild() {
    if (!this.route) return;
    const { route, startLabel, endLabel } = this.route;
    const points = this.polyline(route);

    if (this.line) {
      this.group.remove(this.line);
      this.line.geometry.dispose();
      this.line = null;
    }
    if (this.halo) {
      this.group.remove(this.halo);
      this.halo.geometry.dispose();
      this.halo = null;
    }

    if (points.length >= 2) {
      const positions = points.flatMap((p) => [p.x, p.y, p.z]);

      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const haloGeometry = new LineGeometry();
      haloGeometry.setPositions(positions);

      this.halo = new Line2(haloGeometry, this.glow);
      this.halo.renderOrder = 10;
      this.group.add(this.halo);

      this.line = new Line2(geometry, this.material);
      this.line.computeLineDistances();
      this.line.renderOrder = 11;
      this.group.add(this.line);
    }

    this.clearMarkers();
    const elevation = (node) => {
      const level = this.campus.levels.find((entry) => entry.key === node.levelKey);
      return (level ? level.group.position.y : 0) + PATH_HEIGHT;
    };

    if (startLabel) {
      const origNode = route.path[0];
      const origLevel = this.campus.levels.find((l) => l.key === origNode?.levelKey);
      if (!origLevel || origLevel.group.visible) {
        const startPos = new THREE.Vector3(origNode.x, elevation(origNode), origNode.z);
        this.markers.add(marker(startPos, 0x1b2a4a, startLabel, 'start'));
      }
    }
    if (endLabel) {
      const destNode = route.path[route.path.length - 1];
      const destLevel = this.campus.levels.find((l) => l.key === destNode?.levelKey);
      if (!destLevel || destLevel.group.visible) {
        const endPos = new THREE.Vector3(destNode.x, elevation(destNode), destNode.z);
        this.markers.add(marker(endPos, 0xf4364c, endLabel, 'end'));
      }
    }
    if (!this.group.visible) {
      this.markers.visible = false;
      this.markers.traverse((obj) => {
        if (obj.isCSS2DObject && obj.element) {
          obj.element.style.display = 'none';
        }
      });
      document.querySelectorAll('.route-marker').forEach((el) => {
        el.style.display = 'none';
      });
    }

    // Keep active step marker attached to moving floor
    if (this.activeStep) {
      this.setStepMarker(this.activeStep.step, this.activeStep.index);
    }
  }

  /**
   * Node positions in scene space. Level changes get an intermediate point so
   * the path rises vertically before stepping across to the next floor's
   * landing rather than cutting through the slab diagonally.
   */
  polyline(route) {
    const points = [];
    const elevation = (node) => {
      const level = this.campus.levels.find((entry) => entry.key === node.levelKey);
      return (level ? level.group.position.y : 0) + PATH_HEIGHT;
    };

    route.path.forEach((node, index) => {
      const level = this.campus.levels.find((entry) => entry.key === node.levelKey);
      if (level && !level.group.visible) return;

      const y = elevation(node);
      const previous = route.path[index - 1];
      const edge = route.edges[index - 1];
      if (previous && edge && (edge.kind === 'stairs' || edge.kind === 'lift')) {
        const prevLevel = this.campus.levels.find((entry) => entry.key === previous.levelKey);
        if (!prevLevel || prevLevel.group.visible) {
          const dH = Math.hypot(previous.x - node.x, previous.z - node.z);
          if (dH > 0.01 && dH < 30 && edge.kind === 'stairs') {
            points.push(new THREE.Vector3(previous.x, y, previous.z));
          }
        }
      }
      points.push(new THREE.Vector3(node.x, y, node.z));
    });

    return points;
  }

  update(dt) {
    if (this.line) {
      this.material.dashOffset -= dt * 26;
    }

    if (this.stepMarkerMesh) {
      const now = performance.now() * 0.001;
      const { ring, ringMat, pin } = this.stepMarkerMesh;
      if (ring && ringMat) {
        const pulse = (now * 2) % 1;
        const scale = 1 + pulse * 1.5;
        ring.scale.set(scale, scale, scale);
        ringMat.opacity = Math.max(0, 0.85 * (1 - pulse));
      }
      if (pin) {
        pin.position.y = 16 + Math.sin(now * 4) * 2;
      }
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function marker(position, colour, label, kind) {
  const group = new THREE.Group();
  group.position.copy(position);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(18, 32),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      toneMapped: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -PATH_HEIGHT + 2;
  disc.renderOrder = 9;
  group.add(disc);

  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(7, 20, 14),
    new THREE.MeshBasicMaterial({ color: colour, depthTest: false, toneMapped: false }),
  );
  pin.position.y = 20;
  pin.renderOrder = 12;
  group.add(pin);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 20, 8),
    new THREE.MeshBasicMaterial({ color: colour, depthTest: false, toneMapped: false }),
  );
  stem.position.y = 10;
  stem.renderOrder = 12;
  group.add(stem);

  if (label) {
    const el = document.createElement('div');
    el.className = `route-marker route-marker--${kind}`;
    const badgeText = kind === 'start' ? 'Start' : 'Destination';
    el.innerHTML = `<span class="route-marker__badge">${badgeText}</span><span class="route-marker__name">${escapeHtml(label)}</span>`;
    const tag = new CSS2DObject(el);
    tag.position.y = 44;
    tag.center.set(0.5, 0.5);
    group.add(tag);
  }

  return group;
}

/** A pulsing dot showing where the device thinks the user is standing. */
export class LocationMarker {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);

    this.accuracy = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x2f7de1,
        transparent: true,
        opacity: 0.16,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.accuracy.rotation.x = -Math.PI / 2;
    this.group.add(this.accuracy);

    this.dot = new THREE.Mesh(
      new THREE.SphereGeometry(9, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x2f7de1, depthTest: false, toneMapped: false }),
    );
    this.dot.position.y = 12;
    this.dot.renderOrder = 12;
    this.group.add(this.dot);
  }

  set(x, z, y, accuracyMetres) {
    this.group.visible = true;
    this.group.position.set(x, y + 2, z);
    const radius = Math.max(accuracyMetres / PLAN_SCALE, 24);
    this.accuracy.scale.setScalar(radius);
  }

  hide() {
    this.group.visible = false;
  }

  update(time) {
    if (!this.group.visible) return;
    this.dot.scale.setScalar(1 + Math.sin(time * 3) * 0.12);
  }
}
