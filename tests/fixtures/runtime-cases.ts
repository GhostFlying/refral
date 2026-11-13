import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';
import type { CaseName } from './case-names';

export type Backend = 'native' | 'refral';

const vertex = 'attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }';
const fragment = 'precision mediump float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }';
const texturedVertex = 'attribute vec2 a_position; varying vec2 v_uv; void main() { gl_Position=vec4(a_position,0.0,1.0); v_uv=a_position*0.5+0.5; }';
const texturedFragment = 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_texture; void main() { gl_FragColor=texture2D(u_texture,v_uv); }';
const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export function makeProgram(gl: WebGLRenderingContext, vsSource = vertex, fsSource = fragment) {
  const shaders = [[gl.VERTEX_SHADER, vsSource], [gl.FRAGMENT_SHADER, fsSource]] as const;
  const program = gl.createProgram()!;
  for (const [stage, source] of shaders) {
    const shader = gl.createShader(stage)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  return program;
}

export function geometry(gl: WebGLRenderingContext, program: WebGLProgram, data: Float32Array = quad) {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return buffer;
}

function texture(gl: WebGLRenderingContext, width: number, height: number, data: Uint8Array | null) {
  const result = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return result;
}

async function context(backend: Backend, width = 64, height = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.appendChild(canvas);
  const attributes = { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true };
  const implementation = backend === 'refral' ? await createWebGLOnWebGPU(canvas, { version: 1, ...attributes }) : null;
  const gl = (implementation ?? canvas.getContext('webgl', attributes)) as unknown as WebGLRenderingContext;
  if (!gl) throw new Error(`Cannot create ${backend} context`);
  const hooks = implementation ? getTestingHooks(implementation) : null;
  return { gl, canvas, hooks };
}

export async function runCase(name: CaseName, backend: Backend) {
  const { gl, canvas, hooks } = await context(backend);
  const observed: Record<string, unknown> = {};
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const program = makeProgram(gl);
  const buffer = geometry(gl, program);
  let color = gl.getUniformLocation(program, 'u_color');
  const draw = (r: number, g: number, b: number, a = 1) => {
    gl.uniform4f(color, r, g, b, a);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  switch (name) {
    case 'uniform-snapshot':
      gl.viewport(0, 0, 32, 64);
      draw(1, 0, 0);
      gl.viewport(32, 0, 32, 64);
      draw(0, 1, 0);
      break;
    case 'vertex-index-update': {
      const vertices = new Float32Array([-1, -1, 0, -1, -1, 1, 0, 1]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const indices = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.DYNAMIC_DRAW);
      gl.uniform4f(color, 1, 0, 0, 1);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      for (let index = 0; index < vertices.length; index += 2) vertices[index] += 1;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array([2, 1, 3, 0, 1, 2]));
      gl.uniform4f(color, 0, 1, 0, 1);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      break;
    }
    case 'upload-snapshot': {
      const data = quad.slice();
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      data.fill(0);
      draw(0, 0, 1);
      break;
    }
    case 'storage-replacement':
      gl.viewport(0, 0, 32, 64);
      draw(1, 0, 0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...quad, 0, 0]), gl.DYNAMIC_DRAW);
      gl.viewport(32, 0, 32, 64);
      draw(0, 0, 1);
      break;
    case 'relink-and-errors': {
      const oldLocation = color;
      gl.linkProgram(program);
      observed.linked = gl.getProgramParameter(program, gl.LINK_STATUS);
      gl.uniform4f(oldLocation, 1, 0, 0, 1);
      observed.staleLocationError = gl.getError();
      color = gl.getUniformLocation(program, 'u_color');
      draw(0, 1, 0);
      const bad = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(bad, 'precision mediump float; void main() { gl_FragColor = missing; }');
      gl.compileShader(bad);
      observed.invalidShaderCompiled = gl.getShaderParameter(bad, gl.COMPILE_STATUS);
      observed.invalidShaderLogPresent = (gl.getShaderInfoLog(bad) ?? '').length > 0;
      break;
    }
    case 'masked-clear':
      gl.clearColor(0, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, 32, 64);
      gl.colorMask(true, true, false, false);
      gl.clearColor(1, 0.5, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.colorMask(true, true, true, true);
      gl.disable(gl.SCISSOR_TEST);
      break;
    case 'render-to-texture': {
      const target = texture(gl, 32, 32, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      observed.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.viewport(0, 0, 16, 32);
      draw(1, 0, 0);
      gl.viewport(16, 0, 16, 32);
      draw(0, 1, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, 64, 64);
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
    case 'resource-ownership': {
      draw(1, 0, 0);
      gl.deleteBuffer(buffer);
      observed.deletedBuffer = gl.isBuffer(buffer);
      observed.arrayBufferBindingNull = gl.getParameter(gl.ARRAY_BUFFER_BINDING) === null;
      const other = await context(backend, 2, 2);
      const foreign = other.gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, foreign);
      observed.foreignError = gl.getError();
      await other.hooks?.dispose();
      other.canvas.remove();
      break;
    }
    case 'error-state':
      gl.bindBuffer(0xdead, buffer);
      observed.invalidTarget = gl.getError();
      observed.validBindingRetained = gl.getParameter(gl.ARRAY_BUFFER_BINDING) === buffer;
      gl.viewport(0, 0, -1, 64);
      observed.invalidViewport = gl.getError();
      draw(0, 1, 1);
      break;
    case 'automatic-submit':
      draw(1, 0, 0);
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => { draw(0, 1, 0); resolve(); }));
      await Promise.resolve();
      observed.automaticSubmitted = hooks ? hooks.stats.submits > 0 : true;
      gl.flush();
      break;
    case 'texture-orientation': {
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
      texture(gl, 2, 2, data);
      data.fill(0);
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
    case 'depth-blend': {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      draw(0, 0, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      draw(1, 0, 0, 0.5);
      break;
    }
    case 'texture-reallocation': {
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      texture(gl, 2, 2, new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      gl.viewport(0, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.viewport(32, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
    case 'resize-framebuffer': {
      const target = texture(gl, 16, 16, null);
      const fb = gl.createFramebuffer()!;
      const depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 16, 16);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      observed.initialComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.viewport(0, 0, 16, 16);
      draw(1, 0, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      observed.mismatchedAttachments = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 32, 32);
      observed.resizedComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.viewport(0, 0, 32, 32);
      draw(0, 1, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      canvas.width = 96;
      canvas.height = 48;
      gl.viewport(0, 0, 96, 48);
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      observed.width = gl.drawingBufferWidth;
      observed.height = gl.drawingBufferHeight;
      break;
    }
    case 'constant-alpha-blend':
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 0.5);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ZERO);
      draw(1, 0, 0);
      break;
    case 'zero-initialized-rgb': {
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      gl.clearColor(0, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      texture(gl, 1, 1, null);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
      gl.viewport(0, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
      gl.viewport(32, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
    case 'index-format-cache': {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1]), gl.STATIC_DRAW);
      const indices = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 0, 1, 0, 2, 0]), gl.STATIC_DRAW);
      gl.uniform4f(color, 1, 0, 0, 1);
      gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_BYTE, 0);
      gl.uniform4f(color, 0, 1, 0, 1);
      gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
      break;
    }
    case 'texture-subimage-snapshot': {
      const sampling = makeProgram(gl, texturedVertex, texturedFragment);
      geometry(gl, sampling);
      texture(gl, 2, 2, new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(sampling, 'u_texture'), 0);
      gl.viewport(0, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const update = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, update);
      update.fill(0);
      gl.viewport(32, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
  }
  observed.finalError = gl.getError();
  gl.flush();
  let image: { width: number; height: number; data: Uint8Array };
  if (hooks) {
    image = await hooks.capture();
  } else {
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    image = { width: canvas.width, height: canvas.height, data };
  }
  const stats = hooks ? { ...hooks.stats } : null;
  const validationErrors = hooks ? [...hooks.errors] : [];
  await hooks?.dispose();
  if (!hooks) gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
  return { name, backend, observed, width: image.width, height: image.height, pixels: Array.from(image.data), stats, validationErrors };
}
