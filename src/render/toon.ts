import * as THREE from 'three';

/**
 * The cel material factory.  Every lit surface in the world comes from `cel()`;
 * nothing uses a PBR material.
 *
 * Two things make it read as a painted background rather than low-poly 3D:
 *  - a hand-authored gradient ramp quantises direct light into a few flat bands;
 *  - the toon BRDF is patched so the darker bands are *hue-shifted* toward a cool
 *    violet (`shadowTint`) instead of being a darker copy of the base colour.
 * The tint is one shared uniform, so the time of day can move it.
 */

export const shadowTint = { value: new THREE.Color('#8a86c8') };

const RAMPS: Record<string, number[]> = {
  // values are the light level of each band, darkest first
  hard: [0.32, 1.0],
  cel: [0.3, 0.68, 1.0],
  soft: [0.62, 0.86, 1.0], // pale masses that must stay light: blossom, snow, clouds
  four: [0.26, 0.5, 0.78, 1.0],
};
const rampCache = new Map<string, THREE.DataTexture>();

export function gradientMap(kind: keyof typeof RAMPS = 'cel'): THREE.DataTexture {
  let t = rampCache.get(kind);
  if (t) return t;
  const bands = RAMPS[kind];
  const data = new Uint8Array(bands.map((b) => Math.round(b * 255)));
  t = new THREE.DataTexture(data, bands.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  rampCache.set(kind, t);
  return t;
}

const TOON_CHUNK = THREE.ShaderChunk.lights_toon_pars_fragment.replace(
  'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;',
  /* glsl */ `
  vec3 band = getGradientIrradiance( geometryNormal, directLight.direction );
  // darker bands lean toward the cool shadow tint instead of just going dark
  vec3 irradiance = band * mix( uShadowTint, vec3( 1.0 ), band.r ) * directLight.color;`,
);
if (TOON_CHUNK === THREE.ShaderChunk.lights_toon_pars_fragment) {
  console.warn('[toon] shadow-tint patch did not apply -- three.js changed the toon chunk');
}

export interface CelOptions {
  ramp?: keyof typeof RAMPS;
  map?: THREE.Texture | null;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  /** Set for thin geometry (reeds, grass, wires) so one facet is never black. */
  flatShading?: boolean;
  fog?: boolean;
  vertexColors?: boolean;
}

export function cel(color: THREE.ColorRepresentation, o: CelOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(o.ramp ?? 'cel'),
    map: o.map ?? null,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    fog: o.fog ?? true,
    vertexColors: o.vertexColors ?? false,
  });
  if (o.transparent) m.depthWrite = false; // the ink pass reads depth
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = shadowTint;
    shader.fragmentShader =
      'uniform vec3 uShadowTint;\n' +
      shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', TOON_CHUNK);
  };
  m.customProgramCacheKey = () => 'cel-tinted';
  return m;
}

/** Unlit colour.  For things that must not take light: lamp glass, the far hills. */
export function flat(color: THREE.ColorRepresentation, o: { fog?: boolean; transparent?: boolean; opacity?: number } = {}) {
  const m = new THREE.MeshBasicMaterial({
    color,
    fog: o.fog ?? true,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  });
  if (o.transparent) m.depthWrite = false;
  return m;
}

/**
 * Materials that light up after dark (windows, signs, vending fronts, lamp heads).
 * The time of day sets one shared intensity on all of them.
 */
const glowMaterials: THREE.MeshToonMaterial[] = [];
export function glow(base: THREE.ColorRepresentation, light: THREE.ColorRepresentation, o: CelOptions = {}) {
  const m = cel(base, o);
  m.emissive = new THREE.Color(light);
  m.emissiveIntensity = 0;
  glowMaterials.push(m);
  return m;
}
export function setGlow(level: number) {
  for (const m of glowMaterials) m.emissiveIntensity = level;
}
