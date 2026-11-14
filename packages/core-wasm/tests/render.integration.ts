import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GL, ExecutionResources } from '@refral/core-api';
import type {
  CompiledShader,
  CompilerRegistry,
  DrawingCore,
  DrawOperation,
  LinkedProgram,
  LogicalHandle,
  SemanticHost,
  ResourceOperation,
} from '@refral/core-api';
import { createRustDrawingCoreFromModule } from '../src/render';
import { runBufferCoreContract } from '../../../tests/core/buffer-contract';

let module: WebAssembly.Module;
beforeAll(async () => {
  module = await WebAssembly.compile(
    await readFile(
      new URL(
        process.env.REFRAL_WASM_TEST_PATH ?? '../../../artifacts/core-wasm/refral_core.wasm',
        import.meta.url,
      ),
    ),
  );
});

function setup(contextId = 1, maxBufferBytes = 1024 * 1024) {
  let nextId = 1;
  let linkSuccess = true;
  let layout: Partial<LinkedProgram> = {};
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
        ...layout,
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
  const resources = new ExecutionResources(contextId, host);
  const operations: ResourceOperation[] = [];
  const apply = resources.apply.bind(resources);
  vi.spyOn(resources, 'apply').mockImplementation((operation) => {
    operations.push(operation);
    apply(operation);
  });
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
    { compiler, host, resources },
  );
  return {
    core,
    host,
    draws,
    resources,
    operations,
    compile,
    setLayout(value: Partial<LinkedProgram>) {
      layout = value;
    },
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
describe('actual Rust drawing Wasm', () => {
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
      expect(
        Array.from(core.invoke('getVertexAttrib', [0, GL.CURRENT_VERTEX_ATTRIB]) as Float32Array),
      ).toEqual([1, 2, 3, 4]);
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

describe('typed uniform and raster ABI v3', () => {
  it('preserves i32, boolean, matrix/array packing and non-current program queries', () => {
    const state = setup();
    const { core } = state;
    const uniform = (
      name: string,
      type: number,
      size: number,
      offset: number,
      arrayStride = 0,
      matrixStride = 0,
    ) => ({ name, type, size, vertexOffset: offset, fragmentOffset: offset, arrayStride, matrixStride });
    state.setLayout({
      uniforms: [
        uniform('u_int', GL.INT_VEC4, 1, 0),
        uniform('u_bool', GL.BOOL_VEC3, 1, 16),
        uniform('u_matrix', GL.FLOAT_MAT3, 2, 32, 48, 16),
        uniform('u_array', GL.FLOAT_VEC2, 3, 128, 16),
        uniform('u_single', GL.FLOAT, 1, 180, 16),
      ],
      vertexUniformBufferSize: 192,
      fragmentUniformBufferSize: 192,
    });
    try {
      const { program } = scene(core);
      const location = (name: string) => core.invoke('getUniformLocation', [program, name]);
      const integers = new Int32Array([2147483647, -2147483648, 16777217, -16777217]);
      core.invoke('uniform4iv', [location('u_int'), integers]);
      const result = core.invoke('getUniform', [program, location('u_int')]);
      expect(result).toBeInstanceOf(Int32Array);
      expect(Array.from(result as Int32Array)).toEqual(Array.from(integers));
      core.invoke('uniform3fv', [location('u_bool'), new Float32Array([0, NaN, -1])]);
      expect(core.invoke('getUniform', [program, location('u_bool')])).toEqual([false, true, true]);
      core.invoke('uniformMatrix3fv', [
        location('u_matrix'),
        false,
        new Float32Array(Array.from({ length: 18 }, (_, index) => index + 1)),
      ]);
      expect(
        Array.from(core.invoke('getUniform', [program, location('u_matrix[1]')]) as Float32Array),
      ).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
      core.invoke('uniform2fv', [location('u_array'), [1, 2, 3, 4, 5, 6, 7, 8]]);
      core.invoke('uniform1fv', [location('u_single'), [9, 10, 11]]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(core.invoke('getUniform', [program, location('u_single')])).toBe(9);
      expect(core.invoke('getActiveUniform', [program, 4])).toEqual({
        name: 'u_single[0]',
        type: GL.FLOAT,
        size: 1,
      });
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const bytes = state.draws[0].vertexUniforms;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getInt32(8, true)).toBe(16777217);
      expect(view.getFloat32(48, true)).toBe(4);
      expect(view.getFloat32(80, true)).toBe(10);
      expect(view.getFloat32(160, true)).toBe(5);
      expect(Array.from(bytes.slice(44, 48))).toEqual([0, 0, 0, 0]);
      core.invoke('uniformMatrix3fv', [location('u_matrix'), true, new Float32Array(9)]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      core.invoke('useProgram', [null]);
      expect(Array.from(core.invoke('getUniform', [program, location('u_int')]) as Int32Array)).toEqual(
        Array.from(integers),
      );
    } finally {
      core.dispose();
    }
  });
  it('supports scalar bool/sampler queries and rejects invalid sampler units atomically', () => {
    const state = setup();
    const { core } = state;
    state.setLayout({
      uniforms: [
        {
          name: 'u_bool',
          type: GL.BOOL,
          size: 1,
          vertexOffset: 0,
          fragmentOffset: 0,
          arrayStride: 0,
          matrixStride: 0,
        },
      ],
      samplers: [{ name: 'u_texture', type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
      vertexUniformBufferSize: 16,
      fragmentUniformBufferSize: 16,
    });
    try {
      const { program } = scene(core);
      const boolean = core.invoke('getUniformLocation', [program, 'u_bool']);
      const sampler = core.invoke('getUniformLocation', [program, 'u_texture']);
      core.invoke('uniform1f', [boolean, NaN]);
      expect(core.invoke('getUniform', [program, boolean])).toBe(true);
      core.invoke('uniform1iv', [sampler, new Int32Array([7])]);
      expect(core.invoke('getUniform', [program, sampler])).toBe(7);
      core.invoke('uniform1i', [sampler, 8]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      expect(core.invoke('getUniform', [program, sampler])).toBe(7);
    } finally {
      core.dispose();
    }
  });
  it('roundtrips complete raster snapshots and retains state after invalid changes', () => {
    const state = setup();
    const { core } = state;
    try {
      scene(core);
      for (const capability of [GL.BLEND, GL.CULL_FACE, GL.DEPTH_TEST, GL.SCISSOR_TEST])
        core.invoke('enable', [capability]);
      core.invoke('scissor', [-1, 2, 8, 9]);
      core.invoke('colorMask', [true, false, true, false]);
      core.invoke('depthMask', [false]);
      core.invoke('depthFunc', [GL.LEQUAL]);
      core.invoke('depthRange', [-1, 2]);
      core.invoke('blendColor', [0.2, 0.3, 0.4, 0.5]);
      core.invoke('blendFuncSeparate', [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ZERO]);
      core.invoke('blendEquationSeparate', [GL.FUNC_ADD, GL.FUNC_REVERSE_SUBTRACT]);
      core.invoke('frontFace', [GL.CW]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const raster = state.draws[0].state;
      expect(raster).toMatchObject({
        scissor: [-1, 2, 8, 9],
        colorMask: [true, false, true, false],
        depthTest: true,
        depthMask: false,
        depthFunc: GL.LEQUAL,
        depthRange: [0, 1],
        blend: true,
        cull: true,
        frontFace: GL.CW,
        scissorTest: true,
        blendEquationAlpha: GL.FUNC_REVERSE_SUBTRACT,
      });
      expect(core.invoke('getParameter', [GL.COLOR_WRITEMASK])).toEqual([true, false, true, false]);
      core.invoke('viewport', [-2, 3, 99999, 99999]);
      expect(Array.from(core.invoke('getParameter', [GL.VIEWPORT]) as Int32Array)).toEqual([
        -2, 3, 4096, 4096,
      ]);
      core.invoke('viewport', [0, 0, 16, 16]);
      expect(Array.from(core.invoke('getParameter', [GL.SCISSOR_BOX]) as Int32Array)).toEqual([-1, 2, 8, 9]);
      core.invoke('depthRange', [1, 0]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.invoke('blendFuncSeparate', [GL.ONE, GL.ZERO, GL.ONE, GL.SRC_ALPHA_SATURATE]);
      expect(core.getError()).toBe(GL.INVALID_ENUM);
      core.invoke('clear', [GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT]);
      expect(state.host.clear).toHaveBeenCalledWith(
        expect.anything(),
        raster,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      core.dispose();
    }
  });
});

describe('owned texture resource protocol', () => {
  const upload = (bytes: Uint8Array, viewType = 'Uint8Array') => ({ bytes, viewType });
  function define(
    core: DrawingCore,
    width: number,
    height: number,
    format: number,
    data: ReturnType<typeof upload> | null,
  ) {
    core.invoke('texImage2D', [GL.TEXTURE_2D, 0, format, width, height, 0, format, GL.UNSIGNED_BYTE, data]);
  }
  function texture(core: DrawingCore) {
    const value = core.invoke('createTexture', []);
    expect(core.invoke('isTexture', [value])).toBe(false);
    core.invoke('bindTexture', [GL.TEXTURE_2D, value]);
    expect(core.invoke('isTexture', [value])).toBe(true);
    return value;
  }
  function sampled(state: ReturnType<typeof setup>) {
    state.setLayout({
      samplers: [{ name: 'u_texture', type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
    });
    return scene(state.core);
  }
  it('copies five formats, null definitions, view offsets, alignment, flip and premultiply', () => {
    const state = setup();
    const { core } = state;
    try {
      texture(core);
      for (const [format, input, expected] of [
        [GL.RGBA, [10, 20, 30, 40], [10, 20, 30, 40]],
        [GL.RGB, [10, 20, 30], [10, 20, 30, 255]],
        [GL.ALPHA, [40], [0, 0, 0, 40]],
        [GL.LUMINANCE, [10], [10, 10, 10, 255]],
        [GL.LUMINANCE_ALPHA, [10, 40], [10, 10, 10, 40]],
      ] as const) {
        const bytes = new Uint8Array([99, ...input, 88]);
        define(core, 1, 1, format, upload(bytes.subarray(1, 1 + input.length)));
        bytes.fill(0);
        const operation = state.operations.at(-1)!;
        expect(operation.kind).toBe('define-texture');
        if (operation.kind === 'define-texture') expect(Array.from(operation.data)).toEqual(expected);
        define(core, 1, 1, format, null);
        const zero = state.operations.at(-1)!;
        if (zero.kind === 'define-texture')
          expect(Array.from(zero.data)).toEqual([
            0,
            0,
            0,
            format === GL.RGB || format === GL.LUMINANCE ? 255 : 0,
          ]);
      }
      core.invoke('pixelStorei', [GL.UNPACK_FLIP_Y_WEBGL, 1]);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
      define(
        core,
        1,
        2,
        GL.RGBA,
        upload(new Uint8Array([100, 50, 0, 255, 200, 100, 50, 128]), 'Uint8ClampedArray'),
      );
      const flipped = state.operations.at(-1)!;
      if (flipped.kind === 'define-texture')
        expect(Array.from(flipped.data)).toEqual([100, 50, 25, 128, 100, 50, 0, 255]);
      core.invoke('pixelStorei', [GL.UNPACK_FLIP_Y_WEBGL, 0]);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0]);
      define(core, 2, 2, GL.RGB, upload(new Uint8Array([1, 2, 3, 4, 5, 6, 99, 99, 7, 8, 9, 10, 11, 12])));
      const aligned = state.operations.at(-1)!;
      if (aligned.kind === 'define-texture')
        expect(Array.from(aligned.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('samples stable versions across units, updates, reallocations and deletion', () => {
    const state = setup();
    const { core } = state;
    try {
      const { program } = sampled(state);
      const first = texture(core);
      define(core, 1, 1, GL.RGBA, upload(new Uint8Array([255, 0, 0, 255])));
      core.invoke('activeTexture', [GL.TEXTURE0 + 1]);
      const second = texture(core);
      define(core, 1, 1, GL.RGBA, upload(new Uint8Array([0, 0, 255, 255])));
      const sampler = core.invoke('getUniformLocation', [program, 'u_texture']);
      core.invoke('uniform1i', [sampler, 1]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const original = state.draws[0].textures[0].storage!;
      expect(Array.from(original.data!)).toEqual([0, 0, 255, 255]);
      const source = new Uint8Array([0, 255, 0, 255]);
      core.invoke('texSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, upload(source)]);
      source.fill(0);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const updated = state.draws[1].textures[0].storage!;
      expect(Array.from(updated.update!.data)).toEqual([0, 255, 0, 255]);
      expect(updated.parent).toBe(original);
      expect(Array.from(original.data!)).toEqual([0, 0, 255, 255]);
      define(core, 1, 1, GL.RGBA, upload(new Uint8Array([1, 2, 3, 255])));
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const reallocated = state.draws[2].textures[0].storage!;
      expect(reallocated.reference!.storageGeneration).toBe(2);
      core.invoke('deleteTexture', [second]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws[3].textures[0].storage).toBeNull();
      expect(Array.from(reallocated.data!)).toEqual([1, 2, 3, 255]);
      core.invoke('activeTexture', [GL.TEXTURE0]);
      expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_2D])).toEqual(first);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('validates upload types/null and NPOT completeness without resource version changes on failures', () => {
    const state = setup();
    const { core } = state;
    try {
      sampled(state);
      texture(core);
      define(core, 3, 2, GL.LUMINANCE, null);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws[0].textures[0].storage).toBeNull();
      for (const [parameter, value] of [
        [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
        [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
        [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
      ])
        core.invoke('texParameteri', [GL.TEXTURE_2D, parameter, value]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const storage = state.draws[1].textures[0].storage!;
      expect(storage.width).toBe(3);
      expect(storage.height).toBe(2);
      const count = state.operations.length;
      core.invoke('texSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, 1, 1, GL.LUMINANCE, GL.UNSIGNED_BYTE, null]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      define(core, 1, 1, GL.RGBA, upload(new Uint8Array(4), 'Float32Array'));
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(state.operations).toHaveLength(count);
      core.invoke('texSubImage2D', [
        GL.TEXTURE_2D,
        0,
        0,
        0,
        0,
        1,
        GL.LUMINANCE,
        GL.UNSIGNED_BYTE,
        upload(new Uint8Array()),
      ]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(state.operations).toHaveLength(count);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws[2].textures[0].storage).toBe(storage);
    } finally {
      core.dispose();
    }
  });
  it('copies large output arenas before later memory growth and command reuse', () => {
    const state = setup();
    const { core } = state;
    try {
      sampled(state);
      texture(core);
      core.invoke('texParameteri', [GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST]);
      const source = new Uint8Array(512 * 512 * 4).fill(0x55);
      define(core, 512, 512, GL.RGBA, upload(source));
      source.fill(0);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const original = state.draws[0].textures[0].storage!;
      expect(original.data).toHaveLength(512 * 512 * 4);
      expect(original.data![0]).toBe(0x55);
      expect(original.data!.at(-1)).toBe(0x55);
      define(core, 512, 512, GL.RGBA, upload(new Uint8Array(512 * 512 * 4).fill(0x77)));
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws[1].textures[0].storage!.data![0]).toBe(0x77);
      expect(original.data!.at(-1)).toBe(0x55);
    } finally {
      core.dispose();
    }
  });
});
