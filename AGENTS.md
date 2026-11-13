# Refral engineering instructions

## Direction and reading

- Follow the user's current scope and applicable higher-level instructions.
- Develop JS/TypeScript and Rust/Wasm semantic cores in parallel, sharing the WebGL facade, compiler, browser host, and verification fixtures.
- The initial public target is the declared WebGL1 subset in Chrome. Expand compatibility through original WebGL CTS cases and reproducible differential tests.
- Start with `docs/README.md`, `docs/architecture.md`, `docs/roadmap.md`, and the relevant task. Read the accepted ADRs affecting the change.
- Architecture and accepted ADRs describe current design. Task records describe bounded work. Validation reports and reference documents supply dated evidence and background.

## Module ownership

- The facade owns JS wrapper identity, argument conversion, DOM inputs, and the association between wrappers and logical handles.
- Each semantic core owns GL state, validation, errors, logical object relationships, resource generations, and ordered draw/pass planning.
- The common core contract uses logical handles and explicit data ownership. Keep DOM/GPU objects and implementation-specific classes inside their owning modules.
- The compiler adapter owns ESSL translation, diagnostics, reflection, program finalization, and final WGSL/layout results.
- The host owns concrete GPU objects, uploads, encoding, submission, presentation, and in-flight resource retirement.
- Keep shared compiler and execution behavior behind the common contracts. An explicitly selected core handles its semantic operations and reports capability gaps.
- Migrate the existing prototype toward the agreed layout through scoped tasks with caller and test updates.

## Observable behavior

- Consume or snapshot mutable caller inputs before the GL upload call returns. Define ownership and reuse points for implementation-owned staging data.
- Preserve the state and data version visible to every draw, including updates and resource replacement between draws.
- Track object identity, storage generation, content version, and program link generation separately. Include context ownership and resource generations in validation and cache identity.
- Manage GL-visible deletion, retained object references, and queued GPU resource lifetimes explicitly.
- Preserve synchronous GL compile/link/query behavior after asynchronous context initialization. Handle GPU diagnostics and completion through their documented asynchronous paths.
- Implement invalid-input behavior through GL validation and errors. Give explicit library diagnostics for valid operations outside the declared profile.
- Define CPU-input consumption, transport flush, GPU submission, and GPU completion distinctly wherever an interface exposes them.

## Parallel core development

- State intended GL behavior once in the shared contract and fixtures. Track JS and Rust/Wasm implementation and verification independently.
- Each feature task identifies the core or shared module it advances, its acceptance scope, and remaining parity work.
- Reuse the same inputs, expected state, native reference, and image tolerances when comparing cores. Record the selected core in results.
- Maintain support status by core and verified behavior. Scope earlier reports to the implementation and revision actually tested.
- Record architectural and ABI decisions in ADRs. Keep routine compatible implementation details in their task records.

## Agent tasks and collaboration

- Before implementation, write or update a task with its goal, dependencies, owned files/modules, steps, and acceptance commands.
- Give each concurrently edited file one write owner. Coordinate shared contract changes with the integrating agent and update affected callers.
- The integrating agent owns shared interfaces, integration, and support reporting. Assign core and shared-module work as bounded tasks.
- Continue authorized work using reasonable reversible implementation choices. Ask for input when a missing product decision or external prerequisite prevents progress.
- Mark task completion using the stated acceptance evidence. Record unresolved failures, environment limitations, and parity gaps explicitly.

## Verification and measurement

- Use repository command entry points. `pnpm run doctor` checks the environment; `pnpm check` runs TypeScript, deterministic unit/native Rust checks, and support validation. Compiler builds and actual-Wasm/GPU verification have separate commands.
- Match verification to the change. Documentation changes check links, facts, and status consistency. Semantic changes add or reuse meaningful behavior regressions and run affected core/browser tests.
- Run applicable formatting and language checks for changed code. Use strict TypeScript, rustfmt for Rust, and Google C++ Style for project C++.
- Browser verification uses Playwright's installed `chrome` channel, an isolated profile, and one GPU test worker. Coordinate an exclusive measurement window for performance sampling.
- Identify unit/mock, compiler, real GPU, differential, CTS, and performance evidence in reports. Preserve upstream CTS identities, assertions, and adapter changes.
- Performance reports state units, workload size, warmup/repetitions, timing boundaries, input preparation/copy costs, cache state, and the shared host work included.
- Label trace replay, API processing, CPU encoding/submission, GPU duration, and frame/FPS results according to what was measured. Record timer quantization and unavailable measurements.
- Record exact core/build/browser versions, configuration, actual adapter, and evidence paths. Use hardware adapter measurements for hardware performance conclusions.

## Commit conventions

- Write commit subjects as `feat: <desc>`, `fix: <desc>`, or `refactor: <desc>`. Use lowercase throughout the commit message.
- Describe the changed behavior or implementation in the subject and any body. Put test commands and execution results in task or validation records.
- Make each commit atomic, with one coherent change and its associated caller, documentation, and configuration updates.
- Keep a linear history. Rebase branches when integrating upstream changes and use rebase and merge for integration.
- Follow the existing user Git identity and the task's authorization for commits and remote operations.

## Automatic delivery

- The user authorizes automatic commits, pushes, and integration for completed work in this repository. Carry an accepted task through delivery without requesting confirmation again for those routine actions.
- Until GitHub Actions acceptance gates are established, use the task's documented local acceptance checks as the integration gate. Bootstrap the empty repository with a coherent initial default-branch commit.
- Once Actions gates are established, push a task branch, open a PR, follow its checks, address failures, and merge using rebase merge when the required checks pass. Verify checks against the current PR head and keep the resulting history linear.
- Preserve repository permissions and branch rules. Record the commit/PR and integration result in the task or handoff; report an external blocker if delivery requires access or a decision outside the authorized scope.

## Dependencies, artifacts, and handoff

- Pin dependency revisions and toolchains. Preserve licenses, source provenance, and local adaptation patches.
- Save generated builds, raw samples, screenshots, failure images, and runtime configuration under ignored `artifacts/`. Keep concise conclusions and reproduction commands in documentation.
- Hand off the implemented behavior, verification results, evidence paths, and remaining work needed by the next task.
