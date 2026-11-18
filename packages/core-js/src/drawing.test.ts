import { checkPrimitiveDraws } from "../../../tests/core/primitive-draw-contract";
import { describe, expect, it, vi } from "vitest";
import { allocateContextId, GL, ExecutionResources } from "@refral/core-api";
import type {
  BufferHandle, Compiler, DrawingCore, ProgramHandle, SemanticHost, ShaderHandle, UniformLocationHandle,
} from "@refral/core-api";
import { createCompilerRegistry } from "@refral/compiler";
import { createJsDrawingCore } from "./drawing.js";

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(), clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(), replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(), retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  let nextExecutable = 1;
  const compiler: Compiler = {
    compile(source, stage) {
      return {
        source, stage, version: 1, success: !source.includes("compile-failure"), log: "",
        wgsl: "", attributes: [], uniforms: [], varyings: [], outputs: [], uniformBufferSize: 16,
      };
    },
    link(vertex, fragment) {
      return {
        success: vertex.success && fragment.success, log: "",
        vertexWGSL: `vertex-${nextExecutable++}`, fragmentWGSL: "fragment",
        vertexEntryPoint: "main", fragmentEntryPoint: "main",
        attributes: [{ name: "a_position", type: GL.FLOAT_VEC2, size: 1, location: 0 }],
        uniforms: [{ name: "u_color", type: GL.FLOAT_VEC4, size: 1, vertexOffset: 0, fragmentOffset: 0,
          arrayStride: 0, matrixStride: 0 }], samplers: [],
        vertexUniformBufferSize: 16, fragmentUniformBufferSize: 16, driverUniformBufferSize: 32,
      };
    },
  };
  const registry = createCompilerRegistry(compiler);
  const release = vi.spyOn(registry, "release");
  const dispose = vi.spyOn(registry, "dispose");
  const contextId = allocateContextId();
  const resources = new ExecutionResources(contextId, host);
  const core = createJsDrawingCore({
    contextId, maxBufferBytes: 4096,
    surface: { width: 64, height: 32 }, attributes: { depth: true },
    profile: { vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
      varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4 },
  }, { host, compiler: registry, resources });
  return { core, host, registry, release, dispose };
}

function createLinkedProgram(core: DrawingCore) {
  const vertex = core.invoke("createShader", [GL.VERTEX_SHADER]) as ShaderHandle;
  const fragment = core.invoke("createShader", [GL.FRAGMENT_SHADER]) as ShaderHandle;
  core.invoke("shaderSource", [vertex, "vertex"]);
  core.invoke("shaderSource", [fragment, "fragment"]);
  core.invoke("compileShader", [vertex]);
  core.invoke("compileShader", [fragment]);
  const program = core.invoke("createProgram", []) as ProgramHandle;
  core.invoke("attachShader", [program, vertex]);
  core.invoke("attachShader", [program, fragment]);
  core.invoke("linkProgram", [program]);
  return { program, vertex, fragment };
}

describe("JS DrawingCore logical boundary", () => {
  it("plans line and fan draws with WebGL1 culling and index validation", () => {
    const { core, host } = createContext();
    try {
      core.invoke("useProgram", [createLinkedProgram(core).program]);
      checkPrimitiveDraws(core, () => host.draw.mock.calls.map(([draw]) => draw));
    } finally {
      core.dispose();
    }
  });
  it.each([1, 2, 3, 4])("rejects short vertexAttrib%dfv inputs without changing the current value", (components) => {
    const { core } = createContext();
    core.invoke("vertexAttrib4f", [0, 0.25, 0.5, 0.75, 1]);
    core.invoke(`vertexAttrib${components}fv`, [0, new Float32Array(components - 1)]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.invoke("getVertexAttrib", [0, GL.CURRENT_VERTEX_ATTRIB])).toEqual(new Float32Array([0.25, 0.5, 0.75, 1]));
    core.invoke(`vertexAttrib${components}fv`, [0, new Float32Array([1, 2, 3, 4, 5])]);
    expect(core.invoke("getVertexAttrib", [0, GL.CURRENT_VERTEX_ATTRIB])).toEqual(new Float32Array([
      1, components > 1 ? 2 : 0, components > 2 ? 3 : 0, components > 3 ? 4 : 1,
    ]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("allows a null ARRAY_BUFFER pointer at offset zero and preserves state after rejecting a nonzero offset", () => {
    const { core } = createContext();
    const buffer = core.createBuffer()!;
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(GL.ARRAY_BUFFER, 64, GL.STATIC_DRAW);
    core.invoke("vertexAttribPointer", [0, 2, GL.FLOAT, false, 8, 8]);
    core.bindBuffer(GL.ARRAY_BUFFER, null);
    core.invoke("vertexAttribPointer", [0, 3, GL.FLOAT, true, 16, 4]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING])).toBe(buffer);
    expect(core.invoke("getVertexAttribOffset", [0, GL.VERTEX_ATTRIB_ARRAY_POINTER])).toBe(8);
    core.invoke("vertexAttribPointer", [0, 3, GL.FLOAT, true, 16, 0]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING])).toBeNull();
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_SIZE])).toBe(3);
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_NORMALIZED])).toBe(true);
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_STRIDE])).toBe(16);
    expect(core.invoke("getVertexAttribOffset", [0, GL.VERTEX_ATTRIB_ARRAY_POINTER])).toBe(0);
  });

  it("returns typed handles for object results while sharing Buffer and draw state", () => {
    const { core, host } = createContext();
    const { program, vertex, fragment } = createLinkedProgram(core);
    expect(program).toMatchObject({ kind: "program", contextId: core.contextId });
    expect(vertex).toMatchObject({ kind: "shader", contextId: core.contextId });
    expect(Object.isFrozen(program)).toBe(true);
    expect(core.invoke("getAttachedShaders", [program])).toEqual([vertex, fragment]);
    core.invoke("useProgram", [program]);
    expect(core.invoke("getParameter", [GL.CURRENT_PROGRAM])).toBe(program);
    const buffer = core.invoke("createBuffer", []) as BufferHandle;
    core.invoke("bindBuffer", [GL.ARRAY_BUFFER, buffer]);
    const source = new Float32Array([-1, -1, 1, -1, 0, 1]);
    core.invoke("bufferData", [GL.ARRAY_BUFFER, new Uint8Array(source.buffer), GL.DYNAMIC_DRAW]);
    core.invoke("vertexAttribPointer", [0, 2, GL.FLOAT, false, 0, 0]);
    core.invoke("enableVertexAttribArray", [0]);
    expect(core.invoke("getParameter", [GL.ARRAY_BUFFER_BINDING])).toBe(buffer);
    expect(core.invoke("getVertexAttrib", [0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING])).toBe(buffer);
    const location = core.invoke("getUniformLocation", [program, "u_color"]) as UniformLocationHandle;
    expect(location).toMatchObject({ kind: "uniform-location", contextId: core.contextId });
    core.invoke("uniform4f", [location, 1, 0, 0, 1]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const earlier = host.draw.mock.calls[0]![0];
    core.bufferSubData(GL.ARRAY_BUFFER, 0, new Uint8Array(new Float32Array([0, 0]).buffer));
    core.invoke("uniform4f", [location, 0, 1, 0, 1]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    expect(Array.from(new Float32Array(earlier.vertexUniforms.buffer))).toEqual([1, 0, 0, 1]);
    expect(Array.from(new Float32Array(earlier.attributes[0]!.data!.buffer))).toEqual([-1, -1, 1, -1, 0, 1]);
    expect(core.invoke("getUniform", [program, location])).toEqual(new Float32Array([0, 1, 0, 1]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("rejects foreign, wrong-kind, and malformed handles without aliasing another object", () => {
    const { core } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    const foreign = createLinkedProgram(createContext().core).program;
    core.invoke("useProgram", [program]);
    core.invoke("useProgram", [foreign]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("shaderSource", [program, "wrong kind"]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("useProgram", [{ ...program, generation: program.generation + 1 }]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getParameter", [GL.CURRENT_PROGRAM])).toBe(program);
    expect(core.invoke("isShader", [program])).toBe(false);
    expect(core.invoke("isProgram", [vertex])).toBe(false);
    expect(core.invoke("isProgram", [foreign])).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("retires locations on relink and preserves failed-current-program validation", () => {
    const { core, host } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    core.invoke("useProgram", [program]);
    const old = core.invoke("getUniformLocation", [program, "u_color"]) as UniformLocationHandle;
    core.invoke("uniform4f", [old, 1, 0, 0, 1]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    core.invoke("linkProgram", [program]);
    const fresh = core.invoke("getUniformLocation", [program, "u_color"]) as UniformLocationHandle;
    expect(fresh.slot).toBe(old.slot);
    expect(fresh.generation).toBe(old.generation + 1);
    expect(core.invoke("getUniform", [program, fresh])).toEqual(new Float32Array(4));
    core.invoke("uniform4f", [old, 1, 1, 1, 1]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("shaderSource", [vertex, "compile-failure"]);
    core.invoke("compileShader", [vertex]);
    core.invoke("linkProgram", [program]);
    core.invoke("uniform4f", [fresh, 1, 1, 1, 1]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(host.draw).toHaveBeenCalledTimes(1);
    core.invoke("uniformMatrix4fv", [null, true, new Float32Array(0)]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("keeps deleted attached shaders live until detach and makes old deletion harmless after slot reuse", () => {
    const { core } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    core.invoke("deleteShader", [vertex]);
    expect(core.invoke("isShader", [vertex])).toBe(true);
    expect(core.invoke("getAttachedShaders", [program])).toContain(vertex);
    core.invoke("detachShader", [program, vertex]);
    expect(core.invoke("isShader", [vertex])).toBe(false);
    const replacement = core.invoke("createProgram", []) as ProgramHandle;
    expect(replacement.slot).toBe(vertex.slot);
    expect(replacement.generation).toBe(vertex.generation + 1);
    core.invoke("deleteShader", [vertex]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.invoke("isProgram", [replacement])).toBe(true);
    core.invoke("shaderSource", [vertex, "stale"]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
  });

  it("allows source, compilation, and attachment commands while a deleted shader remains retained", () => {
    const { core } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    const peer = core.invoke("createProgram", []) as ProgramHandle;
    core.invoke("deleteShader", [vertex]);
    expect(core.invoke("getShaderParameter", [vertex, GL.DELETE_STATUS])).toBe(true);
    core.invoke("shaderSource", [vertex, "recompiled retained shader"]);
    expect(core.invoke("getShaderSource", [vertex])).toBe("recompiled retained shader");
    core.invoke("compileShader", [vertex]);
    expect(core.invoke("getShaderParameter", [vertex, GL.COMPILE_STATUS])).toBe(true);
    core.invoke("attachShader", [peer, vertex]);
    expect(core.invoke("getAttachedShaders", [peer])).toEqual([vertex]);
    core.invoke("detachShader", [program, vertex]);
    expect(core.invoke("isShader", [vertex])).toBe(true);
    core.invoke("detachShader", [peer, vertex]);
    expect(core.invoke("isShader", [vertex])).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.invoke("getShaderParameter", [vertex, GL.DELETE_STATUS])).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
  });

  it("allows current deleted program queries and relinking while rejecting a new useProgram call", () => {
    const { core, host } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    core.invoke("useProgram", [program]);
    const old = core.invoke("getUniformLocation", [program, "u_color"]);
    core.invoke("deleteProgram", [program]);
    core.invoke("useProgram", [program]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.invoke("getUniform", [program, old])).toEqual(new Float32Array(4));
    expect(core.invoke("getAttribLocation", [program, "a_position"])).toBe(0);
    expect(core.invoke("getUniformLocation", [program, "u_color"])).not.toBeNull();
    core.invoke("bindAttribLocation", [program, 0, "a_position"]);
    core.invoke("detachShader", [program, vertex]);
    core.invoke("attachShader", [program, vertex]);
    core.invoke("linkProgram", [program]);
    expect(core.invoke("getProgramParameter", [program, GL.LINK_STATUS])).toBe(true);
    expect(core.invoke("getProgramParameter", [program, GL.DELETE_STATUS])).toBe(true);
    const fresh = core.invoke("getUniformLocation", [program, "u_color"]);
    core.invoke("uniform4f", [fresh, 0, 1, 0, 1]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    expect(host.draw).toHaveBeenCalledTimes(1);
    expect(core.invoke("getParameter", [GL.CURRENT_PROGRAM])).toBe(program);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.invoke("uniform4f", [old, 1, 1, 1, 1]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("useProgram", [null]);
    expect(core.invoke("isProgram", [program])).toBe(false);
    expect(core.invoke("getProgramParameter", [program, GL.DELETE_STATUS])).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.invoke("getUniformLocation", [program, "u_color"])).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.invoke("useProgram", [program]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.invoke("deleteProgram", [program]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("releases artifacts on replacement and final retention release while keeping queued draw data", () => {
    const { core, host, release, dispose } = createContext();
    const { program, vertex, fragment } = createLinkedProgram(core);
    core.invoke("useProgram", [program]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    const earlier = host.draw.mock.calls[0]![0];
    core.invoke("shaderSource", [vertex, "replacement"]);
    core.invoke("compileShader", [vertex]);
    core.invoke("linkProgram", [program]);
    core.invoke("shaderSource", [vertex, "compile-failure"]);
    core.invoke("compileShader", [vertex]);
    core.invoke("linkProgram", [program]);
    expect(release.mock.calls.flatMap(([ids]) => ids)).toEqual([1, 3, 4, 7]);
    core.invoke("deleteShader", [vertex]);
    core.invoke("deleteShader", [fragment]);
    core.invoke("deleteProgram", [program]);
    expect(core.invoke("isProgram", [program])).toBe(true);
    expect(release.mock.calls.flatMap(([ids]) => ids)).toEqual([1, 3, 4, 7]);
    core.invoke("useProgram", [null]);
    expect(core.invoke("isProgram", [program])).toBe(false);
    expect(core.invoke("isShader", [vertex])).toBe(false);
    expect(release.mock.calls.flatMap(([ids]) => ids)).toEqual([1, 3, 4, 7, 5, 6, 2]);
    expect(earlier.program.vertexWGSL).toBe("vertex-1");
    expect(earlier.program.uniforms[0]!.name).toBe("u_color");
    core.dispose();
    core.dispose();
    const released = release.mock.calls.flatMap(([ids]) => ids);
    expect(new Set(released).size).toBe(7);
    expect(released).toHaveLength(7);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("preserves deleted-current drawing until unbinding and releases all remaining resources on disposal", () => {
    const { core, host, release } = createContext();
    const { program } = createLinkedProgram(core);
    core.invoke("useProgram", [program]);
    const location = core.invoke("getUniformLocation", [program, "u_color"]);
    core.invoke("deleteProgram", [program]);
    core.invoke("uniform4f", [location, 0, 0, 1, 1]);
    core.invoke("drawArrays", [GL.TRIANGLES, 0, 3]);
    expect(host.draw).toHaveBeenCalledTimes(1);
    expect(core.invoke("getParameter", [GL.CURRENT_PROGRAM])).toBe(program);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.dispose();
    expect(release.mock.calls.flatMap(([ids]) => ids).sort()).toEqual([1, 2, 3]);
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.invoke("createShader", [GL.VERTEX_SHADER])).toBeNull();
    expect(core.invoke("createProgram", [])).toBeNull();
    expect(core.createBuffer()).toBeNull();
    expect(core.invoke("drawingBufferWidth", [])).toBe(0);
    core.invoke("compileShader", [program]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("preserves source code units and existing JS texture/framebuffer operations", () => {
    const { core } = createContext();
    const shader = core.invoke("createShader", [GL.VERTEX_SHADER]);
    const source = "// \ud800\0 shader\n";
    core.invoke("shaderSource", [shader, source]);
    expect(core.invoke("getShaderSource", [shader])).toBe(source);
    const texture = core.invoke("createTexture", []);
    const framebuffer = core.invoke("createFramebuffer", []);
    core.invoke("bindTexture", [GL.TEXTURE_2D, texture]);
    core.invoke("texImage2D", [GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
    core.invoke("bindFramebuffer", [GL.FRAMEBUFFER, framebuffer]);
    core.invoke("framebufferTexture2D", [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0]);
    expect(core.invoke("checkFramebufferStatus", [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_COMPLETE);
    expect(core.captureTarget()).toMatchObject({ width: 2, height: 2, isDefault: false });
    core.invoke("clear", [GL.COLOR_BUFFER_BIT]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});
