import { describe, expect, it, vi } from "vitest";
import { GL } from "@refral/core-api";
import type { Compiler, ReadPixelsRequest, SemanticHost } from "@refral/core-api";
import { SemanticContext } from "./context.js";

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(),
    clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(),
    replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(),
    retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile() { throw new Error("Readback planning must not compile shaders."); },
    link() { throw new Error("Readback planning must not link programs."); },
  };
  const surface = { width: 4, height: 3 };
  const core = new SemanticContext(surface, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return { core, host, surface };
}

function request(overrides: Partial<ReadPixelsRequest> = {}): ReadPixelsRequest {
  return {
    x: 0, y: 0, width: 1, height: 1, format: GL.RGBA, type: GL.UNSIGNED_BYTE,
    viewType: "Uint8Array", byteLength: 4, ...overrides,
  };
}

describe("JS readPixels planning", () => {
  it.each([1, 2, 4, 8])("packs alignment %i without requiring final-row padding", (alignment) => {
    const { core, host } = createContext();
    core.pixelStorei(GL.PACK_ALIGNMENT, alignment);
    const stride = Math.ceil(12 / alignment) * alignment;
    const requiredBytes = stride + 12;
    expect(core.prepareReadPixels(request({ width: 3, height: 2, byteLength: requiredBytes }))).toMatchObject({
      target: { isDefault: true, width: 4, height: 3 },
      sourceX: 0, sourceY: 0, copyWidth: 3, copyHeight: 2,
      destinationOffset: 0, destinationStride: stride, requiredBytes,
    });
    expect(core.prepareReadPixels(request({ width: 3, height: 2, byteLength: requiredBytes - 1 }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getParameter(GL.PACK_ALIGNMENT)).toBe(alignment);
    expect(host.flush).not.toHaveBeenCalled();
    expect(host.draw).not.toHaveBeenCalled();
    expect(host.clear).not.toHaveBeenCalled();
  });

  it.each(["Uint8Array", "Uint8ClampedArray"])("accepts %s output storage", (viewType) => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({ viewType }))).not.toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("retains left and bottom destination regions through a clipped offset and padded stride", () => {
    const { core } = createContext();
    core.pixelStorei(GL.PACK_ALIGNMENT, 8);
    expect(core.prepareReadPixels(request({ x: -1, y: -1, width: 3, height: 3, byteLength: 44 }))).toMatchObject({
      sourceX: 0, sourceY: 0, copyWidth: 2, copyHeight: 2,
      destinationOffset: 20, destinationStride: 16, requiredBytes: 44,
    });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each([
    { x: -1, y: 1, sourceX: 0, sourceY: 1, copyWidth: 1, copyHeight: 2, destinationOffset: 4 },
    { x: 3, y: 1, sourceX: 3, sourceY: 1, copyWidth: 1, copyHeight: 2, destinationOffset: 0 },
    { x: 1, y: -1, sourceX: 1, sourceY: 0, copyWidth: 2, copyHeight: 1, destinationOffset: 8 },
    { x: 1, y: 2, sourceX: 1, sourceY: 2, copyWidth: 2, copyHeight: 1, destinationOffset: 0 },
  ])("clips the rectangle at $x,$y", ({ x, y, ...expected }) => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({ x, y, width: 2, height: 2, byteLength: 16 }))).toMatchObject(expected);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each([
    { x: -3, y: 0 }, { x: 4, y: 0 }, { x: 0, y: -3 }, { x: 0, y: 3 },
    { x: -0x8000_0000, y: -0x8000_0000 }, { x: 0x7fff_ffff, y: 0x7fff_ffff },
  ])("leaves a wholly outside rectangle at $x,$y empty", ({ x, y }) => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({ x, y, width: 2, height: 2, byteLength: 16 }))).toMatchObject({
      copyWidth: 0, copyHeight: 0, destinationOffset: 0, destinationStride: 8, requiredBytes: 16,
    });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each([{ width: 0, height: 2 }, { width: 2, height: 0 }, { width: 0, height: 0 }])(
    "accepts a zero-area request $width by $height with no storage",
    ({ width, height }) => {
      const { core } = createContext();
      expect(core.prepareReadPixels(request({ width, height, byteLength: 0 }))).toMatchObject({
        copyWidth: 0, copyHeight: 0, destinationOffset: 0, requiredBytes: 0,
      });
      expect(core.getError()).toBe(GL.NO_ERROR);
    },
  );

  it.each([
    { override: { width: -1 }, error: GL.INVALID_VALUE },
    { override: { height: -1 }, error: GL.INVALID_VALUE },
    { override: { viewType: null }, error: GL.INVALID_VALUE },
    { override: { viewType: "DataView" }, error: GL.INVALID_OPERATION },
    { override: { viewType: "Float32Array" }, error: GL.INVALID_OPERATION },
    { override: { format: GL.RGB }, error: GL.INVALID_OPERATION },
    { override: { format: GL.ALPHA }, error: GL.INVALID_OPERATION },
    { override: { type: GL.UNSIGNED_SHORT_4_4_4_4 }, error: GL.INVALID_OPERATION },
    { override: { type: GL.UNSIGNED_SHORT_5_6_5 }, error: GL.INVALID_OPERATION },
    { override: { type: GL.UNSIGNED_SHORT_5_5_5_1 }, error: GL.INVALID_OPERATION },
    { override: { format: GL.LUMINANCE }, error: GL.INVALID_ENUM },
    { override: { format: GL.LUMINANCE_ALPHA }, error: GL.INVALID_ENUM },
    { override: { format: 0xbad }, error: GL.INVALID_ENUM },
    { override: { type: GL.FLOAT }, error: GL.INVALID_ENUM },
    { override: { type: GL.UNSIGNED_SHORT }, error: GL.INVALID_ENUM },
    { override: { type: 0xbad }, error: GL.INVALID_ENUM },
    { override: { byteLength: 3 }, error: GL.INVALID_OPERATION },
    { override: { byteLength: -1 }, error: GL.INVALID_OPERATION },
    { override: { byteLength: Number.POSITIVE_INFINITY }, error: GL.INVALID_OPERATION },
  ])("rejects invalid destination or dimensions $override", ({ override, error }) => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request(override))).toBeNull();
    expect(core.getError()).toBe(error);
    expect(core.prepareReadPixels(request())).not.toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("validates destination and complete target even for zero-sized reads", () => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({ width: 0, viewType: null }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.prepareReadPixels(request({ width: 0, viewType: "Float32Array" }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    const framebuffer = core.createFramebuffer();
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.prepareReadPixels(request({ width: 0 }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_FRAMEBUFFER_OPERATION);
  });

  it("uses the shared validation ordering for multiply invalid requests", () => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({ viewType: null, format: 0xbad }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.prepareReadPixels(request({ width: -1, format: 0xbad }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(core.prepareReadPixels(request({ viewType: "Float32Array", format: 0xbad }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    const framebuffer = core.createFramebuffer();
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.prepareReadPixels(request({ byteLength: 0 }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.prepareReadPixels(request({ width: -1 }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.prepareReadPixels(request())).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_FRAMEBUFFER_OPERATION);
  });

  it("rejects unsafe full-rectangle spans before clipping", () => {
    const { core } = createContext();
    expect(core.prepareReadPixels(request({
      width: 0x7fff_ffff, height: 0x7fff_ffff, byteLength: Number.MAX_SAFE_INTEGER,
    }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.prepareReadPixels(request({ x: -2, width: 3, byteLength: 4 }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
  });

  it("selects the current framebuffer and observes attachment storage replacement", () => {
    const { core, surface } = createContext();
    const texture = core.createTexture();
    core.bindTexture(GL.TEXTURE_2D, texture);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const framebuffer = core.createFramebuffer();
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    const before = core.prepareReadPixels(request({ width: 4, height: 3, byteLength: 48 }))!;
    expect(before).toMatchObject({
      target: { isDefault: false, width: 2, height: 2 }, copyWidth: 2, copyHeight: 2,
    });
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 3, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const after = core.prepareReadPixels(request({ width: 4, height: 3, byteLength: 48 }))!;
    expect(after).toMatchObject({
      target: { isDefault: false, width: 3, height: 1 }, copyWidth: 3, copyHeight: 1,
    });
    expect(before.target.width).toBe(2);
    expect(after.target.color).not.toBe(before.target.color);
    core.bindFramebuffer(GL.FRAMEBUFFER, null);
    surface.width = 2;
    surface.height = 1;
    expect(core.prepareReadPixels(request({ width: 4, height: 3, byteLength: 48 }))).toMatchObject({
      target: { isDefault: true, width: 2, height: 1 }, copyWidth: 2, copyHeight: 1,
    });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("advertises the supported pair and preserves framebuffer-specific query errors", () => {
    const { core } = createContext();
    expect(core.getParameter(GL.IMPLEMENTATION_COLOR_READ_FORMAT)).toBe(GL.RGBA);
    expect(core.getParameter(GL.IMPLEMENTATION_COLOR_READ_TYPE)).toBe(GL.UNSIGNED_BYTE);
    const framebuffer = core.createFramebuffer();
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.prepareReadPixels(request())).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_FRAMEBUFFER_OPERATION);
    for (const parameter of [GL.IMPLEMENTATION_COLOR_READ_FORMAT, GL.IMPLEMENTATION_COLOR_READ_TYPE]) {
      expect(core.getParameter(parameter)).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
    }
    expect(core.getParameter(GL.FRAMEBUFFER_BINDING)).toBe(framebuffer);
    core.bindFramebuffer(GL.FRAMEBUFFER, null);
    expect(core.getParameter(GL.IMPLEMENTATION_COLOR_READ_FORMAT)).toBe(GL.RGBA);
    expect(core.prepareReadPixels(request())).not.toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("returns no plan or new error after context loss", () => {
    const { core } = createContext();
    core.markLost();
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.prepareReadPixels(request({ width: -1, viewType: null }))).toBeNull();
    expect(core.getParameter(GL.IMPLEMENTATION_COLOR_READ_FORMAT)).toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});
