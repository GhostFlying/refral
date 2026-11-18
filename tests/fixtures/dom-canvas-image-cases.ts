import { prepareRttContext, rttProgram, rttTextureFragment } from './rtt-cases';
import type { DrawingBackend } from './dual-core-cases';

export const domCanvasImageCaseNames = [
  'canvas-pixel-store',
  'canvas-snapshot-update-resize',
  'source-context-ordering',
  'source-context-alpha-and-loss',
  'png-palette-transforms',
  'packed-formats',
  'image-dimensions',
  'intrinsic-and-cross-realm',
  'invalid-and-security-sources',
  'icc-color-space',
] as const;
export type DomCanvasImageCaseName = typeof domCanvasImageCaseNames[number];

export const domCanvasImagePalette = [
  11, 77, 203, 0, 253, 111, 17, 1, 35, 221, 92, 127, 192, 64, 255, 255,
  229, 35, 109, 255, 193, 107, 41, 127, 67, 203, 149, 1, 155, 19, 231, 0,
];
export const domCanvasImageSourceReferences = {
  textureUpload: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#TEXTURE_UPLOAD_SIZE',
  pixelStore: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#PIXEL_STORAGE_PARAMETERS',
  originalCanvasGenerator: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-canvas.js',
  originalImageGenerator: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-image.js',
};

export interface DomCanvasImageAssets {
  palettePng: string;
  singlePng: string;
  alternatePng: string;
  profilePng: string;
  brokenPng: string;
  crossOriginPng: string;
  corsPng: string;
  svg: string;
}
interface Check { name: string; actual: unknown; expected: unknown; passed: boolean }
interface Capture {
  name: string;
  width: number;
  height: number;
  pixels: number[];
  expected: number[] | null;
  expectation: 'specification' | 'native-browser-colorspace' | 'native-source-alpha';
}
export interface DomCanvasImageResult {
  name: DomCanvasImageCaseName;
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
type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function pixels(width: number, height: number, color: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < width * height; index++) result.push(...color);
  return result;
}

function transform(source: readonly number[], width: number, height: number, flip: boolean, premultiply: boolean): number[] {
  const result: number[] = [];
  for (let row = 0; row < height; row++) {
    const sourceRow = flip ? height - row - 1 : row;
    for (let column = 0; column < width; column++) {
      const offset = (sourceRow * width + column) * 4;
      const alpha = source[offset + 3]!;
      const factor = premultiply ? alpha / 255 : 1;
      result.push(Math.round(source[offset]! * factor), Math.round(source[offset + 1]! * factor),
        Math.round(source[offset + 2]! * factor), alpha);
    }
  }
  return result;
}

function horizontal(left: readonly number[], right: readonly number[], width = 4, height = 2): number[] {
  const result: number[] = [];
  for (let row = 0; row < height; row++) {
    result.push(...left.slice(row * width * 4, (row + 1) * width * 4),
      ...right.slice(row * width * 4, (row + 1) * width * 4));
  }
  return result;
}

function makeTexture(gl: WebGLRenderingContext, width = 4, height = 2): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return texture;
}

function attach(gl: WebGLRenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return framebuffer;
}

function upload(gl: WebGLRenderingContext, source: unknown, subImage = false, target: number = gl.TEXTURE_2D): unknown {
  return subImage
    ? Reflect.apply(gl.texSubImage2D, gl, [target, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source])
    : Reflect.apply(gl.texImage2D, gl, [target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source]);
}

function capture(gl: WebGLRenderingContext, result: DomCanvasImageResult, check: CheckValue,
  name: string, expected: number[] | null, width = 4, height = 2,
  nativeExpectation: 'native-browser-colorspace' | 'native-source-alpha' = 'native-browser-colorspace'): void {
  check(`${name} preceding GL error`, gl.getError(), gl.NO_ERROR);
  const destination = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, destination);
  const actual = Array.from(destination);
  check(`${name} read error`, gl.getError(), gl.NO_ERROR);
  if (expected) check(`${name} exact bytes`, actual, expected);
  result.captures.push({ name, width, height, pixels: actual, expected: expected?.slice() ?? null,
    expectation: expected ? 'specification' : nativeExpectation });
}

function exception(operation: () => unknown): string | null {
  try { operation(); return null; }
  catch (error) { return error instanceof Error ? error.name : String(error); }
}

function paint(context: Context2D, width: number, height: number, source: readonly number[]): number[] {
  context.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
  return Array.from(context.getImageData(0, 0, width, height).data);
}

function sourceCanvas(offscreen: boolean, width = 4, height = 2): { canvas: Canvas; context: Context2D } {
  const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }) as Context2D | null;
  if (!context) throw new Error('The source Canvas2D context is unavailable.');
  return { canvas, context };
}

async function loadImage(url: string, options: { cors?: boolean; density?: boolean; width?: number; height?: number;
  ImageConstructor?: typeof Image } = {}): Promise<HTMLImageElement> {
  const Constructor = options.ImageConstructor ?? Image;
  const image = new Constructor();
  if (options.cors) image.crossOrigin = 'anonymous';
  if (options.width !== undefined) image.width = options.width;
  if (options.height !== undefined) image.height = options.height;
  if (options.density) image.srcset = `${url} 2x`;
  image.src = url;
  await image.decode();
  return image;
}

function canvasPixelStore(gl: WebGLRenderingContext, result: DomCanvasImageResult, check: CheckValue): void {
  const texture = makeTexture(gl, 3, 2);
  attach(gl, texture);
  for (const offscreen of [false, true]) {
    const source = sourceCanvas(offscreen, 3, 2);
    const actualSource = paint(source.context, 3, 2, domCanvasImagePalette.slice(0, 24));
    result.observations[offscreen ? 'offscreenSourceBytes' : 'canvasSourceBytes'] = actualSource;
    for (const alignment of [1, 8]) {
      for (const flip of [false, true]) {
        for (const premultiply of [false, true]) {
          for (const colorSpace of [gl.NONE, gl.BROWSER_DEFAULT_WEBGL]) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
            for (const subImage of [false, true]) {
              const label = `${offscreen ? 'OffscreenCanvas' : 'HTMLCanvas'} sub ${subImage} align ${alignment} flip ${flip} pma ${premultiply} space ${colorSpace}`;
              check(`${label} return`, upload(gl, source.canvas, subImage) === undefined, true);
              capture(gl, result, check, label, transform(actualSource, 3, 2, flip, premultiply), 3, 2);
            }
          }
        }
      }
    }
  }
}

function canvasSnapshots(gl: WebGLRenderingContext, result: DomCanvasImageResult, check: CheckValue): void {
  makeTexture(gl);
  const program = rttProgram(gl, undefined, rttTextureFragment);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  for (const offscreen of [false, true]) {
    const source = sourceCanvas(offscreen);
    const first = paint(source.context, 4, 2, pixels(4, 2, [255, 0, 0, 255]));
    upload(gl, source.canvas);
    const second = paint(source.context, 4, 2, pixels(4, 2, [0, 255, 0, 255]));
    gl.viewport(0, 0, 4, 2); gl.drawArrays(gl.TRIANGLES, 0, 6);
    upload(gl, source.canvas, true);
    paint(source.context, 4, 2, pixels(4, 2, [0, 0, 255, 255]));
    gl.viewport(4, 0, 4, 2); gl.drawArrays(gl.TRIANGLES, 0, 6);
    capture(gl, result, check, `Canvas snapshot and queued updates offscreen ${offscreen}`, horizontal(first, second), 8, 2);
    gl.viewport(0, 0, 4, 2); gl.drawArrays(gl.TRIANGLES, 0, 6);
    source.canvas.width = 2; source.canvas.height = 1;
    paint(source.context, 2, 1, pixels(2, 1, [255, 255, 0, 255]));
    upload(gl, source.canvas);
    paint(source.context, 2, 1, pixels(2, 1, [255, 0, 255, 255]));
    gl.viewport(4, 0, 4, 2); gl.drawArrays(gl.TRIANGLES, 0, 6);
    capture(gl, result, check, `Canvas resize preserves old draw offscreen ${offscreen}`,
      horizontal(second, pixels(4, 2, [255, 255, 0, 255])), 8, 2);
  }
}

async function sourceOrdering(context: Context, result: DomCanvasImageResult, check: CheckValue,
  contexts: Context[]): Promise<void> {
  const { gl } = context;
  const source = await prepareRttContext(result.backend, 4, 2, false);
  contexts.push(source);
  result.observations.sourceContext = { selectedCore: source.selectedCore, environment: source.environment };
  source.gl.clearColor(1, 0, 0, 1); source.gl.clear(source.gl.COLOR_BUFFER_BIT);
  const sourceTexture = makeTexture(source.gl);
  const sourceFramebuffer = attach(source.gl, sourceTexture);
  source.gl.clearColor(0, 0, 1, 1); source.gl.clear(source.gl.COLOR_BUFFER_BIT);
  const destination = makeTexture(gl);
  attach(gl, destination);
  upload(gl, source.canvas);
  check('source framebuffer binding survives canvas extraction', source.gl.getParameter(source.gl.FRAMEBUFFER_BINDING) === sourceFramebuffer, true);
  capture(gl, result, check, 'source canvas reads pending default contents with an FBO bound', pixels(4, 2, [255, 0, 0, 255]));
  source.gl.bindFramebuffer(source.gl.FRAMEBUFFER, null);
  source.gl.clearColor(0, 1, 0, 1); source.gl.clear(source.gl.COLOR_BUFFER_BIT);
  upload(gl, source.canvas, true);
  capture(gl, result, check, 'same-task source clear is visible to destination upload', pixels(4, 2, [0, 255, 0, 255]));

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const selfTexture = makeTexture(gl, 8, 4);
  const selfFramebuffer = attach(gl, selfTexture);
  gl.clearColor(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  upload(gl, context.canvas);
  check('same-context canvas upload retains the destination FBO', gl.getParameter(gl.FRAMEBUFFER_BINDING) === selfFramebuffer, true);
  capture(gl, result, check, 'same-context canvas source selects the default drawing buffer', pixels(8, 4, [255, 0, 255, 255]), 8, 4);
}

async function sourceAlphaAndLoss(context: Context, result: DomCanvasImageResult, check: CheckValue,
  contexts: Context[]): Promise<void> {
  const { gl, hooks } = context;
  const source = await prepareRttContext(result.backend, 4, 2, true);
  contexts.push(source);
  const sourceTexture = makeTexture(source.gl);
  const sourceFramebuffer = attach(source.gl, sourceTexture);
  const destination = makeTexture(gl);
  attach(gl, destination);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  result.observations.alphaSourceContext = { selectedCore: source.selectedCore,
    attributes: source.gl.getContextAttributes(), environment: source.environment,
    comparison: 'Public native Canvas source alpha conversion with byte-exact JS/Rust destination results.' };
  for (const alpha of [0, 1, 127, 255]) {
    for (const premultiply of [false, true]) {
      source.gl.bindFramebuffer(source.gl.FRAMEBUFFER, null);
      source.gl.clearColor(11 / 255, 77 / 255, 203 / 255, alpha / 255);
      source.gl.clear(source.gl.COLOR_BUFFER_BIT);
      source.gl.bindFramebuffer(source.gl.FRAMEBUFFER, sourceFramebuffer);
      source.gl.clearColor(0, 1, 0, 1);
      source.gl.clear(source.gl.COLOR_BUFFER_BIT);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
      for (const subImage of [false, true]) {
        const name = `source context alpha ${alpha}, destination premultiply ${premultiply}, sub ${subImage}`;
        upload(gl, source.canvas, subImage);
        check(`${name} source framebuffer binding survives`,
          source.gl.getParameter(source.gl.FRAMEBUFFER_BINDING) === sourceFramebuffer, true);
        check(`${name} source GL error`, source.gl.getError(), source.gl.NO_ERROR);
        capture(gl, result, check, name, null, 4, 2, 'native-source-alpha');
      }
    }
  }
  const previous = result.captures.at(-1)!.pixels.slice();
  const lose = source.hooks ? null : source.gl.getExtension('WEBGL_lose_context');
  if (!source.hooks && !lose) throw new Error('Native source context-loss extension is required.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Source context loss was not observed.')), 10000);
    source.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); clearTimeout(timer); resolve();
    }, { once: true });
    if (source.hooks) source.hooks.device.destroy(); else lose!.loseContext();
  });
  check('source context loss is observed', source.gl.isContextLost(), true);
  for (const subImage of [false, true]) {
    const before = hooks?.stats.uploadedBytes;
    const name = `lost source context sub ${subImage}`;
    check(`${name} returns without a WebIDL exception`, exception(() => upload(gl, source.canvas, subImage)), null);
    check(`${name} destination GL error`, gl.getError(), gl.INVALID_OPERATION);
    if (hooks) check(`${name} destination upload counter`, hooks.stats.uploadedBytes, before);
    check(`${name} destination binding survives`, gl.getParameter(gl.TEXTURE_BINDING_2D) === destination, true);
    check(`${name} destination framebuffer stays complete`, gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    capture(gl, result, check, `${name} retains destination pixels`, previous);
  }
}

async function pngTransforms(gl: WebGLRenderingContext, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const image = await loadImage(assets.palettePng);
  for (const colorSpace of [gl.NONE, gl.BROWSER_DEFAULT_WEBGL]) {
    for (const flip of [false, true]) {
      for (const premultiply of [false, true]) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
        for (const subImage of [false, true]) {
          const label = `plain PNG sub ${subImage} flip ${flip} pma ${premultiply} space ${colorSpace}`;
          upload(gl, image, subImage);
          capture(gl, result, check, label, transform(domCanvasImagePalette, 4, 2, flip, premultiply));
        }
      }
    }
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  upload(gl, image);
  image.src = assets.alternatePng;
  capture(gl, result, check, 'image src changes after return retain the captured source', domCanvasImagePalette);
  await image.decode();
  upload(gl, image, true);
  capture(gl, result, check, 'decoded replacement image updates the texture', pixels(4, 2, [19, 211, 73, 255]));
}

function doubled(source: readonly number[], width = 4, height = 2): number[] {
  const result: number[] = [];
  for (let row = 0; row < height * 2; row++) {
    for (let column = 0; column < width * 2; column++) {
      const offset = (Math.floor(row / 2) * width + Math.floor(column / 2)) * 4;
      result.push(...source.slice(offset, offset + 4));
    }
  }
  return result;
}

async function dimensions(gl: WebGLRenderingContext, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const raster = await loadImage(assets.palettePng, { width: 12, height: 6 });
  upload(gl, raster);
  capture(gl, result, check, 'raster CSS dimensions retain decoded pixel extent', domCanvasImagePalette);
  const dense = await loadImage(assets.palettePng, { density: true, width: 4, height: 2 });
  check('srcset density-corrected natural dimensions', [dense.naturalWidth, dense.naturalHeight], [2, 1]);
  result.observations.density = { width: dense.width, height: dense.height,
    naturalWidth: dense.naturalWidth, naturalHeight: dense.naturalHeight, expectedUploadWidth: 4, expectedUploadHeight: 2 };
  upload(gl, dense);
  capture(gl, result, check, 'srcset density preserves encoded raster pixel extent', domCanvasImagePalette);
  const single = await loadImage(assets.singlePng, { density: true, width: 1, height: 1 });
  result.observations.singleDensity = { width: single.width, height: single.height,
    naturalWidth: single.naturalWidth, naturalHeight: single.naturalHeight, expectedUploadWidth: 1, expectedUploadHeight: 1 };
  upload(gl, single);
  capture(gl, result, check, 'one-pixel srcset image remains a valid decoded source', domCanvasImagePalette.slice(0, 4), 1, 1);
  const svg = await loadImage(assets.svg);
  const opaque = domCanvasImagePalette.map((value, index) => index % 4 === 3 ? 255 : value);
  upload(gl, svg);
  capture(gl, result, check, 'SVG default rasterization dimensions', opaque);
  svg.width = 8; svg.height = 4;
  upload(gl, svg);
  capture(gl, result, check, 'SVG width attributes select its rasterization dimensions', doubled(opaque), 8, 4);
}

async function brands(gl: WebGLRenderingContext, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const source = sourceCanvas(false);
  const expected = paint(source.context, 4, 2, pixels(4, 2, [47, 113, 229, 255]));
  let shadowReads = 0;
  for (const name of ['width', 'height', 'getContext']) {
    Object.defineProperty(source.canvas, name, { get() { shadowReads++; throw new Error(`Own ${name} getter was invoked.`); } });
  }
  upload(gl, source.canvas);
  capture(gl, result, check, 'Canvas intrinsic metadata bypasses own shadows', expected);
  const image = await loadImage(assets.palettePng);
  for (const name of ['width', 'height', 'naturalWidth', 'naturalHeight', 'complete', 'currentSrc']) {
    Object.defineProperty(image, name, { get() { shadowReads++; throw new Error(`Own ${name} getter was invoked.`); } });
  }
  upload(gl, image);
  capture(gl, result, check, 'HTMLImage intrinsic metadata bypasses own shadows', domCanvasImagePalette);
  check('own source getters are unused', shadowReads, 0);
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    const realm = iframe.contentWindow as Window & typeof globalThis;
    const canvas = realm.document.createElement('canvas'); canvas.width = 4; canvas.height = 2;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
    const foreignExpected = paint(context, 4, 2, pixels(4, 2, [127, 63, 239, 255]));
    check('Canvas belongs to a separate realm', canvas instanceof HTMLCanvasElement, false);
    upload(gl, canvas);
    capture(gl, result, check, 'cross-realm Canvas upload', foreignExpected);
    const offscreen = new realm.OffscreenCanvas(4, 2);
    const offscreenExpected = paint(offscreen.getContext('2d')!, 4, 2, pixels(4, 2, [23, 151, 79, 255]));
    upload(gl, offscreen);
    capture(gl, result, check, 'cross-realm OffscreenCanvas upload', offscreenExpected);
    const foreignImage = await loadImage(assets.palettePng, { ImageConstructor: realm.Image });
    check('HTMLImage belongs to a separate realm', foreignImage instanceof HTMLImageElement, false);
    upload(gl, foreignImage);
    capture(gl, result, check, 'cross-realm HTMLImage upload', domCanvasImagePalette);
  } finally { iframe.remove(); }
}

async function invalid(context: Context, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const { gl, hooks } = context;
  const texture = makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
    new ImageData(new Uint8ClampedArray(domCanvasImagePalette), 4, 2));
  attach(gl, texture);
  const reject = (name: string, source: unknown, expectedException: string | null, expectedError: number,
    badTarget = false, subImage = false, nativeError?: number) => {
    const before = hooks?.stats.uploadedBytes;
    check(`${name} exception`, exception(() => upload(gl, source, subImage, badTarget ? 0xbad : gl.TEXTURE_2D)), expectedException);
    const actualError = gl.getError();
    check(`${name} GL error`, actualError, result.backend === 'native' ? nativeError ?? expectedError : expectedError);
    if (nativeError !== undefined && nativeError !== expectedError) {
      result.observations[name] = { actualError, nativeExpectedError: nativeError, coreExpectedError: expectedError,
        reason: 'The source and target are both invalid. The native branch validates the target first.' };
    }
    if (hooks) check(`${name} destination upload counter`, hooks.stats.uploadedBytes, before);
    check(`${name} binding survives`, gl.getParameter(gl.TEXTURE_BINDING_2D) === texture, true);
    capture(gl, result, check, `${name} previous texture remains`, domCanvasImagePalette);
  };
  const zeroCanvas = document.createElement('canvas'); zeroCanvas.width = 0;
  const zeroOffscreen = new OffscreenCanvas(0, 2);
  const unloaded = new Image();
  const broken = new Image();
  broken.src = assets.brokenPng;
  await broken.decode().catch(() => {});
  check('broken image decode has completed', broken.complete, true);
  for (const [name, source] of [
    ['zero Canvas', zeroCanvas], ['zero OffscreenCanvas', zeroOffscreen],
    ['unloaded image', unloaded], ['broken image', broken],
  ] as const) {
    for (const subImage of [false, true]) {
      reject(`${name} sub ${subImage}`, source, null, gl.INVALID_VALUE, false, subImage);
      reject(`${name} precedes bad target sub ${subImage}`, source, null, gl.INVALID_VALUE, true, subImage,
        name === 'broken image' ? gl.INVALID_ENUM : gl.INVALID_VALUE);
    }
  }
  for (const source of [new Proxy(document.createElement('canvas'), {}),
    { width: 4, height: 2, [Symbol.toStringTag]: 'HTMLCanvasElement' },
    new Proxy(new Image(), {}), { naturalWidth: 4, naturalHeight: 2, [Symbol.toStringTag]: 'HTMLImageElement' }]) {
    reject('forged/proxy source', source, 'TypeError', gl.NO_ERROR);
  }
  const crossOrigin = await loadImage(assets.crossOriginPng);
  const tainted = sourceCanvas(false);
  tainted.context.drawImage(crossOrigin, 0, 0);
  check('cross-origin source taints its Canvas2D backing',
    exception(() => tainted.context.getImageData(0, 0, 4, 2)), 'SecurityError');
  for (const [name, source] of [['tainted Canvas', tainted.canvas], ['tainted image', crossOrigin]] as const) {
    for (const subImage of [false, true]) {
      reject(`${name} sub ${subImage}`, source, 'SecurityError', gl.NO_ERROR, false, subImage);
      reject(`${name} precedes bad target sub ${subImage}`, source, 'SecurityError', gl.NO_ERROR, true, subImage);
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  check('security validation precedes a missing destination binding',
    exception(() => upload(gl, crossOrigin)), 'SecurityError');
  check('security failure with no destination adds no GL error', gl.getError(), gl.NO_ERROR);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const cors = await loadImage(assets.corsPng, { cors: true });
  upload(gl, cors);
  capture(gl, result, check, 'CORS-readable image uploads its encoded bytes', domCanvasImagePalette);
  result.observations.origins = { page: location.origin, crossOrigin: new URL(assets.crossOriginPng).origin,
    cors: new URL(assets.corsPng).origin };
}

async function icc(gl: WebGLRenderingContext, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const texture = makeTexture(gl);
  attach(gl, texture);
  const image = await loadImage(assets.profilePng);
  for (const colorSpace of [gl.NONE, gl.BROWSER_DEFAULT_WEBGL]) {
    for (const flip of [false, true]) {
      for (const premultiply of [false, true]) {
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
        for (const subImage of [false, true]) {
          const label = `ICC PNG sub ${subImage} flip ${flip} pma ${premultiply} space ${colorSpace}`;
          upload(gl, image, subImage);
          const expected = colorSpace === gl.NONE ? transform(domCanvasImagePalette, 4, 2, flip, premultiply) : null;
          capture(gl, result, check, label, expected);
        }
      }
    }
  }
  result.observations.defaultColorSpaceExpectation = 'Current browser-selected ICC conversion is compared byte-exactly with the public native backend.';
}

async function packedFormats(gl: WebGLRenderingContext, assets: DomCanvasImageAssets,
  result: DomCanvasImageResult, check: CheckValue): Promise<void> {
  const image = await loadImage(assets.palettePng);
  const alternate = await loadImage(assets.alternatePng);
  const alternateBytes = pixels(4, 2, [19, 211, 73, 255]);
  const imageData = new ImageData(new Uint8ClampedArray(domCanvasImagePalette), 4, 2);
  const canvasPalette = [
    53, 123, 199, 255, 170, 102, 85, 255, 221, 153, 34, 255, 69, 123, 187, 255,
    69, 123, 187, 255, 221, 153, 34, 255, 170, 102, 85, 255, 53, 123, 199, 255,
  ];
  const canvasUpdate = pixels(4, 2, canvasPalette.slice(0, 4));
  const canvasSources = [false, true].map(offscreen => {
    const { canvas, context } = sourceCanvas(offscreen);
    return {
      name: offscreen ? 'OffscreenCanvas' : 'Canvas',
      first: canvasPalette, second: canvasUpdate,
      reset() { paint(context, 4, 2, canvasPalette); return canvas; },
      update() { paint(context, 4, 2, canvasUpdate); return canvas; },
    };
  });
  const sourceCases = [
    { name: 'ImageData', first: domCanvasImagePalette, second: alternateBytes,
      reset() { imageData.data.set(domCanvasImagePalette); return imageData; },
      update() { imageData.data.set(alternateBytes); return imageData; } },
    { name: 'PNG', first: domCanvasImagePalette, second: alternateBytes,
      reset: () => image, update: () => alternate },
    ...canvasSources,
  ];

  const texture = makeTexture(gl);
  const program = rttProgram(gl, undefined, rttTextureFragment);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.disable(gl.DITHER);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  for (const [label, format, type, steps] of [
    ['565', gl.RGB, gl.UNSIGNED_SHORT_5_6_5, [8, 4, 8, 256]],
    ['4444', gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4, [16, 16, 16, 16]],
    ['5551', gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, [8, 8, 8, 128]],
  ] as const) {
    const expected = (data: readonly number[], flipY: boolean, premultiply: boolean) =>
      transform(data, 4, 2, flipY, premultiply).map((value, index) => {
        const channel = index % 4;
        if (channel === 3 && format === gl.RGB) return 255;
        const step = steps[channel]!;
        return Math.round(Math.floor(value / step) * 255 / (256 / step - 1));
      });
    for (const source of sourceCases) {
      const name = `${source.name} packed ${label}`;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, format, type, source.reset());
      check(`${name} define`, gl.getError(), gl.NO_ERROR);
      const update = source.update();
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, format, gl.UNSIGNED_BYTE, update);
      check(`${name} incompatible subimage type`, gl.getError(), gl.INVALID_OPERATION);
      gl.viewport(0, 0, 4, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, format, type, update);
      check(`${name} update`, gl.getError(), gl.NO_ERROR);
      source.reset();
      gl.viewport(4, 0, 4, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      capture(gl, result, check, name, horizontal(
        expected(source.first, true, true), expected(source.second, false, false)), 8, 2);
    }
  }
}

export async function runDomCanvasImageCase(name: DomCanvasImageCaseName, backend: DrawingBackend,
  assets: DomCanvasImageAssets): Promise<DomCanvasImageResult> {
  const result: DomCanvasImageResult = { name, backend, selectedCore: null, checks: [], captures: [],
    environment: {}, observations: {}, failure: null, validationErrors: [], cleanupErrors: [] };
  const check: CheckValue = (name, actual, expected) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
  };
  const contexts: Context[] = [];
  try {
    const context = await prepareRttContext(backend, 8, 4, true);
    contexts.push(context);
    result.selectedCore = context.selectedCore;
    result.environment = context.environment;
    const { gl } = context;
    switch (name) {
      case 'canvas-pixel-store': canvasPixelStore(gl, result, check); break;
      case 'canvas-snapshot-update-resize': canvasSnapshots(gl, result, check); break;
      case 'source-context-ordering': await sourceOrdering(context, result, check, contexts); break;
      case 'source-context-alpha-and-loss': await sourceAlphaAndLoss(context, result, check, contexts); break;
      case 'png-palette-transforms': await pngTransforms(gl, assets, result, check); break;
      case 'packed-formats': await packedFormats(gl, assets, result, check); break;
      case 'image-dimensions': await dimensions(gl, assets, result, check); break;
      case 'intrinsic-and-cross-realm': await brands(gl, assets, result, check); break;
      case 'invalid-and-security-sources': await invalid(context, assets, result, check); break;
      case 'icc-color-space': await icc(gl, assets, result, check); break;
    }
    check('no trailing GL error', gl.getError(), gl.NO_ERROR);
  } catch (error) {
    result.failure = error instanceof Error ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  } finally {
    for (const context of contexts) {
      try {
        if (context.hooks && !context.gl.isContextLost()) await context.hooks.device.queue.onSubmittedWorkDone();
        await new Promise(resolve => setTimeout(resolve, 0));
        result.validationErrors.push(...(context.hooks?.errors ?? []));
      } catch (error) { result.cleanupErrors.push(String(error)); }
      try { await context.dispose(); }
      catch (error) { result.cleanupErrors.push(String(error)); }
    }
  }
  return result;
}
