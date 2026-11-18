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
