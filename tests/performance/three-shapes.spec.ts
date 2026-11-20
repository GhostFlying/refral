import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { PNG } from 'pngjs';

type Result = Awaited<ReturnType<typeof import('../../benchmarks/three-shapes').runShapesBenchmark>>;
interface Run { round: number; browserVersion: string; result: Result }
const orders = [['native', 'js', 'rust'], ['js', 'rust', 'native'], ['rust', 'native', 'js']] as const;
const runStartedAt = new Date().toISOString();
const output = `artifacts/three-shapes/${runStartedAt.replaceAll(':', '-')}`;
const runPaths: string[] = [];

function percentile(samples: number[], p: number) {
  const sorted = samples.slice().sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p) - 1]!;
}

function compare(reference: PNG, candidate: PNG) {
  expect([candidate.width, candidate.height]).toEqual([reference.width, reference.height]);
  const pixels = reference.height * reference.width;
  let different = 0;
  let absoluteError = 0;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const red = Math.abs(reference.data[offset]! - candidate.data[offset]!);
    const green = Math.abs(reference.data[offset + 1]! - candidate.data[offset + 1]!);
    const blue = Math.abs(reference.data[offset + 2]! - candidate.data[offset + 2]!);
    if (Math.max(red, green, blue) > 2) different++;
    absoluteError += red + green + blue;
  }
  return { rgbTolerance: 2, differentPixels: different, fraction: different / pixels,
    meanAbsoluteRgbError: absoluteError / (pixels * 3),
    byteExact: reference.data.equals(candidate.data) };
}

test.beforeAll(async ({ browser }) => {
  await mkdir(output, { recursive: true });
  await writeFile('artifacts/three-shapes/latest.txt', output + '\n');
  execFileSync(process.execPath, ['tools/snapshot.mjs']);
  const source = JSON.parse(await readFile('artifacts/environment/source.json', 'utf8'));
  const paths = ['artifacts/compiler/compiler.wasm', 'artifacts/core-wasm/refral_core.wasm',
    'pnpm-lock.yaml', 'examples/three-shapes/uv_grid_opengl.jpg'];
  const hashes = await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]));
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(entry => entry.type === 'browser');
    if (!browserProcess) throw new Error('Chrome browser process unavailable.');
    const commandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='], { encoding: 'utf8' }).trim();
    await writeFile(`${output}/environment.json`, JSON.stringify({
      runStartedAt, revision: source.head, sourceSha256: source.treeSha256, hashes: Object.fromEntries(hashes), orders,
      browserVersion: browser.version(), channel: 'chrome', headless: test.info().project.use.headless, commandLine,
      platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model,
    }, null, 2) + '\n');
  } finally { await session.detach(); }
});

for (const [index, order] of orders.entries()) {
  for (const backend of order) {
    const path = `${output}/round-${index + 1}-${backend}`;
    test(`Shapes round ${index + 1} ${backend}`, async ({ page, browser }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto('/tests/fixtures/runner.html');
      const result: Result = await page.evaluate(async backend => {
        const entry = '/benchmarks/three-shapes.ts';
        const { runShapesBenchmark }: typeof import('../../benchmarks/three-shapes') = await import(/* @vite-ignore */ entry);
        return runShapesBenchmark(backend);
      }, backend);
      await page.locator('canvas').screenshot({ path: `${path}.png` });
      await writeFile(`${path}.json`, JSON.stringify({
        round: index + 1, browserVersion: browser.version(), result, pageErrors: errors,
      }, null, 2) + '\n');
      expect(errors).toEqual([]);
      expect(result.backend).toBe(backend);
      expect(result.glError).toBe(0);
      expect(result.gpuErrors).toEqual([]);
      expect(result.frames).toHaveLength(120);
      expect(result.frames.every(frame => frame.calls >= 80 && frame.triangles > 0 && frame.lines > 0 && frame.points > 0)).toBe(true);
      runPaths.push(path);
    });
  }
}

test.afterAll(async () => {
  if (runPaths.length !== 9) return;
  const raw = await Promise.all(runPaths.map(async path => ({
    ...JSON.parse(await readFile(`${path}.json`, 'utf8')) as Run,
    image: PNG.sync.read(await readFile(`${path}.png`)),
  })));
  const measurements = raw.map(({ round, result }) => {
    const values = result.frames.map(frame => frame.cpuMs);
    const raf = result.frames.map(frame => frame.rafIntervalMs);
    const initial = result.initialStats;
    const end = result.endStats;
    return {
      round, backend: result.backend, contextMs: result.contextMs, sceneMs: result.sceneMs,
      firstFrameCpuMs: result.firstFrameCpuMs, cpuP50Ms: percentile(values, 0.5), cpuP95Ms: percentile(values, 0.95),
      rafP50Ms: percentile(raf, 0.5), rafP95Ms: percentile(raf, 0.95),
      observedRafFps: result.frames.length * 1000 / result.rafElapsedMs,
      submissionsPerFrame: initial && end ? (end.submits - initial.submits) / result.frames.length : null,
    };
  });
  const comparisons = orders.map((_, index) => {
    const round = index + 1;
    const [native, js, rust] = ['native', 'js', 'rust'].map(name =>
      raw.find(value => value.round === round && value.result.backend === name)!);
    const workload = (entry: typeof native) => entry.result.frames.map(({ calls, triangles, lines, points }) =>
      ({ calls, triangles, lines, points }));
    return { round, equalWork: JSON.stringify(workload(native!)) === JSON.stringify(workload(js!))
      && JSON.stringify(workload(native!)) === JSON.stringify(workload(rust!)),
      nativeJs: compare(native!.image, js!.image), nativeRust: compare(native!.image, rust!.image),
      jsRust: compare(js!.image, rust!.image) };
  });
  await writeFile(`${output}/summary.json`, JSON.stringify({
    runStartedAt, measurements, comparisons,
    cpuBoundary: 'renderer.render and gl.flush, including browser-side encoding and submission',
    rafBoundary: 'intervals between requestAnimationFrame callbacks, including refresh pacing and scheduling',
  }, null, 2) + '\n');
  for (const comparison of comparisons) {
    expect(comparison.equalWork).toBe(true);
    expect(comparison.nativeJs.fraction).toBeLessThan(0.002);
    expect(comparison.nativeRust.fraction).toBeLessThan(0.002);
    expect(comparison.jsRust.byteExact).toBe(true);
  }
});
