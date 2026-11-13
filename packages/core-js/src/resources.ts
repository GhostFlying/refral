import { GL } from "@refral/core-api";
export { GL } from "@refral/core-api";


let nextObjectId = 1;

export class LogicalObject {
  readonly id = nextObjectId++;
  deleted = false;
  constructor(readonly owner: object) {}
}

export class BufferObject extends LogicalObject {
  data = new Uint8Array(0);
  usage: number = GL.STATIC_DRAW;
  target: number | null = null;
  generation = 0;
  version = 0;
}

export interface TextureStorage {
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

export class TextureObject extends LogicalObject {
  storage: TextureStorage | null = null;
  generation = 0;
  version = 0;
  format: number = GL.RGBA;
  parameters: TextureParameters = {
    minFilter: GL.NEAREST_MIPMAP_LINEAR,
    magFilter: GL.LINEAR,
    wrapS: GL.REPEAT,
    wrapT: GL.REPEAT,
  };
}

export class RenderbufferObject extends LogicalObject {
  width = 0;
  height = 0;
  generation = 0;
  format: number = GL.DEPTH_COMPONENT16;
}

export class FramebufferObject extends LogicalObject {
  color: TextureObject | null = null;
  depth: RenderbufferObject | null = null;
}

export interface VertexAttribute {
  enabled: boolean;
  buffer: BufferObject | null;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
  constant: [number, number, number, number];
}

export interface AttributeSnapshot {
  location: number;
  shaderType: number;
  size: number;
  stride: number;
  offset: number;
  data: Uint8Array | null;
  constant: readonly number[];
}

export interface TargetSnapshot {
  color: TextureStorage | null;
  depth: RenderbufferObject | null;
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

export class ErrorState {
  private errors: number[] = [];
  set(error: number): void {
    if (!this.errors.includes(error)) this.errors.push(error);
  }
  take(): number { return this.errors.shift() ?? GL.NO_ERROR; }
  clear(): void { this.errors = []; }
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

export function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function isTextureComplete(texture: TextureObject): boolean {
  const storage = texture.storage;
  if (!storage || !storage.width || !storage.height) return false;
  const params = texture.parameters;
  if (params.minFilter !== GL.NEAREST && params.minFilter !== GL.LINEAR) return false;
  if (!isPowerOfTwo(storage.width) || !isPowerOfTwo(storage.height)) {
    return params.wrapS === GL.CLAMP_TO_EDGE && params.wrapT === GL.CLAMP_TO_EDGE;
  }
  return true;
}
