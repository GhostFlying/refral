import type { TestingHooks } from '@refral/webgl';
import type { DrawingBackend, DrawingCheck } from './dual-core-cases';

export const uniformRttCases = ['uniform-matrix-arrays', 'uniform-int-bool-arrays', 'uniform-non-current-relink'] as const;
export const textureRttCases = ['texture-format-rgba', 'texture-format-rgb', 'texture-format-alpha',
  'texture-format-luminance', 'texture-format-luminance-alpha', 'texture-unpack-snapshot',
  'texture-packed-565', 'texture-packed-4444', 'texture-packed-5551', 'texture-packed-cube',
  'texture-manual-mip-2d', 'texture-manual-mip-cube', 'texture-generate-mip-from-fbo',
  'texture-updates-reallocation', 'texture-npot-completeness', 'texture-sampler-units', 'texture-invalid-state'] as const;
export const framebufferRttCases = ['fbo-depth-render-sample', 'fbo-cube-face-render-sample', 'fbo-attachment-resize',
  'fbo-deletion-bound-unbound', 'fbo-feedback-loop', 'raster-masks-depth-blend-cull',
  'resources-multiple-contexts', 'canvas-resize-present'] as const;
export const rttCaseNames = [...uniformRttCases, ...textureRttCases, ...framebufferRttCases] as const;
export type RttCaseName = typeof rttCaseNames[number];
export interface RttRegion { x: number; y: number; width: number; height: number; color: number[]; tolerance: number }
export interface RttResult {
  name: RttCaseName; backend: DrawingBackend; selectedCore: DrawingBackend | null;
  checks: DrawingCheck[]; observations: Record<string, unknown>; regions: RttRegion[];
  shaders: Record<string, string>; environment: Record<string, unknown>;
  width: number; height: number; pixels: number[];
  failure: { name: string; message: string } | null; validationErrors: string[]; cleanupErrors: string[];
}

export const rttVertex = 'attribute vec2 a_position; varying vec2 v_uv; uniform float u_z; void main(){gl_Position=vec4(a_position,u_z,1.0);v_uv=a_position*0.5+0.5;}';
export const rttColorFragment = 'precision mediump float; uniform vec4 u_color; void main(){gl_FragColor=u_color;}';
export const rttTextureFragment = 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_texture; void main(){gl_FragColor=texture2D(u_texture,v_uv);}';
const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
const identity4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export async function prepareRttContext(backend: DrawingBackend, width = 64, height = 64, alpha = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  document.body.append(canvas);
  const attributes: WebGLContextAttributes = { alpha, depth: true, stencil: false, antialias: false,
    premultipliedAlpha: true, preserveDrawingBuffer: true };
  let gl: WebGLRenderingContext | null;
  let hooks: TestingHooks | null = null;
  try {
    if (backend === 'native') gl = canvas.getContext('webgl', attributes) as WebGLRenderingContext | null;
    else {
      const runtime = await import('@refral/webgl');
      gl = await runtime.createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
      hooks = runtime.getTestingHooks(gl);
    }
    if (!gl) throw new Error(`Cannot create ${backend} RTT context`);
    const context = gl;
    const selectedCore: DrawingBackend = hooks?.core ?? 'native';
    if (selectedCore !== backend) throw new Error(`Requested ${backend}, received ${selectedCore}`);
    const nativeInfo = backend === 'native' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
    const environment = { ...(hooks?.environment ?? { userAgent: navigator.userAgent,
      version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER),
      unmaskedRenderer: nativeInfo ? gl.getParameter(nativeInfo.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: nativeInfo ? gl.getParameter(nativeInfo.UNMASKED_VENDOR_WEBGL) : null }),
      attributes: gl.getContextAttributes(), devicePixelRatio: window.devicePixelRatio };
    return {
      canvas, gl: context, hooks, selectedCore, environment, requestedAttributes: attributes,
      async capture() {
        if (hooks) return hooks.capture();
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, data);
        return { width: canvas.width, height: canvas.height, data };
      },
      async dispose() {
        try { if (hooks) await hooks.dispose(); else context.getExtension('WEBGL_lose_context')?.loseContext(); }
        finally { canvas.remove(); }
      },
    };
  } catch (error) {
    await hooks?.dispose(); canvas.remove(); throw error;
  }
}

export function rttProgram(gl: WebGLRenderingContext, vertex = rttVertex, fragment = rttColorFragment) {
  const program = gl.createProgram()!;
  for (const [stage, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(stage)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return program;
}

export function rttTexture(gl: WebGLRenderingContext, width: number, height: number, data: Uint8Array | null,
  format: number = gl.RGBA, complete = true) {
  const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
  if (complete) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  return texture;
}

async function executeRtt(result: RttResult, context: Awaited<ReturnType<typeof prepareRttContext>>) {
  const { gl, canvas } = context;
  const check = (name: string, actual: unknown, expected: unknown) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
  };
  const error = (name: string, operation: () => void, expected: number) => { operation(); check(name, gl.getError(), expected); };
  const region = (x: number, y: number, width: number, height: number, color: number[], tolerance = 1) =>
    result.regions.push({ x, y, width, height, color, tolerance });
  const band = (x: number, width: number, color: number[]) => region(x, 0, width, canvas.height, color);
  const full = (color: number[]) => band(0, canvas.width, color);
  const program = (fragment = rttColorFragment, vertex = rttVertex) => {
    result.shaders[`vertex-${Object.keys(result.shaders).length}`] = vertex;
    result.shaders[`fragment-${Object.keys(result.shaders).length}`] = fragment;
    return rttProgram(gl, vertex, fragment);
  };
  let colorProgram: WebGLProgram | null = null;
  let textureProgram: WebGLProgram | null = null;
  const drawColor = (color: number[], z = 0) => {
    colorProgram ??= program(); gl.useProgram(colorProgram);
    gl.uniform4fv(gl.getUniformLocation(colorProgram, 'u_color'), color);
    gl.uniform1f(gl.getUniformLocation(colorProgram, 'u_z'), z);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const sample = (texture: WebGLTexture) => {
    textureProgram ??= program(rttTextureFragment); gl.useProgram(textureProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(textureProgram, 'u_texture'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const target = (width: number, height: number, depth = false) => {
    const texture = rttTexture(gl, width, height, null);
    const framebuffer = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const renderbuffer = depth ? gl.createRenderbuffer()! : null;
    if (renderbuffer) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
    }
    check('target complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    return { texture, framebuffer, renderbuffer };
  };
  gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const name = result.name;
  if (name.startsWith('texture-format-')) {
    const formats: Record<string, { format: number; bytes: number[]; expected: number[]; zero: number[] }> = {
      rgba: { format: gl.RGBA, bytes: [128, 64, 32, 128], expected: [128, 64, 32, 128], zero: [0, 0, 0, 0] },
      rgb: { format: gl.RGB, bytes: [128, 64, 32], expected: [128, 64, 32, 255], zero: [0, 0, 0, 255] },
      alpha: { format: gl.ALPHA, bytes: [128], expected: [0, 0, 0, 128], zero: [0, 0, 0, 0] },
      luminance: { format: gl.LUMINANCE, bytes: [128], expected: [128, 128, 128, 255], zero: [0, 0, 0, 255] },
      'luminance-alpha': { format: gl.LUMINANCE_ALPHA, bytes: [128, 64], expected: [128, 128, 128, 64], zero: [0, 0, 0, 0] },
    };
    const info = formats[name.slice('texture-format-'.length)]!;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const source = new Uint8Array([90, ...info.bytes, 91]);
    const texture = rttTexture(gl, 1, 1, source.subarray(1, source.length - 1), info.format);
    source.fill(0); gl.viewport(0, 0, 32, 64); sample(texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, info.format, 1, 1, 0, info.format, gl.UNSIGNED_BYTE, null);
    gl.viewport(32, 0, 32, 64); sample(texture);
    band(0, 32, info.expected); band(32, 32, info.zero);
  } else if (name === 'texture-packed-565' || name === 'texture-packed-4444' || name === 'texture-packed-5551') {
    const packed = {
      'texture-packed-565': { format: gl.RGB, type: gl.UNSIGNED_SHORT_5_6_5,
        red: 0xf800, green: 0x07e0, blue: 0x001f, redAlpha: 255 },
      'texture-packed-4444': { format: gl.RGBA, type: gl.UNSIGNED_SHORT_4_4_4_4,
        red: 0xf008, green: 0x0f0f, blue: 0x00ff, redAlpha: 136 },
      'texture-packed-5551': { format: gl.RGBA, type: gl.UNSIGNED_SHORT_5_5_5_1,
        red: 0xf801, green: 0x07c1, blue: 0x003f, redAlpha: 255 },
    }[name];
    const { format, type } = packed;
    const texture = rttTexture(gl, 1, 2, null, format);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    const source = Uint16Array.of(0xcccc, packed.red, 0xffff, packed.green, 0xbbbb);
    error('packed definition with padded rows and view offset', () =>
      gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 2, 0, format, type, source.subarray(1, 4)), gl.NO_ERROR);
    source.fill(0);
    gl.viewport(0, 0, 16, 64);
    sample(texture);
    error('packed short source rejects without replacing image', () =>
      gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 2, 0, format, type, new Uint16Array(2)), gl.INVALID_OPERATION);
    error('packed type requires Uint16Array', () =>
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, format, type, new Uint8Array(2)), gl.INVALID_OPERATION);
    error('subimage type must match definition', () =>
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, format, gl.UNSIGNED_BYTE, new Uint8Array(4)), gl.INVALID_OPERATION);
    gl.viewport(16, 0, 16, 64);
    sample(texture);
    const update = Uint16Array.of(packed.blue);
    error('packed subimage update', () =>
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, 1, 1, format, type, update), gl.NO_ERROR);
    update.fill(0);
    gl.viewport(32, 0, 16, 64);
    sample(texture);
    error('packed null definition', () =>
      gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 2, 0, format, type, null), gl.NO_ERROR);
    gl.viewport(48, 0, 16, 64);
    sample(texture);
    region(0, 0, 48, 32, [0, 255, 0, 255]);
    region(0, 32, 32, 32, [packed.redAlpha, 0, 0, packed.redAlpha]);
    region(32, 32, 16, 32, [0, 0, 255, 255]);
    band(48, 16, [0, 0, 0, format === gl.RGB ? 255 : 0]);
  } else switch (name) {
    case 'texture-manual-mip-2d':
    case 'texture-manual-mip-cube': {
      const cube = name === 'texture-manual-mip-cube';
      const binding = cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
      const target = cube ? gl.TEXTURE_CUBE_MAP_POSITIVE_X : gl.TEXTURE_2D;
      const width = cube ? 128 : 32;
      const height = 128;
      const texture = gl.createTexture()!;
      gl.bindTexture(binding, texture);
      gl.texParameteri(binding, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      gl.texParameteri(binding, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(binding, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(binding, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const colors = (w: number, h: number, channel: number) => {
        const data = new Uint8Array(w * h * 4);
        for (let i = 0; i < data.length; i += 4) { data[i + channel] = 255; data[i + 3] = 255; }
        return data;
      };
      const define = (face: number, level: number, channel: number) => {
        const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
        gl.texImage2D(face, level, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, colors(w, h, channel));
      };
      // Defining higher levels first is legal and leaves the chain incomplete until level zero exists.
      for (let level = 7; level >= 0; level--) {
        for (let face = 0; face < (cube ? 6 : 1); face++) {
          define(target + face, level, level === 1 && face === 0 ? 0 : 2);
        }
      }
      check('out-of-order mip definitions succeed', gl.getError(), gl.NO_ERROR);
      const fs = cube ? 'precision mediump float; varying vec2 v_uv; uniform samplerCube u_texture; void main(){gl_FragColor=textureCube(u_texture,vec3(1.0,(v_uv.y-0.5)*2.0,(v_uv.x-0.5)*0.5));}' : rttTextureFragment;
      const p = program(fs);
      gl.uniform1i(gl.getUniformLocation(p, 'u_texture'), 0);
      gl.viewport(0, 0, 16, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const pixels = colors(width / 2, height / 2, 1);
      error('nonzero-level update', () => gl.texSubImage2D(target, 1, 0, 0, width / 2, height / 2,
        gl.RGBA, gl.UNSIGNED_BYTE, pixels), gl.NO_ERROR);
      pixels.fill(0);
      error('out-of-bounds mip update', () => gl.texSubImage2D(target, 1, width / 2, height / 2, 1, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)), gl.INVALID_VALUE);
      gl.viewport(16, 0, 16, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      error('mismatched dimensions define an incomplete chain', () =>
        gl.texImage2D(target, 2, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.NO_ERROR);
      gl.viewport(32, 0, 16, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.texParameteri(binding, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.viewport(48, 0, 16, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      band(0, 16, [255, 0, 0, 255]);
      band(16, 16, [0, 255, 0, 255]);
      band(32, 16, [0, 0, 0, 255]);
      band(48, 16, [0, 0, 255, 255]);
      break;
    }
    case 'texture-generate-mip-from-fbo': {
      const t = target(32, 128);
      error('cube face is not a generation target', () => gl.generateMipmap(gl.TEXTURE_CUBE_MAP_POSITIVE_X), gl.INVALID_ENUM);
      const npot = rttTexture(gl, 3, 2, null);
      error('NPOT generation is invalid', () => gl.generateMipmap(gl.TEXTURE_2D), gl.INVALID_OPERATION);
      gl.deleteTexture(npot);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 1, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      program('precision highp float; void main(){gl_FragColor=mod(floor(gl_FragCoord.x),2.0)<1.0?vec4(1,0,0,1):vec4(0,1,0,1);}');
      gl.viewport(0, 0, 32, 128);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      error('generate replaces manual image from GPU writes', () => gl.generateMipmap(gl.TEXTURE_2D), gl.NO_ERROR);
      gl.viewport(0, 0, 16, 64);
      sample(t.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(16, 0, 16, 64);
      sample(t.texture);
      error('regenerate observes the latest framebuffer clear', () => gl.generateMipmap(gl.TEXTURE_2D), gl.NO_ERROR);
      gl.viewport(32, 0, 16, 64);
      sample(t.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.viewport(48, 0, 16, 64);
      sample(t.texture);
      band(0, 32, [128, 128, 0, 255]);
      band(32, 32, [0, 0, 255, 255]);
      break;
    }
    case 'texture-packed-cube': {
      const cube = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const p = program('precision mediump float; uniform samplerCube u_cube; void main(){gl_FragColor=textureCube(u_cube,vec3(1.0,0.0,0.0));}');
      gl.uniform1i(gl.getUniformLocation(p, 'u_cube'), 0);
      const face = gl.TEXTURE_CUBE_MAP_POSITIVE_X;
      for (let side = 0; side < 6; side++) {
        gl.texImage2D(face + side, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, Uint16Array.of(0xf801));
      }
      check('define all packed cube faces', gl.getError(), gl.NO_ERROR);
      gl.viewport(0, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.texSubImage2D(face, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, Uint16Array.of(0x07c1));
      check('update only the positive-x packed face', gl.getError(), gl.NO_ERROR);
      gl.viewport(32, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      band(0, 32, [255, 0, 0, 255]);
      band(32, 32, [0, 255, 0, 255]);
      break;
    }
    case 'uniform-matrix-arrays': {
      const vs = 'attribute vec2 a_position; uniform mat4 u_m4[2]; void main(){gl_Position=u_m4[0]*u_m4[1]*vec4(a_position,0.,1.);}';
      const fs = 'precision mediump float; uniform mat2 u_m2[2]; uniform mat3 u_m3; void main(){gl_FragColor=vec4(u_m2[0][1][0],u_m2[1][0][1],u_m3[2][1],1.);}';
      const p = program(fs, vs); const m2 = gl.getUniformLocation(p, 'u_m2[0]')!;
      const m3 = gl.getUniformLocation(p, 'u_m3')!; const m4 = gl.getUniformLocation(p, 'u_m4[0]')!;
      const source = new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]);
      gl.uniformMatrix2fv(m2, false, source); source.fill(0);
      gl.uniformMatrix3fv(m3, false, [0, 0, 0, 0, 0, 0, 0, 1, 0]);
      gl.uniformMatrix4fv(m4, false, new Float32Array([...identity4, ...identity4]));
      gl.viewport(0, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      error('null matrix location ignores bad transpose and length', () => gl.uniformMatrix4fv(null, true, [1]), gl.NO_ERROR);
      error('matrix transpose rejects true', () => gl.uniformMatrix4fv(m4, true, identity4), gl.INVALID_VALUE);
      error('matrix short data rejects', () => gl.uniformMatrix3fv(m3, false, [1]), gl.INVALID_VALUE);
      error('matrix nonmultiple rejects', () => gl.uniformMatrix2fv(m2, false, [1, 2, 3, 4, 5]), gl.INVALID_VALUE);
      check('matrix array element query', Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'u_m4[1]')!) as Float32Array), identity4);
      gl.uniformMatrix2fv(m2, false, new Float32Array(8));
      gl.uniformMatrix2fv(gl.getUniformLocation(p, 'u_m2[1]'), false, [0, 1, 0, 0]);
      gl.uniformMatrix3fv(m3, false, new Float32Array(9));
      gl.viewport(32, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      band(0, 32, [255, 0, 255, 255]); band(32, 32, [0, 255, 0, 255]);
      break;
    }
    case 'uniform-int-bool-arrays': {
      const fs = `precision highp float; precision highp int; uniform ivec4 u_i[2]; uniform bvec4 u_b[2];
uniform int u_i1; uniform ivec2 u_i2; uniform ivec3 u_i3; uniform bool u_b1; uniform bvec2 u_b2; uniform bvec3 u_b3;
void main(){bool valid=u_i1==17&&u_i2.x==18&&u_i2.y==19&&u_i3.z==22&&u_b1&&u_b2.x&&!u_b2.y&&u_b3.z;
gl_FragColor=vec4(u_i[0].x==16777217?1.:0.,u_i[1].w==(-2147483647-1)&&u_b[1].z&&valid?1.:0.,u_b[0].x&&!u_b[0].y&&u_b[0].z?1.:0.,1.);}`;
      const p = program(fs); const integer = gl.getUniformLocation(p, 'u_i[0]')!;
      const boolean = gl.getUniformLocation(p, 'u_b[0]')!;
      const i1 = gl.getUniformLocation(p, 'u_i1')!, i2 = gl.getUniformLocation(p, 'u_i2')!, i3 = gl.getUniformLocation(p, 'u_i3')!;
      gl.uniform1i(i1, 17); gl.uniform1iv(i1, [17]);
      gl.uniform2i(i2, 18, 19); gl.uniform2iv(i2, [18, 19]);
      gl.uniform3i(i3, 20, 21, 22); gl.uniform3iv(i3, [20, 21, 22]);
      gl.uniform4i(integer, 16777217, -1, 2147483647, -2147483648);
      check('scalar integer query', gl.getUniform(p, i1), 17);
      check('ivec2 query', Array.from(gl.getUniform(p, i2) as Int32Array), [18, 19]);
      check('ivec3 query', Array.from(gl.getUniform(p, i3) as Int32Array), [20, 21, 22]);
      const b1 = gl.getUniformLocation(p, 'u_b1')!, b2 = gl.getUniformLocation(p, 'u_b2')!, b3 = gl.getUniformLocation(p, 'u_b3')!;
      gl.uniform1i(b1, 1); gl.uniform1f(b1, NaN);
      gl.uniform2f(b2, -2, 0); gl.uniform2fv(b2, [-2, 0]);
      gl.uniform3f(b3, 0, 0, -2); gl.uniform3fv(b3, [0, 0, -2]);
      check('scalar bool query', gl.getUniform(p, b1), true);
      check('bvec2 query', gl.getUniform(p, b2), [true, false]);
      check('bvec3 query', gl.getUniform(p, b3), [false, false, true]);
      const input = new Int32Array([16777217, -1, 2147483647, -2147483648, 0, 1, -2, -2147483648]);
      gl.uniform4iv(integer, input); input.fill(0);
      gl.uniform4iv(boolean, [1, 0, -2, 0, 0, 0, 1, 0]);
      check('integer query keeps i32 precision', Array.from(gl.getUniform(p, integer) as Int32Array), [16777217, -1, 2147483647, -2147483648]);
      check('bool vector query returns booleans', gl.getUniform(p, boolean), [true, false, true, false]);
      gl.viewport(0, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.uniform4fv(boolean, [NaN, 0, -2, 0]);
      check('float bool converts nonzero including NaN', gl.getUniform(p, boolean), [true, false, true, false]);
      gl.uniform4iv(integer, [0, 0, 0, 0]);
      gl.viewport(32, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      band(0, 32, [255, 255, 255, 255]); band(32, 32, [0, 255, 255, 255]);
      break;
    }
    case 'uniform-non-current-relink': {
      const fs = 'precision mediump float; uniform vec4 u_colors[2]; void main(){gl_FragColor=u_colors[0]+u_colors[1];}';
      const p = program(fs); const old = gl.getUniformLocation(p, 'u_colors[0]')!;
      gl.uniform4fv(old, [1, 0, 0, 1, 0, 0, 0, 0, 9, 9, 9, 9]);
      check('excess array elements ignored', gl.getError(), gl.NO_ERROR);
      const other = program();
      check('query non-current program', Array.from(gl.getUniform(p, old) as Float32Array), [1, 0, 0, 1]);
      error('setter wrong current program', () => gl.uniform4fv(old, [0, 1, 0, 1]), gl.INVALID_OPERATION);
      gl.useProgram(null);
      check('query with no current program', Array.from(gl.getUniform(p, old) as Float32Array), [1, 0, 0, 1]);
      gl.useProgram(p); gl.viewport(0, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.linkProgram(p); check('relink success', gl.getProgramParameter(p, gl.LINK_STATUS), true);
      error('old uniform location stale', () => gl.uniform4fv(old, [0, 0, 1, 1]), gl.INVALID_OPERATION);
      const fresh = gl.getUniformLocation(p, 'u_colors[0]')!;
      check('uniform array reset on relink', Array.from(gl.getUniform(p, fresh) as Float32Array), [0, 0, 0, 0]);
      gl.uniform4fv(gl.getUniformLocation(p, 'u_colors[1]'), [0, 1, 0, 1]);
      gl.viewport(32, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.deleteProgram(other);
      band(0, 32, [255, 0, 0, 255]); band(32, 32, [0, 255, 0, 255]);
      break;
    }
    case 'raster-masks-depth-blend-cull':
      gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 32, 32);
      gl.colorMask(true, false, false, false); gl.clearColor(1, 1, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 32, 32, 32); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      drawColor([1, 0, 0, 1], -0.5); drawColor([0, 0, 1, 1], 0.5);
      gl.depthMask(false); drawColor([0, 0, 1, 1], -0.75);
      drawColor([0, 1, 0, 1], -0.6); gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
      gl.viewport(32, 0, 32, 32); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawColor([1, 0, 0, 0.5]); gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW);
      gl.viewport(32, 32, 16, 32); drawColor([1, 1, 0, 1]);
      gl.frontFace(gl.CCW); gl.viewport(48, 32, 16, 32); drawColor([0, 1, 1, 1]);
      region(0, 0, 32, 32, [255, 0, 255, 255]); region(0, 32, 32, 32, [0, 255, 0, 255]);
      region(32, 0, 32, 32, [128, 0, 127, 255]); region(32, 32, 16, 32, [0, 0, 255, 255]);
      region(48, 32, 16, 32, [0, 255, 255, 255]);
      break;
    case 'texture-unpack-snapshot': {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      const data = new Uint8Array([90, 91, 92,
        200, 0, 0, 128, 200, 0, 0, 128, 200, 0, 0, 128, 99, 99, 99, 99,
        0, 200, 0, 128, 0, 200, 0, 128, 0, 200, 0, 128, 93]);
      const texture = rttTexture(gl, 3, 2, data.subarray(3, 31)); data.fill(0);
      const update = new Uint8Array([90, 90, 90, 90, 0, 0, 200, 128,
        99, 99, 99, 99, 200, 200, 200, 128, 91]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 1, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, update.subarray(4, 16));
      update.fill(0); sample(texture);
      check('unpack alignment query', gl.getParameter(gl.UNPACK_ALIGNMENT), 8);
      check('flip query', gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true);
      check('premultiply query', gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), true);
      for (const x of [0, 40]) { region(x, 0, 20, 32, [0, 100, 0, 128]); region(x, 32, 20, 32, [100, 0, 0, 128]); }
      region(20, 0, 20, 32, [100, 100, 100, 128]); region(20, 32, 20, 32, [0, 0, 100, 128]);
      break;
    }
    case 'texture-updates-reallocation': {
      const texture = rttTexture(gl, 1, 1, new Uint8Array([255, 0, 0, 255]));
      gl.viewport(0, 0, 16, 64); sample(texture);
      const update = new Uint8Array([90, 0, 255, 0, 255, 91]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, update.subarray(1, 5));
      update.fill(0); gl.viewport(16, 0, 16, 64); sample(texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]));
      gl.viewport(32, 0, 16, 64); sample(texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.viewport(48, 0, 16, 64); sample(texture);
      gl.deleteTexture(texture);
      check('texture deletion clears binding', gl.getParameter(gl.TEXTURE_BINDING_2D), null);
      check('deleted texture is not live', gl.isTexture(texture), false);
      band(0, 16, [255, 0, 0, 255]); band(16, 16, [0, 255, 0, 255]);
      band(32, 16, [0, 0, 255, 255]); band(48, 16, [0, 255, 255, 255]);
      break;
    }
    case 'texture-npot-completeness': {
      const source = new Uint8Array(3 * 2 * 4).fill(255);
      const texture = rttTexture(gl, 3, 2, source, gl.RGBA, false);
      gl.viewport(0, 0, 16, 64); sample(texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.viewport(16, 0, 16, 64); sample(texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.viewport(32, 0, 16, 64); sample(texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.viewport(48, 0, 16, 64); sample(texture);
      band(0, 32, [0, 0, 0, 255]); band(32, 16, [255, 255, 255, 255]); band(48, 16, [0, 0, 0, 255]);
      break;
    }
    case 'texture-sampler-units': {
      const fs = 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_a; uniform sampler2D u_b; void main(){gl_FragColor=texture2D(u_a,v_uv)+texture2D(u_b,v_uv);}';
      const p = program(fs);
      gl.activeTexture(gl.TEXTURE0); rttTexture(gl, 1, 1, new Uint8Array([255, 0, 0, 255]));
      gl.activeTexture(gl.TEXTURE1); rttTexture(gl, 1, 1, new Uint8Array([0, 255, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(p, 'u_a'), 0); gl.uniform1i(gl.getUniformLocation(p, 'u_b'), 1);
      gl.viewport(0, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.activeTexture(gl.TEXTURE2); rttTexture(gl, 1, 1, new Uint8Array([0, 0, 255, 255]));
      gl.uniform1i(gl.getUniformLocation(p, 'u_b'), 2);
      check('sampler unit query', gl.getUniform(p, gl.getUniformLocation(p, 'u_b')!), 2);
      check('active texture query', gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE2);
      gl.viewport(32, 0, 32, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      band(0, 32, [255, 255, 0, 255]); band(32, 32, [255, 0, 255, 255]);
      break;
    }
    case 'texture-invalid-state': {
      const texture = rttTexture(gl, 1, 1, new Uint8Array([255, 0, 0, 255]));
      gl.viewport(0, 0, 32, 64); sample(texture);
      error('null subimage invalid value', () => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.INVALID_VALUE);
      error('UBYTE rejects Float32Array', () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Float32Array(4)), gl.INVALID_OPERATION);
      error('undersized image rejected', () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(3)), gl.INVALID_OPERATION);
      error('format mismatch rejected', () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.INVALID_OPERATION);
      for (const [label, source] of [['raw ArrayBuffer', new ArrayBuffer(4)],
        ['resizable view', new Uint8Array(Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer)]] as const) {
        let thrown: string | null = null;
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source as Uint8Array); }
        catch (value) { thrown = value instanceof Error ? value.name : String(value); }
        check(label + ' raises TypeError', thrown, 'TypeError'); check(label + ' preserves GL errors', gl.getError(), gl.NO_ERROR);
      }
      check('invalid calls retain texture binding', gl.getParameter(gl.TEXTURE_BINDING_2D) === texture, true);
      gl.viewport(32, 0, 32, 64); sample(texture); full([255, 0, 0, 255]);
      break;
    }
    case 'fbo-depth-render-sample': {
      const t = target(32, 32, true);
      check('FBO alpha bits come from RGBA attachment', gl.getParameter(gl.ALPHA_BITS), 8);
      check('FBO depth has at least sixteen bits', gl.getParameter(gl.DEPTH_BITS) >= 16, true);
      check('color attachment wrapper', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === t.texture, true);
      check('depth attachment wrapper', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === t.renderbuffer, true);
      gl.viewport(0, 0, 32, 32); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      drawColor([1, 0, 0, 1], 0.5); drawColor([0, 1, 0, 1], -0.5);
      gl.deleteRenderbuffer(t.renderbuffer);
      check('depth deletion updates framebuffer bits', gl.getParameter(gl.DEPTH_BITS), 0);
      check('bound depth deletion detaches', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
      check('color-only target remains complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.DEPTH_TEST);
      gl.viewport(0, 0, 64, 64); sample(t.texture); full([0, 255, 0, 255]);
      break;
    }
    case 'fbo-cube-face-render-sample': {
      const cube = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      const first = gl.TEXTURE_CUBE_MAP_POSITIVE_X;
      for (let face = 0; face < 5; face++) {
        gl.texImage2D(first + face, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const attach = (face: number) => {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, face, cube, 0);
        check(`face ${face} attachment enum`, gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE), face);
      };
      attach(first);
      check('missing base face makes the attachment incomplete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
      gl.texImage2D(first + 5, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      check('mip-incomplete cube face is framebuffer complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
      gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      attach(first + 1);
      gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      attach(first);
      const texel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, texel);
      check('changing the other face preserves this framebuffer image', Array.from(texel), [255, 0, 0, 255]);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const p = program('precision mediump float; uniform samplerCube u_cube; uniform float u_face; void main(){gl_FragColor=textureCube(u_cube,vec3(u_face,0.0,0.0));}');
      gl.uniform1i(gl.getUniformLocation(p, 'u_cube'), 0);
      const uFace = gl.getUniformLocation(p, 'u_face');
      gl.uniform1f(uFace, 1);
      gl.viewport(0, 0, 4, 4);
      error('attached cube texture cannot be sampled by the draw', () => gl.drawArrays(gl.TRIANGLES, 0, 6), gl.INVALID_OPERATION);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const draw = (x: number, face: number) => {
        gl.uniform1f(uFace, face);
        gl.viewport(x, 0, 16, 64);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      draw(0, 1);
      draw(16, -1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      attach(first + 1);
      gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      draw(32, -1);
      draw(48, 1);
      band(0, 16, [255, 0, 0, 255]); band(16, 16, [0, 255, 0, 255]);
      band(32, 16, [0, 0, 255, 255]); band(48, 16, [255, 0, 0, 255]);
      break;
    }
    case 'fbo-attachment-resize': {
      const t = target(16, 16, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      check('mismatched attachment sizes', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS);
      error('incomplete target clear rejected', () => gl.clear(gl.COLOR_BUFFER_BIT), gl.INVALID_FRAMEBUFFER_OPERATION);
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.renderbuffer); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 32, 32);
      check('resized renderbuffer width', gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH), 32);
      check('resized target complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
      gl.viewport(0, 0, 32, 32); drawColor([0, 1, 1, 1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, 64, 64); sample(t.texture); full([0, 255, 255, 255]);
      break;
    }
    case 'fbo-deletion-bound-unbound': {
      const t = target(16, 16, true);
      gl.viewport(0, 0, 16, 16); drawColor([1, 0, 0, 1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, 32, 64); sample(t.texture);
      gl.deleteTexture(t.texture); gl.deleteRenderbuffer(t.renderbuffer);
      check('deleted texture object check', gl.isTexture(t.texture), false);
      check('deleted depth object check', gl.isRenderbuffer(t.renderbuffer), false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      check('unbound deletion retains complete attachments', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
      check('retained color wrapper identity', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === t.texture, true);
      check('retained depth wrapper identity', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === t.renderbuffer, true);
      check('renderbuffer texture-level query neutral', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL), null);
      check('renderbuffer texture-level query error', gl.getError(), gl.INVALID_ENUM);
      const next = rttTexture(gl, 16, 16, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, next, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.viewport(0, 0, 16, 16); drawColor([0, 1, 0, 1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(32, 0, 32, 64); sample(next);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer); gl.deleteTexture(next);
      check('bound color deletion detaches', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
      check('empty attachment name neutral', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), null);
      check('empty attachment name error', gl.getError(), gl.INVALID_ENUM);
      check('empty target status', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
      error('empty target clear error', () => gl.clear(gl.COLOR_BUFFER_BIT), gl.INVALID_FRAMEBUFFER_OPERATION);
      gl.deleteFramebuffer(t.framebuffer); check('deleted bound framebuffer resets binding', gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
      band(0, 32, [255, 0, 0, 255]); band(32, 32, [0, 255, 0, 255]);
      break;
    }
    case 'fbo-feedback-loop': {
      const t = target(32, 32);
      gl.viewport(0, 0, 32, 32); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      error('active texture feedback rejected', () => sample(t.texture), gl.INVALID_OPERATION);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, 32, 64); sample(t.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer); gl.viewport(0, 0, 32, 32);
      gl.activeTexture(gl.TEXTURE0); rttTexture(gl, 1, 1, new Uint8Array([0, 255, 0, 255]));
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t.texture);
      error('inactive unit feedback is permitted', () => gl.drawArrays(gl.TRIANGLES, 0, 6), gl.NO_ERROR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(32, 0, 32, 64); sample(t.texture);
      band(0, 32, [255, 0, 0, 255]); band(32, 32, [0, 255, 0, 255]);
      break;
    }
    case 'resources-multiple-contexts': {
      const peer = await prepareRttContext(result.backend, 2, 2);
      try {
        const foreign = rttTexture(peer.gl, 1, 1, new Uint8Array([0, 0, 255, 255]));
        const texture = rttTexture(gl, 1, 1, new Uint8Array([255, 0, 0, 255]));
        error('foreign texture bind rejected', () => gl.bindTexture(gl.TEXTURE_2D, foreign), gl.INVALID_OPERATION);
        check('foreign bind retains own texture', gl.getParameter(gl.TEXTURE_BINDING_2D) === texture, true);
        const framebuffer = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        error('foreign attachment rejected', () => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, foreign, 0), gl.INVALID_OPERATION);
        check('foreign attachment retains own wrapper', gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === texture, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); sample(texture); full([255, 0, 0, 255]);
      } finally { await peer.dispose(); }
      break;
    }
    case 'canvas-resize-present': {
      const t = target(16, 16, true);
      gl.viewport(0, 0, 16, 16); drawColor([1, 0, 0, 1]);
      canvas.width = 96; canvas.height = 32;
      check('canvas resize preserves offscreen completeness', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
      drawColor([0, 0, 1, 1]); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, 96, 32); sample(t.texture);
      check('canvas dimensions', [gl.drawingBufferWidth, gl.drawingBufferHeight], [96, 32]);
      full([0, 0, 255, 255]);
      break;
    }
  }
  check('final GL error', gl.getError(), gl.NO_ERROR);
  gl.flush();
}

export async function runRttCase(name: RttCaseName, backend: DrawingBackend): Promise<RttResult> {
  const width = name === 'texture-unpack-snapshot' ? 60 : 64;
  const alpha = name.startsWith('texture-format-') || name.startsWith('texture-packed-') || name === 'texture-unpack-snapshot';
  const result: RttResult = { name, backend, selectedCore: null, checks: [], observations: {}, regions: [], shaders: {},
    environment: {}, width, height: 64, pixels: [], failure: null, validationErrors: [], cleanupErrors: [] };
  let context: Awaited<ReturnType<typeof prepareRttContext>> | null = null;
  try {
    context = await prepareRttContext(backend, width, 64, alpha);
    result.selectedCore = context.selectedCore; result.environment = context.environment;
    const actualAttributes = context.gl.getContextAttributes();
    for (const [attribute, expected] of Object.entries(context.requestedAttributes)) {
      const actual = actualAttributes?.[attribute as keyof WebGLContextAttributes];
      result.checks.push({ name: 'context attribute ' + attribute, actual, expected, passed: actual === expected });
    }
    await executeRtt(result, context);
    const image = await context.capture();
    result.width = image.width; result.height = image.height; result.pixels = Array.from(image.data);
    result.validationErrors = [...context.hooks?.errors ?? []];
  } catch (error) {
    result.failure = error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
  } finally {
    try { await context?.dispose(); } catch (error) { result.cleanupErrors.push(String(error)); }
  }
  return result;
}
