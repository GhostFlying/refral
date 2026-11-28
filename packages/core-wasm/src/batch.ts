import type { DrawingSurface, RasterState, VertexArrayHandle } from '@refral/core-api';
import { handle, lists, littleEndian, scalars } from './direct.js';
import type { DrawGeometry } from './render.js';

const capacity = 128 * 1024;
const baseNumericCommands = new Map([
  ['drawArrays', [21, 3]], ['drawElements', [22, 4]], ['clear', [23, 1]],
  ['viewport', [24, 4]], ['scissor', [25, 4]], ['enable', [26, 1]], ['disable', [27, 1]],
]);
const frontFaceOpcode = 28;
const extendedNumericCommands = new Map(baseNumericCommands).set('frontFace', [frontFaceOpcode, 1]);

export const rasterReference = 1;
export const geometryReference = 2;

export interface BatchDrawReferences {
  supported: number;
  raster?: RasterState;
  geometry?: DrawGeometry;
}

type Acknowledge = (accepted: boolean) => void;

export interface RustCommandBatchStats {
  commands: number;
  batches: number;
  inputBytes: number;
  outputBytes: number;
  bufferCopies: number;
  bufferBytes: number;
}

export function createCommandBatch(exports: WebAssembly.Exports,
  memory: (pointer: number, length: number) => Uint8Array,
  apply: (kind: number, bytes: Uint8Array, previous: BatchDrawReferences) => void, surface: DrawingSurface) {
  const version = exports.rf_batch_protocol_version;
  const open = exports.rf_batch_input_pointer;
  const run = exports.rf_batch_run;
  const output = exports.rf_batch_output_pointer;
  if (!littleEndian || typeof version !== 'function' || version() !== 1 ||
      typeof open !== 'function' || typeof run !== 'function' || typeof output !== 'function') return null;

  const compact = exports.rf_batch_run_compact;
  const supported = typeof compact === 'function' ? rasterReference | geometryReference : 0;
  const runBatch = typeof compact === 'function'
    ? (length: number, width: number, height: number) => compact(length, width, height, supported)
    : run;

  const numericMax = exports.rf_batch_numeric_opcode_max;
  const numericCommands = typeof numericMax === 'function' && numericMax() >= frontFaceOpcode
    ? extendedNumericCommands : baseNumericCommands;
  const pointer = open() as number;
  if (!pointer) return null;
  let bytes = memory(pointer, capacity);
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  let width = surface.width;
  let height = surface.height;
  const pollResize = surface.bindResizeBarrier?.(replay);
  let pendingAcknowledgments: Acknowledge[] | undefined;
  const stats: RustCommandBatchStats = {
    commands: 0, batches: 0, inputBytes: 0, outputBytes: 0, bufferCopies: 0, bufferBytes: 0,
  };

  function drain(): void {
    if (!cursor) return;
    pollResize?.();
    replay();
  }

  function replay(): void {
    if (!cursor) return;
    const length = (runBatch as (length: number, width: number, height: number) => number)(cursor, width, height) >>> 0;
    stats.batches++;
    stats.inputBytes += cursor;
    cursor = 0;
    const acknowledgments = pendingAcknowledgments;
    pendingAcknowledgments = undefined;
    let acknowledged = 0;
    if (length === 0xffff_ffff) throw new Error('Rust rejected a command batch.');
    stats.outputBytes += length;
    if (length) {
      // Own one copy for the whole drain. Host-side consumers can use Wasm
      // exports while resolving the Buffer versions in these records.
      const reply = memory((output as () => number)(), length).slice();
      const records = new DataView(reply.buffer);
      const previous: BatchDrawReferences = { supported };
      for (let offset = 0; offset < length;) {
        const kind = records.getUint32(offset, true);
        const size = records.getUint32(offset + 4, true);
        offset += 8;
        if (size > length - offset) throw new Error('Invalid Rust batch record length.');
        if (kind === 5) {
          const callback = acknowledgments?.[acknowledged++];
          if (!callback || size !== 4) throw new Error('Invalid Rust VAO acknowledgment.');
          callback(records.getUint32(offset, true) === 1);
        } else {
          apply(kind, reply.subarray(offset, offset + size), previous);
        }
        offset += size;
      }
    }
    if (acknowledged !== (acknowledgments?.length ?? 0)) throw new Error('Missing Rust VAO acknowledgment.');
  }

  function begin(length: number, opcode: number): number {
    if (cursor + length > capacity) drain();
    if (bytes.byteLength === 0) {
      bytes = memory(pointer, capacity);
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    view.setUint32(cursor, opcode, true);
    const start = cursor + 4;
    cursor += length;
    stats.commands++;
    return start;
  }

  function writeHandle(start: number, object: NonNullable<ReturnType<typeof handle>>): void {
    view.setUint32(start, object.contextId, true);
    view.setUint32(start + 4, object.slot, true);
    view.setUint32(start + 8, object.generation, true);
  }

  function writeNumbers(start: number, args: unknown[], first: number): void {
    for (let i = 0; i < 4; i++) view.setFloat64(start + 8 * i, (args[first + i] as number | undefined) ?? 0, true);
  }

  function scalarArgs(args: unknown[], first: number, count: number): boolean {
    if (args.length !== first + count) return false;
    for (let i = first; i < args.length; i++) if (typeof args[i] !== 'number') return false;
    return true;
  }

  return {
    stats,
    drain,
    discard() {
      cursor = 0;
      pendingAcknowledgments = undefined;
    },
    surface(nextWidth: number, nextHeight: number) {
      pollResize?.();
      if (width !== nextWidth || height !== nextHeight) {
        replay();
        width = nextWidth;
        height = nextHeight;
      }
    },
    bindVertexArray(value: VertexArrayHandle | null, acknowledgment: Acknowledge): boolean {
      const object = handle(value, 'vertex-array');
      if (!object) return false;
      writeHandle(begin(16, 19), object);
      (pendingAcknowledgments ??= []).push(acknowledgment);
      return true;
    },
    enqueue(operation: string, args: unknown[]): boolean {
      const numeric = numericCommands.get(operation);
      if (numeric) {
        if (!scalarArgs(args, 0, numeric[1]!)) return false;
        writeNumbers(begin(36, numeric[0]!), args, 0);
        return true;
      }
      if (operation === 'useProgram') {
        const object = handle(args[0], 'program');
        if (!object || args.length !== 1) return false;
        writeHandle(begin(16, 20), object);
        return true;
      }
      const scalar = scalars.get(operation);
      if (scalar !== undefined) {
        const object = handle(args[0], 'uniform-location');
        if (!object || !scalarArgs(args, 1, scalar % 4 + 1)) return false;
        const start = begin(48, scalar);
        writeHandle(start, object);
        writeNumbers(start + 12, args, 1);
        return true;
      }
      const list = lists.get(operation);
      if (list === undefined) return false;
      const object = handle(args[0], 'uniform-location');
      const matrix = list >= 8;
      const integer = list >= 4 && list < 8;
      const transpose = matrix ? args[1] : false;
      const values = args[matrix ? 2 : 1];
      if (!object || typeof transpose !== 'boolean' || !(values instanceof (integer ? Int32Array : Float32Array))
        || values.byteLength + 24 > capacity) return false;
      const start = begin(24 + values.byteLength, 8 + list);
      writeHandle(start, object);
      view.setUint32(start + 12, Number(transpose), true);
      view.setUint32(start + 16, values.length, true);
      bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), start + 20);
      return true;
    },
  };
}
