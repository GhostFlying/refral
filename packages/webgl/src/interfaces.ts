import { GL } from '@refral/core-api';
import { webgl1Methods } from './methods.js';

// WebGL objects have Web IDL interface prototypes. Capability and ownership checks use facade WeakMaps.
export function webglInterfaces(realm: typeof globalThis = globalThis) {
  return {
    buffer: realm.WebGLBuffer?.prototype ?? Object.prototype,
    shader: realm.WebGLShader?.prototype ?? Object.prototype,
    program: realm.WebGLProgram?.prototype ?? Object.prototype,
    'uniform-location': realm.WebGLUniformLocation?.prototype ?? Object.prototype,
    texture: realm.WebGLTexture?.prototype ?? Object.prototype,
    framebuffer: realm.WebGLFramebuffer?.prototype ?? Object.prototype,
    renderbuffer: realm.WebGLRenderbuffer?.prototype ?? Object.prototype,
    activeInfo: realm.WebGLActiveInfo?.prototype ?? Object.prototype,
    precisionFormat: realm.WebGLShaderPrecisionFormat?.prototype ?? Object.prototype,
    context: realm.WebGLRenderingContext?.prototype,
  };
}

export function interfaceRecord(prototype: object, values: unknown): object | null {
  if (values == null) return null;
  const record: object = Object.create(prototype);
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(record, key, { value, enumerable: true, configurable: true });
  }
  return record;
}

type Invoke = (name: string, args: unknown[]) => unknown;
const receivers = new WeakMap<object, Invoke>();
const contextPrototypes = new WeakMap<object, { prototype: object; hidden: Set<string> }>();
const attributes = ['canvas', 'drawingBufferWidth', 'drawingBufferHeight', 'drawingBufferFormat', 'drawingBufferColorSpace'];

function invokeContext(receiver: object, name: string, args: unknown[]): unknown {
  const invoke = receivers.get(receiver);
  if (!invoke) throw new TypeError('Expected a Refral WebGL context receiver.');
  return invoke(name, args);
}

export function createContextInterface(parent: object = Object.prototype, invoke: Invoke): object {
  let entry = contextPrototypes.get(parent);
  if (!entry) {
    const prototype: object = Object.create(parent);
    for (const [key, value] of Object.entries(GL)) {
      Object.defineProperty(prototype, key, { value, enumerable: true });
    }
    for (const key of webgl1Methods) {
      const operation = { [key](this: object, ...args: unknown[]) { return invokeContext(this, key, args); } }[key];
      Object.defineProperty(prototype, key, { value: operation, enumerable: true, writable: true, configurable: true });
    }
    for (const key of attributes) {
      Object.defineProperty(prototype, key, {
        get(this: object) { return invokeContext(this, key, []); }, enumerable: true, configurable: true,
      });
    }
    const hidden = new Set<string>();
    for (const key of Object.keys(parent)) {
      if (!Object.hasOwn(prototype, key)) {
        // Hide browser-only APIs from enumeration while retaining the realm's instanceof chain.
        Object.defineProperty(prototype, key, { value: undefined, writable: true, configurable: true });
        hidden.add(key);
      }
    }
    entry = { prototype, hidden };
    contextPrototypes.set(parent, entry);
  }
  const { prototype, hidden } = entry;
  const context = new Proxy(Object.create(prototype) as object, {
    has(target, key) {
      if (typeof key === 'string' && hidden.has(key) && !Object.hasOwn(target, key)) return false;
      return Reflect.has(target, key);
    },
  });
  receivers.set(context, invoke);
  return context;
}
