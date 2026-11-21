import type { LogicalHandle } from '@refral/core-api';

// Keep these selector orders in sync with direct command protocol v1 in Rust.
const scalars = new Map([
  'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniform2i', 'uniform3i', 'uniform4i',
].map((name, index) => [name, index]));
const lists = new Map([
  'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv', 'uniform2iv', 'uniform3iv', 'uniform4iv',
  'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv',
].map((name, index) => [name, index]));
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const bindVertexArray = 8;
const setSurfaceSize = 9;
const nullHandle = { contextId: 0, slot: 0, generation: 0 };
export const noDirectCommand = Symbol('no direct command');

function u32(value: unknown): value is number {
  return typeof value === 'number' && value === value >>> 0;
}

function handle(arg: unknown, kind: LogicalHandle['kind']) {
  if (arg === null) return nullHandle;
  if (!arg || typeof arg !== 'object') return undefined;
  const value = arg as LogicalHandle;
  if (value.kind !== kind || !u32(value.contextId) || !u32(value.slot) || !u32(value.generation)) return undefined;
  // Only a null input may use the null sentinel.
  return value.contextId || value.slot || value.generation ? value : undefined;
}

export function createDirectCommands(exports: WebAssembly.Exports,
  memory: (pointer: number, bytes: number) => Uint8Array) {
  const version = exports.rf_direct_command_protocol_version;
  const scalar = exports.rf_direct_scalar as (opcode: number, context: number, slot: number, generation: number,
    x: number, y: number, z: number, w: number) => number;
  const prepare = exports.rf_direct_list_prepare as (length: number) => number;
  const commit = exports.rf_direct_list_commit as (opcode: number, context: number, slot: number, generation: number,
    transpose: number) => void;
  if (typeof version !== 'function' || version() !== 1 || typeof scalar !== 'function'
    || typeof prepare !== 'function' || typeof commit !== 'function') return null;

  return {
    surface(width: number, height: number): void {
      scalar(setSurfaceSize, 0, 0, 0, width, height, 0, 0);
    },
    invoke(operation: string, args: unknown[]): boolean | undefined | typeof noDirectCommand {
      if (operation === 'bindVertexArrayOES') {
        const object = handle(args[0], 'vertex-array');
        if (!object) return noDirectCommand;
        return scalar(bindVertexArray, object.contextId, object.slot, object.generation, 0, 0, 0, 0) === 1;
      }
      const scalarOpcode = scalars.get(operation);
      if (scalarOpcode !== undefined) {
        const object = handle(args[0], 'uniform-location');
        if (!object || args.length !== scalarOpcode % 4 + 2) return noDirectCommand;
        const [, x, y = 0, z = 0, w = 0] = args;
        if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof w !== 'number')
          return noDirectCommand;
        scalar(scalarOpcode, object.contextId, object.slot, object.generation, x, y, z, w);
        return undefined;
      }
      const listOpcode = lists.get(operation);
      if (listOpcode === undefined || !littleEndian) return noDirectCommand;
      const object = handle(args[0], 'uniform-location');
      const matrix = listOpcode >= 8;
      const integer = listOpcode >= 4 && listOpcode < 8;
      const transpose = matrix ? args[1] : false;
      const values = args[matrix ? 2 : 1];
      if (!object || typeof transpose !== 'boolean' || !(values instanceof (integer ? Int32Array : Float32Array))
        || !u32(values.byteLength)) return noDirectCommand;
      const pointer = prepare(values.byteLength);
      if (pointer !== 0) {
        memory(pointer, values.byteLength).set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
        commit(listOpcode, object.contextId, object.slot, object.generation, Number(transpose));
      }
      return undefined;
    },
  };
}
