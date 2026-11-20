import { expect, test } from '@playwright/test';

for (const core of ['native', 'js', 'rust'] as const) {
  test(`${core} clamps the negative polygon depth offset on the GPU`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const runtime = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 8;
      const attributes = { depth: true, antialias: false, preserveDrawingBuffer: true };
      const gl = core === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext
        : await createWebGLOnWebGPU(canvas, { version: 1, core, ...attributes });
      const hooks = core === 'native' ? null : getTestingHooks(gl);
      try {
        const ext = gl.getExtension('EXT_polygon_offset_clamp') as {
          polygonOffsetClampEXT(factor: number, units: number, clamp: number): void;
        };
        if (!ext) throw new Error('Missing EXT_polygon_offset_clamp');
        const program = gl.createProgram()!;
        for (const [type, source] of [
          [gl.VERTEX_SHADER, 'attribute vec3 pos; void main(){gl_Position=vec4(pos,1.0);}'],
          [gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 color; void main(){gl_FragColor=color;}'],
        ] as const) {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? '');
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        gl.useProgram(program);
        const position = gl.getAttribLocation(program, 'pos');
        const color = gl.getUniformLocation(program, 'color');
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, -1, 1, -1, 1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(position);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
        gl.depthFunc(gl.ALWAYS);
        gl.uniform4f(color, 1, 0, 0, 1);
        ext.polygonOffsetClampEXT(-canvas.width, 0, -0.25);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.depthFunc(gl.LESS);
        gl.uniform4f(color, 0, 1, 0, 1);
        ext.polygonOffsetClampEXT(-canvas.width, 0, -0.5);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        let pixels: Uint8Array;
        if (hooks) pixels = (await hooks.capture()).data;
        else {
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        }
        return { left: Array.from(pixels.slice(3 * 4, 4 * 4)), right: Array.from(pixels.slice(25 * 4, 26 * 4)),
          error: gl.getError(), gpuErrors: hooks?.errors ?? [] };
      } finally {
        await hooks?.dispose();
      }
    }, core);
    expect(result).toEqual({ left: [255, 0, 0, 255], right: [0, 255, 0, 255], error: 0, gpuErrors: [] });
  });
}

for (const core of ['js', 'rust'] as const) {
  test(`${core} reads the owned translation and discards failed compilations`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const runtime = '/packages/webgl/src/index.ts';
      const { prepareContextFactory, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const factory = await prepareContextFactory({ core });
      const gl = factory(document.createElement('canvas'));
      const peer = factory(document.createElement('canvas'));
      try {
        const ext = gl.getExtension('WEBGL_debug_shaders')!;
        const shader = gl.createShader(gl.VERTEX_SHADER)!;
        const program = gl.createProgram()!;
        gl.shaderSource(shader, 'void main(){gl_Position=vec4(1.0);}');
        gl.compileShader(shader);
        const translated = ext.getTranslatedShaderSource(shader);
        gl.shaderSource(shader, 'void main(){gl_Position=undefinedVariable;}');
        const unchanged = ext.getTranslatedShaderSource(shader) === translated;
        gl.compileShader(shader);
        const failed = ext.getTranslatedShaderSource(shader);
        gl.shaderSource(shader, 'void main(){gl_Position=vec4(1.0);}');
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
        const retained = ext.getTranslatedShaderSource(shader) === translated;
        const peerShader = peer.createShader(gl.VERTEX_SHADER)!;
        const foreign = ext.getTranslatedShaderSource(peerShader);
        return { wgsl: translated.includes('@vertex'), unchanged, failed, retained, foreign, error: gl.getError() };
      } finally {
        await getTestingHooks(gl).dispose();
        await getTestingHooks(peer).dispose();
      }
    }, core);
    expect(result).toEqual({ wgsl: true, unchanged: true, failed: '', retained: true, foreign: '', error: 0x0502 });
  });
}
