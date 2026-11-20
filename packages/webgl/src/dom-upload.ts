import { GL } from '@refral/core-api';
import type { DomTextureCapturePlan, DomTextureUploadRequest, DrawingCore, PixelUpload } from '@refral/core-api';
import { bufferSourceBytes } from './buffers.js';
import { ImageExtractor } from './image-extractor.js';
import type { NativeUploadExtent, NativeUploadSource } from './image-extractor.js';
import { convertImageDataColor } from './image-data-color.js';

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
  width: number, height: number, plan: DomTextureCapturePlan) => Uint8Array;
const canvasSources = new WeakMap<object, CanvasSource>();

export function registerCanvasSource(canvas: HTMLCanvasElement | OffscreenCanvas, source: CanvasSource): () => void {
  canvasSources.set(canvas, source);
  return () => { if (canvasSources.get(canvas) === source) canvasSources.delete(canvas); };
}

function sourceColorSpace(source: HTMLCanvasElement | OffscreenCanvas): DomTextureCapturePlan['colorSpace'] {
  // A synchronous WebCodecs snapshot exposes the source encoding without acquiring a canvas context.
  const frame = new VideoFrame(source, { timestamp: 0 });
  try {
    switch (frame.colorSpace.primaries as string | null) {
      case 'bt709': return 'srgb';
      case 'smpte432': return 'display-p3';
      default: throw new DOMException('This source color encoding is outside the DOM upload profile.', 'NotSupportedError');
    }
  } finally {
    frame.close();
  }
}

/** Platform getters provide the WebIDL source brand and internal dimensions across realms. */
function inspectSource(value: unknown,
  extract: (source: NativeUploadSource, extent: NativeUploadExtent) => ReturnType<ImageExtractor['capture']>,
  captureCanvas: CanvasCapture,
  validateCanvasOrigin: (source: HTMLCanvasElement | OffscreenCanvas) => void,
  unpackPlan: () => DomTextureCapturePlan): SourcePixels {
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
          if ((colorSpace !== 'srgb' && colorSpace !== 'display-p3') || pixelFormat !== 'rgba-unorm8') {
            throw new DOMException('This ImageData source encoding is outside the implemented DOM upload profile.', 'NotSupportedError');
          }
          const plan = unpackPlan();
          const convert = plan.colorSpaceConversion !== GL.NONE && colorSpace !== plan.colorSpace;
          return { bytes: convert ? convertImageDataColor(bytes, plan.colorSpace) : bytes,
            viewType: 'Uint8Array', source: 'dom' };
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
    const canvas = value as HTMLCanvasElement | OffscreenCanvas;
    const registered = canvasSources.get(canvas);
    const source: SourcePixels = { width, height, valid: width > 0 && height > 0,
      contextLost: registered?.isLost() ?? false,
      prepare() {
        if (source.contextLost) return;
        registered?.prepare();
        if (!registered) validateCanvasOrigin(canvas);
      },
      pixels() {
        const plan = unpackPlan();
        const colorSpace = plan.colorSpaceConversion === GL.NONE
          ? registered ? 'srgb' : sourceColorSpace(canvas)
          : plan.colorSpace;
        return { bytes: captureCanvas(canvas, width, height, { ...plan, colorSpace }),
          viewType: 'Uint8Array', source: 'dom-converted' };
      } };
    return source;
  }
  throw new TypeError('Expected a WebGL TexImageSource.');
}

export function createDomTextureUploads(core: DrawingCore, captureCanvas: CanvasCapture) {
  let colorSpace: DomTextureCapturePlan['colorSpace'] = 'srgb';
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
  function unpackPlan(): DomTextureCapturePlan {
    return {
      flipY: core.invoke('getParameter', [GL.UNPACK_FLIP_Y_WEBGL]) as boolean,
      premultiplyAlpha: core.invoke('getParameter', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL]) as boolean,
      colorSpaceConversion: core.invoke('getParameter', [GL.UNPACK_COLORSPACE_CONVERSION_WEBGL]) as number,
      colorSpace,
    };
  }
  function extract(source: NativeUploadSource, extent: NativeUploadExtent) {
    extractor ??= new ImageExtractor();
    return extractor.capture(source, extent, unpackPlan());
  }
  return {
    get colorSpace() { return colorSpace; },
    set colorSpace(value: DomTextureCapturePlan['colorSpace']) { colorSpace = value; },
    upload(parameters: Omit<DomTextureUploadRequest, 'width' | 'height' | 'sourceValid'>, value: unknown): void {
      const source = inspectSource(value, extract, captureCanvas, validateCanvasOrigin, unpackPlan);
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
