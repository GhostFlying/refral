import { interfaceRecord, webglInterfaces } from './interfaces.js';
import { GL } from '@refral/core-api';
import type { DrawingCore, LogicalHandle } from '@refral/core-api';
import { requireArguments, toEnum } from './buffers.js';

type ObjectKind = 'shader' | 'program' | 'uniform-location';
const objects = new WeakMap<object, LogicalHandle>();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedArrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get!;

function unwrap(value: unknown, kind: ObjectKind, nullable = false): LogicalHandle | null {
  if (nullable && (value === null || value === undefined)) return null;
  const handle = value !== null && (typeof value === 'object' || typeof value === 'function')
    ? objects.get(value) : undefined;
  if (!handle || handle.kind !== kind) throw new TypeError(`Expected a Refral WebGL ${kind}.`);
  return handle;
}

function domString(value: unknown): string {
  if (typeof value === 'symbol') throw new TypeError('A Symbol cannot be converted to DOMString.');
  return String(value);
}

function float(value: unknown): number { return Math.fround(+(value as number)); }
function integer(value: unknown): number { return +(value as number) | 0; }

function list(value: unknown, integral: boolean): Float32Array | Int32Array {
  if (value === null || value === undefined
    || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new TypeError('Expected an iterable uniform or attribute value list.');
  }
  // The union accepts fixed shared typed arrays. Resizable storage is excluded
  // by the pinned IDL, including views whose current length is fixed.
  const expectedType = integral ? 'Int32Array' : 'Float32Array';
  if (ArrayBuffer.isView(value) && typedArrayTag.call(value) === expectedType) {
    const buffer = typedArrayBuffer.call(value) as ArrayBufferLike;
    const descriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
    const sharedDescriptor = typeof SharedArrayBuffer === 'undefined' ? undefined
      : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'growable');
    let variable = false;
    try { variable = descriptor?.get?.call(buffer) ?? false; }
    catch { variable = sharedDescriptor?.get?.call(buffer) ?? false; }
    if (variable) throw new TypeError('WebGL value lists require fixed-length storage.');
    const offset = typedArrayOffset.call(value) as number;
    const length = typedArrayLength.call(value) as number;
    return integral ? new Int32Array(buffer, offset, length).slice()
      : new Float32Array(buffer, offset, length).slice();
  }
  if (typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw new TypeError('Expected an iterable uniform or attribute value list.');
  }
  const values = Array.from(value as Iterable<unknown>, integral ? integer : float);
  return integral ? Int32Array.from(values) : Float32Array.from(values);
}

/** Facade-owned wrapper identity and WebIDL conversion for program operations. */
export function createProgramFacade(core: DrawingCore, interfaces = webglInterfaces()) {
  const wrappers = new Map<string, object>();
  function wrap(handle: LogicalHandle | null): object | null {
    if (!handle) return null;
    if (handle.kind !== 'shader' && handle.kind !== 'program' && handle.kind !== 'uniform-location') {
      throw new Error('Resource handle returned by a program operation.');
    }
    const key = `${handle.kind}/${handle.contextId}/${handle.slot}/${handle.generation}`;
    let wrapper = handle.kind === 'uniform-location' ? undefined : wrappers.get(key);
    if (!wrapper) {
      wrapper = Object.create(interfaces[handle.kind]) as object;
      objects.set(wrapper, handle);
      if (handle.kind !== 'uniform-location') wrappers.set(key, wrapper);
    }
    return wrapper;
  }

  const methods: Record<string, (...args: unknown[]) => unknown> = {};
  function method(name: string, minimum: number,
    normalize: (args: unknown[]) => unknown[], result: (value: unknown) => unknown = value => value) {
    methods[name] = (...args) => {
      requireArguments(name, args, minimum);
      return result(core.invoke(name, normalize(args)));
    };
  }
  const shader = (value: unknown, nullable = false) => unwrap(value, 'shader', nullable);
  const program = (value: unknown, nullable = false) => unwrap(value, 'program', nullable);
  const location = (value: unknown, nullable = true) => unwrap(value, 'uniform-location', nullable);
  const wrapResult = (value: unknown) => wrap(value as LogicalHandle | null);

  method('createShader', 1, args => [toEnum(args[0])], wrapResult);
  method('createProgram', 0, () => [], wrapResult);
  for (const name of ['compileShader', 'getShaderInfoLog', 'getShaderSource']) {
    method(name, 1, args => [shader(args[0])]);
  }
  method('shaderSource', 2, args => [shader(args[0]), domString(args[1])]);
  method('getShaderParameter', 2, args => [shader(args[0]), toEnum(args[1])]);
  for (const name of ['deleteShader', 'isShader']) method(name, 1, args => [shader(args[0], true)]);
  for (const name of ['linkProgram', 'validateProgram', 'getProgramInfoLog']) {
    method(name, 1, args => [program(args[0])]);
  }
  for (const name of ['deleteProgram', 'isProgram', 'useProgram']) {
    method(name, 1, args => [program(args[0], true)]);
  }
  for (const name of ['attachShader', 'detachShader']) {
    method(name, 2, args => [program(args[0]), shader(args[1])]);
  }
  method('getAttachedShaders', 1, args => [program(args[0])], value => (
    value === null ? null : (value as LogicalHandle[]).map(wrap)
  ));
  method('bindAttribLocation', 3, args => [program(args[0]), toEnum(args[1]), domString(args[2])]);
  method('getProgramParameter', 2, args => [program(args[0]), toEnum(args[1])]);
  for (const name of ['getActiveAttrib', 'getActiveUniform']) {
    method(name, 2, args => [program(args[0]), toEnum(args[1])],
      value => interfaceRecord(interfaces.activeInfo, value));
  }
  method('getAttribLocation', 2, args => [program(args[0]), domString(args[1])]);
  method('getUniformLocation', 2, args => [program(args[0]), domString(args[1])], wrapResult);
  method('getUniform', 2, args => [program(args[0]), location(args[1], false)]);
  method('getShaderPrecisionFormat', 2, args => [toEnum(args[0]), toEnum(args[1])],
    value => interfaceRecord(interfaces.precisionFormat, value));

  for (let width = 1; width <= 4; width++) {
    for (const type of ['f', 'i']) {
      const integral = type === 'i';
      const convert = integral ? integer : float;
      method(`uniform${width}${type}`, width + 1, args => [
        location(args[0]), ...args.slice(1, width + 1).map(convert),
      ]);
      method(`uniform${width}${type}v`, 2, args => [location(args[0]), list(args[1], integral)]);
    }
    if (width >= 2) method(`uniformMatrix${width}fv`, 3, args => [
      location(args[0]), Boolean(args[1]), list(args[2], false),
    ]);
    method(`vertexAttrib${width}f`, width + 1, args => [
      toEnum(args[0]), ...args.slice(1, width + 1).map(float),
    ]);
    method(`vertexAttrib${width}fv`, 2, args => [toEnum(args[0]), list(args[1], false)]);
  }
  method('vertexAttribPointer', 6, args => [toEnum(args[0]), integer(args[1]), toEnum(args[2]),
    Boolean(args[3]), integer(args[4]), toOffset(args[5])]);
  for (const name of ['enableVertexAttribArray', 'disableVertexAttribArray']) {
    method(name, 1, args => [toEnum(args[0])]);
  }
  method('drawArrays', 3, args => [toEnum(args[0]), integer(args[1]), integer(args[2])]);
  method('drawElements', 4, args => [toEnum(args[0]), integer(args[1]), toEnum(args[2]), toOffset(args[3])]);
  method('viewport', 4, args => args.slice(0, 4).map(integer));
  method('clear', 1, args => [toEnum(args[0])]);
  method('clearColor', 4, args => args.slice(0, 4).map(float));
  method('clearDepth', 1, args => [float(args[0])]);
  method('getVertexAttrib', 2, args => [toEnum(args[0]), toEnum(args[1])]);
  method('getVertexAttribOffset', 2, args => [toEnum(args[0]), toEnum(args[1])]);
  return {
    methods,
    current: () => wrap(core.invoke('getParameter', [GL.CURRENT_PROGRAM]) as LogicalHandle | null),
    dispose: () => wrappers.clear(),
  };
}

function toOffset(value: unknown): number {
  const number = +(value as number);
  if (!Number.isFinite(number) || number === 0) return 0;
  return Number(BigInt.asIntN(64, BigInt(Math.trunc(number))));
}
