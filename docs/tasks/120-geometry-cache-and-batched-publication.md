# Geometry working sets and batched canvas publication

Deliver two independent changes from main 48c9fd6. Compare one native WebGL baseline and each intermediate JS/Rust version in one headless Chrome campaign with rotated variant order.

1. Admit complete reusable draw working sets in a bounded geometry cache. Protect the current draw's resident streams before evicting older entries and skip admission of an oversized set. The initial per-context ceiling is 32 MiB and 512 entries. Keep existing immutable version keys and completion-aware retirement. Validate reuse, oversized sets, overlap, mutation, existing Buffer and draw tests, and the heavy static triangle cloud.
2. Record default framebuffer work until the existing task-end submission or explicit flush. Keep GL-internal ordered operations and read paths. Document the accepted difference for same-stack native canvas consumers. Validate explicit and automatic publication, supported readPixels, FBO rendering, and native snapshots in the declared scope. Profile uniform buffer and bind group allocation inside one encoder before adding any allocator changes.

Test the 160,000-triangle cloud and four-view Shapes alongside native on the same poses and context attributes. Use three rounds, 30 warmup frames, 120 samples, an isolated page per variant, headless hardware Chrome and the exclusive local GPU slot. Report CPU p50/p95, rAF cadence, upload bytes, submissions, passes and image comparisons. Use a separate archive of each commit to avoid changing measured source mid-run.

Run `pnpm check`, focused Chrome and original CTS cases, and `pnpm build` plus headless deployment verification. Report original test behavior affected by the accepted canvas-observation difference. Raw results will be under `artifacts/geometry-batched-publication`.
