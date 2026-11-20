import expressionShaders from "./expression-shaders.json" with { type: "json" };
import type { Compiler } from "../src/types.js";
import COMPILER_LIMITS from "../profile-limits.json" with { type: "json" };
import essl100Shader from "./essl100-shader.json" with { type: "json" };
import vertexCapacityShaders from "./vertex-capacity-shaders.json" with { type: "json" };
import stageInterfaceShaders from "./stage-interface-shaders.json" with { type: "json" };
import structUniformShaders from "./struct-uniform-shaders.json" with { type: "json" };
import varyingArrayShaders from "./varying-array-shaders.json" with { type: "json" };
import fragmentOutputShaders from "./fragment-output-shaders.json" with { type: "json" };

export interface CompilerCaseResult {
  name: string;
  passed: boolean;
  log: string;
}

function uniformPackingCases(compiler: Compiler): CompilerCaseResult[] {
  const vertexRows = COMPILER_LIMITS.vertexUniformVectors;
  const fragmentRows = COMPILER_LIMITS.fragmentUniformVectors;
  const cases = [
    { name: "vertex-array-boundary", stage: "vertex", uniforms: `uniform vec4 v[${vertexRows}];`,
      expression: "v[0]", fits: true },
    { name: "vertex-array-overflow-at-first-element", stage: "vertex", uniforms: `uniform bool v[${vertexRows + 1}];`,
      expression: "vec4(v[0])", fits: false },
    { name: "fragment-matrix-overflow", stage: "fragment", uniforms: `uniform mat2 v[${Math.floor(fragmentRows / 2) + 1}];`,
      expression: "vec4(v[0][0],0.0,1.0)", fits: false },
    { name: "shared-columns", stage: "fragment", uniforms: `uniform vec2 a[${fragmentRows}], b[${fragmentRows}];`,
      expression: "vec4(a[0],b[0])", fits: true },
    { name: "inactive-declaration", stage: "vertex", uniforms: `uniform vec4 unused[${vertexRows + 1}];`,
      expression: "vec4(1.0)", fits: true },
    { name: "separate-sampler-budget", stage: "fragment",
      uniforms: `uniform vec4 v[${fragmentRows}]; uniform sampler2D image;`,
      expression: "v[0]+texture2D(image,vec2(0.0))", fits: true },
    { name: "active-built-in", stage: "fragment", uniforms: `uniform vec4 v[${fragmentRows}];`,
      expression: "v[0]+vec4(gl_DepthRange.near)", fits: false },
    { name: "struct-array-fields", stage: "vertex",
      uniforms: `struct S { vec4 values[2]; }; uniform S records[${Math.floor(vertexRows / 2) + 1}];`,
      expression: "records[0].values[0]", fits: false },
  ] as const;
  const vertex = compiler.compile("void main(){gl_Position=vec4(1.0);}", "vertex");
  const fragment = compiler.compile("precision mediump float; void main(){gl_FragColor=vec4(1.0);}", "fragment");
  return cases.map(({ name, stage, uniforms, expression, fits }) => {
    const output = stage === "vertex" ? "gl_Position" : "gl_FragColor";
    const shader = compiler.compile(`precision mediump float; ${uniforms} void main(){${output}=${expression};}`, stage);
    const linked = stage === "vertex" ? compiler.link(shader, fragment) : compiler.link(vertex, shader);
    const limit = stage === "vertex" ? "MAX_VERTEX_UNIFORM_VECTORS" : "MAX_FRAGMENT_UNIFORM_VECTORS";
    return { name: `uniform-packing-${name}`, passed: shader.success && linked.success === fits &&
      (fits || linked.log.includes(limit)), log: [shader.log, linked.log].filter(Boolean).join("\n") };
  });
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
  const underscoreVertex = compiler.compile('attribute vec4 foo__bar; attribute vec4 foo_bar; void main(){gl_Position=foo__bar + foo_bar;}', 'vertex');
  const underscoreFragment = compiler.compile('precision mediump float; uniform vec4 __color; void main(){gl_FragColor=__color;}', 'fragment');
  const underscores = compiler.link(underscoreVertex, underscoreFragment, { foo__bar: 1, foo_bar: 2 });
  const invalidFragmentAttribute = compiler.compile('attribute vec4 foo__bar; void main(){gl_FragColor=foo__bar;}', 'fragment');
  const arrayVertex = compiler.compile("attribute vec4 position; uniform vec4 colors[2]; void main(){gl_Position=position+colors[1];}", "vertex");
  const arrayProgram = compiler.link(arrayVertex, plainFragment);
  const arrayUniform = arrayProgram.uniforms.find((uniform) => uniform.name === "colors");
  const embeddedNul = compiler.compile("void main(){gl_Position=vec4(1.0);}\0invalid", "vertex");
  const wrongVersion = compiler.compile("#version 300 es\nvoid main(){gl_Position=vec4(1.0);}", "vertex", 1);
  const matrixAttribute = compiler.compile("attribute mat3 transform; attribute vec3 position; void main(){gl_Position=vec4(transform*position,1.0);}", "vertex");
  const matrixProgram = compiler.link(matrixAttribute, plainFragment, { transform: 2 });
  const matrixOverlap = compiler.link(matrixAttribute, plainFragment, { transform: 2, position: 4 });
  const matrixLimit = compiler.link(matrixAttribute, plainFragment, { transform: COMPILER_LIMITS.vertexAttributes - 2 });
  const lowering = compiler.link(compiler.compile(essl100Shader.vertex, "vertex"),
    compiler.compile(essl100Shader.fragment, "fragment"));
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
  const indexedLodSource = `#extension GL_EXT_shader_texture_lod : require
    precision mediump float;
    uniform sampler2D textures[2];
    void main() {
      vec4 color = vec4(0.0);
      for (int i = 0; i < 2; ++i) {
        color += texture2DGradEXT(textures[i], vec2(0.5), vec2(0.01), vec2(0.01));
        color += texture2DLodEXT(textures[i], vec2(0.5), 0.0);
      }
      gl_FragColor = color;
    }`;
  const disabledLod = compiler.compile(indexedLodSource, "fragment");
  const indexedLod = compiler.compile(indexedLodSource, "fragment", 1, 4);
  const indexedLodProgram = compiler.link(vertex, indexedLod);
  const { simpleTextureVertexShader, simpleCubeMapTextureFragmentShader,
    fragDataReadFragmentShader } = fragmentOutputShaders;
  const ctsCubeVertex = compiler.compile(simpleTextureVertexShader, "vertex");
  const ctsCubeFragment = compiler.compile(simpleCubeMapTextureFragmentShader, "fragment");
  const ctsCubeProgram = compiler.link(ctsCubeVertex, ctsCubeFragment);
  const fragDataRead = compiler.compile(fragDataReadFragmentShader, "fragment");
  const fragDataReadProgram = compiler.link(ctsCubeVertex, fragDataRead);
  const fragDataOutsideLimit = compiler.compile("precision mediump float; void main(){gl_FragData[1]=vec4(1.0);}", "fragment");
  const mixedFragColorData = compiler.compile("precision mediump float; void main(){gl_FragColor=vec4(1.0);gl_FragData[0]=vec4(1.0);}", "fragment");
  const varyingArrays = compiler.compile(varyingArrayShaders.vertex, "vertex");
  const varyingInputs = compiler.compile(varyingArrayShaders.fragment, "fragment");
  const arrayInterface = compiler.link(varyingArrays, varyingInputs);
  const scalarInstead = compiler.compile(varyingArrayShaders.fragment
    .replace("float gain[1]", "float gain").replace("gain[0]", "gain"), "fragment");
  const extentMismatch = compiler.compile(varyingArrayShaders.fragment
    .replace("vec2 offsets[2]", "vec2 offsets[3]"), "fragment");
  const mismatchedShape = compiler.link(varyingArrays, scalarInstead);
  const mismatchedExtent = compiler.link(varyingArrays, extentMismatch);
  const tooManyElements = compiler.compile(`varying mat2 basis[${Math.floor(COMPILER_LIMITS.varyingVectors / 2) + 1}];
    void main() { basis[0]=mat2(1.0); gl_Position=vec4(1.0); }`, "vertex");
  const fields = (source: string) => new Map([...source.matchAll(
    /@location\((\d+)\) (ANGLE_varying_\w+) :/g)].map(match => [match[2], match[1]]));
  const vertexFields = fields(arrayInterface.vertexWGSL);
  const fragmentFields = fields(arrayInterface.fragmentWGSL);
  const structVertex = compiler.compile(structUniformShaders.vertex, "vertex");
  const structFragment = compiler.compile(structUniformShaders.fragment, "fragment");
  const structProgram = compiler.link(structVertex, structFragment);
  const structMatrix = structProgram.uniforms.find(uniform => uniform.name === "records[1].m");
  const structColors = structProgram.uniforms.find(uniform => uniform.name === "records[1].colors");
  const mismatchedStruct = compiler.compile(structUniformShaders.fragment
    .replace("struct S", "struct Other").replace("uniform S", "uniform Other"), "fragment");
  const mismatchedPrecision = compiler.compile(structUniformShaders.fragment
    .replace("float gain", "highp float gain"), "fragment");
  const sampleStage = (count: number, stage: "vertex" | "fragment") => {
    const output = stage === "vertex" ? "gl_Position" : "gl_FragColor";
    return compiler.compile(`precision mediump float; uniform sampler2D samples[${count}];
      void main(){ vec4 sum=vec4(0); for(int i=0;i<${count};++i) sum+=texture2D(samples[i],vec2(.5)); ${output}=sum; }`, stage);
  };
  const limit = COMPILER_LIMITS.combinedTextureUnits;
  const boundary = compiler.link(vertex, sampleStage(limit, "fragment"));
  const overBudget = compiler.link(sampleStage(limit, "vertex"), sampleStage(limit, "fragment"));
  const nested = compiler.compile("precision mediump float; struct A{sampler2D a[2];}; struct B{A inner[2];}; uniform B obj[2]; void main(){gl_FragColor=texture2D(obj[1].inner[0].a[1],vec2(0));}", "fragment");
  const forwarded = compiler.compile("precision mediump float; uniform sampler2D s[2]; vec4 lookup(sampler2D img){return texture2D(img, vec2(.5));} void main(){vec4 color=vec4(0);for(int i=0;i<2;++i) color+=lookup(s[i]); gl_FragColor=color;}", "fragment");
  const forwardedProgram = compiler.link(vertex, forwarded);
  const nestedProgram = compiler.link(vertex, nested);
  const opaqueStruct = compiler.compile("precision mediump float; struct S { sampler2D image; vec4 color; }; uniform S s; void main(){gl_FragColor=s.color+texture2D(s.image,vec2(0.0));}", "fragment");
  const opaqueStructProgram = compiler.link(vertex, opaqueStruct);
  const fullVertexRows = compiler.compile(vertexCapacityShaders.vertex
    .replace("PROFILE_ROWS", String(COMPILER_LIMITS.vertexUniformVectors)), "vertex");
  const fullVertexProgram = compiler.link(fullVertexRows, compiler.compile(vertexCapacityShaders.fragment, "fragment"));
  const declaredVertex = compiler.compile(stageInterfaceShaders.vertex, "vertex");
  const readVarying = compiler.compile(stageInterfaceShaders.fragment, "fragment");
  const declaredProgram = compiler.link(declaredVertex, readVarying);
  const missingOutput = compiler.link(compiler.compile("void main(){gl_Position=vec4(0.);}", "vertex"), readVarying);
  const unreachableInput = compiler.compile("precision mediump float; varying float unwritten; void main(){if(false){gl_FragColor=vec4(unwritten);}else{gl_FragColor=vec4(1.);}}", "fragment");
  const staticMismatch = compiler.link(declaredVertex, unreachableInput);
  const invariantInput = compiler.compile(stageInterfaceShaders.fragment.replace("varying mediump", "invariant varying mediump"), "fragment");
  const invariantMismatch = compiler.link(declaredVertex, invariantInput);
  return [
    ...uniformPackingCases(compiler),
    { name: "extension-lod-and-gradient-on-indexed-samplers",
      passed: !disabledLod.success && disabledLod.log.includes("extension is not supported") &&
        indexedLod.success && indexedLodProgram.success &&
        indexedLodProgram.fragmentWGSL.includes("textureSampleLevel(") &&
        indexedLodProgram.fragmentWGSL.includes("textureSampleGrad("),
      log: [indexedLod.log, indexedLodProgram.log].filter(Boolean).join("\n") },
    { name: "unwritten-varying-matrix-array-pipeline", passed: declaredProgram.success && [0, 1, 2, 3].every(location =>
      declaredProgram.vertexWGSL.includes(`@location(${location}) ANGLE_unwritten_${location} : vec2<f32>`)) &&
      declaredProgram.vertexWGSL.includes("@invariant @builtin(position) gl_Position_"), log: declaredProgram.log },
    { name: "varying-static-use-and-declaration-matching", passed: unreachableInput.success && !missingOutput.success &&
      !staticMismatch.success && staticMismatch.log.includes("unwritten"), log: [missingOutput.log, staticMismatch.log].join("\n") },
    { name: "varying-invariance-mismatch", passed: invariantInput.success && !invariantMismatch.success &&
      invariantMismatch.log.includes("unwritten"), log: invariantMismatch.log },
    { name: "vertex-uniform-full-rows-physical-layout", passed: fullVertexProgram.success &&
      fullVertexProgram.uniforms.length === 4 && fullVertexProgram.uniforms.every(uniform =>
        uniform.size === COMPILER_LIMITS.vertexUniformVectors && uniform.arrayStride === 16) &&
      fullVertexProgram.vertexUniformBufferSize === COMPILER_LIMITS.vertexUniformVectors * 4 * 16,
      log: fullVertexProgram.log },
    { name: "struct-array-uniform-stage-layouts", passed: structProgram.success && structProgram.uniforms.length === 7 &&
      [structProgram.vertexWGSL, structProgram.fragmentWGSL].every(source => source.includes("struct ANGLE_wrapped_vec2")) &&
      structProgram.vertexUniformBufferSize === 224 && structProgram.fragmentUniformBufferSize === 160 &&
      structMatrix?.type === 0x8b5a && structMatrix.vertexOffset === 160 && structMatrix.fragmentOffset === 96 &&
      structMatrix.matrixStride === 16 && structColors?.size === 2 && structColors.arrayStride === 16 &&
      structColors.vertexOffset === 192 && structColors.fragmentOffset === 128, log: JSON.stringify(structProgram.uniforms) },
    { name: "uniform-struct-type-and-field-precision", passed: mismatchedStruct.success && mismatchedPrecision.success &&
      !compiler.link(structVertex, mismatchedStruct).success && !compiler.link(structVertex, mismatchedPrecision).success,
      log: [mismatchedStruct.log, mismatchedPrecision.log].join("\n") },
    ...Object.entries(expressionShaders.expressionFragments).map(([name, source]) => {
      const stage = compiler.compile(source, "fragment");
      const program = compiler.link(compiler.compile(expressionShaders.expressionVertex, "vertex"), stage);
      return { name, passed: program.success, log: [stage.log, program.log].filter(Boolean).join("\n") };
    }),
    { name: "indexed-sampler-stage-budget", passed: boundary.success && boundary.samplers[0]?.size === limit &&
      boundary.fragmentWGSL.includes("switch index") && !overBudget.success && overBudget.log.includes("Combined texture count"),
      log: [boundary.log, overBudget.log].join(" ") },
    { name: "sampler-parameter-preserves-dynamic-element", passed: forwardedProgram.success &&
      forwardedProgram.fragmentWGSL.includes("switch index") && !forwardedProgram.fragmentWGSL.includes(" : )"),
      log: forwardedProgram.log },
    { name: "nested-sampler-array-bindings", passed: nestedProgram.success &&
      nestedProgram.samplers.map(s => s.name).join(" ") === "obj[0].inner[0].a[0] obj[0].inner[1].a[0] obj[1].inner[0].a[0] obj[1].inner[1].a[0]" &&
      nestedProgram.samplers[2]?.textureBinding === 9 &&
      nestedProgram.fragmentWGSL.includes("@binding(11) var ANGLE_texture_gl_RefralElement5_"),
      log: nestedProgram.log },
    { name: "uniform-struct-sampler-and-color", passed: opaqueStruct.success && opaqueStructProgram.success &&
      opaqueStructProgram.samplers[0]?.name === "s.image" && opaqueStructProgram.uniforms.find(u => u.name === "s.color")?.fragmentOffset === 0, log: opaqueStructProgram.log },
    { name: "varying-arrays-matching-stage-locations", passed: arrayInterface.success &&
      vertexFields.size === 7 && fragmentFields.size === 7 && new Set(vertexFields.values()).size === 7 &&
      [...vertexFields].every(([name, location]) => fragmentFields.get(name) === location),
      log: arrayInterface.log },
    { name: "varying-matrix-array-column-transfer", passed: arrayInterface.success &&
      [0, 1].every(element => [0, 1].every(column => {
        const field = `ANGLE_varying__ubasis_${element}_${column}`;
        const member = `_ubasis[${element}][${column}]`;
        return arrayInterface.vertexWGSL.includes(`ANGLE_output_annotated.${field} = ANGLE_output_global.${member};`) &&
          arrayInterface.fragmentWGSL.includes(`ANGLE_input_global.${member} = ANGLE_input_annotated.${field};`);
      })), log: arrayInterface.log },
    { name: "varying-array-scalar-and-extent-mismatch", passed: scalarInstead.success && extentMismatch.success &&
      !mismatchedShape.success && mismatchedShape.log.includes("gain") &&
      !mismatchedExtent.success && mismatchedExtent.log.includes("offsets"),
      log: [mismatchedShape.log, mismatchedExtent.log].join("\n") },
    { name: "varying-array-declared-extent-limit", passed: !tooManyElements.success &&
      tooManyElements.log.includes("MAX_VARYING_VECTORS"), log: tooManyElements.log },
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
    { name: "essl100-expression-lowering", passed: lowering.success
      && !lowering.fragmentWGSL.includes("TODO_Operator")
      && !lowering.fragmentWGSL.includes("TODO_operator")
      && !lowering.fragmentWGSL.includes("gl_DepthRange_")
      && lowering.uniforms.some(uniform => uniform.name === "gl_DepthRange.near"
        && uniform.vertexOffset === null && uniform.fragmentOffset === null), log: lowering.log },
    { name: 'webgl1-double-underscore-identity', passed: underscores.success
      && underscores.attributes.some(attribute => attribute.name === 'foo__bar' && attribute.location === 1)
      && underscores.attributes.some(attribute => attribute.name === 'foo_bar' && attribute.location === 2)
      && underscores.uniforms.some(uniform => uniform.name === '__color'), log: underscores.log },
    { name: 'fragment-stage-attribute-is-illegal', passed: !invalidFragmentAttribute.success, log: invalidFragmentAttribute.log },
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
    { name: 'cube-sampler-array-layout', passed: cubeArrayProgram.success && cubeArrayProgram.samplers[0]?.name === 'cubes[0]'
      && cubeArrayProgram.samplers[0].size === 2 && cubeArrayProgram.fragmentWGSL.includes('@binding(3) var ANGLE_texture_gl_RefralElement1_cubes'),
      log: cubeArrayProgram.log },
    { name: 'size-one-sampler-array-identity', passed: singleCubeArrayProgram.success &&
      singleCubeArrayProgram.samplers[0]?.name === 'cubes[0]' && singleCubeArrayProgram.samplers[0].size === 1,
      log: singleCubeArrayProgram.log },
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
    { name: "frag-data-original-cts-compile", passed: ctsCubeVertex.success && ctsCubeFragment.success,
      log: [ctsCubeVertex.log, ctsCubeFragment.log].join("\n") },
    { name: "frag-data-original-cts-link", passed: ctsCubeProgram.success
      && ctsCubeProgram.samplers[0]?.name === "tex" && ctsCubeProgram.samplers[0]?.type === 0x8b60
      && ctsCubeProgram.uniforms.some(uniform => uniform.name === "face" && uniform.type === 0x1404)
      && !ctsCubeProgram.fragmentWGSL.includes("@@@@@@"), log: ctsCubeProgram.log },
    { name: "frag-data-private-array-and-scalar-output", passed: ctsCubeFragment.success
      && ctsCubeFragment.outputs.some(output => output.name === "gl_FragData" && output.type === 0x8b52 && output.size === 1)
      && ctsCubeFragment.wgsl.includes("gl_FragData_ : array<vec4<f32>, 1>")
      && ctsCubeFragment.wgsl.includes("@location(0) gl_FragData_0 : vec4<f32>")
      && ctsCubeFragment.wgsl.includes("ANGLE_output_annotated.gl_FragData_0 = ANGLE_output_global.gl_FragData_[0];"),
      log: ctsCubeFragment.log },
    { name: "frag-data-read-and-early-return", passed: fragDataRead.success && fragDataReadProgram.success
      && fragDataReadProgram.fragmentWGSL.includes("ANGLE_output_global.gl_FragData_")
      && fragDataReadProgram.fragmentWGSL.includes("return;"), log: fragDataReadProgram.log },
    { name: "frag-data-output-index-limit", passed: !fragDataOutsideLimit.success && fragDataOutsideLimit.log.length > 0,
      log: fragDataOutsideLimit.log },
    { name: "frag-data-frag-color-exclusivity", passed: !mixedFragColorData.success && mixedFragColorData.log.length > 0,
      log: mixedFragColorData.log },
  ];
}
