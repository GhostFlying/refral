# Repeatable compiler patch validation

The indexed texture LOD patch extends code introduced by the sampler aggregate patch. Validate the older patch against the source layer it changed before reapplying the indexed overlay. Give the shader-extension insertion hunks surrounding source context so repeated builds detect that they are already applied. Verify the pinned source and two consecutive regular compiler builds, their output hashes, and the corpus.

Both consecutive compiler builds produced the existing Wasm hash `d62226acfc67938a6d5cec1e5ee0e9c56d99636e2151ba097eafc73a03bf2a14`. The new contextual hunks reject forward reapplication. The subsequent Wasm compiler corpus passed all 74 cases.
