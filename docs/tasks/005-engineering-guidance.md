# Dual-core engineering guidance

Status is complete for the initial engineering rules, documentation alignment, and commit conventions.

## Goal and ownership

The integrating agent owns this documentation task. Establish the initial repository rules for the user-approved JS/Rust parallel direction and the agreed target layout.

## Steps

1. Define module ownership, observable semantics, task collaboration, and proportionate verification in the root AGENTS.md.
2. Record the dual-core decision and its relationship to the earlier small-core experiment.
3. Align the architecture, roadmap, documentation index, and current support-matrix implementation identity.
4. Check document references, JSON validity, and the existing support-matrix validator.
5. Add the user's lowercase feat/fix/refactor commit format, change-focused descriptions, atomic commits, and linear rebase-and-merge workflow.

## Acceptance

The engineering rules describe shared facade/compiler/executor modules and independently tracked JS/Rust cores. Instructions reference existing documentation. Historical experiment results retain their date and scope. The support matrix identifies the currently implemented runtime. This task's verification covers documentation and metadata.

## Results

- Root AGENTS.md covers the current direction, module ownership, observable behavior, per-core progress, task collaboration, proportionate verification, measurement, and reproducible handoff.
- ADR 003 records parallel JS/Rust development. ADR 001 is marked as the historical initial JS decision and points to the current direction.
- The documentation map, architecture, roadmap, and README describe the agreed target layout and actual prototype progress.
- The support matrix explicitly identifies its current JS runtime evidence through `runtimeCore`.
- Checked eight Markdown files, eleven local links, trailing whitespace, JSON validity, and the existing 27-entry support validator. All checks passed.
- Workspace migration and the first real shared-core contract remain planned foundation work in the roadmap.
- The commit-convention follow-up records lowercase feat/fix/refactor messages, change-focused descriptions, atomic commits, linear history, and rebase-and-merge integration. Convention-content and Markdown whitespace checks passed.
