import { createJsBufferCore, SemanticContext } from '@refral/core-js';
import type { BufferCoreOptions } from '@refral/core-api';
import type { SemanticHost } from '@refral/core-js';
import type { Compiler } from '@refral/compiler';

export function createJsContractCore(options: BufferCoreOptions) {
  const unexpected = () => { throw new Error('Buffer contract must not render or compile shaders'); };
  const compiler: Compiler = { compile: unexpected, link: unexpected };
  const host: SemanticHost = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: options.maxBufferBytes },
    draw: unexpected, clear: unexpected, flush: unexpected, finish: unexpected, replaceStorage: unexpected,
    retireStorage: unexpected, retireDepth: unexpected,
  };
  const context = new SemanticContext({ width: 8, height: 8 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return createJsBufferCore(context, options);
}
