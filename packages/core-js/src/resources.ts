import { CUBE_FACES, GL } from "@refral/core-api";
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

export interface TextureImage {
  storage: TextureStorage | null;
  generation: number;
  version: number;
  format: number;
}

export class TextureObject extends LogicalObject implements TextureImage {
  handle: TextureHandle | null = null;
  initialized = false;
  retired = false;
  target: number | null = null;
  readonly cubeImages = new Map<number, TextureImage>();
  // These fields retain the existing level-zero 2D image and direct CPU callers.
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

  image(imageTarget: number): TextureImage | undefined {
    return imageTarget === GL.TEXTURE_2D ? this : this.cubeImages.get(imageTarget);
  }
}

export class RenderbufferObject extends LogicalObject {
  handle: RenderbufferHandle | null = null;
  initialized = false;
  retired = false;
  width = 0;
  height = 0;
  generation = 0;
  format: number = GL.RGBA4;
}

export class FramebufferObject extends LogicalObject {
  initialized = false;
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
  let image: TextureImage = texture;
  if (texture.target === GL.TEXTURE_CUBE_MAP) {
    const first = texture.cubeImages.get(CUBE_FACES[0]);
    if (!first?.storage) return false;
    const { width, height } = first.storage;
    if (width !== height || CUBE_FACES.some(face => {
      const other = texture.cubeImages.get(face);
      return !other?.storage || other.storage.width !== width || other.storage.height !== height
        || other.format !== first.format;
    })) return false;
    image = first;
  }
  const storage = image.storage;
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
