# Draw snapshot allocation and batched reply reuse

Base: e2c7a28. Keep the public WebGL contract, the per-draw state and resource versions, and both cores' validation unchanged. See the shared core contract and ADRs 005, 006 and 014. The original feasibility measurements are in artifacts/draw-snapshot-study/report.md.

1. JS core: store each owned uniform snapshot in a never-overwritten part of a bounded page. Check queued snapshots across draws, page rollover, large blocks and release. Measure retained backing storage for sparse and dense consumers and observe memory on animated scenes.
2. Rust raster: use a negotiated batch entry point to reference the preceding draw's identical raster bytes in this drain. Preserve the legacy batch and individual draw protocols and reject invalid references. Check changes to viewport, masks, depth and blend, including the first draw after a drain.
3. Rust geometry: independently reference matching vertex/index descriptors including versions, offsets, formats and constants. Keep complete descriptors on misses. Check buffer updates, VAO switches and lifetime of buffered data.
4. Integrate the three atomic changes in order. Use pnpm check, pnpm ci:check, pnpm rust:build, pnpm rust:test:wasm, headless Chrome, dist and affected original CTS. Measure native, the parent and each affected production revision on the same hardware in alternating order. Report raw samples, CPU ms/frame p50/p95 and the zero-geometry-hit Shapes workload.

The integrating owner maintains runtime code, protocol documentation and final results. The performance runner and verification fixtures have separate owners. All hardware runs use the exclusive GPU lock and headless Chrome.
