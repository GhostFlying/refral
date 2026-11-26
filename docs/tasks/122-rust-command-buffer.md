# Rust command-buffer comparison

Compare the current public Rust/Wasm route, the previous typed-request control, and a bounded binary command buffer in the same Chrome campaign. Use Krypton's JS-to-native binding pattern of writing opcodes and arguments into shared backing memory and draining before synchronous results. Keep the first implementation behind the existing testing entry point while measuring it. The public WebGL factory stays unchanged.

The Rust adapter owns a fixed per-context input arena, records normalized numeric arguments and handle words directly in Wasm memory, and consumes mutable uniform data before the WebGL call returns. Rust uses the existing semantic operations in FIFO order, then publishes an ordered stream of draw/clear snapshots, resource version changes, artifact releases and VAO acknowledgments. The JS host consumes those records before updating GPU submission state. Reuse owned Buffer snapshots for repeated exact versions within a drain. Older ABI7 modules retain their current path.

The initial batch covers the steady-state Shapes trace. Synchronous queries, Buffer operations, other resource mutations, canvas-source preparation, and explicit flush/readback drain the prefix they observe. Draw and clear record the surface dimensions observed at enqueue. Context loss/disposal discard pending private work. VAO wrappers stay referenced until the matching acknowledgment. The experiment is scoped to fixed-size rendering until the existing canvas resize and context lifecycle suites validate a default rollout.

Ownership covers `packages/core-wasm`, `crates/wasm`, the shared facade hook and targeted tests. Run `pnpm check`, actual Wasm integration tests, headless Chrome drawing and deployment regressions. Benchmark native, current JS/Rust, typed Rust, and batched Rust with release Wasm, exclusive headless GPU access, matched workload and exact same-core pixels. Report CPU p50/p95 and actual batch/Buffer counters. Save evidence under `artifacts/rust-command-buffer/`.

## Implemented boundary

The private ABI7 batch capability opens a 128 KiB arena per enabled context. JS records scalar, array and matrix uniforms, `useProgram`, VAO binds, viewport, scissor, enable/disable, clear and both ordinary draw methods. Arena exhaustion drains the existing prefix before reusing its storage. Uniforms are copied into the arena at enqueue. Other resource commands and uploads use the existing transport after draining the pending prefix. One binary reply contains snapshots and resource/lifetime records in execution order. Buffer snapshots are reused across a drain by exact version, up to 512 entries and 32 MiB. The public factory still uses the existing path. `REFRAL_HEAVY_RUST_BATCH=1 REFRAL_HEAVY_SCENES=shapes-four pnpm bench:three:heavy` enables the prototype for the Rust benchmark candidate.

## Matched performance comparison

The comparison ran on Apple M4 Max and headless Chrome 158.0.8127.88. Each of three rounds ran 30 warmup frames and 120 sampled frames per variant. The table shows median-of-rounds CPU p50 / p95 values in milliseconds per frame. The interval includes animation, rendering, and explicit flush. GPU wait and final capture are outside the interval. The typed-request comparison uses the earlier verified alternate module that keeps the original responses and bypasses generic request framing for draw and `useProgram`.

| Scene | Native WebGL | Current JS | Current Rust | Typed Rust per call | Batched Rust |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four-view Shapes | 1.910 / 2.730 | 4.470 / 4.945 | 6.245 / 6.680 | 5.565 / 6.150 | 3.500 / 4.630 |
| Triangle cloud | 0.400 / 0.615 | 1.450 / 1.845 | 1.650 / 2.220 | 1.265 / 1.965 | 1.490 / 1.880 |
| Sobel 1080p | 0.475 / 0.655 | 1.830 / 2.435 | 2.055 / 2.685 | 2.000 / 2.745 | 1.720 / 2.630 |

For Shapes the combined command-buffer path saved 44% of current Rust p50 and 37% of typed-per-call p50. The p95 savings were 31% and 25% respectively. Batched p50 improved in every round. In one round batched p95 was 6.135 ms and typed per-call was 5.875 ms. The two- and three-draw cases did not show a comparable improvement across all rounds. rAF cadence stayed near 60 Hz. All 45 runs had matching scene poses and draw workloads. Both experimental Rust variants matched current Rust pixels exactly.

Shapes recorded about 1,708 commands per frame in one replay, with 72 kB input and 243 kB reply. The adapter still resolves buffer snapshots through Wasm as needed. It copied 129 distinct Buffer snapshots and 599,228 bytes per frame, compared with about 633 copies and 2.46 MB in the earlier current-Rust diagnostic. Steady host counts remained one submission, two passes, 53 bind groups and around 189 kB uploaded per frame. The release Wasm is 366,129 bytes, 7,716 bytes larger than the original 358,413-byte artifact. Artifacts, exact build identities, frame samples, and screenshots are under `artifacts/rust-command-buffer/2026-11-26T05-04-53.655Z/`.

## Verification

`pnpm check`, 224 headless Chrome tests, `pnpm build`, and the headless deployment suite passed. The deployment loaded batch protocol v1 from the packaged Wasm. Actual-Wasm adapter tests passed 55/55 with both the new build and the original ABI7 module. The batch-specific Chrome tests checked immediate error/query ordering, mutable uniform inputs, arena overflow, VAO identity, FBO versions, and program retirement after a queued draw. The standard heavy benchmark entry point passed its native, JS, and batched Rust smoke with matching pixels and explicit batch counters.
