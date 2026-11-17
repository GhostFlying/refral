# Original DOM texture CTS acceptance

Implementation and local acceptance are complete on 2026-11-18 as PR3 of task034 from main5b59508 after PR21 rebase delivery and successful main CI.

## Goal and ownership

Execute unchanged pinned originals textures/image_data/tex-2d-rgba-rgba-unsigned_byte.html, textures/canvas/tex-2d-rgba-rgba-unsigned_byte.html and textures/image/tex-2d-rgba-rgba-unsigned_byte.html on native, actual JS and actual Rust. Integration owns shared runtime fixes, documentation/support, build/deployment, all GPU execution and Git. Verification owns fixtures.lock.json, acquisition helper changes, CTS runner/browser assertions and bounded CubeMap verification fixtures by explicit handoff.

## Plan

Acquire the original HTML, generators, shared texture utilities and image/font assets at revision39443210f7f81db4773eb104facadfb85d05dfa4. Record dependency provenance and licenses. Preserve upstream scripts, expected values, assertions, full2D/Cube branches and asynchronous test completion. Adapt only context initialization/branding and environment plumbing with explicit records.

Run each complete original file and report actual assertion counts, outcomes, selected core, attributes, browser/adapter, Wasm hashes and any browser observations. Resolve supported semantic failures from the pinned specification and retain regressions. Expand the fixed set from18 to at least21 complete files. Copy raw results under artifacts/cubemap/pr3.

Complete the full headless browser suite, deterministic CPU/native checks, actual Wasm, compiler corpus and built verification. Include a built CubeMap smoke with nonuniform face texels through both actual cores where needed. Update the support matrix, architecture/ABI documentation and stage report with actual evidence and remaining mip/packed/FBO/context scope. Required Actions remain lightweight. Deliver via required CI/rebase merge and verify main CI.

## Frozen verification handoff

The verification worker owns fixtures.lock.json, tools/deps-fixtures.mjs, tests/fixtures/cts-runner.ts and tests/chrome/cts.spec.ts. Acquire the three HTML files, four generator/shared JS files and red-green.png through the existing pinned helper, retaining unchanged originals. Capture iframe unhandled rejection and dependency-load failures. Preserve original stylesheet links and record this harness adaptation. The worker may run deterministic CPU/type checks and dependency acquisition, with all browser/GPU execution reserved for integration. Integration adds a built CubeMap entry using the same six-axis/nonuniform-texel and DOM face fixture, and checks both actual cores plus native through dist.

## Original execution and deployment results

The21 complete original files pass2433 assertions per backend on headless Chrome157.0.8103.79. New ImageData/Canvas/HTMLImage files pass226/1570/122 assertions respectively, adding1918 per backend. Complete2D/CubeMap paths and the Canvas OffscreenCanvas branches execute unchanged. No GL, GPU, resource-load or Promise rejection errors occur. The largest original execution is about2.2 seconds for the Canvas Rust path, so the existing30-second per-file timeout is retained. These timings describe whole CTS execution and are retained as diagnostics.

The helper downloads original files at the pinned revision with URL/bytes/SHA256 provenance. All13 audit dependencies match. A direct Node fetch encountered ECONNRESET, and NODE_USE_ENV_PROXY=1 node tools/deps-fixtures.mjs completed through the existing environment proxy. No source adaptation was required. Acquisition evidence is source-verification.json.

Built probe, RTT, triangles, synchronous readPixels and16 DOM variants per backend pass. The new packaged CubeMap entry runs30 orientation/corner and28 DOM draws per backend with explicit expected bytes and native comparisons. Packaged Wasm hashes match current compiler/core files. All browser commands use REFRAL_HEADLESS=1.

## Final regression and handoff

The complete suite passes122 headless Chrome tests. Deterministic checks pass226 CPU,66 core native and9 Wasm-crate tests. The real module passes46 actual-Wasm cases, and the compiler corpus passes45. pnpm build and pnpm test:dist pass with the new CubeMap entry. Source/core hashes, exact original assertions, delayed diagnostics and launch arguments are retained in artifacts/cubemap/pr3. The stage report is docs/validation/2026-11-18-cubemap.md.

Delivery uses an atomic lowercase feature commit, current-head ci/required, rebase merge and verified main CI. The exact PR/head/merge/run receipt is artifacts/cubemap/pr3/delivery.json. Remaining packed/mip/cube-attachment and context prerequisites are explicit in fixtures.lock.json and docs/support.json.
