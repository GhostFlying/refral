import { describe, expect, it } from 'vitest';
import { GL, BufferObject, TextureObject, ErrorState, createRasterState, snapshotRaster, isTextureComplete } from '../../packages/core-js/src/index';

describe('ordered semantic state', () => {
  it('snapshots every mutable raster-state array', () => {
    const state = createRasterState(64, 32);
    const earlier = snapshotRaster(state);
    state.viewport[0] = 16;
    state.scissor[1] = 8;
    state.colorMask[0] = false;
    state.depthRange[0] = 0.5;
    state.blendColor[2] = 1;
    expect(earlier.viewport).toEqual([0, 0, 64, 32]);
    expect(earlier.scissor).toEqual([0, 0, 64, 32]);
    expect(earlier.colorMask).toEqual([true, true, true, true]);
    expect(earlier.depthRange).toEqual([0, 1]);
    expect(earlier.blendColor).toEqual([0, 0, 0, 0]);
  });

  it('keeps object identity and context ownership distinct', () => {
    const owner = {};
    const otherOwner = {};
    const first = new BufferObject(owner);
    const second = new BufferObject(owner);
    const foreign = new BufferObject(otherOwner);
    expect(first.id).not.toBe(second.id);
    expect(first.owner).toBe(second.owner);
    expect(foreign.owner).not.toBe(first.owner);
    expect(first.generation).toBe(0);
    expect(first.version).toBe(0);
  });

  it('retains independent error flags and clears observed flags', () => {
    const errors = new ErrorState();
    errors.set(GL.INVALID_ENUM);
    errors.set(GL.INVALID_ENUM);
    errors.set(GL.INVALID_OPERATION);
    expect(errors.take()).toBe(GL.INVALID_ENUM);
    expect(errors.take()).toBe(GL.INVALID_OPERATION);
    expect(errors.take()).toBe(GL.NO_ERROR);
  });
});

describe('WebGL1 level-zero texture completeness', () => {
  it('requires clamp-to-edge for non-power-of-two storage', () => {
    const texture = new TextureObject({});
    texture.storage = { width: 3, height: 2, generation: 1 };
    texture.parameters.minFilter = GL.NEAREST;
    expect(isTextureComplete(texture)).toBe(false);
    texture.parameters.wrapS = GL.CLAMP_TO_EDGE;
    texture.parameters.wrapT = GL.CLAMP_TO_EDGE;
    expect(isTextureComplete(texture)).toBe(true);
  });

  it('requires a supported mip policy and nonempty storage', () => {
    const texture = new TextureObject({});
    expect(isTextureComplete(texture)).toBe(false);
    texture.storage = { width: 2, height: 2, generation: 1 };
    expect(isTextureComplete(texture)).toBe(false);
    texture.parameters.minFilter = GL.LINEAR;
    expect(isTextureComplete(texture)).toBe(true);
    texture.storage = { width: 0, height: 2, generation: 2 };
    expect(isTextureComplete(texture)).toBe(false);
  });
});
