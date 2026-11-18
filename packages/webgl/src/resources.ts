import { GL } from '@refral/core-api';
import type {
  DrawingCore, FramebufferHandle, LogicalHandle, PixelUpload, RenderbufferHandle, TextureHandle,
} from '@refral/core-api';
import { bufferSourceBytes, requireArguments, toEnum } from './buffers.js';
import { createDomTextureUploads } from './dom-upload.js';
import type { CanvasCapture } from './dom-upload.js';

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

const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

function pixels(value: unknown): PixelUpload | null {
  if (value === null || value === undefined) return null;
  if (!ArrayBuffer.isView(value)) throw new TypeError('Texture pixels require an ArrayBufferView.');
  const bytes = bufferSourceBytes(value);
  const viewType = typedArrayTag.call(value) ?? 'DataView';
  if (viewType !== 'Uint16Array' || littleEndian) return { bytes, viewType };
  const words = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const canonical = new DataView(new ArrayBuffer(bytes.byteLength));
  for (let i = 0; i < words.length; i++) canonical.setUint16(i * 2, words[i]!, true);
  return { bytes: new Uint8Array(canonical.buffer), viewType };
}

// No compressed format is enabled. Validate the required view without sending unused bytes to Wasm.
function compressedByteLength(source: unknown, ErrorType: TypeErrorConstructor): number {
  if (!ArrayBuffer.isView(source)) throw new ErrorType('Compressed texture data requires an ArrayBufferView.');
  return bufferSourceBytes(source, true, ErrorType).byteLength;
}

export function isResourceBinding(parameter: number): boolean {
  return parameter === GL.TEXTURE_BINDING_2D || parameter === GL.TEXTURE_BINDING_CUBE_MAP
    || parameter === GL.FRAMEBUFFER_BINDING
    || parameter === GL.RENDERBUFFER_BINDING;
}

/** New resource wrappers and pixel-view conversion stay at the shared facade. */
export function createResourceFacade(core: DrawingCore, captureCanvas: CanvasCapture,
  ErrorType: TypeErrorConstructor = TypeError) {
  const wrappers = new Map<string, object>();
  const domUploads = createDomTextureUploads(core, captureCanvas);
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
      requireArguments(name, args, minimum, ErrorType);
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
  method('generateMipmap', 1, args => [toEnum(args[0])]);
  method('activeTexture', 1, args => [toEnum(args[0])]);
  method('texParameteri', 3, args => [toEnum(args[0]), toEnum(args[1]), integer(args[2])]);
  method('texParameterf', 3, args => [toEnum(args[0]), toEnum(args[1]), float(args[2])]);
  method('pixelStorei', 2, args => [toEnum(args[0]), integer(args[1])]);
  method('getTexParameter', 2, args => [toEnum(args[0]), toEnum(args[1])]);
  method('compressedTexImage2D', 7, args => [toEnum(args[0]), integer(args[1]), toEnum(args[2]),
    integer(args[3]), integer(args[4]), integer(args[5]), compressedByteLength(args[6], ErrorType)]);
  method('compressedTexSubImage2D', 8, args => [toEnum(args[0]), integer(args[1]), integer(args[2]),
    integer(args[3]), integer(args[4]), integer(args[5]), toEnum(args[6]), compressedByteLength(args[7], ErrorType)]);
  methods.texImage2D = (...args) => {
    requireArguments('texImage2D', args, 6);
    if (args.length === 6) return domUploads.upload({
      operation: 'texImage2D', target: toEnum(args[0]), level: integer(args[1]), internalFormat: integer(args[2]),
      x: 0, y: 0, format: toEnum(args[3]), type: toEnum(args[4]),
    }, args[5]);
    requireArguments('texImage2D', args, 9);
    return core.invoke('texImage2D', [toEnum(args[0]), integer(args[1]), integer(args[2]), integer(args[3]), integer(args[4]),
      integer(args[5]), toEnum(args[6]), toEnum(args[7]), pixels(args[8])]);
  };
  methods.texSubImage2D = (...args) => {
    requireArguments('texSubImage2D', args, 7);
    if (args.length === 7) {
      const target = toEnum(args[0]);
      const level = integer(args[1]);
      const x = integer(args[2]);
      const y = integer(args[3]);
      const format = toEnum(args[4]);
      const type = toEnum(args[5]);
      return domUploads.upload({ operation: 'texSubImage2D', target, level,
        internalFormat: format, x, y, format, type }, args[6]);
    }
    requireArguments('texSubImage2D', args, 9);
    return core.invoke('texSubImage2D', [toEnum(args[0]), integer(args[1]), integer(args[2]), integer(args[3]), integer(args[4]),
      integer(args[5]), toEnum(args[6]), toEnum(args[7]), pixels(args[8])]);
  };
  method('framebufferTexture2D', 5, args => [toEnum(args[0]), toEnum(args[1]), toEnum(args[2]),
    unwrap(args[3], 'texture'), integer(args[4])]);
  method('copyTexImage2D', 8, args => [toEnum(args[0]), integer(args[1]), toEnum(args[2]),
    ...args.slice(3, 8).map(integer)]);
  method('copyTexSubImage2D', 8, args => [toEnum(args[0]), ...args.slice(1, 8).map(integer)]);
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
  method('clearStencil', 1, args => [integer(args[0])]);
  method('stencilMask', 1, args => [toEnum(args[0])]);
  method('stencilMaskSeparate', 2, args => args.slice(0, 2).map(toEnum));
  method('stencilFunc', 3, args => [toEnum(args[0]), integer(args[1]), toEnum(args[2])]);
  method('stencilFuncSeparate', 4, args => [toEnum(args[0]), toEnum(args[1]), integer(args[2]), toEnum(args[3])]);
  method('stencilOp', 3, args => args.slice(0, 3).map(toEnum));
  method('stencilOpSeparate', 4, args => args.slice(0, 4).map(toEnum));
  method('colorMask', 4, args => args.slice(0, 4).map(Boolean));
  method('scissor', 4, args => args.slice(0, 4).map(integer));
  method('depthRange', 2, args => args.slice(0, 2).map(float));
  method('blendColor', 4, args => args.slice(0, 4).map(float));
  for (const name of ['blendFunc', 'blendEquationSeparate']) method(name, 2, args => args.slice(0, 2).map(toEnum));
  method('blendFuncSeparate', 4, args => args.slice(0, 4).map(toEnum));
  return {
    methods,
    binding: (parameter: number) => wrap(core.invoke('getParameter', [parameter])),
    dispose: () => { wrappers.clear(); domUploads.dispose(); },
  };
}
