import * as THREE from 'three';

/**
 *   scene -> rt (colour + depth texture, supersampled)
 *         -> final pass: ink from depth, colour grade, vignette, sRGB -> screen
 *
 * Ink comes from the *second difference* of linearised depth.  A first
 * difference smears ink across any surface that grazes the camera (a road seen
 * from eye height); the second difference is ~0 across every plane however
 * oblique, so it fires only on silhouettes and creases.  Positive curvature
 * (near side of a silhouette, a ridge) inks strongly; negative (inside corners)
 * faintly, like an animator's lighter contact lines.  Lines fade with distance
 * so the background stays quiet.
 *
 * The scene target is *supersampled* (1.5x) rather than MSAA: a multisampled
 * target does not resolve into its depth texture in WebGL here, so MSAA left the
 * ink pass reading depth = 1 everywhere -- no lines, no error.
 *
 * In VR the post pass is skipped entirely (stereo + frame budget), so the look
 * there rests on cel materials and inverted-hull outlines alone.
 */

const _fwd = new THREE.Vector3(), _sp = new THREE.Vector3();

export interface GradeParams {
  shadowTone: THREE.Color; // added to the darks
  highlightTone: THREE.Color; // multiplied into the lights
  lift: number; // raises the blacks
  saturation: number;
  vignette: number;
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly rt: THREE.WebGLRenderTarget;
  inkOn = true;
  /** Sun glare: set from the clock each frame (main.ts). */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color('#fff0d0');
  sunStrength = 0;
  glareOn = true;
  /** Draw calls of the scene pass alone (renderer.info only keeps the last pass: the post quad). */
  sceneCalls = 0;
  /** internal resolution relative to the canvas; the final pass filters it down */
  scale = 1.5;
  gradeOn = true;
  readonly grade: GradeParams = {
    shadowTone: new THREE.Color('#2a2046'),
    highlightTone: new THREE.Color('#fff4e2'),
    lift: 0.035,
    saturation: 1.05,
    vignette: 0.22,
  };
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.depthTexture = new THREE.DepthTexture(2, 2);
    this.rt.depthTexture.type = THREE.UnsignedIntType;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uInk: { value: 1 },
        uInkColor: { value: new THREE.Color('#2a2c52') }, // navy, not black: thin painted lines
        uInkFade: { value: new THREE.Vector2(28, 110) },
        uGrade: { value: 1 },
        uShadowTone: { value: this.grade.shadowTone },
        uHighlightTone: { value: this.grade.highlightTone },
        uLift: { value: this.grade.lift },
        uSat: { value: this.grade.saturation },
        uVignette: { value: this.grade.vignette },
        uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
        uSunGlow: { value: 0 },
        uSunCol: { value: this.sunColor },
        uAspect: { value: 16 / 9 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar, uInk, uGrade, uLift, uSat, uVignette;
        uniform vec3 uInkColor, uShadowTone, uHighlightTone;
        uniform vec2 uInkFade;
        uniform vec2 uSunUv;
        uniform float uSunGlow, uAspect;
        uniform vec3 uSunCol;
        varying vec2 vUv;

        float lin(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }

        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;

          if (uInk > 0.5) {
            float c = lin(vUv);
            vec2 dx = vec2(uTexel.x * 2.0, 0.0), dy = vec2(0.0, uTexel.y * 2.0); // ~1.3 screen px at 1.5x
            // second differences along both axes and both diagonals
            float s1 = lin(vUv - dx) + lin(vUv + dx) - 2.0 * c;
            float s2 = lin(vUv - dy) + lin(vUv + dy) - 2.0 * c;
            float s3 = lin(vUv - dx - dy) + lin(vUv + dx + dy) - 2.0 * c;
            float s4 = lin(vUv - dx + dy) + lin(vUv + dx - dy) - 2.0 * c;
            float pos = max(max(s1, s2), max(s3, s4)) / c;
            float neg = -min(min(s1, s2), min(s3, s4)) / c;
            float ink = smoothstep(0.018, 0.05, pos) + 0.4 * smoothstep(0.03, 0.08, neg);
            ink *= 1.0 - smoothstep(uInkFade.x, uInkFade.y, c);
            col = mix(col, uInkColor, clamp(ink, 0.0, 1.0) * 0.62);
          }

          // Shinkai glare: a bloom round the sun and faint ghosts across the frame,
          // gated by how much of the sun's disc is open sky in the depth buffer
          if (uSunGlow > 0.001) {
            float open = 0.0;
            for (float oy = -1.0; oy <= 1.0; oy += 1.0)
              for (float ox = -1.0; ox <= 1.0; ox += 1.0)
                open += step(0.99999, texture2D(tDepth, clamp(uSunUv + vec2(ox, oy) * vec2(0.010, 0.010 * uAspect), 0.001, 0.999)).x);
            open /= 9.0;
            vec2 sd = vUv - uSunUv; sd.x *= uAspect;
            float d = length(sd);
            float g = exp(-d * 7.0) * 0.6 + exp(-d * 2.2) * 0.22;
            vec2 axis = vec2(0.5) - uSunUv;
            vec3 ghosts = vec3(0.0);
            for (float k = 1.0; k <= 3.0; k += 1.0) {
              vec2 gp = uSunUv + axis * (0.55 + 0.5 * k);
              vec2 gd = vUv - gp; gd.x *= uAspect;
              float ring = smoothstep(0.035 * k + 0.02, 0.0, length(gd));
              ghosts += ring * 0.07 * vec3(0.6 + 0.4 * k / 3.0, 0.8, 1.2 - 0.3 * k / 3.0);
            }
            float onScreen = smoothstep(0.35, 0.0, max(max(-uSunUv.x, uSunUv.x - 1.0), max(-uSunUv.y, uSunUv.y - 1.0)));
            col += (uSunCol * g + ghosts * uSunCol) * uSunGlow * open * onScreen;
          }

          if (uGrade > 0.5) {
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(l), col, uSat);
            // split tone: violet into the darks, warm paper into the lights
            col += uShadowTone * (1.0 - smoothstep(0.0, 0.45, l)) * 0.35;
            col *= mix(vec3(1.0), uHighlightTone, smoothstep(0.35, 1.0, l));
            col = col * (1.0 - uLift) + uLift * vec3(0.55, 0.5, 0.62);
            vec2 v = vUv - 0.5;
            col *= 1.0 - uVignette * dot(v, v) * 1.6;
          }

          gl_FragColor = vec4(max(col, 0.0), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    // cap the target near 4K so a 2x-DPI screen does not ask for 6K
    const s = Math.min(this.scale * pr, Math.sqrt((3840 * 2160) / Math.max(1, w * h)));
    const W = Math.max(2, Math.floor(w * s));
    const H = Math.max(2, Math.floor(h * s));
    this.rt.setSize(W, H);
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / W, 1 / H);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    if (r.xr.isPresenting) {
      // VR: straight to the headset, no post (see header)
      r.setRenderTarget(null);
      r.render(scene, camera);
      this.sceneCalls = r.info.render.calls;
      return;
    }
    const u = this.mat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uInk.value = this.inkOn ? 1 : 0;
    u.uGrade.value = this.gradeOn ? 1 : 0;
    u.uLift.value = this.grade.lift;
    u.uSat.value = this.grade.saturation;
    u.uVignette.value = this.grade.vignette;
    // where the sun lands on screen, and whether it is in front of the camera at all
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.getWorldDirection(_fwd);
    const facing = _fwd.dot(this.sunDir);
    if (this.glareOn && this.sunStrength > 0 && facing > 0.05) {
      camera.getWorldPosition(_sp).addScaledVector(this.sunDir, 1000).project(camera);
      (u.uSunUv.value as THREE.Vector2).set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
      u.uSunGlow.value = this.sunStrength * Math.min(1, facing * 3);
    } else u.uSunGlow.value = 0;
    u.uAspect.value = camera.aspect;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    this.sceneCalls = r.info.render.calls;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
