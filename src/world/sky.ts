import * as THREE from 'three';
import { cel } from '../render/toon';
import { PAL } from '../render/palette';
import { rng } from '../core/util';

/**
 * Gradient dome with a sun disc and night stars, cel cumulus built from
 * clustered blobs, and a ring of far hills in atmospheric colour.  Everything
 * here follows the camera, so it can never be walked up to.
 */
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

    // --- cumulus: clusters of blobs, flattened underneath ----------------------
    const r = rng(7);
    const blob = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const n = 6 + Math.floor(r.next() * 7);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(blob, this.cloudMat);
        const s = r.range(18, 38) * (j === 0 ? 1.3 : 1);
        m.scale.set(s, s * r.range(0.7, 0.95), s);
        m.position.set(r.range(-45, 45), r.range(0, 30) + (j < 3 ? 0 : 18), r.range(-20, 20));
        cloud.add(m);
      }
      const a = r.range(0, Math.PI * 2);
      const dist = r.range(650, 1100);
      cloud.position.set(Math.cos(a) * dist, r.range(170, 330), Math.sin(a) * dist);
      cloud.lookAt(0, cloud.position.y, 0);
      this.group.add(cloud);
    }

    // --- far hills: two rings of soft ridges in haze colour -------------------
    this.hillMat = new THREE.MeshBasicMaterial({ color: PAL.hillFar, fog: false });
    this.hillNearMat = new THREE.MeshBasicMaterial({ color: PAL.hillFar, fog: false });
    this.group.add(this.ridge(1300, 120, 11, this.hillMat), this.ridge(900, 70, 23, this.hillNearMat));
  }

  private ridge(radius: number, height: number, seed: number, mat: THREE.Material) {
    const r = rng(seed);
    const seg = 256;
    const pos: number[] = [];
    const phase = [r.range(0, 6), r.range(0, 6), r.range(0, 6)];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const h =
        height *
        (0.45 +
          0.3 * Math.sin(a * 3 + phase[0]) +
          0.18 * Math.sin(a * 7 + phase[1]) +
          0.07 * Math.sin(a * 17 + phase[2]));
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      pos.push(x, -40, z, x, Math.max(8, h), z);
    }
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    (m.material as THREE.Material).side = THREE.DoubleSide;
    m.frustumCulled = false;
    return m;
  }

  follow(camPos: THREE.Vector3) {
    this.group.position.set(camPos.x, 0, camPos.z);
  }
}
