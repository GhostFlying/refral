# Support matrix evidence

Status is complete.

## Goal and ownership

Compiler worker owns `docs/support.json` during integration. Describe actual WebGL1 API groups, overloads, formats, limits, unsupported behavior, and precise test coverage. The integrating agent supplies final Chrome differential and CTS results.

## Steps and acceptance

Inspect semantic core and browser facade implementations. Populate capability groups using the root support schema. Attach actual test identities and result paths, preserving unverified or failing states where appropriate. After integrated reruns, update only entries supported by the saved evidence. Run `node tools/check-support.mjs`.

## Results

The matrix contains 27 scoped capability groups, including 18 differential-verified groups, 3 CTS-verified groups, 3 partially implemented/unverified groups, and 3 unimplemented groups. Mixed overloads retain their own verification states. Final evidence covers 26 Chrome tests, 18 native pixel/state differential fixtures, 5 original CTS files with 89 assertions, 23 compiler corpus cases, 3 actual WebGPU pipelines, and the built distribution preview. Resource accounting explicitly distinguishes tracked capacities and texture capacity estimates from driver VRAM. `node tools/check-support.mjs` validates the matrix.
