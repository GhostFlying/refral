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
| `pnpm test:buffers` | Shared native/JS/Rust public Buffer, handle, ownership, and loss fixtures |
| `pnpm test:drawing` | Shared native/JS/Rust drawing, state/error, pixel and minimal-example checks |
| `pnpm test:readback` | Experimental synchronous readback placements, shared-memory conditions and existing CTS/demo smoke |
| `pnpm test:readback:compare` | Canvas2D/worker actual-core byte corpus, native reference, tiling and baseline CTS/demo/lifecycle |
| `pnpm bench:readback` | Matched Canvas2D/worker completed-readback latency and process CPU samples |
| `pnpm bench:rtt` | Five native/JS/Rust drawing workloads, three rotated rounds and raw CPU samples |
| `pnpm bench:chrome` | Alias for the independent RTT baseline entry |
| `pnpm build` | Browser deployment tree |
| `pnpm test:dist` | Built deployment probe and demo in actual Chrome |
| `pnpm snapshot` | Source-tree hash and per-file provenance for saved evidence |

Playwright uses the installed `chrome` channel, headed mode, an isolated profile, and one worker. Set `REFRAL_HEADLESS=1` for explicitly recorded headless checks. The primary acceptance path uses headed Chrome. Browser plugin availability for this implementation was absent, so verification uses the approved regular Playwright path.

GitHub Actions uses affected-module checks in `ci/required`. Actual Wasm and compiler verification run through optional manual/daily workflows. See [Actions and PR delivery](docs/ci.md) for commands and integration constraints.

## Public interface

```ts
import { createWebGLOnWebGPU } from '@refral/webgl';

const gl = await createWebGLOnWebGPU(canvas, { version: 1 });
// Select the Rust semantic core explicitly:
const rustGl = await createWebGLOnWebGPU(otherCanvas, { version: 1, core: 'rust' });
```

The asynchronous factory prepares GPU and compiler dependencies and the selected core. JS is the default. Both semantic cores execute the shared Buffer, shader/program, typed uniform/matrix, Texture2D, RGBA/depth framebuffer and raster profile. Supported calls are synchronous. Each core reports valid operations beyond its declared scope through `NotSupportedError`. See `docs/core-api.md` for the shared contract and `docs/support.json` for per-core scope and evidence. The test adapter exposes asynchronous pixel capture separately from the public GL interface.

## Development and evidence

Start with `AGENTS.md`, the documentation map in `docs/README.md`, and the relevant file under `docs/tasks`. Architecture and current decisions live under `docs/architecture.md` and `docs/adr`.

The JS prototype's first Chrome verification passed 26 browser tests, 18 unit tests, and the built deployment check. `docs/validation.md` records that dated evidence and initial performance observations. Formal dual-core development starts with the common Buffer contract and shared fixtures. ADR 003 records the parallel-core direction.

The [dual-core Buffer milestone](docs/validation/2026-11-13-dual-core-buffers.md) passed 34 Chrome tests, 25 JS unit tests, 15 native Rust tests, and four actual-Wasm adapter tests. Both cores pass the shared Buffer fixtures. The built deployment also passes JS demo rendering and packaged Rust Wasm verification. Rust rendering parity advances through subsequent contracts.

The [dual-core drawing milestone](docs/validation/2026-11-14-dual-core-drawing.md) passed 64 Chrome tests, 62 JS unit tests, 27 Rust native tests and nine actual-Wasm tests. Sixteen shared scenes passed native/JS/Rust state, error and pixel checks. Seven original CTS files passed 100 assertions per path. This dated milestone established the common default-framebuffer profile. Task 020 extends it through three-path render-to-texture and repeated drawing performance measurements.

The [three-path RTT milestone](docs/validation/2026-11-15-three-path-rtt.md) passes 84 Chrome correctness tests, 107 CPU tests, 44 native Rust tests and twenty actual-Wasm tests. Eleven original CTS files pass 243 assertions per backend. Twenty shared RTT scenes and sequential demo times 0/1000/2000 pass, with zero observed pixel differences across the demo's nine comparisons. Built deployment exercises RTT, triangles, the GPU probe and ABI3/resource-protocol2.

`pnpm bench:rtt` independently measures five native/JS/Rust drawing workloads in three rotated rounds. The 45 accepted runs retain 5400 CPU samples in ms/logical-frame. Its dedicated server enables COOP/COEP for finer timer resolution. The report records timing boundaries, initial/first-image costs, counters, capacities, hardware, launch flags and build/source hashes. The current Rust path has higher CPU costs than JS in these workloads, with profiling and optimization scheduled as separate work. GPU durations remain unmeasured in this CPU baseline.

The [synchronous readback experiment](docs/validation/2026-11-15-readback-feasibility.md) exercises both semantic cores with an independent GPU worker. An isolated page returns completed pixels through shared memory, using Window polling or a waiting worker client. The proposed ADR records deployment, thread and public API integration work. The production context's readPixels entry remains unimplemented in the support matrix.

Raw outputs are under ignored `artifacts/`. They include environment reports, compiler build/corpus results, JS/Rust samples, differential images, CTS assertions, screenshots, and paired performance samples. Validation summaries describe their environment and measurement limits. GPU timestamp results and internal Dawn integration require their own actual implementation and verification.

## Third-party sources

ANGLE and Emscripten revisions are pinned in `packages/compiler/dependencies.json`. Demo and Khronos WebGL revisions are pinned in `fixtures.lock.json`. Compiler adaptation patches and licenses are described in the compiler package. Original demo/CTS license files are fetched with the corresponding source. See `THIRD_PARTY.md`.
