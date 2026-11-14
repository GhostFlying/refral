import { GL } from '@refral/core-api';
import type {
  DrawingCore, FramebufferHandle, LogicalHandle, PixelUpload, RenderbufferHandle, TextureHandle,
} from '@refral/core-api';
import { bufferSourceBytes, requireArguments, toEnum } from './buffers.js';

type ResourceHandle = TextureHandle | RenderbufferHandle | FramebufferHandle;
type ResourceKind = ResourceHandle['kind'];
class RefralTexture {}
class RefralRenderbuffer {}
class RefralFramebuffer {}
const constructors = { texture: RefralTexture, renderbuffer: RefralRenderbuffer, framebuffer: RefralFramebuffer };
const handles = new WeakMap<object, ResourceHandle>();
const typedArrayTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;

function integer(value: unknown): number { return +(value as number) | 0; }
function float(value: unknown): number { return Math.fround(+(value as number)); }

function unwrap(value: unknown, kind: ResourceKind): ResourceHandle | null {
  if (value === null || value === undefined) return null;
  const handle = (typeof value === 'object' || typeof value === 'function') ? handles.get(value) : undefined;
  if (!handle || handle.kind !== kind) throw new TypeError(`Expected a Refral WebGL ${kind}.`);
  return handle;
}

function pixels(value: unknown, nullable: boolean): PixelUpload | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (!ArrayBuffer.isView(value)) throw new TypeError('Texture pixels require an ArrayBufferView.');
  return { bytes: bufferSourceBytes(value), viewType: typedArrayTag.call(value) ?? 'DataView' };
}

export function isResourceBinding(parameter: number): boolean {
  return parameter === GL.TEXTURE_BINDING_2D || parameter === GL.FRAMEBUFFER_BINDING
    || parameter === GL.RENDERBUFFER_BINDING;
}

/** New resource wrappers and pixel-view conversion stay at the shared facade. */
export function createResourceFacade(core: DrawingCore) {
  const wrappers = new Map<string, object>();
  function wrap(value: unknown): object | null {
    if (value === null || value === undefined) return null;
    const handle = value as LogicalHandle;
    if (handle.kind !== 'texture' && handle.kind !== 'renderbuffer' && handle.kind !== 'framebuffer') {
      throw new Error('Non-resource handle returned by a resource query.');
    }
    const key = `${handle.kind}/${handle.contextId}/${handle.slot}/${handle.generation}`;
    let wrapper = wrappers.get(key);
    if (!wrapper) {
      wrapper = new constructors[handle.kind]();
      handles.set(wrapper, handle as ResourceHandle);
      wrappers.set(key, wrapper);
    }
    return wrapper;
  }

  const methods: Record<string, (...args: unknown[]) => unknown> = {};
  function method(name: string, minimum: number, normalize: (args: unknown[]) => unknown[],
    result: (value: unknown, args: unknown[]) => unknown = value => value) {
    methods[name] = (...args) => {
      requireArguments(name, args, minimum);
      const normalized = normalize(args);
      return result(core.invoke(name, normalized), normalized);
    };
  }
  for (const [suffix, kind] of [['Texture', 'texture'], ['Renderbuffer', 'renderbuffer'],
    ['Framebuffer', 'framebuffer']] as const) {
    methods[`create${suffix}`] = () => {
      if (core.isContextLost()) {
        const wrapper = new constructors[kind]();
        handles.set(wrapper, { kind, contextId: core.contextId, slot: 0, generation: 0 });
        return wrapper;
      }
      return wrap(core.invoke(`create${suffix}`, []));
    };
    method(`bind${suffix}`, 2, args => [toEnum(args[0]), unwrap(args[1], kind)]);
    method(`delete${suffix}`, 1, args => [unwrap(args[0], kind)]);
    method(`is${suffix}`, 1, args => [unwrap(args[0], kind)]);
  }
  method('activeTexture', 1, args => [toEnum(args[0])]);
  method('texParameteri', 3, args => [toEnum(args[0]), toEnum(args[1]), integer(args[2])]);
  method('texParameterf', 3, args => [toEnum(args[0]), toEnum(args[1]), float(args[2])]);
  method('pixelStorei', 2, args => [toEnum(args[0]), integer(args[1])]);
  method('getTexParameter', 2, args => [toEnum(args[0]), toEnum(args[1])]);
  method('texImage2D', 6, args => {
    if (args.length === 6) return [toEnum(args[0]), integer(args[1]), integer(args[2]),
      toEnum(args[3]), toEnum(args[4]), args[5]];
    requireArguments('texImage2D', args, 9);
    return [toEnum(args[0]), integer(args[1]), integer(args[2]), integer(args[3]), integer(args[4]),
      integer(args[5]), toEnum(args[6]), toEnum(args[7]), pixels(args[8], true)];
  });
  method('texSubImage2D', 7, args => {
    if (args.length === 7) return [toEnum(args[0]), integer(args[1]), integer(args[2]), integer(args[3]),
      toEnum(args[4]), toEnum(args[5]), args[6]];
    requireArguments('texSubImage2D', args, 9);
    return [toEnum(args[0]), integer(args[1]), integer(args[2]), integer(args[3]), integer(args[4]),
      integer(args[5]), toEnum(args[6]), toEnum(args[7]), pixels(args[8], false)];
  });
  method('framebufferTexture2D', 5, args => [toEnum(args[0]), toEnum(args[1]), toEnum(args[2]),
    unwrap(args[3], 'texture'), integer(args[4])]);
  method('framebufferRenderbuffer', 4, args => [toEnum(args[0]), toEnum(args[1]), toEnum(args[2]),
    unwrap(args[3], 'renderbuffer')]);
  method('renderbufferStorage', 4, args => [toEnum(args[0]), toEnum(args[1]), integer(args[2]), integer(args[3])]);
  method('getRenderbufferParameter', 2, args => [toEnum(args[0]), toEnum(args[1])]);
  method('checkFramebufferStatus', 1, args => [toEnum(args[0])]);
  method('getFramebufferAttachmentParameter', 3, args => [toEnum(args[0]), toEnum(args[1]), toEnum(args[2])],
    (value, args) => args[2] === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME ? wrap(value) : value);

  for (const name of ['enable', 'disable', 'isEnabled', 'depthFunc', 'frontFace', 'cullFace', 'blendEquation']) {
    method(name, 1, args => [toEnum(args[0])]);
  }
  method('depthMask', 1, args => [Boolean(args[0])]);
  method('colorMask', 4, args => args.slice(0, 4).map(Boolean));
  method('scissor', 4, args => args.slice(0, 4).map(integer));
  method('depthRange', 2, args => args.slice(0, 2).map(float));
  method('blendColor', 4, args => args.slice(0, 4).map(float));
  for (const name of ['blendFunc', 'blendEquationSeparate']) method(name, 2, args => args.slice(0, 2).map(toEnum));
  method('blendFuncSeparate', 4, args => args.slice(0, 4).map(toEnum));
  return {
    methods,
    binding: (parameter: number) => wrap(core.invoke('getParameter', [parameter])),
    dispose: () => wrappers.clear(),
  };
}
