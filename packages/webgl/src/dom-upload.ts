import { GL } from '@refral/core-api';
import type { DomTextureUploadPlan, DomTextureUploadRequest, DrawingCore, PixelUpload } from '@refral/core-api';
import { bufferSourceBytes } from './buffers.js';
import { ImageExtractor } from './image-extractor.js';
import type { NativeUploadExtent, NativeUploadSource } from './image-extractor.js';

type SourceKind = 'image-data' | 'canvas' | 'offscreen-canvas' | 'image' | 'video' | 'video-frame' | 'bitmap';
interface SourceType {
  kind: SourceKind;
  getters: Record<string, PropertyDescriptor>;
  width: string;
  height: string;
}
interface SourcePixels {
  width: number;
  height: number;
  valid: boolean;
  contextLost?: boolean;
  closedVideoFrame?: boolean;
  prepare?(): void;
  pixels(): PixelUpload;
}

const sourceTypes: SourceType[] = [];
for (const [kind, prototype, width, height] of [
  ['image-data', typeof ImageData === 'undefined' ? null : ImageData.prototype],
  ['canvas', typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype],
  ['offscreen-canvas', typeof OffscreenCanvas === 'undefined' ? null : OffscreenCanvas.prototype],
  ['image', typeof HTMLImageElement === 'undefined' ? null : HTMLImageElement.prototype],
  ['video', typeof HTMLVideoElement === 'undefined' ? null : HTMLVideoElement.prototype, 'videoWidth', 'videoHeight'],
  ['video-frame', typeof VideoFrame === 'undefined' ? null : VideoFrame.prototype, 'displayWidth', 'displayHeight'],
  ['bitmap', typeof ImageBitmap === 'undefined' ? null : ImageBitmap.prototype],
] as const) {
  if (prototype) sourceTypes.push({ kind, width: width ?? 'width', height: height ?? 'height', getters: Object.getOwnPropertyDescriptors(prototype) });
}

interface CanvasSource { prepare(): void; isLost(): boolean }
export type CanvasCapture = (source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number, plan: DomTextureUploadPlan) => Uint8Array;
const canvasSources = new WeakMap<object, CanvasSource>();

export function registerCanvasSource(canvas: HTMLCanvasElement | OffscreenCanvas, source: CanvasSource): () => void {
  canvasSources.set(canvas, source);
  return () => { if (canvasSources.get(canvas) === source) canvasSources.delete(canvas); };
}

/** Platform getters provide the WebIDL source brand and internal dimensions across realms. */
function inspectSource(value: unknown,
  extract: (source: NativeUploadSource, extent: NativeUploadExtent) => ReturnType<ImageExtractor['capture']>,
  captureCanvas: (source: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) => Uint8Array,
  validateCanvasOrigin: (source: HTMLCanvasElement | OffscreenCanvas) => void): SourcePixels {
  for (const type of sourceTypes) {
    let width: number;
    try { width = type.getters[type.width]!.get!.call(value); }
    catch { continue; }
    let height = type.getters[type.height]!.get!.call(value) as number;
    if (type.kind === 'image-data') {
      const data = type.getters.data!.get!.call(value) as ArrayBufferView;
      const bytes = bufferSourceBytes(data, true);
      const colorSpace = type.getters.colorSpace?.get?.call(value) ?? 'srgb';
      const pixelFormat = type.getters.pixelFormat?.get?.call(value) ?? 'rgba-unorm8';
      return { width, height, valid: bytes.byteLength > 0,
        pixels() {
          if (colorSpace !== 'srgb' || pixelFormat !== 'rgba-unorm8') {
            throw new DOMException('This ImageData source encoding is outside the implemented DOM upload profile.', 'NotSupportedError');
          }
          return { bytes, viewType: 'Uint8Array', source: 'dom' };
        } };
    }
    if (type.kind === 'image' || type.kind === 'video' || type.kind === 'video-frame' || type.kind === 'bitmap') {
      const isImage = type.kind === 'image';
      if (isImage) {
        width = type.getters.naturalWidth!.get!.call(value);
        height = type.getters.naturalHeight!.get!.call(value);
      }
      let captured: ReturnType<ImageExtractor['capture']>;
      const source: SourcePixels = { width, height,
        closedVideoFrame: type.kind === 'video-frame' && (width === 0 || height === 0),
        // Detached bitmaps report zero dimensions. Native upload checks video frame availability.
        valid: isImage ? type.getters.complete!.get!.call(value) : width > 0 && height > 0,
        prepare() {
          captured = extract(value as NativeUploadSource, { width, height, exact: type.kind === 'bitmap' });
          source.width = captured.width;
          source.height = captured.height;
          source.valid = captured.width > 0 && captured.height > 0;
        },
        pixels: () => captured.pixels() };
      return source;
    }
    const registered = canvasSources.get(value as object);
    const source: SourcePixels = { width, height, valid: width > 0 && height > 0,
      contextLost: registered?.isLost() ?? false,
      prepare() {
        if (source.contextLost) return;
        registered?.prepare();
        if (!registered) validateCanvasOrigin(value as HTMLCanvasElement | OffscreenCanvas);
      },
      pixels: () => ({ bytes: captureCanvas(value as HTMLCanvasElement | OffscreenCanvas, width, height),
        viewType: 'Uint8Array', source: 'dom-converted' }) };
    return source;
  }
  throw new TypeError('Expected a WebGL TexImageSource.');
}

export function createDomTextureUploads(core: DrawingCore, captureCanvas: CanvasCapture) {
  let extractor: ImageExtractor | null = null;
  let originCanvas: OffscreenCanvas | null = null;
  let originContext: OffscreenCanvasRenderingContext2D | null = null;
  function validateCanvasOrigin(source: HTMLCanvasElement | OffscreenCanvas): void {
    if (!originCanvas) {
      originCanvas = new OffscreenCanvas(1, 1);
      originContext = originCanvas.getContext('2d', { willReadFrequently: true });
      if (!originContext) throw new DOMException('Canvas origin validation is unavailable.', 'NotSupportedError');
    }
    // Reset origin-clean state after a previously rejected tainted source.
    originCanvas.width = 1;
    originContext!.drawImage(source, 0, 0, 1, 1);
    originContext!.getImageData(0, 0, 1, 1);
  }
  function unpackPlan(): DomTextureUploadPlan {
    return {
      flipY: core.invoke('getParameter', [GL.UNPACK_FLIP_Y_WEBGL]) as boolean,
      premultiplyAlpha: core.invoke('getParameter', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL]) as boolean,
      colorSpaceConversion: core.invoke('getParameter', [GL.UNPACK_COLORSPACE_CONVERSION_WEBGL]) as number,
    };
  }
  function extract(source: NativeUploadSource, extent: NativeUploadExtent) {
    extractor ??= new ImageExtractor();
    return extractor.capture(source, extent, unpackPlan());
  }
  return {
    upload(parameters: Omit<DomTextureUploadRequest, 'width' | 'height' | 'sourceValid'>, value: unknown): void {
      const source = inspectSource(value, extract, (canvas, width, height) =>
        captureCanvas(canvas, width, height, unpackPlan()), validateCanvasOrigin);
      if (core.isContextLost()) return;
      if (source.valid) source.prepare?.();
      const request: DomTextureUploadRequest = { ...parameters,
        width: source.width, height: source.height, sourceValid: source.valid, sourceContextLost: source.contextLost, closedVideoFrame: source.closedVideoFrame };
      if (!core.prepareDomTextureUpload(request)) return;
      const pixels = source.pixels();
      const { target, level, internalFormat, x, y, width, height, format, type } = request;
      const args = request.operation === 'texImage2D'
        ? [target, level, internalFormat, width, height, 0, format, type, pixels]
        : [target, level, x, y, width, height, format, type, pixels];
      core.invoke(request.operation, args);
    },
    dispose() {
      extractor?.dispose(); extractor = null;
      if (originCanvas) originCanvas.width = originCanvas.height = 1;
      originContext = null; originCanvas = null;
    },
  };
}
