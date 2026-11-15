import type { TestingHooks } from '@refral/webgl';

export const readPixelsCaseNames = [
  'packing-and-destination-views',
  'clipping-and-empty-rectangles',
  'synchronous-draw-clear-and-targets',
  'upload-snapshots-and-read-order',
  'resize-deletion-and-context-ownership',
  'gl-validation-and-state-preservation',
  'webidl-conversions-and-view-validation',
  'context-loss-and-disposal',
] as const;

export type ReadPixelsCaseName = typeof readPixelsCaseNames[number];
export type ReadPixelsBackend = 'native' | 'js' | 'rust';

export interface ReadPixelsCheck {
  name: string;
  actual: unknown;
  expected: unknown;
  passed: boolean;
  nativeObservationOnly: boolean;
}

export interface ReadPixelsResult {
  name: ReadPixelsCaseName;
  backend: ReadPixelsBackend;
  selectedCore: ReadPixelsBackend | null;
  checks: ReadPixelsCheck[];
  observations: Record<string, unknown>;
  contexts: Record<string, unknown>[];
  shaders: Record<string, string>;
  failure: { name: string; message: string } | null;
  validationErrors: string[];
  cleanupErrors: string[];
}

interface TestContext {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  hooks: TestingHooks | null;
  disposed: boolean;
}

interface PixelSource {
  width: number;
  height: number;
  pixels: Uint8Array;
}

type Check = (name: string, actual: unknown, expected: unknown, nativeObservationOnly?: boolean) => void;

const sentinel = 0x6d;
const attributes: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: false, preserveDrawingBuffer: true,
};
const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
const vertexSource = `attribute vec2 a_position;
varying vec2 v_uv;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_position * 0.5 + 0.5; }`;
const colorSource = 'precision mediump float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }';
const textureSource = `precision mediump float;
varying vec2 v_uv; uniform sampler2D u_image;
void main() { gl_FragColor = texture2D(u_image, v_uv); }`;

function read(gl: WebGLRenderingContext, ...args: unknown[]): unknown {
  return (gl.readPixels as unknown as (...values: unknown[]) => unknown)(...args);
}

function byteValues(view: ArrayBufferView): number[] {
  return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function palette(width: number, height: number): PixelSource {
  const pixels = new Uint8Array(width * height * 4);
  const values = [0, 1, 254, 255];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels.set([(x * 37 + y * 61 + 19) & 255, (x * 83 + y * 13 + 127) & 255,
        values[(x + y) % 4]!, values[(x + y * 2) % 4]!], offset);
    }
  }
  return { width, height, pixels };
}

function solid(width: number, height: number, rgba: readonly number[]): PixelSource {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) pixels.set(rgba, index * 4);
  return { width, height, pixels };
}

function configureTexture(gl: WebGLRenderingContext, width: number, height: number, pixels: Uint8Array | null) {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return texture;
}

function framebuffer(gl: WebGLRenderingContext, source: PixelSource, check: Check) {
  const texture = configureTexture(gl, source.width, source.height, source.pixels);
  const target = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  check('RGBA texture framebuffer is complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  return { texture, target };
}

function program(gl: WebGLRenderingContext, fragment: string, result: ReadPixelsResult) {
  result.shaders.vertex = vertexSource;
  result.shaders[fragment === colorSource ? 'colorFragment' : 'textureFragment'] = fragment;
  const linked = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Readback shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(linked, shader);
  }
  gl.bindAttribLocation(linked, 0, 'a_position');
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    throw new Error(`Readback program link failed: ${gl.getProgramInfoLog(linked)}`);
  }
  gl.useProgram(linked);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return linked;
}

/** Compute the spec-defined writes, preserving padding and pixels outside the framebuffer. */
function expectedRead(source: PixelSource, initial: number[], viewOffset: number,
  x: number, y: number, width: number, height: number, alignment: number): number[] {
  const expected = initial.slice();
  const stride = Math.ceil(width * 4 / alignment) * alignment;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const sourceX = x + column;
      const sourceY = y + row;
      if (sourceX < 0 || sourceY < 0 || sourceX >= source.width || sourceY >= source.height) continue;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const destinationOffset = viewOffset + row * stride + column * 4;
      for (let channel = 0; channel < 4; channel++) expected[destinationOffset + channel] = source.pixels[sourceOffset + channel]!;
    }
  }
  return expected;
}

function checkRead(gl: WebGLRenderingContext, check: Check, label: string, source: PixelSource,
  x = 0, y = 0, width = source.width, height = source.height, alignment = 4,
  nativeErrorObservationOnly = false) {
  gl.pixelStorei(gl.PACK_ALIGNMENT, alignment);
  const stride = Math.ceil(width * 4 / alignment) * alignment;
  const required = width === 0 || height === 0 ? 0 : (height - 1) * stride + width * 4;
  const backing = new Uint8Array(required + 13).fill(sentinel);
  const destination = backing.subarray(5, 5 + required);
  const expected = expectedRead(source, Array.from(backing), 5, x, y, width, height, alignment);
  const returned = read(gl, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, destination);
  check(`${label} returns undefined`, returned === undefined, true);
  const error = gl.getError();
  check(`${label} error`, error, gl.NO_ERROR, nativeErrorObservationOnly);
  check(`${label} pixel bytes, clipping, padding and surrounding sentinels`, Array.from(backing), expected);
  return { destination, error };
}

async function packing(gl: WebGLRenderingContext, check: Check, result: ReadPixelsResult) {
  const source = palette(5, 4);
  framebuffer(gl, source, check);
  for (const alignment of [1, 2, 4, 8]) {
    checkRead(gl, check, `PACK_ALIGNMENT ${alignment}, odd width and exact final-row span`, source, 1, 0, 3, 3, alignment);
  }
  gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
  const expected = Array.from(source.pixels);
  const backing = new Uint8ClampedArray(source.pixels.length + 17).fill(sentinel);
  const clamped = backing.subarray(7, 7 + source.pixels.length);
  read(gl, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, clamped);
  check('Uint8ClampedArray read error', gl.getError(), gl.NO_ERROR);
  check('Uint8ClampedArray offset and surrounding bytes', Array.from(backing),
    [...Array<number>(7).fill(sentinel), ...expected, ...Array<number>(10).fill(sentinel)]);

  result.observations.sharedArrayBufferAvailable = typeof SharedArrayBuffer !== 'undefined';
  check('shared-view fixture is cross-origin isolated', crossOriginIsolated, true);
  check('SharedArrayBuffer is available for actual destination coverage', typeof SharedArrayBuffer, 'function');
  if (typeof SharedArrayBuffer !== 'undefined') {
    const shared = new Uint8Array(new SharedArrayBuffer(source.pixels.length + 9)).fill(sentinel);
    read(gl, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, shared.subarray(3, 3 + source.pixels.length));
    check('shared Uint8Array read error', gl.getError(), gl.NO_ERROR);
    check('shared Uint8Array fixed view writes', Array.from(shared),
      [...Array<number>(3).fill(sentinel), ...expected, ...Array<number>(6).fill(sentinel)]);
    const sharedClamped = new Uint8ClampedArray(new SharedArrayBuffer(source.pixels.length));
    read(gl, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, sharedClamped);
    check('shared Uint8ClampedArray error', gl.getError(), gl.NO_ERROR);
    check('shared Uint8ClampedArray bytes', Array.from(sharedClamped), expected);
    const growable = Reflect.construct(SharedArrayBuffer, [source.pixels.length, { maxByteLength: source.pixels.length * 2 }]) as SharedArrayBuffer;
    check('growable shared destination throws TypeError', exceptionName(() =>
      read(gl, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(growable))), 'TypeError');
    check('growable shared destination creates no GL error', gl.getError(), gl.NO_ERROR);
  }
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    const realm = iframe.contentWindow as unknown as { Uint8Array: Uint8ArrayConstructor; Uint8ClampedArray: Uint8ClampedArrayConstructor };
    for (const constructor of [realm.Uint8Array, realm.Uint8ClampedArray]) {
      const destination = new constructor(source.pixels.length).fill(sentinel);
      read(gl, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, destination);
      check(`${constructor.name} from another realm error`, gl.getError(), gl.NO_ERROR);
      check(`${constructor.name} from another realm pixels`, Array.from(destination), expected);
    }
  } finally {
    iframe.remove();
  }
  const tiled = palette(4101, 1);
  framebuffer(gl, tiled, check);
  checkRead(gl, check, 'offset source spanning Canvas packing tiles', tiled, 1, 0, 4099, 1);
}

function clipping(gl: WebGLRenderingContext, check: Check, result: ReadPixelsResult) {
  const source = palette(5, 4);
  framebuffer(gl, source, check);
  for (const [label, x, y, width, height] of [
    ['left edge', -2, 0, 4, 3], ['right edge', 3, 0, 4, 3],
    ['bottom edge', 0, -2, 3, 4], ['top edge', 0, 2, 3, 4],
    ['all four edges', -1, -1, 7, 6], ['outside left', -8, 1, 2, 2],
    ['outside right', 6, 1, 2, 2], ['outside bottom', 1, -4, 2, 2],
    ['outside top', 1, 5, 2, 2], ['minimum GLint coordinates', -2147483648, -2147483648, 2, 2],
    ['maximum GLint coordinates', 2147483647, 2147483647, 2, 2],
    ['zero width', -2147483648, 0, 0, 3], ['zero height', 0, 2147483647, 3, 0],
    ['zero dimensions', 0, 0, 0, 0],
  ] as const) {
    const maximumCoordinates = label === 'maximum GLint coordinates';
    const { error } = checkRead(gl, check, label, source, x, y, width, height, 8, maximumCoordinates);
    if (maximumCoordinates && result.backend === 'native') {
      result.observations.maximumGlintCoordinates = {
        arguments: { x, y, width, height, format: gl.RGBA, type: gl.UNSIGNED_BYTE, destinationByteLength: 16 },
        framebuffer: { width: source.width, height: source.height },
        packAlignment: 8,
        error,
        specificationExpectedError: gl.NO_ERROR,
      };
    }
  }
}

async function drawing(context: TestContext, check: Check, result: ReadPixelsResult,
  open: (alpha?: boolean) => Promise<TestContext>) {
  const { gl, canvas } = context;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(1, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  checkRead(gl, check, 'clear before an explicit flush or task yield', solid(canvas.width, canvas.height, [255, 0, 0, 0]));
  const linked = program(gl, colorSource, result);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform4f(gl.getUniformLocation(linked, 'u_color'), 0, 1, 0, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  checkRead(gl, check, 'draw before an explicit flush or task yield', solid(canvas.width, canvas.height, [0, 255, 0, 255]));
  const target = framebuffer(gl, solid(3, 2, [0, 0, 0, 0]), check);
  gl.viewport(0, 0, 3, 2);
  gl.uniform4f(gl.getUniformLocation(linked, 'u_color'), 0, 0, 1, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  checkRead(gl, check, 'current FBO draw with transparent RGB', solid(3, 2, [0, 0, 255, 0]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  checkRead(gl, check, 'default target retained after FBO read', solid(canvas.width, canvas.height, [0, 255, 0, 255]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.target);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, 1, 1);
  gl.colorMask(false, false, false, false);
  checkRead(gl, check, 'read ignores scissor, viewport and color write masks', solid(3, 2, [0, 0, 255, 0]));
  check('scissor enable survives read', gl.isEnabled(gl.SCISSOR_TEST), true);
  check('scissor box survives read', Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array), [0, 0, 1, 1]);
  check('color write mask survives read', gl.getParameter(gl.COLOR_WRITEMASK), [false, false, false, false]);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.clearColor(1, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  checkRead(gl, check, 'clear after synchronous read', solid(3, 2, [255, 255, 0, 255]));

  const opaque = await open(false);
  opaque.gl.clearColor(1, 0, 1, 0);
  opaque.gl.clear(opaque.gl.COLOR_BUFFER_BIT);
  checkRead(opaque.gl, check, 'opaque default framebuffer reports alpha one', solid(5, 4, [255, 0, 255, 255]));
}

function uploads(context: TestContext, check: Check, result: ReadPixelsResult) {
  const { gl, canvas } = context;
  const source = palette(5, 4);
  const input = new Uint8Array(source.pixels.length + 11).fill(sentinel);
  input.set(source.pixels, 5);
  const texture = configureTexture(gl, source.width, source.height, input.subarray(5, 5 + source.pixels.length));
  input.fill(0);
  const target = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  checkRead(gl, check, 'uploaded source is consumed before caller mutation', source);
  const update = new Uint8Array([255, 0, 0, 255]);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 2, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, update);
  update.fill(0);
  const updated = { ...source, pixels: source.pixels.slice() };
  updated.pixels.set([255, 0, 0, 255], (1 * source.width + 2) * 4);
  checkRead(gl, check, 'texture update between reads is immediately visible', updated);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const linked = program(gl, textureSource, result);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(linked, 'u_image'), 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  checkRead(gl, check, 'sampling after read observes the same updated GPU contents', updated);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.clearColor(0, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  checkRead(gl, check, 'FBO clear supersedes uploaded contents', solid(5, 4, [0, 255, 255, 255]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  checkRead(gl, check, 'FBO write then sampling after synchronous read', solid(5, 4, [0, 255, 255, 255]));
}

async function lifecycle(context: TestContext, check: Check, open: () => Promise<TestContext>) {
  const { gl, canvas } = context;
  const first = framebuffer(gl, solid(5, 4, [255, 0, 0, 255]), check);
  checkRead(gl, check, 'first attachment', solid(5, 4, [255, 0, 0, 255]));
  const replacement = configureTexture(gl, 3, 2, new Uint8Array(3 * 2 * 4));
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, replacement, 0);
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.deleteTexture(first.texture);
  checkRead(gl, check, 'replacement attachment after old texture deletion', solid(3, 2, [0, 0, 255, 255]));
  gl.bindTexture(gl.TEXTURE_2D, replacement);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  checkRead(gl, check, 'reallocated attached texture is zero initialized', solid(2, 3, [0, 0, 0, 0]));
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.deleteFramebuffer(first.target);
  check('deleting current FBO resets binding', gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
  canvas.width = 3;
  canvas.height = 2;
  checkRead(gl, check, 'resized default framebuffer is zero initialized', solid(3, 2, [0, 0, 0, 0]));
  gl.clearColor(1, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  checkRead(gl, check, 'resized default framebuffer clear', solid(3, 2, [255, 255, 0, 255]));

  const other = await open();
  other.gl.clearColor(1, 0, 1, 1);
  other.gl.clear(other.gl.COLOR_BUFFER_BIT);
  checkRead(other.gl, check, 'independent second context', solid(5, 4, [255, 0, 255, 255]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, other.gl.createFramebuffer());
  check('cross-context framebuffer is rejected', gl.getError(), gl.INVALID_OPERATION);
  check('cross-context framebuffer leaves binding intact', gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
  checkRead(gl, check, 'first context remains independent', solid(3, 2, [255, 255, 0, 255]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, first.target);
  check('deleted framebuffer handle is rejected', gl.getError(), gl.INVALID_OPERATION);
  checkRead(gl, check, 'deleted handle rejection preserves read target', solid(3, 2, [255, 255, 0, 255]));
}

function validation(gl: WebGLRenderingContext, check: Check, result: ReadPixelsResult) {
  const source = palette(5, 4);
  const target = framebuffer(gl, source, check);
  check('implementation read format', gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), gl.RGBA);
  check('implementation read type', gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE), gl.UNSIGNED_BYTE);
  const buffer = new Uint8Array(112).fill(sentinel);
  const rejected = (label: string, operation: () => void, expectedError: number, bytes: ArrayBufferView = buffer,
    nativeErrorObservationOnly = false) => {
    const before = byteValues(bytes);
    operation();
    const error = gl.getError();
    check(`${label} error`, error, expectedError, nativeErrorObservationOnly);
    check(`${label} destination retained`, byteValues(bytes), before);
    check(`${label} error drained`, gl.getError(), gl.NO_ERROR);
    return error;
  };
  rejected('negative width', () => read(gl, 0, 0, -1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer), gl.INVALID_VALUE);
  rejected('negative height', () => read(gl, 0, 0, 1, -1, gl.RGBA, gl.UNSIGNED_BYTE, buffer), gl.INVALID_VALUE);
  rejected('null destination', () => read(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.INVALID_VALUE);
  rejected('undefined destination', () => read(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, undefined), gl.INVALID_VALUE);
  rejected('insufficient byte span', () => read(gl, 0, 0, 5, 4, gl.RGBA, gl.UNSIGNED_BYTE, buffer.subarray(0, 79)), gl.INVALID_OPERATION);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 8);
  rejected('aligned intermediate rows require padding', () => read(gl, 0, 0, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, buffer.subarray(0, 43)), gl.INVALID_OPERATION);
  const enormousDimensionsError = rejected('enormous dimensions reject before allocation', () =>
    read(gl, 0, 0, 2147483647, 2147483647, gl.RGBA, gl.UNSIGNED_BYTE, buffer), gl.INVALID_OPERATION, buffer, true);
  if (result.backend === 'native') {
    result.observations.enormousDimensions = {
      arguments: { x: 0, y: 0, width: 2147483647, height: 2147483647,
        format: gl.RGBA, type: gl.UNSIGNED_BYTE, destinationByteLength: buffer.byteLength },
      framebuffer: { width: source.width, height: source.height },
      packAlignment: 8,
      error: enormousDimensionsError,
      specificationExpectedError: gl.INVALID_OPERATION,
    };
  }
  for (const [label, destination] of [
    ['Uint16Array', new Uint16Array(56)], ['Float32Array', new Float32Array(28)], ['DataView', new DataView(new ArrayBuffer(112))],
  ] as const) {
    new Uint8Array(destination.buffer).fill(sentinel);
    rejected(`${label} mismatches UNSIGNED_BYTE`, () => read(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, destination), gl.INVALID_OPERATION, destination);
  }
  for (const format of [gl.ALPHA, gl.RGB]) {
    rejected(`unsupported format ${format}`, () => read(gl, 0, 0, 1, 1, format, gl.UNSIGNED_BYTE, buffer), gl.INVALID_OPERATION);
  }
  for (const type of [gl.UNSIGNED_SHORT_5_6_5, gl.UNSIGNED_SHORT_4_4_4_4, gl.UNSIGNED_SHORT_5_5_5_1]) {
    const destination = new Uint16Array(56).fill(0x6d6d);
    rejected(`unsupported packed type ${type}`, () => read(gl, 0, 0, 1, 1, gl.RGBA, type, destination), gl.INVALID_OPERATION, destination);
  }
  for (const format of [gl.LUMINANCE, gl.LUMINANCE_ALPHA, 0xbad]) {
    rejected(`invalid format enum ${format}`, () => read(gl, 0, 0, 1, 1, format, gl.UNSIGNED_BYTE, buffer), gl.INVALID_ENUM);
  }
  for (const type of [gl.FLOAT, gl.UNSIGNED_SHORT, 0xbad]) {
    rejected(`invalid type enum ${type}`, () => read(gl, 0, 0, 1, 1, gl.RGBA, type, buffer), gl.INVALID_ENUM);
  }
  gl.pixelStorei(gl.PACK_ALIGNMENT, 3);
  check('invalid PACK_ALIGNMENT', gl.getError(), gl.INVALID_VALUE);
  check('invalid PACK_ALIGNMENT preserves prior state', gl.getParameter(gl.PACK_ALIGNMENT), 8);
  const incomplete = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, incomplete);
  rejected('incomplete framebuffer', () => read(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer), gl.INVALID_FRAMEBUFFER_OPERATION);
  for (const pname of [gl.IMPLEMENTATION_COLOR_READ_FORMAT, gl.IMPLEMENTATION_COLOR_READ_TYPE]) {
    check(`incomplete framebuffer query ${pname} result`, gl.getParameter(pname), null);
    check(`incomplete framebuffer query ${pname} error`, gl.getError(), gl.INVALID_OPERATION);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.target);
  checkRead(gl, check, 'valid read after invalid calls retains source and state', source, 0, 0, 3, 3, 8);
}

function exceptionName(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

function webidl(gl: WebGLRenderingContext, check: Check, result: ReadPixelsResult) {
  const source = palette(5, 4);
  framebuffer(gl, source, check);
  const destination = new Uint8Array(4).fill(sentinel);
  const arguments_ = [0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, destination];
  for (const [label, operation] of [
    ['missing required destination', () => read(gl, ...arguments_.slice(0, 6))],
    ['plain object destination', () => read(gl, ...arguments_.slice(0, 6), {})],
    ['array destination', () => read(gl, ...arguments_.slice(0, 6), [0, 0, 0, 0])],
    ['ArrayBuffer destination', () => read(gl, ...arguments_.slice(0, 6), new ArrayBuffer(4))],
    ['symbol coordinate', () => read(gl, Symbol('x'), ...arguments_.slice(1))],
    ['BigInt width', () => read(gl, 0, 0, 1n, ...arguments_.slice(3))],
  ] as const) {
    check(`${label} throws TypeError`, exceptionName(operation), 'TypeError');
    check(`${label} creates no GL error`, gl.getError(), gl.NO_ERROR);
    check(`${label} retains existing destination`, Array.from(destination), Array<number>(4).fill(sentinel));
  }
  for (const [label, view, matchingType] of [
    ['Uint8Array', (buffer: ArrayBuffer) => new Uint8Array(buffer), true],
    ['Uint8ClampedArray', (buffer: ArrayBuffer) => new Uint8ClampedArray(buffer), true],
    ['DataView', (buffer: ArrayBuffer) => new DataView(buffer), false],
  ] as const) {
    const storage = new ArrayBuffer(4);
    const detached = view(storage);
    structuredClone(storage, { transfer: [storage] });
    for (const [width, height] of [[1, 1], [0, 1], [1, 0], [0, 0]] as const) {
      const operation = () => read(gl, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, detached);
      check(`detached ${label} ${width}x${height} converts without an exception`, exceptionName(operation), null);
      check(`detached ${label} ${width}x${height} validates its zero-capacity view`, gl.getError(),
        matchingType && (width === 0 || height === 0) ? gl.NO_ERROR : gl.INVALID_OPERATION);
    }
  }
  const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 16 }]) as ArrayBuffer;
  check('resizable-buffer view throws TypeError', exceptionName(() => read(gl, ...arguments_.slice(0, 6), new Uint8Array(resizable))), 'TypeError');
  check('resizable destination creates no GL error', gl.getError(), gl.NO_ERROR);
  result.observations.crossOriginIsolated = crossOriginIsolated;
  check('Wasm shared destination runs on an ordinary page', crossOriginIsolated, false);
  result.observations.sharedConstructorExposed = typeof SharedArrayBuffer !== 'undefined';
  const sharedMemory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const sharedBytes = new Uint8Array(sharedMemory.buffer);
  for (const constructor of [Uint8Array, Uint8ClampedArray]) {
    sharedBytes.fill(sentinel);
    const sharedView = new constructor(sharedMemory.buffer, 5, 4);
    check(`ordinary Wasm shared ${constructor.name} returns undefined`,
      read(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sharedView) === undefined, true);
    check(`ordinary Wasm shared ${constructor.name} error`, gl.getError(), gl.NO_ERROR);
    check(`ordinary Wasm shared ${constructor.name} bytes and sentinels`, Array.from(sharedBytes.subarray(0, 12)),
      [...Array<number>(5).fill(sentinel), ...Array.from(source.pixels.subarray(0, 4)), ...Array<number>(3).fill(sentinel)]);
    check(`ordinary Wasm shared ${constructor.name} suffix`, sharedBytes.at(-1), sentinel);
  }
  const conversions: Record<string, number> = {};
  const converted = new Uint8Array(4).fill(sentinel);
  const numeric = (name: string, value: number) => ({ valueOf() { conversions[name] = (conversions[name] ?? 0) + 1; return value; } });
  read(gl, numeric('x', 4294967296.9), numeric('y', NaN), numeric('width', 1.9), numeric('height', 1.9),
    numeric('format', gl.RGBA + 4294967296), numeric('type', gl.UNSIGNED_BYTE + 4294967296), converted);
  check('WebIDL numeric conversions and truncation', Array.from(converted), Array.from(source.pixels.subarray(0, 4)));
  check('WebIDL converts every numeric argument once', conversions, { x: 1, y: 1, width: 1, height: 1, format: 1, type: 1 });
  check('converted read error', gl.getError(), gl.NO_ERROR);
}

async function loss(context: TestContext, check: Check, result: ReadPixelsResult,
  open: () => Promise<TestContext>) {
  const { gl, canvas, hooks } = context;
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  checkRead(gl, check, 'read before loss', solid(5, 4, [255, 0, 0, 255]));
  const extension = hooks ? null : gl.getExtension('WEBGL_lose_context');
  if (!hooks && !extension) throw new Error('Chrome WEBGL_lose_context is required for the native loss observation');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for webglcontextlost')), 10000);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      clearTimeout(timer);
      resolve();
    }, { once: true });
    if (hooks) hooks.device.destroy();
    else extension!.loseContext();
  });
  check('context is lost', gl.isContextLost(), true);
  const destination = new Uint8Array(80).fill(sentinel);
  check('lost read returns undefined', read(gl, 0, 0, 5, 4, gl.RGBA, gl.UNSIGNED_BYTE, destination) === undefined, true);
  check('lost read leaves destination untouched', Array.from(destination), Array<number>(80).fill(sentinel));
  check('loss emits CONTEXT_LOST_WEBGL once', gl.getError(), gl.CONTEXT_LOST_WEBGL);
  check('loss error is drained', gl.getError(), gl.NO_ERROR);
  result.observations.nativeHasExplicitDispose = false;
  if (hooks) {
    const second = await open();
    await second.hooks!.dispose();
    second.disposed = true;
    const bytes = new Uint8Array(4).fill(sentinel);
    check('disposed read returns undefined', read(second.gl, 0, 0, 1, 1, second.gl.RGBA, second.gl.UNSIGNED_BYTE, bytes) === undefined, true);
    check('disposed read preserves destination', Array.from(bytes), Array<number>(4).fill(sentinel));
    check('disposed context is lost', second.gl.isContextLost(), true);
  }
}

export async function runReadPixelsCase(name: ReadPixelsCaseName, backend: ReadPixelsBackend): Promise<ReadPixelsResult> {
  const result: ReadPixelsResult = {
    name, backend, selectedCore: null, checks: [], observations: {}, contexts: [], shaders: {},
    failure: null, validationErrors: [], cleanupErrors: [],
  };
  const contexts: TestContext[] = [];
  const check: Check = (name, actual, expected, nativeObservationOnly = false) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected), nativeObservationOnly });
  };
  const open = async (alpha = true): Promise<TestContext> => {
    const canvas = document.createElement('canvas');
    canvas.width = 5;
    canvas.height = 4;
    document.body.appendChild(canvas);
    const requestedAttributes = { ...attributes, alpha };
    let gl: WebGLRenderingContext | null;
    let hooks: TestingHooks | null = null;
    if (backend === 'native') gl = canvas.getContext('webgl', requestedAttributes);
    else {
      const { createWebGLOnWebGPU, getTestingHooks } = await import('@refral/webgl');
      gl = await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes: requestedAttributes });
      hooks = getTestingHooks(gl);
    }
    if (!gl) throw new Error('Chrome did not provide a native WebGL context');
    const context = { gl, canvas, hooks, disposed: false };
    contexts.push(context);
    result.selectedCore = hooks?.core ?? 'native';
    result.contexts.push({ selectedCore: hooks?.core ?? 'native', width: canvas.width, height: canvas.height,
      requestedAttributes, actualAttributes: gl.getContextAttributes(),
      environment: hooks?.environment ?? { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) } });
    return context;
  };
  try {
    const context = await open();
    const { gl } = context;
    switch (name) {
      case 'packing-and-destination-views': await packing(gl, check, result); break;
      case 'clipping-and-empty-rectangles': clipping(gl, check, result); break;
      case 'synchronous-draw-clear-and-targets': await drawing(context, check, result, open); break;
      case 'upload-snapshots-and-read-order': uploads(context, check, result); break;
      case 'resize-deletion-and-context-ownership': await lifecycle(context, check, open); break;
      case 'gl-validation-and-state-preservation': validation(gl, check, result); break;
      case 'webidl-conversions-and-view-validation': webidl(gl, check, result); break;
      case 'context-loss-and-disposal': await loss(context, check, result, open); break;
    }
    if (!gl.isContextLost()) check('no unexpected trailing GL error', gl.getError(), gl.NO_ERROR);
  } catch (error) {
    result.failure = error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
  } finally {
    for (const context of contexts) {
      try {
        if (context.hooks && !context.gl.isContextLost()) await context.hooks.device.queue.onSubmittedWorkDone();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (context.hooks) {
          result.validationErrors.push(...context.hooks.errors);
          if (!context.disposed) await context.hooks.dispose();
        } else if (!context.gl.isContextLost()) {
          context.gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
      } catch (error) {
        result.cleanupErrors.push(String(error));
      } finally {
        context.canvas.remove();
      }
    }
  }
  return result;
}
