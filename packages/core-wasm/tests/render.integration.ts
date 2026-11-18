import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CUBE_FACES, GL, ExecutionResources } from '@refral/core-api';
import type {
  CompiledShader,
  CompilerRegistry,
  DrawingCore,
  DrawOperation,
  LinkedProgram,
  LogicalHandle,
  SemanticHost,
  ResourceOperation,
  ContextAttributes,
  ReadPixelsRequest,
  DomTextureUploadRequest,
  PixelUpload,
} from '@refral/core-api';
import { createRustDrawingCoreFromModule } from '../src/render';
import { checkHintAndLineWidth } from '../../../tests/core/raster-queries';
import { checkPrimitiveDraws } from '../../../tests/core/primitive-draw-contract';
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

function setup(
  contextId = 1,
  maxBufferBytes = 1024 * 1024,
  dimensionLimit = 4096,
  attributes: ContextAttributes = { alpha: true, depth: true },
) {
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
  const events: string[] = [];
  const host: SemanticHost = {
    limits: { maxTextureDimension2D: dimensionLimit, maxBufferSize: maxBufferBytes },
    draw: vi.fn((draw) => {
      draws.push(draw);
      events.push('draw');
    }),
    clear: vi.fn(() => {
      events.push('clear');
    }),
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
    events.push(operation.kind);
    apply(operation);
  });
  const surface = { width: 16, height: 16 };
  const core = createRustDrawingCoreFromModule(
    module,
    {
      contextId,
      maxBufferBytes,
      surface,
      attributes,
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
    events,
    surface,
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
  it('plans line and fan draws with WebGL1 culling and index validation', () => {
    const { core, draws } = setup();
    try {
      scene(core);
      checkPrimitiveDraws(core, () => draws);
    } finally {
      core.dispose();
    }
  });
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

describe('typed uniform and raster draw snapshots', () => {
  it('preserves hint and requested line width through invalid mutations', () => {
    const { core } = setup();
    try {
      checkHintAndLineWidth(core);
    } finally {
      core.dispose();
    }
  });
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

describe('framebuffer targets and ordered GPU writes', () => {
  function offscreen(core: DrawingCore, width = 2, height = 2) {
    const texture = core.invoke('createTexture', []);
    core.invoke('bindTexture', [GL.TEXTURE_2D, texture]);
    core.invoke('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
    core.invoke('texParameteri', [GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST]);
    const depth = core.invoke('createRenderbuffer', []);
    core.invoke('bindRenderbuffer', [GL.RENDERBUFFER, depth]);
    core.invoke('renderbufferStorage', [GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, width, height]);
    const framebuffer = core.invoke('createFramebuffer', []);
    core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, framebuffer]);
    core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0]);
    core.invoke('framebufferRenderbuffer', [GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth]);
    expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_COMPLETE);
    return { texture, depth, framebuffer };
  }
  it('prepares reads against the current canonical FBO version without advancing it', () => {
    const state = setup();
    const { core } = state;
    try {
      offscreen(core, 5, 3);
      core.invoke('clearColor', [0.25, 0.5, 0.75, 1]);
      core.invoke('clear', [GL.COLOR_BUFFER_BIT]);
      const target = core.captureTarget();
      const operationCount = state.operations.length;
      const read = core.prepareReadPixels({
        x: -1,
        y: 1,
        width: 8,
        height: 4,
        format: GL.RGBA,
        type: GL.UNSIGNED_BYTE,
        viewType: 'Uint8Array',
        byteLength: 128,
      })!;
      expect(read.target.color).toBe(target.color);
      expect(read.target.depth).toBe(target.depth);
      expect(read.target).toEqual(target);
      expect(read).toMatchObject({
        sourceX: 0,
        sourceY: 1,
        copyWidth: 5,
        copyHeight: 2,
        destinationOffset: 4,
        destinationStride: 32,
        requiredBytes: 128,
      });
      expect(state.operations).toHaveLength(operationCount);
      expect(core.captureTarget()).toEqual(target);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('encodes the target before advancing its canonical write alias and samples that allocation', () => {
    const state = setup(1, 1024 * 1024, 4096, { alpha: false, depth: false });
    const { core } = state;
    try {
      const { program } = scene(core);
      expect(core.invoke('getParameter', [GL.ALPHA_BITS])).toBe(0);
      expect(core.invoke('getParameter', [GL.DEPTH_BITS])).toBe(0);
      const target = offscreen(core);
      expect(core.invoke('getParameter', [GL.ALPHA_BITS])).toBe(8);
      expect(core.invoke('getParameter', [GL.DEPTH_BITS])).toBe(24);
      core.invoke('clearColor', [1, 0, 0, 1]);
      core.invoke('clear', [GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT]);
      expect(state.events.slice(-2)).toEqual(['clear', 'write-texture']);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.events.slice(-2)).toEqual(['draw', 'write-texture']);
      const drawn = state.draws[0].target;
      expect(drawn).toMatchObject({ width: 2, height: 2, isDefault: false, depthGeneration: 1 });
      expect(drawn.depth).not.toBeNull();
      const write = state.operations.at(-1)!;
      expect(write.kind).toBe('write-texture');
      if (write.kind === 'write-texture') expect(state.resources.texture(write.version)).toBe(drawn.color);
      expect(core.captureTarget().color).toBe(drawn.color);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, null]);
      state.setLayout({
        samplers: [{ name: 'u_texture', type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
      });
      core.invoke('linkProgram', [program]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws[1].textures[0].storage).toBe(drawn.color);
      expect(state.operations.filter((op) => op.kind === 'define-texture')).toHaveLength(1);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, target.framebuffer]);
      core.invoke('deleteRenderbuffer', [target.depth]);
      expect(core.invoke('getParameter', [GL.DEPTH_BITS])).toBe(0);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_COMPLETE);
      expect(state.host.retireDepth).toHaveBeenCalledWith(drawn.depth!.id, 1);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('rejects feedback/incomplete draws and keeps depth/image resize generations distinct', () => {
    const state = setup();
    const { core } = state;
    try {
      state.setLayout({
        samplers: [{ name: 'u_texture', type: GL.SAMPLER_2D, size: 1, samplerBinding: 0, textureBinding: 1 }],
      });
      scene(core);
      const target = offscreen(core);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(state.draws).toHaveLength(0);
      core.invoke('bindTexture', [GL.TEXTURE_2D, null]);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(state.draws).toHaveLength(1);
      const previous = core.captureTarget();
      core.invoke('bindTexture', [GL.TEXTURE_2D, target.texture]);
      core.invoke('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, 4, 4, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(
        GL.FRAMEBUFFER_INCOMPLETE_DIMENSIONS,
      );
      core.invoke('clear', [GL.COLOR_BUFFER_BIT]);
      expect(core.getError()).toBe(GL.INVALID_FRAMEBUFFER_OPERATION);
      core.invoke('renderbufferStorage', [GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 4, 4]);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_COMPLETE);
      const current = core.captureTarget();
      expect(previous).toMatchObject({ width: 2, height: 2, depthGeneration: 1 });
      expect(current).toMatchObject({ width: 4, height: 4, depthGeneration: 2 });
      expect(current.color).not.toBe(previous.color);
      state.surface.width = 32;
      state.surface.height = 24;
      expect(core.captureTarget().width).toBe(4);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, null]);
      expect(core.captureTarget()).toMatchObject({ width: 32, height: 24, isDefault: true });
      expect(Array.from(core.invoke('getParameter', [GL.VIEWPORT]) as Int32Array)).toEqual([0, 0, 16, 16]);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('retains deleted resources in unbound FBOs and ignores repeated renderbuffer deletion', () => {
    const state = setup();
    const { core } = state;
    try {
      scene(core);
      const first = offscreen(core);
      const second = core.invoke('createFramebuffer', []);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, second]);
      core.invoke('framebufferTexture2D', [
        GL.FRAMEBUFFER,
        GL.COLOR_ATTACHMENT0,
        GL.TEXTURE_2D,
        first.texture,
        0,
      ]);
      core.invoke('framebufferRenderbuffer', [
        GL.FRAMEBUFFER,
        GL.DEPTH_ATTACHMENT,
        GL.RENDERBUFFER,
        first.depth,
      ]);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, first.framebuffer]);
      core.invoke('deleteTexture', [first.texture]);
      core.invoke('deleteRenderbuffer', [first.depth]);
      expect(core.invoke('isTexture', [first.texture])).toBe(false);
      expect(core.invoke('isRenderbuffer', [first.depth])).toBe(false);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, second]);
      core.invoke('deleteRenderbuffer', [first.depth]);
      expect(
        core.invoke('getFramebufferAttachmentParameter', [
          GL.FRAMEBUFFER,
          GL.DEPTH_ATTACHMENT,
          GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
        ]),
      ).toEqual(first.depth);
      expect(
        core.invoke('getFramebufferAttachmentParameter', [
          GL.FRAMEBUFFER,
          GL.COLOR_ATTACHMENT0,
          GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
        ]),
      ).toEqual(first.texture);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_COMPLETE);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      const snapshot = state.draws[0].target;
      core.invoke('deleteFramebuffer', [second]);
      expect(state.host.retireStorage).toHaveBeenCalledWith(snapshot.color);
      expect(state.host.retireDepth).toHaveBeenCalledWith(snapshot.depth!.id, 1);
      expect(snapshot.color).not.toBeNull();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('reports resource loss neutrally and rejects impossible image byte allocations atomically', () => {
    const state = setup(1, 1024 * 1024, 32768);
    const { core } = state;
    try {
      scene(core);
      const target = offscreen(core, 1, 1);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, null]);
      const before = state.operations.length;
      core.invoke('texImage2D', [
        GL.TEXTURE_2D,
        0,
        GL.RGBA,
        32768,
        32768,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        null,
      ]);
      expect(core.getError()).toBe(GL.OUT_OF_MEMORY);
      expect(state.operations).toHaveLength(before);
      core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      const flushes = vi.mocked(state.host.flush).mock.calls.length;
      core.markLost();
      expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
      for (const name of ['isTexture', 'isFramebuffer', 'isRenderbuffer'])
        expect(core.invoke(name, [target.texture])).toBe(false);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_UNSUPPORTED);
      core.invoke('flush', []);
      expect(state.host.flush).toHaveBeenCalledTimes(flushes);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
});

describe('actual Rust readPixels plans', () => {
  function request(overrides: Partial<ReadPixelsRequest> = {}): ReadPixelsRequest {
    return {
      x: 0,
      y: 0,
      width: 3,
      height: 2,
      format: GL.RGBA,
      type: GL.UNSIGNED_BYTE,
      viewType: 'Uint8Array',
      byteLength: 24,
      ...overrides,
    };
  }
  it('advertises ABI5 with resource8/readback1', () => {
    const exports = new WebAssembly.Instance(module, {}).exports;
    expect((exports.rf_abi_version as () => number)()).toBe(5);
    expect((exports.rf_resource_protocol_version as () => number)()).toBe(8);
    expect((exports.rf_readback_protocol_version as () => number)()).toBe(1);
  });
  it('rejects old draw snapshots before context initialization', () => {
    const exports = new WebAssembly.Instance(module, {}).exports;
    const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () {
      return { exports: { ...exports, rf_abi_version: () => 3 } };
    });
    try {
      expect(() => setup()).toThrow('Rust drawing ABI version mismatch; expected 5. Rebuild with pnpm rust:build.');
    } finally {
      instance.mockRestore();
    }
  });
  it('rejects stale modules with explicit rebuild guidance', () => {
    const exports = new WebAssembly.Instance(module, {}).exports;
    const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () {
      return { exports: { ...exports, rf_readback_protocol_version: () => 0 } };
    });
    try {
      expect(() => setup()).toThrow('Rust readback protocol mismatch. Rebuild with pnpm rust:build.');
    } finally {
      instance.mockRestore();
    }
  });
  it('rejects modules missing the additive readback export', () => {
    const exports = { ...new WebAssembly.Instance(module, {}).exports };
    delete exports.rf_readback_protocol_version;
    const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () {
      return { exports };
    });
    try {
      expect(() => setup()).toThrow(
        'Rust drawing module requires ABI5/resource8/readback1/DOM upload2 exports. Rebuild with pnpm rust:build.',
      );
    } finally {
      instance.mockRestore();
    }
  });
  it('decodes owned clipped plans and synchronizes the default surface size', () => {
    const { core, surface } = setup();
    try {
      surface.width = 5;
      surface.height = 3;
      const first = core.prepareReadPixels(
        request({ x: -1, y: -2, width: 8, height: 7, byteLength: 224 }),
      )!;
      expect(first).toMatchObject({
        target: { width: 5, height: 3, isDefault: true },
        sourceX: 0,
        sourceY: 0,
        copyWidth: 5,
        copyHeight: 3,
        destinationOffset: 68,
        destinationStride: 32,
        requiredBytes: 224,
      });
      surface.width = 2;
      surface.height = 1;
      expect(core.prepareReadPixels(request())!.target).toMatchObject({ width: 2, height: 1 });
      expect(core.invoke('getParameter', [GL.IMPLEMENTATION_COLOR_READ_FORMAT])).toBe(GL.RGBA);
      expect(core.invoke('getParameter', [GL.IMPLEMENTATION_COLOR_READ_TYPE])).toBe(GL.UNSIGNED_BYTE);
      expect(first.target).toMatchObject({ width: 5, height: 3 });
      expect(first.destinationOffset).toBe(68);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('uses PACK_ALIGNMENT and excludes final-row padding from the required span', () => {
    const { core } = setup();
    try {
      for (const alignment of [1, 2, 4, 8]) {
        core.invoke('pixelStorei', [GL.PACK_ALIGNMENT, alignment]);
        const stride = alignment === 8 ? 16 : 12;
        const byteLength = stride + 12;
        expect(core.prepareReadPixels(request({ byteLength }))).toMatchObject({
          destinationStride: stride,
          requiredBytes: byteLength,
        });
        expect(core.prepareReadPixels(request({ byteLength: byteLength - 1 }))).toBeNull();
        expect(core.getError()).toBe(GL.INVALID_OPERATION);
        expect(core.invoke('getParameter', [GL.PACK_ALIGNMENT])).toBe(alignment);
      }
      expect(
        core.prepareReadPixels(
          request({ width: 0x7fffffff, height: 0x7fffffff, byteLength: Number.MAX_SAFE_INTEGER }),
        ),
      ).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
    } finally {
      core.dispose();
    }
  });
  it('emits no destination copy for outside and zero-size rectangles', () => {
    const { core, surface } = setup();
    try {
      surface.width = 5;
      surface.height = 3;
      for (const overrides of [
        { x: -8 },
        { x: 9 },
        { y: -8 },
        { y: 9 },
        { width: 0, byteLength: 0 },
        { height: 0, byteLength: 0 },
        { x: -0x80000000, width: 0x7fffffff, height: 1, byteLength: 0x7fffffff * 4 },
      ]) {
        expect(core.prepareReadPixels(request(overrides))).toMatchObject({
          copyWidth: 0,
          copyHeight: 0,
          destinationOffset: 0,
        });
      }
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('validates destination brands, null, dimensions and unsupported or invalid pairs', () => {
    const { core } = setup();
    try {
      const cases: [Partial<ReadPixelsRequest>, number][] = [
        [{ viewType: null }, GL.INVALID_VALUE],
        [{ width: -1 }, GL.INVALID_VALUE],
        [{ height: -1 }, GL.INVALID_VALUE],
        [{ viewType: 'Uint16Array' }, GL.INVALID_OPERATION],
        [{ viewType: 'DataView' }, GL.INVALID_OPERATION],
        [{ format: GL.ALPHA }, GL.INVALID_OPERATION],
        [{ format: GL.RGB }, GL.INVALID_OPERATION],
        [{ type: 0x8363 }, GL.INVALID_OPERATION],
        [{ type: 0x8033 }, GL.INVALID_OPERATION],
        [{ type: 0x8034 }, GL.INVALID_OPERATION],
        [{ format: GL.LUMINANCE }, GL.INVALID_ENUM],
        [{ format: GL.LUMINANCE_ALPHA }, GL.INVALID_ENUM],
        [{ type: GL.FLOAT }, GL.INVALID_ENUM],
        [{ type: GL.UNSIGNED_SHORT }, GL.INVALID_ENUM],
        [{ format: 0 }, GL.INVALID_ENUM],
        [{ type: 0 }, GL.INVALID_ENUM],
        [{ viewType: null, format: 0 }, GL.INVALID_VALUE],
        [{ width: -1, format: 0 }, GL.INVALID_ENUM],
        [{ viewType: 'Uint16Array', format: 0 }, GL.INVALID_ENUM],
      ];
      for (const [overrides, error] of cases) {
        expect(core.prepareReadPixels(request(overrides))).toBeNull();
        expect(core.getError()).toBe(error);
      }
      expect(core.prepareReadPixels(request({ viewType: 'Uint8ClampedArray' }))).not.toBeNull();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('checks framebuffer completeness after spans and reports implementation query errors', () => {
    const { core } = setup();
    try {
      const framebuffer = core.invoke('createFramebuffer', []);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, framebuffer]);
      expect(core.prepareReadPixels(request({ byteLength: 23 }))).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(core.prepareReadPixels(request())).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_FRAMEBUFFER_OPERATION);
      for (const parameter of [GL.IMPLEMENTATION_COLOR_READ_FORMAT, GL.IMPLEMENTATION_COLOR_READ_TYPE]) {
        expect(core.invoke('getParameter', [parameter])).toBeNull();
        expect(core.getError()).toBe(GL.INVALID_OPERATION);
      }
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, null]);
      expect(core.prepareReadPixels(request())).not.toBeNull();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });
  it('keeps lost and disposed contexts neutral', () => {
    const { core } = setup();
    core.markLost();
    expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(core.prepareReadPixels(request())).toBeNull();
    expect(core.invoke('getParameter', [GL.IMPLEMENTATION_COLOR_READ_FORMAT])).toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.dispose();
    expect(core.prepareReadPixels(request())).toBeNull();
  });
});

describe('DOM texture source protocol', () => {
  function request(overrides: Partial<DomTextureUploadRequest> = {}): DomTextureUploadRequest {
    return { operation: 'texImage2D', target: GL.TEXTURE_2D, level: 0, internalFormat: GL.RGBA,
      x: 0, y: 0, width: 1, height: 2, format: GL.RGBA, type: GL.UNSIGNED_BYTE, sourceValid: true,
      ...overrides };
  }
  function bind(core: DrawingCore) {
    core.invoke('bindTexture', [GL.TEXTURE_2D, core.invoke('createTexture', [])]);
  }
  function upload(bytes: Uint8Array, source: PixelUpload['source'] = 'dom', viewType = 'Uint8Array'): PixelUpload {
    return { bytes, viewType, source };
  }
  function define(core: DrawingCore, width: number, height: number, data: PixelUpload | null, format: number = GL.RGBA) {
    core.invoke('texImage2D', [GL.TEXTURE_2D, 0, format, width, height, 0, format, GL.UNSIGNED_BYTE, data]);
  }
  it('requires the additive DOM upload capability before initializing context state', () => {
    const exports = new WebAssembly.Instance(module, {}).exports;
    expect((exports.rf_dom_upload_protocol_version as () => number)()).toBe(2);
    for (const version of [0, 1]) {
      const initialize = vi.fn();
      const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () {
        return { exports: { ...exports, rf_dom_upload_protocol_version: () => version, rf_init: initialize } };
      });
      try {
        expect(() => setup()).toThrow('Rust DOM upload protocol mismatch. Rebuild with pnpm rust:build.');
        expect(initialize).not.toHaveBeenCalled();
      } finally { instance.mockRestore(); }
    }
  });
  it('rejects older modules missing DOM upload exports with rebuild guidance', () => {
    const exports = { ...new WebAssembly.Instance(module, {}).exports };
    delete exports.rf_dom_upload_protocol_version;
    const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () { return { exports }; });
    try {
      expect(() => setup()).toThrow('Rust drawing module requires ABI5/resource8/readback1/DOM upload2 exports. Rebuild with pnpm rust:build.');
    } finally { instance.mockRestore(); }
  });
  it('prepares owned unpack flags without changing storage or emitting resource operations', () => {
    const { core, operations } = setup();
    try {
      bind(core);
      core.invoke('pixelStorei', [GL.UNPACK_FLIP_Y_WEBGL, 1]);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
      core.invoke('pixelStorei', [GL.UNPACK_COLORSPACE_CONVERSION_WEBGL, GL.NONE]);
      const plan = core.prepareDomTextureUpload(request());
      expect(plan).toEqual({ flipY: true, premultiplyAlpha: true, colorSpaceConversion: GL.NONE });
      expect(operations).toEqual([]);
      core.invoke('pixelStorei', [GL.UNPACK_FLIP_Y_WEBGL, 0]);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0]);
      define(core, 1, 1, upload(new Uint8Array([11, 77, 203, 0])));
      const operation = operations.at(-1)!;
      expect(operation.kind).toBe('define-texture');
      if (operation.kind === 'define-texture') {
        expect(operation.version).toMatchObject({ storageGeneration: 1, contentVersion: 1 });
        expect([...operation.data]).toEqual([11, 77, 203, 0]);
      }
      expect(plan).toEqual({ flipY: true, premultiplyAlpha: true, colorSpaceConversion: GL.NONE });
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
  it('validates source facts before GL parameters and preserves failed preparation state', () => {
    const { core, operations } = setup();
    try {
      expect(core.prepareDomTextureUpload(request({ sourceValid: false, target: 0xbad, width: -1 }))).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      expect(core.prepareDomTextureUpload(request({ target: 0xbad }))).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_ENUM);
      expect(core.prepareDomTextureUpload(request())).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      bind(core);
      for (const [overrides, error] of [
        [{ level: -1 }, GL.INVALID_VALUE], [{ width: 4097 }, GL.INVALID_VALUE],
        [{ internalFormat: GL.RGB }, GL.INVALID_OPERATION], [{ format: 0xbad }, GL.INVALID_ENUM],
        [{ type: GL.FLOAT }, GL.INVALID_ENUM], [{ operation: 'texSubImage2D' }, GL.INVALID_OPERATION],
      ] as [Partial<DomTextureUploadRequest>, number][]) {
        expect(core.prepareDomTextureUpload(request(overrides))).toBeNull();
        expect(core.getError()).toBe(error);
      }
      expect(operations).toEqual([]);
      expect(core.prepareDomTextureUpload(request())).toEqual({ flipY: false, premultiplyAlpha: false,
        colorSpaceConversion: GL.BROWSER_DEFAULT_WEBGL });
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
  it('rejects lost sources after availability and dimensions without changing destination versions', () => {
    const { core, operations } = setup();
    try {
      bind(core);
      define(core, 2, 2, null);
      for (const operation of ['texImage2D', 'texSubImage2D'] as const) {
        const lost = request({ operation, sourceContextLost: true });
        for (const target of [GL.TEXTURE_2D, 0xbad]) {
          expect(core.prepareDomTextureUpload({ ...lost, target })).toBeNull();
          expect(core.getError()).toBe(GL.INVALID_OPERATION);
          expect(operations).toHaveLength(1);
        }
        for (const overrides of [{ sourceValid: false }, { width: 0 }, { height: Number.NaN }]) {
          expect(core.prepareDomTextureUpload({ ...lost, ...overrides, target: 0xbad })).toBeNull();
          expect(core.getError()).toBe(GL.INVALID_VALUE);
          expect(operations).toHaveLength(1);
        }
        expect(core.prepareDomTextureUpload({ ...lost, sourceContextLost: false, target: 0xbad })).toBeNull();
        expect(core.getError()).toBe(GL.INVALID_ENUM);
        expect(core.prepareDomTextureUpload(request({ operation }))).not.toBeNull();
        expect(core.prepareDomTextureUpload({ ...lost, sourceContextLost: false })).not.toBeNull();
        expect(core.getError()).toBe(GL.NO_ERROR);
        expect(operations).toHaveLength(1);
      }
      core.invoke('texSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, 1, 2, GL.RGBA, GL.UNSIGNED_BYTE,
        upload(new Uint8Array(8))]);
      const update = operations.at(-1)!;
      if (update.kind !== 'update-texture') throw new Error('Missing destination update.');
      expect(update.previous).toMatchObject({ storageGeneration: 1, contentVersion: 1 });
      expect(update.version).toMatchObject({ storageGeneration: 1, contentVersion: 2 });
      expect(operations).toHaveLength(2);
      expect(core.getError()).toBe(GL.NO_ERROR);
      core.markLost();
      expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
      expect(core.prepareDomTextureUpload(request({ sourceContextLost: true }))).toBeNull();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
  it('consumes tight DOM rows for every unpack alignment and retains legacy padded rows', () => {
    const { core, operations } = setup();
    try {
      bind(core);
      for (const alignment of [1, 2, 4, 8]) {
        core.invoke('pixelStorei', [GL.UNPACK_ALIGNMENT, alignment]);
        const bytes = new Uint8Array([11, 77, 203, 0, 201, 109, 19, 1]);
        define(core, 1, 2, upload(bytes, 'dom', 'Uint8ClampedArray'));
        bytes.fill(0);
        const operation = operations.at(-1)!;
        if (operation.kind !== 'define-texture') throw new Error('Missing DOM texture definition.');
        expect([...operation.data]).toEqual([11, 77, 203, 0, 201, 109, 19, 1]);
        expect(core.getError()).toBe(GL.NO_ERROR);
      }
      const count = operations.length;
      define(core, 1, 2, { bytes: new Uint8Array(8), viewType: 'Uint8Array' });
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(operations).toHaveLength(count);
      define(core, 1, 2, { bytes: new Uint8Array(12), viewType: 'Uint8Array' });
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(operations).toHaveLength(count + 1);
    } finally { core.dispose(); }
  });
  it('applies DOM premultiplication before five-format conversion and skips converted inputs', () => {
    const { core, operations } = setup();
    try {
      bind(core);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
      for (const [format, expected] of [
        [GL.RGBA, [100, 50, 25, 128]], [GL.RGB, [100, 50, 25, 255]],
        [GL.ALPHA, [0, 0, 0, 128]], [GL.LUMINANCE, [100, 100, 100, 255]],
        [GL.LUMINANCE_ALPHA, [100, 100, 100, 128]],
      ] as const) {
        define(core, 1, 1, upload(new Uint8Array([200, 100, 50, 128])), format);
        const operation = operations.at(-1)!;
        if (operation.kind !== 'define-texture') throw new Error('Missing DOM definition.');
        expect([...operation.data]).toEqual(expected);
        expect(core.getError()).toBe(GL.NO_ERROR);
      }
      core.invoke('pixelStorei', [GL.UNPACK_FLIP_Y_WEBGL, 1]);
      define(core, 1, 2, upload(new Uint8Array([11, 77, 203, 0, 200, 100, 50, 128])));
      const operation = operations.at(-1)!;
      if (operation.kind !== 'define-texture') throw new Error('Missing DOM flip definition.');
      expect([...operation.data]).toEqual([100, 50, 25, 128, 0, 0, 0, 0]);
      define(core, 1, 2, upload(operation.data, 'dom-converted'));
      const converted = operations.at(-1)!;
      if (converted.kind !== 'define-texture') throw new Error('Missing converted DOM definition.');
      expect([...converted.data]).toEqual([...operation.data]);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
  it('updates DOM content versions and rejects malformed payloads without resource mutation', () => {
    const { core, operations } = setup();
    try {
      bind(core);
      define(core, 2, 2, null);
      expect(core.prepareDomTextureUpload(request({ operation: 'texSubImage2D', x: 1 }))).not.toBeNull();
      const bytes = new Uint8Array([11, 77, 203, 0, 201, 109, 19, 1]);
      core.invoke('pixelStorei', [GL.UNPACK_ALIGNMENT, 8]);
      core.invoke('texSubImage2D', [GL.TEXTURE_2D, 0, 1, 0, 1, 2, GL.RGBA, GL.UNSIGNED_BYTE, upload(bytes)]);
      bytes.fill(0);
      const operation = operations.at(-1)!;
      if (operation.kind !== 'update-texture') throw new Error('Missing DOM update.');
      expect(operation.version).toMatchObject({ storageGeneration: 1, contentVersion: 2 });
      expect([...operation.data]).toEqual([11, 77, 203, 0, 201, 109, 19, 1]);
      const count = operations.length;
      for (const data of [upload(new Uint8Array(7)), upload(new Uint8Array(8), 'dom', 'Float32Array')]) {
        core.invoke('texSubImage2D', [GL.TEXTURE_2D, 0, 1, 0, 1, 2, GL.RGBA, GL.UNSIGNED_BYTE, data]);
        expect(core.getError()).toBe(GL.INVALID_OPERATION);
        expect(operations).toHaveLength(count);
      }
      expect(() => core.invoke('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA,
        GL.UNSIGNED_BYTE, { bytes: new Uint8Array(4), viewType: 'Uint8Array', source: 'unknown' }])).toThrow(TypeError);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(operations).toHaveLength(count);
      core.markLost();
      expect(core.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
      expect(core.prepareDomTextureUpload(request({ sourceValid: false }))).toBeNull();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
});

describe('CubeMap resource8 protocol', () => {
  function bind(core: DrawingCore, target: number = GL.TEXTURE_CUBE_MAP) {
    const texture = core.invoke('createTexture', []);
    core.invoke('bindTexture', [target, texture]);
    return texture;
  }
  function define(core: DrawingCore, target: number, size: number, format: number = GL.RGBA,
    bytes: number[] | null = null) {
    core.invoke('texImage2D', [target, 0, format, size, size, 0, format, GL.UNSIGNED_BYTE,
      bytes ? { bytes: new Uint8Array(bytes), viewType: 'Uint8Array' } : null]);
  }
  function faces(core: DrawingCore, size = 1, format: number = GL.RGBA) {
    for (const face of CUBE_FACES) define(core, face, size, format);
  }
  function sampled(types: number[] = [GL.SAMPLER_CUBE]) {
    const state = setup();
    state.setLayout({ samplers: types.map((type, index) => ({ name: `u_tex${index}`, type, size: 1,
      samplerBinding: index * 2, textureBinding: index * 2 + 1 })) });
    const program = scene(state.core).program;
    return { ...state, program };
  }
  function draw(state: ReturnType<typeof setup>, count = 3) {
    state.core.invoke('drawArrays', [GL.TRIANGLES, 0, count]);
    return state.draws.at(-1)?.textures[0];
  }

  it('rejects resource2 modules before state initialization', () => {
    const exports = new WebAssembly.Instance(module, {}).exports;
    const initialize = vi.fn();
    const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(function () {
      return { exports: { ...exports, rf_resource_protocol_version: () => 2, rf_init: initialize } };
    });
    try {
      expect(() => setup()).toThrow('Rust resource protocol mismatch. Rebuild with pnpm rust:build.');
      expect(initialize).not.toHaveBeenCalled();
    } finally { instance.mockRestore(); }
  });

  it('fixes first binding targets and preserves independent bindings across units', () => {
    const { core } = setup();
    try {
      const cube = core.invoke('createTexture', []);
      core.invoke('bindTexture', [CUBE_FACES[0], cube]);
      expect(core.getError()).toBe(GL.INVALID_ENUM);
      expect(core.invoke('isTexture', [cube])).toBe(false);
      core.invoke('bindTexture', [GL.TEXTURE_CUBE_MAP, cube]);
      const twoD = bind(core, GL.TEXTURE_2D);
      core.invoke('bindTexture', [GL.TEXTURE_2D, cube]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_2D])).toEqual(twoD);
      expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_CUBE_MAP])).toEqual(cube);
      expect(core.invoke('getParameter', [GL.MAX_CUBE_MAP_TEXTURE_SIZE])).toBe(4096);
      core.invoke('activeTexture', [GL.TEXTURE0 + 1]);
      expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_CUBE_MAP])).toBeNull();
      core.invoke('bindTexture', [GL.TEXTURE_CUBE_MAP, cube]);
      core.invoke('deleteTexture', [cube]);
      for (const unit of [0, 1]) {
        core.invoke('activeTexture', [GL.TEXTURE0 + unit]);
        expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_CUBE_MAP])).toBeNull();
      }
      core.invoke('bindTexture', [GL.TEXTURE_CUBE_MAP, cube]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      core.invoke('activeTexture', [GL.TEXTURE0]);
      expect(core.invoke('getParameter', [GL.TEXTURE_BINDING_2D])).toEqual(twoD);
    } finally { core.dispose(); }
  });

  it('serializes all six face identities and normalizes each logical format', () => {
    const state = sampled();
    const { core, operations } = state;
    try {
      bind(core);
      for (const [format, bytes, expected] of [
        [GL.RGBA, [11, 77, 203, 0], [11, 77, 203, 0]],
        [GL.RGB, [11, 77, 203], [11, 77, 203, 255]],
        [GL.ALPHA, [77], [0, 0, 0, 77]],
        [GL.LUMINANCE, [77], [77, 77, 77, 255]],
        [GL.LUMINANCE_ALPHA, [77, 127], [77, 77, 77, 127]],
      ] as const) {
        for (const face of CUBE_FACES) {
          define(core, face, 1, format, [...bytes]);
          const operation = operations.at(-1)!;
          if (operation.kind !== 'define-texture') throw new Error('Missing face definition.');
          expect(operation.version).toMatchObject({ imageTarget: face, level: 0 });
          expect([...operation.data]).toEqual(expected);
        }
        const binding = draw(state)!;
        expect(binding).toMatchObject({ dimension: 'cube', storage: null });
        expect(binding.cubeFaces).toHaveLength(6);
        expect(binding.cubeFaces!.map(face => face.reference?.imageTarget)).toEqual(CUBE_FACES);
      }
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });

  it('keeps incomplete cube views typed and recomputes completeness from every face and parameter', () => {
    const state = sampled();
    const { core } = state;
    try {
      bind(core);
      expect(draw(state)).toMatchObject({ dimension: 'cube', storage: null });
      expect(draw(state)!.cubeFaces).toBeUndefined();
      faces(core);
      expect(draw(state)!.cubeFaces).toHaveLength(6);
      define(core, CUBE_FACES[2], 0);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      faces(core, 2);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      core.invoke('texParameteri', [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.LINEAR]);
      expect(draw(state)!.cubeFaces).toHaveLength(6);
      define(core, CUBE_FACES[3], 1);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      faces(core, 3);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      for (const parameter of [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T])
        core.invoke('texParameteri', [GL.TEXTURE_CUBE_MAP, parameter, GL.CLAMP_TO_EDGE]);
      expect(draw(state)!.cubeFaces).toHaveLength(6);
      define(core, CUBE_FACES[4], 3, GL.RGB);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });

  it('owns rectangular updates, preserves prior draws, and retires all face records', () => {
    const state = sampled();
    const { core, operations } = state;
    try {
      const cube = bind(core);
      faces(core, 2);
      core.invoke('texParameteri', [GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.NEAREST]);
      const previous = draw(state)!;
      const oldFaces = previous.cubeFaces!.slice();
      const bytes = new Uint8Array(8).fill(77);
      core.invoke('texSubImage2D', [CUBE_FACES[1], 0, 1, 0, 1, 2, GL.RGBA, GL.UNSIGNED_BYTE,
        { bytes, viewType: 'Uint8Array' }]);
      bytes.fill(0);
      const update = operations.at(-1)!;
      if (update.kind !== 'update-texture') throw new Error('Missing cube update.');
      expect(update.previous).toEqual(oldFaces[1]!.reference);
      expect(update.version).toMatchObject({ imageTarget: CUBE_FACES[1], level: 0,
        storageGeneration: 1, contentVersion: 2 });
      expect([...update.data]).toEqual(Array(8).fill(77));
      const current = draw(state)!;
      expect(current.cubeFaces![1]).not.toBe(oldFaces[1]);
      for (const face of [0, 2, 3, 4, 5]) expect(current.cubeFaces![face]).toBe(oldFaces[face]);
      const count = operations.length;
      core.invoke('texImage2D', [CUBE_FACES[1], 0, GL.RGBA, 1, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      expect(operations).toHaveLength(count);
      core.invoke('deleteTexture', [cube]);
      const retired = operations.slice(count);
      expect(retired).toHaveLength(6);
      expect(retired.map(operation => operation.kind)).toEqual(Array(6).fill('retire-texture'));
      expect(retired.map(operation => operation.kind === 'retire-texture' ? operation.version : null))
        .toEqual(current.cubeFaces!.map(face => face.reference));
      expect(previous.cubeFaces).toEqual(oldFaces);
      expect(draw(state)!.cubeFaces).toBeUndefined();
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });

  it('rejects mixed sampler unit types at validation and zero-count draws', () => {
    const state = sampled([GL.SAMPLER_2D, GL.SAMPLER_CUBE]);
    const { core, program, draws } = state;
    try {
      core.invoke('validateProgram', [program]);
      expect(core.invoke('getProgramParameter', [program, GL.VALIDATE_STATUS])).toBe(false);
      draw(state, 0);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(draws).toEqual([]);
      const location = core.invoke('getUniformLocation', [program, 'u_tex1']);
      core.invoke('uniform1i', [location, 1]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      core.invoke('uniform1i', [location, 32]);
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      expect(core.invoke('getUniform', [program, location])).toBe(1);
      core.invoke('validateProgram', [program]);
      expect(core.invoke('getProgramParameter', [program, GL.VALIDATE_STATUS])).toBe(true);
      draw(state);
      expect(draws[0]!.textures[0]!.dimension).toBeUndefined();
      expect(draws[0]!.textures[1]).toMatchObject({ dimension: 'cube', storage: null });
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });

  it('rejects cube objects as 2D FBO images and queries legal cube attachments', () => {
    const { core } = setup();
    try {
      const twoD = bind(core, GL.TEXTURE_2D);
      define(core, GL.TEXTURE_2D, 1);
      const cube = bind(core);
      const framebuffer = core.invoke('createFramebuffer', []);
      core.invoke('bindFramebuffer', [GL.FRAMEBUFFER, framebuffer]);
      core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, twoD, 0]);
      core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, cube, 0]);
      expect(core.getError()).toBe(GL.INVALID_OPERATION);
      expect(core.invoke('getFramebufferAttachmentParameter', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toEqual(twoD);
      core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, CUBE_FACES[0], cube, 0]);
      expect(core.getError()).toBe(GL.NO_ERROR);
      expect(core.invoke('getFramebufferAttachmentParameter', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME])).toEqual(cube);
      expect(core.invoke('getFramebufferAttachmentParameter', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE])).toBe(CUBE_FACES[0]);
      core.invoke('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, CUBE_FACES[0], null, 0]);
      expect(core.invoke('checkFramebufferStatus', [GL.FRAMEBUFFER])).toBe(GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
    } finally { core.dispose(); }
  });

  it('prepares and transforms DOM face data while retaining legacy 2D version shapes', () => {
    const { core, operations } = setup();
    try {
      bind(core, GL.TEXTURE_2D);
      define(core, GL.TEXTURE_2D, 1);
      const legacy = operations[0]!;
      if (legacy.kind !== 'define-texture') throw new Error('Missing 2D image.');
      expect(legacy.version.imageTarget).toBeUndefined();
      expect(legacy.version.level).toBeUndefined();
      bind(core);
      const request: DomTextureUploadRequest = { operation: 'texImage2D', target: CUBE_FACES[2], level: 0,
        internalFormat: GL.RGBA, x: 0, y: 0, width: 1, height: 2, format: GL.RGBA,
        type: GL.UNSIGNED_BYTE, sourceValid: true };
      expect(core.prepareDomTextureUpload(request)).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_VALUE);
      core.invoke('pixelStorei', [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]);
      expect(core.prepareDomTextureUpload({ ...request, height: 1 })).not.toBeNull();
      core.invoke('texImage2D', [CUBE_FACES[2], 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE,
        { bytes: new Uint8Array([200, 100, 50, 128]), viewType: 'Uint8Array', source: 'dom' }]);
      const operation = operations.at(-1)!;
      if (operation.kind !== 'define-texture') throw new Error('Missing DOM face image.');
      expect(operation.version).toMatchObject({ imageTarget: CUBE_FACES[2], level: 0 });
      expect([...operation.data]).toEqual([100, 50, 25, 128]);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally { core.dispose(); }
  });
});
