import { expect, test } from '@playwright/test';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`${backend} blends and reads sRGB attachments in their specified color space`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async selected => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      const created = selected === 'native' ? null : await createWebGLOnWebGPU(canvas, { version: 1, core: selected });
      const gl: WebGLRenderingContext = created ?? canvas.getContext('webgl', { antialias: false })!;
      const hooks = created ? getTestingHooks(created) : null;
      try {
        const ext = gl.getExtension('EXT_sRGB')!;
        const program = (fragment: string) => {
          const program = gl.createProgram()!;
          for (const [stage, source] of [[gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'],
            [gl.FRAGMENT_SHADER, fragment]] as const) {
            const shader = gl.createShader(stage)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
            gl.attachShader(program, shader);
          }
          gl.bindAttribLocation(program, 0, 'p');
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
          return program;
        };
        const solid = program('void main(){gl_FragColor=vec4(.25);}');
        const sample = program('precision highp float; uniform sampler2D t; void main(){gl_FragColor=texture2D(t,vec2(.5));}');
        const pixels = () => {
          const bytes = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return [...bytes];
        };
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, ext.SRGB_ALPHA_EXT, 4, 4, 0, ext.SRGB_ALPHA_EXT, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.clearColor(.25, .25, .25, .5);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const clear = pixels();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.colorMask(true, false, true, true);
        gl.useProgram(solid);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const blend = pixels();
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(sample);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return { core: hooks?.core ?? 'native', clear, blend, sample: pixels(), error: gl.getError(),
          diagnostics: [...(hooks?.errors ?? [])] };
      } finally { if (hooks) await hooks.dispose(); }
    }, backend);
    expect(result.core).toBe(backend);
    expect(result.error).toBe(0);
    expect(result.diagnostics).toEqual([]);
    for (const [actual, expected] of [[result.clear, [137,137,137,128]], [result.blend, [188,137,188,192]],
      [result.sample, [128,64,128,192]]] as const) {
      for (let i = 0; i < 4; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(2);
    }
  });
}
