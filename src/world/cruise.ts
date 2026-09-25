import * as THREE from 'three';

/**
 * The sightseeing loop (C key / VR X long-press).  A closed curve at 45-90 m
 * that leaves along the runway, swings north over the rooftops, crosses the
 * tracks, comes back south past the alley and the rotary, then over the station
 * and down Waseda-dori again.  Heights clear the tallest block by 20 m+.
 *
 * Gentle on purpose: the tightest bend is ~150 m radius, which at 18 m/s is a
 * turn rate well inside the machine's, so the autopilot never saturates.
 */
const POINTS: [number, number, number][] = [
  [-150, 45, -8],
  [-270, 60, -50],
  [-250, 80, -210],
  [-60, 90, -260],
  [140, 85, -170],
  [210, 75, 20],
  [130, 65, 160],
  [0, 60, 150],
  [-70, 50, 60],
];

export const CRUISE_ROUTE = new THREE.CatmullRomCurve3(
  POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  'centripetal',
);
const N = 400;
const SAMPLES = CRUISE_ROUTE.getSpacedPoints(N);
export const CRUISE_LENGTH = CRUISE_ROUTE.getLength();

/** Nearest sample index (0..N-1) and its parameter. */
export function cruiseNearest(p: THREE.Vector3) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < N; i++) {
    const s = SAMPLES[i];
    const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2 + ((s.y - p.y) * 0.5) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return { i: bi, u: bi / N, dist: Math.sqrt(best) };
}

const _t = new THREE.Vector3();
/** The point `ahead` metres further along the loop from the nearest one. */
export function cruiseTarget(p: THREE.Vector3, ahead: number) {
  const n = cruiseNearest(p);
  const u = (n.u + ahead / CRUISE_LENGTH) % 1;
  return CRUISE_ROUTE.getPointAt(u, _t);
}
