# Synchronous readback feasibility

Status is locally complete from main 67c20c9 on 2026-11-15. PR delivery is recorded under artifacts/readback/delivery.json.

## Goal and scope

Answer the user's request to validate synchronous WebGL readback support before expanding the CTS texture/input profile. Produce executable Chrome evidence for the current Window-owned WebGPU host, a GPU worker with shared results, and a worker-owned API client. Record required deployment conditions, ordering, failure behavior and measured blocking cost. Keep the public support matrix tied to implemented production behavior.

The integrating agent owns this task, experiments/readback, its verification command/configuration and the readback ADR/report. A verification worker owns task026 and its CTS dependency audit. Existing runtime modules and public contracts remain outside this exploratory implementation scope unless an observed recoverable failure requires a narrowly recorded correction.

## Plan

1. Read current WebGPU mapping, HTML worker/event-loop/shared-memory rules, pinned WebGL readPixels requirements and the existing capture implementation.
2. Probe Window Atomics.wait, SharedArrayBuffer and mapAsync completion under normal and cross-origin-isolated HTTP responses.
3. Run actual Refral JS/Rust semantic cores on the caller thread with the common browser host in a dedicated GPU worker. Snapshot ordered host inputs, validate completion sequences and use bounded shared output. Verify synchronous Window result copying while GPU work and asynchronous mapping progress on the worker.
4. Exercise a worker client using Atomics.wait and an independent GPU worker. Check repeated commands, fresh rendered pixels, timeout/error signaling and cleanup. Collect initialization, round-trip and GPU/readback phase timings with exact boundaries.
5. Record supported experimental paths, unavailable paths and production integration work in a proposed ADR. Audit original CTS prerequisites without changing their scripts/assertions.

## Acceptance

Use installed Chrome, headed mode, DPR1 and one GPU worker. Run the experiment through its own command and owned ports so the user's active demo server remains available. Verify actual adapter/core, distinct sequential image contents, errors, completion sequences and bounded waits. Preserve raw results under ignored artifacts/readback. Run TypeScript, deterministic repository checks and the current demo smoke when affected. Deliver the bounded experiment and findings through the repository's required PR/rebase flow.

The initial research decision is based on runtime evidence. Public readPixels support and a new host threading model require their own implementation acceptance after this feasibility result.

## Results and handoff

Added experiments/readback with actual JS/Rust semantic callers, the common compiler and a private ordered GPU-worker adapter. The seven experimental cases and four existing CTS/demo smoke cases pass through `pnpm test:readback`. All 128 regular images and four post-error recovery images have zero mismatched channels. Owned copies, sequence checks, local synchronous queries, recoverable errors, bounded timeout termination and caller timer behavior pass. Original CTS remains eleven files and 243 assertions per native/JS/Rust backend.

The proposed [ADR](../adr/007-synchronous-readback.md) records the cross-origin-isolated shared-memory and independent-callback-agent conditions. Window uses polling, while a worker caller can use Atomics.wait. The [report](../validation/2026-11-15-readback-feasibility.md) supplies exact environment, build/source provenance, latency boundaries and the initial interrupted HMR smoke attempt. Task026's [audit](../references/cts-readback-dependencies.md) supplies the pinned prerequisites and iframe-brand dependency, with corresponding lock-file metadata corrections.

The experiment and root TypeScript project are checked together. New experiment TypeScript was formatted with Prettier 3.7.4. Acceptance commands are `pnpm check`, `pnpm ci:check` and `pnpm test:readback`. Logs are retained in artifacts/readback-check.log, artifacts/readback-ci-check.log and artifacts/readback-spike.log. The delivery record links the final PR/current-head required check and integrated revision.

Public readPixels, production host transport/presentation, loss handling, DOM uploads and Buffer cache optimization require their bounded follow-up tasks. The production support status remains tied to the existing public context.

## Report-path correction

After PR 12 merged, delivery verification found Playwright resolving its JSON reporter path relative to experiments/readback. The report was generated under experiments/readback/artifacts/readback. Correct the reporter's output to an absolute root-artifacts path, rerun the eleven Chrome cases, and verify the JSON totals and capture-source inventory before the follow-up fix PR. The integrating agent owns the configuration, this record and the refreshed validation report. Acceptance uses the same readback, type and policy commands, plus an explicit report-path/statistics check.

The corrected command passes eleven cases in 13.8 seconds and writes the JSON report at the documented root path. Its parsed totals are eleven expected, zero unexpected, zero skipped and zero flaky cases. The report's timing table and raw summary reflect this recapture. Final delivery records retain both the experiment PR and reporter correction.
