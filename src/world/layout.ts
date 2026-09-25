import * as THREE from 'three';
import { compact, type World } from './world';
import { M, makeTree, makeWire, makePole, place } from './kit';
import {
  makeTower, makeZakkyo, makeLatticeBuilding, makeHotel, makeGirderBridge, makeGantry, makeTrain,
  makeArmLamp, makeSignal, makeCone, makeFence, makeAC, makeBike, makeAwning, makePerson, makeTruck, makeTaxi,
  muralTexture, RAIL, makeCar, makeBus, makeBench, makeLampPool, makeCrates, makePot, makeBin, makeMuralFrame,
} from './city';
import { cel } from '../render/toon';
import { PAL } from '../render/palette';
import { box, rng, type Rng } from '../core/util';
import { signPlane, vSign, hSign, markSpecial, SIGN_STYLES, VERTICAL_TENANTS } from '../render/signs';

/**
 * Takadanobaba, as met travelling west along Waseda-dori.
 *
 *   x = 0          rail embankment (JR + Seibu, 4 tracks) running north-south,
 *                  crossing the road on the girder bridge ("gado", 4.2 m)
 *   x 16..80, z>0  station plaza with the rotary; red-lattice building south of it
 *   x = 47.5, z<0  the izakaya alley running north
 *   everything     zakkyo frontage along the road, then a grid of blocks out to
 *                  700 m so the city reads from the air
 *
 * Positions on the road are (t, lateral +north); elsewhere plain (x, z).
 */

type R = [number, number, number, number]; // x0, z0, x1, z1
const RESERVED: R[] = [
  [-20, -900, 20, 900], // rail
  [14, 8, 106, 112], // plaza + lattice building
  [28, -118, 68, -8], // alley
  [-66, 44, -28, 80], // hotel
  [-53, 15, -27, 44], // glass office
];
const inReserved = (x: number, z: number, pad = 0) => RESERVED.some(([a, b, c, d]) => x > a - pad && x < c + pad && z > b - pad && z < d + pad);

export function buildLayout(world: World) {
  const { ctx, road, pal } = world;
  const r = rng(42);
  const P = new THREE.Vector3(), Rv = new THREE.Vector3();
  const at = (t: number, lateral: number) => {
    road.pointAt(t, P);
    road.rightAt(t, Rv);
    return new THREE.Vector3(P.x + Rv.x * lateral, 0, P.z + Rv.z * lateral);
  };
  const tAt = (x: number) => road.nearest(x, 0).t;
  const face = (t: number, lateral: number) => road.yawAt(t) + (lateral > 0 ? -Math.PI / 2 : Math.PI / 2);
  const solid = (o: THREE.Object3D, pad = 0.05) => { ctx.add(o); ctx.collideObject(o, pad); return o; };
  const edge = road.width / 2 + road.shoulder; // 11 m: where the building line is
  const half = road.width / 2;

  // each section draws from its own seed: adding props to one must not reshuffle another
  roadMarkings(world, at, tAt);
  roadSurface(world, rng(11), at, tAt);
  railway(world, rng(12));
  plaza(world, rng(13));
  alley(world, rng(24));

  // ---- Waseda-dori frontage ------------------------------------------------
  const gapsN: [number, number][] = [[-20, 20], [34, 64], [-258, -250], [-178, -170], [-102, -95], [92, 99], [163, 170], [232, 239]];
  const gapsS: [number, number][] = [[-20, 20], [14, 83], [-258, -250], [-178, -170], [-102, -95], [92, 99], [163, 170], [232, 239], [-66, -28]];
  for (const side of [1, -1]) {
    const gaps = side > 0 ? gapsN : gapsS;
    let x = 300;
    while (x > -335) {
      const w = r.range(7, 13);
      const xc = x - w / 2;
      x -= w + r.range(0.3, 1.2);
      if (gaps.some(([a, b]) => xc + w / 2 > a && xc - w / 2 < b)) continue;
      const t = tAt(xc);
      const d = r.range(13, 20);
      const lat = side * (edge + 0.4 + d / 2);
      const p = at(t, lat);
      const near = Math.abs(xc) < 170;
      const floors = near ? Math.floor(r.range(5, 11)) : Math.floor(r.range(3, 8));
      const b = near || r.chance(0.5)
        ? makeZakkyo(r, w, d, floors, { rooftopSign: near && r.chance(0.35) })
        : makeTower(r, w, d, floors * 3.2, { style: r.pick(['flats', 'office', 'tile'] as const) });
      solid(place(b, p.x, 0, p.z, face(t, lat)));
    }
  }
  // the glass office and the station-front building west of the tracks (01's skyline)
  solid(place(makeTower(r, 22, 18, 38, { style: 'office', wall: '#c9d2dc' }), -40, 0, 26, 0));

  // ---- street trees, lamps, signals along the road ---------------------------
  for (let x = 290; x > -330; x -= 13) {
    if (Math.abs(x) < 30) continue;
    const t = tAt(x);
    for (const side of [1, -1]) {
      if (side < 0 && x > 12 && x < 56) continue; // plaza mouth
      if (side > 0 && x > 40 && x < 58) continue; // alley mouth
      const p = at(t, side * (half + 1.6));
      if (r.chance(0.8)) {
        const tree = place(makeTree(r, pal.canopy, { h: r.range(6.5, 9) }), p.x, 0.14, p.z, r.range(0, 6));
        ctx.add(tree);
        ctx.collide(p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, 5);
        ctx.add(place(box(1.3, 0.12, 1.3, M('#7a6a5a')), p.x, 0.1, p.z)); // tree pit
      }
    }
  }
  for (let x = 280; x > -330; x -= 32) {
    if (Math.abs(x) < 24) continue;
    const t = tAt(x);
    for (const side of [1, -1]) {
      const p = at(t, side * (half + 0.7));
      const lamp = place(makeArmLamp(9), p.x, 0.14, p.z, face(t, side)); // arm reaches over the road
      ctx.add(lamp);
      const pool = at(t, side * (half - 2.2));
      ctx.add(place(makeLampPool(5.5), pool.x, 0, pool.z));
      ctx.collide(p.x - 0.2, p.z - 0.2, p.x + 0.2, p.z + 0.2, 9);
    }
  }
  for (const x of [21, -21, 99, -95]) {
    const t = tAt(x);
    for (const side of [1, -1]) {
      const p = at(t + side * 4 / road.length, side * (half + 0.5));
      ctx.add(place(makeSignal(5), p.x, 0.14, p.z, face(t, side)));
      ctx.collide(p.x - 0.2, p.z - 0.2, p.x + 0.2, p.z + 0.2, 6);
    }
  }
  // pedestrian fences along the curb near the station
  for (const side of [1, -1]) {
    for (const [xa, xb] of [[60, 30], [-30, -60], [140, 100], [-100, -140]]) {
      ctx.add(makeFence(at(tAt(xa), side * (half + 0.35)), at(tAt(xb), side * (half + 0.35))));
    }
  }

  sideStreetWires(world, rng(18));
  traffic(world, rng(15), at);
  blocks(world, rng(16));
  people(world, rng(17), at, tAt);
  void solid;
}

// ---- road paint -------------------------------------------------------------

function roadMarkings(world: World, at: (t: number, l: number) => THREE.Vector3, tAt: (x: number) => number) {
  const { ctx, road } = world;
  const white = M(PAL.roadLine, 'soft');
  world.group.add(world.ribbon(-0.22, -0.08, 0.045, cel(PAL.roadLine, { ramp: 'soft' })));
  world.group.add(world.ribbon(0.08, 0.22, 0.045, cel(PAL.roadLine, { ramp: 'soft' })));
  // lane dashes
  for (let s = 0; s < road.length; s += 10) {
    const t = s / road.length;
    for (const lat of [-3.5, 3.5]) {
      const p = at(t, lat);
      ctx.add(place(box(0.14, 0.02, 5, white), p.x, 0.035, p.z, road.yawAt(t)));
    }
  }
  // zebra crossings: bars along the road, stepped across it
  for (const x of [21, -21, 99, -95]) {
    const t = tAt(x);
    for (let l = -road.width / 2 + 0.5; l < road.width / 2 - 0.3; l += 0.9) {
      const p = at(t, l + 0.225);
      ctx.add(place(box(4, 0.02, 0.45, white), p.x, 0.036, p.z, road.yawAt(t) + Math.PI / 2));
    }
    for (const side of [1, -1]) {
      const p = at(t + side * 3.2 / road.length, -side * road.width / 4);
      ctx.add(place(box(0.4, 0.02, road.width / 2 - 0.4, white), p.x, 0.036, p.z, road.yawAt(t) + Math.PI / 2));
    }
  }
}

/** Manholes, patched asphalt, tactile paving: the things that make a road surface read as a real one. */
function roadSurface(world: World, r: Rng, at: (t: number, l: number) => THREE.Vector3, tAt: (x: number) => number) {
  const { ctx, road } = world;
  const hole = new THREE.CircleGeometry(0.33, 14).rotateX(-Math.PI / 2);
  const holeM = M('#5e5e68', 'soft'), rimM = M('#8a8a94', 'soft');
  const rim = new THREE.RingGeometry(0.33, 0.4, 14).rotateX(-Math.PI / 2);
  for (let s = 5; s < road.length; s += r.range(18, 34)) {
    const t = s / road.length;
    const p = at(t, r.pick([-5.3, -1.8, 1.8, 5.3]));
    const m = new THREE.Mesh(hole, holeM); m.position.set(p.x, 0.042, p.z); ctx.add(m);
    const rr = new THREE.Mesh(rim, rimM); rr.position.set(p.x, 0.041, p.z); ctx.add(rr);
  }
  // patches of newer, darker asphalt
  const patchM = M('#6e7080', 'soft');
  for (let k = 0; k < 26; k++) {
    const t = r.next();
    const p = at(t, r.range(-6, 6));
    ctx.add(place(box(r.range(1.5, 5), 0.01, r.range(0.8, 2.5), patchM), p.x, 0.03, p.z, road.yawAt(t) + r.range(-0.1, 0.1)));
  }
  // yellow tactile paving: a guide line along each sidewalk near the station, and pads at the crossings
  const tactile = M('#e8c23a', 'soft');
  for (const side of [1, -1]) {
    for (let x = 150; x > -150; x -= 2) {
      if (Math.abs(x) < 16) continue;
      const t = tAt(x);
      const p = at(t, side * (road.width / 2 + 2.6));
      ctx.add(place(box(0.3, 0.02, 2, tactile), p.x, 0.14, p.z, road.yawAt(t)));
    }
    for (const x of [21, -21, 99, -95]) {
      const t = tAt(x);
      const p = at(t, side * (road.width / 2 + 0.6));
      ctx.add(place(box(3.6, 0.02, 0.6, tactile), p.x, 0.141, p.z, road.yawAt(t) + Math.PI / 2));
    }
  }
}

// ---- the railway ---------------------------------------------------------------

function railway(world: World, r: Rng) {
  const { ctx } = world;
  const W = 30; // track bundle width
  const top = RAIL.deckTop;
  const embM = M(PAL.embankment), ballast = M('#8a8078'), railM = M('#5a5a60');
  const TRACKS = [-11.5, -6.5, 4, 9.5];
  for (const sgn of [1, -1]) {
    const z0 = sgn * 12.5, z1 = sgn * 460;
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    ctx.add(place(box(W, top, len, embM), 0, 0, zc));
    ctx.add(place(box(W - 1, 0.25, len, ballast), 0, top, zc));
    for (const x of TRACKS) for (const o of [-0.55, 0.55]) ctx.add(place(box(0.08, 0.12, len, railM), x + o, top + 0.25, zc));
    // pilasters on the retaining walls so they read as masonry, not a slab
    for (let z = z0 + sgn * 4; Math.abs(z) < Math.abs(z1); z += sgn * 6) {
      for (const x of [-W / 2 - 0.15, W / 2 + 0.15]) ctx.add(place(box(0.35, top - 0.3, 0.6, M('#a8a196')), x, 0, z));
    }
    ctx.collide(-W / 2, z0, W / 2, z1, top + 1.2);
    // the abutment face beside the sidewalk carries the mural
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 3.6), cel('#ffffff', { map: muralTexture(sgn > 0 ? 3 : 8), ramp: 'soft' }));
    for (const x of [-7.6, 7.6]) {
      const m = mural.clone();
      m.position.set(x, 2.1, z0 - sgn * 0.02);
      m.rotation.y = sgn > 0 ? Math.PI : 0;
      m.receiveShadow = true;
      ctx.add(m);
      ctx.add(place(makeMuralFrame(14.4, 3.6), x, 0.3, z0 - sgn * 0.02, sgn > 0 ? Math.PI : 0));
    }
    for (let z = z0 + sgn * 40; Math.abs(z) < 440; z += sgn * 48) ctx.add(place(makeGantry(W - 2), 0, 0, z));
  }
  // the gado
  // two decks, JR (east) and Seibu (west), with a slot of sky between them as in 03
  for (const [x, w] of [[8, 13.4], [-9, 12.4]] as const) {
    ctx.add(place(makeGirderBridge(25, w), x, 0, 0));
    ctx.collide(x - w / 2, -12.5, x + w / 2, 12.5, top + 1.2, RAIL.deckBottom);
  }
  // light pools on the road under the decks at night
  for (const x of [-9, 8]) for (const z of [-4.5, 4.5]) ctx.add(place(makeLampPool(3), x, 0, z));
  for (const x of TRACKS) for (const o of [-0.55, 0.55]) ctx.add(place(box(0.08, 0.12, 25, railM), x + o, top + 0.25, 0));
  // under-bridge ceiling lights so the underpass is not a black hole at night

  // ---- station: platforms and canopies on the south embankment, the building on the plaza
  for (const [x, w] of [[-9, 3.6], [6.75, 3.6]] as const) {
    ctx.add(place(box(w, 1.1, 170, M('#c9c2b4')), x, top, 110));
    for (let z = 30; z <= 190; z += 10) for (const o of [-1, 1]) ctx.add(place(box(0.2, 3.4, 0.2, M(PAL.steelDark)), x + o * (w / 2 - 0.4), top + 1.1, z));
    ctx.add(place(box(w + 2.6, 0.3, 170, M('#9fa6ae')), x, top + 4.5, 110));
    ctx.add(place(box(w + 1.2, 0.6, 170, M('#c6ccd2')), x, top + 4.7, 110));
    ctx.collide(x - w / 2 - 1.3, 25, x + w / 2 + 1.3, 195, top + 5.4, top + 1.0);
  }
  // station building: its face looks east over the plaza
  const st = place(makeTower(r, 58, 9, 13.5, { style: 'office', wall: '#e6e2da', clutter: false }), 20.5, 0, 42, Math.PI / 2);
  ctx.add(st);
  ctx.collideObject(st, 0.05);
  const name = signPlane(12, 3, markSpecial(hSign('高田馬場駅', { bg: '#ffffff', fg: '#23305a', stripe: '#63b35a' })));
  name.position.set(25.1, 10.4, 30);
  name.rotation.y = Math.PI / 2;
  ctx.add(name);
  ctx.add(place(box(3.2, 0.3, 22, M('#b8bec6')), 26.6, 4.4, 30)); // canopy
  const doors = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.6, 16), M('#6a86a6'));
  doors.position.set(25.05, 1.9, 30);
  ctx.add(doors);

  // ---- trains: one each way, forever
  const trainA = compact(makeTrain(6, PAL.trainGreen));
  const trainB = compact(makeTrain(6, PAL.trainYellow, '#f2c232'));
  trainB.rotation.y = Math.PI; // runs +z
  trainA.position.set(4, top + 0.37, 0);
  trainB.position.set(-11.5, top + 0.37, 0);
  ctx.addDynamic(trainA);
  ctx.addDynamic(trainB);
  const loop = 1400;
  ctx.onUpdate((_dt, time) => {
    trainA.position.z = 700 - ((time * 13 + 300) % loop);
    trainB.position.z = -700 + ((time * 11 + 900) % loop);
    trainA.position.x = 4 + (Math.floor((time * 13 + 300) / loop) % 2) * 5.5; // alternate tracks
  });
}

// ---- the station plaza and rotary ---------------------------------------------------

function plaza(world: World, r: Rng) {
  const { ctx } = world;
  const paving = cel(PAL.sidewalk, { ramp: 'soft' });
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(90, 100).rotateX(-Math.PI / 2), paving);
  slab.position.set(61, 0.13, 61);
  slab.receiveShadow = true;
  ctx.add(slab);
  // the rotary: a stadium of asphalt with a planted island, opening north onto the road
  const ring = roundRect(46, 28, 13);
  const ringM = new THREE.Mesh(new THREE.ShapeGeometry(ring, 16).rotateX(-Math.PI / 2), cel(PAL.asphalt, { ramp: 'soft' }));
  ringM.position.set(52, 0.15, 44);
  ringM.receiveShadow = true;
  ctx.add(ringM);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(16, 24).rotateX(-Math.PI / 2), cel(PAL.asphalt, { ramp: 'soft' }));
  mouth.position.set(40, 0.145, 20);
  ctx.add(mouth);
  const island = new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(26, 9, 4.5), { depth: 0.35, bevelEnabled: false }).rotateX(-Math.PI / 2), M('#c2beb8'));
  island.position.set(52, 0.14, 44);
  ctx.add(island);
  const green = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(24.6, 7.6, 3.8), 12).rotateX(-Math.PI / 2), M('#7f9a5c', 'soft'));
  green.position.set(52, 0.5, 44);
  ctx.add(green);
  ctx.collide(39, 39.5, 65, 48.5, 0.5);
  for (let i = 0; i < 9; i++) {
    const x = 41 + i * 2.8, z = 44 + r.range(-2, 2);
    ctx.add(place(makeTree(r, ['#6f9a54', '#557f48', '#3f6440'], { h: r.range(2.5, 4.5) }), x, 0.5, z, r.range(0, 6)));
  }
  // cones along the island and the ring's south edge (01's foreground)
  for (let i = 0; i < 14; i++) ctx.add(place(makeCone(), 38 + i * 2.1, 0.15, 50.2, 0));
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 9) * Math.PI; // round the east end of the ring
    ctx.add(place(makeCone(), 62 + Math.cos(a) * 11.5, 0.15, 44 + Math.sin(a) * 11.5, 0));
  }
  // lamps, a bus shelter, vehicles, fences
  for (const [x, z, yaw] of [[36, 60, 0], [66, 60, 0], [80, 30, -Math.PI / 2], [30, 30, Math.PI / 2]] as const) {
    ctx.add(place(makeArmLamp(9.5), x, 0.13, z, yaw + Math.PI));
    const lp = new THREE.Vector3(0, 0, -2.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    ctx.add(place(makeLampPool(3.4), x + lp.x, 0.1, z + lp.z));
    ctx.collide(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 9);
  }
  const shelter = new THREE.Group();
  shelter.add(box(8, 0.15, 2.2, M('#b8bec6'), 0, 2.6, 0));
  for (const x of [-3.6, 3.6]) shelter.add(box(0.15, 2.6, 0.15, M(PAL.steelDark), x, 0, -0.9));
  shelter.add(box(8, 1.6, 0.06, M('#a8c0d0', 'soft'), 0, 0.8, -1.0));
  solid(ctx, place(shelter, 52, 0.13, 62, 0));
  const truck = place(makeTruck(), 58, 0.15, 33, -Math.PI / 2 - 0.1);
  solid(ctx, truck);
  solid(ctx, place(makeTaxi(), 36, 0.15, 40, Math.PI));
  solid(ctx, place(makeTaxi('#3a4a7a'), 36, 0.15, 48.5, Math.PI));
  ctx.add(makeFence(new THREE.Vector3(28, 0.13, 57.5), new THREE.Vector3(76, 0.13, 57.5)));
  solid(ctx, place(makeBus(), 48, 0.15, 54.5, Math.PI / 2));
  for (const [bx, bz, by] of [[34, 64, 0], [42, 64, 0], [64, 64, 0], [72, 66, Math.PI], [86, 52, -Math.PI / 2]] as const) solid(ctx, place(makeBench(), bx, 0.13, bz, by));
  for (const [px, pz] of [[30, 66], [56, 67], [80, 62], [84, 46]] as const) {
    ctx.add(place(box(2.4, 0.55, 2.4, M('#c2beb8')), px, 0.13, pz));
    ctx.add(place(makeTree(r, ['#e2b24a', '#c98a3a', '#8f6a3a'], { h: r.range(3, 4.5) }), px, 0.68, pz, r.range(0, 6)));
    ctx.collide(px - 1.2, pz - 1.2, px + 1.2, pz + 1.2, 1);
  }
  // bicycles parked along the plaza edge
  for (let i = 0; i < 12; i++) ctx.add(place(makeBike(r), 30 + i * 0.75, 0.13, 70, Math.PI / 2 + r.range(-0.1, 0.1)));
  ctx.add(makeFence(new THREE.Vector3(30, 0.13, 13), new THREE.Vector3(30, 0.13, 30)));

  // the red-lattice building closes the plaza to the south; zakkyo on the other sides
  solid(ctx, place(makeLatticeBuilding(40, 26, 29, 'BABA CUBE'), 50, 0, 88, Math.PI));
  solid(ctx, place(makeZakkyo(r, 14, 12, 10, { back: false, rooftopSign: true }), 90, 0, 38, -Math.PI / 2));
  solid(ctx, place(makeZakkyo(r, 11, 15, 8, { back: false }), 95, 0, 58, -Math.PI / 2));
  solid(ctx, place(makeZakkyo(r, 10, 14, 7, { back: false }), 95, 0, 76, -Math.PI / 2));
  // double-fronted row between the plaza and the road: signs to the rotary AND to the street
  let x = 81;
  while (x > 56) {
    const w = r.range(7, 10);
    solid(ctx, place(makeZakkyo(r, w, 13, Math.floor(r.range(6, 10)), { back: true }), x - w / 2, 0, 19.5, 0));
    x -= w + 0.4;
  }
  const hotel = place(makeHotel(20, 16, 50, 'ホテル 月見'), -47, 0, 62, Math.PI / 2);
  solid(ctx, hotel);
}

function roundRect(w: number, h: number, rad: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + rad, y);
  s.lineTo(x + w - rad, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rad);
  s.lineTo(x + w, y + h - rad);
  s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  s.lineTo(x + rad, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rad);
  s.lineTo(x, y + rad);
  s.quadraticCurveTo(x, y, x + rad, y);
  return s;
}

function solid(ctx: World['ctx'], o: THREE.Object3D) {
  ctx.add(o);
  ctx.collideObject(o, 0.05);
  return o;
}

// ---- the izakaya alley (02) --------------------------------------------------------

function alley(world: World, r: Rng) {
  const { ctx } = world;
  const AX = 47.5, AW = 3.0, Z0 = -11.2, Z1 = -112;
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(AW + 0.4, Z0 - Z1).rotateX(-Math.PI / 2), cel(PAL.tileRed, { ramp: 'soft' }));
  paving.position.set(AX, 0.06, (Z0 + Z1) / 2);
  paving.receiveShadow = true;
  ctx.add(paving);
  // west side: old two/three-storey izakaya fronting the alley (+x), red awnings
  let z = Z0 - 0.6;
  while (z > Z1 + 4) {
    const w = r.range(4.5, 7.5);
    const d = 10;
    const zc = z - w / 2;
    const b = makeZakkyo(r, w, d, r.chance(0.6) ? 2 : 3, { rooftopSign: false, awning: false, izakaya: r.chance(0.75) });
    b.add(place(makeAwning(w - 0.4, r.chance(0.7) ? PAL.awningRed : '#a83a4a'), 0, 0, d / 2 + 0.05));
    ctx.add(place(b, AX - AW / 2 - d / 2, 0, zc, Math.PI / 2));
    // body only: the awnings and signs overhang the alley and must not wall it off
    ctx.collide(AX - AW / 2 - d, zc - w / 2, AX - AW / 2, zc + w / 2, 12);
    // AC units and a wall mailbox at the shopfront
    if (r.chance(0.6)) ctx.add(place(makeAC(), AX - AW / 2 + 0.2, 0.1, zc + r.range(-1, 1), Math.PI / 2));
    z -= w + 0.15;
  }
  // east side: taller pale buildings with pipes, backs to the alley
  z = Z0 - 0.6;
  while (z > Z1 + 6) {
    const w = r.range(8, 13), d = 12, zc = z - w / 2;
    const h = Math.floor(r.range(4, 7)) * 3.2;
    const b = makeTower(r, w, d, h, { style: 'old', wall: r.pick(['#dcd8cc', '#cfcac0', '#e2ddd2']) });
    // drain pipes and a meter box on the alley face
    for (const o of [-w / 3, w / 5]) b.add(box(0.14, h, 0.14, M('#b8b4aa'), o, 0, d / 2 + 0.1));
    b.add(box(0.5, 0.7, 0.2, M('#cfd2d4'), -w / 3 + 0.5, 1.4, d / 2 + 0.1));
    ctx.add(place(b, AX + AW / 2 + d / 2, 0, zc, -Math.PI / 2));
    ctx.collide(AX + AW / 2, zc - w / 2, AX + AW / 2 + d, zc + w / 2, h + 3);
    z -= w + 0.3;
  }
  // clutter at the shopfronts: crates, pots, bins, posters on the walls
  for (let zz = Z0 - 3; zz > Z1 + 3; zz -= r.range(2.5, 5)) {
    const west = r.chance(0.6);
    const x = west ? AX - AW / 2 + 0.3 : AX + AW / 2 - 0.3;
    const k = r.next();
    const o = k < 0.35 ? makeCrates(r) : k < 0.7 ? makePot(r) : makeBin();
    ctx.add(place(o, x, 0.06, zz, west ? Math.PI / 2 : -Math.PI / 2));
  }
  for (let zz = Z0 - 5; zz > Z1 + 3; zz -= r.range(4, 9)) {
    const west = r.chance(0.5);
    const p = signPlane(0.6, 0.15, hSign(r.pick(['本日営業', '生ビール', 'やきとり', '飲み放題', 'ランチ', '空室あり']), r.pick(SIGN_STYLES)));
    p.scale.setScalar(2);
    p.position.set(west ? AX - AW / 2 + 0.02 : AX + AW / 2 - 0.02, r.range(1.3, 1.9), zz);
    p.rotation.y = west ? Math.PI / 2 : -Math.PI / 2;
    ctx.add(p);
  }
  // a grated gutter along the east edge
  ctx.add(place(box(0.25, 0.02, Z0 - Z1, M('#6a6e74', 'soft')), AX + AW / 2 - 0.15, 0.06, (Z0 + Z1) / 2));
  // bikes, bins, hanging vertical signs over the alley
  for (let k = 0; k < 9; k++) {
    const bz = Z0 - 6 - k * r.range(3, 7);
    if (bz < Z1 + 4) break;
    ctx.add(place(makeBike(r), AX + AW / 2 - 0.35, 0.06, bz, r.range(-0.2, 0.2) + (r.chance(0.5) ? 0 : Math.PI)));
  }
  for (let k = 0; k < 7; k++) {
    const sz = Z0 - 8 - k * 11;
    const st = r.pick(SIGN_STYLES);
    const rect = vSign(r.pick(VERTICAL_TENANTS), st);
    const side = k % 2 ? 1 : -1;
    const sx = AX + side * (AW / 2 - 0.3);
    ctx.add(place(box(0.55, 2.2, 0.16, M(st.bg)), sx, 4.0, sz));
    ctx.add(place(box(0.04, 0.04, 0.5, M(PAL.steelDark)), sx, 6.0, sz)); // bracket
    for (const f of [1, -1]) {
      const p = signPlane(0.55, 2.2, rect);
      p.position.set(sx, 4.0 + 1.1, sz + f * 0.09);
      p.rotation.y = f > 0 ? 0 : Math.PI;
      ctx.add(p);
    }
  }
  // poles and the wire bundle criss-crossing overhead
  let prev: THREE.Vector3[] | null = null;
  for (let zz = Z0 - 4, k = 0; zz > Z1; zz -= 18, k++) {
    const side = k % 2 ? 1 : -1;
    const px = AX + side * (AW / 2 - 0.22);
    ctx.add(place(makePole(), px, 0, zz, Math.PI / 2));
    ctx.collide(px - 0.2, zz - 0.2, px + 0.2, zz + 0.2, 9);
    const anchors = [-0.9, -0.3, 0.4, 0.9].map((o) => new THREE.Vector3(px + o, 7.3 - Math.abs(o) * 0.3, zz));
    if (prev) for (let i = 0; i < 4; i++) ctx.add(makeWire(prev[i], anchors[(i + 1) % 4], 0.5 + i * 0.1));
    // service drops to the buildings
    ctx.add(makeWire(anchors[0], new THREE.Vector3(AX - AW / 2 - 0.2, 5.2, zz - 3), 0.3));
    ctx.add(makeWire(anchors[3], new THREE.Vector3(AX + AW / 2 + 0.2, 6.0, zz + 4), 0.3));
    prev = anchors;
  }
}

// ---- the city grid ---------------------------------------------------------------

function blocks(world: World, r: Rng) {
  const { ctx, road, pal } = world;
  const STREET = 7;
  const xs: number[] = [], zs: number[] = [];
  for (let x = -720; x <= 720; x += 62) xs.push(x + r.range(-7, 7));
  for (let z = -720; z <= 720; z += 54) zs.push(z + r.range(-6, 6));
  const lot = M('#b3afab', 'soft');
  let parks = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const bx0 = xs[i] + STREET / 2, bx1 = xs[i + 1] - STREET / 2;
      const bz0 = zs[j] + STREET / 2, bz1 = zs[j + 1] - STREET / 2;
      const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
      const far = Math.max(Math.abs(cx), Math.abs(cz)) > 380;
      // a few pocket parks, full of ginkgo in autumn
      if (!far && parks < 5 && r.chance(0.04) && !inReserved(cx, cz, 20) && road.nearest(cx, cz).dist > 50) {
        parks++;
        const gr = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0).rotateX(-Math.PI / 2), M('#9aa86a', 'soft'));
        gr.position.set(cx, 0.05, cz);
        ctx.add(gr);
        for (let k = 0; k < 14; k++) {
          const tx = r.range(bx0 + 3, bx1 - 3), tz = r.range(bz0 + 3, bz1 - 3);
          ctx.add(place(makeTree(r, pal.canopy, { h: r.range(7, 11) }), tx, 0, tz, r.range(0, 6)));
          ctx.collide(tx - 0.3, tz - 0.3, tx + 0.3, tz + 0.3, 6);
        }
        continue;
      }
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0).rotateX(-Math.PI / 2), lot);
      slab.position.set(cx, 0.04, cz);
      ctx.add(slab);
      // lots in one or two rows along the block's long side, fronts to the street
      const alongX = bx1 - bx0 >= bz1 - bz0;
      const long0 = alongX ? bx0 : bz0, long1 = alongX ? bx1 : bz1;
      const short0 = alongX ? bz0 : bx0, short1 = alongX ? bz1 : bx1;
      const depth = short1 - short0;
      const rows = depth > 26 ? 2 : 1;
      for (let row = 0; row < rows; row++) {
        const rd = depth / rows;
        let u = long0 + 0.5;
        while (u < long1 - 5) {
          const lw = Math.min(r.range(9, 19), long1 - u - 0.5);
          const uc = u + lw / 2;
          u += lw + r.range(0.4, 1.5);
          if (lw < 5) continue;
          const vc = short0 + rd * (row + 0.5);
          const x = alongX ? uc : vc, z = alongX ? vc : uc;
          const bw = lw - 0.6, bd = rd - r.range(1.2, 3);
          if (inReserved(x, z, Math.max(bw, bd) / 2)) continue;
          if (road.nearest(x, z).dist < 34) continue;
          const dStation = Math.hypot(x, z);
          const floors = r.chance(0.05) ? Math.floor(r.range(12, 19)) : Math.floor(r.range(2, dStation < 260 ? 9 : 7));
          // front faces the outer street of its row
          const out = rows === 1 ? (r.chance(0.5) ? 1 : -1) : row === 0 ? -1 : 1;
          const yaw = alongX ? (out > 0 ? 0 : Math.PI) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
          const b = place(makeTower(r, bw, bd, floors * 3.2, { clutter: !far }), x, 0, z, yaw);
          ctx.add(b);
          if (!far) ctx.collideObject(b, 0.05);
        }
      }
    }
  }
}

// ---- side streets: the poles and wire tangle you see looking off the main road ----

function sideStreetWires(world: World, r: Rng) {
  const { ctx, road } = world;
  for (const x0 of [-254, -174, -98, 95, 166, 235]) {
    for (const dir of [-1, 1]) {
      let prev: THREE.Vector3[] | null = null;
      const zc = road.pointAt(road.nearest(x0, 0).t).z;
      for (let k = 0; k < 2; k++) {
        const z = zc + dir * (16 + k * 14);
        const x = x0 + (k % 2 ? 2.6 : -2.6);
        ctx.add(place(makePole(), x, 0, z, Math.PI / 2));
        ctx.collide(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 9);
        const anchors = [-0.9, -0.3, 0.3, 0.9].map((o) => new THREE.Vector3(x, 7.75 - (o * o) * 0.1, z + o));
        const low = [new THREE.Vector3(x, 6.9, z - 0.6), new THREE.Vector3(x, 6.9, z + 0.6)];
        if (prev) {
          for (let i = 0; i < 4; i++) ctx.add(makeWire(prev[i], anchors[i], 0.45 + r.range(0, 0.3)));
          for (let i = 0; i < 2; i++) ctx.add(makeWire(prev[4 + i], low[i], 0.6 + r.range(0, 0.4)));
        }
        prev = [...anchors, ...low];
      }
    }
  }
}

// ---- traffic -------------------------------------------------------------------

/**
 * A handful of cars in the eastbound lanes (north half, lateral +): the player
 * drives the westbound side, so they never meet head-on.  No collision: they
 * are scenery, looped along the road.
 */
function traffic(world: World, r: Rng, at: (t: number, l: number) => THREE.Vector3) {
  const { ctx, road } = world;
  const cars: { o: THREE.Object3D; s: number; lane: number; speed: number }[] = [];
  for (let k = 0; k < 9; k++) {
    const o = ctx.addMoving(makeCar(r));
    cars.push({ o, s: r.range(0, road.length), lane: r.chance(0.5) ? 1.9 : 5.3, speed: r.range(8, 12) });
  }
  // two parked on the westbound kerb near the plaza
  for (const x of [120, 70]) {
    const t = road.nearest(x, 0).t;
    const p = at(t, -road.width / 2 + 1.2);
    const c = place(makeCar(r, 'van'), p.x, 0.03, p.z, road.yawAt(t) + Math.PI);
    ctx.add(c);
    ctx.collideObject(c, 0.05);
  }
  ctx.onUpdate((_dt, time) => {
    for (const c of cars) {
      const s = ((c.s - time * c.speed) % road.length + road.length) % road.length; // eastbound = decreasing t
      const t = s / road.length;
      const p = at(t, c.lane);
      c.o.position.set(p.x, 0.03, p.z);
      c.o.rotation.y = road.yawAt(t); // +z front points against the course = east
    }
  });
}

// ---- background people ----------------------------------------------------------

function people(world: World, r: Rng, at: (t: number, l: number) => THREE.Vector3, tAt: (x: number) => number) {
  const { ctx, road } = world;
  // a few standing about the plaza and the sidewalks
  const spots: [number, number][] = [[34, 56], [44, 58], [66, 64], [60, 64], [27, 36], [28, 22], [72, 28], [18.5, 9.2], [23.5, 9.6], [19.5, -9.4], [24, -9.8]];
  for (const [x, z] of spots) ctx.add(place(makePerson(r), x, 0.13, z, r.range(0, 6)));
  for (let k = 0; k < 10; k++) {
    const x = r.range(-150, 200);
    if (Math.abs(x) < 20) continue;
    const side = r.chance(0.5) ? 1 : -1;
    const p = at(tAt(x), side * (road.width / 2 + r.range(1.2, 3.5)));
    ctx.add(place(makePerson(r, true), p.x, 0.14, p.z, road.yawAt(tAt(x)) + (r.chance(0.5) ? 0 : Math.PI)));
  }
  // crossers on the zebra by the gado, walking back and forth
  const t = tAt(21);
  const walkers: { o: THREE.Object3D; phase: number; speed: number; lane: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const o = ctx.addMoving(makePerson(r, true));
    walkers.push({ o, phase: r.range(0, 1), speed: r.range(0.035, 0.05), lane: r.range(-1.6, 1.6) });
  }
  const yaw = road.yawAt(t);
  const span = road.width + 5;
  ctx.onUpdate((_dt, time) => {
    for (const w of walkers) {
      const u = (time * w.speed + w.phase) % 2;
      const k = u < 1 ? u : 2 - u; // there and back
      const lat = -span / 2 + k * span;
      const p = at(t + w.lane / road.length, lat);
      w.o.position.set(p.x, 0.12, p.z);
      w.o.rotation.y = yaw + (u < 1 ? Math.PI / 2 : -Math.PI / 2);
    }
  });
}
