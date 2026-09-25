import * as THREE from 'three';
import type { World } from '../world/world';
import type { WorldConfig } from '../config';
import { Vehicle } from './vehicle';
import { clamp } from '../core/util';

/**
 * The one thing that moves through the world: on foot, or on the vehicle.
 * Input comes from the keyboard/mouse, from VR controllers (`xrInput`), or from
 * the autopilot used by scripts/explore.mjs -- all three feed the same
 * `throttle / steer / move` numbers, so a test drive exercises the real code.
 */

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1..1, + right
  moveX: number; // on foot, -1..1 strafe
  moveY: number; // on foot, -1..1 forward
  boost: boolean;
  turn: number; // on foot, yaw delta this frame (snap turn / mouse)
}

const WALK = 1.5, RUN = 3.4, EYE = 1.58, RADIUS = 0.32, STEP = 0.4;

export class Player {
  readonly world: World;
  readonly cfg: WorldConfig;
  readonly vehicle: Vehicle | null;
  mode: 'walk' | 'ride';
  view: 'first' | 'third' = 'third';
  readonly pos = new THREE.Vector3(); // feet
  yaw = 0;
  pitch = 0;
  locked = false;
  autopilot = false;
  readonly keys = new Set<string>();
  xrInput: DriveInput | null = null;
  /** Camera pose this frame (world), set by update(). */
  readonly eye = new THREE.Vector3();
  eyeYaw = 0;
  eyePitch = 0;
  private chase = new THREE.Vector3();
  private chaseInit = false;
  stuckTime = 0;
  private listeners: ((mode: 'walk' | 'ride') => void)[] = [];

  constructor(world: World, cfg: WorldConfig) {
    this.world = world;
    this.cfg = cfg;
    this.vehicle = cfg.mobility === 'walk' ? null : new Vehicle(cfg.vehicle);
    if (this.vehicle) world.group.add(this.vehicle.parts.root);
    this.mode = cfg.mobility === 'walk' ? 'walk' : 'ride';
    this.reset();
  }

  onModeChange(fn: (mode: 'walk' | 'ride') => void) {
    this.listeners.push(fn);
  }

  /** Back to the start of the course, facing along it. */
  reset() {
    const road = this.world.road;
    const t = 0.07;
    road.pointAt(t, this.pos);
    this.yaw = road.yawAt(t);
    this.pitch = 0;
    if (this.vehicle) {
      this.vehicle.pos.copy(this.pos);
      this.vehicle.yaw = this.yaw;
      this.vehicle.speed = 0;
      if (this.mode === 'walk') {
        // park it beside the start so it can be found
        const r = road.rightAt(t, new THREE.Vector3());
        this.vehicle.pos.addScaledVector(r, 1.6);
      }
    }
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.chaseInit = false;
  }

  /** F: get on if near the vehicle, get off beside it if riding. */
  toggleMount() {
    const v = this.vehicle;
    if (!v || this.cfg.mobility !== 'both') return false;
    if (this.mode === 'ride') {
      if (Math.abs(v.speed) > 1) return false;
      v.speed = 0;
      const right = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
      this.pos.copy(v.pos).addScaledVector(right, -1.1);
      this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
      this.yaw = v.yaw;
      this.mode = 'walk';
    } else {
      if (this.pos.distanceTo(v.pos) > 2.8) return false;
      this.mode = 'ride';
      this.yaw = v.yaw;
      this.pitch = 0;
      this.chaseInit = false;
    }
    for (const fn of this.listeners) fn(this.mode);
    return true;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = clamp(this.pitch - dy * 0.0022, -1.2, 1.2);
  }

  private keyInput(): DriveInput {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return { throttle: f, steer: s, moveX: s, moveY: f, boost: k.has('ShiftLeft') || k.has('ShiftRight'), turn: 0 };
  }

  private autoInput(): DriveInput {
    const road = this.world.road;
    const here = this.mode === 'ride' && this.vehicle ? this.vehicle.pos : this.pos;
    const n = road.nearest(here.x, here.z);
    const ahead = road.pointAt(Math.min(1, n.t + 9 / road.length));
    const want = Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z));
    const yaw = this.mode === 'ride' && this.vehicle ? this.vehicle.yaw : this.yaw;
    let d = want - yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const steer = clamp(-d * 2.5, -1, 1);
    return { throttle: n.t > 0.985 ? -1 : 0.7, steer, moveX: 0, moveY: n.t > 0.985 ? 0 : 1, boost: false, turn: this.mode === 'walk' ? d * 0.08 : 0 };
  }

  update(dt: number) {
    const input = this.autopilot ? this.autoInput() : this.xrInput ?? this.keyInput();
    const before = (this.mode === 'ride' && this.vehicle ? this.vehicle.pos : this.pos).clone();
    if (this.mode === 'ride' && this.vehicle) this.updateRide(dt, input);
    else this.updateWalk(dt, input);
    // stuck detector for the explore test: pushing but not moving
    const after = this.mode === 'ride' && this.vehicle ? this.vehicle.pos : this.pos;
    const pushing = Math.abs(input.throttle) > 0.2 || Math.abs(input.moveY) > 0.2;
    if (pushing && after.distanceTo(before) < 0.2 * dt) this.stuckTime += dt;
  }

  private updateWalk(dt: number, input: DriveInput) {
    this.yaw += input.turn;
    const sp = input.boost ? RUN : WALK;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = fx * input.moveY + rx * input.moveX, mz = fz * input.moveY + rz * input.moveX;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    this.move(this.pos, mx * sp * dt, mz * sp * dt, RADIUS);
    // keep within reach of the road so nobody walks off the world
    const n = this.world.road.nearest(this.pos.x, this.pos.z);
    if (n.dist > 70) {
      const p = this.world.road.pointAt(n.t);
      this.pos.x = p.x + (this.pos.x - p.x) * (70 / n.dist);
      this.pos.z = p.z + (this.pos.z - p.z) * (70 / n.dist);
    }
    const target = this.world.heightAt(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y += (target - this.pos.y) * Math.min(1, dt * 14);
    this.eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.eyeYaw = this.yaw;
    this.eyePitch = this.pitch;
    if (this.vehicle) this.vehicle.pose(dt, this.world.heightAt(this.vehicle.pos.x, this.vehicle.pos.z));
  }

  private updateRide(dt: number, input: DriveInput) {
    const v = this.vehicle!;
    const oldYaw = v.yaw;
    v.drive(dt, input.throttle, input.steer, input.boost);
    // drive() already moved it; undo and re-apply through the collider solver
    const px = -Math.sin(v.yaw) * v.speed * dt, pz = -Math.cos(v.yaw) * v.speed * dt;
    v.pos.x -= px; v.pos.z -= pz;
    const hit = this.move(v.pos, px, pz, v.spec.radius);
    if (hit) v.speed *= 0.3; // bump and stop, no crash physics
    // soft guide rails: the road plus its shoulders
    const road = this.world.road;
    const n = road.nearest(v.pos.x, v.pos.z);
    const limit = road.width / 2 + road.shoulder + 0.4;
    if (Math.abs(n.lateral) > limit) {
      const r = road.rightAt(n.t, _r);
      const push = (Math.abs(n.lateral) - limit) * Math.sign(n.lateral);
      v.pos.addScaledVector(r, -push * Math.min(1, dt * 8));
      v.speed *= 1 - Math.min(1, dt * 1.5);
    }
    const gy = this.world.heightAt(v.pos.x, v.pos.z);
    v.pose(dt, gy);
    this.pos.set(v.pos.x, gy, v.pos.z);
    // the rider's head turns with the machine; mouse look is an offset on top
    this.yaw += v.yaw - oldYaw;

    if (this.view === 'first') {
      const back = v.spec.seatBack;
      this.eye.set(v.pos.x + Math.sin(v.yaw) * back, gy + v.spec.eyeHeight, v.pos.z + Math.cos(v.yaw) * back);
      this.eyeYaw = this.yaw;
      this.eyePitch = this.pitch;
    } else {
      const c = v.spec.chase;
      const want = _w.set(v.pos.x + Math.sin(this.yaw) * c.dist, gy + c.height, v.pos.z + Math.cos(this.yaw) * c.dist);
      if (!this.chaseInit) { this.chase.copy(want); this.chaseInit = true; }
      this.chase.lerp(want, Math.min(1, dt * 4));
      this.eye.copy(this.chase);
      const look = _l.set(v.pos.x - Math.sin(v.yaw) * 3, gy + 1.1, v.pos.z - Math.cos(v.yaw) * 3);
      this.eyeYaw = Math.atan2(-(look.x - this.eye.x), -(look.z - this.eye.z));
      this.eyePitch = Math.atan2(look.y - this.eye.y, Math.hypot(look.x - this.eye.x, look.z - this.eye.z)) + this.pitch * 0.5;
    }
  }

  /** Circle vs AABB push-out.  Returns true if anything was hit. */
  private move(p: THREE.Vector3, mx: number, mz: number, radius: number) {
    let hit = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.1)); // no tunnelling at speed
    for (let s = 0; s < steps; s++) {
      p.x += mx / steps;
      p.z += mz / steps;
      for (const c of this.world.colliders) {
        if (c.top <= p.y + STEP) continue;
        const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * radius;
          p.z = cz + (dz / d) * radius;
        } else {
          // centre inside the box: leave by the nearest face
          const opts = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z];
          const i = opts.indexOf(Math.min(...opts));
          if (i === 0) p.x = c.x0 - radius; else if (i === 1) p.x = c.x1 + radius;
          else if (i === 2) p.z = c.z0 - radius; else p.z = c.z1 + radius;
        }
      }
    }
    return hit;
  }

  /** Put the camera rig where this frame's eye is (desktop only; XR drives the head itself). */
  applyCamera(rig: THREE.Object3D, camera: THREE.Camera) {
    rig.position.copy(this.eye);
    rig.rotation.set(0, this.eyeYaw, 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set(this.eyePitch, 0, 0);
  }
}

const _r = new THREE.Vector3(), _w = new THREE.Vector3(), _l = new THREE.Vector3();
