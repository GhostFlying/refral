import { createRasterState, GL, isDrawMode, vertexComponentBytes } from '@refral/core-api';
import { createDirectCommands, noDirectCommand } from './direct.js';
import { createCommandBatch, geometryReference, rasterReference, textureReference, type BatchDrawReferences } from './batch.js';
import type {
  BufferHandle,
  BufferSnapshot,
  DrawingCore,
  DrawingCoreOptions,
  DrawingCoreServices,
  DrawOperation,
  TargetSnapshot,
  LogicalHandle,
  RasterState,
  TextureVersion,
  TextureBinding,
  VertexArrayHandle,
  PixelUpload,
  ReadPixelsRequest,
  ReadPixelsPlan,
  DomTextureUploadRequest,
  DomTextureUploadPlan,
} from '@refral/core-api';

const DEFAULT_URL = '/artifacts/core-wasm/refral_core.wasm';
const modules = new Map<string, Promise<WebAssembly.Module>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const maxCachedBufferVersions = 512;
const maxCachedBufferBytes = 32 * 1024 * 1024;

interface DrawBufferVersion {
  generation: number;
  storage: number;
  content: number;
  data: Uint8Array;
  bufferVersion: string;
}

export interface DrawGeometry {
  attributes: DrawOperation['attributes'];
  indices: DrawOperation['indices'];
  oversize?: Map<number, DrawBufferVersion>;
}

interface ABI {
  memory: WebAssembly.Memory;
  rf_abi_version(): number;
  rf_resource_protocol_version(): number;
  rf_readback_protocol_version(): number;
  rf_dom_upload_protocol_version(): number;
  rf_init(context: number, limit: number): number;
  rf_create_buffer(): number;
  rf_result_generation(): number;
  rf_bind_buffer(target: number, context: number, slot: number, generation: number): void;
  rf_delete_buffer(context: number, slot: number, generation: number): void;
  rf_is_buffer(context: number, slot: number, generation: number): number;
  rf_get_binding(parameter: number): number;
  rf_buffer_data_null(target: number, usage: number): void;
  rf_buffer_data_size(target: number, size: number, usage: number): void;
  rf_buffer_data_prepare(target: number, length: number, usage: number): number;
  rf_buffer_sub_data_prepare(target: number, offset: number, length: number): number;
  rf_input_pointer(): number;
  rf_input_length(): number;
  rf_upload_commit(): void;
  rf_get_buffer_parameter(target: number, parameter: number): number;
  rf_inspect_buffer(context: number, slot: number, generation: number): number;
  rf_draw_buffer_pointer(context: number, slot: number, generation: number,
    storage: number, content: number, byteLength: number): number;
  rf_snapshot_pointer(): number;
  rf_snapshot_length(): number;
  rf_snapshot_usage(): number;
  rf_snapshot_storage_generation(): number;
  rf_snapshot_content_version(): number;
  rf_get_error(): number;
  rf_mark_lost(): number;
  rf_is_context_lost(): number;
  rf_dispose(): void;
  rf_command_prepare(metadata: number, binary: number): number;
  rf_command_pointer(): number;
  rf_command_binary_pointer(): number;
  rf_command_commit(): number;
  rf_reply_pointer(): number;
  rf_reply_length(): number;
  rf_reply_binary_pointer(): number;
  rf_reply_binary_length(): number;
}

interface WireReply {
  type: string;
  value?: unknown;
  operation?: string;
  requestId?: number;
  shader?: LogicalHandle;
  stage?: number;
  extensions?: number;
  program?: LogicalHandle;
  vertexArtifact?: number | null;
  fragmentArtifact?: number | null;
  bindings?: [string, number][];
}

export function prepareRustModule(wasmURL = DEFAULT_URL): Promise<WebAssembly.Module> {
  const existing = modules.get(wasmURL);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(wasmURL);
    if (!response.ok) throw new Error(`Rust drawing core fetch failed (${response.status}).`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  modules.set(wasmURL, pending);
  void pending.catch(() => {
    if (modules.get(wasmURL) === pending) modules.delete(wasmURL);
  });
  return pending;
}

export async function createRustDrawingCore(
  options: DrawingCoreOptions,
  services: DrawingCoreServices,
  wasmURL = DEFAULT_URL,
): Promise<DrawingCore> {
  return createRustDrawingCoreFromModule(await prepareRustModule(wasmURL), options, services);
}

function utf16(bytes: Uint8Array): string {
  if (bytes.byteLength % 2) throw new Error('Invalid UTF16 reply length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result = '';
  for (let start = 0; start < bytes.byteLength; start += 8192) {
    const units: number[] = [];
    for (let offset = start; offset < Math.min(start + 8192, bytes.byteLength); offset += 2)
      units.push(view.getUint16(offset, true));
    result += String.fromCharCode(...units);
  }
  return result;
}

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u32(): number {
    this.check(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  i32(): number {
    return this.u32() | 0;
  }
  f32(): number {
    this.check(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  u64(): number {
    const value = this.u32() + this.u32() * 0x1_0000_0000;
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe Rust resource version.');
    return value;
  }
  skip(length: number): void {
    this.check(length);
    this.offset += length;
  }
  bytes(): Uint8Array {
    const length = this.u32();
    this.check(length);
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  finish(): void {
    if (this.offset !== this.data.byteLength) throw new Error('Trailing Rust drawing reply bytes.');
  }
  private check(length: number): void {
    if (length > this.data.byteLength - this.offset) throw new Error('Truncated Rust drawing reply.');
  }
}

function readRaster(reader: Reader, width: number, height: number): RasterState {
  const state = createRasterState(width, height);
  state.viewport = [reader.i32(), reader.i32(), reader.i32(), reader.i32()];
  state.scissor = [reader.i32(), reader.i32(), reader.i32(), reader.i32()];
  state.scissorTest = reader.u32() !== 0;
  const mask = reader.u32();
  state.colorMask = [Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4), Boolean(mask & 8)];
  state.depthTest = reader.u32() !== 0;
  state.depthMask = reader.u32() !== 0;
  state.depthFunc = reader.u32();
  state.depthRange = [reader.f32(), reader.f32()];
  state.blend = reader.u32() !== 0;
  state.blendColor = [reader.f32(), reader.f32(), reader.f32(), reader.f32()];
  state.blendSrcRGB = reader.u32();
  state.blendDstRGB = reader.u32();
  state.blendSrcAlpha = reader.u32();
  state.blendDstAlpha = reader.u32();
  state.blendEquationRGB = reader.u32();
  state.blendEquationAlpha = reader.u32();
  state.cull = reader.u32() !== 0;
  state.cullFace = reader.u32();
  state.frontFace = reader.u32();
  state.stencilTest = reader.u32() !== 0;
  state.stencilClear = reader.i32();
  const face = () => ({ func: reader.u32(), reference: reader.i32(), valueMask: reader.u32(), writeMask: reader.u32(),
    fail: reader.u32(), depthFail: reader.u32(), pass: reader.u32() });
  state.stencilFront = face();
  state.stencilBack = face();
  return state;
}

/** Each prepared factory owns one lazy instance; all GL state stays in context-specific Rust storage. */
export function prepareRustDrawingCores(module: WebAssembly.Module) {
  const capabilities = WebAssembly.Module.exports(module);
  if (!['rf_select_context', 'rf_drop_context'].every(name => capabilities.some(e => e.name === name))) {
    return (options: DrawingCoreOptions, services: DrawingCoreServices) =>
      createRustDrawingCoreFromModule(module, options, services);
  }
  let raw: WebAssembly.Exports | undefined;
  let next = 1;
  let active = 0;
  const released = new FinalizationRegistry<number>(id => {
    (raw!.rf_drop_context as (id: number) => void)(id);
    if (active === id) active = 0;
  });
  return (options: DrawingCoreOptions, services: DrawingCoreServices): DrawingCore => {
    if (next > 0xffff_ffff) throw new RangeError('Rust context selector space exhausted.');
    const id = next++;
    const instance = raw ??= new WebAssembly.Instance(module, {}).exports;
    const select = instance.rf_select_context as (id: number) => void;
    const bound: Record<string, WebAssembly.ExportValue> = {};
    for (const [name, entry] of Object.entries(instance)) {
      bound[name] = typeof entry !== 'function' ? entry : (...args: number[]) => {
        if (active !== id) { select(id); active = id; }
        return entry(...args);
      };
    }
    try {
      const core = drawingCoreFromExports(bound, options, services);
      released.register(bound, id);
      return core;
    } catch (error) {
      (instance.rf_drop_context as (id: number) => void)(id);
      if (active === id) active = 0;
      throw error;
    }
  };
}

export function createRustDrawingCoreFromModule(
  module: WebAssembly.Module,
  options: DrawingCoreOptions,
  services: DrawingCoreServices,
): DrawingCore {
  return drawingCoreFromExports(new WebAssembly.Instance(module, {}).exports, options, services);
}

function drawingCoreFromExports(exports: WebAssembly.Exports, options: DrawingCoreOptions,
  services: DrawingCoreServices): DrawingCore {
  const { contextId, maxBufferBytes, surface, profile, attributes } = options;
  if (
    !Number.isInteger(contextId) ||
    contextId <= 0 ||
    contextId > 0xffff_ffff ||
    !Number.isSafeInteger(maxBufferBytes) ||
    maxBufferBytes < 0
  )
    throw new RangeError('Invalid Rust context options.');
  const required: (keyof Omit<ABI, 'memory'>)[] = [
    'rf_abi_version',
    'rf_resource_protocol_version',
    'rf_readback_protocol_version',
    'rf_dom_upload_protocol_version',
    'rf_init',
    'rf_create_buffer',
    'rf_result_generation',
    'rf_bind_buffer',
    'rf_delete_buffer',
    'rf_is_buffer',
    'rf_get_binding',
    'rf_buffer_data_null',
    'rf_buffer_data_size',
    'rf_buffer_data_prepare',
    'rf_buffer_sub_data_prepare',
    'rf_input_pointer',
    'rf_input_length',
    'rf_upload_commit',
    'rf_get_buffer_parameter',
    'rf_inspect_buffer',
    'rf_draw_buffer_pointer',
    'rf_snapshot_pointer',
    'rf_snapshot_length',
    'rf_snapshot_usage',
    'rf_snapshot_storage_generation',
    'rf_snapshot_content_version',
    'rf_get_error',
    'rf_mark_lost',
    'rf_is_context_lost',
    'rf_dispose',
    'rf_command_prepare',
    'rf_command_pointer',
    'rf_command_binary_pointer',
    'rf_command_commit',
    'rf_reply_pointer',
    'rf_reply_length',
    'rf_reply_binary_pointer',
    'rf_reply_binary_length',
  ];
  if (
    !(exports.memory instanceof WebAssembly.Memory) ||
    required.some((name) => typeof exports[name] !== 'function')
  ) {
    throw new Error(
      'Rust drawing module requires ABI7/resource8/readback1/DOM upload2 exports. Rebuild with pnpm rust:build.',
    );
  }
  const abi = exports as unknown as ABI;
  if (abi.rf_abi_version() !== 7)
    throw new Error('Rust drawing ABI version mismatch; expected 7. Rebuild with pnpm rust:build.');
  if (abi.rf_resource_protocol_version() !== 8)
    throw new Error('Rust resource protocol mismatch. Rebuild with pnpm rust:build.');
  if (abi.rf_readback_protocol_version() !== 1)
    throw new Error('Rust readback protocol mismatch. Rebuild with pnpm rust:build.');
  if (abi.rf_dom_upload_protocol_version() !== 2)
    throw new Error('Rust DOM upload protocol mismatch. Rebuild with pnpm rust:build.');
  if (abi.rf_init(contextId, maxBufferBytes) !== 1)
    throw new Error('Rust drawing ABI initialization failed.');

  function memory(pointer: number, length: number): Uint8Array {
    const start = pointer >>> 0;
    const buffer = abi.memory.buffer;
    if (start > buffer.byteLength || length > buffer.byteLength - start)
      throw new Error('Invalid Rust arena range.');
    return new Uint8Array(buffer, start, length);
  }
  const direct = createDirectCommands(exports, memory);
  let batch = createCommandBatch(exports, memory, applyBatch, surface);
  function drain(): void { batch?.drain(); }
  function enqueueVertexArrayBind(handle: VertexArrayHandle | null, acknowledged: (accepted: boolean) => void): boolean {
    if (!batch?.bindVertexArray(handle, acknowledged)) return false;
    schedule();
    return true;
  }
  function applyBatch(kind: number, bytes: Uint8Array, previous: BatchDrawReferences): void {
    switch (kind) {
      case 1:
        executeDraw(bytes, previous);
        return;
      case 2:
        decode({ type: 'clear' }, bytes);
        return;
      case 3:
        applyOperations(bytes);
        return;
      case 4: {
        const reader = new Reader(bytes);
        const ids: number[] = [];
        for (let offset = 0; offset < bytes.byteLength; offset += 4) ids.push(reader.u32());
        services.compiler.release(ids);
        return;
      }
      default: throw new Error('Unknown Rust batch record.');
    }
  }
  function syncSurface(): void {
    const { width, height } = surface;
    if (direct) direct.surface(width, height);
    else command('setSurfaceSize', [width, height]);
  }
  function command(
    op: string,
    args: unknown[],
    extra: Record<string, unknown> = {},
  ): { value: WireReply; binary: Uint8Array; after: Uint8Array } {
    const chunks: Uint8Array[] = [];
    let total = 0;
    function append(bytes: Uint8Array): number {
      const offset = total;
      total += bytes.byteLength;
      chunks.push(bytes);
      return offset;
    }
    const encoded = args.map((arg) => {
      if (arg === null || typeof arg === 'boolean') return arg;
      if (typeof arg === 'number') {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setFloat64(0, arg, true);
        return { n: append(bytes) };
      }
      if (typeof arg === 'string') {
        const bytes = new Uint8Array(arg.length * 2);
        const view = new DataView(bytes.buffer);
        for (let index = 0; index < arg.length; index++)
          view.setUint16(index * 2, arg.charCodeAt(index), true);
        return { s: [append(bytes), arg.length] };
      }
      if (arg && typeof arg === 'object' && 'bytes' in arg && 'viewType' in arg) {
        const upload = arg as PixelUpload;
        if (upload.source !== undefined && upload.source !== 'dom' && upload.source !== 'dom-converted') {
          throw new TypeError('Invalid texture upload source marker.');
        }
        const bytes =
          upload.viewType === 'Uint8Array' || upload.viewType === 'Uint8ClampedArray' || upload.viewType === 'Uint16Array' || upload.viewType === 'Float32Array'
            ? upload.bytes
            : new Uint8Array();
        return { p: [append(bytes), bytes.byteLength], viewType: upload.viewType, source: upload.source };
      }
      if (Array.isArray(arg) || ArrayBuffer.isView(arg)) {
        const values = Array.from(arg as ArrayLike<number>);
        const bytes = new Uint8Array(values.length * 4);
        const view = new DataView(bytes.buffer);
        const integer = op.endsWith('iv');
        values.forEach((value, index) => {
          if (integer) view.setInt32(index * 4, value, true);
          else view.setFloat32(index * 4, value, true);
        });
        return { [integer ? 'i' : 'f']: [append(bytes), values.length] };
      }
      return arg;
    });
    const metadata = encoder.encode(JSON.stringify({ op, args: encoded, ...extra }));
    if (abi.rf_command_prepare(metadata.byteLength, total) !== 1)
      return { value: { type: 'null' }, binary: new Uint8Array(), after: new Uint8Array() };
    memory(abi.rf_command_pointer(), metadata.byteLength).set(metadata);
    const input = memory(abi.rf_command_binary_pointer(), total);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (abi.rf_command_commit() !== 1)
      return { value: { type: 'null' }, binary: new Uint8Array(), after: new Uint8Array() };
    const response = JSON.parse(
      decoder.decode(memory(abi.rf_reply_pointer(), abi.rf_reply_length() >>> 0)),
    ) as { value: WireReply; releases: number[]; beforeBytes: number; mainBytes: number; afterBytes: number };
    const binary = memory(abi.rf_reply_binary_pointer(), abi.rf_reply_binary_length() >>> 0).slice();
    services.compiler.release(response.releases.filter((id) => id !== 0));
    if (response.value.type === 'protocol-error') throw new Error('Invalid Rust drawing command.');
    const { beforeBytes, mainBytes, afterBytes } = response;
    if (
      ![beforeBytes, mainBytes, afterBytes].every((length) => Number.isSafeInteger(length) && length >= 0) ||
      beforeBytes + mainBytes + afterBytes !== binary.byteLength
    )
      throw new Error('Invalid Rust resource frame lengths.');
    applyOperations(binary.subarray(0, beforeBytes));
    return {
      value: response.value,
      binary: binary.subarray(beforeBytes, beforeBytes + mainBytes),
      after: binary.subarray(beforeBytes + mainBytes),
    };
  }

  let scheduled = false;
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      try {
        if (!abi.rf_is_context_lost()) {
          drain();
          services.host.flush();
        }
      } finally {
        scheduled = false;
      }
    });
  }
  function textureVersion(reader: Reader): TextureVersion {
    const texture = {
      kind: 'texture' as const,
      contextId: reader.u32(),
      slot: reader.u32(),
      generation: reader.u32(),
    };
    const version = { texture, storageGeneration: reader.u64(), contentVersion: reader.u64() };
    const imageTarget = reader.u32();
    const level = reader.u32();
    if (imageTarget !== GL.TEXTURE_2D
      && (imageTarget < GL.TEXTURE_CUBE_MAP_POSITIVE_X || imageTarget > GL.TEXTURE_CUBE_MAP_NEGATIVE_Z)) {
      throw new Error('Invalid Rust texture image target.');
    }
    return imageTarget === GL.TEXTURE_2D && level === 0 ? version : { ...version, imageTarget, level };
  }
  function applyOperations(bytes: Uint8Array): void {
    if (!bytes.byteLength) return;
    const reader = new Reader(bytes);
    const count = reader.u32();
    const pixels = () => memory(reader.u32(), reader.u32()).slice();
    for (let index = 0; index < count; index++) {
      const kind = reader.u32();
      if (kind === 5) {
        const renderbuffer = {
          kind: 'renderbuffer' as const,
          contextId: reader.u32(),
          slot: reader.u32(),
          generation: reader.u32(),
        };
        services.resources.apply({ kind: 'retire-renderbuffer', renderbuffer, storageGeneration: reader.u64() });
        continue;
      }
      const version = textureVersion(reader);
      if (kind === 1 || kind === 8 || kind === 9) {
        const width = reader.u32();
        const height = reader.u32();
        services.resources.apply({ kind: 'define-texture', version, width, height, data: pixels(),
          texelFormat: kind === 8 ? 'rgba32float' : kind === 9 ? 'rgba8unorm-srgb' : undefined });
      } else if (kind === 2) {
        const previous = textureVersion(reader);
        const x = reader.u32();
        const y = reader.u32();
        const width = reader.u32();
        const height = reader.u32();
        services.resources.apply({
          kind: 'update-texture',
          version,
          previous,
          x,
          y,
          width,
          height,
          data: pixels(),
        });
      } else if (kind === 6) {
        services.resources.apply({ kind: 'generate-texture-mip', version, source: textureVersion(reader),
          width: reader.u32(), height: reader.u32() });
      } else if (kind === 7) {
        const previous = reader.u32() ? textureVersion(reader) : null;
        const width = reader.u32();
        const height = reader.u32();
        const source = readTarget(reader);
        services.resources.apply({ kind: 'copy-texture', version, previous, width, height, copy: {
          source, sourceX: reader.i32(), sourceY: reader.i32(), x: reader.u32(), y: reader.u32(),
          width: reader.u32(), height: reader.u32(), format: reader.u32(), type: reader.u32(),
        } });
      } else if (kind === 3) {
        services.resources.apply({ kind: 'write-texture', version, previous: textureVersion(reader) });
      } else if (kind === 4) {
        services.resources.apply({ kind: 'retire-texture', version });
      } else throw new Error('Invalid Rust resource operation.');
    }
    reader.finish();
    if (count) schedule();
  }
  function readTextures(reader: Reader): TextureBinding[] {
    const textureCount = reader.u32();
    const textures: TextureBinding[] = [];
    for (let index = 0; index < textureCount; index++) textures.push(textureBinding(reader));
    return textures;
  }
  function textureBinding(reader: Reader): TextureBinding {
    const kind = reader.u32();
    const levels = reader.u32();
    if (kind > 1 || levels > 32) throw new Error('Invalid Rust texture binding kind or level count.');
    const versions: TextureVersion[] = [];
    for (let level = 0; level < levels; level++) {
      for (let face = 0; face < (kind === 1 ? 6 : 1); face++) {
        const version = textureVersion(reader);
        const expectedTarget = kind === 1 ? GL.TEXTURE_CUBE_MAP_POSITIVE_X + face : GL.TEXTURE_2D;
        const base = versions[0]?.texture;
        if ((version.imageTarget ?? GL.TEXTURE_2D) !== expectedTarget || (version.level ?? 0) !== level
          || base && (version.texture.contextId !== base.contextId || version.texture.slot !== base.slot
            || version.texture.generation !== base.generation)) {
          throw new Error('Invalid Rust sampled image identity.');
        }
        versions.push(version);
      }
    }
    const parameters = {
      minFilter: reader.u32(),
      magFilter: reader.u32(),
      wrapS: reader.u32(),
      wrapT: reader.u32(),
    };
    const images = versions.map(version => services.resources.texture(version));
    if (levels > 1) return { storage: null, parameters, dimension: kind === 1 ? 'cube' : '2d', mipImages: images };
    if (kind === 1) return { storage: null, parameters, dimension: 'cube',
      ...(levels ? { cubeFaces: images } : {}) };
    return { storage: images[0] ?? null, parameters };
  }
  function readTarget(reader: Reader): TargetSnapshot {
    const width = reader.u32();
    const height = reader.u32();
    const isDefault = reader.u32() !== 0;
    const colorKind = reader.u32();
    if (colorKind > 3 || (isDefault ? colorKind !== 0 : colorKind === 0)) {
      throw new Error('Invalid Rust framebuffer color attachment.');
    }
    let color: TargetSnapshot['color'] = null;
    if (colorKind === 1 || colorKind === 3) color = services.resources.texture(textureVersion(reader));
    else if (colorKind === 2) {
      const handle = { kind: 'renderbuffer' as const, contextId: reader.u32(), slot: reader.u32(), generation: reader.u32() };
      color = services.resources.colorRenderbuffer(handle, reader.u64(), width, height, reader.u32());
    }
    let depth: TargetSnapshot['depth'] = null;
    let depthGeneration = 0;
    const depthFormat = reader.u32();
    if (depthFormat) {
      if (depthFormat !== GL.DEPTH_COMPONENT16 && depthFormat !== GL.STENCIL_INDEX8 && depthFormat !== GL.DEPTH_STENCIL) {
        throw new Error('Invalid Rust depth/stencil format.');
      }
      const handle = {
        kind: 'renderbuffer' as const,
        contextId: reader.u32(),
        slot: reader.u32(),
        generation: reader.u32(),
      };
      depthGeneration = reader.u64();
      depth = services.resources.depth(handle, depthGeneration);
    }
    return { color, ...(colorKind === 3 ? { colorOpaque: true } : {}),
      depth, depthGeneration, ...(depthFormat ? { depthFormat } : {}), width, height, isDefault };
  }
  // Retain owned bytes only for the current/last draw. The reply carries
  // versions, and Rust lends the data only until another GL operation.
  const bufferVersions = new Map<number, DrawBufferVersion>();
  let cachedBufferBytes = 0;
  let previousOversize: ReadonlyMap<number, DrawBufferVersion> | undefined;

  function forgetBufferVersion(slot: number): void {
    const version = bufferVersions.get(slot);
    if (!version) return;
    cachedBufferBytes -= version.data.byteLength;
    bufferVersions.delete(slot);
  }

  function clearBufferVersions(): void {
    bufferVersions.clear();
    cachedBufferBytes = 0;
    previousOversize = undefined;
  }

  function drawBuffer(reader: Reader, fromBatch: boolean, geometry: DrawGeometry): DrawBufferVersion {
    const owner = reader.u32();
    const slot = reader.u32();
    const generation = reader.u32();
    const storage = reader.u64();
    const content = reader.u64();
    const length = reader.u32();
    if (owner !== contextId || !slot || !generation || length > maxBufferBytes
      || (length && (!storage || !content))) {
      throw new Error('Invalid Rust draw buffer version.');
    }
    const oversize = length > maxCachedBufferBytes;
    let version = bufferVersions.get(slot) ?? geometry.oversize?.get(slot) ?? previousOversize?.get(slot);
    if (version?.generation === generation && version.storage === storage && version.content === content) {
      if (version.data.byteLength !== length) throw new Error('Inconsistent Rust draw buffer length.');
    } else {
      const pointer = abi.rf_draw_buffer_pointer(owner, slot, generation, storage, content, length);
      if (!pointer) throw new Error('Rust draw references an unavailable buffer version.');
      version = {
        generation, storage, content,
        data: memory(pointer, length).slice(),
        bufferVersion: `${slot}:${generation}:${storage}:${content}`,
      };
      if (fromBatch && batch) {
        batch.stats.bufferCopies++;
        batch.stats.bufferBytes += length;
      }
      forgetBufferVersion(slot);
      if (!oversize) {
        // Evict in insertion order so the common hit path performs no writes.
        while (bufferVersions.size >= maxCachedBufferVersions || cachedBufferBytes + length > maxCachedBufferBytes)
          forgetBufferVersion(bufferVersions.keys().next().value!);
        bufferVersions.set(slot, version);
        cachedBufferBytes += length;
      }
    }
    if (oversize) (geometry.oversize ??= new Map()).set(slot, version);
    return version;
  }
  function readDrawRaster(reader: Reader, width: number, height: number): RasterState {
    const state = readRaster(reader, width, height);
    const rasterFlags = reader.u32();
    state.polygonOffsetFill = (rasterFlags & 1) !== 0;
    state.depthClamp = (rasterFlags & 2) !== 0;
    state.polygonOffsetFactor = reader.f32();
    state.polygonOffsetUnits = reader.f32();
    state.polygonOffsetClamp = reader.f32();
    return state;
  }
  function readDrawGeometry(reader: Reader, fromBatch: boolean): DrawGeometry {
    const attributeCount = reader.u32();
    const geometry: DrawGeometry = { attributes: [], indices: null };
    for (let index = 0; index < attributeCount; index++) {
      const location = reader.u32();
      const shaderType = reader.u32();
      const size = reader.u32();
      const type = reader.u32();
      const normalized = reader.u32();
      if (!vertexComponentBytes(type) || normalized > 1) throw new Error('Invalid Rust vertex attribute format.');
      const stride = reader.u32();
      const offset = reader.u32();
      const constant = [reader.f32(), reader.f32(), reader.f32(), reader.f32()];
      const buffer = reader.u32() ? drawBuffer(reader, fromBatch, geometry) : null;
      geometry.attributes.push({ location, shaderType, size, type, normalized: normalized === 1,
        stride, offset, constant, data: buffer?.data ?? null, bufferVersion: buffer?.bufferVersion });
    }
    if (reader.u32()) {
      const type = reader.u32();
      const offset = reader.u32();
      const { data, bufferVersion } = drawBuffer(reader, fromBatch, geometry);
      geometry.indices = { type, offset, data, bufferVersion };
    }
    return geometry;
  }
  function executeDraw(bytes: Uint8Array, previous?: BatchDrawReferences): void {
    const reader = new Reader(bytes);
    const magic = reader.u32();
    const tag = reader.u32();
    const flags = tag >>> 8;
    if (magic !== 0x38444652 || (tag & 0xff) !== 8 || (flags & ~(previous?.supported ?? 0)) !== 0)
      throw new Error('Invalid Rust draw snapshot version.');
    const program = services.compiler.executable(reader.u32());
    reader.skip(12 + 8);
    const drawTarget = readTarget(reader);
    const state = flags & rasterReference ? previous?.raster : readDrawRaster(reader, drawTarget.width, drawTarget.height);
    if (!state) throw new Error('Missing Rust batch raster reference.');
    const mode = reader.u32();
    if (!isDrawMode(mode)) throw new Error('Invalid Rust draw mode.');
    const vertexCount = reader.u32();
    const first = reader.u32();
    const count = reader.u32();
    const geometry = flags & geometryReference ? previous?.geometry : readDrawGeometry(reader, previous !== undefined);
    if (!geometry) throw new Error('Missing Rust batch geometry reference.');
    const vertexUniforms = reader.bytes();
    const fragmentUniforms = reader.bytes();
    const textures = flags & textureReference ? previous?.textures : readTextures(reader);
    if (!textures) throw new Error('Missing Rust batch texture reference.');
    reader.finish();
    if (previous) {
      previous.raster = state;
      previous.geometry = geometry;
      previous.textures = textures.length ? textures : undefined;
    }
    previousOversize = geometry.oversize;
    services.host.draw({
      program,
      mode,
      target: drawTarget,
      state,
      attributes: geometry.attributes,
      vertexCount,
      first,
      count,
      indices: geometry.indices,
      vertexUniforms,
      fragmentUniforms,
      textures,
    });
    schedule();
  }
  function decode(reply: WireReply, binary: Uint8Array): unknown {
    switch (reply.type) {
      case 'null':
        return null;
      case 'boolean':
      case 'active':
      case 'object':
      case 'booleans':
        return reply.value;
      case 'handle':
        return Object.freeze(reply.value as object);
      case 'handles':
        return (reply.value as object[]).map((value) => Object.freeze(value));
      case 'number':
        if (binary.byteLength !== 8) throw new Error('Invalid scalar reply.');
        return new DataView(binary.buffer, binary.byteOffset, 8).getFloat64(0, true);
      case 'text':
        return utf16(binary);
      case 'ints':
      case 'floats': {
        if (binary.byteLength % 4) throw new Error('Invalid float reply.');
        const result =
          reply.type === 'ints'
            ? new Int32Array(binary.byteLength / 4)
            : new Float32Array(binary.byteLength / 4);
        const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
        for (let index = 0; index < result.length; index++)
          result[index] =
            reply.type === 'ints' ? view.getInt32(index * 4, true) : view.getFloat32(index * 4, true);
        return result;
      }
      case 'draw':
        executeDraw(binary);
        return undefined;
      case 'target': {
        const reader = new Reader(binary);
        const result = readTarget(reader);
        reader.finish();
        return result;
      }
      case 'read-pixels': {
        const reader = new Reader(binary);
        const result: ReadPixelsPlan = {
          target: readTarget(reader),
          sourceX: reader.u32(),
          sourceY: reader.u32(),
          copyWidth: reader.u32(),
          copyHeight: reader.u32(),
          destinationOffset: reader.u64(),
          destinationStride: reader.u64(),
          requiredBytes: reader.u64(),
        };
        reader.finish();
        return result;
      }
      case 'clear': {
        const reader = new Reader(binary);
        const clearTarget = readTarget(reader);
        const state = readRaster(reader, clearTarget.width, clearTarget.height);
        const mask = reader.u32();
        const color = [reader.f32(), reader.f32(), reader.f32(), reader.f32()];
        const depth = reader.f32();
        reader.finish();
        services.host.clear(clearTarget, state, mask, color, depth);
        schedule();
        return undefined;
      }
      case 'unsupported': {
        const error = new Error(`${reply.operation} is outside the Rust WebGL1 profile`);
        error.name = 'NotSupportedError';
        throw error;
      }
      default:
        throw new Error(`Unknown Rust drawing reply ${reply.type}.`);
    }
  }
  function handle(
    buffer: BufferHandle | null,
    callback: (context: number, slot: number, generation: number) => void,
  ): void {
    if (buffer === null) callback(0, 0, 0);
    else if (
      buffer.kind !== 'buffer' ||
      ![buffer.contextId, buffer.slot, buffer.generation].every(
        (value) => Number.isInteger(value) && value > 0 && value <= 0xffff_ffff,
      )
    )
      callback(0, 1, 1);
    else callback(buffer.contextId, buffer.slot, buffer.generation);
  }
  function bufferHandle(slot: number): BufferHandle | null {
    return slot === 0
      ? null
      : Object.freeze({
          kind: 'buffer',
          contextId,
          slot: slot >>> 0,
          generation: abi.rf_result_generation() >>> 0,
        });
  }
  function upload(bytes: Uint8Array): void {
    if (abi.rf_input_length() >>> 0 !== bytes.byteLength) throw new Error('Invalid Rust upload length.');
    memory(abi.rf_input_pointer(), bytes.byteLength).set(bytes);
    abi.rf_upload_commit();
  }
  command('initializeDrawing', [
    surface.width,
    surface.height,
    profile.vertexAttributes,
    profile.combinedTextureUnits,
    services.host.limits.maxTextureDimension2D,
    attributes.alpha ?? true,
    attributes.depth ?? true,
    attributes.stencil ?? false,
  ]);
  return Object.freeze({
    kind: 'rust' as const,
    contextId,
    maxBufferBytes,
    drainPendingCommands: drain,
    get enqueueVertexArrayBind() {
      if (!batch) return undefined;
      return enqueueVertexArrayBind;
    },
    createBuffer() { drain(); return bufferHandle(abi.rf_create_buffer()); },
    bindBuffer(target: number, buffer: BufferHandle | null) {
      drain();
      handle(buffer, (context, slot, generation) => abi.rf_bind_buffer(target, context, slot, generation));
    },
    deleteBuffer(buffer: BufferHandle | null) {
      drain();
      handle(buffer, (context, slot, generation) => {
        abi.rf_delete_buffer(context, slot, generation);
        if (context === contextId) {
          if (bufferVersions.get(slot)?.generation === generation) forgetBufferVersion(slot);
          if (previousOversize?.get(slot)?.generation === generation) {
            const remaining = new Map(previousOversize);
            remaining.delete(slot);
            previousOversize = remaining.size ? remaining : undefined;
          }
        }
      });
    },
    isBuffer(buffer: BufferHandle | null) {
      drain();
      let result = false;
      handle(buffer, (context, slot, generation) => {
        result = abi.rf_is_buffer(context, slot, generation) === 1;
      });
      return result;
    },
    getBinding(parameter: number) { drain(); return bufferHandle(abi.rf_get_binding(parameter)); },
    bufferData(target: number, data: number | Uint8Array | null, usage: number) {
      drain();
      if (data === null) abi.rf_buffer_data_null(target, usage);
      else if (typeof data === 'number') abi.rf_buffer_data_size(target, data, usage);
      else if (abi.rf_buffer_data_prepare(target, data.byteLength, usage)) upload(data);
    },
    bufferSubData(target: number, offset: number, data: Uint8Array) {
      drain();
      if (abi.rf_buffer_sub_data_prepare(target, offset, data.byteLength)) upload(data);
    },
    getBufferParameter(target: number, parameter: number) {
      drain();
      const value = abi.rf_get_buffer_parameter(target, parameter);
      return value < 0 ? null : value;
    },
    inspectBuffer(buffer: BufferHandle): BufferSnapshot | null {
      drain();
      let valid = false;
      handle(buffer, (context, slot, generation) => {
        valid = abi.rf_inspect_buffer(context, slot, generation) === 1;
      });
      if (!valid) return null;
      const byteLength = abi.rf_snapshot_length() >>> 0;
      return {
        handle: buffer,
        byteLength,
        usage: abi.rf_snapshot_usage() >>> 0,
        storageGeneration: abi.rf_snapshot_storage_generation(),
        contentVersion: abi.rf_snapshot_content_version(),
        data: memory(abi.rf_snapshot_pointer(), byteLength).slice(),
      };
    },
    getError() { drain(); return abi.rf_get_error() >>> 0; },
    markLost() {
      const changed = abi.rf_mark_lost() === 1;
      if (changed) {
        batch?.discard();
        batch = null;
        clearBufferVersions();
        services.compiler.dispose();
        services.resources.dispose();
      }
      return changed;
    },
    isContextLost: () => abi.rf_is_context_lost() === 1,
    dispose() {
      batch?.discard();
      batch = null;
      clearBufferVersions();
      abi.rf_dispose();
      services.compiler.dispose();
      services.resources.dispose();
    },
    captureTarget() {
      drain();
      if (abi.rf_is_context_lost()) throw new Error('Cannot capture a lost context.');
      syncSurface();
      const result = command('captureTarget', []);
      return decode(result.value, result.binary) as TargetSnapshot;
    },
    prepareReadPixels(request: ReadPixelsRequest) {
      drain();
      if (abi.rf_is_context_lost()) return null;
      syncSurface();
      const result = command('prepareReadPixels', [
        request.x,
        request.y,
        request.width,
        request.height,
        request.format,
        request.type,
        request.viewType,
        request.byteLength,
      ]);
      return decode(result.value, result.binary) as ReadPixelsPlan | null;
    },
    prepareDomTextureUpload(request: DomTextureUploadRequest): DomTextureUploadPlan | null {
      drain();
      if (abi.rf_is_context_lost()) return null;
      const result = command('prepareDomTextureUpload', [
        request.operation === 'texSubImage2D', request.target, request.level, request.internalFormat,
        request.x, request.y, request.width, request.height, request.format, request.type, request.sourceValid,
        request.sourceContextLost ?? false, ...(request.closedVideoFrame ? [true] : []),
      ]);
      const values = decode(result.value, result.binary);
      if (values === null) return null;
      if (!(values instanceof Int32Array) || values.length !== 3) {
        throw new Error('Invalid Rust DOM texture upload plan.');
      }
      return { flipY: values[0] === 1, premultiplyAlpha: values[1] === 1, colorSpaceConversion: values[2]! };
    },
    invoke(operation: string, args: unknown[]): unknown {
      if (operation === 'commandBatchStatsForTesting') return batch ? { ...batch.stats } : null;
      if (operation === 'supportsSrgbTextures') {
        const version = exports.rf_srgb_texture_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsShaderExtensions') {
        const version = exports.rf_shader_extensions_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsCoreExtensions') {
        const version = exports.rf_core_extensions_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsPolygonOffsetClamp') {
        const version = exports.rf_polygon_offset_clamp_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsDepthClamp') {
        const version = exports.rf_depth_clamp_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsDebugShaders') {
        const version = exports.rf_debug_shaders_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'getTranslatedShaderSource') {
        drain();
        if (abi.rf_is_context_lost()) return '';
        const result = command('getTranslatedShaderArtifact', args);
        const id = decode(result.value, result.binary);
        return typeof id === 'number' ? services.compiler.translatedShaderSource(id) : '';
      }
      if (operation === 'supportsFloatTextures') {
        const version = exports.rf_float_texture_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsFloatLinearTextures') {
        const version = exports.rf_float_linear_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'supportsVertexArrayObjects') {
        const version = exports.rf_vertex_array_protocol_version;
        return typeof version === 'function' && version() === 1;
      }
      if (operation === 'flush' || operation === 'finish') {
        drain();
        if (!abi.rf_is_context_lost()) services.host[operation]();
        return undefined;
      }
      if (batch) {
        if (operation === 'drawArrays' || operation === 'drawElements' || operation === 'clear')
          batch.surface(surface.width, surface.height);
        if (batch.enqueue(operation, args)) {
          schedule();
          return undefined;
        }
        drain();
      }
      if (abi.rf_is_context_lost()) {
        const result = command(operation, []);
        const value = decode(result.value, result.binary);
        return value === null && !operation.startsWith('get') && !operation.startsWith('create')
          ? undefined
          : value;
      }
      if (direct) {
        const result = direct.invoke(operation, args);
        if (result !== noDirectCommand) return result;
      }
      if (operation === 'getParameter') {
        const capabilities: Record<number, unknown> = {
          [GL.MAX_VERTEX_ATTRIBS]: profile.vertexAttributes,
          [GL.MAX_VERTEX_UNIFORM_VECTORS]: profile.vertexUniformVectors,
          [GL.MAX_FRAGMENT_UNIFORM_VECTORS]: profile.fragmentUniformVectors,
          [GL.MAX_VARYING_VECTORS]: profile.varyingVectors,
          [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: profile.vertexTextureUnits,
          [GL.MAX_TEXTURE_IMAGE_UNITS]: profile.fragmentTextureUnits,
          [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: profile.combinedTextureUnits,
          [GL.MAX_TEXTURE_SIZE]: services.host.limits.maxTextureDimension2D,
          [GL.MAX_CUBE_MAP_TEXTURE_SIZE]: services.host.limits.maxTextureDimension2D,
          [GL.MAX_RENDERBUFFER_SIZE]: services.host.limits.maxTextureDimension2D,
          [GL.MAX_VIEWPORT_DIMS]: new Int32Array([
            services.host.limits.maxTextureDimension2D,
            services.host.limits.maxTextureDimension2D,
          ]),
          [GL.VERSION]: 'WebGL 1.0 (Refral)',
          [GL.SHADING_LANGUAGE_VERSION]: 'WebGL GLSL ES 1.0 (ANGLE)',
          [GL.VENDOR]: 'Refral',
          [GL.RENDERER]: 'WebGPU',
          [GL.SAMPLES]: 0,
          [GL.SAMPLE_BUFFERS]: 0,
        };
        if (Object.hasOwn(capabilities, args[0] as number)) return capabilities[args[0] as number];
      }
      if (operation === 'compileShader' || operation === 'linkProgram') {
        const prepare = command(
          operation === 'compileShader' ? 'prepareCompileShader' : 'prepareLinkProgram',
          args,
        );
        const request = prepare.value;
        if (request.type === 'null') return undefined;
        if (operation === 'compileShader') {
          const compiled = services.compiler.compile(
            utf16(prepare.binary),
            request.stage === GL.VERTEX_SHADER ? 'vertex' : 'fragment',
            request.extensions ?? 0,
          );
          const committed = command('commitCompileShader', [request.shader], {
            request_id: request.requestId,
            result: {
              artifactId: compiled.artifactId,
              success: compiled.result.success,
              log: compiled.result.log,
            },
          });
          if (!committed.value.value) services.compiler.release([compiled.artifactId]);
        } else {
          if (request.vertexArtifact == null || request.fragmentArtifact == null) {
            command('commitLinkProgram', [request.program], {
              request_id: request.requestId,
              result: {
                artifactId: 0,
                success: false,
                log: 'Compiled vertex and fragment shaders are required.',
              },
            });
          } else {
            const linked = services.compiler.link(
              request.vertexArtifact,
              request.fragmentArtifact,
              new Map(request.bindings),
            );
            const committed = command('commitLinkProgram', [request.program], {
              request_id: request.requestId,
              result: { ...linked.result, artifactId: linked.artifactId },
            });
            if (!committed.value.value) services.compiler.release([linked.artifactId]);
          }
        }
        return undefined;
      }
      if (operation === 'drawArrays' || operation === 'drawElements' || operation === 'clear')
        syncSurface();
      const result = command(operation, args);
      let value: unknown;
      try {
        value = decode(result.value, result.binary);
      } finally {
        applyOperations(result.after);
      }
      if (operation === 'getParameter' && args[0] === GL.VIEWPORT && value instanceof Float32Array)
        return new Int32Array(value);
      if (operation === 'getParameter' && args[0] === GL.COMPRESSED_TEXTURE_FORMATS && value instanceof Int32Array)
        return new Uint32Array(value);
      return value === null && !operation.startsWith('get') && !operation.startsWith('create')
        ? undefined
        : value;
    },
  });
}
