# Original state and Buffer CTS

Implementation and local acceptance are complete on 2026-11-16 from main 68f8912 as PR1 of task029. Delivery follows current-head required CI and rebase integration.

## Goal, dependencies and ownership

Activate four complete original files at CTS revision 39443210f7f81db4773eb104facadfb85d05dfa4. Use the current asynchronous context bootstrap and actual JS/Rust cores. Correct support metadata whose matrix, constant-attribute or browser-mode descriptions precede their current evidence.

The CTS worker exclusively owns fixtures.lock.json, tests/fixtures/cts-runner.ts and tests/chrome/cts.spec.ts. The integrating agent exclusively owns docs/support.json, docs/spec-map.md, this task, the parent task and any demonstrated semantic correction. Coordinate core fixes after observing exact failures. Other workers perform read-only DOM audits. GPU execution and all Git operations belong to the integrating agent.

## Steps and specification assertions

1. Acquire state/gl-geterror.html, state/gl-getstring.html, state/gl-initial-state.html and buffers/buffer-data-and-buffer-sub-data.html using the existing fixture tool and fixed revision.
2. Execute original scripts and assertions through native, JS and Rust. Preserve the original getError test's permitted first-error/multiple-error branches and record actual assertion counts independently. Record native contexts created on detached helper canvases as well as document canvases.
3. Exercise the original Buffer file on an ordinary page and an isolated page so its optional fixed-shared-storage branch executes. Record isolation and selected core. Keep scope and adaptation evidence explicit.
4. Resolve demonstrated semantic failures from the pinned specification. Update stale support claims using existing/current actual test results and record the new CTS scope.
5. Run deterministic policy/type checks, focused headless CTS and existing affected regressions. Save raw results under artifacts/dom-input/pr1 and deliver the atomic PR through required CI and rebase merge.

## Acceptance commands

Use node tools/deps-fixtures.mjs, pnpm ci:check, pnpm check and REFRAL_HEADLESS=1 pnpm test:cts. Run the complete existing Chrome suite before PR1 acceptance if harness behavior changes. Verify all original files finish and pass independently, with actual counts/environment and explicit allowed branch differences. Keep the original assertions and upstream identities in the result.

## Results

The eighteen original files pass 515 assertions per backend on ordinary pages. The four new file counts are getError6, getString7, initial-state7 and Buffer65. All three implementations take the upstream multiple-error branch, with their actual values retained. The isolated original Buffer run passes74 assertions per backend, including nine additional shared-storage assertions, with both harness and iframe recording actual isolation/SAB availability.

Full headless Chrome regression passes93 tests with zero failures/skips. TypeScript,152 CPU tests,46 Rust core tests,7 Wasm-crate tests, formatting/clippy and support validation pass. The hardware adapter remains apple/metal-3. Raw logs and copied original CTS records live in artifacts/dom-input/pr1. Matrix/constant-attribute and browser-mode support descriptions now match existing verified fixtures. Native detached helper canvases are recorded and cleaned up.

Delivery provenance is recorded in artifacts/dom-input/pr1/delivery.json. PR2 follows the DOM-source specification and extraction feasibility audit in task029.
