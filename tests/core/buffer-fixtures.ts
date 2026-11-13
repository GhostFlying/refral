import { GL } from '@refral/core-api';
import type { BufferSnapshot } from '@refral/core-api';

export type BufferBackend = 'native' | 'js' | 'rust';
export interface BufferCheck {
  readonly name: string;
  readonly actual: unknown;
  readonly expected: unknown;
  readonly passed: boolean;
}
export interface BufferEvidence {
  readonly checks: BufferCheck[];
  readonly snapshots: Record<string, SerializedBufferSnapshot | null>;
}
export interface SerializedBufferSnapshot {
  readonly byteLength: number;
  readonly usage: number;
  readonly storageGeneration: number;
  readonly contentVersion: number;
  readonly data: number[];
}
export type InspectBuffer = (buffer: WebGLBuffer) => BufferSnapshot | null;

export function createBufferEvidence(): BufferEvidence {
  return { checks: [], snapshots: {} };
}

export function check(evidence: BufferEvidence, name: string, actual: unknown, expected: unknown): void {
  evidence.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
}

export function snapshot(evidence: BufferEvidence, name: string, buffer: WebGLBuffer,
  inspect?: InspectBuffer): SerializedBufferSnapshot | null {
  if (!inspect) return null;
  const value = inspect(buffer);
  const serialized = value && {
    byteLength: value.byteLength, usage: value.usage,
    storageGeneration: value.storageGeneration, contentVersion: value.contentVersion,
    data: Array.from(value.data),
  };
  evidence.snapshots[name] = serialized;
  return serialized;
}

function call(evidence: BufferEvidence, gl: WebGLRenderingContext, name: string,
  operation: () => unknown, error: number = GL.NO_ERROR, exception: string | null = null): void {
  let thrown: string | null = null;
  try { operation(); } catch (value) { thrown = value instanceof Error ? value.name : String(value); }
  check(evidence, `${name}: exception`, thrown, exception);
  check(evidence, `${name}: error`, gl.getError(), error);
  check(evidence, `${name}: error consumed`, gl.getError(), GL.NO_ERROR);
}

/** Shared public WebGL1 calls. Native inspection deliberately uses only public queries. */
export function runPublicBufferFixture(gl: WebGLRenderingContext, foreign: WebGLBuffer,
  inspect?: InspectBuffer): BufferEvidence {
  const evidence = createBufferEvidence();
  const buffer = gl.createBuffer()!;
  check(evidence, 'created object exists', buffer !== null, true);
  check(evidence, 'wrapper is extensible', Object.isExtensible(buffer), true);
  const annotated = buffer as WebGLBuffer & { refralTestTag?: string };
  annotated.refralTestTag = 'caller-owned';
  check(evidence, 'not an object before first bind', gl.isBuffer(buffer), false);
  check(evidence, 'initial array binding', gl.getParameter(GL.ARRAY_BUFFER_BINDING), null);
  check(evidence, 'initial element binding', gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING), null);
  call(evidence, gl, 'first bind', () => gl.bindBuffer(GL.ARRAY_BUFFER, buffer));
  check(evidence, 'query preserves wrapper identity', gl.getParameter(GL.ARRAY_BUFFER_BINDING) === buffer, true);
  check(evidence, 'binding preserves caller property',
    (gl.getParameter(GL.ARRAY_BUFFER_BINDING) as typeof annotated).refralTestTag, 'caller-owned');
  check(evidence, 'object after first bind', gl.isBuffer(buffer), true);
  gl.bindBuffer(GL.ARRAY_BUFFER, null);
  check(evidence, 'unbound object remains valid', gl.isBuffer(buffer), true);
  gl.bindBuffer(GL.ARRAY_BUFFER, buffer);

  call(evidence, gl, 'numeric allocation', () => gl.bufferData(GL.ARRAY_BUFFER, 6, GL.DYNAMIC_DRAW));
  check(evidence, 'numeric allocation size', gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE), 6);
  check(evidence, 'numeric allocation usage', gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_USAGE), GL.DYNAMIC_DRAW);
  const allocated = snapshot(evidence, 'numeric allocation', buffer, inspect);
  if (allocated) check(evidence, 'numeric allocation zero bytes', allocated.data, [0, 0, 0, 0, 0, 0]);

  const source = new Uint8Array([90, 1, 2, 3, 4, 91]);
  call(evidence, gl, 'typed view allocation', () => gl.bufferData(GL.ARRAY_BUFFER,
    new Uint16Array(source.buffer, 2, 1), GL.STATIC_DRAW));
  source.fill(0);
  check(evidence, 'typed view byte length', gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE), 2);
  const typed = snapshot(evidence, 'typed view after caller mutation', buffer, inspect);
  if (typed) check(evidence, 'typed view byte offset and snapshot', typed.data, [2, 3]);

  const viewSource = new Uint8Array([90, 10, 20, 30, 40, 91]);
  call(evidence, gl, 'DataView allocation', () => gl.bufferData(GL.ARRAY_BUFFER,
    new DataView(viewSource.buffer, 1, 4), GL.STREAM_DRAW));
  viewSource.fill(0);
  const beforeUpdate = snapshot(evidence, 'DataView allocation', buffer, inspect);
  if (beforeUpdate) check(evidence, 'DataView snapshot bytes', beforeUpdate.data, [10, 20, 30, 40]);
  const updateSource = new Uint8Array([90, 77, 88, 91]);
  call(evidence, gl, 'subrange DataView update', () => gl.bufferSubData(GL.ARRAY_BUFFER, 1,
    new DataView(updateSource.buffer, 1, 2)));
  updateSource.fill(0);
  const updated = snapshot(evidence, 'subrange after caller mutation', buffer, inspect);
  if (updated && beforeUpdate) {
    check(evidence, 'subrange destination and source offset', updated.data, [10, 77, 88, 40]);
    check(evidence, 'subrange retains storage generation', updated.storageGeneration, beforeUpdate.storageGeneration);
    check(evidence, 'subrange advances content version', updated.contentVersion > beforeUpdate.contentVersion, true);
    check(evidence, 'previous snapshot retains bytes', beforeUpdate.data, [10, 20, 30, 40]);
  }

  call(evidence, gl, 'empty update at end', () => gl.bufferSubData(GL.ARRAY_BUFFER, 4, new Uint8Array()));
  const empty = snapshot(evidence, 'empty update', buffer, inspect);
  if (empty && updated) check(evidence, 'empty update preserves versions and data', empty, updated);

  // Each rejected call starts with no pending error and must retain storage and binding.
  const invalid: [string, () => unknown, number, string | null][] = [
    ['invalid bind target', () => gl.bindBuffer(0xdead, buffer), GL.INVALID_ENUM, null],
    ['target reuse', () => gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, buffer), GL.INVALID_OPERATION, null],
    ['invalid allocation target', () => gl.bufferData(0xdead, 3, GL.STATIC_DRAW), GL.INVALID_ENUM, null],
    ['invalid usage', () => gl.bufferData(GL.ARRAY_BUFFER, 3, 0xdead), GL.INVALID_ENUM, null],
    ['negative size', () => gl.bufferData(GL.ARRAY_BUFFER, -1, GL.STATIC_DRAW), GL.INVALID_VALUE, null],
    ['invalid usage before negative size', () => gl.bufferData(GL.ARRAY_BUFFER, -1, 0xdead), GL.INVALID_ENUM, null],
    ['null allocation', () => gl.bufferData(GL.ARRAY_BUFFER, null, GL.STATIC_DRAW), GL.INVALID_VALUE, null],
    ['negative update offset', () => gl.bufferSubData(GL.ARRAY_BUFFER, -1, new Uint8Array([1])), GL.INVALID_VALUE, null],
    ['update beyond range', () => gl.bufferSubData(GL.ARRAY_BUFFER, 3, new Uint8Array([1, 2])), GL.INVALID_VALUE, null],
    ['empty update beyond end', () => gl.bufferSubData(GL.ARRAY_BUFFER, 5, new Uint8Array()), GL.INVALID_VALUE, null],
    ['null update', () => gl.bufferSubData(GL.ARRAY_BUFFER, 5, null as unknown as ArrayBuffer), GL.NO_ERROR, 'TypeError'],
    ['invalid query target', () => check(evidence, 'invalid target result', gl.getBufferParameter(0xdead, GL.BUFFER_SIZE), null), GL.INVALID_ENUM, null],
    ['invalid query parameter', () => check(evidence, 'invalid parameter result', gl.getBufferParameter(GL.ARRAY_BUFFER, 0xdead), null), GL.INVALID_ENUM, null],
  ];
  for (const [name, operation, error, exception] of invalid) {
    call(evidence, gl, name, operation, error, exception);
    check(evidence, `${name}: binding retained`, gl.getParameter(GL.ARRAY_BUFFER_BINDING) === buffer, true);
    check(evidence, `${name}: size retained`, gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE), 4);
    check(evidence, `${name}: usage retained`, gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_USAGE), GL.STREAM_DRAW);
    const retained = snapshot(evidence, name, buffer, inspect);
    if (retained && updated) check(evidence, `${name}: data and versions retained`, retained, updated);
  }

  check(evidence, 'foreign isBuffer returns false', gl.isBuffer(foreign), false);
  check(evidence, 'foreign isBuffer has no error', gl.getError(), GL.NO_ERROR);
  call(evidence, gl, 'foreign bind', () => gl.bindBuffer(GL.ARRAY_BUFFER, foreign), GL.INVALID_OPERATION);
  call(evidence, gl, 'foreign before invalid target', () => gl.bindBuffer(0xdead, foreign), GL.INVALID_OPERATION);
  call(evidence, gl, 'foreign delete', () => gl.deleteBuffer(foreign), GL.INVALID_OPERATION);
  check(evidence, 'foreign errors retain binding', gl.getParameter(GL.ARRAY_BUFFER_BINDING) === buffer, true);
  snapshot(evidence, 'after foreign errors', buffer, inspect);

  if (inspect) {
    const original = inspect(buffer)!;
    original.data.fill(0);
    check(evidence, 'inspection owns returned bytes', Array.from(inspect(buffer)!.data), [10, 77, 88, 40]);
    gl.bufferSubData(GL.ARRAY_BUFFER, 5, new Uint8Array([1]));
    inspect(buffer);
    check(evidence, 'inspection preserves pending GL error', gl.getError(), GL.INVALID_VALUE);
  }

  call(evidence, gl, 'reallocation', () => gl.bufferData(GL.ARRAY_BUFFER, 8, GL.DYNAMIC_DRAW));
  const replacement = snapshot(evidence, 'reallocated', buffer, inspect);
  if (replacement && updated) {
    check(evidence, 'reallocation advances storage', replacement.storageGeneration > updated.storageGeneration, true);
    check(evidence, 'reallocation advances content', replacement.contentVersion > updated.contentVersion, true);
    check(evidence, 'reallocation zero bytes', replacement.data, Array(8).fill(0));
  }

  // WebIDL conversion belongs to the facade, so these values reach each semantic core as integers.
  for (const [name, size, expected] of [['fractional', 1.5, 1], ['negative fraction', -0.5, 0],
    ['NaN', NaN, 0], ['Infinity', Infinity, 0]] as const) {
    call(evidence, gl, `${name} size`, () => gl.bufferData(GL.ARRAY_BUFFER, size, GL.STATIC_DRAW));
    check(evidence, `${name} normalized size`, gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE), expected);
  }
  gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3]), GL.STATIC_DRAW);
  call(evidence, gl, 'fractional offset', () => gl.bufferSubData(GL.ARRAY_BUFFER, 1.5, new Uint8Array([7])));
  call(evidence, gl, 'NaN offset', () => gl.bufferSubData(GL.ARRAY_BUFFER, NaN, new Uint8Array([8])));
  const numeric = snapshot(evidence, 'normalized offsets', buffer, inspect);
  if (numeric) check(evidence, 'normalized offset bytes', numeric.data, [8, 7, 3]);

  call(evidence, gl, 'delete bound object', () => gl.deleteBuffer(buffer));
  check(evidence, 'delete clears binding', gl.getParameter(GL.ARRAY_BUFFER_BINDING), null);
  check(evidence, 'deleted isBuffer false', gl.isBuffer(buffer), false);
  if (inspect) check(evidence, 'deleted inspection null', inspect(buffer), null);
  call(evidence, gl, 'repeated delete', () => gl.deleteBuffer(buffer));
  call(evidence, gl, 'deleted bind', () => gl.bindBuffer(GL.ARRAY_BUFFER, buffer), GL.INVALID_OPERATION);
  call(evidence, gl, 'deleted before invalid target', () => gl.bindBuffer(0xdead, buffer), GL.INVALID_OPERATION);
  const next = gl.createBuffer()!;
  check(evidence, 'replacement wrapper identity distinct', next !== buffer, true);
  gl.bindBuffer(GL.ARRAY_BUFFER, next);
  call(evidence, gl, 'unbound data', () => gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, 4, GL.STATIC_DRAW), GL.INVALID_OPERATION);
  call(evidence, gl, 'unbound subdata', () => gl.bufferSubData(GL.ELEMENT_ARRAY_BUFFER, 0, new Uint8Array([1])), GL.INVALID_OPERATION);
  gl.deleteBuffer(next);
  check(evidence, 'final error state', gl.getError(), GL.NO_ERROR);
  return evidence;
}
