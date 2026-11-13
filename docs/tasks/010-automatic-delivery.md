# Automatic delivery policy and initial repository publication

Status is complete for the delivery policy and initial repository publication on 2026-11-13.

## Goal and scope

Apply the user's authorization to commit, push, and integrate completed work automatically. Preserve atomic lowercase commits, user Git identity, linear history, and rebase merge. Once GitHub Actions acceptance gates are established, integrate through pull requests.

The integrating agent owns this task, the repository AGENTS.md delivery rules, and the roadmap's CI delivery sequence. Runtime code and GitHub repository settings are outside this policy change. Establish the initial default-branch baseline from the already verified working tree; remote inspection confirms an empty public repository with default branch `main` and rebase merge allowed.

## Steps

1. Record the automatic delivery rules and the transition to Actions-backed PR integration.
2. Review the initial source inventory, ignored artifacts, user identity, local acceptance evidence, and remote state.
3. Validate documentation and existing deterministic checks, then create the initial coherent commit and push the default branch.
4. Verify the remote commit and record the delivery result. Plan Actions gates as a separate task.

## Acceptance

- Project instructions authorize automatic delivery after task acceptance and require PR/rebase integration once Actions gates exist.
- The task and roadmap distinguish implemented policy from planned Actions work.
- The published baseline contains source, lockfiles, instructions, and validation documentation; build artifacts and downloaded third-party trees remain ignored.
- The commit uses the existing GhostFlying identity and the agreed lowercase subject format.
- The local default branch and remote reference point to the same initial commit.

## Validation and delivery record

- `pnpm check` passed TypeScript, 25 JS unit tests, rustfmt/clippy, 15 native Rust tests, and validation of 28 per-core support entries. The preceding runtime milestone's 34 Chrome tests and deployment verification are recorded in its dated report.
- Documentation link validation passed. Initial source review found 122 source files, no staged binaries, no files over 500 KB, and no generated artifact, dependency, build, or downloaded third-party trees. A final blank line in `examples/probe.ts` was removed; staged whitespace checks passed.
- Published the initial coherent runtime baseline as [`9922c3f`](https://github.com/GhostFlying/refral/commit/9922c3fe47f8bfc500f4c944b51cc472eae77bb7), subject `feat: initialize dual-core webgl runtime`, on `origin/main`. Both author and committer use the existing GhostFlying identity. The local branch was renamed from the unborn `master` to the remote repository's default `main`.
- The automatic delivery rules are a following atomic documentation commit. Its commit and final remote-head verification are included in the integration handoff.
- GitHub Actions workflows and required-check configuration remain planned. Once their acceptance gates are established, subsequent delivery uses branches, PR checks, and rebase merge as recorded in AGENTS.md and the roadmap.
