import * as THREE from 'three';
import type { SeasonPalette } from '../render/palette';
import { rng } from '../core/util';

/**
 * One seasonal particle field that travels with the camera: petals in spring,
 * fireflies on summer nights, leaves in autumn, snow in winter.  All motion is
 * in the vertex shader (wrap-around in a box round the camera), so it costs one
 * draw call and nothing on the CPU.
 */
export class SeasonalParticles {
  readonly points: THREE.Points | null = null;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color() },
    uOpacity: { value: 1 },
    uSize: { value: 1 },
    uFireflies: { value: 0 },
    uBox: { value: new THREE.Vector3(70, 24, 70) },
  };
  private kind: SeasonPalette['particles'];

  constructor(pal: SeasonPalette) {
    this.kind = pal.particles;
    if (this.kind === 'none') return;
    const fire = this.kind === 'fireflies';
    const count = fire ? 260 : this.kind === 'snow' ? 1400 : 500;
    const r = rng(11);
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([r.next(), r.next(), r.next()], i * 3);
      seed[i] = r.next();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms.uColor.value.set(pal.particleColor);
    this.uniforms.uFireflies.value = fire ? 1 : 0;
    this.uniforms.uSize.value = fire ? 5 : this.kind === 'snow' ? 3.2 : 4.2;
    if (fire) this.uniforms.uBox.value.set(60, 3, 60);
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uTime, uSize, uFireflies;
        uniform vec3 uCam, uBox;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position * uBox;
          if (uFireflies > 0.5) {
            p += vec3(sin(uTime * 0.4 + aSeed * 40.0), sin(uTime * 0.7 + aSeed * 17.0) * 0.4, cos(uTime * 0.33 + aSeed * 23.0)) * 1.5;
            p.y += 0.4;
            vA = smoothstep(0.2, 1.0, sin(uTime * (1.2 + aSeed) + aSeed * 30.0));
          } else {
            float fall = uTime * (0.6 + aSeed * 0.8);
            p += vec3(sin(uTime * 0.5 + aSeed * 30.0) * 1.2 + uTime * 0.6, -fall, cos(uTime * 0.4 + aSeed * 12.0) * 1.2);
            vA = 1.0;
          }
          // wrap into a box centred on the camera
          vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 world = uCam + rel;
          if (uFireflies > 0.5) world.y = p.y;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          gl_PointSize = uSize * (18.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity, uFireflies;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = uFireflies > 0.5 ? smoothstep(0.5, 0.0, d) : step(d, 0.42);
          gl_FragColor = vec4(uColor, a * vA * uOpacity);
          if (gl_FragColor.a < 0.01) discard;
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    (this as { points: THREE.Points | null }).points = pts;
  }

  update(time: number, cam: THREE.Vector3, daylight: number) {
    if (!this.points) return;
    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(cam);
    // fireflies only after dark; everything else always
    this.uniforms.uOpacity.value = this.kind === 'fireflies' ? 1 - daylight : 1;
    this.points.visible = this.uniforms.uOpacity.value > 0.01;
  }
}
