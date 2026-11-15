# Canvas2D and worker readback comparison

Status is locally complete from main 8664c74 on 2026-11-15. Delivery is tracked under artifacts/readback-comparison/delivery.json.

## Goal and ownership

Compare the Canvas2D synchronous readback candidate with the existing GPU-worker shared-result candidate using actual JS/Rust cores, common ESSL and equivalent rendering inputs. Establish byte correctness, ordering, ownership and measured latency/process CPU before choosing the production integration direction. The integrating agent owns the host implementation, shared scene, browser runner, measurements, ADR/report and delivery. A bounded verification task reviews the assertions and measurement boundaries without running competing GPU work.

## Implementation plan

1. Add an experimental synchronous capture entry to the concrete browser host. Encode each RGBA8 source texel into two opaque pixels on a private sRGB WebGPU canvas, copy one-to-one through Canvas2D, synchronously obtain bytes and decode an owned result. Reuse pipeline/canvas resources, tile to the actual GPU dimension limit and dispose them with the host.
2. Generalize the existing readback scene's host construction so inline Canvas2D and GPU-worker execution run identical actual semantic cores, compiler inputs and GL traces. Preserve the existing feasibility command and worker failure/timeout checks. Keep public GL readPixels support tied to production implementation acceptance.
3. Add an executable comparison corpus for default/FBO targets, alternating draw uniforms, arbitrary RGBA including transparent nonzero RGB, uninitialized storage, texture upload snapshots/updates, write-then-sample, resize/reallocation, deletion and retained readback results. Compare every channel against explicit expectations and the other path. Check Canvas2D on ordinary and isolated pages.
4. Use an independent performance command with headed Chrome, one worker and owned HMR-disabled ports. Compare the two routes and both cores at 64x64 default, 320x240 default and 320x240 FBO. Each case uses 30 warmup samples, 120 measured samples, eight logical frames per sample and three rounds with rotated route/core order. Prepare/verify data outside sampled intervals. Yield between samples for retirement/completion tasks.
5. Record wall-clock GL-processing-plus-completed-readback latency in ms/operation, phase timings, initialization/first result, timer resolution and raw samples. Sample CDP process cumulative CPU before/after each measured batch, report renderer/worker-containing process CPU and GPU-process CPU separately, and retain exact batch boundaries and harness overhead. GPU-only duration remains separately identified as unmeasured.
6. Refresh the proposed ADR with both candidates, documented platform conditions and evidence-backed recommendation. Record the initial omission of Canvas2D, preserve dated earlier measurements, and deliver through the required PR/rebase workflow.

## Specification and acceptance boundaries

The WebGL read operation observes preceding commands and fills caller-visible bytes synchronously. HTML getImageData returns bitmap data synchronously, while nonopaque color conversion through Canvas2D can lose information. Opaque encoding preserves all four source bytes through the tested sRGB route. WebGPU mapping completion runs on the device owner's content timeline. Source links and exact tested profile belong in the report.

This task validates host capture and shared semantic rendering. Public readPixels argument/error ordering, destination packing, iframe branding and activation of additional original CTS remain the subsequent production integration task. Existing original CTS, demo and lifecycle regressions still run as acceptance. This comparison does not advance their production support entries.

## Acceptance commands and evidence

Run pnpm check, pnpm ci:check, pnpm test:readback, the focused comparison correctness command, the independent comparison benchmark, and affected Chrome host/lifecycle regressions. Preserve environment/source/build hashes, per-channel failures, process identities, raw samples and delivery data under ignored artifacts/readback-comparison. The report must distinguish actual-core correctness, original baseline CTS, experimental capture and process CPU measurements.

## Results and handoff

Added the host's lazy experimental captureCanvas entry, reusable opaque sRGB packing and bounded tiling, plus common actual-core rendering and independent comparison commands. Both cores pass Canvas on ordinary/isolated pages and on a Chrome launch using its native color-profile configuration. Both pass the existing GPU-worker route. Native/reference and tiling captures agree on all bytes, covering 163 image checks including retained-result rechecks, plus empty capture.

The comparison command passes fourteen cases. Earlier readback primitives pass eleven, the full Chrome suite passes 84, existing original CTS retains eleven files and 243 assertions per backend, and build/dist verification passes. The deterministic check passes 107 CPU and 44 native Rust tests with 28 support entries.

The accepted repeated capture contains 36 records and 4320 sample means, each covering eight operations. The first performance capture included caller uniform-array allocation. Inputs were then precomputed and a fresh complete capture was taken. Preliminary records retain their distinct artifact directories. Exact timings, process CPU and evidence paths are in the [comparison report](../validation/2026-11-15-readback-comparison.md).

A bounded verification agent reviewed the implementation and independently recomputed pooled latency/process CPU results from raw files. Its findings led to explicit primary-phase boundaries, steady FBO storage, precomputed input arrays, native-color testing and post-batch live-capacity checks. Review was read-only with no competing GPU work.

Canvas has lower renderer CPU and higher GPU-process CPU in the measured traces. Worker has lower completed-operation latency. Public readPixels integration and additional original pixel CTS remain the next task, with the proposed ADR now covering both candidates. This task makes no production support-status promotion.
