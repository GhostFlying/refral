import type { Compiler } from "../src/types.js";
import COMPILER_LIMITS from "../profile-limits.json" with { type: "json" };

export interface CompilerCaseResult {
  name: string;
  passed: boolean;
  log: string;
}

export function runCompilerCorpus(compiler: Compiler): CompilerCaseResult[] {
  const vertexSource = "attribute vec3 position; uniform mat4 matrix; varying vec2 uv; void main() { uv=position.xy; gl_Position=matrix*vec4(position,1.0); }";
  const fragmentSource = "precision mediump float; varying vec2 uv; uniform sampler2D image; uniform vec4 color; void main() { gl_FragColor=texture2D(image,uv)*color; }";
  const vertex = compiler.compile(vertexSource, "vertex");
  const fragment = compiler.compile(fragmentSource, "fragment");
  const linked = compiler.link(vertex, fragment, { position: 3 });
  const broken = compiler.compile("attribute vec4 position; void main() { gl_Position = missing; }", "vertex");
  const mismatch = compiler.compile("precision mediump float; varying vec3 uv; void main() { gl_FragColor=vec4(uv,1.0); }", "fragment");
  const mismatchedProgram = compiler.link(vertex, mismatch);
  const vertex300 = compiler.compile("#version 300 es\nin vec4 position; out vec2 uv; void main(){ uv=position.xy; gl_Position=position; }", "vertex", 2);
  const fragment300 = compiler.compile("#version 300 es\nprecision highp float; in vec2 uv; out vec4 color; void main(){ color=vec4(uv,0.0,1.0); }", "fragment", 2);
  const program300 = compiler.link(vertex300, fragment300);
  const matrix = linked.uniforms.find((uniform) => uniform.name === "matrix");
  const color = linked.uniforms.find((uniform) => uniform.name === "color");
  const twoAttributes = compiler.compile("attribute vec3 first; attribute vec3 second; void main(){gl_Position=vec4(first+second,1.0);}", "vertex");
  const plainFragment = compiler.compile("precision mediump float; void main(){gl_FragColor=vec4(1.0);}", "fragment");
  const overlap = compiler.link(twoAttributes, plainFragment, { first: 2, second: 2 });
  const outsideLimit = compiler.link(twoAttributes, plainFragment, { first: COMPILER_LIMITS.vertexAttributes });
  const lastAttribute = compiler.link(vertex, fragment, { position: COMPILER_LIMITS.vertexAttributes - 1 });
  const tooManyAttributes = Array.from({ length: COMPILER_LIMITS.vertexAttributes + 1 }, (_, index) => `attribute vec4 attr${index};`).join(" ");
  const attributeSum = Array.from({ length: COMPILER_LIMITS.vertexAttributes + 1 }, (_, index) => `attr${index}`).join("+");
  const overAttributeLimit = compiler.compile(`${tooManyAttributes} void main(){gl_Position=${attributeSum};}`, "vertex");
  const overAttributeProgram = compiler.link(overAttributeLimit, plainFragment);
  const prototypeName = compiler.compile("attribute vec4 toString; void main(){gl_Position=toString;}", "vertex");
  const prototypeProgram = compiler.link(prototypeName, plainFragment);
  const arrayVertex = compiler.compile("attribute vec4 position; uniform vec4 colors[2]; void main(){gl_Position=position+colors[1];}", "vertex");
  const arrayProgram = compiler.link(arrayVertex, plainFragment);
  const arrayUniform = arrayProgram.uniforms.find((uniform) => uniform.name === "colors");
  const embeddedNul = compiler.compile("void main(){gl_Position=vec4(1.0);}\0invalid", "vertex");
  const wrongVersion = compiler.compile("#version 300 es\nvoid main(){gl_Position=vec4(1.0);}", "vertex", 1);
  const matrixAttribute = compiler.compile("attribute mat3 transform; attribute vec3 position; void main(){gl_Position=vec4(transform*position,1.0);}", "vertex");
  const matrixProgram = compiler.link(matrixAttribute, plainFragment, { transform: 2 });
  const matrixOverlap = compiler.link(matrixAttribute, plainFragment, { transform: 2, position: 4 });
  const matrixLimit = compiler.link(matrixAttribute, plainFragment, { transform: COMPILER_LIMITS.vertexAttributes - 2 });
  const minimumInteger = compiler.compile('precision highp float; precision highp int; uniform int value; void main(){gl_FragColor=vec4(value == (-2147483647 - 1) ? 1.0 : 0.0);}', 'fragment');
  const cubeFragmentSource = 'precision mediump float; uniform samplerCube cube; void main(){gl_FragColor=textureCube(cube,vec3(1.0,0.0,0.0));}';
  const cubeFragment = compiler.compile(cubeFragmentSource, 'fragment');
  const cubeProgram = compiler.link(vertex, cubeFragment);
  const cubeVertex = compiler.compile('attribute vec3 position; uniform samplerCube cube; void main(){gl_Position=vec4(position,1.0)+textureCube(cube,vec3(1.0,0.0,0.0))*0.01;}', 'vertex');
  const sharedCubeProgram = compiler.link(cubeVertex, cubeFragment);
  const mixedFragment = compiler.compile('precision mediump float; uniform sampler2D planar; uniform samplerCube cube; void main(){gl_FragColor=texture2D(planar,vec2(0.5))+textureCube(cube,vec3(1.0,0.0,0.0));}', 'fragment');
  const mixedProgram = compiler.link(vertex, mixedFragment);
  const cubeArray = compiler.compile('precision mediump float; uniform samplerCube cubes[2]; void main(){gl_FragColor=textureCube(cubes[1],vec3(1.0,0.0,0.0));}', 'fragment');
  const cubeArrayProgram = compiler.link(vertex, cubeArray);
  const singleCubeArray = compiler.compile('precision mediump float; uniform samplerCube cubes[1]; void main(){gl_FragColor=textureCube(cubes[0],vec3(1.0,0.0,0.0));}', 'fragment');
  const singleCubeArrayProgram = compiler.link(vertex, singleCubeArray);
  const unsupportedVolume = compiler.compile('#version 300 es\nprecision highp float; uniform highp sampler3D volume; out vec4 color; void main(){color=texture(volume,vec3(0.5));}', 'fragment', 2);
  const unsupportedVolumeProgram = compiler.link(vertex300, unsupportedVolume);
  const unsupportedIntegerCube = compiler.compile('#version 300 es\nprecision highp float; uniform highp isamplerCube cube; out vec4 color; void main(){color=vec4(texture(cube,vec3(1.0,0.0,0.0)));}', 'fragment', 2);
  const unsupportedIntegerCubeProgram = compiler.link(vertex300, unsupportedIntegerCube);
  const vertexTexture2D = compiler.compile('attribute vec3 position; uniform sampler2D image; void main(){gl_Position=vec4(position,1.0)+texture2D(image,vec2(0.5))*0.01;}', 'vertex');
  const vertexCubeLod = compiler.compile('attribute vec3 position; uniform samplerCube cube; void main(){gl_Position=vec4(position,1.0)+textureCubeLod(cube,vec3(1.0,0.0,0.0),0.75)*0.01;}', 'vertex');
  const fragmentCubeBias = compiler.compile('precision mediump float; uniform samplerCube cube; void main(){gl_FragColor=textureCube(cube,vec3(1.0,0.0,0.0),0.5);}', 'fragment');
  const vertexCubeBias = compiler.compile('attribute vec3 position; uniform samplerCube cube; void main(){gl_Position=vec4(position,1.0)+textureCube(cube,vec3(1.0,0.0,0.0),0.5)*0.01;}', 'vertex');
  const markerNamedFunction = compiler.compile('precision mediump float; vec4 TODO_UNHANDLED_TEXTURE_FUNCTION(){return vec4(0.25,0.5,0.75,1.0);} void main(){gl_FragColor=TODO_UNHANDLED_TEXTURE_FUNCTION();}', 'fragment');
  const markerNamedProgram = compiler.link(vertex, markerNamedFunction);
  return [
    { name: "essl100-vertex", passed: vertex.success, log: vertex.log },
    { name: "essl100-fragment", passed: fragment.success, log: fragment.log },
    { name: "essl100-link", passed: linked.success && !linked.vertexWGSL.includes("@@@@@@") && !linked.fragmentWGSL.includes("@@@@@@"), log: linked.log },
    { name: "attribute-binding", passed: linked.attributes.find((attribute) => attribute.name === "position")?.location === 3, log: linked.log },
    { name: "uniform-layout", passed: matrix?.vertexOffset === 0 && matrix.matrixStride === 16 && color?.fragmentOffset === 0, log: JSON.stringify(linked.uniforms) },
    { name: "sampler-layout", passed: linked.samplers[0]?.samplerBinding === 0 && linked.samplers[0]?.textureBinding === 1, log: JSON.stringify(linked.samplers) },
    { name: "compile-error", passed: !broken.success && broken.log.length > 0, log: broken.log },
    { name: "varying-mismatch", passed: !mismatchedProgram.success && mismatchedProgram.log.includes("uv"), log: mismatchedProgram.log },
    { name: "essl300-vertex", passed: vertex300.success, log: vertex300.log },
    { name: "essl300-fragment", passed: fragment300.success, log: fragment300.log },
    { name: "essl300-link", passed: program300.success, log: program300.log },
    { name: "overlapping-attribute-bindings", passed: !overlap.success, log: overlap.log },
    { name: "attribute-binding-limit", passed: !outsideLimit.success, log: outsideLimit.log },
    { name: "attribute-last-legal-location", passed: lastAttribute.success && lastAttribute.attributes[0]?.location === COMPILER_LIMITS.vertexAttributes - 1, log: lastAttribute.log },
    { name: "attribute-vector-resource-limit", passed: !overAttributeProgram.success && overAttributeProgram.log.length > 0, log: overAttributeProgram.log },
    { name: "prototype-property-attribute-name", passed: prototypeProgram.success, log: prototypeProgram.log },
    { name: "uniform-array-layout", passed: arrayProgram.success && arrayUniform?.size === 2 && arrayUniform.arrayStride === 16, log: JSON.stringify(arrayProgram.uniforms) },
    { name: "embedded-nul-source", passed: !embeddedNul.success && embeddedNul.log.includes("NUL"), log: embeddedNul.log },
    { name: "webgl1-rejects-essl300", passed: !wrongVersion.success && wrongVersion.log.length > 0, log: wrongVersion.log },
    { name: "matrix-attribute-reflection", passed: matrixProgram.success && matrixProgram.attributes.find((attribute) => attribute.name === "transform")?.type === 0x8b5b && matrixProgram.attributes.find((attribute) => attribute.name === "transform")?.location === 2, log: matrixProgram.log },
    { name: "matrix-attribute-column-locations", passed: matrixProgram.success && [2,3,4].every((location) => matrixProgram.vertexWGSL.includes(`@location(${location})`)) && !matrixProgram.vertexWGSL.includes("@@@@@@"), log: matrixProgram.log },
    { name: "matrix-attribute-overlap", passed: !matrixOverlap.success, log: matrixOverlap.log },
    { name: "matrix-attribute-limit", passed: !matrixLimit.success, log: matrixLimit.log },
    { name: 'integer-minimum-literal', passed: minimumInteger.success
      && minimumInteger.wgsl.includes('(-2147483647i - 1i)')
      && !minimumInteger.wgsl.includes('-2147483648i'), log: minimumInteger.log },
    { name: 'scalar-cube-reflection', passed: cubeFragment.success && cubeFragment.uniforms.some(uniform => uniform.name === 'cube' && uniform.type === 0x8b60 && uniform.size === 1), log: cubeFragment.log },
    { name: 'scalar-cube-link', passed: cubeProgram.success && cubeProgram.samplers.length === 1
      && cubeProgram.samplers[0]?.type === 0x8b60 && cubeProgram.samplers[0]?.samplerBinding === 0
      && cubeProgram.samplers[0]?.textureBinding === 1 && cubeProgram.fragmentWGSL.includes('texture_cube<f32>')
      && !cubeProgram.fragmentWGSL.includes('@@@@@@'), log: cubeProgram.log },
    { name: 'shared-cube-stage-binding', passed: sharedCubeProgram.success && sharedCubeProgram.samplers.length === 1
      && sharedCubeProgram.vertexWGSL.includes('@group(1) @binding(1) var ANGLE_texture_cube')
      && sharedCubeProgram.fragmentWGSL.includes('@group(1) @binding(1) var ANGLE_texture_cube'), log: sharedCubeProgram.log },
    { name: 'mixed-2d-cube-binding', passed: mixedProgram.success && mixedProgram.samplers.length === 2
      && mixedProgram.samplers.some(sampler => sampler.type === 0x8b5e)
      && mixedProgram.samplers.some(sampler => sampler.type === 0x8b60)
      && mixedProgram.samplers.every((sampler, index) => sampler.samplerBinding === index * 2 && sampler.textureBinding === index * 2 + 1), log: mixedProgram.log },
    { name: 'cube-sampler-array-diagnostic', passed: cubeArray.success && !cubeArrayProgram.success
      && cubeArrayProgram.log.includes('Sampler cubes'), log: cubeArrayProgram.log },
    { name: 'single-cube-sampler-array-diagnostic', passed: singleCubeArray.success && !singleCubeArrayProgram.success
      && singleCubeArrayProgram.log.includes('sampler array'), log: singleCubeArrayProgram.log },
    { name: 'unsupported-volume-sampler-diagnostic', passed: unsupportedVolume.success && !unsupportedVolumeProgram.success
      && unsupportedVolumeProgram.log.includes('Sampler volume'), log: unsupportedVolumeProgram.log },
    { name: 'unsupported-integer-cube-diagnostic', passed: unsupportedIntegerCube.success && !unsupportedIntegerCubeProgram.success
      && unsupportedIntegerCubeProgram.log.includes('Sampler cube'), log: unsupportedIntegerCubeProgram.log },
    { name: 'vertex-cube-implicit-lod-zero', passed: cubeVertex.success && cubeVertex.wgsl.includes('textureSampleLevel(')
      && cubeVertex.wgsl.includes(', 0.0f)') && !cubeVertex.wgsl.includes('textureSample('), log: cubeVertex.log },
    { name: 'vertex-2d-implicit-lod-zero', passed: vertexTexture2D.success && vertexTexture2D.wgsl.includes('textureSampleLevel(')
      && vertexTexture2D.wgsl.includes(', 0.0f)') && !vertexTexture2D.wgsl.includes('textureSample('), log: vertexTexture2D.log },
    { name: 'vertex-cube-explicit-lod', passed: vertexCubeLod.success && vertexCubeLod.wgsl.includes('textureSampleLevel(')
      && vertexCubeLod.wgsl.split('\n').some(line => line.includes('textureSampleLevel(') && line.includes('0.75f')), log: vertexCubeLod.log },
    { name: 'fragment-cube-implicit-sampling', passed: cubeFragment.success && cubeFragment.wgsl.includes('textureSample(')
      && !cubeFragment.wgsl.includes('textureSampleLevel('), log: cubeFragment.log },
    { name: 'fragment-cube-bias', passed: fragmentCubeBias.success && fragmentCubeBias.wgsl.includes('textureSampleBias(')
      && fragmentCubeBias.wgsl.includes('0.5f'), log: fragmentCubeBias.log },
    { name: 'vertex-cube-bias-diagnostic', passed: !vertexCubeBias.success && vertexCubeBias.log.length > 0, log: vertexCubeBias.log },
    { name: 'user-function-texture-marker-name', passed: markerNamedFunction.success && markerNamedProgram.success
      && markerNamedProgram.fragmentWGSL.includes('_uTODO_UNHANDLED_TEXTURE_FUNCTION'), log: markerNamedProgram.log },
  ];
}
