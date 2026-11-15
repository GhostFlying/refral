# Public synchronous readPixels

Acceptance completed on 2026-11-16 after work began on 2026-11-15. Task028 implements the user's Canvas2D choice on main b1713fd. ADR 007 is accepted. The normal asynchronous factory creates a context whose supported readPixels call returns completed bytes synchronously through either selected semantic core.

## Public contract

The initial readback pair is RGBA/UNSIGNED_BYTE, also returned by the implementation format/type queries. Fixed Uint8Array and Uint8ClampedArray destinations support byte offsets, cross-realm views and fixed shared storage. Ordinary pages execute the normal readback path. The constructor-based shared-storage fixture enables isolation. A separate ordinary-page fixture reads into fixed Wasm shared memory while the SharedArrayBuffer constructor is hidden.

Each core validates the request and computes current-target selection, checked span, PACK_ALIGNMENT and clipping. The facade handles WebIDL numeric/view conversion and owns the destination. BrowserHost encodes source RGBA into two opaque sRGB pixels, performs the synchronous Canvas2D transfer, then returns an owned tight image for the facade's row copy. Source offsets work across packing tiles. GPU ordering, target versions, retirement and subsequent drawing continue through the existing host.

Bytes outside the framebuffer and row padding retain their original destination values under the pinned specification. The full requested span is validated before clipping, and the final row requires only actual pixel bytes. Detached fixed byte views have zero capacity. Nonempty requests fail GL span validation and zero-area requests succeed. Resizable/growable storage and non-view objects fail WebIDL conversion. DataView is a mismatched output type. [Pinned WebGL readPixels](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L3517), [WebIDL buffer sources](https://webidl.spec.whatwg.org/#js-buffer-source-types)

The private Rust module retains ABI3/resource2 and requires readback capability v1. Initialization detects missing/stale readback capability and gives build guidance. Read plans use owned bounded binary output. Caller destination storage remains in JavaScript.

## Verification environment

Chrome 157.0.8103.51 runs through Playwright's installed chrome channel, one worker and DPR1 on the hardware Apple M4 Max / Metal adapter. The first full 92-test run was headed. At the user's request, final public, full-suite, comparison, feasibility, performance and deployment verification runs headlessly. The actual headless adapter remains apple/metal-3 with isFallbackAdapter false. Headless mode is now the default for browser and deployment commands, and REFRAL_HEADLESS=0 selects an explicitly requested visible reproduction. Public records save actual context attributes, adapter/capabilities, launch arguments and core/compiler Wasm hashes. The formal Rust module is 287354 bytes with SHA256 ec346f73bb4465371d8f680c18d635e013cb47215f9565e048441480ee0b6bf0. Compiler Wasm remains 954a24680f8a5a799dd2d72dd66193b56526ec96047f6cc2badf247836f0a49f.

## Acceptance evidence

| Verification | Actual result |
| --- | --- |
| pnpm check | TypeScript, 152 CPU tests, rustfmt/clippy, 46 Rust core tests, 7 Wasm-crate tests and 29 support entries pass |
| pnpm rust:build and pnpm rust:test:wasm | Actual release module and 30 adapter tests pass |
| Public entry fixtures | 8 groups execute native/JS/Rust, with 296 specification assertions per Refral core and 293 native records |
| pnpm test:chrome | 92 pass, 0 fail, 0 skipped in the final headless run |
| pnpm test:readback:compare | 14 pass headlessly, including natural-color and tiled capture regression coverage |
| pnpm test:readback | 11 pass headlessly |
| pnpm build and pnpm test:dist | Built GPU probe, three-path RTT, triangles, public synchronous reads and packaged ABI3/resource2/readback1 pass |
| pnpm bench:readpixels | 18 complete runs, 2160 formal samples and exact final bytes pass |

Raw command logs and per-case JSON live under artifacts/readpixels. Native records contain two separately identified extreme-input observations, with other native assertions passing. Read-only integration review found and corrected ordinary-page Wasm shared-memory recognition. The final public suite executes that regression with the SharedArrayBuffer constructor hidden. Detached-view expectations were corrected from the initial test draft after verifying WebIDL conversion and native behavior. Chrome's disabled automation command-line method was replaced with the repository's process-query approach for evidence collection. The benchmark JSON reporter resolves its root artifacts path explicitly.

The public fixtures cover packing, exact final-row lengths, offsets/Clamped/shared/cross-realm destinations, clipped and empty rectangles, extreme coordinates, alpha/opaque targets, immediate clear/draw reads, uploads and target changes, FBO storage replacement, resize/delete/multiple contexts, invalid-state preservation, WebIDL conversion, loss and disposal. Pixel assertions compare exact bytes. Tests inspect the destination before yielding.

The pinned original CTS set expands from eleven to fourteen files. Existing scripts and assertions execute unchanged. The three added files pass native/JS/Rust with identical counts.

| Original CTS file | Assertions per backend |
| --- | --- |
| programs/program-handling.html | 13 |
| renderbuffers/feedback-loop.html | 9 |
| reading/read-pixels-pack-alignment.html | 165 |
| Complete selected set | 430 |

The harness assigns the structural facade the helper iframe's native WebGLRenderingContext prototype and preserves inert head shader scripts. These adaptations are recorded in every result. Three remaining deferred files retain their unresolved CubeMap, mipmap, packed/extra formats or DOM/copy prerequisites in fixtures.lock.json.

Chrome returns INVALID_OPERATION for x/y equal to INT_MAX with a 2×2 request that is wholly outside a 5×4 target. The pinned outside-framebuffer rule yields an empty untouched read with NO_ERROR in both cores. Chrome returns INVALID_VALUE for INT_MAX width/height, while both cores report the pinned insufficient-span INVALID_OPERATION. Native observations retain exact parameters and errors separately. Matching bytes and other error assertions stay strict.

## Completed-read performance

The independent command pnpm bench:readpixels runs eighteen fresh-context cases in three rotated native/JS/Rust orders. Each run uses thirty warmup samples and 120 formal samples, each containing eight clear/read operations. The 2160 formal sample means cover 17280 operations.

Each timed operation includes clearColor, clear and the public synchronous readPixels through completed GPU work and destination copying. Destination/color/target preparation precedes sampling. Per-run raw data includes initialization, resource preparation, first completed read, steady-state p50/p95, host counters, environment and source/build hashes. Timings are elapsed milliseconds per completed clear/read operation. The ordinary page's observed performance timer step is approximately 0.1 ms. GPU duration and process CPU time are unmeasured by this focused baseline.

| Completed clear/read workload | Backend | Three-round p50 range, ms/operation | Three-round p95 range, ms/operation |
| --- | --- | --- | --- |
| one-pixel | native | 0.1625–0.1750 | 0.2000–0.2250 |
| one-pixel | js | 0.3750–0.4250 | 0.4500–0.5000 |
| one-pixel | rust | 0.4250–0.4625 | 0.5000–0.6250 |
| fbo-320x240 | native | 0.2875–0.2875 | 0.3250–0.4500 |
| fbo-320x240 | js | 0.7375–0.7750 | 0.9625–1.0125 |
| fbo-320x240 | rust | 0.7875–0.8250 | 1.0500–1.1250 |

The one-pixel case clears a 320×240 default buffer and reads 1×1. The FBO case clears and reads a 320×240 RGBA target. Raw data lives under artifacts/readpixels/benchmark and explicitly records headless mode, actual launch command, selected core and adapter. Earlier headed samples are retained under artifacts/readpixels/benchmark-headed.

## Reproduction and artifacts

Use the default background browser mode or set REFRAL_HEADLESS=1 explicitly. Run pnpm check and pnpm rust:test:wasm after pnpm rust:build. Use pnpm test:readpixels for the public fixtures, pnpm test:cts for original scripts, pnpm test:chrome for the complete browser suite, and pnpm build followed by pnpm test:dist for built examples. Prior Canvas2D/worker experiments retain pnpm test:readback and pnpm test:readback:compare.

Artifacts include artifacts/readpixels/public, native-boundaries.json, native-precedence.json, native-detached.json, benchmark raw samples and command logs. Original CTS results live in artifacts/cts/results.json. Built verification uses artifacts/deployment/result.json. Current selected formats, ordinary-page Canvas transfer and the measured Chrome/macOS environment bound this acceptance. Additional readback formats, other completion APIs and context restoration retain their support entries and follow-up tasks.

Delivery provenance is recorded in artifacts/readpixels/delivery.json with the task branch, PR, tested head, required check and integrated main revision.
