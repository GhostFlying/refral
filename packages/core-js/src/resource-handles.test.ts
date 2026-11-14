import { describe, expect, it, vi } from "vitest";
import { allocateContextId, ExecutionResources, GL } from "@refral/core-api";
import type { Compiler, DrawingCore, FramebufferHandle, RenderbufferHandle, SemanticHost, TextureHandle } from "@refral/core-api";
import { createCompilerRegistry } from "@refral/compiler";
import { createJsDrawingCore } from "./drawing.js";

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(), clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(), replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(), retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile(source, stage) {
      return { source, stage, success: true, log: "", version: 1, wgsl: "", attributes: [],
        uniforms: [], varyings: [], outputs: [], uniformBufferSize: 16 };
    },
    link() {
      return { success: true, log: "", vertexWGSL: "", fragmentWGSL: "", vertexEntryPoint: "main",
        fragmentEntryPoint: "main", attributes: [], uniforms: [], samplers: [],
        vertexUniformBufferSize: 16, fragmentUniformBufferSize: 16, driverUniformBufferSize: 32 };
    },
  };
  const contextId = allocateContextId();
  const resources = new ExecutionResources(contextId, host);
  const apply = vi.spyOn(resources, "apply");
  const core = createJsDrawingCore({ contextId, maxBufferBytes: 4096, surface: { width: 64, height: 32 }, attributes: {},
    profile: { vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
      varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4 },
  }, { compiler: createCompilerRegistry(compiler), host, resources });
  return { core, resources, apply, host };
}

function createTexture(core: DrawingCore, data: Uint8Array | null = null): TextureHandle {
  const texture = core.invoke("createTexture", []) as TextureHandle;
  core.invoke("bindTexture", [GL.TEXTURE_2D, texture]);
  core.invoke("texImage2D", [GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE,
    data ? { bytes: data, viewType: "Uint8Array" } : null]);
  return texture;
}

function createTarget(core: DrawingCore) {
  const texture = createTexture(core);
  const framebuffer = core.invoke("createFramebuffer", []) as FramebufferHandle;
  core.invoke("bindFramebuffer", [GL.FRAMEBUFFER, framebuffer]);
  core.invoke("framebufferTexture2D", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0]);
  const depth = core.invoke("createRenderbuffer", []) as RenderbufferHandle;
  core.invoke("bindRenderbuffer", [GL.RENDERBUFFER, depth]);
  core.invoke("renderbufferStorage", [GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 2, 2]);
  core.invoke("framebufferRenderbuffer", [GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth]);
  return { texture, framebuffer, depth };
}

function useProgram(core: DrawingCore): void {
  const program = core.invoke("createProgram", []);
  for (const type of [GL.VERTEX_SHADER, GL.FRAGMENT_SHADER]) {
    const shader = core.invoke("createShader", [type]);
    core.invoke("shaderSource", [shader, "shader"]);
    core.invoke("compileShader", [shader]);
    core.invoke("attachShader", [program, shader]);
  }
  core.invoke("linkProgram", [program]);
  core.invoke("useProgram", [program]);
}

describe("JS typed execution resources", () => {
  it("returns logical binding and attachment identities with neutral canonical target records", () => {
    const { core, resources } = createContext();
    const { texture, framebuffer, depth } = createTarget(core);
    expect(texture).toMatchObject({ kind: "texture", contextId: core.contextId });
    expect(framebuffer).toMatchObject({ kind: "framebuffer", contextId: core.contextId });
    expect(depth).toMatchObject({ kind: "renderbuffer", contextId: core.contextId });
    expect(Object.keys(texture).sort()).toEqual(["contextId", "generation", "kind", "slot"]);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_2D])).toBe(texture);
    expect(core.invoke("getParameter", [GL.FRAMEBUFFER_BINDING])).toBe(framebuffer);
    expect(core.invoke("getParameter", [GL.RENDERBUFFER_BINDING])).toBe(depth);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
      GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toBe(texture);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT,
      GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toBe(depth);
    const target = core.captureTarget();
    expect(target.color).toBe(resources.texture({ texture, storageGeneration: 1, contentVersion: 1 }));
    expect(target.depth!.id).toBe(resources.depth(depth, 1).id);
    expect(Object.keys(target.depth!)).toEqual(["id"]);
    core.invoke("bindRenderbuffer", [GL.RENDERBUFFER, texture]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    const foreign = createTexture(createContext().core);
    core.invoke("bindTexture", [GL.TEXTURE_2D, foreign]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_2D])).toBe(texture);
  });

  it("publishes consumed upload snapshots and ordered canonical update/reallocation records", () => {
    const { core, resources, apply, host } = createContext();
    const source = new Uint8Array(16).fill(7);
    const texture = createTexture(core, source);
    const first = resources.texture({ texture, storageGeneration: 1, contentVersion: 1 });
    source.fill(0);
    expect(first.data).toEqual(new Uint8Array(16).fill(7));
    const update = new Uint8Array([1, 2, 3, 4]);
    core.invoke("texSubImage2D", [GL.TEXTURE_2D, 0, 1, 1, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: update, viewType: "Uint8Array" }]);
    update.fill(0);
    const second = resources.texture({ texture, storageGeneration: 1, contentVersion: 2 });
    expect(second.parent).toBe(first);
    expect(second.update?.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    core.invoke("texImage2D", [GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
    const third = resources.texture({ texture, storageGeneration: 2, contentVersion: 3 });
    expect(third).toMatchObject({ width: 1, height: 1, data: new Uint8Array(4) });
    expect(apply.mock.calls.map(([operation]) => operation.kind)).toEqual(["define-texture", "update-texture", "define-texture"]);
    expect(host.replaceStorage.mock.calls).toEqual([[null, first], [first, second], [second, third]]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("advances GPU color-write versions without replacing the rendered allocation", () => {
    const { core, resources, apply, host } = createContext();
    const { texture } = createTarget(core);
    const first = core.captureTarget().color;
    core.invoke("clear", [GL.COLOR_BUFFER_BIT]);
    expect(resources.texture({ texture, storageGeneration: 1, contentVersion: 2 })).toBe(first);
    core.invoke("clear", [GL.DEPTH_BUFFER_BIT]);
    core.invoke("colorMask", [false, false, false, false]);
    core.invoke("clear", [GL.COLOR_BUFFER_BIT]);
    expect(apply.mock.calls.filter(([operation]) => operation.kind === "write-texture")).toHaveLength(1);
    core.invoke("colorMask", [true, true, true, true]);
    useProgram(core);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    expect(resources.texture({ texture, storageGeneration: 1, contentVersion: 3 })).toBe(first);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
    expect(host.draw.mock.calls[0]![0].target.color).toBe(first);
    core.invoke("texSubImage2D", [GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array([1, 2, 3, 4]), viewType: "Uint8Array" }]);
    const updated = resources.texture({ texture, storageGeneration: 1, contentVersion: 4 });
    expect(updated.parent).toBe(first);
    expect(apply.mock.calls.at(-1)![0]).toMatchObject({ kind: "update-texture",
      previous: { storageGeneration: 1, contentVersion: 3 } });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("retains deleted unbound framebuffer attachments until replacement then retires logical identities", () => {
    const { core, resources, apply, host } = createContext();
    const { texture, framebuffer, depth } = createTarget(core);
    const target = core.captureTarget();
    core.invoke("bindFramebuffer", [GL.FRAMEBUFFER, null]);
    core.invoke("deleteTexture", [texture]);
    core.invoke("deleteRenderbuffer", [depth]);
    expect(core.invoke("isTexture", [texture])).toBe(false);
    expect(core.invoke("isRenderbuffer", [depth])).toBe(false);
    expect(host.retireStorage).not.toHaveBeenCalled();
    expect(host.retireDepth).not.toHaveBeenCalled();
    core.invoke("bindFramebuffer", [GL.FRAMEBUFFER, framebuffer]);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
      GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toBe(texture);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT,
      GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toBe(depth);
    core.invoke("framebufferTexture2D", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, null, 0]);
    core.invoke("framebufferRenderbuffer", [GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, null]);
    expect(host.retireStorage).toHaveBeenCalledExactlyOnceWith(target.color);
    expect(host.retireDepth).toHaveBeenCalledExactlyOnceWith(target.depth!.id, 1);
    expect(apply.mock.calls.slice(-2).map(([operation]) => operation.kind)).toEqual(["retire-texture", "retire-depth"]);
    expect(() => resources.texture({ texture, storageGeneration: 1, contentVersion: 1 })).toThrow();
    core.invoke("deleteTexture", [texture]);
    core.invoke("deleteRenderbuffer", [depth]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    const replacement = core.invoke("createRenderbuffer", []) as RenderbufferHandle;
    expect(replacement.slot).toBe(depth.slot);
    expect(replacement.generation).toBe(depth.generation + 1);
  });
});
