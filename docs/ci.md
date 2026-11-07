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
- **`render (1/2)`, `render (2/2)`** — `bun run test:render`, split by test count.
- **`validate`** — aggregate result of every selected gate; the single required check.

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
all affect browser rendering. Unknown paths select everything. The final `validate` job is the single required check. It reads every job
result, accepts skipped runtime jobs only for prose-only PRs, and fails for
failed or cancelled gates. Skipped runtime jobs are
intentional only for prose; verify remains unconditional.

Core and UI run on Ubuntu, leaving three macOS jobs per run: the two
render shards and the Nix package check. Core passed there in run
42249947516; UI's first Linux result is recorded in the performance record.
Each backdrop option is a separate isolated render test. Playwright shards
individual tests by count with `fullyParallel: true`, taking contiguous
slices in file order. All 60 backdrop tests currently land in shard 1:
about 8.7 minutes of tests against an estimated 6.3 minutes in shard 2.
This balances count, not duration, and remains sensitive to file order.
CI pins `workers: 1` to keep per-runner load fixed; local runs use the default.
Superseded PR runs cancel; publishing is serialized and never cancelled.

The setup action owns Nix installation and dependency setup, including the
flake-check store snapshot. Chromium is cached by OS,
architecture and lockfile; installation still runs to verify its presence.
Dev shells continue to use Nix's binary substituter: a previous snapshot
experiment took 67 seconds versus 45 seconds to substitute, so restoring a
large store in every job would slow this pipeline. Cache misses never bypass
an install, build or test. Bun downloads remain uncached: a hit plus install took 16.2s versus
10.3s for an uncached install (saving the cache added 14s). Chromium cache
hit plus install took 6.5s versus 11s on a miss, so it remains enabled.

The [dated performance record](research/2026-11-06-ci-baseline.md) holds
baseline and after-run numbers, cache evidence, and the failure audit.

## Batches

Use one PR per related, reviewable batch, with separate commits for structural
refactors and behavior additions (Rule 1). Agents stack work on that batch
branch, run local admission, then push a completed batch together. Mark its
body `Batch:` with the included changes and validation. Avoid merging partial
stacks one PR at a time: every main merge correctly triggers full validation
and publication. Unrelated changes remain separate PRs. This uses ordinary
PRs without a paid merge-queue dependency or repository-setting changes.

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
    "contexts": ["validate"]
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
