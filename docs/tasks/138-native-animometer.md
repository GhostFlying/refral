# 138 Native Animometer comparison

Run the task 137 scalar workloads on the Mini through a shared Node/V8 WebGL binding, a calibration backend, native Refral Rust with a Dawn host and ANGLE's EGL/GLES WebGPU renderer. Keep the Node adapter limited to APIs exercised by this fixture. Use the pinned upstream JS and shader inputs. Check real adapter, native dispatch, fast and fallback counts, calls and resulting pixels before interpreting timings. Pin the local Chromium, ANGLE, Dawn and Node versions. Preserve raw data in artifacts/native-dawn. Use the shared exclusive GPU lock, one headless worker, three rounds and 30 + 120 frames. Report browser baseline and native CPU timing boundaries and gaps. Own the isolated benchmark harness, native build integration and this record.

## Implemented paths and timing

The Node runner executes the pinned Animometer script, original frame callback, shader pair and vertex streams. Its small DOM supplies an 800 × 600 canvas, script elements and the task 137 deterministic clock. The controlled variants use the same source transformation and inputs as the browser harness. JS provides the initialization descriptors. In the measured loop the application invokes native WebGL-shaped methods directly.

Both rendering paths and the checksum backend share one addon, the same V8 Fast API functions and the same ordinary callbacks for fallback. Each uniform argument is a canonical JS location object and a scalar. The common binding resolves the location, converts the number to float and counts which callback actually ran. The checksum backend consumes each draw and uniform without creating a GPU device. An independent JS calculation checks the last frame's checksum. On the original scene the runner also disables V8 fast calls with `--no-turbo-fast-api-calls` and verifies that every measured call used fallback.

- Native Rust invokes the repository's `BufferCore` for setters and draw planning. Its fixture-specific C++ Dawn host consumes each draw's uniform snapshot. The program, pipeline, bind groups and two vertex streams are prepared once. A frame uses one render pass, one dynamic uniform offset per draw, one upload from the CPU staging arena and one queue submission. This specializes the fixed program, layout and raster state. It does not represent a general native Refral host.
- Native ANGLE compiles the original ESSL, uses a WebGL-compatible ES2 context on a surfaceless EGL display and draws to an explicit RGBA8 framebuffer. ANGLE receives the hardware Metal device and native Dawn proc table from the same Chromium build as the Rust host. The runner checks framebuffer completeness, renderer and GL errors. The browser's native WebGL reference uses ANGLE's **Metal** renderer.
- Calibration includes the upstream JS loop and data reads, binding and counter work, handle lookup and checksum arithmetic. Its time is reported independently. Subtracting it from browser or GPU timings would assume those costs combine linearly.

Each of three rounds starts an independent Node process per cell. Backend order rotates. The timer covers the original callback through `gl.flush()`, including CPU encoding, uploads and any synchronous submission work. A Dawn queue wait after each Node frame limits execution to one frame in flight. Chrome paced frames by rAF and did not insert the Node per-frame queue wait. Readback and audits run outside the clocks. These are CPU wall times per frame. GPU duration, compositor work and display FPS are unmeasured.

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
