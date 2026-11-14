import type {
  Compiler, CompilerRegistry, CompiledShader, LinkedProgram, ShaderStage,
} from '@refral/core-api';

/** Keeps compiler implementation objects outside either semantic core. */
export function createCompilerRegistry(compiler: Compiler): CompilerRegistry {
  let nextId = 1;
  const shaders = new Map<number, CompiledShader>();
  const programs = new Map<number, LinkedProgram>();
  let disposed = false;

  function allocate(): number {
    if (disposed) throw new Error('Compiler registry is disposed.');
    if (nextId > 0xffff_ffff) throw new RangeError('Compiler artifact identifiers exhausted.');
    return nextId++;
  }

  return {
    compile(source: string, stage: ShaderStage) {
      const artifactId = allocate();
      const result = compiler.compile(source, stage, 1);
      shaders.set(artifactId, result);
      return { artifactId, result };
    },
    link(vertexId, fragmentId, attributeLocations) {
      const vertex = shaders.get(vertexId);
      const fragment = shaders.get(fragmentId);
      if (!vertex || !fragment) throw new Error('Compiler link refers to a retired shader artifact.');
      const artifactId = allocate();
      const result = compiler.link(vertex, fragment, Object.fromEntries(attributeLocations));
      programs.set(artifactId, result);
      return { artifactId, result };
    },
    executable(id) {
      const result = programs.get(id);
      if (!result) throw new Error('Draw refers to a retired program artifact.');
      return result;
    },
    release(ids) {
      for (const id of ids) {
        shaders.delete(id);
        programs.delete(id);
      }
    },
    dispose() {
      disposed = true;
      shaders.clear();
      programs.clear();
    },
  };
}
