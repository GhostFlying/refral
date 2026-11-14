# Foundation Actions and PR integration

Status is complete for foundation Actions and repository PR constraints on 2026-11-14.

## Goal and ownership

Implement the approved pre-stable CI policy and deliver it through a real PR and rebase merge. The integrating agent owns workflows, small CI helpers and their regressions, the PR template, command/documentation updates, and repository merge settings.

## Steps

1. Add one lightweight required job that validates PR/commit conventions, documentation, and support metadata, then selects JS CPU checks and native Rust tests by changed files.
2. Add optional manual/daily Wasm and compiler verification with pinned dependencies, caches, and saved diagnostics.
3. Verify the helpers and workflows locally, publish a task branch, and run the required job in a PR.
4. Configure main to require the successful CI check and PR integration, enforce linear history, allow rebase merge, and enable auto-merge with zero required human approvals.
5. Follow the PR through rebase merge, verify the resulting main workflow, and exercise optional workflow entry points.

## Acceptance

- Documentation-only PRs avoid JS dependency installation and Rust builds.
- JS checks and native Rust tests run when relevant changes require them.
- Invalid commit conventions and broken documentation fail the required job. Workflow/config changes select the checks they can affect.
- Wasm/compiler checks remain optional and daily/manual results preserve the tested revision and logs.
- The required check runs on the current PR revision, the PR merges by rebase, and main matches the merged result.
- Actual run results, repository settings, and any remaining limitations are recorded in the task and final handoff.

## Validation and delivery

- Implemented one affected-module required job, an optional manual/daily Wasm/compiler workflow, commit/PR conventions, a PR template, and delivery documentation. Daily verification is scheduled for 04:17 Asia/Singapore.
- Local checks passed six CI helper regressions, TypeScript, 25 JS unit tests, 15 native Rust tests, support metadata, Markdown links, and Git whitespace validation. actionlint 1.7.12 passed both workflows. The downloaded validator and its verified checksum are under ignored artifacts/ci/actionlint.
- [PR 1](https://github.com/GhostFlying/refral/pull/1) passed the required workflow and merged by rebase as `3a6e03a86832798d23830c9f3df578cc87fc7493`. Both author and committer retain the existing GhostFlying identity.
- The first [required PR job](https://github.com/GhostFlying/refral/actions/runs/43589172285) passed in 27 seconds, including dependency setup, type checking, JS CPU tests, and native Rust tests. The first [main push verification](https://github.com/GhostFlying/refral/actions/runs/43589356863) passed in 28 seconds. These are individual job durations excluding queue time.
- Read back the applied repository settings. Main requires an up-to-date `ci/required` check from GitHub Actions, PR integration with zero required approvals, linear history, and administrator enforcement. Force pushes and branch deletion are disabled. Rebase is the enabled merge method and native auto-merge is enabled. Settings snapshots are under ignored artifacts/ci/repository.
- A manual [optional all-groups run](https://github.com/GhostFlying/refral/actions/runs/43589379470) exercises the daily/manual commands on the merged revision. The actual Wasm job passed in 22 seconds. The compiler job performs the pinned Linux cold build and its result is available at the run link.
- A follow-up documentation PR exercises the documentation-only required path and native auto-merge. Its job results and final remote verification are recorded in the integration handoff.
