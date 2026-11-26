import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GL } from '@refral/core-api';
import { createRustBufferCore } from '../src/index';
import { runBufferCoreContract } from '../../../tests/core/buffer-contract';

let wasm: Uint8Array<ArrayBuffer>;
let sequence = 0;
const originalInstantiate = WebAssembly.instantiate;

beforeAll(async () => {
  try {
    wasm = new Uint8Array(await readFile(new URL(
      process.env.REFRAL_WASM_TEST_PATH ?? '../../../artifacts/core-wasm/refral_core.wasm', import.meta.url,
    )));
  } catch (error) {
    throw new Error('Build the real Rust core artifact with pnpm rust:build before test:wasm.', { cause: error });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function serveModule(): string {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(wasm, { headers: { 'content-type': 'application/wasm' } })));
  return `http://rust-core.test/${sequence++}.wasm`;
}

describe('real Rust/Wasm Buffer adapter', () => {
  it('passes the shared core contract against compiled Rust semantics', async () => {
    const url = serveModule();
    const result = await runBufferCoreContract((options) => createRustBufferCore(options, url));
    expect(result.core).toBe('rust');
    expect(result.evidence.checks.filter((check) => !check.passed)).toEqual([]);
  });

  it('refreshes arena views after memory growth and returns owned snapshots', async () => {
    const url = serveModule();
    let instance: WebAssembly.Instance | undefined;
    vi.spyOn(WebAssembly, 'instantiate').mockImplementation((async (module: WebAssembly.Module, imports?: WebAssembly.Imports) => {
      instance = await originalInstantiate(module, imports);
      return instance;
    }) as typeof WebAssembly.instantiate);
    const core = await createRustBufferCore({ contextId: 41, maxBufferBytes: 4 * 1024 * 1024 }, url);
    try {
      const buffer = core.createBuffer()!;
      core.bindBuffer(GL.ARRAY_BUFFER, buffer);
      const memory = instance!.exports.memory as WebAssembly.Memory;
      const originalMemory = memory.buffer;
      const input = new Uint8Array(2 * 1024 * 1024).fill(7);
      core.bufferData(GL.ARRAY_BUFFER, input, GL.DYNAMIC_DRAW);
      expect(memory.buffer).not.toBe(originalMemory);
      const first = core.inspectBuffer(buffer)!;
      expect(first.data).toHaveLength(input.length);
      expect(first.data[0]).toBe(7);
      expect(first.data.at(-1)).toBe(7);
      input.fill(0);
      memory.grow(1);
      core.bufferSubData(GL.ARRAY_BUFFER, input.length - 2, new Uint8Array([8, 9]));
      expect(first.data.at(-1)).toBe(7);
      const current = core.inspectBuffer(buffer)!;
      expect(Array.from(current.data.slice(-3))).toEqual([7, 8, 9]);
      current.data.fill(0);
      expect(core.inspectBuffer(buffer)!.data[0]).toBe(7);
      expect(core.getError()).toBe(GL.NO_ERROR);
    } finally {
      core.dispose();
    }
  });

  it('rejects malformed handles without i32 wrapping or exposing foreign state', async () => {
    const core = await createRustBufferCore({ contextId: 0xffff_ffff, maxBufferBytes: 16 }, serveModule());
    try {
      const buffer = core.createBuffer()!;
      core.bindBuffer(GL.ARRAY_BUFFER, buffer);
      core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2]), GL.STATIC_DRAW);
      for (const value of [0, -1, 1.5, Number.NaN, 0x1_0000_0001]) {
        const malformed = { ...buffer, slot: value };
        core.bindBuffer(GL.ARRAY_BUFFER, malformed);
        expect(core.getError()).toBe(GL.INVALID_OPERATION);
        expect(core.getBinding(GL.ARRAY_BUFFER_BINDING)).toEqual(buffer);
        expect(core.inspectBuffer(malformed)).toBeNull();
        expect(core.isBuffer(malformed)).toBe(false);
        expect(core.getError()).toBe(GL.NO_ERROR);
      }
    } finally {
      core.dispose();
    }
  });

  it('shares the compiled module while retaining independent instance state', async () => {
    const url = serveModule();
    const options = { contextId: 12, maxBufferBytes: 16 };
    const first = await createRustBufferCore(options, url);
    options.contextId = 13;
    options.maxBufferBytes = 8;
    const second = await createRustBufferCore(options, url);
    try {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(first.contextId).toBe(12);
      expect(first.maxBufferBytes).toBe(16);
      const firstBuffer = first.createBuffer()!;
      const secondBuffer = second.createBuffer()!;
      expect(Object.isFrozen(firstBuffer)).toBe(true);
      first.bindBuffer(GL.ARRAY_BUFFER, firstBuffer);
      first.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1]), GL.STATIC_DRAW);
      second.bindBuffer(GL.ARRAY_BUFFER, secondBuffer);
      second.bufferData(GL.ARRAY_BUFFER, new Uint8Array([2]), GL.STATIC_DRAW);
      expect(Array.from(first.inspectBuffer(firstBuffer)!.data)).toEqual([1]);
      expect(Array.from(second.inspectBuffer(secondBuffer)!.data)).toEqual([2]);
      first.markLost();
      expect(second.isContextLost()).toBe(false);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});
