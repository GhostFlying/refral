import { GL, allocateContextId, ExecutionResources } from "@refral/core-api";
import type { BufferHandle, BufferSnapshot, CoreKind, DrawingCore } from "@refral/core-api";
import { createJsDrawingCore } from "@refral/core-js";
import { createRustDrawingCore, createRustDrawingCoreFromModule, prepareRustModule } from "@refral/core-wasm";
import { BrowserHost } from "@refral/browser-host";
import type { CapturedPixels } from "@refral/browser-host";
import { createCompiler, createCompilerRegistry, COMPILER_LIMITS } from "@refral/compiler";
import type { Compiler } from "@refral/compiler";
import { createBufferFacade, isBufferBinding, requireArguments, toEnum, toSize } from "./buffers.js";
import { createProgramFacade } from "./programs.js";
import { createResourceFacade, isResourceBinding } from './resources.js';
import { readPixels } from './readback.js';
import { registerCanvasSource } from './dom-upload.js';
import { webgl1Methods } from './methods.js';

export interface ContextOptions extends WebGLContextAttributes {
  version: 1;
  core?: CoreKind;
  coreWasmURL?: string;
  attributes?: WebGLContextAttributes;
  contextAttributes?: WebGLContextAttributes;
  compiler?: Compiler;
  compilerBaseURL?: string;
}

export interface TestingHooks {
  readonly core: CoreKind;
  inspectBuffer(buffer: WebGLBuffer): BufferSnapshot | null;
  capture(): Promise<CapturedPixels>;
  readonly stats: BrowserHost["stats"];
  readonly environment: Record<string, unknown>;
  readonly errors: string[];
  readonly device: GPUDevice;
  dispose(): Promise<void>;
}

export interface PreparedContextFactory {
  (canvas: HTMLCanvasElement | OffscreenCanvas, attributes?: WebGLContextAttributes): WebGL1PrototypeContext;
  dispose(): Promise<void>;
}

const hooks = new WeakMap<object, TestingHooks>();
const constants = Object.freeze({ ...GL });
const defaults: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: true,
  powerPreference: "default", failIfMajorPerformanceCaveat: false, desynchronized: false,
};

function unsupported(operation: string): never {
  throw new DOMException(`${operation} is outside the implemented WebGL1 profile`, "NotSupportedError");
}

/** A structural WebGL API facade. Runtime identity is provided by Refral wrappers. */
export type WebGL1PrototypeContext = WebGLRenderingContext;

function actualAttributes(requested: WebGLContextAttributes): WebGLContextAttributes {
  return { ...defaults, premultipliedAlpha: requested.premultipliedAlpha ?? true, alpha: requested.alpha ?? true, depth: requested.depth ?? true, stencil: requested.stencil ?? false };
}

function wrapContext(canvas: HTMLCanvasElement | OffscreenCanvas, host: BrowserHost,
  attributes: WebGLContextAttributes, core: DrawingCore,
  disposeCompiler: () => void): WebGL1PrototypeContext {
  const bufferFacade = createBufferFacade(core);
  const programFacade = createProgramFacade(core);
  const resourceFacade = createResourceFacade(core,
    (source, width, height, plan) => host.captureDomCanvas(source, width, height, plan),
    ('ownerDocument' in canvas ? canvas.ownerDocument.defaultView?.TypeError : undefined) ?? TypeError);
  const unregisterSource = registerCanvasSource(canvas, {
    prepare: () => host.prepareCanvasSource(), isLost: () => core.isContextLost(),
  });
  void host.device.lost.then(info => {
    if (core.markLost()) canvas.dispatchEvent(new WebGLContextEvent("webglcontextlost", {
      cancelable: true, statusMessage: info.message,
    }));
  });
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  const invoke = (property: string, args: unknown[]): unknown => {
    if (property === 'getError') return core.getError();
    if (property === 'isContextLost') return core.isContextLost();
    if (property === 'readPixels') return readPixels(core, host, args);
    if (Object.hasOwn(bufferFacade.methods, property)) return bufferFacade.methods[property]!(...args);
    if (property === 'getParameter') {
      requireArguments(property, args, 1);
      const parameter = toEnum(args[0]);
      if (isBufferBinding(parameter)) return bufferFacade.binding(parameter);
      if (parameter === GL.CURRENT_PROGRAM) return programFacade.current();
      if (isResourceBinding(parameter)) return resourceFacade.binding(parameter);
      args = [parameter];
    }
    if (property === 'getContextAttributes') return core.isContextLost() ? null : { ...attributes };
    if (property === 'getSupportedExtensions') return core.isContextLost() ? null : [];
    if (property === 'getExtension') return null;
    if (property === 'vertexAttribPointer') {
      requireArguments(property, args, 6);
      args = [toEnum(args[0]), +(args[1] as number) | 0, toEnum(args[2]), Boolean(args[3]),
        +(args[4] as number) | 0, toSize(args[5])];
    } else if (property === 'drawArrays') {
      requireArguments(property, args, 3);
      args = [toEnum(args[0]), +(args[1] as number) | 0, +(args[2] as number) | 0];
    } else if (property === 'drawElements') {
      requireArguments(property, args, 4);
      args = [toEnum(args[0]), +(args[1] as number) | 0, toEnum(args[2]), toSize(args[3])];
    }
    const facadeMethod = programFacade.methods[property] ?? resourceFacade.methods[property];
    const result = facadeMethod ? facadeMethod(...args) : core.invoke(property, args);
    if (property === 'getVertexAttrib' && toEnum(args[1]) === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) {
      return bufferFacade.wrap(result as BufferHandle | null);
    }
    return result;
  };
  const surface = Object.setPrototypeOf({
    get canvas() { return canvas; },
    get drawingBufferWidth() { return core.isContextLost() ? 0 : host.surface.width; },
    get drawingBufferHeight() { return core.isContextLost() ? 0 : host.surface.height; },
    get drawingBufferColorSpace() { return 'srgb'; },
  }, constants);
  const proxy = new Proxy(surface, {
    has(target, property) {
      return (typeof property === 'string' && webgl1Methods.has(property)) || Reflect.has(target, property);
    },
    get(target, property, receiver) {
      if (typeof property !== 'string' || !webgl1Methods.has(property) || Object.hasOwn(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      if (!methods.has(property)) methods.set(property, (...args) => invoke(property, args));
      return methods.get(property);
    },
  });
  hooks.set(proxy, {
    core: core.kind,
    inspectBuffer: bufferFacade.inspect,
    capture: () => host.capture(core.captureTarget()),
    stats: host.stats, environment: host.environment, errors: host.errors, device: host.device,
    dispose: async () => {
      unregisterSource();
      core.dispose();
      bufferFacade.dispose();
      programFacade.dispose();
      resourceFacade.dispose();
      disposeCompiler();
      await host.dispose();
    },
  });
  return proxy as unknown as WebGL1PrototypeContext;
}

export async function createWebGLOnWebGPU(canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ContextOptions = { version: 1 }): Promise<WebGL1PrototypeContext> {
  if (options.version !== 1) return unsupported("WebGL version");
  const kind = options.core ?? 'js';
  if (kind !== 'js' && kind !== 'rust') return unsupported('core selection');
  const attributes = actualAttributes({ ...options, ...options.contextAttributes, ...options.attributes });
  const compiler = options.compiler ?? await createCompiler(options.compilerBaseURL);
  const host = await BrowserHost.create(canvas, { alpha: attributes.alpha!, depth: attributes.depth!, stencil: attributes.stencil, premultipliedAlpha: attributes.premultipliedAlpha });
  const registry = createCompilerRegistry(compiler);
  const contextId = allocateContextId();
  const resources = new ExecutionResources(contextId, host);
  try {
    const coreOptions = {
      contextId, maxBufferBytes: host.limits.maxBufferSize,
      surface: host.surface, attributes, profile: COMPILER_LIMITS,
    };
    const services = { compiler: registry, host, resources };
    const core = kind === 'rust'
      ? await createRustDrawingCore(coreOptions, services, options.coreWasmURL)
      : createJsDrawingCore(coreOptions, services);
    return wrapContext(canvas, host, attributes, core, () => { resources.dispose(); registry.dispose(); });
  } catch (error) {
    registry.dispose();
    resources.dispose();
    await host.dispose();
    throw error;
  }
}

/** Harness-only synchronous construction after browser device/compiler initialization. */
export async function prepareContextFactory(
  options: Pick<ContextOptions, 'core' | 'coreWasmURL'> = {},
): Promise<PreparedContextFactory> {
  const kind = options.core ?? 'js';
  if (kind !== 'js' && kind !== 'rust') return unsupported('core selection');
  const prepared = await Promise.allSettled([
    createCompiler(), BrowserHost.prepare(),
    kind === 'rust' ? prepareRustModule(options.coreWasmURL) : null,
  ]);
  const [compilerResult, hostResult, moduleResult] = prepared;
  const failure = prepared.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    if (hostResult.status === 'fulfilled') hostResult.value.dispose();
    throw failure.reason;
  }
  if (compilerResult.status !== 'fulfilled' || hostResult.status !== 'fulfilled'
    || moduleResult.status !== 'fulfilled') throw new Error('Context preparation failed.');
  const compiler = compilerResult.value;
  const makeHost = hostResult.value;
  const module = moduleResult.value;
  const contexts = new Set<WebGL1PrototypeContext>();
  const factory: PreparedContextFactory = (canvas, requested = {}) => {
    const attributes = actualAttributes(requested);
    const host = makeHost(canvas, { alpha: attributes.alpha!, depth: attributes.depth!, stencil: attributes.stencil, premultipliedAlpha: attributes.premultipliedAlpha });
    const registry = createCompilerRegistry(compiler);
    const contextId = allocateContextId();
    const resources = new ExecutionResources(contextId, host);
    const coreOptions = {
      contextId, maxBufferBytes: host.limits.maxBufferSize,
      surface: host.surface, attributes, profile: COMPILER_LIMITS,
    };
    const services = { compiler: registry, host, resources };
    try {
      const core = kind === 'rust'
        ? createRustDrawingCoreFromModule(module!, coreOptions, services)
        : createJsDrawingCore(coreOptions, services);
      const context = wrapContext(canvas, host, attributes, core, () => { resources.dispose(); registry.dispose(); });
      contexts.add(context);
      return context;
    } catch (error) {
      registry.dispose();
      resources.dispose();
      void host.dispose();
      throw error;
    }
  };
  factory.dispose = async () => {
    await Promise.all([...contexts].map(context => getTestingHooks(context).dispose()));
    contexts.clear();
    makeHost.dispose();
  };
  return factory;
}

export function getTestingHooks(context: WebGL1PrototypeContext): TestingHooks {
  const result = hooks.get(context);
  if (!result) throw new TypeError("Expected a Refral context");
  return result;
}
