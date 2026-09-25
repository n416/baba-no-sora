import * as THREE from 'three';
import { PAL } from './palette';

/**
 * Inverted-hull outlines for hero props (the vehicle, signs, vending machines).
 * A back-faced shell pushed out along the normal *in clip space*, so the line
 * holds a constant pixel width at any distance.  Unlike the screen-space ink in
 * post.ts this also works in VR, where the post pass is off -- so anything that
 * must read as drawn in VR needs one of these.
 *
 * Hard-edged geometry (boxes) has split normals, so the shell opens a hairline
 * at each corner.  Fine at this width; for a smooth contour, feed it geometry
 * with merged normals (BufferGeometryUtils.mergeVertices + computeVertexNormals).
 */

export const outlineUniforms = {
  uWidth: { value: 0.0028 },
  uAspect: { value: 16 / 9 },
  uColor: { value: new THREE.Color(PAL.ink) },
};

const outlineMaterial = new THREE.ShaderMaterial({
  // fog: true needs the fog uniforms present; the outline ones stay shared (not cloned)
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...outlineUniforms },
  side: THREE.BackSide,
  vertexShader: /* glsl */ `
    uniform float uWidth;
    uniform float uAspect;
    #include <common>
    #include <fog_pars_vertex>
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec4 clip = projectionMatrix * mvPosition;
      vec3 n = normalize(normalMatrix * normal);
      vec2 d = (projectionMatrix * vec4(n, 0.0)).xy;
      float l = length(d);
      if (l > 1e-5) d /= l;
      d.x /= uAspect;
      clip.xy += d * uWidth * clip.w;
      gl_Position = clip;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    #include <common>
    #include <fog_pars_fragment>
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  fog: true,
});

const noRaycast = () => {};

/** Add a hull to every mesh under `root`. */
export function addOutline(root: THREE.Object3D) {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.isOutline && !o.userData.noOutline) targets.push(o as THREE.Mesh);
  });
  for (const m of targets) {
    const hull = new THREE.Mesh(m.geometry, outlineMaterial);
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.raycast = noRaycast;
    m.add(hull);
  }
}
