import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { installExternalPage } from '../benchmarks/external-page.mjs';
import { specializeUniformSweep, uniformSweep } from './animometer-uniform-sweep.mjs';
import { sources as pins } from './deps-external-benchmarks.mjs';

const sources = resolve('artifacts/external-benchmarks/sources');
const output = resolve(process.env.REFRAL_EXTERNAL_OUTPUT ?? join('artifacts/external-benchmarks', new Date().toISOString().replaceAll(':', '-')));
const cases = {
  ...Object.fromEntries([...uniformSweep.keys()].map(name => [name, 'animometer/Animometer/tests/3d/webgl.html'])),
  aquarium: 'samples/aquarium/aquarium.html',
  'aquarium-20k': 'samples/aquarium/aquarium.html?numFish=20000',
  animometer: 'animometer/Animometer/tests/3d/webgl.html',
  'animometer-attrib': 'animometer/Animometer/tests/3d/webgl.html?use_attributes=1',
  'animometer-attrib-256': 'animometer/Animometer/tests/3d/webgl.html?use_attributes=1',
  cubemap: 'samples/dynamic-cubemap/dynamic-cubemap.html',
  unity: 'unity/benchmarks/unity-webgl/index.html',
};
const selected = process.env.REFRAL_CASES?.split(',') ?? ['aquarium', 'aquarium-20k', 'animometer', 'animometer-attrib-256', 'cubemap'];
const backends = process.env.REFRAL_BACKENDS?.split(',') ?? ['native', 'js', 'rust'];
const rounds = Number(process.env.REFRAL_ROUNDS ?? 3);
const warmup = Number(process.env.REFRAL_WARMUP ?? 30);
const samples = Number(process.env.REFRAL_SAMPLES ?? 120);
assert(selected.every(key => Object.hasOwn(cases, key)) && backends.every(name => ['native','js','rust'].includes(name)));
assert([rounds, warmup, samples].every(n => Number.isSafeInteger(n) && n > 0));
await mkdir(output, { recursive: true });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const revisions = {};
for (const [name, , revision] of pins.filter(([name]) => selected.some(key => cases[key].startsWith(name + '/')))) {
  const cwd = join(sources, name);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), revision);
  assert.equal(git(cwd, 'status', '--porcelain'), '', 'Modified benchmark sources in ' + cwd);
  revisions[name] = revision;
}
const hashes = {};
for (const file of ['artifacts/compiler/compiler.wasm', 'artifacts/core-wasm/refral_core.wasm',
  'tools/animometer-uniform-sweep.mjs', 'benchmarks/external-page.mjs', 'tools/external-benchmarks.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(join(output, 'environment.json'), JSON.stringify({
  revision: git('.', 'rev-parse', 'HEAD'), status: git('.', 'status', '--porcelain'),
  hardware: cpus()[0].model, os: release(), node: process.version, revisions, hashes, selected, backends, rounds, warmup, samples,
}, null, 2));
const server = await createServer({ server: { host: '127.0.0.1', port: 4528, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (let round = 0; round < rounds; round++) {
    for (const name of selected) {
      for (let index = 0; index < backends.length; index++) {
        const backend = backends[(index + round) % backends.length];
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
        const url = 'http://127.0.0.1:4528/upstream/' + cases[name];
        const messages = [];
        const errors = [];
        const result = { round: round + 1, name, backend, browser: browser.version(), warmup, samples, messages, errors };
        const stem = join(output, [round + 1, name, backend].join('-'));
        try {
          page.on('pageerror', error => {
            errors.push(String(error));
            if (name === 'unity') console.log(backend, 'Unity page error', String(error).slice(0, 240));
          });
          page.on('console', msg => {
            if (messages.length < 80) messages.push(msg.type() + ': ' + msg.text().slice(0, 300));
            if (name === 'unity' && /creation of shader|failed compiling|error: 0:|unsupported shader/i.test(msg.text())) {
              result.shaderDiagnostics ??= [];
              if (result.shaderDiagnostics.length < 20) result.shaderDiagnostics.push(msg.text().slice(0, 400));
            }
            if (name === 'unity' && (msg.type() === 'error' || /^(Mandelbrot|Instantiate|CryptoHash|Animation|Asteroid|Particles|Physics|2D Physics|AI Agents|Overall)/.test(msg.text())))
              console.log(backend, msg.text().slice(0, 150));
          });
          await page.route('**/*', async route => {
            const request = new URL(route.request().url());
            if (request.origin !== new URL(url).origin) return route.abort();
            if (request.pathname === '/@vite/client') return route.fulfill({ contentType: 'text/javascript', body: 'export const injectQuery = url => url;' });
            if (request.pathname === '/results' && route.request().method() === 'POST') return route.fulfill({ status: 204 });
            if (!request.pathname.startsWith('/upstream/')) return route.continue();
            if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html>',
              headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } });
            const file = resolve(sources, decodeURIComponent(request.pathname.slice(10)));
            if (!file.startsWith(sources + sep)) return route.abort();
            try {
              let body = await readFile(file);
              if (request.pathname.endsWith('/aquarium/aquarium-config.js')) {
                assert(body.includes('enableVR: true'));
                body = Buffer.from(body.toString().replace('enableVR: true', 'enableVR: false'));
              }
              if (uniformSweep.has(name) && request.pathname.endsWith('/3d/resources/webgl.js'))
                body = Buffer.from(specializeUniformSweep(body.toString(), uniformSweep.get(name)));
              const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(file)];
              await route.fulfill({ body, contentType: type });
            } catch (error) {
              if (messages.length < 80) messages.push(String(error));
              await route.fulfill({ status: 404, body: '' });
            }
          });
          await page.goto(url);
          await page.evaluate(installExternalPage, { backend, unity: name === 'unity', auditUniforms: uniformSweep.has(name) || name === 'animometer' });
          let html = await readFile(join(sources, cases[name].split('?')[0]), 'utf8');
          if (name === 'animometer-attrib-256') {
            assert(html.includes('b.tune(20000)'));
            html = html.replace('b.tune(20000)', 'b.tune(256)');
          }
          await page.evaluate(html => { document.open(); document.write(html); document.close(); }, html);
          if (name === 'unity') {
            await page.waitForFunction(() => window.didShowErrorMessage || window.results?.some(row => row.benchmark === 'Overall'),
              undefined, { polling: 500, timeout: 360000 });
            result.scores = await page.evaluate(() => window.results);
            result.contexts = await page.evaluate(() => externalBench.contexts());
            assert(result.contexts.includes(backend));
            result.graphics = await page.evaluate(() => externalBench.unityGraphics());
            assert.equal(result.graphics?.core, backend);
            if (backend !== 'native') {
              assert(result.graphics.draws > 0 && !result.graphics.adapter.isFallbackAdapter);
              assert.deepEqual(result.graphics.errors, []);
            }
            assert(await page.evaluate(() => [...benchmarks, 'Overall'].every(name =>
              results.some(row => row.benchmark === name && Number.isFinite(row.result) && row.result > 0))),
            'Unity did not complete all thirteen subtests and Overall');
          } else {
            await page.waitForFunction(() => externalBench.ready(), undefined, { polling: 100, timeout: 45000 });
            await page.waitForLoadState('networkidle');
            result.measurement = await page.evaluate(([warmup, samples]) => externalBench.run(warmup, samples), [warmup, samples]);
            const measurement = result.measurement;
            if (uniformSweep.has(name) || name === 'animometer') {
              const draws = name === 'animometer-setup' ? 0 : 20000;
              assert.equal(measurement.auditDraws, draws);
              assert.equal(measurement.auditUniforms, name === 'animometer' ? 6 * draws : 6 + draws * (uniformSweep.get(name) ?? 0));
              if (backend !== 'native') assert.equal(measurement.after.draws - measurement.before.draws, samples * draws);
            } else assert(measurement.auditDraws > 0, 'No draws in audit frame');
            assert.equal(measurement.glError, 0);
            assert.deepEqual(measurement.errors, []);
            if (backend !== 'native') {
              if (name !== 'animometer-setup') assert(measurement.after.draws > measurement.before.draws);
              assert.equal(measurement.adapter.isFallbackAdapter, false);
            } else {
              assert.doesNotMatch(measurement.adapter, /swiftshader|llvmpipe|software rasterizer/i);
            }
            await page.locator('canvas:visible').first().screenshot({ path: stem + '.png' });
          }
          assert.deepEqual(errors, []);
          result.status = 'pass';
        } catch (error) {
          result.status = 'failed';
          result.failure = String(error);
          if (name === 'unity' && !page.isClosed()) {
            result.diagnostic = await page.evaluate(() => ({
              contexts: externalBench.contexts(), scores: window.results, graphics: externalBench.unityGraphics(),
              status: document.body.innerText.slice(-1000),
            })).catch(() => null);
          }
          process.exitCode = 1;
        } finally {
          await writeFile(stem + '.json', JSON.stringify(result, null, 2));
          await page.close();
        }
        console.log(result.round, name, backend, result.status, result.failure ?? '', errors.slice(0,2));
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(output);
}
