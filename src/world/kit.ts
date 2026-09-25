import * as THREE from 'three';
import { cel, flat, glow } from '../render/toon';
import { PAL } from '../render/palette';
import { box, strut, textTexture, type Rng } from '../core/util';
import { addOutline } from '../render/outline';

/**
 * The prop kit.  Every builder here:
 *  - is authored facing +Z (its front looks toward +z) and at the origin; the
 *    caller places it with `place()`.  Rotate the whole thing, never branch on an
 *    axis inside the measurements;
 *  - returns a Group and does not add itself to the scene or register colliders;
 *  - draws connected members between named joints (`strut`).
 * Grow the world by adding builders here, not by one-off geometry in a layout.
 */

const mats = new Map<string, THREE.Material>();
/** Shared cel material per colour, so the bake can merge across props. */
export function M(color: string, ramp: 'cel' | 'soft' | 'hard' | 'four' = 'cel') {
  const k = color + ramp;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = cel(color, { ramp })));
  return m;
}

export function place(o: THREE.Object3D, x: number, y: number, z: number, yaw = 0) {
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  return o;
}

function shadows(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
  });
  return o;
}

// ---- buildings ------------------------------------------------------------

export interface HouseSpec {
  w?: number; d?: number; floors?: 1 | 2;
  wall?: string; roof?: string; trim?: string;
  /** sliding shutters / engawa board on the ground floor */
  engawa?: boolean;
  /** a wall-mounted AC unit -- the detail every Japanese back road has */
  ac?: boolean;
}

/** A plain Japanese wooden house: timber walls, tiled gable roof, lit windows at night. */
export function makeHouse(r: Rng, s: HouseSpec = {}) {
  const w = s.w ?? r.range(7, 10), d = s.d ?? r.range(6, 8);
  const floors = s.floors ?? (r.chance(0.6) ? 2 : 1);
  const fh = 2.7, h = fh * floors;
  const g = new THREE.Group();
  const wall = M(s.wall ?? r.pick([PAL.wood, PAL.woodDark, PAL.plaster, PAL.plasterWarm]));
  const trim = M(s.trim ?? PAL.woodDark);
  g.add(box(w, h, d, wall));
  // foundation band
  g.add(box(w + 0.1, 0.35, d + 0.1, M(PAL.concrete)));
  // floor band between storeys, a small eave over the ground floor
  if (floors === 2) {
    g.add(box(w + 0.05, 0.18, d + 0.05, trim, 0, fh - 0.09, 0));
    const eave = box(w + 0.6, 0.12, 0.9, M(s.roof ?? PAL.roofTile), 0, fh + 0.05, d / 2 + 0.4);
    eave.rotation.x = 0.28;
    g.add(eave);
  }
  // gable roof: two slabs between ridge and eave joints
  const roofM = M(s.roof ?? r.pick([PAL.roofTile, PAL.roofTile, PAL.roofTin, PAL.roofRed]));
  const over = 0.55, rise = 1.6;
  const ridge = new THREE.Vector3(0, h + rise, 0);
  for (const side of [-1, 1]) {
    const eaveP = new THREE.Vector3(0, h - 0.1, side * (d / 2 + over));
    const len = ridge.distanceTo(eaveP);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + over * 2, 0.16, len), roofM);
    slab.position.addVectors(ridge, eaveP).multiplyScalar(0.5);
    // rotating local +z by t about X gives (0, -sin t, cos t); solve for the ridge->eave direction
    slab.rotation.x = Math.atan2(-(eaveP.y - ridge.y), eaveP.z - ridge.z);
    g.add(slab);
  }
  g.add(box(w + over * 2 + 0.05, 0.2, 0.3, roofM, 0, h + rise - 0.12, 0)); // ridge cap
  // gable ends (triangles)
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)]);
  const gable = new THREE.ShapeGeometry(tri);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(gable, wall);
    m.rotation.y = side * Math.PI / 2;
    m.position.set(side * w / 2, h, 0);
    g.add(m);
  }
  // windows: dark glass by day, warm at night
  const win = glow('#3a4052', PAL.glassNight);
  for (let f = 0; f < floors; f++) {
    const n = Math.max(1, Math.floor(w / 3));
    for (let i = 0; i < n; i++) {
      if (f === 0 && i === 0) continue; // the door goes here
      const x = -w / 2 + (w / n) * (i + 0.5);
      g.add(box(1.3, 1.0, 0.08, win, x, f * fh + 1.0, d / 2 + 0.02));
      g.add(box(1.45, 0.08, 0.14, trim, x, f * fh + 0.95, d / 2 + 0.05));
    }
  }
  // door
  const dx = -w / 2 + w / Math.max(1, Math.floor(w / 3)) / 2;
  g.add(box(1.0, 2.0, 0.08, M(PAL.woodDark), dx, 0.35, d / 2 + 0.03));
  if (s.engawa ?? r.chance(0.3)) g.add(box(w * 0.6, 0.12, 0.8, M(PAL.wood), w * 0.15, 0.45, d / 2 + 0.4));
  if (s.ac ?? r.chance(0.5)) {
    const ac = new THREE.Group();
    ac.add(box(0.8, 0.55, 0.3, M('#e8e6e0')));
    ac.add(box(0.5, 0.42, 0.02, M('#8a8a90'), 0.1, 0.06, 0.16));
    ac.position.set(w / 2 - 1.0, 0.1, d / 2 + 0.18);
    g.add(ac);
  }
  return shadows(g);
}

/** A small shop: a house with a shopfront, an awning and a hanging noren-style sign. */
export function makeShop(r: Rng, name: string, colour = PAL.signRed) {
  const g = makeHouse(r, { floors: 2, w: 8, d: 7, engawa: false, ac: true });
  const front = 3.5;
  g.add(box(5.2, 2.2, 0.1, glow('#51596a', PAL.glassNight), -0.8, 0.35, front + 0.02));
  const awn = box(6.0, 0.08, 1.4, M(colour, 'soft'), -0.8, 2.75, front + 0.7);
  awn.rotation.x = 0.22;
  g.add(awn);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.7, 0.08),
    [M(PAL.plaster), M(PAL.plaster), M(PAL.plaster), M(PAL.plaster),
      cel('#ffffff', { map: textTexture(name, { w: 512, h: 112, bg: '#f5eedc', fg: colour, border: colour }) }), M(PAL.plaster)],
  );
  sign.position.set(-0.8, 3.35, front + 0.08);
  g.add(sign);
  return shadows(g);
}

// ---- street furniture ------------------------------------------------------

/** Wooden utility pole with a crossarm and a hazard sleeve.  Returns the wire anchor heights. */
export function makePole() {
  const g = new THREE.Group();
  g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 8.6, 0), 0.14, M(PAL.pole), 8));
  g.add(box(2.2, 0.14, 0.14, M(PAL.woodDark), 0, 7.6, 0));
  g.add(box(0.32, 1.8, 0.32, M(PAL.poleStripe, 'soft'), 0, 0.3, 0));
  for (let i = 0; i < 4; i++) g.add(box(0.29, 0.22, 0.33, M('#2d2a2a'), 0, 0.5 + i * 0.44, 0));
  g.add(box(0.5, 0.7, 0.4, M('#8e8e8a'), 0, 6.4, 0.25)); // transformer
  // insulators on the crossarm, a second (comms) arm, step bolts up the shaft
  for (const x of [-0.9, -0.3, 0.3, 0.9]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), M('#e8e6e0', 'soft'));
    ins.position.set(x, 7.75, 0);
    g.add(ins);
  }
  g.add(box(1.4, 0.1, 0.1, M(PAL.woodDark), 0, 6.9, 0));
  for (let y = 2.2; y < 7.2; y += 0.45) g.add(box(0.36, 0.03, 0.03, M('#5a5a5e'), 0, y, 0).rotateY((y * 7) % 2 ? 0 : Math.PI / 2));
  g.add(box(0.3, 0.7, 0.03, M('#f4f1e8', 'soft'), 0, 2.4, 0.16)); // wrapped ad plate
  return shadows(g, true, false);
}

/** Sagging wire between two world points (catenary-ish parabola).  Thin, so no depth write. */
export function makeWire(a: THREE.Vector3, b: THREE.Vector3, sag = 0.6) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 3, false);
  const m = new THREE.Mesh(geo, wireMat);
  m.userData.noBake = false;
  return m;
}
const wireMat = flat(PAL.wire);

/** Round-canopy tree: clustered blobs in three tones.  Canopies never receive shadow. */
export function makeTree(r: Rng, tones: [string, string, string], opts: { h?: number; blossom?: string } = {}) {
  const g = new THREE.Group();
  const h = opts.h ?? r.range(4.5, 8);
  const trunkTop = new THREE.Vector3(r.range(-0.3, 0.3), h * 0.6, r.range(-0.3, 0.3));
  g.add(strut(new THREE.Vector3(0, 0, 0), trunkTop, 0.16 + h * 0.015, M(PAL.woodDark), 6));
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const n = 5 + Math.floor(r.next() * 5);
  const col = opts.blossom ? [opts.blossom, opts.blossom, tones[0]] : tones;
  for (let i = 0; i < n; i++) {
    const tone = i < n * 0.25 ? col[2] : i < n * 0.6 ? col[1] : col[0];
    const m = new THREE.Mesh(blob, M(tone, opts.blossom ? 'soft' : 'cel'));
    const s = r.range(1.1, 1.9) * (h / 6);
    m.scale.set(s, s * 0.85, s);
    m.position.set(trunkTop.x + r.range(-1.3, 1.3) * h / 6, trunkTop.y + r.range(0, 1.8) * h / 6 + (i / n) * h * 0.25, trunkTop.z + r.range(-1.3, 1.3) * h / 6);
    m.castShadow = true;
    m.receiveShadow = false; // see CLAUDE.md: dark blobs hanging in the sky
    g.add(m);
  }
  g.children[0].castShadow = true;
  return g;
}

/** Yellow diamond warning sign on a post.  Two-sided plates: no mirrored UVs. */
export function makeWarningSign(symbol = '!') {
  const g = new THREE.Group();
  g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.3, 0), 0.04, M('#b8b8b8'), 6));
  const tex = textTexture(symbol, { w: 256, h: 256, bg: PAL.signYellow, fg: '#222', border: '#222' });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.06), [M('#999'), M('#999'), M('#999'), M('#999'), cel('#fff', { map: tex }), M('#999')]);
  plate.rotation.z = Math.PI / 4;
  plate.position.set(0, 2.3, 0.06);
  g.add(plate);
  addOutline(plate);
  return shadows(g, true, false);
}

/** Vending machine: glazed display that glows after dark. */
export function makeVending(colour = PAL.vendingBlue, label = 'のみもの') {
  const g = new THREE.Group();
  g.add(box(1.0, 1.85, 0.75, M(colour)));
  g.add(box(0.84, 0.95, 0.06, glow('#dfe8ee', '#f6fbff', { ramp: 'soft' }), 0, 0.72, 0.39));
  const rowM = M('#e05a4a', 'soft'), rowM2 = M('#4aa0d8', 'soft');
  for (let i = 0; i < 3; i++) g.add(box(0.76, 0.14, 0.04, i % 2 ? rowM : rowM2, 0, 0.85 + i * 0.28, 0.43));
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.04), cel('#fff', { map: textTexture(label, { w: 512, h: 124, bg: colour, fg: '#fff' }) }));
  top.position.set(0, 1.62, 0.39);
  g.add(top);
  g.add(box(0.5, 0.16, 0.08, M('#2b2b30'), 0, 0.2, 0.39)); // delivery port
  addOutline(g);
  return shadows(g);
}

/** The red post box. */
export function makePostBox() {
  const g = new THREE.Group();
  g.add(box(0.12, 0.7, 0.12, M('#555')));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 16), M('#c8312b'));
  body.position.y = 1.2;
  g.add(body);
  g.add(box(0.36, 0.05, 0.1, M('#222'), 0, 1.35, 0.27));
  addOutline(g);
  return shadows(g);
}

/** A run of white guardrail between two points on the ground. */
export function makeGuardrail(a: THREE.Vector3, b: THREE.Vector3) {
  const g = new THREE.Group();
  const len = a.distanceTo(b);
  const n = Math.max(1, Math.round(len / 2));
  const postM = M('#e6e6e2', 'soft');
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    g.add(strut(p, p.clone().setY(p.y + 0.8), 0.05, postM, 6));
  }
  const rail = strut(a.clone().setY(a.y + 0.65), b.clone().setY(b.y + 0.65), 0.05, postM, 6);
  rail.scale.set(3.2, 1, 0.6);
  g.add(rail);
  return shadows(g, true, false);
}

/** A flooded / cropped field panel with low bunds round it. */
export function makeField(w: number, d: number, colour: string, bund: string) {
  const g = new THREE.Group();
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(colour, 'soft'));
  f.rotation.x = -Math.PI / 2;
  f.position.y = 0.04;
  f.receiveShadow = true;
  g.add(f);
  const bm = M(bund, 'soft');
  g.add(box(w, 0.18, 0.4, bm, 0, 0, -d / 2), box(w, 0.18, 0.4, bm, 0, 0, d / 2));
  g.add(box(0.4, 0.18, d, bm, -w / 2, 0, 0), box(0.4, 0.18, d, bm, w / 2, 0, 0));
  g.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.receiveShadow = true; });
  return g;
}
