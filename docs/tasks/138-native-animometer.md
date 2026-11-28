# 138 Native Animometer comparison

Run the task 137 scalar workloads on the Mini through a shared Node/V8 WebGL binding, a calibration backend, native Refral Rust with a Dawn host and ANGLE's EGL/GLES WebGPU renderer. Keep the Node adapter limited to APIs exercised by this fixture. Use the pinned upstream JS and shader inputs. Check real adapter, native dispatch, fast and fallback counts, calls and resulting pixels before interpreting timings. Pin the local Chromium, ANGLE, Dawn and Node versions. Preserve raw data in artifacts/native-dawn. Use the shared exclusive GPU lock, one headless worker, three rounds and 30 + 120 frames. Report browser baseline and native CPU timing boundaries and gaps. Own the isolated benchmark harness, native build integration and this record.

## Implemented paths and timing

The Node runner executes the pinned Animometer script, original frame callback, shader pair and vertex streams. Its small DOM supplies an 800 × 600 canvas, script elements and the task 137 deterministic clock. The controlled variants use the same source transformation and inputs as the browser harness. JS provides the initialization descriptors. In the measured loop the application invokes native WebGL-shaped methods directly.

Both rendering paths and the checksum backend share one addon, the same V8 Fast API functions and the same ordinary callbacks for fallback. Each uniform argument is a canonical JS location object and a scalar. The common binding resolves the location, converts the number to float and counts which callback actually ran. The checksum backend consumes each draw and uniform without creating a GPU device. An independent JS calculation checks the last frame's checksum. On the original scene the runner also disables V8 fast calls with `--no-turbo-fast-api-calls` and verifies that every measured call used fallback.

- Native Rust invokes the repository's `BufferCore` for setters and draw planning. Its fixture-specific C++ Dawn host consumes each draw's uniform snapshot. The program, pipeline, bind groups and two vertex streams are prepared once. A frame uses one render pass, one dynamic uniform offset per draw, one upload from the CPU staging arena and one queue submission. The host supports this fixture’s fixed program, layout and raster state.
- Native ANGLE compiles the original ESSL, uses a WebGL-compatible ES2 context on a surfaceless EGL display and draws to an explicit RGBA8 framebuffer. ANGLE receives the hardware Metal device and native Dawn proc table from the same Chromium build as the Rust host. The runner checks framebuffer completeness, renderer and GL errors. The browser's native WebGL reference uses ANGLE's **Metal** renderer.
- Calibration includes the upstream JS loop and data reads, binding and counter work, handle lookup and checksum arithmetic. Its time is reported independently. Subtracting it from browser or GPU timings would assume those costs combine linearly.

Each of three rounds starts an independent Node process per cell. Backend order rotates. The timer covers the original callback through `gl.flush()`, including CPU encoding, uploads and any synchronous submission work. A Dawn queue wait after each Node frame limits execution to one frame in flight. Chrome paced frames by rAF, with the browser managing queue depth. Readback and audits run outside the clocks. These are CPU wall times per frame. GPU duration, compositor work and display FPS require separate instrumentation.

The browser columns reuse the same Mini's completed [task 137 measurements](137-animometer-uniform-cost.md) at code revision `7806c64` (Chrome 158.0.8127.37). The native build uses the same semantic core on main `8d5f8c0`, Node 24.14.0 / V8 13.6.233.17-node.41, Chromium `77a6c69`, ANGLE `d1c0f87`, Dawn `922930e` and Animometer `8635561`. Chromium's arm64 component build has `is_debug=false` and `symbol_level=1`. Dawn identified an Apple M6 on macOS 27.2.1 (26B131). Browser and native Refral use the same project compiler Wasm. All upstream components are consumed from their respective pinned builds or checkouts. [Native build script](../../benchmarks/native-dawn/build.sh)

## Reproduction on the Mini

Use the existing arm64 Chromium component build at `$CHROMIUM_SRC/out/Default` (default checkout `~/WORKSPACE/chromium/src`) including Dawn's native/proc libraries, generated headers and the object inputs for ui/gl/init. The build script links a local dispatcher against those inputs. The runner also needs the task 137 Animometer checkout and project shader compiler, available through `pnpm bench:external:deps` and `pnpm compiler:build`. Use a fresh output directory for each campaign.

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
b=benchmarks/native-dawn
a=artifacts/native-dawn
browser=artifacts/external-benchmarks/2026-11-28T09-45-22.914Z
output="$a/repeat-$(date +%s)"
bash "$b/build.sh"
python3 artifacts/geometry-performance/lock.py node "$b/compare.mjs" "$browser" "$output"
python3 "$b/report.py" "$browser" "$output"
```

The optional allocation audit builds a separate addon. Its proc table counts calls made by ANGLE to Dawn's buffer and bind group creation functions. Each log line covers the interval through queue completion. The first line includes cold initialization. Use subsequent frames to compare steady-state allocations.

```sh
bash "$b/build.sh" --count-allocations
for k in 0 1 3 6; do
  REFRAL_COUNT_ALLOCATIONS=1 REFRAL_WARMUP=2 REFRAL_SAMPLES=3 \
    python3 artifacts/geometry-performance/lock.py node "$b/run.mjs" angle \
    "animometer-uniforms-$k" "$a/audit-$k"
done
```

## Measurements

Pooled nearest-rank CPU p50 / p95 in ms/frame. Each cell contains 360 samples. The browser and Node columns use the scheduling boundaries described above.

| Uniform updates per draw | Chrome WebGL | Chrome Refral JS | Chrome Refral Rust/Wasm | Node calibration | Node Rust/Dawn | Node ANGLE/Dawn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frame setup | 0.020 / 0.040 | 0.145 / 0.230 | 0.175 / 0.285 | 0.00046 / 0.00050 | 0.016 / 0.019 | 0.016 / 0.018 |
| 0 | 1.610 / 1.650 | 15.380 / 20.705 | 16.360 / 17.465 | 0.036 / 0.036 | 5.107 / 5.160 | 1.604 / 1.690 |
| 1 | 1.500 / 1.525 | 18.040 / 19.285 | 18.515 / 19.740 | 0.073 / 0.075 | 5.541 / 5.594 | 80.544 / 83.030 |
| 3 | 2.180 / 2.550 | 23.225 / 24.465 | 22.920 / 24.135 | 0.179 / 0.190 | 6.334 / 6.916 | 81.240 / 88.738 |
| 6 | 2.940 / 3.625 | 30.250 / 31.405 | 29.005 / 30.110 | 0.356 / 0.378 | 7.574 / 7.642 | 83.165 / 85.000 |
| Original upstream (6) | 2.930 / 3.640 | 29.920 / 31.150 | 28.880 / 29.970 | 0.366 / 0.391 | 7.569 / 7.641 | 83.129 / 84.861 |

The controlled zero-to-six-write increase was 2.467 ms/frame on native Rust, or 20.6 ns per additional setter averaged across the 120,000 calls. With zero loop updates Rust used 5.107 ms/frame and ANGLE used 1.604. On the original scene Chrome Rust/Wasm used 3.82 times the native Rust host’s CPU time. Chrome native WebGL used 2.930 ms/frame.

### V8 binding calibration

Original workload with 20,000 draws and 120,000 setters per frame. Both modes execute the same application code and receive the same uniform-location objects.

| Node path | Default p50 / p95 | Forced fallback p50 / p95 | Change in p50, ms |
| --- | ---: | ---: | ---: |
| Calibration | 0.366 / 0.391 | 1.083 / 1.160 | +0.718 |
| Rust/Dawn | 7.569 / 7.641 | 8.203 / 8.358 | +0.634 |
| ANGLE/Dawn | 83.129 / 84.861 | 83.991 / 88.262 | +0.862 |

Each default backend used the fast path for 7,199,640 of 7,200,000 draws and 43,197,840 of 43,200,000 setters on the original workload (99.995% apiece). Forced fallback registered zero fast calls. Dispatch depends on call site and JIT tier. The zero-update draw loop has its own fast/slow counts in the raw files.

Node Rust reduces the time seen on the browser Rust route, while the browser, JS/Wasm transport, general-purpose GPU host and queue scheduling all change together. The experiment identifies the effect of switching bindings within each native path. Isolating any one of the cross-host factors would require holding the others constant.

### Why ANGLE changes at the first uniform write

On the separate allocation build, zero per-draw writes caused one Dawn buffer and one bind group creation per steady-state frame. With 1, 3 or 6 writes, each of the six post-bootstrap frames created exactly 20,000 buffers and 20,000 bind groups. The pinned renderer checks whether the default uniform block is dirty at draw time, allocates a mapped buffer, copies the uniform bytes, unmaps it and creates a bind group. Multiple setters before a draw share that update. This accounts for the shape of the measured jump. The audit measures resource creation counts. [Pinned ANGLE implementation](https://chromium.googlesource.com/angle/angle/+/d1c0f87e4626e19a4803cda526afa7eeffbe109a/src/libANGLE/renderer/wgpu/ProgramExecutableWgpu.cpp#47)

### Verification and delivery

The release comparison ran 63 isolated Node processes. Each checked measured draw and setter counts. All 42 rendered audit frames (800 × 600 RGB) matched their corresponding Chrome native screenshot at every pixel, including the forced-fallback captures. All calibration audit checksums matched. Hardware checks, GL errors, Dawn validation and queue completion were checked on the relevant paths.

Local verification passed the native addon and allocation-audit builds, rustfmt, locked Clippy, pnpm check (248 unit tests, 76 tooling tests and 77 native Rust tests), ci:check and 73/73 actual-Wasm tests. The measured Node timer step was 0.000041 ms. Raw samples, PNGs, pooled and per-round statistics, observed dispatch counts, build identities and a timer-resolution probe are under `artifacts/native-dawn/release-138/`. Allocation counts are in `artifacts/native-dawn/audit-{0,1,3,6}.log`. The Mini retains an independent earlier campaign in `artifacts/native-dawn/final-138/`. [Delivery PR 121](https://github.com/GhostFlying/refral/pull/121)
