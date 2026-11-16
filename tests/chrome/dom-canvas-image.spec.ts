import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };
import { domCanvasImageCaseNames, domCanvasImagePalette, domCanvasImageSourceReferences } from '../fixtures/dom-canvas-image-cases';
import type { DomCanvasImageAssets, DomCanvasImageResult } from '../fixtures/dom-canvas-image-cases';

// iCCP chunk from the browser-generated Display P3 PNG used by the 2026-11-16 investigation.
// The chunk carries its original length/type/data/CRC. Test IDAT bytes are generated independently below.
const displayP3Chunk = Buffer.from(
  'AAABJ2lDQ1BfAAB4nJWQP0vDQBjGf5aCf6iD6OiQsYtSFbqoSxWLTlIrWJ3SNE2FJoYkpQhufgE/hODsKEJnBwVBcBQ/gji4xicJki4dfI/37nfPPdzd+0JhBkWxAq4XBY16zThpnRrTn0xppGFaoc/kkOvnPfO+rfD/mO3YoaX1S9kJ9LiubIqXnIx7Cbczvkp4GPmR+CbhoNnYEd+Ky84Yt8fY8oPE/yzecvsDK/83Jds7PtK6p1xml3NCfPqYXGJwyIbmunYuAyLxUI6IniikoZOaqEkghyeliy0m6V/2xPUHbI/iOH7MtYMR3Fdh7iHXypuwUIKnl1zLe+qbgZlKRWWh24XvO5hvweKr7jn7a+SE2oy0tjoXGo5qs6Xs678Wq6J1KqxR/QUglE37tILJPA==', 'base64');

const paletteImage = new PNG({ width: 4, height: 2 });
paletteImage.data = Buffer.from(domCanvasImagePalette);
const palette = PNG.sync.write(paletteImage);
const singleImage = new PNG({ width: 1, height: 1 });
singleImage.data = Buffer.from(domCanvasImagePalette.slice(0, 4));
const single = PNG.sync.write(singleImage);
const profilePalette = Buffer.concat([palette.subarray(0, 33), displayP3Chunk, palette.subarray(33)]);
const alternateImage = new PNG({ width: 4, height: 2 });
alternateImage.data = Buffer.from(Array.from({ length: 8 }, () => [19, 211, 73, 255]).flat());
const alternate = PNG.sync.write(alternateImage);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2" viewBox="0 0 4 2" shape-rendering="crispEdges">'
  + Array.from({ length: 8 }, (_, index) => {
    const [red, green, blue] = domCanvasImagePalette.slice(index * 4, index * 4 + 3);
    return `<rect x="${index % 4}" y="${Math.floor(index / 4)}" width="1" height="1" fill="rgb(${red},${green},${blue})"/>`;
  }).join('') + '</svg>';

let builds: Record<string, string>;
let launchCommandLine: string;
test.beforeAll(async ({ browser }) => {
  expect(Array.from(PNG.sync.read(palette).data)).toEqual(domCanvasImagePalette);
  expect(Array.from(PNG.sync.read(profilePalette).data)).toEqual(domCanvasImagePalette);
  builds = {
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    compilerWasmSha256: createHash('sha256').update(await readFile('artifacts/compiler/compiler.wasm')).digest('hex'),
  };
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(info => info.type === 'browser');
    if (!browserProcess) throw new Error('Chrome process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='],
      { encoding: 'utf8' }).trim();
  } finally { await session.detach(); }
});

for (const name of domCanvasImageCaseNames) {
  test(`DOM Canvas/Image ${name}`, async ({ page, browser }) => {
    await page.route('**/tests/fixtures/dom-assets/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const headers: Record<string, string> = path.endsWith('/cors.png') ? { 'Access-Control-Allow-Origin': '*' } : {};
      let body: Buffer | string = palette;
      let contentType = 'image/png';
      if (path.endsWith('/profile.png')) body = profilePalette;
      if (path.endsWith('/alternate.png')) body = alternate;
      if (path.endsWith('/single.png')) body = single;
      if (path.endsWith('/broken.png')) body = 'This resource is not a decoded PNG.';
      if (path.endsWith('/palette.svg')) { body = svg; contentType = 'image/svg+xml'; }
      await route.fulfill({ status: 200, body, contentType, headers });
    });
    await page.goto('/tests/fixtures/runner.html');
    const base = new URL('/tests/fixtures/dom-assets/', page.url());
    const cross = new URL(base); cross.hostname = 'localhost';
    const assets: DomCanvasImageAssets = {
      palettePng: new URL('palette.png', base).href,
      singlePng: new URL('single.png', base).href,
      alternatePng: new URL('alternate.png', base).href,
      profilePng: new URL('profile.png', base).href,
      brokenPng: new URL('broken.png', base).href,
      crossOriginPng: new URL('cross.png', cross).href,
      corsPng: new URL('cors.png', cross).href,
      svg: new URL('palette.svg', base).href,
    };
    const results: DomCanvasImageResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      results.push(await page.evaluate(async ({ name, backend, assets }) => {
        const entry = '/tests/fixtures/dom-canvas-image-cases.ts';
        const { runDomCanvasImageCase } = await import(/* @vite-ignore */ entry);
        return runDomCanvasImageCase(name, backend, assets);
      }, { name, backend, assets }));
    }
    const native = results.find(result => result.backend === 'native')!;
    const comparisons = results.filter(result => result.backend !== 'native').flatMap(result => result.captures.map(capture => {
      const reference = native.captures.find(candidate => candidate.name === capture.name);
      return { backend: result.backend, capture: capture.name, expectation: capture.expectation,
        matchesNative: reference?.width === capture.width && reference?.height === capture.height
          && JSON.stringify(reference.pixels) === JSON.stringify(capture.pixels) };
    }));
    const directory = `artifacts/dom-input/pr3/public/${name}`;
    await mkdir(directory, { recursive: true });
    const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
    await writeFile(`${directory}/result.json`, JSON.stringify({
      recordedAt: new Date().toISOString(), browserVersion: browser.version(), specificationRevision: fixtures.cts.revision,
      fixtureKind: 'source-derived public semantics', sourceReferences: domCanvasImageSourceReferences,
      builds, configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
      assets, fixtureHashes: {
        palettePng: createHash('sha256').update(palette).digest('hex'),
        profilePng: createHash('sha256').update(profilePalette).digest('hex'),
        displayP3Chunk: createHash('sha256').update(displayP3Chunk).digest('hex'),
      },
      pixelTolerance: 0, results, comparisons,
    }, null, 2) + '\n');
    for (const result of results) {
      expect.soft(result.selectedCore, `${result.backend} selected core`).toBe(result.backend);
      expect.soft(result.failure, `${result.backend} execution`).toBeNull();
      expect.soft(result.checks.filter(check => !check.passed), `${result.backend} specification checks`).toEqual([]);
      expect.soft(result.checks.length, `${result.backend} executed checks`).toBeGreaterThan(0);
      expect.soft(result.validationErrors, `${result.backend} delayed GPU diagnostics`).toEqual([]);
      expect.soft(result.cleanupErrors, `${result.backend} cleanup`).toEqual([]);
    }
    expect.soft(comparisons.filter(comparison => !comparison.matchesNative), 'byte-exact native comparisons').toEqual([]);
  });
}
