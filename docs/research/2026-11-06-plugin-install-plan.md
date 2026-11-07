# Installing extensions from outside the repo: the build spec

Date: 2026-11-06. Base: `main` at `c665f90e`. This is the build spec for
installing kb extensions from GitHub and from marketplaces. A build thread
implements it step by step (§10), one PR per step, and each step amends
DESIGN.md first (DESIGN.md → Spec-first changes). Nothing here is built
yet, apart from the `#gap` nodes that §10 files.

It builds on these records and specs, and does not restate them:

- the survey and the P0/P1/P2 answer: [`2026-10-31-plugin-sources.md`](2026-10-31-plugin-sources.md)
  (cited below as "the sources record");
- repository extensions, closures, trust, admission: [DESIGN.md → Core boundary & extensions](../../DESIGN.md#core-boundary--extensions)
  and its "Approved means owner code";
- `CodeTrust`, `sandbox.trust`: [DESIGN.md → Sandbox → Trust](../../DESIGN.md#trust);
- `bunfig.toml` running nothing at install time: [DESIGN.md → Supply chain](../../DESIGN.md#supply-chain);
- the home store and `homePath`/`cachePath`: [DESIGN.md → Locations](../../DESIGN.md#locations);
- the backdrop surface: DESIGN-UI.md → Page-head backdrops, and the
  Backdrop Studio note `2026-11-06-backdrop-studio.md` (thread
  thr_e2ak64ym79, in review).

**What changed since the sources record.** It recommended vendoring
installed trees into each repo's `.kb/extensions/` (its §3 and Q1). The
owner has since chosen otherwise: *"so that multiple kb doesn't need
multiple installation of extensions, they can have separate extensions in
their own .kb folder, or they can point to another"*. So fetched bytes live
once per machine, in a per-user store, and each kb store's committed lock
says which of them it enables. The sources record's cost of a cache, "a
second discovery path", is avoided by making discovery one path over an
ordered list of folders (§1). Its lock shape (§4), its rule that install
never trusts (§0), and its threat lessons (§2) all carry over.

## Open questions for the owner

Each has a recommendation, and the build follows it unless the owner says
otherwise.

1. **Is trust shared across stores?** Recommended: yes. There is one trust
   record per user per machine, keyed by digest, for all code kb trusts
   (extensions, and also code views, scripts and provider bindings). §4
   gives the safety argument. The alternative keeps trust per store and
   trusts again in each one.
2. **What happens when two folders hold the same name?** Recommended: the
   nearer one wins, and the farther one is listed as shadowed (§1). The
   alternative refuses both until one is removed.
3. **What is the default scope of `kb ext install`?** Recommended: `store`,
   the committed lock. `--scope user` means "enabled in every kb on this
   machine".
4. **Can third-party extensions use npm packages?** Recommended: no. A
   tree's closure resolves only inside the tree, so an author vendors a
   library into `<name>/` (§8, T8).
5. **Which hosts does v1 accept?** Recommended: `github:` only, through a
   port that a plain git URL can join later.
6. **Does a running `kb ui` reload on a lock change in this round?**
   Recommended: yes, as the last step (§10, step 12). Until then, the update
   output says "restart kb ui".
7. **Does `update` with no name update everything?** Recommended: yes. It
   trusts nothing, so it is safe for an agent to run.

## 0. The shape in one screen

- **A source is a GitHub path:** `github:owner/repo[/path…][@ref]`. A
  subfolder of a monorepo is fine. The ref is resolved once, to a full
  40-hex sha, and only that sha is ever fetched. `@ref` replaces the
  sources record's `#ref`, as the owner's spelling.
- **A marketplace is an optional index on top:** any git repo with a
  `kb-marketplace.json`, pinned in the lock the same way. `install <name>`
  resolves through the marketplaces. There is no registry service.
- **The bytes live once per machine,** in a content-addressed per-user store
  at `<data>/extensions/store/<files>-<name>/`. Stores do not copy them.
- **Discovery is one path over an ordered list of extension folders:** the
  store's own `.kb/extensions/`, linked folders, and installed trees, drawn
  from three lock scopes (store, local, user). Nearest wins.
- **Install, update, outdated, diff, remove and gc are agent-friendly.** None
  of them trusts anything. New bytes have a new digest, and a new digest is
  untrusted.
- **Trust is the one gate,** and only a person can open it: the page's
  Trust button, the agent dock's approval card, or a TTY prompt on the CLI.
  The invoke core enforces `approval: "required"` in every governance mode
  (step 0, kb#110). So an agent cannot trust: MCP does not list
  `sandbox.trust`, and the CLI with no TTY answers `approval_required`.
- **Bytes are built locally from source at the pinned sha** by the existing
  closure bundler. Nothing runs at install. An import the tree cannot
  resolve is refused.
- **Nothing updates automatically.** `outdated` reads and `update` writes,
  and both are explicit.

## 1. Where things live, and how they combine

`<data>` is kb's per-user data directory: `$KB_DATA`, else
`~/Library/Application Support/kb` on macOS, else
`${XDG_DATA_HOME:-~/.local/share}/kb`. It is the parent of today's default
home store (`<data>/home`). One function owns it (`dataPath`, beside
`homePath` and `cachePath` in `@kb/workspace-fs`'s `home.ts`), and
`homePath` derives from it. A test run must name `KB_DATA`, as it must name
`KB_HOME`.

**The directory kb starts in has no say over it.** Bun auto-loads `.env` and
`bunfig.toml` from the working directory. A clone's `.env` could set
`KB_DATA` to a forged trust ledger, and a `bunfig.toml` `preload` runs code
before kb's entry does (T15). So kb is launched with exactly the flags in
`packages/infrastructure/child-process/src/kb-launch-flags.txt`, shipped
verbatim as `lib/kb/launch-flags`: `--no-env-file` and `--config=/dev/null`
(an explicit empty config, for macOS and Linux delivery).

- **One adapter applies them.** `bin/kb-bun` reads the file and executes
  Bun. The checkout's `bin/kb`, the release launcher and the repo's Nix
  packaging all go through it. A wrapper that calls Bun directly, such as
  the owner's dotfiles Nix wrapper, must pass exactly those flags before
  `$out/lib/kb/cli.js`. The file is the release contract that such a
  wrapper reads.
- **The entry fails closed.** `cli.js` compares `process.execArgv` with the
  same embedded file: order does not matter, but no flag may be missing or
  extra. On a mismatch it exits 78 with `kb: unsafe Bun launch; …`, before
  it imports the CLI or runtime, so no store is opened.
- **The honest limit.** A `bunfig.toml` preload runs before any entry
  code, so the entry check cannot undo one, and it cannot vouch for process
  state that hostile code has already touched. The flags are what prevents
  it; the check only catches an ordinary unprotected launch. kb ships
  Bun-target JS only. A standalone `--compile` binary would need its own
  rule.

| What | Where | Committed? | Holds |
|---|---|---|---|
| Own extensions | `<root>/.kb/extensions/` | yes | files, as today |
| Store lock | `<root>/.kb/extensions.lock.json` | yes | installs, marketplaces, links that resolve inside the repo |
| Local lock | `<data>/extensions/local/<key>.json`, `key` = SHA-256 of the canonical root | no (per-user state, outside every repo; backed up) | the same schema plus the `root` it belongs to: this machine's installs and links for this store, links anywhere |
| User lock | `<data>/extensions/lock.json` | no (backed up) | the same schema: "enabled in every kb on this machine" |
| Trees | `<data>/extensions/store/<files>-<name>/` | no (refetchable) | immutable, read-only source trees |
| Trust | `<data>/trust.json` | no (backed up) | `{digest, machine, at, name?, files?}` records |
| On/off | the store's `sys.extension.<name>` switch | as the store is | unchanged (`extension.switch`) |

One schema covers three scopes, as Claude Code's settings have user,
project and local scopes. `--scope store|local|user` picks the file.

**The local lock lives outside the repo.** Its links may point anywhere,
so only this machine's person may write it, and a file inside the root
can't promise that. A gitignored file can still be force-added and
committed, cloned, or shipped in an archive. The lock is therefore kept
under `<data>`, keyed by the root's canonical path (`canonicalRoot`, with
symlinks resolved), and it records that `root`. A file whose `root` does not
match its key is ignored. A root that moves starts with an empty local
lock; `kb ext gc` lists local locks whose root no longer exists.
A selection file inside the repo (`<root>/.kb/extensions.local.json`) is
never read. When one is present, `extension.list` says once that it is
ignored (T14), as with the old trust file (§4). There is no migration;
re-add with `--scope local`.

**The search list, nearest first.** Discovery reads an ordered list of
*extension folders*, each laid out like `.kb/extensions/`. An installed
tree is a folder holding one extension.

1. `<root>/.kb/extensions/`;
2. the local lock's links (in listed order), then its installs;
3. the store lock's links, then its installs;
4. the user lock's links, then its installs.

Within a scope, links come before installs, so `kb ext link ~/dev/aurora`
overrides an installed `aurora` while you work on it.

**Name clashes.**

- **A bundled family's name is refused** wherever it appears. The kernel
  does this already (`name-taken`), and install refuses it up front.
- **The same name in two folders:** the nearest is the extension. Every
  farther copy is listed on `extension.list` as `shadowed by <folder>`. It
  is never loaded, and never silently dropped.
- **Precedence is resolved before trust.** An untrusted nearer copy does not
  fall through to a trusted farther one, because otherwise which code runs
  would depend on trust state. The worst a clone can do with a shadowing
  copy is hide your extension in that store, and the list shows that.
- **Within one lock, names are keys,** so they are unique by construction.

**When a pointed-to folder changes underneath a store.**

- **A running server keeps what it imported.** A running `kb ui` or
  `kb mcp` imported its closures from memory (a `data:` module), so it
  keeps running the bytes it trusted (`closureCache`, one read per process).
- **The next read sees the change.** That is the next start, or step 12's
  reload.
  - An edited extension has a new digest, so it is untrusted: it is skipped
    and listed with its new digest.
  - An added extension is untrusted.
  - A removed extension is gone. Its nodes stay, as a switched-off
    family's do.
  - A missing folder is one failure row (`link ../notes/.kb/extensions:
    missing`), and the rest load.
  - None of these is an error that stops the store opening.
- **A tree in the store does not change underneath anyone.** It is written
  read-only, and every load checks its file-set hash against the lock's
  `files`. A tree that does not match is refused as `tampered`, and
  `kb ext install` (no arguments) writes it again.
- **With shared trust (Q1), a link brings in everything trusted in that
  folder.** Linking another store's `.kb/extensions/` enables everything in
  it, and anything already trusted there runs here too. That is what a link
  means, and `kb ext link` says so when it runs. It is also why only a
  person's own locks (local and user) may link outside the repo: a
  committed link to `../notes/.kb/extensions` would let any clone run, in
  its own root, what you trusted in another store (T14).

**Admission does not change.** `kb ext validate` (in `verify`, so in
pre-commit and CI) runs extension code without trust, so it stays confined
to the checkout's own code: `<root>/.kb/extensions/`. For the locks it
checks, without running or fetching anything:

- that the schema is valid;
- that every store-scope link resolves inside the repo (§2, Links);
- that no name is a bundled family's;
- that the `files` hash matches, where the tree is present.

Installed and linked code is never run by a gate. It runs only after a
person trusts it.

## 2. Formats

**Source grammar** (one parser, `@kb/extension-source`):

```
github:<owner>/<repo>[/<path>…][@<ref>]     ref: branch, tag or full sha; default: the default branch
https://github.com/<owner>/<repo>/tree/<ref>/<path>     pasted URL, normalised to the form above
<name>[@<marketplace>]                      through the marketplaces
path:<dir>                                  link only (kb ext link)
```

**An extension source** is a directory with exactly one top-level server
entry `<name>.ts` (a `.d.ts` file does not count). It may also have
`<name>.page.ts(x)`, helpers under `<name>/`, and `README.md` and
`LICENSE*`, which are copied for the review sheet. Other top-level files,
such as `package.json` or a `tsconfig`, are not copied, and install lists
them as `ignored`. A directory with several entries is refused, and the
refusal names each one as a path to install instead.

**The lock** is the same file in all three scopes. It is written sorted, so
two branches that each add one entry do not collide on a shared last line.

```json
{
  "version": 1,
  "marketplaces": {
    "sample": {
      "original": "github:popemkt/kb-plugins-sample",
      "locked": { "repo": "popemkt/kb-plugins-sample", "path": "", "rev": "3f2c1a9…40 hex", "files": "sha256:…" }
    }
  },
  "extensions": {
    "aurora": {
      "original": "aurora@sample",
      "locked": { "repo": "popemkt/kb-plugins-sample", "path": "extensions/aurora", "rev": "3f2c1a9…", "files": "sha256:…" }
    },
    "hello": {
      "original": "github:popemkt/kb-plugins-sample/extensions/hello@main",
      "locked": { "repo": "popemkt/kb-plugins-sample", "path": "extensions/hello", "rev": "3f2c1a9…", "files": "sha256:…" }
    }
  },
  "links": ["tools/kb-extensions"]
}
```

- **`original` and `locked`.** `original` is what was typed; `locked` is
  what it resolved to, in the Nix pattern (the sources record §4).
- **`files`** is `kb.source/1`: SHA-256 over the sorted `(path, mode,
  bytes)` of the copied set. It is the tree's integrity check and its
  address in the store. It is provenance, not approval. The closure digest
  is approval (the sources record §4, "two hashes is not a mirror").
- **A marketplace install records its marketplace in the same lock.**
  Installing by name adds the marketplace's pin to the lock it writes to,
  so each lock is self-contained, and a clone on a machine that never added
  `sample` can still fetch.
- **Links.** A store-scope link is committed, so the repository chooses
  it, and it must resolve inside the repo. It is a relative path from the
  root, with no absolute path and no `..` that leaves the root. Where the
  folder exists, its real path (symlinks followed) must also lie inside the
  root's real path. Links to sibling stores or anywhere else belong in the
  local or user lock, which live in per-user state outside the repo
  (§1), so only this machine's person writes them.
  `extension.link` refuses an outside path in the store scope. `validate`
  reports one in a committed lock, and discovery skips it with a failure
  row instead of loading it.

**The marketplace index**, `kb-marketplace.json` at the marketplace
source's path:

```json
{
  "version": 1,
  "name": "sample",
  "extensions": [
    { "name": "aurora", "description": "A drifting aurora backdrop", "source": { "path": "extensions/aurora" } },
    { "name": "hello", "description": "One read action", "source": { "path": "extensions/hello" } },
    { "name": "elsewhere", "source": { "github": "someone/kb-x", "path": "ext", "rev": "<40 hex>" } }
  ]
}
```

- **Two kinds of entry source.** A `path` source is in the same repo, at the
  index's own pinned rev. An external `github` source must pin a full sha:
  an index entry with a ref is refused, so what was reviewed is what is
  fetched (Zed's lesson, the sources record §2.5).
- **One name, one source, per index.** Two marketplaces that both offer
  `aurora` make a bare `install aurora` ambiguous, so it is refused, and
  the refusal lists `aurora@sample` and `aurora@other`.

**The tree store.**

- **The path is content-addressed:** `store/<files hex, first 32>-<name>/`.
  The name is derived from the file-set hash, as in a Nix store path, not
  from `<name>@<sha>`: one sha holds many subfolders, and forks share shas,
  so the file set is the only address that cannot collide. The rev and repo
  are in the lock, not in the path.
- **Trees are written once.** Each is written into `<data>/extensions/tmp/`,
  verified, made read-only (`a-w`), then renamed into place. Two stores
  that install the same bytes share one tree.
- **A marketplace index is stored the same way,** as
  `store/<files>-<name>.marketplace/`.

**The trust record** is `<data>/trust.json`, today's format plus optional
provenance:

```json
{ "version": 1, "trusted": [
  { "digest": "sha256:…", "machine": "shared-server", "at": "2026-11-06T…", "name": "aurora", "files": "sha256:…" }
] }
```

`name` and `files` are written when the digest is an installed tree's.
`diff` (§3) uses them to find the last trusted tree, and `gc` (§6) uses
them to retire trust that no lock still references. Code views, scripts and
an extension's own folder are trusted with no provenance, and gc never
touches those records.

## 3. The surface

The registry is the one surface. Each action gets CLI, MCP and the page
from it with no code of its own (DESIGN.md → Action registry). `outsideRoot`
is true for every action that touches the network or `<data>`.

| Action | Mode | CLI | What it does |
|---|---|---|---|
| `extension.install {source?, scope?}` | write, outsideRoot | `kb ext install [source] [--scope]` | Resolves, fetches, verifies and writes the tree, then the lock entry. **With no source, it fetches every tree any lock in effect names that is missing** (a fresh clone, a new machine). Trusts nothing. |
| `extension.update {name?, scope?}` | write, outsideRoot | `kb ext update [name]` | Re-resolves `original` (and, through a marketplace, that marketplace's pin first), then writes the new tree and lock entry. Output: `{name, from, to, digest, trusted, review}`. |
| `extension.outdated {name?}` | read, outsideRoot | `kb ext outdated` | Locked rev against upstream, for each `original`, with the files changed. Writes nothing. |
| `extension.diff {name}` | read | `kb ext diff <name>` | The file diff between the last trusted tree of `name` (from trust provenance) and the locked tree. Offline. |
| `extension.remove {name, scope?}` | write | `kb ext remove <name>` | Removes the lock entry. The tree stays until gc, and the nodes stay. |
| `extension.link {path, scope?}` / `extension.unlink` | write, outsideRoot | `kb ext link <folder>` / `unlink` | Edits the links of a scope. |
| `extension.marketplace.add {source, scope?}` / `.remove` / `.update {name?}` | write, outsideRoot | `kb ext marketplace add\|remove\|update` | Edits a lock's marketplace pins. |
| `extension.marketplace.list {query?}` | read | `kb ext marketplace list [query]` | Each marketplace and its entries, read from the pinned index trees. Offline. |
| `extension.gc {}` | write, outsideRoot | `kb ext gc` | §6. |
| `extension.list` (extended) | read | `kb ext list` | Each row gains `source` (own, link, or install with its scope, `original` and rev), `files`, `shadowed`, `trusted`, and `reach`. Still the one report. |
| `sandbox.trust` (unchanged) | write, approval required | `kb ext trust <name>` | The CLI gesture: it prints the review (§4) and asks on the TTY. |

- **No `--yes`, no `--dry-run`.** Nothing these verbs do trusts or runs
  code. Apply is the preview: a lock diff in git, and a tree that stays
  untrusted. `gc` only removes what no lock names, and that can be fetched
  again.
- **The reach line on the list** is what bundling already knows (the
  sources record §5): the files and their sizes; whether it has a page
  half; the host modules each half imports; and the Node/Bun builtins the
  server half imports (`node:fs`, `node:child_process`, `node:net`). The
  scan already happens in `unseenCode`. This is a disclosure, not a
  permission.
- **Transport.** `git` runs as a child process with `childProcessEnv`, with
  `-c core.hooksPath=/dev/null -c protocol.allow=never -c
  protocol.https.allow=always -c protocol.ssh.allow=always`. The steps are
  `git ls-remote` to resolve a ref, then a fetch into a scratch bare repo.
  The fetch is bounded before it writes. `--depth 1 --filter=blob:none`
  brings the commit and its trees only, `git ls-tree -r -z` lists the path,
  the count and path checks run, and only the listed blobs are fetched,
  stopping at the byte cap. A blob outside the path is never downloaded. It
  never checks anything out. Private repos work through the person's own
  git credentials.
- **A pinned sha must belong to the named repo.** GitHub serves any commit
  in a fork network through the parent's URL, so a sha alone does not say
  whose code it is ("imposter commits", T13). `read` refuses a `rev` that is
  not reachable from a ref of `repo`. It lists the refs with
  `git ls-remote`, fetches their commits only (`--filter=tree:0`), and
  needs `git merge-base --is-ancestor <rev> <ref>` to hold for one of them.
  The check lives in `read`, so install, restore from a lock and update all
  get it. A sha that a ref no longer reaches (force-pushed away) is refused
  too, so restoring a lock can fail. Re-pin it with `update`. The memory
  adapter models reachability with its refs, and the contract suite holds
  both adapters to it.

## 4. Trust

**Is shared trust safe?** Trust stays per machine and per digest, and the
recommendation (Q1) is one record per user, so one approval covers every
store that loads the same digest. This is no weaker than per-store trust:

- **Per-store trust contains nothing for an extension.** A trusted extension
  is owner code with the server's reach (DESIGN.md → Approved means owner
  code). Once trusted in store A, it can already read and write store B's
  files.
- **The digest is the same in every store.** A tree's closure resolves only
  inside the tree (T8), so its digest depends only on the tree's bytes, the
  Bun version and `HOST_MODULES`, never on which store loads it.
- **The sandbox's principle still holds.** "Whoever opens a root someone
  else wrote runs none of its code before they have read it": a shared
  digest is code this person read.
- **What sharing does add, and the fences against it:**
  - **Selection.** A hostile store can choose to enable code you trusted
    elsewhere, including an older trusted version with a known flaw (a
    downgrade). Fences: `update` keeps the old digest trusted (so a revert
    rolls back at once), and `gc` retires trust records whose `files` no
    lock references any more. `kb ext list` in the hostile store shows
    exactly what it enabled.
  - **Confused deputy.** Trusted code acting on a hostile store's data. This
    is unchanged by sharing, and is the same as any editor plugin.
- **Code views and scripts move with it,** because `CodeTrust` is one port
  with one record (Rule 1), and the argument is the same: a shared digest
  is code and grant you read.
- **No automatic migration; the old file is ignored.** A root's
  `.kb/trust.json` is a file the repository controls. It can be committed
  or shipped in an archive, and its `machine` field is only a hostname. So
  kb never reads it as trust, in its own root or any other. Folding it in
  on open would let a hostile clone's forged records become trusted in
  every store; this was found reviewing kb#115 (T12). When the file exists,
  `extension.list` says once that it is ignored and that the person trusts
  again.
- **Import is optional, and a person's gesture.**
  `sandbox.trust.import {root, digests}` is an action that declares `approval: "required"` and `outsideRoot`. The
  CLI's `kb trust import [root]` reads that root's legacy file and fills
  `digests` with its records for **this machine only**, so the approval
  prompt shows exactly what will be trusted. The handler adds each listed
  digest that the file holds for this machine, and nothing else. It never
  deletes or rewrites the old file. Approval works as for any required
  action, so MCP doesn't list it and an agent can't complete it.
- **Reads never write, and an unreadable record is never overwritten.** A
  trust read only reads. A `<data>/trust.json` that can't be decoded (it is
  corrupt, or a newer kb's `version`) trusts nothing. `trust`, `untrust`
  and import then refuse with an error naming the file, and leave its bytes
  unchanged.
- **Backup.** The backup entry (Mackup's `kb` application, which today
  names each root's `.kb/trust.json`) moves to `<data>/trust.json`. That
  entry lives in the owner's dotfiles, not in this repo.

**Only a person trusts (step 0).**

- **Core enforces declared approval, in every deployment.** The invoke core
  answers an action that declares `approval: "required"` (or a batch with
  such a part) `approval_required` unless `hasPerson` holds. It does this
  for invoking and for listing alike, and depends on no governance guard,
  so `kb --governance off` drops policy, never this. Today the
  approval-required actions are `sandbox.trust`, `ext.code.script.run` and
  `ext.canvas.run`. Graph policies, `delegated` and `force` stay deferred
  under `01M5E2DAVRH5CWKM27BVDYW19T`. Built in kb#110; DESIGN.md → Action
  registry → Current stance is the canonical statement.
- **Which surfaces carry approval:**
  - the page's wire carries it (`PAGE_WIRE`);
  - the agent dock's approval card sets `approved` when the person clicks;
  - MCP never carries it, so MCP does not list approval-required tools at
    all;
  - the CLI's JSON envelope never carries it. A CLI call answered
    `approval_required` asks on `/dev/tty`, showing the actor, title and
    input; it accepts `y` or `yes` and declines after 120 s. With no TTY, it
    is refused.
  - an approved call passes its approval to the calls it makes inside; an
    inner call cannot create approval, and entering a script drops it.
- **What this stops, honestly.** It stops an agent that follows kb's
  surface, and calls driven by prompt injection. It does not stop a process
  with a shell, which can allocate a fake pty, forge the page's `Origin`, or
  write `trust.json`. Governance is not a security boundary; accounts are
  (DESIGN.md → Sandbox → The threat model).

**What the person sees, from the kb page.** Settings → Extensions shows an
untrusted row with "Review & trust", which opens a sheet:

```
Trust "aurora"?
From     github:popemkt/kb-plugins-sample/extensions/aurora @ 3f2c1a9 (main)
         via marketplace "sample" · enabled by this kb's lock
Update   from 9b8e7d6 · 2 files changed, +14 −3            [Show diff]
Reaches  page half: react, kb-ext-sdk/page · server: no builtins
Files    aurora.ts 1.2 KB · aurora.page.tsx 4.8 KB · aurora/draw.ts 2.1 KB   [Read]
Digest   sha256:5e1f…
It runs with your power, on the server and in the page, in every kb on
this machine that enables it.
                                              [Not now]  [Trust]
```

Trust calls `sandbox.trust` on the page wire. The family loads with no
restart, because trust is read on every load (DESIGN.md → Trust is read on
every load).

**What the person sees, from an agent thread.**

- **The agent stops at untrusted.** It runs `kb ext update aurora` (CLI or
  MCP), and the output ends with `trusted: false` and a `review` link: the
  served `kb ui`'s Settings → Extensions URL for the row.
- **The agent shows the review.** In bb, it moves the kb tab to that row
  (`kb_call ui.navigate`), so the sheet is beside the thread. Elsewhere it
  prints the link, or the line `kb ext trust aurora` for a terminal.
- **The agent cannot trust.** Over MCP, `sandbox.trust` is not listed as a
  tool. Over the CLI or `kb_call`, it answers `approval_required`. Either
  way, the person clicks Trust in the sheet, or answers the TTY prompt in
  their own terminal.
- **In kb's own agent dock,** the approval card shows the same review lines,
  and the person's click there is the approval.

## 5. The update flow, end to end, from an agent thread

1. Person: "update my kb plugins".
2. **Check.** The agent runs `kb ext outdated --json` (or the
   `extension.outdated` tool): `aurora: 9b8e7d6 → 3f2c1a9 (main), 2 files`;
   `hello: up to date`.
3. **Update.** The agent runs `kb ext update`. For `aurora`, this:
   - refreshes `sample`'s pin;
   - re-resolves the entry;
   - fetches `3f2c1a9`;
   - verifies the tree, writes it read-only, and rewrites the lock entry.

   The output is `{name: aurora, from: 9b8e7d6, to: 3f2c1a9, digest:
   sha256:5e1f…, trusted: false, review: <url>}`. In a store that is a git
   repo, `.kb/extensions.lock.json` now has a working-tree diff.
4. **Read.** The agent runs `kb ext diff aurora` and summarises it, for
   example: "adds a `hue` knob in aurora.page.tsx; no new builtins; the
   server half is unchanged".
5. **Hand over.** The agent opens the review sheet beside the thread (§4)
   and says what it changed. It cannot trust.
6. **Trust.** The person clicks Trust. The running `kb ui` loads the new
   closure:
   - after step 12, by itself;
   - before it, on restart. The update's output says so.
7. **Verify.** The agent reads `extension.list`: `aurora` is trusted and
   loaded, with the new rev. If the person asks, it commits the lock change.
8. **Rollback.** `git checkout -- .kb/extensions.lock.json`, or a revert.
   The old tree is still in the store until gc, and its digest is still
   trusted, so it loads at once.

## 6. Uninstall and GC

- **`kb ext remove <name> [--scope]`** removes the lock entry. From the next
  load the family is gone.
  - **Its nodes stay.** That includes its seeded options and any knob
    values, as for a switched-off family. `kb ext footprint <name>` lists
    them before you remove it.
  - **A page whose chosen backdrop came from it** falls through to the next
    node's choice. This is already how a choice whose declaration is gone
    resolves (DESIGN-UI.md → Page-head backdrops).
  - **The trust record stays.**
- **`kb ext gc`** never runs by itself, and its output lists what it
  removed.
  - **It reads the locks in effect anywhere:** the user lock, plus the store
    and local locks of every location in the home store (DESIGN.md →
    Locations).
  - **It deletes** every tree, and every marketplace tree, that none of
    those locks names.
  - **It untrusts** every trust record whose `files` none of them names.
    Records without provenance (own folders, code views, scripts) are never
    touched.
  - **A store that was never registered** can lose its tree. That costs a
    `kb ext install` there, which fetches it again.

## 7. How backdrops arrive this way

Backdrops are the first thing a third party would ship, and the example
shows that nothing about them is special.

- **Prerequisite (step 11).** `kb-ext-sdk/page` does not export
  `BackdropPoint` today. It exports `DesignSystemPoint`, but no backdrop
  surface, so a repository extension cannot contribute a backdrop at all.
  Once Backdrop Studio phase 1 merges, the SDK exports:
  - `BackdropPoint`, `provideBackdrop` and the `Knob` types, through
    `kb-ext-sdk/page`;
  - the backdrop declared-option kind, through `kb-ext-sdk`, so that a
    declaration can name its backdrops and their knobs.
- **The extension.** The sample's `aurora` is `aurora.ts`, which declares
  `declaredOptions: [{kind: BACKDROP, options: [{id: "aurora.aurora", label:
  "Aurora", knobs: [speed, hue]}]}]`. `aurora.page.tsx` provides the
  backdrop: a canvas-2D component and its presentation. `aurora/draw.ts` is
  a helper.
- **Install and trust.** `kb ext install aurora@sample` writes the tree and
  the lock entry. The row is untrusted, and its reach says `page half:
  react, kb-ext-sdk/page`. Trust.
- **It joins the graph** as nodes, like every backdrop. The fold seeds
  `sys.backdrop.aurora.aurora` and derives its knob fields, the Studio
  note's decision 4, by the path a bundled family's backdrop takes. The page
  imports the page half from its digest path, and `aurora` appears in the
  Settings picker and the Studio gallery. Its knobs are set with `kb set`
  and MCP `node.update`, like any built-in's.
- **Tested like a built-in.** The shared backdrop contract suite runs over
  it as over every contribution (step 11's acceptance).
- **Update and removal** follow §5 and §6. A GPU host for third-party scenes
  (`mountBackdrop` through the SDK) is not in scope; a third-party backdrop
  draws on its own canvas.

## 8. Threats

| # | Threat | Fence | Pinned by |
|---|---|---|---|
| T1 | **Unpacking.** A symlink, submodule, `..`, absolute path, or case/Unicode collision writes outside the tree (CVE-2026-27800, CVE-2026-27976; the sources record §2.1). | Git objects are read, not checked out. Only modes 100644 and 100755 are accepted; 120000 and 160000 are refused. Only the allowed path set (§2) is written, with no `..` and no absolute path, and paths must be unique under NFC plus case folding. There are caps (proposed: 512 files, 8 MiB). Files are created exclusively in `tmp/`, then renamed. | `SourceReader` contract suite (step 3) |
| T2 | **Moving refs.** A tag or branch is re-pointed after review. | Only a full 40-hex sha is fetched. Refs are resolved only at `install`/`update` and recorded in `original`. A marketplace entry must pin a sha, or be relative to the index's pinned rev. `files` is checked again on every load. | contract suite; lock tests (step 4); index tests (step 9) |
| T3 | **Auto-update** (Nx Console, GlassWorm; the sources record §2.3). | There is no auto-update and no background apply. `outdated` only reads. `update` never trusts, and a new digest is untrusted. | step 7 acceptance |
| T4 | **An agent completes install → trust.** | Core's required-approval invariant, in every governance mode; MCP neither carrying approval nor listing such tools; the TTY prompt. Honest limit: a shell can fake a pty, forge `Origin` or write `trust.json` (§4). | surface contract property under `required` and `off`; CLI approval test (step 0, kb#110) |
| T5 | **Name squatting and shadowing.** | Bundled names are refused. Nearest wins, and shadows are listed. Each index holds one name per source, and an ambiguous bare name is refused. | steps 2, 4, 9 |
| T6 | **Shared-trust downgrade.** | gc retires trust no lock references. `list` shows what a store enables. | step 10 |
| T7 | **A tree is tampered with in the store.** | Trees are read-only, `files` is checked on every load, and a mismatch is refused as `tampered`. | step 4 |
| T8 | **Resolution escapes the tree.** A stray `~/node_modules` gets inlined, so the digest varies by machine. | For an installed tree, every input of the bundle must lie inside the tree (read from Bun's metafile), else the tree is refused. This is a property of the folder entry (`contained`), which is data, not a flag on the bundler. Own and linked folders keep today's resolution. | step 4 |
| T9 | **A compromised marketplace** re-points a name. | That is only a change through `marketplace update` or `update`. It arrives as a new digest, which is untrusted and has a reviewable diff. | step 9 |
| T10 | **Install-time code.** | Nothing runs. Bundling only reads files, as `bunfig.toml`'s empty `trustedDependencies` keeps it. | step 4 |
| T11 | **Gates run a stranger's code.** | `kb ext validate` runs only the root's own `.kb/extensions/`, and checks the locks without running or fetching anything (§1). | step 4 |
| T12 | **Forged trust from a repository.** A committed or shipped `.kb/trust.json` names this hostname and a hostile digest. | kb never reads a root's trust file as trust. Import is an approval-required gesture that shows its digests and imports this machine's records only. Reads never write (§4). | step 1 |
| T13 | **Imposter commit.** `github:trusted-org/x@<sha>` names a commit pushed only to a fork, which GitHub serves through the parent's URL. | `read` refuses a `rev` not reachable from a ref of the named repo (§3, Transport), on install, restore and update. | contract suite (step 3) |
| T14 | **A repository links outside itself.** A clone's store lock links `../notes/.kb/extensions`, or a force-added or archived `.kb/extensions.local.json` carries a local-scope link there. Shared trust then runs what you trusted in that sibling store inside the clone (found reviewing kb#120). | A store-scope link must resolve inside the repo, symlinks included (§2, Links). Outside links live only in the local and user locks, and both sit in per-user state under `<data>`, never in the root. A selection file inside the repo is ignored and reported, because gitignore is not an authority boundary (§1). | steps 4 and 8 |
| T15 | **The working directory configures the runtime.** Starting kb inside a clone lets Bun auto-load its `.env` (`KB_DATA` pointing at a forged trust ledger) and its `bunfig.toml` (a `preload` runs before kb). | kb is launched only with `--no-env-file --config=/dev/null`, from one shipped flag file, through `bin/kb-bun` or a wrapper that passes the same flags. `cli.js` exits 78 when its `execArgv` doesn't match. A preload can't be undone after the fact, so the flags are the defence (§1). | step 1 (`KB startup contract`) |

## 9. What not to build

- **Auto-update, version ranges, and a dependency field.** The sources
  record §2.3, §2.4 and §7 apply unchanged: an installed extension depends
  only on host keys (gap `01M68NFCSWZ41EJNBVDJ23RPFJ`).
- **A registry with accounts, and signing.** The sources record §8 applies.
- **Vendoring into `.kb/extensions/`.** It is superseded (see the top of
  this record). A person who wants a vendored copy can still copy a tree
  into their own folder; it is then their code, as any own extension is.
- **A `--yes` flag on trust.**

## 10. Build plan

There is one PR per step, in this order. Each step amends DESIGN.md first.
Where it restructures, it lands the restructure as its own
behaviour-preserving commit, before the addition (Rule 1). Each step is a
`#gap` node, filed in this record's commit and listed under its parent gap.
Parent gaps:

- `01M68NF91SD1D15C00TYDTPQXE`: install from a pinned source (G1);
- `01M68NF9WGE31RYX3VB9EWHC8M`: reach and diff before trust (G2);
- `01M68NFAXME4CJ8EQT36HKB9ED`: an index (G3);
- `01M5E2DAVRH5CWKM27BVDYW19T`: governance.

**Step 0. Declared approval is enforced** (`01M6RTR1775DH21W4KB26W3ZXV`; child of
`01M5E2DAVRH5CWKM27BVDYW19T`).

Built in kb#110, which also removes its gap.

- The invoke core enforces `approval: "required"` in every governance mode.
- A CLI call answered `approval_required` prompts on the TTY.
- **Acceptance:**
  - MCP does not list `sandbox.trust`, `ext.code.script.run` or
    `ext.canvas.run`;
  - the page wire succeeds, and an explicit `approved: false` is refused;
  - the CLI with no TTY is refused, also under `--governance off`, and with
    a TTY and `y` succeeds;
  - the sandbox runner's run still works;
  - the surface contract property "approval required needs a person" runs
    under both `required` and `off`.

**Step 1. One per-user data dir; trust is per user** (`01M6RTR2WM61SX5PPZWTZC5X2T`; child of G1;
decision Q1).

- `dataPath`, `KB_DATA`, with the test preload naming it.
- `codeTrustLayer` reads and writes `<data>/trust.json` only. A root's
  legacy `.kb/trust.json` is ignored (§4).
- Optional: `sandbox.trust.import` and `kb trust import [root]`,
  approval-required, import this machine's records only (§4).
- **Acceptance:**
  - trusting in root A makes `sandbox.trusted` true in root B;
  - a legacy `.kb/trust.json`, committed or not, grants nothing in its own
    root or any other. Opening that root leaves `<data>/trust.json`
    byte-identical, and `extension.list` reports the file as ignored;
  - if import is built, `kb trust import` with a TTY "y" adds exactly
    this machine's digests from the file and leaves the file in place. Over MCP the action is not
    listed; on the CLI with no TTY it answers `approval_required`;
  - a corrupt or `version: 2` `<data>/trust.json` trusts nothing, and
    `trust`, `untrust` and import refuse, with the file byte-identical;
  - two processes trusting at once keep every digest;
  - another machine's records still count for nothing;
  - a test run without `KB_DATA` fails;
  - the `KB startup contract` suite
    (`packages/app/cli/tests/startup-contract.test.ts`) builds the real CLI
    bundle, extracts the real release launcher and uses the shipped flag
    file. From a hostile working directory:
    - for each of the checkout, release and Nix launchers, a `.env` setting
      `KB_DATA` doesn't reach kb, a `bunfig.toml` preload doesn't run, and
      repo-local selection files grant nothing;
    - a negative control shows the same directory really does load the
      `.env` value and run the preload when the flags are left out, so the
      test can't pass vacuously;
    - a raw `bun cli.js` without the launch flags exits 78 before it
      creates `nodes.jsonl`. With an extra flag it also exits 78;
    - an install check runs the built Nix artifact;
  - `.gitignore` is updated, and the PR tells the owner which backup path
    moved.

**Step 2. Discovery over an ordered list of folders** (`01M6RTR435JMY23NN9M18X72Q0`; child of
G1; a restructure).

- `readClosures` takes `ExtensionFolder[]` (`{dir, origin, contained}`),
  and `rootFamilies` passes `[own]`.
- Failures name their folder.
- **Acceptance:**
  - every existing extension test passes unchanged (the restructure
    commit);
  - then, with two folders holding one name, the nearer loads and the
    farther is listed `shadowed`, even when only the farther is trusted.

**Step 3. `SourceReader` port** (`01M6RTR59A4JRD5MPZDVGXADDQ`; child of G1).

- The source grammar; `resolve` to a full sha; `read` to the checked file
  set; `files` (`kb.source/1`).
- Two adapters: a git one (its URL base injected, so tests use a local bare
  repo) and an in-memory one.
- One contract suite runs over both.
- **Acceptance:**
  - the suite covers each T1/T2 property;
  - an abbreviated sha is refused;
  - a full sha that no ref of the named repo reaches is refused, by both
    adapters;
  - a blob outside the requested path is never fetched, and the caps
    refuse before the blobs are written;
  - `files` is stable across adapters for the same tree;
  - the pasted-URL form is normalised.

**Step S. The sample repo** (`01M6RTR6Q4KFJZ4Z59QE62TYJQ`; child of G1; no kb code).

- Create the public repo `popemkt/kb-plugins-sample` (§11).
- **Acceptance:** `git ls-remote` resolves it, and it holds the layout
  in §11.

**Step 4. The tree store, the locks, `install`** (`01M6RTR7Q326WF4C6S4RV0JJTW`; child of G1).

- The three lock scopes and their schema.
- Installs and links enter the search list by the precedence in §1.
- The `contained` resolution check (T8).
- `install` with no source fetches what is missing.
- `validate` checks the locks without running them.
- **Acceptance:**
  - E2E 1 (§11);
  - a tampered tree is refused, and `kb ext install` restores it;
  - a missing tree is reported `not fetched`;
  - a bundled name is refused;
  - an escaping import is refused;
  - a store-lock link that leaves the repo (absolute, `..` out of the
    root, or a symlink out) fails `validate` and is not loaded;
  - a committed or archived `<root>/.kb/extensions.local.json` with an
    outside link selects nothing in that root. A sibling store's trusted
    extension does not load, and `extension.list` reports the file as
    ignored;
  - `--scope local` writes `<data>/extensions/local/<key>.json` and
    nothing in the root. Two paths to one root (one through a symlink)
    share one local lock. A file whose recorded `root` does not match its
    key is ignored;
  - `validate` never imports installed code (a tree that would
    `process.exit` on import does not stop it).

**Step 5. Reach and source on the list; `diff`; `kb ext trust`** (`01M6RTR8XJZ6JJMBHBYK5X68FW`;
child of G2).

- **Acceptance:**
  - `extension.list` rows carry source, scope, rev, `files`, `reach` and
    `shadowed`;
  - `diff` against the last trusted tree works offline;
  - `kb ext trust` prints the §4 review and prompts;
  - provenance is written on the trust record.

**Step 6. The page: Add, Review & trust, Update, Remove** (`01M6RTRA612RSR06HZC7DQ5S6J`; child
of G2).

- **Acceptance:**
  - a UI test: an untrusted row opens the sheet, which shows reach and
    diff; Trust loads the family with no server restart;
  - "Add from GitHub" installs;
  - screenshots in light and dark.

**Step 7. `update` and `outdated`** (`01M6RTRBA9E2WMJSDPVY9A7YPH`; child of G1).

- **Acceptance:**
  - E2E 3 (§11);
  - the old digest stays trusted;
  - checking out the old lock loads the old tree at once.

**Step 8. Links** (`01M6RTRCD4WSEE50X92YJ2Y5C9`; child of G1).

- `extension.link` and `extension.unlink`, in all three scopes.
- **Acceptance:**
  - linking another store's `.kb/extensions/` in the local or user scope
    makes its extensions appear (trusted ones run);
  - `kb ext link ../other --scope store` is refused;
  - after an edit there and a restart, the new digest is untrusted;
  - a removed folder is one failure row.

**Step 9. Marketplaces** (`01M6RTRE3ARGNQ6JEP4NWQ8FJ8`; child of G3).

- The index schema; `marketplace.add`, `.remove`, `.update` and `.list`.
- Resolving `name[@marketplace]`.
- A marketplace pin is written beside the install.
- **Acceptance:**
  - E2E 2 (§11);
  - an ambiguous name is refused, listing both;
  - an index entry with a ref is refused;
  - `update` of a marketplace install refreshes the marketplace pin.

**Step 10. `remove` and `gc`** (`01M6RTRFDBKDPS8MKVYR9GS61R`; child of G1).

- **Acceptance:**
  - E2E 6 (§11);
  - gc keeps trees that any registered location's lock or the user lock
    names;
  - gc retires provenance trust no lock names, and leaves records without
    provenance alone.

**Step 11. The backdrop surface in the SDK** (`01M6RTRGPNHP3MD7DF6G0EAPE8`; child of G1; after
Backdrop Studio phase 1).

- `BackdropPoint`, `provideBackdrop` and `Knob` in `kb-ext-sdk/page`; the
  backdrop declared-option kind in `kb-ext-sdk`.
- **Acceptance:**
  - a test extension's backdrop passes the shared backdrop contract suite;
  - `gen:ext-sdk` is fresh;
  - the sample's `aurora` loads, and is listed in the Studio gallery.

**Step 12. A running `kb ui` reloads on a lock change** (`01M6RTRHC3PXK31QCQ0M81CDGB`; child of
G1; Q6).

- The server watches the three lock files it composed from (not the linked
  folders), and re-reads closures when one changes.
- **Acceptance:**
  - a CLI `update` while `kb ui` runs shows the new untrusted row with no
    restart;
  - Trust then loads it.

## 11. The fixture and the end-to-end acceptance

**`popemkt/kb-plugins-sample`** is a new public repo with synthetic content
only (MIT):

```
kb-marketplace.json                   name "sample"; entries aurora, hello (path sources)
extensions/hello/hello.ts             declaration "hello"; one read action ext.hello.greet {name} → "hello, <name>"
extensions/aurora/aurora.ts           declaration "aurora"; one backdrop option with knobs speed, hue
extensions/aurora/aurora.page.tsx     provideBackdrop: a canvas-2D drifting gradient
extensions/aurora/aurora/draw.ts      helper
README.md                             what this repo is for
```

**`harness/e2e/plugin-install.ts`** is a script run on demand. It is not in
`verify`, because it uses the network. It runs in two scratch stores, A and
B, with a scratch `KB_DATA` and `KB_HOME`, and stops at the first failure:

1. **Install by GitHub path.** In A, `kb ext install
   github:popemkt/kb-plugins-sample/extensions/hello@main`:
   - the tree is in `<data>/extensions/store/`, read-only;
   - the lock has `original` and `locked` (with a full rev and `files`);
   - `kb ext list` shows `hello` as untrusted, with its digest.
2. **Add the marketplace, then install by name.** In A,
   `kb ext marketplace add github:popemkt/kb-plugins-sample`, then
   `kb ext install aurora`:
   - the lock holds the `sample` pin and `aurora` with
     `original: "aurora@sample"`.

   (Once step 11 lands, `aurora` loads as a backdrop after trust.)
3. **Bump, update, untrusted.** Push a commit to the sample that changes
   `hello.ts`, then in A run `kb ext outdated` and `kb ext update hello`:
   - `outdated` lists `hello`;
   - after `update`, the lock rev and `files` are new, and `hello` is
     untrusted with a digest different from step 4's;
   - `kb ext diff hello` shows the change.

   For a repeatable run, the script pushes the bump to a scratch branch
   and installs from `@<that branch>`.
4. **Trust.**
   - MCP does not list `sandbox.trust`, and the CLI with no TTY answers
     `approval_required`;
   - the script then trusts on a TTY it owns (a pty) and answers `y`;
   - `kb action-invoke ext.hello.greet '{"name":"kb"}'` answers
     `hello, kb`.
5. **A second store reuses the cached install.**
   - In B, `kb ext install` of the same source fetches no blob (the
     adapter's fetch log is empty for it) and needs no trust: `hello` loads
     at once.
   - Then `kb ext install --scope user` of `aurora` in A makes `aurora`
     appear in a fresh store C with no command run there.
6. **Uninstall and gc.**
   - `kb ext remove hello` in A and B, then `kb ext gc`;
   - `hello`'s trees are gone and its provenance trust is retired;
   - `aurora`'s tree, named by the user lock, is kept;
   - the nodes `hello` seeded are still in A.

The builder runs this script at the end of each step from 4 on, as far as
that step reaches. The reviewer runs it again on the PR.
