import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Road } from './road';
import { cel } from '../render/toon';
import { PAL, seasonal, type SeasonPalette } from '../render/palette';
import type { WorldConfig } from '../config';
import { rng, smoothstep } from '../core/util';

export interface Collider { x0: number; z0: number; x1: number; z1: number; top: number }
export interface Platform { x0: number; z0: number; x1: number; z1: number; y: number }

/**
 * The world's contract with everything that walks or drives in it:
 *   heightAt(x, z, fromY?)   ground plus any platform within a step of fromY
 *   colliders                axis-aligned boxes in the XZ plane
 *   road                     the centreline (guide rails, autodrive, viewpoints)
 * Builders never touch these arrays directly; they go through `ctx`.
 */
export class World {
  readonly group = new THREE.Group();
  /** Built once, then merged per material by `bake()` -- draw calls are the budget. */
  readonly staticGroup = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly platforms: Platform[] = [];
  readonly road = new Road();
  readonly pal: SeasonPalette;
  readonly cfg: WorldConfig;
  private updaters: ((dt: number, time: number) => void)[] = [];
  private elapsed = 0;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.pal = seasonal(cfg.season);
    this.group.add(this.staticGroup);
  }

  // ---- terrain ---------------------------------------------------------------
  /** Natural ground: flat along the road corridor, rising into low hills away from it. */
  terrainAt(x: number, z: number, roadDist?: number) {
    const d = roadDist ?? this.road.nearest(x, z).dist;
    const m = smoothstep(38, 120, d);
    if (m <= 0) return 0;
    const n =
      Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) * 0.6 +
      Math.sin(x * 0.047 - z * 0.031 + 2.1) * 0.25 +
      0.35;
    return m * m * Math.max(0, n) * 26;
  }

  heightAt(x: number, z: number, fromY?: number) {
    let h = this.terrainAt(x, z);
    for (const p of this.platforms) {
      if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      if (fromY !== undefined && p.y > fromY + 0.55) continue; // only what you can step onto
      if (p.y > h) h = p.y;
    }
    return h;
  }

  onUpdate(fn: (dt: number, time: number) => void) {
    this.updaters.push(fn);
  }

  update(dt: number) {
    this.elapsed += dt;
    for (const fn of this.updaters) fn(dt, this.elapsed);
  }

  // ---- building ---------------------------------------------------------------
  readonly ctx = {
    world: this,
    /** Static scenery: merged at the end.  Nothing in here may animate. */
    add: (o: THREE.Object3D) => { this.staticGroup.add(o); return o; },
    /** Anything that moves, glows per-frame, or keeps its own identity. */
    addDynamic: (o: THREE.Object3D) => { this.group.add(o); return o; },
    collide: (x0: number, z0: number, x1: number, z1: number, top = 3) => {
      this.colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), top });
    },
    /** Collider from an object's world bounds (conservative for rotated things). */
    collideObject: (o: THREE.Object3D, pad = 0) => {
      o.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(o);
      this.colliders.push({ x0: b.min.x - pad, z0: b.min.z - pad, x1: b.max.x + pad, z1: b.max.z + pad, top: b.max.y });
    },
    /** Walkable box top.  Neighbouring platforms must OVERLAP, not meet, or feet fall through the seam. */
    platform: (x0: number, z0: number, x1: number, z1: number, y: number) => {
      this.platforms.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y });
    },
    onUpdate: (fn: (dt: number, time: number) => void) => this.onUpdate(fn),
    rng,
  };

  /** Ground mesh + road ribbon.  Called by buildWorld before the layout. */
  buildGround() {
    const size = 900, seg = 180;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const cx = this.road.samples[Math.floor(this.road.samples.length / 2)];
    g.translate(cx.x, 0, cx.z);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(this.pal.grass), cDry = new THREE.Color(this.pal.grassDry), cHill = new THREE.Color(this.pal.hill);
    const c = new THREE.Color();
    const r = rng(3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = this.road.nearest(x, z).dist;
      const h = this.terrainAt(x, z, d);
      pos.setY(i, h - 0.02);
      c.copy(cGrass).lerp(cDry, r.next() * 0.35).lerp(cHill, smoothstep(2, 14, h));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, cel('#ffffff', { vertexColors: true, ramp: 'soft' }));
    ground.receiveShadow = true;
    ground.userData.noBake = true;
    this.group.add(ground);

    // road: asphalt over dirt shoulders, both following the ground exactly (it is 0 here)
    const half = this.road.width / 2;
    this.group.add(
      this.ribbon(-half - this.road.shoulder, half + this.road.shoulder, 0.015, cel(PAL.asphaltEdge, { ramp: 'soft' })),
      this.ribbon(-half, half, 0.03, cel(PAL.asphalt, { ramp: 'soft' })),
    );
  }

  /** A strip following the centreline between two lateral offsets.  Winding is fixed by
   *  walking the samples in order, so it always faces up. */
  ribbon(left: number, right: number, y: number, mat: THREE.Material) {
    const s = this.road.samples, t = this.road.tangents;
    const pos: number[] = [], idx: number[] = [], uv: number[] = [];
    let run = 0;
    for (let i = 0; i < s.length; i++) {
      const rx = -t[i].z, rz = t[i].x;
      if (i > 0) run += s[i].distanceTo(s[i - 1]);
      pos.push(s[i].x + rx * left, y, s[i].z + rz * left, s[i].x + rx * right, y, s[i].z + rz * right);
      uv.push(0, run / 4, 1, run / 4);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]));
      g.computeVertexNormals();
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  /**
   * Merge every static mesh per material.  Keeps shadow flags by splitting on
   * them too.  Outlined hero props belong in `addDynamic`, not here.
   */
  bake() {
    this.staticGroup.updateMatrixWorld(true);
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
    const drop: THREE.Object3D[] = [];
    this.staticGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.userData.noBake) return;
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, geos: [] }));
      let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
      b.geos.push(geo);
      drop.push(m);
    });
    for (const m of drop) m.removeFromParent();
    let n = 0;
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.recv;
      this.staticGroup.add(mesh);
      n++;
    }
    return { meshesIn: drop.length, meshesOut: n };
  }
}
