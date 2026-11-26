# Reuse WebGPU draw bindings within a render pass

Integrate the measured pass-state variant into the shared BrowserHost on top of the Rust Buffer cache in task 123 at 2aeb9bb. Reuse identical GPU pipeline, texture and driver bind groups, viewport, scissor, blend constant, stencil reference, vertex and index bindings inside the active pass. Compare actual WebGPU binding identity and applied state. Keep draw-specific dynamic uniform offsets and draw order.

- Own shared state inside BrowserHost. Reset tracked state at pass boundaries and when clear encodes different state. Reuse scratch state between draws and keep resource lifetimes bounded by the pass.
- Validate with existing headless Chrome resource, clear, raster, geometry, default canvas, FBO and multipass fixtures and targeted original CTS. Compare JS and Rust against their respective baselines on the same GPU. Verify the integrated patch matches the measured host source. Run pnpm check, the full headless Chrome suite, the built deployment check and the original draw, vertex input and framebuffer CTS selection. Compare original assertion outcomes with the task 123 result.
- Examine the presentation pass independently using the earlier GPU timing and current requirements for Y orientation, alpha, retained default-buffer contents and synchronous readback. Keep the production presentation path while testing compatible candidates.

## Pass-state experiment

The pass-state variant keeps one set of tracked bindings per host, resets it when the pass ends and updates state touched by clear. Dynamic uniform offsets are still encoded for each draw. WebGPU tracks pipeline, bindings and dynamic state within a pass. [Render commands](https://www.w3.org/TR/webgpu/#render-commands)

All 42 focused Chrome regressions passed with the variant. The 54-run matched comparison used the same workload, adapter and samples described in [task 123](123-rust-buffer-versions.md). Final captures matched their same-core controls exactly. Values are CPU p50 / p95 in milliseconds per frame, aggregated as medians across three rounds.

| Scene | JS control | JS with pass-state reuse | Batched Rust with Buffer cache | Batched Rust with Buffer cache and pass-state reuse |
| --- | ---: | ---: | ---: | ---: |
| Four-view Shapes | 4.255 / 4.940 | 3.965 / 4.585 | 2.470 / 3.370 | 2.355 / 2.720 |
| Triangle cloud | 0.375 / 0.455 | 0.385 / 0.590 | 0.420 / 0.510 | 0.535 / 0.985 |
| Sobel 1080p | 0.540 / 0.940 | 0.615 / 1.695 | 0.585 / 1.240 | 0.560 / 1.215 |

Shapes batched Rust p95 was 5.550 ms in round two, compared with 3.455 ms for its Buffer-cache control. Triangle cloud p95 rose in all three Rust rounds. A separate instrumented Shapes run counted setters over the same complete render sequence, including setup, warmup and sampling. Viewport calls fell from 23,136 to 496, scissor calls from 23,136 to 249 and blend-constant calls from 22,888 to 62. Pipeline calls fell from 23,198 to 15,934. Dynamic uniform, vertex and index setter counts were identical, and draw and submission counts were identical. The first campaign deferred integration pending a tail-latency investigation.

The candidate patch, exact revisions, CPU samples and setter counts are under `artifacts/native-gap/`, including `2026-11-26T08-06-30.388Z/` and `2026-11-26T08-09-35.724Z/`.

## Tail investigation and integration decision

Six alternating A/B pairs and three same-build A/A pairs used headless Chrome 158.0.8127.88 and identical geometry, pixels and Wasm. Triangle Cloud render-pass encoding p95 fell from 0.035 to 0.025 ms in a separate phased capture. The A/B whole-frame CPU p95 was 1.333 to 1.420 ms. Same-build page pairs differed by up to 0.530 ms. The largest Shapes tails occurred in both variants. The instrumented traces placed the extra time across CPU phases and showed no GC pauses in the 72 slowest sampled frames. These observations support the local encoding gain and leave the end-to-end tail attribution unresolved.

The user accepted integration with that measurement scope. Raw A/B, A/A and phase traces are under `artifacts/native-gap/tail-investigation/`. The follow-up analysis phase measures the residual native-WebGL gap with the integrated host and identical scene inputs.

## Canvas presentation experiment

The canonical GL target stores GL row zero in texture row zero. Presentation flips Y and premultiplies RGB for straight-alpha contexts. Default draw-buffer retention, resize, copies and readback observe the canonical target. WebGPU grants write access through the current canvas texture, with expiry on presentation, resize and other operations. Direct rendering would require coordinated changes to those consumers and coordinate lowering. [WebGPU canvas texture lifetime](https://www.w3.org/TR/webgpu/#gpucanvascontext)

A separate matched GPU probe compared nearest sampling with integer texel loads. Both shaders flipped Y and produced the same pixels. Three rounds of 60 measured frames per variant and scene completed with GPU timestamp queries, with a 65,536 ns timestamp quantum. Headless Chrome and adapter matched the CPU comparison. GPU results below are presentation-pass p50 / p95 in ms. The values describe pass timestamp windows, which can overlap other passes. CPU timings and frame speedup lie outside that measurement.

| Scene | Existing nearest-sampled presentation | Integer texel loads |
| --- | ---: | ---: |
| Four-view Shapes | 0.197 / 0.197 | 0.197 / 0.197 |
| Triangle cloud | 0.524 / 0.655 | 0.524 / 0.655 |
| Sobel 1080p | 0.328 / 0.393 | 0.328 / 0.459 |

All 18 runs produced the same final pixels as their controls. The shader experiment yielded equal p50 at the measured precision and a higher Sobel p95. It remains an artifact in `artifacts/native-gap/2026-11-26T08-09-41.270Z/`. The presentation shader candidate remains separate from the pass-state change.
