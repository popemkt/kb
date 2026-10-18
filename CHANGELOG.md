# Changelog

Every stable release of kb, newest first. Each section is generated from the
conventional commits since the previous stable tag by `bin/release-notes`, the
generator that also writes the GitHub release's notes; `bun run release` (and
the Actions "Release" workflow that runs it) adds the next one. Nightly
prereleases are not listed here.

## v0.2.2 — 2026-10-18

Since v0.2.1 (6 changes).

### Fixes

- the core suite's time budget is 30 s, not bun's 5 s default (ee224772)
- heading anchors keep underscores; rule scopes name kb's own paths (5c969010)
- release, dev-shell and mutation-plan scripts say what they mean (ef73333b)
- gap markers fail closed, and check:gaps scans the scripts and workflows (b832f5c9)
- a merge-driver crash is never read as a conflict it wrote (9bc4dea6)

### CI

- actions pinned by commit, and a release only from main, with provenance (d3dfc277)

## v0.2.1 — 2026-10-18

Since v0.2.0 (4 changes).

### Features

- a check surface's files are data on its enforcement level (4a5873b1)

### Fixes

- gen:ext-sdk writes the SDK module formatted (c9a42c15)

### Documentation

- a README for someone who has never seen kb (4195382d)

### CI

- shellcheck every bin/ script, not a list of them (2a6d44a5)

## v0.2.0 — 2026-10-18

First release of kb as its own repository (1481 commits of history).
