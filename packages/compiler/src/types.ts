export type ShaderStage = "vertex" | "fragment";

export interface ShaderVariable {
  name: string;
  mappedName: string;
  type: number;
  size: number;
  active: boolean;
  precision: number;
  offset: number;
  arrayStride: number;
  matrixStride: number;
  fields: ShaderVariable[];
}

export interface CompiledShader {
  success: boolean;
  log: string;
  source: string;
  stage: ShaderStage;
  version: 1 | 2;
  wgsl: string;
  attributes: ShaderVariable[];
  uniforms: ShaderVariable[];
  varyings: ShaderVariable[];
  outputs: ShaderVariable[];
  uniformBufferSize: number;
}

export interface ProgramAttribute {
  name: string;
  type: number;
  size: number;
  location: number;
}

export interface ProgramUniform {
  name: string;
  type: number;
  size: number;
  vertexOffset: number | null;
  fragmentOffset: number | null;
  arrayStride: number;
  matrixStride: number;
}

export interface ProgramSampler {
  name: string;
  type: number;
  size: number;
  samplerBinding: number;
  textureBinding: number;
}

export interface LinkedProgram {
  success: boolean;
  log: string;
  vertexWGSL: string;
  fragmentWGSL: string;
  vertexEntryPoint: string;
  fragmentEntryPoint: string;
  attributes: ProgramAttribute[];
  uniforms: ProgramUniform[];
  samplers: ProgramSampler[];
  vertexUniformBufferSize: number;
  fragmentUniformBufferSize: number;
  driverUniformBufferSize: number;
}

export interface Compiler {
  compile(source: string, stage: ShaderStage, version?: 1 | 2): CompiledShader;
  link(vertex: CompiledShader, fragment: CompiledShader,
    attributeLocations?: Record<string, number>): LinkedProgram;
}
