# Implementation roadmap

## Approved direction

Build a WebGL1-over-WebGPU library with an explicit asynchronous context factory. Validate in installed Chrome and reuse ANGLE shader compiler components as browser Wasm. Develop JS/TypeScript and Rust/Wasm semantic cores in parallel through a common contract, shared compiler/host, and common acceptance fixtures. Extend compatibility through fixed-revision Khronos CTS. Later integrate the existing Dawn/C++ host using its real transport and ownership contracts.

## Current foundation work

ADR 003 defines the accepted parallel-core direction. The root pnpm/Cargo workspaces contain the shared API, migrated JS core, formal Rust core, Wasm exports, and JS adapter. The first shared feature is Buffer lifecycle/data/query/error behavior with native/JS/Rust fixtures. Task 006 records integration acceptance. Track implementation and verification per core.

The existing Chrome prototype and recorded P0–P2 results describe the JS rendering implementation. The Rust trace experiment supplies its documented small-core measurements. Following Buffer acceptance, define shared vertex-input and draw snapshot contracts and implement the first Rust triangle using the common compiler and executor. Follow with uniforms, textures, and framebuffer passes, reusing the same fixtures for both cores.

## P0 Engineering and environment

- Create a pnpm workspace with strict TypeScript, Vite, Vitest, and Playwright.
- Add environment discovery, locked third-party acquisition, and reproducible build/test commands.
- Run native WebGL and real WebGPU probe rendering, asynchronous readback, and presentation in Chrome.
- Record browser, adapter, capabilities, and build environment.

Acceptance runs from the repository root. A clean dependency install, `pnpm check`, `pnpm build`, and the Chrome probe must succeed. Keep GPU diagnostics and images under `artifacts/`.

## P1 Compiler and core selection

- Build fixed-revision ANGLE ESSL-to-WGSL compiler components with Emscripten/CMake/Ninja.
- Exercise ESSL100 and ESSL300, reflection, mismatched stage interfaces, uniforms, samplers, and final WGSL.
- Compare JS and Rust/Wasm using identical state traces and the same browser executor.
- Measure cold initialization, CPU/bridge work, uploads, and memory estimates. Use the measurements to guide each implementation's design and integration.

Acceptance requires executable compiler and core experiments with raw results. Compiler, mock, and real GPU outcomes identify their implementation and scope.

## P2 First complete slice

Implement WebGL1 shaders/programs, buffers, attributes, indexed triangles, uniforms, Texture2D, viewport/scissor/clear, depth/blend, framebuffer rendering, resize, deletion, and deterministic unsupported diagnostics. Add automatic microtask submission and explicit flush. Adapt the fixed-revision WebGL Fundamentals render-to-texture example with native/compatibility context injection.

Required regressions cover draw-time uniform and buffer versions, caller mutation after upload, storage replacement, relink and stale locations, masked/scissored clear, framebuffer sampling and resizing, context ownership and deletion, state after errors, and rAF/task submission. Add initial original-assertion CTS cases and reproducible native WebGL performance comparisons.

Acceptance requires actual Chrome rendering, passing supported differential cases, an evidence-backed support matrix, compiler and runtime ADRs, runnable examples, and raw performance data.

## P3 CTS coverage

Grow a pinned suite by semantic dependency. Retain test identities, assertions, adapter changes, and pass/fail/unsupported/timeout outcomes. Expand formats, extensions, context behavior, and synchronous GPU-dependent APIs as implementation permits.

## P4 Internal host

Inspect the actual existing command buffer, GL provider, upload path, threads, and Dawn resource ownership. Implement the host adapter and compare against the existing batched WebGL baseline. Record actual integration results.

## Task execution

### Delivery and CI

Task 010 establishes automatic commit/push/integration after documented task acceptance. Task 011 records the user's pre-stable priority of short iteration cycles and a small required CI set. Task 012 implements the foundation workflows and PR constraints described in [Actions and PR delivery](ci.md).

Before stable, start with the following checks and select them according to affected modules. Documentation-only changes use documentation and metadata validation. Rust-native checks apply to Rust-affecting changes. Record actual runner startup, queue, and execution times before expanding the required set.

| Verification | Initial pre-stable use |
| --- | --- |
| TypeScript type check, JS CPU unit tests, support metadata | Lightweight required checks for affected code and contracts |
| Native Rust compilation and semantic tests | Lightweight required checks for Rust-affecting changes |
| Actual Wasm build and adapter tests | Optional local, manual, or daily verification |
| ANGLE acquisition/build and shader/link corpus | Optional local, manual, or daily verification |
| Chrome differential scenes, CTS, demo, and deployment | Optional local, manual, or daily verification |
| Performance sampling | Optional local or scheduled measurements with recorded environment |

Keep `pnpm check` available as the comprehensive deterministic local entry point. CI can invoke its individual commands to run the selected lightweight checks. Authors choose focused local verification appropriate to their task and record the results. Manual Actions runs should allow selection of a test group. Daily runs should exercise the latest main revision and preserve diagnostics and failure artifacts. Track software-renderer correctness and hardware GPU measurements with their actual environment.

Once Actions gates are established, deliver subsequent work through task branches and pull requests, follow the required checks, and rebase merge successful changes. Optional and daily outcomes inform follow-up priorities and remain non-blocking for auto-merge. Revisit the required set as stable release criteria take shape, using observed regressions and runner cost. The roadmap records the workflow design and its implementation status.

### Ownership

The integrating agent owns root configuration, architecture, shared contracts, integration, and support reporting. Bounded tasks advance JS semantics, Rust semantics, shared modules, and verification. Each task records scope, dependencies, owned files, commands, evidence, status, and parity gaps. Coordinate interface changes with the integrating agent.

## Recorded stage status

The JS prototype's P0, P1, and P2 initial Chrome profile passed executable acceptance on 2026-11-13. See `validation.md` for commands, environment, limitations, and performance observations. ADR 001 records the initial TypeScript choice and its small-core experiment. ADR 003 establishes parallel JS/Rust development. ADR 002 records the ANGLE Wasm compiler and shared resource profile.

P3 starts with broader original-assertion CTS coverage and optimization of the measured per-draw allocation and binding costs. P4 begins when the actual internal transport and Dawn ownership interfaces are available for inspection.

The first dual-core Buffer milestone passed on 2026-11-13: 34 Chrome tests, 25 JS unit tests, 15 native Rust tests, four actual-Wasm adapter tests, and built deployment verification. See `validation/2026-11-13-dual-core-buffers.md`. Both cores now share the Buffer contract; the broader rendering profile and original CTS acceptance remain JS coverage. Next establish common vertex-input and draw planning types and take Rust through the first real triangle with the shared compiler/host.
