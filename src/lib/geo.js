/**
 * Maps GPS readings onto the floor plan.
 *
 * The drawings carry no real-world coordinates, so the mapping is learnt in the
 * app: stand at two known points (entrances work best, since GPS is far more
 * reliable outdoors) and save a fix at each. Two fixes are enough to solve the
 * rotation, scale and offset of the whole plan.
 *
 * If you already know the coordinates, fill in DEFAULT_ANCHORS and the setup
 * step disappears for everyone.
 */

import { PLAN_SCALE } from '../data/floorplans.js';

const STORAGE_KEY = 'faculty-floorplan.geo-anchors.v1';
const EARTH_RADIUS = 6378137;

/**
 * Pre-configured reference points, e.g.
 *   { nodeId: 'A1:entrance', lat: 3.12345, lng: 101.65432 }
 */
export const DEFAULT_ANCHORS = [];

export function loadAnchors() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // Corrupt or unavailable storage just falls back to the defaults.
  }
  return [...DEFAULT_ANCHORS];
}

export function saveAnchors(anchors) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(anchors));
  } catch {
    // Private browsing: calibration simply won't persist between visits.
  }
}

export function clearAnchors() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Local east/north offsets in metres from a reference latitude and longitude. */
function toLocal(lat, lng, lat0, lng0) {
  const toRad = Math.PI / 180;
  return {
    east: (lng - lng0) * toRad * EARTH_RADIUS * Math.cos(lat0 * toRad),
    north: (lat - lat0) * toRad * EARTH_RADIUS,
  };
}

/**
 * Least-squares similarity fit between GPS and plan coordinates.
 *
 * Working in the complex plane makes this a one-liner: with p = east + i·north
 * and q = x − i·y (plan y grows southwards), any rotation, uniform scale and
 * translation is just q = s·p + t.
 */
export function solveTransform(anchors, positionOf) {
  const usable = anchors
    .map((anchor) => ({ anchor, node: positionOf(anchor.nodeId) }))
    .filter((entry) => entry.node);

  if (!usable.length) return null;

  const lat0 = usable[0].anchor.lat;
  const lng0 = usable[0].anchor.lng;

  const samples = usable.map(({ anchor, node }) => {
    const { east, north } = toLocal(anchor.lat, anchor.lng, lat0, lng0);
    return { pRe: east, pIm: north, qRe: node.x, qIm: -node.z };
  });

  // A single fix can only give the offset, so assume the plan is drawn north-up.
  if (samples.length === 1) {
    const [only] = samples;
    const scale = 1 / PLAN_SCALE; // plan units per metre
    return makeTransform(
      { re: scale, im: 0 },
      { re: only.qRe - scale * only.pRe, im: only.qIm - scale * only.pIm },
      lat0,
      lng0,
      1,
    );
  }

  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const pRe0 = mean(samples.map((s) => s.pRe));
  const pIm0 = mean(samples.map((s) => s.pIm));
  const qRe0 = mean(samples.map((s) => s.qRe));
  const qIm0 = mean(samples.map((s) => s.qIm));

  let numRe = 0;
  let numIm = 0;
  let den = 0;
  for (const s of samples) {
    const pr = s.pRe - pRe0;
    const pi = s.pIm - pIm0;
    const qr = s.qRe - qRe0;
    const qi = s.qIm - qIm0;
    // (q) * conj(p)
    numRe += qr * pr + qi * pi;
    numIm += qi * pr - qr * pi;
    den += pr * pr + pi * pi;
  }

  if (den < 1e-6) return null;

  const s = { re: numRe / den, im: numIm / den };
  const t = {
    re: qRe0 - (s.re * pRe0 - s.im * pIm0),
    im: qIm0 - (s.im * pRe0 + s.re * pIm0),
  };
  return makeTransform(s, t, lat0, lng0, samples.length);
}

function makeTransform(s, t, lat0, lng0, anchorCount) {
  const scale = Math.hypot(s.re, s.im); // plan units per metre
  return {
    anchorCount,
    /** Rotation of plan north relative to true north, in degrees. */
    bearing: (Math.atan2(s.im, s.re) * 180) / Math.PI,
    metresPerPlanUnit: scale > 1e-9 ? 1 / scale : 0,
    toPlan(lat, lng) {
      const { east, north } = toLocal(lat, lng, lat0, lng0);
      return {
        x: s.re * east - s.im * north + t.re,
        z: -(s.im * east + s.re * north + t.im),
      };
    },
  };
}

export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location services.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(new Error(describeGeolocationError(error))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000, ...options },
    );
  });
}

export function watchPosition(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError?.(new Error('This browser does not support location services.'));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    onUpdate,
    (error) => onError?.(new Error(describeGeolocationError(error))),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

function describeGeolocationError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was denied. Pick a starting point instead.';
    case error.POSITION_UNAVAILABLE:
      return 'Your location is unavailable right now.';
    case error.TIMEOUT:
      return 'Timed out waiting for a location fix.';
    default:
      return 'Could not read your location.';
  }
}

/** Browsers only expose geolocation on secure origins (https or localhost). */
export function isSecureContextForGeolocation() {
  return window.isSecureContext || location.hostname === 'localhost';
}
