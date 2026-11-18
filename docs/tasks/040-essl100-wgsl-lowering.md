# ESSL 1.00 lowering for the original OGLES tests

Advance the shared compiler for both semantic cores from task 039's 127/141 OGLES passes. The integrating owner handles the pinned ANGLE patch, compiler tests and provenance, and any shared driver-uniform changes. Dependencies are the existing compiler build, WebGL1/GLES2/ESSL100 and WGSL specifications, ABI4 cores and official runner.

1. Trace the twelve GPU validation failures to typed ANGLE operations. Lower mixed scalar/vector overloads, scalar geometric builtins, matrix component multiplication, aggregate equality and depth range with their ESSL semantics. Preserve argument evaluation count and stage-independent driver layout.
2. Use minimal shader samples and the original tests for syntax, pipeline creation and pixel checks. Diagnose the remaining mod pixel mismatch and build timeout independently.
3. Run `pnpm compiler:build`, `pnpm compiler:test`, `pnpm check`, and original OGLES plus affected GLSL through the headless three-path runner. Store raw results in `artifacts/essl100`. Rebuild and run Chrome and distribution checks before delivery. Record any residual and preserve prior passes.

## Independent build case

The original build test's first shader, `CorrectFull_vert.vert`, declares an active `vec4[2]` varying. Compiling its original source directly reports the pinned ANGLE WGSL missing array input/output lowering. The helper passes the resulting null shader to attachShader, accounting for the facade TypeError. Correct varying location allocation, interface reconstruction, and struct-uniform support are separate compiler dependencies for this build-wide fixture.

## Headless Chrome results

Chrome 158.0.8127.36 on Apple Metal 3 ran the 141 original OGLES files and 15 focused original GLSL files with the standard 20-second idle watchdog. Native passed 156/156. Both JS and actual Rust/Wasm passed 155/156. Each Refral core moved from 127/141 to 140/141 in OGLES. The twelve prior WGSL validation errors and the mod pixel failure passed. All 15 GLSL files passed. The independent build case remains the only timeout. The original source and assertions were unchanged.

Raw records are under `artifacts/essl100/final`. The compiler Wasm SHA-256 is `b24a8b00dabf5800f3baeb2ff8acff7fe6a4593fcefe3a7eb5dd76c7ede53cde`. The ABI4 core Wasm for this run is `69b230e1c3e90e72d0ca36a2a00c2ed276276a8b3bae9636bef00875676eacde`.

Local verification passed the compiler's 46-case corpus, 125 headless Chrome regressions including GPU pipeline validation of the combined expression fixture, 226 JS unit tests, 58 tool tests, 75 Rust native tests, 47 actual-Wasm adapter tests and the built deployment check.
