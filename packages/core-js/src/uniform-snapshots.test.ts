import { describe, expect, it } from 'vitest';
import { UniformSnapshots } from './uniform-snapshots.js';

describe('uniform snapshots', () => {
  it('packs exact source views and preserves old snapshots after caller mutation and page rollover', () => {
    const snapshots = new UniformSnapshots();
    const source = Uint8Array.of(99, 1, 2, 3, 4, 99);
    const retained = snapshots.copy(source.subarray(1, 5));
    const firstPageSize = retained.buffer.byteLength;
    expect(firstPageSize).toBe(4 * 1024);
    const tail = snapshots.copy(new Uint8Array(firstPageSize - 4).fill(5));
    expect(tail.buffer).toBe(retained.buffer);
    expect(tail.byteOffset + tail.byteLength).toBe(firstPageSize);

    source.fill(6);
    const next = snapshots.copy(source);
    expect(next.buffer).not.toBe(retained.buffer);
    expect(Array.from(retained)).toEqual([1, 2, 3, 4]);
    expect(tail[tail.byteLength - 1]).toBe(5);
    expect(Array.from(next)).toEqual([6, 6, 6, 6, 6, 6]);
  });

  it('isolates oversized snapshots and starts a small fresh page after clearing', () => {
    const snapshots = new UniformSnapshots();
    const first = snapshots.copy(Uint8Array.of(1));
    const source = new Uint8Array(64 * 1024 + 1).fill(9);
    const large = snapshots.copy(source);
    source.fill(0);
    expect(large.buffer.byteLength).toBe(large.byteLength);
    expect(large.buffer).not.toBe(source.buffer);
    const next = snapshots.copy(Uint8Array.of(2));
    expect(next.buffer).toBe(first.buffer);

    snapshots.clear();
    const fresh = snapshots.copy(Uint8Array.of(3));
    expect(fresh.buffer.byteLength).toBe(4 * 1024);
    expect(fresh.buffer).not.toBe(first.buffer);
    expect([first[0], next[0], large[0], large[large.length - 1]]).toEqual([1, 2, 9, 9]);
  });
});
