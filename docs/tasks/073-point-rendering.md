# Point primitives, point size and point coordinates

## Plan

The original point-no-attributes, point-size, point clipping and point-coordinate cases depend on WebGL1 point drawing. Task 058 supplies validated draw arguments and immutable index/attribute snapshots. The current renderer supports single-sample targets. The initial compiler probe shows ANGLE retains gl_PointSize in the translated vertex shader's private state and currently fails WGSL generation for fragment gl_PointCoord.

- Follow GLES 2.0.25 §§2.7, 2.13, 3.3 and ESSL 1.00 built-ins. Preserve current-program validation, near/far center clipping and visible wide sprites whose centers extend beyond viewport x/y, requested point size clamped to a declared physical range, upper-left point coordinates, viewport-dependent pixel sizing, ordered vertex/index input and polygon culling independence.
- Extend the pinned ANGLE WGSL pipeline I/O pass with a WebGL1 point-specific shader entry point for each stage. The vertex entry executes the user's shader and expands a point into a screen-aligned instanced quad. The fragment entry supplies the interpolated point coordinate. Regular polygon and line entry points preserve existing behavior. Record the compiler patch and actual build.
- Both semantic cores represent points in the existing draw record and expose identical point size range queries. The common host selects point entry points and instance-stepped vertex attributes; indexed points gather the selected indices from the immutable snapshot. The host uses viewport dimensions, retains depth and fragment tests and suppresses polygon-only culling/bias. Verify ESSL compile/link, real Wasm and headless three-way pixels.
- Record original points and previously terminated files, per-file status, assertions, actual core and screenshots. The required GPU window is headless Chrome under the shared campaign lock.

## Verified results

Chrome 158.0.8127.36 on macOS arm64 and Apple metal-3 ran headless with one GPU worker at revision 4d2167c. The point-sprites differential compared 64×64 RGBA pixels and matched native and the expected regions on all channels. This covers upper-left point coordinates, front-facing fragments, zero culling, size 16, a near-clipped center, two viewport sizes, indexed vertex 65535, nonzero byte offset and index mutation.

The 58-case ANGLE CPU corpus, three GPU compiler checks, 234 Vitest, 62 tool, 75 native Rust and 50 actual-Wasm checks passed. The point patch applies to a fresh unpacking of the pinned ANGLE archive after the existing varying-array patch and exactly reproduces the two locally compiled source files. The generated program includes both ordinary and point-specific entries. The production bundle builds successfully.

| Original file | Native passed / failed | JS passed / failed | Rust passed / failed |
| --- | ---: | ---: | ---: |
| conformance/buffers/buffer-uninitialized.html | 202 / 0 | 202 / 0 | 202 / 0 |
| conformance/glsl/variables/gl-pointcoord.html | 72 / 0 | 72 / 0 | 72 / 0 |
| conformance/glsl/variables/gl-fragcoord-xy-values.html | 11 / 0 | 11 / 0 | 11 / 0 |
| conformance/misc/shader-precision-format.html | 65 / 0 | 53 / 12 | 53 / 12 |
| conformance/misc/type-conversion-test.html | 808 / 0 | 808 / 0 | 808 / 0 |
| conformance/reading/fbo-remains-unchanged-after-read-pixels.html | 4 / 0 | 4 / 0 | 4 / 0 |
| conformance/rendering/blending.html | 13 / 0 | 6 / 0 | 6 / 0 |
| conformance/rendering/clipping-wide-points.html | 10 / 0 | 10 / 0 | 10 / 0 |
| conformance/rendering/more-than-65536-indices.html | 19 / 0 | 19 / 0 | 19 / 0 |
| conformance/rendering/point-no-attributes.html | 3 / 0 | 3 / 0 | 3 / 0 |
| conformance/rendering/point-size.html | 20 / 0 | 20 / 0 | 20 / 0 |
| conformance/rendering/point-specific-shader-variables.html | 13 / 0 | 13 / 0 | 13 / 0 |
| conformance/rendering/point-with-gl-pointcoord-in-fragment-shader.html | 2 / 0 | 2 / 0 | 2 / 0 |
| conformance/state/gl-get-calls.html | 280 / 0 | 192 / 0 | 192 / 0 |
| conformance/textures/misc/format-filterable-renderable.html | 13 / 0 | 13 / 0 | 13 / 0 |
| conformance/textures/misc/texture-active-bind.html | 14 / 0 | 14 / 0 | 14 / 0 |
| conformance/uniforms/out-of-bounds-uniform-array-access.html | 32 / 0 | 32 / 0 | 32 / 0 |

All six point-specific originals passed on each backend. Of the 17 selected originals, native passed 17; JS and Rust each passed 16. The remaining 12 assertions in shader-precision-format.html concern WebGLShaderPrecisionFormat object identity, tracked in task 074. The alpha blending extension branch and optional parameter queries differ by advertised capability. Individual results, screenshots and hashes are under `artifacts/conformance/campaign/point-primitives/`.

The combined sampler, point and realm-interface build ran twelve adjacent originals on headless Chrome. Point-dependent shader-precision-format now completes 65/0 across all three implementations. The combined shader invariance original also completes 19/0 across all three. Eleven files passed on both cores; constants-and-properties retained six enumerable property assertions. Chrome native passed all twelve. All eight public compiler/interface tests passed. The complete original page records are in artifacts/conformance/campaign/point-identity-integration/official.
