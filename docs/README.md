# Documentation map

Current direction is parallel JS/TypeScript and Rust/Wasm semantic cores sharing the WebGL facade, compiler, browser host, and verification fixtures.

| Document | Responsibility |
| --- | --- |
| [Engineering rules](../AGENTS.md) | Repository-wide agent execution, ownership, and verification rules |
| [Architecture](architecture.md) | Module boundaries, target layout, and data ownership |
| [Roadmap](roadmap.md) | Stages, implementation order, and acceptance |
| [Support matrix](support.json) | Actual implementation scope and evidence |
| [Actions and PR delivery](ci.md) | Required checks, optional runs, and repository integration constraints |
| [Shared core contract](core-api.md) | Buffer handles, validation, input ownership, and lifecycle |
| [Architecture decisions](adr/) | Accepted decisions and their rationale |
| [Agent tasks](tasks/) | Bounded implementation plans, dependencies, acceptance, and results |
| [Initial Chrome validation](validation.md) | Dated prototype verification and measurements |
| [Dual-core Buffer validation](validation/2026-11-13-dual-core-buffers.md) | Current shared Buffer acceptance, JS regression, and remaining Rust parity |

ADR 003 records the current [parallel-core direction](adr/003-parallel-cores.md). ADR 001 records the earlier [small-core experiment and initial JS implementation choice](adr/001-runtime-core.md). ADR 002 documents the [ANGLE Wasm compiler](adr/002-compiler.md).

ADR 004 records the first [Buffer contract and Rust Wasm boundary](adr/004-buffer-core-boundary.md).

Dated reports live under `docs/validation/`; the initial JS report remains `docs/validation.md`. Source/reference material belongs under `docs/references/` when needed. Each report identifies the tested implementation and revision. Support entries record JS and Rust progress independently; the broad rendering profile currently belongs to JS.
