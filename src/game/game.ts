import * as THREE from 'three';
import type { World } from '../world/world';
import type { Player } from '../player/player';
import { Destruction } from './destruction';
import { buildKaiju, type KaijuBody } from './kaiju';
import { COURSE } from '../world/course';

/**
 * Robot mode's game loop:
 *   knock buildings down (beam, ramming, stomping)  ->  after SUMMON of them the
 *   kaiju rises out of the ground somewhere nearby  ->  it walks at you, crushing
 *   what it walks through, and spits slow plasma balls  ->  beam it until its HP
 *   gauge is empty  ->  it topples and sinks  ->  the city is restored and you
 *   are back at the start.
 *
 * Everything here runs from `update(dt)` (no rAF of its own), so the test in
 * main.ts can drive a whole round with __scene.step().
 */

export const SUMMON = 6; // buildings down before the kaiju comes
const KAIJU_HP = 100;
const BEAM_DAMAGE_KAIJU = 5;
const BEAM_RANGE = 600;
const BEAM_COOLDOWN = 0.18;
/** The kaiju model is authored ~28 m tall; this makes it tower over the zakkyo (~45 m). */
const S = 1.6;

type Phase = 'calm' | 'rising' | 'fighting' | 'dying' | 'cleared';

interface Shot { mesh: THREE.Mesh; life: number }
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
  phase: Phase = 'calm';
  hp = KAIJU_HP;
  /** Rounds won, for the test. */
  wins = 0;
  hits = 0;
  private hud: GameHud;
  private t = 0; // time in the current phase
  private cooldown = 0;
  private shots: Shot[] = [];
  private orbs: Orb[] = [];
  private beamMat = new THREE.MeshBasicMaterial({ color: '#8ff4ff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private beamCore = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private orbMat = new THREE.MeshBasicMaterial({ color: '#ff5ad8', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private flash = new THREE.PointLight('#8ff4ff', 0, 60, 1.5);
  private kPos = new THREE.Vector3();
  private kYaw = 0;
  private walkPhase = 0;
  private breath = 0; // charge of the next plasma ball
  private hitFlash = 0;
  private near: import('../world/world').Destructible[] = [];
  private ray = new THREE.Ray();

  constructor(world: World, player: Player, hud: GameHud) {
    this.world = world;
    this.player = player;
    this.hud = hud;
    this.destruction = new Destruction(world);
    this.kaiju = buildKaiju();
    this.kaiju.root.visible = false;
    this.kaiju.root.scale.setScalar(S);
    world.group.add(this.kaiju.root, this.flash);
    this.destruction.onDown(() => {
      if (this.phase === 'calm') this.hud.counter(`破壊 ${this.destruction.downCount} / ${SUMMON}`);
      if (this.phase === 'calm' && this.destruction.downCount >= SUMMON) this.summon();
    });
    this.hud.counter(`破壊 0 / ${SUMMON}`);
  }

  get robotActive() {
    return this.player.mode === 'ride' && !!this.player.vehicle?.spec.robot;
  }

  /** Fire the beam from the robot's muzzle toward where the camera looks. */
  fire(camera: THREE.Camera, aimAt?: THREE.Vector3) {
    if (!this.robotActive || this.cooldown > 0 || this.phase === 'cleared') return false;
    this.cooldown = BEAM_COOLDOWN;
    const v = this.player.vehicle!;
    camera.getWorldPosition(this.ray.origin);
    if (aimAt) this.ray.direction.copy(aimAt).sub(this.ray.origin).normalize(); // scripted aim (tests)
    else camera.getWorldDirection(this.ray.direction);
    // what the crosshair is on: kaiju, a building, or the ground
    let end = this.ray.at(BEAM_RANGE, new THREE.Vector3());
    let tBest = BEAM_RANGE;
    let target: 'kaiju' | number | null = null;
    if (this.kaiju.root.visible && (this.phase === 'fighting' || this.phase === 'rising')) {
      const c = _c.copy(this.kPos).setY(this.kPos.y + 16 * S);
      const hit = this.ray.intersectSphere(_s.set(c, 13 * S), _h);
      if (hit) { const t = hit.distanceTo(this.ray.origin); if (t < tBest) { tBest = t; target = 'kaiju'; end = hit.clone(); } }
    }
    const b = this.destruction.raycast(this.ray, tBest);
    if (b) { tBest = b.t; target = b.d.id; end = this.ray.at(b.t, new THREE.Vector3()); }
    if (this.ray.direction.y < -0.01) {
      const tg = -this.ray.origin.y / this.ray.direction.y;
      if (tg > 0 && tg < tBest) { tBest = tg; target = null; end = this.ray.at(tg, new THREE.Vector3()); }
    }
    // draw it from the muzzle
    const from = v.muzzle(new THREE.Vector3());
    this.spawnBeam(from, end);
    this.flash.position.copy(end);
    this.flash.intensity = 400;
    if (target === 'kaiju') {
      this.hp = Math.max(0, this.hp - BEAM_DAMAGE_KAIJU);
      this.hits++;
      this.hitFlash = 0.25;
      this.destruction.burst(end, new THREE.Color('#6a4a8a'), 5, 4);
      this.hud.gauge(this.hp / KAIJU_HP);
      if (this.hp <= 0) this.defeat();
    } else if (typeof target === 'number') {
      this.destruction.damage(target, 1, end);
    } else {
      this.destruction.puff(end, 3, 0.8);
    }
    return true;
  }

  /** The robot rammed or stomped something. */
  crush(id: number) {
    this.destruction.damage(id, 99);
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash.intensity *= Math.pow(0.001, dt);
    this.destruction.update(dt);
    this.updateShots(dt);
    this.updateOrbs(dt);
    const k = this.kaiju;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    k.skin.emissive.setRGB(this.hitFlash > 0 ? 0.8 : 0, this.hitFlash > 0 ? 0.3 : 0, this.hitFlash > 0 ? 0.5 : 0);
    // the floating HP bar faces the camera
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
    this.player.reset();
    this.hud.gauge(null);
    this.hud.counter(`破壊 0 / ${SUMMON}`);
    this.hud.toast('街がもとに戻った');
  }

  // ---- phases ------------------------------------------------------------------

  private summon() {
    // 160-220 m from the robot, toward the middle of town so it walks into the streets
    const v = this.player.vehicle!;
    const toCentre = Math.atan2(-v.pos.x, -v.pos.z);
    const a = toCentre + (Math.random() - 0.5) * 1.2;
    const d = 110 + Math.random() * 30;
    const half = COURSE.flightHalf - 40;
    this.kPos.set(
      Math.max(-half, Math.min(half, v.pos.x + Math.sin(a) * d)),
      -30,
      Math.max(-half, Math.min(half, v.pos.z + Math.cos(a) * d)),
    );
    this.kYaw = Math.atan2(this.kPos.x - v.pos.x, this.kPos.z - v.pos.z); // face the robot (front is -z)
    this.hp = KAIJU_HP;
    this.phase = 'rising';
    this.t = 0;
    this.kaiju.root.visible = true;
    this.hud.gauge(1);
    this.hud.counter('');
    this.hud.toast('怪獣が現れた！');
  }

  private updateRising(dt: number) {
    const k = Math.min(1, this.t / 3.5);
    this.kPos.y = -30 * S * (1 - k) * (1 - k);
    if (Math.random() < dt * 20) this.destruction.puff(new THREE.Vector3(this.kPos.x + (Math.random() - 0.5) * 24, 1, this.kPos.z + (Math.random() - 0.5) * 24), 6 + Math.random() * 6, 2.5);
    this.crushUnderfoot(16 * S);
    this.kaiju.jaw.rotation.x = 0.5 * Math.sin(this.t * 6) * (1 - k);
    this.poseKaiju(dt, 0);
    if (k >= 1) { this.phase = 'fighting'; this.t = 0; this.breath = 0; }
  }

  private updateFighting(dt: number) {
    const v = this.player.vehicle!;
    const dx = v.pos.x - this.kPos.x, dz = v.pos.z - this.kPos.z;
    const dist = Math.hypot(dx, dz);
    // turn toward the robot, walk until close, then stand and spit
    const want = Math.atan2(-dx, -dz);
    let d = want - this.kYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.kYaw += Math.sign(d) * Math.min(Math.abs(d), 0.7 * dt);
    const speed = dist > 70 ? 8 : 0;
    this.kPos.x += -Math.sin(this.kYaw) * speed * dt;
    this.kPos.z += -Math.cos(this.kYaw) * speed * dt;
    this.crushUnderfoot(11 * S);
    // plasma: charge 2.2 s (spines and mouth blaze), then fire at the robot's chest
    this.breath += dt;
    const charge = Math.min(1, this.breath / 2.2);
    this.kaiju.glow.emissiveIntensity = 0.8 + charge * 2.5;
    this.kaiju.jaw.rotation.x = charge * 0.6;
    if (this.breath > 2.2 && dist < 260) {
      this.breath = -1.2 - Math.random();
      const from = _c.set(0, 22.5 * S, -9 * S).applyAxisAngle(_up, this.kYaw).add(this.kPos);
      const to = _h.set(v.pos.x, v.pos.y + 12, v.pos.z);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), this.orbMat);
      orb.position.copy(from);
      this.world.group.add(orb);
      this.orbs.push({ mesh: orb, v: to.sub(from).normalize().multiplyScalar(34), life: 7 });
    }
    this.poseKaiju(dt, speed);
  }

  private defeat() {
    this.phase = 'dying';
    this.t = 0;
    this.hud.gauge(0);
    this.hud.toast('怪獣を倒した！');
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
    this.poseKaiju(dt, 0);
    if (k >= 1) {
      this.kaiju.root.visible = false;
      this.kaiju.body.rotation.x = 0;
      this.flash.color.set('#8ff4ff');
      this.phase = 'cleared';
      this.t = 0;
      this.wins++;
      this.hud.gauge(null);
    }
  }

  private crushUnderfoot(radius: number) {
    for (const d of this.destruction.near(this.kPos.x, this.kPos.z, radius, this.near)) this.destruction.damage(d.id, 99);
  }

  private poseKaiju(dt: number, speed: number) {
    const k = this.kaiju;
    this.walkPhase += speed * dt * 0.28;
    const swing = speed > 0 ? Math.sin(this.walkPhase) * 0.45 : 0;
    k.legs[0].rotation.x += (swing - k.legs[0].rotation.x) * Math.min(1, dt * 6);
    k.legs[1].rotation.x += (-swing - k.legs[1].rotation.x) * Math.min(1, dt * 6);
    k.body.position.y = speed > 0 ? Math.abs(Math.cos(this.walkPhase)) * 0.8 : 0;
    k.body.rotation.z = speed > 0 ? Math.sin(this.walkPhase) * 0.05 : 0;
    k.tail.rotation.y = Math.sin(this.t * 1.3) * 0.25;
    k.root.position.copy(this.kPos);
    k.root.rotation.y = this.kYaw;
  }

  // ---- effects -----------------------------------------------------------------

  private spawnBeam(from: THREE.Vector3, to: THREE.Vector3) {
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(0.9, 0.9, len, 8, 1, true);
    g.translate(0, len / 2, 0).rotateX(Math.PI / 2); // along +z from the origin
    const outer = new THREE.Mesh(g, this.beamMat.clone());
    const core = new THREE.Mesh(g.clone().scale(0.35, 0.35, 1), this.beamCore.clone());
    outer.add(core);
    outer.position.copy(from);
    outer.lookAt(to);
    this.world.group.add(outer);
    this.shots.push({ mesh: outer, life: 0.28 });
  }

  private updateShots(dt: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      const k = Math.max(0, s.life / 0.28);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
      ((s.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.95 * k;
      s.mesh.scale.set(k, k, 1);
      if (s.life <= 0) {
        s.mesh.removeFromParent();
        for (const m of [s.mesh, s.mesh.children[0] as THREE.Mesh]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
        this.shots.splice(i, 1);
      }
    }
  }

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
        this.hud.toast('被弾！');
        done = true;
      }
      if (done) {
        if (o.mesh.position.y < 1) this.destruction.puff(o.mesh.position.clone().setY(2), 6, 1.5);
        o.mesh.removeFromParent();
        o.mesh.geometry.dispose();
        this.orbs.splice(i, 1);
      }
    }
  }
}

const _c = new THREE.Vector3(), _h = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Sphere();
