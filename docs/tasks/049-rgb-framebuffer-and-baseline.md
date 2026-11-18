# WebGL1 RGB texture attachments and pinned conformance refresh

Build on tasks 046–048. This task owns RGB texture target semantics in both cores, shared host opaque color handling, support reporting and the original three-backend verification.

1. Accept defined level-zero RGB texture attachments, preserve implicit opaque alpha across definitions, writes, copies and readback, and report color component sizes. Use the same image/version and framebuffer relationship contracts as RGBA.
2. Check direct RGB rendering, blend behavior, readback and source copy compatibility in headless Chrome. Run copy-tex-image-2d-formats, texture-attachment-formats and surrounding framebuffer/texture cases, then deliver through required CI.
3. Run the full pinned 971-entry original inventory on native, JS and Rust using headless Chrome and the recorded runner. Keep per-backend outcomes, changes since the earlier full baseline and the leading unresolved dependencies.
