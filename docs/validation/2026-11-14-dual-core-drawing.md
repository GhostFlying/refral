# Dual-core drawing validation — 2026-11-14

## Implementation and environment

Task 013 extends the shared Buffer milestone through shader/program lifecycle and minimal default-framebuffer drawing. The public factory selects JS or Rust explicitly, with JS as default. The facade, ANGLE compiler service, WebGPU executor and fixtures are shared. Each selected core owns its semantic state, errors, resources and draw planning.

The accepted environment is macOS arm64, Node 24.14.0, pnpm 10.12.3, Rust 1.94.1 and headed Google Chrome 157.0.8103.51. Playwright uses channel chrome, an isolated profile, DPR 1 and one test worker. WebGPU reported Apple, metal-3 and isFallbackAdapter=false. Fixtures record actual returned context attributes, adapter capabilities, shaders and build hashes.

CTS and the WebGL HTML/IDL sources use revision 39443210f7f81db4773eb104facadfb85d05dfa4. ANGLE uses a03f7cbe9746a577b50629b78f10505744a40291 and Emscripten 4.0.23. Compiler Wasm SHA-256 is f6e6c07afc47f37b543a36444f3438b7aa8e137219d1a052b30b9df0cff85118. Rust ABI v2 Wasm is 223,445 bytes, has no host imports, and has SHA-256 171c1248cb9e8a8ea67425c1344de49110d54f92fcc6b9c132bd7c23d4d6c964. The final source snapshot is `artifacts/environment/source.json`.

## Acceptance results

| Entry point | Result and scope |
| --- | --- |
| `pnpm check` | TypeScript, 62 JS CPU tests, 27 Rust native tests, rustfmt, clippy and 28-entry per-core support validation passed. |
| `pnpm rust:build` | Official ABI v2 module built with the pinned locked toolchain. |
| `pnpm rust:test:wasm` | Nine actual-Wasm CPU tests passed across Buffer and drawing transport. Compiler and host are deterministic mocks in these tests. |
| `pnpm compiler:test` | All 23 standalone ANGLE compiler/link cases passed under Node. |
| `pnpm test:chrome` | All 64 tests passed in 41.9 seconds, covering existing JS rendering, actual compiler/pipelines, shared Buffer/loss, CTS, 16 three-path drawing scenes and three triangle examples. |
| Selected original CTS | Seven unchanged files passed 100 original assertions on each of native, JS and Rust. |
| `pnpm build` and `pnpm test:dist` | Built probe, JS render-to-texture, packaged ABI v2 and native/JS/Rust triangle drawing passed with no page errors. The triangle's center RGBA was [66, 66, 124, 255] on all three paths. |

The independent Node compiler entry exposed a new relative runtime-export resolution failure during final verification. Keeping the registry implementation in the compiler's existing Node-compatible entry corrected that path. The standalone corpus, TypeScript, browser and deployment checks cover the resulting implementation.

## Shared drawing behavior

Sixteen scenes execute the same API trace through native WebGL, JS and Rust. Explicit GL state/error expectations accompany full expected image regions. The permitted byte tolerance is one. Every final comparison observed zero mismatched channels and maximum difference zero.

- All eight float scalar/vector f/fv uniform setters, independent values between draws and fresh values after relink.
- Vertex/index updates between draws with u8/u16 indices, upload-view snapshots, Buffer reallocation and deletion.
- Interleaved stride/offset, constant attributes, attribute size changes, canvas resize, viewport and clear regions.
- Microtask submission inside and outside requestAnimationFrame, explicit flush and canvas presentation.
- Invalid draw calls preserving semantic state and existing output.
- Failed current-program relink, successful relink reset, old locations and source/compile changes before relink.
- Detached/deleted shader executable lifetime, retained deleted shader/program operations, final retirement and exact shader-source code units.

Shader/program/location handles include kind, context, slot and generation. Link generations invalidate earlier uniform locations. Rust stores source as UTF16 code units and transports unrestricted floating-point values through binary payloads. Draw replies own their Buffer/uniform data and include explicit resource versions. Both cores release replaced and finally retired compiler artifacts.

## Native query deviation

Chrome 157 can report the rejected value from an attribute-pointer query after returning an error for invalid stride, size, type or offset. Actual rendering continued with the earlier valid state. GLES 2.0.25 section 2.5 requires these errors to preserve state. The fixture records Chrome's query value under observations, asserts the normative state for JS/Rust, and asserts errors and rendered pixels on all three paths. The independent evidence is `artifacts/dual-core-drawing/native-attribute-validation.json`.

## Scope and remaining work

Rust now covers ESSL100 shader/program lifecycle and reflection, FLOAT vertex arrays/constants, float scalar/vector updates, TRIANGLES arrays/u8/u16 indices, default color/depth clear, viewport, submission and asynchronous testing capture. JS retains its broader texture/FBO, matrix and raster profile, exercised by its existing regressions and render-to-texture demo.

Rust's next parity work includes non-null matrix/integer/sampler updates, other vertex formats, textures/FBO and broader depth/blend/scissor/write-mask state. Public synchronous readPixels and context restoration remain subsequent capabilities. The original program-handling CTS file retains its synchronous readback prerequisite, while source-marked asynchronous project cases cover the supported state transitions.

The existing native/JS CPU benchmark still runs in the Chrome suite. The trace-selection experiment remains independent. This milestone supplies correctness and transport evidence. Controlled JS/Rust rendering performance comparison remains pending. Rust currently copies a Buffer snapshot per active attribute and performs two upload copies, which future measurements must include.

## Reproduction and evidence

```sh
pnpm install --frozen-lockfile
pnpm deps:sync
pnpm compiler:build
pnpm core:build
pnpm rust:build
pnpm check
pnpm rust:test:wasm
pnpm compiler:test
pnpm test:chrome
pnpm build
pnpm test:dist
pnpm snapshot
```

`pnpm test:drawing` runs the 16 shared scenes and three example checks. `pnpm test:cts` runs the seven original files on all three backends. The triangle entry is `/examples/triangle/index.html?core=rust`, with js and native also selectable through the URL.

Raw logs are `artifacts/program-cores-check.log`, `artifacts/program-cores-wasm.log`, `artifacts/drawing-compiler.log`, `artifacts/dual-core-drawing-full-chrome.log` and `artifacts/drawing-dist.log`. Per-scene JSON, original images, failure differences, native probes and build identities are under `artifacts/dual-core-drawing/`. Original CTS assertions are in `artifacts/cts/results.json`. Built screenshots and environment data are under `artifacts/deployment/`.
