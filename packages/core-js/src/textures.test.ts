import { describe, expect, it, vi } from "vitest";
import { GL, SemanticContext, isTextureComplete } from "./index.js";
import type { Compiler, SemanticHost } from "@refral/core-api";

function createContext() {
  const host = { limits: { maxTextureDimension2D: 4096 }, draw() {}, clear() {}, flush() {},
    replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(), retireStorage() {}, retireDepth() {},
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile() { throw new Error("Texture tests must not compile shaders."); },
    link() { throw new Error("Texture tests must not link programs."); },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  const texture = core.createTexture()!;
  core.bindTexture(GL.TEXTURE_2D, texture);
  return { core, texture, host };
}

const formats = [
  { format: GL.RGBA, bytes: [32, 64, 96, 128], rgba: [32, 64, 96, 128], zero: [0, 0, 0, 0] },
  { format: GL.RGB, bytes: [32, 64, 96], rgba: [32, 64, 96, 255], zero: [0, 0, 0, 255] },
  { format: GL.ALPHA, bytes: [32], rgba: [0, 0, 0, 32], zero: [0, 0, 0, 0] },
  { format: GL.LUMINANCE, bytes: [32], rgba: [32, 32, 32, 255], zero: [0, 0, 0, 255] },
  { format: GL.LUMINANCE_ALPHA, bytes: [32, 64], rgba: [32, 32, 32, 64], zero: [0, 0, 0, 0] },
];

describe("JS five-format texture semantics", () => {
  it("makes a texture object valid only after its first successful binding", () => {
    const { core } = createContext();
    const texture = core.createTexture()!;
    expect(core.isTexture(texture)).toBe(false);
    core.bindTexture(-1, texture);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(core.isTexture(texture)).toBe(false);
    core.bindTexture(GL.TEXTURE_2D, texture);
    expect(core.isTexture(texture)).toBe(true);
    core.bindTexture(GL.TEXTURE_2D, null);
    expect(core.isTexture(texture)).toBe(true);
    core.deleteTexture(texture);
    core.deleteTexture(texture);
    expect(core.isTexture(texture)).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each(formats)("expands format $format into owned RGBA bytes and initializes null inputs", ({ format, bytes, rgba, zero }) => {
    const { core, texture } = createContext();
    const input = new Uint8Array(bytes);
    core.texImage2D(GL.TEXTURE_2D, 0, format, 1, 1, 0, format, GL.UNSIGNED_BYTE,
      { bytes: input, viewType: "Uint8Array" });
    input.fill(0);
    expect(texture.storage!.data).toEqual(new Uint8Array(rgba));
    core.texImage2D(GL.TEXTURE_2D, 0, format, 1, 1, 0, format, GL.UNSIGNED_BYTE, null);
    expect(texture.storage!.data).toEqual(new Uint8Array(zero));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("uses the selected source view and unpack row alignment without requiring last-row padding", () => {
    const { core, texture } = createContext();
    const source = new Uint8Array([90, 1, 2, 3, 99, 4, 5, 6, 91]);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.LUMINANCE, 3, 2, 0, GL.LUMINANCE, GL.UNSIGNED_BYTE,
      { bytes: source.subarray(1, 8), viewType: "Uint8Array" });
    source.fill(0);
    expect(texture.storage!.data).toEqual(new Uint8Array([
      1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255,
      4, 4, 4, 255, 5, 5, 5, 255, 6, 6, 6, 255,
    ]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("applies flip and premultiplication to normalized Uint8ClampedArray input", () => {
    const { core, texture } = createContext();
    core.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 1);
    core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array([100, 80, 60, 128, 90, 60, 30, 255]), viewType: "Uint8ClampedArray" });
    expect(texture.storage!.data).toEqual(new Uint8Array([90, 60, 30, 255, 50, 40, 30, 128]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("rejects null subimages, wrong input brands, and short rows without changing data or versions", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const original = texture.storage;
    const generation = texture.generation;
    const version = texture.version;
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array(16), viewType: "Float32Array" });
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array(3), viewType: "Uint8Array" });
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(texture.storage).toBe(original);
    expect(texture.generation).toBe(generation);
    expect(texture.version).toBe(version);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });

  it("validates subimage enum, level, and bounds errors atomically and leaves valid empty updates unchanged", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const original = texture.storage;
    const upload = { bytes: new Uint8Array(4), viewType: "Uint8Array" };
    core.texSubImage2D(GL.TEXTURE_2D, -1, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, upload);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 1, 1, -1, GL.UNSIGNED_BYTE, upload);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 2, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, upload);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 0, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array(0), viewType: "Uint8Array" });
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(texture.storage).toBe(original);
    expect(texture.version).toBe(1);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });

  it("tracks NPOT and level-zero completeness as sampler parameters change", () => {
    const { core, texture } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 3, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(isTextureComplete(texture)).toBe(false);
    core.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
    core.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    expect(isTextureComplete(texture)).toBe(false);
    core.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    expect(isTextureComplete(texture)).toBe(true);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 0, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(isTextureComplete(texture)).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("requires no additional mip level for a one-pixel texture", () => {
    const { core, texture } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(isTextureComplete(texture)).toBe(true);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(isTextureComplete(texture)).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("reports pixel allocation failure without replacing prior storage or versions", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const previous = texture.storage;
    const NativeUint8Array = Uint8Array;
    class FailingPixels extends NativeUint8Array {
      constructor(length: number) {
        if (length === 16) throw new RangeError("Simulated pixel allocation failure");
        super(length);
      }
    }
    vi.stubGlobal("Uint8Array", FailingPixels);
    try {
      core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(core.getError()).toBe(GL.OUT_OF_MEMORY);
    expect(texture.storage).toBe(previous);
    expect(texture.generation).toBe(1);
    expect(texture.version).toBe(1);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });
});
