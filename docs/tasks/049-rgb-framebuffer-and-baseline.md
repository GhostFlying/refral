# WebGL1 RGB texture attachments and pinned conformance refresh

Build on tasks 046–048. This task owns RGB texture target semantics in both cores, shared host opaque color handling, support reporting and the original three-backend verification.

1. Accept defined level-zero RGB texture attachments, preserve implicit opaque alpha across definitions, writes, copies and readback, and report color component sizes. Use the same image/version and framebuffer relationship contracts as RGBA.
2. Check direct RGB rendering, blend behavior, readback and source copy compatibility in headless Chrome. Run copy-tex-image-2d-formats, texture-attachment-formats and surrounding framebuffer/texture cases, then deliver through required CI.
3. Run the full pinned 971-entry original inventory on native, JS and Rust using headless Chrome and the recorded runner. Keep per-backend outcomes, changes since the earlier full baseline and the leading unresolved dependencies.

## Acceptance

RGB color targets retain their implicit opaque alpha while exposing zero alpha bits to WebGL. Resource capability 8 records opaque texture targets in the color discriminant without changing the layout size or stencil snapshots. In an ordered three-path test, destination-alpha blending yields opaque green, an RGBA copy is rejected, and the RGB copy retains green when the source is subsequently cleared blue.

Eight targeted original files pass on all three backends. Both the copy-tex-image-2d-formats and texture-attachment-formats files now execute the RGB branch, passing 51 and 14 assertions per backend. Raw results are under `artifacts/rgb-framebuffer/official` and `artifacts/rtt/fbo-rgb-texture`.

The full pinned refresh uses `pnpm conformance:run --backend all --timeout-ms 5000 --output artifacts/conformance/stencil-rgb-refresh`. It retains the original inventory and test scripts and uses a five-second per-case idle window for exploratory triage. The previous full run used 20 seconds. Files that regress to a timeout are eligible for targeted reruns with the previous window.

The refresh completed for all three backends on 2a519f2. [Full results, comparison and reproduction](../validation/2026-11-18-stencil-rgb-conformance.md)
