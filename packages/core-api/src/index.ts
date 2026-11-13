export { GL } from './gl.js';

export type CoreKind = 'js' | 'rust';

export interface BufferHandle {
  readonly contextId: number;
  readonly slot: number;
  readonly generation: number;
}

export interface BufferCoreOptions {
  readonly contextId: number;
  readonly maxBufferBytes: number;
}

export interface BufferSnapshot {
  readonly handle: BufferHandle;
  readonly byteLength: number;
  readonly usage: number;
  readonly storageGeneration: number;
  readonly contentVersion: number;
  readonly data: Uint8Array;
}

export interface BufferCore {
  readonly kind: CoreKind;
  readonly contextId: number;
  readonly maxBufferBytes: number;
  createBuffer(): BufferHandle | null;
  bindBuffer(target: number, buffer: BufferHandle | null): void;
  bufferData(target: number, data: number | Uint8Array | null, usage: number): void;
  bufferSubData(target: number, offset: number, data: Uint8Array): void;
  getBufferParameter(target: number, parameter: number): number | null;
  getBinding(parameter: number): BufferHandle | null;
  deleteBuffer(buffer: BufferHandle | null): void;
  isBuffer(buffer: BufferHandle | null): boolean;
  getError(): number;
  markLost(): boolean;
  isContextLost(): boolean;
  inspectBuffer(buffer: BufferHandle): BufferSnapshot | null;
  dispose(): void;
}

let nextContextId = 1;

export function allocateContextId(): number {
  if (nextContextId > 0xffff_ffff) throw new RangeError('Context identifier capacity exhausted.');
  return nextContextId++;
}

export function bufferHandleKey(handle: BufferHandle): string {
  return `${handle.contextId}/${handle.slot}/${handle.generation}`;
}
