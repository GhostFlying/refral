import type { BufferCore, BufferCoreOptions } from './index.js';
import type { CompiledShader, LinkedProgram, ShaderStage } from './compiler.js';
import type {
  ContextAttributes, DrawingSurface, RuntimeProfile, SemanticHost, TargetSnapshot,
} from './execution.js';
import type { ResourceRegistry } from './resources.js';
import type { ReadPixelsPlan, ReadPixelsRequest } from './readback.js';
import type { DomTextureUploadPlan, DomTextureUploadRequest } from './dom-upload.js';

/** Per-context artifacts owned by the shared synchronous compiler service. */
export interface CompilerRegistry {
  compile(source: string, stage: ShaderStage, extensions?: number): { artifactId: number; result: CompiledShader };
  link(vertexId: number, fragmentId: number,
    attributeLocations: ReadonlyMap<string, number>): { artifactId: number; result: LinkedProgram };
  executable(id: number): LinkedProgram;
  translatedShaderSource(id: number): string;
  release(ids: readonly number[]): void;
  dispose(): void;
}

export interface DrawingCoreOptions extends BufferCoreOptions {
  readonly surface: DrawingSurface;
  readonly attributes: ContextAttributes;
  readonly profile: RuntimeProfile;
}

export interface DrawingCoreServices {
  readonly compiler: CompilerRegistry;
  readonly host: SemanticHost;
  readonly resources: ResourceRegistry;
}

/** Arguments contain normalized scalar/data values and logical object handles. */
export interface DrawingCore extends BufferCore {
  invoke(operation: string, args: unknown[]): unknown;
  captureTarget(): TargetSnapshot;
  prepareReadPixels(request: ReadPixelsRequest): ReadPixelsPlan | null;
  prepareDomTextureUpload(request: DomTextureUploadRequest): DomTextureUploadPlan | null;
}
