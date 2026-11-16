# DOM texture inputs and CTS expansion

Status is running from main 68f8912 on 2026-11-16. The user authorized PR1 through PR4 and requires headless browser execution throughout.

## Goal and scope

Implement the shared WebGL1 Texture2D level-zero RGBA/UNSIGNED_BYTE DOM-source overloads for ImageData, HTMLCanvasElement, OffscreenCanvas and HTMLImageElement. Both actual semantic cores retain GL validation, errors and versions. The facade owns DOM brands, conversion, extraction and caller-source snapshots. The host owns GPU uploads, source-canvas submission/presentation and retirement.

Retain the pinned WebGL/IDL/GLES/CTS revisions. Map input conversion, validation order, source readiness, origin-clean checks, pixel store, colorspace and source consumption before implementation. Whole original DOM CTS generators include CubeMap, which remains a recorded dependency. Shared source-derived scenarios accept this bounded Texture2D input profile.

## PR sequence and ownership

1. PR1, task030, correct dated support descriptions and activate original gl-geterror, gl-getstring, gl-initial-state and buffer-data-and-buffer-sub-data. The integrating agent owns documentation/support and delivery. The CTS worker owns fixtures.lock.json, tests/fixtures/cts-runner.ts and tests/chrome/cts.spec.ts.
2. PR2, task031, implement the common DOM input contract and ImageData behavior. Freeze shared contracts after the specification audit. Assign JS, Rust and verification work by exclusive file ownership. The integrating agent owns facade/contracts and integration.
3. PR3, task032, accept Canvas, OffscreenCanvas and image sources, source-canvas ordering, origin/decode behavior and colorspace/alpha conversion. The integrating agent owns source-host coordination. The verification worker owns bounded browser fixtures and local origin resources.
4. PR4, task033, complete full regression, built deployment, DOM upload performance samples, documentation/support and the stage report. Record actual results and limitations, then deliver through current-head ci/required and rebase merge.

The integrating agent serializes shared-file edits and all browser/GPU execution. Read-only JS/Rust specification/interface audits may run during PR1. Each implementation task records its final contract, owned files, commands and evidence before code changes.

## Browser and delivery constraints

All browser, deployment and benchmark commands explicitly set REFRAL_HEADLESS=1 and use the installed chrome channel, an isolated profile and one worker. Verify the actual hardware adapter and preserve the mode/launch arguments in results. Browser processes and task-owned servers are cleaned up after each run. Performance measurement has an exclusive window.

Keep required Actions lightweight. Run actual Wasm, GPU/CTS, deployment and performance locally or through existing optional entries. Use existing user Git identity, lowercase feat/fix/refactor subjects, atomic commits and linear rebase integration. Complete each authorized PR and verify its main CI before advancing.

## Acceptance and handoff

PR1 targets eighteen complete original CTS files with per-backend actual assertion counts and branch observations. PR2/PR3 use native/JS/Rust public calls, fixed expected state/errors/pixels, mutable-source snapshots, two-draw updates, alpha/pixel-store/origin rules, target changes, lifecycle and current-frame source-canvas contents. Retain existing drawing/readback regressions.

PR4 records context/resource preparation, first completed upload/draw, steady-state CPU p50/p95 with units and sample boundaries, upload/creation/submission counters, raw samples and source/build/browser/adapter provenance. Save artifacts under artifacts/dom-input. A dated report and delivery.json record the four PRs and integrated heads.
