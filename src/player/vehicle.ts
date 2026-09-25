import * as THREE from 'three';
import type { VehicleKind } from '../config';
import { M } from '../world/kit';
import { box, strut } from '../core/util';
import { addOutline } from '../render/outline';
import { cel, glow } from '../render/toon';

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
  chase: { dist: number; height: number; side?: number; lookY?: number };
  /** Present only on machines that fly.  Speeds in m/s, rates in rad/s and m/s. */
  flight?: { takeoff: number; minAir: number; maxAir: number; airBoost: number; turn: number; climb: number; bank: number };
  /** Present only on the giant robot: walks anywhere, flies on verniers, fires a beam. */
  robot?: { walk: number; dash: number; air: number; thrust: number; height: number; step: number; turn: number };
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  bicycle: { name: 'ママチャリ', maxSpeed: 5.5, boost: 1.45, accel: 2.2, brake: 5, reverse: 0, turnRate: 1.3, eyeHeight: 1.55, seatBack: 0.25, wheelRadius: 0.33, radius: 0.45, lean: 0.35, chase: { dist: 4.2, height: 2.0 } },
  scooter: { name: '原付', maxSpeed: 8.3, boost: 1.25, accel: 3.0, brake: 6, reverse: 0, turnRate: 1.1, eyeHeight: 1.5, seatBack: 0.2, wheelRadius: 0.27, radius: 0.55, lean: 0.3, chase: { dist: 4.6, height: 2.1 } },
  robot: {
    name: '巨大ロボット', maxSpeed: 7, boost: 2.2, accel: 9, brake: 14, reverse: 4, turnRate: 1.0, eyeHeight: 16.5, seatBack: -2.0, wheelRadius: 1, radius: 3.4, lean: 0,
    chase: { dist: 30, height: 21, side: 5, lookY: 14 },
    robot: { walk: 7, dash: 16, air: 24, thrust: 26, height: 20, step: 9.5, turn: 1.0 },
  },
  wingCar: {
    name: '翼のある車', maxSpeed: 14, boost: 1.5, accel: 4, brake: 8, reverse: 3, turnRate: 0.9, eyeHeight: 1.0, seatBack: 0.25, wheelRadius: 0.28, radius: 1.05, lean: 0, chase: { dist: 6.6, height: 2.3 },
    flight: { takeoff: 16, minAir: 12, maxAir: 22, airBoost: 1.4, turn: 0.55, climb: 7, bank: 0.45 },
  },
  keiTruck: { name: '軽トラ', maxSpeed: 11, boost: 1.2, accel: 2.6, brake: 7, reverse: 2.5, turnRate: 0.9, eyeHeight: 1.45, seatBack: -0.9, wheelRadius: 0.3, radius: 1.2, lean: 0, chase: { dist: 7.5, height: 3.0 } },
};

/** Robot rifle arm: how far it swings either side of the body (rad), its pitch range, and its speed (rad/s). */
const ARM_YAW = THREE.MathUtils.degToRad(40);
const ARM_PITCH: [number, number] = [THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(55)];
const ARM_RATE = 3.2;
const _sh = new THREE.Vector3();

export interface VehicleBody {
  root: THREE.Group; // origin on the ground between the wheels, front toward -z
  body: THREE.Group; // what leans
  wheels: THREE.Group[]; // pivots, spun about local X
  steer?: THREE.Group; // turned about local Y
  lamp?: THREE.MeshToonMaterial;
  /** Wing pivots, [left, right]; rotation.z folds them up against the body. */
  wings?: THREE.Group[];
  /** Spun about local Z. */
  prop?: THREE.Group;
  /** Robot: legs and arms (pivots swung about X), vernier flames (scaled by thrust), the beam muzzle. */
  legs?: THREE.Group[];
  arms?: THREE.Group[];
  flames?: THREE.Object3D[];
  thrusterMat?: THREE.MeshToonMaterial;
  muzzle?: THREE.Object3D;
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

/**
 * A little retro kei car that grew wings: cream body, teal belt line, round
 * lamps, twin tail fins and a pusher propeller.  The wings stand folded upright
 * beside the cabin in town and swing down flat as it gathers speed.
 */
function buildWingCar(): VehicleBody {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const cream = M('#efe4cc'), teal = M('#3f9a9c'), dark = M('#2c2a30'), chrome = M('#cfd3d6');
  const glass = cel('#9fc0dc', { ramp: 'soft', transparent: true, opacity: 0.32 });
  // lower body, a rounded nose and tail made of stepped boxes
  body.add(box(1.46, 0.5, 2.9, cream, 0, 0.32, 0));
  body.add(box(1.4, 0.34, 0.4, cream, 0, 0.36, -1.6));
  body.add(box(1.4, 0.34, 0.35, cream, 0, 0.36, 1.58));
  body.add(box(1.48, 0.1, 3.2, teal, 0, 0.62, 0)); // belt line
  body.add(box(1.5, 0.12, 3.35, dark, 0, 0.26, 0)); // bumper/rocker line
  // cabin: glass all round with a cream roof and pillars
  const cabinGlass = box(1.28, 0.62, 1.55, glass, 0, 0.72, 0.15);
  cabinGlass.userData.noOutline = true; // a hull round the glass would black out the view from the seat
  body.add(cabinGlass);
  body.add(box(1.34, 0.08, 1.45, cream, 0, 1.34, 0.2));
  for (const x of [-0.62, 0.62]) for (const z of [-0.6, 0.9]) body.add(box(0.07, 0.62, 0.07, cream, x, 0.72, z));
  // cockpit: dashboard, gauges and a wheel, so the first-person (and VR) view has a frame
  body.add(box(1.22, 0.1, 0.34, dark, 0, 0.7, -0.42));
  for (const x of [0.12, 0.42]) {
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), glow('#f2ecd8', '#ffd98a'));
    gauge.position.set(x, 0.8, -0.26);
    gauge.rotation.x = -0.5;
    body.add(gauge);
  }
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 20), dark);
  wheelRing.position.set(0.3, 0.84, -0.16); // right-hand drive
  wheelRing.rotation.x = -0.4;
  body.add(wheelRing);
  body.add(box(0.5, 0.45, 0.5, M('#b8a58a'), -0.3, 0.3, 0.4), box(0.5, 0.45, 0.5, M('#b8a58a'), 0.3, 0.3, 0.4)); // seats
  // hood slopes down to the nose
  const hood = box(1.38, 0.08, 0.9, cream, 0, 0, 0);
  hood.position.set(0, 0.76, -1.1);
  hood.rotation.x = -0.12;
  body.add(hood);
  // round lamps + a chrome grille bar
  const lampMat = glow('#f4efe0', '#fff1c0');
  for (const x of [-0.5, 0.5]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14), lampMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, 0.55, -1.82);
    body.add(l);
  }
  body.add(box(0.5, 0.06, 0.05, chrome, 0, 0.42, -1.8));
  const tail = glow('#b8453c', '#ff6a4a');
  for (const x of [-0.55, 0.55]) body.add(box(0.2, 0.1, 0.04, tail, x, 0.5, 1.77));
  // twin tail fins and a stabiliser
  for (const x of [-0.5, 0.5]) {
    const fin = box(0.06, 0.55, 0.55, teal, x, 0.82, 1.45);
    fin.rotation.x = -0.35;
    body.add(fin);
  }
  body.add(box(1.5, 0.05, 0.35, cream, 0, 0.84, 1.55));
  // pusher propeller behind the tail
  const prop = new THREE.Group();
  prop.position.set(0, 0.95, 1.82);
  prop.add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 10).rotateX(-Math.PI / 2), chrome));
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i * Math.PI * 2) / 3;
    blade.add(box(0.1, 0.55, 0.02, dark, 0, 0.05, 0));
    blade.add(box(0.1, 0.08, 0.025, M('#e8c23a'), 0, 0.52, 0));
    prop.add(blade);
  }
  body.add(prop);
  // wings: pivot at the cabin's shoulder, span outward along x
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(side * 0.64, 1.36, 0.25); // high wing off the roof rail, like a Cessna
    const span = 2.5;
    const panel = box(span, 0.07, 1.05, cream, side * span / 2, 0, 0);
    const tip = box(0.35, 0.075, 1.07, teal, side * (span - 0.17), 0, 0);
    const flap = box(span * 0.7, 0.06, 0.18, teal, side * span * 0.45, 0.0, 0.58);
    w.add(panel, tip, flap);
    body.add(w);
    wings.push(w);
  }
  // wheels
  const wheelsOut: THREE.Group[] = [];
  for (const [x, z] of [[-0.64, -1.05], [0.64, -1.05], [-0.64, 1.0], [0.64, 1.0]]) {
    const w = wheel(0.28, 0.55);
    w.position.set(x, 0.28, z);
    body.add(w);
    wheelsOut.push(w);
  }
  addOutline(body);
  return { root, body, wheels: wheelsOut, lamp: lampMat, wings, prop };
}

/**
 * A giant robot, ~20 m: cream armour with teal and orange trim (the winged car's
 * colours), a crested head with a glowing visor, a backpack with two vernier
 * nozzles, and a beam rifle built into the right forearm.  Front toward -z.
 * Invented design.
 */
function buildRobot(): VehicleBody {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const cream = M('#efe4cc'), teal = M('#3f9a9c'), orange = M('#e0843e'), dark = M('#3a3e48'), steel = M('#9aa0a8');
  const visor = cel('#7ff0ff');
  visor.emissive = new THREE.Color('#7ff0ff');
  visor.emissiveIntensity = 1.2; // always lit: it is an eye, not a window
  const thrusterMat = cel('#6a6e78');
  thrusterMat.emissive = new THREE.Color('#8fe8ff');
  thrusterMat.emissiveIntensity = 0;
  // legs: hip pivot at y 9
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 2.2, 9, 0);
    leg.add(box(2.4, 3.6, 2.6, cream, 0, -3.6, 0)); // thigh
    leg.add(box(2.0, 0.6, 2.2, dark, 0, -4.2, 0)); // knee joint
    leg.add(box(2.8, 3.6, 3.0, cream, 0, -7.8, 0.1)); // shin
    leg.add(box(2.9, 1.0, 1.0, orange, 0, -5.4, -1.45)); // knee guard
    leg.add(box(3.0, 1.2, 4.6, teal, 0, -9, -0.5)); // foot
    body.add(leg);
    legs.push(leg);
  }
  // pelvis, torso, chest
  body.add(box(5.2, 2.0, 3.2, dark, 0, 8.2, 0));
  body.add(box(1.6, 1.6, 0.6, orange, 0, 8.3, -1.8)); // crotch plate
  body.add(box(7.2, 5.2, 4.6, cream, 0, 10.2, 0));
  body.add(box(6.0, 2.4, 0.6, teal, 0, 12.2, -2.4)); // chest plate
  for (const s of [-1, 1]) body.add(box(1.4, 0.9, 0.4, M('#f2d24a'), s * 1.9, 12.9, -2.8)); // chest vents
  body.add(box(4.0, 1.2, 0.5, dark, 0, 10.6, -2.4)); // cockpit hatch
  // backpack + verniers
  body.add(box(4.6, 4.2, 2.2, teal, 0, 10.6, 3.2));
  const flames: THREE.Object3D[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: '#9ff0ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 1.6, 10), thrusterMat);
    noz.position.set(s * 1.3, 10.0, 4.4);
    noz.rotation.x = 0.35;
    body.add(noz);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.8, 5, 10, 1, true).translate(0, -2.5, 0), flameMat);
    flame.position.set(s * 1.3, 9.2, 4.7);
    flame.rotation.x = 0.35;
    flame.userData.noOutline = true;
    flame.scale.setScalar(0.001);
    body.add(flame);
    flames.push(flame);
  }
  // head (hidden from the cockpit view: the pilot's eye is just in front of the visor)
  for (const m of [box(2.4, 2.2, 2.6, cream, 0, 15.4, -0.2), box(2.0, 0.5, 0.3, visor, 0, 16.3, -1.55), box(0.35, 1.4, 2.4, orange, 0, 17.4, -0.1), box(2.6, 0.6, 0.6, dark, 0, 15.2, -1.4)]) {
    m.userData.head = true;
    body.add(m);
  }
  // arms: shoulder pivot at y 14.3
  const arms: THREE.Group[] = [];
  let muzzle: THREE.Object3D | undefined;
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 4.9, 14.3, 0);
    arm.add(box(2.8, 2.6, 3.0, cream, 0, -1.1, 0)); // shoulder armour
    arm.add(box(0.4, 2.2, 3.1, orange, s * 1.45, -1.0, 0));
    arm.add(box(1.5, 3.2, 1.6, dark, 0, -4.2, 0)); // upper arm
    arm.add(box(2.0, 3.6, 2.2, cream, 0, -7.9, 0)); // forearm
    arm.add(box(1.6, 1.4, 1.6, dark, 0, -9.2, 0)); // hand
    if (s > 0) {
      // beam rifle along the outside of the forearm: it points wherever the arm points
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6.0, 10), steel);
      barrel.position.set(1.2, -8.4, -0.3);
      arm.add(barrel);
      arm.add(box(1.0, 2.4, 1.2, teal, 1.2, -7.4, -0.3)); // housing
      arm.add(box(0.7, 0.4, 0.7, M('#8ff4ff'), 1.2, -11.6, -0.3)); // emitter
      muzzle = new THREE.Object3D();
      muzzle.position.set(1.2, -11.6, -0.3);
      arm.add(muzzle);
    }
    body.add(arm);
    arms.push(arm);
  }
  addOutline(body);
  return { root, body, wheels: [], legs, arms, flames, thrusterMat, muzzle };
}

const BUILDERS: Record<VehicleKind, () => VehicleBody> = {
  robot: buildRobot,
  wingCar: buildWingCar,
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
  /** In the air.  pos.y is the machine's height (absolute) whether flying or not. */
  airborne = false;
  vy = 0;
  /** 0 folded .. 1 spread */
  wingOpen = 0;
  private pitchVis = 0;
  private propSpin = 0;
  private hullsShown = true;
  /** Robot: vernier output 0..1 (flames, glow), walk cycle phase, arm raised to aim. */
  thrust = 0;
  private stride = 0;
  aim = 0;
  /** What the rifle arm is trying to point at, and for how much longer (s). */
  readonly aimTarget = new THREE.Vector3();
  aimHold = 0;
  /** Current rifle-arm angles relative to the body (rad): swing left/right, up/down. */
  private armYaw = 0;
  private armPitch = 0;
  /** Knock-back velocity (robot), decays. */
  readonly push = new THREE.Vector3();

  /** World direction the rifle points (robot only; falls back to the body's facing). */
  muzzleDir(out: THREE.Vector3) {
    const m = this.parts.muzzle;
    if (!m) return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    m.updateWorldMatrix(true, false);
    return out.set(0, -1, 0).transformDirection(m.matrixWorld); // the barrel runs down the arm (-y)
  }

  /** World position of the beam muzzle (robot only; falls back to the chest). */
  muzzle(out: THREE.Vector3) {
    const m = this.parts.muzzle;
    if (m) { m.updateWorldMatrix(true, false); return m.getWorldPosition(out); }
    return out.set(this.pos.x, this.pos.y + 12, this.pos.z);
  }

  /** From the seat (first person, VR) the machine's own outline shells only get in the way. */
  showHulls(on: boolean) {
    if (on === this.hullsShown) return;
    this.hullsShown = on;
    this.parts.root.traverse((o) => { if (o.userData.isOutline || o.userData.head) o.visible = on; });
  }

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

  /** Visual pose: wheels, bars, bank, wings, propeller.  groundY is used when on the ground. */
  pose(dt: number, groundY: number) {
    const p = this.parts, s = this.spec;
    if (!this.airborne) this.pos.y = groundY;
    p.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    p.root.rotation.y = this.yaw;
    const lean = (this.airborne && s.flight ? s.flight.bank : s.lean) * (this.hullsShown ? 1 : 0.45);
    const top = this.airborne && s.flight ? s.flight.maxAir : s.maxSpeed;
    const targetBank = -this.steerInput * Math.min(1, Math.abs(this.speed) / top) * lean;
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 4);
    p.body.rotation.z = this.bank;
    const targetPitch = this.airborne ? Math.max(-0.3, Math.min(0.3, this.vy * 0.045)) : 0;
    this.pitchVis += (targetPitch - this.pitchVis) * Math.min(1, dt * 4);
    p.body.rotation.x = this.pitchVis;
    if (!this.airborne) for (const w of p.wheels) w.rotation.x -= (this.speed * dt) / s.wheelRadius;
    if (p.steer) p.steer.rotation.y = -this.steerInput * 0.4;
    if (s.flight && p.wings) {
      const want = this.airborne ? 1 : Math.max(0, Math.min(1, (this.speed - s.flight.takeoff * 0.45) / (s.flight.takeoff * 0.45)));
      this.wingOpen += (want - this.wingOpen) * Math.min(1, dt * 2.5);
      const fold = (1 - this.wingOpen) * (Math.PI / 2 - 0.12);
      p.wings[0].rotation.z = -fold;
      p.wings[1].rotation.z = fold;
    }
    if (s.robot && p.legs && p.arms) {
      // walk cycle from ground speed; legs trail and arms spread a little in the air
      this.stride += Math.abs(this.speed) * dt * 0.32;
      const air = this.airborne ? 1 : 0;
      const swing = air ? 0.25 : Math.sin(this.stride) * Math.min(0.55, Math.abs(this.speed) * 0.07);
      p.legs[0].rotation.x = swing + air * 0.2;
      p.legs[1].rotation.x = -swing + air * 0.35;
      p.arms[0].rotation.x = -swing * 0.8 - air * 0.3;
      p.arms[0].rotation.z = -air * 0.25;
      // the right arm (rifle) comes up and tracks the target, as far as a shoulder turns
      if (this.aimHold > 0) {
        this.aimHold -= dt;
        this.aim = Math.min(1, this.aim + dt * 4);
        const sh = p.arms[1].getWorldPosition(_sh);
        const dx = this.aimTarget.x - sh.x, dy = this.aimTarget.y - sh.y, dz = this.aimTarget.z - sh.z;
        let yaw = Math.atan2(-dx, -dz) - this.yaw;
        while (yaw > Math.PI) yaw -= Math.PI * 2;
        while (yaw < -Math.PI) yaw += Math.PI * 2;
        const wantYaw = Math.max(-ARM_YAW, Math.min(ARM_YAW, yaw));
        const wantPitch = Math.max(ARM_PITCH[0], Math.min(ARM_PITCH[1], Math.atan2(dy, Math.hypot(dx, dz)) - p.body.rotation.x));
        const step = ARM_RATE * dt;
        this.armYaw += Math.max(-step, Math.min(step, wantYaw - this.armYaw));
        this.armPitch += Math.max(-step, Math.min(step, wantPitch - this.armPitch));
      } else {
        this.aim = Math.max(0, this.aim - dt * 1.5);
        this.armYaw *= 1 - Math.min(1, dt * 3);
        this.armPitch *= 1 - Math.min(1, dt * 3);
      }
      const rest = swing * 0.8 - air * 0.3;
      p.arms[1].rotation.order = 'YXZ'; // yaw the raised arm about the shoulder, then pitch it
      p.arms[1].rotation.x = rest * (1 - this.aim) + this.aim * (Math.PI / 2 + this.armPitch);
      p.arms[1].rotation.y = this.aim * this.armYaw;
      p.body.position.y = air ? 0 : Math.abs(Math.cos(this.stride)) * Math.min(0.5, Math.abs(this.speed) * 0.05);
      p.body.rotation.x = air ? -Math.min(0.25, Math.abs(this.speed) * 0.012) : 0; // lean into flight
      if (p.flames && p.thrusterMat) {
        for (const f of p.flames) f.scale.set(0.6 + this.thrust * 0.5, 0.001 + this.thrust * (1 + Math.random() * 0.25), 0.6 + this.thrust * 0.5);
        p.thrusterMat.emissiveIntensity = this.thrust * 2;
      }
    }
    if (p.prop) {
      const rate = 6 + Math.abs(this.speed) * 3 + (this.airborne ? 20 : 0);
      this.propSpin += rate * dt;
      p.prop.rotation.z = this.propSpin;
    }
  }
}
