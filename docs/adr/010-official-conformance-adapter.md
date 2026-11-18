# ADR 010 — Official conformance runner integration

Status is accepted on 2026-11-18 for [task 038](../tasks/038-official-conformance-baseline.md).

## Source and execution

Self-host the pinned Khronos `sdk/tests` subtree and its original `webgl-conformance-tests.html`, `webgl-test-harness.js` and test lists. Verify every installed file against the Git tree and record hashes and license provenance. Serve original bytes through the conformance asset middleware, including media ranges. The original parser enumerates 971 WebGL1 HTML entries for version 1.0.4 when slow tests are enabled.

The integration page creates the original runner iframe after its backend probe factory is ready. A document-start script installs report and context hooks before upstream scripts execute. It wraps the exported `TestHarness` constructor and preserves its prototype and static behavior. Original `startTest` executes after a per-file selected factory initializes. Original completion executes after result capture and selected-factory disposal. The official page retains its list parser, URL order, assertions, report callbacks, test scripts and scheduler.

The local selected-core entry uses the conformance CLI and its Playwright document-start installation. An initialization marker detects absent or mismatched bootstrap before the integration page creates the official iframe. Native Chrome and both actual semantic cores run through the same selected official URL inventory.

## Context and ownership

HTMLCanvasElement and same-thread OffscreenCanvas acquisition validate the native receiver brand and convert the context ID before dispatch. OffscreenCanvas uses its own context ID enum. Boxed strings and custom conversion objects enter the selected-core gate. Context mode conflicts and repeated acquisition retain their native slot behavior. The per-file prepared factory creates both canvas types on demand, synchronously. Each context record identifies the surface type, actual core, attributes and adapter. Parent-module Canvas acquisition remains available to the accepted native HTMLImage extractor.

Selected-core getter Array/TypedArray containers cross the parent-factory boundary through a stable child-realm context Proxy. Captured child intrinsics construct the return containers, with raw-byte typed-array copies and shallow Array copies. Resource wrapper identities, exceptions and ordinary method identities retain their original values. Realm transfers are counted per result.

The document-start hook covers same-thread canvas instances, including ones constructed after the original script starts. A same-origin classic dedicated worker under the pinned suite starts at its script path with adapter query parameters. A same-origin Blob worker snapshots the original Blob at construction and loads its original bytes in a Blob-backed worker. Workers that spawn further workers report the nested script, depth and actual context and drain the children before acknowledging completion. Its worker realm loads the selected factory, installs the canvas hook, and calls native `importScripts` for the original bytes at the original URL. Relative imports keep the worker's original base directory. The constructor snapshots any messages and transfer lists posted during startup, preserving immediate detachment. Original replies pass directly to the test. The worker reports its ready state, actual core, canvas type and adapter and drains GPU work before termination. A verified CPU worker can complete with zero WebGL contexts. Missing acknowledgements, core mismatches and unsupported worker sources remain identifiable in the per-case result.

Each file owns its selected factory and concrete resources. A separate factory supports the original runner's context probe. Native cleanup captures metadata and relies on official iframe navigation and browser-context rotation. Synthesizing native context loss at completion would invoke upstream loss listeners again. Delayed completed-frame diagnostics retain their originating file identity.

## Results and recovery

Record one result per official URL and backend, preserving original pass, fail, skip and timeout counters. Original skipped results overlap the failure counter. Store `failed - skippedFailures` as `effectiveFailed` and `passed + failed + assertionTimeouts` as `totalAssertions`. Retain the first 200 original failure messages and the exact number omitted. Record errors, core provenance, adapter gaps and delayed diagnostics.

The CLI checkpoints completed cases atomically and validates backend, index and URL identities on resume. Its fingerprint includes runtime source bytes, HEAD, adapter and runner source, compiler and core Wasm, Chrome and Playwright. It rotates browser contexts after 32 files, retains the official 20-second idle watchdog, and provides a 600-second hard deadline plus a separate deadline for an unresponsive page. Recovery retries an interrupted case in a fresh browser before recording a terminal outcome. The result marks browser failures with unavailable partial counters.

Exploratory selected-core execution can end a file 100 ms after an uncaught page or promise `NotSupportedError`. Caught diagnostics and original completion within that period retain their usual behavior. Early termination preserves observed counters and the original exception, sets `upstreamCompleted=false` and records `completion=capability-error`. The original timeout hook advances scheduling. The `--wait-unsupported` option retains the original idle watchdog for all files. Native always uses the original watchdog. A passed file requires normal original completion.

The CLI owns headless Chrome and its local Vite process, handles interruption and closes both. Full baseline execution remains local or optional. Required Actions add only deterministic acquisition/adapter/report/checkpoint regressions.

## Interpretation

A complete baseline contains all 971 original URLs for each of native, JS and Rust. Evidence-pattern clusters identify dependency candidates for specification review. Native failures retain paired observations. Future feature and semantic fixes follow the observed baseline and pinned specification assertions.

Task 080 passes the requesting realm and its existing getter-container conversion to the prepared factory. The harness returns the real facade to the page. Reading and invoking an operation from its prototype exercises the same receiver checks as the normal public entry point. Tracking and result-container conversion preserve the per-case provenance.
