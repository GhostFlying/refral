# Refral

WebGL1 over public browser WebGPU, with an ANGLE shader compiler delivered as Wasm. The first target is installed Google Chrome. The accepted direction develops JS/TypeScript and Rust/Wasm semantic cores in parallel with a shared facade, compiler, browser host, and verification fixtures.

## Setup

Use Node 24.14.0, pnpm 10.12.3, and the Rust toolchain pinned in `rust-toolchain.toml` (1.94.1, rustfmt, clippy, and `wasm32-unknown-unknown`). Install it with `rustup toolchain install 1.94.1 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown`. CMake, Ninja, Python, Git, curl, and tar are required for the pinned compiler build. Compiler dependencies are acquired under ignored `artifacts/compiler`.

The repository uses the public npm registry and commits pnpm/Cargo lockfiles. Rust's formal Buffer crates currently require no third-party crates.

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

Open [the Chrome validation page](http://127.0.0.1:4173/examples/index.html). The probe checks actual WebGPU adapter/device creation, drawing, pixel readback, presentation, and the native WebGL environment. The demo selects native WebGL or Refral and runs the pinned WebGL Fundamentals render-to-texture scene.

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
| `pnpm rust:build` | Formal Rust Buffer core Wasm module |
| `pnpm check` | Strict TypeScript, deterministic unit/native Rust checks, and support validation |
| `pnpm ci:check` | Lightweight CI selection, commit policy, documentation, and support checks |
| `pnpm test:probe` | Actual Chrome WebGPU/native WebGL environment probe |
| `pnpm test:chrome` | Chrome compiler, core selection, semantics, CTS, and baseline collection |
| `pnpm test:cts` | Original-assertion pinned Khronos cases through the recorded test adapter |
| `pnpm test:buffers` | Shared native/JS/Rust public Buffer, handle, ownership, and loss fixtures |
| `pnpm bench:chrome` | Paired native WebGL / Refral CPU samples |
| `pnpm build` | Browser deployment tree |
| `pnpm test:dist` | Built deployment probe and demo in actual Chrome |
| `pnpm snapshot` | Source-tree hash and per-file provenance for saved evidence |

Playwright uses the installed `chrome` channel, headed mode, an isolated profile, and one worker. Set `REFRAL_HEADLESS=1` for explicitly recorded headless checks. The primary acceptance path uses headed Chrome. Browser plugin availability for this implementation was absent, so verification uses the approved regular Playwright path.

GitHub Actions uses affected-module checks in `ci/required`. Actual Wasm and compiler verification run through optional manual/daily workflows. See [Actions and PR delivery](docs/ci.md) for commands and integration constraints.

## Public interface

```ts
import { createWebGLOnWebGPU } from '@refral/webgl';

const gl = await createWebGLOnWebGPU(canvas, { version: 1 });
// Select the current Rust Buffer profile explicitly:
const rustGl = await createWebGLOnWebGPU(otherCanvas, { version: 1, core: 'rust' });
```

The asynchronous factory prepares GPU and compiler dependencies and the selected core. JS is the default and implements the current rendering profile. Rust implements Buffer semantics in its Wasm instance; remaining shader, texture, and rendering operations report `NotSupportedError`. Supported calls are synchronous. See `docs/core-api.md` for the shared contract and `docs/support.json` for per-core scope and evidence. The test adapter exposes asynchronous pixel capture separately from the public GL interface.

## Development and evidence

Start with `AGENTS.md`, the documentation map in `docs/README.md`, and the relevant file under `docs/tasks`. Architecture and current decisions live under `docs/architecture.md` and `docs/adr`.

The JS prototype's first Chrome verification passed 26 browser tests, 18 unit tests, and the built deployment check. `docs/validation.md` records that dated evidence and initial performance observations. Formal dual-core development starts with the common Buffer contract and shared fixtures. ADR 003 records the parallel-core direction. Current native-comparison microbenchmarks show higher CPU costs for the prototype, and allocation/binding optimization is queued in P3.

The [dual-core Buffer milestone](docs/validation/2026-11-13-dual-core-buffers.md) passed 34 Chrome tests, 25 JS unit tests, 15 native Rust tests, and four actual-Wasm adapter tests. Both cores pass the shared Buffer fixtures. The built deployment also passes JS demo rendering and packaged Rust Wasm verification. Rust rendering parity advances through subsequent contracts.

Raw outputs are under ignored `artifacts/`. They include environment reports, compiler build/corpus results, JS/Rust samples, differential images, CTS assertions, screenshots, and paired performance samples. Validation summaries describe their environment and measurement limits. GPU timestamp results and internal Dawn integration require their own actual implementation and verification.

## Third-party sources

ANGLE and Emscripten revisions are pinned in `packages/compiler/dependencies.json`. Demo and Khronos WebGL revisions are pinned in `fixtures.lock.json`. Compiler adaptation patches and licenses are described in the compiler package. Original demo/CTS license files are fetched with the corresponding source. See `THIRD_PARTY.md`.
