# Runtime core selection experiment

Build the dependency-free Rust core with `node tools/core-selection-build.mjs`. Run Node measurements with `node tools/core-selection-run.mjs`.

The build uses the pinned Rust 1.94.1 toolchain and the `wasm32-unknown-unknown` target. Install a missing toolchain with `rustup toolchain install 1.94.1 --profile minimal --target wasm32-unknown-unknown`. `REFRAL_RUSTUP` can select an explicit rustup executable.

For Chrome, start the repository Vite server and import `runBrowserSelection` from `/experiments/core-selection/browser.mjs`. The function fetches `/artifacts/core-selection/core.wasm`, returns raw CPU samples and actual WebGPU correctness results, and releases its device. The integrating browser harness writes the returned object to `artifacts/core-selection/chrome-results.json`.

The interactive page is `/experiments/core-selection/index.html`. Its Run action displays all nine CPU comparisons and the real GPU verification count. `pnpm exec playwright test core-selection.spec.ts` exercises that interaction and saves the result, metadata, and screenshot.

## Workloads and paths

All paths receive the same seeded eight-word command records and payload bytes, emit twelve-word draw snapshots, and use the same JS output consumer. Workloads cover uniform updates, pipeline/layout cache metadata, storage generations, and immediate upload-byte hashing. The complete output snapshots are compared before timing, and a common checksum is checked during timing.

- JavaScript decodes commands and writes snapshots in a typed arena.
- Per-call Rust/Wasm decodes the trace in JS and invokes an exported command function for each command.
- Batch Rust/Wasm copies the command stream into linear memory and decodes it in Wasm.

Both Wasm paths include payload copying into linear memory. Browser GPU proof consumes all emitted snapshots with the same fixed WGSL, one scissored pixel per draw, and checks exact RGBA8 pixels after asynchronous readback.

Default sampling uses 512 draws per scene, five rounds, twenty warmup replays, sixty samples per round, and 128 replays per sample. Path order rotates within every sample, keeping candidate measurements close together in time. The longer sample interval reduces browser timer quantization. Results contain every sample. Wasm module compilation is measured once separately from instance construction. Build output is stripped release Wasm, and the build metadata records its compiler version and byte size.

## Interpretation

This is a bounded core and bridge experiment. Pre-recorded trace construction, full WebGL validation/object handling, application uploads, native host integration, and the production executor's complete work are outside the CPU samples. Upload hashing measures byte consumption with a deterministic result. Browser GPU proof independently validates emitted colors. Consult the ADR together with raw samples before choosing a production architecture.
