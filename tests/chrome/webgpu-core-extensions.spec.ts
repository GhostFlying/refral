import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} preserves wide element indices across WebGPU primitive paths`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const runtime = '/packages/webgl/src/index.ts';
      const { prepareContextFactory, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const factory = await prepareContextFactory({ core });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const gl = factory(canvas);
      try {
        function shader(type: number, source: string) {
          const object = gl.createShader(type)!;
          gl.shaderSource(object, source);
          gl.compileShader(object);
          if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(object) ?? '');
          return object;
        }
        const program = gl.createProgram()!;
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 pos; void main() { gl_Position = vec4(pos, 0.0, 1.0); gl_PointSize = 4.0; }'));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }'));
        gl.linkProgram(program);
        gl.useProgram(program);
        const position = gl.getAttribLocation(program, 'pos');
        const vertices = new Float32Array(65540 * 2);
        vertices.fill(2);
        vertices.set([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 65536 * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(position);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0xffffffff, 65536, 65537, 65538, 65539]), gl.STATIC_DRAW);
        gl.drawElements(gl.POINTS, 1, gl.UNSIGNED_INT, 4);
        const disabled = gl.getError();
        const enabled = !!gl.getExtension('OES_element_index_uint');
        const pixels = [];
        for (const mode of [gl.POINTS, gl.LINE_LOOP, gl.TRIANGLE_FAN, gl.LINE_STRIP]) {
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawElements(mode, 4, gl.UNSIGNED_INT, 4);
          const capture = await getTestingHooks(gl).capture();
          pixels.push({ error: gl.getError(), colored: capture.data.some((value, index) => index % 4 === 1 && value === 255) });
        }
        gl.drawElements(gl.POINTS, 1, gl.UNSIGNED_INT, 0);
        const outOfRange = gl.getError();
        gl.disableVertexAttribArray(position);
        gl.vertexAttrib2f(position, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.POINTS, 1, gl.UNSIGNED_INT, 0);
        const constantOnly = await getTestingHooks(gl).capture();
        return { disabled, enabled, pixels, outOfRange, constantOnly: constantOnly.data[(8 * 16 + 8) * 4 + 1],
          finalError: gl.getError(), gpuErrors: getTestingHooks(gl).errors };
      } finally { await factory.dispose(); }
    }, core);
    expect(result).toEqual({ disabled: 0x0500, enabled: true,
      pixels: Array.from({ length: 4 }, () => ({ error: 0, colored: true })),
      outOfRange: 0x0502, constantOnly: 255, finalError: 0, gpuErrors: [] });
  });
}
