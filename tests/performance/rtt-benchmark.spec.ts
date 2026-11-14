import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { benchmarkWorkloads } from '../../benchmarks/browser';
import type { runRttBenchmark } from '../../benchmarks/browser';

const orders = [['native', 'js', 'rust'], ['js', 'rust', 'native'], ['rust', 'native', 'js']] as const;
const runStartedAt = new Date().toISOString();
const machine = { platform: platform(), release: release(), architecture: arch(),
  cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version };
type Result = Awaited<ReturnType<typeof runRttBenchmark>>;
let launchCommandLine = '';
let source: { head: string; treeSha256: string };

test.beforeAll(async ({ browser }) => {
  execFileSync(process.execPath, ['tools/snapshot.mjs']);
  const snapshot = JSON.parse(await readFile('artifacts/environment/source.json', 'utf8'));
  source = { head: snapshot.head, treeSha256: snapshot.treeSha256 };
  const session = await browser.newBrowserCDPSession();
  try {
    const processes = (await session.send('SystemInfo.getProcessInfo')).processInfo;
    const browserProcess = processes.find(process => process.type === 'browser');
    if (!browserProcess) throw new Error('Chrome browser process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='], { encoding: 'utf8' }).trim();
  } finally { await session.detach(); }
});

function compareImages(reference: Result, candidate: Result, tolerance: number, edge: number) {
  const source = reference.lastImage; const target = candidate.lastImage;
  let differingPixels = 0; let unmatchedPixels = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const index = (y * source.width + x) * 4;
      const matches = (otherX: number, otherY: number) => {
        if (otherX < 0 || otherY < 0 || otherX >= source.width || otherY >= source.height) return false;
        const other = (otherY * source.width + otherX) * 4;
        return [0, 1, 2, 3].every(channel => Math.abs(source.pixels[other + channel]! - target.pixels[index + channel]!) <= tolerance);
      };
      if (matches(x, y)) continue;
      differingPixels++;
      let nearby = false;
      for (let dy = -edge; dy <= edge; dy++) for (let dx = -edge; dx <= edge; dx++) nearby ||= matches(x + dx, y + dy);
      if (!nearby) unmatchedPixels++;
    }
  }
  return { tolerance, edge, differingPixels, unmatchedPixels };
}

test.afterAll(async () => {
  const records: { round: number; backend: string; workload: string; result: Result }[] = [];
  for (let round = 0; round < orders.length; round++) {
    for (const workload of benchmarkWorkloads) {
      for (const backend of orders[round]!) {
        const path = `artifacts/benchmarks/rtt/round-${round + 1}/${workload}/${backend}.json`;
        try {
          const record = JSON.parse(await readFile(path, 'utf8'));
          if (record.runStartedAt === runStartedAt && record.status === 'pass') {
            records.push({ round: round + 1, backend, workload, result: record.result });
          }
        } catch { /* A partial or failed run records the available backend results. */ }
      }
    }
  }
  const workloads = benchmarkWorkloads.map(workload => ({ workload,
    rounds: [1, 2, 3].map(round => {
      const runs = records.filter(record => record.workload === workload && record.round === round);
      const native = runs.find(record => record.backend === 'native');
      const js = runs.find(record => record.backend === 'js');
      const rust = runs.find(record => record.backend === 'rust');
      const comparisons = native ? runs.filter(record => record.backend !== 'native').map(record => ({
        pair: record.backend + '/native', ...compareImages(native.result, record.result,
          workload === 'render-to-texture' ? 2 : 1, workload === 'render-to-texture' ? 1 : 0),
      })) : [];
      if (js && rust) comparisons.push({ pair: 'rust/js', ...compareImages(js.result, rust.result, 0, 0) });
      return { round, comparisons, runs: runs.map(record => ({ backend: record.backend,
        cpuP50Ms: record.result.cpuP50Ms, cpuP95Ms: record.result.cpuP95Ms,
        nativeP50Ratio: native && native.result.cpuP50Ms > 0 ? record.result.cpuP50Ms / native.result.cpuP50Ms : null,
        contextInitializationMs: record.result.contextInitializationMs,
        resourcePreparationMs: record.result.resourcePreparationMs,
        firstFrameCpuMs: record.result.firstFrameCpuMs,
        firstImageCompleteMs: record.result.firstImageCompleteMs,
        timedCounters: record.result.timedCounters, memory: record.result.memory,
      })) };
    }),
  }));
  await mkdir('artifacts/benchmarks/rtt', { recursive: true });
  await writeFile('artifacts/benchmarks/rtt/summary.json', JSON.stringify({ runStartedAt,
    status: records.length === 45 ? 'complete' : 'partial', completedRuns: records.length,
    units: 'ms/logical-frame', ratioDefinition: 'backend CPU p50 / native CPU p50 from the same round and workload',
    backendOrders: orders, workloads,
  }, null, 2) + '\n');
  if (records.length === 45) {
    for (const workload of workloads) for (const round of workload.rounds) {
      for (const comparison of round.comparisons) expect(comparison.unmatchedPixels,
        `${workload.workload} round ${round.round} ${comparison.pair}`).toBe(0);
    }
  }
});

for (let round = 0; round < orders.length; round++) {
  for (const workload of benchmarkWorkloads) {
    for (let position = 0; position < orders[round]!.length; position++) {
      const backend = orders[round]![position]!;
      test(`round ${round + 1} ${workload} ${backend}`, async ({ page, browser }) => {
        await page.goto('/tests/fixtures/runner.html');
        const result: Result | { failure: string } = await page.evaluate(async ({ backend, workload }) => {
          const path = '/benchmarks/browser.ts';
          const { runRttBenchmark } = await import(/* @vite-ignore */ path);
          return runRttBenchmark(backend, workload);
        }, { backend, workload }).catch(error => ({ failure: String(error) }));
        const directory = `artifacts/benchmarks/rtt/round-${round + 1}/${workload}`;
        await mkdir(directory, { recursive: true });
        const hashes: Record<string, string> = {};
        for (const [name, path] of [['rust', 'artifacts/core-wasm/refral_core.wasm'],
          ['compiler', 'artifacts/compiler/compiler.wasm'], ['demoAdapter', 'artifacts/fixtures/render-to-texture.mjs']] as const) {
          hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
        }
        const passed = !('failure' in result) && result.selectedCore === backend && result.error === 0
          && result.validationErrors.length === 0 && result.cpuSamplesMs.length === 120;
        await writeFile(`${directory}/${backend}.json`, JSON.stringify({ runStartedAt, status: passed ? 'pass' : 'fail', recordedAt: new Date().toISOString(),
          round: round + 1, backendOrder: orders[round], position, browserVersion: browser.version(),
          launch: { channel: 'chrome', headless: process.env.REFRAL_HEADLESS === '1', commandLine: launchCommandLine }, machine, source, hashes, result,
        }, null, 2) + '\n');
        if ('failure' in result) throw new Error(result.failure);
        expect(result.selectedCore).toBe(backend);
        expect(result.timer.crossOriginIsolated).toBe(true);
        expect(result.error).toBe(0); expect(result.validationErrors).toEqual([]);
        expect(result.cpuSamplesMs).toHaveLength(120);
        expect(result.configuration.warmupSamples).toBe(30);
        expect(result.configuration.framesPerSample).toBe(8);
        expect([result.lastImage.width, result.lastImage.height]).toEqual([64, 64]);
      });
    }
  }
}
