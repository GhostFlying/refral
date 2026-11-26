import type { BufferCore, BufferCoreOptions, BufferHandle, BufferSnapshot } from '@refral/core-api';

const ABI_VERSION = 7;
const DEFAULT_WASM_URL = '/artifacts/core-wasm/refral_core.wasm';
const UINT32_MAX = 0xffff_ffff;

interface CoreExports {
  readonly memory: WebAssembly.Memory;
  rf_abi_version(): number;
  rf_init(contextId: number, maxBufferBytes: number): number;
  rf_create_buffer(): number;
  rf_result_generation(): number;
  rf_bind_buffer(target: number, contextId: number, slot: number, generation: number): void;
  rf_buffer_data_size(target: number, size: number, usage: number): void;
  rf_buffer_data_null(target: number, usage: number): void;
  rf_buffer_data_prepare(target: number, length: number, usage: number): number;
  rf_buffer_sub_data_prepare(target: number, offset: number, length: number): number;
  rf_input_pointer(): number;
  rf_input_length(): number;
  rf_upload_commit(): void;
  rf_get_buffer_parameter(target: number, parameter: number): number;
  rf_get_binding(parameter: number): number;
  rf_delete_buffer(contextId: number, slot: number, generation: number): void;
  rf_is_buffer(contextId: number, slot: number, generation: number): number;
  rf_get_error(): number;
  rf_mark_lost(): number;
  rf_is_context_lost(): number;
  rf_inspect_buffer(contextId: number, slot: number, generation: number): number;
  rf_snapshot_pointer(): number;
  rf_snapshot_length(): number;
  rf_snapshot_usage(): number;
  rf_snapshot_storage_generation(): number;
  rf_snapshot_content_version(): number;
  rf_dispose(): void;
}

const exportNames = [
  'rf_abi_version', 'rf_init', 'rf_create_buffer', 'rf_result_generation',
  'rf_bind_buffer', 'rf_buffer_data_size', 'rf_buffer_data_null',
  'rf_buffer_data_prepare', 'rf_buffer_sub_data_prepare', 'rf_input_pointer',
  'rf_input_length', 'rf_upload_commit', 'rf_get_buffer_parameter', 'rf_get_binding',
  'rf_delete_buffer', 'rf_is_buffer', 'rf_get_error', 'rf_mark_lost',
  'rf_is_context_lost', 'rf_inspect_buffer', 'rf_snapshot_pointer', 'rf_snapshot_length',
  'rf_snapshot_usage', 'rf_snapshot_storage_generation', 'rf_snapshot_content_version',
  'rf_dispose',
] as const;

const modules = new Map<string, Promise<WebAssembly.Module>>();

function loadModule(url: string): Promise<WebAssembly.Module> {
  const existing = modules.get(url);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Rust core Wasm fetch failed (${response.status}): ${url}`);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  modules.set(url, pending);
  void pending.catch(() => {
    if (modules.get(url) === pending) modules.delete(url);
  });
  return pending;
}

function checkedExports(instance: WebAssembly.Instance): CoreExports {
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)
    || exportNames.some((name) => typeof exports[name] !== 'function')) {
    throw new Error('Rust core Wasm does not expose the required Buffer ABI. Rebuild with pnpm rust:build.');
  }
  const abi = exports as unknown as CoreExports;
  if (abi.rf_abi_version() !== ABI_VERSION) {
    throw new Error(`Rust core ABI version mismatch; expected ${ABI_VERSION}. Rebuild with pnpm rust:build.`);
  }
  return abi;
}

function isPositiveU32(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= UINT32_MAX;
}

type HandleCall<T> = (contextId: number, slot: number, generation: number) => T;

function withHandle<T>(buffer: BufferHandle | null, call: HandleCall<T>): T {
  if (buffer === null) return call(0, 0, 0);
  if (buffer.kind !== 'buffer' || !isPositiveU32(buffer.contextId)
    || !isPositiveU32(buffer.slot) || !isPositiveU32(buffer.generation)) {
    // Preserve a nonnull invalid handle across the i32 ABI, rather than wrapping
    // a malformed number onto a live object or turning it into a null binding.
    return call(0, 1, 1);
  }
  return call(buffer.contextId, buffer.slot, buffer.generation);
}

function memoryBytes(abi: CoreExports, pointer: number, length: number): Uint8Array {
  const start = pointer >>> 0;
  const size = length >>> 0;
  const memory = abi.memory.buffer;
  if (start > memory.byteLength || size > memory.byteLength - start) {
    throw new Error('Rust core returned an invalid arena range.');
  }
  // A prepare or inspection call can grow memory, detaching earlier views.
  return new Uint8Array(memory, start, size);
}

/** Initializes a separate Rust semantic context using the shared compiled module. */
export async function createRustBufferCore(
  options: BufferCoreOptions,
  wasmURL: string = DEFAULT_WASM_URL,
): Promise<BufferCore> {
  const { contextId, maxBufferBytes } = options;
  if (!isPositiveU32(contextId)) throw new RangeError('contextId must be a positive u32.');
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 0) {
    throw new RangeError('maxBufferBytes must be a nonnegative safe integer.');
  }
  const abi = checkedExports(await WebAssembly.instantiate(await loadModule(wasmURL), {}));
  if (abi.rf_init(contextId, maxBufferBytes) !== 1) {
    throw new Error('Rust Buffer core initialization failed.');
  }

  function resultHandle(slot: number): BufferHandle | null {
    if (slot === 0) return null;
    return Object.freeze({ kind: 'buffer', contextId, slot: slot >>> 0, generation: abi.rf_result_generation() >>> 0 });
  }

  function upload(data: Uint8Array): void {
    if ((abi.rf_input_length() >>> 0) !== data.byteLength) {
      throw new Error('Rust core upload arena length differs from the requested input.');
    }
    memoryBytes(abi, abi.rf_input_pointer(), data.byteLength).set(data);
    abi.rf_upload_commit();
  }

  return Object.freeze({
    kind: 'rust' as const,
    contextId,
    maxBufferBytes,
    createBuffer: () => resultHandle(abi.rf_create_buffer()),
    bindBuffer(target: number, buffer: BufferHandle | null): void {
      withHandle(buffer, (context, slot, generation) => abi.rf_bind_buffer(target, context, slot, generation));
    },
    bufferData(target: number, data: number | Uint8Array | null, usage: number): void {
      if (data === null) abi.rf_buffer_data_null(target, usage);
      else if (typeof data === 'number') abi.rf_buffer_data_size(target, data, usage);
      else if (abi.rf_buffer_data_prepare(target, data.byteLength, usage) === 1) upload(data);
    },
    bufferSubData(target: number, offset: number, data: Uint8Array): void {
      if (abi.rf_buffer_sub_data_prepare(target, offset, data.byteLength) === 1) upload(data);
    },
    getBufferParameter(target: number, parameter: number): number | null {
      const result = abi.rf_get_buffer_parameter(target, parameter);
      return result < 0 ? null : result;
    },
    getBinding: (parameter: number) => resultHandle(abi.rf_get_binding(parameter)),
    deleteBuffer(buffer: BufferHandle | null): void {
      withHandle(buffer, (context, slot, generation) => abi.rf_delete_buffer(context, slot, generation));
    },
    isBuffer: (buffer: BufferHandle | null) => withHandle(buffer, (context, slot, generation) => (
      abi.rf_is_buffer(context, slot, generation) === 1
    )),
    getError: () => abi.rf_get_error() >>> 0,
    markLost: () => abi.rf_mark_lost() === 1,
    isContextLost: () => abi.rf_is_context_lost() === 1,
    inspectBuffer(buffer: BufferHandle): BufferSnapshot | null {
      if (withHandle(buffer, (context, slot, generation) => abi.rf_inspect_buffer(context, slot, generation)) !== 1) {
        return null;
      }
      const byteLength = abi.rf_snapshot_length() >>> 0;
      return {
        handle: Object.freeze({ kind: 'buffer', contextId: buffer.contextId, slot: buffer.slot, generation: buffer.generation }),
        byteLength,
        usage: abi.rf_snapshot_usage() >>> 0,
        storageGeneration: abi.rf_snapshot_storage_generation(),
        contentVersion: abi.rf_snapshot_content_version(),
        data: memoryBytes(abi, abi.rf_snapshot_pointer(), byteLength).slice(),
      };
    },
    dispose: () => abi.rf_dispose(),
  });
}
export { createRustDrawingCore, createRustDrawingCoreFromModule, prepareRustDrawingCores, prepareRustModule } from './render.js';
export type { RustCommandBatchStats } from './batch.js';
