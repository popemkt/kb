# Plugin sources: installing extensions from outside the repo (research, for the owner to read)

Date: 2026-10-31. Base: `main` at `a756efee`. This record surveys and
proposes. Nothing in it is built except the gap nodes it files (§8). It links
to the specs that own each mechanism and does not restate them:

- repository extensions, closures and trust: [DESIGN.md → Core boundary & extensions](../../DESIGN.md#core-boundary--extensions);
- the sandbox, `CodeGrant`, `sandbox.trust`: [DESIGN.md → Sandbox](../../DESIGN.md#sandbox);
- derived dependencies: [`2026-10-29-plugin-codependency.md`](2026-10-29-plugin-codependency.md);
- WASM components as a second sandbox: [`2026-10-31-rust-wasm-in-kb.md` §5](2026-10-31-rust-wasm-in-kb.md#5-plugins-as-wasm-components-a-second-sandbox).

The owner's question, verbatim: *"Should we start doing plugin marketplace,
pointing plugins at a github source for example?"*

## 0. The answer

**Start with the source, not the marketplace.** A marketplace is an index of
sources, and kb has no source yet.

1. **P0 is "install = vendor a sha-pinned GitHub tree into `.kb/extensions/`,
   with a committed lock".** Everything after the copy (discovery, closure,
   digest, trust, admission, switch, list) is the existing repository-extension
   path, unchanged. That is the smallest step that adds no second mechanism
   (Rule 1): a repository extension is already "a family from another
   source" (DESIGN.md), and this adds the source.
2. **Install never trusts.** The installed bytes are skipped until a person
   runs `sandbox.trust` on the closure digest. An update changes the bytes, so
   it changes the digest, so it is untrusted again with no new code. Nobody
   in the survey gets this property for free.
3. **A stranger's extension is owner code.** It is reviewed, not contained.
   QuickJS (and later a component engine) can hold a stranger's *code views
   and scripts*, which are nodes under a `CodeGrant`, not extensions. So the
   sandbox is P2 and is a different artefact from P0's.
4. **P1 is an index repo** of `{name, repo, path, sha}` entries, merged by PR
   review, like Zed, Raycast and Logseq. No registry, no resolver, no
   auto-update, no declared dependencies.
5. **One precondition.** `sandbox.trust` is callable by an agent today
   (`// GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]`). An `install` an agent can call,
   followed by a `trust` an agent can call, is a remote-code path. Land the
   governance guard ("never trusts code") before MCP exposes install (§5).

### Prior art at a glance

Claims are from primary docs or source fetched 2026-10-31 (Sources). "unv." means
not confirmed in a primary source.

| System | Source and pin | Update / rollback | Trust | Dependencies | Discovery | Uninstall |
|---|---|---|---|---|---|---|
| **Claude Code** | marketplace entry `source`: relative path, `github`, `url`, `git-subdir` (all with `ref` and a 40-hex `sha`), `npm`, `archive` + `sha256`, `command`. No lockfile; version = manifest `version`, else 12-char sha | manual `plugin update`; auto-update default only for official marketplaces; no rollback command; old versions kept 14 days | full user trust (hooks, MCP, LSP "can execute arbitrary code"); install pane shows a fixed warning, component list not available for remote plugins; admin allow/deny lists on marketplace sources; reserved marketplace names | `dependencies`, semver over `<plugin>--v<x.y.z>` git tags, auto-installed, cross-marketplace refused unless allowlisted | any git repo with `marketplace.json`; Anthropic's official and community repos | removes data; `--prune` drops auto-installed deps |
| **Codex** | `marketplace.json` (`.agents/plugins/` or the Claude path): `local`, `url`, `git-subdir`, `npm`; `ref` or `sha`; no content hash found | `marketplace upgrade`; no plugin-level update found; admin sync keeps last working version | host sandbox and approvals; a plugin's hooks are separately trusted ("installing or enabling … doesn't automatically trust its hooks") | none between plugins | `/plugins`, marketplaces | `plugin remove` deletes the cache |
| **Obsidian** | GitHub Release assets (`main.js`, `manifest.json`, `styles.css`); tag must equal manifest `version`; no client hash found (unv.) | manual only ("don't update automatically"); no rollback documented | Restricted Mode, all-or-nothing; since 2026-05-12 every version is scanned and builds verified, manual review for popular or flagged; no permission model | none; policy forbids a plugin installing its own deps | community.obsidian.md; `community-plugins.json` bot-mirrored | "remove"; `data.json` cleanup unv. |
| **Logseq** | `packages/<id>/manifest.json` in `logseq/marketplace` points at a GitHub repo; client takes latest release `.zip`; no hash check seen | update check on by default; install by tag exists; UI rollback unv. | PR review; `blocked.json`; plugin iframe on a separate origin, `effect: true` shares the host's; no permission prompt found | none found | the marketplace repo | deletes plugin dir and settings file |
| **VS Code / Open VSX** | VSIX in a registry; Marketplace signs on publish and the client verifies; "Install Another Version" | auto-update on; rollback by installing an older version | full trust; publisher-trust dialog; malware scan, sandbox VM, verified publisher; Open VSX: namespace claim, tokens | `extensionDependencies`, `extensionPack` (abused, §2) | two registries | uninstall; server block-list uninstalls |
| **Zed** | `extensions.toml` + a git submodule pinned to a commit + `version`; Zed builds the wasm | PR bumps the submodule; auto-update default on, per-extension off; rollback unv. | reviewed PR; wasm components on wasmtime; capabilities `process:exec`, `download_file`, `npm:install`, defaults grant all | none found | the monorepo | removes install and work dir |
| **Raycast** | PR into `raycast/extensions`; `package-lock.json` mandatory; no user-facing pin | auto-update; no user pin or rollback found | review; runtime "not further sandboxed"; source public | none | the monorepo / Store | unv. |
| **Figma** | upload; one latest version | publish updates everyone; users cannot revert | QuickJS-in-wasm main thread + iframe UI; manifest `permissions`, `networkAccess`; review for public listing | none | Community | unpublish removes for all |
| **Deno / JSR** | `jsr:` / `npm:` / URL; `deno.lock` with integrity hashes; `--frozen` | semver; revert the lock | versions immutable, yank-not-delete, provenance via GitHub Actions OIDC; runtime permission flags | transitive via registry, all in the lock | jsr.io | `deno remove` |
| **Nix flakes** | `github:owner/repo/<rev-or-ref>`; `flake.lock` `original` + `locked` {`rev`, `narHash`} | `nix flake update [input]`; revert the lock; profile generations | pure eval restricts reads; build sandbox; flake code itself is trusted | `inputs` graph, `follows` | registries (`indirect`) | `nix profile remove`, gc |

## 1. What kb has today

All from the specs and code, at `a756efee`.

- **A repository extension is already a family from another source.** Its
  module is `.kb/extensions/<name>.ts`, with an optional page half
  `<name>.page.tsx`; helper files in subdirectories are allowed, stray code
  at the top level is a failure (`strayCode`, `extension-loader.ts`).
  Everything else is the bundled families' path (`rootFamilies`,
  `serverEntriesFor`).
- **Trust is a digest, per machine.** The closure is every file the entry
  loads, bundled by Bun into one module; `extensionDigest` is its hash;
  `sandbox.trust` records it in `.kb/trust.json` (gitignored, one record per
  machine). An edit to any file is new code, untrusted. The server imports
  the approved bytes themselves (a `data:` module), never from disk.
- **Approved means owner code.** The digest proves *what* runs, not what it
  does; there is no permission model for extensions, by design (DESIGN.md →
  Approved means owner code). `LOADS_CODE` is a text check against mistakes.
- **What a closure may import is bounded.** An unresolved import is refused,
  so a source that needs a package the root does not hold fails at
  admission. That is the right default: `bunfig.toml` allows nothing to run
  at install time (DESIGN.md → Supply chain), and Obsidian's policy forbids
  plugins to "install or update themselves or their dependencies".
- **Admission is a gate.** `kb ext validate` (in `verify` as `check:ext`)
  composes every extension as if trusted and fails on any that would be
  skipped.
- **Actions are the one surface.** CLI, MCP and the page derive from the
  registry. A mode may add `outsideRoot: true` ("reaches past its kb root,
  to … a process it starts"), which MCP publishes as `openWorldHint`.
- **No policy bites yet.** The governance family contributes no guard, so
  `approval: "required"` is declared and not enforced
  (`// GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]`).

## 2. What the prior art teaches

**1. Everything that runs a stranger's code at full trust leans on review and
disclosure, and none of them has a permission model.** Claude Code, Codex
(for MCP and hooks), Obsidian ("cannot reliably restrict plugins to specific
permissions"), Logseq, VS Code and Raycast ask the user to trust the author.
The systems with declared capabilities run guests in a real sandbox
(Figma's QuickJS-in-wasm, Zed's wasmtime). Even then Zed's defaults grant
every capability, and two extension-archive advisories (zip-slip,
CVE-2026-27800; tar symlink, CVE-2026-27976, both 2026-02-25) came from the
host unpacking untrusted files. **For kb:** a stranger's extension is a
review, and the unpacker must copy regular files only.

**2. A pin is a full commit sha plus a hash you can recheck.** Tags and
branches move. Claude Code supports `sha` but has no lockfile, and an entry
with no `version` tracks every commit. Nix keeps the user's spelling
(`original`) beside the resolution (`locked`: `rev`, `narHash`); Deno's
lockfile carries integrity per entry and `--frozen` fails on drift. GitHub
itself says source-archive checksums are not guaranteed
([2023-01-30](https://github.blog/changelog/2023-01-30-git-archive-checksums-may-change/),
[2023-02-21](https://github.blog/open-source/git/update-on-the-future-stability-of-source-code-archives-and-hashes/)),
so hash the file set, not the tarball. **For kb:** `original` + `locked`, as
Nix does.

**3. Auto-update is the incident vector.** The Nx Console 18.95.0 release
reached auto-updating clients in an 11-minute window
([postmortem](https://nx.dev/blog/nx-console-v18-95-0-postmortem)). GlassWorm
published a clean extension and shipped the payload as a later update
([BleepingComputer, 2025-12-01](https://www.bleepingcomputer.com/news/security/glassworm-malware-returns-in-third-wave-of-malicious-vs-code-packages/)).
Obsidian chose manual updates. **For kb:** no auto-update; and an update
re-triggers trust, which kb's digest model gives for free.

**4. Dependency fields are the second vector.** Attackers added
`extensionPack` / `extensionDependencies` entries to benign Open VSX
extensions in later updates, pulling in loaders
([Socket, 2026-03-13](https://socket.dev/blog/open-vsx-transitive-glassworm-campaign)).
Claude Code gates cross-marketplace dependencies behind an allowlist; Codex,
Obsidian, Zed and Raycast have none. **For kb:** none is the right default,
and it agrees with the codependency record (§3.3: no manifest list, no
resolver).

**5. Discovery is an index repo, reviewed by PR.** Claude Code, Codex, Zed,
Raycast, Logseq and (now) Obsidian use one; only VS Code and JSR run a
registry. The best variant is Zed's: the index entry *is* the pin (a
submodule gitlink), so what is reviewed is what is fetched, and CI builds
it. **For kb:** P1 is that.

**6. Names need defending.** Claude Code reserves official marketplace names
and rejects lookalikes; Open VSX verifies namespace ownership publicly.
**For kb:** an installed extension's name is its namespace (`ext.<name>.*`),
so the installer refuses a bundled family's name and the index (P1) owns one
name to one source.

Incidents reported but not about the mechanism itself: PhantomPulse
(Elastic, 2026-04-14), which abused the legitimate Shell Commands plugin
through an attacker's vault; Logseq host CVEs (CERT Polska, 2026-06-09); the
Open VSX scanner fail-open bug, fixed 2026-02-11 (Palo Alto). I found no
compromised-plugin or takeover incident for Obsidian, Zed or Raycast in
primary sources; that is a limited search, not proof.

## 3. The model: a source is where `.kb/extensions/` bytes come from

**The concept** is the *source of an extension's bytes*. Today there is one
(files already in the root, put there by hand or by git). The proposal adds
one more, and nothing downstream changes:

| Step | Today | With a source |
|---|---|---|
| Put bytes in `.kb/extensions/` | by hand / git | `extension.install` (new) |
| Discover, bundle, digest | `readClosures` | unchanged |
| Trust | `sandbox.trust` on the digest | unchanged |
| Admit | `kb ext validate` | unchanged, plus "files equal the lock" |
| Switch, list, footprint | `extension.*` | unchanged; `list` gains `from` |
| Update | edit files | `extension.update` (new): same bytes path, new rev |
| Remove | delete files | `extension.remove` (new): files, lock entry |

**Vendored, not cached.** The installer writes the files into
`.kb/extensions/` and they are committed with the repo. The alternative, a
cache outside the repo that discovery also reads, would be a second
discovery path. Vendoring gives:

- review in the repo's own PR (the update diff is `git diff`);
- rollback by `git revert`; a revert restores a digest the person trusted
  before, which `.kb/trust.json` still records unless they untrusted it, so
  it works at once;
- no network on a fresh clone or in CI;
- the cost is repo size and diff noise, and that is the point.

**Source layout.** A source (a repo, or a `path` inside one) is laid out as
`.kb/extensions/` is: `<name>.ts`, optionally `<name>.page.tsx`, and helpers
under `<name>/`. The installer mirrors it 1:1 and writes nothing else.
Authors already develop this way (`kb ext sdk --write`), so no layout
restructure is needed. The installer:

- reads git objects, not a checkout: regular files only (mode 100644 and
  100755), no symlinks (120000), no submodules (160000), no path outside
  `<name>.ts`, `<name>.page.ts(x)`, `<name>/**`, no `..`, no case or
  Unicode collision (the zip-slip and tar-symlink lessons, §2.1);
- refuses a name held by a bundled family or by a file that is not this
  source's lock entry;
- runs no code: it bundles to compute the closure digest (as `closureOf`
  does) and imports nothing.

## 4. The lock

**`.kb/extensions.lock.json`, committed.** One file, `original` beside
`locked`, the shape Nix uses:

```json
{
  "version": 1,
  "extensions": {
    "pomodoro": {
      "original": "github:someone/kb-pomodoro/ext#v1.2.0",
      "locked": { "repo": "someone/kb-pomodoro", "path": "ext", "rev": "<40 hex>" },
      "files": "sha256:<64 hex>"
    }
  }
}
```

- **`original`** is what the person typed; a tag or branch is resolved once,
  at `install` and `update`, to `rev`. Only a full 40-hex `rev` is ever
  fetched: GitHub serves `git fetch --depth 1 <url> <full-sha>` and refuses
  an abbreviated one (checked 2026-10-31 against `popemkt/kb`). Git verifies
  the objects against that id, so the commit is its own integrity check, and
  no archive hash is involved.
- **`files`** is `kb.source/1`: SHA-256 over the sorted `(path, mode, bytes)`
  of the vendored set. It answers "do the bytes on disk equal that commit's
  tree", offline, so `kb ext validate` can fail a PR that hand-edits vendored
  code. (A git tree id would do the same job with no kb-owned format, at the
  price of needing git to verify; open question Q4.)
- **Why two hashes is not a mirror.** `files` hashes the *source files* and
  is the same on every machine; the closure digest hashes *Bun's bundle*, and
  a Bun upgrade changes it (DESIGN.md → The host and the bundler are outside
  the digest). They answer different questions, one is provenance and one is
  approval, and neither is derived from the other. The lock holds no trust,
  and trust (`.kb/trust.json`, per machine, gitignored) holds no provenance.
- **Why a file and not nodes.** "Everything is a node" is the rule for kb's
  model, and the lock is not model: it must be readable before the store
  opens, by `validate` and CI, and must not be writable by `node.update` from
  any actor. Trust sits beside it for the same reason. Editing the file by
  hand is allowed and `validate` catches a lie. Q3 asks the owner.
- **Deleting a lock entry** turns the extension into an ordinary repository
  extension, local edits and all. There is no "eject" verb and no
  "modified" state to build.
- **Merge.** Entries are keyed by name and the file is written sorted, so
  two branches that each add one extension do not collide at a shared tail
  line, which is what `nodes.jsonl`'s ULIDs do (hence its merge driver).

## 5. Trust: what runs trusted, what runs in a sandbox

| Artefact from a stranger | What it is | Runs as | Reviewed by | When |
|---|---|---|---|---|
| **Extension** (`<name>.ts`: declares, contributes actions, points, view types, a server entry, a page half) | owner code in the server and the page | owner code, after `sandbox.trust` on the closure digest | the person, reading the closure | P0 |
| **Code view / script** (a `#script` node: code + `CodeGrant`) | a node under a grant | QuickJS untrusted (views, snapshots); Worker after `sandbox.trust` on the code+grant digest (scripts) | the grant, said in words by `grantSentence`, plus the code | P2 |
| **Component guest** (WIT `kb:guest`, any language) | a guest like a script, never a kernel plugin | a component engine under the same grant | same as a script | P2, only if a non-JS untrusted guest becomes a requirement ([rust-wasm record §5](2026-10-31-rust-wasm-in-kb.md#5-plugins-as-wasm-components-a-second-sandbox)) |

- **An extension cannot be contained in-process.** It runs in the server's
  realm. The only containment would be a process per extension, which the
  codependency record rejects (§3.3). So P0 does not pretend: install is
  "download code you will read".
- **What a trust prompt can honestly show before the code runs.** The
  declaration is code, so kb cannot list an untrusted extension's actions or
  its `inject`s (that needs running it). It can show what bundling already
  knows: `from` (repo, path, rev), the file list and sizes, the closure
  digest, which host modules and which Node/Bun builtins the closure
  imports (`node:fs`, `node:child_process`, `node:net`), and, on update, the
  diff against the locked rev. Name it a *reach disclosure*, not a
  permission: reflection bypasses it (DESIGN.md says so for `LOADS_CODE`),
  and Zed shows what a vocabulary alone buys: its defaults grant every
  capability. It rides on the `extension.list` row, which is already "the one
  report".
- **An agent must not be able to complete the chain.** Both `install` and
  `update` declare `approval: "required"` (as `sandbox.trust` does), plus
  `outsideRoot`. Declared is not enforced (§1). The governance family's
  designed default is "an agent asks before … never trusts code" and it is
  the same gap `01M5E2DAVRH5CWKM27BVDYW19T`. **Recommend landing that guard
  for `sandbox.trust` before P0 is exposed over MCP.** CLI and UI are a
  person's own gesture and can ship first.
- **A code view/script pack (P2)** is nodes, so it is not an extension and
  needs no loader: the source holds an outline (Tana Paste, `node.addTree`),
  its grants are read from the nodes, and each is untrusted until its
  digest is trusted. The reusable unit is the *source reader* (resolve,
  fetch by sha, verify, lock), shared by two sinks (files for an extension,
  nodes for a pack). Designing the pack's provenance (a `:node/owner`-like
  mark, since imported nodes are then the user's data) is out of scope here.

## 6. Actions: one registry, three surfaces

| Action | Mode | CLI | MCP | Page |
|---|---|---|---|---|
| `extension.install {source, name?}` | write, `approval: required`, `outsideRoot` | `kb ext install <source>` | tool (open-world) | Settings → Extensions → Add from GitHub |
| `extension.update {name}` | write, `approval: required`, `outsideRoot` | `kb ext update <name>` | tool | Update, with the diff |
| `extension.remove {name}` | write | `kb ext remove <name>` | tool | Remove |
| `extension.list` (extended) | read | `kb ext list` | tool | the existing rows, plus `from`, `reach` |
| `sandbox.trust {digest}` (unchanged) | write, `approval: required` | `kb action-invoke` | tool | the existing Trust gesture |

- **One report.** `from` is a read-time join of `extension.list` with the
  lock, not a stored column. A new `extension.sources` read would be a
  second report beside `list` (Rule 1).
- **No `dryRun` flag.** Preview of an update is the working-tree diff
  (`git diff`) and the update leaves the extension untrusted until trusted
  again, so applying is the preview and a revert is the cancel. A network
  read `extension.outdated {name?}` (rev upstream vs locked) is a P1 nicety,
  as its own read, `outsideRoot`.
- **Remove** deletes files and the lock entry. The extension's seeded nodes
  stay, as for any family switched off ("the data stays"); `kb ext footprint
  <name>` lists them first. Trust records are per digest and harmless; a
  rollback finds them.
- **Transport.** `git` as a child process (hence `outsideRoot`). Q4 weighs it
  against GitHub's tarball-by-commit API.

## 7. Dependencies across sources

The codependency record's model carries over unchanged: a dependency is
`inject` joined to `provide`, derived and never declared, and a missing
provider means `pending`, not an error.

- **One kernel, any source.** A bundled family, an installed extension and a
  hand-written one are all plugins in the kernel, so `kb ext list` and the
  organisation report show a missing provider the same way for all.
- **Keys are compared by identity** (`keys.ts`), and an extension's closure
  inlines every import except the host's modules. So two separately
  installed extensions cannot share a key one of them defines: each bundle
  holds its own copy. An installed extension can therefore depend only on
  keys the host owns (`kb-ext-sdk`, `@kb/contracts`), never on another
  installed extension. That is a limit and a feature: the graph is a star
  around the host, no transitive install, no resolver, no cycle. It
  sharpens the codependency record's open Q1 (where cross-family keys
  live); filed as a gap (§8).
- **Pre-trust, kb cannot say what an extension needs**, because that is in
  its code. After trust, `kb ext list` shows `nobody yet` for an unprovided
  key. Do not paper over that with a manifest `requires:` list (VS Code's
  `extensionDependencies`, §2.4); if the P1 index ever shows needs, they are
  generated by the index's CI from the same report and never typed.
- **Index and lock are not dependency sources.** Neither carries one.

## 8. Phases

| Phase | What | Rule 1 order | Size | Closes |
|---|---|---|---|---|
| **P0** | `extension.install`, `update`, `remove`; the lock; `from` and `reach` on `extension.list`; "files equal the lock" in `kb ext validate`; CLI and page gestures. GitHub only: `github:owner/repo[/path][#ref]`, resolved to a full sha at install | add only: the loader, closure, digest, trust and admission are untouched | M | G1, G2 |
| **P0a** (precondition for MCP) | the governance guard: an agent's `sandbox.trust` is denied or asked | add (the guard exists, uncontributed) | S | `01M5E2DAVRH5CWKM27BVDYW19T` (partly) |
| **P1** | an index repo (`kb-extensions`): entries `{name, repo, path, sha, description, tags}` merged by PR, CI runs `install` in a clean root, `kb ext validate`, the reach report, and a one-name-one-source check. `name@index` as the install spelling; indexes are sources in the same lock, pinned to a sha; a root setting names the allowed indexes. `extension.outdated`. Still no auto-update, no dependency field | add | M | G3 |
| **P2** | sandboxed third-party: packs of code views and scripts from a source (shown by `grantSentence`); a component engine only if a non-JS untrusted guest is required | restructure (share the source reader), then add | L | G4 |

- **P0 exit test.** `install` of a fixture repo writes the files and lock;
  the extension is listed untrusted with its digest; `sandbox.trust` loads
  it; a changed byte in the vendored tree fails `validate`; `update` to a
  new rev leaves it untrusted; `git revert` of the update restores it
  trusted; a symlink, a `..` path, a submodule and a bundled name are each
  refused. Per "One contract, every implementation", the source reader is a
  port (`SourceReader`) with a GitHub adapter and an in-memory one, and
  these properties are one shared contract suite over both, so a second host
  (GitLab, a plain git URL) joins the suite and the spec states the promise
  once.
- **What not to build, and why.** Auto-update (§2.3); a version resolver or
  ranges (the codependency record §3.3); a manifest dependency list (§2.4);
  a registry with accounts (an index repo gets reviewed identity from GitHub
  and PR history); signing before there is a publisher population (Open
  VSX's and Obsidian's problems are scanning and tokens, and a signature
  attests the publisher, not the code).
- **Gaps** recorded as `#gap` nodes in this record's commit:
  - **G1** `01M68NF91SD1D15C00TYDTPQXE` — No way to install an extension from a pinned source, and no
    provenance for one: bytes arrive only as files already in the root.
  - **G2** `01M68NF9WGE31RYX3VB9EWHC8M` — A stranger's extension is trusted by digest alone: nothing shows
    a person its reach before they trust it, or the diff on update.
  - **G3** `01M68NFAXME4CJ8EQT36HKB9ED` — No index of installable extensions (P1).
  - **G4** `01M68NFBY0FEK3Q2CW2XZ7E6DE` — No distribution for sandboxed third-party code: code views and
    scripts have no source, and the component engine is unbuilt (P2).
  - **G5** `01M68NFCSWZ41EJNBVDJ23RPFJ` — Two installed extensions cannot share a key, since each closure
    inlines its own copy: installed extensions can depend only on host keys.
  - `sandbox.trust` and `extension.install` being agent-callable is the
    existing `01M5E2DAVRH5CWKM27BVDYW19T`; it is not filed again.

## 9. Questions for the owner

1. **Vendor into the repo, or cache outside it?** The record recommends
   vendoring (§3). A cache is a second discovery path.
2. **Does P0 wait for the governance guard (P0a)?** The record recommends
   shipping CLI and page first and holding MCP exposure until the guard
   lands.
3. **The lock as a file or as nodes?** Recommended: a file (§4). Nodes would
   make provenance editable by any actor and unreadable before the store
   opens.
4. **`git` as a child process, or GitHub's tarball API by commit id?**
   Recommended: git. A commit id is its own integrity check and also works
   for GitLab and plain git URLs. The tarball API needs no `git` binary and
   GitHub documents it as stable by commit id, but its bytes are GitHub's to
   keep stable; then `files` is the only integrity check.
5. **P1: who reviews the index?** A reviewed index is a policy, not a
   mechanism; the owner is the first reviewer, as Zed's and Raycast's
   maintainers are theirs.

## Sources

kb (at `a756efee`): DESIGN.md → Core boundary & extensions, Sandbox, Supply
chain, Action registry; `packages/app/runtime/src/extension-loader.ts`,
`extension-closure.ts`, `families.ts`; `packages/application/operations/src/trust.ts`,
`extensions.ts`; `packages/infrastructure/workspace-fs/src/trust.ts`;
`packages/domain/plugin/src/keys.ts`. Fetched 2026-10-31 by three research
passes plus spot checks; "unv." marks what no primary source confirmed.

Claude Code:
- https://code.claude.com/docs/en/plugins/marketplace-reference.md (source types, `sha`, `archive.sha256`, reserved names; re-fetched to confirm)
- https://code.claude.com/docs/en/plugins/security.md, `/plugins/org.md`, `/plugins/dependencies.md`, `/plugins/loading.md`, `/plugins/cli-reference.md`, `/plugins/publish.md`, `/plugins/anthropic-marketplaces.md`, `/plugins/host-marketplace.md`
- PromptArmor on plugin hooks, 2025-10-16: https://promptarmor.substack.com/p/hijacking-claude-code-via-injected

Codex:
- https://developers.openai.com/codex/plugins/build, https://learn.chatgpt.com/docs/plugins, `/docs/enterprise/plugin-management.md`, `/docs/developer-commands.md?surface=cli`
- https://github.com/openai/codex (`codex-rs/cli/src/plugin_cmd.rs`, `codex-rs/core-plugins/src/*`)

Obsidian, Logseq, VS Code, Open VSX, Zed:
- https://obsidian.md/blog/future-of-plugins/ (2026-05-12, re-fetched), https://docs.obsidian.md/Community+directory/Developer+policies, https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin, https://github.com/obsidianmd/obsidian-releases, `obsidianmd/obsidian-help` "Plugin security"
- https://www.elastic.co/security-labs/threat-command/phantom-in-the-vault
- https://github.com/logseq/marketplace; `logseq/logseq` `src/electron/electron/plugin.cljs`; https://cert.pl/en/posts/2026/06/CVE-2026-9279/
- https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security, https://code.visualstudio.com/docs/editor/extension-marketplace, https://code.visualstudio.com/api/references/extension-manifest
- https://github.com/eclipse/openvsx/wiki/Publishing-Extensions, https://mikael.barbero.tech/blog/post/2025-10-27-openvsx-security-update/, https://socket.dev/blog/open-vsx-transitive-glassworm-campaign, https://paloaltonetworks.com/blog/security-operations/open-sesame-fail-open-bug-open-vsx-scanner, https://nx.dev/blog/nx-console-v18-95-0-postmortem
- https://zed.dev/docs/extensions/publishing/publishing-guide, https://zed.dev/docs/extensions/capabilities, https://github.com/zed-industries/extensions (`extensions.toml`, `.gitmodules`, CI), `zed-industries/zed` `crates/extension_host/*`, GitHub advisories GHSA-v385-xh3h-rrfr and GHSA-59p4-3mhm-qm3r

Raycast, Figma, Deno/JSR, Nix, GitHub:
- https://developers.raycast.com/basics/publish-an-extension, `/basics/prepare-an-extension-for-store`, `/information/security`; https://github.com/raycast/extensions/blob/main/CONTRIBUTING.md
- https://developers.figma.com/docs/plugins/how-plugins-run/, `/plugins/manifest/`, `/plugins/publishing/`; https://www.figma.com/blog/an-update-on-plugin-security/ (2019-10-02, QuickJS)
- https://docs.deno.com/runtime/fundamentals/modules/, `/runtime/packages/supply_chain/`; https://jsr.io/docs/trust, `/docs/immutability`
- https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-flake.html, `nix3-flake-update.html`, `nix3-profile.html`
- https://github.blog/changelog/2023-01-30-git-archive-checksums-may-change/, https://github.blog/open-source/git/update-on-the-future-stability-of-source-code-archives-and-hashes/
- `git fetch --depth 1 <url> <full-sha>` against github.com, run once on 2026-10-31: a full sha fetched, an abbreviated sha was refused.

Not verified: Raycast's uninstall and artefact storage; Figma's install prompt wording; Zed's extension-archive integrity check and rollback; Logseq's update UI; Obsidian's client-side hash check, rollback and `data.json` cleanup; Open VSX's current scanner controls.
