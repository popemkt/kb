# Changelog

Every stable release of kb, newest first. Each section is generated from the
conventional commits since the previous stable tag by `bin/release-notes`, the
generator that also writes the GitHub release's notes; `bun run release` (and
the Actions "Release" workflow that runs it) adds the next one. Nightly
prereleases are not listed here.

## v0.3.0 — 2026-10-20

Since v0.2.2 (45 changes).

### Features

- **extensions:** a family's tags are declared once and every plugin of it carries them (af32cd85)
- **plugin:** the kernel reports tags and derived dependencies, and kb ext list shows them (c33e345e)
- **server:** kb ui --socket, and the identity header believed only there (4b9b72ce)
- **governance:** a deployment without governance seeds no policy node (b406acdb)
- **code:** a script never starts a run by the code family's guard, not a declared policy (a694542c)
- kb --governance required|off; a required governance fails closed (a23c9503)
- interceptors, required guards, nesting limit and the SDK's guardAction/onAction (b47f0b09)
- a kb ui server with no identity provider runs, and every connection is nobody's (3e484687)
- kb ui --identity-header trusts a reverse proxy to name the person (c7124ae1)
- repository extensions get the full plugin surface, both halves, approved as one closure (91967d79)
- a nightly prerelease of main, published by the same path (7c0f1142)
- Actions → Release bumps, commits, tags and publishes a stable release (16d2a384)
- release notes and CHANGELOG.md come from conventional commits (c655171e)
- kb is MIT-licensed, and a checkout puts its own kb on PATH (70da9d5a)

### Fixes

- **invoke:** the call's record is frozen, and a call is plain data (dc8967bf)
- **interception:** a required plugin is missing once a plugin that loaded it goes (384b733d)
- **interception:** a listener that throws as it makes its effect fails closed (da8e6b9d)
- **invoke:** the call is sealed data from the start, its action included (c8169ea9)
- **server:** a socket is stale only when a connection to it is refused (aa5ed0db)
- **plugin:** the kernel moves before an unloading plugin's finalizers run (f8fecffc)
- **invoke:** a call's listeners run as the call, so their calls nest in it (20c39004)
- **interception:** a guard reads sealed copies of the call and the commit (c06b76b9)
- **interception:** a guard's span records its decision and rule, and the benchmark asserts (ebf5fafa)
- **agent-ui:** a tab that is nobody's knows it without trying the agent's channel (7f8a690f)
- **plugin:** a plugin's contributions appear and go as one (241c19c1)
- **test:** the crashing-bun merge test links its tools instead of assuming /usr/bin (1f13d25b)
- a tab nobody is verified for publishes its screen; only channels and approvals need the person (07bb4736)
- a root has one registry at a time, and the one it replaces is released (5e2f9357)
- approved means owner code; trust is read on every load (7ff86edd)
- the release smoke test opens its store under a home of its own (075d59f9)
- a test run never resolves the person's home store (6dc3bad1)

### Refactors

- **server:** where a ui server listens is one value the bind and the guard read (0df8f63a)
- **governance:** the policy vocabulary, resolver and seed are the family's (176c2b05)
- **identity:** identity.providers answer or pass, and the first answer holds (b45910d3)
- governance is a family; core contributes no guard (d244aca0)
- approval is a guard on the invoke core's guard point (1a771fde)
- identity providers are plugins contributing to IdentityPoint (0c2b4f87)
- who the person is is one input, from the deployment's authenticator (29b67076)
- a repository extension is a family, loaded as a bundled one is (7e8317b0)
- publish.yml is the one release path, called by release.yml (f0fe78ed)

### Documentation

- the extension-point review, and three corrections it found (12562a7b)
- what kinds of extension kb supports, with what it does not offer (0d55c673)
- correct the DeepSeek Harness takeover claim; propose governance as a plugin (49ea6e97)

### Tests

- kb ext list's tags and guard order, --governance, and the page token's adoption (548444bb)
- **harness:** core stands on core alone, checked over kb's own compositions (700ea2bd)

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
