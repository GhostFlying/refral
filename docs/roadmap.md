# Implementation roadmap

## Approved direction

Build a WebGL1-over-WebGPU library with an explicit asynchronous context factory. Validate in installed Chrome and reuse ANGLE shader compiler components as browser Wasm. Develop JS/TypeScript and Rust/Wasm semantic cores in parallel through a common contract, shared compiler/host, and common acceptance fixtures. Extend compatibility through fixed-revision Khronos CTS. Later integrate the existing Dawn/C++ host using its real transport and ownership contracts.

## Current foundation work

Task 013 established spec-driven minimal drawing, typed shader/program handles, shared compiler ownership and the three-path triangle. Task 020 advances the common profile through render-to-texture in five bounded PRs. Shared resource handles and execution operations precede typed uniforms/raster/ABI v3, Texture2D/unpack, framebuffer multipass drawing, and repeated performance/deployment acceptance.

ADR 003 defines the accepted parallel-core direction. The root pnpm/Cargo workspaces contain the shared API, migrated JS core, formal Rust core, Wasm exports, and JS adapter. Task 006 established Buffer lifecycle/data/query/error behavior with native/JS/Rust fixtures. Task 013 extends the shared contract through default-framebuffer drawing. Track implementation and verification per core.

The existing Chrome prototype and recorded P0–P2 results describe the earlier JS rendering implementation. The Rust trace experiment retains its documented small-core measurements. The current shared contract includes float/int/bool uniforms and matrices, level-zero five-format UNSIGNED_BYTE texture uploads, RGBA color/depth targets and raster state. Both semantic cores use the common compiler, executor, inputs and acceptance fixtures. The selected original CTS set contains21 complete files. Tasks029–033 accepted ImageData, Canvas and HTMLImage uploads, preserving source-derived identities separately from complete original-file CTS results. Task034 accepts level-zero CubeMap/samplerCube and three complete original DOM files through both actual cores.

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

Task 038 establishes the original official runner and records the 971-entry WebGL1 baseline on native, JS and Rust. Native passes 968 files, JS 566 and Rust 571. The 21-file accepted set remains a focused regression entry. The full inventory prioritizes WebGL1 API surface corrections, vertex inputs and primitive modes, ANGLE WGSL lowering and packed pixel types. [Baseline and implementation order](validation/2026-11-18-official-conformance.md)

The completed milestones and subsequent compatibility dependencies follow.

1. Task 025 establishes synchronous readback feasibility using actual JS/Rust cores and an independent GPU worker. Task 027 adds a main-thread Canvas2D candidate, byte-exact shared rendering corpus and matched latency/process CPU comparison. Task028 implements the user-selected Canvas2D path through both public cores, including destination ownership, packing, clipping, ordering and loss handling. The original program-handling, feedback-loop and read-pixels-pack-alignment files execute unchanged through a recorded iframe prototype adapter. ADR 007 records the accepted backend.
2. Tasks029–033 complete the declared DOM input profile. Task034 extends texture-image identities, samplerCube and six-face level-zero sampling, then runs the three unchanged original RGBA DOM upload files. Tasks035–037 preserve both cores and the common host.
3. Use the official baseline to order semantic corrections and capability work, including packed pixel types, mip levels, mipmap generation, vertex inputs and framebuffer formats. Attach specification assertions and affected original directories to each task, then rerun those directories and the complete baseline as appropriate.
4. Extend context restoration, extensions and remaining state according to the fixed CTS dependency graph.

Use the repeated drawing baseline to choose separate optimization tasks for the measured CPU, bridge, allocation and host costs. Preserve workload sizes, raw samples and image assertions when comparing changes.

The first Buffer optimization candidate is per-submission reuse of immutable bytes by logical Buffer version. The Rust draw decoder currently creates fresh byte-array identities that miss the shared host's vertex cache. Reuse must include context, object identity, storage generation and content version, with updates, deletion and queued work covered by the shared fixtures. The readback experiment leaves this optimization as a subsequent bounded task.

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

P3 continues with broader original-assertion CTS coverage and separately scoped optimization of measured per-draw allocation, bridge and binding costs. P4 begins when the actual internal transport and Dawn ownership interfaces are available for inspection.

The first dual-core Buffer milestone passed on 2026-11-13: 34 Chrome tests, 25 JS unit tests, 15 native Rust tests, four actual-Wasm adapter tests, and built deployment verification. See `validation/2026-11-13-dual-core-buffers.md`. This dated milestone established the Buffer contract. The next drawing milestone passes 64 Chrome tests, 62 JS CPU tests, 27 Rust native tests and nine actual-Wasm tests. Sixteen shared drawing scenes and seven original CTS files now pass native/JS/Rust acceptance. See `validation/2026-11-14-dual-core-drawing.md` for scope and remaining parity.

The RTT milestone completes local acceptance on 2026-11-15 with 84 Chrome correctness tests, 107 CPU tests, 44 native Rust tests, twenty actual-Wasm tests, twenty shared RTT scenes and eleven original CTS files with 243 assertions per backend. The sequential three-path demo has zero observed pixel differences. Deployment and 45 repeated performance runs pass. See `validation/2026-11-15-three-path-rtt.md` for raw-data paths, timing boundaries and current compatibility limits.

The CubeMap milestone passes the21-file original CTS set with2433 assertions per backend, including1918 new DOM texture assertions. Shared runtime and built CubeMap results retain129 and58 draw samples per backend respectively. See [the stage report](validation/2026-11-18-cubemap.md) for the accepted scope and residual compatibility dependencies.
