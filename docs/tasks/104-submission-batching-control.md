# 104. Task-end submission control for the original sustained-draw workload

## Goal and boundary

Measure whether publishing the default framebuffer at task end allows the renderer to complete the original file at index 656 under the pinned 20-second idle policy and default 30-second renderer health check. Compare actual JS and Rust/Wasm on the same headless Chrome build, compiler and GPU. The experiment changes observable canvas behavior and has no production API or runtime changes in its delivery.

## Plan and acceptance

Start from f1dac24, the equal-size resize fix. Search for existing evidence with the same draw count, timeouts and observation points. Run a source-only diagnostic patch that leaves all 505,000 GL draws intact, defers immediate default publication and preserves explicit flush and synchronous GL reads. Keep Khronos code and assertions unchanged. Record runtime counts, selected core and Wasm hashes, transfer epochs, original assertion/epilogue timeline and raw case screenshots. Run each backend independently under the shared headless GPU lock. Compare against actual production-mode measurements and include a native control for observable pixel values.

For each actual core, draw distinct colors in sequence, copying the source with the native Canvas2D method captured before context creation. Compare same-stack snapshots with GL readPixels, explicit flush and a task boundary. Save the original inputs, source patch, environment and measurements under artifacts/conformance/campaign/submission-batching-control. Report any semantic difference as a cost of the experimental policy. A result on the modified host is diagnostic only.

## Results

Both experimental cores finished the unchanged original script, including its dynamically fetched `js-test-post.js`. Headless Chrome 158.0.8127.36 used the Apple M4 Max / Metal adapter, a 20,000 ms idle timeout, 30,000 ms renderer health deadline and 600,000 ms absolute watchdog. Each backend ran with a fresh Chrome process, an isolated profile and one exclusive GPU slot. The default production policy remains immediate publication. These experimental observations are excluded from the 971-file production totals.

| Selected core | Draws | Queue submissions | Render passes | Passed/failed assertions | Original case duration | Epilogue request to response |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| JS | 505,000 | 100 | 200 | 12/0 | 5,992.5 ms | 2 ms |
| Rust/Wasm | 505,000 | 100 | 200 | 12/0 | 11,598.5 ms | 7 ms |

The control removes the call to `submitEncoded()` in `publishDefaultColor()`. Each core's existing microtask flush publishes the finished frame. The shared host still issues the real vertex draws, binds their individual uniform values and records 505,202 bind groups. Per-frame counters match the original sequence of 100, 200, …, 10,000 draws. Each frame records one render pass for the GL work, one presentation pass and one queue submission. Both backends reported zero GL assertions failed and zero validation errors, and saved a final case screenshot. The immediate host's earlier controlled trace spent 38.783 s inside Dawn ProcessEvents during a 39.022 s interval after the same epilogue request. See tasks 092 and 099 and `artifacts/conformance/campaign/draw-completion-trace/`.

### External pixel control

The control takes the native 2D method from the caller's realm before importing Refral. Each of the eight observations reads the complete 4×2 destination canvas. Rows below give its leftmost and rightmost pixels. All colors in this table have alpha 255.

| Observation | Native and immediate JS/Rust | Batched JS/Rust |
| --- | --- | --- |
| Initial black after explicit flush | black / black | black / black |
| Draw red in left half, same call stack | red / black | black / black |
| Draw green in right half, same call stack | red / green | black / black |
| After a synchronous GL readPixels | red / green | red / green |
| Draw blue across the canvas, same call stack | blue / blue | red / green |
| After explicit GL flush | blue / blue | blue / blue |
| Draw yellow, same call stack | yellow / yellow | blue / blue |
| After the scheduled microtask | yellow / yellow | yellow / yellow |

GL readPixels itself returned all four expected red/green pixels in both policies and both cores. Each batched core showed the previous publication at four of the eight native Canvas2D observation points. The application can already hold this native method, so patching its JS prototype at initialization cannot guarantee observation of every use. The WebGPU canvas snapshot algorithm waits for submitted work to write the public image. An unfinished private command encoder cannot supply the new image through that mechanism. [WebGPU canvas image contents](https://www.w3.org/TR/webgpu/#abstract-opdef-get-a-copy-of-the-image-contents-of-a-context)

### Disposition on 2026-11-20

Defer original #656 as a known performance issue in the default browser host. Record the decision in the campaign report and support matrix. Keep both production timeouts in the official totals and retain task-end batching as an experiment. Reopen when Chrome's queue processing changes or a host optimization can preserve same-stack canvas copies. Verify any candidate with the unchanged original under the pinned timeout and the red/green copy control above.

### Reproduction and evidence

Use a disposable worktree at `f1dac24d856c7c96dbf6be8402e0198872d7e2e2`, with pinned CTS dependencies, compiler and actual Wasm available. Apply the [experimental host patch](../../experiments/submission-batching/defer-publication.patch) from this task and run each command independently in the GPU slot. The instrumentation prints existing host counters at flush time.

```sh
pnpm conformance:run --backend js --start 656 --count 1 --timeout-ms 20000 --hard-timeout-ms 600000 --screenshots --output artifacts/conformance/104-js
pnpm conformance:run --backend rust --start 656 --count 1 --timeout-ms 20000 --hard-timeout-ms 600000 --screenshots --output artifacts/conformance/104-rust
```

The captured runs used an observer copy of the normal runner with the same watchdogs and reporting behavior. It logged counters, assertion progress and the epilogue network events. The source scripts, original source hashes, environment, raw logs, two original case screenshots and 48 direct Canvas2D observation PNGs are under `artifacts/conformance/campaign/submission-batching-control/`. `summary.json` records core selection, pinned binary hashes, counts, durations, screenshot hashes and observed differences. `summarize.py` checks the original assertions, every frame count and the eight observation points. The previous immediate-production measurements and the batched diagnostics retain their separate source identities and timeout policies.
