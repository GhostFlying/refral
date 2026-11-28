# 136 Sampled binding reuse

Reduce per-draw binding overhead on the task 135 Aquarium baseline. The single-frame audit on main 4761901 found 20,066 adjacent texture-group matches out of 20,110 creates. Own the browser host sampled group cache, Wasm batch encoder, adapter, protocol notes and regressions. Follow ADRs 006, 009 and 012 for ordered execution resources and independent image versions.

1. Reuse the preceding host group when its layout, ordered sampler objects and materialized GPU textures agree. Preserve pass binding transitions and current uniforms.
2. Measure logical binding matches within real Rust batches. Negotiate an optional sampled-texture reference, retaining exact version, dimension, face, level, order and sampling parameters. Keep legacy and direct replies complete. Exercise fresh and nested drains, texture changes, and protocol negotiation.
3. Verify with doctor, pnpm check, ci:check, rust:build, rust:test:wasm and single-worker headless Chrome. Compare both Aquarium sizes on this Mini with the task 131 harness and task 135 baseline. Collect three rounds of 30 warmup and 120 timed frames under the shared GPU lock. Verify screenshots, errors and draw counts. Use Animometer uniforms as the untextured control.
