import { prepareRttContext, rttProgram, rttTextureFragment } from './rtt-cases';
import type { DrawingBackend } from './dual-core-cases';

export const domImageDataCaseNames = [
  'palette-pixel-store',
  'source-snapshots-and-draw-order',
  'subimage-and-storage-replacement',
  'intrinsic-and-cross-realm',
  'webidl-and-error-preservation',
  'scalar-side-effects',
  'five-format-dom-conversion',
  'context-loss',
] as const;
export type DomImageDataCaseName = typeof domImageDataCaseNames[number];

export const domImageDataSources = {
  specification: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#TEXTURE_UPLOAD_SIZE',
  pixelStore: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#PIXEL_STORAGE_PARAMETERS',
  originalGenerator: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-image-data.js',
};

interface Check { name: string; actual: unknown; expected: unknown; passed: boolean }
interface Capture { name: string; width: number; height: number; pixels: number[]; expected: number[] }
export interface DomImageDataResult {
  name: DomImageDataCaseName;
  backend: DrawingBackend;
  selectedCore: DrawingBackend | null;
  checks: Check[];
  captures: Capture[];
  environment: Record<string, unknown>;
  observations: Record<string, unknown>;
  failure: { name: string; message: string } | null;
  validationErrors: string[];
  cleanupErrors: string[];
}

type Context = Awaited<ReturnType<typeof prepareRttContext>>;
type CheckValue = (name: string, actual: unknown, expected: unknown) => void;
type Operation = 'texImage2D' | 'texSubImage2D';
type Format = 'rgba' | 'rgb' | 'alpha' | 'luminance' | 'luminance-alpha';

const palette = [
  255, 31, 63, 0, 7, 101, 201, 1, 133, 17, 239, 127,
  17, 111, 243, 255, 223, 41, 79, 64, 31, 127, 251, 128,
];

function image(bytes: readonly number[] = palette, width = 3, height = 2): ImageData {
  return new ImageData(new Uint8ClampedArray(bytes), width, height, { colorSpace: 'srgb' });
}

function invoke(gl: WebGLRenderingContext, operation: Operation, args: readonly unknown[]): unknown {
  return Reflect.apply(gl[operation], gl, args);
}

function uploadArgs(gl: WebGLRenderingContext, source: unknown, subImage = false, format: number = gl.RGBA): unknown[] {
  return subImage ? [gl.TEXTURE_2D, 0, 0, 0, format, gl.UNSIGNED_BYTE, source]
    : [gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, source];
}

function makeTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function attach(gl: WebGLRenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return framebuffer;
}

/** ImageData supplies tight source RGBA rows. GL row zero takes the first source row before flipping. */
function expectedPixels(bytes: readonly number[], width: number, height: number,
  flip = false, premultiply = false, format: Format = 'rgba'): number[] {
  const result: number[] = [];
  for (let y = 0; y < height; y++) {
    const sourceY = flip ? height - y - 1 : y;
    for (let x = 0; x < width; x++) {
      const offset = (sourceY * width + x) * 4;
      const alpha = bytes[offset + 3]!;
      const factor = premultiply ? alpha / 255 : 1;
      const red = Math.round(bytes[offset]! * factor);
      const green = Math.round(bytes[offset + 1]! * factor);
      const blue = Math.round(bytes[offset + 2]! * factor);
      switch (format) {
        case 'rgba': result.push(red, green, blue, alpha); break;
        case 'rgb': result.push(red, green, blue, 255); break;
        case 'alpha': result.push(0, 0, 0, alpha); break;
        case 'luminance': result.push(red, red, red, 255); break;
        case 'luminance-alpha': result.push(red, red, red, alpha); break;
      }
    }
  }
  return result;
}

function solid(width: number, height: number, color: readonly number[]): number[] {
  const result: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel++) result.push(...color);
  return result;
}

function paste(destination: readonly number[], destinationWidth: number, source: readonly number[],
  width: number, height: number, x: number, y: number): number[] {
  const result = destination.slice();
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const from = (row * width + column) * 4;
      const to = ((row + y) * destinationWidth + column + x) * 4;
      for (let channel = 0; channel < 4; channel++) result[to + channel] = source[from + channel]!;
    }
  }
  return result;
}

function sideBySide(left: readonly number[], right: readonly number[], width = 3, height = 2): number[] {
  const result: number[] = [];
  for (let row = 0; row < height; row++) {
    result.push(...left.slice(row * width * 4, (row + 1) * width * 4),
      ...right.slice(row * width * 4, (row + 1) * width * 4));
  }
  return result;
}

function capture(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue,
  name: string, expected: number[], width = 3, height = 2): void {
  check(`${name} preceding GL error`, gl.getError(), gl.NO_ERROR);
  const pixels = new Uint8Array(width * height * 4);
  const returned = gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const actual = Array.from(pixels);
  check(`${name} synchronous read returns undefined`, returned === undefined, true);
  check(`${name} read error`, gl.getError(), gl.NO_ERROR);
  check(`${name} exact RGBA bytes`, actual, expected);
  result.captures.push({ name, width, height, pixels: actual, expected: expected.slice() });
}

function exception(operation: () => unknown): string | null {
  try { operation(); return null; }
  catch (error) { return error instanceof Error ? error.name : String(error); }
}

function pixelStore(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue): void {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const source = image();
  for (const alignment of [1, 2, 4, 8]) {
    for (const flip of [false, true]) {
      for (const premultiply of [false, true]) {
        for (const colorSpace of [gl.NONE, gl.BROWSER_DEFAULT_WEBGL]) {
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
          const expected = expectedPixels(palette, 3, 2, flip, premultiply);
          for (const subImage of [false, true]) {
            const operation = subImage ? 'texSubImage2D' : 'texImage2D';
            const label = `${operation} alignment ${alignment}, flip ${flip}, premultiply ${premultiply}, colorspace ${colorSpace}`;
            check(`${label} returns undefined`, invoke(gl, operation, uploadArgs(gl, source, subImage)) === undefined, true);
            check(`${label} framebuffer completeness`, gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
            capture(gl, result, check, label, expected);
            check(`${label} alignment remains selected`, gl.getParameter(gl.UNPACK_ALIGNMENT), alignment);
          }
        }
      }
    }
  }
  check('upload leaves caller ImageData bytes intact', Array.from(source.data), palette);
}

function snapshots(context: Context, result: DomImageDataResult, check: CheckValue): void {
  const { gl } = context;
  makeTexture(gl);
  const program = rttProgram(gl, undefined, rttTextureFragment);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  const initial = image();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, initial);
  initial.data.fill(0);
  gl.viewport(0, 0, 3, 2);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const replacement = solid(3, 2, [17, 211, 93, 127]);
  const update = image(replacement);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, update);
  update.data.fill(0);
  gl.viewport(3, 0, 3, 2);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  capture(gl, result, check, 'two draws retain their ImageData content versions', sideBySide(palette, replacement), 6, 2);
  check('source mutation after texImage2D remains caller-visible', Array.from(initial.data), Array<number>(24).fill(0));
  check('source mutation after texSubImage2D remains caller-visible', Array.from(update.data), Array<number>(24).fill(0));

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image());
  gl.viewport(0, 0, 3, 2);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const resized = image(solid(2, 2, [101, 37, 219, 255]), 2, 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resized);
  resized.data.fill(0);
  gl.viewport(3, 0, 3, 2);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  capture(gl, result, check, 'reallocation preserves queued old-storage draws',
    sideBySide(palette, solid(3, 2, [101, 37, 219, 255])), 6, 2);
}

function subimage(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue): void {
  const texture = makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image());
  const framebuffer = attach(gl, texture);
  const source = image([193, 71, 29, 127], 1, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  source.data.fill(0);
  capture(gl, result, check, 'ImageData subimage applies its rectangle and snapshot',
    paste(palette, 3, [193, 71, 29, 127], 1, 1, 1, 0));
  check('attachment returns the original texture wrapper',
    gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === texture, true);
  check('framebuffer binding wrapper identity', gl.getParameter(gl.FRAMEBUFFER_BINDING) === framebuffer, true);
  const resizedBytes = palette.slice().reverse();
  const resized = image(resizedBytes, 2, 3);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resized);
  resized.data.fill(0);
  check('resized attachment remains complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  capture(gl, result, check, 'attached texture storage replacement changes dimensions', resizedBytes, 2, 3);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, image([1, 2, 3, 4], 1, 1));
  check('out-of-bounds ImageData subimage error', gl.getError(), gl.INVALID_VALUE);
  capture(gl, result, check, 'rejected subimage preserves replacement storage', resizedBytes, 2, 3);
}

function brands(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue): void {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const source = image();
  let shadowReads = 0;
  for (const key of ['width', 'height', 'data', 'colorSpace', 'pixelFormat']) {
    Object.defineProperty(source, key, { get() { shadowReads++; throw new Error(`Shadow ${key} must not be read.`); } });
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  capture(gl, result, check, 'ImageData intrinsic metadata bypasses own shadows', palette);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  capture(gl, result, check, 'subimage intrinsic metadata bypasses own shadows', palette);
  check('own source metadata getters are unused', shadowReads, 0);

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    const realm = iframe.contentWindow as Window & typeof globalThis;
    const foreign = new realm.ImageData(new realm.Uint8ClampedArray(palette), 3, 2);
    check('source comes from a separate realm', foreign instanceof ImageData, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, foreign);
    capture(gl, result, check, 'cross-realm genuine ImageData image', palette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, foreign);
    capture(gl, result, check, 'cross-realm genuine ImageData subimage', palette);
  } finally { iframe.remove(); }
}

function validation(context: Context, result: DomImageDataResult, check: CheckValue): void {
  const { gl, hooks } = context;
  const texture = makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image());
  attach(gl, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
  const reject = (label: string, operation: Operation, args: unknown[], expectedException: string | null,
    expectedError: number) => {
    const before = hooks?.stats.uploadedBytes;
    check(`${label} exception`, exception(() => invoke(gl, operation, args)), expectedException);
    check(`${label} GL error`, gl.getError(), expectedError);
    if (hooks) check(`${label} upload byte counter`, hooks.stats.uploadedBytes, before);
    check(`${label} binding retained`, gl.getParameter(gl.TEXTURE_BINDING_2D) === texture, true);
    check(`${label} unpack alignment retained`, gl.getParameter(gl.UNPACK_ALIGNMENT), 8);
    capture(gl, result, check, `${label} previous image survives`, palette);
  };
  const fake = { width: 3, height: 2, data: new Uint8ClampedArray(palette), [Symbol.toStringTag]: 'ImageData' };
  for (const [name, source] of [
    ['plain object', fake], ['forged prototype', Object.create(ImageData.prototype)],
    ['proxy', new Proxy(image(), {})], ['null', null], ['undefined', undefined],
    ['typed array', new Uint8ClampedArray(palette)], ['DataView', new DataView(new ArrayBuffer(24))],
  ] as const) {
    reject(`${name} image`, 'texImage2D', uploadArgs(gl, source), 'TypeError', gl.NO_ERROR);
    reject(`${name} subimage`, 'texSubImage2D', uploadArgs(gl, source, true), 'TypeError', gl.NO_ERROR);
  }
  for (const [operation, minimum] of [['texImage2D', 6], ['texSubImage2D', 7]] as const) {
    const normal = uploadArgs(gl, image(), operation === 'texSubImage2D');
    reject(`${operation} missing source`, operation, normal.slice(0, minimum - 1), 'TypeError', gl.NO_ERROR);
    reject(`${operation} one surplus DOM argument`, operation, [...normal, 0], 'TypeError', gl.NO_ERROR);
    if (operation === 'texImage2D') reject('texImage2D two surplus DOM arguments', operation,
      [...normal, 0, 0], 'TypeError', gl.NO_ERROR);
  }
  reject('symbol target', 'texImage2D', [Symbol('target'), ...uploadArgs(gl, image()).slice(1)], 'TypeError', gl.NO_ERROR);
  reject('BigInt level', 'texImage2D', [gl.TEXTURE_2D, 0n, ...uploadArgs(gl, image()).slice(2)], 'TypeError', gl.NO_ERROR);
  for (const [name, index, value, error] of [
    ['bad target', 0, 0xbad, gl.INVALID_ENUM], ['negative level', 1, -1, gl.INVALID_VALUE],
    ['mismatched internal format', 2, gl.RGB, gl.INVALID_OPERATION],
    ['bad format', 3, 0xbad, gl.INVALID_ENUM], ['bad type', 4, 0xbad, gl.INVALID_ENUM],
  ] as const) {
    const args = uploadArgs(gl, image()); args[index] = value;
    reject(name, 'texImage2D', args, null, error);
  }
  const detached = image();
  structuredClone(detached.data.buffer, { transfer: [detached.data.buffer] });
  for (const subImage of [false, true]) {
    const operation = subImage ? 'texSubImage2D' : 'texImage2D';
    reject(`${operation} detached source`, operation, uploadArgs(gl, detached, subImage), null, gl.INVALID_VALUE);
    const badTarget = uploadArgs(gl, detached, subImage); badTarget[0] = 0xbad;
    reject(`${operation} detached source precedes bad target`, operation, badTarget, null, gl.INVALID_VALUE);
    const badLevel = uploadArgs(gl, detached, subImage); badLevel[1] = -1;
    reject(`${operation} detached source precedes negative level`, operation, badLevel, null, gl.INVALID_VALUE);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  check('unbound valid source reports INVALID_OPERATION',
    exception(() => invoke(gl, 'texImage2D', uploadArgs(gl, image()))), null);
  check('unbound valid source error', gl.getError(), gl.INVALID_OPERATION);
  check('unbound detached source reports INVALID_VALUE',
    exception(() => invoke(gl, 'texImage2D', uploadArgs(gl, detached))), null);
  check('source availability precedes missing binding', gl.getError(), gl.INVALID_VALUE);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.enable(0xbad);
  check('WebIDL failure with a pending GL error throws TypeError',
    exception(() => invoke(gl, 'texImage2D', uploadArgs(gl, fake))), 'TypeError');
  check('WebIDL failure preserves the pending error', gl.getError(), gl.INVALID_ENUM);
  check('WebIDL failure adds no subsequent error', gl.getError(), gl.NO_ERROR);
  capture(gl, result, check, 'valid image remains after rejected calls', palette);
}

function scalarEffects(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue): void {
  const first = makeTexture(gl);
  const original = solid(3, 2, [255, 0, 0, 255]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image(original));
  const second = makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image());
  gl.bindTexture(gl.TEXTURE_2D, first);
  const source = image();
  const updated = palette.map((value, index) => index % 4 === 3 ? value : 255 - value);
  const calls: string[] = [];
  const numeric = (name: string, value: number, effect = () => {}) => ({ valueOf() { calls.push(name); effect(); return value; } });
  const args = [numeric('target', gl.TEXTURE_2D + 0x1_0000_0000), numeric('level', 0.9),
    numeric('internalFormat', gl.RGBA + 0x1_0000_0000), numeric('format', gl.RGBA + 0x1_0000_0000),
    numeric('type', gl.UNSIGNED_BYTE + 0x1_0000_0000, () => {
      gl.bindTexture(gl.TEXTURE_2D, second);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      source.data.set(updated);
    }), source];
  check('scalar-converted image return', invoke(gl, 'texImage2D', args) === undefined, true);
  check('image numeric conversions execute once in order', calls, ['target', 'level', 'internalFormat', 'format', 'type']);
  check('binding changes during scalar conversion take effect', gl.getParameter(gl.TEXTURE_BINDING_2D) === second, true);
  attach(gl, second);
  const secondExpected = expectedPixels(updated, 3, 2, true, true);
  capture(gl, result, check, 'source and unpack changes precede ImageData snapshot', secondExpected);
  attach(gl, first);
  capture(gl, result, check, 'original binding retains its image', original);

  const patchBytes = [51, 101, 151, 127, 13, 67, 199, 255];
  const patch = image(patchBytes, 1, 2);
  calls.length = 0;
  gl.bindTexture(gl.TEXTURE_2D, second);
  const patchArgs = [numeric('target', gl.TEXTURE_2D), numeric('level', 0), numeric('x', 1.9), numeric('y', 0.9),
    numeric('format', gl.RGBA), numeric('type', gl.UNSIGNED_BYTE, () => {
      gl.bindTexture(gl.TEXTURE_2D, first);
      patch.data.set(patchBytes);
    }), patch];
  invoke(gl, 'texSubImage2D', patchArgs);
  check('subimage numeric conversions execute once in order', calls, ['target', 'level', 'x', 'y', 'format', 'type']);
  check('subimage conversion selects the new binding', gl.getParameter(gl.TEXTURE_BINDING_2D) === first, true);
  const patched = paste(original, 3, expectedPixels(patchBytes, 1, 2, true, true), 1, 2, 1, 0);
  capture(gl, result, check, 'subimage honors scalar conversion side effects', patched);
  const detachDuringConversion = image();
  const detachCalls: string[] = [];
  const detachType = { valueOf() {
    detachCalls.push('type');
    structuredClone(detachDuringConversion.data.buffer, { transfer: [detachDuringConversion.data.buffer] });
    return gl.UNSIGNED_BYTE;
  } };
  invoke(gl, 'texImage2D', [gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, detachType, detachDuringConversion]);
  check('type conversion detaches once before source validation', detachCalls, ['type']);
  check('source detached during conversion error', gl.getError(), gl.INVALID_VALUE);
  capture(gl, result, check, 'conversion-time detachment retains previous pixels', patched);
}

function formats(gl: WebGLRenderingContext, result: DomImageDataResult, check: CheckValue): void {
  makeTexture(gl);
  const program = rttProgram(gl, undefined, rttTextureFragment);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  gl.viewport(0, 0, 3, 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
  for (const [name, format] of [
    ['rgba', gl.RGBA], ['rgb', gl.RGB], ['alpha', gl.ALPHA],
    ['luminance', gl.LUMINANCE], ['luminance-alpha', gl.LUMINANCE_ALPHA],
  ] as const) {
    for (const subImage of [false, true]) {
      const operation = subImage ? 'texSubImage2D' : 'texImage2D';
      invoke(gl, operation, uploadArgs(gl, image(), subImage, format));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      capture(gl, result, check, `${name} ${operation} converts source RGBA`, expectedPixels(palette, 3, 2, false, false, name));
    }
  }
}

async function loss(context: Context, result: DomImageDataResult, check: CheckValue): Promise<void> {
  const { gl, hooks, canvas } = context;
  makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image());
  const lose = hooks ? null : gl.getExtension('WEBGL_lose_context');
  if (!hooks && !lose) throw new Error('Native context-loss extension is required.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Context loss was not observed.')), 10000);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); clearTimeout(timer); resolve();
    }, { once: true });
    if (hooks) hooks.device.destroy(); else lose!.loseContext();
  });
  check('context loss is observed', gl.isContextLost(), true);
  check('loss error occurs once', gl.getError(), gl.CONTEXT_LOST_WEBGL);
  check('loss error is drained', gl.getError(), gl.NO_ERROR);
  const source = image();
  const conversions: string[] = [];
  const numeric = (name: string, value: number) => ({ valueOf() { conversions.push(name); return value; } });
  const uploaded = hooks?.stats.uploadedBytes;
  check('lost context still converts public arguments', exception(() => invoke(gl, 'texImage2D', [
    numeric('target', gl.TEXTURE_2D), numeric('level', 0), numeric('internalFormat', gl.RGBA),
    numeric('format', gl.RGBA), numeric('type', gl.UNSIGNED_BYTE), source,
  ])), null);
  check('lost context numeric conversion order', conversions, ['target', 'level', 'internalFormat', 'format', 'type']);
  check('lost valid DOM upload adds no GL error', gl.getError(), gl.NO_ERROR);
  check('lost DOM upload rejects wrong WebIDL source',
    exception(() => invoke(gl, 'texSubImage2D', uploadArgs(gl, {}, true))), 'TypeError');
  check('lost wrong source adds no GL error', gl.getError(), gl.NO_ERROR);
  if (hooks) check('lost DOM upload creates no uploaded bytes', hooks.stats.uploadedBytes, uploaded);
  result.observations.contextLossSource = hooks ? 'GPUDevice.destroy' : 'WEBGL_lose_context';
}

export async function runDomImageDataCase(name: DomImageDataCaseName, backend: DrawingBackend): Promise<DomImageDataResult> {
  const result: DomImageDataResult = { name, backend, selectedCore: null, checks: [], captures: [],
    environment: {}, observations: {}, failure: null, validationErrors: [], cleanupErrors: [] };
  const check: CheckValue = (name, actual, expected) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
  };
  let context: Context | null = null;
  try {
    context = await prepareRttContext(backend, 6, 2, true);
    result.selectedCore = context.selectedCore;
    result.environment = context.environment;
    result.observations.sourceEncoding = { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' };
    const { gl } = context;
    switch (name) {
      case 'palette-pixel-store': pixelStore(gl, result, check); break;
      case 'source-snapshots-and-draw-order': snapshots(context, result, check); break;
      case 'subimage-and-storage-replacement': subimage(gl, result, check); break;
      case 'intrinsic-and-cross-realm': brands(gl, result, check); break;
      case 'webidl-and-error-preservation': validation(context, result, check); break;
      case 'scalar-side-effects': scalarEffects(gl, result, check); break;
      case 'five-format-dom-conversion': formats(gl, result, check); break;
      case 'context-loss': await loss(context, result, check); break;
    }
    if (!gl.isContextLost()) check('no trailing GL error', gl.getError(), gl.NO_ERROR);
  } catch (error) {
    result.failure = error instanceof Error ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  } finally {
    if (context) {
      try {
        if (context.hooks && !context.gl.isContextLost()) await context.hooks.device.queue.onSubmittedWorkDone();
        await new Promise(resolve => setTimeout(resolve, 0));
        result.validationErrors = context.hooks?.errors.slice() ?? [];
      } catch (error) { result.cleanupErrors.push(String(error)); }
      try { await context.dispose(); }
      catch (error) { result.cleanupErrors.push(String(error)); }
    }
  }
  return result;
}
