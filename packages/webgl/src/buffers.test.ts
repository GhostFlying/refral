import { expect, it } from 'vitest';
import { allocateContextId, GL } from '@refral/core-api';
import { createJsContractCore } from '../../../tests/core/js-buffer-factory';
import { createBufferFacade } from './buffers';

function setup() {
  const core = createJsContractCore({ contextId: allocateContextId(), maxBufferBytes: 64 });
  const facade = createBufferFacade(core);
  const buffer = facade.methods.createBuffer!() as WebGLBuffer;
  facade.methods.bindBuffer!(GL.ARRAY_BUFFER, buffer);
  return { core, facade, buffer, data: () => facade.inspect(buffer)! };
}

it('selects the numeric overload for numeric objects and functions', () => {
  const { core, facade, data } = setup();
  for (const value of [new Number(3), { valueOf: () => 3 }, function () {}]) {
    facade.methods.bufferData!(GL.ARRAY_BUFFER, value, GL.STATIC_DRAW);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(data().byteLength).toBe(typeof value === 'function' ? 0 : 3);
  }
});

it('accepts fixed shared storage and consumes selected bytes before return', () => {
  const { core, facade, data } = setup();
  const buffer = new SharedArrayBuffer(6);
  const input = new Uint8Array(buffer);
  input.set([9, 1, 2, 3, 4, 8]);
  facade.methods.bufferData!(GL.ARRAY_BUFFER, new DataView(buffer, 1, 4), GL.STATIC_DRAW);
  input.fill(0);
  expect(Array.from(data().data)).toEqual([1, 2, 3, 4]);
  input.set([9, 5, 6, 7, 8, 9]);
  facade.methods.bufferSubData!(GL.ARRAY_BUFFER, 1, new Uint8Array(buffer, 2, 2));
  input.fill(0);
  expect(Array.from(data().data)).toEqual([1, 6, 7, 4]);
  facade.methods.bufferData!(GL.ARRAY_BUFFER, buffer, GL.STATIC_DRAW);
  expect(data().byteLength).toBe(6);
  expect(core.getError()).toBe(GL.NO_ERROR);
});

it('uses buffer-view internal slots when callers shadow view properties', () => {
  const { facade, data } = setup();
  for (const view of [new Uint8Array([1, 2, 3, 4]), new DataView(new Uint8Array([1, 2, 3, 4]).buffer)]) {
    Object.defineProperties(view, {
      buffer: { value: new ArrayBuffer(1) }, byteOffset: { value: 99 }, byteLength: { value: 99 },
    });
    facade.methods.bufferData!(GL.ARRAY_BUFFER, view, GL.STATIC_DRAW);
    expect(Array.from(data().data)).toEqual([1, 2, 3, 4]);
  }
});

it('rejects resizable, growable and detached storage before GL validation', () => {
  const { core, facade } = setup();
  const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
  const shared = Reflect.construct(SharedArrayBuffer, [4, { maxByteLength: 8 }]) as SharedArrayBuffer;
  const detached = new ArrayBuffer(4);
  structuredClone(detached, { transfer: [detached] });
  for (const value of [resizable, new Uint8Array(resizable), shared, new DataView(shared), detached]) {
    expect(() => facade.methods.bufferData!(0xdead, value, GL.STATIC_DRAW)).toThrow(TypeError);
    expect(core.getError()).toBe(GL.NO_ERROR);
  }
});

it('performs argument conversion left to right and preserves conversion exceptions', () => {
  const { core, facade, data } = setup();
  const order: string[] = [];
  facade.methods.bufferData!(
    { valueOf() { order.push('target'); return GL.ARRAY_BUFFER; } },
    { valueOf() { order.push('size'); return 3; } },
    { valueOf() { order.push('usage'); return GL.STATIC_DRAW; } },
  );
  expect(order).toEqual(['target', 'size', 'usage']);
  expect(data().byteLength).toBe(3);
  expect(() => facade.methods.bufferData!(GL.ARRAY_BUFFER, Symbol('size'), GL.STATIC_DRAW)).toThrow(TypeError);
  expect(core.getError()).toBe(GL.NO_ERROR);
});
