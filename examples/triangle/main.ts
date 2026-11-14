import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

const vertex = `attribute vec2 a_position;
attribute vec3 a_color;
varying vec3 v_color;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_color = a_color; }`;
const fragment = `precision mediump float;
varying vec3 v_color;
uniform vec4 u_tint;
void main() { gl_FragColor = vec4(v_color, 1.0) * u_tint; }`;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const requested = new URL(location.href).searchParams.get('core') ?? 'js';

declare global {
  interface Window {
    refralTriangle?: { core: string; selectedCore: string; ready: boolean; width: number; height: number };
  }
}

async function main() {
  if (requested !== 'native' && requested !== 'js' && requested !== 'rust') throw new Error(`Unknown core ${requested}`);
  status.textContent = `${requested} · initializing`;
  const attributes: WebGLContextAttributes = {
    alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true,
  };
  const gl = requested === 'native' ? canvas.getContext('webgl', attributes)
    : await createWebGLOnWebGPU(canvas, { version: 1, core: requested, attributes });
  if (!gl) throw new Error('WebGL context creation failed');
  const hooks = requested === 'native' ? null : getTestingHooks(gl);
  const selectedCore = hooks?.core ?? 'native';
  if (selectedCore !== requested) throw new Error(`Requested ${requested}, received ${selectedCore}`);
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.bindAttribLocation(program, 1, 'a_color');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.8, -0.75, 1, 0, 0,
    0.8, -0.75, 0, 1, 0,
    0, 0.8, 0, 0, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
  gl.uniform4f(gl.getUniformLocation(program, 'u_tint'), 1, 1, 1, 1);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.03, 0.04, 0.06, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.flush();
  if (gl.getError() !== gl.NO_ERROR) throw new Error('Triangle draw reported a GL error');
  if (hooks) {
    await hooks.device.queue.onSubmittedWorkDone();
    if (hooks.errors.length) throw new Error(hooks.errors.join('\n'));
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  window.refralTriangle = { core: requested, selectedCore, ready: true, width: canvas.width, height: canvas.height };
  status.textContent = `${selectedCore} · rendered`;
  window.addEventListener('pagehide', () => {
    if (hooks) void hooks.dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  }, { once: true });
}

main().catch(error => {
  status.textContent = `${requested} · ${error instanceof Error ? error.message : String(error)}`;
  status.dataset.state = 'error';
});
