import * as THREE from 'three';
import type { World } from '../world/world';
import type { Player } from '../player/player';
import { Destruction } from './destruction';
import { buildKaiju, type KaijuBody } from './kaiju';
import { Fx, SaberTrail, type Bolt } from './fx';
import { SLASHES } from '../player/vehicle';
import { COURSE } from '../world/course';
import { sfx } from '../audio/sfx';

/**
 * Robot mode's game loop:
 *   knock buildings down (beam, ramming, stomping)  ->  after SUMMON of them the
 *   kaiju rises out of the ground somewhere nearby  ->  it walks at you, crushing
 *   what it walks through, and spits slow plasma balls  ->  shoot it from range,
 *   or close in: the robot switches to close-combat mode and draws its beam saber
 *   (a four-cut combo)  ->  the kaiju rocks back under every hit  ->  when its HP
 *   gauge is empty it topples and sinks  ->  the city is restored and you are back
 *   at the start.
 *
 * Everything here runs from `update(dt)` (no rAF of its own), so the tests in
 * main.ts can drive whole rounds with __scene.step().
 */

export const SUMMON = 6; // buildings down before the kaiju comes
const KAIJU_HP = 100;
const BEAM_DAMAGE_KAIJU = 5;
const BEAM_RANGE = 600;
const BEAM_COOLDOWN = 0.2;
/** Beam bolts travel: you see them go and land a beat later. m/s. */
const BOLT_SPEED = 180;
/** Targets further round than this from the robot's facing cannot be fired at (it turns first). */
const FIRE_ARC = THREE.MathUtils.degToRad(100);
/** How fast the body swings round toward what it is aiming at (rad/s). */
const AIM_TURN = 1.5;
/** How long the rifle arm stays up after the trigger is released (s). */
const AIM_HOLD = 0.9;
/** The kaiju model is authored ~28 m tall; this makes it tower over the zakkyo (~45 m). */
const S = 1.6;
/** Close combat: switch in under MELEE_IN metres (horizontal, to the kaiju's centre), back out over MELEE_OUT. */
const MELEE_IN = 50;
const MELEE_OUT = 62;
/** A slash connects if the kaiju's centre is within this reach and in front. */
const SLASH_REACH = 40; // the kaiju's body radius (~21 m) + blade (13 m) + arm
const SLASH_DAMAGE = [6, 6, 7, 15];
/** How the kaiju reels: impulse per hit kind. */
const RECOIL = { beam: 0.28, slash: 0.6, finisher: 1.15 };
/** After a slash finishes, the next click within this window continues the combo. */
const COMBO_WINDOW = 0.75;

type Phase = 'calm' | 'rising' | 'fighting' | 'dying' | 'cleared';
interface Orb { mesh: THREE.Mesh; v: THREE.Vector3; life: number }

export interface GameHud {
  toast(text: string): void;
  gauge(ratio: number | null): void; // null hides it
  counter(text: string): void;
}

export class RobotGame {
  readonly world: World;
  readonly player: Player;
  readonly destruction: Destruction;
  readonly kaiju: KaijuBody;
  readonly fx = new Fx();
  phase: Phase = 'calm';
  hp = KAIJU_HP;
  /** 'shoot' at range, 'melee' with the saber when close to the kaiju. */
  mode: 'shoot' | 'melee' = 'shoot';
  /** Rounds won, slashes landed, beam hits: for the tests. */
  wins = 0;
  hits = 0;
  slashHits = 0;
  /** The biggest the kaiju has reeled this round (rad), for the tests. */
  maxRecoil = 0;
  /** Combo indices of the slashes started, in order (tests read it). */
  readonly comboLog: number[] = [];
  private hud: GameHud;
  private t = 0; // time in the current phase
  private cooldown = 0;
  private bolts: Bolt[] = [];
  private orbs: Orb[] = [];
  private trail = new SaberTrail();
  private orbMat = new THREE.MeshBasicMaterial({ color: '#ff5ad8', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private flash = new THREE.PointLight('#8ff4ff', 0, 60, 1.5);
  private kPos = new THREE.Vector3();
  private kYaw = 0;
  private walkPhase = 0;
  private breath = 0; // charge of the next plasma ball
  private hitFlash = 0;
  private near: import('../world/world').Destructible[] = [];
  private ray = new THREE.Ray();
  private warnAt = -10;
  private robotSteps = 0;
  private kaijuSteps = 0;
  // saber
  private wantSlash = false;
  private sinceSlash = 99; // time since the last slash finished
  private lastCombo = -1;
  private slashStruck = false;
  private slashSwung = false;
  // kaiju recoil: a damped spring on the lean-back angle, plus a stagger
  private rec = 0;
  private recV = 0;
  private stun = 0;

  constructor(world: World, player: Player, hud: GameHud) {
    this.world = world;
    this.player = player;
    this.hud = hud;
    this.destruction = new Destruction(world);
    this.kaiju = buildKaiju();
    this.kaiju.root.visible = false;
    this.kaiju.root.scale.setScalar(S);
    world.group.add(this.kaiju.root, this.flash, this.fx.group, this.trail.mesh);
    this.destruction.onDown(() => {
      if (this.phase === 'calm') this.hud.counter(`破壊 ${this.destruction.downCount} / ${SUMMON}`);
      if (this.phase === 'calm' && this.destruction.downCount >= SUMMON) this.summon();
    });
    this.hud.counter(`破壊 0 / ${SUMMON}`);
  }

  get robotActive() {
    return this.player.mode === 'ride' && !!this.player.vehicle?.spec.robot;
  }

  /**
   * The trigger, every frame: `held` while the button is down, `pressed` on the
   * frame it went down.  Shooting mode fires while held; close-combat mode cuts
   * once per press (a press during a cut queues the next one in the combo).
   */
  trigger(camera: THREE.Camera, held: boolean, pressed: boolean) {
    if (this.mode === 'melee') { if (pressed) this.wantSlash = true; }
    else if (held) this.fire(camera);
  }

  /**
   * Fire the beam.  The pilot aims with the camera (or `aimAt` in tests); the
   * robot raises its rifle arm, swings it toward that point as far as the arm
   * reaches, and turns its body round after it.  A bolt leaves the muzzle along
   * the rifle and travels at BOLT_SPEED, so it lands a beat later -- near the
   * target while the body is still turning, dead on once it has caught up.
   * Anything more than FIRE_ARC behind cannot be shot at.
   */
  fire(camera: THREE.Camera, aimAt?: THREE.Vector3) {
    if (!this.robotActive || this.phase === 'cleared' || this.mode === 'melee') return false;
    const v = this.player.vehicle!;
    if (aimAt) v.aimTarget.copy(aimAt);
    else {
      camera.getWorldPosition(this.ray.origin);
      camera.getWorldDirection(this.ray.direction);
      v.aimTarget.copy(this.trace(this.ray, BEAM_RANGE).end);
    }
    v.aimHold = AIM_HOLD;
    const rel = wrap(Math.atan2(-(v.aimTarget.x - v.pos.x), -(v.aimTarget.z - v.pos.z)) - v.yaw);
    if (Math.abs(rel) > FIRE_ARC) {
      if (this.t - this.warnAt > 1.5) { this.warnAt = this.t; this.hud.toast('後ろには撃てない — 旋回中'); }
      return false;
    }
    if (this.cooldown > 0 || v.aim < 0.9) return false; // rifle still coming up
    this.cooldown = BEAM_COOLDOWN;
    const from = v.muzzle(new THREE.Vector3());
    const dir = v.muzzleDir(new THREE.Vector3());
    this.bolts.push(this.fx.bolt(from, dir));
    this.fx.muzzle(from, dir);
    this.flash.position.copy(from);
    this.flash.intensity = 250;
    sfx.beam(from);
    return true;
  }

  /** First thing a ray meets within `range`: the kaiju, a standing building, or the ground. */
  private trace(ray: THREE.Ray, range: number) {
    let end = ray.at(range, new THREE.Vector3());
    let tBest = range;
    let target: 'kaiju' | number | null | undefined; // undefined: nothing within range
    if (this.kaiju.root.visible && (this.phase === 'fighting' || this.phase === 'rising')) {
      const hit = ray.intersectSphere(_s.set(this.kaijuCentre(_c), 13 * S), _h);
      if (hit) { const t = hit.distanceTo(ray.origin); if (t < tBest) { tBest = t; target = 'kaiju'; end = hit.clone(); } }
    }
    const b = this.destruction.raycast(ray, tBest);
    if (b) { tBest = b.t; target = b.d.id; end = ray.at(b.t, new THREE.Vector3()); }
    if (ray.direction.y < -0.01) {
      const tg = -ray.origin.y / ray.direction.y;
      if (tg > 0 && tg < tBest) { tBest = tg; target = null; end = ray.at(tg, new THREE.Vector3()); }
    }
    return { end, target };
  }

  private kaijuCentre(out: THREE.Vector3) {
    return out.copy(this.kPos).setY(this.kPos.y + 16 * S);
  }

  /** The robot rammed or stomped something. */
  crush(id: number) {
    this.destruction.damage(id, 99);
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    const v = this.player.vehicle;
    // robot footfalls: one thud per half stride on the ground
    if (v && this.robotActive) {
      const n = v.stepCount;
      if (n !== this.robotSteps && !v.airborne && Math.abs(v.speed) > 0.5) sfx.robotStep(v.pos, Math.min(1.6, 0.6 + Math.abs(v.speed) * 0.08));
      this.robotSteps = n;
    }
    // while aiming, the body swings round toward the target (the camera does not: the pilot keeps the view)
    if (v && this.robotActive && v.aimHold > 0 && this.mode === 'shoot') {
      const d = wrap(Math.atan2(-(v.aimTarget.x - v.pos.x), -(v.aimTarget.z - v.pos.z)) - v.yaw);
      if (Math.abs(d) > 0.01) v.yaw += Math.sign(d) * Math.min(Math.abs(d), AIM_TURN * dt);
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash.intensity *= Math.pow(0.001, dt);
    this.destruction.update(dt);
    this.updateBolts(dt);
    this.updateOrbs(dt);
    this.updateMelee(dt);
    this.fx.update(dt, camera);
    this.trail.update(dt);
    const k = this.kaiju;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // a brief warm flash on the hide, not a solid pink silhouette
    const hf = Math.min(1, Math.max(0, this.hitFlash) * 3.5);
    k.skin.emissive.setRGB(0.42 * hf, 0.22 * hf, 0.3 * hf);
    // the kaiju's recoil spring
    const acc = -38 * this.rec - 6.5 * this.recV; // soft spring: a slow, heavy sway back and forth
    this.recV += acc * dt;
    this.rec = Math.max(-0.25, Math.min(1.0, this.rec + this.recV * dt));
    this.maxRecoil = Math.max(this.maxRecoil, this.rec);
    this.stun = Math.max(0, this.stun - dt);
    if (k.root.visible) {
      camera.getWorldPosition(_c);
      k.bar.lookAt(_c);
      k.barFill.scale.x = Math.max(0.001, this.hp / KAIJU_HP);
      k.bar.visible = this.phase === 'fighting' || this.phase === 'rising';
    }
    switch (this.phase) {
      case 'rising': this.updateRising(dt); break;
      case 'fighting': this.updateFighting(dt); break;
      case 'dying': this.updateDying(dt); break;
      case 'cleared':
        if (this.t > 2.5) this.reset();
        break;
    }
  }

  /** Back to the start: buildings up, rubble gone, kaiju gone, robot at the start. */
  reset() {
    this.destruction.restoreAll();
    this.phase = 'calm';
    this.t = 0;
    this.hp = KAIJU_HP;
    this.kaiju.root.visible = false;
    for (const o of this.orbs) o.mesh.removeFromParent();
    this.orbs.length = 0;
    for (const b of this.bolts) this.fx.removeBolt(b);
    this.bolts.length = 0;
    this.setMode('shoot', true);
    this.player.vehicle?.resetSaber();
    this.rec = this.recV = this.stun = 0;
    this.maxRecoil = 0;
    this.comboLog.length = 0;
    this.player.reset();
    this.hud.gauge(null);
    this.hud.counter(`破壊 0 / ${SUMMON}`);
    this.hud.toast('街がもとに戻った');
    sfx.chime();
  }

  // ---- close combat -------------------------------------------------------------

  private setMode(mode: 'shoot' | 'melee', quiet = false) {
    if (mode === this.mode) return;
    this.mode = mode;
    const v = this.player.vehicle;
    if (mode === 'melee') {
      v?.drawSaber();
      v && (v.aimHold = 0);
      if (!quiet) { this.hud.toast('接近モード — ビームサーベル'); sfx.saberIgnite(v?.pos, 0.45); }
    } else {
      v?.stowSaber();
      this.wantSlash = false;
      if (!quiet) { this.hud.toast('射撃モード'); sfx.saberOff(v?.pos); }
    }
    if (this.phase === 'fighting') this.hud.counter(mode === 'melee' ? '⚔ 接近モード' : '◎ 射撃モード');
  }

  private updateMelee(dt: number) {
    const v = this.player.vehicle;
    if (!v || !this.robotActive) return;
    const sb = v.saber;
    // choose the mode from the distance to the kaiju
    const fighting = this.phase === 'fighting' && this.kaiju.root.visible;
    const dist = Math.hypot(v.pos.x - this.kPos.x, v.pos.z - this.kPos.z);
    if (fighting && this.mode === 'shoot' && dist < MELEE_IN) this.setMode('melee');
    else if (this.mode === 'melee' && (!fighting || dist > MELEE_OUT)) this.setMode('shoot');
    if (this.mode !== 'melee') return;
    // face the kaiju
    const want = Math.atan2(-(this.kPos.x - v.pos.x), -(this.kPos.z - v.pos.z));
    const d = wrap(want - v.yaw);
    if (Math.abs(d) > 0.01) v.yaw += Math.sign(d) * Math.min(Math.abs(d), 2.2 * dt);
    // start the next cut: the combo continues if the click came soon enough after the last one
    if (sb.state !== 'slash') this.sinceSlash += dt;
    if (this.wantSlash) {
      const next = this.sinceSlash < COMBO_WINDOW || sb.state === 'slash' ? (this.lastCombo + 1) % SLASHES.length : 0;
      // step in fully from out at the edge of reach, barely when already on top of it
      v.saber.step = Math.max(0.2, Math.min(1.8, (dist - 18) / 12));
      if (v.slash(next)) {
        this.wantSlash = false;
        this.lastCombo = next;
        this.comboLog.push(next);
        this.slashStruck = false;
        this.slashSwung = false;
        this.sinceSlash = 0;
      } else if (sb.state !== 'drawing' && sb.state !== 'slash') this.wantSlash = false;
    }
    if (sb.state !== 'slash') return;
    const k = sb.t / sb.dur;
    const heavy = sb.combo === 3;
    // the whoosh as the blade comes round, the trail while it moves, the hit at the strike
    if (!this.slashSwung && k > 0.28) { this.slashSwung = true; sfx.saberSwing(v.pos, heavy); }
    if (k > 0.26 && k < 0.82 && v.bladeEnds(_a, _b)) this.trail.push(_a, _b);
    if (!this.slashStruck && k >= 0.45) {
      this.slashStruck = true;
      const rel = Math.abs(wrap(want - v.yaw));
      if (fighting && dist < SLASH_REACH && rel < 1.2) {
        // where the blade meets the kaiju: the point of its body sphere nearest the blade tip
        v.bladeEnds(_a, _b);
        const c = this.kaijuCentre(_c);
        const at = _h.copy(_b).sub(c).setLength(13 * S * 0.8).add(c);
        at.y = Math.max(at.y, _b.y * 0.5 + at.y * 0.5);
        this.hitKaiju(at, SLASH_DAMAGE[sb.combo], heavy ? RECOIL.finisher : RECOIL.slash, heavy ? 5 : 1.5);
        this.slashHits++;
        this.fx.impact(at, heavy ? 1.8 : 1.1, '#ff6ac8');
        this.fx.sparkBurst(at, heavy ? 40 : 20, 55);
        sfx.saberHit(at, heavy);
      }
    }
  }

  /** Damage + recoil + stagger.  `impulse` sets how far it reels, `knock` metres it is shoved back. */
  private hitKaiju(at: THREE.Vector3, damage: number, impulse: number, knock: number) {
    const v = this.player.vehicle!;
    this.hp = Math.max(0, this.hp - damage);
    this.hits++;
    this.hitFlash = impulse > 0.5 ? 0.3 : 0.18;
    this.recV += impulse * 6.5;
    this.stun = Math.max(this.stun, 0.35 + impulse * 0.6);
    // shoved back, away from the robot
    const dx = this.kPos.x - v.pos.x, dz = this.kPos.z - v.pos.z, l = Math.hypot(dx, dz) || 1;
    this.kPos.x += (dx / l) * knock;
    this.kPos.z += (dz / l) * knock;
    this.breath = Math.min(this.breath, 0.2); // a hard hit breaks its charge
    this.destruction.burst(at, new THREE.Color('#6a4a8a'), impulse > 0.5 ? 10 : 5, 4);
    this.hud.gauge(this.hp / KAIJU_HP);
    if (impulse >= 0.5) sfx.yelp(this.kaijuCentre(_c), impulse > 1);
    if (this.hp <= 0) this.defeat();
  }

  // ---- bolts ------------------------------------------------------------------------

  private updateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const step = BOLT_SPEED * dt;
      this.ray.origin.copy(b.pos);
      this.ray.direction.copy(b.dir);
      const hit = step > 0 ? this.trace(this.ray, step) : { end: b.pos, target: undefined };
      if (hit.target !== undefined) {
        b.pos.copy(hit.end);
        this.boltHit(hit.end, hit.target);
        this.fx.removeBolt(b);
        this.bolts.splice(i, 1);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.travelled += step;
      this.fx.placeBolt(b, dt);
      if (b.travelled > BEAM_RANGE) { this.fx.removeBolt(b); this.bolts.splice(i, 1); }
    }
  }

  private boltHit(end: THREE.Vector3, target: 'kaiju' | number | null) {
    this.flash.position.copy(end);
    this.flash.intensity = 450;
    if (target === 'kaiju') {
      this.fx.impact(end, 1.2, '#ff8ad8');
      sfx.hitKaiju(end);
      this.hitKaiju(end, BEAM_DAMAGE_KAIJU, RECOIL.beam, 1.2);
    } else {
      this.fx.impact(end, 1, '#9ff4ff');
      sfx.impact(end);
      if (typeof target === 'number') this.destruction.damage(target, 1, end);
      else this.destruction.puff(end, 3, 0.8);
    }
  }

  // ---- phases ------------------------------------------------------------------

  private summon() {
    // 110-140 m from the robot, toward the middle of town so it walks into the streets
    const v = this.player.vehicle!;
    const toCentre = Math.atan2(-v.pos.x, -v.pos.z);
    const a = toCentre + (Math.random() - 0.5) * 1.2;
    const d = 110 + Math.random() * 30;
    this.placeKaiju(v.pos.x + Math.sin(a) * d, v.pos.z + Math.cos(a) * d);
  }

  /** Bring the kaiju up out of the ground at (x, z).  Public for the tests. */
  placeKaiju(x: number, z: number) {
    const v = this.player.vehicle!;
    const half = COURSE.flightHalf - 40;
    this.kPos.set(Math.max(-half, Math.min(half, x)), -30, Math.max(-half, Math.min(half, z)));
    this.kYaw = Math.atan2(this.kPos.x - v.pos.x, this.kPos.z - v.pos.z); // face the robot (front is -z)
    this.hp = KAIJU_HP;
    this.phase = 'rising';
    this.t = 0;
    this.kaiju.root.visible = true;
    this.hud.gauge(1);
    this.hud.counter('');
    this.hud.toast('怪獣が現れた！');
    sfx.roar(this.kPos.clone().setY(20));
  }

  private updateRising(dt: number) {
    const k = Math.min(1, this.t / 3.5);
    this.kPos.y = -30 * S * (1 - k) * (1 - k);
    if (Math.random() < dt * 20) this.destruction.puff(new THREE.Vector3(this.kPos.x + (Math.random() - 0.5) * 24, 1, this.kPos.z + (Math.random() - 0.5) * 24), 6 + Math.random() * 6, 2.5);
    this.crushUnderfoot(16 * S);
    this.kaiju.jaw.rotation.x = 0.5 * Math.sin(this.t * 6) * (1 - k);
    this.poseKaiju(dt, 0);
    if (k >= 1) {
      this.phase = 'fighting'; this.t = 0; this.breath = -0.5;
      this.hud.counter('◎ 射撃モード');
    }
  }

  private updateFighting(dt: number) {
    const v = this.player.vehicle!;
    const dx = v.pos.x - this.kPos.x, dz = v.pos.z - this.kPos.z;
    const dist = Math.hypot(dx, dz);
    // turn toward the robot, walk until close, then stand and spit -- unless reeling from a hit
    const want = Math.atan2(-dx, -dz);
    const d = wrap(want - this.kYaw);
    const stunned = this.stun > 0;
    if (!stunned) this.kYaw += Math.sign(d) * Math.min(Math.abs(d), 0.7 * dt);
    const speed = !stunned && dist > 70 ? 8 : 0;
    this.kPos.x += -Math.sin(this.kYaw) * speed * dt;
    this.kPos.z += -Math.cos(this.kYaw) * speed * dt;
    this.crushUnderfoot(11 * S);
    // plasma: charge 2.2 s (spines and mouth blaze), then fire at the robot's chest
    if (!stunned) {
      if (this.breath < 0 && this.breath + dt >= 0 && dist < 260) sfx.charge(this.kPos.clone().setY(36), 2.2);
      this.breath += dt;
    }
    const charge = Math.max(0, Math.min(1, this.breath / 2.2));
    this.kaiju.glow.emissiveIntensity = 0.8 + charge * 2.5;
    this.kaiju.jaw.rotation.x = Math.max(charge * 0.6, this.rec * 0.9); // it gapes when it reels
    if (this.breath > 2.2 && dist < 260 && !stunned) {
      this.breath = -1.2 - Math.random();
      const from = _c.set(0, 22.5 * S, -9 * S).applyAxisAngle(_up, this.kYaw).add(this.kPos);
      const to = _h.set(v.pos.x, v.pos.y + 12, v.pos.z);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), this.orbMat);
      orb.position.copy(from);
      this.world.group.add(orb);
      sfx.plasma(from);
      this.orbs.push({ mesh: orb, v: to.sub(from).normalize().multiplyScalar(34), life: 7 });
    }
    this.poseKaiju(dt, speed);
  }

  private defeat() {
    this.phase = 'dying';
    this.t = 0;
    this.hud.gauge(0);
    this.hud.toast('怪獣を倒した！');
    this.rec = this.recV = 0;
    this.setMode('shoot', true);
    sfx.roar(this.kPos.clone().setY(20), true);
    sfx.impact(this.kPos.clone().setY(10), true);
    this.fx.impact(this.kaijuCentre(_c), 3, '#ffb070');
    for (const o of this.orbs) o.mesh.removeFromParent();
    this.orbs.length = 0;
  }

  private updateDying(dt: number) {
    const k = Math.min(1, this.t / 3);
    this.kaiju.body.rotation.x = -k * 1.35; // topples forward (front is -z)
    this.kPos.y = -12 * S * k * k;
    this.kaiju.glow.emissiveIntensity = 3 * (1 - k);
    if (Math.random() < dt * 25) this.destruction.puff(new THREE.Vector3(this.kPos.x + (Math.random() - 0.5) * 30, 2, this.kPos.z + (Math.random() - 0.5) * 30), 8 + Math.random() * 6, 2.5);
    this.flash.position.set(this.kPos.x, 16, this.kPos.z);
    this.flash.color.set('#ffb070');
    if (Math.random() < dt * 6) this.flash.intensity = 900;
    this.poseKaiju(dt, 0, true);
    if (k >= 1) {
      this.kaiju.root.visible = false;
      this.kaiju.body.rotation.x = 0;
      this.flash.color.set('#8ff4ff');
      this.phase = 'cleared';
      this.t = 0;
      this.wins++;
      this.hud.gauge(null);
      this.hud.counter('');
    }
  }

  private crushUnderfoot(radius: number) {
    for (const d of this.destruction.near(this.kPos.x, this.kPos.z, radius, this.near)) this.destruction.damage(d.id, 99);
  }

  private poseKaiju(dt: number, speed: number, dying = false) {
    const k = this.kaiju;
    this.walkPhase += speed * dt * 0.28;
    const steps = Math.floor(this.walkPhase / Math.PI);
    if (steps !== this.kaijuSteps && speed > 0) sfx.kaijuStep(this.kPos);
    this.kaijuSteps = steps;
    const swing = speed > 0 ? Math.sin(this.walkPhase) * 0.45 : 0;
    // reeling: one leg steps back to catch it
    const brace = this.rec * 0.7;
    k.legs[0].rotation.x += (swing + brace - k.legs[0].rotation.x) * Math.min(1, dt * 6);
    k.legs[1].rotation.x += (-swing - brace * 0.4 - k.legs[1].rotation.x) * Math.min(1, dt * 6);
    k.body.position.y = speed > 0 ? Math.abs(Math.cos(this.walkPhase)) * 0.8 : 0;
    k.body.rotation.z = speed > 0 ? Math.sin(this.walkPhase) * 0.05 : Math.sin(this.t * 17) * this.rec * 0.08; // a shudder
    if (!dying) k.body.rotation.x = this.rec * 0.8; // lean back (front is -z: +x raises the front)
    k.tail.rotation.y = Math.sin(this.t * 1.3) * 0.25 + this.rec * 0.6 * Math.sin(this.t * 9);
    k.root.position.copy(this.kPos);
    k.root.rotation.y = this.kYaw;
  }

  // ---- plasma balls -----------------------------------------------------------------

  private updateOrbs(dt: number) {
    const v = this.player.vehicle;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      o.mesh.position.addScaledVector(o.v, dt);
      o.mesh.scale.setScalar(1 + Math.sin(o.life * 20) * 0.12);
      let done = o.life <= 0 || o.mesh.position.y < 0;
      if (v && this.robotActive && o.mesh.position.distanceTo(_c.set(v.pos.x, v.pos.y + 11, v.pos.z)) < 8) {
        // hit: knock the robot back and up, no damage model -- it is a shove, not a fail state
        this.player.knockback(o.v.x * 0.5, 9, o.v.z * 0.5);
        this.destruction.puff(o.mesh.position.clone(), 7, 1.2);
        this.fx.impact(o.mesh.position, 1.4, '#ff5ad8');
        sfx.impact(o.mesh.position, true);
        this.hud.toast('被弾！');
        done = true;
      }
      if (done) {
        if (o.mesh.position.y < 1) { this.destruction.puff(o.mesh.position.clone().setY(2), 6, 1.5); sfx.impact(o.mesh.position, true); }
        o.mesh.removeFromParent();
        o.mesh.geometry.dispose();
        this.orbs.splice(i, 1);
      }
    }
  }
}

const _c = new THREE.Vector3(), _h = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const _s = new THREE.Sphere();
