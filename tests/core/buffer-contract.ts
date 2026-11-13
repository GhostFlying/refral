import { allocateContextId, GL } from '@refral/core-api';
import type { BufferCore, BufferCoreOptions } from '@refral/core-api';
import { check, createBufferEvidence } from './buffer-fixtures';

export type BufferCoreFactory = (options: BufferCoreOptions) => BufferCore | Promise<BufferCore>;

/** Logical-handle and allocation checks with no DOM, compiler, GPU, or facade dependency. */
export async function runBufferCoreContract(create: BufferCoreFactory) {
  const core = await create({ contextId: allocateContextId(), maxBufferBytes: 8 });
  const peer = await create({ contextId: allocateContextId(), maxBufferBytes: 8 });
  const evidence = createBufferEvidence();
  try {
    const first = core.createBuffer()!;
    check(evidence, 'handle context ownership', first.contextId, core.contextId);
    check(evidence, 'handle positive slot', first.slot > 0, true);
    check(evidence, 'handle positive generation', first.generation > 0, true);
    check(evidence, 'direct unbound isBuffer', core.isBuffer(first), false);
    core.bindBuffer(GL.ARRAY_BUFFER, first);
    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4]), GL.STATIC_DRAW);
    const before = core.inspectBuffer(first)!;
    core.bufferData(GL.ARRAY_BUFFER, 9, GL.DYNAMIC_DRAW);
    check(evidence, 'host buffer limit error', core.getError(), GL.OUT_OF_MEMORY);
    check(evidence, 'failed allocation snapshot retained', core.inspectBuffer(first), before);
    core.bufferData(GL.ARRAY_BUFFER, 0x1_0000_0000, GL.STATIC_DRAW);
    check(evidence, 'large allocation checked before u32 wrap', core.getError(), GL.OUT_OF_MEMORY);
    check(evidence, 'large allocation retains data', Array.from(core.inspectBuffer(first)!.data), [1, 2, 3, 4]);
    before.data.fill(0);
    check(evidence, 'direct inspection owns bytes', Array.from(core.inspectBuffer(first)!.data), [1, 2, 3, 4]);
    core.bindBuffer(0xdead, null);
    core.inspectBuffer(first);
    check(evidence, 'direct inspection retains error', core.getError(), GL.INVALID_ENUM);

    core.deleteBuffer(first);
    check(evidence, 'delete clears logical binding', core.getBinding(GL.ARRAY_BUFFER_BINDING), null);
    const replacement = core.createBuffer()!;
    check(evidence, 'deleted slot reused', replacement.slot, first.slot);
    check(evidence, 'reused slot generation increments', replacement.generation, first.generation + 1);
    check(evidence, 'reused slot context unchanged', replacement.contextId, first.contextId);
    core.bindBuffer(GL.ARRAY_BUFFER, replacement);
    core.bufferData(GL.ARRAY_BUFFER, new Uint8Array([8, 7]), GL.DYNAMIC_DRAW);
    core.bindBuffer(GL.ARRAY_BUFFER, first);
    check(evidence, 'stale bind rejected', core.getError(), GL.INVALID_OPERATION);
    check(evidence, 'stale bind retains replacement', core.getBinding(GL.ARRAY_BUFFER_BINDING), replacement);
    core.deleteBuffer(first);
    core.deleteBuffer(first);
    check(evidence, 'stale repeated delete no error', core.getError(), GL.NO_ERROR);
    check(evidence, 'stale deletion retains replacement', core.isBuffer(replacement), true);
    check(evidence, 'stale isBuffer neutral', core.isBuffer(first), false);
    check(evidence, 'stale inspection null', core.inspectBuffer(first), null);
    check(evidence, 'stale queries preserve error state', core.getError(), GL.NO_ERROR);
    check(evidence, 'stale deletion retains replacement bytes', Array.from(core.inspectBuffer(replacement)!.data), [8, 7]);

    const foreign = peer.createBuffer()!;
    peer.bindBuffer(GL.ARRAY_BUFFER, foreign);
    core.bindBuffer(0xdead, foreign);
    check(evidence, 'foreign handle checked before target', core.getError(), GL.INVALID_OPERATION);
    check(evidence, 'foreign logical binding retained', core.getBinding(GL.ARRAY_BUFFER_BINDING), replacement);
    check(evidence, 'foreign logical inspection null', core.inspectBuffer(foreign), null);
    core.deleteBuffer(foreign);
    check(evidence, 'foreign logical delete rejected', core.getError(), GL.INVALID_OPERATION);
    check(evidence, 'peer handle survives foreign delete', peer.isBuffer(foreign), true);

    core.bindBuffer(0xdead, null);
    check(evidence, 'first markLost transition', core.markLost(), true);
    check(evidence, 'repeated markLost no transition', core.markLost(), false);
    check(evidence, 'loss replaces earlier error', core.getError(), GL.CONTEXT_LOST_WEBGL);
    check(evidence, 'loss error once', core.getError(), GL.NO_ERROR);
    check(evidence, 'direct lost flag', core.isContextLost(), true);
    check(evidence, 'direct lost create', core.createBuffer(), null);
    check(evidence, 'direct lost binding', core.getBinding(GL.ARRAY_BUFFER_BINDING), null);
    check(evidence, 'direct lost inspection', core.inspectBuffer(replacement), null);
    core.bindBuffer(0xdead, replacement);
    core.bufferData(0xdead, -1, 0xdead);
    core.bufferSubData(0xdead, -1, new Uint8Array([1]));
    check(evidence, 'direct lost mutations ignored', core.getError(), GL.NO_ERROR);
    return { core: core.kind, evidence };
  } finally {
    core.dispose();
    core.dispose();
    peer.dispose();
  }
}
