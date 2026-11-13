import { describe, expect, it, vi } from "vitest";
import { allocateContextId, GL } from "@refral/core-api";
import type { Compiler } from "@refral/compiler";
import { createJsBufferCore } from "./buffers.js";
import { SemanticContext } from "./context.js";
import type { SemanticHost } from "./context.js";
import { BufferObject } from "./resources.js";

function createContext(maxBufferBytes = 32) {
  const host: SemanticHost = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: maxBufferBytes },
    draw() {}, clear() {}, flush() {}, replaceStorage() {}, retireStorage() {}, retireDepth() {},
  };
  const compiler: Compiler = {
    compile() { throw new Error("Buffer tests must not compile shaders."); },
    link() { throw new Error("Buffer tests must not link programs."); },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return { core, buffers: createJsBufferCore(core, { contextId: allocateContextId(), maxBufferBytes }) };
}

describe("JS Buffer contract over the rendering context", () => {
  it("shares bindings and attribute identity while retaining prior upload bytes", () => {
    const { core, buffers } = createContext();
    const handle = buffers.createBuffer()!;
    expect(Object.isFrozen(handle)).toBe(true);
    expect(buffers.isBuffer(handle)).toBe(false);
    buffers.bindBuffer(GL.ARRAY_BUFFER, handle);
    expect(buffers.isBuffer(handle)).toBe(true);
    const legacyBuffer = core.getParameter(GL.ARRAY_BUFFER_BINDING) as BufferObject;
    expect(buffers.toHandle(legacyBuffer)).toBe(handle);
    const source = new Uint8Array([90, 1, 2, 3, 4, 91]);
    buffers.bufferData(GL.ARRAY_BUFFER, source.subarray(1, 5), GL.DYNAMIC_DRAW);
    const earlierDrawBytes = legacyBuffer.data;
    source.fill(0);
    core.vertexAttribPointer(0, 1, GL.FLOAT, false, 0, 0);
    expect(buffers.toHandle(core.getVertexAttrib(0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING))).toBe(handle);
    buffers.bufferSubData(GL.ARRAY_BUFFER, 1, new Uint8Array([7, 8]));
    expect(Array.from(earlierDrawBytes)).toEqual([1, 2, 3, 4]);
    expect(Array.from(legacyBuffer.data)).toEqual([1, 7, 8, 4]);
    expect(buffers.inspectBuffer(handle)).toMatchObject({
      handle, byteLength: 4, usage: GL.DYNAMIC_DRAW, storageGeneration: 1, contentVersion: 2,
    });
    expect(buffers.getError()).toBe(GL.NO_ERROR);
  });

  it("reuses slots with a new generation and clears legacy references on deletion", () => {
    const { core, buffers } = createContext();
    const first = buffers.createBuffer()!;
    buffers.bindBuffer(GL.ARRAY_BUFFER, first);
    buffers.bufferData(GL.ARRAY_BUFFER, 4, GL.STATIC_DRAW);
    core.vertexAttribPointer(0, 1, GL.FLOAT, false, 0, 0);
    const legacyBuffer = core.getParameter(GL.ARRAY_BUFFER_BINDING);
    buffers.deleteBuffer(first);
    expect(buffers.getBinding(GL.ARRAY_BUFFER_BINDING)).toBeNull();
    expect(core.getVertexAttrib(0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)).toBeNull();
    expect(buffers.toHandle(legacyBuffer)).toBeNull();
    const replacement = buffers.createBuffer()!;
    expect(replacement.slot).toBe(first.slot);
    expect(replacement.generation).toBe(first.generation + 1);
    buffers.bindBuffer(GL.ARRAY_BUFFER, replacement);
    buffers.bindBuffer(-1, first);
    expect(buffers.getError()).toBe(GL.INVALID_OPERATION);
    expect(buffers.getBinding(GL.ARRAY_BUFFER_BINDING)).toBe(replacement);
    buffers.deleteBuffer(first);
    buffers.deleteBuffer(first);
    expect(buffers.isBuffer(replacement)).toBe(true);
    expect(buffers.isBuffer(first)).toBe(false);
    expect(buffers.inspectBuffer(first)).toBeNull();
    expect(buffers.getError()).toBe(GL.NO_ERROR);
  });

  it("rejects foreign handles before target validation without changing binding", () => {
    const { buffers } = createContext();
    const local = buffers.createBuffer()!;
    const foreign = createContext().buffers.createBuffer()!;
    buffers.bindBuffer(GL.ARRAY_BUFFER, local);
    buffers.bindBuffer(-1, foreign);
    expect(buffers.getError()).toBe(GL.INVALID_OPERATION);
    expect(buffers.getBinding(GL.ARRAY_BUFFER_BINDING)).toBe(local);
    expect(buffers.isBuffer(foreign)).toBe(false);
    expect(buffers.inspectBuffer(foreign)).toBeNull();
    expect(buffers.getError()).toBe(GL.NO_ERROR);
    buffers.deleteBuffer(foreign);
    expect(buffers.getError()).toBe(GL.INVALID_OPERATION);
    buffers.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, local);
    expect(buffers.getError()).toBe(GL.INVALID_OPERATION);
  });

  it("preserves error flags and buffer bytes when inspecting or rejecting allocation", () => {
    const { core, buffers } = createContext(8);
    const handle = buffers.createBuffer()!;
    buffers.bindBuffer(GL.ARRAY_BUFFER, handle);
    buffers.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4]), GL.STATIC_DRAW);
    buffers.bufferData(GL.ARRAY_BUFFER, 9, GL.DYNAMIC_DRAW);
    const copy = buffers.inspectBuffer(handle)!;
    copy.data.fill(0);
    expect(Array.from(buffers.inspectBuffer(handle)!.data)).toEqual([1, 2, 3, 4]);
    expect(core.getError()).toBe(GL.OUT_OF_MEMORY);
    expect(buffers.inspectBuffer(handle)).toMatchObject({
      byteLength: 4, usage: GL.STATIC_DRAW, storageGeneration: 1, contentVersion: 1,
    });
    buffers.bufferData(GL.ARRAY_BUFFER, -1, -1);
    expect(buffers.getError()).toBe(GL.INVALID_ENUM);
    expect(buffers.getError()).toBe(GL.NO_ERROR);
  });

  it("treats empty updates as no-ops and preserves state after a staging allocation failure", () => {
    const { buffers } = createContext();
    const handle = buffers.createBuffer()!;
    buffers.bindBuffer(GL.ARRAY_BUFFER, handle);
    buffers.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4]), GL.STREAM_DRAW);
    buffers.bufferSubData(GL.ARRAY_BUFFER, 4, new Uint8Array(0));
    expect(buffers.inspectBuffer(handle)!.contentVersion).toBe(1);
    buffers.bufferSubData(GL.ARRAY_BUFFER, 5, new Uint8Array(0));
    expect(buffers.getError()).toBe(GL.INVALID_VALUE);
    const allocation = vi.spyOn(Uint8Array.prototype, "slice").mockImplementationOnce(() => {
      throw new RangeError("Simulated allocation failure");
    });
    buffers.bufferSubData(GL.ARRAY_BUFFER, 0, new Uint8Array([9]));
    allocation.mockRestore();
    expect(buffers.getError()).toBe(GL.OUT_OF_MEMORY);
    expect(buffers.inspectBuffer(handle)).toMatchObject({
      data: new Uint8Array([1, 2, 3, 4]), storageGeneration: 1, contentVersion: 1,
    });
  });

  it("shares context loss and releases CPU storage on repeated disposal", () => {
    const { core, buffers } = createContext();
    const handle = buffers.createBuffer()!;
    buffers.bindBuffer(GL.ARRAY_BUFFER, handle);
    buffers.bufferData(GL.ARRAY_BUFFER, 4, GL.STATIC_DRAW);
    const legacyBuffer = core.getParameter(GL.ARRAY_BUFFER_BINDING) as BufferObject;
    buffers.bindBuffer(-1, null);
    expect(buffers.markLost()).toBe(true);
    expect(buffers.markLost()).toBe(false);
    buffers.bindBuffer(-1, handle);
    buffers.bufferData(-1, -1, -1);
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(buffers.getError()).toBe(GL.NO_ERROR);
    expect(buffers.createBuffer()).toBeNull();
    expect(buffers.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE)).toBeNull();
    expect(buffers.getBinding(GL.ARRAY_BUFFER_BINDING)).toBeNull();
    expect(buffers.isBuffer(handle)).toBe(false);
    expect(buffers.inspectBuffer(handle)).toBeNull();
    buffers.dispose();
    buffers.dispose();
    expect(legacyBuffer.data.byteLength).toBe(0);
    expect(buffers.getError()).toBe(GL.NO_ERROR);
  });
});
