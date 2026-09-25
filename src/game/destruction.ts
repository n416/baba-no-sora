import * as THREE from 'three';
import type { World, Destructible } from '../world/world';
import { cel } from '../render/toon';
import { rng } from '../core/util';

/**
 * Knocking buildings down, and putting them back.
 *
 * A building's vertices live inside the baked (merged) meshes; `world.bake()`
 * recorded where.  Falling = rewriting that range each frame (it sinks into the
 * ground with a slight shudder), down = collapsed to a point.  The originals
 * are kept, so `restoreAll()` is exact.  Colliders linked to the building are
 * switched off as it falls.
 *
 * Debris and dust are two InstancedMeshes (two draw calls however much falls).
 * Rubble that lands stays until the reset: a flattened block leaves a heap.
 */

const FALL_TIME = 1.8;
const CHUNKS = 900;
const PUFFS = 220;

interface Chunk { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; alive: boolean; resting: boolean }
interface Puff { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; s: number; alive: boolean }

export class Destruction {
  readonly world: World;
  /** Buildings down since the last reset. */
  downCount = 0;
  private falling: Destructible[] = [];
  private listeners: ((d: Destructible) => void)[] = [];
  private chunkMesh: THREE.InstancedMesh;
  private puffMesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private puffs: Puff[] = [];
  private nextChunk = 0;
  private nextPuff = 0;
  private r = rng(404);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
    this.chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cel('#ffffff'), CHUNKS);
    this.chunkMesh.castShadow = true;
    this.chunkMesh.receiveShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.count = CHUNKS;
    const dustMat = new THREE.MeshBasicMaterial({ color: '#d8c8b8', transparent: true, opacity: 0.42, depthWrite: false });
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), dustMat, PUFFS);
    this.puffMesh.frustumCulled = false;
    for (let i = 0; i < CHUNKS; i++) {
      this.chunks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1, alive: false, resting: false });
      this.chunkMesh.setColorAt(i, new THREE.Color('#ffffff'));
    }
    for (let i = 0; i < PUFFS; i++) this.puffs.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, s: 1, alive: false });
    this.hideAll();
    world.group.add(this.chunkMesh, this.puffMesh);
  }

  onDown(fn: (d: Destructible) => void) {
    this.listeners.push(fn);
  }

  /** Deal damage; returns true if this blow started the collapse. */
  damage(id: number, amount = 1, at?: THREE.Vector3) {
    const d = this.world.destructibles[id - 1];
    if (!d || d.state !== 'standing') return false;
    d.hp -= amount;
    if (at) this.burst(at, d.colour, 6, 8);
    if (d.hp > 0) return false;
    d.state = 'falling';
    d.t = 0;
    for (const c of d.colliders) c.off = true;
    this.falling.push(d);
    // a skirt of dust round the base, chunks thrown from the upper floors
    const b = d.box, c = b.getCenter(this.sv.set(0, 0, 0)).clone();
    const w = b.max.x - b.min.x, dd = b.max.z - b.min.z, h = b.max.y - b.min.y;
    for (let i = 0; i < 18; i++) this.puff(new THREE.Vector3(b.min.x + this.r.next() * w, this.r.range(0, 3), b.min.z + this.r.next() * dd), Math.max(w, dd) * 0.25 + this.r.range(2, 5), this.r.range(1.6, 2.6));
    this.burst(new THREE.Vector3(c.x, b.min.y + h * 0.7, c.z), d.colour, Math.min(70, 24 + Math.floor(h)), Math.max(w, dd) * 0.5, 1.6);
    this.heap(b, d.colour, Math.min(40, 10 + Math.floor(w * dd / 12)));
    return true;
  }

  /** Axis-aligned hit test along a ray against standing buildings.  Returns the nearest. */
  raycast(ray: THREE.Ray, maxDist: number) {
    let best: Destructible | null = null, bestT = maxDist;
    for (const d of this.world.destructibles) {
      if (d.state !== 'standing') continue;
      const hit = ray.intersectBox(d.box, this.sv);
      if (!hit) continue;
      const t = hit.distanceTo(ray.origin);
      if (t < bestT) { bestT = t; best = d; }
    }
    return best ? { d: best, t: bestT } : null;
  }

  /** Every building within `radius` of (x, z) on the ground plane (the kaiju's feet, a hard landing). */
  near(x: number, z: number, radius: number, out: Destructible[] = []) {
    out.length = 0;
    for (const d of this.world.destructibles) {
      if (d.state !== 'standing') continue;
      const b = d.box;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((cx - x) ** 2 + (cz - z) ** 2 < radius * radius) out.push(d);
    }
    return out;
  }

  update(dt: number) {
    // buildings on the way down
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const d = this.falling[i];
      d.t += dt;
      const h = d.box.max.y - d.box.min.y;
      const k = Math.min(1, d.t / FALL_TIME);
      const drop = h * 1.05 * k * k;
      const shake = (1 - k) * 0.35 * Math.sin(d.t * 55);
      for (const r of d.ranges) {
        const a = r.attr.array as Float32Array, o = r.orig, base = r.start * 3;
        if (k >= 1) {
          a.fill(0, base, base + r.count * 3); // collapse to a point: nothing left to draw
        } else {
          for (let j = 0; j < o.length; j += 3) {
            a[base + j] = o[j] + shake;
            a[base + j + 1] = Math.max(-0.5, o[j + 1] - drop);
            a[base + j + 2] = o[j + 2];
          }
        }
        r.attr.addUpdateRange(base, r.count * 3);
        r.attr.needsUpdate = true;
      }
      if (this.r.chance(dt * 6)) {
        const b = d.box;
        this.puff(new THREE.Vector3(this.r.range(b.min.x, b.max.x), Math.max(1, h - drop), this.r.range(b.min.z, b.max.z)), this.r.range(3, 6), 2);
      }
      if (k >= 1) {
        d.state = 'down';
        this.falling.splice(i, 1);
        this.downCount++;
        for (const fn of this.listeners) fn(d);
      }
    }
    this.updateChunks(dt);
    this.updatePuffs(dt);
  }

  /** Every building back up, rubble swept away. */
  restoreAll() {
    for (const d of this.world.destructibles) {
      if (d.state === 'standing' && d.hp === d.maxHp) continue;
      for (const r of d.ranges) {
        (r.attr.array as Float32Array).set(r.orig, r.start * 3);
        r.attr.addUpdateRange(r.start * 3, r.count * 3);
        r.attr.needsUpdate = true;
      }
      for (const c of d.colliders) c.off = false;
      d.state = 'standing';
      d.hp = d.maxHp;
      d.t = 0;
    }
    this.falling.length = 0;
    this.downCount = 0;
    for (const c of this.chunks) c.alive = false;
    for (const p of this.puffs) p.alive = false;
    this.hideAll();
  }

  /** A low heap of big slabs already lying in the footprint: what is left when the dust clears. */
  heap(b: THREE.Box3, colour: THREE.Color, n: number) {
    const col = new THREE.Color();
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const w = (b.max.x - b.min.x) * 0.45, d = (b.max.z - b.min.z) * 0.45;
    for (let i = 0; i < n; i++) {
      const k = this.nextChunk++ % CHUNKS;
      const c = this.chunks[k];
      c.alive = true;
      c.resting = true;
      const u = this.r.range(-1, 1), v = this.r.range(-1, 1);
      c.s = this.r.range(2, 4.5) * (1.2 - 0.5 * Math.hypot(u, v));
      c.p.set(cx + u * w, c.s * 0.3 + (1 - Math.hypot(u, v)) * 1.5, cz + v * d);
      c.r.set(this.r.range(-0.5, 0.5), this.r.range(0, 6), this.r.range(-0.5, 0.5));
      col.copy(colour).multiplyScalar(this.r.range(0.6, 0.95));
      this.chunkMesh.setColorAt(k, col);
    }
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
  }

  /** Chunks thrown from a point, in a building's colour (varied). */
  burst(at: THREE.Vector3, colour: THREE.Color, n: number, spread: number, size = 1) {
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = this.nextChunk++ % CHUNKS;
      const c = this.chunks[k];
      c.alive = true;
      c.resting = false;
      c.p.set(at.x + this.r.range(-spread, spread) * 0.5, at.y + this.r.range(-2, 2), at.z + this.r.range(-spread, spread) * 0.5);
      c.v.set(this.r.range(-8, 8), this.r.range(2, 12), this.r.range(-8, 8));
      c.r.set(this.r.range(0, 6), this.r.range(0, 6), this.r.range(0, 6));
      c.w.set(this.r.range(-4, 4), this.r.range(-4, 4), this.r.range(-4, 4));
      c.s = this.r.range(0.5, 2.2) * size;
      col.copy(colour).multiplyScalar(this.r.range(0.7, 1.05));
      if (this.r.chance(0.15)) col.set('#7a8290'); // steel and glass among the concrete
      this.chunkMesh.setColorAt(k, col);
    }
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
  }

  puff(at: THREE.Vector3, size: number, life: number) {
    const k = this.nextPuff++ % PUFFS;
    const p = this.puffs[k];
    p.alive = true;
    p.p.copy(at);
    p.v.set(this.r.range(-1.5, 1.5), this.r.range(1, 3), this.r.range(-1.5, 1.5));
    p.age = 0;
    p.life = life;
    p.s = size;
  }

  private updateChunks(dt: number) {
    const m = this.m;
    for (let i = 0; i < CHUNKS; i++) {
      const c = this.chunks[i];
      if (!c.alive) continue;
      if (!c.resting) {
        c.v.y -= 22 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        const floor = c.s * 0.35;
        if (c.p.y < floor) {
          c.p.y = floor;
          if (Math.abs(c.v.y) < 3) { c.resting = true; } // settle into the rubble heap
          c.v.y *= -0.25; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.4);
        }
      }
      m.compose(c.p, this.q.setFromEuler(c.r), this.sv.set(c.s, c.s * 0.7, c.s));
      this.chunkMesh.setMatrixAt(i, m);
    }
    this.chunkMesh.instanceMatrix.needsUpdate = true;
  }

  private updatePuffs(dt: number) {
    const m = this.m;
    for (let i = 0; i < PUFFS; i++) {
      const p = this.puffs[i];
      if (!p.alive) { m.makeScale(0, 0, 0); this.puffMesh.setMatrixAt(i, m); continue; }
      p.age += dt;
      if (p.age > p.life) { p.alive = false; m.makeScale(0, 0, 0); this.puffMesh.setMatrixAt(i, m); continue; }
      p.p.addScaledVector(p.v, dt);
      const k = p.age / p.life;
      const s = p.s * (0.5 + k) * (1 - k * k);
      m.compose(p.p, this.q.identity(), this.sv.set(s, s * 0.8, s));
      this.puffMesh.setMatrixAt(i, m);
    }
    this.puffMesh.instanceMatrix.needsUpdate = true;
  }

  private hideAll() {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CHUNKS; i++) this.chunkMesh.setMatrixAt(i, z);
    for (let i = 0; i < PUFFS; i++) this.puffMesh.setMatrixAt(i, z);
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    this.puffMesh.instanceMatrix.needsUpdate = true;
  }
}
