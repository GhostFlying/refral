export const COMMAND_WORDS = 8;
export const RECORD_WORDS = 12;
const MAX_COMMANDS = 8192;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const OPERATIONS = { uniform: 1, pipeline: 2, layout: 3, storage: 4, upload: 5, draw: 6 };

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

export function createTrace(scene, { draws = 512, seed = 0x7f4a7c15 } = {}) {
  if (!Number.isInteger(draws) || draws < 1 || draws > 1800) {
    throw new RangeError('draws must be an integer from 1 through 1800');
  }
  if (!['uniform-draws', 'state-cache', 'dynamic-upload'].includes(scene)) {
    throw new TypeError(`Unknown selection scene ${scene}`);
  }
  const random = createRandom(seed);
  const commands = [];
  const payload = [];
  let uploadedBytes = 0;
  const append = (operation, ...args) => {
    commands.push(operation, ...Array.from({ length: 7 }, (_, index) => args[index] ?? 0));
  };
  const upload = (length) => {
    const offset = payload.length;
    for (let index = 0; index < length; index++) payload.push(random() & 255);
    append(OPERATIONS.upload, offset, length);
    uploadedBytes += length;
  };
  append(OPERATIONS.storage);
  if (scene === 'dynamic-upload') upload(65536);
  for (let index = 0; index < draws; index++) {
    append(OPERATIONS.uniform, random() & 255, random() & 255, random() & 255, 255);
    if (scene === 'state-cache') {
      append(OPERATIONS.pipeline, random() & 31);
      append(OPERATIONS.layout, random() & 7);
    }
    if (scene === 'dynamic-upload') {
      if (index % 64 === 0) append(OPERATIONS.storage);
      upload(64);
    }
    append(OPERATIONS.draw);
  }
  return {
    scene,
    seed,
    draws,
    commands: new Uint32Array(commands),
    payload: new Uint8Array(payload),
    uploadedBytes,
  };
}

export function createJsCore() {
  const output = new Uint32Array(MAX_COMMANDS * RECORD_WORDS);
  const cache = new Uint8Array(256);
  const color = new Uint32Array(4);
  return {
    replay(trace) {
      cache.fill(0);
      color.set([0, 0, 0, 255]);
      let pipeline = 0;
      let layout = 0;
      let storageGeneration = 0;
      let contentVersion = 0;
      let bufferChecksum = 0;
      let uploadedBytes = 0;
      let misses = 0;
      let outputWords = 0;
      const commands = trace.commands;
      for (let offset = 0; offset < commands.length; offset += COMMAND_WORDS) {
        switch (commands[offset]) {
          case OPERATIONS.uniform:
            for (let component = 0; component < 4; component++) color[component] = commands[offset + component + 1];
            break;
          case OPERATIONS.pipeline:
            pipeline = commands[offset + 1];
            if (pipeline >= 32) throw new RangeError('Pipeline key out of range');
            break;
          case OPERATIONS.layout:
            layout = commands[offset + 1];
            if (layout >= 8) throw new RangeError('Layout key out of range');
            break;
          case OPERATIONS.storage:
            storageGeneration++;
            contentVersion++;
            bufferChecksum = 0;
            break;
          case OPERATIONS.upload: {
            const start = commands[offset + 1];
            const length = commands[offset + 2];
            if (start + length > trace.payload.length) throw new RangeError('Upload outside payload');
            let checksum = 2166136261;
            for (let index = start; index < start + length; index++) {
              checksum = Math.imul(checksum ^ trace.payload[index], 16777619) >>> 0;
            }
            bufferChecksum = checksum;
            contentVersion++;
            uploadedBytes += length;
            break;
          }
          case OPERATIONS.draw: {
            const key = pipeline * 8 + layout;
            if (!cache[key]) {
              cache[key] = 1;
              misses++;
            }
            output.set(color, outputWords);
            output[outputWords + 4] = pipeline;
            output[outputWords + 5] = layout;
            output[outputWords + 6] = storageGeneration;
            output[outputWords + 7] = contentVersion;
            output[outputWords + 8] = bufferChecksum;
            output[outputWords + 9] = uploadedBytes;
            output[outputWords + 10] = misses;
            output[outputWords + 11] = outputWords / RECORD_WORDS;
            outputWords += RECORD_WORDS;
            break;
          }
          default:
            throw new TypeError('Unknown core operation');
        }
      }
      return output.subarray(0, outputWords);
    },
  };
}

export async function createWasmCore(bytes, { mode = 'per-call' } = {}) {
  if (!['per-call', 'batch'].includes(mode)) throw new TypeError(`Unknown Wasm mode ${mode}`);
  const start = performance.now();
  const instantiated = await WebAssembly.instantiate(bytes, {});
  const instance = instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;
  const coldStartMs = performance.now() - start;
  const exports = instance.exports;
  const commandArena = new Uint32Array(exports.memory.buffer, exports.commands_pointer(), MAX_COMMANDS * COMMAND_WORDS);
  const payloadArena = new Uint8Array(exports.memory.buffer, exports.payload_pointer(), MAX_PAYLOAD_BYTES);
  const outputArena = new Uint32Array(exports.memory.buffer, exports.output_pointer(), MAX_COMMANDS * RECORD_WORDS);
  return {
    coldStartMs,
    memoryBytes: exports.memory.buffer.byteLength,
    replay(trace) {
      if (trace.commands.length > commandArena.length || trace.payload.length > payloadArena.length) {
        throw new RangeError('Trace exceeds Wasm arena capacity');
      }
      payloadArena.set(trace.payload);
      if (mode === 'batch') {
        commandArena.set(trace.commands);
        exports.replay(trace.commands.length / COMMAND_WORDS, trace.payload.length);
      } else {
        exports.reset(trace.payload.length);
        for (let offset = 0; offset < trace.commands.length; offset += COMMAND_WORDS) {
          exports.command(
            trace.commands[offset], trace.commands[offset + 1], trace.commands[offset + 2], trace.commands[offset + 3],
            trace.commands[offset + 4], trace.commands[offset + 5], trace.commands[offset + 6], trace.commands[offset + 7],
          );
        }
      }
      if (exports.status() !== 0) throw new Error(`Wasm replay failed with status ${exports.status()}`);
      return outputArena.subarray(0, exports.output_words());
    },
  };
}

// All paths cross into this same JS host consumer after each trace replay.
export function consumeSnapshots(output) {
  let checksum = 2166136261;
  for (let offset = 0; offset < output.length; offset++) {
    checksum = Math.imul(checksum ^ output[offset], 16777619) >>> 0;
  }
  return checksum;
}

function assertEquivalent(expected, actual, label) {
  if (actual.length !== expected.length) throw new Error(`${label} output length mismatch`);
  for (let index = 0; index < expected.length; index++) {
    if (actual[index] !== expected[index]) throw new Error(`${label} mismatch at word ${index}`);
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export async function runSelection(wasmBytes, options = {}) {
  const configuration = {
    draws: options.draws ?? 512,
    rounds: options.rounds ?? 5,
    warmup: options.warmup ?? 20,
    samples: options.samples ?? 60,
    iterationsPerSample: options.iterationsPerSample ?? 128,
    seed: options.seed ?? 0x7f4a7c15,
  };
  for (const key of ['rounds', 'samples', 'iterationsPerSample']) {
    if (!Number.isInteger(configuration[key]) || configuration[key] < 1) throw new RangeError(`${key} must be positive`);
  }
  if (!Number.isInteger(configuration.warmup) || configuration.warmup < 0) throw new RangeError('warmup must be nonnegative');
  const jsStart = performance.now();
  const jsCore = createJsCore();
  const jsColdStartMs = performance.now() - jsStart;
  const compileStart = performance.now();
  const module = await WebAssembly.compile(wasmBytes);
  const wasmCompileMs = performance.now() - compileStart;
  const wasmPerCall = await createWasmCore(module);
  const wasmBatch = await createWasmCore(module, { mode: 'batch' });
  const paths = [
    { path: 'javascript', core: jsCore, coldStartMs: jsColdStartMs },
    { path: 'rust-wasm-per-call', core: wasmPerCall, coldStartMs: wasmPerCall.coldStartMs },
    { path: 'rust-wasm-batch', core: wasmBatch, coldStartMs: wasmBatch.coldStartMs },
  ];
  const records = [];
  let sink = 0;
  for (const scene of ['uniform-draws', 'state-cache', 'dynamic-upload']) {
    const trace = createTrace(scene, configuration);
    const expected = jsCore.replay(trace).slice();
    const expectedChecksum = consumeSnapshots(expected);
    const samplesByPath = Object.fromEntries(paths.map(({ path }) => [path, []]));
    for (const { path, core } of paths) {
      assertEquivalent(expected, core.replay(trace), `${scene}/${path}`);
      for (let iteration = 0; iteration < configuration.warmup; iteration++) sink ^= consumeSnapshots(core.replay(trace));
    }
    for (let round = 0; round < configuration.rounds; round++) {
      for (let sample = 0; sample < configuration.samples; sample++) {
        const order = paths.map((_, index) => paths[(round + sample + index) % paths.length]);
        for (const { path, core } of order) {
          const start = performance.now();
          for (let iteration = 0; iteration < configuration.iterationsPerSample; iteration++) {
            const checksum = consumeSnapshots(core.replay(trace));
            if (checksum !== expectedChecksum) throw new Error(`${scene}/${path} changed output during timing`);
            sink ^= checksum;
          }
          samplesByPath[path].push({ round, sample, ms: (performance.now() - start) / configuration.iterationsPerSample });
        }
      }
    }
    for (const { path, coldStartMs, core } of paths) {
      const rawSamples = samplesByPath[path];
      const times = rawSamples.map(({ ms }) => ms);
      records.push({
        scene,
        path,
        correct: true,
        snapshotWords: expected.length,
        snapshotChecksum: expectedChecksum,
        commandCount: trace.commands.length / COMMAND_WORDS,
        payloadBytes: trace.payload.length,
        uploadedBytes: trace.uploadedBytes,
        cpuInputCopyBytes: path === 'javascript' ? 0 : trace.payload.byteLength + (path.endsWith('batch') ? trace.commands.byteLength : 0),
        coldStartMs,
        wasmMemoryBytes: core.memoryBytes ?? null,
        p50Ms: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
        rawSamples,
      });
    }
  }
  return {
    configuration,
    sampleOrdering: 'rotate paths for each sample within each round',
    wasmBytes: wasmBytes.byteLength,
    wasmCompileMs,
    sink: sink >>> 0,
    records,
    limitations: [
      'This bounded trace benchmark covers state updates, snapshot emission, pipeline-key cache metadata, and upload-byte consumption.',
      'The pre-recorded input trace excludes application-side trace construction and a full WebGL object/validation implementation.',
      'The timed common JS host computes a checksum. Browser GPU proof is recorded separately from CPU selection measurements.',
      'Wasm upload input includes a measured copy into linear memory. A production direct-host upload path can have different costs.',
      'Wasm batch replay includes copying the pre-recorded command stream and requires a production input-batching design.',
      'Wasm compilation is measured once separately. Per-path coldStartMs measures core construction and Wasm module instantiation.',
      'No GPU duration, driver VRAM, native engine integration, or CTS compliance is established by these samples.',
    ],
  };
}
