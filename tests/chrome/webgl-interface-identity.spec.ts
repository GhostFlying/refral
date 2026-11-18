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
        const peer = await fixture.prepareRttContext(backend, 16, 16, true);
        const methods = Object.getPrototypeOf(gl) as WebGLRenderingContext;
        let receiverOK = false;
        let invalidReceiver = false;
        let formats: number[];
        try {
          const viaPrototype = methods.createBuffer.call(peer.gl);
          methods.bindBuffer.call(peer.gl, peer.gl.ARRAY_BUFFER, viaPrototype);
          receiverOK = methods.getParameter.call(peer.gl, peer.gl.ARRAY_BUFFER_BINDING) === viaPrototype
            && gl.getParameter(gl.ARRAY_BUFFER_BINDING) === owned;
          try { methods.getError.call(Object.create(methods)); } catch (error) { invalidReceiver = error instanceof TypeError; }
          formats = [Reflect.get(gl, 'drawingBufferFormat'), Reflect.get(peer.gl, 'drawingBufferFormat')];
        } finally { await peer.dispose(); }
        Object.preventExtensions(gl);
        return { selectedCore, receiverOK, invalidReceiver, formats, context: gl instanceof WebGLRenderingContext, buffer: owned instanceof WebGLBuffer,
          binding: owned === gl.getParameter(gl.ARRAY_BUFFER_BINDING), forgedRejected,
          record: precision instanceof WebGLShaderPrecisionFormat, readOnly, retained: precision.precision === value,
          error: gl.getError() };
      } finally { await dispose(); }
    }, backend);
    expect(result).toEqual({ selectedCore: backend, receiverOK: true, invalidReceiver: true, formats: [0x8051, 0x8058], context: true, buffer: true, binding: true,
      forgedRejected: true, record: true, readOnly: true, retained: true, error: 0 });
  });
}
