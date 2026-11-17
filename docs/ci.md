# Actions and PR delivery

## Required PR verification

The `CI` workflow runs on PR updates, pushes to main, and manual dispatch. Its single required job is `ci/required`. New PR updates cancel that PR's older run.

Each run verifies lowercase feat/fix/refactor commit messages, the PR title, linear PR commit history, local Markdown links, CI selection regressions, and support metadata. Documentation and support-only changes use these checks. JS changes also run type checking and CPU unit tests. Rust-affecting changes run native Rust tests. Shared core contracts, Wasm bindings, and workflow/helper changes select both implementations.

The JS path installs the pinned pnpm dependencies and uses the Node version from `.nvmrc`. Native Rust uses the pinned channel from `rust-toolchain.toml`. CI job summaries identify the tested revision and selected checks. Action references use commit SHAs.

Run the small policy and documentation checks locally with `pnpm ci:check`. Run `node tools/ci.mjs scope` to inspect the selected JS/Rust checks for the working branch. `pnpm check` remains the comprehensive deterministic local entry point.

## Optional verification

`Optional verification` supports manual `wasm`, `compiler`, and `all` groups. The daily schedule requests both groups at 20:17 UTC, corresponding to 04:17 Asia/Singapore. Wasm verification builds the real module and runs adapter tests. Compiler verification acquires the pinned ANGLE/Emscripten dependencies, builds the compiler, and runs the shader/link corpus. The compiler cache key covers the runner platform, pinned dependencies, wrapper, profile, patches, and build scripts.

Run a group on GitHub from the repository with `gh workflow run optional.yml -f suite=wasm`, replacing `wasm` with `compiler` or `all` as needed. Runs record the source revision, keep logs and JSON reports as seven-day artifacts, and report failures for follow-up. These job names are optional for branch integration.

Chrome differential scenes, CTS, deployment verification, and performance retain their local command entries in README.md. Choose verification relevant to the task and record the environment and results. Hardware GPU performance results identify their actual adapter.

## PR and repository constraints

Main uses PR integration with zero required human approvals, an up-to-date successful `ci/required` check, and linear history. Repository merge settings select rebase merge and enable native auto-merge. Main protection applies to administrators and blocks force pushes and deletion.

Keep each PR scoped to a task with atomic lowercase commits. The PR template links the behavior change to task or validation evidence. The integrating agent addresses required-check failures, follows the current PR revision, and enables auto-merge. After merge, verify the main workflow and synchronize the local main branch. Optional/daily outcomes inform follow-up priorities.

Task 012 records initial workflow validation, repository configuration, and the first end-to-end PR acceptance.

## Initial runner observation

On 2026-11-14, the first required PR job passed in 27 seconds with JS and native Rust checks selected. The first main push job passed in 28 seconds. These individual job durations include setup and execution and exclude runner queue time. The manual optional Wasm job passed in 22 seconds. Task 012 links the corresponding runs and repository settings verification.

Run the official conformance baseline locally with `pnpm conformance:deps`, `pnpm conformance:run` and `pnpm conformance:report`. Required JS verification includes `pnpm test:tools` for deterministic source acquisition, static serving, adapter, checkpoint and reporting regressions.
