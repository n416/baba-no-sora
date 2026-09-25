import * as THREE from 'three';
import { M } from './kit';
import { cel, flat, glow } from '../render/toon';
import { PAL } from '../render/palette';
import { box, strut, textTexture, JP_FONT, rng, type Rng } from '../core/util';
import { addOutline } from '../render/outline';
import { facadeBox, facadeMaterial, FLOOR, type FacadeStyle } from '../render/facade';
import { hSign, vSign, signPlane, markSpecial, SIGN_STYLES, TENANTS, VERTICAL_TENANTS, type SignStyle } from '../render/signs';

/**
 * The Takadanobaba kit.  Same rules as kit.ts: authored at the origin facing +Z
 * (the front looks toward +z), placed by the caller with place(), connected
 * members drawn with strut(), colours from PAL through M().
 */

const shadows = (o: THREE.Object3D, cast = true, receive = true) => {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
  return o;
};

// ---- buildings --------------------------------------------------------------

export interface TowerSpec { style?: FacadeStyle; wall?: string; clutter?: boolean }

/** Plain background building: window-grid box, parapet, and (near) rooftop kit. */
export function makeTower(r: Rng, w: number, d: number, h: number, s: TowerSpec = {}) {
  const g = new THREE.Group();
  const style = s.style ?? r.pick(['office', 'flats', 'tile', 'flats', 'old'] as FacadeStyle[]);
  const wall = s.wall ?? r.pick(PAL.facades);
  g.add(facadeBox(w, h, d, facadeMaterial(style, wall)));
  const roofM = M(PAL.roofSlab, 'soft');
  // parapet: a slightly proud rim so the roofline reads against the sky
  g.add(box(w + 0.3, 0.7, 0.3, M(wall), 0, h, d / 2), box(w + 0.3, 0.7, 0.3, M(wall), 0, h, -d / 2));
  g.add(box(0.3, 0.7, d, M(wall), w / 2, h, 0), box(0.3, 0.7, d, M(wall), -w / 2, h, 0));
  g.add(box(w, 0.05, d, roofM, 0, h, 0));
  if (s.clutter ?? true) rooftop(r, g, w, d, h);
  return g;
}

/** Water tank, plant room, AC units, an antenna: what makes a Tokyo roof from the air. */
/** Plant for the big landmark roofs, fixed rather than random. */
function rooftopKit(g: THREE.Group, w: number, d: number, h: number) {
  g.add(box(w * 0.3, 3, d * 0.35, M('#d6d2ca'), -w * 0.2, h, 0));
  for (let i = 0; i < 8; i++) g.add(box(1.2, 0.9, 0.6, M(PAL.acUnit), w * 0.1 + (i % 4) * 1.6, h, (i < 4 ? -1 : 1) * d * 0.2));
}

function rooftop(r: Rng, g: THREE.Group, w: number, d: number, h: number) {
  const kit = M(PAL.roofKit);
  if (r.chance(0.7)) {
    const pw = Math.min(w * 0.4, 5), pd = Math.min(d * 0.4, 4);
    g.add(box(pw, 2.4, pd, M('#d6d2ca'), r.range(-w / 4, w / 4), h, r.range(-d / 4, d / 4)));
  }
  if (r.chance(0.5)) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), M('#8fb2c4'));
    const tx = r.range(-w / 3, w / 3), tz = r.range(-d / 3, d / 3);
    tank.position.set(tx, h + 1.9, tz);
    g.add(tank);
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.add(box(0.1, 1.1, 0.1, kit, tx + ox, h, tz + oz));
  }
  const nAc = Math.floor(r.range(0, Math.min(6, w / 1.5)));
  const acz = r.range(-d / 3, d / 3);
  for (let i = 0; i < nAc; i++) g.add(box(0.9, 0.7, 0.4, M(PAL.acUnit), -w / 2 + 1 + i * 1.2, h, acz));
  if (r.chance(0.25)) g.add(strut(new THREE.Vector3(w / 3, h, -d / 3), new THREE.Vector3(w / 3, h + 5, -d / 3), 0.05, kit, 4));
}

/**
 * The zakkyo building: every floor a different tenant, a sign band per floor,
 * vertical signs stacked at the front corner sticking out over the pavement,
 * a shopfront with an awning.  `back` also dresses the rear (+ -z) face.
 */
export function makeZakkyo(r: Rng, w: number, d: number, floors: number, opts: { back?: boolean; rooftopSign?: boolean; awning?: boolean; izakaya?: boolean } = {}) {
  const g = new THREE.Group();
  const h = floors * FLOOR + 0.4;
  const wall = r.pick(PAL.facades);
  g.add(facadeBox(w, h, d, facadeMaterial(r.pick(['tile', 'old', 'flats'] as FacadeStyle[]), wall)));
  g.add(box(w + 0.25, 0.6, d + 0.25, M(wall), 0, h, 0));
  // floor slabs stand 5 cm proud of the wall: the ink finds them, the sun shadows them
  const band = M(shadeHex(wall, 0.9));
  for (let f = 1; f < floors; f++) g.add(box(w + 0.1, 0.14, d + 0.1, band, 0, f * FLOOR - 0.07, 0));
  if (floors >= 4 && r.chance(0.3)) fireEscape(g, r.chance(0.5) ? 1 : -1, w, d, floors);
  g.add(box(w, 0.05, d, M(PAL.roofSlab, 'soft'), 0, h + 0.55, 0));
  rooftop(r, g, w, d, h + 0.6);
  const faces = opts.back ? [1, -1] : [1];
  for (const side of faces) {
    const face = new THREE.Group();
    face.rotation.y = side > 0 ? 0 : Math.PI;
    if (opts.izakaya) izakayaFront(r, face, w, d);
    else dressFront(r, face, w, d, floors, opts.awning ?? true);
    g.add(face);
  }
  if (opts.rooftopSign ?? r.chance(0.3)) {
    // big billboard on the roof, 4:1, on two legs
    const bw = Math.min(w - 1, 10), bh = bw / 4;
    const st = r.pick(SIGN_STYLES);
    const s = signPlane(bw, bh, hSign(r.pick(TENANTS), st));
    s.position.set(0, h + 1.6 + bh / 2, d / 2 - 1.2);
    g.add(s);
    g.add(box(bw, bh, 0.15, M(st.bg), 0, h + 1.6, d / 2 - 1.3));
    for (const x of [-bw / 3, bw / 3]) g.add(box(0.15, 1.7, 0.15, M(PAL.steelDark), x, h + 0.6, d / 2 - 1.35));
  }
  return shadows(g);
}

/**
 * An old izakaya's ground floor (02): timber lattice doors, a short noren,
 * a red paper lantern that lights after dark, a small name board, a wall mailbox.
 */
function izakayaFront(r: Rng, g: THREE.Group, w: number, d: number) {
  const z = d / 2;
  const wood = M(r.pick(['#7a5a42', '#6a4c38', '#8a6a4e'])), slat = M('#4e3a2c');
  const dw = Math.min(w - 1.2, 3.2);
  g.add(box(dw, 2.2, 0.1, paperMat(), -w / 2 + 0.6 + dw / 2, 0.1, z + 0.03)); // paper-backed doors
  for (let x = -w / 2 + 0.7; x < -w / 2 + 0.6 + dw; x += 0.22) g.add(box(0.05, 2.2, 0.06, slat, x, 0.1, z + 0.1));
  g.add(box(dw + 0.3, 0.14, 0.14, wood, -w / 2 + 0.6 + dw / 2, 2.3, z + 0.08));
  // the rest of the frontage: rolled-down shutter or plank wall
  const rest = w - dw - 1.2;
  if (rest > 0.6) g.add(box(rest, 2.4, 0.08, r.chance(0.5) ? M(PAL.shutter) : wood, w / 2 - 0.4 - rest / 2, 0.1, z + 0.03));
  // noren: three short cloth panels over the door
  const noren = M(r.pick(['#2c3a5a', '#7a2a2a', '#e8e0cc']), 'soft');
  for (let i = 0; i < 3; i++) g.add(box(dw / 3 - 0.05, 0.55, 0.02, noren, -w / 2 + 0.6 + dw / 6 + (i * dw) / 3, 1.72, z + 0.16));
  // red lantern (akachochin) on a bracket
  const lx = -w / 2 + 0.35;
  const lan = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8).scale(1, 1.35, 1), lanternMat());
  lan.scale.set(1, 1, 1);
  lan.position.set(lx, 2.15, z + 0.32);
  g.add(lan);
  g.add(box(0.03, 0.2, 0.03, slat, lx, 2.4, z + 0.32), box(0.03, 0.03, 0.3, slat, lx, 2.6, z + 0.18));
  // small name board over the door
  const st = r.pick(SIGN_STYLES);
  const b = signPlane(2.0, 0.5, hSign(r.pick(TENANTS), st));
  b.position.set(-w / 2 + 0.6 + dw / 2, 2.9, z + 0.1);
  g.add(b);
  if (r.chance(0.6)) g.add(box(0.4, 0.3, 0.14, M('#f0eee8'), w / 2 - 0.8, 1.2, z + 0.1)); // mailbox
}

let _paper: THREE.MeshToonMaterial | null = null;
function paperMat() {
  if (!_paper) { _paper = glow('#caa878', '#c98a4a', { ramp: 'soft' }); }
  return _paper;
}
let _lantern: THREE.MeshToonMaterial | null = null;
function lanternMat() {
  return (_lantern ??= glow('#d0452f', '#ff6a3a', { ramp: 'soft' }));
}

function shadeHex(hex: string, k: number) {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

/** Steel fire escape on a side wall: a landing per floor, flights zig-zagging between them. */
function fireEscape(g: THREE.Group, side: number, w: number, d: number, floors: number) {
  const m = M('#6a6e74'), x = side * (w / 2 + 0.7);
  const z0 = -d / 2 + 1.2, z1 = Math.min(d / 2 - 1.2, z0 + 3.2);
  for (let f = 1; f < floors; f++) {
    const y = f * FLOOR;
    g.add(box(1.3, 0.08, z1 - z0 + 1.2, m, x, y, (z0 + z1) / 2));
    g.add(box(0.05, 1.0, z1 - z0 + 1.2, m, x + side * 0.63, y, (z0 + z1) / 2)); // rail
    const up = f % 2 ? [z0, z1] : [z1, z0];
    g.add(strut(new THREE.Vector3(x, y - FLOOR + 0.1, up[0]), new THREE.Vector3(x, y, up[1]), 0.06, m, 4));
    g.add(strut(new THREE.Vector3(x + side * 0.5, y - FLOOR + 1.0, up[0]), new THREE.Vector3(x + side * 0.5, y + 0.9, up[1]), 0.03, m, 4));
  }
  for (const z of [z0 - 0.6, z1 + 0.6]) g.add(box(0.08, floors * FLOOR, 0.08, m, x + side * 0.6, 0, z));
}

/** Signs, shopfront and awning on the +z face of a w x d building. */
function dressFront(r: Rng, g: THREE.Group, w: number, d: number, floors: number, awning: boolean) {
  const z = d / 2;
  // ground floor: lit glass shopfront, awning, name board
  const shopW = w - 0.8;
  g.add(box(shopW, 2.6, 0.1, shopGlass(r), 0, 0.15, z + 0.03));
  g.add(box(shopW, 0.25, 0.14, M(PAL.steelDark), 0, 2.72, z + 0.05)); // fascia rail
  const st = r.pick(SIGN_STYLES);
  const board = signPlane(Math.min(shopW, 4.8), Math.min(shopW, 4.8) / 4, hSign(r.pick(TENANTS), st));
  board.position.set(0, 3.35 + Math.min(shopW, 4.8) / 8, z + 0.16);
  g.add(board);
  g.add(box(Math.min(shopW, 4.8) + 0.2, Math.min(shopW, 4.8) / 4 + 0.2, 0.12, M(PAL.steelDark), 0, 3.25, z + 0.07));
  if (awning && r.chance(0.7)) {
    const awn = box(shopW, 0.07, 1.3, M(r.pick([PAL.awningRed, '#2f7a5a', '#e1a33a', '#3a5a9a', '#b8b0a4']), 'soft'), 0, 0, 0);
    awn.position.set(0, 2.95, z + 0.62);
    awn.rotation.x = 0.28;
    g.add(awn);
  }
  // one or two sign bands per upper floor, on backing plates proud of the wall
  for (let f = 1; f < floors; f++) {
    if (r.chance(0.18)) continue;
    const two = w > 8 && r.chance(0.5);
    const sw = two ? (w - 1.2) / 2 : Math.min(w - 0.8, 6);
    const sh = sw / 4;
    const y = f * FLOOR + FLOOR * 0.12;
    for (let k = 0; k < (two ? 2 : 1); k++) {
      const x = two ? (k ? 1 : -1) * (sw / 2 + 0.2) : 0;
      const s2 = r.pick(SIGN_STYLES);
      g.add(box(sw + 0.1, sh + 0.1, 0.1, M(s2.bg), x, y - 0.05, z + 0.05));
      const p = signPlane(sw, sh, hSign(r.pick(TENANTS), s2));
      p.position.set(x, y + sh / 2, z + 0.11);
      g.add(p);
    }
  }
  // vertical signs at a front corner: a column of 1:4 panels sticking out over the pavement
  const nV = Math.min(floors - 1, Math.floor(r.range(2, 5)));
  const vx = (r.chance(0.5) ? 1 : -1) * (w / 2 - 0.35);
  const vw = 0.95, vh = vw * 4;
  for (let i = 0; i < nV; i++) {
    const st2 = r.pick(SIGN_STYLES);
    const rect = vSign(r.pick(VERTICAL_TENANTS), st2);
    const y = FLOOR * 1.1 + i * (vh + 0.15);
    if (y + vh > floors * FLOOR) break;
    g.add(box(0.26, vh, vw, M(st2.bg), vx, y, z + 0.1 + vw / 2));
    // two faces, each its own plane so neither is mirrored
    for (const sgn of [1, -1]) {
      const p = signPlane(vw, vh, rect);
      p.rotation.y = sgn * Math.PI / 2;
      p.position.set(vx + sgn * 0.14, y + vh / 2, z + 0.1 + vw / 2);
      g.add(p);
    }
    g.add(box(0.06, 0.06, 0.6, M(PAL.steelDark), vx, y + vh - 0.3, z + 0.3)); // bracket
  }
  // AC units hung on the face
  for (let f = 1; f < floors; f++) if (r.chance(0.35)) g.add(box(0.8, 0.55, 0.3, M(PAL.acUnit), r.range(-w / 2 + 0.8, w / 2 - 0.8), f * FLOOR + 2.2, z + 0.16));
}

const shopGlassCache: THREE.MeshToonMaterial[] = [];
/**
 * Shop windows with something inside: ceiling lights, shelves of goods, a counter,
 * a couple of figures.  A handful of painted interiors, each one texture used as
 * both map and emissive map, so the shop reads by day and glows by night.
 */
function shopGlass(r: Rng) {
  if (!shopGlassCache.length) {
    const tones: [string, string][] = [['#e8dcc4', '#c89a5a'], ['#dfe6ea', '#6a8aa6'], ['#f0e0c8', '#b8583a'], ['#e4e8d8', '#6a9a5a'], ['#efe2d0', '#8a5a9a']];
    tones.forEach(([wall, goods], k) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const x = c.getContext('2d')!;
      const grad = x.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, wall); grad.addColorStop(1, '#b8a890');
      x.fillStyle = grad; x.fillRect(0, 0, 256, 128);
      x.fillStyle = '#fffbe8';
      for (let i = 12; i < 256; i += 40) x.fillRect(i, 6, 24, 5); // ceiling lights
      const rnd = rng(900 + k);
      for (const y of [40, 64, 88]) {
        x.fillStyle = '#8a7a6a'; x.fillRect(4, y, 150, 3); // shelf
        for (let i = 8; i < 150; i += 7) { x.fillStyle = rnd.chance(0.5) ? goods : '#f4eee0'; x.fillRect(i, y - 12 + rnd.range(0, 4), 5, 12 - rnd.range(0, 4)); }
      }
      x.fillStyle = '#7a5a42'; x.fillRect(170, 78, 80, 50); // counter
      x.fillStyle = 'rgba(40,40,60,0.55)';
      for (const px of [120 + rnd.range(0, 30), 200 + rnd.range(0, 30)]) { x.beginPath(); x.arc(px, 62, 8, 0, Math.PI * 2); x.fill(); x.fillRect(px - 9, 70, 18, 58); }
      x.fillStyle = '#5a6068'; for (const mx of [0, 84, 170, 252]) x.fillRect(mx, 0, 4, 128); // mullions
      x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(40, 0); x.lineTo(90, 0); x.lineTo(30, 128); x.lineTo(-20, 128); x.fill(); // glass glint
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      const m = glow('#ffffff', '#c8b090', { map: t, emissiveMap: t, ramp: 'soft' });
      shopGlassCache.push(m);
    });
  }
  return r.pick(shopGlassCache);
}

/** The red-lattice landmark on the plaza: dark glass box wrapped in a diamond grid. */
export function makeLatticeBuilding(w: number, d: number, h: number, name: string) {
  const r0 = rng(77);
  const g = new THREE.Group();
  g.add(facadeBox(w, h, d, facadeMaterial('office', '#8a5a4c')));
  // lattice-red rim, plain roof inside it (from the air it must not read as a red box)
  for (const s of [1, -1]) {
    g.add(box(w + 0.5, 0.8, 0.4, M(PAL.lattice), 0, h, s * (d / 2 + 0.05)));
    g.add(box(0.4, 0.8, d + 0.5, M(PAL.lattice), s * (w / 2 + 0.05), h, 0));
  }
  g.add(box(w, 0.05, d, M(PAL.roofSlab, 'soft'), 0, h, 0));
  rooftopKit(g, w, d, h);
  const lat = M(PAL.lattice);
  const step = 2.4, rad = 0.13;
  // diamond grid on the front and both sides, starting above the shop floor
  const y0 = 4.2, y1 = h;
  const faces: { w: number; place: (u: number, y: number) => THREE.Vector3 }[] = [
    { w, place: (u, y) => new THREE.Vector3(u - w / 2, y, d / 2 + 0.45) },
    { w: d, place: (u, y) => new THREE.Vector3(w / 2 + 0.45, y, d / 2 - u) },
    { w: d, place: (u, y) => new THREE.Vector3(-w / 2 - 0.45, y, u - d / 2) },
  ];
  for (const f of faces) {
    const H = y1 - y0;
    for (let c = -H; c < f.w + H; c += step) {
      for (const dir of [1, -1]) {
        // line u = c + dir * (y - y0); keep the part with 0 <= u <= f.w
        const lo = dir > 0 ? y0 - c : y0 + c - f.w, hi = dir > 0 ? y0 + f.w - c : y0 + c;
        const ya = Math.max(y0, lo), yb = Math.min(y1, hi);
        if (yb - ya < 0.3) continue;
        const u = (y: number) => c + dir * (y - y0);
        g.add(strut(f.place(u(ya), ya), f.place(u(yb), yb), rad, lat, 4));
      }
    }
    // frame top and bottom
    g.add(strut(f.place(0, y0), f.place(f.w, y0), 0.2, lat, 4));
  }
  // ground floor shops and the name board
  g.add(box(w - 2, 3.2, 0.1, shopGlass(r0), 0, 0.2, d / 2 + 0.05));
  for (let i = 0; i < 5; i++) {
    const st = SIGN_STYLES[(i * 5 + 2) % SIGN_STYLES.length];
    const bw = (w - 3) / 5 - 0.3;
    const sp = signPlane(bw, bw / 4, hSign(TENANTS[(i * 7 + 3) % TENANTS.length], st));
    sp.position.set(-w / 2 + 1.5 + (i + 0.5) * ((w - 3) / 5), 3.55, d / 2 + 0.2);
    g.add(sp);
  }
  // entrance: a recessed frame with steps
  g.add(box(6, 0.25, 2, M('#c8c2b8'), 0, 0, d / 2 + 1), box(6, 0.12, 1, M('#c8c2b8'), 0, 0.25, d / 2 + 0.5));
  for (const x of [-3.1, 3.1]) g.add(box(0.3, 3.4, 0.3, M(PAL.lattice), x, 0, d / 2 + 0.4));
  g.add(box(6.5, 0.4, 0.6, M(PAL.lattice), 0, 3.4, d / 2 + 0.4));
  const nm = signPlane(10, 2.5, markSpecial(hSign(name, { bg: '#fff7ea', fg: PAL.lattice, border: PAL.lattice })));
  nm.position.set(0, h - 3.2, d / 2 + 0.7);
  g.add(nm);
  return shadows(g);
}

/** Tall white hotel with a crown and a vertical name sign. */
export function makeHotel(w: number, d: number, h: number, name: string) {
  const g = new THREE.Group();
  g.add(facadeBox(w, h, d, facadeMaterial('hotel', PAL.hotel)));
  g.add(box(w + 0.6, 1.2, d + 0.6, M('#e4e2dc'), 0, h, 0));
  g.add(box(w * 0.5, 3.5, d * 0.5, M('#dcdad4'), 0, h + 1.2, 0));
  const nm = signPlane(2.2, 8.8, markSpecial(vSign(name, { bg: '#26315a', fg: '#ffffff' })));
  nm.position.set(w / 2 - 1.6, h - 6, d / 2 + 0.12);
  g.add(nm);
  const nm2 = signPlane(8, 2, markSpecial(hSign(name, { bg: '#26315a', fg: '#ffffff' })));
  nm2.position.set(0, h + 2.6, d / 4 + 0.05);
  g.add(nm2);
  g.add(box(w + 2, 5, d + 2, facadeMaterial('office', '#d8d6d0'), 0, 0, 0)); // podium
  g.add(box(w - 4, 3.6, 0.1, glow('#b8c4cc', '#ffe6b8', { ramp: 'soft' }), 0, 0.1, d / 2 + 1.06)); // lobby glass
  const canopy = box(9, 0.35, 4, M('#e8e6e0'), 0, 3.8, d / 2 + 3);
  g.add(canopy);
  g.add(box(8.6, 0.05, 3.6, glow('#d8d4cc', '#fff0d0'), 0, 3.75, d / 2 + 3)); // lit soffit
  for (const x of [-4.2, 4.2]) g.add(box(0.25, 3.8, 0.25, M('#c8c6c0'), x, 0, d / 2 + 4.7));
  return shadows(g);
}

// ---- the railway -----------------------------------------------------------

export const RAIL = { deckBottom: 4.2, deckTop: 6.4, railY: 6.6 };

/**
 * The girder bridge over the road (the "gado"): runs along z (the track
 * direction), spans `span` metres over the road, carries `width` metres of
 * track.  Yellow-black hazard band and a 4.2 m clearance plate on both faces.
 */
export function makeGirderBridge(span: number, width: number) {
  const g = new THREE.Group();
  const steel = rivetMat(), dark = M(PAL.steelDark);
  const { deckBottom: b, deckTop: t } = RAIL;
  g.add(box(width, t - b - 0.6, span, steel, 0, b + 0.6, 0));
  // bearings on the abutments at both ends of every main girder
  for (const x of [-width / 2 + 0.3, 0, width / 2 - 0.3]) for (const z of [-span / 2 + 0.4, span / 2 - 0.4]) g.add(box(0.6, 0.35, 0.6, dark, x, b - 0.6, z));
  // down-lights under the deck, lit after dark
  const dl = downLight();
  for (let x = -width / 2 + 2; x < width / 2 - 1; x += 4) for (const z of [-7, -2.5, 2.5, 7]) g.add(box(0.5, 0.08, 0.9, dl, x, b - 0.3, z));
  // main girders: deeper plates along both edges and under the rails
  for (const x of [-width / 2 + 0.3, -width / 4, 0, width / 4, width / 2 - 0.3]) g.add(box(0.35, 0.9, span, dark, x, b - 0.25, 0));
  // stiffener ribs on the outer girder faces
  for (let z = -span / 2 + 1; z < span / 2; z += 1.6) {
    for (const x of [-width / 2 - 0.02, width / 2 + 0.02]) g.add(box(0.1, t - b, 0.14, dark, x, b, z));
  }
  // hazard stripes on both faces the traffic sees: the road runs along x, so the x faces
  const stripe = hazardTexture();
  for (const sgn of [1, -1]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.9), cel('#ffffff', { map: stripe, ramp: 'soft' }));
    band.position.set(sgn * (width / 2 + 0.2), b + 0.2, 0);
    band.rotation.y = sgn * Math.PI / 2;
    g.add(band);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), cel('#ffffff', { map: clearanceTexture(), ramp: 'soft' }));
    plate.position.set(sgn * (width / 2 + 0.22), b + 1.25, -sgn * span * 0.1);
    plate.rotation.y = sgn * Math.PI / 2;
    g.add(plate);
  }
  // parapet walls on the deck
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) g.add(box(0.2, 1.1, span, M(PAL.embankment), x, t, 0));
  return shadows(g);
}

let _down: THREE.MeshToonMaterial | null = null;
export function downLight() {
  return (_down ??= glow('#cfd2d4', '#fff4dc'));
}
let _rivet: THREE.MeshToonMaterial | null = null;
/** Grey plate with rows of rivets and vertical splice lines: reads as an old steel bridge up close. */
function rivetMat() {
  if (_rivet) return _rivet;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = PAL.steel; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#7c848c'; x.fillRect(0, 0, 6, 128); x.fillRect(128, 0, 4, 128);
  x.fillStyle = '#a4acb4';
  for (const y of [10, 118]) for (let i = 8; i < 256; i += 12) { x.beginPath(); x.arc(i, y, 3, 0, Math.PI * 2); x.fill(); }
  for (const cx of [16, 140]) for (let y = 22; y < 110; y += 12) { x.beginPath(); x.arc(cx, y, 3, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 1);
  t.anisotropy = 4;
  return (_rivet = cel('#ffffff', { map: t }));
}

let _hazard: THREE.CanvasTexture | null = null;
function hazardTexture() {
  if (_hazard) return _hazard;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = PAL.hazardYellow; x.fillRect(0, 0, 1024, 64);
  x.fillStyle = PAL.hazardBlack;
  for (let i = -2; i < 24; i++) {
    x.beginPath();
    x.moveTo(i * 48, 64); x.lineTo(i * 48 + 24, 64); x.lineTo(i * 48 + 24 + 64, 0); x.lineTo(i * 48 + 64, 0);
    x.fill();
  }
  _hazard = new THREE.CanvasTexture(c);
  _hazard.colorSpace = THREE.SRGBColorSpace;
  return _hazard;
}
let _clear: THREE.CanvasTexture | null = null;
function clearanceTexture() {
  if (_clear) return _clear;
  _clear = textTexture('制限高 4.2M', { w: 512, h: 128, bg: '#f4f1e8', fg: '#c7271f', border: '#1f5fae' });
  return _clear;
}

/** Catenary gantry across `width` metres of track: two masts and a beam. */
export function makeGantry(width: number) {
  const g = new THREE.Group();
  const m = M(PAL.steelDark);
  const y = RAIL.railY;
  for (const x of [-width / 2, width / 2]) g.add(box(0.3, 6.2, 0.3, m, x, y, 0));
  g.add(box(width + 0.4, 0.35, 0.3, m, 0, y + 5.6, 0));
  for (let x = -width / 2 + 2.2; x < width / 2; x += 4.2) g.add(box(0.05, 0.9, 0.05, m, x, y + 4.8, 0));
  return shadows(g, true, false);
}

/**
 * A commuter train of `cars` x 20 m cars, front toward -z.  Silver body, a
 * colour band, windows that light up after dark.  Invented livery.
 */
export function makeTrain(cars: number, band: string, body = PAL.trainSilver) {
  const g = new THREE.Group();
  const shell = M(body), bandM = M(band), dark = M('#3a3e46');
  const win = glow('#56657e', '#fff0cc');
  const L = 20, W = 2.9;
  for (let i = 0; i < cars; i++) {
    const z0 = i * (L + 0.5);
    const c = new THREE.Group();
    c.position.z = z0 + L / 2;
    c.add(box(W, 3.0, L, shell, 0, 0.9, 0));
    c.add(box(W + 0.02, 0.35, L, bandM, 0, 1.5, 0));
    c.add(box(W + 0.03, 0.8, L - 2, win, 0, 2.25, 0));
    for (let z = -L / 2 + 1.6; z < L / 2 - 1; z += 1.55) c.add(box(W + 0.06, 0.8, 0.1, shell, 0, 2.25, z)); // mullions
    if (i > 0) c.add(box(W - 0.6, 2.6, 0.7, dark, 0, 1.0, -L / 2 - 0.3)); // gangway bellows
    c.add(box(W - 0.4, 0.3, L - 1, M('#b8bcc2'), 0, 3.9, 0)); // roof
    c.add(box(W - 0.5, 0.8, L - 3, dark, 0, 0.1, 0)); // underframe
    for (const dz of [-5.5, 0, 5.5]) c.add(box(W + 0.04, 1.9, 1.3, M('#9aa0a8'), 0, 0.95, dz)); // doors
    if (i === 0) {
      c.add(box(W - 0.2, 1.2, 0.1, win, 0, 2.0, -L / 2 - 0.02));
      for (const x of [-0.9, 0.9]) c.add(box(0.3, 0.18, 0.06, glow('#e8e4d8', '#fff4d0'), x, 1.1, -L / 2 - 0.03));
    }
    if (i % 2 === 1) {
      const pa = new THREE.Vector3(0, 4.2, -3), pb = new THREE.Vector3(0, 5.4, -1.5), pc = new THREE.Vector3(0, 5.4, -4.5);
      c.add(strut(pa, pb, 0.04, dark, 4), strut(pa, pc, 0.04, dark, 4), box(1.4, 0.06, 0.1, dark, 0, 5.4, -3));
    }
    g.add(c);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

// ---- street furniture ------------------------------------------------------

/** The tall curved-arm road lamp from the rotary (01): pole, arcing arm toward +z, lamp head. */
export function makeArmLamp(h = 9) {
  const g = new THREE.Group();
  const m = M(PAL.lampPole);
  const pts = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h - 1, 0), new THREE.Vector3(0, h - 0.2, 0.45),
    new THREE.Vector3(0, h + 0.25, 1.2), new THREE.Vector3(0, h + 0.35, 2.0), new THREE.Vector3(0, h + 0.25, 2.7),
  ];
  for (let i = 0; i < pts.length - 1; i++) g.add(strut(pts[i], pts[i + 1], i === 0 ? 0.13 : 0.08, m, 6));
  g.add(box(0.36, 0.2, 0.9, m, 0, h + 0.05, 2.95));
  g.add(box(0.3, 0.05, 0.8, glow('#e8e4d8', '#fff1c8'), 0, h + 0.02, 2.95));
  return shadows(g, true, false);
}

/** Traffic signal on a pole with an arm reaching +z over the road. */
export function makeSignal(reach = 4) {
  const g = new THREE.Group();
  const m = M(PAL.lampPole);
  g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 6, 0), 0.12, m, 6));
  g.add(strut(new THREE.Vector3(0, 5.6, 0), new THREE.Vector3(0, 5.6, reach), 0.07, m, 6));
  const head = new THREE.Group();
  head.position.set(0, 5.6, reach - 0.4);
  head.add(box(1.3, 0.42, 0.28, M('#4a5058'), 0, -0.21, 0));
  const cols = ['#4fd07a', '#f2c230', '#e84a3a'];
  cols.forEach((c, i) => {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12), i === 0 ? glow('#3a8a5a', c) : M('#5a5a5e'));
    lamp.rotation.z = Math.PI / 2;
    lamp.rotation.y = Math.PI / 2;
    lamp.position.set(-0.4 + i * 0.4, 0, 0.16);
    head.add(lamp);
  });
  // the head faces along the road (+x), which is how approaching traffic sees it
  head.rotation.y = Math.PI / 2;
  g.add(head);
  // pedestrian signal
  g.add(box(0.32, 0.6, 0.22, M('#4a5058'), 0.2, 2.6, 0));
  g.add(box(0.26, 0.24, 0.02, glow('#2a6a4a', '#5fe08a'), 0.2, 2.62, 0.12));
  return shadows(g, true, false);
}

/** Orange-and-white traffic cone. */
export function makeCone() {
  const g = new THREE.Group();
  g.add(box(0.42, 0.05, 0.42, M('#3a3a3e')));
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.72, 10), M(PAL.cone));
  c.position.y = 0.41;
  g.add(c);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.118, 0.14, 10), M(PAL.coneWhite));
  band.position.y = 0.46;
  g.add(band);
  return g;
}

/** Pedestrian fence run between two ground points: posts and a top rail. */
export function makeFence(a: THREE.Vector3, b: THREE.Vector3, colour = '#e8e6e0', h = 0.95) {
  const g = new THREE.Group();
  const m = M(colour, 'soft');
  const n = Math.max(1, Math.round(a.distanceTo(b) / 2));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    g.add(strut(p, p.clone().setY(h), 0.035, m, 5));
  }
  g.add(strut(a.clone().setY(h), b.clone().setY(h), 0.04, m, 5));
  g.add(strut(a.clone().setY(h * 0.55), b.clone().setY(h * 0.55), 0.025, m, 4));
  return shadows(g, true, false);
}

/** Wall-hung AC outdoor unit, front toward +z. */
export function makeAC() {
  const g = new THREE.Group();
  g.add(box(0.8, 0.58, 0.3, M(PAL.acUnit)));
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), M('#8a8c90'));
  fan.position.set(-0.12, 0.3, 0.155);
  g.add(fan);
  return g;
}

/** A parked mamachari, front toward +z. */
export function makeBike(r: Rng) {
  const g = new THREE.Group();
  const frame = M(r.pick(['#c8453c', '#e8e4dc', '#3a6aa0', '#2c2c30', '#6aa06a']));
  const tyre = M('#26242a');
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 5, 16), tyre);
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.33, z);
    g.add(w);
  }
  const P = (y: number, z: number) => new THREE.Vector3(0, y, z);
  for (const [a, b] of [[P(0.3, 0.05), P(0.9, -0.25)], [P(0.3, 0.05), P(0.62, 0.45)], [P(0.62, 0.45), P(0.95, 0.4)], [P(0.9, -0.25), P(0.33, -0.55)], [P(0.3, 0.05), P(0.33, 0.55)], [P(0.95, 0.4), P(0.33, 0.55)]] as const) g.add(strut(a, b, 0.022, frame, 4));
  g.add(box(0.14, 0.05, 0.24, M('#2e2a2a'), 0, 0.97, -0.28));
  g.add(box(0.5, 0.03, 0.03, M('#bfc2c6'), 0, 1.02, 0.45));
  g.add(box(0.32, 0.22, 0.26, M('#9ea2a8'), 0, 0.72, 0.68)); // basket
  return g;
}

/** Awning run for the alley: a sloped fabric sheet on two brackets, front toward +z. */
export function makeAwning(w: number, colour = PAL.awningRed) {
  const g = new THREE.Group();
  const sheet = box(w, 0.06, 0.95, M(colour, 'soft'), 0, 0, 0);
  sheet.position.set(0, 2.62, 0.44);
  sheet.rotation.x = 0.38;
  g.add(sheet);
  const valance = box(w, 0.24, 0.04, M(colour, 'soft'), 0, 2.2, 0.88);
  g.add(valance);
  return g;
}

/** Stacked beer crates, front toward +z. */
export function makeCrates(r: Rng) {
  const g = new THREE.Group();
  const cols = [M('#e0b23a'), M('#c8412f'), M('#3a6aa0')];
  const n = Math.floor(r.range(2, 6));
  for (let i = 0; i < n; i++) g.add(box(0.45, 0.3, 0.35, r.pick(cols), (i % 2) * 0.47 - 0.23, Math.floor(i / 2) * 0.31, 0));
  return shadows(g, true, false);
}

/** A potted shrub by a shopfront. */
export function makePot(r: Rng) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.35, 10), M(r.pick(['#a8684a', '#6a6e74', '#d8d0c0'])));
  pot.position.y = 0.175;
  g.add(pot);
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), M(r.pick(['#5f8a4a', '#6f9a54', '#4a7a44'])));
  leaf.position.y = 0.55;
  leaf.scale.set(1, 1.2, 1);
  g.add(leaf);
  return shadows(g, true, false);
}

/** Blue lidded bin with a net over it. */
export function makeBin() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.23, 0.7, 12), M('#3a6ab0'));
  b.position.y = 0.35;
  g.add(b);
  g.add(box(0.56, 0.06, 0.56, M('#2a4a8a'), 0, 0.7, 0));
  return shadows(g, true, false);
}

/** Background pedestrian: simple, faceless, in autumn clothes.  Faces +z. */
export function makePerson(r: Rng, walking = false) {
  const g = new THREE.Group();
  const s = r.range(0.92, 1.06);
  const coat = M(r.pick(['#3a4460', '#6a4a3c', '#8a8a86', '#2c2c34', '#b89a6a', '#5a6a4a', '#9a3a3a', '#d8d0c0']));
  const legs = M(r.pick(['#2c2c34', '#3a4460', '#5a5048', '#1e2230']));
  const skin = M('#e9c7a8', 'soft');
  const hair = M(r.pick(['#2a2222', '#3a2c26', '#5a4232']));
  const stride = walking ? 0.22 : 0.05;
  g.add(box(0.13, 0.8, 0.16, legs, -0.09, 0, stride), box(0.13, 0.8, 0.16, legs, 0.09, 0, -stride));
  g.add(box(0.42, 0.66, 0.26, coat, 0, 0.78, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skin);
  head.position.y = 1.56;
  g.add(head);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairM.position.y = 1.575;
  hairM.rotation.x = -0.25;
  g.add(hairM);
  if (r.chance(0.4)) g.add(box(0.1, 0.34, 0.3, M(r.pick(['#d8c8a8', '#2c2c34', '#9a6a4a'])), 0.27, 0.62, 0)); // bag
  g.scale.setScalar(s);
  return shadows(g, true, false);
}

/** A white delivery truck (01 has one at the rotary), front toward +z. */
export function makeTruck() {
  const g = new THREE.Group();
  const w = M('#f2f2ee');
  g.add(box(2.0, 2.2, 4.2, w, 0, 0.7, -0.9));
  g.add(box(1.95, 1.5, 1.6, w, 0, 0.6, 2.1));
  g.add(box(1.8, 0.7, 0.05, M('#5f7688'), 0, 1.35, 2.92));
  for (const [x, z] of [[-0.9, -2.2], [0.9, -2.2], [-0.9, 2.1], [0.9, 2.1]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12), M('#26242a'));
    t.rotation.z = Math.PI / 2;
    t.position.set(x, 0.4, z);
    g.add(t);
  }
  return shadows(g);
}

/** A taxi, front toward +z. */
export function makeTaxi(colour = '#e8c23a') {
  const g = new THREE.Group();
  g.add(box(1.7, 0.75, 4.5, M(colour), 0, 0.3, 0));
  g.add(box(1.5, 0.55, 2.2, M('#6a86a6'), 0, 1.05, -0.2));
  g.add(box(1.52, 0.06, 2.1, M(colour), 0, 1.6, -0.2));
  g.add(box(0.5, 0.2, 0.25, glow('#f4f0e0', '#fff0c0'), 0, 1.66, -0.2));
  for (const [x, z] of [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.4], [0.8, 1.4]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12), M('#26242a'));
    t.rotation.z = Math.PI / 2;
    t.position.set(x, 0.32, z);
    g.add(t);
  }
  return shadows(g);
}

/** A car, front toward +z.  kind: sedan / kei / van.  Lamps light after dark. */
export function makeCar(r: Rng, kind: 'sedan' | 'kei' | 'van' = r.pick(['sedan', 'sedan', 'kei', 'van'] as const)) {
  const g = new THREE.Group();
  const paint = M(r.pick(['#f2f2ee', '#2c2c34', '#9aa0a8', '#3a4a7a', '#8a2a2a', '#d8d0c0', '#4a6a5a']));
  const glass = M('#6a86a6');
  const L = kind === 'kei' ? 3.4 : 4.5, W = kind === 'kei' ? 1.48 : 1.75;
  if (kind === 'van') {
    g.add(box(W, 1.55, L, paint, 0, 0.35, 0));
    g.add(box(W + 0.02, 0.55, L * 0.7, glass, 0, 1.2, -0.2));
  } else {
    g.add(box(W, 0.7, L, paint, 0, 0.3, 0));
    g.add(box(W - 0.15, 0.55, L * 0.5, glass, 0, 1.0, -0.15));
    g.add(box(W - 0.13, 0.06, L * 0.46, paint, 0, 1.55, -0.15));
  }
  const lamp = glow('#eeeadc', '#fff2c8'), tail = glow('#9a3a32', '#ff5a3a');
  for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) {
    g.add(box(0.3, 0.12, 0.04, lamp, x, 0.62, L / 2 + 0.01));
    g.add(box(0.28, 0.12, 0.04, tail, x, 0.62, -L / 2 - 0.01));
  }
  for (const [x, z] of [[-W / 2, L / 2 - 0.8], [W / 2, L / 2 - 0.8], [-W / 2, -L / 2 + 0.8], [W / 2, -L / 2 + 0.8]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), M('#26242a'));
    t.rotation.z = Math.PI / 2;
    t.position.set(x, 0.3, z);
    g.add(t);
  }
  return shadows(g, true, false);
}

/** City bus, front toward +z.  Invented livery. */
export function makeBus() {
  const g = new THREE.Group();
  g.add(box(2.5, 2.6, 10.5, M('#eeeae0'), 0, 0.35, 0));
  g.add(box(2.52, 0.4, 10.5, M('#3a8a5a'), 0, 0.6, 0));
  g.add(box(2.53, 1.0, 9.5, M('#6a86a6'), 0, 1.6, -0.2));
  g.add(box(2.2, 1.2, 0.05, glow('#6a86a6', '#fff0cc'), 0, 1.4, 5.26));
  g.add(box(1.6, 0.3, 0.05, glow('#232730', '#f6d64a'), 0, 2.65, 5.26));
  for (const [x, z] of [[-1.2, 3.5], [1.2, 3.5], [-1.2, -3.5], [1.2, -3.5]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 12), M('#26242a'));
    t.rotation.z = Math.PI / 2;
    t.position.set(x, 0.48, z);
    g.add(t);
  }
  return shadows(g);
}

/** Plaza bench: slats on two legs, front toward +z. */
export function makeBench() {
  const g = new THREE.Group();
  const wood = M('#9a7456'), leg = M(PAL.steelDark);
  for (let i = 0; i < 3; i++) g.add(box(1.8, 0.05, 0.12, wood, 0, 0.45, -0.14 + i * 0.14));
  for (const x of [-0.75, 0.75]) g.add(box(0.06, 0.45, 0.42, leg, x, 0, 0));
  return shadows(g, true, false);
}

/**
 * The warm pool of light a street lamp throws on the ground after dark.
 * One shared additive material; main.ts drives its opacity from the clock.
 */
export const lampPoolMaterial = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
let _poolGeo: THREE.BufferGeometry | null = null;
export function makeLampPool(radius = 5) {
  if (!_poolGeo) {
    // soft-edged disc: brightness in vertex colours would be lost in the bake, so use rings
    _poolGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  }
  const g = new THREE.Group();
  for (const [s, y] of [[1, 0.07], [0.62, 0.075], [0.3, 0.08]] as const) {
    const m = new THREE.Mesh(_poolGeo, lampPoolMaterial);
    m.scale.setScalar(radius * s);
    m.position.y = y;
    g.add(m);
  }
  return g;
}

// ---- the mural under the tracks ------------------------------------------------

/**
 * An invented mural: big friendly shapes, a rocket, a round mascot, stars and
 * speech bubbles, in poster colours.  No existing character.  Canvas 4:1.
 */
export function muralTexture(seed: number) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const x = c.getContext('2d')!;
  const rnd = (() => { let a = seed; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const bgs = ['#7ec8e3', '#f7d56a', '#f29ab0', '#9fd89a'];
  for (let i = 0; i < 4; i++) { x.fillStyle = bgs[(i + seed) % 4]; x.fillRect(i * 512, 0, 512, 512); }
  const ink = '#2b2533';
  x.lineWidth = 10; x.strokeStyle = ink; x.lineJoin = 'round';
  for (let i = 0; i < 4; i++) {
    const cx = i * 512 + 256, cy = 280;
    const kind = (i + seed) % 4;
    if (kind === 0) {
      // round mascot: big head, ears, dot eyes
      x.fillStyle = '#ffffff';
      x.beginPath(); x.arc(cx, cy, 150, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = '#ff8a5a';
      for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + s * 70, cy - 120); x.lineTo(cx + s * 140, cy - 220); x.lineTo(cx + s * 150, cy - 90); x.fill(); x.stroke(); }
      x.fillStyle = ink;
      for (const s of [-1, 1]) { x.beginPath(); x.arc(cx + s * 55, cy - 20, 18, 0, Math.PI * 2); x.fill(); }
      x.beginPath(); x.arc(cx, cy + 40, 40, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    } else if (kind === 1) {
      // rocket
      x.fillStyle = '#f4f1ea';
      x.beginPath(); x.moveTo(cx, cy - 230); x.quadraticCurveTo(cx + 110, cy - 60, cx + 70, cy + 120); x.lineTo(cx - 70, cy + 120); x.quadraticCurveTo(cx - 110, cy - 60, cx, cy - 230); x.fill(); x.stroke();
      x.fillStyle = '#e84a3a';
      x.beginPath(); x.moveTo(cx - 70, cy + 40); x.lineTo(cx - 150, cy + 170); x.lineTo(cx - 60, cy + 120); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(cx + 70, cy + 40); x.lineTo(cx + 150, cy + 170); x.lineTo(cx + 60, cy + 120); x.fill(); x.stroke();
      x.fillStyle = '#7ec8e3'; x.beginPath(); x.arc(cx, cy - 60, 45, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = '#f7a23a';
      x.beginPath(); x.moveTo(cx - 45, cy + 125); x.lineTo(cx, cy + 230); x.lineTo(cx + 45, cy + 125); x.fill(); x.stroke();
    } else if (kind === 2) {
      // a kid running with a paper plane
      x.fillStyle = '#ffd9b8';
      x.beginPath(); x.arc(cx - 20, cy - 120, 60, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = '#3a6aa0';
      x.fillRect(cx - 70, cy - 60, 100, 150); x.strokeRect(cx - 70, cy - 60, 100, 150);
      x.beginPath(); x.moveTo(cx - 50, cy + 90); x.lineTo(cx - 110, cy + 200); x.moveTo(cx + 10, cy + 90); x.lineTo(cx + 70, cy + 190); x.stroke();
      x.fillStyle = '#ffffff';
      x.beginPath(); x.moveTo(cx + 60, cy - 160); x.lineTo(cx + 210, cy - 200); x.lineTo(cx + 110, cy - 120); x.closePath(); x.fill(); x.stroke();
    } else {
      // speech bubble with invented words
      x.fillStyle = '#ffffff';
      x.beginPath(); x.ellipse(cx, cy - 40, 200, 120, 0, 0, Math.PI * 2); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(cx - 40, cy + 70); x.lineTo(cx - 90, cy + 170); x.lineTo(cx + 20, cy + 76); x.fill();
      x.fillStyle = ink; x.font = `bold 96px ${JP_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(['とべ！', 'ババ！', 'ゆけ！', 'そら！'][(seed + i) % 4], cx, cy - 40);
    }
    // stars
    x.fillStyle = '#ffffff';
    for (let k = 0; k < 6; k++) {
      const sx = i * 512 + rnd() * 512, sy = rnd() * 150 + 20, rr = 10 + rnd() * 18;
      x.beginPath();
      for (let p = 0; p < 10; p++) { const a = (p / 10) * Math.PI * 2 - Math.PI / 2, rad = p % 2 ? rr * 0.45 : rr; x.lineTo(sx + Math.cos(a) * rad, sy + Math.sin(a) * rad); }
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Frame and an overhead light bar for a mural panel of width w, front toward +z (lit after dark). */
export function makeMuralFrame(w: number, h: number) {
  const g = new THREE.Group();
  const m = M('#3a3e46');
  g.add(box(w + 0.3, 0.15, 0.12, m, 0, -0.15, 0.04), box(w + 0.3, 0.15, 0.12, m, 0, h, 0.04));
  g.add(box(0.15, h + 0.3, 0.12, m, -w / 2 - 0.08, -0.15, 0.04), box(0.15, h + 0.3, 0.12, m, w / 2 + 0.08, -0.15, 0.04));
  for (let x = -w / 2 + 1.5; x < w / 2; x += 3) {
    g.add(box(0.05, 0.05, 0.5, m, x, h + 0.25, 0.25));
    g.add(box(0.5, 0.14, 0.2, downLight(), x, h + 0.15, 0.5));
  }
  return g;
}

export { shadows, flat, addOutline };
export type { SignStyle };
