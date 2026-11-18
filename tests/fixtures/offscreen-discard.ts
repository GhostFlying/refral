import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

export type Backend = 'native' | 'js' | 'rust';
export type Scenario = 'color' | 'depth' | 'stencil';

async function frames() {
  for (let frame = 0; frame < 6; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
}

function fullscreen(gl: WebGLRenderingContext) {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'],
    [gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ gl_FragColor = vec4(0.,1.,0.,1.); }'],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link failed.');
  gl.useProgram(program);
  const p = gl.getAttribLocation(program, 'p');
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
}

export async function runDiscardCase(canvas: OffscreenCanvas, backend: Backend, scenario: Scenario,
  capture: (step: string) => Promise<void>) {
  const attributes = { alpha: true, antialias: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, depth: true, stencil: true };
  const gl = backend === 'native' ? canvas.getContext('webgl', attributes)
    : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
  if (!gl) throw new Error('Missing WebGL context.');
  const hooks = backend === 'native' ? null : getTestingHooks(gl);
  const read = () => {
    const bytes = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  };
  const probes = () => hooks?.stats.offscreenDiscardProbes ?? 0;
  try {
    let first: number[] = [], after: number[] = [], second: number[] = [], final: number[] = [];
    let emptyProbes = 0;
    fullscreen(gl);
    if (scenario === 'color') {
      gl.clearColor(1, 0.5, 0.25, 0);
      for (let i = 0; i < 8; i++) {
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      first = read();
      emptyProbes = probes();
      await frames();
      after = read();
      gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      second = read();
      await frames();
      await capture('before');
      final = read();
      await frames();
      await capture('after');
    } else {
      // A masked clear and an FBO write must not publish the default target.
      gl.depthMask(false); gl.stencilMask(0);
      gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      await frames();
      first = read();
      emptyProbes = probes();
      gl.depthMask(true); gl.stencilMask(255);
      gl.clearDepth(0.25); gl.clearStencil(7);
      gl.clear(scenario === 'depth' ? gl.DEPTH_BUFFER_BIT : gl.STENCIL_BUFFER_BIT);
      await frames();
      if (scenario === 'depth') { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.GREATER); }
      else { gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 7, 255); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      after = read();
    }
    if (hooks) await hooks.device.queue.onSubmittedWorkDone();
    return { core: hooks?.core ?? 'native', scenario, first, after, second, final, emptyProbes,
      probes: probes(), discards: hooks?.stats.offscreenDiscards ?? 0,
      indeterminate: hooks?.stats.offscreenDiscardIndeterminate ?? 0, glError: gl.getError(), errors: hooks?.errors ?? [] };
  } finally {
    if (hooks) await hooks.dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
