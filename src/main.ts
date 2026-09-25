import * as THREE from 'three';
import { CONFIG, applyUrlOverrides } from './config';
import { Pipeline } from './render/post';
import { shadowTint, setGlow } from './render/toon';
import { outlineUniforms } from './render/outline';
import { World } from './world/world';
import { buildLayout } from './world/layout';
import { Sky } from './world/sky';
import { TimeOfDay } from './world/timeofday';
import { SeasonalParticles } from './world/particles';
import { COURSE, type Viewpoint } from './world/course';
import { Player } from './player/player';
import { XRSupport } from './xr/xr';
import { Hud } from './ui/hud';

const cfg = applyUrlOverrides(CONFIG);

// ---- renderer, camera ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2400);
const rig = new THREE.Group(); // XR moves the camera inside this; we move the rig
rig.add(camera);
scene.add(rig);

// ---- light: warm quantised key, strong cool bounce, violet-grounded hemisphere
const sun = new THREE.DirectionalLight('#fff0cc', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
const fill = new THREE.DirectionalLight('#8aa0d8', 0.6);
const hemi = new THREE.HemisphereLight('#bcd8f0', '#8a7f8a', 0.85);
scene.add(sun, sun.target, fill, fill.target, hemi);
scene.fog = new THREE.Fog('#d8e8ec', 60, 480);

// ---- world -----------------------------------------------------------------
const tod = new TimeOfDay(cfg);
const world = new World(cfg);
world.buildGround();
buildLayout(world);
const bakeStats = world.bake();
scene.add(world.group);
const sky = new Sky();
scene.add(sky.group);
const particles = new SeasonalParticles(world.pal);
if (particles.points) scene.add(particles.points);

const player = new Player(world, cfg);
const pipeline = new Pipeline(renderer);
pipeline.setSize(window.innerWidth, window.innerHeight);
const hud = new Hud(tod, cfg);
const xr = new XRSupport(renderer, rig, camera, player, tod);
xr.onSession((on) => {
  // VR quality preset: smaller shadow map; the post pass switches itself off
  sun.shadow.mapSize.setScalar(on ? 1024 : 2048);
  sun.shadow.map?.dispose();
  (sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  hud.toast(on ? 'VR: 右トリガー 前進 / 右スティック 旋回 / A 乗り降り' : 'VR 終了');
});

// ---- time of day -> everything ---------------------------------------------
const _camWorld = new THREE.Vector3();
function applyLook() {
  const L = tod.look;
  const focus = player.pos;
  sun.color.copy(L.sun);
  sun.intensity = L.sunI;
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(tod.keyDir, 120);
  fill.color.copy(L.fill);
  fill.intensity = L.fillI;
  fill.target.position.copy(focus);
  fill.position.set(focus.x - tod.keyDir.x * 100, focus.y + 30, focus.z - tod.keyDir.z * 100);
  hemi.color.copy(L.hemiSky);
  hemi.groundColor.copy(L.hemiGround);
  hemi.intensity = L.hemiI;
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(L.fog);
  fog.far = L.fogFar;
  fog.near = L.fogFar * 0.18;
  sky.uniforms.uZenith.value.copy(L.zenith);
  sky.uniforms.uHorizon.value.copy(L.horizon);
  sky.uniforms.uGround.value.copy(L.fog);
  sky.uniforms.uSunDir.value.copy(tod.sunDir);
  sky.uniforms.uSunColor.value.copy(L.sun);
  sky.uniforms.uSunVis.value = THREE.MathUtils.smoothstep(tod.elevation, -3, 1);
  sky.uniforms.uStars.value = L.stars;
  sky.hillMat.color.copy(L.hill);
  sky.hillNearMat.color.copy(L.hill).lerp(_seasonHill, 0.35 * L.daylight);
  shadowTint.value.copy(L.tint);
  setGlow(L.glow);
  pipeline.grade.shadowTone.copy(L.shadowTone);
  pipeline.grade.highlightTone.copy(L.highlight);
  if (player.vehicle?.parts.lamp) player.vehicle.parts.lamp.emissiveIntensity = L.glow;
}
const _seasonHill = new THREE.Color(world.pal.hill);
tod.onChange(applyLook);

/** T jumps through the moments worth seeing.  Computed from the sun, so they move with the season. */
function keyTimes(): number[] {
  const probe = new TimeOfDay({ ...cfg, startTime: 0 });
  let rise = 6, set = 18;
  let prev = -90;
  for (let h = 0; h <= 24; h += 0.05) {
    probe.set(h);
    if (prev < 0 && probe.elevation >= 0) rise = h;
    if (prev >= 0 && probe.elevation < 0) set = h;
    prev = probe.elevation;
  }
  return [rise + 1, 12, set - 1.5, set - 0.2, set + 1.2];
}
const KEY_TIMES = keyTimes();

// ---- loop ------------------------------------------------------------------
function step(dt: number) {
  xr.readInput();
  tod.update(dt);
  player.update(dt);
  world.update(dt);
  if (!xr.presenting) player.applyCamera(rig, camera);
  xr.update(dt);
  applyLook();
  camera.getWorldPosition(_camWorld);
  sky.follow(_camWorld);
  particles.update(performance.now() / 1000, _camWorld, tod.look.daylight);
  updateHint();
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  step(dt);
  pipeline.render(scene, camera);
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outlineUniforms.uAspect.value = w / h;
  pipeline.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---- input -----------------------------------------------------------------
const canvas = renderer.domElement;
const start = () => { if (!xr.presenting) canvas.requestPointerLock(); };
document.getElementById('start')!.addEventListener('click', start);
canvas.addEventListener('click', start);
document.addEventListener('pointerlockchange', () => {
  player.locked = document.pointerLockElement === canvas;
  hud.setStarted(player.locked);
  if (!player.locked) player.keys.clear();
});
document.addEventListener('mousemove', (e) => { if (player.locked) player.look(e.movementX, e.movementY); });
let hintOn = true;
window.addEventListener('keydown', (e) => {
  if (!player.locked) return;
  player.keys.add(e.code);
  switch (e.code) {
    case 'KeyF':
      if (player.toggleMount()) hud.toast(player.mode === 'ride' ? `${player.vehicle!.spec.name}に乗った` : '降りた');
      break;
    case 'KeyV':
      player.view = player.view === 'first' ? 'third' : 'first';
      break;
    case 'KeyT': {
      const next = KEY_TIMES.find((t) => t > tod.time + 0.05) ?? KEY_TIMES[0];
      tod.playing = false;
      tod.set(next);
      hud.toast(tod.label());
      break;
    }
    case 'KeyP':
      tod.playing = !tod.playing;
      hud.sync();
      break;
    case 'KeyR':
      player.reset();
      break;
    case 'KeyO':
      pipeline.inkOn = !pipeline.inkOn;
      hud.toast(`墨線 ${pipeline.inkOn ? 'ON' : 'OFF'}`);
      break;
    case 'KeyG':
      pipeline.gradeOn = !pipeline.gradeOn;
      hud.toast(`グレード ${pipeline.gradeOn ? 'ON' : 'OFF'}`);
      break;
    case 'KeyH':
      hintOn = !hintOn;
      break;
  }
});
window.addEventListener('keyup', (e) => player.keys.delete(e.code));

function updateHint() {
  if (!hintOn || !player.locked) { hud.hint(''); return; }
  const v = player.vehicle;
  if (player.mode === 'walk' && v && cfg.mobility === 'both' && player.pos.distanceTo(v.pos) < 2.8) hud.hint(`F で${v.spec.name}に乗る`);
  else if (player.mode === 'ride' && cfg.mobility === 'both') hud.hint('W 前進 / S ブレーキ / A D 曲がる / F 降りる / V 視点');
  else hud.hint('');
}

// ---- debug + verification API (used by scripts/shoot.mjs and scripts/explore.mjs) ----
function viewpointPose(vp: Viewpoint) {
  const road = world.road;
  const p = road.pointAt(vp.t);
  const r = road.rightAt(vp.t);
  p.addScaledVector(r, vp.lateral ?? 0);
  p.y = world.heightAt(p.x, p.z) + (vp.height ?? 1.58);
  return { pos: p, yaw: road.yawAt(vp.t) + (vp.yaw ?? 0), pitch: vp.pitch ?? 0.02 };
}

interface ShotOpts { vp?: string; pos?: [number, number, number]; yaw?: number; pitch?: number; time?: number; ink?: boolean; grade?: boolean }

/** Render one frame at w x h and return it as a JPEG data URL.  Does not need rAF. */
function grab(w = 1600, h = 900, o: ShotOpts = {}) {
  if (o.time !== undefined) { tod.playing = false; tod.set(o.time); }
  step(0);
  if (o.vp) {
    const vp = COURSE.viewpoints.find((v) => v.name === o.vp);
    if (!vp) throw new Error(`no viewpoint ${o.vp}`);
    const pose = viewpointPose(vp);
    rig.position.copy(pose.pos);
    rig.rotation.set(0, pose.yaw, 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set(pose.pitch, 0, 0);
  } else if (o.pos) {
    rig.position.set(o.pos[0], o.pos[1] || world.heightAt(o.pos[0], o.pos[2]) + 1.58, o.pos[2]);
    rig.rotation.set(0, o.yaw ?? 0, 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set(o.pitch ?? 0, 0, 0);
  }
  camera.getWorldPosition(_camWorld);
  sky.follow(_camWorld);
  const ink = pipeline.inkOn, grade = pipeline.gradeOn;
  if (o.ink !== undefined) pipeline.inkOn = o.ink;
  if (o.grade !== undefined) pipeline.gradeOn = o.grade;
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outlineUniforms.uAspect.value = w / h;
  pipeline.setSize(w, h);
  pipeline.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  pipeline.inkOn = ink;
  pipeline.gradeOn = grade;
  renderer.setPixelRatio(pr);
  resize();
  return url;
}

const api = {
  scene, camera, rig, renderer, pipeline, world, player, tod, sky, sun, fill, hemi, xr, THREE,
  bakeStats,
  viewpoints: COURSE.viewpoints.map((v) => v.name),
  keyTimes: KEY_TIMES,
  grab,
  /** Step the simulation by hand (rAF may not run in a headless or hidden page). */
  step: (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) step(dt); },
  /** Drive the course on autopilot; returns how far it got and how long it was stuck. */
  autoRun(seconds = 120, mode: 'ride' | 'walk' = player.vehicle ? 'ride' : 'walk') {
    // set the mode directly: toggleMount() honours cfg.mobility, a test should not
    if (mode === 'walk' || !player.vehicle) player.mode = 'walk';
    else player.mode = 'ride';
    player.reset();
    player.autopilot = true;
    player.stuckTime = 0;
    let maxT = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      step(1 / 60);
      const here = player.mode === 'ride' && player.vehicle ? player.vehicle.pos : player.pos;
      maxT = Math.max(maxT, world.road.nearest(here.x, here.z).t);
      if (maxT > 0.98) break;
    }
    player.autopilot = false;
    return { mode: player.mode, progress: +maxT.toFixed(3), stuckSeconds: +player.stuckTime.toFixed(2) };
  },
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  /** Average ms per rendered frame at the current size (synchronous, forces a GPU sync each frame). */
  bench(frames = 120) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    pipeline.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      step(1 / 60);
      pipeline.render(scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const ms = (performance.now() - t0) / frames;
    return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), ...api.stats() };
  },
};
(window as unknown as { __scene: typeof api }).__scene = api;

if (import.meta.env.DEV) {
  /** Dev only: render a frame and write it to .shots/<name>.jpg via the Vite plugin. */
  (window as unknown as { __shot: unknown }).__shot = async (name: string, w = 1600, h = 900, o: ShotOpts = {}) => {
    const data = grab(w, h, o);
    const res = await fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, data }) });
    return res.json();
  };
}

applyLook();
