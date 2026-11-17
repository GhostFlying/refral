import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("ANGLE Wasm compiles ESSL corpus and WebGPU accepts linked WGSL", async ({ page }) => {
  // Keep Vite's URL helper available while disabling source-change navigation in this test.
  await page.route("**/@vite/client", (route) => route.fulfill({
    contentType: "text/javascript", body: "export const injectQuery = (url) => url;",
  }));
  await page.goto("/packages/compiler/test/browser.html");
  const result = await page.evaluate(async () => {
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
      const bindings: Record<string, number> = pair.matrix ? { transform: 2, position: 0 } : { position: 3 };
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
  });
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
