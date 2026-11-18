import type {
  CompiledShader, Compiler, LinkedProgram, ProgramSampler, ProgramUniform,
  ShaderStage, ShaderVariable,
} from "./types.js";
import type { CompilerRegistry } from '@refral/core-api';
import profileLimits from "../profile-limits.json" with { type: "json" };

export type * from "./types.js";
export const COMPILER_LIMITS = Object.freeze(profileLimits);

interface AngleModule {
  ccall(name: string, returnType: string, parameterTypes: string[], parameters: unknown[]): string;
}

const samplerTypes = new Set([
  0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5,
  0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2, 0x8dd3, 0x8dd4, 0x8dd7,
]);
const unsupportedTextureOperation = /\bTODO_UNHANDLED_TEXTURE_FUNCTION\s*\(/;

function isSampler(variable: ShaderVariable): boolean {
  return samplerTypes.has(variable.type);
}

function matrixColumns(type: number): number {
  if (type === 0x8b5a) return 2;
  if (type === 0x8b5b) return 3;
  if (type === 0x8b5c) return 4;
  return 1;
}

function active(variables: ShaderVariable[]): ShaderVariable[] {
  return variables.filter((variable) => variable.active && !variable.name.startsWith("gl_"));
}

function sameType(left: ShaderVariable, right: ShaderVariable, matchPrecision = false): boolean {
  return left.type === right.type && left.size === right.size && left.isArray === right.isArray &&
    (!matchPrecision || left.precision === right.precision) && left.structName === right.structName &&
    left.fields.length === right.fields.length && left.fields.every((field, index) => {
      const other = right.fields[index];
      return other !== undefined && field.name === other.name && sameType(field, other, matchPrecision);
    });
}

function containsSampler(variable: ShaderVariable): boolean {
  return isSampler(variable) || variable.fields.some(containsSampler);
}

function numericUniforms(shader: CompiledShader) {
  const variables = active(shader.uniforms).filter(variable => !isSampler(variable) && !variable.fields.length);
  return new Map([...variables, ...(shader.structUniforms ?? [])].map(variable => [variable.name, variable]));
}

function failedProgram(log: string): LinkedProgram {
  return {
    success: false, log, vertexWGSL: "", fragmentWGSL: "",
    vertexEntryPoint: "wgslMain", fragmentEntryPoint: "wgslMain",
    attributes: [], uniforms: [], samplers: [], vertexUniformBufferSize: 0,
    fragmentUniformBufferSize: 0, driverUniformBufferSize: 32,
  };
}

function names(variable: ShaderVariable): string[] {
  return [variable.name, variable.mappedName, `_u${variable.name}`];
}

function setLocation(map: Map<string, number>, variable: ShaderVariable, location: number): void {
  for (const name of names(variable)) map.set(name, location);
}

/** Finalize ANGLE's explicitly documented WGSL link markers. ESSL parsing stays in ANGLE. */
function finalizeWGSL(source: string, locations: Map<string, number>, unwritten?: { inputs: Set<string>; outputs: Set<string> }): string {
  return source.replace(/@location\(@@@@@@\)\s+(\S+)\s*:\s*([^,\n]+),/g, (_match, name: string, type: string) => {
    const location = locations.get(name);
    if (location === undefined) throw new Error(`Unassigned WGSL location for ${name}`);
    if (unwritten?.inputs.has(name)) {
      unwritten.outputs.add(`  @location(${location}) ANGLE_unwritten_${location} : ${type},`);
    }
    return `@location(${location}) ${name} : ${type},`;
  }).replace(/@group\(1\) @binding\(@@@@@@\) var (\S+) :[^;]+;/g,
    (match, name: string) => {
      const location = locations.get(name);
      // ANGLE can emit inactive split sampler declarations. They have no executable references.
      if (location === undefined) return "";
      return match.replace("@@@@@@", String(location));
    });
}

export function linkShaders(vertex: CompiledShader, fragment: CompiledShader,
  attributeLocations: Record<string, number> = {}): LinkedProgram {
  if (!vertex.success || !fragment.success) return failedProgram("Attached shader compilation failed.");
  if (vertex.stage !== "vertex" || fragment.stage !== "fragment") {
    return failedProgram("A vertex shader and a fragment shader are required.");
  }
  if (vertex.version !== fragment.version) return failedProgram("Shader language versions differ.");
  const uniformPackingErrors = [vertex.uniformPackingError, fragment.uniformPackingError].filter(Boolean);
  if (uniformPackingErrors.length) return failedProgram(uniformPackingErrors.join("\n"));
  const vertexVaryings = active(vertex.varyings);
  for (const input of fragment.varyings) {
    if (input.name.startsWith("gl_") || !(input.staticUse ?? input.active)) continue;
    const output = vertex.varyings.find(candidate => candidate.name === input.name);
    if (!output || !sameType(output, input) || (vertex.version === 1 && !!output.invariant !== !!input.invariant)) {
      return failedProgram(`Varying interface mismatch for ${input.name}.`);
    }
    if (input.active && !output.active) vertexVaryings.push(output);
  }
  const invariant = (shader: CompiledShader, name: string) =>
    shader.varyings.some(variable => variable.name === name && variable.invariant);
  if (vertex.version === 1) {
    for (const [input, output] of [["gl_FragCoord", "gl_Position"], ["gl_PointCoord", "gl_PointSize"]] as const) {
      if (invariant(fragment, input) && !invariant(vertex, output)) {
        return failedProgram(`Invariant ${input} requires invariant ${output}.`);
      }
    }
  }
  const allUniforms = new Map<string, ShaderVariable>();
  for (const variable of [...active(vertex.uniforms), ...active(fragment.uniforms)]) {
    const previous = allUniforms.get(variable.name);
    if (previous && !sameType(previous, variable, true)) {
      return failedProgram(`Uniform interface mismatch for ${variable.name}.`);
    }
    if (variable.fields.some(containsSampler)) {
      return failedProgram(`Samplers inside struct uniform ${variable.name} require an unsupported binding layout.`);
    }
    if (isSampler(variable) && (variable.size !== 1 ||
        (variable.type !== 0x8b5e && variable.type !== 0x8b60))) {
      return failedProgram(`Sampler ${variable.name} requires an unsupported type or array layout.`);
    }
    allUniforms.set(variable.name, variable);
  }
  // A one-element sampler array has scalar-sized reflection in the pinned ANGLE API.
  // Reject the backend's explicit unsupported operation marker before final WGSL is exposed.
  if (unsupportedTextureOperation.test(vertex.wgsl) ||
      unsupportedTextureOperation.test(fragment.wgsl)) {
    return failedProgram("ANGLE WGSL backend does not support this texture operation, including sampler array access.");
  }
  const locations = new Map<string, number>();
  const occupied = new Set<number>();
  const attributes: LinkedProgram["attributes"] = [];
  const vertexAttributes = active(vertex.attributes);
  const explicitLocation = (name: string): number | undefined =>
    Object.hasOwn(attributeLocations, name) ? attributeLocations[name] : undefined;
  for (const variable of vertexAttributes) {
    const bound = explicitLocation(variable.name);
    if (bound === undefined) continue;
    const columns = matrixColumns(variable.type);
    if (!Number.isInteger(bound) || bound < 0 || bound + columns > COMPILER_LIMITS.vertexAttributes) {
      return failedProgram(`Invalid or overlapping attribute binding for ${variable.name}.`);
    }
    for (let column = 0; column < columns; column++) {
      if (occupied.has(bound + column)) {
        return failedProgram(`Invalid or overlapping attribute binding for ${variable.name}.`);
      }
      occupied.add(bound + column);
    }
  }
  for (const variable of vertexAttributes) {
    if (variable.size !== 1) {
      return failedProgram(`Attribute array ${variable.name} is outside the initial compiler profile.`);
    }
    const columns = matrixColumns(variable.type);
    let location = explicitLocation(variable.name);
    if (location === undefined) {
      location = 0;
      for (const used of [...occupied].sort((left, right) => left - right)) {
        if (used >= location && used < location + columns) location = used + 1;
      }
    }
    if (location + columns > COMPILER_LIMITS.vertexAttributes) {
      return failedProgram("Attribute count exceeds the initial profile limit.");
    }
    for (let column = 0; column < columns; column++) occupied.add(location + column);
    if (columns === 1) setLocation(locations, variable, location);
    else {
      for (const name of names(variable)) {
        for (let column = 0; column < columns; column++) locations.set(`${name}_col${column}`, location + column);
      }
    }
    attributes.push({ name: variable.name, type: variable.type, size: variable.size, location });
  }
  const fragmentLocations = new Map<string, number>();
  const unwrittenInputs = new Set<string>();
  let varyingLocation = 0;
  for (const varying of vertexVaryings) {
    const columns = matrixColumns(varying.type);
    for (let element = 0; element < varying.size; element++) {
      for (let column = 0; column < columns; column++) {
        const members = varying.isArray ? [`ANGLE_varying__u${varying.name}_${element}_${column}`]
          : names(varying).map(name => columns === 1 ? name : `${name}_col${column}`);
        for (const member of members) {
          locations.set(member, varyingLocation);
          fragmentLocations.set(member, varyingLocation);
          if (!varying.active) unwrittenInputs.add(member);
        }
        varyingLocation++;
      }
    }
  }
  if (varyingLocation > COMPILER_LIMITS.varyingVectors) return failedProgram("Varying count exceeds the initial profile limit.");
  let outputLocation = 0;
  for (const output of active(fragment.outputs)) setLocation(fragmentLocations, output, outputLocation++);
  const uniforms: ProgramUniform[] = [];
  const samplers: ProgramSampler[] = [];
  for (const variable of allUniforms.values()) {
    if (isSampler(variable)) {
      const samplerBinding = samplers.length * 2;
      const textureBinding = samplerBinding + 1;
      samplers.push({ name: variable.name, type: variable.type, size: variable.size, samplerBinding, textureBinding });
      for (const map of [locations, fragmentLocations]) {
        map.set(`ANGLE_sampler_${variable.name}`, samplerBinding);
        map.set(`ANGLE_texture_${variable.name}`, textureBinding);
      }
    }
  }
  const vertexUniforms = numericUniforms(vertex);
  const fragmentUniforms = numericUniforms(fragment);
  for (const [name, variable] of new Map([...vertexUniforms, ...fragmentUniforms])) {
    uniforms.push({ name, type: variable.type, size: variable.size,
      vertexOffset: vertexUniforms.get(name)?.offset ?? null, fragmentOffset: fragmentUniforms.get(name)?.offset ?? null,
      arrayStride: variable.arrayStride, matrixStride: variable.matrixStride });
  }
  // The built-in belongs to driver state, but GLES exposes it in active-uniform reflection.
  const depthRange = [...vertex.uniforms, ...fragment.uniforms]
    .find(variable => variable.active && variable.name === "gl_DepthRange");
  if (depthRange) {
    for (const field of depthRange.fields) {
      uniforms.push({ name: `gl_DepthRange.${field.name}`, type: field.type, size: field.size,
        vertexOffset: null, fragmentOffset: null, arrayStride: 0, matrixStride: 0 });
    }
  }
  if (samplers.length > COMPILER_LIMITS.combinedTextureUnits) {
    return failedProgram("Combined texture count exceeds the initial profile limit.");
  }
  try {
    const additionalOutputs = new Set<string>();
    const fragmentWGSL = finalizeWGSL(fragment.wgsl, fragmentLocations, { inputs: unwrittenInputs, outputs: additionalOutputs });
    let vertexWGSL = finalizeWGSL(vertex.wgsl, locations);
    if (additionalOutputs.size) {
      // ESSL permits an unwritten varying. WGSL requires each fragment input to have
      // a matching output; a newly declared member of ANGLE's local result starts at zero.
      const vertexOutput = /struct ANGLE_Output_Annotated\s*\{/;
      if (!vertexOutput.test(vertexWGSL)) return failedProgram("Missing ANGLE vertex output interface.");
      vertexWGSL = vertexWGSL.replace(/struct (?:ANGLE_Output_Annotated|RefralPointOutput)\s*\{/g,
        header => [header, ...additionalOutputs].join("\n"));
    }
    if (invariant(vertex, "gl_Position")) {
      vertexWGSL = vertexWGSL.replaceAll("@builtin(position) gl_Position_", "@invariant @builtin(position) gl_Position_");
    }
    if (vertexWGSL.includes("@@@@@@") || fragmentWGSL.includes("@@@@@@")) {
      return failedProgram("Unresolved ANGLE WGSL link markers.");
    }
    return { success: true, log: "", vertexWGSL, fragmentWGSL,
      vertexEntryPoint: "wgslMain", fragmentEntryPoint: "wgslMain", attributes, uniforms, samplers,
      vertexUniformBufferSize: vertex.uniformBufferSize,
      fragmentUniformBufferSize: fragment.uniformBufferSize, driverUniformBufferSize: 32 };
  } catch (error) {
    return failedProgram(error instanceof Error ? error.message : String(error));
  }
}

export async function createCompiler(baseURL = "/artifacts/compiler/"): Promise<Compiler> {
  const moduleURL = new URL("compiler.mjs", new URL(baseURL, globalThis.location?.href ?? import.meta.url)).href;
  const imported = await import(/* @vite-ignore */ moduleURL) as {
    default: (options?: Record<string, unknown>) => Promise<AngleModule>;
  };
  const module = await imported.default();
  return {
    compile(source: string, stage: ShaderStage, version: 1 | 2 = 1): CompiledShader {
      const raw: Partial<CompiledShader> = source.includes("\0")
        ? { success: false, log: "Shader source contains an embedded NUL character." }
        : JSON.parse(module.ccall("RefralCompile", "string", ["string", "number", "number"],
          [source, stage === "vertex" ? 0 : 1, version]));
      return { source, stage, version, success: raw.success ?? false, log: raw.log ?? "",
        wgsl: raw.wgsl ?? "", uniformPackingError: raw.uniformPackingError, structUniforms: raw.structUniforms,
        attributes: raw.attributes ?? [], uniforms: raw.uniforms ?? [],
        varyings: raw.varyings ?? [], outputs: raw.outputs ?? [], uniformBufferSize: raw.uniformBufferSize ?? 0 };
    },
    link: linkShaders,
  };
}

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
