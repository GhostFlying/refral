import { VERTEX_ARRAY_BINDING_OES } from '@refral/core-api';
import type { DrawingCore, VertexArrayHandle } from '@refral/core-api';
import { requireArguments } from './buffers.js';

const handles = new WeakMap<object, VertexArrayHandle>();
const prototypes = new WeakMap<object, object>();

export function createVertexArrayExtension(core: DrawingCore, bufferPrototype: object, ErrorType: TypeErrorConstructor) {
  // The ratified IDL has no global constructor. Share its prototype within the canvas realm.
  let prototype = prototypes.get(bufferPrototype);
  if (!prototype) {
    prototype = Object.create(Object.getPrototypeOf(bufferPrototype), {
      [Symbol.toStringTag]: { value: 'WebGLVertexArrayObjectOES', configurable: true },
    }) as object;
    prototypes.set(bufferPrototype, prototype);
  }
  const arrayPrototype = prototype;
  const wrappers = new Map<string, WeakRef<WebGLVertexArrayObjectOES>>();
  let bound: WebGLVertexArrayObjectOES | null = null;
  const collected = new FinalizationRegistry<VertexArrayHandle>(handle => {
    wrappers.delete(handle.slot + '/' + handle.generation);
    core.invoke('deleteVertexArrayOES', [handle]);
  });
  function unwrap(value: WebGLVertexArrayObjectOES | null | undefined) {
    if (value == null) return null;
    const handle = handles.get(value);
    if (!handle) throw new ErrorType('Expected a WebGLVertexArrayObjectOES.');
    return handle;
  }
  function wrap(handle: VertexArrayHandle | null) {
    if (!handle) return null;
    const key = handle.slot + '/' + handle.generation;
    let wrapper = wrappers.get(key)?.deref();
    if (!wrapper) {
      wrapper = Object.create(arrayPrototype) as WebGLVertexArrayObjectOES;
      handles.set(wrapper, handle);
      wrappers.set(key, new WeakRef(wrapper));
      collected.register(wrapper, handle, wrapper);
    }
    return wrapper;
  }
  const extension = {
    VERTEX_ARRAY_BINDING_OES,
    createVertexArrayOES() {
      if (this !== extension) throw new ErrorType('Expected an OES_vertex_array_object receiver.');
      if (core.isContextLost()) {
        const wrapper = Object.create(arrayPrototype) as WebGLVertexArrayObjectOES;
        handles.set(wrapper, { kind: 'vertex-array', contextId: core.contextId, slot: 0, generation: 0 });
        return wrapper;
      }
      return wrap(core.invoke('createVertexArrayOES', []) as VertexArrayHandle | null);
    },
    bindVertexArrayOES(value: WebGLVertexArrayObjectOES | null) {
      if (this !== extension) throw new ErrorType('Expected an OES_vertex_array_object receiver.');
      requireArguments('bindVertexArrayOES', arguments, 1, ErrorType);
      const handle = unwrap(value);
      if (core.invoke('bindVertexArrayOES', [handle])) bound = handle ? wrap(handle) : null;
    },
    deleteVertexArrayOES(value: WebGLVertexArrayObjectOES | null) {
      if (this !== extension) throw new ErrorType('Expected an OES_vertex_array_object receiver.');
      requireArguments('deleteVertexArrayOES', arguments, 1, ErrorType);
      const handle = unwrap(value);
      core.invoke('deleteVertexArrayOES', [handle]);
      if (value && handle?.contextId === core.contextId) {
        collected.unregister(value);
        if (value === bound) bound = null;
        wrappers.delete(handle.slot + '/' + handle.generation);
      }
    },
    isVertexArrayOES(value: WebGLVertexArrayObjectOES | null) {
      if (this !== extension) throw new ErrorType('Expected an OES_vertex_array_object receiver.');
      requireArguments('isVertexArrayOES', arguments, 1, ErrorType);
      return core.invoke('isVertexArrayOES', [unwrap(value)]);
    },
  };
  Object.defineProperty(extension, 'VERTEX_ARRAY_BINDING_OES', { writable: false, configurable: false });
  core.invoke('enableVertexArrayObjects', []);
  return { extension, binding: () => wrap(core.invoke('getParameter', [VERTEX_ARRAY_BINDING_OES]) as VertexArrayHandle | null) };
}
