import { expect } from 'vitest';
import { GL } from '@refral/core-api';
import type { DrawingCore } from '@refral/core-api';

export function checkHintAndLineWidth(core: Pick<DrawingCore, 'invoke' | 'getError'>): void {
  const get = (parameter: number) => core.invoke('getParameter', [parameter]);

  expect(get(GL.GENERATE_MIPMAP_HINT)).toBe(GL.DONT_CARE);
  for (const value of [GL.FASTEST, GL.DONT_CARE, GL.NICEST]) {
    core.invoke('hint', [GL.GENERATE_MIPMAP_HINT, value]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(get(GL.GENERATE_MIPMAP_HINT)).toBe(value);
  }
  for (const [target, mode] of [[GL.GENERATE_MIPMAP_HINT, GL.NICEST + 1], [0x8b8b, GL.FASTEST]]) {
    core.invoke('hint', [target, mode]);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(get(GL.GENERATE_MIPMAP_HINT)).toBe(GL.NICEST);
  }

  const range = get(GL.ALIASED_LINE_WIDTH_RANGE);
  expect(range).toEqual(Float32Array.of(1, 1));
  (range as Float32Array)[1] = 42;
  expect(get(GL.ALIASED_LINE_WIDTH_RANGE)).toEqual(Float32Array.of(1, 1));
  expect(get(GL.LINE_WIDTH)).toBe(1);

  for (const width of [0.25, Infinity, 4.5]) {
    core.invoke('lineWidth', [width]);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(get(GL.LINE_WIDTH)).toBe(width);
  }
  for (const width of [NaN, 0, -1, -Infinity]) {
    core.invoke('lineWidth', [width]);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(get(GL.LINE_WIDTH)).toBe(4.5);
  }
}

export function checkOffsetAndSampleState(core: Pick<DrawingCore, 'invoke' | 'getError'>): void {
  const get = (parameter: number) => core.invoke('getParameter', [parameter]);
  expect(get(GL.SUBPIXEL_BITS)).toBe(4);
  expect(get(GL.POLYGON_OFFSET_FACTOR)).toBe(0);
  expect(get(GL.POLYGON_OFFSET_UNITS)).toBe(0);
  expect(get(GL.SAMPLE_COVERAGE_VALUE)).toBe(1);
  expect(get(GL.SAMPLE_COVERAGE_INVERT)).toBe(false);
  for (const cap of [GL.POLYGON_OFFSET_FILL, GL.SAMPLE_COVERAGE, GL.SAMPLE_ALPHA_TO_COVERAGE]) {
    expect(get(cap)).toBe(false);
    core.invoke('enable', [cap]);
    expect(get(cap)).toBe(true);
    expect(core.invoke('isEnabled', [cap])).toBe(true);
    core.invoke('disable', [cap]);
    expect(core.invoke('isEnabled', [cap])).toBe(false);
  }
  for (const [factor, units] of [[-0.25, 1.75], [0.125, -4294967296], [1, 4294967296]]) {
    core.invoke('polygonOffset', [factor, units]);
    expect(get(GL.POLYGON_OFFSET_FACTOR)).toBe(factor);
    expect(get(GL.POLYGON_OFFSET_UNITS)).toBe(units);
  }
  for (const [input, value, invert] of [[-1, 0, true], [0.5, 0.5, false], [2, 1, true]] as const) {
    core.invoke('sampleCoverage', [input, invert]);
    expect(get(GL.SAMPLE_COVERAGE_VALUE)).toBe(value);
    expect(get(GL.SAMPLE_COVERAGE_INVERT)).toBe(invert);
  }
  expect(core.getError()).toBe(GL.NO_ERROR);
}
