# Renderer work after the sustained draw workload

Identify the source of the delay following the last rendering callback in the unchanged original `conformance/rendering/many-draw-calls.html`. Task 092 measured the server's response and the renderer's receipt separately. Scope this investigation to observation of the headless browser, preserved CTS assertions, source mapping and the cost of immediate WebGPU submission. The HTML drawing surface and the synchronous public GL API keep their existing behavior.

## Measurement

A frozen `a7be1dc` build ran the original through the JS core on Chrome 158.0.8127.36, Apple Metal 3, with its normal 20-second inactivity watchdog and the separate 30-second page-health check. The official workload makes 505,000 GL draw calls over 100 animation frames. The runner attaches a browser-wide CDP trace to its isolated headless Chrome process, records a clock marker when it observes the request for `js-test-post.js`, and writes Vite's request and response times independently. The original page, harness assertions, shader programs and WebGPU runtime are unchanged. This diagnostic run has trace collection overhead. Its timings describe this run and remain separate from launch or rendering benchmarks.

Both attempts requested the final 1,293-byte script. Vite finished the corresponding HTTP 200 responses in the same wall-clock millisecond. The first attempt recorded 11 successful assertions before the page-health timeout. The second recorded 10, also timed out and retained an in-flight case screenshot. The final official assertion and completion callback would both be required to count the file as passed.

The first attempt produced a readable trace with the final request marker. Its remaining interval was **39.022 seconds**. On the active renderer main thread, 38,140 completed top-level tasks accounted for 38.862 seconds of wall time. Source locations on the scheduler events divide that interval as follows.

| Source on renderer main thread | Completed tasks | Sum of task wall time |
| --- | ---: | ---: |
| GPU return-data handler posting Dawn event processing at `webgpu_implementation.cc`, line 351 | 6,010 | 38.783 s |
| Mojo IPC `Accept` | 32,112 | 0.079 s |
| Other recorded top-level tasks | 18 | <0.001 s |

The first row accounts for 99.8% of the measured top-level task time after the request. A second complete trace stream was unavailable on teardown. The assertion counts, timeout and server log for that attempt are still present. Task 092's earlier extended-window JS run finished all twelve assertions. The normal-window result reported here remains a timeout.

## Mapping the trace to the installed browser

- Blink flushes the WebGPU command stream immediately in `GPUQueue::submit`. [Blink queue implementation at 158.0.8127.36](https://github.com/chromium/chromium/blob/158.0.8127.36/third_party/blink/renderer/modules/webgpu/gpu_queue.cc#L112-L124)
- Chromium handles the returned Dawn commands and posts a task running `DawnWireServices::ProcessEvents` to the renderer main thread. The post at line 351 is the location identified by the trace. [Chromium return-data handler](https://github.com/chromium/chromium/blob/158.0.8127.36/gpu/command_buffer/client/webgpu_implementation.cc#L338-L352)
- Chrome pins Dawn at `6e24542436a3ef58d4a1110f01712da9afbff3e3`. In that revision, each queue submission registers an internal work-done callback that advances its completed-submission index. Event polling walks the tracked futures to find ready callbacks. These internal callbacks exist even when Refral issues no JS completion promise for the individual draw. [Chromium dependency pin](https://github.com/chromium/chromium/blob/158.0.8127.36/DEPS#L451) · [Dawn queue at that pin](https://dawn.googlesource.com/dawn/+/6e24542436a3ef58d4a1110f01712da9afbff3e3/src/dawn/wire/client/Queue.cpp#104) · [Dawn event polling](https://dawn.googlesource.com/dawn/+/6e24542436a3ef58d4a1110f01712da9afbff3e3/src/dawn/wire/client/EventManager.cpp#133)

The trace establishes which posted tasks consumed renderer time. The association with the submitted workload follows from the pinned code and task 092's measured submission counts. The trace does not enumerate each private future or measure individual event-map lengths. Continue to verify upstream completion and ordered same-stack external Canvas2D observations for any change to immediate publication. Repeat the original on a newer browser when the queue or event-processing implementation changes.

## Evidence and reproduction

The timeline, source-matched observer, source extracts, gateway timings, per-attempt recovery records, final screenshot metadata and reduction scripts are under `artifacts/conformance/campaign/draw-completion-trace`. The main-thread reduction counts complete top-level task intervals once, starting at the recorded request marker. It does not add nested slices. `return-data.txt` stores the counts and durations in microseconds. The browser version, source hash, actual core and both Wasm hashes are present in `js/js/results.json`.

Place the archived `observe-epilogue-trace.mjs` next to `tools/conformance-run.mjs` in the frozen checkout. In the exclusive headless slot run `node tools/observe-epilogue-trace.mjs --backend js --start 656 --count 1 --timeout-ms 20000 --screenshots --output <directory>` with `NODE_OPTIONS=--require=<absolute-path-to-observe-local-server.cjs>`. Run `python3 return-data.py <timeline-file>` to extract the task counts. Use the stock `pnpm conformance:run` entry point for acceptance.
