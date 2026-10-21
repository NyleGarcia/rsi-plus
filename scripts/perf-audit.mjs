#!/usr/bin/env node
/**
 * Hub performance audit: drives the built extension in headless Chromium and times the Browse / Ship catalog
 * interactions. Lighthouse refuses chrome-extension:// pages, so this is the stand-in.
 *
 *   npm run build && npm run perf [label] [path/to/.output/chrome-mv3]
 *
 * Writes .tmp/perf/<label>.json: boot (first paint, listing loaded, long tasks), CDP Performance metrics after load
 * and at the end (DOM nodes, JS heap, script / layout time), and per interaction wall time, settle time (two frames
 * after the DOM changed) and the longest long task. Needs /usr/bin/chromium (or CHROME=path) and no RSI login — the
 * store listing and the ship catalog are public.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const label = process.argv[2] ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const EXT = resolve(process.argv[3] ?? '.output/chrome-mv3');
const CHROME = process.env.CHROME ?? '/usr/bin/chromium';
const profile = mkdtempSync(join(tmpdir(), 'rsi-plus-perf-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--window-size=1600,1000'],
  viewport: { width: 1600, height: 1000 },
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push({ s: Math.round(e.startTime), d: Math.round(e.duration) });
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const WANT = ['Nodes', 'JSHeapUsedSize', 'LayoutCount', 'RecalcStyleCount', 'ScriptDuration', 'LayoutDuration', 'TaskDuration'];
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics
        .filter((m) => WANT.includes(m.name))
        .map((m) => [m.name, m.name.endsWith('Size') ? `${Math.round(m.value / 1048576)}MB` : m.name.endsWith('Duration') ? `${Math.round(m.value * 1000)}ms` : Math.round(m.value)]),
    );
  const out = [];
  /** Time from dispatching an action to the frame after the DOM settled (≈ what INP measures for one interaction). */
  async function interact(name, fn) {
    try {
      const lt0 = await page.evaluate(() => window.__lt.length);
      const t0 = Date.now();
      await fn();
      const settle = await page.evaluate(
        () =>
          new Promise((r) => {
            const t = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - t))));
          }),
      );
      const wall = Date.now() - t0;
      const lts = await page.evaluate((n) => window.__lt.slice(n), lt0);
      out.push({ name, wall, settle, longTasks: lts.length, longest: Math.max(0, ...lts.map((x) => x.d)) });
    } catch (e) {
      out.push({ name, error: String(e.message).split('\n')[0] });
    }
  }
  const rows = () => page.locator('table tbody tr').count();
  const waitRows = async (n, s = 90) => {
    for (let i = 0; i < s * 2; i++) {
      if ((await rows()) > n) return;
      await page.waitForTimeout(500);
    }
  };

  const t0 = Date.now();
  await page.goto(`chrome-extension://${id}/hub.html#browse`);
  await page.waitForSelector('table tbody tr', { timeout: 30000 });
  const firstPaint = Date.now() - t0;
  await waitRows(100); // the live listing (anonymous fetch, 500+ rows)
  const loaded = Date.now() - t0;
  const boot = await page.evaluate(() => ({ longTasks: window.__lt.length, longest: Math.max(0, ...window.__lt.map((x) => x.d)), total: window.__lt.reduce((a, x) => a + x.d, 0) }));
  const metricsAfterLoad = await metrics();

  const tabs = page.locator('[aria-label="Category"] button');
  const n = await tabs.count();
  for (let i = 1; i < n; i++) await interact(`tab ${(await tabs.nth(i).textContent()).trim()}`, () => tabs.nth(i).click());
  await interact('tab All', () => tabs.nth(0).click());
  await interact('toggle Out of stock', () => page.getByRole('button', { name: 'Include out of stock' }).click());
  await interact('toggle Out of stock off', () => page.getByRole('button', { name: 'Include out of stock' }).click());
  await interact('toggle Bundles', () => page.getByRole('button', { name: 'Bundles' }).click());
  const chev = page.locator('button[aria-expanded="false"]').first();
  if (await chev.count()) await interact('expand bundle', () => chev.click());
  await interact('toggle Bundles off', () => page.getByRole('button', { name: 'Bundles' }).click());
  await interact('search "paint"', () => page.getByLabel('Search listings').fill('paint'));
  await interact('clear search', () => page.getByLabel('Search listings').fill(''));
  await interact('sort by price', () => page.locator('thead th', { hasText: /^Price/ }).first().click());
  await interact('sidebar → Ship catalog', async () => {
    await page.getByRole('button', { name: /^Ship catalog/ }).first().click();
    await page.waitForSelector('table tbody tr');
  });
  await waitRows(20, 60);
  const shipRows = await rows();
  const sale = page.locator('[aria-label="On sale"] button');
  if (await sale.count()) {
    await interact('ships: All hulls', () => sale.nth(2).click());
    await interact('ships: On sale', () => sale.nth(0).click());
  }
  await interact('sidebar → Browse', async () => {
    await page.getByRole('button', { name: /^Browse/ }).first().click();
    await page.waitForSelector('table tbody tr');
  });
  const result = { label, at: new Date().toISOString(), extension: id, firstPaint, loaded, listingRows: await rows(), shipRows, errors, boot, metricsAfterLoad, metricsEnd: await metrics(), interactions: out };
  mkdirSync('.tmp/perf', { recursive: true });
  const file = `.tmp/perf/${label}.json`;
  writeFileSync(file, JSON.stringify(result, null, 1));
  console.log(`boot: first paint ${firstPaint} ms, listing ${loaded} ms, longest task ${boot.longest} ms · after load: ${metricsAfterLoad.Nodes} nodes, ${metricsAfterLoad.JSHeapUsedSize} heap`);
  for (const i of out) console.log(i.error ? `  ${i.name}: ${i.error}` : `  ${i.name.padEnd(28)} wall ${String(i.wall).padStart(4)} ms  settle ${String(i.settle).padStart(3)} ms  longest task ${String(i.longest).padStart(3)} ms`);
  console.log(`→ ${file}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
