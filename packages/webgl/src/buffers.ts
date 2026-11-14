import { GL, bufferHandleKey } from '@refral/core-api';
import type { BufferCore, BufferHandle } from '@refral/core-api';

class RefralBuffer {}

const handles = new WeakMap<object, BufferHandle>();
const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const sharedByteLength = typeof SharedArrayBuffer === 'undefined' ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')!.get!;
const growable = typeof SharedArrayBuffer === 'undefined' ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'growable')?.get;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const typedOffset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset')!.get!;
const typedLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!.get!;
const viewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')!.get!;
const viewOffset = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteOffset')!.get!;
const viewLength = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength')!.get!;

function storage(value: unknown): { value: ArrayBufferLike; length: number; variable: boolean } | null {
  try {
    const length = byteLength.call(value) as number;
    return { value: value as ArrayBuffer, length, variable: resizable?.call(value) ?? false };
  } catch { /* Try the other AllowSharedBufferSource storage type. */ }
  if (sharedByteLength) {
    try {
      const length = sharedByteLength.call(value) as number;
      return { value: value as SharedArrayBuffer, length, variable: growable?.call(value) ?? false };
    } catch { /* The value uses the numeric bufferData overload. */ }
  }
  return null;
}

export function requireArguments(name: string, args: readonly unknown[], minimum: number): void {
  if (args.length < minimum) throw new TypeError(`${name} requires at least ${minimum} arguments.`);
}

export function toEnum(value: unknown): number {
  return +(value as number) >>> 0;
}

function toSize(value: unknown): number {
  const number = +(value as number);
  if (!Number.isFinite(number) || number === 0) return 0;
  const integer = Math.trunc(number);
  return Number.isSafeInteger(integer) ? integer : Number(BigInt.asIntN(64, BigInt(integer)));
}

function bytes(value: unknown): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    let buffer: ArrayBufferLike;
    let offset: number;
    let length: number;
    try {
      buffer = typedBuffer.call(value);
      offset = typedOffset.call(value);
      length = typedLength.call(value);
    } catch {
      buffer = viewBuffer.call(value);
      offset = viewOffset.call(value);
      length = viewLength.call(value);
    }
    const backing = storage(buffer)!;
    if (backing.variable) throw new TypeError('WebGL buffer sources require fixed-length storage.');
    return new Uint8Array(buffer, offset, length);
  }
  const backing = storage(value);
  if (!backing || backing.variable) throw new TypeError('Expected a fixed-length AllowSharedBufferSource.');
  return new Uint8Array(backing.value, 0, backing.length);
}

function bufferDataSource(value: unknown): number | Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (ArrayBuffer.isView(value) || storage(value)) return bytes(value);
  return toSize(value);
}

function unwrap(value: unknown): BufferHandle | null {
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'object' && typeof value !== 'function') || !handles.has(value)) {
    throw new TypeError('Expected a Refral WebGLBuffer.');
  }
  return handles.get(value)!;
}

export function createBufferFacade(core: BufferCore) {
  const wrappers = new Map<string, WebGLBuffer>();

  function wrap(handle: BufferHandle | null): WebGLBuffer | null {
    if (!handle) return null;
    const key = bufferHandleKey(handle);
    let wrapper = wrappers.get(key);
    if (!wrapper) {
      wrapper = new RefralBuffer() as WebGLBuffer;
      handles.set(wrapper, handle);
      wrappers.set(key, wrapper);
    }
    return wrapper;
  }

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createBuffer: () => {
      if (core.isContextLost()) {
        // Public WebGL objects created during loss exist in an invalidated state.
        // No logical resource is allocated; zero is never a live core handle.
        const wrapper = new RefralBuffer() as WebGLBuffer;
        handles.set(wrapper, Object.freeze({ kind: 'buffer', contextId: core.contextId, slot: 0, generation: 0 }));
        return wrapper;
      }
      return wrap(core.createBuffer());
    },
    bindBuffer: (...args) => {
      requireArguments('bindBuffer', args, 2);
      core.bindBuffer(toEnum(args[0]), unwrap(args[1]));
    },
    bufferData: (...args) => {
      requireArguments('bufferData', args, 3);
      const target = toEnum(args[0]);
      const source = bufferDataSource(args[1]);
      core.bufferData(target, source, toEnum(args[2]));
    },
    bufferSubData: (...args) => {
      requireArguments('bufferSubData', args, 3);
      const target = toEnum(args[0]);
      const offset = toSize(args[1]);
      const source = bytes(args[2]);
      core.bufferSubData(target, offset, source);
    },
    getBufferParameter: (...args) => {
      requireArguments('getBufferParameter', args, 2);
      return core.getBufferParameter(toEnum(args[0]), toEnum(args[1]));
    },
    deleteBuffer: (...args) => {
      requireArguments('deleteBuffer', args, 1);
      const handle = unwrap(args[0]);
      core.deleteBuffer(handle);
      if (handle?.contextId === core.contextId && !core.isBuffer(handle)) {
        wrappers.delete(bufferHandleKey(handle));
      }
    },
    isBuffer: (...args) => {
      requireArguments('isBuffer', args, 1);
      return core.isBuffer(unwrap(args[0]));
    },
  };

  return {
    methods,
    wrap,
    binding: (parameter: number) => wrap(core.getBinding(parameter)),
    inspect: (buffer: WebGLBuffer) => {
      const handle = unwrap(buffer);
      return handle ? core.inspectBuffer(handle) : null;
    },
    dispose: () => wrappers.clear(),
  };
}

export function isBufferBinding(parameter: number): boolean {
  return parameter === GL.ARRAY_BUFFER_BINDING || parameter === GL.ELEMENT_ARRAY_BUFFER_BINDING;
}
