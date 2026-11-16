import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { domUploadConfiguration, domUploadSources } from './dom-upload';
import type { runDomUploadBenchmark } from './dom-upload';

type Result = Awaited<ReturnType<typeof runDomUploadBenchmark>>;
const output = fileURLToPath(new URL('../artifacts/dom-input/pr4/performance/', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const orders = [['native', 'js', 'rust'], ['js', 'rust', 'native'], ['rust', 'native', 'js']] as const;
const runStartedAt = new Date().toISOString();
const machine = { platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model ?? null,
  logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version };
const pngStarted = performance.now();
const png = new PNG({ width: domUploadConfiguration.width, height: domUploadConfiguration.height });
for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(domUploadConfiguration.color, offset);
const pngBytes = PNG.sync.write(png);
const pngDataURL = 'data:image/png;base64,' + pngBytes.toString('base64');
const pngPreparationMs = performance.now() - pngStarted;
const records: { round: number; sourceKind: string; backend: string; status: string; result: Result | { failure: string } }[] = [];
let launchCommandLine = '';
let source: { head: string; treeSha256: string };
let hashes: Record<string, string>;
let rustBuild: unknown;

test.beforeAll(async ({ browser }) => {
  execFileSync(process.execPath, ['tools/snapshot.mjs'], { cwd: root });
  const snapshot = JSON.parse(await readFile(new URL('../artifacts/environment/source.json', import.meta.url), 'utf8'));
  source = { head: snapshot.head, treeSha256: snapshot.treeSha256 };
  hashes = {};
  for (const [name, path] of [['rustWasm', '../artifacts/core-wasm/refral_core.wasm'],
    ['compilerWasm', '../artifacts/compiler/compiler.wasm'], ['compilerAdapter', '../artifacts/compiler/compiler.mjs'],
    ['dependencyLock', '../pnpm-lock.yaml']] as const) {
    hashes[name] = createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
  }
  hashes.sourcePng = createHash('sha256').update(pngBytes).digest('hex');
  rustBuild = JSON.parse(await readFile(new URL('../artifacts/core-wasm/build.json', import.meta.url), 'utf8'));
  const session = await browser.newBrowserCDPSession();
  try {
    const processes = (await session.send('SystemInfo.getProcessInfo')).processInfo;
    const browserProcess = processes.find(process => process.type === 'browser');
    if (!browserProcess) throw new Error('Chrome browser process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='], { encoding: 'utf8' }).trim();
  } finally {
    await session.detach();
  }
  await mkdir(output, { recursive: true });
  await writeFile(output + 'source.png', pngBytes);
});

test.afterAll(async ({ browser }) => {
  const runs = records.map(record => {
    if ('failure' in record.result) return record;
    const result = record.result;
    const native = records.find(other => other.round === record.round && other.sourceKind === record.sourceKind
      && other.backend === 'native' && other.status === 'pass');
    const nativeP50 = native && !('failure' in native.result) ? native.result.cpuP50MsPerLogicalFrame : null;
    return { round: record.round, sourceKind: record.sourceKind, backend: record.backend, status: record.status,
      sourcePreparationMs: result.sourcePreparationMs, contextInitializationMs: result.contextInitializationMs,
      resourcePreparationMs: result.resourcePreparationMs, firstFrameCpuMs: result.firstFrameCpuMs,
      firstImageCompleteMs: result.firstImageCompleteMs, firstImageSinceStartMs: result.firstImageSinceStartMs,
      cpuSampleP50Ms: result.cpuSampleP50Ms, cpuSampleP95Ms: result.cpuSampleP95Ms,
      cpuP50MsPerLogicalFrame: result.cpuP50MsPerLogicalFrame, cpuP95MsPerLogicalFrame: result.cpuP95MsPerLogicalFrame,
      nativeCpuP50Ratio: nativeP50 && nativeP50 > 0 ? result.cpuP50MsPerLogicalFrame / nativeP50 : null,
      timer: result.timer, hostCounters: result.hostCounters, gpuTiming: result.gpuTiming };
  });
  await mkdir(output, { recursive: true });
  await writeFile(output + 'summary.json', JSON.stringify({ runStartedAt, recordedAt: new Date().toISOString(),
    status: records.length === 27 && records.every(record => record.status === 'pass') ? 'complete' : 'partial',
    completedRuns: records.filter(record => record.status === 'pass').length, expectedRuns: 27,
    browserVersion: browser.version(), launch: { channel: 'chrome', headless: test.info().project.use.headless,
      commandLine: launchCommandLine, deviceScaleFactor: test.info().project.use.deviceScaleFactor },
    machine, source, hashes, rustBuild, orders, configuration: domUploadConfiguration, pngPreparationMs,
    units: { sample: 'ms/sample', logicalFrame: 'ms/logical-frame' },
    ratioDefinition: 'Backend CPU p50 per logical frame divided by native CPU p50 for the same source and round.', runs,
  }, null, 2) + '\n');
});

for (let round = 0; round < orders.length; round++) {
  for (const sourceKind of domUploadSources) {
    for (let position = 0; position < orders[round]!.length; position++) {
      const backend = orders[round]![position]!;
      test(`round ${round + 1} ${sourceKind} ${backend}`, async ({ page, browser }) => {
        await page.goto('/tests/fixtures/runner.html');
        const result: Result | { failure: string } = await page.evaluate(async ({ backend, sourceKind, pngDataURL }) => {
          const entry = '/benchmarks/dom-upload.ts';
          const { runDomUploadBenchmark } = await import(/* @vite-ignore */ entry);
          return runDomUploadBenchmark(backend, sourceKind, pngDataURL);
        }, { backend, sourceKind, pngDataURL }).catch(error => ({ failure: String(error) }));
        const passed = !('failure' in result) && result.selectedCore === backend && result.error === 0
          && result.validationErrors.length === 0 && result.firstProbe.pixelCorrect && result.firstProbe.error === 0
          && result.samples.length === 120 && result.warmup.length === 30
          && [...result.warmup, ...result.samples].every(sample => sample.pixelCorrect && sample.error === 0);
        const status = passed ? 'pass' : 'fail';
        records.push({ round: round + 1, sourceKind, backend, status, result });
        const directory = output + `round-${round + 1}/${sourceKind}/`;
        await mkdir(directory, { recursive: true });
        await writeFile(directory + backend + '.json', JSON.stringify({ runStartedAt, recordedAt: new Date().toISOString(),
          status, round: round + 1, backendOrder: orders[round], position, browserVersion: browser.version(),
          launch: { channel: 'chrome', headless: test.info().project.use.headless, commandLine: launchCommandLine,
            deviceScaleFactor: test.info().project.use.deviceScaleFactor },
          machine, source, hashes, rustBuild, pngPreparationMs, result,
        }, null, 2) + '\n');
        if ('failure' in result) throw new Error(result.failure);
        expect(result.selectedCore).toBe(backend);
        expect(result.error).toBe(0);
        expect(result.validationErrors).toEqual([]);
        expect(result.configuration).toEqual(domUploadConfiguration);
        expect(result.firstProbe.pixel).toEqual([...domUploadConfiguration.color]);
        expect(result.firstProbe.error).toBe(0);
        expect(result.warmup).toHaveLength(30);
        expect(result.samples).toHaveLength(120);
        expect(result.cpuSamplesMs).toHaveLength(120);
        expect(result.cpuSamplesMsPerLogicalFrame).toHaveLength(120);
        expect([...result.warmup, ...result.samples].filter(sample => !sample.pixelCorrect || sample.error !== 0)).toEqual([]);
        expect(result.hostCounters.available).toBe(backend !== 'native');
      });
    }
  }
}
