import type {
  DrawOperation,
  LinkedProgram,
  RasterState,
  SemanticHost,
  TargetSnapshot,
  TextureStorage,
} from '@refral/core-api';
import { HEADER_BYTES, HEIGHT, LENGTH, PIXEL_CAPACITY, SEQUENCE, STATUS, WIDTH } from './protocol';
import type { Command, HostOperation, Ready, WireTarget } from './protocol';
import type { HostStats } from '@refral/browser-host';

export type WaitMode = 'spin' | 'wait';

export async function createRemoteHost(mode: WaitMode) {
  const shared = new SharedArrayBuffer(HEADER_BYTES + PIXEL_CAPACITY);
  const control = new Int32Array(shared, 0, 8);
  const timing = new Float64Array(shared, 32, 4);
  const pixels = new Uint8Array(shared, HEADER_BYTES);
  const worker = new Worker(new URL('./gpu-worker.ts', import.meta.url), { type: 'module' });
  let sequence = 0;
  let closed = false;
  let operations: HostOperation[] = [];
  let nextId = 1;
  const programIds = new WeakMap<LinkedProgram, number>();
  const storageIds = new WeakMap<TextureStorage, number>();

  function message<T>(kind: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Worker startup/disposal timed out.')), 15_000);
      const receive = (event: MessageEvent) => {
        if (event.data.kind === kind) finish(null, event.data);
        if (event.data.kind === 'error') finish(new Error(event.data.message));
      };
      const failure = (event: ErrorEvent) => finish(new Error(event.message));
      function finish(error: Error | null, value?: T) {
        clearTimeout(timeout);
        worker.removeEventListener('message', receive);
        worker.removeEventListener('error', failure);
        if (error) reject(error);
        else resolve(value!);
      }
      worker.addEventListener('message', receive);
      worker.addEventListener('error', failure);
    });
  }
  const initialized = message<Ready>('ready');
  worker.postMessage({ kind: 'init', shared } satisfies Command);
  let ready: Ready;
  try {
    ready = await initialized;
  } catch (error) {
    worker.terminate();
    throw error;
  }

  function program(value: LinkedProgram): number {
    let id = programIds.get(value);
    if (id !== undefined) return id;
    const snapshot = structuredClone(value);
    id = nextId++;
    operations.push({ kind: 'program', id, value: snapshot });
    programIds.set(value, id);
    return id;
  }
  function storage(value: TextureStorage): number {
    let id = storageIds.get(value);
    if (id !== undefined) return id;
    const data = value.data?.slice();
    const update = value.update ? structuredClone(value.update) : undefined;
    const parent = value.parent ? storage(value.parent) : undefined;
    id = nextId++;
    operations.push({
      kind: 'storage',
      id,
      width: value.width,
      height: value.height,
      generation: value.generation,
      data,
      parent,
      update,
    });
    storageIds.set(value, id);
    return id;
  }
  function target(value: TargetSnapshot): WireTarget {
    return {
      ...value,
      depth: value.depth ? { ...value.depth } : null,
      color: value.color ? storage(value.color) : null,
    };
  }
  function request(
    command:
      | { kind: 'capture'; operations: HostOperation[]; target: WireTarget }
      | { kind: 'failure' }
      | { kind: 'stall'; delayMs: number },
    timeoutMs = 5000
  ) {
    if (closed) throw new Error('Readback client is closed.');
    sequence++;
    Atomics.store(control, STATUS, 0);
    const started = performance.now();
    worker.postMessage({ ...command, sequence });
    while (Atomics.load(control, STATUS) === 0) {
      const remaining = timeoutMs - (performance.now() - started);
      if (remaining <= 0) {
        closed = true;
        worker.terminate();
        throw new Error('Synchronous readback timed out.');
      }
      if (mode === 'wait') Atomics.wait(control, STATUS, 0, remaining);
    }
    const status = Atomics.load(control, STATUS);
    const length = control[LENGTH]!;
    if (control[SEQUENCE] !== sequence || length < 0 || length > pixels.byteLength) {
      closed = true;
      worker.terminate();
      throw new Error('Invalid shared readback sequence or length.');
    }
    const data = pixels.slice(0, length);
    if (status === -1) throw new Error(new TextDecoder().decode(data));
    if (status !== 1) throw new Error('Invalid shared readback status.');
    return {
      data,
      sequence,
      width: control[WIDTH]!,
      height: control[HEIGHT]!,
      roundTripMs: performance.now() - started,
      workerExecutionMs: timing[0]!,
      workerCaptureMs: timing[1]!,
    };
  }

  const host: SemanticHost = {
    limits: ready.limits,
    draw(value: DrawOperation) {
      const programId = program(value.program);
      const drawTarget = target(value.target);
      const textures = value.textures.map((binding) => ({
        parameters: { ...binding.parameters },
        storage: binding.storage ? storage(binding.storage) : null,
      }));
      const snapshot = structuredClone({ ...value, program: programId, target: drawTarget, textures });
      operations.push({ kind: 'draw', value: snapshot });
    },
    clear(value: TargetSnapshot, state: RasterState, mask: number, color: readonly number[], depth: number) {
      operations.push({
        kind: 'clear',
        target: target(value),
        state: structuredClone(state),
        mask,
        color: [...color],
        depth,
      });
    },
    flush() {
      operations.push({ kind: 'flush' });
    },
    replaceStorage(previous: TextureStorage | null, next: TextureStorage) {
      const previousId = previous ? storage(previous) : null;
      operations.push({ kind: 'replace', previous: previousId, next: storage(next) });
      delete next.parent;
      delete next.update;
    },
    retireStorage(value: TextureStorage) {
      operations.push({ kind: 'retire-storage', id: storage(value) });
    },
    retireDepth(id: number, generation: number) {
      operations.push({ kind: 'retire-depth', id, generation });
    },
  };
  return {
    host,
    environment: ready.environment,
    resize(width: number, height: number) {
      operations.push({ kind: 'resize', width, height });
    },
    capture(value: TargetSnapshot) {
      const captureTarget = target(value);
      const batch = operations;
      operations = [];
      return request({ kind: 'capture', operations: batch, target: captureTarget });
    },
    injectFailure() {
      request({ kind: 'failure' });
    },
    timeout() {
      request({ kind: 'stall', delayMs: 100 }, 5);
    },
    async inspect() {
      if (closed) throw new Error('Readback client is closed.');
      const reply = message<{ stats: HostStats; errors: string[]; canvas: null }>('inspection');
      worker.postMessage({ kind: 'inspect' } satisfies Command);
      return reply;
    },
    async dispose() {
      operations = [];
      if (closed) return;
      closed = true;
      const disposed = message('disposed');
      worker.postMessage({ kind: 'dispose' } satisfies Command);
      try {
        await disposed;
      } finally {
        worker.terminate();
      }
    },
  };
}
