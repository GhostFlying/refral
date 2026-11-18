# Current evidence for the WebGL1 conformance campaign

Update the public support matrix and the phase report from a complete single-build run, including the original 971 URLs per backend, assertion and file statuses, reference branches, screenshot identity, timer settings and the actual source and Wasm hashes. Keep historical measurements dated and scoped. Verify the accompanying MDN member report against the selected source. The latest core and deployment checks must run on the same runtime as the conformance scores. Keep accepted observations, upstream specification conflicts, host capability limits and outstanding regressions explicit.

The integrating agent owns docs/support.json, the campaign report and this task. Review the support records for stale capability limits and cross-check the actual WebGL surface against its implementation and tests. Check all observed nonpassing original URLs against their exact retained assertions. The acceptance commands are pnpm check, pnpm rust:test:wasm, pnpm compiler:test, the headless Chrome regressions, pnpm test:dist and pnpm conformance:report on the complete source-matched three-backend directory. Validate every PNG and per-member link through the report generator.

## Same-build engineering results

The acceptance checkout and the full original suite froze merged source f1dac24d856c7c96dbf6be8402e0198872d7e2e2. All 202 Chrome tests, 55 actual Wasm tests and the complete production deployment passed. All three pairs of RTT images matched at every pixel. The currentIntegration entry contains the compiler and Rust Wasm hashes, protocol versions, tested CPU suites and raw artifact paths. The six focused original files finished on all three backends; original 48 retained its accepted observation. Full-inventory counters are derived separately from the original suite.

The visual case table allows selection of newly passing and regressed files per backend against the preceding complete run. Compare by upstream URL and keep raw outcomes and image links. Display both inactivity timeouts when they differ. Verify each filtered URL and PNG mapping against its stored summary before publication.

The two formal build commands were rerun from the matching compiler/core sources with the local incremental build caches. The ANGLE build relinked its browser module. The Rust release build confirmed ABI 6 with zero Wasm imports. The resulting compiler loader, compiler Wasm and Rust Wasm match the three files in the frozen official checkout, the engineering checkout and its production dist byte for byte. `integration/runtime-artifacts.json` records these SHA-256 values; the two rebuild logs retain the commands and cache behavior.

## Reproduction

Use the pinned dependencies and compiled modules on the frozen runtime revision. Set REFRAL_HEADLESS=1 and run the following in an exclusive Chrome GPU window. Use a fresh output directory for a new measurement.

```sh
export REFRAL_HEADLESS=1
out="artifacts/conformance/recheck-$(git rev-parse --short HEAD)"
for core in native js rust; do
  pnpm conformance:run --backend "$core" --screenshots --timeout-ms 20000 --hard-timeout-ms 600000 --output "$out" || exit 1
done
pnpm conformance:report --input "$out"
```

The reporter in PR 89 exposes collection and common build/runner configuration separately. The phase evidence also compares the compiler loader from the suite checkout to the shipped loader and verifies each image against its record. The standard report preserves completion, assertions, late and partial observations, worker contexts and original page captures.

## Full inventory and visual verification

Frozen source f1dac24 completed 971/971 file executions on each backend. Chrome passed 968, JS passed 965 and Rust passed 965. Each Refral core retained four assertion-failing files, one unsupported file and one timeout. The six nonpassing URLs were identical on JS and Rust. Compared with a7be1dc, original 41 gained a pass on both cores and there were no file regressions. All 2,913 images were captured from the identified original case pages. For the two #656 timeouts the final report identifies the in-progress screenshot on the retried case. The remaining 2,911 images represent completed case pages. The published visual passed 971 three-way selectors, 2,913 individual image links, the gain/regression controls against the previous full data, and 142 separately listed MDN members. The canonical data is in `artifacts/conformance/campaign/final-html-resize/full/{summary.json,phase-evidence.json}`. The deployment and rebuilt compiler/core evidence is in its sibling `integration` directory.

The production comparison retains default synchronous external image visibility. The optional task-end batching policy in task 104 remains an experiment. Its 12/0 results use a different policy and have no effect on these scores.
