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
