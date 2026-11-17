import { GL } from "./gl.js";
import type { LinkedProgram } from "./compiler.js";
import type { TextureVersion } from './resources.js';

export interface DrawingSurface { readonly width: number; readonly height: number }
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
  reference?: TextureVersion;
  width: number;
  height: number;
  generation: number;
  data?: Uint8Array;
  parent?: TextureStorage;
  update?: { x: number; y: number; width: number; height: number; data: Uint8Array };
}

export interface TextureParameters {
  minFilter: number;
  magFilter: number;
  wrapS: number;
  wrapT: number;
}

export interface AttributeSnapshot {
  location: number;
  shaderType: number;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
  data: Uint8Array | null;
  constant: readonly number[];
}

export interface TargetSnapshot {
  color: TextureStorage | null;
  depth: { readonly id: number } | null;
  depthGeneration: number;
  width: number;
  height: number;
  isDefault: boolean;
}

export interface RasterState {
  viewport: [number, number, number, number];
  scissor: [number, number, number, number];
  scissorTest: boolean;
  colorMask: [boolean, boolean, boolean, boolean];
  depthTest: boolean;
  depthMask: boolean;
  depthFunc: number;
  depthRange: [number, number];
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
  return {
    viewport: [0, 0, width, height], scissor: [0, 0, width, height], scissorTest: false,
    colorMask: [true, true, true, true], depthTest: false, depthMask: true,
    depthFunc: GL.LESS, depthRange: [0, 1], blend: false, blendColor: [0, 0, 0, 0],
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
    blendColor: [...state.blendColor],
  };
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
}

export interface DrawOperation {
  program: LinkedProgram;
  mode: typeof GL.TRIANGLES | typeof GL.TRIANGLE_STRIP;
  target: TargetSnapshot;
  state: RasterState;
  attributes: AttributeSnapshot[];
  vertexCount: number;
  count: number;
  first: number;
  indices: { data: Uint8Array; type: number; offset: number } | null;
  vertexUniforms: Uint8Array;
  fragmentUniforms: Uint8Array;
  textures: TextureBinding[];
}
export interface SemanticHost {
  readonly limits: { readonly maxTextureDimension2D: number; readonly maxBufferSize?: number };
  draw(operation: DrawOperation): void;
  clear(target: TargetSnapshot, state: RasterState, mask: number, color: readonly number[], depth: number): void;
  flush(): void;
  replaceStorage(previous: TextureStorage | null, next: TextureStorage): void;
  retireStorage(storage: TextureStorage): void;
  retireDepth(id: number, generation: number): void;
}
