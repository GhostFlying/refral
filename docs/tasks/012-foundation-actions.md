# Foundation Actions and PR integration

Status is running.

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
- Initial PR execution, live repository settings, and rebase integration are pending.
