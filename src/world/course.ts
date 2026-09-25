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

/**
 * Takadanobaba: Waseda-dori, travelled westward.  The rail embankment runs
 * north-south along x = 0 and the road dips under it through the girder
 * "gado" (4.2 m clearance).  East of the tracks and south of the road is the
 * station plaza with its rotary; north of the road an izakaya alley runs off at
 * x = 48.  West of the gado the road runs straight for 300 m -- the runway.
 */
export const COURSE = {
  /** metres; the asphalt only -- sidewalks are the "shoulders" either side */
  roadWidth: 14,
  shoulder: 4,
  /** Control points (x, z).  Catmull-Rom through these. */
  centreline: [
    [300, 6],
    [220, 4],
    [140, 1],
    [60, 0],
    [0, 0],
    [-60, 0],
    [-140, -2],
    [-220, -8],
    [-300, -18],
    [-345, -22],
  ] as [number, number][],
  /** where the player starts, 0..1 along the centreline, and facing along it */
  startT: 0.3,
  /** Station-centred box the flight is kept inside (soft wall), metres. */
  flightHalf: 330,
  flightCeiling: 150,
  /** Ten viewpoints; 01-03 match refs/place/NN.jpg, the rest are our own.
   *  lateral + is to the right of travel = north; yaw 0 looks west, -PI/2 north, +PI/2 south. */
  viewpoints: [
    { name: '01', t: 0.353, lateral: -54, yaw: -0.15, pitch: 0.08 },
    { name: '02', t: 0.391, lateral: 24, yaw: -Math.PI / 2, pitch: 0.02 },
    { name: '03', t: 0.417, lateral: -9.8, yaw: -0.7, pitch: 0.16 },
    { name: '04', t: 0.235, lateral: -3, yaw: 0.02, pitch: 0.05 },
    { name: '05', t: 0.468, lateral: -3.5, yaw: 0, pitch: 0.02 },
    { name: '06', t: 0.655, lateral: 2, yaw: 0, pitch: 0.03 },
    { name: '07', t: 0.608, lateral: -2, yaw: Math.PI, pitch: 0.04 },
    { name: '08', t: 0.78, lateral: 0, yaw: Math.PI, pitch: -0.12, height: 25 },
    { name: '09', t: 0.29, lateral: -90, yaw: -0.35, pitch: -0.55, height: 90 },
    { name: '10', t: 0.465, lateral: 150, yaw: Math.PI / 2, pitch: -0.14, height: 120 },
  ] as Viewpoint[],
};
