import { describe, expect, it, vi } from "vitest";
import { allocateContextId, CUBE_FACES, ExecutionResources, GL } from "@refral/core-api";
import type {
  Compiler, DrawingCore, PixelUpload, ProgramHandle, SemanticHost, TextureHandle,
} from "@refral/core-api";
import { createCompilerRegistry } from "@refral/compiler";
import { createJsDrawingCore } from "./drawing.js";

function createContext(samplerTypes: number[] = [GL.SAMPLER_CUBE]) {
  const host = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(), clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(), finish: vi.fn<SemanticHost["finish"]>(), replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(), retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile(source, stage) {
      return { source, stage, success: true, log: "", version: 1, wgsl: "", attributes: [],
        uniforms: [], varyings: [], outputs: [], uniformBufferSize: 16 };
    },
    link() {
      return { success: true, log: "", vertexWGSL: "", fragmentWGSL: "", vertexEntryPoint: "main",
        fragmentEntryPoint: "main", attributes: [], uniforms: [],
        samplers: samplerTypes.map((type, index) => ({ name: `u_sampler${index}`, type, size: 1,
          samplerBinding: index * 2, textureBinding: index * 2 + 1 })),
        vertexUniformBufferSize: 16, fragmentUniformBufferSize: 16, driverUniformBufferSize: 32 };
    },
  };
  const contextId = allocateContextId();
  const resources = new ExecutionResources(contextId, host);
  const apply = vi.spyOn(resources, "apply");
  const core = createJsDrawingCore({ contextId, maxBufferBytes: 4096, surface: { width: 8, height: 8 }, attributes: {},
    profile: { vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
      varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4 },
  }, { compiler: createCompilerRegistry(compiler), host, resources });
  const program = core.invoke("createProgram", []) as ProgramHandle;
  for (const type of [GL.VERTEX_SHADER, GL.FRAGMENT_SHADER]) {
    const shader = core.invoke("createShader", [type]);
    core.invoke("shaderSource", [shader, "shader"]);
    core.invoke("compileShader", [shader]);
    core.invoke("attachShader", [program, shader]);
  }
  core.invoke("linkProgram", [program]);
  core.invoke("useProgram", [program]);
  return { core, host, resources, apply, program };
}

function bindTexture(core: DrawingCore, target: number = GL.TEXTURE_CUBE_MAP): TextureHandle {
  const texture = core.invoke("createTexture", []) as TextureHandle;
  core.invoke("bindTexture", [target, texture]);
  return texture;
}

function define(core: DrawingCore, target: number, width = 1, height = width,
  format: number = GL.RGBA, pixels: PixelUpload | Uint8Array | null = null): void {
  core.invoke("texImage2D", [target, 0, format, width, height, 0, format, GL.UNSIGNED_BYTE, pixels]);
}

function defineCube(core: DrawingCore, size = 1): TextureHandle {
  const texture = bindTexture(core);
  for (const face of CUBE_FACES) define(core, face, size);
  return texture;
}

function version(texture: TextureHandle, imageTarget: number, storageGeneration = 1, contentVersion = 1) {
  return { texture, imageTarget, level: 0, storageGeneration, contentVersion };
}

describe("JS CubeMap image and sampling semantics", () => {
  it("fixes target at first successful binding and keeps each unit's target bindings independent", () => {
    const { core } = createContext();
    const texture2D = bindTexture(core, GL.TEXTURE_2D);
    const cube = core.invoke("createTexture", []) as TextureHandle;
    expect(core.invoke("isTexture", [cube])).toBe(false);
    core.invoke("bindTexture", [CUBE_FACES[0], cube]);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(core.invoke("isTexture", [cube])).toBe(false);
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, cube]);
    expect(core.invoke("isTexture", [cube])).toBe(true);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_2D])).toBe(texture2D);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBe(cube);
    core.invoke("bindTexture", [GL.TEXTURE_2D, cube]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_2D])).toBe(texture2D);
    core.invoke("activeTexture", [GL.TEXTURE1]);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBeNull();
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, cube]);
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, null]);
    core.invoke("activeTexture", [GL.TEXTURE0]);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBe(cube);
    expect(core.invoke("getParameter", [GL.MAX_CUBE_MAP_TEXTURE_SIZE])).toBe(4096);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("publishes separate canonical image versions and preserves earlier six-face draw snapshots", () => {
    const { core, host, resources, apply } = createContext();
    const cube = bindTexture(core);
    for (const [index, face] of CUBE_FACES.entries()) {
      const input = new Uint8Array([index + 1, 2, 3, 255]);
      define(core, face, 1, 1, GL.RGBA, { bytes: input, viewType: "Uint8Array" });
      input.fill(0);
    }
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const before = host.draw.mock.calls[0]![0].textures[0]!;
    expect(before.dimension).toBe("cube");
    expect(before.storage).toBeNull();
    expect(before.cubeFaces).toHaveLength(6);
    for (const [index, face] of CUBE_FACES.entries()) {
      expect(before.cubeFaces![index]).toBe(resources.texture(version(cube, face)));
      expect(before.cubeFaces![index]!.data).toEqual(new Uint8Array([index + 1, 2, 3, 255]));
    }
    const input = new Uint8Array([90, 80, 70, 255]);
    core.invoke("texSubImage2D", [CUBE_FACES[2], 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: input, viewType: "Uint8Array" }]);
    input.fill(0);
    core.invoke("texParameteri", [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MAG_FILTER, GL.NEAREST]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const after = host.draw.mock.calls[1]![0].textures[0]!;
    expect(after.cubeFaces![2]).toBe(resources.texture(version(cube, CUBE_FACES[2], 1, 2)));
    expect(after.cubeFaces![2]!.parent).toBe(before.cubeFaces![2]);
    expect(after.cubeFaces![2]!.update!.data).toEqual(new Uint8Array([90, 80, 70, 255]));
    expect(after.cubeFaces!.filter((image, index) => image === before.cubeFaces![index])).toHaveLength(5);
    expect(before.parameters.magFilter).toBe(GL.LINEAR);
    expect(after.parameters.magFilter).toBe(GL.NEAREST);
    expect(apply.mock.calls).toHaveLength(7);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("requires six positive matching square images with the same logical format", () => {
    const { core, host } = createContext();
    bindTexture(core);
    for (const face of CUBE_FACES.slice(0, 5)) define(core, face, 2);
    core.invoke("texParameteri", [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.LINEAR]);
    const sample = () => {
      core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
      return host.draw.mock.calls.at(-1)![0].textures[0]!;
    };
    expect(sample()).toEqual(expect.objectContaining({ dimension: "cube", storage: null }));
    expect(sample().cubeFaces).toBeUndefined();
    define(core, CUBE_FACES[5], 1);
    expect(sample().cubeFaces).toBeUndefined();
    define(core, CUBE_FACES[5], 2, 2, GL.RGB);
    expect(sample().cubeFaces).toBeUndefined();
    define(core, CUBE_FACES[5], 0);
    expect(sample().cubeFaces).toBeUndefined();
    define(core, CUBE_FACES[5], 2);
    expect(sample().cubeFaces).toHaveLength(6);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("applies NPOT sampling rules and the one-pixel mipmap-completeness exception", () => {
    const { core, host } = createContext();
    defineCube(core);
    const sample = () => {
      core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
      return host.draw.mock.calls.at(-1)![0].textures[0]!.cubeFaces;
    };
    expect(sample()).toHaveLength(6);
    for (const face of CUBE_FACES) define(core, face, 2);
    expect(sample()).toBeUndefined();
    core.invoke("texParameteri", [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.NEAREST]);
    expect(sample()).toHaveLength(6);
    for (const face of CUBE_FACES) define(core, face, 3);
    expect(sample()).toBeUndefined();
    core.invoke("texParameteri", [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE]);
    expect(sample()).toBeUndefined();
    core.invoke("texParameteri", [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE]);
    expect(sample()).toHaveLength(6);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("rejects malformed face definitions and updates without advancing prior image versions", () => {
    const { core, resources, apply } = createContext();
    const cube = bindTexture(core);
    define(core, CUBE_FACES[0]);
    const original = resources.texture(version(cube, CUBE_FACES[0]));
    define(core, CUBE_FACES[0], 2, 1);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    define(core, GL.TEXTURE_CUBE_MAP);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.invoke("texParameteri", [CUBE_FACES[0], GL.TEXTURE_MAG_FILTER, GL.NEAREST]);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.invoke("texSubImage2D", [CUBE_FACES[1], 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(4)]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("texSubImage2D", [CUBE_FACES[0], 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, null]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    define(core, CUBE_FACES[0], 1, 1, GL.RGBA, { bytes: new Uint8Array(4), viewType: "Float32Array" });
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("texSubImage2D", [CUBE_FACES[0], 0, 1, 1, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(0)]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(resources.texture(version(cube, CUBE_FACES[0]))).toBe(original);
    expect(apply).toHaveBeenCalledTimes(1);
    core.invoke("texImage2D", [CUBE_FACES[0], 1, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(resources.texture({ ...version(cube, CUBE_FACES[0]), level: 1 }).data).toEqual(new Uint8Array(4));
    expect(resources.texture(version(cube, CUBE_FACES[0]))).toBe(original);
  });

  it.each([
    { format: GL.RGBA, input: [10, 20, 30, 128], expected: [10, 20, 30, 128], zero: [0, 0, 0, 0] },
    { format: GL.RGB, input: [10, 20, 30], expected: [10, 20, 30, 255], zero: [0, 0, 0, 255] },
    { format: GL.ALPHA, input: [128], expected: [0, 0, 0, 128], zero: [0, 0, 0, 0] },
    { format: GL.LUMINANCE, input: [10], expected: [10, 10, 10, 255], zero: [0, 0, 0, 255] },
    { format: GL.LUMINANCE_ALPHA, input: [10, 128], expected: [10, 10, 10, 128], zero: [0, 0, 0, 0] },
  ])("expands typed and null face inputs for logical format $format", ({ format, input, expected, zero }) => {
    const { core, resources } = createContext();
    const cube = bindTexture(core);
    define(core, CUBE_FACES[0], 1, 1, format, new Uint8Array(input));
    expect(resources.texture(version(cube, CUBE_FACES[0])).data).toEqual(new Uint8Array(expected));
    define(core, CUBE_FACES[0], 1, 1, format);
    expect(resources.texture(version(cube, CUBE_FACES[0], 2, 2)).data).toEqual(new Uint8Array(zero));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("preflights DOM face destinations and consumes unpacked source snapshots once", () => {
    const { core, resources, apply } = createContext();
    const cube = bindTexture(core);
    core.invoke("pixelStorei", [GL.UNPACK_FLIP_Y_WEBGL, 1]);
    core.invoke("pixelStorei", [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
    const request = { operation: "texImage2D" as const, target: CUBE_FACES[3], level: 0,
      internalFormat: GL.RGBA, x: 0, y: 0, width: 2, height: 2, format: GL.RGBA,
      type: GL.UNSIGNED_BYTE, sourceValid: true };
    expect(core.prepareDomTextureUpload(request)).toMatchObject({ flipY: true, premultiplyAlpha: true });
    expect(apply).not.toHaveBeenCalled();
    const input = new Uint8Array([100, 80, 60, 128, 10, 20, 30, 255,
      90, 60, 30, 255, 30, 60, 90, 255]);
    define(core, CUBE_FACES[3], 2, 2, GL.RGBA, { bytes: input, viewType: "Uint8Array", source: "dom" });
    input.fill(0);
    expect(resources.texture(version(cube, CUBE_FACES[3])).data).toEqual(new Uint8Array([
      90, 60, 30, 255, 30, 60, 90, 255, 50, 40, 30, 128, 10, 20, 30, 255,
    ]));
    expect(core.prepareDomTextureUpload({ ...request, width: 1 })).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("updates a rectangular face region using aligned rows, flip and premultiplication", () => {
    const { core, resources } = createContext();
    const cube = defineCube(core, 2);
    core.invoke("pixelStorei", [GL.UNPACK_ALIGNMENT, 8]);
    core.invoke("pixelStorei", [GL.UNPACK_FLIP_Y_WEBGL, 1]);
    core.invoke("pixelStorei", [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
    const input = new Uint8Array([100, 80, 60, 128, 99, 99, 99, 99, 90, 60, 30, 255]);
    core.invoke("texSubImage2D", [CUBE_FACES[4], 0, 1, 0, 1, 2, GL.RGBA, GL.UNSIGNED_BYTE,
      { bytes: input, viewType: "Uint8ClampedArray" }]);
    input.fill(0);
    const updated = resources.texture(version(cube, CUBE_FACES[4], 1, 2));
    expect(updated).toMatchObject({ width: 2, height: 2 });
    expect(updated.update).toEqual({ x: 1, y: 0, width: 1, height: 2,
      data: new Uint8Array([90, 60, 30, 255, 50, 40, 30, 128]) });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("shares mixed sampler validation between draw and validateProgram and selects bindings by type", () => {
    const { core, host, program } = createContext([GL.SAMPLER_2D, GL.SAMPLER_CUBE]);
    const texture2D = bindTexture(core, GL.TEXTURE_2D);
    define(core, GL.TEXTURE_2D);
    defineCube(core);
    core.invoke("validateProgram", [program]);
    expect(core.invoke("getProgramParameter", [program, GL.VALIDATE_STATUS])).toBe(false);
    expect(core.invoke("getProgramInfoLog", [program])).toMatch(/different types/);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 0]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(host.draw).not.toHaveBeenCalled();
    const cubeLocation = core.invoke("getUniformLocation", [program, "u_sampler1"]);
    core.invoke("uniform1iv", [cubeLocation, new Int32Array([1])]);
    expect(core.invoke("getUniform", [program, cubeLocation])).toBe(1);
    core.invoke("activeTexture", [GL.TEXTURE1]);
    defineCube(core);
    core.invoke("bindTexture", [GL.TEXTURE_2D, texture2D]);
    core.invoke("validateProgram", [program]);
    expect(core.invoke("getProgramParameter", [program, GL.VALIDATE_STATUS])).toBe(true);
    expect(core.invoke("getProgramInfoLog", [program])).toBe("");
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const bindings = host.draw.mock.calls[0]![0].textures;
    expect(bindings[0]!.storage).not.toBeNull();
    expect(bindings[0]!.cubeFaces).toBeUndefined();
    expect(bindings[1]!.dimension).toBe("cube");
    expect(bindings[1]!.cubeFaces).toHaveLength(6);
    core.invoke("uniform1f", [cubeLocation, 0]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("uniform1i", [cubeLocation, 4]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.invoke("getUniform", [program, cubeLocation])).toBe(1);
    core.invoke("linkProgram", [program]);
    const fresh = core.invoke("getUniformLocation", [program, "u_sampler1"]);
    expect(core.invoke("getUniform", [program, fresh])).toBe(0);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("allows active cube samplers of the same type to share a unit", () => {
    const { core, host, program } = createContext([GL.SAMPLER_CUBE, GL.SAMPLER_CUBE]);
    defineCube(core);
    core.invoke("validateProgram", [program]);
    expect(core.invoke("getProgramParameter", [program, GL.VALIDATE_STATUS])).toBe(true);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const bindings = host.draw.mock.calls[0]![0].textures;
    expect(bindings[0]!.cubeFaces).toEqual(bindings[1]!.cubeFaces);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("retires all face images and unit bindings while preserving previously encoded records", () => {
    const { core, host, resources, apply } = createContext();
    const texture2D = bindTexture(core, GL.TEXTURE_2D);
    const cube = defineCube(core);
    core.invoke("activeTexture", [GL.TEXTURE1]);
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, cube]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const earlier = host.draw.mock.calls[0]![0].textures[0]!.cubeFaces!;
    core.invoke("deleteTexture", [cube]);
    core.invoke("deleteTexture", [cube]);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBeNull();
    core.invoke("activeTexture", [GL.TEXTURE0]);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBeNull();
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_2D])).toBe(texture2D);
    expect(core.invoke("isTexture", [cube])).toBe(false);
    expect(apply.mock.calls.filter(([operation]) => operation.kind === "retire-texture")).toHaveLength(6);
    expect(host.retireStorage.mock.calls.map(([storage]) => storage)).toEqual(earlier);
    expect(() => resources.texture(version(cube, CUBE_FACES[0]))).toThrow(/stale/);
    expect(earlier[0]!.data).toEqual(new Uint8Array(4));
    const replacement = bindTexture(core);
    expect(replacement.slot).toBe(cube.slot);
    expect(replacement.generation).toBeGreaterThan(cube.generation);
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, cube]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    const foreign = bindTexture(createContext().core);
    core.invoke("bindTexture", [GL.TEXTURE_CUBE_MAP, foreign]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getParameter", [GL.TEXTURE_BINDING_CUBE_MAP])).toBe(replacement);
  });

  it("queries the identity and face of a valid cube attachment", () => {
    const { core } = createContext();
    const cube = defineCube(core);
    const framebuffer = core.invoke("createFramebuffer", []);
    core.invoke("bindFramebuffer", [GL.FRAMEBUFFER, framebuffer]);
    core.invoke("framebufferTexture2D", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, cube, 0]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("framebufferTexture2D", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, CUBE_FACES[0], cube, 0]);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
      GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE])).toBe(GL.TEXTURE);
    expect(core.invoke("getFramebufferAttachmentParameter", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
      GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE])).toBe(CUBE_FACES[0]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});
