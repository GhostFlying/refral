import { describe, expect, it, vi } from 'vitest';
import { CUBE_FACES, ExecutionResources } from './resources.js';
import { GL } from './gl.js';
import type { TextureVersion } from './resources.js';
import type { SemanticHost } from './execution.js';
import type { RenderbufferHandle, TextureHandle } from './index.js';

function setup(contextId = 1) {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn(), clear: vi.fn(), flush: vi.fn(),
    replaceStorage: vi.fn<SemanticHost['replaceStorage']>(),
    retireStorage: vi.fn<SemanticHost['retireStorage']>(),
    retireDepth: vi.fn<SemanticHost['retireDepth']>(),
  } satisfies SemanticHost;
  const resources = new ExecutionResources(contextId, host);
  const texture: TextureHandle = { kind: 'texture', contextId, slot: 1, generation: 1 };
  const version: TextureVersion = { texture, storageGeneration: 1, contentVersion: 1 };
  const data = new Uint8Array([1, 2, 3, 4]);
  resources.apply({ kind: 'define-texture', version, width: 1, height: 1, data });
  return { host, resources, texture, version, data };
}

describe('ordered execution resources', () => {
  it('reuses rendered GPU storage through logical write versions', () => {
    const { host, resources, version } = setup();
    const storage = resources.texture(version);
    expect(resources.texture(version)).toBe(storage);
    const rendered = { ...version, contentVersion: 2 };
    resources.apply({ kind: 'write-texture', previous: version, version: rendered });
    expect(resources.texture(rendered)).toBe(storage);
    expect(storage.reference).toBe(rendered);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
    expect(host.retireStorage).not.toHaveBeenCalled();
    expect(() => resources.texture(version)).toThrow(/stale/);
  });

  it('copies updates from the canonical rendered predecessor', () => {
    const { host, resources, version } = setup();
    const storage = resources.texture(version);
    const rendered = { ...version, contentVersion: 2 };
    resources.apply({ kind: 'write-texture', previous: version, version: rendered });
    const updated = { ...version, contentVersion: 3 };
    const data = new Uint8Array([5, 6, 7, 8]);
    resources.apply({ kind: 'update-texture', previous: rendered, version: updated,
      x: 0, y: 0, width: 1, height: 1, data });
    const next = resources.texture(updated);
    expect(next.parent).toBe(storage);
    expect(next.update?.data).toBe(data);
    expect(host.replaceStorage).toHaveBeenLastCalledWith(storage, next);
    expect(() => resources.texture(rendered)).toThrow(/stale/);
  });

  it('separates reallocation, object reuse and foreign contexts', () => {
    const { resources, version, texture } = setup();
    const previous = resources.texture(version);
    const allocated = { ...version, storageGeneration: 2, contentVersion: 2 };
    resources.apply({ kind: 'define-texture', version: allocated, width: 2, height: 1, data: new Uint8Array(8) });
    expect(resources.texture(allocated)).not.toBe(previous);
    const reused = { texture: { ...texture, generation: 2 }, storageGeneration: 1, contentVersion: 1 };
    resources.apply({ kind: 'define-texture', version: reused, width: 1, height: 1, data: new Uint8Array(4) });
    expect(resources.texture(reused)).not.toBe(resources.texture(allocated));
    expect(() => resources.texture({ ...allocated, texture: { ...texture, contextId: 2 } })).toThrow(/foreign/);
    expect(() => resources.texture(version)).toThrow(/stale/);
  });

  it('rejects malformed transitions without replacing the latest record', () => {
    const { resources, version, data, host } = setup();
    const storage = resources.texture(version);
    expect(() => resources.apply({ kind: 'define-texture', version, width: 1, height: 1, data })).toThrow(/advance/);
    expect(() => resources.apply({ kind: 'update-texture', previous: version,
      version: { ...version, contentVersion: 2 }, x: 1, y: 0, width: 1, height: 1, data })).toThrow(/region/);
    expect(resources.texture(version)).toBe(storage);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });

  it('retires depth generations and current textures exactly once', () => {
    const { host, resources, version } = setup();
    const depth: RenderbufferHandle = { kind: 'renderbuffer', contextId: 1, slot: 1, generation: 1 };
    const first = resources.depth(depth, 1);
    expect(resources.depth(depth, 2)).toBe(first);
    expect(resources.depth({ ...depth, generation: 2 }, 1).id).not.toBe(first.id);
    resources.apply({ kind: 'retire-depth', renderbuffer: depth, storageGeneration: 1 });
    resources.apply({ kind: 'retire-depth', renderbuffer: depth, storageGeneration: 1 });
    expect(host.retireDepth).toHaveBeenCalledTimes(1);
    resources.apply({ kind: 'retire-texture', version });
    resources.apply({ kind: 'retire-texture', version });
    expect(host.retireStorage).toHaveBeenCalledTimes(1);
    resources.dispose();
    resources.dispose();
    expect(host.retireDepth).toHaveBeenCalledTimes(3);
    expect(() => resources.texture(version)).toThrow(/disposed/);
  });
});

describe('texture image subresources', () => {
  it('resolves legacy image identity as explicit 2D level zero', () => {
    const { resources, version } = setup();
    expect(resources.texture({ ...version, imageTarget: GL.TEXTURE_2D, level: 0 })).toBe(resources.texture(version));
  });

  it('keeps six faces and levels independent through definition, update and retirement', () => {
    const { resources, version, host } = setup();
    const faces = CUBE_FACES.map(imageTarget => ({ ...version, imageTarget, level: 0 }));
    for (const [index, face] of faces.entries()) {
      resources.apply({ kind: 'define-texture', version: face, width: 1, height: 1,
        data: new Uint8Array([index, 0, 0, 255]) });
    }
    const otherLevel = { ...faces[0]!, level: 1 };
    resources.apply({ kind: 'define-texture', version: otherLevel, width: 1, height: 1,
      data: new Uint8Array([77, 0, 0, 255]) });
    const before = faces.map(face => resources.texture(face));
    const updated = { ...faces[2]!, contentVersion: 2 };
    resources.apply({ kind: 'update-texture', previous: faces[2]!, version: updated,
      x: 0, y: 0, width: 1, height: 1, data: new Uint8Array([99, 0, 0, 255]) });
    const next = resources.texture(updated);
    expect(next.parent).toBe(before[2]);
    expect(resources.texture(faces[0]!)).toBe(before[0]);
    expect(resources.texture(otherLevel).data?.[0]).toBe(77);
    expect(resources.texture(version).data).toEqual(new Uint8Array([1, 2, 3, 4]));
    resources.apply({ kind: 'retire-texture', version: updated });
    expect(host.retireStorage).toHaveBeenLastCalledWith(next);
    expect(() => resources.texture(updated)).toThrow(/stale/);
    for (const index of [0, 1, 3, 4, 5]) expect(resources.texture(faces[index]!)).toBe(before[index]);
  });

  it('rejects content transitions across faces without changing either image', () => {
    const { resources, version, host } = setup();
    const first = { ...version, imageTarget: CUBE_FACES[0] };
    const second = { ...version, imageTarget: CUBE_FACES[1] };
    const data = new Uint8Array([4, 3, 2, 1]);
    for (const face of [first, second]) resources.apply({ kind: 'define-texture', version: face,
      width: 1, height: 1, data });
    const storages = [resources.texture(first), resources.texture(second)];
    expect(() => resources.apply({ kind: 'write-texture', previous: first,
      version: { ...second, contentVersion: 2 } })).toThrow(/transition/);
    expect(resources.texture(first)).toBe(storages[0]);
    expect(resources.texture(second)).toBe(storages[1]);
    expect(host.replaceStorage).toHaveBeenCalledTimes(3);
  });

  it.each([
    { imageTarget: GL.TEXTURE_CUBE_MAP }, { imageTarget: 0xbad }, { level: -1 },
    { level: 0.5 }, { level: NaN }, { level: 0x8000_0000 },
  ])('rejects malformed image identity $0 before host mutation', (invalid) => {
    const { resources, version, host } = setup();
    expect(() => resources.apply({ kind: 'define-texture', version: { ...version, ...invalid },
      width: 1, height: 1, data: new Uint8Array(4) })).toThrow(/subresource/);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
    expect(resources.texture(version).data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
