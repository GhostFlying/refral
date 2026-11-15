import type { DrawingCore } from '@refral/core-api';
import type { BrowserHost } from '@refral/browser-host';
import { bufferSourceBytes, requireArguments, toEnum } from './buffers.js';

const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const viewName = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;

/** Convert the public WebIDL arguments before semantic validation in the selected core. */
export function readPixels(core: DrawingCore, host: BrowserHost, args: readonly unknown[]): void {
  requireArguments('readPixels', args, 7);
  const x = +(args[0] as number) | 0;
  const y = +(args[1] as number) | 0;
  const width = +(args[2] as number) | 0;
  const height = +(args[3] as number) | 0;
  const format = toEnum(args[4]);
  const type = toEnum(args[5]);
  const destination = args[6];
  let bytes: Uint8Array | null = null;
  let viewType: string | null = null;
  if (destination !== null && destination !== undefined) {
    if (!ArrayBuffer.isView(destination)) throw new TypeError('readPixels requires an ArrayBufferView.');
    bytes = bufferSourceBytes(destination, true);
    viewType = viewName.call(destination) ?? 'DataView';
  }
  const plan = core.prepareReadPixels({ x, y, width, height, format, type,
    viewType, byteLength: bytes?.byteLength ?? 0 });
  if (!plan || !plan.copyWidth || !plan.copyHeight) return;
  const captured = host.captureCanvas(plan.target, {
    x: plan.sourceX, y: plan.sourceY, width: plan.copyWidth, height: plan.copyHeight,
  });
  const rowBytes = plan.copyWidth * 4;
  for (let row = 0; row < plan.copyHeight; row++) {
    bytes!.set(captured.data.subarray(row * rowBytes, (row + 1) * rowBytes),
      plan.destinationOffset + row * plan.destinationStride);
  }
}
