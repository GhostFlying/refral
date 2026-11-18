import { expect, vi } from 'vitest';
import { GL, SRGB, type DrawingCore, type ResourceRegistry } from '@refral/core-api';

export function checkSrgbTextureState(core: DrawingCore, resources: ResourceRegistry): void {
  const calls = vi.spyOn(resources, 'apply').mock.calls;
  const tex = core.invoke('createTexture', []);
  core.invoke('bindTexture', [GL.TEXTURE_2D, tex]);
  const image = (format: number, type: number, source: unknown) => core.invoke('texImage2D',
    [GL.TEXTURE_2D, 0, format, 1, 1, 0, format, type, source]);
  image(SRGB.SRGB_ALPHA_EXT, GL.UNSIGNED_BYTE, null);
  expect(core.getError()).toBe(GL.INVALID_ENUM);
  core.invoke('enableSrgbTextures', []);
  core.invoke('enableFloatTextures', []);
  image(SRGB.SRGB_ALPHA_EXT, GL.FLOAT, null);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  const fb = core.invoke('createFramebuffer', []);
  core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, fb]);
  const colorEncoding = () => core.invoke('getFramebufferAttachmentParameter',
    [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, SRGB.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT]);
  expect(colorEncoding()).toBeNull();
  expect(core.getError()).toBe(GL.INVALID_ENUM);
  core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0]);
  expect(colorEncoding()).toBe(GL.LINEAR);
  for (const [format, alpha, complete] of [[SRGB.SRGB_EXT, 255, false], [SRGB.SRGB_ALPHA_EXT, 41, true]] as const) {
    const data = new Uint8Array([12, 78, 134, 41]);
    image(format, GL.UNSIGNED_BYTE, { bytes: data, viewType: 'Uint8Array' });
    data.fill(0);
    const definition = calls.at(-1)?.[0];
    if (definition?.kind !== 'define-texture') throw new Error('Expected an sRGB texture definition.');
    expect(definition.texelFormat).toBe('rgba8unorm-srgb');
    expect([...definition.data]).toEqual([12,78,134,alpha]);
    expect(colorEncoding()).toBe(SRGB.SRGB_EXT);
    expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(
      complete ? GL.FRAMEBUFFER_COMPLETE : GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
    core.invoke('generateMipmap', [GL.TEXTURE_2D]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
  }
  const linear = core.invoke('createTexture', []);
  core.invoke('bindTexture', [GL.TEXTURE_2D, linear]);
  image(GL.RGBA, GL.UNSIGNED_BYTE, null);
  const copySub = () => core.invoke('copyTexSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, 0, 0, 1, 1]);
  copySub();
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, null]);
  core.invoke('bindTexture', [GL.TEXTURE_2D, tex]);
  copySub();
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.invoke('copyTexImage2D', [GL.TEXTURE_2D, 0, SRGB.SRGB_ALPHA_EXT, 0, 0, 1, 1, 0]);
  expect(core.getError()).toBe(GL.INVALID_ENUM);
  expect(core.getError()).toBe(GL.NO_ERROR);
}
