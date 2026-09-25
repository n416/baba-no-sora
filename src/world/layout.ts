import * as THREE from 'three';
import type { World } from './world';
import {
  makeField, makeGuardrail, makeHouse, makePole, makePostBox, makeShop, makeTree,
  makeVending, makeWarningSign, makeWire, place,
} from './kit';
import { rng } from '../core/util';

/**
 * THE DRESSING -- the second file to rewrite for a new place.
 *
 * The demo is a generic Japanese back road: fields on the left, a loose row of
 * houses and one shop on the right, poles and wires along the right verge,
 * trees, a guardrail where the road bends.  Replace it with what survey.md
 * found in refs/place/, in the order you meet it along the road.
 *
 * Positions are given as (t along the road, lateral metres, +right).  `at()`
 * converts, and `face()` turns a +Z-authored prop to look at the road.
 */
export function buildLayout(world: World) {
  const { ctx, road, pal } = world;
  const r = rng(42);
  const P = new THREE.Vector3(), R = new THREE.Vector3();

  const at = (t: number, lateral: number) => {
    road.pointAt(t, P);
    road.rightAt(t, R);
    return new THREE.Vector3(P.x + R.x * lateral, 0, P.z + R.z * lateral);
  };
  /** yaw that turns a +Z-facing prop at this side of the road to face it */
  const face = (t: number, lateral: number) => road.yawAt(t) + (lateral > 0 ? -Math.PI / 2 : Math.PI / 2);

  const edge = road.width / 2 + road.shoulder;
  const L = road.length;

  // ---- fields on the left --------------------------------------------------
  for (let s = 6; s < L - 10; s += 22) {
    const t = s / L;
    if (r.chance(0.15)) continue;
    const p = at(t, -(edge + 14));
    const f = place(makeField(20, r.range(16, 22), pal.field, pal.grassDry), p.x, 0, p.z, road.yawAt(t));
    ctx.add(f);
  }

  // ---- houses and a shop on the right ---------------------------------------
  let shopDone = false;
  for (let s = 20; s < L - 15; s += r.range(16, 30)) {
    const t = s / L;
    if (r.chance(0.25)) continue;
    const lat = edge + r.range(6, 9);
    const p = at(t, lat);
    const isShop = !shopDone && s > L * 0.25;
    const o = isShop ? makeShop(r, 'ひばり商店') : makeHouse(r);
    place(o, p.x, 0, p.z, face(t, lat));
    ctx.add(o);
    ctx.collideObject(o, 0.1);
    if (isShop) {
      shopDone = true;
      const v = at(t + 3.5 / L, edge + 2.6);
      const vm = place(makeVending(), v.x, 0, v.z, face(t, 1));
      ctx.addDynamic(vm);
      ctx.collideObject(vm);
      const pb = at(t - 3 / L, edge + 1.8);
      const post = place(makePostBox(), pb.x, 0, pb.z, face(t, 1));
      ctx.addDynamic(post);
      ctx.collideObject(post);
    }
  }

  // ---- poles and wires along the right verge --------------------------------
  let prev: THREE.Vector3[] | null = null;
  for (let s = 4; s < L; s += 32) {
    const t = s / L;
    const p = at(t, edge + 0.6);
    const pole = place(makePole(), p.x, 0, p.z, road.yawAt(t));
    ctx.add(pole);
    ctx.collide(p.x - 0.2, p.z - 0.2, p.x + 0.2, p.z + 0.2, 9);
    const rr = road.rightAt(t, new THREE.Vector3());
    const anchors = [-0.9, 0.9].map((o) => new THREE.Vector3(p.x + rr.x * o, 7.65, p.z + rr.z * o));
    if (prev) for (let i = 0; i < 2; i++) ctx.add(makeWire(prev[i], anchors[i], 0.7));
    prev = anchors;
  }

  // ---- trees: a few big ones by the houses, clumps beyond the fields --------
  for (let i = 0; i < 70; i++) {
    const t = r.next();
    const side = r.chance(0.55) ? 1 : -1;
    const lat = side > 0 ? edge + r.range(12, 30) : -(edge + r.range(40, 80));
    const p = at(t, lat);
    if (world.colliders.some((c) => p.x > c.x0 - 1.5 && p.x < c.x1 + 1.5 && p.z > c.z0 - 1.5 && p.z < c.z1 + 1.5)) continue;
    const tree = place(makeTree(r, pal.canopy, { blossom: pal.blossom && r.chance(0.4) ? pal.blossom : undefined }), p.x, world.terrainAt(p.x, p.z), p.z, r.range(0, 6));
    ctx.add(tree);
    ctx.collide(p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, 6);
  }

  // ---- a guardrail and a warning sign where the road bends -------------------
  const bend = 0.38;
  for (let k = 0; k < 6; k++) {
    const p0 = at(bend + (-18 + k * 6) / L, -(edge + 0.3));
    const p1 = at(bend + (-18 + (k + 1) * 6) / L, -(edge + 0.3));
    ctx.add(makeGuardrail(p0, p1));
  }
  // small colliders along the run: one AABB over a bent run would swallow the road
  for (let d = -18; d <= 18; d += 1.5) {
    const p = at(bend + d / L, -(edge + 0.3));
    ctx.collide(p.x - 0.25, p.z - 0.25, p.x + 0.25, p.z + 0.25, 1);
  }
  const sp = at(bend - 30 / L, edge + 0.4);
  ctx.addDynamic(place(makeWarningSign('↰'), sp.x, 0, sp.z, road.yawAt(bend - 30 / L)));  // +Z front already faces oncoming traffic

}
