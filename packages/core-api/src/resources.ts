import { GL, SRGB } from './gl.js';
import type { RenderbufferHandle, TextureHandle } from './index.js';
import type { SemanticHost, TextureCopy, TextureStorage } from './execution.js';

export interface TextureVersion {
  readonly texture: TextureHandle;
  readonly storageGeneration: number;
  readonly contentVersion: number;
  /** Image target is TEXTURE_2D or a cube face. Legacy records identify TEXTURE_2D level zero. */
  readonly imageTarget?: number;
  readonly level?: number;
}

export const CUBE_FACES = [
  GL.TEXTURE_CUBE_MAP_POSITIVE_X, GL.TEXTURE_CUBE_MAP_NEGATIVE_X,
  GL.TEXTURE_CUBE_MAP_POSITIVE_Y, GL.TEXTURE_CUBE_MAP_NEGATIVE_Y,
  GL.TEXTURE_CUBE_MAP_POSITIVE_Z, GL.TEXTURE_CUBE_MAP_NEGATIVE_Z,
] as const;

/** Source view identity is retained for GL pixel-type validation. Uint16 and Float32 elements use little-endian bytes. */
export interface PixelUpload {
  readonly bytes: Uint8Array;
  readonly viewType: string;
  readonly source?: 'dom' | 'dom-converted';
}

export type ResourceOperation =
  | { kind: 'define-texture'; texelFormat?: TextureStorage['texelFormat']; version: TextureVersion; width: number; height: number; data: Uint8Array }
  | { kind: 'update-texture'; version: TextureVersion; previous: TextureVersion;
      x: number; y: number; width: number; height: number; data: Uint8Array }
  | { kind: 'generate-texture-mip'; version: TextureVersion; source: TextureVersion; width: number; height: number }
  | { kind: 'copy-texture'; version: TextureVersion; previous: TextureVersion | null;
      width: number; height: number; copy: TextureCopy }
  | { kind: 'write-texture'; version: TextureVersion; previous: TextureVersion }
  | { kind: 'retire-texture'; version: TextureVersion }
  | { kind: 'retire-renderbuffer'; renderbuffer: RenderbufferHandle; storageGeneration: number };

/** Payload bytes are owned by the operation and consumed synchronously. */
export interface ResourceRegistry {
  apply(operation: ResourceOperation): void;
  texture(version: TextureVersion): TextureStorage;
  depth(handle: RenderbufferHandle, storageGeneration: number): { readonly id: number };
  colorRenderbuffer(handle: RenderbufferHandle, storageGeneration: number,
    width: number, height: number, format: number): TextureStorage;
  dispose(): void;
}

export function resourceHandleKey(handle: TextureHandle | RenderbufferHandle): string {
  return `${handle.kind}/${handle.contextId}/${handle.slot}/${handle.generation}`;
}

export function textureImageKey(version: TextureVersion): string {
  return `${resourceHandleKey(version.texture)}/${version.imageTarget ?? GL.TEXTURE_2D}/${version.level ?? 0}`;
}

interface TextureRecord { version: TextureVersion; storage: TextureStorage }
interface DepthRecord { id: number; generations: Set<number> }
let nextDepthId = 1;

/** Canonical CPU execution records over the ordered operations from either core. */
export class ExecutionResources implements ResourceRegistry {
  private readonly textures = new Map<string, TextureRecord>();
  private readonly depths = new Map<string, DepthRecord>();
  private readonly colors = new Map<string, Map<number, TextureStorage>>();
  private disposed = false;

  constructor(private readonly contextId: number, private readonly host: SemanticHost) {
    if (!Number.isInteger(contextId) || contextId <= 0 || contextId > 0xffff_ffff) {
      throw new RangeError('Execution resources require a positive u32 context.');
    }
  }

  private validateHandle(handle: TextureHandle | RenderbufferHandle): void {
    if (this.disposed) throw new Error('Execution resources are disposed.');
    if (handle.contextId !== this.contextId || !Number.isInteger(handle.slot) || handle.slot <= 0
      || handle.slot > 0xffff_ffff || !Number.isInteger(handle.generation)
      || handle.generation <= 0 || handle.generation > 0xffff_ffff) {
      throw new Error('Execution resource refers to an invalid or foreign handle.');
    }
  }

  private version(version: TextureVersion): string {
    if (version.texture.kind !== 'texture' || !Number.isSafeInteger(version.storageGeneration)
      || version.storageGeneration <= 0 || !Number.isSafeInteger(version.contentVersion)
      || version.contentVersion <= 0) throw new Error('Invalid texture execution version.');
    const target = version.imageTarget ?? GL.TEXTURE_2D;
    const level = version.level ?? 0;
    if ((target !== GL.TEXTURE_2D && !CUBE_FACES.some(face => face === target))
      || !Number.isInteger(level) || level < 0 || level > 0x7fff_ffff) {
      throw new Error('Invalid texture image subresource.');
    }
    this.validateHandle(version.texture);
    return textureImageKey(version);
  }

  private current(version: TextureVersion): TextureRecord {
    const record = this.textures.get(this.version(version));
    // The map key already identifies the context, object generation, face and level.
    if (!record || record.version.storageGeneration !== version.storageGeneration
      || record.version.contentVersion !== version.contentVersion) {
      throw new Error('Texture execution operation refers to a stale version.');
    }
    return record;
  }

  private pixels(width: number, height: number, data: Uint8Array, texelFormat?: TextureStorage['texelFormat']): void {
    const bytes = width * height * (texelFormat === 'rgba32float' ? 16 : 4);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0
      || !Number.isSafeInteger(bytes) || data.byteLength !== bytes) {
      throw new Error('Invalid owned texture execution payload.');
    }
  }

  apply(operation: ResourceOperation): void {
    if (operation.kind === 'retire-renderbuffer') {
      this.validateHandle(operation.renderbuffer);
      const key = resourceHandleKey(operation.renderbuffer);
      const record = this.depths.get(key);
      if (record?.generations.delete(operation.storageGeneration)) {
        this.host.retireDepth(record.id, operation.storageGeneration);
      }
      const colors = this.colors.get(key);
      const color = colors?.get(operation.storageGeneration);
      if (color) {
        this.host.retireStorage(color);
        colors!.delete(operation.storageGeneration);
        if (!colors!.size) this.colors.delete(key);
      }
      return;
    }
    const key = this.version(operation.version);
    if (operation.kind === 'retire-texture') {
      const record = this.textures.get(key);
      if (!record) return;
      this.current(operation.version);
      this.host.retireStorage(record.storage);
      this.textures.delete(key);
      return;
    }
    if (operation.kind === 'write-texture') {
      const record = this.current(operation.previous);
      this.advance(operation.version, operation.previous);
      // A rendered image stays in its GPU allocation through this version step.
      record.version = operation.version;
      record.storage.reference = operation.version;
      return;
    }
    if (operation.kind === 'generate-texture-mip') {
      const source = this.current(operation.source).storage;
      if (resourceHandleKey(operation.source.texture) !== resourceHandleKey(operation.version.texture)
        || (operation.source.imageTarget ?? GL.TEXTURE_2D) !== (operation.version.imageTarget ?? GL.TEXTURE_2D)
        || (operation.source.level ?? 0) + 1 !== operation.version.level
        || !source.width || !source.height || (source.width === 1 && source.height === 1)
        || operation.width !== Math.max(1, source.width >> 1)
        || operation.height !== Math.max(1, source.height >> 1)) {
        throw new Error('Invalid generated texture level.');
      }
      const current = this.textures.get(key);
      this.validateDefinition(operation.version, current?.version);
      const storage = { reference: operation.version, generation: operation.version.storageGeneration,
        width: operation.width, height: operation.height, ...(source.texelFormat ? { texelFormat: source.texelFormat } : {}), mipSource: source };
      this.host.replaceStorage(current?.storage ?? null, storage);
      this.textures.set(key, { version: operation.version, storage });
      return;
    }
    if (operation.kind === 'copy-texture') {
      const previous = this.textures.get(key);
      const { copy, width, height } = operation;
      if (operation.previous) {
        const parent = this.current(operation.previous).storage;
        this.advance(operation.version, operation.previous);
        if (parent.width !== width || parent.height !== height) throw new Error('Invalid texture copy size.');
      } else this.validateDefinition(operation.version, previous?.version);
      if (![width, height, copy.x, copy.y, copy.width, copy.height].every(value =>
        Number.isSafeInteger(value) && value >= 0) || copy.x + copy.width > width || copy.y + copy.height > height
        || !Number.isSafeInteger(copy.sourceX) || !Number.isSafeInteger(copy.sourceY)
        || (!copy.source.isDefault && !copy.source.color) || (previous && previous.storage === copy.source.color)) {
        throw new Error('Invalid framebuffer texture copy.');
      }
      const storage: TextureStorage = { reference: operation.version, generation: operation.version.storageGeneration,
        width, height, copy };
      if (operation.previous) storage.parent = previous!.storage;
      this.host.replaceStorage(previous?.storage ?? null, storage);
      this.textures.set(key, { version: operation.version, storage });
      return;
    }
    let previous = this.textures.get(key)?.storage ?? null;
    const storage: TextureStorage = {
      reference: operation.version, generation: operation.version.storageGeneration,
      width: operation.width, height: operation.height,
    };
    if (operation.kind === 'update-texture') {
      previous = this.current(operation.previous).storage;
      this.advance(operation.version, operation.previous);
      if (!Number.isSafeInteger(operation.x) || !Number.isSafeInteger(operation.y)
        || operation.x < 0 || operation.y < 0 || operation.x + operation.width > previous.width
        || operation.y + operation.height > previous.height) throw new Error('Invalid texture update region.');
      this.pixels(operation.width, operation.height, operation.data, previous.texelFormat);
      if (previous.texelFormat) storage.texelFormat = previous.texelFormat;
      storage.width = previous.width;
      storage.height = previous.height;
      storage.parent = previous;
      storage.update = { x: operation.x, y: operation.y, width: operation.width,
        height: operation.height, data: operation.data };
    } else {
      this.validateDefinition(operation.version, this.textures.get(key)?.version);
      this.pixels(operation.width, operation.height, operation.data, operation.texelFormat);
      if (operation.texelFormat) storage.texelFormat = operation.texelFormat;
      storage.data = operation.data;
    }
    this.host.replaceStorage(previous, storage);
    this.textures.set(key, { version: operation.version, storage });
  }

  private validateDefinition(next: TextureVersion, previous?: TextureVersion): void {
    if (previous && (next.storageGeneration <= previous.storageGeneration
      || next.contentVersion <= previous.contentVersion)) {
      throw new Error('Texture definition did not advance its generations.');
    }
  }

  private advance(next: TextureVersion, previous: TextureVersion): void {
    if (textureImageKey(next) !== textureImageKey(previous)
      || next.storageGeneration !== previous.storageGeneration
      || next.contentVersion <= previous.contentVersion) throw new Error('Invalid texture content transition.');
  }

  texture(version: TextureVersion): TextureStorage { return this.current(version).storage; }

  depth(handle: RenderbufferHandle, storageGeneration: number): { readonly id: number } {
    this.validateHandle(handle);
    const key = resourceHandleKey(handle);
    if (handle.kind !== 'renderbuffer' || !Number.isSafeInteger(storageGeneration) || storageGeneration <= 0) {
      throw new Error('Invalid depth storage identity.');
    }
    let record = this.depths.get(key);
    if (!record) {
      if (!Number.isSafeInteger(nextDepthId)) throw new RangeError('Depth resource identities exhausted.');
      record = { id: nextDepthId++, generations: new Set() };
      this.depths.set(key, record);
    }
    record.generations.add(storageGeneration);
    return record;
  }

  colorRenderbuffer(handle: RenderbufferHandle, storageGeneration: number,
    width: number, height: number, format: number): TextureStorage {
    this.validateHandle(handle);
    const key = resourceHandleKey(handle);
    if (handle.kind !== 'renderbuffer' || !Number.isSafeInteger(storageGeneration) || storageGeneration <= 0
      || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || !isColorRenderbufferFormat(format)) throw new Error('Invalid color renderbuffer storage.');
    let versions = this.colors.get(key);
    if (!versions) this.colors.set(key, versions = new Map());
    let storage = versions.get(storageGeneration);
    const opaque = format === GL.RGB565;
    const texelFormat = format === SRGB.SRGB8_ALPHA8_EXT ? 'rgba8unorm-srgb' : undefined;
    if (!storage) {
      storage = { width, height, generation: storageGeneration, opaque, texelFormat };
      versions.set(storageGeneration, storage);
    } else if (storage.width !== width || storage.height !== height || storage.opaque !== opaque || storage.texelFormat !== texelFormat) {
      throw new Error('Color renderbuffer storage changed without a new generation.');
    }
    return storage;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const record of this.textures.values()) this.host.retireStorage(record.storage);
    for (const record of this.depths.values()) {
      for (const generation of record.generations) this.host.retireDepth(record.id, generation);
    }
    for (const colors of this.colors.values()) {
      for (const storage of colors.values()) this.host.retireStorage(storage);
    }
    this.textures.clear();
    this.depths.clear();
    this.colors.clear();
    this.disposed = true;
  }
}

export function isColorRenderbufferFormat(format: number): boolean {
  return format === GL.RGB565 || format === GL.RGBA4 || format === GL.RGB5_A1 || format === SRGB.SRGB8_ALPHA8_EXT;
}
