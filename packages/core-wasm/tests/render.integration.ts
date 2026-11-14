import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GL } from '@refral/core-api';
import type {
  CompiledShader,
  CompilerRegistry,
  DrawingCore,
  DrawOperation,
  LinkedProgram,
  LogicalHandle,
  SemanticHost,
} from '@refral/core-api';
import { createRustDrawingCoreFromModule } from '../src/render';
import { runBufferCoreContract } from '../../../tests/core/buffer-contract';

let module: WebAssembly.Module;
beforeAll(async () => {
  module = await WebAssembly.compile(
      await readFile(new URL('../../../artifacts/core-wasm/refral_core.wasm', import.meta.url)),
  );
});

function setup(contextId = 1, maxBufferBytes = 1024 * 1024) {
  let nextId = 1;
  let linkSuccess = true;
  const executables = new Map<number, LinkedProgram>();
  const compile = vi.fn((source: string, stage: 'vertex' | 'fragment') => {
    const result: CompiledShader = {
      source,
      stage,
      version: 1,
      success: true,
      log: '',
      wgsl: '',
      attributes: [],
      uniforms: [],
      varyings: [],
      outputs: [],
      uniformBufferSize: 0,
    };
    return { artifactId: nextId++, result };
  });
  const compiler: CompilerRegistry = {
    compile,
    link() {
      const artifactId = nextId++;
      const result: LinkedProgram = {
        success: linkSuccess,
        log: linkSuccess ? '' : 'link failure',
        vertexWGSL: '',
        fragmentWGSL: '',
        vertexEntryPoint: 'main',
        fragmentEntryPoint: 'main',
        attributes: [{ name: 'a_position', type: GL.FLOAT_VEC2, size: 1, location: 0 }],
        uniforms: [
          {
            name: 'u_color',
            type: GL.FLOAT_VEC4,
            size: 1,
            vertexOffset: null,
            fragmentOffset: 0,
            arrayStride: 0,
            matrixStride: 0,
          },
        ],
        samplers: [],
        vertexUniformBufferSize: 0,
        fragmentUniformBufferSize: 16,
        driverUniformBufferSize: 32,
      };
      executables.set(artifactId, result);
      return { artifactId, result };
    },
    executable(id) {
      const value = executables.get(id);
      if (!value) throw new Error(`missing artifact ${id}`);
      return value;
    },
    release(ids) {
      for (const id of ids) executables.delete(id);
    },
    dispose() {
      executables.clear();
    },
  };
  const draws: DrawOperation[] = [];
  const host: SemanticHost = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: maxBufferBytes },
    draw: vi.fn((draw) => {
      draws.push(draw);
    }),
    clear: vi.fn(),
    flush: vi.fn(),
    replaceStorage: vi.fn(),
    retireStorage: vi.fn(),
    retireDepth: vi.fn(),
  };
  const core = createRustDrawingCoreFromModule(
    module,
    {
      contextId,
      maxBufferBytes,
      surface: { width: 16, height: 16 },
      attributes: { alpha: true, depth: true },
      profile: {
        vertexAttributes: 8,
        vertexUniformVectors: 128,
        fragmentUniformVectors: 64,
        varyingVectors: 8,
        vertexTextureUnits: 8,
        fragmentTextureUnits: 8,
        combinedTextureUnits: 8,
      },
    },
    { compiler, host },
  );
  return {
    core,
    host,
    draws,
    compile,
    failLink: () => {
      linkSuccess = false;
    },
    succeedLink: () => {
      linkSuccess = true;
    },
  };
}
function scene(core: DrawingCore) {
  const vertex = core.invoke('createShader', [GL.VERTEX_SHADER]) as LogicalHandle;
  const fragment = core.invoke('createShader', [GL.FRAGMENT_SHADER]) as LogicalHandle;
  core.invoke('compileShader', [vertex]);
  core.invoke('compileShader', [fragment]);
  const program = core.invoke('createProgram', []) as LogicalHandle;
  core.invoke('attachShader', [program, vertex]);
  core.invoke('attachShader', [program, fragment]);
  core.invoke('linkProgram', [program]);
  core.invoke('useProgram', [program]);
  const location = core.invoke('getUniformLocation', [program, 'u_color']) as LogicalHandle;
  const buffer = core.createBuffer()!;
  core.bindBuffer(GL.ARRAY_BUFFER, buffer);
  core.bufferData(GL.ARRAY_BUFFER, new Uint8Array(24), GL.STATIC_DRAW);
  core.invoke('vertexAttribPointer', [0, 2, GL.FLOAT, false, 0, 0]);
  core.invoke('enableVertexAttribArray', [0]);
  return { vertex, fragment, program, location, buffer };
}
describe('actual Rust drawing Wasm v2', () => {
  it('preserves the complete shared Buffer contract in the rendering context', async () => {
    const result = await runBufferCoreContract(
      (options) => setup(options.contextId, options.maxBufferBytes).core,
    );
    expect(result.evidence.checks.filter((check) => !check.passed)).toEqual([]);
  });
  it('roundtrips UTF16 source and names, including lone surrogate code units', () => {
    const { core, compile } = setup();
    try {
      const shader = core.invoke('createShader', [GL.VERTEX_SHADER]);
      const source = '\ud800\0// 中文\udfff';
      core.invoke('shaderSource', [shader, source]);
      expect(core.invoke('getShaderSource', [shader])).toBe(source);
      core.invoke('compileShader', [shader]);
      expect(compile).toHaveBeenCalledWith(source, 'vertex');
      const program = core.invoke('createProgram', []);
      core.invoke('bindAttribLocation', [program, 0, '\ud800']);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      core.invoke('getShaderSource', [program]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
    } finally {
      core.dispose();
    }
  });
  it('keeps owned Buffer and uniform snapshots through updates and failed/successful relinking', () => {
    const state = setup();
    const { core } = state;
    try {
      const { program, fragment, location } = scene(core);
      core.invoke('uniform4fv', [location, new Float32Array([1, 0, 0, 1])]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      core.bufferSubData(GL.ARRAY_BUFFER, 0, new Uint8Array([9, 8]));
      core.invoke('uniform4f', [location, 0, 1, 0, 1]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws).toHaveLength(2);
      expect(Array.from(state.draws[0].attributes[0].data!.slice(0, 2))).toEqual([0, 0]);
      expect(Array.from(state.draws[1].attributes[0].data!.slice(0, 2))).toEqual([9, 8]);
      expect(
        new DataView(
          state.draws[0].fragmentUniforms.buffer,
          state.draws[0].fragmentUniforms.byteOffset,
        ).getFloat32(0, true),
      ).toBe(1);
      core.invoke('shaderSource', [fragment, 'modified']);
      core.invoke('compileShader', [fragment]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws).toHaveLength(3);
      state.failLink();
      core.invoke('linkProgram', [program]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.invoke('uniform4f', [location, 1, 1, 1, 1]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      state.succeedLink();
      core.invoke('linkProgram', [program]);
      const fresh = core.invoke('getUniformLocation', [program, 'u_color']);
      expect(Array.from(core.invoke('getUniform', [program, fresh]) as Float32Array)).toEqual([0, 0, 0, 0]);
      core.invoke('uniform4f', [location, 1, 1, 1, 1]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
    } finally {
      core.dispose();
    }
  });
  it('transports unrestricted float values and supports every null uniform entrypoint', () => {
    const { core } = setup();
    try {
      const { program, location } = scene(core);
      core.invoke('uniform4f', [location, NaN, Infinity, -Infinity, 1]);
      const values = core.invoke('getUniform', [program, location]) as Float32Array;
      expect(Number.isNaN(values[0])).toBe(true);
      expect(Array.from(values.slice(1))).toEqual([Infinity, -Infinity, 1]);
      for (const op of [
        'uniform1f',
        'uniform2f',
        'uniform3f',
        'uniform4f',
        'uniform1fv',
        'uniform2fv',
        'uniform3fv',
        'uniform4fv',
        'uniform1i',
        'uniform2i',
        'uniform3i',
        'uniform4i',
        'uniform1iv',
        'uniform2iv',
        'uniform3iv',
        'uniform4iv',
        'uniformMatrix2fv',
        'uniformMatrix3fv',
        'uniformMatrix4fv',
      ]) {
        expect(core.invoke(op, [null, new Float32Array([1])])).toBeUndefined();
        expect(core.getError()).toBe(GL.NO_ERROR);
      }
      core.invoke('uniform4fv', [location, [1, 2, 3]]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
    } finally {
      core.dispose();
    }
  });
  it('decodes clear/indexed draws and validates precision and attribute limits', async () => {
    const { core, host, draws } = setup();
    try {
      scene(core);
      core.invoke('viewport', [1, 2, 3, 4]);
      core.invoke('clearColor', [0.1, 0.2, 0.3, 1]);
      core.invoke('clear', [GL.COLOR_BUFFER_BIT]);
      expect(host.clear).toHaveBeenCalledTimes(1);
      expect(Array.from(core.invoke('getParameter', [GL.VIEWPORT]) as Int32Array)).toEqual([1, 2, 3, 4]);
      const indices = core.createBuffer()!;
      core.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, indices);
      core.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2]), GL.STATIC_DRAW);
      core.invoke('drawElements', [GL.TRIANGLES, 3, GL.UNSIGNED_BYTE, 0]);
      expect(draws).toHaveLength(1);
      expect(Array.from(draws[0].indices!.data)).toEqual([0, 1, 2]);
      expect(core.invoke('getShaderPrecisionFormat', [GL.VERTEX_SHADER, GL.HIGH_FLOAT])).toEqual({
        rangeMin: 127,
        rangeMax: 127,
        precision: 23,
      });
      core.invoke('getShaderPrecisionFormat', [0, GL.HIGH_FLOAT]);
      expect(core.getError()).toBe(GL.INVALID_ENUM);
      core.invoke('enableVertexAttribArray', [8]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      core.invoke('vertexAttrib4f', [0, 1, 2, 3, 4]);
      core.invoke('vertexAttrib4fv', [0, [9, 8, 7]]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      expect(Array.from(core.invoke('getVertexAttrib', [0, GL.CURRENT_VERTEX_ATTRIB]) as Float32Array)).toEqual([1, 2, 3, 4]);
      core.bindBuffer(GL.ARRAY_BUFFER, null);
      core.invoke('vertexAttribPointer', [0, 2, GL.FLOAT, false, 0, 0]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(core.invoke('getVertexAttrib', [0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING])).toBeNull();
      await Promise.resolve();
      expect(host.flush).toHaveBeenCalledTimes(1);
    } finally {
      core.dispose();
    }
  });
});
