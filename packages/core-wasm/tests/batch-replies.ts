import { vi } from 'vitest';

/** Inspect the real encoder's ordered output before the adapter consumes it. */
export function observeBatchDraws<T>(create: () => T, options: {
  legacy?: boolean;
  direct?: boolean;
  supported?: number;
  editTag?: (tag: number) => number;
} = {}) {
  const batches: { compact: boolean; supported?: number; tags: number[] }[] = [];
  const prototype = WebAssembly.Instance.prototype;
  const getExports = Object.getOwnPropertyDescriptor(prototype, 'exports')!.get!;
  const spy = vi.spyOn(prototype, 'exports', 'get').mockImplementationOnce(function (this: WebAssembly.Instance) {
    const raw: WebAssembly.Exports = getExports.call(this);
    const wrapped = { ...raw };
    if (options.legacy) delete wrapped.rf_batch_run_compact;
    if (options.direct) delete wrapped.rf_batch_protocol_version;
    for (const name of ['rf_batch_run', 'rf_batch_run_compact']) {
      const run = wrapped[name];
      if (typeof run !== 'function') continue;
      wrapped[name] = (...args: number[]) => {
        if (name === 'rf_batch_run_compact' && options.supported !== undefined)
          args[3] = options.supported;
        const length = run(...args) >>> 0;
        if (!length || length === 0xffff_ffff) return length;
        const pointer = (raw.rf_batch_output_pointer as () => number)();
        const records = new DataView((raw.memory as WebAssembly.Memory).buffer, pointer, length);
        const tags: number[] = [];
        for (let offset = 0; offset < length;) {
          const kind = records.getUint32(offset, true);
          const size = records.getUint32(offset + 4, true);
          if (kind === 1) {
            // Each record has an eight-byte header. The draw starts with its magic and version.
            const tagOffset = offset + 12;
            const tag = records.getUint32(tagOffset, true);
            tags.push(tag);
            if (options.editTag) records.setUint32(tagOffset, options.editTag(tag), true);
          }
          offset += 8 + size;
        }
        if (tags.length) batches.push({ compact: name === 'rf_batch_run_compact', supported: args[3], tags });
        return length;
      };
    }
    return wrapped;
  });
  try { return { state: create(), batches }; }
  finally { spy.mockRestore(); }
}
