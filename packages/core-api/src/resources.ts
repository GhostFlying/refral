import type { RenderbufferHandle, TextureHandle } from './index.js';
import type { SemanticHost, TextureStorage } from './execution.js';

export interface TextureVersion {
  readonly texture: TextureHandle;
  readonly storageGeneration: number;
  readonly contentVersion: number;
}

/** Source view identity is retained for GL pixel-type validation. */
export interface PixelUpload {
  readonly bytes: Uint8Array;
  readonly viewType: string;
  readonly source?: 'dom' | 'dom-converted';
}

export type ResourceOperation =
  | { kind: 'define-texture'; version: TextureVersion; width: number; height: number; data: Uint8Array }
  | { kind: 'update-texture'; version: TextureVersion; previous: TextureVersion;
      x: number; y: number; width: number; height: number; data: Uint8Array }
  | { kind: 'write-texture'; version: TextureVersion; previous: TextureVersion }
  | { kind: 'retire-texture'; version: TextureVersion }
  | { kind: 'retire-depth'; renderbuffer: RenderbufferHandle; storageGeneration: number };

/** Payload bytes are owned by the operation and consumed synchronously. */
export interface ResourceRegistry {
  apply(operation: ResourceOperation): void;
  texture(version: TextureVersion): TextureStorage;
  depth(handle: RenderbufferHandle, storageGeneration: number): { readonly id: number };
  dispose(): void;
}

export function resourceHandleKey(handle: TextureHandle | RenderbufferHandle): string {
  return `${handle.kind}/${handle.contextId}/${handle.slot}/${handle.generation}`;
}

function sameVersion(first: TextureVersion, second: TextureVersion): boolean {
  return resourceHandleKey(first.texture) === resourceHandleKey(second.texture)
    && first.storageGeneration === second.storageGeneration
    && first.contentVersion === second.contentVersion;
}

interface TextureRecord { version: TextureVersion; storage: TextureStorage }
interface DepthRecord { id: number; generations: Set<number> }
let nextDepthId = 1;

/** Canonical CPU execution records over the ordered operations from either core. */
export class ExecutionResources implements ResourceRegistry {
  private readonly textures = new Map<string, TextureRecord>();
  private readonly depths = new Map<string, DepthRecord>();
  private disposed = false;

  constructor(private readonly contextId: number, private readonly host: SemanticHost) {
    if (!Number.isInteger(contextId) || contextId <= 0 || contextId > 0xffff_ffff) {
      throw new RangeError('Execution resources require a positive u32 context.');
    }
  }

  private handle(handle: TextureHandle | RenderbufferHandle): string {
    if (this.disposed) throw new Error('Execution resources are disposed.');
    if (handle.contextId !== this.contextId || !Number.isInteger(handle.slot) || handle.slot <= 0
      || handle.slot > 0xffff_ffff || !Number.isInteger(handle.generation)
      || handle.generation <= 0 || handle.generation > 0xffff_ffff) {
      throw new Error('Execution resource refers to an invalid or foreign handle.');
    }
    return resourceHandleKey(handle);
  }

  private version(version: TextureVersion): string {
    if (version.texture.kind !== 'texture' || !Number.isSafeInteger(version.storageGeneration)
      || version.storageGeneration <= 0 || !Number.isSafeInteger(version.contentVersion)
      || version.contentVersion <= 0) throw new Error('Invalid texture execution version.');
    return this.handle(version.texture);
  }

  private current(version: TextureVersion): TextureRecord {
    const record = this.textures.get(this.version(version));
    if (!record || !sameVersion(record.version, version)) {
      throw new Error('Texture execution operation refers to a stale version.');
    }
    return record;
  }

  private pixels(width: number, height: number, data: Uint8Array): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0
      || !Number.isSafeInteger(width * height * 4) || data.byteLength !== width * height * 4) {
      throw new Error('Invalid owned texture execution payload.');
    }
  }

  apply(operation: ResourceOperation): void {
    if (operation.kind === 'retire-depth') {
      const record = this.depths.get(this.handle(operation.renderbuffer));
      if (record?.generations.delete(operation.storageGeneration)) {
        this.host.retireDepth(record.id, operation.storageGeneration);
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
      return;
    }
    this.pixels(operation.width, operation.height, operation.data);
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
      storage.width = previous.width;
      storage.height = previous.height;
      storage.parent = previous;
      storage.update = { x: operation.x, y: operation.y, width: operation.width,
        height: operation.height, data: operation.data };
    } else {
      const current = this.textures.get(key);
      if (current && (operation.version.storageGeneration <= current.version.storageGeneration
        || operation.version.contentVersion <= current.version.contentVersion)) {
        throw new Error('Texture definition did not advance its generations.');
      }
      storage.data = operation.data;
    }
    this.host.replaceStorage(previous, storage);
    this.textures.set(key, { version: operation.version, storage });
  }

  private advance(next: TextureVersion, previous: TextureVersion): void {
    if (resourceHandleKey(next.texture) !== resourceHandleKey(previous.texture)
      || next.storageGeneration !== previous.storageGeneration
      || next.contentVersion <= previous.contentVersion) throw new Error('Invalid texture content transition.');
  }

  texture(version: TextureVersion): TextureStorage { return this.current(version).storage; }

  depth(handle: RenderbufferHandle, storageGeneration: number): { readonly id: number } {
    const key = this.handle(handle);
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

  dispose(): void {
    if (this.disposed) return;
    for (const record of this.textures.values()) this.host.retireStorage(record.storage);
    for (const record of this.depths.values()) {
      for (const generation of record.generations) this.host.retireDepth(record.id, generation);
    }
    this.textures.clear();
    this.depths.clear();
    this.disposed = true;
  }
}
