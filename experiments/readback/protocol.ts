import type { DrawOperation, LinkedProgram, RasterState, TargetSnapshot, TextureParameters } from '@refral/core-api';

export const HEADER_BYTES = 64;
export const MAX_WIDTH = 320;
export const MAX_HEIGHT = 240;
export const PIXEL_CAPACITY = MAX_WIDTH * MAX_HEIGHT * 4;
export const STATUS = 0;
export const SEQUENCE = 1;
export const LENGTH = 2;
export const WIDTH = 3;
export const HEIGHT = 4;

export interface WireTarget extends Omit<TargetSnapshot, 'color'> {
  color: number | null;
}
export interface WireDraw extends Omit<DrawOperation, 'program' | 'target' | 'textures'> {
  program: number;
  target: WireTarget;
  textures: { storage: number | null; parameters: TextureParameters }[];
}
export type HostOperation =
  | { kind: 'program'; id: number; value: LinkedProgram }
  | {
      kind: 'storage';
      id: number;
      width: number;
      height: number;
      generation: number;
      data?: Uint8Array;
      parent?: number;
      update?: { x: number; y: number; width: number; height: number; data: Uint8Array };
    }
  | { kind: 'draw'; value: WireDraw }
  | { kind: 'clear'; target: WireTarget; state: RasterState; mask: number; color: number[]; depth: number }
  | { kind: 'replace'; previous: number | null; next: number }
  | { kind: 'retire-storage'; id: number }
  | { kind: 'retire-depth'; id: number; generation: number }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'flush' };

export type Command =
  | { kind: 'init'; shared: SharedArrayBuffer }
  | { kind: 'capture'; sequence: number; operations: HostOperation[]; target: WireTarget }
  | { kind: 'failure'; sequence: number }
  | { kind: 'stall'; sequence: number; delayMs: number }
  | { kind: 'dispose' };

export interface Ready {
  environment: Record<string, unknown>;
  limits: { maxTextureDimension2D: number; maxBufferSize: number };
}

export interface ReadbackSample {
  sequence: number;
  width: number;
  height: number;
  target: 'default' | 'fbo';
  byteLength: number;
  roundTripMs: number;
  clientEncodingMs: number;
  frameAndReadbackMs: number;
  workerExecutionMs: number;
  workerCaptureMs: number;
  mismatchedChannels: number;
  checksum: number;
}
