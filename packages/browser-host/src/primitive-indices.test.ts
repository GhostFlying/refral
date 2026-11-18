import { describe, expect, it } from 'vitest';
import { GL } from '@refral/core-api';
import { primitiveIndexBatches } from './primitive-indices.js';

describe('WebGL1 loop and fan assembly', () => {
  it('closes a loop once and keeps the fan anchor and winding', () => {
    expect([...primitiveIndexBatches(GL.LINE_LOOP, 7, 3, null)][0]).toEqual(new Uint32Array([7, 8, 8, 9, 9, 7]));
    expect([...primitiveIndexBatches(GL.TRIANGLE_FAN, 7, 4, null)][0]).toEqual(new Uint32Array([7, 8, 9, 7, 9, 10]));
    expect([...primitiveIndexBatches(GL.LINE_LOOP, 2, 1, null)]).toEqual([]);
    expect([...primitiveIndexBatches(GL.TRIANGLE_FAN, 2, 2, null)]).toEqual([]);
  });

  it('preserves the maximum WebGL1 index, byte offsets and subview bounds', () => {
    const bytes = new Uint16Array([9, 8, 65535, 5, 4, 3, 2]);
    const data = new Uint8Array(bytes.buffer, 2, 10);
    expect([...primitiveIndexBatches(GL.TRIANGLE_FAN, 0, 4, { data, type: GL.UNSIGNED_SHORT, offset: 2 })][0])
      .toEqual(new Uint32Array([65535, 5, 4, 65535, 4, 3]));
    const u8 = { data: new Uint8Array([0, 255, 6, 5]), type: GL.UNSIGNED_BYTE, offset: 1 };
    expect([...primitiveIndexBatches(GL.LINE_LOOP, 0, 3, u8)][0]).toEqual(new Uint32Array([255, 6, 6, 5, 5, 255]));
  });

  it('preserves topology across batch boundaries and large array indices', () => {
    const first = 100000;
    const count = 9000;
    const fan = [...primitiveIndexBatches(GL.TRIANGLE_FAN, first, count, null)];
    expect(fan).toHaveLength(2);
    expect(Array.from(fan[1]!.slice(0, 3))).toEqual([first, fan[0]!.at(-1), fan[0]!.at(-1)! + 1]);
    expect(fan[1]!.at(-1)).toBe(first + count - 1);
    const loop = [...primitiveIndexBatches(GL.LINE_LOOP, first, count, null)];
    expect(loop).toHaveLength(2);
    expect(loop[1]![0]).toBe(loop[0]!.at(-1));
    expect(Array.from(loop[1]!.slice(-2))).toEqual([first + count - 1, first]);
  });
});
