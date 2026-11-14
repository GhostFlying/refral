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
  const facade = createProgramFacade({ invoke } as unknown as DrawingCore);
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

  it('applies signed/unsigned numeric conversion before dispatch', () => {
    const facade = setup();
    facade.methods.drawArrays!(0x1_0000_0004, 0x1_0000_0001, 3.9);
    expect(facade.invoke).toHaveBeenLastCalledWith('drawArrays', [GL.TRIANGLES, 1, 3]);
    facade.methods.vertexAttribPointer!(0x1_0000_0000, 3, GL.FLOAT, 1, 12, -1.9);
    expect(facade.invoke).toHaveBeenLastCalledWith('vertexAttribPointer', [0, 3, GL.FLOAT, true, 12, -1]);
    expect(() => facade.methods.uniform1fv!(null, { length: 1, 0: 1 })).toThrow(TypeError);
  });
});
