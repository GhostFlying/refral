import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import type { probeOwnWorker, probeSharedReadback } from './browser';
import type { probeAgent } from './primitives';

let commandLine = '';
let source: { head: string; treeSha256: string };
let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});
test.beforeAll(async ({ browser }) => {
  execFileSync(process.execPath, ['tools/snapshot.mjs']);
  const bytes = await readFile('artifacts/environment/source.json', 'utf8');
  const snapshot = JSON.parse(bytes);
  source = { head: snapshot.head, treeSha256: snapshot.treeSha256 };
  await mkdir('artifacts/readback', { recursive: true });
  await writeFile('artifacts/readback/source.json', bytes);
  const session = await browser.newBrowserCDPSession();
  try {
    const processes = (await session.send('SystemInfo.getProcessInfo')).processInfo;
    const browserProcess = processes.find((value) => value.type === 'browser');
    if (!browserProcess) throw new Error('Chrome process metadata is unavailable.');
    commandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='], {
      encoding: 'utf8',
    }).trim();
  } finally {
    await session.detach();
  }
});

async function save(name: string, browserVersion: string, result: unknown) {
  await mkdir('artifacts/readback', { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, path] of [
    ['rust', 'artifacts/core-wasm/refral_core.wasm'],
    ['compiler', 'artifacts/compiler/compiler.wasm'],
  ] as const) {
    hashes[name] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  }
  await writeFile(
    `artifacts/readback/${name}.json`,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        browserVersion,
        launch: { channel: 'chrome', headless: process.env.REFRAL_HEADLESS !== '0', commandLine },
        machine: { platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model },
        source,
        hashes,
        result,
      },
      null,
      2
    ) + '\n'
  );
}

for (const isolated of [false, true]) {
  test(`Window completion and wait primitives isolated=${isolated}`, async ({ page, browser }) => {
    await page.goto(`http://127.0.0.1:${isolated ? 4176 : 4175}/tests/fixtures/runner.html`);
    const result: Awaited<ReturnType<typeof probeAgent>> = await page.evaluate(async () => {
      const path = '/experiments/readback/browser.ts';
      const module = await import(/* @vite-ignore */ path);
      return module.probeAgent('spin');
    });
    await save(`window-${isolated}`, browser.version(), result);
    expect(result.crossOriginIsolated).toBe(isolated);
    expect(result.sharedArrayBuffer).toBe(isolated);
    if (isolated) expect(result.wasmSharedBufferClone).toBe('shared');
    else expect(result.wasmSharedBufferClone).not.toBe('shared');
    expect(result.waitResult).toBe(isolated ? 'TypeError' : 'SharedArrayBuffer unavailable');
    expect(result.duringTask.callbackRan).toBe(false);
    expect(result.duringTask.mapState).toBe('pending');
    expect(result.duringTask.mappedRangeResult).toBe('OperationError');
    expect(result.afterYield.values).toEqual([17, 31, 127, 255]);
  });
}

test('waiting GPU-owner worker requires its event loop to finish mapping', async ({ page, browser }) => {
  await page.goto('http://127.0.0.1:4176/tests/fixtures/runner.html');
  const result: Awaited<ReturnType<typeof probeOwnWorker>> = await page.evaluate(async () => {
    const path = '/experiments/readback/browser.ts';
    const module = await import(/* @vite-ignore */ path);
    return module.probeOwnWorker();
  });
  await save('worker-owned-gpu', browser.version(), result);
  expect(result.scope).toBe('worker');
  expect(result.waitResult).toBe('timed-out');
  expect(result.mappingWaitResult).toBe('timed-out');
  expect(result.duringTask.callbackRan).toBe(false);
  expect(result.duringTask.mapState).toBe('pending');
  expect(result.afterYield.values).toEqual([17, 31, 127, 255]);
});

for (const caller of ['window', 'worker'] as const) {
  for (const core of ['js', 'rust'] as const) {
    test(`${caller} ${core} synchronous experimental readback`, async ({ page, browser }) => {
      await page.goto('http://127.0.0.1:4176/tests/fixtures/runner.html');
      const result: Awaited<ReturnType<typeof probeSharedReadback>> = await page.evaluate(
        async ({ caller, core }) => {
          const path = '/experiments/readback/browser.ts';
          const module = await import(/* @vite-ignore */ path);
          return module.probeSharedReadback(core, caller);
        },
        { caller, core }
      );
      await save(`${caller}-${core}`, browser.version(), result);
      const value = result.result;
      expect(value.selectedCore).toBe(core);
      const samples = value.samples as { mismatchedChannels: number; sequence: number; roundTripMs: number }[];
      expect(samples).toHaveLength(32);
      expect(samples.every((sample) => sample.mismatchedChannels === 0 && sample.roundTripMs > 0)).toBe(true);
      expect(samples.map((sample) => sample.sequence)).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
      expect(value.failure).toContain('Injected worker readback failure');
      expect(value.timeout).toContain('Synchronous readback timed out');
      expect(value.recovered).toMatchObject({ mismatchedChannels: 0, sequence: 34 });
      expect(value.sameAgentTimerRanDuringCalls).toBe(false);
      if (caller === 'worker') {
        expect((value as Record<string, unknown>).waitProbe).toBe('timed-out');
        expect(result.timerTicksDuringSyncSequence).toBeGreaterThan(0);
      } else expect(result.timerTicksDuringSyncSequence).toBe(0);
    });
  }
}
