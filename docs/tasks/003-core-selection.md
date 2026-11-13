# JS and Rust/Wasm core selection

Status is complete.

## Goal and ownership

Selection worker owns `experiments/core-selection`, related benchmark entry, and `docs/adr/001-runtime-core.md`.

## Steps and acceptance

Build identical seeded state traces in JS and Rust/Wasm covering uniforms/draw snapshots, state/cache changes, and upload metadata. Use common host consumption. Validate output equivalence, measure cold and warm CPU/bridge work, save raw repeated samples, and make an evidence-backed core decision. Coordinate production integration with the main agent. Record measured and unmeasured boundaries explicitly.

## Implementation plan

1. Build a dependency-free Rust Wasm library with bounded input/output arenas and explicit setter/draw operations.
2. Implement equivalent JS state handling and seeded uniform, pipeline-state, and upload traces. Compare the complete emitted draw snapshots for each path.
3. Measure JS, per-call Wasm, and batched Wasm using the same trace and common JS output consumer. Account for upload-byte ownership separately.
4. Run repeated Node measurements and Chrome measurements. Exercise emitted snapshots through one fixed-WGSL WebGPU executor for output equivalence.
5. Save raw samples, versions, configuration, and limitations under `artifacts/core-selection`, then write an ADR and report integration commands.

Acceptance commands are `node tools/core-selection-build.mjs`, `node tools/core-selection-run.mjs`, and the browser harness calling `runBrowserSelection()` from `experiments/core-selection/browser.mjs`.

## Verification and evidence

- `node tools/core-selection-build.mjs` passed with Rust 1.94.1 and produces 4,997-byte stripped Wasm. The existing stable 1.94.0 target registration conflicted with installed files, so the experiment uses the already installed, pinned 1.94.1 toolchain.
- `node tools/core-selection-run.mjs` passed all complete snapshot comparisons and records 2,700 raw samples in `artifacts/core-selection/node-results.json`.
- `pnpm exec playwright test core-selection.spec.ts --output=artifacts/core-selection/playwright` passed in installed headed Chrome 157.0.8103.51. The final exclusive GPU run took 17.3 seconds of test execution.
- All nine scene/path GPU proof cases passed exact RGBA8 readback for 512 draws each on the Apple metal-3 hardware adapter. Page and console error lists are empty.
- Browser measurements, compiler metadata, source/Wasm hashes, observability limitations, and adapter changes are saved in `artifacts/core-selection/chrome-results.json`. The visible Run interaction and results were captured and inspected in `artifacts/core-selection/chrome-results.png`.
- ADR 001 selects TypeScript for the Chrome first phase, based on mixed per-command Wasm costs and the browser integration boundary. Batched Wasm remains an executable measured candidate.

An initial run was interrupted by Vite hot reload while another agent edited the app. The isolated experiment page and test-specific hot-reload suppression make this repeatable during agent-driven development. Another run completed all comparison assertions before an optional CDP metadata query failed. That query now records its unavailability and preserves the successful correctness evidence.

## Follow-up core boundary tests

Add `tests/unit/context.test.ts` using a mock semantic host and compiler methods that throw on unexpected invocation. Exercise public SemanticContext operations for input views and destination offsets, storage/content generations, invalid and foreign-context calls preserving bindings, deletion and retained attachment lifetimes, and context loss neutral responses and queued-flush cancellation. Observe the logical resources returned by core methods and the host's recorded operations. Run this file directly under Node Vitest, then report defects to the runtime owner for correction.

Follow-up status is complete. The initial Node run passed nine of twelve cases and exposed missing texture retirement after the final retained framebuffer is deleted, a true `isBuffer` result after loss, and compiler invocation after loss. The runtime owner corrected these paths and resource-release handling. The targeted `vitest run tests/unit/context.test.ts` rerun passes all twelve cases in Node. Repository TypeScript checking passes with the new test file.
