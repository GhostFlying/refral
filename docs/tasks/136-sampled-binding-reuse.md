# 136 Sampled binding reuse

Reduce per-draw binding overhead on the task 135 Aquarium baseline. The single-frame audit on main 4761901 found 20,066 adjacent texture-group matches out of 20,110 creates. Own the browser host sampled group cache, Wasm batch encoder, adapter, protocol notes and regressions. Follow ADRs 006, 009 and 012 for ordered execution resources and independent image versions.

1. Reuse the preceding host group when its layout, ordered sampler objects and materialized GPU textures agree. Preserve pass binding transitions and current uniforms.
2. Measure logical binding matches within real Rust batches. Negotiate an optional sampled-texture reference, retaining exact version, dimension, face, level, order and sampling parameters. Keep legacy and direct replies complete. Exercise fresh and nested drains, texture changes, and protocol negotiation.
3. Verify with doctor, pnpm check, ci:check, rust:build, rust:test:wasm and single-worker headless Chrome. Compare both Aquarium sizes on this Mini with the task 131 harness and task 135 baseline. Collect three rounds of 30 warmup and 120 timed frames under the shared GPU lock. Verify screenshots, errors and draw counts. Use Animometer uniforms as the untextured control.

## Attribution

At 20,000 fish, an untimed frame after 30 warmup and one sampled frame had 20,110 draws. The baseline created 20,110 groups containing samplers and called createView 79,861 times (all uses). Comparing actual layout, sampler, backing texture and view descriptor yielded 20,066 adjacent matches and 36 unique combinations. Host reuse reduced this to 44 sampler-group creates and 85 total views. At 500 fish the corresponding counts fell from 610 groups and 2,081 views to the same 44 and 85. The host resolves current GPU allocations before comparing, and its pass state still binds the cached group again when necessary.

A separate audit compared the complete old wire bytes beginning with the texture count, resetting the predecessor per drain. With the host change alone it found 20,036 eligible repeats at 20,000 fish and 566 at 500 fish. Total nonempty batch reply bytes in the audit frames were 69,699,652 and 1,763,092 respectively (all records, including uniforms). The negotiated bit 4 now omits the texture section on exact matches of nonempty binding lists. The host-side binding cache and the Wasm reference use different identities: GPU objects for binding, and the complete ordered logical image versions for replay. Empty binding lists retain the original four-byte encoding.

The current adapter against the preceding actual module passed 73/73 Wasm tests. The preceding adapter against the updated module passed its entire 70-test suite. The current pair passed 73/73, including sampled-unit changes inside a batch, nested drains, explicit support masks, and incomplete bindings with differing filters.

## JS small-scene follow-up

The first two changes reduced 20K CPU time on both cores, but JS at 500 fish regressed relative to a fresh 4761901 control. A host experiment that reused matching sampler parameters and avoided temporary slot arrays did not recover the small-scene loss. The JS profile repeatedly resolved the same mip images during completeness checks and binding assembly. Extend the task to the JS texture helper and draw call site to collect the validated chain in one pass. Rerun both Aquarium sizes, retain existing incomplete-texture, framebuffer-feedback and sampling behavior, and check the untextured control.

## Mini measurements

Apple M6, Darwin 27.2.0, Chrome 158.0.8127.37 headless, Apple Metal hardware adapter, one page and GPU lock. Task 131 pins, fixed simulation time, antialiasing off. Values are pooled nearest-rank CPU p50 / p95, milliseconds per frame across three rounds of 30 warmup and 120 samples. The timer covers scene update, WebGL calls and flush, including CPU submission and possible backpressure. GPU completion, audit and screenshot occur after timing. GPU and presentation durations were unmeasured.

| Case / core | Native | Before | Host reuse | Host + Rust wire | Final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Aquarium 500 JS | 1.245 / 1.465 | 5.015 / 5.365 | 5.340 / 5.885 | 5.315 / 5.800 | 5.005 / 5.625 |
| Aquarium 500 Rust | 1.245 / 1.465 | 9.135 / 9.675 | 7.740 / 8.210 | 5.080 / 5.570 | 5.080 / 5.570 |
| Aquarium 20,000 JS | 3.555 / 3.965 | 166.665 / 170.790 | 109.255 / 111.370 | 109.560 / 111.395 | 84.140 / 85.975 |
| Aquarium 20,000 Rust | 3.555 / 3.965 | 284.840 / 290.055 | 227.665 / 231.185 | 60.200 / 61.590 | 60.200 / 61.590 |
| Animometer uniforms JS | 2.630 / 3.160 | 53.890 / 55.325 | 53.485 / 54.665 | 53.690 / 54.960 | 54.110 / 55.425 |
| Animometer uniforms Rust | 2.630 / 3.160 | 37.945 / 39.670 | 37.945 / 39.780 | 38.180 / 39.805 | 38.180 / 39.805 |

The 500-fish before column comes from a fresh serial 4761901 checkout. Larger before and native cells reuse the same Mini's task 131 and 135 data. Final Rust cells use the host + Rust wire run; the last code change only affects the JS semantic core. The rejected host candidate measured 5.390 / 5.905 for JS at 500. Collecting mip images during JS validation recovered its median, with a final 0.260 ms increase in p95 relative to the fresh control. Every round preserved the previous corresponding PNG bytes, audit draw counts, sampled upload bytes and number of submissions. Native Aquarium comparisons retain the deferred visual discrepancy from task 134.

The negotiated producer emitted exactly 20,036 and 566 references in the respective audit frames. Nonempty batch reply bytes fell to 7,663,328 and 296,288. At 20K this removed 89.0% of the reply bytes. Audits use different animation frames from the full 30/120 timing runs.

## Remaining frame costs

Animometer uniforms has 20,000 draws and zero sampled-texture groups. A separate 500 µs CDP renderer CPU profile used 12 warmup and 45 sampled frames plus the audit. Of non-idle sampled time, JS uniform handling and packing accounted for 27.2% inclusive, the shared host for 26.2%, including 5.7% in the uniform arena and 4.1% in host flush. Rust's host accounted for 37.5%, including 8.5% in the uniform arena and 5.5% in flush. The Rust enqueue function alone had 7.1% self time. Inclusive enqueue also contains synchronous batch drains. The uniform facade, core packing, geometry encoding and per-draw host bindings are measurable targets for the untextured gap. These profiles include warmup and audit work.

## Reproduction and evidence

From the Mini checkout load the tool environment and run the timed harness separately on the revisions to compare:

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
REFRAL_TEST=1 REFRAL_BENCHMARK=1 REFRAL_CASES=aquarium,aquarium-20k,animometer \
  REFRAL_BACKENDS=js,rust REFRAL_ROUNDS=3 REFRAL_WARMUP=30 REFRAL_SAMPLES=120 \
  python3 artifacts/geometry-performance/lock.py node tools/external-benchmarks.mjs
```

Raw timing directories under `artifacts/external-benchmarks/` end in `09-21-31.543Z` (1e56f64), `09-26-22.654Z` (747b859), `09-28-51.209Z` (discarded host experiment) and `09-30-24.568Z` (final JS source). Each contains the build hashes, per-frame samples and captures. The fresh control, raw wire and GPU audits, profiles, test logs and aggregation script reside under `artifacts/sampled-binding-reuse/`. Run `python3 artifacts/sampled-binding-reuse/report.py` to verify PNGs and workload counters against task 131 and regenerate results.json. The audit runner uses the same benchmark command with entry point `artifacts/sampled-binding-reuse/audit.mjs`, one round, 30 warmup and one sample.

## Verification and delivery

The Mini passed doctor, pnpm check, ci:check, rust:build, the actual-Wasm matrix above, all 232 headless Chrome tests with one worker, the distribution build and test:dist. Six original CTS files under conformance/textures/misc passed on all three routes (18/18 file/backend runs): cube-map-uploads-out-of-order, mipmap-fbo, texture-complete, texture-size-cube-maps, texture-sub-image-cube-maps and texture-upload-cube-maps. The Mini retains raw CTS results in `artifacts/sampled-binding-reuse/cts/`. [Delivery PR 119](https://github.com/GhostFlying/refral/pull/119)
