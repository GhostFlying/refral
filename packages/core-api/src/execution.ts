import { GL } from "./gl.js";
import type { LinkedProgram } from "./compiler.js";
import type { TextureVersion } from './resources.js';

export interface DrawingSurface {
  readonly width: number;
  readonly height: number;
  /** Replay preceding draws before an observed canvas resize. Poll before queuing or replaying draws. */
  bindResizeBarrier?(replay: () => void): () => void;
}
export interface ContextAttributes {
  alpha?: boolean;
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: string;
  failIfMajorPerformanceCaveat?: boolean;
  desynchronized?: boolean;
}
export interface RuntimeProfile {
  vertexAttributes: number;
  vertexUniformVectors: number;
  fragmentUniformVectors: number;
  varyingVectors: number;
  vertexTextureUnits: number;
  fragmentTextureUnits: number;
  combinedTextureUnits: number;
}
export interface TextureStorage {
  texelFormat?: 'rgba32float' | 'rgba8unorm-srgb';
  reference?: TextureVersion;
  width: number;
  height: number;
  generation: number;
  opaque?: boolean;
  data?: Uint8Array;
  parent?: TextureStorage;
  mipSource?: TextureStorage;
  copy?: TextureCopy;
  update?: { x: number; y: number; width: number; height: number; data: Uint8Array };
}

export interface TextureParameters {
  minFilter: number;
  magFilter: number;
  wrapS: number;
  wrapT: number;
}

/** One physical vertex location. Each matrix column supplies its own vector input. */
export interface AttributeSnapshot {
  location: number;
  shaderType: number;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
  data: Uint8Array | null;
  /** Identifies immutable buffer bytes within this host. */
  bufferVersion?: string;
  constant: readonly number[];
}

export interface TargetSnapshot {
  color: TextureStorage | null;
  colorOpaque?: boolean;
  depth: { readonly id: number } | null;
  depthGeneration: number;
  depthFormat?: number;
  width: number;
  height: number;
  isDefault: boolean;
}

export interface TextureCopy {
  source: TargetSnapshot;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  format: number;
  type: number;
}

export interface StencilFaceState {
  func: number;
  reference: number;
  valueMask: number;
  writeMask: number;
  fail: number;
  depthFail: number;
  pass: number;
}

export interface RasterState {
  viewport: [number, number, number, number];
  scissor: [number, number, number, number];
  scissorTest: boolean;
  colorMask: [boolean, boolean, boolean, boolean];
  depthTest: boolean;
  depthMask: boolean;
  polygonOffsetFill: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  polygonOffsetClamp: number;
  depthClamp: boolean;
  depthFunc: number;
  depthRange: [number, number];
  stencilTest: boolean;
  stencilClear: number;
  stencilFront: StencilFaceState;
  stencilBack: StencilFaceState;
  blend: boolean;
  blendColor: [number, number, number, number];
  blendSrcRGB: number;
  blendDstRGB: number;
  blendSrcAlpha: number;
  blendDstAlpha: number;
  blendEquationRGB: number;
  blendEquationAlpha: number;
  cull: boolean;
  cullFace: number;
  frontFace: number;
}

export function createRasterState(width: number, height: number): RasterState {
  const stencil: StencilFaceState = { func: GL.ALWAYS, reference: 0, valueMask: 0xffff_ffff,
    writeMask: 0xffff_ffff, fail: GL.KEEP, depthFail: GL.KEEP, pass: GL.KEEP };
  return {
    viewport: [0, 0, width, height], scissor: [0, 0, width, height], scissorTest: false,
    colorMask: [true, true, true, true], depthTest: false, depthMask: true,
    polygonOffsetFill: false, polygonOffsetFactor: 0, polygonOffsetUnits: 0, polygonOffsetClamp: 0, depthClamp: false,
    depthFunc: GL.LESS, depthRange: [0, 1], stencilTest: false, stencilClear: 0,
    stencilFront: { ...stencil }, stencilBack: { ...stencil }, blend: false, blendColor: [0, 0, 0, 0],
    blendSrcRGB: GL.ONE, blendDstRGB: GL.ZERO, blendSrcAlpha: GL.ONE,
    blendDstAlpha: GL.ZERO, blendEquationRGB: GL.FUNC_ADD,
    blendEquationAlpha: GL.FUNC_ADD, cull: false, cullFace: GL.BACK, frontFace: GL.CCW,
  };
}

export function snapshotRaster(state: RasterState): RasterState {
  return {
    ...state,
    viewport: [...state.viewport], scissor: [...state.scissor],
    colorMask: [...state.colorMask], depthRange: [...state.depthRange],
    stencilFront: { ...state.stencilFront }, stencilBack: { ...state.stencilBack },
    blendColor: [...state.blendColor],
  };
}

export function stencilReference(value: number): number { return Math.max(0, Math.min(0xff, value)); }

export function isStencilRenderbufferFormat(format: number | undefined): boolean {
  return format === GL.STENCIL_INDEX8 || format === GL.DEPTH_STENCIL;
}

export function componentCount(type: number): number {
  switch (type) {
    case GL.FLOAT_VEC2: case GL.INT_VEC2: case GL.BOOL_VEC2: return 2;
    case GL.FLOAT_VEC3: case GL.INT_VEC3: case GL.BOOL_VEC3: return 3;
    case GL.FLOAT_VEC4: case GL.INT_VEC4: case GL.BOOL_VEC4: return 4;
    case GL.FLOAT_MAT2: return 4;
    case GL.FLOAT_MAT3: return 9;
    case GL.FLOAT_MAT4: return 16;
    default: return 1;
  }
}

export interface TextureBinding {
  storage: TextureStorage | null;
  parameters: TextureParameters;
  /** Missing dimension retains the legacy 2D binding. Cube faces use +X,-X,+Y,-Y,+Z,-Z. */
  dimension?: '2d' | 'cube';
  /** A complete cube contains six canonical image records. Missing faces denote incomplete sampling. */
  cubeFaces?: readonly TextureStorage[];
  /** Complete multilevel chains are level-major, with cube faces in CUBE_FACES order. */
  mipImages?: readonly TextureStorage[];
}

export type DrawMode = typeof GL.POINTS | typeof GL.LINES | typeof GL.LINE_LOOP | typeof GL.LINE_STRIP
  | typeof GL.TRIANGLES | typeof GL.TRIANGLE_STRIP | typeof GL.TRIANGLE_FAN;

export function isDrawMode(mode: number): mode is DrawMode {
  return Number.isInteger(mode) && mode >= GL.POINTS && mode <= GL.TRIANGLE_FAN;
}

export interface DrawOperation {
  program: LinkedProgram;
  mode: DrawMode;
  target: TargetSnapshot;
  state: RasterState;
  attributes: AttributeSnapshot[];
  vertexCount: number;
  count: number;
  first: number;
  indices: { data: Uint8Array; bufferVersion?: string; type: number; offset: number } | null;
  vertexUniforms: Uint8Array;
  fragmentUniforms: Uint8Array;
  textures: TextureBinding[];
}
export interface SemanticHost {
  readonly limits: { readonly maxTextureDimension2D: number; readonly maxBufferSize?: number };
  draw(operation: DrawOperation): void;
  clear(target: TargetSnapshot, state: RasterState, mask: number, color: readonly number[], depth: number): void;
  flush(): void;
  /** Return synchronously only after all preceding GL work has completed. */
  finish(): void;
  replaceStorage(previous: TextureStorage | null, next: TextureStorage): void;
  retireStorage(storage: TextureStorage): void;
  retireDepth(id: number, generation: number): void;
}
