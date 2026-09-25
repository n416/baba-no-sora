import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Seeded RNG (mulberry32).  Every scatter in the world uses one of these, so a
 *  layout is reproducible and a new seed is a new layout. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/**
 * A member drawn *between two points*.  Build anything with connected parts
 * (frames, struts, stays, rails) from named joints and this, never from a
 * centre plus a guessed angle -- that is how ends stop meeting.
 */
export function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 6,
): THREE.Mesh {
  _dir.subVectors(b, a);
  const len = _dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegments);
  const m = new THREE.Mesh(geo, material);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _dir.normalize());
  return m;
}

/** A box with its base at y = 0 of the given position, which is how props are seated. */
export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  return m;
}

export const JP_FONT = "'Yu Gothic', 'Meiryo', 'Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP', sans-serif";

/**
 * Signage drawn at runtime.  Size the canvas to the aspect of the face it will
 * land on -- a 4:1 texture on a 1:6 face is an unreadable smear, not an error.
 */
export function textTexture(
  text: string,
  opts: { w?: number; h?: number; bg?: string; fg?: string; vertical?: boolean; border?: string } = {},
): THREE.CanvasTexture {
  const { w = 512, h = 128, bg = '#f4efe2', fg = '#2a2a33', vertical = false, border } = opts;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.min(w, h) * 0.06;
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text];
    const size = Math.min(w * 0.7, (h * 0.86) / chars.length);
    g.font = `bold ${size}px ${JP_FONT}`;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, h * 0.07 + size * (i + 0.5)));
  } else {
    const size = Math.min(h * 0.62, (w * 0.9) / Math.max(1, [...text].length));
    g.font = `bold ${size}px ${JP_FONT}`;
    g.fillText(text, w / 2, h / 2 + size * 0.04);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
