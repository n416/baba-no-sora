import type { Season } from '../config';

/**
 * Every colour in the world lives here.  Built things are season-independent;
 * anything that grows is looked up through `seasonal()`.
 *
 * The look: warm sun, cool violet-grey shadow, pale buildings, dark ink.
 * Colours are authored a little lighter and less saturated than they "are",
 * because the cel ramp and the grade both push toward contrast.
 */
export const PAL = {
  // --- city ground ---
  ground: '#aaa6a8',
  groundAlt: '#9d9aa6',
  sidewalk: '#dccbb0',
  curb: '#c2beb8',
  street: '#8e8e9c', // side streets (Waseda-dori itself is `asphalt`)
  tileRed: '#b8826a', // alley paving
  // --- buildings ---
  facades: ['#ece6da', '#ddd5c6', '#c9cbd0', '#bfa88e', '#e6d3b6', '#a9b2bc', '#cf9a84', '#d8dcd6'] as readonly string[],
  roofSlab: '#9a98a2',
  roofKit: '#b9bcc2', // rooftop tanks, plant rooms
  lattice: '#b4523e', // the red lattice building
  hotel: '#f1f0ec',
  glassBlue: '#8fb0cc',
  steel: '#8c949c',
  steelDark: '#5d646c',
  hazardYellow: '#f0c43a',
  hazardBlack: '#2a2a2e',
  embankment: '#b5aea2',
  awningRed: '#c0413a',
  shutter: '#9a938a',
  acUnit: '#e9e7e1',
  cone: '#ee7a3a',
  coneWhite: '#f4f1ea',
  lampPole: '#6f757c',
  trainSilver: '#d4d8dc',
  trainGreen: '#63b35a',
  trainYellow: '#f0c232',
  asphalt: '#7f8192',
  asphaltEdge: '#a39a86',
  roadLine: '#f1eee4',
  dirt: '#b79e7a',
  concrete: '#c9c4bb',
  woodDark: '#6b4c3b',
  wood: '#9a7456',
  plaster: '#efe6d6',
  plasterWarm: '#e9d7bd',
  roofTile: '#4d5566',
  roofTin: '#7b6f68',
  roofRed: '#a4574a',
  pole: '#7d6a58',
  poleStripe: '#e6c02e',
  wire: '#2d2a33',
  signYellow: '#f0c43a',
  signRed: '#c9423a',
  vendingBlue: '#3b7fb2',
  vendingRed: '#c24a42',
  glassNight: '#ffd99a',
  ink: '#2b2533',
  cloud: '#ffffff',
  hillFar: '#7f9fb0',
};

export interface SeasonPalette {
  grass: string;
  grassDry: string;
  field: string; // the crop / paddy / open ground beside the road
  canopy: [string, string, string]; // light, mid, dark
  blossom?: string; // flowering trees, if any this season
  hill: string;
  particles: 'petals' | 'fireflies' | 'leaves' | 'snow' | 'none';
  particleColor: string;
  ground: string; // bare ground tone under everything
}

const SEASONS: Record<Season, SeasonPalette> = {
  spring: {
    grass: '#9cc46c',
    grassDry: '#b9c27a',
    field: '#a7b98a',
    canopy: ['#a9cf73', '#7fae5c', '#5b8a4f'],
    blossom: '#f6c9d6',
    hill: '#8fae78',
    particles: 'petals',
    particleColor: '#fbd9e3',
    ground: '#a9b77f',
  },
  earlySummer: {
    grass: '#7fbf5a',
    grassDry: '#a6c066',
    field: '#79b7a8', // flooded paddy with young rice
    canopy: ['#8fcb5e', '#5fa14c', '#3f7a45'],
    hill: '#6e9d62',
    particles: 'none',
    particleColor: '#fff6a8',
    ground: '#8fb866',
  },
  summer: {
    grass: '#6fb34c',
    grassDry: '#9db85a',
    field: '#6aa84f',
    canopy: ['#7cbd4f', '#4f9444', '#346c3e'],
    hill: '#5f9257',
    particles: 'fireflies',
    particleColor: '#e9ff8a',
    ground: '#7aab55',
  },
  autumn: {
    grass: '#b8b56a',
    grassDry: '#d2b56e',
    field: '#d9b85c', // ripe rice
    canopy: ['#f2c64c', '#dc9a3a', '#a9683c'], // ginkgo and zelkova along Tokyo streets
    hill: '#b08a5a',
    particles: 'leaves',
    particleColor: '#e0843e',
    ground: '#b9a66a',
  },
  winter: {
    grass: '#dfe6ec',
    grassDry: '#c9c2b0',
    field: '#e8eef2', // snow over the fields
    canopy: ['#8a8f86', '#6f766e', '#565b58'],
    hill: '#cfd9df',
    particles: 'snow',
    particleColor: '#ffffff',
    ground: '#dde5ea',
  },
};

export const seasonal = (s: Season): SeasonPalette => SEASONS[s];
