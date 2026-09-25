import * as THREE from 'three';
import { M } from '../world/kit';
import { cel } from '../render/toon';
import { box } from '../core/util';
import { addOutline } from '../render/outline';
import { compact } from '../world/world';

/**
 * The kaiju: an invented beast (no existing monster) -- a round violet body on
 * two thick legs, a long segmented tail, a horned head, and a crest of spines
 * that glow teal.  Front toward -z, like the vehicles.  About 28 m tall.
 *
 * The body parts are compacted per material so the whole thing is a handful
 * of draw calls; the legs, tail and jaw are separate pivots so it can walk,
 * sway and roar.
 */
export interface KaijuBody {
  root: THREE.Group;
  body: THREE.Group; // sways
  legs: THREE.Group[]; // pivots at the hips, swing about X
  tail: THREE.Group; // pivot at the base, swings about Y
  jaw: THREE.Group; // pivot, opens about X
  glow: THREE.MeshToonMaterial; // spines + eyes; flashes when hit, blazes before a shot
  skin: THREE.MeshToonMaterial;
  bar: THREE.Group; // floating HP bar for VR (billboarded by the game)
  barFill: THREE.Mesh;
}

export function buildKaiju(): KaijuBody {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const skin = cel('#5a4478');
  const belly = M('#b8a0c8'), horn = M('#e8dcc8'), dark = M('#2a2238');
  const glow = cel('#3fd8c8');
  glow.emissive = new THREE.Color('#5ff0e0');
  glow.emissiveIntensity = 0.8;
  const blob = new THREE.IcosahedronGeometry(1, 2);
  const part = (mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(blob, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };
  // torso: a leaning egg, belly plates in front
  const torso = new THREE.Group();
  torso.add(part(skin, 0, 15, 0, 7, 8.5, 7.5));
  torso.add(part(belly, 0, 13.5, -4.2, 5, 6.5, 3.8));
  torso.add(part(skin, 0, 21, -2.5, 4.5, 4, 4.5)); // shoulders / neck
  // small arms
  for (const s of [-1, 1]) {
    torso.add(part(skin, s * 6, 17, -3, 1.6, 3.2, 1.6));
    torso.add(part(horn, s * 6.3, 13.8, -4.2, 0.6, 1, 0.9));
  }
  // spines along the back
  for (let i = 0; i < 7; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9 + (i < 3 ? i * 0.35 : (6 - i) * 0.35), 3.2 + (i < 3 ? i : 6 - i) * 0.8, 6), glow);
    cone.position.set(0, 22.5 - i * 1.9, -1 + i * 1.6);
    cone.rotation.x = 0.35 + i * 0.12;
    torso.add(cone);
  }
  body.add(compact(torso));
  // head with horns, eyes and a jaw
  const head = new THREE.Group();
  head.position.set(0, 24, -5);
  head.add(part(skin, 0, 0, -1, 3.2, 2.8, 3.8));
  head.add(part(skin, 0, 0.6, -3.8, 2.2, 1.6, 2.2)); // snout
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.4, 6), horn);
    h.position.set(s * 1.8, 2.8, 0);
    h.rotation.set(-0.5, 0, s * -0.35);
    head.add(h);
    head.add(part(glow, s * 1.5, 1.0, -3.3, 0.45, 0.35, 0.3)); // eyes
  }
  body.add(compact(head));
  const jaw = new THREE.Group();
  jaw.position.set(0, 22.8, -6);
  jaw.add(part(belly, 0, -0.4, -2.2, 1.9, 0.7, 2.4));
  for (const s of [-1, 1]) jaw.add(box(0.25, 0.6, 0.25, horn, s * 1.2, -0.1, -3.8));
  body.add(jaw);
  // legs
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 4.2, 11, 0.5);
    leg.add(part(skin, 0, -2.5, 0, 3, 4.5, 3.4)); // thigh
    leg.add(part(skin, 0, -7.5, 0.6, 2.3, 3.6, 2.4)); // shin
    leg.add(part(dark, 0, -10.4, -0.8, 3, 0.9, 3.8)); // foot
    for (const t of [-1, 0, 1]) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3, 5), horn);
      claw.position.set(t * 1.1, -10.6, -4.4);
      claw.rotation.x = -Math.PI / 2;
      leg.add(claw);
    }
    const c = compact(leg);
    body.add(c);
    legs.push(c);
  }
  // tail: five shrinking segments behind (+z), with glowing tips on the top
  const tail = new THREE.Group();
  tail.position.set(0, 9, 5);
  for (let i = 0; i < 6; i++) {
    const s = 3.6 - i * 0.5;
    tail.add(part(skin, 0, -i * 1.2, 2 + i * 3.6, s, s * 0.85, s * 1.3));
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 5), glow);
    sp.position.set(0, -i * 1.2 + s * 0.8, 2 + i * 3.6);
    sp.rotation.x = 0.6;
    tail.add(sp);
  }
  const tailC = compact(tail);
  body.add(tailC);
  addOutline(body);
  body.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.isOutline) { o.castShadow = true; } });

  // HP bar that floats above the head (what VR players read; the DOM gauge is desktop-only)
  const bar = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.4), new THREE.MeshBasicMaterial({ color: '#1a1830', transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
  const fillGeo = new THREE.PlaneGeometry(15.4, 0.9);
  fillGeo.translate(7.7, 0, 0); // grows from the left edge
  const barFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: '#ff5a7a', fog: false }));
  barFill.position.set(-7.7, 0, 0.01);
  bar.add(bg, barFill);
  bar.position.set(0, 34, 0);
  root.add(bar);
  return { root, body, legs, tail: tailC, jaw, glow, skin, bar, barFill };
}
