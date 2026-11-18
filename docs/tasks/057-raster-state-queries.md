# WebGL1 hint and line width queries

## Plan and specification

Own the WebIDL conversions, JS and Rust context state, internal Rust Wasm dispatch, support documentation and focused state tests for the two methods and their three queries. Task 053 provides the original-file baseline and the headless verification procedure. The current context exposes zero extensions.

- Implement core WebGL1 hint(target, mode) for GENERATE_MIPMAP_HINT. Accept DONT_CARE, FASTEST and NICEST, retain the chosen mode, use DONT_CARE initially, report INVALID_ENUM for an unknown or disabled extension target or mode, and preserve state on invalid calls.
- Implement lineWidth(width) with WebIDL unrestricted float conversion. Start at 1, generate INVALID_VALUE for zero, negative or NaN and retain the previous value. For positive widths retain the requested floating-point value for LINE_WIDTH. Advertise the WebGPU line rasterizer's singleton width range in a fresh Float32Array returned by ALIASED_LINE_WIDTH_RANGE. GLES2 §3.4 permits a width range containing only 1 and queries the unclamped requested width.
- Verify both semantic cores and the actual Wasm bindings. Preserve lost-context behavior and the original assertions in hint.html, gl-line-width.html and the related assertions in gl-get-calls.html and gl-enum-tests.html. The original gl-get-calls and gl-enum-tests files also exercise unrelated APIs.
- Acceptance: pnpm check, pnpm rust:build, pnpm rust:test:wasm, then a single worker in headless Chrome on all three backends for the four named originals. The integrating agent owns the GPU window.

## Local validation

The shared state fixture passed on the JS core and actual Rust Wasm. It covers invalid target and mode, mutation of the returned range, retained positive widths outside the physical range, NaN, infinities and prior state after errors. The facade fixture covers WebIDL arity, floating-point rounding and enum conversions. On the task branch, pnpm check passed 228 Vitest, 59 tool and 75 native Rust tests. The Rust build and all 48 actual-Wasm tests passed.

## Original conformance results

Headless Chrome 158.0.8127.36 on macOS arm64, Apple metal-3, ran all four original scripts on revision 790a258. The screenshot, context attributes, actual core, Wasm hashes and assertion output for each backend are under `artifacts/conformance/campaign/raster-queries/`.

| Original file | Native passed / failed | JS passed / failed | Rust passed / failed |
| --- | ---: | ---: | ---: |
| conformance/limits/gl-line-width.html | 14 / 0 | 14 / 0 | 14 / 0 |
| conformance/misc/hint.html | 502 / 0 | 252 / 0 | 252 / 0 |
| conformance/state/gl-enum-tests.html | 66 / 0 | 66 / 0 | 66 / 0 |
| conformance/state/gl-get-calls.html | 280 / 0 | 182 / 10 | 182 / 10 |

Chrome also ran the enabled OES_standard_derivatives section of hint.html. Both Refral cores covered the unextended WebGL1 path. The ten remaining gl-get-calls assertions covered ALIASED_POINT_SIZE_RANGE, COMPRESSED_TEXTURE_FORMATS, polygon offset, sample coverage, SUBPIXEL_BITS and the resulting GL error. The isolated build predates the compressed-texture validation task.
