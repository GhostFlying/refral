# ADR 001 — TypeScript core for the first Chrome slice

Status is historical for the initial JS prototype. [ADR 003](003-parallel-cores.md) establishes the current parallel-core direction.

## Decision

Use TypeScript for the production semantic core in the first Chrome slice. Keep GPU object ownership in the browser host and ANGLE compilation in its Wasm module. Retain the executable Rust/Wasm selection experiment for future runtime and transport decisions.

The selected core remains independent of compiler language and host GPU object types. Resource identities, generation tracking, validation, and ordered draw snapshots are production-core responsibilities.

## Experiment

The experiment runs three seeded traces with 512 draws each. Traces cover uniform/draw snapshots, pipeline/layout cache metadata, and dynamic upload-byte consumption with storage/content versions. JavaScript, per-command Rust/Wasm, and batch Rust/Wasm produce identical complete twelve-word draw records and feed the same JS output consumer.

Each path has twenty warmup replays followed by five rounds with sixty samples per round and 128 replays per sample. Candidate order rotates for each sample. The decision evidence is preserved in the write-once, read-only snapshots `artifacts/core-selection/decision-node.json` and `artifacts/core-selection/decision-chrome.json`. Routine runs write `node-results.json` and `chrome-results.json` alongside these snapshots.

The browser separately consumes all emitted records using one fixed-WGSL WebGPU executor. Each draw writes one scissored RGBA8 pixel using its saved uniform color. All nine scene/path combinations passed exact asynchronous pixel comparison, totaling 4,608 draws. CPU timing ends independently of GPU encoding and readback.

## Evidence and interpretation

Measured environments include Node 24.14.0/V8 13.6 on Darwin arm64, Apple M4 Max, and installed Chrome 157.0.8103.51. Chrome reports a hardware Apple `metal-3` adapter with `isFallbackAdapter=false`.

The Chrome decision snapshot comes from the 2026-11-13 00:35 UTC+8 run in the single-worker integration suite. Its complete suite passed 26 Chrome tests. The Node decision snapshot was collected on 2026-11-13 at 00:13 UTC+8. CPU medians below are milliseconds per 512-draw trace from the preserved Chrome snapshot, including the common JS consumer, rounded to six decimal places.

| Scene | JavaScript | Rust/Wasm per command | Rust/Wasm batch |
| --- | --- | --- | --- |
| Uniform/draw snapshots | 0.013281 | 0.011719 | 0.009375 |
| State/cache metadata | 0.015625 | 0.017969 | 0.014063 |
| Dynamic upload consumption | 0.097656 | 0.091406 | 0.085938 |

The corresponding Chrome p95 values are 0.043750/0.042969/0.040625, 0.042969/0.045312/0.041406, and 0.121875/0.114844/0.110156 milliseconds in the same column order. The preserved Chrome result includes all 2,700 raw samples and nine GPU proof records. The Node snapshot preserves its own 2,700 raw samples, environment, build metadata, and sampling configuration.

Rust per-command results vary by workload. State/cache traces consistently show higher cost in the per-command Rust path. Uniform and upload traces show smaller or workload-dependent Rust benefits. Batch replay improves the small core but introduces a different production input-batching requirement.

TypeScript is the first-phase choice because it directly matches the per-call browser facade and JS executor, and the measured per-command Rust path has mixed costs. The full WebGL validation, resource model, and transport costs remain to be measured in integrated scenes. This decision applies to the Chrome first phase.

The stripped Rust Wasm artifact is 4,997 bytes. Each instance reserves 3,866,624 bytes of linear memory for fixed-capacity input, payload, output arenas, and stack. This is a measured memory-buffer size. The JS output/cache/color typed arenas total approximately 393,488 bytes, excluding input traces, engine objects, and VM overhead. These values describe the experiment's capacities.

## Limits and reproduction

- Input traces are prepared before timing and remain immutable during replay. Public WebGL argument adaptation and input stream construction are outside these samples.
- Both Wasm paths copy payload bytes into linear memory. Batch mode additionally copies the pre-recorded command array. A direct-host production upload path has a different cost structure.
- Upload hashing provides deterministic byte-consumption work. The common GPU proof validates saved colors. Full pipeline state and resource-version equality are checked in CPU records.
- Samples include observed browser timer quantization and scheduling interruptions. Every sample is retained. Tail values and cold-start values near the clock resolution require cautious interpretation.
- Wasm module compilation is timed once separately from instance construction. GPU duration and driver memory are unmeasured. Browser command-line availability is recorded in each run.
- The common executor verifies this bounded trace. Integrated WebGL correctness, CTS coverage, native engine behavior, and end-to-end speed are measured by their dedicated suites.

Run `pnpm core:build`, `pnpm core:bench`, and `pnpm exec playwright test core-selection.spec.ts`. The experiment uses pinned Rust 1.94.1 with `wasm32-unknown-unknown`, without third-party Rust crates. The Chrome test records source/Wasm hashes, build metadata, adapter information, raw samples, page/console errors, and a screenshot.

The browser's CDP command-line query reported that `--enable-automation` was absent. Its full arguments are recorded as unavailable, with the protocol error retained. The test suppresses the Vite hot-reload client during sampling and records that test-adapter change. Page identity, visible result rows, the Run action, absence of overlays, and page/console health are asserted. The resulting screenshot was visually inspected.

Future Rust evaluation should use the integrated public facade and real upload paths, or the actual native host transport, with the complete supported semantics and the corresponding baseline. Batch input construction and output bridge work belong in that comparison.
