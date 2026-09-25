import * as THREE from 'three';

/**
 * Boost effect, hung on the camera: speed lines streaming out from the middle of
 * the view toward the edges, and a pale glow closing in from the screen's rim.
 * Both live in the scene (not the post pass), so they also show in VR -- there
 * at half strength, and the lines keep out of the middle of the view.
 */
const N = 56;
/** Streaks start this far ahead and fly past the camera. */
const Z_FAR = 34, Z_NEAR = 2;
/** A streak only shows once it is this far off the view axis (keeps the centre clear). */
const MIN_ANGLE = THREE.MathUtils.degToRad(16);

export class SpeedFx {
  private readonly lines: THREE.InstancedMesh;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly rim: THREE.Mesh;
  private readonly lineMat: THREE.ShaderMaterial;
  private readonly rimMat: THREE.ShaderMaterial;
  private readonly seeds: { a: number; r: number; z: number; v: number }[] = [];
  private level = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    geo.setAttribute('aAlpha', this.alpha);
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA; varying vec2 vUv;
        void main() {
          vA = aAlpha; vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vA; varying vec2 vUv;
        void main() {
          // bright head (the near end, uv.y = 0), long fading tail, soft sides
          float y = 1.0 - vUv.y;
          float along = pow(y, 1.6) * smoothstep(1.0, 0.85, y);
          float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
          gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), uOpacity * vA * along * across);
        }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.InstancedMesh(geo, this.lineMat, N);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 998;
    for (let i = 0; i < N; i++) this.seeds.push({ a: Math.random() * Math.PI * 2, r: 3 + Math.random() * 3, z: -Math.random() * Z_FAR, v: 0.7 + Math.random() * 0.6 });

    this.rimMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      // an oversized plane; the glow is worked out from where each pixel lands on screen,
      // so it fits whatever size and aspect the view is rendered at
      vertexShader: /* glsl */ `
        varying vec4 vClip; varying float vAspect;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vClip = gl_Position;
          vAspect = projectionMatrix[1][1] / projectionMatrix[0][0];
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec4 vClip; varying float vAspect;
        void main() {
          vec2 d = vClip.xy / vClip.w; d.x *= vAspect;
          float r = length(d) / length(vec2(vAspect, 1.0));
          float a = smoothstep(0.55, 1.0, r);
          gl_FragColor = vec4(vec3(0.8, 0.92, 1.0), uOpacity * a);
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.rim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.rimMat);
    this.rim.position.z = -1;
    this.rim.scale.setScalar(20); // far wider than any view at 1 m
    this.rim.frustumCulled = false;
    this.rim.renderOrder = 999;
    camera.add(this.lines, this.rim);
    this.lines.visible = this.rim.visible = false;
  }

  /**
   * `want` 0..1: how hard the machine is boosting.  `vel`: its velocity in the
   * camera's frame (m/s) -- the lines stream out of the point it is heading for
   * (ahead, off to the side, above...), not always out of the middle of the view.
   */
  update(dt: number, want: number, vel: THREE.Vector3, vr: boolean) {
    const speed = vel.length();
    if (speed > 1.5) {
      _q.setFromUnitVectors(_fwd, _d.copy(vel).divideScalar(speed));
      this.lines.quaternion.slerp(_q, Math.min(1, dt * 8));
    }
    this.level += (want - this.level) * Math.min(1, dt * (want > this.level ? 5 : 2.5));
    const on = this.level > 0.01;
    this.lines.visible = on;
    this.rim.visible = on && !vr;
    if (!on) return;
    const k = this.level * (vr ? 0.5 : 1);
    this.lineMat.uniforms.uOpacity.value = 0.55 * k;
    this.rimMat.uniforms.uOpacity.value = 0.22 * k;
    const flow = (25 + speed * 2.2) * dt;
    const len = 3 + 7 * this.level;
    for (let i = 0; i < N; i++) {
      const s = this.seeds[i];
      s.z += flow * s.v;
      if (s.z > -Z_NEAR) { s.z = -Z_FAR * (0.7 + Math.random() * 0.3); s.a = Math.random() * Math.PI * 2; s.r = 3 + Math.random() * 3; }
      const ang = Math.atan2(s.r, -s.z);
      const vis = Math.min(1, Math.max(0, (ang - MIN_ANGLE) / 0.15)) * Math.min(1, (s.z + Z_FAR) / 6);
      this.alpha.setX(i, vis);
      // (in the lines' own frame, whose -z is the direction of travel)
      // length along the travel axis, width across the radial direction
      this.p.set(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, s.z - len / 2);
      this.q.copy(_lay).premultiply(_spin.setFromAxisAngle(_z, s.a + Math.PI / 2));
      this.s.set(0.07, len, 1);
      this.m.compose(this.p, this.q, this.s);
      this.lines.setMatrixAt(i, this.m);
    }
    this.lines.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
const _z = new THREE.Vector3(0, 0, 1);
const _fwd = new THREE.Vector3(0, 0, -1), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
/** The quad's length (y) laid along -z; then spun so its width runs round the view axis. */
const _lay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _spin = new THREE.Quaternion();
