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
  get executionVersion(): string { return `${this.id}:${this.generation}:${this.version}`; }
}

export interface TextureImage {
  storage: TextureStorage | null;
  generation: number;
  version: number;
  format: number;
  type: number;
}

export class TextureObject extends LogicalObject implements TextureImage {
  handle: TextureHandle | null = null;
  initialized = false;
  retired = false;
  target: number | null = null;
  readonly imageLevels = new Map<number, Map<number, TextureImage>>();
  // These fields retain the existing level-zero 2D image and direct CPU callers.
  storage: TextureStorage | null = null;
  generation = 0;
  version = 0;
  format: number = GL.RGBA;
  type: number = GL.UNSIGNED_BYTE;
  parameters: TextureParameters = {
    minFilter: GL.NEAREST_MIPMAP_LINEAR,
    magFilter: GL.LINEAR,
    wrapS: GL.REPEAT,
    wrapT: GL.REPEAT,
  };

  image(imageTarget: number, level = 0): TextureImage | undefined {
    return imageTarget === GL.TEXTURE_2D && level === 0 ? this : this.imageLevels.get(level)?.get(imageTarget);
  }

  setImage(imageTarget: number, level: number, image: TextureImage): void {
    if (image === this) return;
    let images = this.imageLevels.get(level);
    if (!images) this.imageLevels.set(level, images = new Map());
    images.set(imageTarget, image);
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
  colorStorage: TextureStorage | null = null;
}

export class FramebufferObject extends LogicalObject {
  initialized = false;
  color: TextureObject | RenderbufferObject | null = null;
  colorTarget: number = GL.TEXTURE_2D;
  colorLevel = 0;
  get colorTexture(): TextureObject | null { return this.color instanceof TextureObject ? this.color : null; }
  get colorRenderbuffer(): RenderbufferObject | null { return this.color instanceof RenderbufferObject ? this.color : null; }
  get colorImage(): TextureImage | undefined { return this.colorTexture?.image(this.colorTarget, this.colorLevel); }
  depth: RenderbufferObject | null = null;
  stencil: RenderbufferObject | null = null;
  depthStencil: RenderbufferObject | null = null;
}

export function framebufferAttachmentPoint(attachment: number) {
  switch (attachment) {
    case GL.COLOR_ATTACHMENT0: return "color";
    case GL.DEPTH_ATTACHMENT: return "depth";
    case GL.STENCIL_ATTACHMENT: return "stencil";
    case GL.DEPTH_STENCIL_ATTACHMENT: return "depthStencil";
    default: return undefined;
  }
}

export interface VertexAttribute {
  enabled: boolean;
  buffer: BufferObject | null;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
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

export function textureTargets(texture: TextureObject): readonly number[] {
  return texture.target === GL.TEXTURE_CUBE_MAP ? CUBE_FACES : [GL.TEXTURE_2D];
}

export function textureBase(texture: TextureObject): TextureImage | undefined {
  const targets = textureTargets(texture);
  const base = texture.image(targets[0]!);
  const storage = base?.storage;
  if (!base || !storage?.width || !storage.height) return undefined;
  if (texture.target === GL.TEXTURE_CUBE_MAP && (storage.width !== storage.height || targets.some(target => {
    const image = texture.image(target);
    return image?.storage?.width !== storage.width || image.storage.height !== storage.height
      || image.format !== base.format || image.type !== base.type;
  }))) return undefined;
  return base;
}

export function textureSamplingLevelCount(texture: TextureObject, floatLinear = false): number {
  const base = textureBase(texture);
  if (!base?.storage) return 0;
  const { width, height } = base.storage;
  const { minFilter, wrapS, wrapT } = texture.parameters;
  if (base.type === GL.FLOAT && !floatLinear && (texture.parameters.magFilter !== GL.NEAREST
    || (minFilter !== GL.NEAREST && minFilter !== GL.NEAREST_MIPMAP_NEAREST))) return 0;
  const nonMip = minFilter === GL.NEAREST || minFilter === GL.LINEAR;
  if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
    return nonMip && wrapS === GL.CLAMP_TO_EDGE && wrapT === GL.CLAMP_TO_EDGE ? 1 : 0;
  }
  if (nonMip) return 1;
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const targets = textureTargets(texture);
  for (let level = 1; level < levels; level++) {
    for (const target of targets) {
      const image = texture.image(target, level);
      if (image?.storage?.width !== Math.max(1, width >> level)
        || image.storage.height !== Math.max(1, height >> level)
        || image.format !== base.format || image.type !== base.type) return 0;
    }
  }
  return levels;
}

export function isTextureComplete(texture: TextureObject): boolean {
  return textureSamplingLevelCount(texture) > 0;
}

export class VertexArrayObject extends LogicalObject {
  boundOnce = false;
  element: BufferObject | null = null;
  readonly attributes: VertexAttribute[];
  constructor(owner: object, count: number) {
    super(owner);
    this.attributes = Array.from({ length: count }, () => ({ enabled: false, buffer: null, size: 4,
      type: GL.FLOAT, normalized: false, stride: 0, offset: 0 }));
  }
}
