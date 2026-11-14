# Pre-stable CI scope

Status is complete for the pre-stable CI policy update on 2026-11-14.

## Goal and scope

Apply the user's iteration-speed requirement before stable. Keep required Actions checks small and critical. Run expensive verification locally, on demand, or daily, with optional results informing follow-up work.

The integrating agent owns AGENTS.md, the delivery section of docs/roadmap.md, and this task record. This task updates the CI design and automatic delivery policy. Workflow implementation follows the revised design in a subsequent task.

## Steps

1. Limit the initial required set to type checking, deterministic CPU semantics, and support metadata, selected for affected modules.
2. Schedule Wasm, compiler, Chrome/CTS, deployment, and performance verification as optional local, manual, or daily work.
3. Make automatic PR integration depend on the required checks and record optional failures for follow-up.
4. Validate documentation consistency and publish the atomic policy update using the existing Git identity.

## Acceptance

- The roadmap specifies a lightweight pre-stable required set and optional test entry points.
- Automatic delivery follows the required set, with optional results tracked independently.
- Existing comprehensive local commands remain available to select appropriate task verification.
- Documentation links and whitespace checks pass.

## Results

- Required CI starts with type checking, deterministic JS CPU tests, and support metadata for affected code and contracts. Native Rust compilation/tests apply to Rust-affecting changes. Documentation-only verification follows its smaller scope.
- Actual Wasm, ANGLE, Chrome/CTS, deployment, and performance verification use optional local, manual, or daily execution. Optional failures are recorded and prioritized as follow-up work.
- AGENTS.md ties automatic integration to required checks and explicitly keeps optional/daily checks non-blocking. The roadmap replaces the earlier plan to expand Wasm/compiler/browser gates before stable.
- Repository Markdown link validation, required/optional policy consistency checks, and Git whitespace checks passed. The change contains engineering instructions and planning documents. Its delivery commit is reported in the integration handoff.
