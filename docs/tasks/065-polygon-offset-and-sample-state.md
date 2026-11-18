# Polygon offset, sample coverage and subpixel precision

## Plan

Task 053 identifies missing state in gl-get-calls, gl-enable-enum-test and polygon-offset. The initial test base combines task 057 and task 058. The fixed WebGL1 IDL declares polygonOffset(GLfloat, GLfloat) and sampleCoverage(GLclampf, GLboolean). GLES 2.0.25 sections 3.5.2, 4.1.3 and the state tables define the initial settings and their effect on fragments.

- Implement both calls through the public facade and each core. Initially polygon offset factor/units are zero and fill is disabled. Alpha-to-coverage and sample-coverage are disabled, stored coverage is one and invert is false. Clamp the coverage value to [0, 1], preserve capability state and report it via ordinary GL queries. The supported targets have zero sample buffers, so these settings leave the single-sample result unchanged.
- Report four subpixel precision bits for this rasterizer profile, matching GLES's minimum and pinned ANGLE's WebGPU and Metal default. Capabilities are per context.
- Carry slope, units and polygon fill enablement in the per-draw snapshot. Version the private Rust draw record and ABI, keep unaffected clear/resource encoding, and update capacity checks, loader and deployment checks. Set the WebGPU depth-stencil bias only for triangle topologies with a depth attachment, key pipelines by the effective bias, and preserve requested floats for queries. Exercise positive/negative slopes, fractional and large units, cache reuse, disabled bias and active depth comparisons on real hardware.
- Run pnpm check, pnpm rust:build, pnpm rust:test:wasm and headless three-way original-file and differential checks under the campaign GPU lock. Save per-file assertions and image evidence in artifacts/conformance/campaign/raster-coverage. Point range and point drawing are separate work.

## Implementation and validation

ABI6 reserves the extra 12 bytes in each RFD6 draw record before the mode and counts. The public queries retain the two GLfloat offsets. WebGPU’s depthBias is a signed integer, so the executor rounds units to nearest with ties away from zero, saturates to the i32 range, and uses the selected depth format’s hardware resolution. Factors and enabled state are taken from the individual draw snapshot. Refral does not advertise multisample buffers in this profile.

The initial CPU build passed TypeScript, native Rust, support validation, and 50 actual-Wasm checks. The added WebIDL regression verifies arity validation before mutation, f32 value conversion and boolean invert conversion.

Headless Chrome 158.0.8127.36 on Apple metal-3 ran three originals against code revision dc1dec4. Native, JS and Rust passed all 10 polygon-offset and all 339 gl-enable-enum-test assertions independently. Native gl-get-calls passed 280; JS and Rust each passed 189 with three failures for the separate point-size range query and resultant error. Task 073 covers that query and its point drawing behavior.

The 64×64 native/JS/Rust differential produced identical pixels on all channels, including negative tilt, positive/negative slope, units ±1.75 and ±2^34, disabled bias and enabled sample coverage on a single-sample target. `pnpm build && pnpm test:dist` verified ABI6, packaged Wasm identity, three-path triangles and RTT, readPixels, DOM and CubeMap images and the WebGPU probe. Evidence, screenshots, actual contexts and per-file assertions are under `artifacts/conformance/campaign/raster-coverage/`, including `dual-core/result.json` and `dist-rerun.log`. The final deterministic run passed 235 unit tests, 59 tool tests and 75 native Rust tests.
