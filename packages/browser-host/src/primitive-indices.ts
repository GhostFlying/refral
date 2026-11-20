import { GL, elementIndexBytes, readElementIndex } from '@refral/core-api';
import type { DrawOperation } from '@refral/core-api';

// WebGPU has no line-loop or triangle-fan topology. Emit bounded list draws
// so a large GL draw never needs one index allocation proportional to count.
export function* primitiveIndexBatches(
  mode: typeof GL.LINE_LOOP | typeof GL.TRIANGLE_FAN,
  first: number,
  count: number,
  indices: DrawOperation['indices'],
): Generator<Uint32Array<ArrayBuffer>> {
  const loop = mode === GL.LINE_LOOP;
  if (count < (loop ? 2 : 3)) return;
  const view = indices && new DataView(indices.data.buffer, indices.data.byteOffset, indices.data.byteLength);
  const vertex = (i: number) => {
    if (!indices || !view) return first + i;
    const bytes = elementIndexBytes(indices.type);
    return readElementIndex(view, indices.offset + i * bytes, bytes);
  };
  const primitives = loop ? count : count - 2;
  const anchor = vertex(0);
  const batchSize = 8192;
  for (let start = 0; start < primitives; start += batchSize) {
    const length = Math.min(batchSize, primitives - start);
    const batch = new Uint32Array(length * (loop ? 2 : 3));
    let offset = 0;
    for (let i = start; i < start + length; i++) {
      if (loop) {
        batch[offset++] = vertex(i);
        batch[offset++] = i + 1 === count ? anchor : vertex(i + 1);
      } else {
        batch[offset++] = anchor;
        batch[offset++] = vertex(i + 1);
        batch[offset++] = vertex(i + 2);
      }
    }
    yield batch;
  }
}
