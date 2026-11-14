# JS drawing core logical handles

Status is implemented, with task 013 owning integration acceptance.

## Goal and ownership

Implement the JS `DrawingCore` adapter for task 013. This task owns core-js Buffer kind validation, the new drawing adapter, necessary internal semantic/compiler lifetime hooks, package exports, focused unit regressions, and this record. The integrating agent owns shared contract definitions, compiler registry implementation, and public facade wrappers/conversion.

## Plan

1. Require typed Buffer handles and reject wrong-kind aliases without changing valid Buffer semantics.
2. Adapt shader, program, and uniform-location operations over one existing semantic context, resolving typed handles and translating returned object references into logical handles.
3. Bridge the compiler registry to existing semantic compilation/linking with explicit artifact release on replacement, retirement, and disposal.
4. Preserve retained deletion, link-generation validation, JS texture/framebuffer features, and existing draw snapshots.
5. Verify handle isolation, shader/program lifecycle, uniform locations, shared Buffer/attribute state, compiler artifact lifetimes, and disposal through deterministic unit tests.
6. Apply the shared specification audit for short `vertexAttribNfv` inputs and null Buffer pointer bindings, with matching state-preservation regressions.
7. Audit shader/program commands after deletion while retained. Cross-check GLES 2.0.25 lifetime rules with the verification worker's native probe, correct confirmed deviations, and add focused handle-boundary regressions.

## Acceptance

`createJsDrawingCore(options, services)` implements the common DrawingCore. Shader/program/location classes stay inside core-js. Public invocation receives and returns typed logical handles for migrated object kinds and preserves normalized legacy operation results. Existing CPU regressions pass. The integrating agent records actual Chrome, compiler, CTS, and deployment results.

## Implementation

`createJsDrawingCore` creates one semantic context and extends its Buffer adapter with typed shader, program, and uniform-location handles. The adapter checks kind, context, slot, and generation, preserves handle identity for attachment/current/binding queries, and translates legacy query results before returning them. Shader/program slots retire only after their retained references are released. Location slots retire after a valid link attempt or final program release. Earlier issued deletion handles remain harmless after slot reuse.

The internal compiler bridge associates each semantic compile/link result with a registry artifact ID. It releases shader IDs on recompilation and final retirement, executable IDs on successful replacement and final retirement, and failed link result IDs immediately. Result ownership records share their WGSL strings and reflected arrays with registry results. Core disposal releases its owned IDs and CPU references while the facade owns registry disposal. Existing direct `SemanticContext` construction continues to accept the prior `Compiler` interface through optional lifecycle callbacks.

The legacy JS texture, framebuffer, matrix, blend/depth, and capture operations continue through the same semantic context. Common draw data and captured versions retain their previous ownership. Existing host work holds its own execution snapshots after compiler records retire.

The shared attribute audit added two specification corrections. `vertexAttribNfv` rejects a source shorter than N with INVALID_VALUE and preserves its previous constant. `vertexAttribPointer` accepts an unbound ARRAY_BUFFER at offset zero, recording a null attribute binding, and rejects a nonzero offset without changing prior attribute state. These rules follow the pinned WebGL vertex-attribute API sections used by task 013.

The retained-deletion audit found that source changes, compilation, attachment changes, relinking, and queries must continue while a deleted shader/program remains referenced. The semantic validator now accepts these retained shader/program objects. `useProgram` keeps its explicit marked-deleted rejection, while an already current deleted program may continue drawing. Final retirement removes the logical identity, and shader/program queries report INVALID_VALUE while `useProgram` reports INVALID_OPERATION. GLES 2.0.25 sections 2.10.1 and 2.10.3 and appendix C.1.3 define the retained name lifetime. [OpenGL ES 2.0.25 specification](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf)

The verification worker's native Chrome probe confirmed retained source/compile/link/query behavior, rejected `useProgram` on the deleted current program, and the final-retirement query codes. Its evidence is `artifacts/dual-core-drawing/native-retained-deletion.json`. The unit regression also attaches a retained deleted shader to a second program in accordance with the GLES valid-name rule. That secondary attachment and retired mutation calls were audited from the specification and CPU behavior, and have no additional native probe in this task.

## Verification

`pnpm typecheck` passed. `pnpm test:unit` passed 9 files and 62 tests at this integration point. The new package coverage includes 14 DrawingCore cases and one Buffer wrong-kind regression. It exercises typed results, shared Buffer/attribute state and ordered draws, foreign/kind/generation rejection, stale locations, retained deletion and slot reuse, exact artifact release, disposal, source code units, legacy framebuffer forwarding, and both attribute corrections.

The synchronous compiler and semantic host are mocks in the DrawingCore cases, with the actual shared compiler registry implementation. The integrating agent owns real compiler, Chrome, CTS, and delivery verification.
