import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import essl100Shader from "../../packages/compiler/test/essl100-shader.json" with { type: "json" };
import compilerLimits from "../../packages/compiler/profile-limits.json" with { type: "json" };
import vertexCapacityShaders from "../../packages/compiler/test/vertex-capacity-shaders.json" with { type: "json" };
import stageInterfaceShaders from "../../packages/compiler/test/stage-interface-shaders.json" with { type: "json" };
import structUniformShaders from "../../packages/compiler/test/struct-uniform-shaders.json" with { type: "json" };
import varyingArrayShaders from "../../packages/compiler/test/varying-array-shaders.json" with { type: "json" };
import { createHash } from "node:crypto";

test("ANGLE Wasm compiles ESSL corpus and WebGPU accepts linked WGSL", async ({ page }) => {
  // Keep Vite's URL helper available while disabling source-change navigation in this test.
  await page.route("**/@vite/client", (route) => route.fulfill({
    contentType: "text/javascript", body: "export const injectQuery = (url) => url;",
  }));
  await page.goto("/packages/compiler/test/browser.html");
  const result = await page.evaluate(async ({ essl100Shader, stageInterfaceShaders, structUniformShaders, varyingArrayShaders }) => {
    const compilerURL = "/packages/compiler/src/index.ts";
    const corpusURL = "/packages/compiler/test/corpus.ts";
    const { createCompiler } = await import(compilerURL) as typeof import("../../packages/compiler/src/index.js");
    const { runCompilerCorpus } = await import(corpusURL) as typeof import("../../packages/compiler/test/corpus.js");
    const started = performance.now();
    const compiler = await createCompiler();
    const initializationMs = performance.now() - started;
    const corpus = runCompilerCorpus(compiler);
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Chrome did not provide a WebGPU adapter.");
    const device = await adapter.requestDevice();
    const pairs = [
      { version: 1 as const, matrix: false, ...essl100Shader },
      { version: 1 as const, matrix: false, ...varyingArrayShaders },
      { version: 1 as const, matrix: false, positionName: 'foo__bar',
        vertex: 'attribute vec4 foo__bar; void main(){gl_Position=foo__bar;}',
        fragment: 'precision mediump float; uniform vec4 __color; void main(){gl_FragColor=__color;}' },
      { version: 1 as const, matrix: false, ...structUniformShaders },
      { version: 1 as const, matrix: false, ...stageInterfaceShaders },
      {
        version: 1 as const,
        matrix: false,
        vertex: 'attribute vec3 position; void main(){gl_Position=vec4(position,1.0);}',
        fragment: 'precision highp float; precision highp int; uniform int value; void main(){gl_FragColor=vec4(value == (-2147483647 - 1) ? 1.0 : 0.0);}',
      },
      {
        version: 1 as const,
        matrix: false,
        vertex: "attribute vec3 position; uniform mat4 matrix; varying vec2 uv; void main(){ uv=position.xy; gl_Position=matrix*vec4(position,1.0); }",
        fragment: "precision mediump float; varying vec2 uv; uniform sampler2D image; uniform vec4 color; void main(){ gl_FragColor=texture2D(image,uv)*color; }",
      },
      {
        version: 2 as const,
        matrix: false,
        vertex: "#version 300 es\nin vec3 position; out vec2 uv; void main(){uv=position.xy;gl_Position=vec4(position,1.0);}",
        fragment: "#version 300 es\nprecision highp float; in vec2 uv; out vec4 color; void main(){color=vec4(uv,0.0,1.0);}",
      },
      {
        version: 1 as const,
        matrix: true,
        vertex: "attribute mat3 transform; attribute vec3 position; void main(){gl_Position=vec4(transform*position,1.0);}",
        fragment: "precision mediump float; void main(){gl_FragColor=vec4(1.0);}",
      },
    ];
    const validation: Array<{ version: number; matrix: boolean; messages: Array<{ type: string; message: string }>; pipeline: boolean }> = [];
    for (const pair of pairs) {
      const bindings: Record<string, number> = pair.matrix ? { transform: 2, position: 0 } : { [pair.positionName ?? 'position']: 3 };
      const linked = compiler.link(compiler.compile(pair.vertex, "vertex", pair.version),
        compiler.compile(pair.fragment, "fragment", pair.version), bindings);
      if (!linked.success) throw new Error(linked.log);
      const vertexModule = device.createShaderModule({ code: linked.vertexWGSL });
      const fragmentModule = device.createShaderModule({ code: linked.fragmentWGSL });
      const vertexInfo = await vertexModule.getCompilationInfo();
      const fragmentInfo = await fragmentModule.getCompilationInfo();
      const messages = [...vertexInfo.messages, ...fragmentInfo.messages]
        .map(({ type, message }) => ({ type, message }));
      await device.createRenderPipelineAsync({ layout: "auto",
        vertex: { module: vertexModule, entryPoint: linked.vertexEntryPoint,
          buffers: pair.matrix ? [{ arrayStride: 48, attributes: [
            { shaderLocation: 2, offset: 0, format: "float32x3" },
            { shaderLocation: 3, offset: 12, format: "float32x3" },
            { shaderLocation: 4, offset: 24, format: "float32x3" },
            { shaderLocation: 0, offset: 36, format: "float32x3" },
          ] }] : [{ arrayStride: 12, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x3" }] }] },
        fragment: { module: fragmentModule, entryPoint: linked.fragmentEntryPoint,
          targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
      });
      validation.push({ version: pair.version, matrix: pair.matrix, messages, pipeline: true });
    }
    const info = adapter.info;
    device.destroy();
    return { initializationMs, corpus, validation,
      adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device,
        description: info.description, isFallbackAdapter: info.isFallbackAdapter } };
  }, { essl100Shader, stageInterfaceShaders, structUniformShaders, varyingArrayShaders });
  await mkdir("artifacts/compiler", { recursive: true });
  await writeFile("artifacts/compiler/chrome-corpus.json", JSON.stringify(result, null, 2) + "\n");
  expect(result.corpus.filter((item) => !item.passed)).toEqual([]);
  for (const stage of result.validation) {
    expect(stage.messages.filter((message) => message.type === "error")).toEqual([]);
    expect(stage.pipeline).toBe(true);
  }
});

test("ANGLE scalar cube samplers preserve six faces and per-face texel orientation", async ({ page, browser }) => {
  await page.route("**/@vite/client", (route) => route.fulfill({
    contentType: "text/javascript", body: "export const injectQuery = (url) => url;",
  }));
  await page.goto("/packages/compiler/test/browser.html");
  const result = await page.evaluate(async () => {
    const compilerURL = "/packages/compiler/src/index.ts";
    const fixtureURL = "/packages/compiler/test/cubemap.ts";
    const { createCompiler } = await import(compilerURL) as typeof import("../../packages/compiler/src/index.js");
    const { runCubeSamplerVerification } = await import(fixtureURL) as typeof import("../../packages/compiler/test/cubemap.js");
    return runCubeSamplerVerification(await createCompiler());
  });
  const evidence = {
    recordedAt: new Date().toISOString(), browser: browser.version(),
    launchMode: process.env.REFRAL_HEADLESS === "0" ? "headed" : "headless",
    scope: "Direct ANGLE compiler and WebGPU sampling spike with a native WebGL reference",
    compilerDependencies: JSON.parse(await readFile("packages/compiler/dependencies.json", "utf8")),
    compilerWasmSha256: createHash("sha256").update(await readFile("artifacts/compiler/compiler.wasm")).digest("hex"),
    ...result,
  };
  await mkdir("artifacts/cubemap/pr1", { recursive: true });
  await writeFile("artifacts/cubemap/pr1/compiler-gpu.json", JSON.stringify(evidence, null, 2) + "\n");
  expect(evidence.launchMode).toBe("headless");
  expect(result.faceOrder.map(face => face.target)).toEqual([0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a]);
  expect(result.results.map(sample => [sample.id, sample.probes.length])).toEqual([
    ["six-axis-directions", 6], ["six-face-texel-orientation", 24],
    ["vertex-implicit-cube-level-zero", 1], ["vertex-implicit-2d-level-zero", 1],
  ]);
  expect(result.validationErrors).toEqual([]);
  for (const sample of result.results) {
    expect(sample.nativeError, sample.id).toBe(0);
    expect(sample.pipeline, sample.id).toBe(true);
    expect(sample.compilation.filter(message => message.type === "error"), sample.id).toEqual([]);
    expect(sample.reflection.samplers).toEqual([{
      name: "image", type: sample.kind === "cube" ? 0x8b60 : 0x8b5e,
      size: 1, samplerBinding: 0, textureBinding: 1,
    }]);
    expect(sample.sources.vertexWGSL).not.toContain("@@@@@@");
    expect(sample.sources.fragmentWGSL).not.toContain("@@@@@@");
    for (const probe of sample.probes) {
      expect(probe.native, `${sample.id} native ${probe.id}`).toEqual(probe.expected);
      expect(probe.webgpu, `${sample.id} WebGPU ${probe.id}`).toEqual(probe.expected);
    }
  }
});

test("ANGLE preserves original CTS gl_FragData array outputs and main return semantics", async ({ page, browser }) => {
  const shaders = JSON.parse(await readFile("packages/compiler/test/fragment-output-shaders.json", "utf8")) as Record<string, string>;
  const originalShaderSha256 = Object.fromEntries(["simpleTextureVertexShader", "simpleCubeMapTextureFragmentShader"]
    .map(name => [name, createHash("sha256").update(shaders[name]!).digest("hex")]));
  expect(originalShaderSha256).toEqual({
    simpleTextureVertexShader: "9706fa0607f5852f9f737f7559ce81e164900c364aca7f8dd30ec37533411cec",
    simpleCubeMapTextureFragmentShader: "58ed004072642d45799c6c2ec6fcaa2dc76f64c69d386c48702fcc066e8ea124",
  });
  await page.route("**/@vite/client", route => route.fulfill({
    contentType: "text/javascript", body: "export const injectQuery = (url) => url;",
  }));
  await page.goto("/packages/compiler/test/browser.html");
  const result = await page.evaluate(async () => {
    const compilerURL = "/packages/compiler/src/index.ts";
    const fixtureURL = "/packages/compiler/test/fragment-output.ts";
    const { createCompiler } = await import(compilerURL) as typeof import("../../packages/compiler/src/index.js");
    const { runFragmentOutputVerification } = await import(fixtureURL) as typeof import("../../packages/compiler/test/fragment-output.js");
    return runFragmentOutputVerification(await createCompiler());
  });
  const evidence = { recordedAt: new Date().toISOString(), browser: browser.version(),
    launchMode: process.env.REFRAL_HEADLESS === "0" ? "headed" : "headless",
    compilerDependencies: JSON.parse(await readFile("packages/compiler/dependencies.json", "utf8")),
    compilerWasmSha256: createHash("sha256").update(await readFile("artifacts/compiler/compiler.wasm")).digest("hex"),
    originalShaderSha256, ...result };
  await mkdir("artifacts/cubemap/pr2", { recursive: true });
  await writeFile("artifacts/cubemap/pr2/compiler-frag-data-gpu.json", JSON.stringify(evidence, null, 2) + "\n");
  expect(evidence.launchMode).toBe("headless");
  expect(result.results.map(sample => [sample.id, sample.samples.length])).toEqual([
    ["original-cts-cubemap-frag-data", 6], ["frag-data-array-read-early-return", 1],
  ]);
  expect(result.validationErrors).toEqual([]);
  for (const sample of result.results) {
    expect(sample.pipeline, sample.id).toBe(true);
    expect(sample.compilation.filter(message => message.type === "error"), sample.id).toEqual([]);
    for (const face of sample.samples) {
      expect(face.nativeError, `${sample.id} ${face.target}`).toBe(0);
      expect(face.native, `${sample.id} native ${face.target}`).toEqual(face.expected);
      expect(face.webgpu, `${sample.id} WebGPU ${face.target}`).toEqual(face.expected);
    }
  }
});

test("the vertex uniform limit renders the last element of all four packed columns", async ({ page }) => {
  await page.goto("/packages/compiler/test/browser.html");
  const result = await page.evaluate(async ({ rows, shaders }) => {
    const path = "/packages/webgl/src/index.ts";
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path) as typeof import("../../packages/webgl/src/index.js");
    const reports = [];
    for (const backend of ["native", "js", "rust"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const gl = backend === "native" ? canvas.getContext("webgl", { antialias: false })! :
        await createWebGLOnWebGPU(canvas, { version: 1, core: backend, antialias: false });
      const hooks = backend === "native" ? undefined : getTestingHooks(gl);
      try {
        const program = gl.createProgram()!;
        for (const [stage, source] of [[gl.VERTEX_SHADER, shaders.vertex.replace("PROFILE_ROWS", String(rows))],
                                       [gl.FRAGMENT_SHADER, shaders.fragment]] as const) {
          const shader = gl.createShader(stage)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? backend);
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? backend);
        gl.useProgram(program);
        const rgba = [17, 81, 190, 255];
        for (const [channel, name] of ["red", "green", "blue", "alpha"].entries()) {
          const location = gl.getUniformLocation(program, `${name}[${rows - 1}]`);
          if (!location) throw new Error(`${backend} missing ${name}[${rows - 1}]`);
          gl.uniform1f(location, rgba[channel]! / 255);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "position");
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(position);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4);
        gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        reports.push({ backend, actual: hooks?.core ?? "native", pixel: [...pixel], error: gl.getError(),
          rows: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), maxBindingBytes: hooks?.device.limits.maxUniformBufferBindingSize,
          diagnostics: hooks?.errors ?? [] });
      } finally {
        await hooks?.dispose();
      }
    }
    return reports;
  }, { rows: compilerLimits.vertexUniformVectors, shaders: vertexCapacityShaders });
  await mkdir("artifacts/compiler", { recursive: true });
  await writeFile("artifacts/compiler/vertex-uniform-capacity.json", JSON.stringify(result, null, 2) + "\n");
  for (const report of result) {
    expect(report.actual).toBe(report.backend);
    expect(report.rows).toBeGreaterThanOrEqual(compilerLimits.vertexUniformVectors);
    if (report.backend !== "native") {
      expect(report.rows).toBe(compilerLimits.vertexUniformVectors);
      expect(report.maxBindingBytes).toBeGreaterThanOrEqual(compilerLimits.vertexUniformVectors * 4 * 16);
    }
    expect(report.error).toBe(0);
    expect(report.diagnostics).toEqual([]);
    for (const [i, expected] of [17, 81, 190, 255].entries()) {
      expect(Math.abs(report.pixel[i]! - expected), report.backend).toBeLessThanOrEqual(1);
    }
  }
});

test("sampler array elements retain independent units and draw bindings", async ({ page }) => {
  await page.goto("/packages/compiler/test/browser.html");
  const reports = await page.evaluate(async () => {
    const path = "/packages/webgl/src/index.ts";
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path) as typeof import("../../packages/webgl/src/index.js");
    const reports = [];
    for (const backend of ["native", "js", "rust"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const gl = backend === "native" ? canvas.getContext("webgl", { antialias: false })! :
        await createWebGLOnWebGPU(canvas, { version: 1, core: backend, antialias: false });
      const hooks = backend === "native" ? undefined : getTestingHooks(gl);
      try {
        const program = gl.createProgram()!;
        const shaders = [
          [gl.VERTEX_SHADER, "attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}"],
          [gl.FRAGMENT_SHADER, `precision mediump float;
            struct S { sampler2D images[2]; }; uniform S t; uniform samplerCube sky;
            void main(){vec4 v=vec4(0); for(int i=0;i<2;++i) v+=texture2D(t.images[i],vec2(.5));
              gl_FragColor=vec4(v.rgb+textureCube(sky,vec3(1,0,0)).rgb,1.);}`],
        ] as const;
        for (const [stage, source] of shaders) {
          const shader = gl.createShader(stage)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? backend);
        gl.useProgram(program);
        const image = gl.getUniformLocation(program, "t.images")!;
        const last = gl.getUniformLocation(program, "t.images[1]")!;
        const query = () => [gl.getUniform(program, image), gl.getUniform(program, last)];
        const initial = query();
        gl.validateProgram(program);
        const defaultConflict = !gl.getProgramParameter(program, gl.VALIDATE_STATUS);
        gl.uniform1iv(image, [1, 2]);
        const assigned = query();
        gl.uniform1iv(image, [3, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)]);
        const invalid = gl.getError();
        const afterError = query();
        gl.uniform1i(last, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const conflict = gl.getError();
        gl.uniform1i(last, 2);
        for (const [unit, pixels] of [[1, [17, 0, 0, 255]], [2, [0, 81, 0, 255]]] as const) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4);
        gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        reports.push({ backend, actual: hooks?.core ?? "native", initial, assigned, afterError, defaultConflict,
          invalid, conflict, pixel: [...pixel], error: gl.getError(), diagnostics: hooks?.errors ?? [] });
      } finally {
        await hooks?.dispose();
      }
    }
    return reports;
  });
  await mkdir("artifacts/compiler", { recursive: true });
  await writeFile("artifacts/compiler/sampler-aggregates.json", JSON.stringify(reports, null, 2) + "\n");
  for (const report of reports) {
    expect(report.actual).toBe(report.backend);
    expect(report.initial).toEqual([0, 0]);
    expect(report.assigned).toEqual([1, 2]);
    expect(report.afterError).toEqual([1, 2]);
    expect(report.invalid).toBe(0x0501);
    expect(report.defaultConflict).toBe(true);
    expect(report.conflict).toBe(0x0502);
    expect(report.pixel).toEqual([17, 81, 0, 255]);
    expect(report.error).toBe(0);
    expect(report.diagnostics).toEqual([]);
  }
});
