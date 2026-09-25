/**
 * Paste-able camera list for the top-10 detail pass (docs/detail-top10.md).
 * Run in the page:  await detailShots('before')  -> .shots/detail/<tag>/<name>.jpg
 * Each entry: [name, {pos, yaw, pitch}] or [name, {vp}], shot at noon and at night.
 */
window.detailShots = async (tag, times = [12, 18.8]) => {
  const Y = (deg) => (deg * Math.PI) / 180; // yaw: 0 north, 90 west, 180 south, -90 east
  const cams = [
    ['gado-far', { pos: [70, 0, -2.5], yaw: Y(90), pitch: 0.04 }],
    ['gado-mid', { pos: [26, 0, 8.5], yaw: Y(60), pitch: 0.2 }],
    ['gado-near', { pos: [6, 0, 8.8], yaw: Y(100), pitch: 0.55 }],
    ['train', { pos: [36, 16, 40], yaw: Y(95), pitch: -0.3 }],
    ['rotary', { vp: '01' }],
    ['lattice', { pos: [63, 0, 63], yaw: Y(195), pitch: 0.3 }],
    ['zakkyo-mid', { pos: [150, 0, -7.6], yaw: Y(70), pitch: 0.3 }],
    ['zakkyo-near', { pos: [132, 0, 8.0], yaw: Y(-125), pitch: 0.35 }],
    ['alley', { vp: '02' }],
    ['alley-near', { pos: [47.8, 0, -45], yaw: Y(10), pitch: 0.2 }],
    ['mural', { pos: [4, 0, 7.6], yaw: Y(190), pitch: 0.08 }],
    ['hotel', { pos: [-22, 0, 30], yaw: Y(130), pitch: 0.42 }],
  ];
  const out = [];
  for (const t of times) {
    for (const [name, o] of cams) {
      const r = await window.__shot(`detail/${tag}/${name}@${t}`, 960, 540, { ...o, time: t });
      out.push(r.file);
    }
  }
  return out.length;
};
