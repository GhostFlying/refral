# WebGL1 conformance campaign on headless Chrome

Each full run used the 971 unique WebGL1 files at Khronos revision `39443210f7f81db4773eb104facadfb85d05dfa4`, installed headless Chrome 158.0.8127.36, and a single hardware GPU worker on macOS arm64. The saved manifest and binary hashes identify each run. The numbers are files whose original script passed.

| Frozen source | Change | Chrome | JS | Rust/Wasm | Evidence under artifacts/conformance |
| --- | --- | ---: | ---: | ---: | --- |
| 88c7fe1 | Initial three-way capture | 968 | 850 | 853 | case-screenshots |
| 035a959 | Shader name lookup | 968 | 854 | 854 | campaign/location-names/full |
| 00d056e | Context queries | 968 | 868 | 868 | campaign/query-integration/full |
| c41a2d7 | Shader resource packing | 968 | 874 | 874 | campaign/compiler-packing/full |
| f9aa7fd | Same-thread OffscreenCanvas | 968 | 886 | 886 | campaign/window-offscreen/full |
| f2b0c77 | Lines, triangle fans, index bounds | 968 | 891 | 891 | campaign/nonpoint-topology/full |
| f055822 | Matrix attributes, float textures and sRGB | 968 | 963 | 963 | campaign/integrated-matrix-float-srgb/full |
| a7be1dc | Transferred OffscreenCanvas discard | 968 | 964 | 964 | campaign/retained-offscreen-release/full |
| f1dac24 | Equal-size HTML canvas assignments | 968 | 965 | 965 | campaign/final-html-resize/full |

The matrix/color and later runs used the pinned 20-second upstream inactivity window and 600-second hard deadline. The earlier line-topology run used a 5-second inactivity window. The changes between those two rows include this runner setting.

The line-topology build had 42 assertion-failing, 21 unsupported, 4 timed-out and 13 runner-error files per Refral core. All 2,913 records have captured pages. The phase report presents one row per MDN member and one native/JS/Rust comparison per file. Later runs keep independent manifests. A partial sweep cannot establish a new full pass count.

## Integrated capability checks

| Merged changes | Original evidence |
| --- | --- |
| [Dedicated workers](../tasks/064-dedicated-worker-context.md) and [navigation](../tasks/081-worker-navigation.md) | The navigation original exercised 25 iframe loads and passed 76 assertions on each backend. A dedicated worker creates the selected core and reports its provenance. |
| [Immediate Canvas consumers](../tasks/066-synchronous-canvas-observation.md) and [raster state](../tasks/065-polygon-offset-and-sample-state.md) | Five canvas/alpha originals passed 274 assertions per backend. Polygon offset and enable/query passed 10 and 339 per backend. The deployment verification included the ABI6 artifact. |
| [Structured uniforms](../tasks/062-structured-uniform-reflection.md), [limits](../tasks/071-vertex-uniform-capacity.md), [stage matching](../tasks/072-shader-stage-matching.md) and [sampler aggregates](../tasks/078-sampler-aggregate-bindings.md) | Both cores completed all 2,272 applicable dEQP linkage assertions. The ten-file sampler group passed on all three paths, including 341 assertions for uniform defaults on each. |
| [Points](../tasks/073-point-rendering.md) and [WebGL interface identity](../tasks/074-webgl-object-identity.md) | Point coordinates, clipping and point sizes passed all six point-specific originals. The combined build completed shader precision 65/0, invariance 19/0 and instanceof 21/0 on all three paths. |
| [Fresh canvas upload](../tasks/075-fresh-canvas-texture-source.md) and [VideoFrame](../tasks/077-video-frame-texture-upload.md) | The decoded I420 image original passed 3/0 per backend. Three direct-factory regressions cover closing the caller's frame, vertical orientation and retained texture content. |
| [Transfer](../tasks/068-offscreen-bitmap-transfer.md), [loss and restore](../tasks/069-context-loss-restoration.md) and [retention](../tasks/070-default-buffer-retention.md) | Context loss/restoration and explicit transfer use the selected core. Both location-error originals now execute their optional loss branches, 118/0 on all three paths for each file. Bitmap transfer passed 241/0 per path. The combined headless engineering suite passed 169/169 and actual Wasm passed 51/51. |

The HTML equal-size resize case (#41) on Chrome and both Refral cores finished 11/0 after the host preserved the GL attachments across a same-size assignment. A separate immediate DOM-only copy following that assignment can still observe transparent pixels on Refral before another GL access or mutation delivery. The transferred OffscreenCanvas discard case (#599) finished 3/0 on all three paths. [HTML resize](../tasks/100-render-after-resize.md) · [Offscreen composition](../tasks/094-offscreen-compositor-observation.md)

Raw results include the original URL, assertion counts, selected core, configuration and page snapshots. Focused totals stay separate from full inventory counts. Chrome may take extra optional extension branches.

## Fixed-suite conflicts

- The original double-underscore success case includes an attribute in a fragment shader and omits its float precision. Native returned 1/2, JS and Rust 1/1. The valid vertex declaration is accepted by Refral. [Task 067](../tasks/067-shader-double-underscores.md)
- The same pinned revision has a second file, `conformance/glsl/misc/shader-with-reserved-words.html`, which instead expects four valid shader pairs with each of `__foo` and `foo__bar` to fail. Node compilation and public name lookup preserve these spellings. The original completed 761/0 on Chrome and 753/8 on each Refral core. The eight failures are these two identifiers across the four pairs. The pinned specification explicitly permits consecutive underscores, so accepting the names can coexist with passing the other 753 assertions. The run and pages are under `artifacts/conformance/campaign/reserved-word-audit`. [WebGL1 identifier rule](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#DOUBLE_UNDERSCORE_IN_SHADER_IDENTIFIERS)
- The dimensionless SVG subimage original assumes a failed update can replace an existing 150×150 texture with empty storage. Native returned 13/0, JS and Rust 11/2. Both cores retain the prior dimensions and texels. [Task 076](../tasks/076-zero-size-svg-uploads.md)

These three URLs remain failed in each applicable raw result and stay in the denominator of 971. Their assertions need upstream reconciliation before all 971 can pass under the pinned specification. No upstream revision was changed.

Chrome's other two native baseline failures occur in `offscreencanvas/methods.html` and `methods-worker.html`. The method census found every expected method plus one enumerable browser method, `texElementSubImage2D`, in each realm. Both originals rejected that extra method. See `artifacts/conformance/campaign/dedicated-workers/chrome-methods-audit.json` for the installed browser and renderer.

## Accepted undefined observation

Original #48 uses an opaque HTML canvas with preserveDrawingBuffer false. All three paths immediately copied red and continued displaying red after composition. A later Canvas2D drawImage copied opaque black on Chrome WebGL and transparent black on both Refral cores. The pinned WebGL specification lists this particular cross-frame read as potentially undefined. The owner accepted the observed difference. The original remains 4/0 on Chrome and 3/1 on JS and Rust. Keep both failing records in every total and continue testing the separate required drawing-buffer behavior. [Specification, screenshots and history](../tasks/093-opaque-webgpu-canvas-discard.md)

## Host capability blocker

For synchronous finish, both cores return immediately once every earlier submission is known to have completed. The original uninitialized-test issues a 2 MiB upload immediately before finish. Each selected core reached one pass/one failure at that call. Chrome finished 39/0. The two quickCheck files passed. The owner accepted this host capability boundary and retained the original failing count. Reopen when a host can synchronously demonstrate completion of all preceding GL effects. The pinned original, two CDP call stacks and separate queue/Canvas2D measurements are recorded in [task 079](../tasks/079-synchronous-queue-completion.md).

### Sustained draw timeout

The original many-draw-calls file (#656) issues 505,000 default framebuffer draws over 100 frames. A Chrome 158 trace following the final upstream script request accounted for 38.78 seconds in 6,010 Dawn event-processing tasks on the renderer main thread. The server completed the epilogue response within one millisecond. Refral preserved the raw timeout with the 20-second upstream inactivity window. Candidate optimizations either changed shared-edge coverage or retained the timeout. The extended observation on JS reached all twelve assertions under a separately recorded timeout. [Trace and Chromium source](../tasks/101-sustained-draw-completion.md) · [Raster experiments](../tasks/099-default-framebuffer-copy.md)

In the task-end batching diagnostic both actual cores executed all 505,000 draws in sequence with 100 submissions. The unchanged original finished 12/0 on JS in 5,992.5 ms and on Rust in 11,598.5 ms. A same-stack native Canvas2D drawImage control still observed the previous pixels on both batched cores, whereas the production path exposed every intervening draw. The two policies have separate runtime identities and scores. [Matched submission and external-image controls](../tasks/104-submission-batching-control.md)

On November 19, the two Dawn wire files inspected on upstream main were byte-identical to the files pinned by Chrome 158. Chromium main retained the same return-data handler that posts the ProcessEvents task. These are source comparisons. Timing on a newer executable requires a new run. Recheck the original and external image control when either path changes. [Dawn queue](https://dawn.googlesource.com/dawn/+/476cd38f35d5f4d370d45c0d3cc82662eb666dc1/src/dawn/wire/client/Queue.cpp#104) · [Dawn polling](https://dawn.googlesource.com/dawn/+/476cd38f35d5f4d370d45c0d3cc82662eb666dc1/src/dawn/wire/client/EventManager.cpp#133) · [Chromium return-data handler](https://chromium.googlesource.com/chromium/src/+/98ccdbe08e7ee14c81a09ad0203f6b2396a997e2/gpu/command_buffer/client/webgpu_implementation.cc)

## Assertion coverage

The dEQP functions file reported a pass after the expression and return fixes. Comparing individual passed messages found 12 matrix-attribute subcases with incomplete draw paths. Chrome ran 13,045 assertions while each selected core ran 12,545. Task 089 then restored all 28 draws and associated pixel reads. All three paths execute the same 4,653 distinct assertion labels with identical multiplicities and finish 13,045/0. The integrated source with matrix inputs, float texture sampling, sRGB and compiler validation also completed the original matrix-conversion and linkage files at 1,813/0 and 2,479/0 on all three paths. See `artifacts/conformance/campaign/matrix-dependent-deqp/official` and [task 089](../tasks/089-matrix-vertex-input.md).

Six attribute originals reported 3,545 passed assertions on Chrome and 1,209 per Refral core. The eight additional native attribute locations account for 2,304 assertions and the optional instancing extension for 32. Five framebuffer, readback and texture originals reported 2,897 and 2,795, respectively. The 102 additional native assertions come from antialiasing, the optional half-float read type, colorless framebuffer branches and advertised texture dimensions. [Attribute cases](../tasks/102-attribute-assertion-coverage.md) · [Framebuffer and texture cases](../tasks/106-framebuffer-and-texture-assertion-coverage.md)

Three further originals cover multi-draw, hint and state queries. At f1dac24 their native counts were 7,930, 502 and 280. Each Refral core ran 45, 252 and 192 respectively. The 7,885 additional native multi-draw assertions include 7,680 extension-dependent pixel checks. The derivative-hint extension adds 250 validation cases. State queries use the advertised counts of texture units and attribute slots. All nine scripts reached the upstream completion callback. [Multi-draw and state-query audit](../tasks/107-multidraw-and-query-assertion-coverage.md)

### Engineering and performance scope

On merged runtime `f1dac24`, the 202 headless Chrome tests passed. Production RTT images were byte-identical across native, JS and actual Rust/Wasm. The Chrome probe, three triangle images, synchronous readPixels, DOM and CubeMap paths passed with zero page errors. Packaged Rust ABI 6 and resource protocol 8 matched the recorded binaries; readback and DOM upload used protocol versions 1 and 2. TypeScript checking, 243 Vitest tests, 72 Node tool tests, 76 native Rust tests, 55 actual-Wasm tests and the 73-case compiler corpus passed on this checkout. The ANGLE browser loader, compiler Wasm and Rust Wasm matched across the official suite, engineering checkout, production bundle and incremental rebuild. Logs, capture data and hashes are under `artifacts/conformance/campaign/final-html-resize/integration`.

On the integrated matrix and color runtime (candidate `f055822`, source equivalent to main `049f8eb`), the production preview passed all three RTT and triangle pixel comparisons, WebGPU probe, public readPixels, DOM uploads, CubeMap and Wasm ABI checks. The first browser suite recorded 185/187. The two restoration fixtures still expected the earlier one-extension capability list. After checking all four supported extensions before and after restoration and null while lost, the full hardware suite passed 187/187 using the same compiler and core Wasm. This verification is independent of the 971-file original suite. [Restoration verification and logs](../tasks/096-restored-extension-set.md)


On build 9d0b435 the 151-test headless browser suite and the production bundle both passed. The later combined lifecycle/retention build passed its complete 169-test browser suite. The immediate-publication experiment measured CPU time to issue and flush 32 default clears at 64×64. With six warmup batches and 30 measurements, JS median/p95 rose from 0.1/0.4 ms to 0.4/0.7 ms and Rust from 0.5/0.9 ms to 0.8/1.3 ms. Submissions rose from one to 32. Readback was outside the measured interval. Raw measurements and execution metadata are in `artifacts/conformance/campaign/default-presentation`. [Measurement boundaries](../tasks/066-synchronous-canvas-observation.md)

## Results on f1dac24

The official inventory produced 2,913 source-matched results. All three backends passed 963 common files. JS and Rust differed in 0 file statuses. 72 files passed on all three with different assertion counts. The case table preserves the exact raw counters and page image for every URL.

The following rows include every URL with a nonpassing result on any backend. Counts are passed/failed assertions observed; a timeout can have zero observed failures and incomplete execution.

| Index | Official URL | Chrome | JS | Rust/Wasm | Investigation |
| ---: | --- | --- | --- | --- | --- |
| 48 | `conformance/context/context-attribute-preserve-drawing-buffer.html` | pass 4/0 | fail 3/1 | fail 3/1 | Post-composite HTML canvas copy |
| 332 | `conformance/glsl/misc/shader-with-double-underscore.html` | fail 1/2 | fail 1/1 | fail 1/1 | Invalid fragment-stage fixture |
| 371 | `conformance/glsl/misc/shader-with-reserved-words.html` | pass 761/0 | fail 753/8 | fail 753/8 | Valid double-underscore identifiers |
| 455 | `conformance/misc/uninitialized-test.html` | pass 39/0 | unsupported 1/1 | unsupported 1/1 | Pending queue work at synchronous finish |
| 606 | `conformance/offscreencanvas/methods.html` | fail 1/1 | pass 2/0 | pass 2/0 | Native OffscreenCanvas method enumeration |
| 607 | `conformance/offscreencanvas/methods-worker.html` | fail 1/1 | pass 2/0 | pass 2/0 | Native Worker method enumeration |
| 656 | `conformance/rendering/many-draw-calls.html` | pass 12/0 | timeout 10/0 | timeout 10/0 | Immediate-publication queue cost |
| 708 | `conformance/textures/misc/tex-image-svg-image-no-natural-width-and-height.html` | pass 13/0 | fail 11/2 | fail 11/2 | Texture storage after rejected SVG upload |
