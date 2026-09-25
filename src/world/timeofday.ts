import * as THREE from 'three';
import type { Season, WorldConfig } from '../config';
import { clamp, smoothstep } from '../core/util';

/**
 * Clock -> sun -> everything.
 *
 * The sun's direction is computed from latitude, the season's date and the hour,
 * so a winter afternoon really is lower and redder than a summer one.  The look
 * (sky, light colours, fog, shadow tint, grade, lamps) is keyed on the sun's
 * *elevation* rather than the clock, which is what lets one set of keys serve
 * every season: a 17:00 in December gets dusk because the sun is at dusk.
 *
 * World axes: +x east, -z north, +y up.
 * Everything here is allocation-free per frame.
 */

const DAY_OF_YEAR: Record<Season, number> = {
  spring: 100, // mid April
  earlySummer: 165, // mid June
  summer: 215, // early August
  autumn: 295, // late October
  winter: 20, // mid January
};

interface Key {
  el: number; // sun elevation in degrees
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  fill: string; // cool bounce from the opposite quarter
  fillI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: string;
  fogFar: number;
  tint: string; // cel shadow tint
  glow: number; // window / lamp emissive
  stars: number;
  shadowTone: string;
  highlight: string;
  hill: string;
}

// Keys ordered by elevation.  Tune these first when matching a style reference.
const KEYS: Key[] = [
  { el: -18, zenith: '#0b1330', horizon: '#1d2b4f', sun: '#6d80c0', sunI: 0.25, fill: '#34457a', fillI: 0.25, hemiSky: '#2a3a66', hemiGround: '#1a1830', hemiI: 0.55, fog: '#1b2748', fogFar: 260, tint: '#3b3f86', glow: 1.0, stars: 1, shadowTone: '#10183a', highlight: '#c9d6ff', hill: '#26345a' },
  { el: -6, zenith: '#1d2c5e', horizon: '#6a6aa0', sun: '#8a86c8', sunI: 0.3, fill: '#4b5696', fillI: 0.35, hemiSky: '#4a5690', hemiGround: '#2b2440', hemiI: 0.7, fog: '#57608f', fogFar: 300, tint: '#4a4c9a', glow: 0.9, stars: 0.5, shadowTone: '#1e1c4a', highlight: '#e3dcff', hill: '#4a5282' },
  { el: -1, zenith: '#3b5aa0', horizon: '#f0a37a', sun: '#ff9a6a', sunI: 0.9, fill: '#6a70b8', fillI: 0.45, hemiSky: '#8a94c8', hemiGround: '#5a4058', hemiI: 0.75, fog: '#d99a88', fogFar: 360, tint: '#6a5aa8', glow: 0.6, stars: 0, shadowTone: '#3a2050', highlight: '#ffe0c4', hill: '#8a7aa0' },
  { el: 6, zenith: '#4d86c8', horizon: '#ffd3a0', sun: '#ffc27a', sunI: 1.9, fill: '#7a86c8', fillI: 0.55, hemiSky: '#a9c1e0', hemiGround: '#7a6a70', hemiI: 0.8, fog: '#f0cfae', fogFar: 420, tint: '#7a70b8', glow: 0.15, stars: 0, shadowTone: '#35244e', highlight: '#fff0d8', hill: '#9aa3b8' },
  { el: 20, zenith: '#2f7fd0', horizon: '#e4f0ee', sun: '#fff0cc', sunI: 2.6, fill: '#8aa0d8', fillI: 0.6, hemiSky: '#bcd8f0', hemiGround: '#8a7f8a', hemiI: 0.85, fog: '#d8e8ec', fogFar: 480, tint: '#8a86c8', glow: 0, stars: 0, shadowTone: '#2a2046', highlight: '#fff6e8', hill: '#8fb0c0' },
  { el: 60, zenith: '#2a78d0', horizon: '#dff0f6', sun: '#fffaf0', sunI: 2.8, fill: '#90a8e0', fillI: 0.6, hemiSky: '#c4e0f6', hemiGround: '#8a8290', hemiI: 0.9, fog: '#dcecf2', fogFar: 520, tint: '#8e8cd0', glow: 0, stars: 0, shadowTone: '#262048', highlight: '#fffaf0', hill: '#90b4c8' },
];

type ColorField = 'zenith' | 'horizon' | 'sun' | 'fill' | 'hemiSky' | 'hemiGround' | 'fog' | 'tint' | 'shadowTone' | 'highlight' | 'hill';
type NumField = 'sunI' | 'fillI' | 'hemiI' | 'fogFar' | 'glow' | 'stars';
const COLOR_FIELDS: ColorField[] = ['zenith', 'horizon', 'sun', 'fill', 'hemiSky', 'hemiGround', 'fog', 'tint', 'shadowTone', 'highlight', 'hill'];
const NUM_FIELDS: NumField[] = ['sunI', 'fillI', 'hemiI', 'fogFar', 'glow', 'stars'];

const KEY_COLORS = KEYS.map((k) => {
  const o = {} as Record<ColorField, THREE.Color>;
  for (const f of COLOR_FIELDS) o[f] = new THREE.Color(k[f]);
  return o;
});

export interface Look {
  zenith: THREE.Color; horizon: THREE.Color; sun: THREE.Color; fill: THREE.Color;
  hemiSky: THREE.Color; hemiGround: THREE.Color; fog: THREE.Color; tint: THREE.Color;
  shadowTone: THREE.Color; highlight: THREE.Color; hill: THREE.Color;
  sunI: number; fillI: number; hemiI: number; fogFar: number; glow: number; stars: number;
  /** 0 = full night, 1 = full day; for anything that only cares whether it is dark */
  daylight: number;
}

export class TimeOfDay {
  /** Hours, 0..24 */
  time: number;
  playing = false;
  dayLength: number;
  readonly latitude: number;
  readonly dayOfYear: number;
  /** Unit vector toward the sun (may point below the horizon). */
  readonly sunDir = new THREE.Vector3();
  /** Unit vector the key light comes from: the sun by day, the moon by night. */
  readonly keyDir = new THREE.Vector3();
  elevation = 0;
  readonly look: Look;
  private listeners: ((t: number) => void)[] = [];

  constructor(cfg: WorldConfig) {
    this.time = cfg.startTime;
    this.dayLength = cfg.dayLengthSeconds;
    this.latitude = cfg.latitude;
    this.dayOfYear = DAY_OF_YEAR[cfg.season];
    const look = { sunI: 0, fillI: 0, hemiI: 0, fogFar: 0, glow: 0, stars: 0, daylight: 1 } as Look;
    for (const f of COLOR_FIELDS) look[f] = new THREE.Color();
    this.look = look;
    this.compute();
  }

  onChange(fn: (t: number) => void) {
    this.listeners.push(fn);
  }

  set(hours: number) {
    this.time = ((hours % 24) + 24) % 24;
    this.compute();
    for (const fn of this.listeners) fn(this.time);
  }

  update(dt: number) {
    if (this.playing) this.set(this.time + (24 * dt) / this.dayLength);
  }

  private compute() {
    const deg = Math.PI / 180;
    const phi = this.latitude * deg;
    const decl = -23.44 * deg * Math.cos(((2 * Math.PI) / 365) * (this.dayOfYear + 10));
    const H = (this.time - 12) * 15 * deg;
    const east = -Math.cos(decl) * Math.sin(H);
    const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(H) * Math.sin(phi);
    const up = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(H) * Math.cos(phi);
    this.sunDir.set(east, up, -north).normalize();
    this.elevation = Math.asin(clamp(up, -1, 1)) / deg;

    // key light: the sun above -4 deg, a moon-ish light from the opposite quarter below
    const moonMix = smoothstep(-2, -8, this.elevation);
    if (moonMix < 0.5) {
      this.keyDir.copy(this.sunDir);
      this.keyDir.y = Math.max(this.keyDir.y, 0.06); // grazing but never from below
    } else {
      this.keyDir.set(-this.sunDir.x, 0.55, -this.sunDir.z);
    }
    this.keyDir.normalize();

    // interpolate the look by elevation
    const e = clamp(this.elevation, KEYS[0].el, KEYS[KEYS.length - 1].el);
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].el) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(0, 1, (e - a.el) / (b.el - a.el));
    for (const f of COLOR_FIELDS) this.look[f].copy(KEY_COLORS[i][f]).lerp(KEY_COLORS[i + 1][f], t);
    for (const f of NUM_FIELDS) this.look[f] = a[f] + (b[f] - a[f]) * t;
    // the key light dips to ~0 through the sun/moon hand-over so the jump is invisible
    this.look.sunI *= 1 - 0.92 * Math.sin(Math.PI * clamp(moonMix, 0, 1));
    this.look.daylight = smoothstep(-6, 4, this.elevation);
    // mornings a touch cooler and clearer than evenings
    if (this.time < 12 && this.elevation < 25) {
      const m = 1 - smoothstep(5, 25, this.elevation);
      this.look.horizon.lerp(_morning, 0.25 * m);
      this.look.sun.lerp(_morningSun, 0.3 * m);
    }
  }

  /** "15:30" */
  label() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

const _morning = new THREE.Color('#cfe2f0');
const _morningSun = new THREE.Color('#fff4dc');
