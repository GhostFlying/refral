# WebGL1 conformance campaign through drawing-buffer retention

Each full run used the 971 unique WebGL1 files at Khronos revision `39443210f7f81db4773eb104facadfb85d05dfa4`, installed headless Chrome 158.0.8127.36, and a single hardware GPU worker on macOS arm64. The saved manifest and binary hashes identify each run. The numbers are files whose original script passed.

| Frozen source | Change | Chrome | JS | Rust/Wasm | Evidence under artifacts/conformance |
| --- | --- | ---: | ---: | ---: | --- |
| 88c7fe1 | Initial three-way capture | 968 | 850 | 853 | case-screenshots |
| 035a959 | Shader name lookup | 968 | 854 | 854 | campaign/location-names/full |
| 00d056e | Context queries | 968 | 868 | 868 | campaign/query-integration/full |
| c41a2d7 | Shader resource packing | 968 | 874 | 874 | campaign/compiler-packing/full |
| f9aa7fd | Same-thread OffscreenCanvas | 968 | 886 | 886 | campaign/window-offscreen/full |
| f2b0c77 | Lines, triangle fans, index bounds | 968 | 891 | 891 | campaign/nonpoint-topology/full |

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

Raw results include the original URL, assertion counts, selected core, configuration and page snapshots. Focused totals stay separate from full inventory counts. Chrome may take extra optional extension branches.

## Fixed-suite conflicts

- The original double-underscore success case includes an attribute in a fragment shader and omits its float precision. Native returned 1/2, JS and Rust 1/1. The valid vertex declaration is accepted by Refral. [Task 067](../tasks/067-shader-double-underscores.md)
- The same pinned revision has a second file, `conformance/glsl/misc/shader-with-reserved-words.html`, which instead expects four valid shader pairs with each of `__foo` and `foo__bar` to fail. Node compilation and public name lookup preserve these spellings. The original completed 761/0 on Chrome and 753/8 on each Refral core. The eight failures are these two identifiers across the four pairs. The pinned specification explicitly permits consecutive underscores, so accepting the names can coexist with passing the other 753 assertions. The run and pages are under `artifacts/conformance/campaign/reserved-word-audit`. [WebGL1 identifier rule](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#DOUBLE_UNDERSCORE_IN_SHADER_IDENTIFIERS)
- The dimensionless SVG subimage original assumes a failed update can replace an existing 150×150 texture with empty storage. Native returned 13/0, JS and Rust 11/2. Both cores retain the prior dimensions and texels. [Task 076](../tasks/076-zero-size-svg-uploads.md)

These three URLs remain failed in each applicable raw result and stay in the denominator of 971. Their assertions need upstream reconciliation before all 971 can pass under the pinned specification. No upstream revision was changed.

Chrome's other two native baseline failures occur in `offscreencanvas/methods.html` and `methods-worker.html`. The method census found every expected method plus one enumerable browser method, `texElementSubImage2D`, in each realm. Both originals rejected that extra method. See `artifacts/conformance/campaign/dedicated-workers/chrome-methods-audit.json` for the installed browser and renderer.

## Host capability blocker

For synchronous finish, both cores return immediately once every earlier submission is known to have completed. The original uninitialized-test issues a 2 MiB upload immediately before finish. Each selected core reached one pass/one failure at that call. Chrome finished 39/0. The two quickCheck files passed. The owner accepted this host capability boundary and retained the original failing count. Reopen when a host can synchronously demonstrate completion of all preceding GL effects. The pinned original, two CDP call stacks and separate queue/Canvas2D measurements are recorded in [task 079](../tasks/079-synchronous-queue-completion.md).

The dEQP functions file reported a pass after the expression and return fixes. Comparing individual passed messages found 12 matrix-attribute subcases with incomplete draw paths. Chrome ran 13,045 assertions while each selected core ran 12,545. Task 089 then restored all 28 draws and associated pixel reads. All three paths execute the same 4,653 distinct assertion labels with identical multiplicities and finish 13,045/0. The integrated source with matrix inputs, float texture sampling, sRGB and compiler validation also completed the original matrix-conversion and linkage files at 1,813/0 and 2,479/0 on all three paths. See `artifacts/conformance/campaign/matrix-dependent-deqp/official` and [task 089](../tasks/089-matrix-vertex-input.md).

### Engineering and performance scope

On the integrated matrix and color runtime (candidate `f055822`, source equivalent to main `049f8eb`), the production preview passed all three RTT and triangle pixel comparisons, WebGPU probe, public readPixels, DOM uploads, CubeMap and Wasm ABI checks. The first browser suite recorded 185/187. The two restoration fixtures still expected the earlier one-extension capability list. After checking all four supported extensions before and after restoration and null while lost, the full hardware suite passed 187/187 using the same compiler and core Wasm. This verification is independent of the 971-file original suite. [Restoration verification and logs](../tasks/096-restored-extension-set.md)


On build 9d0b435 the 151-test headless browser suite and the production bundle both passed. The later combined lifecycle/retention build passed its complete 169-test browser suite. The immediate-publication experiment measured CPU time to issue and flush 32 default clears at 64×64. With six warmup batches and 30 measurements, JS median/p95 rose from 0.1/0.4 ms to 0.4/0.7 ms and Rust from 0.5/0.9 ms to 0.8/1.3 ms. Submissions rose from one to 32. Readback was outside the measured interval. Raw measurements and execution metadata are in `artifacts/conformance/campaign/default-presentation`. [Measurement boundaries](../tasks/066-synchronous-canvas-observation.md)
