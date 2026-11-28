import {
  CUBE_FACES, GL, SRGB, SHADER_EXTENSIONS, DERIVATIVE_HINT_OES, BLEND_MINMAX, elementIndexBytes, isSrgbTextureFormat, VERTEX_ARRAY_BINDING_OES, createRasterState, snapshotRaster, componentCount, vertexComponentBytes, isColorRenderbufferFormat,
  isStencilRenderbufferFormat, stencilReference, isDrawMode,
} from "@refral/core-api";
import type {
  AttributeSnapshot, RasterState, StencilFaceState, TargetSnapshot, TextureBinding, TextureCopy,
  Compiler, CompiledShader, LinkedProgram, ProgramUniform, DrawingSurface,
  ContextAttributes, RuntimeProfile, SemanticHost, ResourceRegistry, TextureVersion, PixelUpload,
  ReadPixelsPlan, ReadPixelsRequest, DomTextureUploadPlan, DomTextureUploadRequest,
  DrawOperation,
} from "@refral/core-api";
import {
  LogicalObject, BufferObject, VertexArrayObject, TextureObject, RenderbufferObject, FramebufferObject,
  ErrorState, framebufferAttachmentPoint, isPowerOfTwo, textureBase, textureSamplingLevelCount, textureTargets,
} from "./resources.js";
import { UniformSnapshots } from "./uniform-snapshots.js";
import type { TextureImage, VertexAttribute } from "./resources.js";

export type {
  DrawingSurface, ContextAttributes, RuntimeProfile, SemanticHost, DrawOperation as CoreDrawOperation,
} from "@refral/core-api";

const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

function unsupported(operation: string): never {
  const error = new Error(`${operation} is outside the implemented WebGL1 profile`);
  error.name = "NotSupportedError";
  throw error;
}

class ShaderObject extends LogicalObject {
  source = "";
  result: CompiledShader | null = null;
  constructor(owner: object, readonly type: number) { super(owner); }
}

class ProgramObject extends LogicalObject {
  shaders: ShaderObject[] = [];
  attributeLocations: Record<string, number> = Object.create(null);
  executable: LinkedProgram | null = null;
  vertexInputs: Array<{ location: number; type: number }> = [];
  linkStatus = false;
  validateStatus = false;
  log = "";
  generation = 0;
  vertexUniforms = new Uint8Array(16);
  fragmentUniforms = new Uint8Array(16);
  values = new Map<string, Float32Array | Int32Array>();
  samplerUnits = new Map<string, Int32Array>();
}

class UniformLocation {
  constructor(readonly owner: object, readonly program: ProgramObject,
    readonly generation: number, readonly name: string, readonly index: number) {}
}

function clamp(value: number): number { return Math.max(0, Math.min(1, Number(value) || 0)); }
function baseName(name: string): string { return name.replace(/\[0\]$/, ""); }
function isUniformArray(uniform: { name: string; size: number; arrayStride?: number }): boolean {
  return uniform.size > 1 || (uniform.arrayStride ?? 0) > 0 || uniform.name.endsWith("[0]");
}
function bytesOf(value: ArrayBufferView | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

interface SemanticCompiler extends Compiler {
  releaseShader?(shader: CompiledShader): void;
  releaseProgram?(program: LinkedProgram): void;
}

interface TextureUnit {
  texture2D: TextureObject | null;
  cubeMap: TextureObject | null;
}

export class SemanticContext {
  private readonly owner = {};
  private readonly uniformSnapshots = new UniformSnapshots();
  private readonly errors = new ErrorState();
  private readonly objects = new Set<LogicalObject>();
  private readonly state: RasterState;
  private arrayBuffer: BufferObject | null = null;
  private readonly defaultArray: VertexArrayObject;
  private currentArray: VertexArrayObject;
  private arraysEnabled = false;
  private polygonOffsetClampEnabled = false;
  private depthClampEnabled = false;
  private floatTextures = false;
  private floatLinearTextures = false;
  private srgbTextures = false;
  supportsSrgbTextures(): boolean { return true; }
  enableSrgbTextures(): void { this.srgbTextures = true; }
  private elementIndexUint = false;
  private blendMinmax = false;
  private framebufferMipmaps = false;
  private shaderExtensions = 0;
  private derivativeHint: number = GL.DONT_CARE;
  supportsShaderExtensions(): boolean { return true; }
  enableShaderExtension(mask: number): void { this.shaderExtensions |= mask; }
  supportsCoreExtensions(): boolean { return true; }
  enableElementIndexUint(): void { this.elementIndexUint = true; }
  enableBlendMinmax(): void { this.blendMinmax = true; }
  enableFramebufferMipmaps(): void { this.framebufferMipmaps = true; }
  supportsFloatTextures(): boolean { return true; }
  enableFloatTextures(): void { this.floatTextures = true; }
  supportsFloatLinearTextures(): boolean { return true; }
  enableFloatLinearTextures(): void { this.floatLinearTextures = true; }
  private get elementBuffer() { return this.currentArray.element; }
  private set elementBuffer(buffer: BufferObject | null) { this.currentArray.element = buffer; }
  private get attributes(): VertexAttribute[] { return this.currentArray.attributes; }
  private program: ProgramObject | null = null;
  private framebuffer: FramebufferObject | null = null;
  private renderbuffer: RenderbufferObject | null = null;
  private activeUnit = 0;
  private readonly textureUnits: TextureUnit[];
  private readonly constants: [number, number, number, number][];
  private clearColorValue: [number, number, number, number] = [0, 0, 0, 0];
  private clearDepthValue = 1;
  private unpackAlignment = 4;
  private packAlignment = 4;
  private unpackFlipY = false;
  private unpackPremultiply = false;
  private unpackColorSpace: number = GL.BROWSER_DEFAULT_WEBGL;
  private scheduled = false;
  private lost = false;
  private dither = true;
  private sampleAlphaToCoverage = false;
  private sampleCoverageEnabled = false;
  private sampleCoverageValue = 1;
  private sampleCoverageInvert = false;
  private requestedLineWidth = 1;
  private mipmapHint: number = GL.DONT_CARE;
  private maxBufferBytes: number;

  constructor(readonly canvas: DrawingSurface, private readonly host: SemanticHost,
    private readonly compiler: SemanticCompiler, private readonly contextAttributes: ContextAttributes,
    private readonly profile: RuntimeProfile, private readonly resources?: ResourceRegistry) {
    this.maxBufferBytes = host.limits.maxBufferSize ?? Number.MAX_SAFE_INTEGER;
    this.state = createRasterState(canvas.width, canvas.height);
    this.textureUnits = Array.from({ length: profile.combinedTextureUnits }, () => ({ texture2D: null, cubeMap: null }));
    this.currentArray = this.defaultArray = new VertexArrayObject(this.owner, profile.vertexAttributes);
    this.constants = Array.from({ length: profile.vertexAttributes }, () => [0, 0, 0, 1]);

  }

  get drawingBufferWidth(): number { return this.lost ? 0 : this.canvas.width; }
  get drawingBufferHeight(): number { return this.lost ? 0 : this.canvas.height; }
  get drawingBufferColorSpace(): string { return "srgb"; }

  /** Central public-call dispatch keeps context-loss behavior consistent across the facade. */
  invoke(method: string, arguments_: unknown[]): unknown {
    // WEBGL_lose_context may generate INVALID_OPERATION even on a lost context.
    if (method === "recordContextLossError") { this.errors.set(GL.INVALID_OPERATION); return; }
    if (this.lost && method !== "getError" && method !== "isContextLost") {
      if (method === "getAttribLocation") return -1;
      if (method === "getVertexAttribOffset") return 0;
      if (method === "checkFramebufferStatus") return GL.FRAMEBUFFER_UNSUPPORTED;
      if (method.startsWith("get") || method.startsWith("create")) return null;
      if (method.startsWith("is")) return false;
      return undefined;
    }
    const implementation: unknown = Reflect.get(this, method);
    if (typeof implementation !== "function") return unsupported(method);
    return implementation.apply(this, arguments_);
  }

  private track<T extends LogicalObject>(object: T): T { this.objects.add(object); return object; }
  private valid<T extends LogicalObject>(object: unknown, type: new (...args: never[]) => T,
    allowDeleted = false): object is T {
    if (this.lost) return false;
    const retained = (object instanceof ShaderObject || object instanceof ProgramObject) && this.objects.has(object);
    if (!(object instanceof type) || object.owner !== this.owner ||
        (!allowDeleted && object.deleted && !retained)) {
      this.errors.set(GL.INVALID_OPERATION);
      return false;
    }
    return true;
  }
  private error(code: number): void { if (!this.lost) this.errors.set(code); }

  /** Shared contract adapters add validation errors to the same GL error state. */
  recordError(code: number): void { this.error(code); }

  /** Restrict allocation to the resource capacity supplied by the selected host. */
  setBufferByteLimit(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError("Invalid buffer byte limit.");
    this.maxBufferBytes = Math.min(this.maxBufferBytes, maximum);
  }
  private schedule(): void {
    if (this.scheduled || this.lost) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.lost) this.host.flush();
    });
  }
  private bufferFor(target: number): BufferObject | null | undefined {
    if (this.lost) return undefined;
    if (target === GL.ARRAY_BUFFER) return this.arrayBuffer;
    if (target === GL.ELEMENT_ARRAY_BUFFER) return this.elementBuffer;
    this.error(GL.INVALID_ENUM);
    return undefined;
  }
  private boundTexture(target: number): TextureObject | null | undefined {
    if (this.lost) return undefined;
    const unit = this.textureUnits[this.activeUnit]!;
    if (target === GL.TEXTURE_2D) return unit.texture2D;
    if (target === GL.TEXTURE_CUBE_MAP) return unit.cubeMap;
    this.error(GL.INVALID_ENUM);
    return undefined;
  }
  private boundImageTexture(imageTarget: number): TextureObject | null | undefined {
    if (imageTarget === GL.TEXTURE_2D) return this.boundTexture(GL.TEXTURE_2D);
    if (CUBE_FACES.some(face => face === imageTarget)) return this.boundTexture(GL.TEXTURE_CUBE_MAP);
    this.error(GL.INVALID_ENUM);
    return undefined;
  }
  private target(): TargetSnapshot | null {
    if (!this.framebuffer) return {
      color: null, depth: null, depthGeneration: 0, width: this.canvas.width,
      height: this.canvas.height, isDefault: true,
    };
    if (this.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
      this.error(GL.INVALID_FRAMEBUFFER_OPERATION); return null;
    }
    const colorRenderbuffer = this.framebuffer.colorRenderbuffer;
    const storage = colorRenderbuffer
      ? this.resources?.colorRenderbuffer(colorRenderbuffer.handle!, colorRenderbuffer.generation,
          colorRenderbuffer.width, colorRenderbuffer.height, colorRenderbuffer.format) ?? colorRenderbuffer.colorStorage!
      : this.framebuffer.colorImage!.storage!;
    const renderbuffer = this.framebuffer.depth ?? this.framebuffer.stencil ?? this.framebuffer.depthStencil;
    const depth = renderbuffer && this.resources
      ? { id: this.resources.depth(renderbuffer.handle!, renderbuffer.generation).id } : renderbuffer;
    return { color: storage, colorOpaque: colorRenderbuffer ? storage.opaque === true : this.framebuffer.colorImage?.format === GL.RGB, depth,
      depthGeneration: renderbuffer?.generation ?? 0, depthFormat: renderbuffer?.format,
      width: storage.width, height: storage.height, isDefault: false };
  }

  private textureVersion(texture: TextureObject, imageTarget: number = GL.TEXTURE_2D, level = 0): TextureVersion {
    if (!texture.handle) throw new Error("Texture has no logical resource handle.");
    const image = texture.image(imageTarget, level);
    if (!image) throw new Error("Texture image has no defined resource version.");
    const version = { texture: texture.handle, storageGeneration: image.generation, contentVersion: image.version };
    return imageTarget === GL.TEXTURE_2D && level === 0 ? version : { ...version, imageTarget, level };
  }

  private wroteColorTarget(): void {
    const framebuffer = this.framebuffer;
    const texture = framebuffer?.colorTexture;
    const image = framebuffer?.colorImage;
    if (!this.resources || !framebuffer || !texture || !image?.storage || !this.state.colorMask.some(Boolean)) return;
    const previous = this.textureVersion(texture, framebuffer.colorTarget, framebuffer.colorLevel);
    image.version++;
    const version = this.textureVersion(texture, framebuffer.colorTarget, framebuffer.colorLevel);
    this.resources.apply({ kind: "write-texture", version, previous });
    image.storage = this.resources.texture(version);
  }

  private retireRenderbufferStorage(renderbuffer: RenderbufferObject): void {
    if (this.resources) {
      if (renderbuffer.generation > 0) this.resources.apply({ kind: "retire-renderbuffer",
        renderbuffer: renderbuffer.handle!, storageGeneration: renderbuffer.generation });
    } else if (renderbuffer.colorStorage) this.host.retireStorage(renderbuffer.colorStorage);
    else if (renderbuffer.generation > 0) this.host.retireDepth(renderbuffer.id, renderbuffer.generation);
    renderbuffer.colorStorage = null;
  }

  getError(): number { return this.errors.take(); }
  isContextLost(): boolean { return this.lost; }
  getContextAttributes(): ContextAttributes | null {
    return this.lost ? null : { ...this.contextAttributes };
  }
  getSupportedExtensions(): string[] | null { return this.lost ? null : []; }
  getExtension(_name: string): null { return null; }
  flush(): void { if (!this.lost) this.host.flush(); }
  finish(): void { if (!this.lost) this.host.finish(); }

  createBuffer(): BufferObject | null { return this.lost ? null : this.track(new BufferObject(this.owner)); }
  bindBuffer(target: number, buffer: BufferObject | null): void {
    if (this.lost) return;
    if (target !== GL.ARRAY_BUFFER && target !== GL.ELEMENT_ARRAY_BUFFER) return this.error(GL.INVALID_ENUM);
    if (buffer !== null && !this.valid(buffer, BufferObject)) return;
    if (buffer?.target && buffer.target !== target) return this.error(GL.INVALID_OPERATION);
    if (buffer) buffer.target = target;
    if (target === GL.ARRAY_BUFFER) this.arrayBuffer = buffer;
    else this.elementBuffer = buffer;
  }
  bufferData(target: number, data: number | ArrayBufferView | ArrayBuffer | null, usage: number): void {
    const buffer = this.bufferFor(target);
    if (buffer === undefined) return;
    if (!buffer) return this.error(GL.INVALID_OPERATION);
    if (![GL.STATIC_DRAW, GL.DYNAMIC_DRAW, GL.STREAM_DRAW].includes(usage as 0x88e4)) {
      return this.error(GL.INVALID_ENUM);
    }
    if (data === null) return this.error(GL.INVALID_VALUE);
    if (typeof data === "number" && (!Number.isSafeInteger(data) || data < 0)) {
      return this.error(GL.INVALID_VALUE);
    }
    const byteLength = typeof data === "number" ? data : data.byteLength;
    if (byteLength > this.maxBufferBytes) return this.error(GL.OUT_OF_MEMORY);
    try {
      buffer.data = typeof data === "number" ? new Uint8Array(data) : new Uint8Array(bytesOf(data));
      buffer.usage = usage; buffer.generation++; buffer.version++;
    } catch { this.error(GL.OUT_OF_MEMORY); }
  }
  bufferSubData(target: number, offset: number, data: ArrayBufferView | ArrayBuffer | null): void {
    const buffer = this.bufferFor(target);
    if (buffer === undefined) return;
    if (!buffer) return this.error(GL.INVALID_OPERATION);
    if (data === null) return;
    const bytes = bytesOf(data);
    if (offset < 0 || !Number.isSafeInteger(offset) || offset + bytes.byteLength > buffer.data.byteLength) {
      return this.error(GL.INVALID_VALUE);
    }
    if (bytes.byteLength === 0) return;
    try {
      const replacement = buffer.data.slice(); replacement.set(bytes, offset);
      buffer.data = replacement; buffer.version++;
    } catch { this.error(GL.OUT_OF_MEMORY); }
  }
  getBufferParameter(target: number, parameter: number): number | null {
    const buffer = this.bufferFor(target);
    if (buffer === undefined) return null;
    if (!buffer) { this.error(GL.INVALID_OPERATION); return null; }
    if (parameter === GL.BUFFER_SIZE) return buffer.data.byteLength;
    if (parameter === GL.BUFFER_USAGE) return buffer.usage;
    this.error(GL.INVALID_ENUM); return null;
  }
  deleteBuffer(buffer: BufferObject | null): void {
    if (buffer === null) return;
    if (!this.valid(buffer, BufferObject, true) || buffer.deleted) return;
    buffer.deleted = true;
    this.objects.delete(buffer);
    if (this.arrayBuffer === buffer) this.arrayBuffer = null;
    if (this.elementBuffer === buffer) this.elementBuffer = null;
    for (const attribute of this.attributes) if (attribute.buffer === buffer) attribute.buffer = null;
    // Other vertex arrays retain this storage through their element/attribute references.
  }
  isBuffer(buffer: unknown): boolean {
    return !this.lost && buffer instanceof BufferObject && buffer.owner === this.owner && !buffer.deleted && buffer.target !== null;
  }

  createShader(type: number): ShaderObject | null {
    if (this.lost) return null;
    if (type !== GL.VERTEX_SHADER && type !== GL.FRAGMENT_SHADER) { this.error(GL.INVALID_ENUM); return null; }
    return this.track(new ShaderObject(this.owner, type));
  }
  shaderSource(shader: ShaderObject, source: string): void {
    if (this.valid(shader, ShaderObject)) shader.source = String(source);
  }
  compileShader(shader: ShaderObject): void {
    if (!this.valid(shader, ShaderObject)) return;
    const previous = shader.result;
    shader.result = this.compiler.compile(shader.source,
      shader.type === GL.VERTEX_SHADER ? "vertex" : "fragment", 1, this.shaderExtensions);
    if (previous) this.compiler.releaseShader?.(previous);
  }
  getShaderParameter(shader: ShaderObject, parameter: number): unknown {
    if (!this.valid(shader, ShaderObject, true)) return null;
    if (parameter === GL.COMPILE_STATUS) return shader.result?.success ?? false;
    if (parameter === GL.DELETE_STATUS) return shader.deleted;
    if (parameter === GL.SHADER_TYPE) return shader.type;
    this.error(GL.INVALID_ENUM); return null;
  }
  getShaderInfoLog(shader: ShaderObject): string | null {
    return this.valid(shader, ShaderObject, true) ? shader.result?.log ?? "" : null;
  }
  getShaderSource(shader: ShaderObject): string | null {
    return this.valid(shader, ShaderObject, true) ? shader.source : null;
  }
  supportsDebugShaders(): boolean { return true; }
  getTranslatedShaderSource(shader: ShaderObject): string {
    return this.valid(shader, ShaderObject, true) && shader.result?.success ? shader.result.wgsl : "";
  }
  deleteShader(shader: ShaderObject | null): void {
    if (shader === null || !this.valid(shader, ShaderObject, true)) return;
    shader.deleted = true;
    this.releaseShader(shader);
  }
  private releaseShader(shader: ShaderObject): void {
    if (!shader.deleted) return;
    const retained = [...this.objects].some(object => object instanceof ProgramObject && object.shaders.includes(shader));
    if (retained) return;
    this.objects.delete(shader);
    shader.source = "";
    if (shader.result) this.compiler.releaseShader?.(shader.result);
    shader.result = null;
  }
  isShader(shader: unknown): boolean {
    return !this.lost && shader instanceof ShaderObject && shader.owner === this.owner &&
      (!shader.deleted || [...this.objects].some(object => object instanceof ProgramObject && object.shaders.includes(shader)));
  }

  createProgram(): ProgramObject | null { return this.lost ? null : this.track(new ProgramObject(this.owner)); }
  attachShader(program: ProgramObject, shader: ShaderObject): void {
    if (!this.valid(program, ProgramObject) || !this.valid(shader, ShaderObject)) return;
    if (program.shaders.some(candidate => candidate.type === shader.type)) return this.error(GL.INVALID_OPERATION);
    program.shaders.push(shader);
  }
  detachShader(program: ProgramObject, shader: ShaderObject): void {
    if (!this.valid(program, ProgramObject) || !this.valid(shader, ShaderObject, true)) return;
    const index = program.shaders.indexOf(shader);
    if (index < 0) return this.error(GL.INVALID_OPERATION);
    program.shaders.splice(index, 1);
    this.releaseShader(shader);
  }
  getAttachedShaders(program: ProgramObject): ShaderObject[] | null {
    return this.valid(program, ProgramObject, true) ? [...program.shaders] : null;
  }
  private usableLocationName(name: string, binding = false): boolean {
    // ESSL 1.00 section 3.1 permits ASCII whitespace and printable ASCII except these six symbols.
    if (name.length > 256 || /[^\t-\r\x20-\x7e]|["'$@\\\x60]/.test(name)) {
      this.error(GL.INVALID_VALUE);
      return false;
    }
    if (name.startsWith("gl_") || name.startsWith("webgl_") || name.startsWith("_webgl_")) {
      if (binding) this.error(GL.INVALID_OPERATION);
      return false;
    }
    return true;
  }

  bindAttribLocation(program: ProgramObject, index: number, name: string): void {
    if (!this.valid(program, ProgramObject)) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.attributes.length) return this.error(GL.INVALID_VALUE);
    if (this.usableLocationName(name, true)) program.attributeLocations[name] = index;
  }
  linkProgram(program: ProgramObject): void {
    if (!this.valid(program, ProgramObject)) return;
    program.generation++;
    program.validateStatus = false;
    program.linkStatus = false;
    const vertex = program.shaders.find(shader => shader.type === GL.VERTEX_SHADER)?.result;
    const fragment = program.shaders.find(shader => shader.type === GL.FRAGMENT_SHADER)?.result;
    if (!vertex || !fragment) {
      program.linkStatus = false; program.log = "Compiled vertex and fragment shaders are required."; return;
    }
    const executable = this.compiler.link(vertex, fragment, program.attributeLocations);
    program.linkStatus = executable.success; program.log = executable.log;
    if (!executable.success) {
      this.compiler.releaseProgram?.(executable);
      return;
    }
    const previous = program.executable;
    program.executable = executable;
    program.vertexInputs = executable.attributes.flatMap(({ location, type }) => {
      switch (type) {
        case GL.FLOAT_MAT2: return Array.from({ length: 2 }, (_, i) => ({ location: location + i, type: GL.FLOAT_VEC2 }));
        case GL.FLOAT_MAT3: return Array.from({ length: 3 }, (_, i) => ({ location: location + i, type: GL.FLOAT_VEC3 }));
        case GL.FLOAT_MAT4: return Array.from({ length: 4 }, (_, i) => ({ location: location + i, type: GL.FLOAT_VEC4 }));
        default: return [{ location, type }];
      }
    });
    if (previous) this.compiler.releaseProgram?.(previous);
    program.vertexUniforms = new Uint8Array(Math.max(16, executable.vertexUniformBufferSize));
    program.fragmentUniforms = new Uint8Array(Math.max(16, executable.fragmentUniformBufferSize));
    program.values.clear(); program.samplerUnits.clear();
    for (const uniform of executable.uniforms) {
      const integer = [GL.INT, GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4,
        GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x1404);
      const size = componentCount(uniform.type) * uniform.size;
      program.values.set(baseName(uniform.name), integer ? new Int32Array(size) : new Float32Array(size));
    }
    for (const sampler of executable.samplers) program.samplerUnits.set(baseName(sampler.name), new Int32Array(sampler.size));
  }
  useProgram(program: ProgramObject | null): void {
    if (program !== null && !this.valid(program, ProgramObject)) return;
    if (program !== null && (program.deleted || !program.linkStatus)) return this.error(GL.INVALID_OPERATION);
    const previous = this.program;
    this.program = program;
    if (previous && previous !== program) this.releaseProgram(previous);
  }
  getProgramParameter(program: ProgramObject, parameter: number): unknown {
    if (!this.valid(program, ProgramObject, true)) return null;
    if (parameter === GL.LINK_STATUS) return program.linkStatus;
    if (parameter === GL.VALIDATE_STATUS) return program.validateStatus;
    if (parameter === GL.DELETE_STATUS) return program.deleted;
    if (parameter === GL.ATTACHED_SHADERS) return program.shaders.length;
    if (parameter === GL.ACTIVE_ATTRIBUTES) return program.executable?.attributes.length ?? 0;
    if (parameter === GL.ACTIVE_UNIFORMS) return (program.executable?.uniforms.length ?? 0) + (program.executable?.samplers.length ?? 0);
    this.error(GL.INVALID_ENUM); return null;
  }
  getProgramInfoLog(program: ProgramObject): string | null {
    return this.valid(program, ProgramObject, true) ? program.log : null;
  }
  validateProgram(program: ProgramObject): void {
    if (!this.valid(program, ProgramObject)) return;
    const conflict = this.samplerTypeConflict(program);
    program.validateStatus = program.linkStatus && !conflict;
    if (conflict) program.log = "Active samplers of different types reference the same texture unit.";
    else program.log = program.linkStatus ? "" : "A successfully linked program is required for validation.";
  }
  private samplerTypeConflict(program: ProgramObject): boolean {
    const types = new Map<number, number>();
    for (const sampler of program.executable?.samplers ?? []) {
      for (const unit of program.samplerUnits.get(baseName(sampler.name))!) {
        const previous = types.get(unit);
        if (previous !== undefined && previous !== sampler.type) return true;
        types.set(unit, sampler.type);
      }
    }
    return false;
  }
  getAttribLocation(program: ProgramObject, name: string): number {
    if (!this.valid(program, ProgramObject)) return -1;
    if (!program.linkStatus) { this.error(GL.INVALID_OPERATION); return -1; }
    if (!this.usableLocationName(name)) return -1;
    return program.executable!.attributes.find(attribute => attribute.name === name)?.location ?? -1;
  }
  getActiveAttrib(program: ProgramObject, index: number): { name: string; size: number; type: number } | null {
    if (!this.valid(program, ProgramObject)) return null;
    const attribute = program.executable?.attributes[index];
    if (!attribute) { this.error(GL.INVALID_VALUE); return null; }
    return { name: attribute.name, size: attribute.size, type: attribute.type };
  }
  getActiveUniform(program: ProgramObject, index: number): { name: string; size: number; type: number } | null {
    if (!this.valid(program, ProgramObject)) return null;
    const list = [...(program.executable?.uniforms ?? []), ...(program.executable?.samplers ?? [])];
    const uniform = list[index];
    if (!uniform) { this.error(GL.INVALID_VALUE); return null; }
    return { name: isUniformArray(uniform) ? `${baseName(uniform.name)}[0]` : uniform.name,
      size: uniform.size, type: uniform.type };
  }
  getUniformLocation(program: ProgramObject, name: string): UniformLocation | null {
    if (!this.valid(program, ProgramObject)) return null;
    if (!program.linkStatus) { this.error(GL.INVALID_OPERATION); return null; }
    if (!this.usableLocationName(name)) return null;
    const match = /^(.*?)(?:\[(\d+)\])?$/s.exec(name)!;
    const base = match[1]!; const index = Number(match[2] ?? 0);
    const uniform = [...program.executable!.uniforms, ...program.executable!.samplers].find(value => baseName(value.name) === base);
    if (!uniform || index >= uniform.size) return null;
    return new UniformLocation(this.owner, program, program.generation, base, index);
  }
  deleteProgram(program: ProgramObject | null): void {
    if (program === null || !this.valid(program, ProgramObject, true)) return;
    program.deleted = true;
    this.releaseProgram(program);
  }
  private releaseProgram(program: ProgramObject): void {
    if (!program.deleted || this.program === program) return;
    this.objects.delete(program);
    const shaders = program.shaders;
    program.shaders = [];
    if (program.executable) this.compiler.releaseProgram?.(program.executable);
    program.executable = null;
    program.vertexUniforms = new Uint8Array(0);
    program.fragmentUniforms = new Uint8Array(0);
    program.values.clear();
    program.samplerUnits.clear();
    for (const shader of shaders) this.releaseShader(shader);
  }
  isProgram(program: unknown): boolean {
    return !this.lost && program instanceof ProgramObject && program.owner === this.owner && (!program.deleted || this.program === program);
  }

  private uniform(location: UniformLocation | null, values: ArrayLike<number>, integer: boolean,
    components: number, matrix = 0): void {
    if (this.lost) return;
    if (location === null) return;
    if (!(location instanceof UniformLocation) || location.owner !== this.owner ||
        location.program !== this.program || !location.program.linkStatus ||
        location.generation !== location.program.generation) {
      return this.error(GL.INVALID_OPERATION);
    }
    if (values.length < components || values.length % components !== 0) return this.error(GL.INVALID_VALUE);
    const program = location.program;
    const units = program.samplerUnits.get(location.name);
    if (units) {
      const sampler = program.executable!.samplers.find(value => baseName(value.name) === location.name)!;
      if (!integer || components !== 1 || (values.length > 1 && !isUniformArray(sampler))) {
        return this.error(GL.INVALID_OPERATION);
      }
      const count = Math.min(values.length, units.length - location.index);
      for (let i = 0; i < count; ++i) {
        const unit = values[i]!;
        if (!Number.isInteger(unit) || unit < 0 || unit >= this.textureUnits.length) return this.error(GL.INVALID_VALUE);
      }
      for (let i = 0; i < count; ++i) units[location.index + i] = values[i]!;
      return;
    }
    const uniform = program.executable!.uniforms.find(value => baseName(value.name) === location.name)!;
    const isInteger = [GL.INT, GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4,
      GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x1404);
    const isBoolean = [GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x8b56);
    const expectedMatrix = uniform.type === GL.FLOAT_MAT2 ? 2 : uniform.type === GL.FLOAT_MAT3 ? 3 :
      uniform.type === GL.FLOAT_MAT4 ? 4 : 0;
    if ((!isBoolean && integer !== isInteger) || expectedMatrix !== matrix || componentCount(uniform.type) !== components ||
        (values.length / components > 1 && !isUniformArray(uniform))) {
      return this.error(GL.INVALID_OPERATION);
    }
    const stored = program.values.get(location.name)!;
    const length = Math.min(values.length, (uniform.size - location.index) * components);
    for (let i = 0; i < length; i++) {
      const value = isBoolean ? (Number(values[i]) === 0 ? 0 : 1) : Number(values[i]);
      stored[location.index * components + i] = value;
    }
    this.packUniform(program, uniform, stored);
  }
  private packUniform(program: ProgramObject, uniform: ProgramUniform, values: ArrayLike<number>): void {
    const components = componentCount(uniform.type);
    const dimension = uniform.type === GL.FLOAT_MAT2 ? 2 : uniform.type === GL.FLOAT_MAT3 ? 3 :
      uniform.type === GL.FLOAT_MAT4 ? 4 : 0;
    const integer = [GL.INT, GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4,
      GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x1404);
    for (const [data, start] of [[program.vertexUniforms, uniform.vertexOffset],
      [program.fragmentUniforms, uniform.fragmentOffset]] as const) {
      if (start === null) continue;
      const view = new DataView(data.buffer);
      for (let element = 0; element < uniform.size; element++) {
        const offset = start + element * (uniform.arrayStride || components * 4);
        for (let component = 0; component < components; component++) {
          const position = dimension ? offset + Math.floor(component / dimension) * (uniform.matrixStride || 16) +
            component % dimension * 4 : offset + component * 4;
          const value = Number(values[element * components + component]);
          if (integer) view.setInt32(position, value, true);
          else view.setFloat32(position, value, true);
        }
      }
    }
  }
  uniform1f(location: UniformLocation | null, x: number): void { this.uniform(location, [x], false, 1); }
  uniform2f(location: UniformLocation | null, x: number, y: number): void { this.uniform(location, [x, y], false, 2); }
  uniform3f(location: UniformLocation | null, x: number, y: number, z: number): void { this.uniform(location, [x, y, z], false, 3); }
  uniform4f(location: UniformLocation | null, x: number, y: number, z: number, w: number): void { this.uniform(location, [x, y, z, w], false, 4); }
  uniform1i(location: UniformLocation | null, x: number): void { this.uniform(location, [x], true, 1); }
  uniform2i(location: UniformLocation | null, x: number, y: number): void { this.uniform(location, [x, y], true, 2); }
  uniform3i(location: UniformLocation | null, x: number, y: number, z: number): void { this.uniform(location, [x, y, z], true, 3); }
  uniform4i(location: UniformLocation | null, x: number, y: number, z: number, w: number): void { this.uniform(location, [x, y, z, w], true, 4); }
  uniform1fv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, false, 1); }
  uniform2fv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, false, 2); }
  uniform3fv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, false, 3); }
  uniform4fv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, false, 4); }
  uniform1iv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, true, 1); }
  uniform2iv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, true, 2); }
  uniform3iv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, true, 3); }
  uniform4iv(location: UniformLocation | null, values: ArrayLike<number>): void { this.uniform(location, values, true, 4); }
  uniformMatrix2fv(location: UniformLocation | null, transpose: boolean, values: ArrayLike<number>): void {
    if (this.lost || location === null) return;
    if (transpose) return this.error(GL.INVALID_VALUE); this.uniform(location, values, false, 4, 2);
  }
  uniformMatrix3fv(location: UniformLocation | null, transpose: boolean, values: ArrayLike<number>): void {
    if (this.lost || location === null) return;
    if (transpose) return this.error(GL.INVALID_VALUE); this.uniform(location, values, false, 9, 3);
  }
  uniformMatrix4fv(location: UniformLocation | null, transpose: boolean, values: ArrayLike<number>): void {
    if (this.lost || location === null) return;
    if (transpose) return this.error(GL.INVALID_VALUE); this.uniform(location, values, false, 16, 4);
  }
  getUniform(program: ProgramObject, location: UniformLocation): unknown {
    if (!this.valid(program, ProgramObject) || !program.linkStatus || !(location instanceof UniformLocation) ||
        location.program !== program || location.owner !== this.owner || location.generation !== program.generation) {
      this.error(GL.INVALID_OPERATION); return null;
    }
    if (program.samplerUnits.has(location.name)) return program.samplerUnits.get(location.name)![location.index];
    const uniform = program.executable!.uniforms.find(value => baseName(value.name) === location.name)!;
    const values = program.values.get(location.name)!;
    const components = componentCount(uniform.type);
    const boolean = [GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x8b56);
    if (components === 1) return boolean ? !!values[location.index] : values[location.index];
    const result = values.slice(location.index * components, (location.index + 1) * components);
    return boolean ? [...result].map(value => !!value) : result;
  }

  supportsVertexArrayObjects(): boolean { return true; }
  enableVertexArrayObjects(): void { this.arraysEnabled = true; }
  createVertexArrayOES(): VertexArrayObject { return this.track(new VertexArrayObject(this.owner, this.profile.vertexAttributes)); }
  bindVertexArrayOES(array: VertexArrayObject | null): boolean {
    if (array) array.boundOnce = true;
    this.currentArray = array ?? this.defaultArray;
    return true;
  }
  isVertexArrayOES(array: VertexArrayObject): boolean { return array.boundOnce && !array.deleted; }
  deleteVertexArrayOES(array: VertexArrayObject): void {
    if (this.currentArray === array) this.currentArray = this.defaultArray;
    this.objects.delete(array);
    array.deleted = true;
    array.attributes.length = 0;
    array.element = null;
  }

  enableVertexAttribArray(index: number): void {
    const attribute = this.attributes[index];
    if (!attribute) return this.error(GL.INVALID_VALUE); attribute.enabled = true;
  }
  disableVertexAttribArray(index: number): void {
    const attribute = this.attributes[index];
    if (!attribute) return this.error(GL.INVALID_VALUE); attribute.enabled = false;
  }
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    const attribute = this.attributes[index];
    if (!attribute || size < 1 || size > 4 || stride < 0 || stride > 255 || offset < 0) return this.error(GL.INVALID_VALUE);
    const componentBytes = vertexComponentBytes(type);
    if (!componentBytes) return this.error(GL.INVALID_ENUM);
    if (stride % componentBytes || offset % componentBytes) return this.error(GL.INVALID_OPERATION);
    if (!this.arrayBuffer && offset !== 0) return this.error(GL.INVALID_OPERATION);
    Object.assign(attribute, { buffer: this.arrayBuffer, size, type, normalized: !!normalized, stride, offset });
  }
  private constantAttribute(index: number, values: ArrayLike<number>, components: number): void {
    const attribute = this.attributes[index];
    if (!attribute) return this.error(GL.INVALID_VALUE);
    if (values.length < components) return this.error(GL.INVALID_VALUE);
    this.constants[index] = [values[0] ?? 0, components > 1 ? values[1] ?? 0 : 0,
      components > 2 ? values[2] ?? 0 : 0, components > 3 ? values[3] ?? 1 : 1];
  }
  vertexAttrib1f(index: number, x: number): void { this.constantAttribute(index, [x], 1); }
  vertexAttrib2f(index: number, x: number, y: number): void { this.constantAttribute(index, [x, y], 2); }
  vertexAttrib3f(index: number, x: number, y: number, z: number): void { this.constantAttribute(index, [x, y, z], 3); }
  vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void { this.constantAttribute(index, [x, y, z, w], 4); }
  vertexAttrib1fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, values, 1); }
  vertexAttrib2fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, values, 2); }
  vertexAttrib3fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, values, 3); }
  vertexAttrib4fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, values, 4); }
  getVertexAttrib(index: number, parameter: number): unknown {
    if (this.lost) return null;
    const attribute = this.attributes[index];
    if (!attribute) { this.error(GL.INVALID_VALUE); return null; }
    const values: Record<number, unknown> = {
      [GL.VERTEX_ATTRIB_ARRAY_ENABLED]: attribute.enabled, [GL.VERTEX_ATTRIB_ARRAY_SIZE]: attribute.size,
      [GL.VERTEX_ATTRIB_ARRAY_TYPE]: attribute.type, [GL.VERTEX_ATTRIB_ARRAY_NORMALIZED]: attribute.normalized,
      [GL.VERTEX_ATTRIB_ARRAY_STRIDE]: attribute.stride,
      [GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING]: attribute.buffer,
      [GL.CURRENT_VERTEX_ATTRIB]: new Float32Array(this.constants[index]!),
    };
    if (parameter in values) return values[parameter];
    this.error(GL.INVALID_ENUM); return null;
  }
  getVertexAttribOffset(index: number, parameter: number): number {
    if (this.lost) return 0;
    if (!this.attributes[index]) { this.error(GL.INVALID_VALUE); return 0; }
    if (parameter !== GL.VERTEX_ATTRIB_ARRAY_POINTER) { this.error(GL.INVALID_ENUM); return 0; }
    return this.attributes[index]!.offset;
  }

  drawArrays(mode: number, first: number, count: number): void { this.draw(mode, first, count, null); }
  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.draw(mode, 0, count, { type, offset });
  }
  private draw(mode: number, first: number, count: number,
    elements: { type: number; offset: number } | null): void {
    if (this.lost) return;
    if (!isDrawMode(mode)) return this.error(GL.INVALID_ENUM);
    if (first < 0 || count < 0 || !Number.isInteger(first) || !Number.isInteger(count)) return this.error(GL.INVALID_VALUE);
    let indices: DrawOperation['indices'] = null;
    if (elements) {
      const { type, offset } = elements;
      if (type !== GL.UNSIGNED_BYTE && type !== GL.UNSIGNED_SHORT
        && !(type === GL.UNSIGNED_INT && this.elementIndexUint)) return this.error(GL.INVALID_ENUM);
      if (offset < 0) return this.error(GL.INVALID_VALUE);
      if (!this.elementBuffer || !Number.isInteger(offset) || offset % elementIndexBytes(type)) {
        return this.error(GL.INVALID_OPERATION);
      }
      indices = { data: this.elementBuffer.data, bufferVersion: this.elementBuffer.executionVersion, type, offset };
    }
    if (!this.program?.linkStatus || !this.program.executable) return this.error(GL.INVALID_OPERATION);
    if (this.attributes.some(attribute => attribute.enabled && !attribute.buffer)) return this.error(GL.INVALID_OPERATION);
    if (this.samplerTypeConflict(this.program)) return this.error(GL.INVALID_OPERATION);
    const target = this.target(); if (!target) return;
    if (this.state.stencilTest && (target.isDefault ? this.contextAttributes.stencil : isStencilRenderbufferFormat(target.depthFormat))) {
      const { stencilFront: front, stencilBack: back } = this.state;
      if (((front.writeMask ^ back.writeMask) & 0xff) || ((front.valueMask ^ back.valueMask) & 0xff)
        || stencilReference(front.reference) !== stencilReference(back.reference)) return this.error(GL.INVALID_OPERATION);
    }
    let vertices = first + count;
    if (indices && count) {
      const bytes = elementIndexBytes(indices.type);
      const end = indices.offset + count * bytes;
      if (end > indices.data.byteLength) return this.error(GL.INVALID_OPERATION);
      if (indices.type === GL.UNSIGNED_INT
        && !this.program.vertexInputs.some(input => this.attributes[input.location]!.enabled)) {
        // WebGL1 shaders cannot observe an index without an enabled vertex input.
        indices = null;
        vertices = count;
      } else {
        vertices = this.elementBuffer!.indexedVertexCount(indices.offset, end, bytes);
      }
    }
    const attributes: AttributeSnapshot[] = [];
    for (const active of this.program.vertexInputs) {
      const attribute = this.attributes[active.location]!;
      if (attribute.enabled) {
        if (!attribute.buffer) return this.error(GL.INVALID_OPERATION);
        const elementBytes = attribute.size * vertexComponentBytes(attribute.type);
        const stride = attribute.stride || elementBytes;
        const required = count ? attribute.offset + (vertices - 1) * stride + elementBytes : 0;
        if (required > attribute.buffer.data.byteLength) return this.error(GL.INVALID_OPERATION);
      }
      attributes.push({ location: active.location, shaderType: active.type,
        size: attribute.size, type: attribute.type, normalized: attribute.normalized,
        stride: attribute.stride, offset: attribute.offset,
        data: attribute.enabled ? attribute.buffer!.data : null,
        bufferVersion: attribute.enabled ? attribute.buffer!.executionVersion : undefined,
        constant: [...this.constants[active.location]!] });
    }
    const textures: TextureBinding[] = [];
    for (const sampler of this.program.executable.samplers) {
      for (const unit of this.program.samplerUnits.get(baseName(sampler.name))!) {
        const binding = this.textureUnits[unit]!;
        const cube = sampler.type === GL.SAMPLER_CUBE;
        if (!cube && sampler.type !== GL.SAMPLER_2D) return unsupported("sampler type");
        const texture = cube ? binding.cubeMap : binding.texture2D;
        const levels = texture ? textureSamplingLevelCount(texture, this.floatLinearTextures) : 0;
        if (this.framebuffer?.color === texture && levels > this.framebuffer.colorLevel) return this.error(GL.INVALID_OPERATION);
        const parameters = texture ? { ...texture.parameters } :
          { minFilter: GL.NEAREST, magFilter: GL.NEAREST, wrapS: GL.CLAMP_TO_EDGE, wrapT: GL.CLAMP_TO_EDGE };
        if (levels > 1 && texture) {
          const mipImages = [];
          for (let level = 0; level < levels; level++) {
            for (const target of textureTargets(texture)) mipImages.push(texture.image(target, level)!.storage!);
          }
          textures.push({ dimension: cube ? "cube" : "2d", storage: null, parameters, mipImages });
        } else if (cube) {
          const snapshot: TextureBinding = { dimension: "cube", storage: null, parameters };
          if (levels) snapshot.cubeFaces = CUBE_FACES.map(face => texture!.image(face)!.storage!);
          textures.push(snapshot);
        } else textures.push({ storage: levels ? texture!.storage : null, parameters });
      }
    }
    if (!count || !target.width || !target.height ||
        (mode >= GL.TRIANGLES && this.state.cull && this.state.cullFace === GL.FRONT_AND_BACK)) return;
    this.host.draw({ program: this.program.executable, mode, target, state: snapshotRaster(this.state),
      attributes, vertexCount: vertices, first, count, indices,
      vertexUniforms: this.uniformSnapshots.copy(this.program.vertexUniforms),
      fragmentUniforms: this.uniformSnapshots.copy(this.program.fragmentUniforms),
      textures });
    this.wroteColorTarget();
    this.schedule();
  }

  createTexture(): TextureObject | null { return this.lost ? null : this.track(new TextureObject(this.owner)); }
  activeTexture(texture: number): void {
    const unit = texture - GL.TEXTURE0;
    if (!Number.isInteger(unit) || unit < 0 || unit >= this.textureUnits.length) return this.error(GL.INVALID_ENUM);
    this.activeUnit = unit;
  }
  bindTexture(target: number, texture: TextureObject | null): void {
    if (target !== GL.TEXTURE_2D && target !== GL.TEXTURE_CUBE_MAP) return this.error(GL.INVALID_ENUM);
    if (texture !== null && !this.valid(texture, TextureObject)) return;
    if (texture && texture.target !== null && texture.target !== target) {
      return this.error(GL.INVALID_OPERATION);
    }
    if (texture) { texture.target = target; texture.initialized = true; }
    const unit = this.textureUnits[this.activeUnit]!;
    if (target === GL.TEXTURE_2D) unit.texture2D = texture;
    else unit.cubeMap = texture;
  }
  texParameteri(target: number, parameter: number, value: number): void {
    const texture = this.boundTexture(target); if (texture === undefined) return;
    if (!texture) return this.error(GL.INVALID_OPERATION);
    if (parameter === GL.TEXTURE_MAG_FILTER && (value === GL.NEAREST || value === GL.LINEAR)) texture.parameters.magFilter = value;
    else if (parameter === GL.TEXTURE_MIN_FILTER && [GL.NEAREST, GL.LINEAR, GL.NEAREST_MIPMAP_NEAREST,
      GL.LINEAR_MIPMAP_NEAREST, GL.NEAREST_MIPMAP_LINEAR, GL.LINEAR_MIPMAP_LINEAR].includes(value as 0x2600)) texture.parameters.minFilter = value;
    else if ((parameter === GL.TEXTURE_WRAP_S || parameter === GL.TEXTURE_WRAP_T) &&
      [GL.REPEAT, GL.CLAMP_TO_EDGE, GL.MIRRORED_REPEAT].includes(value as 0x2901)) {
      if (parameter === GL.TEXTURE_WRAP_S) texture.parameters.wrapS = value; else texture.parameters.wrapT = value;
    } else this.error(GL.INVALID_ENUM);
  }
  texParameterf(target: number, parameter: number, value: number): void { this.texParameteri(target, parameter, value); }
  getTexParameter(target: number, parameter: number): unknown {
    const texture = this.boundTexture(target); if (texture === undefined) return null;
    if (!texture) { this.error(GL.INVALID_OPERATION); return null; }
    const values: Record<number, number> = { [GL.TEXTURE_MIN_FILTER]: texture.parameters.minFilter,
      [GL.TEXTURE_MAG_FILTER]: texture.parameters.magFilter, [GL.TEXTURE_WRAP_S]: texture.parameters.wrapS,
      [GL.TEXTURE_WRAP_T]: texture.parameters.wrapT };
    if (parameter in values) return values[parameter]; this.error(GL.INVALID_ENUM); return null;
  }
  compressedTexImage2D(target: number): void {
    const texture = this.boundImageTexture(target);
    if (texture !== undefined) this.error(texture === null ? GL.INVALID_OPERATION : GL.INVALID_ENUM);
  }
  compressedTexSubImage2D(target: number): void { this.compressedTexImage2D(target); }

  private allocatePixels(width: number, height: number, bytesPerPixel = 4): Uint8Array | null {
    try { return new Uint8Array(width * height * bytesPerPixel); }
    catch { this.error(GL.OUT_OF_MEMORY); return null; }
  }
  private pixelData(width: number, height: number, format: number, type: number, source: unknown): Uint8Array | null {
    if (format === SRGB.SRGB_EXT) format = GL.RGB;
    else if (format === SRGB.SRGB_ALPHA_EXT) format = GL.RGBA;
    const float = type === GL.FLOAT;
    const packed = !float && type !== GL.UNSIGNED_BYTE;
    const components = format === GL.RGBA ? 4 : format === GL.RGB ? 3 : format === GL.LUMINANCE_ALPHA ? 2 : 1;
    let bytes: Uint8Array;
    let stride: number;
    const upload = source && typeof source === "object" && "bytes" in source && "viewType" in source
      ? source as PixelUpload : null;
    const typedSource = ArrayBuffer.isView(source) || upload !== null;
    const domSource = upload?.source === "dom" || upload?.source === "dom-converted";
    const converted = upload?.source === "dom-converted";
    const packedView = packed && !domSource;
    const pixelBytes = domSource ? 4 : packed ? 2 : components * (float ? 4 : 1);
    if (source === null) {
      const pixels = this.allocatePixels(width, height, float ? 16 : 4); if (!pixels) return null;
      if (float) {
        if (format === GL.RGB || format === GL.LUMINANCE) {
          const rgba = new DataView(pixels.buffer);
          for (let i = 12; i < pixels.length; i += 16) rgba.setFloat32(i, 1, true);
        }
        return pixels;
      }
      if (format === GL.RGB || format === GL.LUMINANCE) {
        for (let pixel = 0; pixel < width * height; pixel++) pixels[pixel * 4 + 3] = 255;
      }
      return pixels;
    }
    if (typedSource) {
      const tag = upload?.viewType ?? Object.prototype.toString.call(source).slice(8, -1);
      const matchesView = float && !domSource ? tag === "Float32Array" : packedView
        ? tag === "Uint16Array" : tag === "Uint8Array" || tag === "Uint8ClampedArray";
      if (!matchesView) {
        this.error(GL.INVALID_OPERATION); return null;
      }
      bytes = upload?.bytes ?? bytesOf(source as ArrayBufferView);
      const rowBytes = width * pixelBytes;
      stride = domSource ? rowBytes : Math.ceil(rowBytes / this.unpackAlignment) * this.unpackAlignment;
      const required = width && height ? (height - 1) * stride + rowBytes : 0;
      if (bytes.byteLength < required) {
        this.error(GL.INVALID_OPERATION); return null;
      }
    } else {
      this.error(GL.INVALID_VALUE); return null;
    }
    const pixels = this.allocatePixels(width, height, float ? 16 : 4); if (!pixels) return null;
    if (float) {
      const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const rgba = new DataView(pixels.buffer);
      for (let y = 0; y < height; y++) {
        const row = (this.unpackFlipY && !converted ? height - 1 - y : y) * stride;
        for (let x = 0; x < width; x++) {
          const start = row + x * pixelBytes;
          const component = (i: number) => domSource ? bytes[start + i]! / 255 : input.getFloat32(start + i * 4, upload !== null || littleEndian);
          const luminance = format === GL.LUMINANCE || format === GL.LUMINANCE_ALPHA;
          const r = format === GL.ALPHA ? 0 : component(0);
          const g = format === GL.ALPHA ? 0 : luminance ? r : component(1);
          const b = format === GL.ALPHA ? 0 : luminance ? r : component(2);
          const a = format === GL.RGB || format === GL.LUMINANCE ? 1 : domSource || format === GL.RGBA
            ? component(3) : format === GL.LUMINANCE_ALPHA ? component(1) : component(0);
          const factor = this.unpackPremultiply && !converted ? (domSource ? component(3) : a) : 1;
          const dst = (y * width + x) * 16;
          rgba.setFloat32(dst, r * factor, true);
          rgba.setFloat32(dst + 4, g * factor, true);
          rgba.setFloat32(dst + 8, b * factor, true);
          rgba.setFloat32(dst + 12, a, true);
        }
      }
      return pixels;
    }
    const words = packedView ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    const expand = (value: number, mask: number) => Math.round(value * 255 / mask);
    const quantize = (value: number, bits: number) => expand(value >>> (8 - bits), (1 << bits) - 1);
    const rgbBits = type === GL.UNSIGNED_SHORT_4_4_4_4 ? 4 : 5;
    const greenBits = type === GL.UNSIGNED_SHORT_5_6_5 ? 6 : rgbBits;
    const alphaBits = type === GL.UNSIGNED_SHORT_4_4_4_4 ? 4 : 1;
    const wordLittleEndian = upload !== null || littleEndian;
    for (let y = 0; y < height; y++) {
      const sourceY = this.unpackFlipY && !converted ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const offset = sourceY * stride + x * pixelBytes;
        const destination = (y * width + x) * 4;
        let r: number, g: number, b: number, a: number;
        if (words) {
          const word = words.getUint16(offset, wordLittleEndian);
          if (type === GL.UNSIGNED_SHORT_5_6_5) {
            r = expand(word >>> 11, 31);
            g = expand((word >>> 5) & 63, 63);
            b = expand(word & 31, 31);
            a = 255;
          } else if (type === GL.UNSIGNED_SHORT_4_4_4_4) {
            r = expand(word >>> 12, 15);
            g = expand((word >>> 8) & 15, 15);
            b = expand((word >>> 4) & 15, 15);
            a = expand(word & 15, 15);
          } else {
            r = expand(word >>> 11, 31);
            g = expand((word >>> 6) & 31, 31);
            b = expand((word >>> 1) & 31, 31);
            a = (word & 1) * 255;
          }
        } else {
          r = bytes[offset] ?? 0; g = bytes[offset + 1] ?? 0;
          b = bytes[offset + 2] ?? 0; a = bytes[offset + 3] ?? 255;
        }
        const sourceAlpha = a;
        if (format === GL.RGB) a = 255;
        if (format === GL.ALPHA) {
          if (!domSource) a = r;
          r = g = b = 0;
        }
        if (format === GL.LUMINANCE) { a = 255; g = b = r; }
        if (format === GL.LUMINANCE_ALPHA) {
          if (!domSource) a = g;
          g = b = r;
        }
        const alpha = domSource ? sourceAlpha : a;
        const factor = this.unpackPremultiply && !converted ? alpha / 255 : 1;
        r = Math.round(r * factor); g = Math.round(g * factor); b = Math.round(b * factor);
        // DOM extraction delivers RGBA8 even when the upload requests fewer bits per channel.
        if (domSource && packed) {
          r = quantize(r, rgbBits); g = quantize(g, greenBits);
          b = quantize(b, rgbBits); a = quantize(a, alphaBits);
        }
        pixels[destination] = r; pixels[destination + 1] = g;
        pixels[destination + 2] = b; pixels[destination + 3] = a;
      }
    }
    return pixels;
  }
  private validateDomSource(width: number, height: number, sourceValid: boolean): boolean {
    if (!sourceValid || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0) {
      this.error(GL.INVALID_VALUE);
      return false;
    }
    return true;
  }
  private validateTextureFormat(format: number, type: number): boolean {
    const srgb = this.srgbTextures && isSrgbTextureFormat(format);
    if ((!srgb && ![GL.RGBA, GL.RGB, GL.ALPHA, GL.LUMINANCE, GL.LUMINANCE_ALPHA].includes(format as 0x1908)) ||
        !(type === GL.FLOAT && this.floatTextures) && ![GL.UNSIGNED_BYTE, GL.UNSIGNED_SHORT_5_6_5, GL.UNSIGNED_SHORT_4_4_4_4,
          GL.UNSIGNED_SHORT_5_5_5_1].includes(type as 0x1401)) {
      this.error(GL.INVALID_ENUM); return false;
    }
    if (srgb && type !== GL.UNSIGNED_BYTE || (type !== GL.FLOAT && type !== GL.UNSIGNED_BYTE && format !== (type === GL.UNSIGNED_SHORT_5_6_5 ? GL.RGB : GL.RGBA))) {
      this.error(GL.INVALID_OPERATION); return false;
    }
    return true;
  }
  private validateTextureImage(target: number, level: number, internalFormat: number,
    width: number, height: number, border: number, format: number, type: number): TextureObject | null {
    const texture = this.boundImageTexture(target);
    if (texture === undefined) return null;
    if (!texture) { this.error(GL.INVALID_OPERATION); return null; }
    const levelLimit = Math.floor(this.host.limits.maxTextureDimension2D / 2 ** level);
    if (!Number.isInteger(level) || level < 0 || !levelLimit || width < 0 || height < 0
        || !Number.isInteger(width) || !Number.isInteger(height) || width > levelLimit || height > levelLimit
        || border !== 0 || (target !== GL.TEXTURE_2D && width !== height)
        || (level > 0 && (!isPowerOfTwo(width) || !isPowerOfTwo(height)))) {
      this.error(GL.INVALID_VALUE); return null;
    }
    if (!this.validateTextureFormat(format, type)) return null;
    if (internalFormat !== format) { this.error(GL.INVALID_OPERATION); return null; }
    return texture;
  }
  private validateTextureSubImage(target: number, level: number, x: number, y: number,
    width: number, height: number, format?: number, type: number = GL.UNSIGNED_BYTE): TextureObject | null {
    const texture = this.boundImageTexture(target);
    if (texture === undefined) return null;
    if (!Number.isInteger(level) || level < 0 || 2 ** level > this.host.limits.maxTextureDimension2D) {
      this.error(GL.INVALID_VALUE); return null;
    }
    const image = texture?.image(target, level);
    if (!image?.storage) { this.error(GL.INVALID_OPERATION); return null; }
    if (x < 0 || y < 0 || width < 0 || height < 0 || !Number.isInteger(width) || !Number.isInteger(height) ||
        x + width > image.storage.width || y + height > image.storage.height) {
      this.error(GL.INVALID_VALUE); return null;
    }
    if (format !== undefined) {
      if (!this.validateTextureFormat(format, type)) return null;
      if (format !== image.format || type !== image.type) { this.error(GL.INVALID_OPERATION); return null; }
    }
    return texture;
  }
  prepareDomTextureUpload(request: DomTextureUploadRequest): DomTextureUploadPlan | null {
    if (this.lost) return null;
    if (request.closedVideoFrame) {
      if (this.boundImageTexture(request.target) !== undefined) this.error(GL.INVALID_OPERATION);
      return null;
    }
    if (!this.validateDomSource(request.width, request.height, request.sourceValid)) return null;
    if (request.sourceContextLost) { this.error(GL.INVALID_OPERATION); return null; }
    const texture = request.operation === "texSubImage2D"
      ? this.validateTextureSubImage(request.target, request.level, request.x, request.y,
        request.width, request.height, request.format, request.type)
      : this.validateTextureImage(request.target, request.level, request.internalFormat,
        request.width, request.height, 0, request.format, request.type);
    return texture ? { flipY: this.unpackFlipY, premultiplyAlpha: this.unpackPremultiply,
      colorSpaceConversion: this.unpackColorSpace } : null;
  }
  copyTexImage2D(target: number, level: number, format: number, x: number, y: number,
    width: number, height: number, border: number): void {
    const texture = this.validateTextureImage(target, level, format, width, height, border, format, GL.UNSIGNED_BYTE);
    if (texture && isSrgbTextureFormat(format)) return this.error(GL.INVALID_ENUM);
    if (texture) this.copyFramebufferImage(texture, target, level, format, null, 0, 0, x, y, width, height);
  }

  copyTexSubImage2D(target: number, level: number, x: number, y: number, sourceX: number, sourceY: number,
    width: number, height: number): void {
    const texture = this.validateTextureSubImage(target, level, x, y, width, height);
    if (!texture) return;
    const image = texture.image(target, level)!;
    this.copyFramebufferImage(texture, target, level, image.format, image, x, y, sourceX, sourceY, width, height);
  }

  private copyFramebufferImage(texture: TextureObject, target: number, level: number, format: number,
    parent: TextureImage | null, x: number, y: number, sourceX: number, sourceY: number,
    width: number, height: number): void {
    const source = this.target();
    if (!source) return;
    const sourceHasAlpha = source.isDefault ? this.contextAttributes.alpha : !source.colorOpaque;
    if (isSrgbTextureFormat(format) || source.color?.texelFormat === "rgba8unorm-srgb" ||
        parent?.type === GL.FLOAT || (!sourceHasAlpha && format !== GL.RGB && format !== GL.LUMINANCE)
      || (this.framebuffer?.color === texture && this.framebuffer.colorTarget === target && this.framebuffer.colorLevel === level)) {
      return this.error(GL.INVALID_OPERATION);
    }
    if (parent && (width === 0 || height === 0 || sourceX >= source.width || sourceY >= source.height
      || sourceX + width <= 0 || sourceY + height <= 0)) return;
    const type = parent?.type ?? GL.UNSIGNED_BYTE;
    const copy: TextureCopy = { source, sourceX, sourceY, x, y, width, height, format, type };
    const image = texture.image(target, level) ?? { storage: null, generation: 0, version: 0, format, type };
    const previous = image.storage;
    const previousVersion = parent && this.resources ? this.textureVersion(texture, target, level) : null;
    if (!parent) image.generation++;
    image.version++;
    image.format = format;
    image.type = type;
    texture.setImage(target, level, image);
    const imageWidth = parent?.storage?.width ?? width;
    const imageHeight = parent?.storage?.height ?? height;
    if (this.resources) {
      const version = this.textureVersion(texture, target, level);
      this.resources.apply({ kind: "copy-texture", version, previous: previousVersion,
        width: imageWidth, height: imageHeight, copy });
      image.storage = this.resources.texture(version);
    } else {
      image.storage = { width: imageWidth, height: imageHeight, generation: image.generation, copy,
        ...(parent ? { parent: previous! } : {}) };
      this.host.replaceStorage(previous, image.storage);
    }
    this.schedule();
  }
  texImage2D(...arguments_: unknown[]): void {
    const [target, level, internalFormat] = arguments_ as number[];
    const dimensions = arguments_.length === 9;
    const source = arguments_[dimensions ? 8 : 5];
    const sourceImage = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number } | null;
    const width = Number(dimensions ? arguments_[3] : sourceImage?.naturalWidth ?? sourceImage?.videoWidth ?? sourceImage?.width);
    const height = Number(dimensions ? arguments_[4] : sourceImage?.naturalHeight ?? sourceImage?.videoHeight ?? sourceImage?.height);
    const border = dimensions ? Number(arguments_[5]) : 0;
    const format = Number(arguments_[dimensions ? 6 : 3]);
    const type = Number(arguments_[dimensions ? 7 : 4]);
    const upload = source && typeof source === "object" && "bytes" in source && "viewType" in source
      ? source as PixelUpload : null;
    if (upload?.source && !this.validateDomSource(width, height, true)) return;
    const texture = this.validateTextureImage(target!, level!, internalFormat!, width, height, border, format, type);
    if (!texture) return;
    const data = this.pixelData(width, height, format, type, source); if (!data) return;
    const image: TextureImage = texture.image(target!, level!) ?? { storage: null, generation: 0, version: 0, format, type };
    const previous = image.storage;
    image.generation++; image.version++; image.format = format; image.type = type;
    texture.setImage(target!, level!, image);
    const texelFormat = type === GL.FLOAT ? "rgba32float" : isSrgbTextureFormat(format) ? "rgba8unorm-srgb" : undefined;
    if (this.resources) {
      const version = this.textureVersion(texture, target!, level!);
      this.resources.apply({ kind: "define-texture", version, width, height, data, texelFormat });
      image.storage = this.resources.texture(version);
    } else {
      image.storage = { width, height, generation: image.generation, data, texelFormat };
      this.host.replaceStorage(previous, image.storage);
    }
    this.schedule();
  }
  texSubImage2D(...arguments_: unknown[]): void {
    const [target, level, x, y] = arguments_ as number[];
    const dimensions = arguments_.length === 9;
    const source = arguments_[dimensions ? 8 : 6];
    const sourceImage = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | null;
    const width = Number(dimensions ? arguments_[4] : sourceImage?.naturalWidth ?? sourceImage?.width);
    const height = Number(dimensions ? arguments_[5] : sourceImage?.naturalHeight ?? sourceImage?.height);
    const format = Number(arguments_[dimensions ? 6 : 4]);
    const type = Number(arguments_[dimensions ? 7 : 5]);
    const upload = source && typeof source === "object" && "bytes" in source && "viewType" in source
      ? source as PixelUpload : null;
    if (upload?.source && !this.validateDomSource(width, height, true)) return;
    const texture = this.validateTextureSubImage(target!, level!, x!, y!, width, height, format, type);
    if (!texture) return;
    if (source === null) return this.error(GL.INVALID_VALUE);
    const data = this.pixelData(width, height, format, type, source); if (!data) return;
    if (width === 0 || height === 0) return;
    const image = texture.image(target!, level!)!;
    const previous = image.storage!;
    const previousVersion = this.resources ? this.textureVersion(texture, target!, level!) : null;
    image.version++;
    if (this.resources) {
      const version = this.textureVersion(texture, target!, level!);
      this.resources.apply({ kind: "update-texture", version, previous: previousVersion!,
        x: x!, y: y!, width, height, data });
      image.storage = this.resources.texture(version);
    } else {
      image.storage = { width: previous.width, height: previous.height,
        generation: image.generation, parent: previous, ...(previous.texelFormat ? { texelFormat: previous.texelFormat } : {}),
        update: { x: x!, y: y!, width, height, data } };
      this.host.replaceStorage(previous, image.storage);
    }
    this.schedule();
  }
  generateMipmap(target: number): void {
    const texture = this.boundTexture(target);
    if (texture === undefined) return;
    if (texture === null) return this.error(GL.INVALID_OPERATION);
    const base = textureBase(texture);
    if (!base?.storage || isSrgbTextureFormat(base.format) || !isPowerOfTwo(base.storage.width) || !isPowerOfTwo(base.storage.height)) {
      return this.error(GL.INVALID_OPERATION);
    }
    const { width, height } = base.storage;
    const targets = textureTargets(texture);
    const levels = Math.floor(Math.log2(Math.max(width, height)));
    for (let level = 1; level <= levels; level++) {
      for (const face of targets) {
        const image = texture.image(face, level);
        if (image && (image.generation >= Number.MAX_SAFE_INTEGER || image.version >= Number.MAX_SAFE_INTEGER)) {
          return this.error(GL.OUT_OF_MEMORY);
        }
      }
    }
    for (let level = 1; level <= levels; level++) {
      for (const face of targets) {
        const image = texture.image(face, level) ?? { storage: null, generation: 0, version: 0,
          format: base.format, type: base.type };
        const previous = image.storage;
        image.generation++; image.version++; image.format = base.format; image.type = base.type;
        texture.setImage(face, level, image);
        const mipWidth = Math.max(1, width >> level);
        const mipHeight = Math.max(1, height >> level);
        if (this.resources) {
          const version = this.textureVersion(texture, face, level);
          this.resources.apply({ kind: "generate-texture-mip", version,
            source: this.textureVersion(texture, face, level - 1), width: mipWidth, height: mipHeight });
          image.storage = this.resources.texture(version);
        } else {
          image.storage = { width: mipWidth, height: mipHeight, generation: image.generation,
            texelFormat: base.storage!.texelFormat, mipSource: texture.image(face, level - 1)!.storage! };
          this.host.replaceStorage(previous, image.storage);
        }
      }
    }
    if (levels) this.schedule();
  }
  deleteTexture(texture: TextureObject | null): void {
    if (texture === null || !this.valid(texture, TextureObject, true) || texture.deleted) return;
    texture.deleted = true;
    this.objects.delete(texture);
    for (const unit of this.textureUnits) {
      if (unit.texture2D === texture) unit.texture2D = null;
      if (unit.cubeMap === texture) unit.cubeMap = null;
    }
    if (this.framebuffer?.color === texture) this.framebuffer.color = null;
    this.releaseTexture(texture);
  }
  private releaseTexture(texture: TextureObject): void {
    if (!texture.deleted) return;
    const retained = [...this.objects].some(object => object instanceof FramebufferObject && object.color === texture);
    if (!retained) {
      texture.retired = true;
      const retire = (imageTarget: number, level: number, image: TextureImage) => {
        if (!image.storage) return;
        if (this.resources) this.resources.apply({ kind: "retire-texture",
          version: this.textureVersion(texture, imageTarget, level) });
        else this.host.retireStorage(image.storage);
        image.storage = null;
      };
      retire(GL.TEXTURE_2D, 0, texture);
      for (const [level, images] of texture.imageLevels) {
        for (const [target, image] of images) retire(target, level, image);
      }
      texture.imageLevels.clear();
      this.schedule();
    }
  }
  isTexture(texture: unknown): boolean {
    return !this.lost && texture instanceof TextureObject && texture.owner === this.owner && texture.initialized && !texture.deleted;
  }
  pixelStorei(parameter: number, value: number): void {
    if (parameter === GL.UNPACK_ALIGNMENT || parameter === GL.PACK_ALIGNMENT) {
      if (![1, 2, 4, 8].includes(value)) return this.error(GL.INVALID_VALUE);
      if (parameter === GL.UNPACK_ALIGNMENT) this.unpackAlignment = value; else this.packAlignment = value;
    } else if (parameter === GL.UNPACK_FLIP_Y_WEBGL) this.unpackFlipY = !!value;
    else if (parameter === GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL) this.unpackPremultiply = !!value;
    else if (parameter === GL.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      if (value !== GL.NONE && value !== GL.BROWSER_DEFAULT_WEBGL) return this.error(GL.INVALID_VALUE);
      this.unpackColorSpace = value;
    } else this.error(GL.INVALID_ENUM);
  }

  createFramebuffer(): FramebufferObject | null { return this.lost ? null : this.track(new FramebufferObject(this.owner)); }
  bindFramebuffer(target: number, framebuffer: FramebufferObject | null): void {
    if (target !== GL.FRAMEBUFFER) return this.error(GL.INVALID_ENUM);
    if (framebuffer !== null && !this.valid(framebuffer, FramebufferObject)) return;
    if (framebuffer) framebuffer.initialized = true;
    this.framebuffer = framebuffer;
  }
  framebufferTexture2D(target: number, attachment: number, textureTarget: number,
    texture: TextureObject | null, level: number): void {
    const cubeFace = CUBE_FACES.some(face => face === textureTarget);
    if (target !== GL.FRAMEBUFFER || attachment !== GL.COLOR_ATTACHMENT0 ||
        (textureTarget !== GL.TEXTURE_2D && !cubeFace)) return this.error(GL.INVALID_ENUM);
    if (!Number.isInteger(level) || level < 0 || (level !== 0 && !this.framebufferMipmaps)
      || level > Math.floor(Math.log2(this.host.limits.maxTextureDimension2D))) return this.error(GL.INVALID_VALUE);
    if (!this.framebuffer) return this.error(GL.INVALID_OPERATION);
    if (texture !== null && !this.valid(texture, TextureObject)) return;
    if (texture !== null && !texture.initialized) return this.error(GL.INVALID_OPERATION);
    if (texture !== null && texture.target !== (cubeFace ? GL.TEXTURE_CUBE_MAP : GL.TEXTURE_2D)) {
      return this.error(GL.INVALID_OPERATION);
    }
    const previous = this.framebuffer.color;
    this.framebuffer.color = texture;
    this.framebuffer.colorTarget = texture ? textureTarget : GL.TEXTURE_2D;
    this.framebuffer.colorLevel = texture ? level : 0;
    if (previous instanceof RenderbufferObject) this.releaseRenderbuffer(previous);
    else if (previous && previous !== texture) this.releaseTexture(previous);
  }
  checkFramebufferStatus(target: number): number {
    if (this.lost) return GL.FRAMEBUFFER_UNSUPPORTED;
    if (target !== GL.FRAMEBUFFER) { this.error(GL.INVALID_ENUM); return 0; }
    if (!this.framebuffer) return GL.FRAMEBUFFER_COMPLETE;
    const colorTexture = this.framebuffer.colorTexture;
    const colorRenderbuffer = this.framebuffer.colorRenderbuffer;
    const colorImage = this.framebuffer.colorImage;
    const color = colorRenderbuffer ?? colorImage?.storage;
    const auxiliaries = [
      [this.framebuffer.depth, GL.DEPTH_COMPONENT16],
      [this.framebuffer.stencil, GL.STENCIL_INDEX8],
      [this.framebuffer.depthStencil, GL.DEPTH_STENCIL],
    ] as const;
    const attachments = auxiliaries.filter(([object]) => object !== null);
    if (!this.framebuffer.color && attachments.length === 0) return GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
    if (this.framebuffer.color && (!color?.width || !color.height || colorImage?.type === GL.FLOAT ||
        (colorRenderbuffer ? !isColorRenderbufferFormat(colorRenderbuffer.format)
          : colorImage?.format !== GL.RGB && colorImage?.format !== GL.RGBA && colorImage?.format !== SRGB.SRGB_ALPHA_EXT) ||
        (colorTexture?.target === GL.TEXTURE_CUBE_MAP && !textureBase(colorTexture)))) {
      return GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    }
    for (const [buffer, format] of attachments) {
      if (!buffer?.width || !buffer.height || buffer.format !== format) return GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    }
    if (attachments.length > 1) return GL.FRAMEBUFFER_UNSUPPORTED;
    const auxiliary = attachments[0]?.[0];
    if (color && auxiliary && (auxiliary.width !== color.width || auxiliary.height !== color.height)) {
      return GL.FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
    }
    if (!color) return GL.FRAMEBUFFER_UNSUPPORTED;
    return GL.FRAMEBUFFER_COMPLETE;
  }
  getFramebufferAttachmentParameter(target: number, attachment: number, parameter: number): unknown {
    const point = framebufferAttachmentPoint(attachment);
    if (target !== GL.FRAMEBUFFER || !point) {
      this.error(GL.INVALID_ENUM); return null;
    }
    if (!this.framebuffer) { this.error(GL.INVALID_OPERATION); return null; }
    const object = this.framebuffer[point];
    if (parameter === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) return object === null ? GL.NONE :
      object instanceof TextureObject ? GL.TEXTURE : GL.RENDERBUFFER;
    if (!object) { this.error(GL.INVALID_ENUM); return null; }
    if (parameter === SRGB.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT && this.srgbTextures) {
      const format = object instanceof TextureObject ? this.framebuffer.colorImage?.format : object.format;
      return format !== undefined && (isSrgbTextureFormat(format) || format === SRGB.SRGB8_ALPHA8_EXT)
        ? SRGB.SRGB_EXT : GL.LINEAR;
    }
    if (parameter === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) return object;
    if (object instanceof TextureObject && parameter === GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL) return this.framebuffer.colorLevel;
    if (object instanceof TextureObject && parameter === GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE) {
      return this.framebuffer.colorTarget === GL.TEXTURE_2D ? GL.NONE : this.framebuffer.colorTarget;
    }
    this.error(GL.INVALID_ENUM); return null;
  }
  deleteFramebuffer(framebuffer: FramebufferObject | null): void {
    if (framebuffer === null || !this.valid(framebuffer, FramebufferObject, true) || framebuffer.deleted) return;
    const attachments = [framebuffer.color, framebuffer.depth, framebuffer.stencil, framebuffer.depthStencil];
    framebuffer.deleted = true; this.objects.delete(framebuffer);
    if (this.framebuffer === framebuffer) this.framebuffer = null;
    framebuffer.color = framebuffer.depth = framebuffer.stencil = framebuffer.depthStencil = null;
    for (const object of new Set(attachments)) {
      if (object instanceof RenderbufferObject) this.releaseRenderbuffer(object);
      else if (object) this.releaseTexture(object);
    }
  }
  isFramebuffer(framebuffer: unknown): boolean {
    return !this.lost && framebuffer instanceof FramebufferObject && framebuffer.owner === this.owner && framebuffer.initialized && !framebuffer.deleted;
  }
  createRenderbuffer(): RenderbufferObject | null { return this.lost ? null : this.track(new RenderbufferObject(this.owner)); }
  bindRenderbuffer(target: number, renderbuffer: RenderbufferObject | null): void {
    if (target !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (renderbuffer !== null && !this.valid(renderbuffer, RenderbufferObject)) return;
    if (renderbuffer) renderbuffer.initialized = true;
    this.renderbuffer = renderbuffer;
  }
  renderbufferStorage(target: number, format: number, width: number, height: number): void {
    if (target !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (!this.renderbuffer) return this.error(GL.INVALID_OPERATION);
    if (width < 0 || height < 0 || !Number.isInteger(width) || !Number.isInteger(height) || width > this.host.limits.maxTextureDimension2D ||
        height > this.host.limits.maxTextureDimension2D) return this.error(GL.INVALID_VALUE);
    if ((format === SRGB.SRGB8_ALPHA8_EXT && !this.srgbTextures) || !isColorRenderbufferFormat(format) && format !== GL.DEPTH_COMPONENT16
      && format !== GL.STENCIL_INDEX8 && format !== GL.DEPTH_STENCIL) return this.error(GL.INVALID_ENUM);
    this.retireRenderbufferStorage(this.renderbuffer);
    Object.assign(this.renderbuffer, { width, height, format, generation: this.renderbuffer.generation + 1 });
    if (!this.resources && isColorRenderbufferFormat(format)) {
      this.renderbuffer.colorStorage = { width, height, generation: this.renderbuffer.generation, opaque: format === GL.RGB565,
        texelFormat: format === SRGB.SRGB8_ALPHA8_EXT ? "rgba8unorm-srgb" : undefined };
    }
    this.schedule();
  }
  framebufferRenderbuffer(target: number, attachment: number, renderbufferTarget: number,
    renderbuffer: RenderbufferObject | null): void {
    const point = framebufferAttachmentPoint(attachment);
    if (target !== GL.FRAMEBUFFER || !point || renderbufferTarget !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (!this.framebuffer) return this.error(GL.INVALID_OPERATION);
    if (renderbuffer !== null && !this.valid(renderbuffer, RenderbufferObject)) return;
    if (renderbuffer !== null && !renderbuffer.initialized) return this.error(GL.INVALID_OPERATION);
    const previous = this.framebuffer[point];
    this.framebuffer[point] = renderbuffer;
    if (previous instanceof TextureObject) this.releaseTexture(previous);
    else if (previous && previous !== renderbuffer) this.releaseRenderbuffer(previous);
  }
  getRenderbufferParameter(target: number, parameter: number): unknown {
    if (target !== GL.RENDERBUFFER) { this.error(GL.INVALID_ENUM); return null; }
    if (!this.renderbuffer) { this.error(GL.INVALID_OPERATION); return null; }
    const format = this.renderbuffer.format;
    const colorBits = this.renderbuffer.generation && isColorRenderbufferFormat(format) ? 8 : 0;
    const values: Record<number, number> = { [GL.RENDERBUFFER_WIDTH]: this.renderbuffer.width,
      [GL.RENDERBUFFER_HEIGHT]: this.renderbuffer.height, [GL.RENDERBUFFER_INTERNAL_FORMAT]: this.renderbuffer.format,
      [GL.RENDERBUFFER_RED_SIZE]: colorBits, [GL.RENDERBUFFER_GREEN_SIZE]: colorBits, [GL.RENDERBUFFER_BLUE_SIZE]: colorBits,
      [GL.RENDERBUFFER_ALPHA_SIZE]: format === GL.RGB565 ? 0 : colorBits,
      [GL.RENDERBUFFER_DEPTH_SIZE]: this.renderbuffer.generation && (format === GL.DEPTH_COMPONENT16 || format === GL.DEPTH_STENCIL) ? 24 : 0,
      [GL.RENDERBUFFER_STENCIL_SIZE]: this.renderbuffer.generation && (format === GL.STENCIL_INDEX8 || format === GL.DEPTH_STENCIL) ? 8 : 0 };
    if (parameter in values) return values[parameter]; this.error(GL.INVALID_ENUM); return null;
  }
  deleteRenderbuffer(renderbuffer: RenderbufferObject | null): void {
    if (renderbuffer === null || !this.valid(renderbuffer, RenderbufferObject, true) || renderbuffer.deleted) return;
    renderbuffer.deleted = true; if (this.renderbuffer === renderbuffer) this.renderbuffer = null;
    const framebuffer = this.framebuffer;
    if (framebuffer) {
      for (const point of ["color", "depth", "stencil", "depthStencil"] as const) {
        if (framebuffer[point] === renderbuffer) framebuffer[point] = null;
      }
    }
    this.objects.delete(renderbuffer);
    this.releaseRenderbuffer(renderbuffer);
  }
  private releaseRenderbuffer(renderbuffer: RenderbufferObject): void {
    if (!renderbuffer.deleted) return;
    const retained = [...this.objects].some(object => object instanceof FramebufferObject &&
      (object.depth === renderbuffer || object.color === renderbuffer || object.stencil === renderbuffer || object.depthStencil === renderbuffer));
    if (!retained && !renderbuffer.retired) {
      this.retireRenderbufferStorage(renderbuffer);
      renderbuffer.retired = true;
      this.schedule();
    }
  }
  isRenderbuffer(renderbuffer: unknown): boolean {
    return !this.lost && renderbuffer instanceof RenderbufferObject && renderbuffer.owner === this.owner && renderbuffer.initialized && !renderbuffer.deleted;
  }

  polygonOffset(factor: number, units: number): void {
    this.setPolygonOffset(factor, units, 0);
  }
  supportsPolygonOffsetClamp(): boolean { return true; }
  enablePolygonOffsetClamp(): void { this.polygonOffsetClampEnabled = true; }
  supportsDepthClamp(): boolean { return true; }
  enableDepthClamp(): void { this.depthClampEnabled = true; }
  polygonOffsetClampEXT(factor: number, units: number, clamp: number): void {
    if (this.polygonOffsetClampEnabled) this.setPolygonOffset(factor, units, clamp);
  }
  private setPolygonOffset(factor: number, units: number, clamp: number): void {
    this.state.polygonOffsetFactor = factor;
    this.state.polygonOffsetUnits = units;
    this.state.polygonOffsetClamp = clamp;
  }
  sampleCoverage(value: number, invert: boolean): void {
    this.sampleCoverageValue = clamp(value);
    this.sampleCoverageInvert = invert;
  }
  lineWidth(width: number): void {
    if (!(width > 0)) return this.error(GL.INVALID_VALUE);
    this.requestedLineWidth = width;
  }
  hint(target: number, mode: number): void {
    if (mode !== GL.DONT_CARE && mode !== GL.FASTEST && mode !== GL.NICEST) return this.error(GL.INVALID_ENUM);
    if (target === GL.GENERATE_MIPMAP_HINT) this.mipmapHint = mode;
    else if (target === DERIVATIVE_HINT_OES && (this.shaderExtensions & SHADER_EXTENSIONS.derivatives)) this.derivativeHint = mode;
    else this.error(GL.INVALID_ENUM);
  }
  enable(capability: number): void { this.setCapability(capability, true); }
  disable(capability: number): void { this.setCapability(capability, false); }
  private setCapability(capability: number, enabled: boolean): void {
    if (capability === GL.BLEND) this.state.blend = enabled;
    else if (capability === GL.DEPTH_TEST) this.state.depthTest = enabled;
    else if (capability === 0x864f && this.depthClampEnabled) this.state.depthClamp = enabled;
    else if (capability === GL.CULL_FACE) this.state.cull = enabled;
    else if (capability === GL.SCISSOR_TEST) this.state.scissorTest = enabled;
    else if (capability === GL.DITHER) this.dither = enabled;
    else if (capability === GL.STENCIL_TEST) this.state.stencilTest = enabled;
    else if (capability === GL.POLYGON_OFFSET_FILL) this.state.polygonOffsetFill = enabled;
    else if (capability === GL.SAMPLE_COVERAGE) this.sampleCoverageEnabled = enabled;
    else if (capability === GL.SAMPLE_ALPHA_TO_COVERAGE) this.sampleAlphaToCoverage = enabled;
    else this.error(GL.INVALID_ENUM);
  }
  isEnabled(capability: number): boolean {
    if (capability === GL.BLEND) return this.state.blend;
    if (capability === GL.DEPTH_TEST) return this.state.depthTest;
    if (capability === 0x864f && this.depthClampEnabled) return this.state.depthClamp;
    if (capability === GL.CULL_FACE) return this.state.cull;
    if (capability === GL.SCISSOR_TEST) return this.state.scissorTest;
    if (capability === GL.DITHER) return this.dither;
    if (capability === GL.STENCIL_TEST) return this.state.stencilTest;
    if (capability === GL.POLYGON_OFFSET_FILL) return this.state.polygonOffsetFill;
    if (capability === GL.SAMPLE_COVERAGE) return this.sampleCoverageEnabled;
    if (capability === GL.SAMPLE_ALPHA_TO_COVERAGE) return this.sampleAlphaToCoverage;
    this.error(GL.INVALID_ENUM); return false;
  }
  viewport(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) return this.error(GL.INVALID_VALUE);
    const maximum = this.host.limits.maxTextureDimension2D;
    this.state.viewport = [x, y, Math.min(width, maximum), Math.min(height, maximum)];
  }
  scissor(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) return this.error(GL.INVALID_VALUE);
    this.state.scissor = [x, y, width, height];
  }
  clearColor(r: number, g: number, b: number, a: number): void { this.clearColorValue = [clamp(r), clamp(g), clamp(b), clamp(a)]; }
  clearDepth(depth: number): void { this.clearDepthValue = clamp(depth); }
  clearStencil(stencil: number): void { this.state.stencilClear = stencil; }
  private updateStencilFaces(face: number, values: Partial<StencilFaceState>): void {
    if (face !== GL.FRONT && face !== GL.BACK && face !== GL.FRONT_AND_BACK) return this.error(GL.INVALID_ENUM);
    if (face !== GL.BACK) Object.assign(this.state.stencilFront, values);
    if (face !== GL.FRONT) Object.assign(this.state.stencilBack, values);
  }
  stencilMask(mask: number): void { this.stencilMaskSeparate(GL.FRONT_AND_BACK, mask); }
  stencilMaskSeparate(face: number, mask: number): void { this.updateStencilFaces(face, { writeMask: mask }); }
  stencilFunc(func: number, reference: number, mask: number): void {
    this.stencilFuncSeparate(GL.FRONT_AND_BACK, func, reference, mask);
  }
  stencilFuncSeparate(face: number, func: number, reference: number, mask: number): void {
    if (func < GL.NEVER || func > GL.ALWAYS) return this.error(GL.INVALID_ENUM);
    this.updateStencilFaces(face, { func, reference, valueMask: mask });
  }
  stencilOp(fail: number, depthFail: number, pass: number): void {
    this.stencilOpSeparate(GL.FRONT_AND_BACK, fail, depthFail, pass);
  }
  stencilOpSeparate(face: number, fail: number, depthFail: number, pass: number): void {
    const operations: readonly number[] = [GL.KEEP, GL.ZERO, GL.REPLACE, GL.INCR, GL.INCR_WRAP, GL.DECR, GL.DECR_WRAP, GL.INVERT];
    if (![fail, depthFail, pass].every(operation => operations.includes(operation))) return this.error(GL.INVALID_ENUM);
    this.updateStencilFaces(face, { fail, depthFail, pass });
  }
  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void { this.state.colorMask = [!!r, !!g, !!b, !!a]; }
  depthMask(enabled: boolean): void { this.state.depthMask = !!enabled; }
  depthFunc(func: number): void {
    if (func < GL.NEVER || func > GL.ALWAYS) return this.error(GL.INVALID_ENUM); this.state.depthFunc = func;
  }
  depthRange(near: number, far: number): void {
    if (near > far) return this.error(GL.INVALID_OPERATION); this.state.depthRange = [clamp(near), clamp(far)];
  }
  frontFace(mode: number): void {
    if (mode !== GL.CW && mode !== GL.CCW) return this.error(GL.INVALID_ENUM); this.state.frontFace = mode;
  }
  cullFace(mode: number): void {
    if (mode !== GL.FRONT && mode !== GL.BACK && mode !== GL.FRONT_AND_BACK) return this.error(GL.INVALID_ENUM); this.state.cullFace = mode;
  }
  blendColor(r: number, g: number, b: number, a: number): void { this.state.blendColor = [clamp(r), clamp(g), clamp(b), clamp(a)]; }
  blendEquation(mode: number): void { this.blendEquationSeparate(mode, mode); }
  blendEquationSeparate(rgb: number, alpha: number): void {
    const valid = [GL.FUNC_ADD, GL.FUNC_SUBTRACT, GL.FUNC_REVERSE_SUBTRACT] as number[];
    if (this.blendMinmax) valid.push(BLEND_MINMAX.MIN_EXT, BLEND_MINMAX.MAX_EXT);
    if (!valid.includes(rgb) || !valid.includes(alpha)) return this.error(GL.INVALID_ENUM);
    this.state.blendEquationRGB = rgb; this.state.blendEquationAlpha = alpha;
  }
  blendFunc(source: number, destination: number): void { this.blendFuncSeparate(source, destination, source, destination); }
  blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void {
    const factors = [GL.ZERO, GL.ONE, GL.SRC_COLOR, GL.ONE_MINUS_SRC_COLOR, GL.DST_COLOR,
      GL.ONE_MINUS_DST_COLOR, GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.DST_ALPHA,
      GL.ONE_MINUS_DST_ALPHA, GL.CONSTANT_COLOR, GL.ONE_MINUS_CONSTANT_COLOR,
      GL.CONSTANT_ALPHA, GL.ONE_MINUS_CONSTANT_ALPHA, GL.SRC_ALPHA_SATURATE] as number[];
    if (![srcRGB, dstRGB, srcAlpha, dstAlpha].every(value => factors.includes(value))) return this.error(GL.INVALID_ENUM);
    if (dstRGB === GL.SRC_ALPHA_SATURATE || dstAlpha === GL.SRC_ALPHA_SATURATE) return this.error(GL.INVALID_ENUM);
    const colorFactors = [GL.CONSTANT_COLOR, GL.ONE_MINUS_CONSTANT_COLOR] as number[];
    const alphaFactors = [GL.CONSTANT_ALPHA, GL.ONE_MINUS_CONSTANT_ALPHA] as number[];
    if ((colorFactors.includes(srcRGB) && alphaFactors.includes(dstRGB)) ||
        (alphaFactors.includes(srcRGB) && colorFactors.includes(dstRGB))) return this.error(GL.INVALID_OPERATION);
    Object.assign(this.state, { blendSrcRGB: srcRGB, blendDstRGB: dstRGB, blendSrcAlpha: srcAlpha, blendDstAlpha: dstAlpha });
  }
  clear(mask: number): void {
    if (mask & ~(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT)) return this.error(GL.INVALID_VALUE);
    const target = this.target(); if (!target || this.lost || !target.width || !target.height) return;
    this.host.clear(target, snapshotRaster(this.state), mask, this.clearColorValue, this.clearDepthValue);
    if (mask & GL.COLOR_BUFFER_BIT) this.wroteColorTarget();
    this.schedule();
  }

  getParameter(parameter: number): unknown {
    if (this.lost) return null;
    if (parameter === GL.CURRENT_PROGRAM) return this.program;
    if (parameter === GL.COMPRESSED_TEXTURE_FORMATS) return new Uint32Array(0);
    if (parameter === GL.ALIASED_POINT_SIZE_RANGE) return new Float32Array([1, 64]);
    if (parameter === GL.ALIASED_LINE_WIDTH_RANGE) return new Float32Array([1, 1]);
    if (parameter === GL.IMPLEMENTATION_COLOR_READ_FORMAT || parameter === GL.IMPLEMENTATION_COLOR_READ_TYPE) {
      if (this.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
        this.error(GL.INVALID_OPERATION);
        return null;
      }
      return parameter === GL.IMPLEMENTATION_COLOR_READ_FORMAT ? GL.RGBA : GL.UNSIGNED_BYTE;
    }
    const colorRenderbuffer = this.framebuffer?.colorRenderbuffer;
    const colorImage = this.framebuffer?.colorImage;
    const storage = colorRenderbuffer && isColorRenderbufferFormat(colorRenderbuffer.format) ? colorRenderbuffer
      : colorImage?.format === GL.RGBA || colorImage?.format === GL.RGB || colorImage?.format === SRGB.SRGB_ALPHA_EXT ? colorImage.storage : null;
    const colorBits = this.framebuffer ? (storage?.width && storage.height ? 8 : 0) : 8;
    const alphaBits = this.framebuffer ? ((colorRenderbuffer ? colorRenderbuffer.format !== GL.RGB565
      : colorImage?.format === GL.RGBA || colorImage?.format === SRGB.SRGB_ALPHA_EXT) ? colorBits : 0)
      : (this.contextAttributes.alpha ? 8 : 0);
    const depth = this.framebuffer?.depth ?? this.framebuffer?.depthStencil;
    const stencil = this.framebuffer?.stencil ?? this.framebuffer?.depthStencil;
    const depthBits = this.framebuffer ? (depth?.width && depth.height &&
      (depth.format === GL.DEPTH_COMPONENT16 || depth.format === GL.DEPTH_STENCIL) ? 24 : 0)
      : (this.contextAttributes.depth ? 24 : 0);
    const stencilBits = this.framebuffer ? (stencil?.width && stencil.height && isStencilRenderbufferFormat(stencil.format) ? 8 : 0)
      : (this.contextAttributes.stencil ? 8 : 0);
    if (parameter === VERTEX_ARRAY_BINDING_OES && this.arraysEnabled)
      return this.currentArray === this.defaultArray ? null : this.currentArray;
    const { stencilFront: front, stencilBack: back } = this.state;
    const values: Record<number, unknown> = {
      [GL.ARRAY_BUFFER_BINDING]: this.arrayBuffer, [GL.ELEMENT_ARRAY_BUFFER_BINDING]: this.elementBuffer,
      [GL.FRAMEBUFFER_BINDING]: this.framebuffer,
      [GL.RENDERBUFFER_BINDING]: this.renderbuffer, [GL.ACTIVE_TEXTURE]: GL.TEXTURE0 + this.activeUnit,
      [GL.TEXTURE_BINDING_2D]: this.textureUnits[this.activeUnit]!.texture2D,
      [GL.TEXTURE_BINDING_CUBE_MAP]: this.textureUnits[this.activeUnit]!.cubeMap,
      [GL.VIEWPORT]: new Int32Array(this.state.viewport), [GL.SCISSOR_BOX]: new Int32Array(this.state.scissor),
      [GL.LINE_WIDTH]: this.requestedLineWidth, [GL.GENERATE_MIPMAP_HINT]: this.mipmapHint,
      ...((this.shaderExtensions & SHADER_EXTENSIONS.derivatives) ? { [DERIVATIVE_HINT_OES]: this.derivativeHint } : {}),
      [GL.COLOR_CLEAR_VALUE]: new Float32Array(this.clearColorValue), [GL.DEPTH_CLEAR_VALUE]: this.clearDepthValue,
      [GL.COLOR_WRITEMASK]: [...this.state.colorMask], [GL.DEPTH_WRITEMASK]: this.state.depthMask,
      [GL.DEPTH_FUNC]: this.state.depthFunc, [GL.DEPTH_RANGE]: new Float32Array(this.state.depthRange),
      [GL.BLEND_COLOR]: new Float32Array(this.state.blendColor), [GL.BLEND_EQUATION_RGB]: this.state.blendEquationRGB,
      [GL.BLEND_EQUATION_ALPHA]: this.state.blendEquationAlpha, [GL.BLEND_SRC_RGB]: this.state.blendSrcRGB,
      [GL.BLEND_DST_RGB]: this.state.blendDstRGB, [GL.BLEND_SRC_ALPHA]: this.state.blendSrcAlpha,
      [GL.BLEND_DST_ALPHA]: this.state.blendDstAlpha, [GL.CULL_FACE_MODE]: this.state.cullFace,
      [GL.FRONT_FACE]: this.state.frontFace, [GL.UNPACK_ALIGNMENT]: this.unpackAlignment,
      [GL.STENCIL_CLEAR_VALUE]: this.state.stencilClear,
      [GL.STENCIL_FUNC]: front.func, [GL.STENCIL_REF]: front.reference, [GL.STENCIL_VALUE_MASK]: front.valueMask,
      [GL.STENCIL_WRITEMASK]: front.writeMask, [GL.STENCIL_FAIL]: front.fail,
      [GL.STENCIL_PASS_DEPTH_FAIL]: front.depthFail, [GL.STENCIL_PASS_DEPTH_PASS]: front.pass,
      [GL.STENCIL_BACK_FUNC]: back.func, [GL.STENCIL_BACK_REF]: back.reference, [GL.STENCIL_BACK_VALUE_MASK]: back.valueMask,
      [GL.STENCIL_BACK_WRITEMASK]: back.writeMask, [GL.STENCIL_BACK_FAIL]: back.fail,
      [GL.STENCIL_BACK_PASS_DEPTH_FAIL]: back.depthFail, [GL.STENCIL_BACK_PASS_DEPTH_PASS]: back.pass,
      [GL.PACK_ALIGNMENT]: this.packAlignment, [GL.UNPACK_FLIP_Y_WEBGL]: this.unpackFlipY,
      [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL]: this.unpackPremultiply,
      [GL.UNPACK_COLORSPACE_CONVERSION_WEBGL]: this.unpackColorSpace,
      [GL.MAX_VERTEX_ATTRIBS]: this.profile.vertexAttributes, [GL.MAX_TEXTURE_SIZE]: this.host.limits.maxTextureDimension2D,
      [GL.MAX_CUBE_MAP_TEXTURE_SIZE]: this.host.limits.maxTextureDimension2D,
      [GL.MAX_RENDERBUFFER_SIZE]: this.host.limits.maxTextureDimension2D,
      [GL.MAX_TEXTURE_IMAGE_UNITS]: this.profile.fragmentTextureUnits, [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: this.profile.combinedTextureUnits,
      [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: this.profile.vertexTextureUnits, [GL.MAX_VERTEX_UNIFORM_VECTORS]: this.profile.vertexUniformVectors,
      [GL.MAX_FRAGMENT_UNIFORM_VECTORS]: this.profile.fragmentUniformVectors, [GL.MAX_VARYING_VECTORS]: this.profile.varyingVectors,
      [GL.MAX_VIEWPORT_DIMS]: new Int32Array([this.host.limits.maxTextureDimension2D, this.host.limits.maxTextureDimension2D]),
      [GL.VERSION]: "WebGL 1.0 (Refral prototype)", [GL.SHADING_LANGUAGE_VERSION]: "WebGL GLSL ES 1.0 (ANGLE)",
      [GL.VENDOR]: "Refral", [GL.RENDERER]: "WebGPU",
      [GL.RED_BITS]: colorBits, [GL.GREEN_BITS]: colorBits, [GL.BLUE_BITS]: colorBits,
      [GL.ALPHA_BITS]: alphaBits, [GL.DEPTH_BITS]: depthBits, [GL.STENCIL_BITS]: stencilBits,
      [GL.SAMPLES]: 0, [GL.SAMPLE_BUFFERS]: 0, [GL.SUBPIXEL_BITS]: 4,
      [GL.POLYGON_OFFSET_FACTOR]: this.state.polygonOffsetFactor, [GL.POLYGON_OFFSET_UNITS]: this.state.polygonOffsetUnits,
      [GL.SAMPLE_COVERAGE_VALUE]: this.sampleCoverageValue, [GL.SAMPLE_COVERAGE_INVERT]: this.sampleCoverageInvert,
    };
    if (parameter === 0x8e1b && this.polygonOffsetClampEnabled) return this.state.polygonOffsetClamp;
    if (parameter === 0x864f && this.depthClampEnabled) return this.state.depthClamp;
    if (parameter in values) return values[parameter];
    if ([GL.BLEND, GL.CULL_FACE, GL.DEPTH_TEST, GL.SCISSOR_TEST, GL.DITHER,
      GL.STENCIL_TEST, GL.POLYGON_OFFSET_FILL, GL.SAMPLE_COVERAGE, GL.SAMPLE_ALPHA_TO_COVERAGE].includes(parameter as 0x0be2)) return this.isEnabled(parameter);
    this.error(GL.INVALID_ENUM); return null;
  }
  getShaderPrecisionFormat(shaderType: number, precision: number): { rangeMin: number; rangeMax: number; precision: number } | null {
    if (this.lost) return null;
    if (shaderType !== GL.VERTEX_SHADER && shaderType !== GL.FRAGMENT_SHADER) { this.error(GL.INVALID_ENUM); return null; }
    if ([GL.LOW_FLOAT, GL.MEDIUM_FLOAT, GL.HIGH_FLOAT].includes(precision as 0x8df0)) return { rangeMin: 127, rangeMax: 127, precision: 23 };
    if ([GL.LOW_INT, GL.MEDIUM_INT, GL.HIGH_INT].includes(precision as 0x8df3)) return { rangeMin: 31, rangeMax: 30, precision: 0 };
    this.error(GL.INVALID_ENUM); return null;
  }

  captureTarget(): TargetSnapshot {
    const target = this.target();
    if (!target) throw new Error("Cannot capture an incomplete framebuffer");
    return target;
  }

  prepareReadPixels(request: ReadPixelsRequest): ReadPixelsPlan | null {
    if (this.lost) return null;
    if (request.viewType === null) {
      this.error(GL.INVALID_VALUE);
      return null;
    }
    if (!([GL.ALPHA, GL.RGB, GL.RGBA] as number[]).includes(request.format) ||
        !([GL.UNSIGNED_BYTE, GL.UNSIGNED_SHORT_5_6_5, GL.UNSIGNED_SHORT_4_4_4_4,
          GL.UNSIGNED_SHORT_5_5_5_1] as number[]).includes(request.type)) {
      this.error(GL.INVALID_ENUM);
      return null;
    }
    if (request.width < 0 || request.height < 0) {
      this.error(GL.INVALID_VALUE);
      return null;
    }
    if (request.format !== GL.RGBA || request.type !== GL.UNSIGNED_BYTE ||
        (request.viewType !== "Uint8Array" && request.viewType !== "Uint8ClampedArray")) {
      this.error(GL.INVALID_OPERATION);
      return null;
    }
    const rowBytes = request.width * 4;
    const destinationStride = Math.ceil(rowBytes / this.packAlignment) * this.packAlignment;
    const requiredBytes = request.width === 0 || request.height === 0
      ? 0 : (request.height - 1) * destinationStride + rowBytes;
    if (!Number.isSafeInteger(requiredBytes) || !Number.isSafeInteger(request.byteLength) ||
        request.byteLength < requiredBytes) {
      this.error(GL.INVALID_OPERATION);
      return null;
    }
    const target = this.target();
    if (!target) return null;
    const sourceX = Math.min(target.width, Math.max(0, request.x));
    const sourceY = Math.min(target.height, Math.max(0, request.y));
    const copyWidth = Math.max(0, Math.min(target.width, request.x + request.width) - sourceX);
    const copyHeight = Math.max(0, Math.min(target.height, request.y + request.height) - sourceY);
    const empty = copyWidth === 0 || copyHeight === 0;
    return {
      target, sourceX: empty ? 0 : sourceX, sourceY: empty ? 0 : sourceY,
      copyWidth: empty ? 0 : copyWidth,
      copyHeight: empty ? 0 : copyHeight,
      destinationOffset: empty ? 0 : (sourceY - request.y) * destinationStride + (sourceX - request.x) * 4,
      destinationStride, requiredBytes,
    };
  }

  dispose(): void {
    this.markLost();
    for (const object of this.objects) {
      object.deleted = true;
      if (object instanceof ShaderObject) {
        if (object.result) this.compiler.releaseShader?.(object.result);
        object.result = null;
        object.source = "";
      } else if (object instanceof ProgramObject) {
        if (object.executable) this.compiler.releaseProgram?.(object.executable);
        object.executable = null;
        object.shaders = [];
        object.values.clear();
        object.samplerUnits.clear();
        object.vertexUniforms = new Uint8Array(0);
        object.fragmentUniforms = new Uint8Array(0);
      } else if (object instanceof BufferObject) object.data = new Uint8Array(0);
      else if (object instanceof TextureObject) {
        object.storage = null;
        object.imageLevels.clear();
      }
      else if (object instanceof FramebufferObject) {
        object.color = null;
        object.depth = object.stencil = object.depthStencil = null;
      }
    }
    this.objects.clear();
    this.program = null;
    this.arrayBuffer = null;
    this.elementBuffer = null;
    this.framebuffer = null;
    this.renderbuffer = null;
    for (const unit of this.textureUnits) { unit.texture2D = null; unit.cubeMap = null; }
    for (const attribute of this.attributes) attribute.buffer = null;
  }

  markLost(): boolean {
    if (this.lost) return false;
    this.lost = true;
    this.uniformSnapshots.clear();
    this.errors.clear();
    this.errors.set(GL.CONTEXT_LOST_WEBGL);
    return true;
  }
}
