/**
 * THE COURSE -- the first file to rewrite for a new place.
 *
 * Author it from the aerial capture in refs/place/: trace the road you will
 * travel as a polyline in metres, +x east and -z north, starting where the
 * player starts.  Everything else (terrain flattening, the road ribbon, the
 * guide rails, the viewpoints the critic shoots from, autodrive) derives from
 * this one list.
 *
 * Scale check: a Japanese rural lane is 4-5 m, a two-lane road ~7 m with
 * shoulders, a house plot ~12-18 m of frontage.
 */

export interface Viewpoint {
  /** Matches refs/place/NN.jpg -- the frame the critic compares against. */
  name: string;
  /** 0..1 along the centreline */
  t: number;
  /** metres to the right (+) or left (-) of the centreline */
  lateral?: number;
  /** extra yaw in radians relative to looking along the road */
  yaw?: number;
  pitch?: number;
  /** eye height above ground; defaults to walking height */
  height?: number;
}

export const COURSE = {
  /** metres; the asphalt only -- shoulders are added either side */
  roadWidth: 4.4,
  shoulder: 0.9,
  /** Control points (x, z).  Catmull-Rom through these. */
  centreline: [
    [0, 30],
    [0, 0],
    [3, -45],
    [-5, -95],
    [-22, -140],
    [-18, -185],
    [4, -230],
    [10, -280],
    [2, -330],
  ] as [number, number][],
  /** where the player starts, 0..1 along the centreline, and facing along it */
  startT: 0.07,
  /** Ten viewpoints, one per refs/place/NN.jpg.  Keep the names in step. */
  viewpoints: [
    { name: '01', t: 0.08, lateral: 0.6 },
    { name: '02', t: 0.17, lateral: -0.8 },
    { name: '03', t: 0.26, lateral: 0.5, yaw: 0.35 },
    { name: '04', t: 0.35, lateral: -1.2, yaw: -0.4 },
    { name: '05', t: 0.44, lateral: 0.8 },
    { name: '06', t: 0.53, lateral: -0.4, yaw: 0.6 },
    { name: '07', t: 0.62, lateral: 1.0 },
    { name: '08', t: 0.71, lateral: -0.8, yaw: -0.3 },
    { name: '09', t: 0.8, lateral: 0.5 },
    { name: '10', t: 0.9, lateral: 0.0, pitch: 0.05 },
  ] as Viewpoint[],
};
