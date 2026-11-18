import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} samples full float and normalized textures through one program`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async selected => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      const gl = await createWebGLOnWebGPU(canvas, { version: 1, core: selected });
      const hooks = getTestingHooks(gl);
      try {
        const extension = gl.getExtension('OES_texture_float');
        const program = gl.createProgram()!;
        const attach = (type: number, source: string) => {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
          gl.attachShader(program, shader);
        };
        attach(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }');
        attach(gl.FRAGMENT_SHADER, `precision highp float;
          uniform sampler2D flatTexture;
          uniform samplerCube cubeTexture;
          void main(){
            float a = texture2D(flatTexture, vec2(.5)).r;
            float b = textureCube(cubeTexture, vec3(1.,0.,0.)).r;
            gl_FragColor = vec4(a < -3.24 && a > -3.26 ? 1. : 0.,
              b > 10000.12 && b < 10000.13 ? 1. : 0., b > .3 && b < .4 ? 1. : 0., 1.);
          }`);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'p');
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(position);
        gl.uniform1i(gl.getUniformLocation(program, 'cubeTexture'), 1);
        const allocate = (unit: number, target: number) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(target, gl.createTexture());
          gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        };
        const fillCube = (type: number, source: Float32Array | Uint8Array) => {
          for (let i = 0; i < 6; i++)
            gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.LUMINANCE, 2, 2, 0, gl.LUMINANCE, type, source);
          gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
          gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        };
        const draw = () => {
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const pixel = new Uint8Array(4);
          gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return [...pixel];
        };
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        allocate(0, gl.TEXTURE_2D);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([128]));
        allocate(1, gl.TEXTURE_CUBE_MAP);
        fillCube(gl.FLOAT, new Float32Array(4).fill(10000.125));
        const cubeFloat = draw();
        fillCube(gl.UNSIGNED_BYTE, new Uint8Array(4).fill(90));
        gl.activeTexture(gl.TEXTURE0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.FLOAT, null);
        const input = new Float32Array([-3.25]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.LUMINANCE, gl.FLOAT, input);
        input.fill(0);
        const flatFloat = draw();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const incomplete = draw();
        await gl.flush();
        return { core: hooks.core, extension: !!extension, sameExtension: extension === gl.getExtension('oes_texture_float'),
          cubeFloat, flatFloat, incomplete, error: gl.getError(), diagnostics: [...hooks.errors] };
      } finally { await hooks.dispose(); }
    }, core);
    expect(result).toEqual({ core, extension: true, sameExtension: true, cubeFloat: [0,255,0,255],
      flatFloat: [255,0,255,255], incomplete: [0,0,255,255], error: 0, diagnostics: [] });
  });
}
