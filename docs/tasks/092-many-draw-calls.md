# 092. Sustained default framebuffer draws

## Goal and dependencies

Run the unchanged WebGL 1.0.4 conformance/rendering/many-draw-calls.html on native, JS and Rust. The fixed workload issues 505,000 draws in 100 animation frames. Preserve GL call order, same-task external Canvas2D snapshots, immediate readback and the runner's original timeout. Start from 087's submitted-uniform reuse and 085's recorded timeout recovery.

## Ownership and steps

The browser host owns GPU work and presentation. Use the current JS/Rust semantic paths and compiler. Measure the baseline on the current build, distinguish CPU and GPU/queue time and count WebGPU operations. Remove measured repeated GPU work or bound outstanding resources while retaining external visibility. Verify the original case and relevant presentation regressions through the serial headless harness. Keep intermediate measurements under artifacts/conformance/campaign/many-draw-092.

## Acceptance

- Run the unchanged official case with all three backends, retaining attempts, assertions and screenshots.
- Run pnpm check, build the actual Rust Wasm, and run affected real Chrome draw/canvas regressions with a single headless worker.
- Record timings in milliseconds, input sizes, submission/command counts, backend, build provenance and remaining limitations.

## Results on Chrome 158.0.8127.36, Apple M4 Max / Metal

The host now reuses attachment and swap texture views, uploads only stages that have reflected uniform data after the initial group is created, and sends aligned bytes directly to queue.writeBuffer. The Rust adapter uses the handle, storage generation and content version already carried in the draw packet to preserve immutable Buffer payload identity across adjacent draws. It retains at most the preceding draw's streams. GL commands still publish every default color mutation in call order. A same-task Canvas2D and readPixels regression checks three backends through uniform changes, bufferSubData and storage replacement.

The diagnostic workload uses the original vertex and fragment shaders, position attribute, matrix, per-tile vec3, 100×100 tile grid and a 256×256 visible canvas. It runs batches of 256, 1,000, 4,000, 10,000 and 10,000 draws. The two 10,000-draw batches on each run recorded these counts and CPU times. The CPU interval includes GL calls and flush. An immediate Canvas2D snapshot and waiting on the actual WebGPU queue follow the interval. Full samples, sampling code and renderer identity are in `artifacts/conformance/campaign/many-draw-092/`.

| Build | Core | Texture views per batch | Buffer writes per batch | CPU through flush (ms) | Additional snapshot and fence (ms) |
| --- | --- | ---: | ---: | --- | --- |
| 087 + 085 | JS | 30,003 | 20,003 | 340.6, 339.2 | 95.3, 173.9 |
| 092 | JS | 1 | 10,004 | 331.0, 324.9 | 86.6, 152.9 |
| 087 + 085 | Rust | 30,003 | 30,002 | 364.0, 380.9 | 103.7, 162.5 |
| 092 | Rust | 1 | 10,004 | 323.6, 318.0 | 89.3, 164.0 |

Each Refral batch still contains 10,001 immediate queue submissions and 20,002 render passes, including the initial clear. A one-pixel synchronous pacing read every 1,024 publications increased the original JS draw phase from about 22 to 27 seconds and still stalled at the epilogue. That experimental path was discarded.

The unmodified upstream file at index 656 performs 505,000 draws over 100 animation frames. Its final callback records “All draw calls completed successfully” and requests js-test-post.js. That script checks successfullyParsed and calls notifyFinished. The pinned harness has a 20-second inactivity watchdog, reset by a report. The historical campaign overrides it to 5 seconds. The external runner has a separate page-health and absolute deadline.

- With the historical 5-second window, Chrome native finished 12/0 in 1.69 seconds. The baseline JS and Rust both timed out with 10 positive assertions observed. On 092 JS completed 11 positive assertions before timeout, and Rust's runner observed 10. The recorded counts and screenshot statuses are under `baseline/` and `versions/`.
- The 20-second upstream window on the JS candidate recorded the 11th assertion after about 22.4 seconds. The page triggered its inactivity watchdog about 32 seconds later as the epilogue response arrived. GPU fence completion took another 203 ms, the validation scan found zero errors, the screenshot took about 119 ms, and disposal about 25 ms. The phase trace is under `phases/`.
- In a separately declared 120-second observation window, JS completed all 12 original assertions, finished normally, and saved a final case screenshot. The 11th assertion occurred at 22.31 seconds, followed by a 27.45-second request-to-response interval for the epilogue. The final successfullyParsed assertion and upstream finish occurred at 49.90 seconds, followed by an 18-ms GPU fence, 106-ms screenshot and 25-ms disposal. The recorded case duration excluding capture was 49,768 ms. See `extended-window/js/results.json` and `extended-window/js.log`. The renderer main thread remained active in a longer baseline sample. The specific internal browser activity causing this interval has not been identified.
- Rust's longer baseline trace reached the last upstream animation callback after 27.4 seconds. Its first 120-second-health attempt timed out before the final official assertion. The diagnostic run relinquished the exclusive GPU slot after this observation. Rust's extended-window pass is still unverified.

The reports keep each timeout policy separate. Only a finished upstream file counts for its policy. The optional per-frame/phase timing diagnostic preserves the pinned suite sources, uses a 600-second absolute deadline, and stores its runner and timeline with the case. Run `pnpm conformance:run --backend all --start 656 --count 1 --timeout-ms 5000 --screenshots` for the historical gate.

`pnpm check` passed all 240 Vitest checks, 76 native Rust checks, tool tests and the support matrix. Real Wasm passed 52 integration checks. The new Canvas2D and readPixels tests and the existing ordered-uniform tests passed on native, JS and Rust. Two lifecycle assertions outside these changes still expected the pre-VAO extension list at this baseline. Task 096 owns their updated expectation.

Integration retained the existing HTML visibility check before reading the current swap texture. Acquiring a new WebGPU texture marks the canvas dirty and replaces the prior backing. An invisible connected canvas must keep the existing backing when a read observes its canonical buffer. The timings above identify the feature candidate on which they were measured.
