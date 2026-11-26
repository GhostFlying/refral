# Reduce per-draw CPU costs on the heavy Three.js scenes

Start from dec0dcc, the default Rust command buffer. Measure each change independently on the same hardware and verify the actual core, workload, and pixels.

1. Return the JS current program directly after the context-loss guard. Preserve the program binding, retirement, wrapper identity and error order.
2. Add frontFace to the optional Rust batch numeric instructions. Select the instruction from a module capability at initialization. Preserve synchronous queries and errors and draw-time winding. Exercise the previous batch module and the older per-call module with the new reader.
3. Experiment with reusing prepared vertex layouts in the shared host. Only retain a change with reproducible whole-frame benefit and dependency-safe resource ownership.

The JS core, Rust batch adapter and decoder, their regressions, and shared host drawing are in scope. Use pnpm check, pnpm ci:check, pnpm rust:build, pnpm rust:test:wasm, the headless Chrome regression suite, production deployment check and targeted original conformance files. Archive each benchmark tree and its release module. Interleave native, JS and Rust on four-view Shapes and Triangle Cloud with 30 warmup frames and 120 samples per round. Report CPU p50 and p95 in ms per frame, replays, submissions and image comparisons. Raw evidence belongs in artifacts/render-hot-paths/.
