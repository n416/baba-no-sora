import * as THREE from 'three';
import { COURSE } from './course';

/**
 * The centreline as a queryable object.  Sampled once into a dense polyline so
 * `nearest()` is a cheap linear scan (a few hundred points); if a course grows
 * past a couple of kilometres, bucket the samples on a grid.
 */
export class Road {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly samples: THREE.Vector3[];
  readonly tangents: THREE.Vector3[];
  readonly width = COURSE.roadWidth;
  readonly shoulder = COURSE.shoulder;

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      COURSE.centreline.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
    this.length = this.curve.getLength();
    const n = Math.max(64, Math.ceil(this.length / 1.5));
    this.samples = this.curve.getSpacedPoints(n);
    this.tangents = this.samples.map((_, i) => this.curve.getTangentAt(i / n).setY(0).normalize());
  }

  pointAt(t: number, out = new THREE.Vector3()) {
    return out.copy(this.curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1)));
  }
  tangentAt(t: number, out = new THREE.Vector3()) {
    return out.copy(this.curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1))).setY(0).normalize();
  }
  /** Right-hand normal in the ground plane. */
  rightAt(t: number, out = new THREE.Vector3()) {
    const tg = this.tangentAt(t, out);
    return out.set(-tg.z, 0, tg.x);
  }
  /** Yaw (radians, three.js convention: 0 looks down -z) of travel along the road. */
  yawAt(t: number) {
    const tg = this.tangentAt(t, _v);
    return Math.atan2(-tg.x, -tg.z);
  }

  /** Nearest point: distance to the centreline, signed lateral offset (+ = right), and t. */
  nearest(x: number, z: number) {
    let best = Infinity, bi = 0;
    const s = this.samples;
    for (let i = 0; i < s.length; i++) {
      const dx = s[i].x - x, dz = s[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    const p = s[bi], tg = this.tangents[bi];
    const rx = -tg.z, rz = tg.x;
    const lateral = (x - p.x) * rx + (z - p.z) * rz;
    return { dist: Math.sqrt(best), lateral, t: bi / (s.length - 1) };
  }
}

const _v = new THREE.Vector3();
