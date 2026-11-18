import { expect } from 'vitest';
import { GL } from '@refral/core-api';
import type { DrawingCore, DrawOperation } from '@refral/core-api';

export function checkPrimitiveDraws(core: DrawingCore, draws: () => DrawOperation[]) {
  core.invoke('disableVertexAttribArray', [0]);
  core.invoke('enable', [GL.CULL_FACE]);
  core.invoke('cullFace', [GL.FRONT_AND_BACK]);
  for (const mode of [GL.LINES, GL.LINE_LOOP, GL.LINE_STRIP, GL.TRIANGLE_FAN]) {
    core.invoke('drawArrays', [mode, 7, 4]);
  }
  expect(draws().map(({ mode, first, count }) => [mode, first, count]))
    .toEqual([[GL.LINES, 7, 4], [GL.LINE_LOOP, 7, 4], [GL.LINE_STRIP, 7, 4]]);
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
  for (const mode of [GL.LINES, GL.LINE_LOOP, GL.LINE_STRIP, GL.TRIANGLE_FAN]) {
    core.invoke('drawElements', [mode, 3, GL.UNSIGNED_SHORT, 2]);
    expect(draws().at(-1)).toMatchObject({ mode, count: 3, vertexCount: 65536, indices: { type: GL.UNSIGNED_SHORT, offset: 2, data: bytes } });
  }
  expect(core.getError()).toBe(GL.NO_ERROR);
  core.invoke('drawElements', [GL.TRIANGLE_FAN, 0, GL.UNSIGNED_SHORT, 100]);
  expect(core.getError()).toBe(GL.NO_ERROR);
  core.invoke('drawElements', [GL.TRIANGLE_FAN, 1, GL.UNSIGNED_SHORT, 100]);
  expect(core.getError()).toBe(GL.INVALID_OPERATION);
  expect(draws()).toHaveLength(7);
}
