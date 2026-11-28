import { describe, expect, it, vi } from "vitest";
import { GL, SemanticContext } from "./index.js";
import type { Compiler, ProgramUniform, SemanticHost } from "@refral/core-api";

const uniforms: ProgramUniform[] = [
  { name: "u_values", type: GL.FLOAT_VEC2, size: 2, vertexOffset: 0, fragmentOffset: 0, arrayStride: 16, matrixStride: 0 },
  { name: "u_single", type: GL.FLOAT, size: 1, vertexOffset: 32, fragmentOffset: 32, arrayStride: 0, matrixStride: 0 },
  { name: "u_one", type: GL.FLOAT, size: 1, vertexOffset: 48, fragmentOffset: 48, arrayStride: 16, matrixStride: 0 },
  { name: "u_matrix", type: GL.FLOAT_MAT3, size: 2, vertexOffset: 64, fragmentOffset: 64, arrayStride: 48, matrixStride: 16 },
  { name: "u_integer", type: GL.INT_VEC4, size: 1, vertexOffset: 160, fragmentOffset: 160, arrayStride: 0, matrixStride: 0 },
  { name: "u_bool", type: GL.BOOL_VEC4, size: 1, vertexOffset: 176, fragmentOffset: 176, arrayStride: 0, matrixStride: 0 },
];

function createContext() {
  const host = {
    limits: { maxTextureDimension2D: 4096 },
    draw: vi.fn<SemanticHost["draw"]>(), clear() {}, flush() {}, finish() {}, replaceStorage() {}, retireStorage() {}, retireDepth() {},
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile(source, stage) {
      return { source, stage, success: true, log: "", version: 1, wgsl: "", attributes: [], uniforms: [],
        varyings: [], outputs: [], uniformBufferSize: 192 };
    },
    link() {
      return { success: true, log: "", vertexWGSL: "", fragmentWGSL: "", vertexEntryPoint: "main", fragmentEntryPoint: "main",
        attributes: [], uniforms, samplers: [{ name: "u_texture", type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
        vertexUniformBufferSize: 192, fragmentUniformBufferSize: 192, driverUniformBufferSize: 32 };
    },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  function createProgram() {
    const program = core.createProgram()!;
    for (const type of [GL.VERTEX_SHADER, GL.FRAGMENT_SHADER]) {
      const shader = core.createShader(type)!;
      core.shaderSource(shader, "shader");
      core.compileShader(shader);
      core.attachShader(program, shader);
    }
    core.linkProgram(program);
    return program;
  }
  const program = createProgram();
  core.useProgram(program);
  return { core, host, program, createProgram };
}

describe("JS typed uniform semantics", () => {
  it("ignores complete excess array elements from a base or nonzero element location", () => {
    const { core, program } = createContext();
    const base = core.getUniformLocation(program, "u_values")!;
    core.uniform2fv(base, new Float32Array([1, 2, 3, 4, 5, 6]));
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.getUniform(program, base)).toEqual(new Float32Array([1, 2]));
    const second = core.getUniformLocation(program, "u_values[1]")!;
    expect(core.getUniform(program, second)).toEqual(new Float32Array([3, 4]));
    core.uniform2fv(second, new Float32Array([7, 8, 9, 10]));
    expect(core.getUniform(program, second)).toEqual(new Float32Array([7, 8]));
    expect(core.getUniform(program, base)).toEqual(new Float32Array([1, 2]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("distinguishes an array of length one by its reflected stride", () => {
    const { core, program } = createContext();
    const array = core.getUniformLocation(program, "u_one")!;
    core.uniform1fv(array, new Float32Array([3, 4]));
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(core.getUniform(program, array)).toBe(3);
    expect(core.getActiveUniform(program, 2)).toEqual({ name: "u_one[0]", type: GL.FLOAT, size: 1 });
    const scalar = core.getUniformLocation(program, "u_single")!;
    core.uniform1fv(scalar, new Float32Array([8, 9]));
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(program, scalar)).toBe(0);
  });

  it("packs matrix array columns and strides while ignoring excess complete matrices", () => {
    const { core, host, program } = createContext();
    const location = core.getUniformLocation(program, "u_matrix")!;
    const values = new Float32Array(Array.from({ length: 27 }, (_, i) => i + 1));
    core.uniformMatrix3fv(location, false, values);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const bytes = host.draw.mock.calls[0]![0].vertexUniforms;
    const packed = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    expect(Array.from(packed.slice(16, 28))).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
    expect(Array.from(packed.slice(28, 40))).toEqual([10, 11, 12, 0, 13, 14, 15, 0, 16, 17, 18, 0]);
    const second = core.getUniformLocation(program, "u_matrix[1]")!;
    const queried = core.getUniform(program, second) as Float32Array;
    expect(queried).toEqual(values.slice(9, 18));
    queried.fill(0);
    expect(core.getUniform(program, second)).toEqual(values.slice(9, 18));
  });

  it("preserves exact i32 values in queries and execution packing", () => {
    const { core, host, program } = createContext();
    const location = core.getUniformLocation(program, "u_integer")!;
    const values = new Int32Array([-2147483648, 2147483647, 16777217, -1]);
    core.uniform4iv(location, values);
    expect(core.getUniform(program, location)).toEqual(values);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const bytes = host.draw.mock.calls[0]![0].vertexUniforms;
    const packed = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    expect(packed.slice(40, 44)).toEqual(values);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("converts bool float inputs by zero comparison and returns boolean query values", () => {
    const { core, host, program } = createContext();
    const location = core.getUniformLocation(program, "u_bool")!;
    core.uniform4fv(location, new Float32Array([0, -0, NaN, Infinity]));
    expect(core.getUniform(program, location)).toEqual([false, false, true, true]);
    core.drawArrays(GL.TRIANGLES, 0, 3);
    const bytes = host.draw.mock.calls[0]![0].vertexUniforms;
    const packed = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    expect(packed.slice(44, 48)).toEqual(new Int32Array([0, 0, 1, 1]));
    core.uniform4iv(location, new Int32Array([0, -1, 1, 2]));
    expect(core.getUniform(program, location)).toEqual([false, true, true, true]);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("queries a linked non-current program without changing either program's values", () => {
    const { core, program, createProgram } = createContext();
    const first = core.getUniformLocation(program, "u_single")!;
    core.uniform1f(first, 0.25);
    const secondProgram = createProgram();
    const second = core.getUniformLocation(secondProgram, "u_single")!;
    core.useProgram(secondProgram);
    core.uniform1f(second, 0.75);
    expect(core.getUniform(program, first)).toBe(0.25);
    expect(core.getUniform(secondProgram, second)).toBe(0.75);
    expect(core.getParameter(GL.CURRENT_PROGRAM)).toBe(secondProgram);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("validates sampler type and unit range while preserving the previous valid unit", () => {
    const { core, program } = createContext();
    const location = core.getUniformLocation(program, "u_texture")!;
    core.uniform1iv(location, new Int32Array([3]));
    expect(core.getUniform(program, location)).toBe(3);
    core.uniform1i(location, 4);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    core.uniform1fv(location, new Float32Array([1]));
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.uniform1iv(location, new Int32Array([0, 1]));
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getUniform(program, location)).toBe(3);
  });
});
