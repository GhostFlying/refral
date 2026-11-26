import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { PNG } from 'pngjs';
import type { HeavyScene, runHeavyScene } from '../../benchmarks/three-heavy';

type Result = Awaited<ReturnType<typeof runHeavyScene>>;
type Backend = 'native' | 'js' | 'rust';
interface Run { round: number; scene: HeavyScene; backend: Backend; result: Result; path: string }

const defaultScenes: readonly HeavyScene[] = ['shapes-four', 'triangle-cloud', 'sobel-1080p', 'sobel-540p'];
const largeScenes: readonly HeavyScene[] = ['suzanne-1000', 'suzanne-3000', 'interactive-cubes'];
const scenes = [...defaultScenes, ...largeScenes];
const order = [['native', 'js', 'rust'], ['js', 'rust', 'native'], ['rust', 'native', 'js']] as const;
const requestedScenes = process.env.REFRAL_HEAVY_SCENES?.split(',') ?? defaultScenes;
const activeScenes = scenes.filter(scene => requestedScenes.includes(scene));
if (activeScenes.length !== requestedScenes.length) throw new Error('Invalid REFRAL_HEAVY_SCENES.');

function sampleCount(variable: string, fallback: number) {
  const value = Number(process.env[variable] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${variable}.`);
  return value;
}
const warmup = sampleCount('REFRAL_HEAVY_WARMUP', 30);
const samples = sampleCount('REFRAL_HEAVY_SAMPLES', 120);
const rounds = sampleCount('REFRAL_HEAVY_ROUNDS', 3);
const runStartedAt = new Date().toISOString();
const output = `artifacts/three-heavy/${runStartedAt.replaceAll(':', '-')}`;
const runs: Run[] = [];

function percentile(values: number[], p: number) {
  return values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
}
function metrics(values: number[]) {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}
function compare(reference: PNG, candidate: PNG) {
  expect([candidate.width, candidate.height]).toEqual([reference.width, reference.height]);
  let different = 0;
  let absoluteError = 0;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const red = Math.abs(reference.data[offset]! - candidate.data[offset]!);
    const green = Math.abs(reference.data[offset + 1]! - candidate.data[offset + 1]!);
    const blue = Math.abs(reference.data[offset + 2]! - candidate.data[offset + 2]!);
    if (Math.max(red, green, blue) > 2) different++;
    absoluteError += red + green + blue;
  }
  const pixels = reference.width * reference.height;
  return { pixelsOverTwo: different, fractionOverTwo: different / pixels,
    meanAbsoluteRgbDelta: absoluteError / (3 * pixels), byteExact: reference.data.equals(candidate.data) };
}
function digest(data: Uint8Array) { return createHash('sha256').update(data).digest('hex'); }

test.beforeAll(async ({ browser }) => {
  await mkdir(output, { recursive: true });
  const files = ['benchmarks/three-heavy.ts', 'benchmarks/three-large.ts', 'tests/performance/three-heavy.spec.ts', 'pnpm-lock.yaml', 'artifacts/compiler/compiler.wasm',
    'artifacts/core-wasm/refral_core.wasm', 'examples/three-shapes/uv_grid_opengl.jpg'];
  if (activeScenes.some(scene => scene.startsWith('suzanne-'))) files.push('artifacts/three-scene-assets/suzanne_buffergeometry.json');
  const hashes = await Promise.all(files.map(async file => [file, digest(await readFile(file))]));
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(entry => entry.type === 'browser');
    if (!browserProcess) throw new Error('Chrome browser process unavailable.');
    const commandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='], { encoding: 'utf8' }).trim();
    await writeFile(`${output}/environment.json`, JSON.stringify({
      runStartedAt, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      trackedDiffSha256: digest(execFileSync('git', ['diff', 'HEAD'])), hashes: Object.fromEntries(hashes),
      browser: browser.version(), channel: 'chrome', headless: test.info().project.use.headless, commandLine,
      platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model,
      warmup, samples, rounds, scenes: activeScenes, order,
    }, null, 2) + '\n');
  } finally { await session.detach(); }
});

test.use({ viewport: { width: 1920, height: 1200 } });
for (let round = 0; round < rounds; round++) {
  for (const scene of activeScenes) {
    for (const backend of order[round % order.length]!) {
      test(`heavy round ${round + 1} ${scene} ${backend}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto('/tests/fixtures/runner.html');
        const result: Result = await page.evaluate(async ({ scene, backend, warmup, samples }) => {
          const path = '/benchmarks/three-heavy.ts';
          const { runHeavyScene }: typeof import('../../benchmarks/three-heavy') = await import(/* @vite-ignore */ path);
          return runHeavyScene(scene, backend, warmup, samples);
        }, { scene, backend, warmup, samples });
        const path = `${output}/round-${round + 1}-${scene}-${backend}`;
        await page.locator('canvas').screenshot({ path: `${path}.png` });
        await writeFile(`${path}.json`, JSON.stringify({ round: round + 1, scene, backend, result, errors }, null, 2) + '\n');
        expect(errors).toEqual([]);
        expect(result.selectedCore).toBe(backend);
        if (largeScenes.includes(scene) && backend !== 'native') expect(result.adapter).toMatchObject({ isFallbackAdapter: false });
        if (backend === 'rust') expect(result.afterBatchStats!.batches).toBeGreaterThan(result.beforeBatchStats!.batches);
        expect(result.glError).toBe(0);
        expect(result.gpuErrors).toEqual([]);
        expect(result.frames).toHaveLength(samples);
        expect(result.frames.every(frame => frame.calls > 0 && frame.triangles > 0)).toBe(true);
        runs.push({ round: round + 1, scene, backend, result, path });
      });
    }
  }
}

test.afterAll(async () => {
  if (runs.length !== rounds * activeScenes.length * order[0].length) return;
  const measurements = runs.map(({ round, scene, backend, result, path }) => {
    const { width, height, first, contextMs, sceneMs, firstImageMs, frames, beforeStats, afterStats, firstStats,
      beforeBatchStats, afterBatchStats } = result;
    const interval = frames.map(frame => frame.intervalMs);
    const counters = ['draws', 'submits', 'passes', 'copies', 'pipelines', 'bindGroups', 'uploadedBytes'] as const;
    const batchCounters = ['commands', 'batches', 'inputBytes', 'outputBytes', 'bufferCopies', 'bufferBytes'] as const;
    return { round, scene, backend, width, height, firstCalls: first.calls, firstTriangles: first.triangles,
      calls: metrics(frames.map(frame => frame.calls)), triangles: metrics(frames.map(frame => frame.triangles)),
      cpuMs: metrics(frames.map(frame => frame.cpuMs)), intervalMs: metrics(interval),
      observedRafHz: 1000 * interval.length / interval.reduce((a, b) => a + b, 0),
      callbacksOver20Ms: interval.filter(ms => ms > 20).length,
      contextMs, sceneMs, firstCpuMs: first.cpuMs, firstImageMs, firstStats,
      hostPerFrame: beforeStats && afterStats ? Object.fromEntries(counters.map(counter =>
        [counter, (afterStats[counter] - beforeStats[counter]) / frames.length])) : null,
      batchPerFrame: beforeBatchStats && afterBatchStats ? Object.fromEntries(batchCounters.map(counter =>
        [counter, (afterBatchStats[counter] - beforeBatchStats[counter]) / frames.length])) : null,
      allocatedBufferBytes: afterStats?.allocatedBufferBytes ?? null, image: `${path}.png` };
  });
  const comparisons = [];
  for (let round = 1; round <= rounds; round++) {
    for (const scene of activeScenes) {
      const group = order[0].map(backend => runs.find(run =>
        run.round === round && run.scene === scene && run.backend === backend)!);
      const [native, js, rust] = await Promise.all(group.map(async run => PNG.sync.read(await readFile(`${run.path}.png`))));
      if (largeScenes.includes(scene)) {
        const background = scene === 'interactive-cubes' ? 240 : 255;
        let nonBackground = 0;
        const pixel = native!.data;
        for (let i = 0; i < pixel.length; i += 4) {
          if (pixel[i] !== background || pixel[i + 1] !== background || pixel[i + 2] !== background) nonBackground++;
        }
        expect(nonBackground).toBeGreaterThan(native!.width * native!.height * 0.05);
      }
      const counts = (run: Run) => run.result.frames.map(({ seconds, calls, triangles, lines, points }) =>
        [seconds, calls, triangles, lines, points]);
      const equalWork = group.every(run => JSON.stringify(counts(run)) === JSON.stringify(counts(group[0]!)));
      comparisons.push({ round, scene, equalWork,
        nativeJs: compare(native!, js!), nativeRust: compare(native!, rust!), jsRust: compare(js!, rust!) });
    }
  }
  await writeFile(`${output}/summary.json`, JSON.stringify({ runStartedAt, measurements, comparisons,
    cpuBoundary: 'scene animation updates, Three.js rendering and gl.flush CPU time',
    intervalBoundary: 'requestAnimationFrame callback interval including refresh pacing and scheduling',
    firstImageBoundary: 'context creation through first resolved createImageBitmap including scene and RAF wait',
  }, null, 2) + '\n');
  await writeFile('artifacts/three-heavy/latest.txt', output + '\n');
  for (const comparison of comparisons) {
    expect(comparison.equalWork, comparison.scene).toBe(true);
    expect(comparison.jsRust.byteExact, comparison.scene).toBe(true);
    expect(comparison.nativeJs.fractionOverTwo, comparison.scene).toBeLessThan(0.002);
    expect(comparison.nativeRust.fractionOverTwo, comparison.scene).toBeLessThan(0.002);
  }
});
