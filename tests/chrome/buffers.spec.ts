import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { BufferBackend, BufferEvidence } from '../core/buffer-fixtures';

const backends: BufferBackend[] = ['native', 'js', 'rust'];

async function save(name: string, value: unknown, browserVersion: string) {
  const directory = 'artifacts/buffers';
  await mkdir(directory, { recursive: true });
  const { channel, headless, deviceScaleFactor, viewport, launchOptions } = test.info().project.use;
  const configuration = { channel, headless, deviceScaleFactor, viewport, launchOptions: launchOptions ?? {} };
  await writeFile(`${directory}/${name}.json`, JSON.stringify({ browserVersion, configuration, result: value }, null, 2) + '\n');
}

function expectPass(evidence: BufferEvidence, label: string) {
  expect(evidence.checks.filter(check => !check.passed), label).toEqual([]);
}

test('shared native, JS and Rust public Buffer fixtures', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results: { backend: BufferBackend; evidence: BufferEvidence }[] = [];
  for (const backend of backends) {
    const result = await page.evaluate(async backend => {
      const path = '/tests/core/buffer-browser.ts';
      const { runBrowserBufferFixture } = await import(/* @vite-ignore */ path);
      return runBrowserBufferFixture(backend);
    }, backend);
    await save(`public-${backend}`, result, browser.version());
    results.push(result);
  }
  for (const result of results) expectPass(result.evidence, `${result.backend} public Buffer checks`);
  const native = results[0]!.evidence.checks;
  for (const result of results.slice(1)) {
    const common = result.evidence.checks.filter(check => native.some(reference => reference.name === check.name));
    expect(common, `${result.backend} public observations match native`).toEqual(native);
  }
  expect(results[2]!.evidence.snapshots, 'Rust and JS bytes and version metadata').toEqual(results[1]!.evidence.snapshots);
});

test('foreign buffers are rejected across JS and Rust cores', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/tests/core/buffer-browser.ts';
    const { runCrossCoreBufferFixture } = await import(/* @vite-ignore */ path);
    return runCrossCoreBufferFixture();
  });
  await save('cross-core', result, browser.version());
  expectPass(result.evidence, 'cross-core Buffer ownership');
});

for (const backend of ['js', 'rust'] as const) {
  test(`${backend} shared logical Buffer contract`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const path = '/tests/core/buffer-browser.ts';
      const { runBrowserBufferContract } = await import(/* @vite-ignore */ path);
      return runBrowserBufferContract(backend);
    }, backend);
    await save(`contract-${backend}`, result, browser.version());
    expect(result.core).toBe(backend);
    expectPass(result.evidence, `${backend} logical handle contract`);
  });
}

for (const backend of backends) {
  test(`${backend} Buffer context loss`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const path = '/tests/core/buffer-browser.ts';
      const { runBufferLossFixture } = await import(/* @vite-ignore */ path);
      return runBufferLossFixture(backend);
    }, backend);
    await save(`loss-${backend}`, result, browser.version());
    expectPass(result.evidence, `${backend} context loss`);
  });
}
