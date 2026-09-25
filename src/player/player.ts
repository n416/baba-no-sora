import * as THREE from 'three';
import type { World } from '../world/world';
import type { WorldConfig } from '../config';
import { Vehicle } from './vehicle';
import { clamp } from '../core/util';
import { COURSE } from '../world/course';
import { cruiseTarget } from '../world/cruise';

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
  lift: number; // flying machines: -1 descend .. 1 climb (on the ground, > 0 at speed = take off)
  fire?: boolean; // robot: beam (VR trigger; the mouse button is read in main.ts)
}

const WALK = 1.5, RUN = 3.4, EYE = 1.58, RADIUS = 0.32, STEP = 0.4, BODY = 1.8, WALK_LIMIT = 200;

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
  /** Sightseeing flight: follows the cruise route (takes off first if on the ground). */
  cruise = false;
  /** Collisions while airborne, for the flight test. */
  airHits = 0;
  /** Robot: called with a destructible's id when the robot rams or lands on it. */
  onCrush: ((id: number) => void) | null = null;
  /** Robot: touched down after a fall (vy is the downward speed, m/s). */
  onLand: ((vy: number) => void) | null = null;
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
    const t = COURSE.startT;
    road.pointAt(t, this.pos);
    this.yaw = road.yawAt(t);
    this.pitch = 0;
    if (this.vehicle) {
      this.vehicle.pos.copy(this.pos);
      this.vehicle.yaw = this.yaw;
      this.vehicle.speed = 0;
      this.vehicle.airborne = false;
      this.vehicle.vy = 0;
      this.vehicle.push.set(0, 0, 0);
      this.vehicle.thrust = 0;
      this.vehicle.aim = 0;
      this.vehicle.aimHold = 0;
      this.cruise = false;
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
      if (Math.abs(v.speed) > 1 || v.airborne || (v.spec.robot && v.pos.y > 0.5)) return false;
      v.speed = 0;
      const right = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
      this.pos.copy(v.pos).addScaledVector(right, v.spec.robot ? -5 : -1.1);
      this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
      this.yaw = v.yaw;
      this.mode = 'walk';
    } else {
      if (this.pos.distanceTo(v.pos) > (v.spec.robot ? 7 : 2.8)) return false;
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
    const lift = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    return { throttle: f, steer: s, moveX: s, moveY: f, boost: k.has('ShiftLeft') || k.has('ShiftRight'), turn: 0, lift };
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
    return { throttle: n.t > 0.985 ? -1 : 0.7, steer, moveX: 0, moveY: n.t > 0.985 ? 0 : 1, boost: false, turn: this.mode === 'walk' ? d * 0.08 : 0, lift: 0 };
  }

  /** Sightseeing autopilot: on the ground, run up the road and lift off; in the air, chase a point ahead on the route. */
  private cruiseInput(): DriveInput {
    const v = this.vehicle!, f = v.spec.flight!;
    if (!v.airborne) {
      const road = this.autoInput();
      return { ...road, throttle: 1, boost: true, lift: v.speed > f.takeoff + 0.5 ? 1 : 0 };
    }
    const target = cruiseTarget(v.pos, 70);
    const want = Math.atan2(-(target.x - v.pos.x), -(target.z - v.pos.z));
    let d = want - v.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // climb out over the rooftops before turning onto the route
    const high = v.pos.y > 28;
    const steer = high ? clamp(-d * 1.6, -1, 1) : 0;
    const lift = high ? clamp((target.y - v.pos.y) / 12, -1, 1) : 1;
    const cruiseSpeed = 18;
    return { throttle: clamp((cruiseSpeed - v.speed) * 0.6, -1, 1), steer, moveX: 0, moveY: 0, boost: false, turn: 0, lift };
  }

  update(dt: number) {
    const flying = this.mode === 'ride' && this.vehicle?.spec.flight;
    const input = this.cruise && flying ? this.cruiseInput() : this.autopilot ? this.autoInput() : this.xrInput ?? this.keyInput();
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
    this.move(this.pos, mx * sp * dt, mz * sp * dt, RADIUS, this.pos.y + STEP, this.pos.y + BODY);
    // keep within reach of the road so nobody walks off the world
    const n = this.world.road.nearest(this.pos.x, this.pos.z);
    if (n.dist > WALK_LIMIT) {
      const p = this.world.road.pointAt(n.t);
      this.pos.x = p.x + (this.pos.x - p.x) * (WALK_LIMIT / n.dist);
      this.pos.z = p.z + (this.pos.z - p.z) * (WALK_LIMIT / n.dist);
    }
    const target = this.world.heightAt(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y += (target - this.pos.y) * Math.min(1, dt * 14);
    this.eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.eyeYaw = this.yaw;
    this.eyePitch = this.pitch;
    if (this.vehicle) {
      this.vehicle.showHulls(true);
      this.vehicle.pose(dt, this.world.heightAt(this.vehicle.pos.x, this.vehicle.pos.z));
    }
  }

  private updateRide(dt: number, input: DriveInput) {
    const v = this.vehicle!;
    const oldYaw = v.yaw;
    if (v.spec.robot) this.updateRobot(dt, input);
    else if (v.airborne) this.updateFlight(dt, input);
    else this.updateGround(dt, input);
    const gy = this.world.heightAt(v.pos.x, v.pos.z);
    v.pose(dt, v.spec.robot ? v.pos.y : gy); // the robot can stand on roofs
    this.pos.set(v.pos.x, gy, v.pos.z);
    // the rider's head turns with the machine; mouse look is an offset on top
    this.yaw += v.yaw - oldYaw;
    const baseY = v.pos.y;
    v.showHulls(this.view !== 'first');

    if (this.view === 'first') {
      const back = v.spec.seatBack;
      this.eye.set(v.pos.x + Math.sin(v.yaw) * back, baseY + v.spec.eyeHeight, v.pos.z + Math.cos(v.yaw) * back);
      this.eyeYaw = this.yaw;
      this.eyePitch = this.pitch;
    } else if (v.spec.robot) {
      // over the right shoulder; the view (and the beam) goes where the mouse points
      const c = v.spec.chase;
      const side = c.side ?? 0;
      const want = _w.set(
        v.pos.x + Math.sin(this.yaw) * c.dist + Math.cos(this.yaw) * side,
        baseY + c.height,
        v.pos.z + Math.cos(this.yaw) * c.dist - Math.sin(this.yaw) * side,
      );
      // keep the camera out of buildings: pull it in along the line from the robot's head
      const head = _l.set(v.pos.x, baseY + 17, v.pos.z);
      const k = this.clearance(head, want);
      want.lerpVectors(head, want, k);
      if (!this.chaseInit) { this.chase.copy(want); this.chaseInit = true; }
      this.chase.lerp(want, Math.min(1, dt * (k < 1 ? 12 : 5)));
      this.chase.y = Math.max(this.chase.y, gy + 2);
      this.eye.copy(this.chase);
      this.eyeYaw = this.yaw;
      this.eyePitch = this.pitch - 0.12;
    } else {
      const c = v.spec.chase;
      const want = _w.set(v.pos.x + Math.sin(this.yaw) * c.dist, baseY + c.height, v.pos.z + Math.cos(this.yaw) * c.dist);
      if (!this.chaseInit) { this.chase.copy(want); this.chaseInit = true; }
      this.chase.lerp(want, Math.min(1, dt * 4));
      // never let the chase camera sink into the road when coming in to land
      this.chase.y = Math.max(this.chase.y, gy + 1.2);
      this.eye.copy(this.chase);
      const look = _l.set(v.pos.x - Math.sin(v.yaw) * 3, baseY + 1.1, v.pos.z - Math.cos(v.yaw) * 3);
      this.eyeYaw = Math.atan2(-(look.x - this.eye.x), -(look.z - this.eye.z));
      this.eyePitch = Math.atan2(look.y - this.eye.y, Math.hypot(look.x - this.eye.x, look.z - this.eye.z)) + this.pitch * 0.5;
    }
  }

  /** Fraction (0..1) of the segment a->b that is clear of standing buildings, minus a margin. */
  private clearance(a: THREE.Vector3, b: THREE.Vector3) {
    let tMin = 1;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    for (const c of this.world.colliders) {
      if (c.off || c.top < Math.min(a.y, b.y) - 1) continue;
      // slab test against the collider's box (ground to top, or bottom to top)
      let t0 = 0, t1 = 1;
      const bx = [c.x0 - 1.5, c.x1 + 1.5], by = [c.bottom ?? -1, c.top + 1.5], bz = [c.z0 - 1.5, c.z1 + 1.5];
      const axes: [number, number, number[]][] = [[a.x, dx, bx], [a.y, dy, by], [a.z, dz, bz]];
      let miss = false;
      for (const [o, d, [lo, hi]] of axes) {
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { miss = true; break; } continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { miss = true; break; }
      }
      if (!miss && t0 < tMin) tMin = t0;
    }
    return Math.max(0.12, tMin * 0.92);
  }

  /** A shove (the kaiju's plasma).  Robot only; gentle enough to stay comfortable in VR. */
  knockback(x: number, y: number, z: number) {
    const v = this.vehicle;
    if (!v?.spec.robot) return;
    v.push.set(x, 0, z);
    v.vy = Math.max(v.vy, y);
    v.airborne = true;
  }

  /**
   * The giant robot: walks anywhere (no guide rails), steps over anything below
   * its knee, flies on its verniers (Space/E up, Q down, gravity otherwise),
   * lands on roofs, and flattens a small building it walks into -- or any
   * building it rams at dash or flying speed.
   */
  private updateRobot(dt: number, input: DriveInput) {
    const v = this.vehicle!, R = v.spec.robot!;
    // turning: tank-style, and the camera turns with it (mouse look is on top)
    v.steerInput += (input.steer - v.steerInput) * Math.min(1, dt * 6);
    v.yaw -= v.steerInput * R.turn * dt;
    const top = v.airborne ? R.air : input.boost ? R.dash : R.walk;
    const target = input.throttle * top;
    const acc = (v.airborne ? 10 : v.spec.accel) * dt;
    v.speed += Math.max(-acc, Math.min(acc, target - v.speed));
    // verniers
    v.thrust += ((input.lift > 0 ? 1 : input.boost && input.throttle > 0 && v.airborne ? 0.5 : 0) - v.thrust) * Math.min(1, dt * 6);
    if (input.lift > 0) v.vy = Math.min(14, v.vy + R.thrust * dt);
    else if (input.lift < 0) v.vy = Math.max(-22, v.vy - 30 * dt);
    else if (v.airborne) v.vy = Math.max(-20, v.vy - (v.thrust > 0.1 ? 4 : 14) * dt); // falls, softly while jets idle
    // knock-back decays
    v.pos.x += v.push.x * dt;
    v.pos.z += v.push.z * dt;
    v.push.multiplyScalar(Math.pow(0.15, dt));
    const prevY = v.pos.y;
    v.pos.y += v.vy * dt;
    if (v.pos.y > COURSE.flightCeiling) { v.pos.y = COURSE.flightCeiling; v.vy = Math.min(0, v.vy); }
    // soft wall at the edge of town
    const half = COURSE.flightHalf;
    v.pos.x = clamp(v.pos.x, -half - 30, half + 30);
    v.pos.z = clamp(v.pos.z, -half - 30, half + 30);
    // horizontal move against what it cannot step over
    const px = -Math.sin(v.yaw) * v.speed * dt, pz = -Math.cos(v.yaw) * v.speed * dt;
    const hits = this.robotMove(v.pos, px, pz, v.spec.radius, v.pos.y, v.pos.y + R.height, R.step);
    const fast = Math.abs(v.speed) > R.walk * 1.3 || v.airborne;
    for (const c of hits) {
      if (!c.bid) continue;
      if (fast || c.top - v.pos.y < 14) this.onCrush?.(c.bid);
    }
    if (hits.length && !fast) v.speed *= 0.6;
    // floor: ground, or a roof we were above
    let floor = this.world.heightAt(v.pos.x, v.pos.z);
    const r = v.spec.radius * 0.6;
    for (const c of this.world.colliders) {
      if (c.off || v.pos.x < c.x0 - r || v.pos.x > c.x1 + r || v.pos.z < c.z0 - r || v.pos.z > c.z1 + r) continue;
      if (prevY >= c.top - 0.3) floor = Math.max(floor, c.top);
    }
    if (v.pos.y <= floor) {
      // a hard landing on a building flattens it
      if (v.vy < -12) for (const c of this.world.colliders) if (c.bid && !c.off && Math.abs(c.top - floor) < 0.5 && v.pos.x > c.x0 && v.pos.x < c.x1 && v.pos.z > c.z0 && v.pos.z < c.z1) this.onCrush?.(c.bid);
      if (v.airborne && v.vy < -4) this.onLand?.(-v.vy);
      v.pos.y = floor;
      v.vy = Math.max(0, v.vy);
      v.airborne = false;
    } else v.airborne = v.pos.y > floor + 0.05;
  }

  /** Circle vs AABB for the robot: steps over low things, returns what it pushed against. */
  private robotMove(p: THREE.Vector3, mx: number, mz: number, radius: number, y0: number, y1: number, step: number) {
    const hits: import('../world/world').Collider[] = [];
    const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.25));
    for (let s = 0; s < steps; s++) {
      p.x += mx / steps;
      p.z += mz / steps;
      for (const c of this.world.colliders) {
        if (c.off || c.top <= y0 + 0.3 || (c.bottom !== undefined && c.bottom >= y1)) continue;
        if (!c.bid && c.top <= y0 + step) continue; // trees, lamps, poles, the rail embankment: step over
        const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (!hits.includes(c)) hits.push(c);
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * radius;
          p.z = cz + (dz / d) * radius;
        } else {
          const opts = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z];
          const i = opts.indexOf(Math.min(...opts));
          if (i === 0) p.x = c.x0 - radius; else if (i === 1) p.x = c.x1 + radius;
          else if (i === 2) p.z = c.z0 - radius; else p.z = c.z1 + radius;
        }
      }
    }
    return hits;
  }

  private updateGround(dt: number, input: DriveInput) {
    const v = this.vehicle!;
    v.drive(dt, input.throttle, input.steer, input.boost);
    // drive() already moved it; undo and re-apply through the collider solver
    const px = -Math.sin(v.yaw) * v.speed * dt, pz = -Math.cos(v.yaw) * v.speed * dt;
    v.pos.x -= px; v.pos.z -= pz;
    const gy = this.world.heightAt(v.pos.x, v.pos.z);
    const hit = this.move(v.pos, px, pz, v.spec.radius, gy + STEP, gy + 1.6);
    if (hit) v.speed *= 0.3; // bump and stop, no crash physics
    // soft guide rails: the road plus its sidewalks.  Far off the road (after landing
    // somewhere else) there is no rail to snap back to, so only nudge when close.
    const road = this.world.road;
    const n = road.nearest(v.pos.x, v.pos.z);
    const limit = road.width / 2 + road.shoulder + 0.4;
    if (Math.abs(n.lateral) > limit && Math.abs(n.lateral) < limit + 8) {
      const r = road.rightAt(n.t, _r);
      const push = (Math.abs(n.lateral) - limit) * Math.sign(n.lateral);
      v.pos.addScaledVector(r, -push * Math.min(1, dt * 8));
      v.speed *= 1 - Math.min(1, dt * 1.5);
    }
    // take off: fast enough and pulling up
    const f = v.spec.flight;
    if (f && v.speed >= f.takeoff && input.lift > 0) {
      v.airborne = true;
      v.vy = 2.5;
      v.pos.y = gy + 0.05;
    }
  }

  private updateFlight(dt: number, input: DriveInput) {
    const v = this.vehicle!, f = v.spec.flight!;
    const top = f.maxAir * (input.boost ? f.airBoost : 1);
    // airspeed never drops below the stall speed: it is a plane in the air
    if (input.throttle > 0) v.speed += v.spec.accel * input.throttle * dt;
    else if (input.throttle < 0) v.speed += v.spec.accel * 0.8 * input.throttle * dt;
    if (v.speed > top) v.speed = Math.max(top, v.speed - v.spec.brake * 0.5 * dt);
    v.speed = Math.max(f.minAir, v.speed);
    // turning: bank-and-turn, gentle so VR stays comfortable
    let steer = input.steer;
    const half = COURSE.flightHalf;
    const out = Math.max(Math.abs(v.pos.x) - half, Math.abs(v.pos.z) - half);
    if (out > 0) {
      // soft wall: steer home, harder the further out
      const want = Math.atan2(v.pos.x, v.pos.z); // yaw that points at the origin
      let d = want - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = Math.min(1, out / 40);
      steer = clamp(steer * (1 - k) - d * k * 2, -1, 1);
    }
    v.steerInput += (steer - v.steerInput) * Math.min(1, dt * 3);
    v.yaw -= v.steerInput * f.turn * dt;
    // climb / descend toward the stick
    const vyWant = input.lift * f.climb;
    v.vy += (vyWant - v.vy) * Math.min(1, dt * 2.2);
    const prevY = v.pos.y;
    v.pos.y += v.vy * dt;
    if (v.pos.y > COURSE.flightCeiling) { v.pos.y = COURSE.flightCeiling; v.vy = Math.min(v.vy, 0); }
    // horizontal move through the colliders the hull overlaps vertically
    const px = -Math.sin(v.yaw) * v.speed * dt, pz = -Math.cos(v.yaw) * v.speed * dt;
    const { floor, ceil, onRoad } = this.airSpan(v.pos.x + px, v.pos.z + pz, prevY);
    if (v.pos.y + HULL > ceil) { v.pos.y = ceil - HULL; v.vy = Math.min(v.vy, 0); }
    if (v.pos.y < floor) { v.pos.y = floor; v.vy = Math.max(v.vy, 0); }
    if (this.move(v.pos, px, pz, v.spec.radius, v.pos.y + 0.05, v.pos.y + HULL)) {
      this.airHits++;
      v.speed = Math.max(f.minAir, v.speed * 0.85);
    }
    // touch down: back on the road surface, sinking or level
    const gy = this.world.heightAt(v.pos.x, v.pos.z);
    if (onRoad && v.pos.y <= gy + 0.06 && v.vy <= 0.5) {
      v.airborne = false;
      v.vy = 0;
      v.pos.y = gy;
      v.speed = Math.min(v.speed, v.spec.maxSpeed * v.spec.boost);
      this.cruise = false;
    }
  }

  /**
   * What the hull may occupy vertically at (x, z) given where it was: roofs it was
   * above are a floor, bridge decks it was under are a ceiling.  Off the road the
   * floor stays a little above the ground, so it can only land on the road.
   */
  private airSpan(x: number, z: number, prevY: number) {
    const v = this.vehicle!;
    const r = v.spec.radius;
    const road = this.world.road;
    const n = road.nearest(x, z);
    const onRoad = Math.abs(n.lateral) < road.width / 2 + road.shoulder;
    let floor = this.world.heightAt(x, z) + (onRoad ? 0 : 1.5);
    let ceil = Infinity;
    for (const c of this.world.colliders) {
      if (c.off || x < c.x0 - r || x > c.x1 + r || z < c.z0 - r || z > c.z1 + r) continue;
      if (prevY >= c.top - 0.05) floor = Math.max(floor, c.top);
      else if (c.bottom !== undefined && prevY + HULL <= c.bottom + 0.05) ceil = Math.min(ceil, c.bottom);
    }
    return { floor, ceil, onRoad };
  }

  /** Circle vs AABB push-out.  Returns true if anything was hit. */
  private move(p: THREE.Vector3, mx: number, mz: number, radius: number, y0: number, y1: number) {
    let hit = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.1)); // no tunnelling at speed
    for (let s = 0; s < steps; s++) {
      p.x += mx / steps;
      p.z += mz / steps;
      for (const c of this.world.colliders) {
        if (c.off || c.top <= y0 || (c.bottom !== undefined && c.bottom >= y1)) continue;
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
/** Height of the flying car's hull above its origin, for vertical overlap. */
const HULL = 1.5;
