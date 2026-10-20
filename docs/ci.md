# CI

Five workflows: one gates the repository, one grades its tests, and three
release it.

| Workflow | Trigger | What it answers |
|---|---|---|
| `validate.yml` | PR, push to `main` | Is the repo green? |
| `kb-mutation.yml` | Weekly (Mon 04:00 UTC, incremental), monthly (full), manual | Which mutants does the test suite fail to kill? |
| `release.yml` (Release) | Manual with a bump, or a hand-pushed `v<major.minor.patch>` tag | Cut a stable release: version, CHANGELOG, commit and tag, then publish |
| `nightly.yml` (Nightly) | Validate green on a push to `main`, manual; daily 03:00 UTC prunes only | Publish that commit as a `-nightly.<UTC YYYYMMDDHHMMSS>` prerelease, unless a nightly holds it |
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
- **`render`** — `bun run test:render`.

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

## Why the jobs look the way they do

- **One job per question, sharded where one is slow.** Before the split the
  suites ran one after another in a single job, about 18 minutes; now the
  longest job is the render suite. The UI suite, the slowest, is sharded
  across two runners rather than parallelised on one: Vitest already forks a
  worker per core within a package, and the suite has gone red under load
  before (the timing gaps in `docs/rules.md`), so each shard keeps the load
  a single run had. `test:ui` still runs one package at a time
  (`--parallel=1`), and the shard is Vitest's own `--shard`, passed through
  nx to each package.
- **Five macOS jobs, no more.** An account runs at most five macOS jobs at
  once: `nix (macos-15)`, `core`, the two UI shards and `render`. A sixth would
  wait for one of Validate's own to finish, which is why the render suite,
  shorter than the UI suite, stays one job.
- **Only the flake check's store is cached.** The macOS `nix flake check`
  builds one derivation per npm package, about 3,700, none of them
  substitutable: about seven minutes. `nix-community/cache-nix-action`
  restores them from the repository's Actions cache, no secret involved, and
  only kb itself builds. The dev shell and Bun's package cache are not
  cached, because measured they do not pay: the dev shell substitutes from
  cache.nixos.org faster than its snapshot untars, and `bun install` takes
  seconds. The setup action states the numbers.
- **It calls `bun run verify`, not its constituent tools.** `verify` is the one
  name for the complete toolchain gate; what it runs is its definition in
  `package.json`, and is stated nowhere else.
- **`verify` checks out the full history.** The harness's warn ratchet holds
  the committed baseline to the one at the fork point with `main` (on `main`
  itself, the previous commit), so a regenerated snapshot cannot raise it; a
  shallow clone has no fork point to read. No other job reads history.
- **The render suite runs, with no retries.** `bun run test:render` builds the
  UI in Vite's `test-render` mode and gives every test its own server over a
  fresh fixture store (`tests-render/harness-test.ts`), so no test can see
  another's writes. It runs Chromium's new headless mode with WebGPU enabled.
  Each spec that draws a scene asserts the backend it expects: WebGPU where
  Chromium offers an adapter, WebGL2 where it does not, so a silent fall back
  is red. The WebGPU-only specs (the Embers study) skip on a runner with no
  adapter, each under the gap that names that lane.
- **The suites run on `macos-15`, not `ubuntu-latest`.** They have only ever
  run on Darwin. Linux would be faster and cheaper, but a first-ever Linux run
  would mix real regressions with portability noise. Moving them is a
  worthwhile follow-up on its own. The package build already runs on Linux,
  in the `nix` job, and `verify` runs there: it is static analysis, and the
  pre-commit hook runs it on Linux checkouts for every commit. That also
  keeps it out of the five macOS slots.
- **The DST sweep runs 25 extra seeds.** `bun test` already runs the committed
  seeds; the sweep is the only thing that exercises replay determinism on
  seeds nobody has looked at. It is pure and in-memory, so it is nearly free.

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
                 "ui (1/2)", "ui (2/2)", "render"]
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
