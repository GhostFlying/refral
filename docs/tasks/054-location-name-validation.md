# Location name validation

Start from task 053's three reproduced original files. Correct name length, character set and reserved prefixes in the JS core and audit the Rust equivalent. Preserve program validation order, unknown-name return values and attribute bindings on errors. Add a shared browser scenario with validation and a draw after the failed calls. Update the specification map and reflection evidence.

WebGL1 limits location names to 256 characters. Check the ESSL 1.00 section 3.1 source character set before considering gl_, webgl_ and _webgl_. Reserved names produce INVALID_OPERATION on binding and are ordinary missing results for linked-program queries. A query of an unlinked program produces INVALID_OPERATION before name validation. A deleted program has its own error path. Valid source punctuation and whitespace can form an unknown name.

Acceptance uses pnpm check, pnpm rust:build, pnpm rust:test:wasm, the headless dual-core location scenario, and the three original paths and parameters in task 053. Compare the complete files on native, JS and Rust. Record separately the optional context-loss branch and observed native deviations.

Chrome 158 returns INVALID_OPERATION for a reserved binding name containing a non-ESSL character, and INVALID_VALUE when that name is queried on an unlinked program. The two cores validate query link state first and validate the character set before applying the reserved binding prefix rule. The three-way fixture records the native results separately for those compound-invalid inputs. The rendering assertion checks the retained binding after relink. Evidence paths are `artifacts/dual-core-drawing/location-name-validation/result.json` and `artifacts/conformance/campaign/location-names/`.

At implementation revision 64f9810 the three complete originals passed on all three backends. Native executed 246 assertions and each Refral core executed 124, including all 18 previously failing JS assertions. The optional WEBGL_lose_context branch accounts for the additional native assertions. All nine page captures were saved. The shared scenario passed its draw, state and error checks. The Wasm adapter suite passed 47 tests.
