# DOM upload and CTS stage validation

Recorded on 2026-11-16 from task029, with implementation main3861a65 and the PR4 harness source snapshot recorded below. Tasks030–032 delivered original state/Buffer CTS, ImageData and Canvas/HTMLImage behavior. Task033 closes deployment and measurement acceptance.

## Accepted behavior

Both actual semantic cores accept unorm8 sRGB ImageData with five UNSIGNED_BYTE output formats. The accepted Canvas/Offscreen profile uses sRGB sources and RGBA/UNSIGNED_BYTE output. Decoded HTMLImage RGBA uploads/subimages preserve alpha-zero RGB, low-alpha values and ICC NONE encoding. Intrinsic/cross-realm brands, scalar conversion order, source mutation after return, unpack alignment/flip/PMA, errors, CORS, dimensions, storage replacement and draw ordering have shared fixtures.

Canvas extraction uses WebGPU external copy and the existing opaque Canvas2D readback transport. It preserves WebGL-source alpha-zero RGB and premultiplied values that a direct Canvas2D snapshot loses. Same-module Refral source registrations publish their current-sized default drawing buffer independently of a bound FBO and supply source loss facts. HTMLImage uses the user-approved lazy private native WebGL extraction context. ADR008 records ownership, synchronous costs and lifetime. The selected JS/Rust core owns destination validation, errors, formats and versions.

The Chrome157 ICC investigation observes extra premultiplication in external-image upload. Identical pixels with cICP recover correct values. The pinned Chromium/Skia branch explanation is source-derived, with direct internal branch logging remaining additional evidence. [Investigation](../references/chrome-external-image-alpha.md), [extraction decision](../adr/008-dom-image-extraction.md)

## Correctness and deployment

| Verification | Result |
| --- | --- |
| TypeScript and deterministic CPU tests | Passed,201 CPU tests |
| Native Rust | Passed,58 core and8 Wasm-crate tests, rustfmt and clippy |
| Actual Wasm adapter | Passed,38 tests with ABI3/resource2/readback1/DOM upload2 |
| Complete headless Chrome suite | Passed,110 tests with zero failures/skips |
| Original CTS ordinary pages | Eighteen complete files,515 assertions per backend |
| Original shared-storage Buffer CTS |74 assertions per backend on isolated pages |
| ImageData public groups | Eight groups,120 exact captures per backend, native838 / JS871 / Rust871 assertion records |
| Canvas/image public groups | Nine groups,162 exact captures per backend, native670 / JS700 / Rust700 assertion records |
| Built deployment | GPU probe, three-path RTT and triangle pixels, public readPixels, packaged capability/hash checks,16 DOM captures per backend |

The four newly activated original files are state/gl-geterror.html, state/gl-getstring.html, state/gl-initial-state.html and buffers/buffer-data-and-buffer-sub-data.html. Upstream paths, scripts, assertions, revision and permitted error branch are retained. Shared semantic scenes have their own identities. Native broken-image/bad-target order is recorded alongside the cores' source-first errors for the multiple-invalid combination.

Built DOM verification uses tests/fixtures/dom-deployment.html from the actual dist tree. It checks ImageData, Canvas, OffscreenCanvas and PNG with both flip and PMA values. The ordinary examples still cover rendering through the shared compiler and executor. Packaged Rust/compiler hashes match their source build artifacts. Deployment evidence records the actual headless command line and adapter.

## Environment and measurement

Headless installed Chrome157.0.8103.51 runs on macOS arm64 / Apple M4 Max. Refral uses the apple/metal-3 hardware adapter with isFallbackAdapter false. Node24.14.0 and Rust1.94.1 are pinned. Rust Wasm is291593 bytes, SHA2561ac0f7ebfc7a0b54ba96d332f38a2151a76b3c0dae76203f20910d000975d311.

Each source uses identical prebuilt64×64 opaque sRGB pixels and the same textured draw. Each logical frame calls public texSubImage2D, drawArrays and flush. There are30 warmup samples and120 formal samples per run, eight logical frames per sample, three rounds with rotated backend order. All27 runs pass, producing3240 formal samples and25920 formal logical frames. Readback/probing and outer GPU completion happen after each timed sample. DOM extraction's internal synchronous operations remain inside the API interval.

The measurement is client-side call-interval wall time. It includes facade conversion, source snapshot/extraction, core processing, Wasm bridge, encoding, submission and synchronous waits performed inside those APIs. Source construction/decode and shader/resource preparation are separate. Native and Refral outer completion checks validate the same RGBA pixel. Raw data retain source/context/resource/first-image timing, shaders, counters and all pixels/errors.

The benchmark server uses cross-origin isolation for the measured0.005ms timer resolution. A sample groups eight frames, giving a derived0.000625ms per-frame timing increment. Native short-call measurements show this quantization. Cache state is a fresh browser context and public GL context per run in one Chrome process, with reused source/destination and unmanaged decoder/driver caches. The data describe this64×64 fixed workload. GPU timestamps were available on the adapter and disabled on the device for this CPU-call baseline.

### Pooled steady-state call intervals

Nearest-rank p50/p95 pools360 formal samples for each source/backend. Units are ms/logical-frame, obtained by dividing each sample by eight before pooling. Raw per-round values remain available.

| Source | Backend | p50 | p95 |
| --- | --- | --- | --- |
| imagedata | native | 0.001875 | 0.003125 |
| imagedata | js | 0.060000 | 0.071875 |
| imagedata | rust | 0.070625 | 0.108125 |
| canvas | native | 0.001250 | 0.002500 |
| canvas | js | 0.870000 | 1.048125 |
| canvas | rust | 0.878125 | 1.067500 |
| image-png | native | 0.014375 | 0.015625 |
| image-png | js | 0.873750 | 0.988125 |
| image-png | rust | 0.901250 | 1.008750 |

### Setup and first image

Each range contains the minimum and maximum of three runs. Units are milliseconds. First completed image starts at the first upload/draw and ends after its completed pixel probe. Source preparation precedes context initialization and is recorded independently in raw JSON.

| Source | Backend | Context initialization | Shader/resource preparation | First call interval | First completed image |
| --- | --- | --- | --- | --- | --- |
| imagedata | native | 2.270–3.735 | 0.830–1.535 | 0.050–0.060 | 0.850–1.110 |
| imagedata | js | 16.225–35.575 | 14.920–15.605 | 1.525–1.640 | 6.865–7.420 |
| imagedata | rust | 24.610–25.690 | 15.840–17.155 | 1.600–1.730 | 7.060–7.675 |
| canvas | native | 2.170–2.790 | 0.910–0.925 | 0.045–0.050 | 0.675–0.920 |
| canvas | js | 17.320–18.140 | 15.090–15.775 | 6.890–7.230 | 9.865–10.495 |
| canvas | rust | 23.590–24.535 | 15.775–16.520 | 6.920–7.470 | 10.630–11.165 |
| image-png | native | 2.390–2.540 | 0.905–0.960 | 0.085–0.090 | 0.890–1.380 |
| image-png | js | 16.525–18.655 | 15.285–16.010 | 5.105–5.250 | 10.195–10.815 |
| image-png | rust | 23.275–23.955 | 15.810–17.325 | 5.420–6.880 | 10.955–13.300 |

### Host counters and memory scope

For960 formal frames per run, ImageData and PNG record960 draws,1920 passes,960 submits,1920 copies,15836160 uploaded bytes and3840 bind groups in timed intervals. Canvas records960 draws,2880 passes,1920 submits,2880 copies,31580160 uploaded bytes and4800 bind groups. Every path creates zero additional WebGPU pipelines in these warmed intervals. Counter snapshots precede outer completion/readback work.

These WebGPU host counters include Canvas external-copy/opaque transport work. Native WebGL exposes no corresponding counters. Private HTMLImage extractor GL copies, dimension probes and driver allocations lack those counters, while their wall time is included. Recorded host peaks are131984 buffer bytes and180224 texture bytes for the fixed runs. These estimates cover tracked WebGPU resources. Browser canvas backing stores, native helper/driver allocations and complete process/Wasm memory require separate accounting.

## Evidence and reproduction

Run pnpm check, pnpm rust:test:wasm, REFRAL_HEADLESS=1 pnpm test:chrome, pnpm build, REFRAL_HEADLESS=1 pnpm test:dist and pnpm bench:dom using the pinned Node/pnpm PATH. GPU entries are serialized. pnpm bench:dom forces headless Chrome and one worker. Required Actions retain their deterministic affected-module checks. Expensive verification remains local/optional.

Raw PR1–PR3 logs and delivery receipts live under artifacts/dom-input/pr1, pr2 and pr3. Public fixture output directories are reused by full regressions. The final capability2 records are copied to artifacts/dom-input/pr4/public-imagedata and public-canvas-image, with actual build hashes in each result. Earlier acceptance logs and receipts retain their dated heads. PR4 correctness logs, original CTS copies and built results live under artifacts/dom-input/pr4. Performance summary.json, pooled.json, source-manifest.json and per-round raw records live under artifacts/dom-input/pr4/performance. The measured source snapshot is 22bb3f3b3b609d37a3d11d67207bd1030c265c79e70dfd9b214c8a8ba15666ff at main3861a65 plus the recorded harness changes. Delivery records identify the final PR and integrated main head.

## Remaining compatibility scope

ImageBitmap/video, additional ImageData encodings, wide-gamut/HDR Canvas, other Canvas/image output formats, mipmaps/CubeMap/packed formats, extensions and context restoration retain scoped compatibility tasks. Refral pending-work/loss coordination across independently loaded module/realm instances and unregistered native-WebGL-source loss require additional acceptance. Whole original DOM upload CTS generators retain their CubeMap and broader-format dependencies. The accepted source-derived fixtures preserve their upstream references.
