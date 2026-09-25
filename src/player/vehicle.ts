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

// ---- beam saber keyframes: the whole body ----------------------------------------------------------
// ra / la: right / left arm (rx raise, ry swing to the robot's left, rz tilt), order YXZ
// up: the upper body at the waist (x lean back +, y twist to the left +, z tilt)
// st: stance 0..1 (hips drop, legs open front/back with the feet kept on the ground)
// lunge: metres the body shifts forward over the front foot; hop: metres it rises
// two: 0..1, how much the left hand is on the grip (1 = two-handed; `la` is ignored then)
// wp: wrist -- 0 holds the blade at right angles to the forearm (up, in the guard), -PI/2 lays it along the arm
// The arm's direction in the world is the upper-body twist PLUS the arm's ry: they must turn the same way
// through a cut, or they cancel (the horizontal sweep once only covered 83 degrees because of that).
type V3 = [number, number, number];
interface Pose { ra: V3; la: V3; up: V3; st: number; lunge: number; hop: number; wp: number; two: number }
const P = (ra: V3, la: V3, up: V3, st: number, lunge = 0, hop = 0, wp = 0, two = 0): Pose => ({ ra, la, up, st, lunge, hop, wp, two });
const REST_POSE = P([0, 0, 0], [0, 0, 0], [0, 0, 0], 0);
const GUARD = P([1.15, 0.3, -0.15], [1.0, -0.45, 0.2], [-0.05, -0.2, 0], 0.35, 0, 0, 0, 1); // both hands on the grip
const REACH = P([3.45, 0, 0.3], [0.35, 0, 0.15], [0.05, 0.25, -0.05], 0.15);
/**
 * The combo: a diagonal cut, a sweep, a rising cut, a two-handed overhead finisher.
 * Each cut starts where the one before it ended (low left -> sweep to the right ->
 * up from low right -> overhead -> down), so a chained combo never passes back
 * through the guard.
 */
export const SLASHES: { name: string; dur: number; wind: Pose; strike: Pose; follow: Pose }[] = [
  // diagonal: the blade leans over the shoulder, then cuts down across the body
  { name: '袈裟斬り', dur: 0.85,
    wind: P([3.0, -0.45, -0.5], [2.2, -0.3, 0.3], [0.12, -0.6, -0.12], 0.45, 0, 0, -0.2, 0.8),
    strike: P([1.0, 0.35, 0.35], [0.7, -0.2, 0.1], [-0.22, 0.4, 0.14], 0.8, 3, 0, -0.9, 0.4),
    follow: P([0.85, 0.75, 0.45], [0.45, 0.2, 0.2], [-0.24, 0.6, 0.16], 0.85, 3.5, 0, -0.45) },
  // horizontal: arm level, blade laid out along it, a flat arc at chest height from
  // the left (where the diagonal cut left the blade) round to the right
  { name: '横薙ぎ', dur: 0.85,
    wind: P([1.5, 1.2, 0], [1.2, 0.9, 0.1], [0.02, 0.65, -0.06], 0.6, 0, 0, -1.4, 1),
    strike: P([1.55, 0.0, 0], [0.8, -0.2, 0.3], [-0.1, 0.0, 0], 0.8, 2, 0, -1.5, 1),
    follow: P([1.5, -1.2, 0], [0.4, -0.9, 0.5], [-0.08, -0.75, 0.06], 0.75, 2.5, 0, -1.45, 1) },
  // rising: blade trailing low behind, swept up past the face
  { name: '斬り上げ', dur: 0.85,
    wind: P([0.55, -0.6, 0.45], [0.4, 0.3, 0.2], [-0.3, 0.3, 0.08], 1.0, 0, 0, -0.25, 0.7),
    strike: P([2.1, 0.1, -0.2], [1.1, 0, 0.3], [0.05, -0.1, -0.05], 0.45, 2, 0, -0.9, 0.3),
    follow: P([3.0, 0.4, -0.3], [1.9, 0, 0.5], [0.22, -0.3, -0.1], 0.1, 2, 1.5, -0.7) },
  // overhead: blade back over the head, then straight down in line with the arms
  { name: '唐竹割り', dur: 1.25,
    wind: P([3.55, 0.1, 0], [3.45, -0.25, -0.2], [0.28, 0, 0], 0.3, 0, 0.8, -0.3, 1),
    strike: P([1.35, 0.1, 0], [1.3, -0.35, -0.15], [-0.38, 0, 0], 1.0, 5, 0, -0.85, 1),
    follow: P([1.15, 0.1, 0], [1.1, -0.35, -0.1], [-0.36, 0, 0], 0.95, 5.5, 0, -0.4, 1) },
];
/** After the follow-through: seconds the body hangs on, carried on a little by the blade's weight, then seconds to come back to guard. */
const LINGER = [0.35, 0.35, 0.4, 0.6];
const RECOVER = [0.6, 0.6, 0.6, 0.8];
/** Where the follow-through drifts to while it lingers: a little further along the cut, a little lower. */
const settlePose = (S: { strike: Pose; follow: Pose }): Pose => {
  const d = blend(S.strike, S.follow, 1.12);
  return { ...d, st: S.follow.st + 0.1, two: S.follow.two, hop: 0 };
};
const lerpV = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (k: number) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
/** Pose -> flat number list and back, for the spline. */
const flatPose = (q: Pose) => [...q.ra, ...q.la, ...q.up, q.st, q.lunge, q.hop, q.wp, q.two];
const unflatPose = (a: number[]): Pose => ({ ra: [a[0], a[1], a[2]], la: [a[3], a[4], a[5]], up: [a[6], a[7], a[8]], st: a[9], lunge: a[10], hop: a[11], wp: a[12], two: Math.max(0, Math.min(1, a[13])) });
/**
 * Non-uniform Catmull-Rom through `keys` at `times` (0..1), with zero speed at both
 * ends: continuous position AND velocity at every key.
 */
function splinePose(keys: Pose[], times: number[], k: number): Pose {
  const x = Math.max(0, Math.min(1, k));
  let i = 0;
  while (i < times.length - 2 && x > times[i + 1]) i++;
  const P = keys.map(flatPose);
  const t0 = times[i], t1 = times[i + 1], h = t1 - t0;
  const tangent = (j: number) => (j === 0 || j === keys.length - 1)
    ? P[j].map(() => 0)
    : P[j].map((_, c) => (P[j + 1][c] - P[j - 1][c]) / (times[j + 1] - times[j - 1]));
  const m0 = tangent(i), m1 = tangent(i + 1);
  const u = (x - t0) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return unflatPose(P[i].map((p0, c) => h00 * p0 + h10 * h * m0[c] + h01 * P[i + 1][c] + h11 * h * m1[c]));
}
const blend = (a: Pose, b: Pose, k: number): Pose => ({
  ra: lerpV(a.ra, b.ra, k), la: lerpV(a.la, b.la, k), up: lerpV(a.up, b.up, k),
  st: a.st + (b.st - a.st) * k, lunge: a.lunge + (b.lunge - a.lunge) * k, hop: a.hop + (b.hop - a.hop) * k, wp: a.wp + (b.wp - a.wp) * k,
  two: a.two + (b.two - a.two) * k,
});
/** Robot arm: shoulder -> elbow -> centre of the hand. */
const UPPER_ARM = 4.25, FOREARM = 4.25;
/** Elbow to the saber's hilt (the right hand holds it just past the hand's centre). */
const SABER_REACH = 5.15;
const _g = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _nl = new THREE.Vector3();
const _pole = new THREE.Vector3(-0.6, -0.8, 0.3).normalize(); // the left elbow points down and out to the left
const _poleR = new THREE.Vector3(0.6, -0.8, 0.3).normalize(); // the right one down and out to the right
/** The point in front of the chest (upper-body frame) that a two-handed grip draws the hands toward. */
const _chest = new THREE.Vector3(0, 3.2, -6.5);
const _h2 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _qSaber = new THREE.Quaternion(), _qParent = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const _qIK = new THREE.Quaternion(), _qInv = new THREE.Quaternion();

/** Robot leg: hip -> knee -> ankle, and the ankle's height above the sole. */
const THIGH = 3.9, SHIN = 3.9, ANKLE = 1.2, HIP = 9;
/** Where the feet stand in the guard (local z, forward is -): left foot leads. */
const GUARD_FRONT = -2.4, GUARD_BACK = 2.8;
/** How far each cut steps in (m), before the game scales it by how close the kaiju already is. */
const STEP_IN = [4.5, 3.2, 3.2, 5.5];
/** Share of a step the body itself travels (the rest is the front foot's reach). */
const BODY_SHARE = 0.45;
/** The furthest the front foot reaches / the rear foot trails (m), and the deepest the hips go (m). */
const FRONT_MAX = 6.8, BACK_MAX = 6.0, MAX_LUNGE = 3.2;

/**
 * Two-bone IK in the leg's plane: angles for hip and knee that put the ankle at
 * (z, y) relative to the hip.  Forward is -z; +x rotation swings a limb forward.
 * The knee always bends forward, like a person's.
 */
function legIK(z: number, y: number) {
  const reach = THIGH + SHIN - 0.02;
  let c = Math.hypot(z, y);
  if (c > reach) c = reach;
  const toTarget = Math.atan2(-z, -y); // 0 = straight down, + = forward
  const hipOpen = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + c * c - SHIN * SHIN) / (2 * THIGH * c))));
  const kneeIn = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + SHIN * SHIN - c * c) / (2 * THIGH * SHIN))));
  return { hip: toTarget + hipOpen, knee: -(Math.PI - kneeIn) };
}

/** Robot rifle arm: how far it swings either side of the body (rad), its pitch range, and its speed (rad/s). */
const ARM_YAW = THREE.MathUtils.degToRad(40);
const ARM_PITCH: [number, number] = [THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(55)];
const ARM_RATE = 3.2;
/** Rifle arm: seconds to bring it up from the hip, and to lower it again. */
const RIFLE_UP = 0.22, RIFLE_DOWN = 0.9;
/** Seconds to take the saber off the back and light it, and to put it away. */
const DRAW_TIME = 1.2, STOW_TIME = 0.95;
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
  /** Robot: the saber's hilt stowed on the backpack, and the drawn saber in the right hand (blade scales along its z). */
  saberBack?: THREE.Object3D;
  saberHand?: THREE.Object3D;
  saberBlade?: THREE.Object3D;
  saberBase?: THREE.Object3D;
  saberTip?: THREE.Object3D;
  /** Robot: everything above the waist (torso, head, arms, backpack), pivoting at the hips so it can twist and lean. */
  upper?: THREE.Group;
  /** Robot: shin pivots at the knees (bend about X) and feet at the ankles (kept level). */
  shins?: THREE.Group[];
  feet?: THREE.Group[];
  /** Robot: the left forearm's pivot, bent to bring the left hand onto the saber's grip. */
  leftElbow?: THREE.Group;
  /** Robot: the right forearm's pivot (the rifle and the saber hang from it). */
  rightElbow?: THREE.Group;
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
  // legs: hip pivot at y 9, knee pivot 3.9 below it, ankle 3.9 below that (sole on the ground)
  const legs: THREE.Group[] = [], shins: THREE.Group[] = [], feet: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 2.2, 9, 0);
    leg.add(box(2.4, 3.6, 2.6, cream, 0, -3.6, 0)); // thigh
    leg.add(box(2.0, 0.6, 2.2, dark, 0, -4.2, 0)); // knee joint
    const shin = new THREE.Group();
    shin.position.y = -THIGH;
    shin.add(box(2.8, 3.6, 3.0, cream, 0, -3.9, 0.1)); // shin
    shin.add(box(2.9, 1.0, 1.0, orange, 0, -1.5, -1.45)); // knee guard
    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    foot.add(box(3.0, 1.2, 4.6, teal, 0, -1.2, -0.5)); // foot: stays level on the ground
    shin.add(foot);
    leg.add(shin);
    body.add(leg);
    legs.push(leg); shins.push(shin); feet.push(foot);
  }
  // pelvis (stays with the legs), torso, chest
  const lower = [box(5.2, 2.0, 3.2, dark, 0, 8.2, 0), box(1.6, 1.6, 0.6, orange, 0, 8.3, -1.8)]; // crotch plate
  body.add(...lower);
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
  let leftElbow: THREE.Group | undefined, rightElbow: THREE.Group | undefined;
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 4.9, 14.3, 0);
    arm.add(box(2.8, 2.6, 3.0, cream, 0, -1.1, 0)); // shoulder armour
    arm.add(box(0.4, 2.2, 3.1, orange, s * 1.45, -1.0, 0));
    arm.add(box(1.5, 3.2, 1.6, dark, 0, -4.2, 0)); // upper arm
    // forearm and hand hang from an elbow pivot, so the free hand can reach the saber's grip
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    elbow.add(box(2.0, 3.6, 2.2, cream, 0, -7.9 + UPPER_ARM, 0)); // forearm
    elbow.add(box(1.6, 1.4, 1.6, dark, 0, -9.2 + UPPER_ARM, 0)); // hand
    arm.add(elbow);
    if (s < 0) leftElbow = elbow;
    else rightElbow = elbow;
    if (s > 0) {
      // beam rifle along the outside of the forearm: it points wherever the forearm points
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6.0, 10), steel);
      barrel.position.set(1.2, -8.4 + UPPER_ARM, -0.3);
      elbow.add(barrel);
      elbow.add(box(1.0, 2.4, 1.2, teal, 1.2, -7.4 + UPPER_ARM, -0.3)); // housing
      elbow.add(box(0.7, 0.4, 0.7, M('#8ff4ff'), 1.2, -11.6 + UPPER_ARM, -0.3)); // emitter
      muzzle = new THREE.Object3D();
      muzzle.position.set(1.2, -11.6 + UPPER_ARM, -0.3);
      elbow.add(muzzle);
    }
    body.add(arm);
    arms.push(arm);
  }
  // beam saber: a hilt clipped to the backpack's right shoulder ...
  const hiltGeo = new THREE.CylinderGeometry(0.34, 0.38, 2.4, 10);
  const saberBack = new THREE.Group();
  saberBack.position.set(1.6, 15.4, 3.3);
  saberBack.rotation.set(-0.25, 0, -0.2);
  saberBack.add(new THREE.Mesh(hiltGeo, steel), box(0.8, 0.4, 0.8, dark, 0, 1.2, 0));
  body.add(saberBack);
  // ... and the same hilt in the right hand, with a blade that ignites out of it along -z
  const saberHand = new THREE.Group();
  saberHand.position.set(0, -9.4 + UPPER_ARM, -0.2);
  const hilt = new THREE.Mesh(hiltGeo, steel);
  hilt.rotation.x = Math.PI / 2;
  saberHand.add(hilt, box(0.9, 0.5, 0.5, dark, 0, -0.2, -1.1));
  const blade = new THREE.Group();
  blade.position.z = -1.3;
  const bladeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff4fb', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const bladeHalo = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ff4fb0', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  bladeCore.scale.z = 13;
  bladeHalo.scale.z = 13.6;
  for (const m of [bladeCore, bladeHalo]) m.userData.noOutline = true;
  blade.add(bladeCore, bladeHalo);
  const saberBase = new THREE.Object3D(), saberTip = new THREE.Object3D();
  saberTip.position.z = -13;
  blade.add(saberBase, saberTip);
  blade.scale.z = 0.001;
  saberHand.add(blade);
  saberHand.visible = false;
  rightElbow!.add(saberHand);
  // the waist: move everything that is not legs or pelvis under a pivot at hip height
  const upper = new THREE.Group();
  upper.position.y = 9.6;
  body.add(upper);
  body.updateMatrixWorld(true);
  for (const c of [...body.children]) if (c !== upper && !legs.includes(c as THREE.Group) && !lower.includes(c as THREE.Mesh)) upper.attach(c);
  upper.rotation.order = 'YXZ';
  addOutline(body);
  return { root, body, wheels: [], legs, shins, feet, arms, leftElbow, rightElbow, flames, thrusterMat, muzzle, saberBack, saberHand, saberBlade: blade, saberBase, saberTip, upper };
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
  /** Linear 0..1 behind `aim` (which is eased). */
  aimRaw = 0;
  /** Half-strides taken so far (a footfall each time it changes). */
  get stepCount() {
    return Math.floor(this.stride / Math.PI);
  }
  /** What the rifle arm is trying to point at, and for how much longer (s). */
  readonly aimTarget = new THREE.Vector3();
  aimHold = 0;
  /** Current rifle-arm angles relative to the body (rad): swing left/right, up/down. */
  private armYaw = 0;
  private armPitch = 0;
  /**
   * Robot close combat.  `state` runs stowed -> drawing -> ready <-> slash -> stowing -> stowed;
   * the game decides when, this class only animates.  `combo` picks the slash (0..3).
   */
  readonly saber = { state: 'stowed' as 'stowed' | 'drawing' | 'ready' | 'slash' | 'stowing', t: 0, combo: 0, dur: 0.45, ignite: 0, step: 1, hold: 0, rec: 0, total: 0.45 };
  /** Metres of the current cut's step already applied to pos (root motion). */
  private stepDone = 0;
  /** Where the feet are now (local z), and where they were when the current cut began. */
  private feetNow = { front: GUARD_FRONT, back: GUARD_BACK };
  private feetStart = { front: GUARD_FRONT, back: GUARD_BACK };
  private hipS = 9;
  private shimmer = 0;
  /** The saber pose last frame, and the pose when the current cut began (its wind-up blends from there). */
  private poseNow: Pose = REST_POSE;
  private slashFrom: Pose = REST_POSE;

  /** Saber back on the backpack, instantly (round reset). */
  resetSaber() {
    const p = this.parts;
    this.saber.state = 'stowed'; this.saber.t = 0; this.saber.ignite = 0;
    if (p.saberHand) p.saberHand.visible = false;
    if (p.saberBack) p.saberBack.visible = true;
    if (p.saberBlade) p.saberBlade.scale.z = 0.001;
    if (p.upper) p.upper.rotation.set(0, 0, 0);
    this.poseNow = REST_POSE;
    this.hipS = HIP;
    p.leftElbow?.quaternion.identity();
    p.rightElbow?.quaternion.identity();
    p.saberHand?.quaternion.identity();
  }
  drawSaber() { if (this.saber.state === 'stowed' || this.saber.state === 'stowing') { this.saber.state = 'drawing'; this.saber.t = 0; } }
  stowSaber() { if (this.saber.state !== 'stowed' && this.saber.state !== 'stowing') { this.saber.state = 'stowing'; this.saber.t = 0; } }
  /** Start slash `i` (0..3).  Returns false if the saber is not in hand. */
  slash(i: number) {
    const sb = this.saber;
    // a chained cut takes over once the blade is into its follow-through, and flows on from there
    if (sb.state !== 'ready' && !(sb.state === 'slash' && sb.t > sb.dur * 0.72)) return false;
    sb.state = 'slash'; sb.t = 0; sb.combo = i; sb.dur = SLASHES[i].dur;
    sb.hold = LINGER[i]; sb.rec = RECOVER[i]; sb.total = sb.dur * 0.8 + sb.hold + sb.rec;
    this.stepDone = 0;
    this.feetStart = { ...this.feetNow }; // a chained cut starts its footwork from mid-recovery
    this.slashFrom = this.poseNow;
    return true;
  }
  /** World positions of the blade's base and tip (for hits and the trail). */
  bladeEnds(base: THREE.Vector3, tip: THREE.Vector3) {
    const p = this.parts;
    if (!p.saberBase || !p.saberTip) return false;
    p.saberTip.updateWorldMatrix(true, false);
    p.saberBase.getWorldPosition(base);
    p.saberTip.getWorldPosition(tip);
    return true;
  }

  /** Knock-back velocity (robot), decays. */
  readonly push = new THREE.Vector3();

  /**
   * The whole body through the draw, the guard, the four cuts and the stow:
   * both arms, the upper body twisting and leaning at the waist, the hips
   * dropping into a stance with the legs opening front and back, and the body
   * shifting forward onto the front foot at the strike.  `walk` is how much the
   * walk cycle should still show through (moving or in the air: the stance gives way).
   */
  private poseSaber(dt: number, walk: number, walkLegs: [number, number]) {
    const p = this.parts, sb = this.saber;
    sb.t += dt;
    let key: Pose = GUARD;
    let ignite = sb.ignite;
    if (sb.state === 'drawing') {
      // reach over the right shoulder, take the hilt, bring it round to guard, light it
      const k = sb.t / DRAW_TIME;
      if (k < 0.45) key = blend(this.poseNow, REACH, ease(k / 0.45));
      else key = blend(REACH, GUARD, ease((k - 0.45) / 0.55));
      if (k >= 0.45 && p.saberBack?.visible) { p.saberBack.visible = false; if (p.saberHand) p.saberHand.visible = true; }
      ignite = Math.max(0, Math.min(1, (k - 0.6) / 0.25));
      if (k >= 1) { sb.state = 'ready'; sb.t = 0; }
    } else if (sb.state === 'ready') {
      // breathing in the guard: a slow sway of the blade and the shoulders
      key = { ...GUARD, ra: [GUARD.ra[0] + Math.sin(sb.t * 2.2) * 0.04, GUARD.ra[1], GUARD.ra[2]], up: [GUARD.up[0], GUARD.up[1] + Math.sin(sb.t * 1.1) * 0.04, 0] };
      ignite = 1;
    } else if (sb.state === 'slash') {
      const S = SLASHES[sb.combo];
      // one smooth curve through start -> wind-up -> strike -> follow-through, then the
      // weight of the blade carries it on a little and the body hangs there before it
      // comes back up to guard -- unless the next cut takes over from the follow-through
      const A = 0.8 * S.dur, T = sb.total;
      key = splinePose([this.slashFrom, S.wind, S.strike, S.follow, settlePose(S), GUARD],
        [0, 0.3 * S.dur, 0.55 * S.dur, A, A + sb.hold, T].map((x) => x / T), sb.t / T);
      ignite = 1;
      if (sb.t >= T) { sb.state = 'ready'; sb.t = 0; }
    } else if (sb.state === 'stowing') {
      // a shot wanted: put the saber away quickly so the rifle can come up
      if (this.aimHold > 0) sb.t += dt * 2;
      const k = sb.t / STOW_TIME;
      ignite = Math.max(0, 1 - k / 0.3);
      if (k < 0.5) key = blend(GUARD, REACH, ease(k / 0.5));
      else key = blend(REACH, REST_POSE, ease((k - 0.5) / 0.5));
      if (k >= 0.5 && p.saberHand?.visible) { p.saberHand.visible = false; if (p.saberBack) p.saberBack.visible = true; }
      if (k >= 1) { sb.state = 'stowed'; sb.t = 0; this.aim = this.aimRaw = 0; }
    }
    sb.ignite = ignite;
    this.shimmer += dt;
    if (p.saberBlade) p.saberBlade.scale.z = Math.max(0.001, ignite * (1 + 0.01 * Math.sin(this.shimmer * 37))); // a faint, smooth pulse (random per-frame jitter read as stutter)
    const [ra, la] = [p.arms![1], p.arms![0]];
    ra.rotation.order = la.rotation.order = 'YXZ';
    ra.rotation.set(key.ra[0], key.ra[1], key.ra[2]);
    la.rotation.set(key.la[0], key.la[1], key.la[2]);
    p.upper?.rotation.set(key.up[0], key.up[1], key.up[2]);
    if (p.saberHand) { p.saberHand.quaternion.identity(); p.saberHand.rotation.x = key.wp; } // the wrist (the grip may re-orient it)
    // ---- footwork -------------------------------------------------------------------
    // Feet are placed in the robot's local z (forward -).  A cut is a lunge and a
    // recovery, and every foot position is continuous from frame to frame:
    //   wind-up   the feet settle from wherever they were into the guard stance;
    //   step      the front foot lifts, swings forward and plants while the body is
    //             carried forward about half as far (root motion); the back foot
    //             stays planted in the world, so in local terms it falls behind;
    //   recovery  the body comes up over the front foot (more root motion, the front
    //             foot stays planted) while the back foot is lifted and drawn up --
    //             ending exactly in the guard stance, a step further on.
    const gFront = GUARD_FRONT * (1 + key.st * 0.5), gBack = GUARD_BACK * (1 + key.st * 0.2);
    let front = gFront, back = gBack, liftF = 0, liftB = 0;
    if (sb.state === 'slash') {
      const k = sb.t / sb.dur;
      const L = STEP_IN[sb.combo] * sb.step;
      const s0 = Math.min(1, k / 0.28), settle = ease(s0);
      const f0 = this.feetStart.front * (1 - settle) + gFront * settle;
      const b0 = this.feetStart.back * (1 - settle) + gBack * settle;
      // chained from the last cut's lunge: the front foot stays planted and the body is
      // carried up over it (root motion) while the back foot steps up behind
      const carry = Math.max(0, gFront - this.feetStart.front) * settle;
      if (s0 < 1 && (carry > 0.3 || Math.abs(this.feetStart.back - gBack) > 0.8)) liftB = Math.sin(Math.PI * s0) * 1.6;
      // the lunge
      const u = Math.max(0, Math.min(1, (k - 0.28) / 0.27));
      const D = L * BODY_SHARE * ease(u);
      const landAt = Math.max(-FRONT_MAX, gFront - L * (1 - BODY_SHARE) - 0.8);
      if (u > 0 && u < 1) liftF = Math.sin(Math.PI * u) * 2.2;
      front = (f0 + D) * (1 - u) + landAt * u;
      // (a step longer than the leg can trail drags the back foot along rather than sinking the hips)
      back = Math.min(BACK_MAX, b0 + D);
      // the recovery: rise over the planted front foot, draw the back foot up
      const r = Math.max(0, Math.min(1, (sb.t - sb.dur * 0.8 - sb.hold) / sb.rec));
      const E = (gFront - landAt) * ease(r);
      front += E;
      back = back * (1 - ease(r)) + gBack * ease(r);
      if (r > 0 && r < 1) liftB = Math.sin(Math.PI * r) * 1.6;
      // root motion for whatever the body travelled this frame
      const dTotal = carry + D + E - this.stepDone;
      this.stepDone = carry + D + E;
      this.pos.x -= Math.sin(this.yaw) * dTotal;
      this.pos.z -= Math.cos(this.yaw) * dTotal;
    } else this.stepDone = 0;
    this.feetNow.front = front;
    this.feetNow.back = back;
    // hips: as low as the stance asks, and low enough that both planted feet can reach the ground
    const walkLegs0 = walkLegs;
    let hipY = HIP - key.st * 1.6 + key.hop;
    // every foot counts, a lifted one at its lift height: as the lift eases to zero the
    // limit eases in with it, so landing never yanks the hips down in one frame
    for (const [z, lift] of [[front, liftF], [back, liftB]] as const) {
      const reachable = Math.sqrt(Math.max(0, (THIGH + SHIN - 0.05) ** 2 - z * z)) + ANKLE + lift;
      hipY = Math.min(hipY, reachable);
    }
    hipY = Math.max(HIP - MAX_LUNGE, hipY) * (1 - walk) + HIP * walk;
    // the hips follow that height with a quick spring, never a one-frame drop
    this.hipS += (hipY - this.hipS) * Math.min(1, dt * 14);
    hipY = this.hipS;
    // solve each leg; the foot stays level
    const legsTarget: [number, number][] = [[front, liftF], [back, liftB]];
    for (let i = 0; i < 2; i++) {
      const [z, lift] = legsTarget[i];
      const ik = legIK(z, -(hipY - ANKLE - lift));
      p.legs![i].rotation.x = walkLegs0[i] * walk + ik.hip * (1 - walk);
      if (p.shins) p.shins[i].rotation.x = ik.knee * (1 - walk);
      if (p.feet) p.feet[i].rotation.x = -(p.legs![i].rotation.x + (p.shins ? p.shins[i].rotation.x : 0));
    }
    p.legs![0].rotation.z = -0.06 * key.st;
    p.legs![1].rotation.z = 0.06 * key.st;
    const drop = HIP - hipY;
    this.poseNow = key;
    return { drop, lunge: 0, hop: 0 };
  }


  /**
   * Two-handed grip.  The keyframes move a straight right arm; for a two-handed
   * hold the right hand is drawn in toward the middle of the chest (elbow bent,
   * two-bone IK) while the saber keeps exactly the world orientation the
   * keyframe gave it -- so the cut's blade path is unchanged -- and the left hand
   * is solved onto the grip just behind the right fist.  `two` blends it all in.
   */
  private gripLeft(two: number) {
    const p = this.parts, armL = p.arms?.[0], armR = p.arms?.[1], elL = p.leftElbow, elR = p.rightElbow, hilt = p.saberHand;
    if (!armL || !armR || !elL || !elR || !hilt) return;
    // start from straight elbows every frame: last frame's bend must not leak into this frame's pose
    elL.quaternion.identity();
    elR.quaternion.identity();
    if (two <= 0.001) return;
    p.root.updateMatrixWorld(true);
    const upper = armR.parent!;
    // 1. where the straight arm put the right hand, and how the saber is oriented in the world
    const handStraight = upper.worldToLocal(hilt.getWorldPosition(_g)).clone();
    hilt.getWorldQuaternion(_qSaber);
    // 2. draw the hands in toward a point in front of the chest (upper-body frame)
    const hand = _h2.copy(handStraight).lerp(_chest, 0.6 * two);
    this.solveArm(armR, elR, hand, _poleR, two, SABER_REACH); // the hilt sits a little past the hand's centre
    // 3. keep the saber's world orientation: undo what the bent arm did to it
    p.root.updateMatrixWorld(true);
    elR.getWorldQuaternion(_qParent);
    hilt.quaternion.copy(_qParent.invert().multiply(_qSaber));
    p.root.updateMatrixWorld(true);
    // 4. the left hand onto the grip, pommel side of the right fist
    const target = upper.worldToLocal(hilt.localToWorld(_g.set(0, 0, 1.6)));
    this.solveArm(armL, elL, target, _pole, two, FOREARM);
  }

  /** Two-bone IK for one arm toward `target` (the upper body's frame), elbow toward `pole`, blended by `w`. */
  private solveArm(arm: THREE.Group, elbow: THREE.Group, target: THREE.Vector3, pole: THREE.Vector3, w: number, fore: number) {
    const t = _t2.copy(target).sub(arm.position);
    const c = Math.min(t.length(), UPPER_ARM + fore - 0.05);
    const dir = t.normalize();
    const n = _n.crossVectors(dir, pole).normalize();
    const alpha = Math.acos(Math.max(-1, Math.min(1, (UPPER_ARM ** 2 + c * c - fore ** 2) / (2 * UPPER_ARM * c))));
    _qIK.setFromUnitVectors(_down, _u.copy(dir).applyAxisAngle(n, alpha));
    arm.quaternion.slerp(_qIK, w);
    const interior = Math.acos(Math.max(-1, Math.min(1, (UPPER_ARM ** 2 + fore ** 2 - c * c) / (2 * UPPER_ARM * fore))));
    elbow.quaternion.setFromAxisAngle(_nl.copy(n).applyQuaternion(_qInv.copy(_qIK).invert()), -(Math.PI - interior) * w);
  }

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
      const swing = air ? 0 : Math.sin(this.stride) * Math.min(0.55, Math.abs(this.speed) * 0.07);
      // in the air: legs straight, trailing back as it gathers speed (never tucked forward -- that reads as a crouch),
      // one a little behind the other, feet slightly apart; the free arm eases back
      const fwd = Math.min(1, Math.abs(this.speed) / (s.robot.air || 1));
      const legA = air ? -(0.06 + 0.3 * fwd) : swing, legB = air ? -(0.14 + 0.4 * fwd) : -swing;
      p.legs[0].rotation.x += (legA - p.legs[0].rotation.x) * Math.min(1, dt * 6);
      p.legs[1].rotation.x += (legB - p.legs[1].rotation.x) * Math.min(1, dt * 6);
      if (p.shins && p.feet) for (let i = 0; i < 2; i++) {
        // a soft knee on the lifting leg while walking; straight in the air
        const lift = air ? 0 : Math.max(0, i ? -Math.sin(this.stride) : Math.sin(this.stride)) * Math.min(0.6, Math.abs(this.speed) * 0.08);
        p.shins[i].rotation.x = -lift;
        p.feet[i].rotation.x = -(p.legs[i].rotation.x - lift);
      }
      p.legs[0].rotation.z += ((air ? -0.05 : 0) - p.legs[0].rotation.z) * Math.min(1, dt * 6);
      p.legs[1].rotation.z += ((air ? 0.05 : 0) - p.legs[1].rotation.z) * Math.min(1, dt * 6);
      const armA = air ? -(0.15 + 0.35 * fwd) : -swing * 0.8;
      p.arms[0].rotation.x += (armA - p.arms[0].rotation.x) * Math.min(1, dt * 6);
      p.arms[0].rotation.z += ((air ? -0.18 : 0) - p.arms[0].rotation.z) * Math.min(1, dt * 6);
      // lean into flight -- set before the rifle aims, which compensates for it
      p.body.rotation.x = air ? -Math.min(0.25, Math.abs(this.speed) * 0.012) : 0;
      let saberBody = { drop: 0, lunge: 0, hop: 0 };
      if (this.saber.state !== 'stowed') {
        // moving or airborne, the legs keep walking / trailing and the stance gives way
        const walk = air ? 1 : Math.max(0, Math.min(1, (Math.abs(this.speed) - 1.5) / 3));
        saberBody = this.poseSaber(dt, walk, [legA, legB]);
      } else
      // the right arm (rifle) comes up and tracks the target, as far as a shoulder turns
      if (this.aimHold > 0) {
        this.aimHold -= dt;
        this.aimRaw = Math.min(1, this.aimRaw + dt / RIFLE_UP);
        this.aim = 1 - (1 - this.aimRaw) ** 3; // quick off the hip, settling onto the target
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
        this.aimRaw = Math.max(0, this.aimRaw - dt / RIFLE_DOWN);
        this.aim = this.aimRaw * this.aimRaw * (3 - 2 * this.aimRaw); // lowered unhurriedly
        this.armYaw *= 1 - Math.min(1, dt * 3);
        this.armPitch *= 1 - Math.min(1, dt * 3);
      }
      if (this.saber.state === 'stowed') {
        const rest = air ? -(0.15 + 0.35 * fwd) : swing * 0.8;
        p.arms[1].rotation.order = 'YXZ'; // yaw the raised arm about the shoulder, then pitch it
        p.arms[1].rotation.x = rest * (1 - this.aim) + this.aim * (Math.PI / 2 + this.armPitch);
        p.arms[1].rotation.y = this.aim * this.armYaw;
        p.arms[1].rotation.z = 0;
        p.upper?.rotation.set(0, 0, 0);
      }
      const bob = air ? 0 : Math.abs(Math.cos(this.stride)) * Math.min(0.5, Math.abs(this.speed) * 0.05);
      p.body.position.set(0, bob - saberBody.drop + saberBody.hop, -saberBody.lunge);
      p.root.position.set(this.pos.x, this.pos.y, this.pos.z); // the saber step moved pos this frame
      this.gripLeft(this.saber.state === 'stowed' ? 0 : this.poseNow.two * (p.saberHand?.visible ? 1 : 0));
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
