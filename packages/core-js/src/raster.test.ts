import { describe, expect, it, vi } from "vitest";
import { checkHintAndLineWidth, checkOffsetAndSampleState } from "../../../tests/core/raster-queries.js";
import { GL, SemanticContext } from "./index.js";
import type { Compiler, SemanticHost } from "@refral/core-api";

function createContext() {
  const host = { limits: { maxTextureDimension2D: 4096 }, draw() {},
    clear: vi.fn<SemanticHost["clear"]>(), flush() {}, replaceStorage() {}, retireStorage() {}, retireDepth() {},
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile() { throw new Error("Raster state tests must not compile shaders."); },
    link() { throw new Error("Raster state tests must not link programs."); },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return { core, host };
}

describe("JS raster state semantics", () => {
  it("tracks polygon offset, single-sample coverage and raster precision", () => {
    checkOffsetAndSampleState(createContext().core);
  });
  it("preserves hint and requested line width through invalid mutations", () => {
    checkHintAndLineWidth(createContext().core);
  });
  it("clamps viewport dimensions to advertised limits and preserves state after invalid dimensions", () => {
    const { core } = createContext();
    core.viewport(-10, 20, 4097, 8192);
    expect(core.getParameter(GL.VIEWPORT)).toEqual(new Int32Array([-10, 20, 4096, 4096]));
    expect(core.getParameter(GL.MAX_VIEWPORT_DIMS)).toEqual(new Int32Array([4096, 4096]));
    core.viewport(0, 0, -1, 32);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(core.getParameter(GL.VIEWPORT)).toEqual(new Int32Array([-10, 20, 4096, 4096]));
    core.scissor(-10, 20, 8192, 8192);
    expect(core.getParameter(GL.SCISSOR_BOX)).toEqual(new Int32Array([-10, 20, 8192, 8192]));
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("accepts source saturation in either channel and rejects destination saturation atomically", () => {
    const { core } = createContext();
    core.blendFuncSeparate(GL.SRC_ALPHA_SATURATE, GL.ONE, GL.SRC_ALPHA_SATURATE, GL.ZERO);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.blendFuncSeparate(GL.ONE, GL.SRC_ALPHA_SATURATE, GL.ONE, GL.ZERO);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.blendFuncSeparate(GL.ONE, GL.ZERO, GL.ONE, GL.SRC_ALPHA_SATURATE);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(core.getParameter(GL.BLEND_SRC_RGB)).toBe(GL.SRC_ALPHA_SATURATE);
    expect(core.getParameter(GL.BLEND_DST_RGB)).toBe(GL.ONE);
    expect(core.getParameter(GL.BLEND_SRC_ALPHA)).toBe(GL.SRC_ALPHA_SATURATE);
    expect(core.getParameter(GL.BLEND_DST_ALPHA)).toBe(GL.ZERO);
  });

  it("applies the constant color/alpha conflict rule to the RGB pair", () => {
    const { core } = createContext();
    core.blendFuncSeparate(GL.ONE, GL.ZERO, GL.CONSTANT_COLOR, GL.CONSTANT_ALPHA);
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.blendFuncSeparate(GL.CONSTANT_COLOR, GL.CONSTANT_ALPHA, GL.ONE, GL.ZERO);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getParameter(GL.BLEND_SRC_RGB)).toBe(GL.ONE);
    expect(core.getParameter(GL.BLEND_DST_RGB)).toBe(GL.ZERO);
    expect(core.getParameter(GL.BLEND_SRC_ALPHA)).toBe(GL.CONSTANT_COLOR);
    expect(core.getParameter(GL.BLEND_DST_ALPHA)).toBe(GL.CONSTANT_ALPHA);
  });

  it("retains independent clear-time raster snapshots across later state updates", () => {
    const { core, host } = createContext();
    core.enable(GL.SCISSOR_TEST);
    core.scissor(1, 2, 3, 4);
    core.colorMask(true, false, true, false);
    core.depthMask(false);
    core.depthRange(0.25, 0.75);
    core.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    const first = host.clear.mock.calls[0]![1];
    core.scissor(5, 6, 7, 8);
    core.colorMask(false, true, false, true);
    core.depthMask(true);
    core.depthRange(0, 1);
    expect(first).toMatchObject({ scissorTest: true, scissor: [1, 2, 3, 4], colorMask: [true, false, true, false],
      depthMask: false, depthRange: [0.25, 0.75] });
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});
