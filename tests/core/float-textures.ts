import { expect, vi } from 'vitest';
import { GL, type DrawingCore, type ResourceRegistry } from '@refral/core-api';

export function checkFloatTextureStorage(core: DrawingCore, resources: ResourceRegistry) {
  const operations = vi.spyOn(resources, 'apply');
  const tex = core.invoke('createTexture', []);
  core.invoke('bindTexture', [GL.TEXTURE_2D, tex]);
  const define = (source: unknown) => core.invoke('texImage2D',
    [GL.TEXTURE_2D, 0, GL.LUMINANCE, 1, 2, 0, GL.LUMINANCE, GL.FLOAT, source]);
  const encoded = new Float32Array([99, -1.25, 0, 10000.125, 99]);
  const view = { bytes: new Uint8Array(encoded.buffer, 4, 12), viewType: 'Float32Array' };
  const values = (bytes: Uint8Array) => {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: bytes.byteLength / 4 }, (_, index) => data.getFloat32(index * 4, true));
  };
  expect(core.invoke('supportsFloatTextures', [])).toBe(true);
  define(null);
  expect(core.getError()).toBe(GL.INVALID_ENUM);
  core.invoke('enableFloatTextures', []);
  core.invoke('pixelStorei', [GL.UNPACK_ALIGNMENT, 8]);
  define(view);
  encoded.fill(0);
  expect(core.getError()).toBe(GL.NO_ERROR);
  const first = operations.mock.calls.at(-1)?.[0];
  if (first?.kind !== 'define-texture') throw new Error('Expected a texture definition.');
  expect(first.texelFormat).toBe('rgba32float');
  expect(values(first.data)).toEqual([-1.25,-1.25,-1.25,1, 10000.125,10000.125,10000.125,1]);
  const update = (source: unknown) => core.invoke('texSubImage2D',
    [GL.TEXTURE_2D, 0, 0, 1, 1, 1, GL.LUMINANCE, GL.FLOAT, source]);
  const initial = operations.mock.calls.length;
  update({ bytes: new Uint8Array(4), viewType: 'Int32Array' });
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  expect(operations.mock.calls.length).toBe(initial);
  encoded[0] = -456.5;
  update({ bytes: new Uint8Array(encoded.buffer, 0, 4), viewType: 'Float32Array' });
  encoded[0] = 0;
  const patch = operations.mock.calls.at(-1)?.[0];
  if (patch?.kind !== 'update-texture') throw new Error('Expected a subimage.');
  expect(resources.texture(patch.version).texelFormat).toBe('rgba32float');
  expect(values(patch.data)).toEqual([-456.5,-456.5,-456.5,1]);
  core.invoke('copyTexSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, 0, 0, 1, 1]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  const framebuffer = core.invoke('createFramebuffer', []);
  core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, framebuffer]);
  core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0]);
  expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
  define(null);
  const zero = operations.mock.calls.at(-1)?.[0];
  if (zero?.kind !== 'define-texture') throw new Error('Expected a zero-initialized texture.');
  expect(values(zero.data)).toEqual([0,0,0,1,0,0,0,1]);
  expect(core.getError()).toBe(GL.NO_ERROR);
}
