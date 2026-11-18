# Find differences in assertion coverage for passing originals

A green dEQP functions result previously concealed missing matrix-attribute draws. The original pass count alone does not identify the cause of a difference, which can also depend on an optional extension or the published hardware limits. Expose all three complete counters for originals which pass on each backend but differ in the number of passed or skipped assertions. Preserve official file results and ordering. Exclude incomplete or invalid executions. Let the aggregate JSON and Markdown supply the evidence for follow-up branch audits. Keep the browser runner and fixed sources untouched.

Own tools/conformance-report.mjs and its deterministic test. Run node --test tools/conformance-report.test.mjs and regenerate a full report in an isolated output from existing raw results. Check able to recover the known matrix and extension differences without changing any status or using future results for an earlier build.

All 17 deterministic report tests passed. Re-reporting f2b0c77 identified 80 fully passing originals with divergent counters, including the two matrix-location limit loops and optional texture formats. The old and new per-file records and backend totals were identical. Reproduction and outputs are in artifacts/conformance/campaign/passing-assertion-counts.
