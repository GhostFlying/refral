import { GL } from "@refral/core-api";
import type { BufferCore, BufferCoreOptions, BufferHandle, BufferSnapshot } from "@refral/core-api";
import { SemanticContext } from "./context.js";
import { BufferObject } from "./resources.js";

const MAX_U32 = 0xffff_ffff;

interface BufferSlot {
  generation: number;
  buffer: BufferObject | null;
}

function isPositiveU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_U32;
}

/** Logical Buffer handles over the state used by the existing JS renderer. */
export class JsBufferCore implements BufferCore {
  readonly kind = "js";
  readonly contextId: number;
  readonly maxBufferBytes: number;
  private readonly slots = new Map<number, BufferSlot>();
  private readonly freeSlots: number[] = [];
  private readonly handles = new WeakMap<BufferObject, BufferHandle>();
  private nextSlot = 1;
  private disposed = false;

  constructor(private readonly core: SemanticContext, options: BufferCoreOptions) {
    if (!isPositiveU32(options.contextId)) throw new RangeError("Invalid context identifier.");
    this.contextId = options.contextId;
    core.setBufferByteLimit(options.maxBufferBytes);
    this.maxBufferBytes = options.maxBufferBytes;
  }

  private findSlot(handle: BufferHandle): BufferSlot | null {
    if (typeof handle !== "object" || handle === null || handle.kind !== "buffer" || handle.contextId !== this.contextId ||
        !isPositiveU32(handle.slot) || !isPositiveU32(handle.generation)) return null;
    return this.slots.get(handle.slot) ?? null;
  }

  private resolve(handle: BufferHandle): BufferObject | null {
    const slot = this.findSlot(handle);
    if (!slot) return null;
    return slot.generation === handle.generation && slot.buffer && !slot.buffer.deleted ? slot.buffer : null;
  }

  private invalidHandle(): void { this.core.recordError(GL.INVALID_OPERATION); }

  createBuffer(): BufferHandle | null {
    if (this.isContextLost()) return null;
    const slotNumber = this.freeSlots.pop() ?? this.nextSlot++;
    if (slotNumber > MAX_U32) {
      this.core.recordError(GL.OUT_OF_MEMORY);
      return null;
    }
    const previous = this.slots.get(slotNumber);
    const generation = (previous?.generation ?? 0) + 1;
    const buffer = this.core.createBuffer();
    if (!buffer) return null;
    const handle = Object.freeze({ kind: "buffer" as const, contextId: this.contextId, slot: slotNumber, generation });
    this.slots.set(slotNumber, { generation, buffer });
    this.handles.set(buffer, handle);
    return handle;
  }

  bindBuffer(target: number, handle: BufferHandle | null): void {
    if (this.isContextLost()) return;
    const buffer = handle === null ? null : this.resolve(handle);
    // WebGL validates the supplied object's ownership and liveness before target.
    if (handle !== null && !buffer) return this.invalidHandle();
    this.core.bindBuffer(target, buffer);
  }

  bufferData(target: number, data: number | Uint8Array | null, usage: number): void {
    this.core.bufferData(target, data, usage);
  }

  bufferSubData(target: number, offset: number, data: Uint8Array): void {
    this.core.bufferSubData(target, offset, data);
  }

  getBufferParameter(target: number, parameter: number): number | null {
    return this.core.getBufferParameter(target, parameter);
  }

  getBinding(parameter: number): BufferHandle | null {
    if (this.isContextLost()) return null;
    if (parameter !== GL.ARRAY_BUFFER_BINDING && parameter !== GL.ELEMENT_ARRAY_BUFFER_BINDING) {
      this.core.recordError(GL.INVALID_ENUM);
      return null;
    }
    return this.toHandle(this.core.getParameter(parameter));
  }

  deleteBuffer(handle: BufferHandle | null): void {
    if (this.isContextLost() || handle === null) return;
    const slot = this.findSlot(handle);
    if (!slot || handle.generation > slot.generation) return this.invalidHandle();
    // Every earlier generation in this slot was issued and deleted before reuse.
    if (handle.generation < slot.generation || slot.buffer === null) return;
    const buffer = slot.buffer;
    this.core.deleteBuffer(buffer);
    this.handles.delete(buffer);
    slot.buffer = null;
    // Exhausted generations retire the slot, so generation zero is never issued.
    if (slot.generation < MAX_U32) this.freeSlots.push(handle.slot);
  }

  isBuffer(handle: BufferHandle | null): boolean {
    if (this.isContextLost() || handle === null) return false;
    return this.core.isBuffer(this.resolve(handle));
  }

  /** Converts legacy attribute/binding query results without exposing their classes. */
  toHandle(value: unknown): BufferHandle | null {
    if (this.isContextLost() || !(value instanceof BufferObject)) return null;
    const handle = this.handles.get(value);
    return handle && this.resolve(handle) === value ? handle : null;
  }

  getError(): number { return this.core.getError(); }
  markLost(): boolean { return this.core.markLost(); }
  isContextLost(): boolean { return this.core.isContextLost(); }

  inspectBuffer(handle: BufferHandle): BufferSnapshot | null {
    if (this.isContextLost()) return null;
    const buffer = this.resolve(handle);
    if (!buffer) return null;
    const canonicalHandle = this.handles.get(buffer)!;
    return {
      handle: canonicalHandle,
      byteLength: buffer.data.byteLength,
      usage: buffer.usage,
      storageGeneration: buffer.generation,
      contentVersion: buffer.version,
      data: buffer.data.slice(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      if (!slot.buffer) continue;
      this.core.deleteBuffer(slot.buffer);
      // Loss may already have disabled semantic mutations; still release CPU storage.
      slot.buffer.data = new Uint8Array(0);
      this.handles.delete(slot.buffer);
      slot.buffer = null;
    }
    this.freeSlots.length = 0;
    this.markLost();
  }
}

export function createJsBufferCore(core: SemanticContext, options: BufferCoreOptions): JsBufferCore {
  return new JsBufferCore(core, options);
}
