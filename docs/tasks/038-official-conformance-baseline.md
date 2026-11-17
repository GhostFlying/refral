# Official WebGL1 conformance baseline

Local acceptance passed on 2026-11-18 from `main@5b3d8cd`. The user approved connecting the official `webgl-conformance-tests.html` runner, running the complete pinned WebGL1 inventory on native, JS and Rust, and producing a failure dependency report. Browser execution was headless.

## Scope and success

Self-host the unchanged official runner, harness, lists and complete dependencies from Khronos revision `39443210f7f81db4773eb104facadfb85d05dfa4`. Select WebGL conformance version 1.0.4 with slow tests enabled and one iframe. The official parser enumerates 971 unique HTML entries. Preserve upstream assertions and test identities. Initialize the compiler, device and core before each selected-core test starts. Synchronous HTMLCanvas WebGL acquisition enters the selected core and records its provenance. Record OffscreenCanvas and worker adapter gaps in the affected results.

Run all 971 original entries through native, JS and Rust/Wasm. Preserve checkpoints, original outcomes, assertion counts, bounded failure messages with truncation counts, browser and GPU diagnostics, core selection, context attributes, launch arguments, source revision and Wasm hashes. Recover from browser process failures and resume pending URLs. Keep the deterministic required CI scope lightweight.

Finish with reproducible commands, a complete per-file/per-backend baseline, module totals, failure dependency clusters and a spec-driven next implementation order. Fix runner/acquisition/injection failures required to obtain the baseline. Runtime feature expansion follows independently scoped tasks.

## Ownership and steps

Integration owns tools/conformance-run.mjs, package commands/configuration, documentation/support, shared interfaces, all browser/GPU execution and Git delivery. The acquisition worker owns tools/deps-conformance.mjs and its source manifest logic. The adapter worker owns tests/fixtures/conformance.html, conformance.ts and conformance-init.ts. The reporting worker owns tools/conformance-report.mjs and bounded deterministic report tests. Each concurrently edited file has one writer.

1. Fetch the pinned source archive and record source/license provenance. Resolve official lists using the original harness parser.
2. Add a local entry that hosts the unchanged official runner. Install context/bootstrap and report hooks before original test execution. Native testing retains its original context implementation. Per-file selected factories initialize asynchronously before official startTest and dispose at finish. Keep test assertions and scheduling identity intact.
3. Add a headless Chrome CLI with one GPU window, backend/URL-range selection, periodic checkpointing, timeout/crash recovery and resumability. Run smoke cases before the complete baseline.
4. Generate raw results and failure-cluster summaries. Verify existing accepted21 originals through the official entry, then complete971 by3.
5. Update roadmap/support with measured coverage, adapter limitations and next dependencies. Verify deterministic checks, relevant browser regression and delivery through current-head ci/required, rebase merge and main CI.

## Result contract

Each case result records its official index, URL relative to `sdk/tests`, backend, status, completion, assertion counts, original failure messages, truncation count, diagnostics, context provenance and duration. Completion is `finished`, `timeout`, `crash` or `capability-error`. File status is `pass`, `fail`, `skip`, `unsupported`, `timeout` or `harness-error`. Full inventory counts include every original URL even when initialization or browser execution fails. Every run records the source and runtime revisions, settings and Wasm hashes.

The parent integration page exports window.conformanceSession with ready(), inventory, run({start,count}), progress and results. The init script receives the selected backend and injects synchronous context acquisition only where the parent bridge is available. Official TestHarness hooks call the bridge before start and before finish, then preserve the upstream method behavior. Worker creation is recorded as an adapter coverage gap until worker WebGL provenance is supported. Offscreen WebGL acquisition for JS/Rust reports its capability gap. Ancillary native extraction remains inside the parent facade module.

## Acceptance commands and evidence

Use `pnpm conformance:deps`, `pnpm conformance:run`, `pnpm conformance:report`, `pnpm check`, `pnpm ci:check`, `pnpm test:chrome`, `pnpm build` and `pnpm test:dist`. Browser commands use `REFRAL_HEADLESS=1` and installed Chrome. Artifacts live under `artifacts/conformance` with source provenance, per-backend checkpoints, per-file results and aggregate reports. Delivery records the PR head, required check and integrated main results.

## Bootstrap and initial evidence

The unchanged official runner enumerates971 entries in every backend. Initial three-file and accepted21-file smoke runs pass through the official page on all three backends, with2433 original assertions per backend. The final adapter also validates native HTMLCanvas context receiver/DOMString conversion and mode exclusivity before dispatch, preventing boxed/object contextId values from obtaining an untracked native WebGL context. The document-start init backend marker is required before the local integration page constructs the official iframe. The top-level facade module retains its native image-extraction context path.

The source command installs5224 official sdk/tests files plus LICENSE, with per-file Git blob/size verification and SHA256 provenance. Original file bytes are served through a static Vite middleware with HEAD/media-range support. Deterministic regressions cover immutable source responses, source acquisition, official-counter overlap, missing/duplicate result denominators, core provenance and checkpoint runtime/backend/URL identity. All browser processes are owned headless Chrome instances. The CLI retains the official20-second idle watchdog and a600-second hard deadline, rotates browser contexts after32 files, and records interruptions/recovery.

## Initial full-run correction

The first native exploration reached384 entries and exposed7 adapter errors attributed to the following file. Native cleanup called WEBGL_lose_context after an original file finished. Original lost/restored listeners then resumed and reported to the dequeued URL, producing upstream unknown-test errors. The official runner normally retires that document through navigation. Remove this explicit native loss, retain metadata capture and browser-context rotation, and restart the baseline with the updated adapter fingerprint. Initial evidence is retained under artifacts/conformance/diagnostics/native-cleanup-initial.*. The original accepted21 files already pass through the official page on all three backends.

The interruption experiment sends SIGTERM to the owned CLI after its first saved case. It exits143, releases the Vite port, and resumes with unchanged records/fingerprint. Runtime fingerprints include actual package sources, dirty source bytes, core/compiler Wasm, runner/bootstrap source, HEAD, Chrome and Playwright. CPU and real interruption evidence are retained under artifacts/conformance/interruption.

## Realm correction and triage boundary

The broader exploration exposed a parent/child realm mismatch in getter containers. The parent factory returned real Float32Array values to the original child document. In gl-vertex-attrib.html all160 failures were instanceof checks, with numeric assertions passing. The selected-core document adapter now caches a child Proxy per raw context and copies only the specified getter Array/TypedArray containers into captured child intrinsics. Typed arrays copy bytes, preserving signed zero and NaN payloads. Resource elements, raw context ownership, exceptions and ordinary method identities remain unchanged. Native uses its original context. A dedicated three-backend index9 run validates this correction before the fresh complete baseline. Original failing evidence is retained in diagnostics/realm-initial.

Separate verified runtime dependencies remain in the measured baseline. The shared facade synthesizes unknown member functions, which makes the pinned wtu.isWebGL2 duck-typing probe true through drawArraysInstanced. Enabled unconsumed attributes without buffers lack required draw validation. Canvas requested preserve behavior, synchronous Canvas2D/export consumption and drawing-buffer size limits have observed failures. Pinned ANGLE WGSL lowering has vector/scalar builtin and expression gaps. These are recorded for subsequent specification-driven tasks, preserving the runtime baseline under test.

The targeted realm regression passes on native1241/0, JS633/0 and Rust633/0. Different declared attribute limits produce different original assertion counts. The immutable raw typed-array transfer preserves all numeric checks. The final complete baseline restarts from index0 after both adapter corrections, with fresh fingerprints.

## Capability-barrier termination

The strict original watchdog run shows repeated OGLES files terminate their asynchronous script at an uncaught NotSupportedError for TRIANGLE_STRIP, then produce no additional assertions during the20-second idle watchdog. Preserve this strict evidence. The exploratory baseline may finalize a file after a100ms grace following an uncaught page/promise NotSupportedError, marking completion capability-error and status unsupported. Caught acquisition diagnostics and ordinary assertion failures retain original execution. Native uses the original watchdog. The result records that remaining assertions are blocked, retains exact observed counters, and includes the original exception. A --wait-unsupported option retains the original timeout behavior for reproduction. Fingerprints distinguish both settings.

This is an explicit termination outcome for an unsupported original URL. It contributes to the full attempted-file denominator and to the unsupported column. Passed files still require normal original completion. Verify an OGLES barrier against the retained strict run before starting the final complete baseline with this setting.

## Browser teardown correction

The sequential run checkpointed all 971 native and JS files. The Playwright launch-server teardown stalled between JS and Rust, with the Chrome parent gone and the Node runner still holding its WebSocket listener. After an unsuccessful SIGTERM, the owned Vite and Node processes were stopped. Rust ran separately with the same baseline driver and completed all 971 checkpoints before the teardown stall recurred. The three sets of checkpoints have the same fingerprint and zero per-file recovery attempts.

The delivered driver uses Playwright's direct Chrome connection, records the owned browser PID and command through CDP, bounds teardown and verifies process identity before any shutdown fallback. The headless verification interrupted after four native checkpoints and observed exit 143 with the Vite port released. Resume reused those four results and finished 12 original files per backend with the same statuses and assertion counts as the baseline. The resumed driver exited 0 and released the port again. Evidence is in `artifacts/conformance/teardown-verification/verification.json`. The full baseline retains the pre-correction driver SHA-256 and a copy at `artifacts/conformance/baseline-driver.mjs`.

## Local acceptance results

- Collected and validated 2,913 official outcomes. Native passes 968 files, JS 566 and Rust 571, with 565 shared passes. All 21 focused originals pass on every backend with 2,433 assertions each. The results and next dependencies are in the [baseline report](../validation/2026-11-18-official-conformance.md).
- `pnpm check` and `pnpm ci:check` passed, including 226 JS unit tests, 57 conformance tool tests and 75 native Rust tests.
- `pnpm compiler:test` passed 45 cases and `pnpm rust:test:wasm` passed 46 actual-Wasm cases.
- `pnpm test:chrome` passed all 122 tests in headless Chrome. `pnpm build` and `pnpm test:dist` passed the built probe, three-path RTT and triangle, synchronous readPixels, DOM uploads, CubeMap and packaged-artifact checks.

Full results, source provenance, tool logs and the delivery receipt are under `artifacts/conformance`.
