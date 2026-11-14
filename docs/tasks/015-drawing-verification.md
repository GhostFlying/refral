# Drawing specification and verification

Status is complete for PR1 verification. Integration and subsequent Rust drawing stages belong to task 013.

## Goal and ownership

Implement PR1 verification for task 013. This task owns the fixture lock and acquisition script, shared runtime scenes and case names, Chrome CTS/program checks, and the specification mapping. The integrating agent owns semantic fixes, public interfaces, support metadata, and delivery.

## Plan

1. Read the WebGL specification and IDL at the existing CTS revision, applicable GLES/ESSL rules, and original program/buffer tests.
2. Pin and acquire the specification sources, two additional original CTS tests, and required resources. Preserve upstream test assertions and provenance.
3. Map supported program and buffer behavior to exact specification anchors and test identities. Record synchronous readback as an original program-handling prerequisite.
4. Add shared native/JS scenes for failed and successful relink, source/compile changes, and detached/deleted shader executable lifetime. Check public state/errors and asynchronously captured pixels.
5. Run TypeScript and deterministic CPU checks, then coordinate an exclusive Chrome window with the integrating agent for original CTS and derived scenes. Record per-backend results and remaining capability prerequisites.

## Acceptance

Pinned WebGL HTML and IDL share CTS revision `39443210f7f81db4773eb104facadfb85d05dfa4`. Original `buffers/buffer-bind-test.html` and `programs/gl-getshadersource.html` run unchanged against native and JS. Program state/error checks have explicit expected values and images verify earlier draws and installed executable lifetime. The source mapping identifies original upstream assertions and any adaptation used by project regressions.

## Validation record

On 2026-11-14, the integrating agent granted an exclusive Chrome window. The following checks completed.

- `node tools/deps-fixtures.mjs` acquired both specification sources, all seven selected CTS files, the original program-handling reference and its resources, and the existing demo at their fixed revisions.
- `pnpm typecheck` passed, followed by `pnpm test:unit` with six files and 35 tests passing. A later typecheck during concurrent facade test work reported two SharedArrayBuffer constructor typing errors in the integrating agent's files. Those locations were sent to the owner for integration.
- `pnpm exec playwright test program-spec.spec.ts cts.spec.ts` passed six tests in 5.8 seconds on headed Chrome `157.0.8103.51`.
- All seven selected original CTS files passed on native and JS, totaling 100 assertions per backend. The two new files passed eight Buffer assertions and three shader-source assertions per backend. `artifacts/cts/results.json` retains every original assertion and records `program-handling.html` as `prerequisite-not-run`.
- Five program specification cases passed explicit state/error expectations, native/JS observation parity, and full expected pixel regions. All regions had zero mismatched channels and maximum difference zero, using a permitted tolerance of one byte. Raw pixels, shader sources, configuration and PNGs are under `artifacts/program-spec/<case>/`.
- JS used the Apple WebGPU adapter with `architecture: metal-3` and `isFallbackAdapter: false`. The new scenes are also included in the existing differential case list for subsequent complete regression runs.
- A targeted native probe confirmed null-location calls ignore invalid transpose and short vector data. Live locations produce `INVALID_VALUE` for the same invalid inputs. `artifacts/program-spec/native-uniform-validation.json` records the exact calls and Chrome version. The result was sent to the semantic owner.

The five scenes cover failed current-program relink, successful relink and uniform reset, source/compile changes without relink, detached/deleted shader executable lifetime, and DOMString code-unit preservation. The last scene verifies lone surrogates, NUL, a supplementary character, and CRLF. `docs/spec-map.md` records their specification and original-test sources.

The final fixture edits add actual context attributes, selected core and DPR to runtime evidence and ensure both backend PNGs are written before assertions. The integrating agent's complete Chrome run regenerates those additive metadata fields. The behavior and pixel checks passed before that metadata edit.

## Handoff

The GPU window is free. No public hook or interface change was needed. Original program-handling awaits synchronous WebGL readback, while the project cases use asynchronous JS capture. Rust shader/program and drawing verification proceeds through the subsequent task 013 contracts. No Git operation was performed by this worker.
