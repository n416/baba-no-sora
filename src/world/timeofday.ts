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
// Shinkai-style autumn Tokyo: saturated zenith, a long warm horizon, violet-blue
// shadows, and a night that is navy (not black) with the city's glow on the horizon.
const KEYS: Key[] = [
  { el: -18, zenith: '#0a1236', horizon: '#3b3a78', sun: '#6d80c0', sunI: 0.3, fill: '#3a4a88', fillI: 0.35, hemiSky: '#34427a', hemiGround: '#2a2140', hemiI: 0.75, fog: '#262c5c', fogFar: 520, tint: '#3f438e', glow: 1.0, stars: 0.8, shadowTone: '#10183a', highlight: '#d0d8ff', hill: '#2a3264' },
  { el: -6, zenith: '#1a2866', horizon: '#c07a9c', sun: '#9a82d0', sunI: 0.35, fill: '#5a5aa8', fillI: 0.4, hemiSky: '#5a5ea0', hemiGround: '#3a2a4a', hemiI: 0.8, fog: '#6c5c98', fogFar: 560, tint: '#5048a0', glow: 0.95, stars: 0.35, shadowTone: '#22184e', highlight: '#ffd8f0', hill: '#5a5490' },
  { el: -1, zenith: '#2c4aa6', horizon: '#ff9468', sun: '#ff7a48', sunI: 1.6, fill: '#5a58b8', fillI: 0.4, hemiSky: '#8a82c8', hemiGround: '#5a3a58', hemiI: 0.68, fog: '#e8927a', fogFar: 600, tint: '#5a4aa8', glow: 0.7, stars: 0, shadowTone: '#3a1a52', highlight: '#ffd4b0', hill: '#9a78a8' },
  { el: 6, zenith: '#3170cc', horizon: '#ffc080', sun: '#ffa452', sunI: 3.0, fill: '#6a70c8', fillI: 0.4, hemiSky: '#98acdc', hemiGround: '#6a5a68', hemiI: 0.62, fog: '#f0c09a', fogFar: 680, tint: '#6258b8', glow: 0.2, stars: 0, shadowTone: '#35204e', highlight: '#fff0d4', hill: '#a8a0bc' },
  { el: 20, zenith: '#1d6ad8', horizon: '#d4eaf6', sun: '#fff0d0', sunI: 2.6, fill: '#8aa0e0', fillI: 0.6, hemiSky: '#bcd6f4', hemiGround: '#8a8090', hemiI: 0.85, fog: '#cfe2f0', fogFar: 700, tint: '#7c84d4', glow: 0, stars: 0, shadowTone: '#262050', highlight: '#fff6e8', hill: '#98b4cc' },
  { el: 60, zenith: '#1a64d4', horizon: '#dcf0fa', sun: '#fffaf0', sunI: 2.8, fill: '#90a8e8', fillI: 0.6, hemiSky: '#c4e0f8', hemiGround: '#8a8294', hemiI: 0.9, fog: '#d6eaf4', fogFar: 720, tint: '#8088d8', glow: 0, stars: 0, shadowTone: '#222050', highlight: '#fffaf0', hill: '#9cbad0' },
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
    // mornings are clear and pale, evenings warm: without this, 8:00 and 16:30 look alike
    if (this.time < 12 && this.elevation < 30) {
      const m = 1 - smoothstep(4, 30, this.elevation);
      const up = smoothstep(-6, 2, this.elevation); // keep the dawn itself rosy
      this.look.horizon.lerp(_morning, 0.6 * m * up);
      this.look.sun.lerp(_morningSun, 0.55 * m * up);
      this.look.zenith.lerp(_morningZenith, 0.35 * m * up);
      this.look.fog.lerp(_morningFog, 0.5 * m * up);
      this.look.hill.lerp(_morningFog, 0.4 * m * up);
      this.look.highlight.lerp(_morningSun, 0.5 * m * up);
    }
  }

  /** "15:30" */
  label() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

const _morning = new THREE.Color('#e2eef6');
const _morningSun = new THREE.Color('#fff6e4');
const _morningZenith = new THREE.Color('#3f86dc');
const _morningFog = new THREE.Color('#dde8f0');
