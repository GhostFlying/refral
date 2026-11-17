# CubeMap and original DOM CTS

Implementation and local acceptance are complete on 2026-11-18 from the original main db9c722 baseline. The user authorized the three PRs proposed for this stage and requires all browser work to use headless Chrome.

## Goal and scope

Add scalar samplerCube and level-zero CubeMap uploads/sampling to both actual semantic cores, sharing the facade/compiler/executor. Execute the three complete original RGBA/UNSIGNED_BYTE DOM upload files for ImageData, Canvas and HTMLImage at the existing pinned CTS revision. Preserve existing Texture2D, DOM extraction, framebuffer and synchronous readback behavior.

The initial CubeMap profile includes six level-zero faces, five UNSIGNED_BYTE logical formats for typed/null input, and the accepted RGBA DOM-source overloads. Track each face independently by logical image identity, storage generation and content version. Validate texture target ownership, cube completeness, sampling units, data ownership, errors, deletion and queued work. Nonzero levels, mipmap generation, packed types, CubeMap framebuffer attachment acceptance and Buffer caching retain their separately scoped work.

## Three PRs

1. Task035 maps pinned specification assertions, adds image subresource identities and cube sampling contracts, verifies scalar samplerCube reflection/final WGSL with a real cube pipeline, and updates stale roadmap/support descriptions. Existing baseline must pass.
2. Task036 implements CubeMap state and ordered face operations in JS/Rust, migrates the private Wasm resource protocol with stale-artifact checks, adds facade/executor support and shared three-path semantics. Existing and new regressions must pass.
3. Task037 acquires and executes the unchanged original image_data/canvas/image RGBA UBYTE scripts and dependencies. It completes headless regression, built verification, support metadata and the stage report. Target at least21 complete original files with actual per-file/per-backend assertion counts.

## Ownership and collaboration

The integrating agent owns core-api, facade, browser host, shared ABI contracts, documentation/support, all browser/GPU execution and Git delivery. The compiler worker owns packages/compiler and its focused tests. JS and Rust workers own their semantic implementations and tests after the common contract freezes. Verification owns bounded shared fixtures and CTS acquisition/harness files. Give each file one writer and coordinate shared changes through integration.

Use headless installed Chrome with isolated profiles and one worker. Set REFRAL_HEADLESS=1 for every browser/deployment command and serialize GPU work. Record actual selected core, browser/adapter, build hashes and launch mode. Save artifacts under artifacts/cubemap/pr1–pr3. Required Actions remain lightweight. Deliver each accepted PR through current-head ci/required and rebase merge, then verify main CI before advancing.

## Acceptance and delivery

All three bounded implementations pass local acceptance. PR20 and PR21 rebase integrate the contract/compiler and dual-core runtime as9b57f9c and5b59508, with successful required and main CI. Task037 delivers the original CTS/deployment closure through the same workflow, with its exact receipt under artifacts/cubemap/pr3/delivery.json.

The final suite passes122 headless Chrome tests,226 CPU tests,66 core native tests,9 Wasm-crate tests,46 actual-Wasm tests and45 compiler cases. The21 complete original files pass2433 assertions per backend. Shared CubeMap and built acceptance retain129 and58 draw samples per backend with zero byte differences. The final scope and residual dependencies are in the stage report and support matrix.
