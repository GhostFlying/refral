# Foundation and integration

Status is complete for P0–P2 of the approved Chrome profile.

## Goal and ownership

Integrating agent owns root configuration, tools, examples, tests, support matrix, and shared documentation. Establish runnable Chrome verification, integrate worker modules, and verify P0–P2 acceptance.

## Steps

1. Record the approved architecture and task ownership.
2. Create workspace tooling and environment discovery.
3. Establish probe rendering, native reference, and browser test entry.
4. Integrate compiler and runtime interfaces, then exercise semantic differentials.
5. Run core selection, CTS, benchmarks, and update evidence-backed documentation.

## Acceptance

Run dependency install, `pnpm check`, `pnpm build`, Chrome GPU/differential tests, compiler corpus, core-selection experiment, initial CTS, and performance collection. Record actual commands, outcomes, and unresolved items here and in the stage documentation.

## Results

- Workspace, agent rules, architecture, task records, locked dependencies, reproducible commands, support matrix, and ADRs are present.
- Environment discovery resolves Node/NVM, Rust, CMake/Ninja, installed Chrome, and the task-local Emscripten SDK.
- Actual Chrome WebGPU draw/readback/presentation and native reference passed on the Apple Metal-3 hardware adapter.
- ANGLE compiler Wasm passed 23 corpus cases and 3 actual browser pipeline configurations.
- Measured JS/Rust selection chose the TypeScript semantic core for the first Chrome phase.
- The semantic core, thin DOM facade, and concrete browser executor have separate ownership boundaries.
- Final `pnpm check` passed 18 unit tests and strict typing. Final `pnpm test:chrome` passed 26 tests, including 18 differential cases and 5 CTS files with 89 original assertions.
- The pinned demo passed native/compatibility comparison, and its UI displays both backends. Actual Chrome also verified the built deployment with compiler Wasm and adjacent assets.
- Initial native/Refral CPU samples, capacity estimates, images, and diagnostics are saved in ignored artifacts. `docs/validation.md` records results and limits.

## Follow-up

Continue P3 using the evidence-backed support matrix and observed allocation costs. Internal host integration requires the real command-buffer/provider/upload/thread contracts described by P4.
