import { expect } from 'vitest';
import { GL } from '@refral/core-api';
import type { DrawingCore, DrawOperation } from '@refral/core-api';

export function checkPrimitiveDraws(core: DrawingCore, draws: () => DrawOperation[]) {
  expect(core.invoke('getParameter', [GL.ALIASED_POINT_SIZE_RANGE])).toEqual(new Float32Array([1, 64]));
  core.invoke('disableVertexAttribArray', [0]);
  core.invoke('enable', [GL.CULL_FACE]);
  core.invoke('cullFace', [GL.FRONT_AND_BACK]);
  for (const mode of [GL.POINTS, GL.LINES, GL.LINE_LOOP, GL.LINE_STRIP, GL.TRIANGLE_FAN]) {
    core.invoke('drawArrays', [mode, 7, 4]);
  }
  expect(draws().map(({ mode, first, count }) => [mode, first, count]))
    .toEqual([[GL.POINTS, 7, 4], [GL.LINES, 7, 4], [GL.LINE_LOOP, 7, 4], [GL.LINE_STRIP, 7, 4]]);
  core.invoke('disable', [GL.CULL_FACE]);
  core.invoke('drawElements', [GL.LINE_LOOP, 0, GL.UNSIGNED_SHORT, 100]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.invoke('drawElements', [GL.LINE_LOOP, 0, GL.UNSIGNED_SHORT, 1]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.invoke('drawElements', [GL.LINE_LOOP, 1, GL.UNSIGNED_SHORT, 0]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, core.createBuffer());
  const bytes = new Uint8Array(new Uint16Array([0, 4, 65535, 7]).buffer);
  core.bufferData(GL.ELEMENT_ARRAY_BUFFER, bytes, GL.STATIC_DRAW);
  for (const mode of [GL.POINTS, GL.LINES, GL.LINE_LOOP, GL.LINE_STRIP, GL.TRIANGLE_FAN]) {
    core.invoke('drawElements', [mode, 3, GL.UNSIGNED_SHORT, 2]);
    expect(draws().at(-1)).toMatchObject({ mode, count: 3, vertexCount: 65536, indices: { type: GL.UNSIGNED_SHORT, offset: 2, data: bytes } });
  }
  expect(core.getError()).toBe(GL.NO_ERROR);
  core.invoke('drawElements', [GL.TRIANGLE_FAN, 0, GL.UNSIGNED_SHORT, 100]);
  expect(core.getError()).toBe(GL.NO_ERROR);
  core.invoke('drawElements', [GL.TRIANGLE_FAN, 1, GL.UNSIGNED_SHORT, 100]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  expect(draws()).toHaveLength(9);
}

export function checkMatrixColumnDraws(core: DrawingCore, draws: () => DrawOperation[]) {
  core.invoke('vertexAttrib3f', [2, 1, 2, 3]);
  core.bindBuffer(GL.ARRAY_BUFFER, core.createBuffer());
  core.invoke('vertexAttribPointer', [3, 3, GL.FLOAT, false, 0, 0]);
  core.invoke('enableVertexAttribArray', [3]);
  core.bufferData(GL.ARRAY_BUFFER, new Uint8Array(35), GL.STATIC_DRAW);
  core.invoke('drawArrays', [GL.TRIANGLES, 0, 3]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  core.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, core.createBuffer());
  core.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2]), GL.STATIC_DRAW);
  core.invoke('drawElements', [GL.TRIANGLES, 3, GL.UNSIGNED_BYTE, 0]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  expect(draws()).toHaveLength(0);
  core.bufferData(GL.ARRAY_BUFFER, new Uint8Array(36), GL.STATIC_DRAW);
  core.invoke('drawElements', [GL.TRIANGLES, 3, GL.UNSIGNED_BYTE, 0]);
  expect(core.getError()).toBe(GL.NO_ERROR);
  const columns = draws()[0]!.attributes;
  expect(columns.map(({ location, shaderType }) => [location, shaderType])).toEqual([
    [1, GL.FLOAT_VEC3], [2, GL.FLOAT_VEC3], [3, GL.FLOAT_VEC3],
  ]);
  expect(columns.map(column => column.data?.byteLength ?? null)).toEqual([null, null, 36]);
  expect(columns[1]!.constant).toEqual([1, 2, 3, 1]);
}
