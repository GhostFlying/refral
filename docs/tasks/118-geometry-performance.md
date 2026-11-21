# Geometry performance on Marching Cubes

Improve shared vertex materialization, retain reusable vertex/index GPU Buffers, then remove full geometry payloads from Rust draw replies. Compare each intermediate version to its immediate predecessor on the continuous Marching Cubes workload. Repeat the static Shapes workload to verify cache reuse. Base on 31bd898 and the packed-float experiment in `artifacts/performance-analysis`.

1. BrowserHost owns the packed FLOAT path. Keep the generic path for formats, missing components, indexing and stride that need transformation. Check matching component count, valid size and offset, byte order and exact covered range before using source bytes. Cover the path through both real cores and the native image comparison.
2. BrowserHost owns persistent geometry resources. Both cores supply immutable Buffer version identities. Keep reuse bounded and retire evicted resources only after submitted work has completed. Transient draw resources keep their existing submission lifetime. Verify repeated static draws, mutation, buffer replacement, index type/layout, retained VAO references and context teardown.
3. Rust core and Wasm transport own draw Buffer metadata and a checked lookup for the corresponding linear-memory bytes. The adapter owns any byte snapshot it hands to BrowserHost and reuses it for repeated references. Preserve public inspection copies, raw index/range validation, error behavior and context isolation. Bump the private ABI and verify build/deployment consumers. Record the remaining copy costs.

The primary comparison uses one actual Chrome GPU worker with headless Chrome, isolated browser profiles, fixed 800 × 600 rendering, 30 warmups, 120 samples and three rounds. Rotate order across builds and backends. Keep the draw workload and final pixels identical. Report CPU render + flush p50/p95, full frame CPU p50/p95 including geometry generation, geometry/total upload bytes, Buffer allocations and Rust draw reply payload. Save raw samples and images under `artifacts/geometry-performance`. Separately check cache performance on Shapes, where geometry stays unchanged. Record diagnostic probes independently of committed variants.

Run `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm`, focused Chrome differential/CTS/Three.js coverage and the built deployment checks. Record source and Wasm identity per stage. See [vertex-input rules](../adr/011-vertex-input-and-topology.md) and the [Buffer contract](../core-api.md).

## Smoke results

Packed FLOAT lowered steady render and flush CPU p50 from 3.22 to 0.88 ms on JS and 3.23 to 1.40 ms on Rust in the 15-warmup/45-sample paired Marching Cubes run. Workload, uploaded bytes and final pixels matched.

The persistent cache smoke retained zero repeat geometry uploads in Shapes (from 599,228 bytes/frame on JS and 614,935 bytes/frame on Rust). Marching Cubes still uploaded three new attribute versions per frame. The paired draw workloads and pixels matched in both demos. The host bounds retention to 512 entries and 8 MiB per context and sends evictions through completion-aware retirement.
