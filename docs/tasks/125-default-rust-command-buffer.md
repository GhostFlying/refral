# Enable the Rust command buffer in drawing contexts

Promote the batch v1 transport from task 122 on main at 66d8b6f. Every Rust drawing context, including contexts from a prepared factory, restored contexts and workers, selects the batch protocol when the loaded ABI7 module supplies it. Older ABI7 modules use their existing per-call path. The factory keeps JS as its default core.

Own the Wasm adapter, facade/host ordering boundaries, benchmark route reporting, tests, and adapter documentation. Keep the current wire encoding and Wasm exports. Inspect synchronous error/query/readback, uploads, canvas resize and transfer, auto/explicit submission, multiple contexts and loss/disposal. Verify earlier draw snapshots survive state and resource changes. Record host observations at the transport boundary when testing deferred work.

Run `pnpm check`, `pnpm ci:check`, `pnpm rust:test:wasm` against current and pre-batch ABI7 modules, all headless Chrome regressions, `pnpm build`, `pnpm test:dist`, the task 124 original CTS selection and the heavy scene benchmark through the public factory. Check batch counters and pixels. Store logs under `artifacts/default-rust-batch/` and compare original outcomes to task 124. Deliver through the required PR check and rebase merge.

## Acceptance

The default adapter uses the existing binary writer and replay implementation from PR 106. The benchmark reads the actual transport counters from the public context. Its setup no longer enables a private benchmark route. Rust draws preceding an HTML width/height assignment are replayed before the host handles the assignment. Coverage includes a width round trip, opposite sides of a scissor clear, and retention across an equal-size assignment while work is pending. The Wasm fixture drains at the points where it inspects host operations. Browser clear diagnostics measure call CPU time and read the probe count after the preceding clear reaches the host.

The release module has ABI7, batch protocol 1 and SHA-256 62cc4f7394d3567252eefac6aa149ee5b26fa7f92f30c23f53fd0cec986b44a9. The current and pre-batch ABI7 modules each passed 58 actual-Wasm tests. The complete headless Chrome suite passed 225 tests. The production build and packaged three-path drawing, readback and deployment suite passed. Local deterministic and CI policy checks passed. All 46 selected original files matched the task 124 baseline per backend by outcome, completion and assertion counts. Native passed 46, JS and Rust each passed 45 and retained the known same-stack Canvas2D observation failure in clear-default-framebuffer-with-scissor-test.html.

## Public factory comparison

The archived parent 66d8b6f and rollout implementation 8c06780 used identical Wasm and compiler binaries on Apple M4 Max in headless Chrome 158.0.8127.88, with exclusive GPU access. Each of three rounds used 30 warmup frames and 120 sampled frames per scene and route. The table gives median-of-rounds CPU p50 / p95 in ms per frame, including animation, Three.js rendering and flush. Capture and completion waits fall outside the interval. Scene inputs and poses matched between all routes, with byte-exact JS and both Rust output images in every round.

| Scene | Native WebGL | Refral JS | Previous public Rust | Default batched Rust |
| --- | ---: | ---: | ---: | ---: |
| Four-view Shapes | 0.540 / 1.875 | 3.970 / 4.585 | 5.590 / 6.270 | 2.400 / 3.135 |
| Triangle Cloud | 0.215 / 0.355 | 0.570 / 0.915 | 1.410 / 2.065 | 0.585 / 1.220 |

Shapes averaged 1,709 commands, one replay, 71,886 input bytes and 243,316 reply bytes per frame. The large reply still contains a complete snapshot for each draw. Triangle Cloud averaged 11 commands across three replays. Logs, exact revisions, raw frame samples, screenshots, per-round timings and original-file comparisons are under `artifacts/default-rust-batch/`. The [initial protocol comparison](122-rust-command-buffer.md) describes the opt-in variant.
