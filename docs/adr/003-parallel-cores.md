# ADR 003 — Parallel JS and Rust semantic cores

Status is accepted on 2026-11-13.

## Decision

Develop JS/TypeScript and Rust/Wasm semantic cores in parallel. Share the public WebGL facade, ANGLE compiler adapter, browser WebGPU executor, fixtures, native references, and comparison workloads. Advance functionality through a common behavior contract and record each implementation's progress independently.

The user approved this structure after reviewing the small-core measurement boundaries. The earlier experiment remains evidence for the state-trace and bridge work it measured. This decision establishes the continuing engineering direction described by the architecture and roadmap.

## Boundaries

The common core interface defines observable GL behavior, logical handles, data ownership, resource versions, and ordered execution results. The facade manages JS wrapper identity and input adaptation. Each core performs its semantic operations and produces results for the shared host. The compiler supplies common diagnostics, reflection, and program layouts.

The layout has `packages/core-api`, `packages/core-js`, and `packages/core-wasm`, together with Rust crates under `crates/core` and `crates/wasm`. The JS Wasm adapter connects the Rust exports to the common interface. The first shared feature is Buffer semantics, described in `../core-api.md` and foundation task 006.

## Progress and verification

Track support and verification per core. A task may advance one core or a shared module, with its parity gap recorded. Compare equivalent behavior through the same fixtures and native reference. An explicitly requested implementation reports its own capability gaps.

Record CPU trace processing, public API costs, host encoding/submission, GPU time, and frame/FPS results with their actual units and measurement boundaries. Use shared compiler and executor paths where they support meaningful comparison.

## Current implementation

The Chrome rendering profile uses `packages/core-js` or the formal Rust implementation under `crates/core` and `crates/wasm` through `packages/core-wasm`. Both semantic cores execute the common Buffer, shader/program, typed uniform/matrix, Texture2D, RGBA/depth framebuffer and raster contracts with opaque facade wrappers. ADRs 005 and 006 record the drawing/resource extensions. The trace experiment under `experiments/core-selection` stays independently reproducible and its results retain their original measurement boundaries. Task 020 adds a repeated five-workload public-API drawing baseline.
