# WebGL1 non-point drawing topologies

## Plan

Task 053 groups the remaining primitive modes and index behavior. Use the pinned WebGL 1.0 draw validation and GLES 2.0 sections 2.7 and 3.4–3.5 for primitive assembly. Keep the original GL topology in the shared draw snapshot. Both cores validate mode, draw arguments, state and the selected element/attribute byte range. A zero-count indexed draw may use an aligned offset past the available indices and performs no fetch. Culling applies to triangles. Points remain a separate task.

- Map LINES and LINE_STRIP to the corresponding WebGPU primitive topology. Assemble LINE_LOOP with its closing segment and TRIANGLE_FAN with a fixed anchor, preserving drawArrays first, indexed byte offset, winding and the original GL indices (including 65535). Preserve existing draw ordering, cache keys, staging cleanup and mutable data snapshots.
- Exercise assembly on CPU, actual Wasm forwarding and three-backend differential pixels for indexed and array draws. Record the behavior surviving the original line-loop-tri-fan, draw-elements-out-of-bounds and line-rendering-quality tests. The physical line width is one pixel, with hardware rasterization rules checked against the original coverage and orientation tests.
- Owned modules are the common draw contract, both semantic draw planners, Wasm reader, browser host primitive assembly, shared tests and scope documentation. Verify with pnpm check, pnpm rust:build and pnpm rust:test:wasm. The integrating agent owns all headless GPU runs.

## Implementation and acceptance

Both cores preserve the logical primitive mode and validate each selected index through their existing draw path. A zero-count draw still validates the offset, program and draw state, and fetches no index bytes. The No Client Side Arrays clause requires a bound element buffer even for zero count. Rust sends the original mode in the existing RFD5 draw record. The shared host widens indexed strips when a selected ushort is 65535 and generates bounded 32-bit index batches for loops and fans.

- `pnpm check` passed 230 Vitest checks, 59 tool checks, 75 native Rust checks and support validation. `pnpm ci:check` passed.
- `pnpm rust:build && pnpm rust:test:wasm` passed 48 actual-Wasm checks. The isolated 6dff15c-based build at `artifacts/core-wasm/refral_core.wasm` is 328632 bytes, SHA-256 `f64ee2933e7a8bb84d55348815db9ea1917447a103f0e49420dcab129e2ac527`.
- Local GPU acceptance uses `REFRAL_HEADLESS=1 pnpm test:drawing --grep line-and-fan-modes` and the original `conformance/rendering/{line-loop-tri-fan,draw-elements-out-of-bounds,line-rendering-quality}.html` on native, JS and Rust. The differential covers fan winding, drawArrays first, indexed byte offsets, a closing edge, culling and scissor. GPU results belong to the integrating build.
- Lines use WebGPU's single-sample line rasterizer at one physical pixel. ANGLE's native backend and the selected WebGPU backend may resolve endpoint or subpixel ties differently. The official quality case counts horizontal/vertical crossings in two contexts and does not establish coverage of every slope or blending overlap. Point size and point coordinates belong to the subsequent task.

The first original-file run exposed one failing assertion per core, for zero count with a null element buffer. Apply the additional unconditional WebGL1 No Client Side Arrays validation, retain the zero-count range exemption for a bound buffer, and rerun the shared contract and four original files.

All three backends completed the four original files after the correction at 9943fbe. draw-arrays-out-of-bounds, draw-elements-out-of-bounds, line-rendering-quality and line-loop-tri-fan passed 30, 44, 13 and 10 assertions respectively on every backend. The three-way pixel differential for closed lines and fans also passed. The original screenshots, raw counters and pixel results are in artifacts/conformance/campaign/nonpoint-topology/9943fbe. The integrated combined head passed 49 actual-Wasm tests.
