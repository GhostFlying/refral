import type { DomTextureUploadRequest, DrawingCore, PixelUpload } from '@refral/core-api';
import { bufferSourceBytes } from './buffers.js';

type SourceKind = 'image-data' | 'canvas' | 'offscreen-canvas' | 'image';
interface SourceType {
  kind: SourceKind;
  getters: Record<string, PropertyDescriptor>;
}
interface SourcePixels {
  width: number;
  height: number;
  valid: boolean;
  validateOrigin?(): void;
  pixels(): PixelUpload;
}

const sourceTypes: SourceType[] = [];
for (const [kind, prototype] of [
  ['image-data', typeof ImageData === 'undefined' ? null : ImageData.prototype],
  ['canvas', typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype],
  ['offscreen-canvas', typeof OffscreenCanvas === 'undefined' ? null : OffscreenCanvas.prototype],
  ['image', typeof HTMLImageElement === 'undefined' ? null : HTMLImageElement.prototype],
] as const) {
  if (prototype) sourceTypes.push({ kind, getters: Object.getOwnPropertyDescriptors(prototype) });
}

/** Platform getters provide the WebIDL source brand and internal dimensions across realms. */
function inspectSource(value: unknown): SourcePixels {
  for (const type of sourceTypes) {
    let width: number;
    try { width = type.getters.width!.get!.call(value); }
    catch { continue; }
    let height = type.getters.height!.get!.call(value) as number;
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
    if (type.kind === 'image') {
      width = type.getters.naturalWidth!.get!.call(value);
      height = type.getters.naturalHeight!.get!.call(value);
    }
    let snapshot: Uint8ClampedArray | null = null;
    const capture = () => {
      if (snapshot) return;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(value as CanvasImageSource, 0, 0, width, height);
      snapshot = context.getImageData(0, 0, width, height).data;
    };
    return { width, height, valid: width > 0 && height > 0,
      validateOrigin: capture,
      pixels() {
        capture();
        return { bytes: new Uint8Array(snapshot!.buffer, snapshot!.byteOffset, snapshot!.byteLength),
          viewType: 'Uint8Array', source: 'dom' };
      } };
  }
  throw new TypeError('Expected a WebGL TexImageSource.');
}

export function uploadDomTexture(core: DrawingCore,
  parameters: Omit<DomTextureUploadRequest, 'width' | 'height' | 'sourceValid'>, value: unknown): void {
  const source = inspectSource(value);
  if (core.isContextLost()) return;
  if (source.valid) source.validateOrigin?.();
  const request: DomTextureUploadRequest = { ...parameters,
    width: source.width, height: source.height, sourceValid: source.valid };
  if (!core.prepareDomTextureUpload(request)) return;
  const pixels = source.pixels();
  const { target, level, internalFormat, x, y, width, height, format, type } = request;
  const args = request.operation === 'texImage2D'
    ? [target, level, internalFormat, width, height, 0, format, type, pixels]
    : [target, level, x, y, width, height, format, type, pixels];
  core.invoke(request.operation, args);
}
