import { expect, it, vi } from 'vitest';
import { GeometryCache } from './geometry-cache';

function stream(size: number): GPUBuffer { return { size } as GPUBuffer; }

it('keeps the current draw streams when a new stream requires eviction', () => {
  const retain = vi.fn();
  const retire = vi.fn();
  const cache = new GeometryCache(16, 4, retain, retire);
  const position = stream(4), normal = stream(4), old = stream(8), color = stream(8);
  cache.beginDraw();
  cache.use('position', position);
  cache.use('normal', normal);
  cache.use('old', old);
  expect(cache.endDraw()).toBe(true);

  cache.beginDraw();
  expect(cache.get('position')).toBe(position);
  cache.use('color', color);
  expect(cache.get('color')).toBe(color);
  expect(cache.get('normal')).toBe(normal);
  expect(cache.endDraw()).toBe(true);

  expect(retire.mock.calls).toEqual([[old]]);
  expect(retain.mock.calls).toEqual([[position], [normal], [old], [color]]);
  cache.beginDraw();
  for (const [key, buffer] of [['position', position], ['normal', normal], ['color', color]] as const)
    expect(cache.get(key)).toBe(buffer);
  expect(cache.endDraw()).toBe(true);
});

it('skips new admission for a draw exceeding either budget', () => {
  const retain = vi.fn();
  const retire = vi.fn();
  const cache = new GeometryCache(16, 2, retain, retire);
  const small = stream(4);
  cache.beginDraw();
  cache.use('small', small);
  expect(cache.endDraw()).toBe(true);

  for (const lengths of [[8, 12], [4, 4, 4]]) {
    cache.beginDraw();
    lengths.forEach((length, index) => cache.use(String(index), stream(length)));
    expect(cache.endDraw()).toBe(false);
  }
  cache.beginDraw();
  expect(cache.get('small')).toBe(small);
  expect(cache.get('0')).toBeUndefined();
  expect(retain.mock.calls).toEqual([[small]]);
  expect(retire).not.toHaveBeenCalled();
});
