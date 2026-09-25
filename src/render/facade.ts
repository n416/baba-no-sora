import * as THREE from 'three';
import { glow } from './toon';
import { rng } from '../core/util';

/**
 * Window-grid facades for the thousands of background buildings.  One small
 * repeating canvas per (style, wall colour); the box's UVs are scaled so a
 * tile always covers 4 bays x 4 floors (14 m x 12.8 m) whatever its size.
 * The emissive map is a second canvas where only some windows are lit, so at
 * night the city comes on unevenly, like a real one.
 *
 * Painted, not photographed: flat wall, flat glass, a lighter sill line.
 */

export type FacadeStyle = 'office' | 'flats' | 'tile' | 'hotel' | 'old';
export const BAY = 3.5, FLOOR = 3.2;
const TILE_W = BAY * 4, TILE_H = FLOOR * 4;
const PX = 512;

const cache = new Map<string, THREE.MeshToonMaterial>();

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  return '#' + c.multiplyScalar(k).getHexString();
}

function paint(style: FacadeStyle, wall: string, seed: number) {
  const day = document.createElement('canvas'), night = document.createElement('canvas');
  day.width = day.height = night.width = night.height = PX;
  const d = day.getContext('2d')!, n = night.getContext('2d')!;
  d.fillStyle = wall;
  d.fillRect(0, 0, PX, PX);
  n.fillStyle = '#000';
  n.fillRect(0, 0, PX, PX);
  const r = rng(seed);
  const bw = PX / 4, fh = PX / 4;
  const glass = style === 'office' ? '#6f8fb4' : style === 'hotel' ? '#7c93b0' : '#5d6c86';
  const lit = style === 'office' ? ['#eef3ff', '#fff4d8'] : ['#ffd99a', '#ffe7b8', '#ffc98a'];
  for (let f = 0; f < 4; f++) {
    // canvas y runs down; floor 0 is at the bottom of the tile
    const y0 = PX - (f + 1) * fh;
    if (style === 'office') {
      // ribbon window per floor with mullions
      const wy = y0 + fh * 0.3, wh = fh * 0.5;
      d.fillStyle = glass; d.fillRect(2, wy, PX - 4, wh);
      d.fillStyle = shade(glass, 1.25); d.fillRect(2, wy, PX - 4, wh * 0.25); // sky reflection
      d.fillStyle = shade(wall, 0.8);
      for (let b = 0; b <= 8; b++) d.fillRect(b * (PX / 8) - 2, wy, 5, wh);
      for (let b = 0; b < 8; b++) if (r.chance(0.55)) { n.fillStyle = r.pick(lit); n.fillRect(b * (PX / 8) + 2, wy + 1, PX / 8 - 4, wh - 2); }
      continue;
    }
    for (let b = 0; b < 4; b++) {
      const x0 = b * bw;
      let wx = x0 + bw * 0.18, ww = bw * 0.64, wy = y0 + fh * 0.22, wh = fh * 0.5;
      if (style === 'hotel') { wx = x0 + bw * 0.34; ww = bw * 0.32; wy = y0 + fh * 0.16; wh = fh * 0.62; }
      if (style === 'tile' || style === 'old') { wx = x0 + bw * 0.24; ww = bw * 0.52; wh = fh * 0.46; }
      d.fillStyle = glass; d.fillRect(wx, wy, ww, wh);
      d.fillStyle = shade(glass, 1.3); d.fillRect(wx, wy, ww, wh * 0.22);
      d.fillStyle = shade(wall, 1.08); d.fillRect(wx - 4, wy + wh, ww + 8, 6); // sill
      d.fillStyle = shade(glass, 0.75); d.fillRect(wx + ww / 2 - 2, wy, 4, wh); // mullion
      if (style === 'flats') {
        // balcony slab + rail across the bay
        d.fillStyle = shade(wall, 0.72); d.fillRect(x0 + 2, y0 + fh * 0.72, bw - 4, fh * 0.05);
        d.fillStyle = shade(wall, 1.06); d.fillRect(x0 + 2, y0 + fh * 0.77, bw - 4, fh * 0.2);
      }
      if (r.chance(style === 'hotel' ? 0.45 : 0.5)) {
        // a lit room: warm glass with a darker curtain edge, not a flat slab
        n.fillStyle = r.pick(lit); n.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        n.fillStyle = 'rgba(80,50,30,0.45)'; n.fillRect(wx + 2, wy + 2, (ww - 4) * r.range(0.15, 0.35), wh - 4);
        n.fillStyle = 'rgba(0,0,0,0.35)'; n.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      }
    }
    if (style === 'tile') { d.fillStyle = shade(wall, 0.9); d.fillRect(0, y0 + fh - 2, PX, 2); } // floor seam
  }
  // keep texel (0,0) plain wall: roofs and floors sample it
  d.fillStyle = wall; d.fillRect(0, PX - 6, 6, 6);
  n.fillStyle = '#000'; n.fillRect(0, PX - 6, 6, 6);
  const mk = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(day), emissive: mk(night) };
}

export function facadeMaterial(style: FacadeStyle, wall: string) {
  const key = style + wall;
  let m = cache.get(key);
  if (!m) {
    const t = paint(style, wall, cache.size * 17 + 5);
    m = glow('#ffffff', '#ffffff', { map: t.map, emissiveMap: t.emissive });
    cache.set(key, m);
  }
  return m;
}

/**
 * A box (base at y = 0) whose side faces tile the facade at true scale.
 * Top and bottom faces sample the plain-wall texel.
 */
export function facadeBox(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; four vertices each
  const faceW = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (faceW[f] === 0) uv.setXY(i, 0.002, 0.002);
      else uv.setXY(i, uv.getX(i) * (faceW[f] / TILE_W), uv.getY(i) * (h / TILE_H));
    }
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
