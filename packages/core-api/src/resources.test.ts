import { describe, expect, it, vi } from 'vitest';
import { ExecutionResources } from './resources.js';
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
