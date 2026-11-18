# Per-case conformance screenshots

## Goal and scope

Capture one image per selected original WebGL conformance file and backend, including passing files, assertion failures, capability exits and timeouts. Keep captures paired by the fixed inventory index and original URL. The companion coverage report opens the native Chrome reference, JS and Rust side by side.

The owned files are the conformance CLI, its completion fixture, the conformance report and tests, and this task. Generated PNGs, manifests and the local HTML report belong in ignored artifacts or the visualization output directory.

## Plan

1. Add an opt-in screenshot run mode. Await capture after the test's assertion boundary, before selected-core resource disposal and original iframe reuse.
2. Keep the original case viewport size. Bring the existing case frame on screen for capture and restore the runner panel afterwards. Save the test viewport for every backend and record a visible Canvas region when present. Compare the same Canvas when the three captures can be paired, with the viewport available for every case. Record capture metadata independently from assertion status.
3. Add capture metadata to the raw results and summary. Exercise rendering, assertion-only, capability and timeout paths in a headless sample, then capture the complete 971-file inventory on native, JS and Rust. Validate every PNG against its case identity and saved metadata.
4. Update the local visual report with a comparison control for every file. Include passing and failing outcomes, capture type and the link to the original PNG. Render with visual-explainer and verify the screenshots and report interaction. Deliver the runner changes through required CI.

## Acceptance

```sh
pnpm check
pnpm conformance:run --backend native --screenshots --timeout-ms 5000 --output artifacts/conformance/case-screenshots
pnpm conformance:run --backend js --screenshots --timeout-ms 5000 --output artifacts/conformance/case-screenshots
pnpm conformance:run --backend rust --screenshots --timeout-ms 5000 --output artifacts/conformance/case-screenshots
pnpm conformance:report --input artifacts/conformance/case-screenshots
```
