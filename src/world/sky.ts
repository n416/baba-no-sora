import * as THREE from 'three';
import { cel } from '../render/toon';
import { PAL } from '../render/palette';
import { rng } from '../core/util';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Gradient dome with a sun disc and night stars, cel cumulus built from
 * clustered blobs, and a ring of far hills in atmospheric colour.  Everything
 * here follows the camera, so it can never be walked up to.
 */
/** Radial alpha falloff for the soft cloudlets: a solid core and a feathered rim. */
function softDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, '#d8d8d8');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Sky {
  readonly group = new THREE.Group();
  readonly uniforms = {
    uZenith: { value: new THREE.Color('#2f7fd0') },
    uHorizon: { value: new THREE.Color('#dff0f4') },
    uGround: { value: new THREE.Color('#b8c8c8') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#fff2c8') },
    uSunVis: { value: 1 },
    uStars: { value: 0 },
  };
  readonly cloudMat = cel(PAL.cloud, { ramp: 'soft', fog: false });
  /** The high sheet takes the sunset first and longest, so it gets its own, pinker material. */
  readonly cloudLowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false, vertexColors: true });
  readonly cloudHighMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, alphaMap: softDisc() });
  readonly hillMat: THREE.MeshBasicMaterial;
  readonly hillNearMat: THREE.MeshBasicMaterial;

  constructor() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww; // pin to the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir;
          uniform float uSunVis, uStars;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.55));
            col = mix(uGround, col, smoothstep(-0.08, 0.0, h));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            col += uSunColor * (pow(s, 12.0) * 0.35 + pow(s, 180.0) * 0.6) * uSunVis;
            col = mix(col, uSunColor * 1.4, smoothstep(0.9994, 0.9997, s) * uSunVis);
            if (uStars > 0.0 && h > 0.0) {
              vec3 cell = floor(d * 220.0);
              float r = hash(cell);
              float star = step(0.9975, r) * smoothstep(0.0, 0.25, h);
              col += vec3(star) * uStars * (0.6 + 0.4 * hash(cell + 1.0));
            }
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // --- clouds: everything merged into two meshes (two draw calls) -----------
    const r = rng(7);
    const blob = new THREE.IcosahedronGeometry(1, 2);
    const cum: THREE.BufferGeometry[] = [];
    // a few far cumulus banks low on the horizon
    for (let i = 0; i < 12; i++) {
      const a = r.range(0, Math.PI * 2);
      const dist = r.range(800, 1150);
      const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist, cy = r.range(120, 220);
      const n = 6 + Math.floor(r.next() * 7);
      const rot = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2);
      for (let j = 0; j < n; j++) {
        const s = r.range(16, 34) * (j === 0 ? 1.3 : 1);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(r.range(-70, 70), r.range(0, 18) + (j < 4 ? 0 : 12), r.range(-22, 22)).applyMatrix4(rot).add(new THREE.Vector3(cx, cy, cz)),
          new THREE.Quaternion(), new THREE.Vector3(s * 1.3, s * r.range(0.5, 0.7), s));
        cum.push(blob.clone().applyMatrix4(m));
      }
    }
    const cumGeo = mergeGeometries(cum.map((g) => g.toNonIndexed()))!;
    // bright tops, shaded bellies: the gradient is baked into vertex colours
    const cp = cumGeo.attributes.position as THREE.BufferAttribute;
    const cc = new Float32Array(cp.count * 3);
    for (let i = 0; i < cp.count; i++) {
      const k = THREE.MathUtils.smoothstep(cp.getY(i), 120, 200);
      const v = 0.72 + 0.28 * k;
      cc.set([v * 0.96, v * 0.95, v], i * 3);
    }
    cumGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const cumulus = new THREE.Mesh(cumGeo, this.cloudLowMat);
    cumulus.frustumCulled = false;
    this.group.add(cumulus);
    // autumn "iwashi-gumo": fish-scale rows of soft discs seen from below, in patches
    const disc = new THREE.CircleGeometry(1, 10).rotateX(Math.PI / 2); // faces down
    const sheet: THREE.BufferGeometry[] = [];
    // scattered clusters rather than a lattice: each cluster is a few ragged rows of
    // overlapping scales, so it reads as one textured patch of sky
    for (let c = 0; c < 22; c++) {
      const cx = r.range(-800, 800), cz = r.range(-800, 500);
      const ang = r.range(-0.5, 0.5) + 0.3; // rows run roughly WSW-ENE
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rows = Math.floor(r.range(3, 9)), len = r.range(120, 320);
      for (let row = 0; row < rows; row++) {
        const v = (row - rows / 2) * r.range(22, 30);
        const taper = 1 - Math.abs(row - rows / 2) / (rows / 2 + 1);
        for (let u = -len / 2 * taper; u < len / 2 * taper; u += r.range(14, 22)) {
          const x = cx + u * ca - v * sa + r.range(-4, 4), z = cz + u * sa + v * ca + r.range(-4, 4);
          const edge = Math.hypot(x / 950, (z + 150) / 800);
          if (edge > 1) continue;
          const sx = r.range(13, 22) * (0.6 + 0.4 * taper), sz = sx * r.range(0.55, 0.75);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 560 - edge * 120 + r.range(-6, 6), z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang + r.range(-0.2, 0.2)), new THREE.Vector3(sx, 1, sz));
          sheet.push(disc.clone().applyMatrix4(m));
        }
      }
    }
    const iwashi = new THREE.Mesh(mergeGeometries(sheet)!, this.cloudHighMat);
    iwashi.frustumCulled = false;
    this.group.add(iwashi);

    // --- the far city: two rings of blocky skyline, and Shinjuku's towers to the south
    this.hillMat = new THREE.MeshBasicMaterial({ color: PAL.hillFar, fog: false });
    this.hillNearMat = new THREE.MeshBasicMaterial({ color: PAL.hillFar, fog: false });
    this.group.add(this.skyline(1300, 38, 11, this.hillMat, 1.6), this.skyline(950, 26, 23, this.hillNearMat, 2.4), this.skyline(800, 30, 31, this.hillNearMat, 3.2));
    this.group.add(this.towers(this.hillMat));
  }

  /** A ring of flat-topped silhouettes: a city horizon rather than hills. */
  private skyline(radius: number, height: number, seed: number, mat: THREE.Material, stepDeg: number) {
    const r = rng(seed);
    const pos: number[] = [], idx: number[] = [];
    let a = 0, v = 0;
    const quad = (a0: number, a1: number, h: number) => {
      const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius, x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
      pos.push(x0, -2, z0, x1, -2, z1, x0, h, z0, x1, h, z1);
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 4;
    };
    while (a < Math.PI * 2) {
      const w = (stepDeg * r.range(0.4, 1.6) * Math.PI) / 180;
      const tall = r.chance(0.12) ? r.range(1.6, 2.6) : 1;
      quad(a, Math.min(Math.PI * 2, a + w), height * r.range(0.35, 1) * tall);
      a += w;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    (m.material as THREE.Material).side = THREE.DoubleSide;
    m.frustumCulled = false;
    return m;
  }

  /** Shinjuku's high-rise cluster, ~2.5 km south (+z): a handful of tall slabs on the far ring. */
  private towers(mat: THREE.Material) {
    const r = rng(5);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 16; i++) {
      const a = Math.PI / 2 + r.range(-0.2, 0.2); // due south
      const d = r.range(1180, 1260);
      const h = r.range(120, 260) * (i < 3 ? 1.25 : 1);
      const w = r.range(18, 40);
      const gb = new THREE.BoxGeometry(w, h + 40, w * r.range(0.5, 1));
      gb.translate(Math.cos(a) * d, h / 2 - 20, Math.sin(a) * d);
      parts.push(gb);
    }
    // a twin-spired tower, the cluster's landmark (invented shape)
    const spire = new THREE.BoxGeometry(30, 300, 26);
    spire.translate(Math.cos(Math.PI / 2 + 0.05) * 1210, 130, Math.sin(Math.PI / 2 + 0.05) * 1210);
    parts.push(spire);
    for (const o of [-8, 8]) {
      const t = new THREE.BoxGeometry(9, 40, 9);
      t.translate(Math.cos(Math.PI / 2 + 0.05) * 1210 + o, 300, Math.sin(Math.PI / 2 + 0.05) * 1210);
      parts.push(t);
    }
    const m = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed()))!, mat);
    m.frustumCulled = false;
    return m;
  }

  follow(camPos: THREE.Vector3) {
    // x/z only: the far skyline must stay on the ground when flying, or it floats as a band
    this.group.position.set(camPos.x, 0, camPos.z);
  }
}
