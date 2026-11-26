import { describe, expect, it, vi } from 'vitest';
import { GL } from '@refral/core-api';
import type { DrawingCore, LogicalHandle } from '@refral/core-api';
import { createProgramFacade } from './programs.js';

function setup(contextId = 1) {
  const handle = (kind: LogicalHandle['kind']): LogicalHandle => ({
    kind, contextId, slot: 1, generation: 1,
  });
  const shader = handle('shader');
  const program = handle('program');
  const location = handle('uniform-location');
  const invoke = vi.fn((operation: string, _args: unknown[]) => {
    if (operation === 'createShader') return shader;
    if (operation === 'createProgram' || operation === 'getParameter') return program;
    if (operation === 'getUniformLocation') return location;
    if (operation === 'getAttachedShaders') return [shader];
    return undefined;
  });
  const facade = createProgramFacade({ invoke, contextId, isContextLost: () => false } as unknown as DrawingCore);
  return { ...facade, invoke, shader, program, location };
}

describe('program facade boundary', () => {
  it('preserves shader/program identity and creates independent location wrappers', () => {
    const facade = setup();
    const shader = facade.methods.createShader!(GL.VERTEX_SHADER);
    const program = facade.methods.createProgram!();
    expect(facade.methods.getAttachedShaders!(program)).toEqual([shader]);
    expect(facade.current()).toBe(program);
    const first = facade.methods.getUniformLocation!(program, 'color');
    const second = facade.methods.getUniformLocation!(program, 'color');
    expect(first).not.toBe(second);
    facade.methods.uniform4f!(first, 1, 2, 3, 4);
    expect(facade.invoke).toHaveBeenLastCalledWith('uniform4f', [facade.location, 1, 2, 3, 4]);
  });

  it('carries foreign-context handles to core validation and rejects wrong wrapper kinds', () => {
    const first = setup(1);
    const second = setup(2);
    const foreign = first.methods.createProgram!();
    second.methods.useProgram!(foreign);
    expect(second.invoke).toHaveBeenLastCalledWith('useProgram', [first.program]);
    const shader = first.methods.createShader!(GL.VERTEX_SHADER);
    expect(() => second.methods.useProgram!(shader)).toThrow(TypeError);
    expect(() => first.methods.compileShader!(null)).toThrow(TypeError);
    expect(() => first.methods.attachShader!(foreign)).toThrow(TypeError);
    first.methods.useProgram!(null);
    expect(first.invoke).toHaveBeenLastCalledWith('useProgram', [null]);
  });

  it('preserves DOMString code units and unrestricted float payloads', () => {
    const facade = setup();
    const shader = facade.methods.createShader!(GL.VERTEX_SHADER);
    const source = '\ud800\0\udc00\r\n';
    facade.methods.shaderSource!(shader, { toString: () => source });
    expect(facade.invoke).toHaveBeenLastCalledWith('shaderSource', [facade.shader, source]);
    expect(() => facade.methods.shaderSource!(shader, Symbol())).toThrow(TypeError);
    facade.methods.uniform3f!(null, NaN, Infinity, -Infinity);
    expect(facade.invoke).toHaveBeenLastCalledWith('uniform3f', [null, NaN, Infinity, -Infinity]);
    const input = new Float32Array([0.5, NaN, Infinity, -Infinity]);
    facade.methods.uniform4fv!(null, input);
    const values = facade.invoke.mock.calls.at(-1)![1] as unknown as unknown[];
    expect(values[1]).toEqual(input);
    expect(values[1]).not.toBe(input);
    input.fill(0);
    expect(values[1]).toEqual(new Float32Array([0.5, NaN, Infinity, -Infinity]));
  });

  it('converts matrix storage before dispatch even after a previously accepted view detaches', () => {
    const facade = setup();
    const set = (view: Float32Array) => facade.methods.uniformMatrix2fv!(null, false, view);
    const source = new Float32Array([1, 0, 0, 1]);
    const buffer = source.buffer;
    Object.defineProperty(source, 'buffer', { get() { throw new Error('shadowed buffer'); } });
    set(source);
    set(source);
    structuredClone(buffer, { transfer: [buffer] });
    expect(() => set(source)).toThrow(TypeError);
    const variable = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]);
    expect(() => set(new Float32Array(variable, 0, 4))).toThrow(TypeError);
    const shared = new Float32Array(new SharedArrayBuffer(16));
    shared[0] = 2;
    set(shared);
    const dispatched = facade.invoke.mock.lastCall![1][2] as Float32Array;
    shared[0] = 3;
    expect(dispatched[0]).toBe(2);
    expect(() => set(new Float32Array(Reflect.construct(SharedArrayBuffer, [16, { maxByteLength: 32 }])))).toThrow(TypeError);
  });

  it('applies signed/unsigned numeric conversion before dispatch', () => {
    const facade = setup();
    facade.methods.drawArrays!(0x1_0000_0004, 0x1_0000_0001, 3.9);
    expect(facade.invoke).toHaveBeenLastCalledWith('drawArrays', [GL.TRIANGLES, 1, 3]);
    facade.methods.vertexAttribPointer!(0x1_0000_0000, 3, GL.FLOAT, 1, 12, -1.9);
    expect(facade.invoke).toHaveBeenLastCalledWith('vertexAttribPointer', [0, 3, GL.FLOAT, true, 12, -1]);
    expect(() => facade.methods.uniform1fv!(null, { length: 1, 0: 1 })).toThrow(TypeError);
  });
});
