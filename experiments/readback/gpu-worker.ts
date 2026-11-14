/// <reference lib="webworker" />
import { BrowserHost } from '@refral/browser-host';
import type { LinkedProgram, TargetSnapshot, TextureStorage } from '@refral/core-api';
import { HEADER_BYTES, HEIGHT, LENGTH, SEQUENCE, STATUS, WIDTH } from './protocol';
import type { Command, HostOperation, WireTarget } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const canvas = new OffscreenCanvas(64, 64);
let host: BrowserHost;
let control: Int32Array;
let timing: Float64Array;
let pixels: Uint8Array;
const programs = new Map<number, LinkedProgram>();
const storages = new Map<number, TextureStorage>();

function storage(id: number): TextureStorage {
  const result = storages.get(id);
  if (!result) throw new Error('Unknown worker texture storage.');
  return result;
}

function target(value: WireTarget): TargetSnapshot {
  return { ...value, color: value.color === null ? null : storage(value.color) };
}

function execute(operation: HostOperation): void {
  switch (operation.kind) {
    case 'program':
      programs.set(operation.id, operation.value);
      return;
    case 'storage': {
      storages.set(operation.id, {
        ...operation,
        parent: operation.parent === undefined ? undefined : storage(operation.parent),
      });
      return;
    }
    case 'draw': {
      const program = programs.get(operation.value.program);
      if (!program) throw new Error('Unknown worker executable.');
      host.draw({
        ...operation.value,
        program,
        target: target(operation.value.target),
        textures: operation.value.textures.map((binding) => ({
          ...binding,
          storage: binding.storage === null ? null : storage(binding.storage),
        })),
      });
      return;
    }
    case 'clear':
      host.clear(target(operation.target), operation.state, operation.mask, operation.color, operation.depth);
      return;
    case 'replace': {
      host.replaceStorage(operation.previous === null ? null : storage(operation.previous), storage(operation.next));
      if (operation.previous !== null) storages.delete(operation.previous);
      return;
    }
    case 'retire-storage':
      host.retireStorage(storage(operation.id));
      storages.delete(operation.id);
      return;
    case 'retire-depth':
      host.retireDepth(operation.id, operation.generation);
      return;
    case 'resize':
      if (canvas.width !== operation.width) canvas.width = operation.width;
      if (canvas.height !== operation.height) canvas.height = operation.height;
      return;
    case 'flush':
      host.flush();
      return;
  }
}

function publish(sequence: number, status: number, data: Uint8Array, width = 0, height = 0): void {
  if (data.byteLength > pixels.byteLength) throw new Error('Shared reply capacity exceeded.');
  pixels.set(data);
  control[LENGTH] = data.byteLength;
  control[WIDTH] = width;
  control[HEIGHT] = height;
  control[SEQUENCE] = sequence;
  Atomics.store(control, STATUS, status);
  Atomics.notify(control, STATUS);
}

async function handle(command: Command): Promise<void> {
  if (command.kind === 'init') {
    control = new Int32Array(command.shared, 0, 8);
    timing = new Float64Array(command.shared, 32, 4);
    pixels = new Uint8Array(command.shared, HEADER_BYTES);
    // The existing executor uses width/height/getContext, all available on OffscreenCanvas.
    host = await BrowserHost.create(canvas as unknown as HTMLCanvasElement, { alpha: false, depth: true });
    scope.postMessage({
      kind: 'ready',
      environment: host.environment,
      limits: { maxTextureDimension2D: host.limits.maxTextureDimension2D, maxBufferSize: host.limits.maxBufferSize },
    });
    return;
  }
  if (command.kind === 'dispose') {
    await host.dispose();
    storages.clear();
    programs.clear();
    scope.postMessage({ kind: 'disposed' });
    return;
  }
  try {
    if (command.kind === 'failure') throw new Error('Injected worker readback failure.');
    if (command.kind === 'stall') {
      await new Promise((resolve) => setTimeout(resolve, command.delayMs));
      publish(command.sequence, 1, new Uint8Array());
      return;
    }
    const started = performance.now();
    for (const operation of command.operations) execute(operation);
    const encoded = performance.now();
    const captured = await host.capture(target(command.target));
    timing[0] = encoded - started;
    timing[1] = performance.now() - encoded;
    if (host.errors.length) throw new Error(host.errors.join('\n'));
    publish(command.sequence, 1, captured.data, captured.width, captured.height);
  } catch (error) {
    const message = error instanceof Error ? error.name + ': ' + error.message : String(error);
    publish(command.sequence, -1, new TextEncoder().encode(message));
  }
}

let pending = Promise.resolve();
scope.onmessage = (event: MessageEvent<Command>) => {
  pending = pending
    .then(() => handle(event.data))
    .catch((error) => {
      scope.postMessage({ kind: 'error', message: String(error) });
    });
};
