import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('AllowSharedBufferSource and numeric overloads agree across native, JS and Rust', async ({ page, browser }) => {
  await page.route('**/tests/fixtures/runner.html', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(),
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } });
  });
  await page.goto('/tests/fixtures/runner.html');
  const results = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
    if (!crossOriginIsolated) throw new Error('Shared source fixture requires cross-origin isolation.');
    const results = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      const canvas = document.createElement('canvas');
      const gl = backend === 'native' ? canvas.getContext('webgl')!
        : await createWebGLOnWebGPU(canvas, { version: 1, core: backend });
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const checks: { name: string; error: number; exception: string | null; size: unknown }[] = [];
      const call = (name: string, source: unknown, expectedSize: number, expectedException: string | null = null) => {
        let exception = null;
        try { gl.bufferData(gl.ARRAY_BUFFER, source as number, gl.STATIC_DRAW); }
        catch (error) { exception = (error as Error).name; }
        const error = gl.getError();
        const size = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
        checks.push({ name, error, exception, size });
        if (error !== 0 || size !== expectedSize || exception !== expectedException) {
          throw new Error(`${backend}/${name}: ${JSON.stringify(checks.at(-1))}`);
        }
      };
      try {
        call('number object', new Number(3), 3);
        call('valueOf object', { valueOf: () => 5 }, 5);
        call('function', function () {}, 0);
        call('shared storage', new SharedArrayBuffer(6), 6);
        const shared = new SharedArrayBuffer(6);
        new Uint8Array(shared).set([9, 1, 2, 3, 4, 8]);
        call('shared source view', new DataView(shared, 1, 4), 4);
        new Uint8Array(shared).fill(0);
        if (backend !== 'native') {
          const bytes = getTestingHooks(gl).inspectBuffer(buffer)!.data;
          if (Array.from(bytes).join() !== '1,2,3,4') throw new Error('Shared source was not consumed before return.');
        }
        const resized = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
        const grown = Reflect.construct(SharedArrayBuffer, [4, { maxByteLength: 8 }]) as SharedArrayBuffer;
        call('resizable storage', resized, 4, 'TypeError');
        call('resizable source view', new Uint8Array(resized), 4, 'TypeError');
        call('growable shared storage', grown, 4, 'TypeError');
        const shadowed = new Uint8Array([7, 6, 5]);
        Object.defineProperties(shadowed, { byteLength: { value: 99 }, byteOffset: { value: 99 }, buffer: { value: new ArrayBuffer(1) } });
        call('view internal slots', shadowed, 3);
        results.push({ backend, checks });
      } finally {
        if (backend === 'native') gl.getExtension('WEBGL_lose_context')?.loseContext();
        else await getTestingHooks(gl).dispose();
      }
    }
    return results;
  });
  await mkdir('artifacts/buffers', { recursive: true });
  await writeFile('artifacts/buffers/sources.json', JSON.stringify({ browser: browser.version(), results }, null, 2) + '\n');
  expect(results[1]!.checks).toEqual(results[0]!.checks);
  expect(results[2]!.checks).toEqual(results[0]!.checks);
});
