import {
  GL, LogicalObject, BufferObject, TextureObject, RenderbufferObject, FramebufferObject,
  ErrorState, createRasterState, snapshotRaster, componentCount, isTextureComplete,
} from "./resources.js";
import type { AttributeSnapshot, RasterState, TargetSnapshot, VertexAttribute, TextureStorage, TextureParameters } from "./resources.js";
import type { Compiler, CompiledShader, LinkedProgram, ProgramUniform } from "@refral/compiler";

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
export interface CoreDrawOperation {
  program: LinkedProgram;
  target: TargetSnapshot;
  state: RasterState;
  attributes: AttributeSnapshot[];
  vertexCount: number;
  count: number;
  first: number;
  indices: { data: Uint8Array; type: number; offset: number } | null;
  vertexUniforms: Uint8Array;
  fragmentUniforms: Uint8Array;
  textures: { storage: TextureStorage | null; parameters: TextureParameters }[];
}
export interface SemanticHost {
  readonly limits: { readonly maxTextureDimension2D: number; readonly maxBufferSize?: number };
  draw(operation: CoreDrawOperation): void;
  clear(target: TargetSnapshot, state: RasterState, mask: number, color: readonly number[], depth: number): void;
  flush(): void;
  replaceStorage(previous: TextureStorage | null, next: TextureStorage): void;
  retireStorage(storage: TextureStorage): void;
  retireDepth(id: number, generation: number): void;
}

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
  attributeLocations: Record<string, number> = {};
  executable: LinkedProgram | null = null;
  linkStatus = false;
  validateStatus = false;
  log = "";
  generation = 0;
  vertexUniforms = new Uint8Array(16);
  fragmentUniforms = new Uint8Array(16);
  values = new Map<string, Float32Array | Int32Array>();
  samplerUnits = new Map<string, number>();
}

class UniformLocation {
  constructor(readonly owner: object, readonly program: ProgramObject,
    readonly generation: number, readonly name: string, readonly index: number) {}
}

function clamp(value: number): number { return Math.max(0, Math.min(1, Number(value) || 0)); }
function baseName(name: string): string { return name.replace(/\[0\]$/, ""); }
function bytesOf(value: ArrayBufferView | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

export class SemanticContext {
  private readonly owner = {};
  private readonly errors = new ErrorState();
  private readonly objects = new Set<LogicalObject>();
  private readonly state: RasterState;
  private arrayBuffer: BufferObject | null = null;
  private elementBuffer: BufferObject | null = null;
  private program: ProgramObject | null = null;
  private framebuffer: FramebufferObject | null = null;
  private renderbuffer: RenderbufferObject | null = null;
  private activeUnit = 0;
  private textureUnits: (TextureObject | null)[];
  private readonly attributes: VertexAttribute[];
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
  private maxBufferBytes: number;

  constructor(readonly canvas: DrawingSurface, private readonly host: SemanticHost,
    private readonly compiler: Compiler, private readonly contextAttributes: ContextAttributes,
    private readonly profile: RuntimeProfile) {
    this.maxBufferBytes = host.limits.maxBufferSize ?? Number.MAX_SAFE_INTEGER;
    this.state = createRasterState(canvas.width, canvas.height);
    this.textureUnits = Array.from({ length: profile.combinedTextureUnits }, () => null);
    this.attributes = Array.from({ length: profile.vertexAttributes }, () => ({ enabled: false, buffer: null, size: 4,
      type: GL.FLOAT, normalized: false, stride: 0, offset: 0, constant: [0, 0, 0, 1] }));

  }

  get drawingBufferWidth(): number { return this.lost ? 0 : this.canvas.width; }
  get drawingBufferHeight(): number { return this.lost ? 0 : this.canvas.height; }
  get drawingBufferColorSpace(): string { return "srgb"; }

  /** Central public-call dispatch keeps context-loss behavior consistent across the facade. */
  invoke(method: string, arguments_: unknown[]): unknown {
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
    if (!(object instanceof type) || object.owner !== this.owner ||
        (!allowDeleted && object.deleted)) {
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
    if (target !== GL.TEXTURE_2D) { this.error(GL.INVALID_ENUM); return undefined; }
    return this.textureUnits[this.activeUnit];
  }
  private target(): TargetSnapshot | null {
    if (!this.framebuffer) return {
      color: null, depth: null, depthGeneration: 0, width: this.canvas.width,
      height: this.canvas.height, isDefault: true,
    };
    if (this.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
      this.error(GL.INVALID_FRAMEBUFFER_OPERATION); return null;
    }
    const storage = this.framebuffer.color!.storage!;
    return { color: storage, depth: this.framebuffer.depth,
      depthGeneration: this.framebuffer.depth?.generation ?? 0,
      width: storage.width, height: storage.height, isDefault: false };
  }

  getError(): number { return this.errors.take(); }
  isContextLost(): boolean { return this.lost; }
  getContextAttributes(): ContextAttributes | null {
    return this.lost ? null : { ...this.contextAttributes };
  }
  getSupportedExtensions(): string[] | null { return this.lost ? null : []; }
  getExtension(_name: string): null { return null; }
  flush(): void { if (!this.lost) this.host.flush(); }
  finish(): never { return unsupported("finish"); }

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
    buffer.data = new Uint8Array(0);
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
    shader.result = this.compiler.compile(shader.source,
      shader.type === GL.VERTEX_SHADER ? "vertex" : "fragment", 1);
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
  bindAttribLocation(program: ProgramObject, index: number, name: string): void {
    if (!this.valid(program, ProgramObject)) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.attributes.length) return this.error(GL.INVALID_VALUE);
    if (name.startsWith("gl_")) return this.error(GL.INVALID_OPERATION);
    program.attributeLocations[String(name)] = index;
  }
  linkProgram(program: ProgramObject): void {
    if (!this.valid(program, ProgramObject)) return;
    program.generation++;
    program.validateStatus = false;
    const vertex = program.shaders.find(shader => shader.type === GL.VERTEX_SHADER)?.result;
    const fragment = program.shaders.find(shader => shader.type === GL.FRAGMENT_SHADER)?.result;
    if (!vertex || !fragment) {
      program.linkStatus = false; program.log = "Compiled vertex and fragment shaders are required."; return;
    }
    const executable = this.compiler.link(vertex, fragment, program.attributeLocations);
    program.linkStatus = executable.success; program.log = executable.log;
    if (!executable.success) return;
    program.executable = executable;
    program.vertexUniforms = new Uint8Array(Math.max(16, executable.vertexUniformBufferSize));
    program.fragmentUniforms = new Uint8Array(Math.max(16, executable.fragmentUniformBufferSize));
    program.values.clear(); program.samplerUnits.clear();
    for (const uniform of executable.uniforms) {
      const integer = [GL.INT, GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4,
        GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x1404);
      const size = componentCount(uniform.type) * uniform.size;
      program.values.set(baseName(uniform.name), integer ? new Int32Array(size) : new Float32Array(size));
    }
    for (const sampler of executable.samplers) program.samplerUnits.set(baseName(sampler.name), 0);
  }
  useProgram(program: ProgramObject | null): void {
    if (program !== null && !this.valid(program, ProgramObject)) return;
    if (program !== null && !program.linkStatus) return this.error(GL.INVALID_OPERATION);
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
    // The supported sampler profile has no cross-type or array binding conflicts.
    program.validateStatus = program.linkStatus;
  }
  getAttribLocation(program: ProgramObject, name: string): number {
    if (!this.valid(program, ProgramObject)) return -1;
    if (!program.linkStatus) { this.error(GL.INVALID_OPERATION); return -1; }
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
    return { name: uniform.size > 1 ? `${baseName(uniform.name)}[0]` : uniform.name,
      size: uniform.size, type: uniform.type };
  }
  getUniformLocation(program: ProgramObject, name: string): UniformLocation | null {
    if (!this.valid(program, ProgramObject)) return null;
    if (!program.linkStatus) { this.error(GL.INVALID_OPERATION); return null; }
    const match = /^(.*?)(?:\[(\d+)\])?$/.exec(String(name))!;
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
    if (program.samplerUnits.has(location.name)) {
      if (!integer || components !== 1 || values.length !== 1) return this.error(GL.INVALID_OPERATION);
      const unit = Number(values[0]);
      if (!Number.isInteger(unit) || unit < 0 || unit >= this.textureUnits.length) return this.error(GL.INVALID_VALUE);
      program.samplerUnits.set(location.name, unit); return;
    }
    const uniform = program.executable!.uniforms.find(value => baseName(value.name) === location.name)!;
    const isInteger = [GL.INT, GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4,
      GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x1404);
    const isBoolean = [GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x8b56);
    const expectedMatrix = uniform.type === GL.FLOAT_MAT2 ? 2 : uniform.type === GL.FLOAT_MAT3 ? 3 :
      uniform.type === GL.FLOAT_MAT4 ? 4 : 0;
    if ((!isBoolean && integer !== isInteger) || expectedMatrix !== matrix || componentCount(uniform.type) !== components ||
        values.length / components > uniform.size - location.index) {
      return this.error(GL.INVALID_OPERATION);
    }
    const stored = program.values.get(location.name)!;
    for (let i = 0; i < values.length; i++) {
      const value = isBoolean ? (values[i] ? 1 : 0) : Number(values[i]);
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
    if (program.samplerUnits.has(location.name)) return program.samplerUnits.get(location.name);
    const uniform = program.executable!.uniforms.find(value => baseName(value.name) === location.name)!;
    const values = program.values.get(location.name)!;
    const components = componentCount(uniform.type);
    const boolean = [GL.BOOL, GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4].includes(uniform.type as 0x8b56);
    if (components === 1) return boolean ? !!values[location.index] : values[location.index];
    const result = values.slice(location.index * components, (location.index + 1) * components);
    return boolean ? [...result].map(value => !!value) : result;
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
    if (![GL.FLOAT, GL.BYTE, GL.UNSIGNED_BYTE, GL.SHORT, GL.UNSIGNED_SHORT].includes(type as 0x1406)) return this.error(GL.INVALID_ENUM);
    if (type !== GL.FLOAT) return unsupported("non-FLOAT vertexAttribPointer");
    if (stride % 4 || offset % 4) return this.error(GL.INVALID_OPERATION);
    if (!this.arrayBuffer) return this.error(GL.INVALID_OPERATION);
    Object.assign(attribute, { buffer: this.arrayBuffer, size, type, normalized: !!normalized, stride, offset });
  }
  private constantAttribute(index: number, values: number[]): void {
    const attribute = this.attributes[index];
    if (!attribute) return this.error(GL.INVALID_VALUE);
    attribute.constant = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
  }
  vertexAttrib1f(index: number, x: number): void { this.constantAttribute(index, [x]); }
  vertexAttrib2f(index: number, x: number, y: number): void { this.constantAttribute(index, [x, y]); }
  vertexAttrib3f(index: number, x: number, y: number, z: number): void { this.constantAttribute(index, [x, y, z]); }
  vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void { this.constantAttribute(index, [x, y, z, w]); }
  vertexAttrib1fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, [values[0]!]); }
  vertexAttrib2fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, [values[0]!, values[1]!]); }
  vertexAttrib3fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, [values[0]!, values[1]!, values[2]!]); }
  vertexAttrib4fv(index: number, values: ArrayLike<number>): void { this.constantAttribute(index, [values[0]!, values[1]!, values[2]!, values[3]!]); }
  getVertexAttrib(index: number, parameter: number): unknown {
    if (this.lost) return null;
    const attribute = this.attributes[index];
    if (!attribute) { this.error(GL.INVALID_VALUE); return null; }
    const values: Record<number, unknown> = {
      [GL.VERTEX_ATTRIB_ARRAY_ENABLED]: attribute.enabled, [GL.VERTEX_ATTRIB_ARRAY_SIZE]: attribute.size,
      [GL.VERTEX_ATTRIB_ARRAY_TYPE]: attribute.type, [GL.VERTEX_ATTRIB_ARRAY_NORMALIZED]: attribute.normalized,
      [GL.VERTEX_ATTRIB_ARRAY_STRIDE]: attribute.stride,
      [GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING]: attribute.buffer,
      [GL.CURRENT_VERTEX_ATTRIB]: new Float32Array(attribute.constant),
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
    if (type !== GL.UNSIGNED_BYTE && type !== GL.UNSIGNED_SHORT) return this.error(GL.INVALID_ENUM);
    if (!this.elementBuffer) return this.error(GL.INVALID_OPERATION);
    if (offset < 0 || !Number.isInteger(offset) || (type === GL.UNSIGNED_SHORT && offset % 2)) return this.error(GL.INVALID_OPERATION);
    this.draw(mode, 0, count, { data: this.elementBuffer.data, type, offset });
  }
  private draw(mode: number, first: number, count: number,
    indices: { data: Uint8Array; type: number; offset: number } | null): void {
    if (this.lost) return;
    if (mode < GL.POINTS || mode > GL.TRIANGLE_FAN) return this.error(GL.INVALID_ENUM);
    if (mode !== GL.TRIANGLES) return unsupported("non-triangle draw");
    if (first < 0 || count < 0 || !Number.isInteger(first) || !Number.isInteger(count)) return this.error(GL.INVALID_VALUE);
    if (!this.program?.linkStatus || !this.program.executable) return this.error(GL.INVALID_OPERATION);
    const target = this.target(); if (!target) return;
    let vertices = first + count;
    if (indices) {
      const bytes = indices.type === GL.UNSIGNED_BYTE ? 1 : 2;
      if (indices.offset + count * bytes > indices.data.byteLength) return this.error(GL.INVALID_OPERATION);
      const view = new DataView(indices.data.buffer, indices.data.byteOffset, indices.data.byteLength);
      let maximum = 0;
      for (let i = 0; i < count; i++) {
        const value = bytes === 1 ? view.getUint8(indices.offset + i) : view.getUint16(indices.offset + i * 2, true);
        maximum = Math.max(maximum, value);
      }
      vertices = maximum + 1;
    }
    const attributes: AttributeSnapshot[] = [];
    for (const active of this.program.executable.attributes) {
      if (active.type === GL.FLOAT_MAT2 || active.type === GL.FLOAT_MAT3 || active.type === GL.FLOAT_MAT4) {
        return unsupported("matrix vertex attribute drawing");
      }
      const attribute = this.attributes[active.location]!;
      if (attribute.enabled) {
        if (!attribute.buffer) return this.error(GL.INVALID_OPERATION);
        const stride = attribute.stride || attribute.size * 4;
        const required = count ? attribute.offset + (vertices - 1) * stride + attribute.size * 4 : 0;
        if (required > attribute.buffer.data.byteLength) return this.error(GL.INVALID_OPERATION);
      }
      attributes.push({ location: active.location, shaderType: active.type,
        size: attribute.size, stride: attribute.stride, offset: attribute.offset,
        data: attribute.enabled ? attribute.buffer!.data : null, constant: [...attribute.constant] });
    }
    const textures = this.program.executable.samplers.map(sampler => {
      const unit = this.program!.samplerUnits.get(baseName(sampler.name)) ?? 0;
      const texture = this.textureUnits[unit];
      if (texture && this.framebuffer?.color === texture) return null;
      return { storage: texture && isTextureComplete(texture) ? texture.storage : null,
        parameters: texture ? { ...texture.parameters } :
          { minFilter: GL.NEAREST, magFilter: GL.NEAREST, wrapS: GL.CLAMP_TO_EDGE, wrapT: GL.CLAMP_TO_EDGE } };
    });
    if (textures.some(texture => texture === null)) return this.error(GL.INVALID_OPERATION);
    if (!count || !target.width || !target.height ||
        (this.state.cull && this.state.cullFace === GL.FRONT_AND_BACK)) return;
    this.host.draw({ program: this.program.executable, target, state: snapshotRaster(this.state),
      attributes, vertexCount: vertices, first, count, indices,
      vertexUniforms: this.program.vertexUniforms.slice(), fragmentUniforms: this.program.fragmentUniforms.slice(),
      textures: textures as NonNullable<typeof textures[number]>[] });
    this.schedule();
  }

  createTexture(): TextureObject | null { return this.lost ? null : this.track(new TextureObject(this.owner)); }
  activeTexture(texture: number): void {
    const unit = texture - GL.TEXTURE0;
    if (!Number.isInteger(unit) || unit < 0 || unit >= this.textureUnits.length) return this.error(GL.INVALID_ENUM);
    this.activeUnit = unit;
  }
  bindTexture(target: number, texture: TextureObject | null): void {
    if (target !== GL.TEXTURE_2D) return this.error(GL.INVALID_ENUM);
    if (texture !== null && !this.valid(texture, TextureObject)) return;
    this.textureUnits[this.activeUnit] = texture;
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
  private pixelData(width: number, height: number, format: number, source: unknown): Uint8Array | null {
    const components = format === GL.RGBA ? 4 : format === GL.RGB ? 3 : format === GL.LUMINANCE_ALPHA ? 2 : 1;
    let bytes: Uint8Array;
    let stride: number;
    if (source === null) {
      const pixels = new Uint8Array(width * height * 4);
      if (format === GL.RGB || format === GL.LUMINANCE) {
        for (let pixel = 0; pixel < width * height; pixel++) pixels[pixel * 4 + 3] = 255;
      }
      return pixels;
    }
    if (ArrayBuffer.isView(source)) {
      const tag = Object.prototype.toString.call(source);
      if (tag !== "[object Uint8Array]" && tag !== "[object Uint8ClampedArray]") {
        this.error(GL.INVALID_OPERATION); return null;
      }
      bytes = bytesOf(source);
      stride = Math.ceil(width * components / this.unpackAlignment) * this.unpackAlignment;
      if (bytes.byteLength < Math.max(0, (height - 1) * stride + width * components)) {
        this.error(GL.INVALID_OPERATION); return null;
      }
    } else {
      this.error(GL.INVALID_VALUE); return null;
    }
    const pixels = new Uint8Array(width * height * 4);
    const sourceComponents = ArrayBuffer.isView(source) ? components : 4;
    for (let y = 0; y < height; y++) {
      const sourceY = this.unpackFlipY ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const offset = sourceY * stride + x * sourceComponents;
        const destination = (y * width + x) * 4;
        let r = bytes[offset] ?? 0; let g = bytes[offset + 1] ?? 0;
        let b = bytes[offset + 2] ?? 0; let a = bytes[offset + 3] ?? 255;
        if (sourceComponents !== 4 || ArrayBuffer.isView(source)) {
          if (format === GL.RGB) a = 255;
          if (format === GL.ALPHA) { a = r; r = g = b = 0; }
          if (format === GL.LUMINANCE || format === GL.LUMINANCE_ALPHA) {
            a = format === GL.LUMINANCE_ALPHA ? g : 255; g = b = r;
          }
        }
        const factor = this.unpackPremultiply ? a / 255 : 1;
        pixels[destination] = Math.round(r * factor); pixels[destination + 1] = Math.round(g * factor);
        pixels[destination + 2] = Math.round(b * factor); pixels[destination + 3] = a;
      }
    }
    return pixels;
  }
  texImage2D(...arguments_: unknown[]): void {
    const [target, level, internalFormat] = arguments_ as number[];
    const texture = this.boundTexture(target!); if (texture === undefined) return;
    if (!texture) return this.error(GL.INVALID_OPERATION);
    const dimensions = arguments_.length === 9;
    const source = arguments_[dimensions ? 8 : 5];
    const image = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number } | null;
    const width = Number(dimensions ? arguments_[3] : image?.naturalWidth ?? image?.videoWidth ?? image?.width);
    const height = Number(dimensions ? arguments_[4] : image?.naturalHeight ?? image?.videoHeight ?? image?.height);
    const border = dimensions ? Number(arguments_[5]) : 0;
    const format = Number(arguments_[dimensions ? 6 : 3]);
    const type = Number(arguments_[dimensions ? 7 : 4]);
    if (level! < 0 || width < 0 || height < 0 || !Number.isInteger(width) || !Number.isInteger(height) ||
        width > this.host.limits.maxTextureDimension2D || height > this.host.limits.maxTextureDimension2D || border !== 0) return this.error(GL.INVALID_VALUE);
    if (level !== 0) return unsupported("texture mip levels");
    if (![GL.RGBA, GL.RGB, GL.ALPHA, GL.LUMINANCE, GL.LUMINANCE_ALPHA].includes(format as 0x1908) ||
        type !== GL.UNSIGNED_BYTE) return this.error(GL.INVALID_ENUM);
    if (internalFormat !== format) return this.error(GL.INVALID_OPERATION);
    const data = this.pixelData(width, height, format, source); if (!data) return;
    const previous = texture.storage;
    texture.generation++; texture.version++; texture.format = format;
    texture.storage = { width, height, generation: texture.generation, data };
    this.host.replaceStorage(previous, texture.storage);
    this.schedule();
  }
  texSubImage2D(...arguments_: unknown[]): void {
    const [target, level, x, y] = arguments_ as number[];
    const texture = this.boundTexture(target!); if (texture === undefined) return;
    if (!texture?.storage) return this.error(GL.INVALID_OPERATION);
    const dimensions = arguments_.length === 9;
    const source = arguments_[dimensions ? 8 : 6];
    const image = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
    const width = Number(dimensions ? arguments_[4] : image.naturalWidth ?? image.width);
    const height = Number(dimensions ? arguments_[5] : image.naturalHeight ?? image.height);
    const format = Number(arguments_[dimensions ? 6 : 4]);
    const type = Number(arguments_[dimensions ? 7 : 5]);
    if (level !== 0) return unsupported("texture mip levels");
    if (x! < 0 || y! < 0 || width < 0 || height < 0 || x! + width > texture.storage.width ||
        y! + height > texture.storage.height) return this.error(GL.INVALID_VALUE);
    if (format !== texture.format || type !== GL.UNSIGNED_BYTE) return this.error(GL.INVALID_OPERATION);
    const data = this.pixelData(width, height, format, source); if (!data) return;
    const previous = texture.storage;
    texture.storage = { width: previous.width, height: previous.height,
      generation: texture.generation, parent: previous,
      update: { x: x!, y: y!, width, height, data } };
    texture.version++;
    this.host.replaceStorage(previous, texture.storage);
    this.schedule();
  }
  generateMipmap(_target: number): never { return unsupported("generateMipmap"); }
  deleteTexture(texture: TextureObject | null): void {
    if (texture === null || !this.valid(texture, TextureObject, true) || texture.deleted) return;
    texture.deleted = true;
    this.objects.delete(texture);
    this.textureUnits = this.textureUnits.map(value => value === texture ? null : value);
    if (this.framebuffer?.color === texture) this.framebuffer.color = null;
    this.releaseTexture(texture);
  }
  private releaseTexture(texture: TextureObject): void {
    if (!texture.deleted) return;
    const retained = [...this.objects].some(object => object instanceof FramebufferObject && object.color === texture);
    if (!retained && texture.storage) {
      this.host.retireStorage(texture.storage);
      texture.storage = null;
      this.schedule();
    }
  }
  isTexture(texture: unknown): boolean {
    return !this.lost && texture instanceof TextureObject && texture.owner === this.owner && !texture.deleted;
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
    this.framebuffer = framebuffer;
  }
  framebufferTexture2D(target: number, attachment: number, textureTarget: number,
    texture: TextureObject | null, level: number): void {
    if (target !== GL.FRAMEBUFFER || attachment !== GL.COLOR_ATTACHMENT0 || textureTarget !== GL.TEXTURE_2D) return this.error(GL.INVALID_ENUM);
    if (level !== 0) return this.error(GL.INVALID_VALUE);
    if (!this.framebuffer) return this.error(GL.INVALID_OPERATION);
    if (texture !== null && !this.valid(texture, TextureObject)) return;
    const previous = this.framebuffer.color;
    this.framebuffer.color = texture;
    if (previous && previous !== texture) this.releaseTexture(previous);
  }
  checkFramebufferStatus(target: number): number {
    if (this.lost) return GL.FRAMEBUFFER_UNSUPPORTED;
    if (target !== GL.FRAMEBUFFER) { this.error(GL.INVALID_ENUM); return 0; }
    if (!this.framebuffer) return GL.FRAMEBUFFER_COMPLETE;
    const color = this.framebuffer.color?.storage;
    if (!color) return GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
    if (!color.width || !color.height || this.framebuffer.color!.format !== GL.RGBA) return GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    const depth = this.framebuffer.depth;
    if (depth && (!depth.width || !depth.height)) return GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    if (depth && (depth.width !== color.width || depth.height !== color.height)) return GL.FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
    return GL.FRAMEBUFFER_COMPLETE;
  }
  getFramebufferAttachmentParameter(target: number, attachment: number, parameter: number): unknown {
    if (target !== GL.FRAMEBUFFER || (attachment !== GL.COLOR_ATTACHMENT0 && attachment !== GL.DEPTH_ATTACHMENT)) {
      this.error(GL.INVALID_ENUM); return null;
    }
    if (!this.framebuffer) { this.error(GL.INVALID_OPERATION); return null; }
    const object = attachment === GL.COLOR_ATTACHMENT0 ? this.framebuffer.color : this.framebuffer.depth;
    if (parameter === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) return object === null ? GL.NONE :
      attachment === GL.COLOR_ATTACHMENT0 ? GL.TEXTURE : GL.RENDERBUFFER;
    if (parameter === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) return object;
    if (object && parameter === GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL) return 0;
    if (object && parameter === GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE) return 0;
    this.error(GL.INVALID_ENUM); return null;
  }
  deleteFramebuffer(framebuffer: FramebufferObject | null): void {
    if (framebuffer === null || !this.valid(framebuffer, FramebufferObject, true)) return;
    const color = framebuffer.color;
    const depth = framebuffer.depth;
    framebuffer.deleted = true; this.objects.delete(framebuffer);
    if (this.framebuffer === framebuffer) this.framebuffer = null;
    framebuffer.color = null;
    framebuffer.depth = null;
    if (color) this.releaseTexture(color);
    if (depth) this.releaseRenderbuffer(depth);
  }
  isFramebuffer(framebuffer: unknown): boolean {
    return !this.lost && framebuffer instanceof FramebufferObject && framebuffer.owner === this.owner && !framebuffer.deleted;
  }
  createRenderbuffer(): RenderbufferObject | null { return this.lost ? null : this.track(new RenderbufferObject(this.owner)); }
  bindRenderbuffer(target: number, renderbuffer: RenderbufferObject | null): void {
    if (target !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (renderbuffer !== null && !this.valid(renderbuffer, RenderbufferObject)) return;
    this.renderbuffer = renderbuffer;
  }
  renderbufferStorage(target: number, format: number, width: number, height: number): void {
    if (target !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (!this.renderbuffer) return this.error(GL.INVALID_OPERATION);
    if (width < 0 || height < 0 || width > this.host.limits.maxTextureDimension2D ||
        height > this.host.limits.maxTextureDimension2D) return this.error(GL.INVALID_VALUE);
    if (format !== GL.DEPTH_COMPONENT16) return unsupported("non-depth renderbuffer storage");
    this.host.retireDepth(this.renderbuffer.id, this.renderbuffer.generation);
    Object.assign(this.renderbuffer, { width, height, format, generation: this.renderbuffer.generation + 1 });
    this.schedule();
  }
  framebufferRenderbuffer(target: number, attachment: number, renderbufferTarget: number,
    renderbuffer: RenderbufferObject | null): void {
    if (target !== GL.FRAMEBUFFER || attachment !== GL.DEPTH_ATTACHMENT || renderbufferTarget !== GL.RENDERBUFFER) return this.error(GL.INVALID_ENUM);
    if (!this.framebuffer) return this.error(GL.INVALID_OPERATION);
    if (renderbuffer !== null && !this.valid(renderbuffer, RenderbufferObject)) return;
    const previous = this.framebuffer.depth;
    this.framebuffer.depth = renderbuffer;
    if (previous && previous !== renderbuffer) this.releaseRenderbuffer(previous);
  }
  getRenderbufferParameter(target: number, parameter: number): unknown {
    if (target !== GL.RENDERBUFFER) { this.error(GL.INVALID_ENUM); return null; }
    if (!this.renderbuffer) { this.error(GL.INVALID_OPERATION); return null; }
    const values: Record<number, number> = { [GL.RENDERBUFFER_WIDTH]: this.renderbuffer.width,
      [GL.RENDERBUFFER_HEIGHT]: this.renderbuffer.height, [GL.RENDERBUFFER_INTERNAL_FORMAT]: this.renderbuffer.format,
      [GL.RENDERBUFFER_RED_SIZE]: 0, [GL.RENDERBUFFER_GREEN_SIZE]: 0, [GL.RENDERBUFFER_BLUE_SIZE]: 0,
      [GL.RENDERBUFFER_ALPHA_SIZE]: 0, [GL.RENDERBUFFER_DEPTH_SIZE]: 24, [GL.RENDERBUFFER_STENCIL_SIZE]: 0 };
    if (parameter in values) return values[parameter]; this.error(GL.INVALID_ENUM); return null;
  }
  deleteRenderbuffer(renderbuffer: RenderbufferObject | null): void {
    if (renderbuffer === null || !this.valid(renderbuffer, RenderbufferObject, true)) return;
    renderbuffer.deleted = true; if (this.renderbuffer === renderbuffer) this.renderbuffer = null;
    if (this.framebuffer?.depth === renderbuffer) this.framebuffer.depth = null;
    this.objects.delete(renderbuffer);
    this.releaseRenderbuffer(renderbuffer);
  }
  private releaseRenderbuffer(renderbuffer: RenderbufferObject): void {
    if (!renderbuffer.deleted) return;
    const retained = [...this.objects].some(object => object instanceof FramebufferObject && object.depth === renderbuffer);
    if (!retained) { this.host.retireDepth(renderbuffer.id, renderbuffer.generation); this.schedule(); }
  }
  isRenderbuffer(renderbuffer: unknown): boolean {
    return !this.lost && renderbuffer instanceof RenderbufferObject && renderbuffer.owner === this.owner && !renderbuffer.deleted;
  }

  enable(capability: number): void { this.setCapability(capability, true); }
  disable(capability: number): void { this.setCapability(capability, false); }
  private setCapability(capability: number, enabled: boolean): void {
    if (capability === GL.BLEND) this.state.blend = enabled;
    else if (capability === GL.DEPTH_TEST) this.state.depthTest = enabled;
    else if (capability === GL.CULL_FACE) this.state.cull = enabled;
    else if (capability === GL.SCISSOR_TEST) this.state.scissorTest = enabled;
    else if (capability === GL.DITHER) this.dither = enabled;
    else if (capability === GL.STENCIL_TEST || capability === GL.POLYGON_OFFSET_FILL) unsupported("stencil/polygon offset state");
    else this.error(GL.INVALID_ENUM);
  }
  isEnabled(capability: number): boolean {
    if (capability === GL.BLEND) return this.state.blend;
    if (capability === GL.DEPTH_TEST) return this.state.depthTest;
    if (capability === GL.CULL_FACE) return this.state.cull;
    if (capability === GL.SCISSOR_TEST) return this.state.scissorTest;
    if (capability === GL.DITHER) return this.dither;
    if (capability === GL.STENCIL_TEST || capability === GL.POLYGON_OFFSET_FILL) return false;
    this.error(GL.INVALID_ENUM); return false;
  }
  viewport(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) return this.error(GL.INVALID_VALUE);
    this.state.viewport = [x, y, width, height];
  }
  scissor(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) return this.error(GL.INVALID_VALUE);
    this.state.scissor = [x, y, width, height];
  }
  clearColor(r: number, g: number, b: number, a: number): void { this.clearColorValue = [clamp(r), clamp(g), clamp(b), clamp(a)]; }
  clearDepth(depth: number): void { this.clearDepthValue = clamp(depth); }
  clearStencil(_stencil: number): void {}
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
    this.schedule();
  }

  getParameter(parameter: number): unknown {
    if (this.lost) return null;
    const values: Record<number, unknown> = {
      [GL.ARRAY_BUFFER_BINDING]: this.arrayBuffer, [GL.ELEMENT_ARRAY_BUFFER_BINDING]: this.elementBuffer,
      [GL.CURRENT_PROGRAM]: this.program, [GL.FRAMEBUFFER_BINDING]: this.framebuffer,
      [GL.RENDERBUFFER_BINDING]: this.renderbuffer, [GL.ACTIVE_TEXTURE]: GL.TEXTURE0 + this.activeUnit,
      [GL.TEXTURE_BINDING_2D]: this.textureUnits[this.activeUnit],
      [GL.VIEWPORT]: new Int32Array(this.state.viewport), [GL.SCISSOR_BOX]: new Int32Array(this.state.scissor),
      [GL.COLOR_CLEAR_VALUE]: new Float32Array(this.clearColorValue), [GL.DEPTH_CLEAR_VALUE]: this.clearDepthValue,
      [GL.COLOR_WRITEMASK]: [...this.state.colorMask], [GL.DEPTH_WRITEMASK]: this.state.depthMask,
      [GL.DEPTH_FUNC]: this.state.depthFunc, [GL.DEPTH_RANGE]: new Float32Array(this.state.depthRange),
      [GL.BLEND_COLOR]: new Float32Array(this.state.blendColor), [GL.BLEND_EQUATION_RGB]: this.state.blendEquationRGB,
      [GL.BLEND_EQUATION_ALPHA]: this.state.blendEquationAlpha, [GL.BLEND_SRC_RGB]: this.state.blendSrcRGB,
      [GL.BLEND_DST_RGB]: this.state.blendDstRGB, [GL.BLEND_SRC_ALPHA]: this.state.blendSrcAlpha,
      [GL.BLEND_DST_ALPHA]: this.state.blendDstAlpha, [GL.CULL_FACE_MODE]: this.state.cullFace,
      [GL.FRONT_FACE]: this.state.frontFace, [GL.UNPACK_ALIGNMENT]: this.unpackAlignment,
      [GL.PACK_ALIGNMENT]: this.packAlignment, [GL.UNPACK_FLIP_Y_WEBGL]: this.unpackFlipY,
      [GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL]: this.unpackPremultiply,
      [GL.UNPACK_COLORSPACE_CONVERSION_WEBGL]: this.unpackColorSpace,
      [GL.MAX_VERTEX_ATTRIBS]: this.profile.vertexAttributes, [GL.MAX_TEXTURE_SIZE]: this.host.limits.maxTextureDimension2D,
      [GL.MAX_RENDERBUFFER_SIZE]: this.host.limits.maxTextureDimension2D,
      [GL.MAX_TEXTURE_IMAGE_UNITS]: this.profile.fragmentTextureUnits, [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: this.profile.combinedTextureUnits,
      [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: this.profile.vertexTextureUnits, [GL.MAX_VERTEX_UNIFORM_VECTORS]: this.profile.vertexUniformVectors,
      [GL.MAX_FRAGMENT_UNIFORM_VECTORS]: this.profile.fragmentUniformVectors, [GL.MAX_VARYING_VECTORS]: this.profile.varyingVectors,
      [GL.MAX_VIEWPORT_DIMS]: new Int32Array([this.host.limits.maxTextureDimension2D, this.host.limits.maxTextureDimension2D]),
      [GL.VERSION]: "WebGL 1.0 (Refral prototype)", [GL.SHADING_LANGUAGE_VERSION]: "WebGL GLSL ES 1.0 (ANGLE)",
      [GL.VENDOR]: "Refral", [GL.RENDERER]: "WebGPU",
      [GL.RED_BITS]: 8, [GL.GREEN_BITS]: 8, [GL.BLUE_BITS]: 8,
      [GL.ALPHA_BITS]: this.contextAttributes.alpha ? 8 : 0,
      [GL.DEPTH_BITS]: this.contextAttributes.depth ? 24 : 0, [GL.STENCIL_BITS]: 0,
      [GL.SAMPLES]: 0, [GL.SAMPLE_BUFFERS]: 0,
    };
    if (parameter in values) return values[parameter];
    if ([GL.BLEND, GL.CULL_FACE, GL.DEPTH_TEST, GL.SCISSOR_TEST, GL.DITHER,
      GL.STENCIL_TEST, GL.POLYGON_OFFSET_FILL].includes(parameter as 0x0be2)) return this.isEnabled(parameter);
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

  markLost(): boolean {
    if (this.lost) return false;
    this.lost = true;
    this.errors.clear();
    this.errors.set(GL.CONTEXT_LOST_WEBGL);
    return true;
  }
}
