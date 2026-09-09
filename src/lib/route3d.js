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
    this.route = null;
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
    this.group.visible = false;
  }

  show(route, { startLabel, endLabel }) {
    this.clear();
    this.route = { route, startLabel, endLabel };
    this.group.visible = true;
    this.rebuild();
  }

  /** Recomputes the polyline; call whenever levels move. */
  rebuild() {
    if (!this.route) return;
    const { route, startLabel, endLabel } = this.route;
    const points = this.polyline(route);
    if (points.length < 2) return;

    const positions = points.flatMap((p) => [p.x, p.y, p.z]);

    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const haloGeometry = new LineGeometry();
    haloGeometry.setPositions(positions);

    if (this.line) {
      this.group.remove(this.line);
      this.line.geometry.dispose();
    }
    if (this.halo) {
      this.group.remove(this.halo);
      this.halo.geometry.dispose();
    }

    this.halo = new Line2(haloGeometry, this.glow);
    this.halo.renderOrder = 10;
    this.group.add(this.halo);

    this.line = new Line2(geometry, this.material);
    this.line.computeLineDistances();
    this.line.renderOrder = 11;
    this.group.add(this.line);

    this.clearMarkers();
    if (startLabel) {
      this.markers.add(marker(points[0], 0x1b2a4a, startLabel, 'start'));
    }
    if (endLabel) {
      this.markers.add(marker(points[points.length - 1], 0xf4364c, endLabel, 'end'));
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
      const y = elevation(node);
      const previous = route.path[index - 1];
      const edge = route.edges[index - 1];
      if (previous && edge && (edge.kind === 'stairs' || edge.kind === 'lift')) {
        points.push(new THREE.Vector3(previous.x, y, previous.z));
      }
      points.push(new THREE.Vector3(node.x, y, node.z));
    });

    return points;
  }

  update(dt) {
    if (!this.line) return;
    this.material.dashOffset -= dt * 26;
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
