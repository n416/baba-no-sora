import * as THREE from 'three';

/**
 * Boost effect: manga-style focus lines (集中線) centred on the robot.
 *
 * A screen-space shader on an oversized plane hung in front of the camera.  The
 * robot's world position is projected in the vertex shader with the camera
 * being rendered, so the lines centre on the robot wherever it is on screen --
 * and per eye in VR.  Thin radial lines stream outward from the robot; a clear
 * disc round it keeps the machine itself unobstructed, and the lines thicken
 * toward the screen's edges.  A pale rim glow closes in with them (desktop only).
 */
export class SpeedFx {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private level = 0;
  private t = 0;

  constructor(camera: THREE.Camera) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uLines: { value: 0 },
        uRim: { value: 0 },
        uTime: { value: 0 },
        uClear: { value: 0.22 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uCenter;
        varying vec4 vClip; varying vec2 vCenter; varying float vAspect;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vClip = gl_Position;
          vec4 c = projectionMatrix * viewMatrix * vec4(uCenter, 1.0);
          vCenter = c.w > 0.0 ? c.xy / c.w : vec2(0.0);
          vAspect = projectionMatrix[1][1] / projectionMatrix[0][0];
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLines, uRim, uTime, uClear;
        varying vec4 vClip; varying vec2 vCenter; varying float vAspect;
        float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        void main() {
          vec2 ndc = vClip.xy / vClip.w;
          vec2 d = ndc - vCenter; d.x *= vAspect;
          float r = length(d);
          float ang = atan(d.y, d.x) / 6.2831853 + 0.5;       // 0..1 round the robot
          // lines: 150 angular slots, about a third of them lit, each re-rolled now and then
          float N = 220.0;
          float slot = floor(ang * N);
          float epoch = floor(uTime * 3.0 + hash(slot) * 7.0);
          float h = hash(slot + epoch * 17.0);
          float lit = step(0.72, h);
          float across = abs(fract(ang * N) - 0.5) * 2.0;        // 0 at the slot's centre line
          float width = mix(0.04, 0.2, smoothstep(0.2, 1.6, r)) * (0.6 + h);   // hairline near the robot, a little wider out
          float line = lit * smoothstep(width, width * 0.4, across);
          // dashes streaming outward
          // long strokes streaming outward, a sharp head and a fading tail
          float s = fract(r * (0.45 + 0.3 * h) - uTime * (0.9 + h * 0.8) + h * 5.0);
          float dash = smoothstep(0.0, 0.04, s) * smoothstep(0.85, 0.2, s);
          // keep the robot clear; strongest toward the edges
          float clear = smoothstep(uClear, uClear + 0.35, r);
          float a = uLines * line * dash * clear * (0.35 + 0.65 * smoothstep(0.3, 1.2, r));
          // rim glow from the screen's edge
          vec2 e = ndc; e.x *= vAspect;
          float rim = uRim * smoothstep(0.55, 1.0, length(e) / length(vec2(vAspect, 1.0)));
          gl_FragColor = vec4(vec3(0.88, 0.96, 1.0), clamp(a + rim, 0.0, 1.0));
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.position.z = -1;
    this.mesh.scale.setScalar(20); // far wider than any view at 1 m
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  /**
   * `want` 0..1: how hard the machine is boosting.  `center`: the robot (world),
   * the lines' focus.  `size`: radius of the clear disc round it (in units of
   * half the screen height).
   */
  update(dt: number, want: number, center: THREE.Vector3, vr: boolean, size = 0.4) {
    this.level += (want - this.level) * Math.min(1, dt * (want > this.level ? 5 : 2.5));
    const on = this.level > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    this.t += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.t;
    u.uCenter.value.copy(center);
    u.uLines.value = 0.6 * this.level * (vr ? 0.5 : 1);
    u.uRim.value = vr ? 0 : 0.2 * this.level;
    u.uClear.value = size;
  }
}
