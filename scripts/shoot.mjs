#!/usr/bin/env node
/**
 * The critic's camera: every viewpoint in src/world/course.ts at four times of
 * day, plus a perf sample and the console errors.  Writes shots/<out>/ and
 * shots/<out>/report.json.  Needs the dev server running (npm run dev).
 *
 *   node scripts/shoot.mjs --out=iter-1 [--times=7,12,17.5,20.5] [--w=1600 --h=900]
 *
 * Name the frames so they sort next to refs/place/NN.jpg: vp-01@12.0.jpg ...
 * First run: npx playwright install chromium
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg('url', 'http://127.0.0.1:5180/');
const OUT = path.join(ROOT, 'shots', arg('out', 'latest'));
const W = +arg('w', 1600), H = +arg('h', 900);
const TIMES = arg('times', 'key').split(',');

const gpuArgs = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'];

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: [...gpuArgs, '--mute-audio'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__scene, null, { timeout: 60000 });

  const info = await page.evaluate(() => ({
    viewpoints: window.__scene.viewpoints,
    keyTimes: window.__scene.keyTimes,
    renderer: (() => {
      const gl = window.__scene.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })(),
  }));
  const times = TIMES[0] === 'key'
    ? [info.keyTimes[0], 12, +(info.keyTimes[3] - 0.45).toFixed(2), info.keyTimes[4]] // morning, noon, low evening sun, night
    : TIMES.map(Number);
  if (/swiftshader|llvmpipe|software/i.test(info.renderer)) console.warn(`WARNING: software renderer (${info.renderer}) -- perf numbers are meaningless`);

  const files = [];
  for (const vp of info.viewpoints) {
    for (const t of times) {
      const data = await page.evaluate(([vp, t, w, h]) => window.__scene.grab(w, h, { vp, time: t }), [vp, t, W, H]);
      const file = path.join(OUT, `vp-${vp}@${t.toFixed(1)}.jpg`);
      await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
      files.push(path.relative(ROOT, file));
    }
  }
  const perf = await page.evaluate(() => { window.__scene.tod.set(15.5); return window.__scene.bench(120); });
  const report = { url: URL, renderer: info.renderer, size: [W, H], times, perf, errors, files };
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), shots: files.length, perf, errors: errors.length }, null, 2));
} finally {
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
