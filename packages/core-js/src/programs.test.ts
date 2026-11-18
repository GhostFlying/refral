import { describe, expect, it, vi } from "vitest";
import type { CompiledShader, Compiler, LinkedProgram } from "@refral/compiler";
import { GL, SemanticContext } from "./index.js";
import type { SemanticHost } from "./context.js";

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(),
    clear: vi.fn<SemanticHost["clear"]>(),
    flush: vi.fn<SemanticHost["flush"]>(), finish: vi.fn<SemanticHost["finish"]>(),
    replaceStorage: vi.fn<SemanticHost["replaceStorage"]>(),
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(),
    retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  let nextExecutable = 1;
  const compiler: Compiler = {
    compile(source, stage): CompiledShader {
      return {
        source, stage, version: 1, success: !source.includes("compile-failure"),
        log: source.includes("compile-failure") ? "Compile failed." : "",
        wgsl: "", attributes: [], uniforms: [], varyings: [], outputs: [], uniformBufferSize: 32,
      };
    },
    link(vertex, fragment): LinkedProgram {
      const success = vertex.success && fragment.success && !vertex.source.includes("link-failure");
      return {
        success, log: success ? "" : "Link failed.",
        vertexWGSL: `vertex-${nextExecutable++}`, fragmentWGSL: "fragment",
        vertexEntryPoint: "main", fragmentEntryPoint: "main", attributes: [],
        uniforms: [
          { name: "u_value", type: GL.FLOAT, size: 1, vertexOffset: 0, fragmentOffset: 0, arrayStride: 0, matrixStride: 0 },
          { name: "u_color", type: GL.FLOAT_VEC4, size: 1, vertexOffset: 16, fragmentOffset: 16, arrayStride: 0, matrixStride: 0 },
        ],
        samplers: [{ name: "u_texture", type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
        vertexUniformBufferSize: 32, fragmentUniformBufferSize: 32, driverUniformBufferSize: 32,
      };
    },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return { core, host };
}

function createLinkedProgram(core: SemanticContext) {
  const vertex = core.createShader(GL.VERTEX_SHADER)!;
  const fragment = core.createShader(GL.FRAGMENT_SHADER)!;
  core.shaderSource(vertex, "vertex");
  core.shaderSource(fragment, "fragment");
  core.compileShader(vertex);
  core.compileShader(fragment);
  const program = core.createProgram()!;
  core.attachShader(program, vertex);
  core.attachShader(program, fragment);
  core.linkProgram(program);
  return { program, vertex, fragment };
}

function firstUniform(data: Uint8Array): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(0, true);
}

describe("JS installed program executable", () => {
  it.each(["compile-failure", "link-failure", "missing-stage"])(
    "invalidates the current program after a %s relink",
    (failure) => {
      const { core, host } = createContext();
      const { program, vertex, fragment } = createLinkedProgram(core);
      core.useProgram(program);
      const location = core.getUniformLocation(program, "u_value")!;
      core.uniform1f(location, 0.5);
      core.drawArrays(GL.TRIANGLES, 0, 3);
      const earlierDraw = host.draw.mock.calls[0]![0];

      if (failure === "missing-stage") core.detachShader(program, fragment);
      else {
        core.shaderSource(vertex, failure);
        core.compileShader(vertex);
      }
      core.linkProgram(program);

      expect(core.getProgramParameter(program, GL.LINK_STATUS)).toBe(false);
      expect(core.getParameter(GL.CURRENT_PROGRAM)).toBe(program);
      expect(core.getProgramInfoLog(program)).not.toBe("");
      expect(core.getError()).toBe(GL.NO_ERROR);
      core.uniform1f(location, 1);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(core.getUniform(program, location)).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(core.getUniformLocation(program, "u_value")).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.drawArrays(GL.TRIANGLES, 0, 3);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.drawArrays(GL.TRIANGLES, 0, 0);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      const indices = core.createBuffer()!;
      core.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, indices);
      core.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2]), GL.STATIC_DRAW);
      core.drawElements(GL.TRIANGLES, 3, GL.UNSIGNED_BYTE, 0);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.uniform1f(null, 1);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(host.draw).toHaveBeenCalledTimes(1);
      expect(firstUniform(earlierDraw.vertexUniforms)).toBe(0.5);

      if (failure === "missing-stage") core.attachShader(program, fragment);
      else {
        core.shaderSource(vertex, "repaired vertex");
        core.compileShader(vertex);
      }
      core.linkProgram(program);
      const repairedLocation = core.getUniformLocation(program, "u_value")!;
      expect(core.getUniform(program, repairedLocation)).toBe(0);
      core.drawArrays(GL.TRIANGLES, 0, 3);
      expect(host.draw).toHaveBeenCalledTimes(2);
      expect(core.getError()).toBe(GL.NO_ERROR);
    },
  );

  it("keeps the installed executable through source, compilation, and attachment changes", () => {
    const { core, host } = createContext();
    const { program, vertex, fragment } = createLinkedProgram(core);
    core.useProgram(program);
    const location = core.getUniformLocation(program, "u_value")!;
    core.uniform1f(location, 0.25);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const installed = host.draw.mock.calls[0]![0].program;

    core.shaderSource(vertex, "compile-failure");
    core.uniform1f(location, 0.5);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    core.compileShader(vertex);
    expect(core.getShaderParameter(vertex, GL.COMPILE_STATUS)).toBe(false);
    core.uniform1f(location, 0.75);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    core.detachShader(program, fragment);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    core.attachShader(program, fragment);
    core.drawArrays(GL.TRIANGLES, 0, 3);

    expect(core.getProgramParameter(program, GL.LINK_STATUS)).toBe(true);
    expect(core.getUniform(program, location)).toBe(0.75);
    expect(host.draw.mock.calls.map(([draw]) => draw.program)).toEqual(Array(5).fill(installed));
    expect(host.draw.mock.calls.map(([draw]) => firstUniform(draw.vertexUniforms))).toEqual([0.25, 0.5, 0.75, 0.75, 0.75]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("resets successful relink uniforms and rejects old locations without changing queued draws", () => {
    const { core, host } = createContext();
    const { program } = createLinkedProgram(core);
    core.useProgram(program);
    const oldLocation = core.getUniformLocation(program, "u_value")!;
    const oldSampler = core.getUniformLocation(program, "u_texture")!;
    core.uniform1f(oldLocation, 0.75);
    core.uniform1i(oldSampler, 2);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const earlierDraw = host.draw.mock.calls[0]![0];

    core.linkProgram(program);
    const location = core.getUniformLocation(program, "u_value")!;
    const sampler = core.getUniformLocation(program, "u_texture")!;
    expect(core.getUniform(program, location)).toBe(0);
    expect(core.getUniform(program, sampler)).toBe(0);
    core.uniform1f(oldLocation, 1);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(program, oldLocation)).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const relinkedDraw = host.draw.mock.calls[1]![0];
    expect(relinkedDraw.program).not.toBe(earlierDraw.program);
    expect(firstUniform(relinkedDraw.vertexUniforms)).toBe(0);
    expect(firstUniform(earlierDraw.vertexUniforms)).toBe(0.75);
    core.uniform1f(location, 0.25);
    expect(core.getUniform(program, location)).toBe(0.25);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("keeps a valid current program after rejecting a failed program selection", () => {
    const { core, host } = createContext();
    const { program } = createLinkedProgram(core);
    const failed = core.createProgram()!;
    core.linkProgram(failed);
    core.useProgram(program);
    core.useProgram(failed);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getParameter(GL.CURRENT_PROGRAM)).toBe(program);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    expect(host.draw).toHaveBeenCalledTimes(1);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});

describe("JS program validation and reference lifetime", () => {
  it.each([2, 3, 4])("ignores null matrix%d locations before transpose and length validation", (dimension) => {
    const { core } = createContext();
    const method = `uniformMatrix${dimension}fv`;
    core.invoke(method, [null, true, new Float32Array([1])]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.invoke(method, [null, false, new Float32Array(0)]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    const { program } = createLinkedProgram(core);
    core.useProgram(program);
    const location = core.getUniformLocation(program, "u_color")!;
    core.invoke(method, [location, true, new Float32Array([1])]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
  });

  it("records validation separately from linking and resets it on every link", () => {
    const { core } = createContext();
    const empty = core.createProgram()!;
    expect(core.getProgramParameter(empty, GL.VALIDATE_STATUS)).toBe(false);
    core.validateProgram(empty);
    expect(core.getProgramParameter(empty, GL.VALIDATE_STATUS)).toBe(false);
    const { program, vertex } = createLinkedProgram(core);
    expect(core.getProgramParameter(program, GL.LINK_STATUS)).toBe(true);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(false);
    core.validateProgram(program);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(true);
    core.linkProgram(program);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(false);
    core.validateProgram(program);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(true);
    core.shaderSource(vertex, "compile-failure");
    core.compileShader(vertex);
    core.linkProgram(program);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(false);
    core.validateProgram(program);
    expect(core.getProgramParameter(program, GL.VALIDATE_STATUS)).toBe(false);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("retains deleted current programs and attached shaders until the final current reference is released", () => {
    const { core, host } = createContext();
    const { program, vertex } = createLinkedProgram(core);
    core.useProgram(program);
    const location = core.getUniformLocation(program, "u_value")!;
    core.deleteShader(vertex);
    expect(core.getShaderParameter(vertex, GL.DELETE_STATUS)).toBe(true);
    expect(core.isShader(vertex)).toBe(true);
    core.deleteProgram(program);
    expect(core.getProgramParameter(program, GL.DELETE_STATUS)).toBe(true);
    expect(core.isProgram(program)).toBe(true);
    core.uniform1f(location, 0.5);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const earlierDraw = host.draw.mock.calls[0]![0];
    expect(firstUniform(earlierDraw.vertexUniforms)).toBe(0.5);
    core.useProgram(null);
    expect(core.isProgram(program)).toBe(false);
    expect(core.isShader(vertex)).toBe(false);
    expect(earlierDraw.program.uniforms).toHaveLength(2);
    expect(firstUniform(earlierDraw.vertexUniforms)).toBe(0.5);
    core.deleteProgram(program);
    core.deleteShader(vertex);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("rejects locations owned by another program or context while preserving uniform values", () => {
    const { core } = createContext();
    const first = createLinkedProgram(core).program;
    const second = createLinkedProgram(core).program;
    const foreignCore = createContext().core;
    const foreign = createLinkedProgram(foreignCore).program;
    const location = core.getUniformLocation(first, "u_value")!;
    const wrongProgram = core.getUniformLocation(second, "u_value")!;
    const foreignLocation = foreignCore.getUniformLocation(foreign, "u_value")!;
    core.useProgram(first);
    core.uniform1f(location, 0.5);
    core.uniform1f(wrongProgram, 1);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.uniform1f(foreignLocation, 1);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(second, location)).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(first, foreignLocation)).toBeNull();
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(first, location)).toBe(0.5);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("reports invalid vector lengths as INVALID_VALUE and leaves the stored uniform unchanged", () => {
    const { core } = createContext();
    const { program } = createLinkedProgram(core);
    core.useProgram(program);
    const location = core.getUniformLocation(program, "u_color")!;
    core.uniform4fv(location, new Float32Array([1, 0.5, 0.25, 1]));
    core.uniform4fv(location, new Float32Array(0));
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.uniform4fv(location, new Float32Array([1, 2, 3]));
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.uniform4fv(location, new Float32Array([1, 2, 3, 4, 5]));
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.getUniform(program, location)).toEqual(new Float32Array([1, 0.5, 0.25, 1]));
    core.uniform3fv(location, new Float32Array([1, 2, 3]));
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
  });
});
