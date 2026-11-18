import { describe, expect, it, vi } from 'vitest';
import { GL, SemanticContext } from '../../packages/core-js/src/index';
import type { RuntimeProfile, SemanticHost } from '../../packages/core-js/src/index';
import type { Compiler } from '../../packages/compiler/src/types';

const profile: RuntimeProfile = {
  vertexAttributes: 4,
  vertexUniformVectors: 128,
  fragmentUniformVectors: 64,
  varyingVectors: 8,
  vertexTextureUnits: 4,
  fragmentTextureUnits: 4,
  combinedTextureUnits: 4,
};

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn<SemanticHost['draw']>(),
    clear: vi.fn<SemanticHost['clear']>(),
    flush: vi.fn<SemanticHost['flush']>(),
    finish: vi.fn<SemanticHost['finish']>(),
    replaceStorage: vi.fn<SemanticHost['replaceStorage']>(),
    retireStorage: vi.fn<SemanticHost['retireStorage']>(),
    retireDepth: vi.fn<SemanticHost['retireDepth']>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile: vi.fn(() => { throw new Error('Unexpected shader compilation in a core boundary test'); }),
    link: vi.fn(() => { throw new Error('Unexpected program linking in a core boundary test'); }),
  };
  const core = new SemanticContext(
    { width: 64, height: 32 }, host, compiler,
    { alpha: false, depth: true, antialias: false, preserveDrawingBuffer: true }, profile,
  );
  return { core, host, compiler };
}

describe('SemanticContext upload ownership', () => {
  it('copies the selected source view before bufferData returns', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    const source = new Uint8Array([90, 1, 2, 3, 4, 91]);
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, source.subarray(1, 5), GL.STATIC_DRAW);
    source.fill(0);

    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBe(buffer);
    expect(core.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE)).toBe(4);
    expect(Array.from(buffer.data)).toEqual([1, 2, 3, 4]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('applies bufferSubData source and destination offsets while retaining earlier bytes', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4, 5, 6]), GL.DYNAMIC_DRAW);
    const earlierBytes = buffer.data;
    const source = new Uint8Array([90, 20, 21, 91]);

    core.bufferSubData(GL.ARRAY_BUFFER, 2, source.subarray(1, 3));
    source.fill(0);

    expect(Array.from(buffer.data)).toEqual([1, 2, 20, 21, 5, 6]);
    expect(Array.from(earlierBytes)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(core.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_USAGE)).toBe(GL.DYNAMIC_DRAW);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('distinguishes buffer content updates from storage replacement', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, 8, GL.STATIC_DRAW);
    const storageGeneration = buffer.generation;
    const firstContentVersion = buffer.version;

    core.bufferSubData(GL.ARRAY_BUFFER, 4, new Uint8Array([1, 2]));
    expect(buffer.generation).toBe(storageGeneration);
    expect(buffer.version).toBeGreaterThan(firstContentVersion);
    const updatedContentVersion = buffer.version;

    core.bufferData(GL.ARRAY_BUFFER, 16, GL.DYNAMIC_DRAW);
    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBe(buffer);
    expect(buffer.generation).toBeGreaterThan(storageGeneration);
    expect(buffer.version).toBeGreaterThan(updatedContentVersion);
    expect(core.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE)).toBe(16);
    expect(Array.from(buffer.data)).toEqual(Array(16).fill(0));
  });

  it('snapshots texture uploads and versions sub-image updates independently of storage', () => {
    const { core, host } = createContext();
    const texture = core.createTexture()!;
    core.bindTexture(GL.TEXTURE_2D, texture);
    const source = new Uint8Array([90, 90, 90, 90, 1, 2, 3, 255, 4, 5, 6, 255, 91]);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, source.subarray(4, 12));
    const [previous, firstStorage] = host.replaceStorage.mock.calls[0]!;
    const firstVersion = texture.version;
    source.fill(0);
    expect(previous).toBeNull();
    expect(Array.from(firstStorage.data!)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);

    const update = new Uint8Array([7, 8, 9, 255]);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 1, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, update);
    const [updateParent, updatedStorage] = host.replaceStorage.mock.calls[1]!;
    update.fill(0);
    expect(updateParent).toBe(firstStorage);
    expect(updatedStorage.generation).toBe(firstStorage.generation);
    expect(texture.version).toBeGreaterThan(firstVersion);
    expect(updatedStorage.update).toEqual({ x: 1, y: 0, width: 1, height: 1, data: new Uint8Array([7, 8, 9, 255]) });
    expect(Array.from(firstStorage.data!)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);

    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const [, replacement] = host.replaceStorage.mock.calls[2]!;
    expect(replacement.generation).toBeGreaterThan(firstStorage.generation);
    expect(Array.from(replacement.data!)).toEqual(Array(8).fill(0));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});

describe('SemanticContext invalid calls and ownership', () => {
  it('preserves the binding and data after rejected buffer operations', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4]), GL.STATIC_DRAW);
    const bytes = buffer.data;
    const generation = buffer.generation;
    const version = buffer.version;

    core.bufferSubData(GL.ARRAY_BUFFER, 3, new Uint8Array([9, 9]));
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.bufferData(GL.ARRAY_BUFFER, 10, -1);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, buffer);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);

    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBe(buffer);
    expect(core.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING)).toBeNull();
    expect(buffer.data).toBe(bytes);
    expect(Array.from(buffer.data)).toEqual([1, 2, 3, 4]);
    expect(buffer.generation).toBe(generation);
    expect(buffer.version).toBe(version);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('rejects foreign buffers, textures, and framebuffers while keeping local bindings', () => {
    const { core } = createContext();
    const foreign = createContext().core;
    const buffer = core.createBuffer()!;
    const texture = core.createTexture()!;
    const framebuffer = core.createFramebuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bindTexture(GL.TEXTURE_2D, texture);
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);

    core.bindBuffer(GL.ARRAY_BUFFER, foreign.createBuffer());
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.bindTexture(GL.TEXTURE_2D, foreign.createTexture());
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.bindFramebuffer(GL.FRAMEBUFFER, foreign.createFramebuffer());
    expect(core.getError()).toBe(GL.INVALID_OPERATION);

    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBe(buffer);
    expect(core.getParameter(GL.TEXTURE_BINDING_2D)).toBe(texture);
    expect(core.getParameter(GL.FRAMEBUFFER_BINDING)).toBe(framebuffer);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});

describe('SemanticContext deletion references', () => {
  it('clears a deleted buffer binding and attribute reference while preserving captured bytes', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, new Float32Array([1, 2, 3]), GL.STATIC_DRAW);
    core.vertexAttribPointer(0, 3, GL.FLOAT, false, 0, 0);
    core.enableVertexAttribArray(0);
    const earlierBytes = buffer.data;

    core.deleteBuffer(buffer);
    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBeNull();
    expect(core.getVertexAttrib(0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)).toBeNull();
    expect(core.isBuffer(buffer)).toBe(false);
    expect(Array.from(new Float32Array(earlierBytes.buffer))).toEqual([1, 2, 3]);

    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBeNull();
    core.deleteBuffer(buffer);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('detaches a deleted texture from the bound framebuffer and retires its storage once', () => {
    const { core, host } = createContext();
    const texture = core.createTexture()!;
    const framebuffer = core.createFramebuffer()!;
    core.bindTexture(GL.TEXTURE_2D, texture);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const [, storage] = host.replaceStorage.mock.calls[0]!;
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);

    core.deleteTexture(texture);
    expect(core.getParameter(GL.TEXTURE_BINDING_2D)).toBeNull();
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)).toBe(GL.NONE);
    expect(core.isTexture(texture)).toBe(false);
    expect(host.retireStorage).toHaveBeenCalledExactlyOnceWith(storage);
    core.deleteTexture(texture);
    expect(host.retireStorage).toHaveBeenCalledTimes(1);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('retains a deleted texture through an unbound framebuffer until its final attachment is released', () => {
    const { core, host } = createContext();
    const texture = core.createTexture()!;
    const framebuffer = core.createFramebuffer()!;
    core.bindTexture(GL.TEXTURE_2D, texture);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const [, storage] = host.replaceStorage.mock.calls[0]!;
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    core.bindFramebuffer(GL.FRAMEBUFFER, null);

    core.deleteTexture(texture);
    expect(host.retireStorage).not.toHaveBeenCalled();
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_COMPLETE);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)).toBe(texture);

    core.deleteFramebuffer(framebuffer);
    expect(core.getParameter(GL.FRAMEBUFFER_BINDING)).toBeNull();
    expect(host.retireStorage).toHaveBeenCalledExactlyOnceWith(storage);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});

describe('SemanticContext context loss', () => {
  it('reports loss once and cancels a queued automatic flush', async () => {
    const { core, host } = createContext();
    core.clear(GL.COLOR_BUFFER_BIT);
    expect(host.clear).toHaveBeenCalledTimes(1);
    expect(core.markLost()).toBe(true);
    expect(core.markLost()).toBe(false);
    await Promise.resolve();

    expect(core.isContextLost()).toBe(true);
    expect(core.getContextAttributes()).toBeNull();
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(host.flush).not.toHaveBeenCalled();
  });

  it('returns neutral creation and query results after loss', () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.markLost();

    expect(core.createBuffer()).toBeNull();
    expect(core.createShader(GL.VERTEX_SHADER)).toBeNull();
    expect(core.createProgram()).toBeNull();
    expect(core.createTexture()).toBeNull();
    expect(core.createFramebuffer()).toBeNull();
    expect(core.createRenderbuffer()).toBeNull();
    expect(core.getParameter(GL.ARRAY_BUFFER_BINDING)).toBeNull();
    expect(core.getParameter(GL.MAX_VERTEX_ATTRIBS)).toBeNull();
    expect(core.isBuffer(buffer)).toBe(false);
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it('ignores uploads, compilation, and invalid calls after disposal marks the core lost', () => {
    const { core, host, compiler } = createContext();
    const buffer = core.createBuffer()!;
    const shader = core.createShader(GL.VERTEX_SHADER)!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4]), GL.STATIC_DRAW);
    const earlierBytes = buffer.data.slice();
    core.markLost();

    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([9]), GL.DYNAMIC_DRAW);
    core.bufferSubData(GL.ARRAY_BUFFER, 0, new Uint8Array([8]));
    expect(() => core.compileShader(shader)).not.toThrow();
    core.bindBuffer(-1, buffer);
    core.clear(GL.COLOR_BUFFER_BIT);
    core.flush();

    expect(Array.from(buffer.data)).toEqual(Array.from(earlierBytes));
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(host.clear).not.toHaveBeenCalled();
    expect(host.flush).not.toHaveBeenCalled();
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});
