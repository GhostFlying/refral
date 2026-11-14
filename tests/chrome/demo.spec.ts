import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

interface Frame {
  time: number; width: number; height: number; pixels: number[]; error: number; validationErrors: string[];
}
interface DemoResult {
  backend: 'native' | 'js' | 'rust'; selectedCore: string | null; frames: Frame[];
  environment: Record<string, unknown>; shaders: Record<string, string>; failure: string | null;
}

function image(frame: Frame, pixels = frame.pixels) {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let row = 0; row < frame.height; row++) {
    png.data.set(pixels.slice(row * frame.width * 4, (row + 1) * frame.width * 4),
      (frame.height - 1 - row) * frame.width * 4);
  }
  return PNG.sync.write(png);
}

function compare(reference: Frame, candidate: Frame, channelTolerance: number, edgeRadius: number) {
  let differingPixels = 0; let unmatchedPixels = 0; let maxDifference = 0;
  const pixels = new Array<number>(candidate.pixels.length).fill(0);
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < reference.width; x++) {
      const index = (y * reference.width + x) * 4;
      const matches = (otherX: number, otherY: number) => {
        if (otherX < 0 || otherY < 0 || otherX >= reference.width || otherY >= reference.height) return false;
        const otherIndex = (otherY * reference.width + otherX) * 4;
        return [0, 1, 2, 3].every(channel =>
          Math.abs(reference.pixels[otherIndex + channel]! - candidate.pixels[index + channel]!) <= channelTolerance);
      };
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(reference.pixels[index + channel]! - candidate.pixels[index + channel]!);
        maxDifference = Math.max(maxDifference, difference);
        pixels[index + channel] = channel === 3 ? 255 : difference;
      }
      if (matches(x, y)) continue;
      differingPixels++;
      let nearby = false;
      for (let dy = -edgeRadius; dy <= edgeRadius; dy++) {
        for (let dx = -edgeRadius; dx <= edgeRadius; dx++) nearby ||= matches(x + dx, y + dy);
      }
      if (!nearby) unmatchedPixels++;
    }
  }
  return { differingPixels, unmatchedPixels, maxDifference, pixels };
}

test('pinned render-to-texture demo renders sequential frames through three backends', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results: DemoResult[] = [];
  for (const backend of ['native', 'js', 'rust'] as const) {
    results.push(await page.evaluate(async backend => {
      const path = '/examples/render-to-texture.ts';
      const { prepareDemo } = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      canvas.style.width = '320px'; canvas.style.height = '240px';
      document.body.append(canvas);
      try {
        const scene = await prepareDemo(canvas, backend);
        try {
          const frames: Frame[] = [];
          for (const time of [0, 1000, 2000]) {
            scene.frame(time); scene.gl.flush();
            const captured = await scene.capture();
            frames.push({ time, width: captured.width, height: captured.height,
              pixels: Array.from(captured.data as Uint8Array), error: scene.gl.getError(),
              validationErrors: [...scene.hooks?.errors ?? []] });
          }
          return { backend, selectedCore: scene.selectedCore, environment: scene.environment,
            shaders: scene.shaders, frames, failure: null };
        } finally { await scene.dispose(); }
      } catch (error) {
        return { backend, selectedCore: null, environment: {}, shaders: {}, frames: [],
          failure: error instanceof Error ? error.name + ': ' + error.message : String(error) };
      } finally { canvas.remove(); }
    }, backend));
  }
  await mkdir('artifacts/demo', { recursive: true });
  const comparisons = [];
  for (const result of results) {
    for (const frame of result.frames) {
      const bytes = image(frame);
      await writeFile('artifacts/demo/' + result.backend + '-' + frame.time + '.png', bytes);
      if (frame.time === 1000) {
        await writeFile('artifacts/demo/' + (result.backend === 'js' ? 'refral' : result.backend) + '.png', bytes);
      }
    }
  }
  for (const time of [0, 1000, 2000]) {
    const native = results[0]!.frames.find(frame => frame.time === time);
    const js = results[1]!.frames.find(frame => frame.time === time);
    const rust = results[2]!.frames.find(frame => frame.time === time);
    if (!native || !js || !rust) continue;
    for (const [label, reference, candidate, tolerance, edge] of [
      ['js-native', native, js, 2, 1], ['rust-native', native, rust, 2, 1], ['rust-js', js, rust, 0, 0],
    ] as const) {
      const difference = compare(reference, candidate, tolerance, edge);
      comparisons.push({ time, pair: label, channelTolerance: tolerance, edgeRadius: edge,
        differingPixels: difference.differingPixels, unmatchedPixels: difference.unmatchedPixels,
        maxDifference: difference.maxDifference });
      await writeFile('artifacts/demo/' + label + '-' + time + '-diff.png', image(candidate, difference.pixels));
    }
  }
  const hashes: Record<string, string> = {};
  for (const [name, path] of [['rust', 'artifacts/core-wasm/refral_core.wasm'],
    ['compiler', 'artifacts/compiler/compiler.wasm'], ['demoAdapter', 'artifacts/fixtures/render-to-texture.mjs']] as const) {
    hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  await writeFile('artifacts/demo/result.json', JSON.stringify({ browserVersion: browser.version(), hashes,
    demoRevision: fixtures.demo.revision, configuration: { width: 320, height: 240, dpr: 1, times: [0, 1000, 2000],
      contextReuse: 'one prepared instance per backend across all three times' },
    comparisons, results,
  }, null, 2) + '\n');
  for (const result of results) {
    expect(result.failure, result.backend).toBeNull();
    expect(result.selectedCore).toBe(result.backend);
    expect(result.environment.devicePixelRatio).toBe(1);
    expect(result.environment.attributes).toMatchObject({ alpha: false, depth: true, stencil: false,
      antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    expect(result.frames).toHaveLength(3);
    for (const frame of result.frames) {
      expect([frame.width, frame.height]).toEqual([320, 240]);
      expect(frame.error).toBe(0); expect(frame.validationErrors).toEqual([]);
    }
  }
  expect(comparisons).toHaveLength(9);
  for (const result of comparisons) {
    expect(result.unmatchedPixels, result.pair + ' time ' + result.time).toBe(0);
    if (result.pair === 'rust-js') expect(result.differingPixels).toBe(0);
  }
});

for (const backend of ['refral', 'rust'] as const) {
  test('demo backend control produces an actual ' + backend + ' frame', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/examples/index.html');
    await page.getByLabel('Demo backend').selectOption(backend);
    await page.getByRole('button', { name: 'Render to texture', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Passed');
    const report = JSON.parse(await page.locator('#report').innerText());
    expect(report.backend).toBe(backend);
    expect(report.selectedCore).toBe(backend === 'refral' ? 'js' : 'rust');
    expect(report.error).toBe(0); expect(report.nonWhitePixels).toBeGreaterThan(100);
    expect(report.nativeReference.error).toBe(0);
    expect(report.nativeReference.nonWhitePixels).toBeGreaterThan(100);
    expect(errors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    await mkdir('artifacts/demo', { recursive: true });
    await page.screenshot({ path: 'artifacts/demo/chrome-demo-' + backend + '.png' });
  });
}
