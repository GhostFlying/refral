# Render-to-texture verification and performance

Status is running.

## Goal and ownership

Implement shared native/JS/Rust verification, the pinned render-to-texture demo adapter, and an independently invoked five-workload baseline for task 020. This task owns fixture acquisition and selection, the CTS Chrome entry, new RTT fixtures and Chrome tests, the existing demo adapter/test, browser benchmark code and its independent runner, and this record. The integrating agent owns public interfaces, shared resources, UI selectors, root commands/build/deployment configuration, support reporting, and delivery.

## Plan

1. Audit the fixed WebGL/IDL/GLES rules and selected upstream tests. Acquire four additional original uniform CTS files through a preparatory lock list, preserving the seven-case executable list and its current assertion budget for PR1.
2. Hand off acquisition and source findings so the integrating agent can verify the existing 64 Chrome tests and JS demo before advancing the default Rust ABI.
3. At PR2, activate the four original uniform files and record their actual assertion totals. Document texture/FBO original-test prerequisites and map project regressions to their sources.
4. Add identical specification-derived state/error/pixel traces for typed uniforms and matrices, five texture formats and unpack behavior, updates/completeness/sampler units, FBO/raster/deletion/resize/context behavior, and ordered snapshots.
5. Extend the pinned demo to native/JS/Rust with a JS alias, selected-core checks, metadata and build hashes. Run the same prepared scene at 320×240, DPR1, times 0/1000/2000. Compare native with two-byte/one-pixel-edge tolerance and JS/Rust exactly.
6. Implement a separate performance runner for five workloads, three rotated backend rounds, 30 warmup samples, 120 measured samples and eight logical frames per sample. Exclude input preparation from intervals, include GL conversion/copy/bridge/encoding/flush, and pace with equivalent RGBA readback outside intervals. Record setup/first-image timing, raw samples, timer/cache/environment/counter/memory information and GPU timing availability.
7. Run CPU checks during implementation and coordinate exclusive Chrome correctness/performance windows with the integrating agent. Record exact results and capability gaps before delivery.

## Acceptance

Original CTS scripts and assertions remain intact. Shared fixtures verify specification expectations and retain reproducible native deviations. Demo frames have per-backend shader/configuration/image evidence. Performance results state exact units, timing boundaries, workload sizes, warmup/repetitions, pace/readback regions and unavailable measurements. PR1 preserves the current executable test selection, and later stages advance only with their stated implementation prerequisites.

## PR1 preparatory acquisition

The four original uniform files are recorded in `cts.preparedTests` at revision `39443210f7f81db4773eb104facadfb85d05dfa4`. The acquisition script fetches this list, while `cts.tests` continues to contain the existing seven files. The CTS runner and its current 100-assertion budget remain unchanged during this preparation.

`node tools/deps-fixtures.mjs` acquired all four files. They require only the existing `js-test-pre.js`, `webgl-test-utils.js`, `js-test-post.js`, and stylesheet resources. Their WebGL1 branches use synchronous state/query assertions and have no pixel-readback prerequisite.

The source audit identified these acceptance details for the semantic owners.

- `gl-uniform-arrays.html` accepts shorter complete updates and larger complete arrays, with extra array values ignored. It checks element queries, reflection names ending `[0]`, wide out-of-range location strings, malformed vector lengths, and wrong setter widths. Its integer/boolean/unsigned sections are WebGL2-only, so the WebGL1 project regressions supply the typed integer and boolean evidence required by task 020.
- `gl-uniformmatrix4fv.html` checks mat2/mat3/mat4 lengths, fixed shared inputs when available, and transpose rejection in WebGL1.
- `gl-uniform-bool.html` requires a float setter to accept a bool uniform.
- `gl-get-uniform-non-current-program.html` requires querying another program and querying while no program is current, including previously set values.

The existing JS uniform implementation rejects updates larger than the remaining uniform array capacity with `INVALID_OPERATION`. This conflicts with the selected original array test and GLES 2.10.4's excess-element rule. This finding is handed to the JS owner before activation.
