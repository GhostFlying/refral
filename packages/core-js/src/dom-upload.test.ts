import { describe, expect, it, vi } from "vitest";
import { GL } from "@refral/core-api";
import type { Compiler, DomTextureUploadRequest, PixelUpload, SemanticHost } from "@refral/core-api";
import { SemanticContext } from "./context.js";

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(), clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(), replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(), retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile() { throw new Error("DOM upload planning must not compile shaders."); },
    link() { throw new Error("DOM upload planning must not link programs."); },
  };
  const core = new SemanticContext({ width: 8, height: 8 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  const texture = core.createTexture()!;
  core.bindTexture(GL.TEXTURE_2D, texture);
  return { core, texture, host };
}

function request(overrides: Partial<DomTextureUploadRequest> = {}): DomTextureUploadRequest {
  return { operation: "texImage2D", target: GL.TEXTURE_2D, level: 0, internalFormat: GL.RGBA,
    x: 0, y: 0, width: 1, height: 1, format: GL.RGBA, type: GL.UNSIGNED_BYTE,
    sourceValid: true, ...overrides };
}

function upload(bytes: Uint8Array, source: PixelUpload["source"] = "dom"): PixelUpload {
  return { bytes, viewType: "Uint8ClampedArray", source };
}

const palette = [100, 80, 60, 128, 254, 1, 64, 0, 7, 9, 15, 255, 254, 128, 10, 1];
const premultiplied = [50, 40, 30, 128, 0, 0, 0, 0, 7, 9, 15, 255, 1, 1, 0, 1];

describe("JS DOM texture upload planning", () => {
  it("rejects a lost source context without changing destination storage or versions", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const storage = texture.storage;
    const version = texture.version;
    const replacements = host.replaceStorage.mock.calls.length;
    expect(core.prepareDomTextureUpload(request({ sourceContextLost: true, target: 0xbad }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.prepareDomTextureUpload(request({ sourceContextLost: true, sourceValid: false }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(texture.storage).toBe(storage);
    expect(texture.version).toBe(version);
    expect(host.replaceStorage.mock.calls.length).toBe(replacements);
  });

  it("returns unpack flags while retaining binding, storage and versions", () => {
    const { core, texture, host } = createContext();
    core.pixelStorei(GL.UNPACK_ALIGNMENT, 8);
    core.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 1);
    core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    core.pixelStorei(GL.UNPACK_COLORSPACE_CONVERSION_WEBGL, GL.NONE);
    expect(core.prepareDomTextureUpload(request())).toEqual({
      flipY: true, premultiplyAlpha: true, colorSpaceConversion: GL.NONE,
    });
    expect(core.getParameter(GL.TEXTURE_BINDING_2D)).toBe(texture);
    expect(core.getParameter(GL.UNPACK_ALIGNMENT)).toBe(8);
    expect(texture.storage).toBeNull();
    expect(texture.generation).toBe(0);
    expect(texture.version).toBe(0);
    expect(host.replaceStorage).not.toHaveBeenCalled();
    expect(host.flush).not.toHaveBeenCalled();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each([
    { sourceValid: false }, { width: 0 }, { height: 0 }, { width: -1 }, { height: -1 },
    { width: NaN }, { height: NaN }, { width: Infinity }, { height: Infinity },
    { width: 1.5 }, { height: 1.5 }, { width: Number.MAX_SAFE_INTEGER + 1 },
    { height: Number.MAX_SAFE_INTEGER + 1 },
  ])("validates source facts before GL parameters for $0", (invalid) => {
    const { core, texture, host } = createContext();
    core.bindTexture(GL.TEXTURE_2D, null);
    expect(core.prepareDomTextureUpload(request({ target: 0xbad, format: 0xbad, ...invalid }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.getParameter(GL.TEXTURE_BINDING_2D)).toBeNull();
    expect(texture.storage).toBeNull();
    expect(texture.version).toBe(0);
    expect(host.replaceStorage).not.toHaveBeenCalled();
  });

  it.each([
    { invalid: { target: 0xbad }, error: GL.INVALID_ENUM },
    { invalid: { level: -1 }, error: GL.INVALID_VALUE },
    { invalid: { width: 4097 }, error: GL.INVALID_VALUE },
    { invalid: { height: 4097 }, error: GL.INVALID_VALUE },
    { invalid: { format: 0xbad }, error: GL.INVALID_ENUM },
    { invalid: { type: GL.FLOAT }, error: GL.INVALID_ENUM },
    { invalid: { internalFormat: GL.RGB }, error: GL.INVALID_OPERATION },
  ])("reuses ordinary image validation for $invalid", ({ invalid, error }) => {
    const { core, texture, host } = createContext();
    expect(core.prepareDomTextureUpload(request(invalid))).toBeNull();
    expect(core.getError()).toBe(error);
    expect(texture.storage).toBeNull();
    expect(texture.generation).toBe(0);
    expect(host.replaceStorage).not.toHaveBeenCalled();
  });

  it("reports unbound and undefined storage errors without allocating", () => {
    const { core, host } = createContext();
    expect(core.prepareDomTextureUpload(request({ operation: "texSubImage2D" }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.bindTexture(GL.TEXTURE_2D, null);
    expect(core.prepareDomTextureUpload(request())).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(host.replaceStorage).not.toHaveBeenCalled();
  });

  it("prepares subimages without advancing existing versions and rejects invalid updates", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const storage = texture.storage;
    expect(core.prepareDomTextureUpload(request({ operation: "texSubImage2D", x: 1, y: 1 }))).toEqual({
      flipY: false, premultiplyAlpha: false, colorSpaceConversion: GL.BROWSER_DEFAULT_WEBGL,
    });
    for (const invalid of [{ x: -1 }, { y: -1 }, { x: 2 }, { y: 2 }]) {
      expect(core.prepareDomTextureUpload(request({ operation: "texSubImage2D", ...invalid }))).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_VALUE);
    }
    expect(core.prepareDomTextureUpload(request({ operation: "texSubImage2D", format: GL.RGB }))).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(texture.storage).toBe(storage);
    expect(texture.generation).toBe(1);
    expect(texture.version).toBe(1);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });

  it("gives supported source facts an explicit capability outcome for mip levels", () => {
    const { core, texture } = createContext();
    expect(() => core.prepareDomTextureUpload(request({ level: 1 }))).toThrowError(/texture mip levels/);
    expect(texture.storage).toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("returns no plan or new error after context loss", () => {
    const { core, host } = createContext();
    core.markLost();
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.prepareDomTextureUpload(request({ sourceValid: false, target: 0xbad }))).toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(host.replaceStorage).not.toHaveBeenCalled();
  });
});

describe("JS DOM pixel consumption", () => {
  it.each([1, 2, 4, 8])("consumes tight RGBA rows independently of unpack alignment %i", (alignment) => {
    const { core, texture } = createContext();
    const bytes = new Uint8Array([...palette, 11, 22, 33, 44, 55, 66, 77, 88]);
    core.pixelStorei(GL.UNPACK_ALIGNMENT, alignment);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 3, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, upload(bytes));
    bytes.fill(0);
    expect(texture.storage!.data).toEqual(new Uint8Array([...palette, 11, 22, 33, 44, 55, 66, 77, 88]));
    expect(texture.generation).toBe(1);
    expect(texture.version).toBe(1);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it.each([
    { flip: false, premultiply: false, expected: palette },
    { flip: true, premultiply: false, expected: [...palette.slice(8), ...palette.slice(0, 8)] },
    { flip: false, premultiply: true, expected: premultiplied },
    { flip: true, premultiply: true, expected: [...premultiplied.slice(8), ...premultiplied.slice(0, 8)] },
  ])("applies flip=$flip and premultiply=$premultiply once", ({ flip, premultiply, expected }) => {
    const { core, texture } = createContext();
    core.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, Number(flip));
    core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE,
      upload(new Uint8Array(palette)));
    expect(texture.storage!.data).toEqual(new Uint8Array(expected));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  const formats = [
    { format: GL.RGBA, expected: [200, 100, 50, 128], premultiplied: [100, 50, 25, 128] },
    { format: GL.RGB, expected: [200, 100, 50, 255], premultiplied: [100, 50, 25, 255] },
    { format: GL.ALPHA, expected: [0, 0, 0, 128], premultiplied: [0, 0, 0, 128] },
    { format: GL.LUMINANCE, expected: [200, 200, 200, 255], premultiplied: [100, 100, 100, 255] },
    { format: GL.LUMINANCE_ALPHA, expected: [200, 200, 200, 128], premultiplied: [100, 100, 100, 128] },
  ];
  for (const premultiply of [false, true]) {
    it.each(formats)(`normalizes original RGBA source into format $format with premultiply=${premultiply}`, (format) => {
      const { core, texture } = createContext();
      core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
      core.texImage2D(GL.TEXTURE_2D, 0, format.format, 1, 1, 0, format.format, GL.UNSIGNED_BYTE,
        upload(new Uint8Array([200, 100, 50, 128])));
      expect(texture.storage!.data).toEqual(new Uint8Array(premultiply ? format.premultiplied : format.expected));
      expect(core.getError()).toBe(GL.NO_ERROR);
    });
  }

  it("consumes already converted RGBA without applying current flip or premultiply again", () => {
    const { core, texture } = createContext();
    core.pixelStorei(GL.UNPACK_ALIGNMENT, 8);
    core.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 1);
    core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    const converted = [...premultiplied.slice(8), ...premultiplied.slice(0, 8)];
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE,
      upload(new Uint8Array(converted), "dom-converted"));
    expect(texture.storage!.data).toEqual(new Uint8Array(converted));
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 1, 1, 0, GL.RGB, GL.UNSIGNED_BYTE,
      upload(new Uint8Array([100, 50, 25, 128]), "dom-converted"));
    expect(texture.storage!.data).toEqual(new Uint8Array([100, 50, 25, 255]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("owns subimage payloads while retaining prior storage and generation", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const before = texture.storage!;
    const bytes = new Uint8Array([17, 34, 51, 0]);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 1, 1, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, upload(bytes));
    bytes.fill(0);
    expect(texture.storage!.parent).toBe(before);
    expect(texture.storage!.update).toEqual({ x: 1, y: 1, width: 1, height: 1,
      data: new Uint8Array([17, 34, 51, 0]) });
    expect(before.data).toEqual(new Uint8Array(16));
    expect(texture.generation).toBe(1);
    expect(texture.version).toBe(2);
    expect(host.replaceStorage).toHaveBeenCalledTimes(2);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("preserves old storage and versions after malformed DOM payloads", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const before = texture.storage;
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, upload(new Uint8Array(3)));
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array(4), viewType: "Float32Array", source: "dom" });
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.texImage2D(0xbad, 0, GL.RGBA, 0, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, upload(new Uint8Array(0)));
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(texture.storage).toBe(before);
    expect(texture.generation).toBe(1);
    expect(texture.version).toBe(1);
    expect(host.replaceStorage).toHaveBeenCalledTimes(1);
  });

  it("retains ordinary typed and null upload layout and format behavior", () => {
    const { core, texture } = createContext();
    core.pixelStorei(GL.UNPACK_ALIGNMENT, 8);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 3, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array(24), viewType: "Uint8Array" });
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 1, 1, 0, GL.RGB, GL.UNSIGNED_BYTE,
      { bytes: new Uint8Array([200, 100, 50]), viewType: "Uint8Array" });
    expect(texture.storage!.data).toEqual(new Uint8Array([200, 100, 50, 255]));
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 0, 2, 0, GL.RGB, GL.UNSIGNED_BYTE, null);
    expect(texture.storage!.data).toEqual(new Uint8Array(0));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("reports allocation failure without committing storage or versions", () => {
    const { core, texture, host } = createContext();
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    const before = texture.storage;
    const source = upload(new Uint8Array(16));
    const NativeUint8Array = Uint8Array;
    class FailingPixels extends NativeUint8Array {
      constructor(length: number) {
        if (length === 16) throw new RangeError("Simulated pixel allocation failure");
        super(length);
      }
    }
    vi.stubGlobal("Uint8Array", FailingPixels);
    try {
      expect(core.prepareDomTextureUpload(request({ width: 2, height: 2 }))).not.toBeNull();
      core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, source);
      expect(core.getError()).toBe(GL.OUT_OF_MEMORY);
      expect(texture.storage).toBe(before);
      expect(texture.generation).toBe(1);
      expect(texture.version).toBe(1);
      expect(host.replaceStorage).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
