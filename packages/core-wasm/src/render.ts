import { createRasterState, GL } from '@refral/core-api';
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
  PixelUpload,
} from '@refral/core-api';

const DEFAULT_URL = '/artifacts/core-wasm/refral_core.wasm';
const modules = new Map<string, Promise<WebAssembly.Module>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ABI {
  memory: WebAssembly.Memory;
  rf_abi_version(): number;
  rf_resource_protocol_version(): number;
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
  buffer(): Uint8Array {
    this.skip(12 + 16);
    return this.bytes();
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
  return state;
}

export function createRustDrawingCoreFromModule(
  module: WebAssembly.Module,
  options: DrawingCoreOptions,
  services: DrawingCoreServices,
): DrawingCore {
  const { contextId, maxBufferBytes, surface, profile, attributes } = options;
  if (
    !Number.isInteger(contextId) ||
    contextId <= 0 ||
    contextId > 0xffff_ffff ||
    !Number.isSafeInteger(maxBufferBytes) ||
    maxBufferBytes < 0
  )
    throw new RangeError('Invalid Rust context options.');
  const exports = new WebAssembly.Instance(module, {}).exports;
  const required: (keyof Omit<ABI, 'memory'>)[] = [
    'rf_abi_version',
    'rf_resource_protocol_version',
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
    throw new Error('Rust drawing module does not expose resource ABI v3. Rebuild with pnpm rust:build.');
  }
  const abi = exports as unknown as ABI;
  if (abi.rf_abi_version() !== 3 || abi.rf_resource_protocol_version() !== 1)
    throw new Error('Rust resource protocol mismatch. Rebuild with pnpm rust:build.');
  if (abi.rf_init(contextId, maxBufferBytes) !== 1)
    throw new Error('Rust drawing ABI initialization failed.');

  function memory(pointer: number, length: number): Uint8Array {
    const start = pointer >>> 0;
    const buffer = abi.memory.buffer;
    if (start > buffer.byteLength || length > buffer.byteLength - start)
      throw new Error('Invalid Rust arena range.');
    return new Uint8Array(buffer, start, length);
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
        const bytes =
          upload.viewType === 'Uint8Array' || upload.viewType === 'Uint8ClampedArray'
            ? upload.bytes
            : new Uint8Array();
        return { p: [append(bytes), bytes.byteLength], viewType: upload.viewType };
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
      scheduled = false;
      if (!abi.rf_is_context_lost()) services.host.flush();
    });
  }
  function target(width = surface.width, height = surface.height): TargetSnapshot {
    return { color: null, depth: null, depthGeneration: 0, width, height, isDefault: true };
  }
  function textureVersion(reader: Reader): TextureVersion {
    const texture = {
      kind: 'texture' as const,
      contextId: reader.u32(),
      slot: reader.u32(),
      generation: reader.u32(),
    };
    return { texture, storageGeneration: reader.u64(), contentVersion: reader.u64() };
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
        services.resources.apply({ kind: 'retire-depth', renderbuffer, storageGeneration: reader.u64() });
        continue;
      }
      const version = textureVersion(reader);
      if (kind === 1) {
        const width = reader.u32();
        const height = reader.u32();
        services.resources.apply({ kind: 'define-texture', version, width, height, data: pixels() });
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
      } else if (kind === 3) {
        services.resources.apply({ kind: 'write-texture', version, previous: textureVersion(reader) });
      } else if (kind === 4) {
        services.resources.apply({ kind: 'retire-texture', version });
      } else throw new Error('Invalid Rust resource operation.');
    }
    reader.finish();
    if (count) schedule();
  }
  function textureBinding(reader: Reader): TextureBinding {
    const version = reader.u32() ? textureVersion(reader) : null;
    const parameters = {
      minFilter: reader.u32(),
      magFilter: reader.u32(),
      wrapS: reader.u32(),
      wrapT: reader.u32(),
    };
    return { storage: version ? services.resources.texture(version) : null, parameters };
  }
  function executeDraw(bytes: Uint8Array): void {
    const reader = new Reader(bytes);
    if (reader.u32() !== 0x33444652 || reader.u32() !== 3)
      throw new Error('Invalid Rust draw snapshot version.');
    const program = services.compiler.executable(reader.u32());
    reader.skip(12 + 8);
    const width = reader.u32();
    const height = reader.u32();
    const state = readRaster(reader, width, height);
    const vertexCount = reader.u32();
    const first = reader.u32();
    const count = reader.u32();
    const attributeCount = reader.u32();
    const vertexAttributes: DrawOperation['attributes'] = [];
    for (let index = 0; index < attributeCount; index++) {
      const location = reader.u32();
      const shaderType = reader.u32();
      const size = reader.u32();
      const stride = reader.u32();
      const offset = reader.u32();
      const constant = [reader.f32(), reader.f32(), reader.f32(), reader.f32()];
      const data = reader.u32() ? reader.buffer() : null;
      vertexAttributes.push({ location, shaderType, size, stride, offset, constant, data });
    }
    const indices = reader.u32() ? { type: reader.u32(), offset: reader.u32(), data: reader.buffer() } : null;
    const vertexUniforms = reader.bytes();
    const fragmentUniforms = reader.bytes();
    const textureCount = reader.u32();
    const textures: TextureBinding[] = [];
    for (let index = 0; index < textureCount; index++) textures.push(textureBinding(reader));
    reader.finish();
    services.host.draw({
      program,
      target: target(width, height),
      state,
      attributes: vertexAttributes,
      vertexCount,
      first,
      count,
      indices,
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
      case 'clear': {
        const reader = new Reader(binary);
        const width = reader.u32();
        const height = reader.u32();
        const state = readRaster(reader, width, height);
        const mask = reader.u32();
        const color = [reader.f32(), reader.f32(), reader.f32(), reader.f32()];
        const depth = reader.f32();
        reader.finish();
        services.host.clear(target(width, height), state, mask, color, depth);
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
  ]);
  return Object.freeze({
    kind: 'rust' as const,
    contextId,
    maxBufferBytes,
    createBuffer: () => bufferHandle(abi.rf_create_buffer()),
    bindBuffer(target: number, buffer: BufferHandle | null) {
      handle(buffer, (context, slot, generation) => abi.rf_bind_buffer(target, context, slot, generation));
    },
    deleteBuffer(buffer: BufferHandle | null) {
      handle(buffer, (context, slot, generation) => abi.rf_delete_buffer(context, slot, generation));
    },
    isBuffer(buffer: BufferHandle | null) {
      let result = false;
      handle(buffer, (context, slot, generation) => {
        result = abi.rf_is_buffer(context, slot, generation) === 1;
      });
      return result;
    },
    getBinding: (parameter: number) => bufferHandle(abi.rf_get_binding(parameter)),
    bufferData(target: number, data: number | Uint8Array | null, usage: number) {
      if (data === null) abi.rf_buffer_data_null(target, usage);
      else if (typeof data === 'number') abi.rf_buffer_data_size(target, data, usage);
      else if (abi.rf_buffer_data_prepare(target, data.byteLength, usage)) upload(data);
    },
    bufferSubData(target: number, offset: number, data: Uint8Array) {
      if (abi.rf_buffer_sub_data_prepare(target, offset, data.byteLength)) upload(data);
    },
    getBufferParameter(target: number, parameter: number) {
      const value = abi.rf_get_buffer_parameter(target, parameter);
      return value < 0 ? null : value;
    },
    inspectBuffer(buffer: BufferHandle): BufferSnapshot | null {
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
    getError: () => abi.rf_get_error() >>> 0,
    markLost() {
      const changed = abi.rf_mark_lost() === 1;
      if (changed) {
        services.compiler.dispose();
        services.resources.dispose();
      }
      return changed;
    },
    isContextLost: () => abi.rf_is_context_lost() === 1,
    dispose() {
      abi.rf_dispose();
      services.compiler.dispose();
      services.resources.dispose();
    },
    captureTarget: () => target(),
    invoke(operation: string, args: unknown[]): unknown {
      if (operation === 'flush') {
        services.host.flush();
        return undefined;
      }
      if (operation === 'getParameter' && !abi.rf_is_context_lost()) {
        const capabilities: Record<number, unknown> = {
          [GL.MAX_VERTEX_ATTRIBS]: profile.vertexAttributes,
          [GL.MAX_VERTEX_UNIFORM_VECTORS]: profile.vertexUniformVectors,
          [GL.MAX_FRAGMENT_UNIFORM_VECTORS]: profile.fragmentUniformVectors,
          [GL.MAX_VARYING_VECTORS]: profile.varyingVectors,
          [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: profile.vertexTextureUnits,
          [GL.MAX_TEXTURE_IMAGE_UNITS]: profile.fragmentTextureUnits,
          [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: profile.combinedTextureUnits,
          [GL.MAX_TEXTURE_SIZE]: services.host.limits.maxTextureDimension2D,
          [GL.MAX_RENDERBUFFER_SIZE]: services.host.limits.maxTextureDimension2D,
          [GL.MAX_VIEWPORT_DIMS]: new Int32Array([
            services.host.limits.maxTextureDimension2D,
            services.host.limits.maxTextureDimension2D,
          ]),
          [GL.VERSION]: 'WebGL 1.0 (Refral)',
          [GL.SHADING_LANGUAGE_VERSION]: 'WebGL GLSL ES 1.0 (ANGLE)',
          [GL.VENDOR]: 'Refral',
          [GL.RENDERER]: 'WebGPU',
          [GL.RED_BITS]: 8,
          [GL.GREEN_BITS]: 8,
          [GL.BLUE_BITS]: 8,
          [GL.ALPHA_BITS]: attributes.alpha ? 8 : 0,
          [GL.DEPTH_BITS]: attributes.depth ? 24 : 0,
          [GL.STENCIL_BITS]: 0,
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
        command('setSurfaceSize', [surface.width, surface.height]);
      const result = command(operation, args);
      let value: unknown;
      try {
        value = decode(result.value, result.binary);
      } finally {
        applyOperations(result.after);
      }
      if (operation === 'getParameter' && args[0] === GL.VIEWPORT && value instanceof Float32Array)
        return new Int32Array(value);
      return value === null && !operation.startsWith('get') && !operation.startsWith('create')
        ? undefined
        : value;
    },
  });
}
