# Refral

WebGL1 over public browser WebGPU, with an ANGLE shader compiler delivered as Wasm. The first target is installed Google Chrome. The accepted direction develops JS/TypeScript and Rust/Wasm semantic cores in parallel with a shared facade, compiler, browser host, and verification fixtures.

## Setup

Use Node 24.14.0, pnpm 10.12.3, and the Rust toolchain pinned in `rust-toolchain.toml` (1.94.1, rustfmt, clippy, and `wasm32-unknown-unknown`). Install it with `rustup toolchain install 1.94.1 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown`. CMake, Ninja, Python, Git, curl, and tar are required for the pinned compiler build. Compiler dependencies are acquired under ignored `artifacts/compiler`.

The repository uses the public npm registry and commits pnpm/Cargo lockfiles. The Rust semantic crate has no third-party dependencies. Its Wasm binding pins serde and serde_json for cold compiler/reflection metadata.

```sh
pnpm install --frozen-lockfile
pnpm run doctor
pnpm deps:sync
pnpm compiler:build
pnpm core:build
pnpm rust:build
pnpm rust:test:wasm
pnpm check
pnpm compiler:test
pnpm test:chrome
pnpm build
pnpm dev
```

Open [the Chrome validation page](http://127.0.0.1:4173/examples/index.html). The probe checks actual WebGPU adapter/device creation, drawing, pixel readback, presentation, and the native WebGL environment. The demo selects native WebGL, Refral JS or Refral Rust and runs the pinned WebGL Fundamentals render-to-texture scene.

Open [the Rust triangle](http://127.0.0.1:4173/examples/triangle/index.html?core=rust) for the shared drawing profile. Set core=js or core=native in the URL to run the same scene through either reference path.

Open [Three.js Shapes](http://127.0.0.1:4173/examples/three-shapes/index.html) to compare the three backends on the pinned r162 Shapes scene. Drag the scene to rotate it. Run `REFRAL_HEADLESS=1 pnpm bench:three` for the optional performance comparison and image checks. See the [workload and results](docs/tasks/116-three-shapes-workload.md).

Open [Three.js Marching Cubes](http://127.0.0.1:4173/examples/three-marching-cubes/index.html) for an automatically playing animation. This scene rebuilds the mesh's positions, normals and colors each frame. The backend links switch between native WebGL1, Refral JS and Refral Rust. See the [animation verification](docs/tasks/117-three-marching-cubes.md).

Run `pnpm bench:three:heavy` for the optional headless comparison of four-view Shapes, a lit triangle cloud, and Sobel postprocessing at two resolutions. Results include the native, JS and Rust screenshots and raw timings. See the [heavier workloads and diagnostic controls](docs/tasks/119-heavy-three-benchmarks.md).

Run `pnpm bench:three:large` to compare Shapes, 1,000 and 3,000 separate Suzanne meshes, and 2,000 interactive cubes. This optional headless benchmark fetches and verifies the pinned model. See the [scene adaptations, CPU timings, and index-scan experiment](docs/tasks/127-large-three-scenes.md).

Refral publishes default framebuffer work at its automatic microtask checkpoint or on `gl.flush()`. If synchronous platform calls such as Canvas2D `drawImage()` or canvas serialization need the latest drawing, call `gl.flush()` before taking the snapshot. Native WebGL can provide the drawing directly when taking a same-stack snapshot.

The build produces a standalone `dist` tree containing the browser bundles, compiler Wasm, formal Rust core Wasm, core-selection experiment Wasm, and pinned demo resources. Serve it over localhost or HTTPS.

## Commands

| Command | Result |
| --- | --- |
| `pnpm run doctor` | Tool paths, versions, missing setup steps, and environment JSON |
| `pnpm deps:sync` | Pinned ANGLE/Emscripten, demo, and initial CTS acquisition |
| `pnpm compiler:build` | Standalone ESSL-to-WGSL compiler JS/Wasm |
| `pnpm compiler:test` | Compiler and linker corpus using the built Wasm |
| `pnpm core:build` | Pinned Rust/Wasm selection experiment |
| `pnpm core:bench` | Node JS/Rust repeated CPU samples |
| `pnpm rust:check` | Pinned Rust formatting and clippy checks |
| `pnpm rust:test` | Native Rust core and ABI tests |
| `pnpm rust:test:wasm` | Actual compiled Wasm adapter, memory growth, and shared contract tests |
| `pnpm rust:build` | Formal Rust semantic core Wasm module |
| `pnpm check` | Strict TypeScript, deterministic unit/native Rust checks, and support validation |
| `pnpm ci:check` | Lightweight CI selection, commit policy, documentation, and support checks |
| `pnpm test:probe` | Actual Chrome WebGPU/native WebGL environment probe |
| `pnpm test:chrome` | Chrome compiler, core selection, semantics, CTS, and three-path demo correctness |
| `pnpm test:cts` | Original-assertion pinned Khronos cases through the recorded test adapter |
| `pnpm conformance:deps` | Full pinned Khronos suite and source provenance |
| `pnpm conformance:run` | Official WebGL1 runner on native, JS and Rust in headless Chrome |
| `pnpm conformance:report` | Per-file and per-module outcomes, paired native results and failure dependencies |
| `pnpm test:buffers` | Shared native/JS/Rust public Buffer, handle, ownership, and loss fixtures |
| `pnpm test:drawing` | Shared native/JS/Rust drawing, state/error, pixel and minimal-example checks |
| `pnpm test:readback` | Experimental synchronous readback placements, shared-memory conditions and existing CTS/demo smoke |
| `pnpm test:readback:compare` | Canvas2D/worker actual-core byte corpus, native reference, tiling and baseline CTS/demo/lifecycle |
| `pnpm test:readpixels` | Public synchronous readPixels semantics, packing, destinations, ordering and lifecycle |
| `pnpm bench:readpixels` | Three-path public clear/read completed-latency samples on an ordinary page |
| `pnpm bench:readback` | Matched Canvas2D/worker completed-readback latency and process CPU samples |
| `pnpm bench:dom` | Three-source native/JS/Rust DOM upload/draw call intervals, three rounds and raw samples |
| `pnpm bench:rtt` | Five native/JS/Rust drawing workloads, three rotated rounds and raw CPU samples |
| `pnpm bench:chrome` | Alias for the independent RTT baseline entry |
| `pnpm build` | Browser deployment tree |
| `pnpm test:dist` | Built probe, three-path RTT/triangles, readPixels, DOM uploads and packaged Wasm hashes in headless Chrome |
| `pnpm snapshot` | Source-tree hash and per-file provenance for saved evidence |

Playwright uses the installed `chrome` channel, headless mode by default, an isolated profile, and one worker. Browser tests and deployment checks run in the background. Set `REFRAL_HEADLESS=0` for an explicitly requested visible reproduction. Dated reports record the actual mode and adapter. Browser verification uses repository Playwright entry points.

GitHub Actions uses affected-module checks in `ci/required`. Actual Wasm and compiler verification run through optional manual/daily workflows. See [Actions and PR delivery](docs/ci.md) for commands and integration constraints.

## Public interface

```ts
import { createWebGLOnWebGPU } from '@refral/webgl';

const gl = await createWebGLOnWebGPU(canvas, { version: 1 });
// Select the Rust semantic core explicitly:
const rustGl = await createWebGLOnWebGPU(otherCanvas, { version: 1, core: 'rust' });

const pixels = new Uint8Array(canvas.width * canvas.height * 4);
gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
```

The asynchronous factory prepares GPU and compiler dependencies and the selected core. JS is the default. Both semantic cores execute the shared Buffer, shader/program, typed uniform/matrix, Texture2D/CubeMap, RGBA/depth framebuffer and raster profile. Supported calls are synchronous. Each core reports valid operations beyond its declared scope through `NotSupportedError`. See `docs/core-api.md` for the shared contract and `docs/support.json` for per-core scope and evidence. The test adapter exposes asynchronous pixel capture separately from the public GL interface.

The accepted DOM overloads include unorm8 sRGB ImageData, sRGB Canvas/OffscreenCanvas, decoded HTMLImageElement, HTMLVideoElement and ImageBitmap. After the context is initialized, texImage2D/texSubImage2D consume their source synchronously. Images, video frames and bitmaps use a lazy private native WebGL context to apply source-specific upload conversion and read source pixels. Canvas transfer uses WebGPU external copy and the opaque Canvas2D readback transport. The [DOM extraction decision](docs/adr/008-dom-image-extraction.md) records ownership, source-context coordination and accepted limits.

## Development and evidence

Start with `AGENTS.md`, the documentation map in `docs/README.md`, and the relevant file under `docs/tasks`. Architecture and current decisions live under `docs/architecture.md` and `docs/adr`.

The JS prototype's first Chrome verification passed 26 browser tests, 18 unit tests, and the built deployment check. `docs/validation.md` records that dated evidence and initial performance observations. Formal dual-core development starts with the common Buffer contract and shared fixtures. ADR 003 records the parallel-core direction.

The [dual-core Buffer milestone](docs/validation/2026-11-13-dual-core-buffers.md) passed 34 Chrome tests, 25 JS unit tests, 15 native Rust tests, and four actual-Wasm adapter tests. Both cores pass the shared Buffer fixtures. The built deployment also passes JS demo rendering and packaged Rust Wasm verification. Rust rendering parity advances through subsequent contracts.

The [dual-core drawing milestone](docs/validation/2026-11-14-dual-core-drawing.md) passed 64 Chrome tests, 62 JS unit tests, 27 Rust native tests and nine actual-Wasm tests. Sixteen shared scenes passed native/JS/Rust state, error and pixel checks. Seven original CTS files passed 100 assertions per path. This dated milestone established the common default-framebuffer profile. Task 020 extends it through three-path render-to-texture and repeated drawing performance measurements.

The [three-path RTT milestone](docs/validation/2026-11-15-three-path-rtt.md) passes 84 Chrome correctness tests, 107 CPU tests, 44 native Rust tests and twenty actual-Wasm tests. Eleven original CTS files pass 243 assertions per backend. Twenty shared RTT scenes and sequential demo times 0/1000/2000 pass, with zero observed pixel differences across the demo's nine comparisons. Built deployment exercises RTT, triangles, the GPU probe and ABI3/resource-protocol2.

`pnpm bench:rtt` independently measures five native/JS/Rust drawing workloads in three rotated rounds. The 45 accepted runs retain 5400 CPU samples in ms/logical-frame. Its dedicated server enables COOP/COEP for finer timer resolution. The report records timing boundaries, initial/first-image costs, counters, capacities, hardware, launch flags and build/source hashes. The current Rust path has higher CPU costs than JS in these workloads, with profiling and optimization scheduled as separate work. GPU durations remain unmeasured in this CPU baseline.

The [synchronous readback experiment](docs/validation/2026-11-15-readback-feasibility.md) exercises both semantic cores with an independent GPU worker. An isolated page returns completed pixels through shared memory, using Window polling or a waiting worker client. ADR 007 accepts the main-thread Canvas2D path for public readPixels. Both actual cores implement RGBA/UNSIGNED_BYTE, fixed Uint8Array/Uint8ClampedArray destinations, PACK_ALIGNMENT and clipped reads through the ordinary factory. The [public readPixels report](docs/validation/2026-11-16-public-readpixels.md) records synchronous behavior, original CTS and performance acceptance.

The [DOM upload milestone](docs/validation/2026-11-16-dom-uploads.md) passes110 headless Chrome tests,201 CPU tests,66 native Rust tests and38 actual-Wasm tests. Eighteen complete original CTS files pass515 assertions per backend. Seventeen DOM semantic groups record282 exact captures per backend. Built deployment checks all four source brands, while pnpm bench:dom retains3240 formal call-interval samples with explicit ms/logical-frame units and source-extraction costs.

Raw outputs are under ignored `artifacts/`. They include environment reports, compiler build/corpus results, JS/Rust samples, differential images, CTS assertions, screenshots, and paired performance samples. Validation summaries describe their environment and measurement limits. GPU timestamp results and internal Dawn integration require their own actual implementation and verification.

## Third-party sources

ANGLE and Emscripten revisions are pinned in `packages/compiler/dependencies.json`. Demo and Khronos WebGL revisions are pinned in `fixtures.lock.json`. Compiler adaptation patches and licenses are described in the compiler package. Original demo/CTS license files are fetched with the corresponding source. See `THIRD_PARTY.md`.

The [CubeMap milestone](docs/validation/2026-11-18-cubemap.md) adds level-zero six-face sampling to both actual cores, with129 exact shared draw samples per backend and resource capability3. Twenty-one complete original CTS files pass2433 assertions per backend, including the unchanged ImageData, Canvas and HTMLImage RGBA generators with their2D/Cube branches. Built CubeMap verification retains58 additional draw samples per backend.

## Official conformance baseline

After the compiler and Rust Wasm builds in Setup, run the original Khronos WebGL1 runner through the installed headless Chrome channel.

```sh
pnpm conformance:deps
pnpm conformance:run
pnpm conformance:report
```

The source command acquires the complete pinned suite and validates Git blobs. The runner uses the original version 1.0.4 inventory, including slow tests, with one iframe. It selects native, JS and Rust sequentially and saves checkpoints under `artifacts/conformance/baseline`. The selected-core entry uses the CLI's document-start bootstrap. Its marker reports an explicit initialization error when the local integration page is opened without that installation.

Use `--backend js` to select a backend, `--include 'conformance/uniforms/'` to select a directory, and `--start` and `--count` to select an official index range. Reports retain the complete inventory denominator. Exploratory selected-core files can stop 100 ms after an uncaught `NotSupportedError`. Results retain observed counters and mark the original file unfinished. Use `--wait-unsupported` to retain the official idle watchdog for those cases. Native always uses the original watchdog. Repeating a command resumes compatible saved results. A changed runtime/browser fingerprint requires a new `--output` directory or `--fresh`. Interruption closes the owned Chrome and Vite processes. [Adapter decision](docs/adr/010-official-conformance-adapter.md)
