import { describe, expect, it, vi } from 'vitest';
import { GL } from '@refral/core-api';
import type { DrawingCore, PixelUpload, TextureHandle } from '@refral/core-api';
import { createResourceFacade } from './resources.js';

function setup(contextId = 1) {
  const texture: TextureHandle = { kind: 'texture', contextId, slot: 1, generation: 1 };
  const invoke = vi.fn((operation: string, _args: unknown[]) => {
    if (operation === 'createTexture' || operation === 'getParameter'
      || operation === 'getFramebufferAttachmentParameter') return texture;
    if (operation === 'createFramebuffer') return { ...texture, kind: 'framebuffer' };
    return undefined;
  });
  const facade = createResourceFacade({ contextId, invoke, isContextLost: () => false } as unknown as DrawingCore, () => new Uint8Array(0));
  return { ...facade, invoke, texture };
}

describe('resource facade conversion and identity', () => {
  it('converts coverage and depth bias arguments before mutating state', () => {
    const { methods, invoke } = setup();
    expect(() => methods.polygonOffset!(1)).toThrow(TypeError);
    expect(() => methods.sampleCoverage!(0.5)).toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    methods.polygonOffset!('1.1', -0.25);
    expect(invoke).toHaveBeenLastCalledWith('polygonOffset', [Math.fround(1.1), -0.25]);
    methods.sampleCoverage!('0.7', {});
    expect(invoke).toHaveBeenLastCalledWith('sampleCoverage', [Math.fround(0.7), true]);
  });

  it('converts hint enums and unrestricted line width before core dispatch', () => {
    const { methods, invoke } = setup();
    expect(() => methods.hint!(GL.GENERATE_MIPMAP_HINT)).toThrow(TypeError);
    expect(() => methods.lineWidth!()).toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    methods.hint!(2 ** 32 + GL.GENERATE_MIPMAP_HINT, String(GL.FASTEST));
    expect(invoke).toHaveBeenLastCalledWith('hint', [GL.GENERATE_MIPMAP_HINT, GL.FASTEST]);
    methods.lineWidth!('1.1');
    expect(invoke).toHaveBeenLastCalledWith('lineWidth', [Math.fround(1.1)]);
    methods.lineWidth!(undefined);
    expect(invoke).toHaveBeenLastCalledWith('lineWidth', [NaN]);
  });

  it('returns existing wrappers through bindings and attachment queries', () => {
    const facade = setup();
    const texture = facade.methods.createTexture!();
    expect(facade.binding(GL.TEXTURE_BINDING_2D)).toBe(texture);
    expect(facade.methods.getFramebufferAttachmentParameter!(GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)).toBe(texture);
    facade.methods.bindTexture!(GL.TEXTURE_2D, texture);
    expect(facade.invoke).toHaveBeenLastCalledWith('bindTexture', [GL.TEXTURE_2D, facade.texture]);
  });

  it('rejects wrapper-kind mistakes and carries foreign ownership to core validation', () => {
    const first = setup(1);
    const second = setup(2);
    const texture = first.methods.createTexture!();
    second.methods.bindTexture!(GL.TEXTURE_2D, texture);
    expect(second.invoke).toHaveBeenLastCalledWith('bindTexture', [GL.TEXTURE_2D, first.texture]);
    const framebuffer = first.methods.createFramebuffer!();
    expect(() => first.methods.bindTexture!(GL.TEXTURE_2D, framebuffer)).toThrow(TypeError);
    expect(() => first.methods.framebufferTexture2D!(GL.FRAMEBUFFER)).toThrow(TypeError);
  });

  it('uses internal view ranges and retains the source element type', () => {
    const facade = setup();
    const data = new Uint8Array([9, 1, 2, 3, 4, 9]);
    const view = data.subarray(1, 5);
    Object.defineProperty(view, 'byteOffset', { value: 0 });
    facade.methods.texImage2D!(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, view);
    const upload = facade.invoke.mock.calls.at(-1)![1][8] as PixelUpload;
    expect(upload.viewType).toBe('Uint8Array');
    expect([...upload.bytes]).toEqual([1, 2, 3, 4]);
    facade.methods.texImage2D!(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Float32Array(1));
    expect((facade.invoke.mock.calls.at(-1)![1][8] as PixelUpload).viewType).toBe('Float32Array');
  });

  it('validates compressed upload arguments before dispatch and transports only the view length', () => {
    const { methods, invoke } = setup();
    const rejected = () => { throw new Error('numeric argument conversion'); };
    const image = methods.compressedTexImage2D!;
    const subimage = methods.compressedTexSubImage2D!;
    expect(() => image(1, 0, 2, 4, 4, 0)).toThrow(TypeError);
    expect(() => subimage(1, 0, 0, 0, 4, 4, 2, null)).toThrow(TypeError);
    expect(() => image(1, 0, 2, 4, 4, 0, new ArrayBuffer(8))).toThrow(TypeError);
    expect(() => image(1, 0, { valueOf: rejected }, 4, 4, 0, null)).toThrow('numeric argument conversion');
    const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]);
    expect(() => image(1, 0, 2, 4, 4, 0, new Uint8Array(resizable))).toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    const view = new DataView(new SharedArrayBuffer(16), 2, 8);
    image(1, 0, 2, 4, 4, 0, view, { valueOf: rejected });
    expect(invoke).toHaveBeenLastCalledWith('compressedTexImage2D', [1, 0, 2, 4, 4, 0, 8]);
    subimage(1, 0, 0, 0, 4, 4, 2, new Uint8Array(12).subarray(2, 10));
    expect(invoke).toHaveBeenLastCalledWith('compressedTexSubImage2D', [1, 0, 0, 0, 4, 4, 2, 8]);
  });

  it('applies fixed-view WebIDL checks before semantic dispatch', () => {
    const facade = setup();
    const image = (pixels: unknown) => facade.methods.texImage2D!(GL.TEXTURE_2D, 0, GL.RGBA,
      1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, pixels);
    expect(() => image(new ArrayBuffer(4))).toThrow(TypeError);
    const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]);
    expect(() => image(new Uint8Array(resizable))).toThrow(TypeError);
    expect(facade.invoke).not.toHaveBeenCalled();
    image(null);
    expect(facade.invoke.mock.calls.at(-1)![1][8]).toBeNull();
    facade.methods.texSubImage2D!(GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(facade.invoke).toHaveBeenLastCalledWith('texSubImage2D',
      [GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, null]);
  });
});
