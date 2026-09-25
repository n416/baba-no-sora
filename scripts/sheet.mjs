#!/usr/bin/env node
/**
 * Contact sheets for the critic: one row per viewpoint (its refs/place/NN.jpg
 * first when there is one), one column per time of day.  Needs ffmpeg on PATH.
 *
 *   node scripts/sheet.mjs --in=iter-1 [--per=5]
 * Writes shots/<in>/sheet-1.jpg, sheet-2.jpg ...
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = path.join(ROOT, 'shots', arg('in', 'latest'));
const PER = +arg('per', 5);
const W = 400, H = 225;

const files = fs.readdirSync(DIR).filter((f) => /^vp-\d+@[\d.]+\.jpg$/.test(f));
const vps = [...new Set(files.map((f) => f.match(/^vp-(\d+)@/)[1]))].sort();
const times = [...new Set(files.map((f) => f.match(/@([\d.]+)\.jpg$/)[1]))].sort((a, b) => a - b);
const blank = path.join(DIR, '_blank.jpg');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x303030:s=${W}x${H}`, '-frames:v', '1', blank]);

for (let s = 0; s * PER < vps.length; s++) {
  const rows = vps.slice(s * PER, s * PER + PER);
  const inputs = [], cells = [];
  rows.forEach((vp, y) => {
    const ref = path.join(ROOT, 'refs', 'place', `${vp}.jpg`);
    const row = [fs.existsSync(ref) ? ref : blank, ...times.map((t) => path.join(DIR, `vp-${vp}@${t}.jpg`))];
    row.forEach((f, x) => { inputs.push('-i', f); cells.push([x, y]); });
  });
  const scale = cells.map((_, i) => `[${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[v${i}]`).join(';');
  const layout = cells.map(([x, y]) => `${x * W}_${y * H}`).join('|');
  const stack = `${cells.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}`;
  const out = path.join(DIR, `sheet-${s + 1}.jpg`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${scale};${stack}`, '-q:v', '4', out]);
  console.log(path.relative(ROOT, out));
}
fs.unlinkSync(blank);
