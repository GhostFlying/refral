# Cross-backend provenance for official conformance reports

The official reporter already classifies collection completeness and checks the selected core in each case. Audit the recorded common runner configuration before presenting native, JS and Rust as one build. Add a separate verified, mismatch or unavailable comparison in summary.json, the Markdown report and CLI. Compare the source revision, browser build, CTS revision/version, recorded runtime binaries and fixtures, and runner settings. Name differing fields and missing evidence. Exclude per-backend core identities, timestamps, process IDs and independent launch/recovery order.

Task 105 owns tools/conformance-report.mjs, its deterministic unit suite and this record. Keep all historical per-file, aggregate and collection results readable. Check fully collected matched and mixed runs, an identical source revision with a changed Wasm, changed timeouts, missing historical metadata and harmless key/launch ordering. Re-report real local checkpoint data using CPU only; record the actual observed result and evidence path. Run the report suite, tools tests and repository CI metadata checks.

## Comparison contract

`summary.complete` continues to describe collection of the expected backend files. `summary.comparability.status` compares the recorded build and runner inputs, including inputs to a partially collected campaign. A complete, comparable final campaign requires both `complete: true` and `status: "verified"`. File-level core selection, completion, assertions, accepted observations, screenshots and statuses retain their existing definitions.

- **verified** means every backend reported the same source commit, browser build, CTS revision/version, Playwright version, common runner settings and recorded file digests. The reporter requires both compiler/core Wasm digests, the shared harness files and runtime package entry points. It compares every additional path in the runner's hash inventory, including Worker fixtures whenever recorded.
- **mismatch** means recorded values disagree. Each entry in `mismatches` names the field and preserves each backend's value. Differences in which files were included in recorded manifests are visible. Disagreeing source declarations within a checkpoint are also identified. A known mismatch takes precedence over missing evidence.
- **unavailable** means the available evidence is insufficient to verify all three backends. Each entry in `unavailable` names the field and affected backends. Port, profile/PID, timestamps, repetition order, backend identity and launch history do not form part of the common build. Object key order has no effect. The Markdown lists the principal differences and the JSON includes the full digests.

The existing checkpoint fingerprint governs resuming an individual run. The report compares the underlying recorded fields, which permits naming a binary or timeout and avoids treating JSON object ordering as a build difference. Its scope is recorded provenance. For example, the runner records the compiler Wasm digest and compiler package sources; the generated compiler.mjs loader has no separately recorded digest in these checkpoints.

## CPU validation

All 22 deterministic report tests passed, including missing historical metadata, a fully collected mixed binary, independently reordered launches/configuration, partial coverage of matching inputs, differing CTS/source/browser/timing, and conflicting revision declarations. All 76 tool tests passed. The following archived originals were processed locally without launching a browser.

| Input | Collection | Comparison | Recorded evidence |
| --- | --- | --- | --- |
| nonpoint-topology/full | Complete | Verified | All 2,913 backend files and common inputs matched at f2b0c77. |
| attribute-assertions/witness | Incomplete | Verified | Only five original URLs per backend were selected, all on 3531eab with the same observer. |
| vertex-arrays | Incomplete | Mismatch | Same ec2443009 source and Chrome. The single difference is the Rust Wasm hash. Native recorded c338f30b49a8…, JS and Rust recorded e04606f860d0…. |
| blob-workers-transfer | Incomplete | Mismatch | Native recorded 0e1cd6251, JS and Rust recorded 7599dbbec. The sole differing field is the source revision. |
| Original artifacts/conformance/baseline | Complete | Unavailable | Every backend omitted the screenshot setting. Its other comparable fields agreed. |
| Three original 971-file inputs assembled for this audit | Complete | Mismatch | Native f055822 at 20,000 ms plus JS/Rust f2b0c77 at 5,000 ms. The reporter identifies 52 differing fields, including source, watchdog and both Wasm binaries. |

The full mixed-input comparison preserved every previous summary field and all failure clusters, including the 2,913 per-backend file records. Removing the new comparison object yields data equal to the previous reporter's JSON. Reproduce with `pnpm conformance:report --input <checkpoint-directory> --output <report-directory>`. The frozen inputs and before/after reports are under `artifacts/conformance/campaign/report-provenance-105/`. The Markdown and CLI display collection and comparability separately.
