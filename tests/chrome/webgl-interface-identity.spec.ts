import { expect, test } from '@playwright/test';
import type { prepareRttContext } from '../fixtures/rtt-cases';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`webgl object prototypes and handle ownership on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const url = '/tests/fixtures/rtt-cases.ts';
      const fixture = await import(/* @vite-ignore */ url) as { prepareRttContext: typeof prepareRttContext };
      const { gl, selectedCore, dispose } = await fixture.prepareRttContext(backend);
      try {
        const owned = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, owned);
        const protoOnly: WebGLBuffer = Object.create(WebGLBuffer.prototype);
        let forgedRejected = false;
        try { gl.bindBuffer(gl.ARRAY_BUFFER, protoOnly); } catch (error) { forgedRejected = error instanceof TypeError; }
        const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)!;
        const value = precision.precision;
        const readOnly = !Reflect.set(precision, 'precision', value + 1);
        Object.preventExtensions(gl);
        return { selectedCore, context: gl instanceof WebGLRenderingContext, buffer: owned instanceof WebGLBuffer,
          binding: owned === gl.getParameter(gl.ARRAY_BUFFER_BINDING), forgedRejected,
          record: precision instanceof WebGLShaderPrecisionFormat, readOnly, retained: precision.precision === value,
          error: gl.getError() };
      } finally { await dispose(); }
    }, backend);
    expect(result).toEqual({ selectedCore: backend, context: true, buffer: true, binding: true,
      forgedRejected: true, record: true, readOnly: true, retained: true, error: 0 });
  });
}
