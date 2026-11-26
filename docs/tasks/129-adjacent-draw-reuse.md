# Reuse resident draw inputs, pipeline selection and matrix views

Start at main `a9b898b`. Implement three independently measurable changes in the common browser host and WebGL facade. Both cores continue to own validation, per-draw snapshots and uniform values as specified in [the spec map](../spec-map.md) and ADRs [005](../adr/005-drawing-core-boundary.md), [006](../adr/006-resource-execution.md) and [011](../adr/011-vertex-input-and-topology.md).

1. Reuse a complete resident set of vertex and index GPU buffers for consecutive ordinary indexed draws with compatible immutable inputs. Preserve per-draw offsets, the existing cache budget, eviction, transient paths and resource lifetime. Verify updates, attribute and index replacement, mode changes, clear and budget boundaries.
2. Reuse the previous compatible pipeline selection within a linked program and resource layout. Compare all descriptor inputs, keep dynamic pass state independent and exercise changes in render target, vertex format, masks, depth, blend, cull, bias and stencil.
3. Remove the intermediate matrix copy for ordinary fixed Float32Array inputs consumed synchronously by either core. Exercise source mutation, views, shared and resizable storage, detachment, cross-realm inputs and invalid lengths. Preserve WebIDL conversion and draw isolation.

Keep one change per commit. Run pnpm check, pnpm ci:check, actual-Wasm and headless Chrome regressions, packaged deployment and relevant original WebGL1 CTS. Measure the parent plus each successive commit and native WebGL in one rotating comparison with identical workloads, output images, host counters and Rust command statistics. Use Suzanne 3000 and Cubes 2000 as targets and Shapes four-view as a geometry-miss control. Record three rounds of 30 warmup and 120 measured frames on an exclusive hardware adapter. Review marginal p50/p95 for each change and follow up inconsistent or adverse results before integration.

The geometry shortcut requires repeat use of an ordinary versioned element buffer before recording its streams. It stores immutable version strings and packing parameters for the entire resident set, and drops the set before a cache miss can evict buffers. Per-draw index offset and count remain encoder arguments. Geometry cache admission tests and five headless geometry cases passed, including the new three-route regression with repeated index ranges, vertex offsets, updates and disabled arrays.

Each cached program/texture-layout variant now keeps its most recent non-stencil pipeline selection. It compares the prepared layout, primitive mode and strip format, attachment formats and opacity, effective depth bias and static raster state. Stencil descriptors use the existing canonical key. Dynamic pass setters still consume each snapshot. Type checking and 14 targeted headless raster, depth, stencil, vertex-array and extension cases passed.

The matrix setter reuses a branded internal Float32Array view for a fixed ordinary backing store. A prior nonempty view reaching zero length is converted again so detachment follows the existing exception path. Shared input still gets an owned copy before dispatch. The synchronous JS setter writes semantic uniform storage, and the Rust writer copies the bytes into its command arena. Public cross-realm subview tests cover mutation before each draw, two queued values and the queried matrix. These and the geometry rerun passed 11/11 in headless Chrome.

## Continuous animation measurements

The release comparison used archives of baseline `a9b898b`, geometry `9375779`, geometry plus pipeline `39966d4`, and the full candidate `0b762bc`. Each ran on headless Chrome 158.0.8127.88, Apple M4 Max, native ANGLE Metal or a non-fallback apple metal-3 adapter, DPR 1. All used release Wasm SHA-256 `ec6f255d60d84480fe514cc269907fefad59f82c82db2bd65fd7aae2b5a12ef5`. Each of three rounds rotated nine independent page configurations per scene, with 30 warmup and 120 measured frames per page. CPU ms/frame includes animation, Three.js rendering, facade and host work through return from `gl.flush()`. GPU waits, rAF waits and screenshot capture occur outside this interval. The measured CPU timer quantum was 0.005 ms.

Cells give the median of per-round p50 / p95 CPU ms/frame. Each column includes the preceding change.

| Scene | Core | Native | Baseline | Geometry | Plus pipeline | Plus matrix |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| suzanne-3000 | js | 2.150 / 3.200 | 10.405 / 11.305 | 8.920 / 9.465 | 7.950 / 8.855 | 7.535 / 8.180 |
| suzanne-3000 | rust | 2.150 / 3.200 | 10.385 / 11.495 | 9.655 / 10.530 | 8.575 / 9.785 | 7.420 / 8.110 |
| interactive-cubes | js | 2.215 / 4.085 | 10.175 / 10.650 | 8.875 / 9.410 | 8.650 / 9.310 | 8.445 / 9.580 |
| interactive-cubes | rust | 2.215 / 4.085 | 9.410 / 10.320 | 8.370 / 9.215 | 8.000 / 8.355 | 7.025 / 7.465 |
| shapes-four | js | 0.595 / 1.630 | 2.680 / 3.540 | 2.575 / 3.005 | 2.435 / 2.820 | 2.670 / 3.385 |
| shapes-four | rust | 0.595 / 1.630 | 2.650 / 3.170 | 2.260 / 3.035 | 2.380 / 2.930 | 2.495 / 3.070 |

All 81 runs passed their work, output and execution checks. Every optimization stage preserved the baseline output pixels, per-frame draw/primitive counts, host counters and Rust transport counts. The two large scenes had zero pixels differing from native by more than two channel levels. In Shapes, 1,177 of 1,920,000 pixels exceeded that two-level threshold, below the 0.2% native tolerance. All three scenes continued to submit once per frame. In steady state Suzanne and Cubes created zero pipelines and made zero Rust geometry-byte copies.

The large scenes improved overall p50 and p95 in each of three rounds on each core. The independent-page results for intermediate steps varied, especially for the smaller Shapes workload and for Cubes JS p95 when adding the matrix change.

Raw frame samples, adapter data, images and comparisons are under `artifacts/adjacent-draw/2026-11-26T13-48-48.220Z/`. The tracked `pnpm bench:three:large` entry runs the workload on a single checkout. The local comparison can be replayed from the repository root using:

```sh
REFRAL_COMPARE_SCENES=suzanne-3000,interactive-cubes,shapes-four \
  REFRAL_REPORT_POINTER=release.txt python3 artifacts/geometry-performance/lock.py \
  node artifacts/adjacent-draw/compare.mjs control=a9b898b geometry=9375779 pipeline=39966d4 matrix=0b762bc
```

## Within-page control

A diagnostic archive of the candidate switched among two identical baseline draw implementations, geometry reuse, geometry plus pipeline reuse, and all three changes. Each backend reused its device, page and scene. Each pose was rendered with all five paths in rotating and reversing order. A small frame-boundary hook discarded the one-entry geometry shortcut so the baseline could safely access its original independent LRU path. The diagnostic borrows the draw implementations directly from the three measured revisions. The actual Wasm binary stayed fixed.

Three rounds each warmed 12 poses and measured 60 poses per path. The table uses the same p50 / p95 aggregation and units as the continuous animation comparison. For every page the five paths had matching work per pose and byte-identical final captures.

| Scene | Core | Native | Baseline | Geometry | Plus pipeline | Plus matrix |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| suzanne-3000 | js | 2.355 / 3.565 | 9.790 / 10.930 | 8.455 / 9.350 | 7.840 / 8.660 | 7.375 / 8.165 |
| suzanne-3000 | rust | 2.355 / 3.565 | 10.470 / 11.670 | 9.280 / 10.355 | 8.825 / 9.530 | 7.385 / 8.575 |
| interactive-cubes | js | 2.940 / 4.590 | 9.735 / 10.585 | 8.720 / 9.650 | 8.230 / 8.940 | 7.775 / 8.630 |
| interactive-cubes | rust | 2.940 / 4.590 | 9.530 / 10.285 | 8.695 / 9.390 | 8.170 / 8.955 | 7.130 / 7.770 |
| shapes-four | js | 0.585 / 2.330 | 2.555 / 3.800 | 2.675 / 3.770 | 2.495 / 3.760 | 2.505 / 3.740 |
| shapes-four | rust | 0.585 / 2.330 | 2.830 / 5.405 | 2.720 / 4.130 | 2.615 / 3.960 | 2.290 / 3.920 |

On both large workloads, each successive optimization reduced both percentiles in every paired round on each core. For Cubes JS the continuous animation's marginal p95 changed from 9.310 to 9.580 ms when adding matrix reuse. In the within-page control the same step reduced p95 by 0.310, 0.300 and 0.400 ms. The increase from the independent pages did not reproduce here. Its precise cause remains undetermined.

On Shapes, the geometry-only JS p50 deltas (savings) were +0.085, -0.070 and -0.135 ms, with identical baseline controls differing by +0.110, -0.145 and -0.090 ms. This scene previously showed zero adjacent-geometry hits. Individual steps have mixed small-scene effects. Retain it as a miss-path control. The combined result was faster than baseline at both percentiles in every paired round on both cores.

The raw paired data and captures are in `artifacts/adjacent-draw/2026-11-26T13-56-17.281Z/`. Phase switches and instrumentation live only in the diagnostic checkout. The 27-page control, round-level gains for every comparison and summary scripts are indexed by `paired.txt`, `paired-analysis.json` and `analyze.py` in the evidence directory.

## Compatibility evidence

The complete headless Chrome suite passed 232/232 with zero skipped, flaky or unexpected cases. The deployed dist passed the GPU probe, three-route RTT and triangle comparisons, readPixels, DOM uploads and CubeMap checks. Deterministic tests passed (246 TypeScript unit, 76 tooling, 77 native Rust), as did all 59 actual release-Wasm tests and support metadata verification.

All three routes passed 71/71 selected upstream WebGL1 files, covering buffers, vertex inputs, element indices, VAOs, uniforms, blend/minmax, stencil, culling, color masks and polygon offset. Native ran 9,535 passing assertions and JS/Rust each ran 7,192. Comparing each route with its previous record for the same 71 URLs found no changes in status, pass/fail/skip counts, upstream completion, skipped failures or assertion timeouts. Original identities and captures are in `artifacts/adjacent-draw/cts/`. See `verify.sh`, `chrome-results.json`, `deployment.json` and `cts-comparison.json` in the same evidence directory for commands and verification details.

Delivery uses [PR 113](https://github.com/GhostFlying/refral/pull/113) and rebase merge.
