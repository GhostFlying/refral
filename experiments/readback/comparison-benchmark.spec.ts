import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureEnvironment } from './evidence';
import { comparisonSampling, comparisonWorkloads } from './comparison';
import type { prepareMeasurement, measure } from './comparison';

interface ProcessInfo {
  id: number;
  type: string;
  cpuTime: number;
}

function cpuDifference(before: ProcessInfo[], after: ProcessInfo[]) {
  const records = after.map((process) => {
    const previous = before.find((value) => value.id === process.id && value.type === process.type);
    if (!previous || !Number.isFinite(process.cpuTime) || process.cpuTime < previous.cpuTime) {
      throw new Error(`Process CPU identity/counter changed for ${process.type}/${process.id}.`);
    }
    return { id: process.id, type: process.type, cpuMs: (process.cpuTime - previous.cpuTime) * 1000 };
  });
  if (records.length !== before.length) throw new Error('Chrome process set changed during CPU sampling.');
  const rendererCpuMs = records
    .filter((value) => /renderer|worker/i.test(value.type))
    .reduce((sum, value) => sum + value.cpuMs, 0);
  const gpuProcessCpuMs = records
    .filter((value) => /gpu/i.test(value.type))
    .reduce((sum, value) => sum + value.cpuMs, 0);
  if (rendererCpuMs <= 0) throw new Error('Renderer process CPU counters are unavailable or unchanged.');
  const operations = comparisonSampling.samples * comparisonSampling.framesPerSample;
  return {
    records,
    rendererCpuMs,
    gpuProcessCpuMs,
    rendererCpuMsPerOperation: rendererCpuMs / operations,
    gpuProcessCpuMsPerOperation: gpuProcessCpuMs / operations,
  };
}

function percentile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

test('Canvas2D and GPU-worker actual-core readback benchmark', async ({ page, browser }) => {
  const environment = await captureEnvironment(browser, 'artifacts/readback-comparison/benchmark');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4176/tests/fixtures/runner.html');
  const session = await browser.newBrowserCDPSession();
  const records = [];
  const combinations = [
    { core: 'js', route: 'canvas' },
    { core: 'js', route: 'worker' },
    { core: 'rust', route: 'canvas' },
    { core: 'rust', route: 'worker' },
  ] as const;
  try {
    for (let round = 0; round < comparisonSampling.rounds; round++) {
      for (let workload = 0; workload < comparisonWorkloads.length; workload++) {
        for (let step = 0; step < combinations.length; step++) {
          const combination = combinations[(step + round) % combinations.length]!;
          const setup: Awaited<ReturnType<typeof prepareMeasurement>> = await page.evaluate(
            async ({ core, route, workload }) => {
              const path = '/experiments/readback/comparison.ts';
              return (await import(/* @vite-ignore */ path)).prepareMeasurement(core, route, workload);
            },
            { ...combination, workload }
          );
          try {
            expect(setup.core).toBe(combination.core);
            expect(setup.first.mismatchedChannels).toBe(0);
            const warm = await page.evaluate(async (workload) => {
              const path = '/experiments/readback/comparison.ts';
              return (await import(/* @vite-ignore */ path)).warmMeasurement(workload);
            }, workload);
            const before = (await session.send('SystemInfo.getProcessInfo')).processInfo;
            const started = performance.now();
            const samples: Awaited<ReturnType<typeof measure>> = await page.evaluate(async (workload) => {
              const path = '/experiments/readback/comparison.ts';
              return (await import(/* @vite-ignore */ path)).measure(workload);
            }, workload);
            const batchWallMs = performance.now() - started;
            const after = (await session.send('SystemInfo.getProcessInfo')).processInfo;
            const verification = await page.evaluate(async () => {
              const path = '/experiments/readback/comparison.ts';
              return (await import(/* @vite-ignore */ path)).verifyMeasurement();
            });
            expect(verification.mismatchedChannels).toBe(0);
            expect(samples.diagnostics.errors).toEqual([]);
            expect(samples.diagnostics.stats.allocatedBufferBytes).toBe(warm.diagnostics.stats.allocatedBufferBytes);
            expect(samples.diagnostics.stats.allocatedTextureBytes).toBe(warm.diagnostics.stats.allocatedTextureBytes);
            expect(samples.records).toHaveLength(comparisonSampling.samples);
            const cpu = cpuDifference(before, after);
            const values = samples.records.map((value) => value.operationMs);
            const capture = samples.records.map((value) => value.captureMs);
            const record = {
              round,
              step,
              ...combination,
              workload: comparisonWorkloads[workload]!.name,
              setup,
              warmDiagnostics: warm.diagnostics,
              ...samples,
              verification,
              batchWallMs,
              cpu: { before, after, ...cpu },
              p50Ms: percentile(values, 0.5),
              p95Ms: percentile(values, 0.95),
              captureP50Ms: percentile(capture, 0.5),
              captureP95Ms: percentile(capture, 0.95),
            };
            records.push(record);
            const name = `${round}-${combination.route}-${combination.core}-${record.workload}`;
            await writeFile(
              `artifacts/readback-comparison/benchmark/${name}.json`,
              JSON.stringify({ environment, record }, null, 2)
            );
            console.log(
              `${name} ${record.p50Ms.toFixed(4)} ms/operation, renderer CPU ${cpu.rendererCpuMsPerOperation.toFixed(4)} ms/operation`
            );
          } finally {
            await page.evaluate(async () => {
              const path = '/experiments/readback/comparison.ts';
              await (await import(/* @vite-ignore */ path)).disposeMeasurement();
            });
          }
        }
      }
    }
    const aggregate = [];
    for (const combination of combinations) {
      for (const workload of comparisonWorkloads) {
        const selected = records.filter(
          (record) =>
            record.core === combination.core && record.route === combination.route && record.workload === workload.name
        );
        const values = selected.flatMap((record) => record.records.map((sample) => sample.operationMs));
        aggregate.push({
          ...combination,
          workload: workload.name,
          samples: values.length,
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          rendererCpuMsPerOperation:
            selected.reduce((sum, record) => sum + record.cpu.rendererCpuMsPerOperation, 0) / selected.length,
          gpuProcessCpuMsPerOperation:
            selected.reduce((sum, record) => sum + record.cpu.gpuProcessCpuMsPerOperation, 0) / selected.length,
        });
      }
    }
    await writeFile(
      'artifacts/readback-comparison/benchmark/summary.json',
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          environment,
          sampling: comparisonSampling,
          aggregate,
          latencyBoundary:
            'Semantic GL calls plus host encoding/transport, completed GPU readback and owned pixel copying. Per-pixel validation is outside sampling.',
          cpuBoundary:
            'CDP cumulative process CPU across the measured batch, sample yields, retirement draining, harness bookkeeping and result serialization. All renderer/worker-containing processes are summed. GPU-process CPU is separate from GPU execution duration.',
          phaseBoundary:
            'Canvas capture excludes inline draw encoding already counted in clientEncodingMs. Worker capture includes remote draw encoding. operationMs is the primary comparable wall-clock metric.',
          gpuDuration: {
            measured: false,
            reason: 'GPU timestamp queries are not enabled for this latency/CPU comparison.',
          },
          records: records.map(({ records: _samples, ...record }) => record),
        },
        null,
        2
      )
    );
    expect(errors).toEqual([]);
  } finally {
    await session.detach();
  }
});
