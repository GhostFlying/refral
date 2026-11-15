import type { TargetSnapshot } from './execution.js';

/** WebIDL-normalized request. Destination storage remains owned by the facade. */
export interface ReadPixelsRequest {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly format: number;
  readonly type: number;
  readonly viewType: string | null;
  readonly byteLength: number;
}

/** Only the intersecting rectangle is copied. Other destination bytes retain their values. */
export interface ReadPixelsPlan {
  readonly target: TargetSnapshot;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly copyWidth: number;
  readonly copyHeight: number;
  readonly destinationOffset: number;
  readonly destinationStride: number;
  readonly requiredBytes: number;
}
