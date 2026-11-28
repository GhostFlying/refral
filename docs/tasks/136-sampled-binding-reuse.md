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
