# Documentation map

Current direction is parallel JS/TypeScript and Rust/Wasm semantic cores sharing the WebGL facade, compiler, browser host, and verification fixtures.

| Document | Responsibility |
| --- | --- |
| [Engineering rules](../AGENTS.md) | Repository-wide agent execution, ownership, and verification rules |
| [Architecture](architecture.md) | Module boundaries, target layout, and data ownership |
| [Roadmap](roadmap.md) | Stages, implementation order, and acceptance |
| [Support matrix](support.json) | Actual implementation scope and evidence |
| [Actions and PR delivery](ci.md) | Required checks, optional runs, and repository integration constraints |
| [Shared core contract](core-api.md) | Object handles, shader/program state, draw snapshots, validation, and lifecycle |
| [Specification map](spec-map.md) | Pinned WebGL/IDL/GLES sources, semantic assertions, and original CTS identities |
| [Architecture decisions](adr/) | Decisions, proposals and their recorded status |
| [Agent tasks](tasks/) | Bounded implementation plans, dependencies, acceptance, and results |
| [Initial Chrome validation](validation.md) | Dated prototype verification and measurements |
| [Dual-core Buffer validation](validation/2026-11-13-dual-core-buffers.md) | Current shared Buffer acceptance, JS regression, and remaining Rust parity |
| [Dual-core drawing validation](validation/2026-11-14-dual-core-drawing.md) | Unified cores, original CTS, three-path pixels, built examples, and remaining Rust scope |
| [Three-path RTT validation](validation/2026-11-15-three-path-rtt.md) | Current shared texture/FBO profile, sequential demo, eleven original CTS files, deployment and repeated performance |
| [Synchronous readback feasibility](validation/2026-11-15-readback-feasibility.md) | Experimental caller/GPU-worker placements, shared-memory conditions, synchronous image checks and integration work |
| [Canvas2D and worker comparison](validation/2026-11-15-readback-comparison.md) | Actual-core RGBA/ordering corpus, ordinary-page Canvas capture and matched latency/process CPU evidence |
| [CTS readback dependencies](references/cts-readback-dependencies.md) | Pinned original pixel helper, context-brand, texture/input and state/query prerequisites |

ADR 003 records the current [parallel-core direction](adr/003-parallel-cores.md). ADR 001 records the earlier [small-core experiment and initial JS implementation choice](adr/001-runtime-core.md). ADR 002 documents the [ANGLE Wasm compiler](adr/002-compiler.md).

ADR 004 records the first [Buffer contract and Rust Wasm boundary](adr/004-buffer-core-boundary.md).

Dated reports live under `docs/validation/`. The initial JS report remains `docs/validation.md`. Source/reference material belongs under `docs/references/` when needed. Each report identifies the tested implementation and revision. Support entries record JS and Rust progress independently through the current shared RTT profile.

ADR 005 records the [unified drawing core and compiler-artifact boundary](adr/005-drawing-core-boundary.md) introduced by task 013.

ADR 006 records [resource versions and shared execution](adr/006-resource-execution.md), including typed targets and the ABI3/resource-protocol2 boundary.

ADR 007 proposes the [synchronous readback integration](adr/007-synchronous-readback.md) using task025's worker feasibility and task027's Canvas2D comparison. Its status remains proposed while production readPixels acceptance and backend selection are pending.
