import * as THREE from 'three';

/**
 * Combat effects: glows, shockwave rings, sparks, beam bolts and saber trails.
 * Everything is additive and unlit, so it reads as light against the cel-shaded
 * city at any time of day, and none of it writes depth (the ink pass ignores it).
 *
 * Pools where it matters (sprites, sparks); bolts and trails are few at a time.
 */

let _glowTex: THREE.CanvasTexture | null = null;
/** Soft round glow: white core, falling off to nothing. */
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

const additive = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });

interface Flash { s: THREE.Sprite; age: number; life: number; size0: number; size1: number; alive: boolean }
interface Ring { m: THREE.Mesh; age: number; life: number; size: number; alive: boolean }
interface Spark { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; alive: boolean }

export interface Bolt {
  group: THREE.Group;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  from: THREE.Vector3;
  travelled: number;
  life: number;
  trail: THREE.Mesh;
  trailAge: number;
  done: boolean;
}

export class Fx {
  readonly group = new THREE.Group();
  private flashes: Flash[] = [];
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private nextFlash = 0;
  private nextRing = 0;
  private nextSpark = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camQ = new THREE.Quaternion();
  /** Beam bolt parts, shared. */
  private boltCore = new THREE.CylinderGeometry(0.28, 0.28, 1, 8, 1, true).rotateX(Math.PI / 2);
  private boltHalo = new THREE.CylinderGeometry(1.1, 0.6, 1, 10, 1, true).rotateX(Math.PI / 2);
  private boltCoreMat = additive('#ffffff', 1);
  private boltHaloMat = additive('#5fe8ff', 0.55);

  constructor() {
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ s, age: 0, life: 1, size0: 1, size1: 1, alive: false });
    }
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, additive('#bff6ff', 0.8));
      m.visible = false;
      this.group.add(m);
      this.rings.push({ m, age: 0, life: 1, size: 1, alive: false });
    }
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1), additive('#fff2c0', 1), 260);
    this.sparkMesh.frustumCulled = false;
    this.group.add(this.sparkMesh);
    for (let i = 0; i < 260; i++) { this.sparks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, alive: false }); this.sparkMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
    this.group.renderOrder = 10;
  }

  /** A glow that swells from size0 to size1 and fades over `life` seconds. */
  flash(at: THREE.Vector3, color: THREE.ColorRepresentation, size0: number, size1: number, life: number) {
    const f = this.flashes[this.nextFlash++ % this.flashes.length];
    f.alive = true; f.age = 0; f.life = life; f.size0 = size0; f.size1 = size1;
    f.s.position.copy(at);
    f.s.material.color.set(color);
    f.s.visible = true;
  }

  /** An expanding shockwave ring that faces the camera. */
  ring(at: THREE.Vector3, size: number, life: number, color: THREE.ColorRepresentation = '#bff6ff') {
    const r = this.rings[this.nextRing++ % this.rings.length];
    r.alive = true; r.age = 0; r.life = life; r.size = size;
    r.m.position.copy(at);
    (r.m.material as THREE.MeshBasicMaterial).color.set(color);
    r.m.visible = true;
  }

  /** Sparks sprayed from a point, biased along `normal`. */
  sparkBurst(at: THREE.Vector3, n: number, speed: number, normal?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.nextSpark++ % this.sparks.length];
      s.alive = true; s.age = 0; s.life = 0.25 + Math.random() * 0.45;
      s.p.copy(at);
      s.v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      if (normal) s.v.addScaledVector(normal, speed * 0.6);
    }
  }

  /** The whole impact: flash, ring, sparks.  `scale` 1 for a beam, more for a saber finisher. */
  impact(at: THREE.Vector3, scale = 1, color: THREE.ColorRepresentation = '#9ff4ff') {
    this.flash(at, '#ffffff', 3 * scale, 14 * scale, 0.22);
    this.flash(at, color, 8 * scale, 26 * scale, 0.45);
    this.ring(at, 18 * scale, 0.45, color);
    this.sparkBurst(at, Math.round(18 * scale), 40 * scale);
  }

  /** Muzzle flash at the rifle. */
  muzzle(at: THREE.Vector3, dir: THREE.Vector3) {
    this.flash(at, '#ffffff', 2, 7, 0.12);
    this.flash(this.v.copy(at).addScaledVector(dir, 2), '#5fe8ff', 4, 11, 0.2);
    this.ring(at, 6, 0.2, '#9ff4ff');
  }

  /** A travelling beam bolt: white core in a cyan halo, a glow at the head, a fading line back to the muzzle. */
  bolt(from: THREE.Vector3, dir: THREE.Vector3): Bolt {
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.boltCore, this.boltCoreMat);
    const halo = new THREE.Mesh(this.boltHalo, this.boltHaloMat);
    core.scale.set(1, 1, 16);
    halo.scale.set(1, 1, 20);
    core.position.z = -8;
    halo.position.z = -10;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bff8ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    head.scale.setScalar(9);
    group.add(core, halo, head);
    group.position.copy(from);
    group.lookAt(this.v.copy(from).add(dir)); // +z forward: the head is at the origin, core and halo trail along -z
    this.group.add(group);
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), additive('#7feeff', 0.5));
    trail.position.copy(from);
    trail.lookAt(this.v.copy(from).add(dir));
    this.group.add(trail);
    return { group, pos: from.clone(), dir: dir.clone(), from: from.clone(), travelled: 0, life: 3, trail, trailAge: 0, done: false };
  }

  /** Move a bolt's visuals to its position. */
  placeBolt(b: Bolt, dt: number) {
    b.group.position.copy(b.pos);
    b.trailAge += dt;
    const len = b.pos.distanceTo(b.from);
    b.trail.scale.set(1, 1, Math.max(0.01, len));
    (b.trail.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.max(0, 1 - b.trailAge / 0.35);
  }

  removeBolt(b: Bolt) {
    b.group.removeFromParent();
    ((b.group.children[2] as THREE.Sprite).material as THREE.Material).dispose();
    b.trail.removeFromParent();
    b.trail.geometry.dispose();
    (b.trail.material as THREE.Material).dispose();
  }

  update(dt: number, camera: THREE.Camera) {
    camera.getWorldPosition(this.camPos);
    camera.getWorldQuaternion(this.camQ);
    for (const f of this.flashes) {
      if (!f.alive) continue;
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { f.alive = false; f.s.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      f.s.scale.setScalar(f.size0 + (f.size1 - f.size0) * e);
      f.s.material.opacity = (1 - k) * (1 - k);
    }
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) { r.alive = false; r.m.visible = false; continue; }
      r.m.scale.setScalar(r.size * (0.2 + 0.8 * Math.sqrt(k)));
      r.m.quaternion.copy(this.camQ);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    const up = this.v.set(0, 0, 1);
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      if (!s.alive) continue;
      s.age += dt;
      if (s.age > s.life) { s.alive = false; this.sparkMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      s.v.y -= 30 * dt;
      s.p.addScaledVector(s.v, dt);
      const speed = s.v.length();
      this.q.setFromUnitVectors(up, _dir.copy(s.v).divideScalar(Math.max(0.001, speed)));
      const len = Math.min(6, speed * 0.05) * (1 - s.age / s.life);
      this.m.compose(s.p, this.q, _sc.set(1.2, 1.2, Math.max(0.01, len)));
      this.sparkMesh.setMatrixAt(i, this.m);
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }
}

const _dir = new THREE.Vector3(), _sc = new THREE.Vector3();

/**
 * The fading ribbon a saber blade leaves: keeps the last few (base, tip)
 * samples and draws them as a strip, brightest at the newest edge.
 */
export class SaberTrail {
  readonly mesh: THREE.Mesh;
  private samples: { a: THREE.Vector3; b: THREE.Vector3; age: number }[] = [];
  private readonly max = 14;
  private pos: Float32Array;
  private col: Float32Array;
  private tint = new THREE.Color('#ff5ab8');

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 2 * 3);
    this.col = new Float32Array(this.max * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
  }

  /** Add a sample while the blade is swinging; call `update` every frame either way. */
  push(base: THREE.Vector3, tip: THREE.Vector3) {
    this.samples.unshift({ a: base.clone(), b: tip.clone(), age: 0 });
    if (this.samples.length > this.max) this.samples.pop();
  }

  update(dt: number) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > 0.22) this.samples.pop();
    const n = this.samples.length;
    for (let i = 0; i < this.max; i++) {
      const s = this.samples[Math.min(i, Math.max(0, n - 1))];
      const k = n ? Math.max(0, 1 - s.age / 0.22) * (1 - i / this.max) : 0;
      for (const [j, p] of [[0, s?.a], [1, s?.b]] as const) {
        const o = (i * 2 + j) * 3;
        if (p) this.pos.set([p.x, p.y, p.z], o);
        // the tip edge glows, the base edge fades: an arc of light rather than a flat sheet
        const w = j ? k : k * 0.25;
        this.col.set([this.tint.r * w, this.tint.g * w, this.tint.b * w], o);
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = n > 1;
  }
}
