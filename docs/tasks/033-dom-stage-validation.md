# DOM upload stage validation and performance

Implementation and local acceptance are complete on 2026-11-16 as PR4 of task029, depending on task032.

## Goal and ownership

Verify the accepted ImageData, Canvas and HTMLImage inputs in the built deployment, retain full browser/original CTS regression, and report measured DOM upload costs with raw samples and environment evidence. The integrating agent owns deployment/support/stage reporting and all GPU execution. The benchmark worker owns benchmarks/dom-upload.config.ts, benchmarks/dom-upload.spec.ts and benchmarks/dom-upload.ts. Shared files have one writer.

## Measurement plan

Use native WebGL, actual JS core and actual Rust core with the same 64×64 opaque sRGB pixels, shader, destination size, GL calls and common Refral executor. Prepare ImageData, Canvas and decoded HTMLImage sources before timing. Report source preparation separately. Initialize the selected public context, shader and texture separately, then record first upload/draw CPU and first completed-image elapsed time.

Measure texSubImage2D plus a textured draw and explicit flush per logical frame. Use30 warmup samples,120 formal samples and8 logical frames per sample. Execute three rounds with rotated backend order. Include facade conversion, source extraction/snapshot, core processing, Wasm bridge, WebGPU encoding and submission inside the CPU interval. Complete GPU work and verify a pixel outside each sample interval. Save timing resolution, cache state, actual core/browser/headless launch arguments, adapter and Wasm hashes. Record host counter deltas within the CPU interval separately from completion/readback overhead. GPU timestamps report availability and a concrete reason.

Keep hardware performance conclusions scoped to the actual adapter. Values are milliseconds per sample and per logical frame, with raw samples and p50/p95. Native host counters have an explicit availability field.

## Acceptance

Run deterministic checks, actual-Wasm tests, complete headless browser/original CTS tests, built probe/demo/DOM verification and the independent DOM benchmark. Store outputs under artifacts/dom-input/pr4. Add the local benchmark command and document the accepted runtime extraction dependency and remaining source/format limits. Deliver the report/support changes through current-head ci/required and rebase merge and verify main CI.

## Results

All27 performance runs pass with3240 formal samples and25920 logical frames. The source/backend pools each contain360 samples. The report docs/validation/2026-11-16-dom-uploads.md records pooled p50/p95, setup/first-image ranges,0.005ms timer resolution, counters, memory scope and the costs included in DOM extraction. GPU timestamp measurement is disabled for this call-interval baseline. Private image-helper native GL counters remain unavailable.

TypeScript,201 CPU tests,58 Rust core tests,8 Wasm-crate tests, rustfmt/clippy,38 actual-Wasm tests and110 headless Chrome tests pass. All eighteen original CTS scripts pass515 assertions per ordinary-page backend, with separate isolated Buffer74-assertion results. Built deployment passes the probe, three-path RTT/triangle/readPixels, sixteen DOM captures per backend, module capability2 and matching packaged/source hashes.

The benchmark and built verification use installed Chrome157 on the apple/metal-3 hardware adapter with isFallbackAdapter false. The measured source manifest and raw samples are preserved under artifacts/dom-input/pr4/performance. Final DOM public records are copied under pr4/public-imagedata and pr4/public-canvas-image. Per-PR delivery receipts and the final stage delivery record identify accepted heads and CI. Remaining compatibility limits are listed in the report and support matrix.
