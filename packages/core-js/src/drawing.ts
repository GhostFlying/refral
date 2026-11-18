import { GL } from "@refral/core-api";
import type {
  CompiledShader, Compiler, CompilerRegistry, DrawingCore, DrawingCoreOptions,
  DrawingCoreServices, LinkedProgram, LogicalHandle, ProgramHandle, ShaderHandle,
  TargetSnapshot, UniformLocationHandle, TextureHandle, RenderbufferHandle, FramebufferHandle,
  ReadPixelsPlan, ReadPixelsRequest, DomTextureUploadPlan, DomTextureUploadRequest,
} from "@refral/core-api";
import { JsBufferCore } from "./buffers.js";
import { SemanticContext } from "./context.js";
import { framebufferAttachmentPoint } from "./resources.js";

type ShaderObject = NonNullable<ReturnType<SemanticContext["createShader"]>>;
type ProgramObject = NonNullable<ReturnType<SemanticContext["createProgram"]>>;
type LocationObject = NonNullable<ReturnType<SemanticContext["getUniformLocation"]>>;
type TextureObject = NonNullable<ReturnType<SemanticContext["createTexture"]>>;
type RenderbufferObject = NonNullable<ReturnType<SemanticContext["createRenderbuffer"]>>;
type FramebufferObject = NonNullable<ReturnType<SemanticContext["createFramebuffer"]>>;
type DrawingHandle = ShaderHandle | ProgramHandle | UniformLocationHandle | TextureHandle | RenderbufferHandle | FramebufferHandle;
type ObjectKind = DrawingHandle["kind"];
type ResourceKind = "texture" | "renderbuffer" | "framebuffer";

interface ObjectSlot {
  kind: ObjectKind;
  generation: number;
  value: object | null;
}

const MAX_U32 = 0xffff_ffff;
const bufferOperations = new Set([
  "createBuffer", "bindBuffer", "bufferData", "bufferSubData", "getBufferParameter",
  "getBinding", "deleteBuffer", "isBuffer", "getError", "isContextLost",
]);
const shaderOperations = new Set([
  "shaderSource", "compileShader", "getShaderParameter", "getShaderInfoLog", "getShaderSource",
]);
const programOperations = new Set([
  "bindAttribLocation", "getProgramParameter", "getProgramInfoLog", "validateProgram",
  "getAttribLocation", "getActiveAttrib", "getActiveUniform",
]);
const resourceCreates: Record<string, ResourceKind> = {
  createTexture: "texture", createRenderbuffer: "renderbuffer", createFramebuffer: "framebuffer",
};
const resourceBinds: Record<string, ResourceKind> = {
  bindTexture: "texture", bindRenderbuffer: "renderbuffer", bindFramebuffer: "framebuffer",
};
const resourceDeletes: Record<string, ResourceKind> = {
  deleteTexture: "texture", deleteRenderbuffer: "renderbuffer", deleteFramebuffer: "framebuffer",
};
const resourceChecks: Record<string, ResourceKind> = {
  isTexture: "texture", isRenderbuffer: "renderbuffer", isFramebuffer: "framebuffer",
};

function isPositiveU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_U32;
}

/** Gives each semantic result an ownership record over its shared compiler artifact. */
class RegistryCompiler implements Compiler {
  private readonly shaders = new WeakMap<CompiledShader, number>();
  private readonly programs = new WeakMap<LinkedProgram, number>();
  private readonly owned = new Set<number>();

  constructor(private readonly registry: CompilerRegistry) {}

  compile(source: string, stage: "vertex" | "fragment"): CompiledShader {
    const artifact = this.registry.compile(source, stage);
    const result = { ...artifact.result };
    this.shaders.set(result, artifact.artifactId);
    this.owned.add(artifact.artifactId);
    return result;
  }

  link(vertex: CompiledShader, fragment: CompiledShader,
    attributes: Record<string, number> = {}): LinkedProgram {
    const vertexId = this.shaders.get(vertex);
    const fragmentId = this.shaders.get(fragment);
    if (vertexId === undefined || fragmentId === undefined) throw new Error("Shader artifact is unavailable.");
    const artifact = this.registry.link(vertexId, fragmentId, new Map(Object.entries(attributes)));
    const result = { ...artifact.result };
    this.programs.set(result, artifact.artifactId);
    this.owned.add(artifact.artifactId);
    return result;
  }

  releaseShader(shader: CompiledShader): void {
    const id = this.shaders.get(shader);
    if (id === undefined) return;
    this.shaders.delete(shader);
    this.release(id);
  }

  releaseProgram(program: LinkedProgram): void {
    const id = this.programs.get(program);
    if (id === undefined) return;
    this.programs.delete(program);
    this.release(id);
  }

  private release(id: number): void {
    if (this.owned.delete(id)) this.registry.release([id]);
  }

  dispose(): void {
    this.registry.release([...this.owned]);
    this.owned.clear();
  }
}

/** Logical shader/program/location handles over the complete existing JS semantics. */
export class JsDrawingCore extends JsBufferCore implements DrawingCore {
  private readonly context: SemanticContext;
  private readonly registryCompiler: RegistryCompiler;
  private readonly objectSlots = new Map<number, ObjectSlot>();
  private readonly reusableSlots: number[] = [];
  private readonly objectHandles = new WeakMap<object, DrawingHandle>();
  private readonly locations = new Map<ProgramObject, Set<number>>();
  private nextObjectSlot = 1;
  private drawingDisposed = false;

  constructor(options: DrawingCoreOptions, services: DrawingCoreServices) {
    const compiler = new RegistryCompiler(services.compiler);
    const context = new SemanticContext(options.surface, services.host, compiler, options.attributes, options.profile, services.resources);
    super(context, options);
    this.context = context;
    this.registryCompiler = compiler;
  }

  private findObjectSlot(value: unknown, kind: ObjectKind): { handle: LogicalHandle; slot: ObjectSlot } | null {
    if (typeof value !== "object" || value === null) return null;
    const handle = value as LogicalHandle;
    if (handle.kind !== kind || handle.contextId !== this.contextId ||
        !isPositiveU32(handle.slot) || !isPositiveU32(handle.generation)) return null;
    const slot = this.objectSlots.get(handle.slot);
    return slot ? { handle, slot } : null;
  }

  private resolveObject(value: unknown, kind: ObjectKind, reportError = true,
    retiredError: number = GL.INVALID_VALUE): object | null {
    const found = this.findObjectSlot(value, kind);
    if (found && found.slot.kind === kind && found.slot.generation === found.handle.generation && found.slot.value) {
      return found.slot.value;
    }
    if (reportError) {
      const retired = found && (found.handle.generation < found.slot.generation ||
        (found.slot.kind === kind && found.handle.generation === found.slot.generation && found.slot.value === null));
      this.context.recordError(retired && (kind === "shader" || kind === "program") ? retiredError : GL.INVALID_OPERATION);
    }
    return null;
  }

  private resolveDeletion(value: unknown, kind: Exclude<ObjectKind, "uniform-location">): object | null {
    if (value === null) return null;
    const found = this.findObjectSlot(value, kind);
    if (!found || found.handle.generation > found.slot.generation) {
      this.context.recordError(GL.INVALID_OPERATION);
      return null;
    }
    if (found.handle.generation < found.slot.generation || found.slot.value === null) return null;
    if (found.slot.kind !== kind) {
      this.context.recordError(GL.INVALID_OPERATION);
      return null;
    }
    return found.slot.value;
  }

  private wrap(value: object | null, kind: ObjectKind): DrawingHandle | null {
    if (value === null) return null;
    const previous = this.objectHandles.get(value);
    if (previous) return previous;
    const number = this.reusableSlots.pop() ?? this.nextObjectSlot++;
    if (number > MAX_U32) {
      if (kind === "shader") this.context.deleteShader(value as ShaderObject);
      else if (kind === "program") this.context.deleteProgram(value as ProgramObject);
      else if (kind === "texture") this.context.deleteTexture(value as TextureObject);
      else if (kind === "renderbuffer") this.context.deleteRenderbuffer(value as RenderbufferObject);
      else if (kind === "framebuffer") this.context.deleteFramebuffer(value as FramebufferObject);
      this.context.recordError(GL.OUT_OF_MEMORY);
      return null;
    }
    const generation = (this.objectSlots.get(number)?.generation ?? 0) + 1;
    const handle = Object.freeze({ kind, contextId: this.contextId, slot: number, generation }) as DrawingHandle;
    this.objectSlots.set(number, { kind, generation, value });
    this.objectHandles.set(value, handle);
    if (kind === "texture") (value as TextureObject).handle = handle as TextureHandle;
    else if (kind === "renderbuffer") (value as RenderbufferObject).handle = handle as RenderbufferHandle;
    if (kind === "uniform-location") {
      const program = (value as LocationObject).program;
      let locations = this.locations.get(program);
      if (!locations) this.locations.set(program, locations = new Set());
      locations.add(number);
    }
    return handle;
  }

  private retire(value: object): void {
    const handle = this.objectHandles.get(value);
    if (!handle) return;
    const slot = this.objectSlots.get(handle.slot)!;
    slot.value = null;
    this.objectHandles.delete(value);
    if (slot.generation < MAX_U32) this.reusableSlots.push(handle.slot);
  }

  private retireLocations(program: ProgramObject): void {
    const locations = this.locations.get(program);
    if (!locations) return;
    for (const number of locations) {
      const value = this.objectSlots.get(number)?.value;
      if (value) this.retire(value);
    }
    this.locations.delete(program);
  }

  private retireShader(shader: ShaderObject): void {
    if (!this.context.isShader(shader)) this.retire(shader);
  }

  private retireProgram(program: ProgramObject | null, shaders: readonly ShaderObject[]): void {
    if (!program || this.context.isProgram(program)) return;
    this.retireLocations(program);
    this.retire(program);
    for (const shader of shaders) this.retireShader(shader);
  }

  private retireAttachment(value: TextureObject | RenderbufferObject | null): void {
    if (value?.retired) this.retire(value);
  }

  private invalidResult(operation: string): unknown {
    if (operation === "getAttribLocation") return -1;
    if (operation.startsWith("get")) return null;
    return undefined;
  }

  invoke(operation: string, args: unknown[]): unknown {
    if (operation === "drawingBufferWidth" || operation === "drawingBufferHeight" || operation === "drawingBufferColorSpace") {
      return this.context[operation];
    }
    if (bufferOperations.has(operation)) {
      const method = Reflect.get(this, operation) as (...values: unknown[]) => unknown;
      return method.apply(this, args);
    }
    if (this.isContextLost()) return this.context.invoke(operation, args);
    if (Object.hasOwn(resourceCreates, operation)) {
      return this.wrap(this.context.invoke(operation, args) as object | null, resourceCreates[operation]);
    }
    if (Object.hasOwn(resourceChecks, operation)) {
      const value = this.resolveObject(args[0], resourceChecks[operation], false);
      return value !== null && this.context.invoke(operation, [value]);
    }
    if (Object.hasOwn(resourceBinds, operation)) {
      const value = args[1] === null ? null : this.resolveObject(args[1], resourceBinds[operation]);
      if (args[1] !== null && !value) return;
      return this.context.invoke(operation, [args[0], value]);
    }
    if (Object.hasOwn(resourceDeletes, operation)) {
      const kind = resourceDeletes[operation];
      const value = this.resolveDeletion(args[0], kind);
      if (!value) return;
      const framebuffer = kind === "framebuffer" ? value as FramebufferObject : null;
      const attachments = framebuffer ? [framebuffer.color, framebuffer.depth, framebuffer.stencil, framebuffer.depthStencil] : [];
      this.context.invoke(operation, [value]);
      if (framebuffer) {
        this.retire(framebuffer);
        for (const attachment of new Set(attachments)) this.retireAttachment(attachment);
      } else this.retireAttachment(value as TextureObject | RenderbufferObject);
      return;
    }
    if (operation === "framebufferTexture2D" || operation === "framebufferRenderbuffer") {
      const texture = operation === "framebufferTexture2D";
      const value = args[3] === null ? null : this.resolveObject(args[3], texture ? "texture" : "renderbuffer");
      if (args[3] !== null && !value) return;
      const framebuffer = this.context.getParameter(GL.FRAMEBUFFER_BINDING) as FramebufferObject | null;
      const point = framebufferAttachmentPoint(args[1] as number);
      const previous = point ? framebuffer?.[point] ?? null : null;
      const result = this.context.invoke(operation, [args[0], args[1], args[2], value, ...args.slice(4)]);
      this.retireAttachment(previous);
      return result;
    }
    if (operation === "createShader" || operation === "createProgram") {
      return this.wrap(this.context.invoke(operation, args) as object | null,
        operation === "createShader" ? "shader" : "program");
    }
    if (operation === "isShader" || operation === "isProgram") {
      const kind = operation === "isShader" ? "shader" : "program";
      const value = this.resolveObject(args[0], kind, false);
      return value !== null && this.context.invoke(operation, [value]);
    }
    if (operation === "deleteShader" || operation === "deleteProgram") {
      const shader = operation === "deleteShader";
      const value = this.resolveDeletion(args[0], shader ? "shader" : "program");
      if (!value) return;
      const attached = shader ? [] : [...(value as ProgramObject).shaders];
      this.context.invoke(operation, [value]);
      if (shader) this.retireShader(value as ShaderObject);
      else this.retireProgram(value as ProgramObject, attached);
      return;
    }
    if (operation === "useProgram") {
      const program = args[0] === null ? null : this.resolveObject(args[0], "program", true, GL.INVALID_OPERATION);
      if (args[0] !== null && !program) return;
      const previous = this.context.getParameter(GL.CURRENT_PROGRAM) as ProgramObject | null;
      const attached = previous ? [...previous.shaders] : [];
      this.context.invoke(operation, [program]);
      this.retireProgram(previous, attached);
      return;
    }
    if (operation === "attachShader" || operation === "detachShader") {
      const program = this.resolveObject(args[0], "program");
      const shader = this.resolveObject(args[1], "shader");
      if (!program || !shader) return;
      this.context.invoke(operation, [program, shader]);
      if (operation === "detachShader") this.retireShader(shader as ShaderObject);
      return;
    }
    if (shaderOperations.has(operation)) {
      const shader = this.resolveObject(args[0], "shader");
      return shader ? this.context.invoke(operation, [shader, ...args.slice(1)]) : this.invalidResult(operation);
    }
    if (programOperations.has(operation) || operation === "linkProgram" || operation === "getAttachedShaders" ||
        operation === "getUniformLocation" || operation === "getUniform") {
      const program = this.resolveObject(args[0], "program") as ProgramObject | null;
      if (!program) return this.invalidResult(operation);
      if (operation === "getUniform") {
        const location = this.resolveObject(args[1], "uniform-location");
        return location ? this.context.invoke(operation, [program, location]) : null;
      }
      const generation = program.generation;
      const result = this.context.invoke(operation, [program, ...args.slice(1)]);
      if (operation === "linkProgram" && program.generation !== generation) this.retireLocations(program);
      if (operation === "getAttachedShaders") {
        return (result as ShaderObject[] | null)?.map(shader => this.wrap(shader, "shader")) ?? null;
      }
      if (operation === "getUniformLocation") return this.wrap(result as object | null, "uniform-location");
      return result;
    }
    if (/^uniform(?:[1-4][fi]v?|Matrix[234]fv)$/.test(operation)) {
      const location = args[0] === null ? null : this.resolveObject(args[0], "uniform-location");
      if (args[0] !== null && !location) return;
      return this.context.invoke(operation, [location, ...args.slice(1)]);
    }
    const result = this.context.invoke(operation, args);
    if (operation === "getParameter") {
      if (args[0] === GL.CURRENT_PROGRAM) return this.wrap(result as object | null, "program");
      if (args[0] === GL.ARRAY_BUFFER_BINDING || args[0] === GL.ELEMENT_ARRAY_BUFFER_BINDING) return this.toHandle(result);
      if (args[0] === GL.TEXTURE_BINDING_2D || args[0] === GL.TEXTURE_BINDING_CUBE_MAP) {
        return this.wrap(result as object | null, "texture");
      }
      if (args[0] === GL.RENDERBUFFER_BINDING) return this.wrap(result as object | null, "renderbuffer");
      if (args[0] === GL.FRAMEBUFFER_BINDING) return this.wrap(result as object | null, "framebuffer");
    }
    if (operation === "getFramebufferAttachmentParameter" && args[2] === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) {
      return this.wrap(result as object | null, args[1] === GL.COLOR_ATTACHMENT0 ? "texture" : "renderbuffer");
    }
    if (operation === "getVertexAttrib" && args[1] === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) return this.toHandle(result);
    return result;
  }

  captureTarget(): TargetSnapshot { return this.context.captureTarget(); }

  prepareReadPixels(request: ReadPixelsRequest): ReadPixelsPlan | null {
    return this.context.prepareReadPixels(request);
  }

  prepareDomTextureUpload(request: DomTextureUploadRequest): DomTextureUploadPlan | null {
    return this.context.prepareDomTextureUpload(request);
  }

  override dispose(): void {
    if (this.drawingDisposed) return;
    this.drawingDisposed = true;
    super.dispose();
    this.context.dispose();
    this.registryCompiler.dispose();
    this.objectSlots.clear();
    this.reusableSlots.length = 0;
    this.locations.clear();
  }
}

export function createJsDrawingCore(options: DrawingCoreOptions, services: DrawingCoreServices): DrawingCore {
  return new JsDrawingCore(options, services);
}
