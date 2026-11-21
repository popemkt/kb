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
- **`render`** — `bun run test:render`, as two Playwright projects of the render
  config, each split into two shards by test count: `macos` (the specs that
  need a GPU or macOS's fonts and scrollbars) on `macos-15`, and `portable`
  (every other spec) on `ubuntu-24.04`. `MACOS_SPECS` in the render config
  names which specs are `macos`, with the reason for each group.
- **`android`** — the Android app (`apps/android`, a Gradle project the Bun
  workspace does not see): `gradle testDebugUnitTest assembleDebug` in the
  flake's `android` dev shell, so its JVM unit tests run and the debug APK
  builds with the JDK, Gradle and SDK a person builds with. On
  `ubuntu-24.04` only, and only when a change reaches the app (below). A
  failed run keeps its test report as the `android-test-report` artifact.
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
workflows. The audit reads commands from package scripts, shell hook files
and workflow `run` steps. An invocation names the first words of one
command, including any wrapper that runs it. A shell parser identifies
commands. Literal words compare after quote removal, and words containing
expansions compare by their original spelling. Comments, here-document
text and test operands supply no commands.
Lint invocations name complete enabled rule keys in the lint config.
Other file formats supply no invocations.

A fresh clone without `bun install` fails the hook with the command to run,
rather than passing on checks it could not make.

## Scheduling and selection

Every main push runs every gate before publication. A PR's gates are selected
by the paths its diff touches, in `bin/ci-scope`, which the `scope` job runs
and which prints one answer per gate. PRs whose entire diff is
Markdown under `docs/` or `README.md` run verify (including rule-home audits)
and generated-doc checks only. All other paths conservatively select all
suites: shared graph packages, extensions, assets and build configuration can
all affect browser rendering. Unknown paths select everything. `android` is
the one gate selected the other way round, by the paths it reads: the app's
own tree, its dev shell and the flake, the files its Gradle build names
outside it, and its own selection and job. Nothing else in the repository
reaches the APK. The final `validate` job is the single required check. It
reads every job result and fails for failed or cancelled gates. A gate is
skipped only by its `if`, which reads the scope's answer for it, so on a PR,
once `scope` has passed, a skip means the change did not select that gate;
on a push to `main` a skip fails. Verify has no `if` and always runs.

Core, UI, Android and the portable render specs run on Ubuntu, leaving three macOS
jobs per run: the two `macos` render shards and the Nix package check. A
Linux runner has no queue; the account runs five macOS jobs at once, so with
three per run two runs in flight already queue the third, and macOS wait
reached 40 minutes at p90 in the week before the split (render 1,000 s of run
time on each of two runners, 2026-11-15 to 17). The portable specs were 482 s
of the suite's 1,740 s of tests there; on a GPU-less Ubuntu runner they take
about 5 to 7 minutes per shard (run 44017124181), beside the macOS shards.
Three specs that the same probe ran 5 to 8 times slower (`query-builder`,
`view-settings`) or over a 250 ms frame budget (`query-budget`) stay on
macOS, as does anything that reads the GPU or the platform's text and
scrollbars; `--disable-gpu` made no difference to the slow ones. Core passed there in run
42249947516; UI's first Linux result is recorded in the performance record.
Each backdrop option is a separate isolated render test. CI assigns whole
spec files within each project by descending measured duration, placing
each file on the lightest shard so far. The render config reads the
project's `render-durations.json` weights and the matrix's
`KB_RENDER_SHARD` selection. A new file takes its project's median
measured duration until a new timing sample is recorded. CI pins
`workers: 1`; local runs use the default and collect the whole project
unless a shard is selected. Two
workers on the three-core macOS runner were tried (run 43371012192): every
test slowed, shard 2's tests summed 956 s against 396 s at one worker and
the shard took longer, and a frame-time assertion failed under the load.
Each test still
gets its own harness process and scratch store; a worker starts the next
test's while the current one runs (`HarnessPool` in
`tests-render/harness-server.ts`), so a test no longer waits out a process
start. `core` runs its files in four isolated workers, the reason stated
in the root `bunfig.toml`. The measurements behind both are in
[the 2026-11-13 record](research/2026-11-13-test-suite-speed.md).
Superseded PR runs cancel; publishing is serialized and never cancelled.

**Render timing.** The render step runs with `KB_RENDER_TIMING=1`, so each
test logs one `[timing]` line: the wait for its harness, the harness's boot
(it boots while the test before runs), the first `page.goto`, and the rest.
The sum of a shard's lines against its test step says what the harness, the
page load and the specs each cost on the macOS runner, which is where the
suite's time is spent; read them from the job log before changing the suite's
shape. The duration ledger starts with Validate run 44377439682. To update
it, sum `wait + goto + test` from each project's successful shard logs per
path relative to `tests-render`. The harness boots alongside another test,
so the weight includes the wait it caused and excludes the separate
`boot` measurement.

The setup action owns Nix installation and dependency setup, including the
flake-check store snapshot, which only the Linux `nix` job restores. On
`macos-15` the snapshot cost as much as it saved (run 44014077446: restore 170
s then a 52 s check, against 223 s with no snapshot, where cache.nixos.org
serves most of the ~3,700 bun2nix packages), and it is a 1.5 GB cache entry.
Chromium is cached by OS,
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
and merges the JSON reports Stryker writes for that run. A shard's working
baseline stays separate from its upload. The merge warns about unreadable
or invalid shard reports and uses the valid ones. A run with no valid reports
produces no new baseline.
The survivor report is the artifact.

The weekly mutation report saves its baseline cache whenever the baseline
file exists, including after an earlier step fails. The next run can reuse
the results represented in that file.

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
