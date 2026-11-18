import { webglInterfaces } from './interfaces.js';
import { GL, allocateContextId, ExecutionResources } from "@refral/core-api";
import type { BufferHandle, BufferSnapshot, CoreKind, DrawingCore } from "@refral/core-api";
import { createJsDrawingCore } from "@refral/core-js";
import { prepareRustDrawingCores, prepareRustModule } from "@refral/core-wasm";
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
import { createContextLoss } from './context-loss.js';

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
  premultipliedAlpha: true, preserveDrawingBuffer: false,
  powerPreference: "default", failIfMajorPerformanceCaveat: false, desynchronized: false,
};

function unsupported(operation: string): never {
  throw new DOMException(`${operation} is outside the implemented WebGL1 profile`, "NotSupportedError");
}

/** A structural WebGL API facade. Runtime identity is provided by Refral wrappers. */
export type WebGL1PrototypeContext = WebGLRenderingContext;

function actualAttributes(requested: WebGLContextAttributes): WebGLContextAttributes {
  return { ...defaults, preserveDrawingBuffer: requested.preserveDrawingBuffer ?? false, premultipliedAlpha: requested.premultipliedAlpha ?? true, alpha: requested.alpha ?? true, depth: requested.depth ?? true, stencil: requested.stencil ?? false };
}

function trackBitmapTransfer(canvas: HTMLCanvasElement | OffscreenCanvas, currentHost: () => BrowserHost): () => void {
  if (!('transferToImageBitmap' in canvas)) return () => {};
  const previous = Object.getOwnPropertyDescriptor(canvas, 'transferToImageBitmap');
  const original = canvas.transferToImageBitmap;
  function transferToImageBitmap(this: OffscreenCanvas): ImageBitmap {
    if (this !== canvas) return original.call(this);
    const host = currentHost();
    host.prepareCanvasSource();
    const bitmap = original.call(this);
    host.resetDefaultDrawingBuffer();
    return bitmap;
  }
  Object.defineProperty(canvas, 'transferToImageBitmap', {
    value: transferToImageBitmap, configurable: true, writable: true, enumerable: previous?.enumerable ?? false,
  });
  return () => {
    if (canvas.transferToImageBitmap !== transferToImageBitmap) return;
    if (previous) Object.defineProperty(canvas, 'transferToImageBitmap', previous);
    else Reflect.deleteProperty(canvas, 'transferToImageBitmap');
  };
}

function createGeneration(canvas: HTMLCanvasElement | OffscreenCanvas, host: BrowserHost, core: DrawingCore, releaseResources: () => void) {
  const realm = ('ownerDocument' in canvas ? canvas.ownerDocument.defaultView : null) ?? globalThis;
  const interfaces = webglInterfaces(realm);
  const bufferFacade = createBufferFacade(core, interfaces);
  const programFacade = createProgramFacade(core, interfaces);
  const resourceFacade = createResourceFacade(core,
    (source, width, height, plan) => host.captureDomCanvas(source, width, height, plan),
    realm.TypeError, interfaces);
  let releasing: Promise<void> | undefined;
  let disposed = false;
  function releaseGPU() {
    if (!releasing) { releaseResources(); releasing = host.dispose(); }
    return releasing;
  }
  return { core, host, interfaces, bufferFacade, programFacade, resourceFacade, releaseGPU,
    dispose() {
      if (!disposed) {
        disposed = true;
        core.dispose();
        bufferFacade.dispose();
        programFacade.dispose();
        resourceFacade.dispose();
      }
      return releaseGPU();
    } };
}

function observeDeviceLoss(device: GPUDevice, owner: WeakRef<ReturnType<typeof createContextLoss>>): void {
  void device.lost.then(info => owner.deref()?.deviceLoss(info.message));
}

function wrapContext(canvas: HTMLCanvasElement | OffscreenCanvas, attributes: WebGLContextAttributes,
  create: () => ReturnType<typeof createGeneration>, onDispose: () => void): WebGL1PrototypeContext {
  let current = create();
  const interfaces = current.interfaces;
  let disposed: Promise<void> | undefined;
  const lost = createContextLoss(canvas, {
    invalidOperation: () => current.core.invoke('recordContextLossError', []),
    lose() {
      if (!current.core.markLost()) return false;
      void current.releaseGPU();
      return true;
    },
    async restore() {
      const previous = current;
      try {
        await previous.releaseGPU();
        if (!lost.canRestore()) return false;
        current = create();
        await previous.dispose();
        return true;
      } catch (error) {
        current.host.errors.push(`Context restoration failed: ${String(error)}`);
        return false;
      }
    },
  });
  const untrackBitmap = trackBitmapTransfer(canvas, () => current.host);
  const unregisterSource = registerCanvasSource(canvas, {
    prepare: () => current.host.prepareCanvasSource(), isLost: () => current.core.isContextLost(),
  });
  observeDeviceLoss(current.host.device, new WeakRef(lost));
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  const invoke = (property: string, args: unknown[]): unknown => {
    const { core, host, bufferFacade, programFacade, resourceFacade } = current;
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
    if (property === 'getSupportedExtensions') return core.isContextLost() ? null : ['WEBGL_lose_context'];
    if (property === 'getExtension') {
      requireArguments(property, args, 1);
      const name = `${args[0]}`.toLowerCase();
      return !core.isContextLost() && name === 'webgl_lose_context' ? lost.extension : null;
    }
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
    get drawingBufferWidth() { return current.core.isContextLost() ? 0 : current.host.surface.width; },
    get drawingBufferHeight() { return current.core.isContextLost() ? 0 : current.host.surface.height; },
    get drawingBufferColorSpace() { return 'srgb'; },
  }, interfaces.context ?? constants);
  const proxy = new Proxy(surface, {
    has(target, property) {
      if (typeof property !== 'string' || Object.hasOwn(target, property)) return Reflect.has(target, property);
      if (webgl1Methods.has(property) || Object.hasOwn(constants, property)) return true;
      return !(interfaces.context && Object.hasOwn(interfaces.context, property)) && Reflect.has(target, property);
    },
    get(target, property, receiver) {
      if (typeof property !== 'string' || Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
      if (Object.hasOwn(constants, property)) return Reflect.get(constants, property);
      if (!webgl1Methods.has(property)) {
        if (interfaces.context && Object.hasOwn(interfaces.context, property)) return undefined;
        return Reflect.get(target, property, receiver);
      }
      if (!methods.has(property)) methods.set(property, (...args) => invoke(property, args));
      return methods.get(property);
    },
  });
  hooks.set(proxy, {
    core: current.core.kind,
    inspectBuffer: buffer => current.bufferFacade.inspect(buffer),
    capture: () => current.host.capture(current.core.captureTarget()),
    get stats() { return current.host.stats; },
    get environment() { return current.host.environment; },
    get errors() { return current.host.errors; },
    get device() { return current.host.device; },
    dispose() {
      if (!disposed) {
        lost.dispose();
        untrackBitmap();
        unregisterSource();
        disposed = current.dispose().finally(onDispose);
      }
      return disposed;
    },
  });
  return proxy as unknown as WebGL1PrototypeContext;
}

export async function createWebGLOnWebGPU(canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ContextOptions = { version: 1 }): Promise<WebGL1PrototypeContext> {
  if (options.version !== 1) return unsupported("WebGL version");
  const prepared = await prepareRuntime(options);
  try {
    return prepared.create(canvas, { ...options, ...options.contextAttributes, ...options.attributes }, prepared.dispose);
  } catch (error) { prepared.dispose(); throw error; }
}

type RuntimeOptions = Pick<ContextOptions, 'core' | 'coreWasmURL' | 'compiler' | 'compilerBaseURL'>;

async function prepareRuntime(options: RuntimeOptions) {
  const kind = options.core ?? 'js';
  if (kind !== 'js' && kind !== 'rust') return unsupported('core selection');
  const prepared = await Promise.allSettled([
    options.compiler ?? createCompiler(options.compilerBaseURL), BrowserHost.prepare(),
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
  const makeCore = moduleResult.value ? prepareRustDrawingCores(moduleResult.value) : createJsDrawingCore;
  const create = (canvas: HTMLCanvasElement | OffscreenCanvas, requested: WebGLContextAttributes, onDispose: () => void) => {
    const attributes = actualAttributes(requested);
    const errors: string[] = [];
    return wrapContext(canvas, attributes, () => {
      const host = makeHost(canvas, { alpha: attributes.alpha!, depth: attributes.depth!, stencil: attributes.stencil, premultipliedAlpha: attributes.premultipliedAlpha, preserveDrawingBuffer: attributes.preserveDrawingBuffer, errors });
      const registry = createCompilerRegistry(compiler);
      const contextId = allocateContextId();
      const resources = new ExecutionResources(contextId, host);
      const coreOptions = {
        contextId, maxBufferBytes: host.limits.maxBufferSize,
        surface: host.surface, attributes, profile: COMPILER_LIMITS,
      };
      const services = { compiler: registry, host, resources };
      try {
        const core = makeCore(coreOptions, services);
        return createGeneration(canvas, host, core, () => { resources.dispose(); registry.dispose(); });
      } catch (error) {
        registry.dispose();
        resources.dispose();
        void host.dispose();
        throw error;
      }
    }, onDispose);
  };
  return { create, dispose: makeHost.dispose };
}

/** Harness-only synchronous construction after browser device/compiler initialization. */
export async function prepareContextFactory(options: RuntimeOptions = {}): Promise<PreparedContextFactory> {
  const prepared = await prepareRuntime(options);
  const contexts = new Set<WeakRef<WebGL1PrototypeContext>>();
  const factory: PreparedContextFactory = (canvas, requested = {}) => {
    const context = prepared.create(canvas, requested, () => contexts.delete(reference));
    const reference = new WeakRef(context);
    contexts.add(reference);
    return context;
  };
  factory.dispose = async () => {
    await Promise.all([...contexts].map(ref => {
      const context = ref.deref();
      return context && getTestingHooks(context).dispose();
    }));
    contexts.clear();
    prepared.dispose();
  };
  return factory;
}

export function getTestingHooks(context: WebGL1PrototypeContext): TestingHooks {
  const result = hooks.get(context);
  if (!result) throw new TypeError("Expected a Refral context");
  return result;
}
