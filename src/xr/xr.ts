import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import type { Player, DriveInput } from '../player/player';
import type { TimeOfDay } from '../world/timeofday';
import { clamp, JP_FONT } from '../core/util';

/**
 * WebXR: seated, first person, horizon always level.
 *
 * Comfort rules this module keeps, because nausea is the one bug nobody forgives:
 *  - the vehicle's bank never reaches the head -- the rig only yaws;
 *  - turning on foot is snap turn (30 deg); on a vehicle the heading turns
 *    smoothly because the machine does, so a speed-scaled vignette narrows the view;
 *  - acceleration comes from the vehicle spec, which is already gentle.
 *
 * Controls (xr-standard mapping):
 *   right trigger  throttle / walk forward     left trigger   brake
 *   right stick    steer (ride) / snap turn     left stick     walk / climb-descend in the air
 *   right stick up at take-off speed: pull up and fly
 *   A              get on / off                 B              recentre
 *   X tap          timelapse on / off           X hold         sightseeing flight on / off
 *   left grip + left stick up/down: scrub the clock
 * The wrist clock shows the altitude while flying.
 */
export class XRSupport {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: Player;
  readonly tod: TimeOfDay;
  comfortVignette = true;
  private headRef = new THREE.Vector3(0, 1.2, 0);
  private needRecentre = true;
  private prevButtons = new Map<string, boolean>();
  private snapReady = true;
  private vignette: THREE.Mesh;
  private vignetteU = { uStrength: { value: 0 } };
  private wrist: THREE.Mesh;
  private wristCtx: CanvasRenderingContext2D;
  private wristTex: THREE.CanvasTexture;
  private wristLabel = '';
  private leftGrip: THREE.Group | null = null;
  private sessionListeners: ((on: boolean) => void)[] = [];
  private cruiseListeners: (() => void)[] = [];
  private xHeld = 0;

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Group, camera: THREE.PerspectiveCamera, player: Player, tod: TimeOfDay) {
    this.renderer = renderer;
    this.rig = rig;
    this.camera = camera;
    this.player = player;
    this.tod = tod;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(1.0);

    if ('xr' in navigator) {
      const btn = VRButton.createButton(renderer);
      btn.id = 'vr-button';
      document.body.appendChild(btn);
    }

    // comfort vignette: a camera-locked ring that darkens the periphery
    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.vignetteU,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uStrength; varying vec2 vUv;
          void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(0.95 - uStrength * 0.55, 1.05 - uStrength * 0.4, d) * uStrength;
          gl_FragColor = vec4(0.05, 0.05, 0.08, a); }`,
      }),
    );
    this.vignette.position.z = -0.3;
    this.vignette.renderOrder = 999;
    this.vignette.visible = false;
    this.vignette.frustumCulled = false;
    camera.add(this.vignette);

    // wrist clock on the left controller
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    this.wristCtx = c.getContext('2d')!;
    this.wristTex = new THREE.CanvasTexture(c);
    this.wristTex.colorSpace = THREE.SRGBColorSpace;
    this.wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: this.wristTex, transparent: true }));
    this.wrist.position.set(0, 0.03, 0.05);
    this.wrist.rotation.x = -Math.PI / 3;

    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      grip.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        if (src.handedness === 'left') { this.leftGrip = grip; grip.add(this.wrist); }
      });
      rig.add(grip);
      rig.add(renderer.xr.getController(i));
    }

    renderer.xr.addEventListener('sessionstart', () => {
      this.needRecentre = true;
      this.player.view = 'first';
      this.vignette.visible = true;
      for (const fn of this.sessionListeners) fn(true);
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.vignette.visible = false;
      this.player.xrInput = null;
      for (const fn of this.sessionListeners) fn(false);
    });
  }

  get presenting() {
    return this.renderer.xr.isPresenting;
  }

  /** X held for 0.8 s: sightseeing flight on/off (a tap stays the timelapse). */
  onCruise(fn: () => void) {
    this.cruiseListeners.push(fn);
  }

  onSession(fn: (on: boolean) => void) {
    this.sessionListeners.push(fn);
  }

  /** Read the controllers into the player's input (call before player.update). */
  readInput() {
    if (!this.presenting) return;
    const session = this.renderer.xr.getSession();
    const inp: DriveInput = { throttle: 0, steer: 0, moveX: 0, moveY: 0, boost: false, turn: 0, lift: 0 };
    if (!session) return;
    let scrub = 0;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const trig = gp.buttons[0]?.value ?? 0;
      const grip = gp.buttons[1]?.pressed ?? false;
      const sx = gp.axes[2] ?? 0, sy = gp.axes[3] ?? 0;
      const a = gp.buttons[4]?.pressed ?? false, b = gp.buttons[5]?.pressed ?? false;
      if (src.handedness === 'right') {
        inp.throttle += trig;
        inp.moveY += trig;
        if (this.player.mode === 'ride') {
          inp.steer = Math.abs(sx) > 0.15 ? sx : 0;
          // right stick up at speed = pull up (take off)
          if (!this.player.vehicle?.airborne && sy < -0.6) inp.lift = 1;
        }
        else if (Math.abs(sx) > 0.7 && this.snapReady) { inp.turn = -Math.sign(sx) * (Math.PI / 6); this.snapReady = false; }
        else if (Math.abs(sx) < 0.3) this.snapReady = true;
        if (this.edge('rA', a)) this.player.toggleMount();
        if (this.edge('rB', b)) this.needRecentre = true;
      } else if (src.handedness === 'left') {
        inp.throttle -= trig;
        if (grip) scrub = Math.abs(sy) > 0.2 ? -sy : 0;
        else {
          inp.moveX = Math.abs(sx) > 0.15 ? sx : 0;
          inp.moveY += Math.abs(sy) > 0.15 ? -sy : 0;
        }
        // X: tap = timelapse, hold = sightseeing flight
        if (a) {
          this.xHeld += 1 / 72;
          if (this.xHeld >= 0.8 && this.xHeld < 0.8 + 1 / 72) for (const fn of this.cruiseListeners) fn();
        } else {
          if (this.xHeld > 0 && this.xHeld < 0.5) this.tod.playing = !this.tod.playing;
          this.xHeld = 0;
        }
        // flying: left stick up/down climbs and descends (no strafing in the air)
        if (this.player.vehicle?.airborne) { inp.lift = Math.abs(sy) > 0.2 ? -sy : 0; inp.moveY = 0; inp.moveX = 0; }
      }
    }
    // walking is head-relative: turn the stick vector by the head's yaw on the rig
    if (this.player.mode === 'walk') {
      const h = this.headYaw();
      const f = inp.moveY, r = inp.moveX;
      inp.moveY = f * Math.cos(h) + r * Math.sin(h);
      inp.moveX = -f * Math.sin(h) + r * Math.cos(h);
    }
    inp.throttle = clamp(inp.throttle, -1, 1);
    inp.moveY = clamp(inp.moveY, -1, 1);
    this._scrub = scrub;
    this.player.xrInput = inp;
  }
  private _scrub = 0;

  private edge(key: string, down: boolean) {
    const was = this.prevButtons.get(key) ?? false;
    this.prevButtons.set(key, down);
    return down && !was;
  }

  private headYaw() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    return e.y;
  }

  /** Seat the rig so the head lands on the player's eye.  Call after player.update. */
  update(dt: number) {
    if (!this.presenting) return;
    if (this._scrub) this.tod.set(this.tod.time + this._scrub * 3 * dt);
    const cam = this.camera; // XR updates its local pose (relative to the rig)
    if (this.needRecentre && cam.position.lengthSq() > 0) {
      this.headRef.copy(cam.position);
      this.needRecentre = false;
    }
    const yaw = this.player.eyeYaw;
    this.rig.rotation.set(0, yaw, 0); // yaw only: no pitch, no bank, ever
    const off = _o.set(this.headRef.x, 0, this.headRef.z).applyAxisAngle(_up, yaw);
    this.rig.position.set(this.player.eye.x - off.x, this.player.eye.y - this.headRef.y, this.player.eye.z - off.z);

    const v = this.player.vehicle;
    let s = 0;
    if (this.comfortVignette && this.player.mode === 'ride' && v) {
      const top = v.airborne && v.spec.flight ? v.spec.flight.maxAir : v.spec.maxSpeed;
      s = clamp(Math.abs(v.speed) / top, 0, 1) * 0.35 + Math.abs(v.steerInput) * Math.min(1, Math.abs(v.speed) / 2) * 0.5 + Math.min(0.3, Math.abs(v.vy) * 0.05);
    }
    this.vignetteU.uStrength.value += (clamp(s, 0, 0.75) - this.vignetteU.uStrength.value) * Math.min(1, dt * 6);

    const flying = v?.airborne && this.player.mode === 'ride';
    const label = flying ? `${this.tod.label()} ${Math.round(v!.pos.y)}m` : `${this.tod.label()}${this.tod.playing ? ' ▶' : ''}`;
    if (this.leftGrip && label !== this.wristLabel) {
      this.wristLabel = label;
      const g = this.wristCtx;
      g.clearRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(245,239,226,0.92)';
      g.beginPath(); g.roundRect(4, 4, 248, 120, 22); g.fill();
      g.fillStyle = '#2b2533';
      g.font = `bold ${label.length > 7 ? 48 : 64}px ${JP_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, 128, 66);
      this.wristTex.needsUpdate = true;
    }
  }
}

const _o = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
