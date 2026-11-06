# CI

Five workflows: one gates the repository, one grades its tests, and three
release it.

| Workflow | Trigger | What it answers |
|---|---|---|
| `validate.yml` | PR, push to `main` | Is the repo green? |
| `kb-mutation.yml` | Weekly (Mon 04:00 UTC, incremental), monthly (full), manual | Which mutants does the test suite fail to kill? |
| `release.yml` (Release) | Manual with a bump, or a hand-pushed `v<major.minor.patch>` tag | Cut a stable release: version, CHANGELOG, commit and tag, then publish |
| `nightly.yml` (Nightly) | Validate green on a push to `main`, manual; daily 03:00 UTC retries green main and prunes | Publish that commit as a `-nightly.<UTC YYYYMMDDHHMMSS>` prerelease, unless a nightly holds it |
| `publish.yml` (Publish) | Called by Release and Nightly only | Build, smoke-test, attest and publish one release |

`validate.yml` is the single answer to "does this change land". Its jobs run
in parallel because they share nothing but setup, the composite action
`.github/actions/setup` (Nix, `bun install`, and for the `nix` job the Nix
store `nix flake check` builds, restored from the Actions cache). Every step
runs inside `nix develop`, so the tool versions — Bun included, the same one
the pre-commit hook and `packages.kb` use — are the flake's.

- **`nix`** — `shellcheck` over the hook and every `bin/` script, `actionlint`,
  `nixfmt --check`, and `nix flake check`, which builds `packages.kb`. It runs
  on `macos-15` and `ubuntu-24.04`, so the package is proven on Darwin and on
  Linux.
- **`verify`** — `bun run verify`, then the generated-docs check.
- **`core`** — `bun run test` and `bun run test:dst`.
- **`ui (1/2)`, `ui (2/2)`** — `bun run test:ui`, each shard half of every
  browser package's files.
- **`render (1/2)`, `render (2/2)`** — `bun run test:render`, split by file.

## Pre-commit: the same questions, one commit earlier

`.githooks/pre-commit` is admission for this clone, installed with
`bun run setup` (`bin/setup`, which also registers the node-store merge
driver). It runs the checks CI runs, and it runs them against a
**reconstructed index snapshot** — a detached linked worktree of
`git write-tree` — never against the working tree. That is the point of it:
an unstaged fix must not be able to mask a staged defect. Stage a defect, fix
it in the working copy only, and the hook fails on the staged content, which
is what will be committed.

Two mechanics worth knowing, both learned the hard way:

- **A `git checkout-index` directory is not enough.** The harness reads the
  tree through `git ls-files` and `git check-ignore`, so a snapshot that is
  not a git repository fails its own checks for the wrong reason. (`git stash
  --keep-index` is not a candidate at all — it moves the user's tree, which is
  the one thing a hook must not do.)
- **git exports `GIT_DIR` and `GIT_INDEX_FILE` into a hook**, and they name the
  committing repository. `git worktree add` that inherits `GIT_INDEX_FILE`
  checks the files out but leaves the new worktree's index *empty*, and then
  every tree-reading check passes on no files at all — a green hook that
  checked nothing. The hook scrubs those variables for every snapshot-directed
  git command and then asserts the snapshot's index equals its HEAD.

The snapshot borrows the checkout's `node_modules` rather than installing: the
content-addressed store and the caches by absolute symlink, every other entry
copied as the symlink it already is. That last part matters — a package's
`node_modules/@kb/<member>` link is relative to a sibling source directory, so
copied it resolves inside the snapshot, and shared it would resolve back into
the working tree.

### What triggers what

A check runs when the staged paths include one of its own inputs. Unstaged
edits are invisible in the snapshot, so a check whose every input is unchanged
there has a known answer already:

| Check | Runs when the commit stages |
|---|---|
| generated docs (`kb docs check`) | `.kb/**`, `docs/rules.md`, `docs/todos.md`, `packages/**` |
| `bun run verify` | anything |

`verify` has no narrower row because the workspace is the repository, and
`verify` runs `bun run check:audit`, and `ext.check.audit` reads every
`#rule`'s `home` file and every `#check`'s `evidence` file, wherever they
live, plus each surface's files — the `files` its `enforcement` option node
declares, here this hook, `package.json`, the lint and tsc configs and the
workflows.

A fresh clone without `bun install` fails the hook with the command to run,
rather than passing on checks it could not make.

## Scheduling and selection

Every main push runs every gate before publication. PRs whose entire diff is
Markdown under `docs/` or `README.md` run verify (including rule-home audits)
and generated-doc checks only. All other paths conservatively select all
suites: shared graph packages, extensions, assets and build configuration can
all affect browser rendering. Unknown paths select everything. No workflow
path filter can leave a required workflow pending. Skipped runtime jobs are
intentional only for prose; verify remains unconditional.

Core runs on Ubuntu, freeing a macOS slot for a second render shard. Both
UI shards and both render shards retain isolated runners and the existing
per-runner concurrency. Render has no dependency on Nix checks. Five macOS
jobs fit the account's five slots; concurrent PRs can still queue globally.
Superseded PR runs cancel; publishing is serialized and never cancelled.

The setup action owns Nix installation and dependency setup, including the
flake-check store snapshot and Bun download cache. Chromium is cached by OS,
architecture and lockfile; installation still runs to verify its presence.
Dev shells continue to use Nix's binary substituter: a previous snapshot
experiment took 67 seconds versus 45 seconds to substitute, so restoring a
large store in every job would slow this pipeline. Cache misses never bypass
an install, build or test. Cache timings must be reassessed after real runs.

## Batches

Use one PR per related, reviewable batch, with separate commits for structural
refactors and behavior additions (Rule 1). Agents stack work on that batch
branch, run local admission, then push a completed batch together. Mark its
body `Batch:` with the included changes and validation. Avoid merging partial
stacks one PR at a time: every main merge correctly triggers full validation
and publication. Unrelated changes remain separate PRs. This uses ordinary
PRs without a paid merge-queue dependency or repository-setting changes.

## Measurement: 2026-11-06 baseline

Sample: the latest 30 repository runs at 15:57 UTC, IDs 41698279061 through
42247804627, obtained with `gh run list --limit 30 --json ...`, then
`gh run view <id> --json jobs,attempt` and attempt logs. This includes 20
Validate and 10 Nightly runs; pending and cancelled jobs are excluded from
successful-job medians. Start delay is job start minus workflow creation,
so it includes scheduler/dependency delay, not just runner allocation.
Durations include setup and cache post-steps. Times are minutes.

| Job | Successful samples | Median start delay | Median execution | Maximum finish since trigger |
|---|---:|---:|---:|---:|
| verify | 20 | 0.05 | 4.95 | 7.15 |
| nix Ubuntu | 20 | 0.05 | 2.25 | 4.15 |
| nix macOS | 17 | 0.32 | 6.12 | 23.18 |
| core | 17 | 0.22 | 5.28 | 20.10 |
| ui 1/2 | 17 | 0.70 | 7.37 | 18.67 |
| ui 2/2 | 16 | 0.53 | 6.98 | 24.77 |
| render | 16 | 0.58 | 13.96 | 23.97 |
| nightly prepare | 3 | 0.05 | 0.52 | 0.65 |
| bundle | 3 | 0.60 | 0.68 | 1.52 |
| smoke macOS | 2 | 1.29 | 2.21 | 3.53 |
| publish | 2 | 3.54 | 0.23 | 3.80 |

Render is the normal critical path. Main run 42242547817 finished in 24.77
minutes, with UI 2/2 finishing last after queueing. There was already no
`needs: nix` on render: runner contention explains the apparent dependency.
Green-main workflow publication also already existed; the schedule previously
only pruned. It now retries publication of main through the same green gate.
`validate-green` accepts only a successful **push on main**, so a selectively
validated PR can never authorize publication.

Flake audit: 42242587247 attempt 1 records UI 2/2 as cancelled, not failed;
its log endpoint returns 404. No test identity can be inferred from a
28-minute cancelled job. No available UI log records an assertion failure.
41795515320 failed core's `the wire protocol > is the version recorded with
the wire it names` once; this is a version-consistency assertion, not evidence
of a timing flake. 41792737026 failed render's `every design system paints the page it is chosen
for (dark)` once: the selected swatch was yorha while the root still painted
transistor after 5 seconds. 41698279061 failed seed-golden and seed-migration
assertions (11 core tests). Each failure occurred in one of the 20 sampled
Validate runs; none demonstrates a same-commit assertion failure followed by
a passing retry. These remain strict failures; root-cause changes to UI are
outside this pipeline-only change.

Available attempt-1 logs show Nix flake snapshot hits in 17 Ubuntu jobs and
17 macOS jobs. Both were already warm in the latest successful main run.
Bun and Chromium had no configured cache, so no hit rate existed. Installer
cache hits are distinct from flake-store hits. Cancelled/missing logs prevent
claiming a complete cache denominator.
No test has been quarantined or retried into green. Manual reruns remain
visible in GitHub's attempt history. Missing logs are missing evidence,
not zero failures.

## kb-mutation

Mutation testing is not part of Validate — see the header comment in
`kb-mutation.yml`. It is slow, and its score is a signal rather than a gate
(the harness holds that no threshold breaks the run). It covers `@kb/model`,
`@kb/query` and the CLI's argument mapper, and the run seeds fast-check, so
its survivor list is reproducible. `harness/src/mutation.ts` plans the shards
and merges their reports; the survivor report is the artifact.

## Releases

Release and Nightly each decide *what* to release, and both refuse unless
Validate passed at that commit (`bin/validate-green`). Neither builds
anything itself: both call `publish.yml`, the one path to a GitHub release.
The README's [Releasing](../README.md#releasing) section is the owner-facing
account, covering the stable flow, nightlies, and `gh attestation verify`.

## Still manual

**Branch protection is not enabled.** CI runs on every push to `main`, but
nothing stops a push that fails it. Making the checks required means:

```bash
gh api -X PUT repos/popemkt/kb/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["nix (macos-15)", "nix (ubuntu-24.04)", "verify", "core",
                 "ui (1/2)", "ui (2/2)", "render (1/2)", "render (2/2)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

That makes a direct push to `main` that fails CI impossible, which is the
point, but a red run then blocks until it is fixed or admin-overridden.
Enable it deliberately.
It also stops the Release workflow: that workflow pushes its
`chore: release vX.Y.Z` commit to `main` with the workflow token, and that
commit has no checks of its own. Protection turned on therefore means letting
`github-actions[bot]` bypass it, or cutting stable releases by hand (`bun run
release`, then push).
