#!/usr/bin/env node
/**
 * Regression: drive the whole course on autopilot (and walk the first stretch),
 * then fail on console errors, on not reaching the end, or on getting stuck.
 * Needs the dev server running (npm run dev).
 *
 *   node scripts/explore.mjs [--url=http://127.0.0.1:5180/]
 */
import { chromium } from 'playwright';

const arg = (n, d) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg('url', 'http://127.0.0.1:5180/');
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__scene, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const s = window.__scene;
    const out = {};
    if (s.player.vehicle) out.ride = s.autoRun(240, 'ride');
    out.walk = s.autoRun(90, 'walk');
    if (s.player.vehicle?.spec.flight) {
      out.fly = s.autoFly(150);
      out.land = s.autoLand();
    }
    return out;
  });
  const checks = [];
  if (result.ride) {
    checks.push(['ride reaches the end (>= 0.97)', result.ride.progress >= 0.97]);
    checks.push(['ride stuck < 2 s', result.ride.stuckSeconds < 2]);
  }
  checks.push(['walk stuck < 2 s', result.walk.stuckSeconds < 2]);
  if (result.fly) {
    checks.push(['takes off within 10 s', result.fly.takeoffAt >= 0 && result.fly.takeoffAt < 10]);
    checks.push(['sightseeing loop fully covered', result.fly.loopCoverage >= 0.95]);
    checks.push(['no collisions in the air', result.fly.airHits === 0]);
    checks.push(['lands on the runway', result.land.landed]);
  }
  checks.push(['no console errors', errors.length === 0]);
  ok = checks.every(([, pass]) => pass);
  console.log(JSON.stringify({ result, checks: Object.fromEntries(checks), errors }, null, 2));
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
