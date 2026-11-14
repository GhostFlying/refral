import { GL } from "@refral/core-api";
import type { RenderbufferHandle, TextureHandle, TextureParameters, TextureStorage } from "@refral/core-api";
export { GL, componentCount, createRasterState, snapshotRaster } from "@refral/core-api";
export type { AttributeSnapshot, RasterState, TargetSnapshot, TextureParameters, TextureStorage } from "@refral/core-api";

let nextObjectId = 1;

export class LogicalObject {
  readonly id = nextObjectId++;
  deleted = false;
  constructor(readonly owner: object) {}
}

export class BufferObject extends LogicalObject {
  data = new Uint8Array(0);
  usage: number = GL.STATIC_DRAW;
  target: number | null = null;
  generation = 0;
  version = 0;
}

export class TextureObject extends LogicalObject {
  handle: TextureHandle | null = null;
  initialized = false;
  retired = false;
  storage: TextureStorage | null = null;
  generation = 0;
  version = 0;
  format: number = GL.RGBA;
  parameters: TextureParameters = {
    minFilter: GL.NEAREST_MIPMAP_LINEAR,
    magFilter: GL.LINEAR,
    wrapS: GL.REPEAT,
    wrapT: GL.REPEAT,
  };
}

export class RenderbufferObject extends LogicalObject {
  handle: RenderbufferHandle | null = null;
  retired = false;
  width = 0;
  height = 0;
  generation = 0;
  format: number = GL.DEPTH_COMPONENT16;
}

export class FramebufferObject extends LogicalObject {
  color: TextureObject | null = null;
  depth: RenderbufferObject | null = null;
}

export interface VertexAttribute {
  enabled: boolean;
  buffer: BufferObject | null;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
  constant: [number, number, number, number];
}

export class ErrorState {
  private errors: number[] = [];
  set(error: number): void {
    if (!this.errors.includes(error)) this.errors.push(error);
  }
  take(): number { return this.errors.shift() ?? GL.NO_ERROR; }
  clear(): void { this.errors = []; }
}

export function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function isTextureComplete(texture: TextureObject): boolean {
  const storage = texture.storage;
  if (!storage || !storage.width || !storage.height) return false;
  const params = texture.parameters;
  if (params.minFilter !== GL.NEAREST && params.minFilter !== GL.LINEAR) {
    if (![GL.NEAREST_MIPMAP_NEAREST, GL.LINEAR_MIPMAP_NEAREST,
      GL.NEAREST_MIPMAP_LINEAR, GL.LINEAR_MIPMAP_LINEAR].includes(params.minFilter as 0x2700)) return false;
    if (storage.width !== 1 || storage.height !== 1) return false;
  }
  if (!isPowerOfTwo(storage.width) || !isPowerOfTwo(storage.height)) {
    return params.wrapS === GL.CLAMP_TO_EDGE && params.wrapT === GL.CLAMP_TO_EDGE;
  }
  return true;
}
