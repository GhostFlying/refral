# WebGL1 conformance refresh after stencil and RGB targets

## Runtime and result

The tested runtime is 2a519f2cbc701328df85e2b4c523b1a4cf9b9b34, including the [stencil attachments](https://github.com/GhostFlying/refral/pull/32), [stencil raster state](https://github.com/GhostFlying/refral/pull/33) and [RGB framebuffer](https://github.com/GhostFlying/refral/pull/34) changes. The original WebGL1 1.0.4 inventory remains pinned at 39443210f7f81db4773eb104facadfb85d05dfa4. Chrome 158.0.8127.36 ran headless on macOS arm64 with an Apple Metal 3 WebGPU adapter. The result collection contains all 2,913 file/backend outcomes and zero input issues.

| Backend | Previous passes | Pass | Fail | Unsupported | Timeout | Harness error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native WebGL | 968 | 968 | 3 | 0 | 0 | 0 |
| Refral JS | 566 | 785 | 52 | 39 | 78 | 17 |
| Refral Rust/Wasm | 571 | 788 | 49 | 39 | 78 | 17 |

Each row covers 971 original files. The corresponding old pass sets are subsets of the refreshed pass sets. There are 785 three-way passes. The net gains of 219 JS and 217 Rust files span all implementation work since the earlier full baseline. The earlier baseline used Chrome 157 and a 20-second idle window. This refresh uses five seconds. All previous passes completed under the newer window. [Previous baseline](2026-11-18-official-conformance.md)

The framebuffer renderbuffer module passes 7/7 in both cores. The stencil state original passes 671 assertions per backend, and both stencil and depth initialization originals pass 43 each. The original RGB copy format and texture attachment format tests pass 51 and 14 assertions per backend. Headless local verification also passed 138 Chrome regressions, deterministic checks, 47 actual-Wasm tests and the built deployment on ABI5/resource8/readback1/DOM2.

## Remaining dependencies

Textures pass 82/164 on both cores. In each backend's 78 timeouts, 48 are the six ImageBitmap source groups, eight are video uploads, and eight are WebGL Canvas uploads whose OffscreenCanvas branch cannot acquire the selected core. The raw diagnostics distinguish unsupported source brands from missing OffscreenCanvas context acquisition. Three Rust WebGL Canvas packed-upload files moved from unsupported to timeout. Each now reaches 72 passing assertions before the OffscreenCanvas acquisition gap. All three reproduced the same status and counters with the earlier 20-second window. Raw confirmation is under `artifacts/conformance/stencil-rgb-refresh/timeout-confirmation`. The GLSL and rendering groups have 24 JS / 23 Rust and 13 per-core nonpassing files respectively.

Three original files pass in Rust and fail in JS. Their retained assertions concern maximum attribute/uniform name length in gl-get-attrib-location-errors, attrib-location-length-limits and gl-get-uniform-location-errors. Standalone OffscreenCanvas conformance remains 0/12 on both cores. The oversized stencil viewport original verifies drawing and readback from a device-bounded drawing buffer. Actual presentation still requires the requested canvas extent to fit the WebGPU swapchain.

## Reproduction

Run each backend in sequence against the same checkout and built compiler/Rust artifacts.

~~~sh
pnpm conformance:run --backend native --timeout-ms 5000 --output artifacts/conformance/stencil-rgb-refresh
pnpm conformance:run --backend js --timeout-ms 5000 --output artifacts/conformance/stencil-rgb-refresh
pnpm conformance:run --backend rust --timeout-ms 5000 --output artifacts/conformance/stencil-rgb-refresh
pnpm conformance:report --input artifacts/conformance/stencil-rgb-refresh
~~~

The combined run saved 971 native and 971 JS results, then the JS Chrome close exceeded the teardown deadline. An independent invocation recorded all 971 Rust results with the same fingerprint. Rust also exceeded the close deadline after its final checkpoint. The report validated the complete checkpoint set. The output directory contains each backend's results.json, summary.json, summary.md, failure-clusters.json, comparison.json, run.log and run-rust.log.
