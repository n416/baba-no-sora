import * as THREE from 'three';
import type { VehicleKind } from '../config';
import { M } from '../world/kit';
import { box, strut } from '../core/util';
import { addOutline } from '../render/outline';
import { glow } from '../render/toon';

/**
 * A rideable machine.  A kind is a row of numbers plus a builder; the physics,
 * camera and VR seat all read the numbers.  Add a kind by adding a row here and
 * a builder that returns { root, wheels } -- wheels are *pivot groups* spun about
 * their local X, never bare meshes (a bare mesh spins about whatever its origin is).
 */

export interface VehicleSpec {
  name: string;
  maxSpeed: number; // m/s
  boost: number; // multiplier while Shift is held
  accel: number; // m/s^2
  brake: number;
  reverse: number; // max reverse speed, 0 = none
  turnRate: number; // rad/s at full lock and walking pace
  eyeHeight: number; // seated eye height above the ground
  seatBack: number; // eye position behind the vehicle origin (m, +z is back)
  wheelRadius: number;
  radius: number; // collision radius
  lean: number; // how far it banks into turns (the body only -- never the VR head)
  chase: { dist: number; height: number };
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  bicycle: { name: 'ママチャリ', maxSpeed: 5.5, boost: 1.45, accel: 2.2, brake: 5, reverse: 0, turnRate: 1.3, eyeHeight: 1.55, seatBack: 0.25, wheelRadius: 0.33, radius: 0.45, lean: 0.35, chase: { dist: 4.2, height: 2.0 } },
  scooter: { name: '原付', maxSpeed: 8.3, boost: 1.25, accel: 3.0, brake: 6, reverse: 0, turnRate: 1.1, eyeHeight: 1.5, seatBack: 0.2, wheelRadius: 0.27, radius: 0.55, lean: 0.3, chase: { dist: 4.6, height: 2.1 } },
  keiTruck: { name: '軽トラ', maxSpeed: 11, boost: 1.2, accel: 2.6, brake: 7, reverse: 2.5, turnRate: 0.9, eyeHeight: 1.45, seatBack: -0.9, wheelRadius: 0.3, radius: 1.2, lean: 0, chase: { dist: 7.5, height: 3.0 } },
};

export interface VehicleBody {
  root: THREE.Group; // origin on the ground between the wheels, front toward -z
  body: THREE.Group; // what leans
  wheels: THREE.Group[]; // pivots, spun about local X
  steer?: THREE.Group; // turned about local Y
  lamp?: THREE.MeshToonMaterial;
}

function wheel(r: number, width: number) {
  const pivot = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r - 0.03, 0.035 + width * 0.25, 6, 20), M('#26242a'));
  tyre.rotation.y = Math.PI / 2;
  pivot.add(tyre);
  for (let i = 0; i < 3; i++) {
    const spoke = box(0.02, r * 1.9, 0.02, M('#c9c9cf'));
    spoke.position.y = 0;
    spoke.rotation.x = (i * Math.PI) / 3;
    pivot.add(spoke);
  }
  return pivot;
}

function buildBicycle(): VehicleBody {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const r = 0.33;
  // joints (front is -z)
  const RH = new THREE.Vector3(0, r, 0.55); // rear hub
  const FH = new THREE.Vector3(0, r, -0.55); // front hub
  const BB = new THREE.Vector3(0, 0.3, 0.08); // bottom bracket
  const SC = new THREE.Vector3(0, 0.92, 0.28); // seat cluster
  const HT = new THREE.Vector3(0, 0.95, -0.42); // head tube top
  const HB = new THREE.Vector3(0, 0.62, -0.47); // head tube bottom
  const frame = M('#c8453c');
  for (const [a, b] of [[BB, SC], [BB, HB], [HB, HT], [BB, RH], [SC, RH]] as const) body.add(strut(a, b, 0.024, frame));
  body.add(strut(SC, SC.clone().setY(1.02), 0.018, M('#cfcfd4')));
  const seat = box(0.16, 0.06, 0.26, M('#3a3434'), 0, 1.02, 0.3);
  body.add(seat);
  const steer = new THREE.Group();
  steer.position.copy(HT);
  steer.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.12, 0.08), 0.018, M('#cfcfd4')));
  steer.add(strut(new THREE.Vector3(-0.3, 0.13, 0.12), new THREE.Vector3(0.3, 0.13, 0.12), 0.016, M('#cfcfd4')));
  const basket = box(0.36, 0.24, 0.28, M('#b9b9bf'), 0, -0.2, -0.2);
  steer.add(basket);
  const lampMat = glow('#f2eee0', '#fff1c0');
  steer.add(box(0.08, 0.08, 0.06, lampMat, 0, -0.26, -0.36));
  // the fork runs head -> front hub; it steers with the bars
  steer.add(strut(HB.clone().sub(HT), FH.clone().sub(HT), 0.02, frame));
  body.add(steer);
  const rw = wheel(r, 0.1); rw.position.copy(RH);
  const fw = wheel(r, 0.1); fw.position.copy(FH).sub(HT);
  steer.add(fw);
  body.add(rw);
  // a rear rack and the chain case
  body.add(box(0.2, 0.03, 0.34, M('#9a9aa0'), 0, 0.78, 0.58));
  body.add(box(0.02, 0.18, 0.55, M('#c8453c'), 0.06, 0.2, 0.32));
  addOutline(body);
  return { root, body, wheels: [rw, fw], steer, lamp: lampMat };
}

function buildScooter(): VehicleBody {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const shell = M('#e9e4d8');
  body.add(box(0.36, 0.3, 1.1, shell, 0, 0.3, 0.05));
  body.add(box(0.3, 0.12, 0.6, M('#2d2a2e'), 0, 0.74, 0.25)); // seat
  body.add(box(0.34, 0.5, 0.42, shell, 0, 0.38, 0.3));
  body.add(box(0.4, 0.7, 0.12, M('#6fa7b8'), 0, 0.3, -0.52)); // leg shield
  const steer = new THREE.Group();
  steer.position.set(0, 0.95, -0.5);
  steer.add(box(0.62, 0.05, 0.05, M('#9a9aa0')));
  const lampMat = glow('#f2eee0', '#fff1c0');
  steer.add(box(0.14, 0.1, 0.08, lampMat, 0, -0.05, -0.08));
  body.add(steer);
  const rw = wheel(0.27, 0.3); rw.position.set(0, 0.27, 0.5);
  const fw = wheel(0.27, 0.3); fw.position.set(0, 0.27, -0.6);
  body.add(rw, fw);
  addOutline(body);
  return { root, body, wheels: [rw, fw], steer, lamp: lampMat };
}

function buildKeiTruck(): VehicleBody {
  // a kei truck is a legal box: 3.40 x 1.48 m -- keep it visibly small
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = M('#f2f2ee');
  body.add(box(1.46, 0.95, 1.3, paint, 0, 0.45, -1.0)); // cab lower
  body.add(box(1.4, 0.6, 1.0, M('#5f7688'), 0, 1.4, -1.05)); // glasshouse (dark glass)
  body.add(box(1.46, 0.08, 1.2, paint, 0, 2.0, -1.05)); // roof
  body.add(box(1.48, 0.12, 2.0, M('#9aa0a6'), 0, 0.55, 0.62)); // bed floor
  for (const x of [-0.72, 0.72]) body.add(box(0.05, 0.35, 2.0, paint, x, 0.67, 0.62));
  body.add(box(1.48, 0.35, 0.05, paint, 0, 0.67, 1.6));
  const lampMat = glow('#f2eee0', '#fff1c0');
  for (const x of [-0.55, 0.55]) body.add(box(0.2, 0.12, 0.04, lampMat, x, 0.75, -1.67));
  const wheels: THREE.Group[] = [];
  for (const [x, z] of [[-0.62, -1.05], [0.62, -1.05], [-0.62, 0.95], [0.62, 0.95]]) {
    const w = wheel(0.3, 0.6);
    w.position.set(x, 0.3, z);
    body.add(w);
    wheels.push(w);
  }
  addOutline(body);
  return { root, body, wheels, lamp: lampMat };
}

const BUILDERS: Record<VehicleKind, () => VehicleBody> = {
  bicycle: buildBicycle,
  scooter: buildScooter,
  keiTruck: buildKeiTruck,
};

export class Vehicle {
  readonly spec: VehicleSpec;
  readonly parts: VehicleBody;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  steerInput = 0;
  private bank = 0;

  constructor(kind: VehicleKind) {
    this.spec = VEHICLES[kind];
    this.parts = BUILDERS[kind]();
    this.parts.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.isOutline) o.castShadow = true;
    });
  }

  /** Throttle -1..1 (negative brakes, then reverses), steer -1..1 (+ = right). */
  drive(dt: number, throttle: number, steer: number, boost: boolean) {
    const s = this.spec;
    const top = s.maxSpeed * (boost ? s.boost : 1);
    if (throttle > 0) this.speed = Math.min(top, this.speed + s.accel * throttle * dt);
    else if (throttle < 0) {
      if (this.speed > 0) this.speed = Math.max(0, this.speed + s.brake * throttle * dt);
      else this.speed = Math.max(-s.reverse, this.speed + s.accel * throttle * dt * 0.5);
    } else {
      this.speed *= Math.pow(0.35, dt); // rolling resistance; a bike coasts
      if (Math.abs(this.speed) < 0.03) this.speed = 0;
    }
    if (this.speed > top) this.speed = Math.max(top, this.speed - s.brake * dt);
    this.steerInput += (steer - this.steerInput) * Math.min(1, dt * 5);
    // turning needs way on; full lock at walking pace, gentler at speed
    const v = Math.abs(this.speed);
    const rate = s.turnRate * Math.min(1, v / 1.5) / (1 + v * 0.08);
    this.yaw -= this.steerInput * rate * dt * Math.sign(this.speed || 1);
    this.pos.x += -Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += -Math.cos(this.yaw) * this.speed * dt;
  }

  /** Visual pose: wheels, bars, bank. */
  pose(dt: number, groundY: number) {
    const p = this.parts, s = this.spec;
    p.root.position.set(this.pos.x, groundY, this.pos.z);
    p.root.rotation.y = this.yaw;
    const targetBank = -this.steerInput * Math.min(1, Math.abs(this.speed) / s.maxSpeed) * s.lean;
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 4);
    p.body.rotation.z = this.bank;
    for (const w of p.wheels) w.rotation.x -= (this.speed * dt) / s.wheelRadius;
    if (p.steer) p.steer.rotation.y = -this.steerInput * 0.4;
  }
}
