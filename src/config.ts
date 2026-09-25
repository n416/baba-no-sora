/**
 * The world's knobs.  Phase 0 of PROMPT.md fills these in from the interview;
 * everything else in the template reads them rather than hard-coding a choice.
 */

export type Season = 'spring' | 'earlySummer' | 'summer' | 'autumn' | 'winter';
export type Mobility = 'walk' | 'ride' | 'both';
export type VehicleKind = 'bicycle' | 'scooter' | 'keiTruck';
export type People = 'none' | 'background' | 'protagonist';

export interface WorldConfig {
  title: string;
  /** Drives the vegetation palette, the sun's path and the seasonal particles. */
  season: Season;
  /** Degrees north.  With the season it decides how high the sun climbs. */
  latitude: number;
  /** walk = on foot only, ride = always on the vehicle, both = F gets on and off. */
  mobility: Mobility;
  vehicle: VehicleKind;
  /** Clock time the world opens at, in hours (15.5 = 15:30). */
  startTime: number;
  /** Real seconds for one full day while the timelapse is playing. */
  dayLengthSeconds: number;
  people: People;
}

export const CONFIG: WorldConfig = {
  title: 'Explore3D Template',
  season: 'earlySummer',
  latitude: 35.4,
  mobility: 'both',
  vehicle: 'bicycle',
  startTime: 15.5,
  dayLengthSeconds: 60,
  people: 'none',
};

/** URL overrides, handy for shots and tests: ?time=18.2&season=autumn&mobility=walk */
export function applyUrlOverrides(cfg: WorldConfig): WorldConfig {
  const q = new URLSearchParams(location.search);
  const out = { ...cfg };
  const t = q.get('time');
  if (t !== null && !Number.isNaN(parseFloat(t))) out.startTime = parseFloat(t);
  const s = q.get('season') as Season | null;
  if (s && ['spring', 'earlySummer', 'summer', 'autumn', 'winter'].includes(s)) out.season = s;
  const m = q.get('mobility') as Mobility | null;
  if (m && ['walk', 'ride', 'both'].includes(m)) out.mobility = m;
  const v = q.get('vehicle') as VehicleKind | null;
  if (v && ['bicycle', 'scooter', 'keiTruck'].includes(v)) out.vehicle = v;
  return out;
}
