# Recover conformance batches after a stalled browser

## Goal and ownership

Continue a 971-file run after an unresponsive official case, preserving upstream assertions, timeout settings, case identity, retries and available screenshot evidence. Task 085 owns the CLI runner, its checkpoint/recovery tests and the harness's dispatch of partial observations. The independent rendering task owns the cost of the many-draw-calls implementation.

The preceding full-run JS log in `artifacts/conformance/campaign/worker-navigation-shader-link/full/js.log` records index 655 complete, an unresponsive 656 on attempt one, and an exception from waiting a second time on the same failed Chrome close promise. The pinned upstream file is `conformance/rendering/many-draw-calls.html`.

- Own the test Chrome through a Playwright browser server and its actual spawned process, bind the endpoint to loopback, preserve automatic profile isolation, Chrome channel, headless mode and recorded launch arguments. Bound graceful teardown and recover using the owning server's process cleanup.
- Preserve received upstream results and partial observations on recovery, retain each attempt and any available captures, distinguish an expired deadline from a transport crash. Resume from checkpoint and rerun with a fresh owned browser. Do not alter the original file, its workload, upstream assertions or configured test thresholds.
- Run deterministic tests plus the unchanged 656 and its neighbors under the exclusive GPU lock for native, JS and Rust. Verify result IDs, counts, screenshots, retries and process exit. Exercise a stuck teardown separately if the real case completes without one. Keep all generated proof under `artifacts/conformance/campaign/browser-teardown/`.

## Recovery mechanism

Playwright 1.65's local BrowserServer supplies the spawned ChildProcess and owns the temporary profile and process group. The runner connects to its loopback Playwright endpoint and drives the same page/context fixtures. It records the spawned PID, complete launch argument vector, browser version and observed exit in launchHistory. Closing the connected client alone would disconnect it from the server. The runner instead requests BrowserServer.close and escalates through its owner's kill. For delayed launcher cleanup it waits for the owned child and POSIX process group to exit, then closes that child's inherited pipe endpoints. This allows a new independent browser to start even when a protocol or pipe cleanup promise had stayed pending. [Playwright BrowserServer lifecycle](https://playwright.dev/docs/api/class-browserserver), [connected browser semantics](https://playwright.dev/docs/api/class-browser#browser-close)

Before this change, index 656 in the JS full scan lost contact after index 655 passed. Teardown then terminated the entire run before its retry. In a first live iteration of this fix, BrowserServer.kill also exceeded 15 seconds. The subsequent OS-aware run showed the old Chrome groups actually exit, with the Playwright cleanup completing after releasing the pipes. `artifacts/conformance/campaign/browser-teardown/physical-exit/js/results.json` records two independent 656 attempts (9 and 10 observed passes, no observed assertion failures), terminal runner timeout and index 657 passing all 19 assertions. Each recovered attempt has its own observation and diagnostic data. A controlled loss of the browser transport instead produced a harness-error after two attempts, retained one positive assertion, then ran 657. Those injected-control results are in `crash-control/`, outside the original conformance results.

The case harness streams a first-context snapshot, throttled assertion counters and the official completion boundary before image capture/disposal. The runner retains partial counters only for the given attempt and marks incomplete counts. On retry it captures one identified case image while the original is still running. The final attempt can use this image with phase, elapsed time and observed assertion counts if its final screenshot is unavailable. A viewport whose case cannot be identified can be kept as a separate diagnostic file with case image status unavailable.

## Acceptance

Tested `f5668c5` on headless Chrome 158.0.8127.36 on Apple Metal using an isolated profile, a 5,000 ms official case timeout and the pre-existing page health and hard deadlines. The fixed 1.0.4 originals at indices 655–657 ran serially on each route.

| Original | Native | JS | Rust |
| --- | --- | --- | --- |
| line-rendering-quality (655) | 13/0 | 13/0 | 13/0 |
| many-draw-calls (656) | 12/0, finished | runner timeout twice, 9/0 observed each time | runner timeout twice, 9/0 observed each time |
| more-than-65536-indices (657) | 19/0 | 19/0 | 19/0 |

Counts are original passed/failed assertions. The partial attempts are separate observations and are never summed. Each backend has a case-specific image for all three URLs. The two incomplete 656 images show the original heading and the partially filled WebGL canvas. Their metadata identifies the running phase. The retry capture requests occurred 13 ms (JS) and 16 ms (Rust) after the runner start notification.

Reproduce with `pnpm conformance:run --backend all --start 655 --count 3 --timeout-ms 5000 --screenshots --output artifacts/conformance/teardown-check`. The campaign's assertions, retry evidence, PNGs and per-process launch/exit records are in `artifacts/conformance/campaign/browser-teardown/verified/`. A separate test sending SIGSTOP only to its owned headless Chrome confirms forced group termination, followed by a healthy replacement. Its script and results are in `owned-process-smoke.mjs` and `owned-process-smoke.json` in the campaign directory.

`pnpm check` passed type checking, 237 Vitest, 69 Node and 76 native Rust tests. The additional pipe-cleanup regression brought the deterministic Node total to 70 (`pnpm test:tools`). The `final-check.log` and `final-tools.log` files record the runs. This change unblocks complete inventories. The rendering cost and true timeouts of the 656 original remain a separate implementation problem.
