# One-shot commands and long-running hosts: separating the two modes

Status: **proposal, for the owner, revised 2026-11-12.** The owner approved
the direction (one mode-neutral core, host services in their own modules,
and the rule that a host only accelerates). The rule is stated once, in
[AGENTS.md → Hosts are accelerators](../../AGENTS.md#hosts-are-accelerators),
and today's drift is in `#gap` nodes (`kb backlinks` on the rule lists
them). This record holds the evidence and the plan, and does not restate
the rule. Nothing here changes code.

The revision answers the owner's feedback on the first version: which
topology makes one-shot commands as fast as curl (§5), how a plugin's
background work generalizes (§6), how routines recovers a deletion made
while no host runs (§7), whether the second rule stays a rule (§8), and the
storage-outside-the-store gap (§9). The decisions are in §10.

Date: 2026-11-11, revised 2026-11-12.
Inputs: kb `main` at `d94876c5` (revision: `0caabcc0`); host shared-server
(16 cores, shared with other agents); the installed nightlies
`0.3.1-nightly.20261111044351` and (revision) `0.3.1-nightly.20261111222222`;
Bun 1.4.2.

## 0. The answer in one screen

`kb --version` takes about 370–400 ms, and almost none of it is the command.
On the clean run (§1.2) it splits as follows:

| Phase | `--version` | `get` | Where it goes |
|---|---:|---:|---|
| Bun starts | ~5–19 | ~5–19 | `bun -e 0` |
| Parse the 11 MB `cli.js` | **~225** | **~225** | the whole release bundle, host code included, before any kb line runs |
| Run module bodies of the CLI's static graph | ~145 | ~135 | 1,116 of the bundle's 1,310 modules |
| The command itself | ~11 | ~200 (360 nodes), ~270 (1,209 nodes) | open: rebuild the index, derived sets and action manifest |

Three causes, in order of size:

1. **The release is one bundle.** `bun build` runs without `--splitting`, so
   every `import()` kb already makes lazy (`@kb/server`, `@kb/mcp`, the
   agent and routines host packages) still sits in the same file. Bun defers
   running that code but not parsing it. About 225 ms of every command, 55–60%
   of `--version`, is parsing code the command never runs.
2. **The CLI's static graph includes host-only and rarely used code.** The
   `@kb/runtime` barrel on its own is an 8.1 MB, ~254 ms bundle. It pulls in
   every family's server entry (Vega and d3 for chart figures, gallery-net,
   canvas' tldraw file reader), the QuickJS sandbox engine, both store
   adapters and the git source reader.
3. **Every command opens the whole store.** It rebuilds the DataScript index
   from every node, recomputes the derived sets, and turns every action's
   schema into JSON Schema. This is mode-neutral, but it is about a third of
   `get` and grows with the store.

Splitting the build alone saves only 60–135 ms, because the static graph
behind it is 5.2 MB. The levers work together: split the build, move painters
and engines behind their first use, and open only what a command reads (§4.5).
**`kb get` under 100 ms needs all three, plus a diet in the core's own module
init** (§1.3 has the floor). `--version` can reach it with steps
1–3 alone (an estimate). §10 asks the owner to confirm the target.

**Curl-like speed needs a running host** (§5). Bun itself starts in
14–16 ms here, and the core's imports bring an in-process command to about
100 ms at best. A thin client that hands the command to a warm host over
its Unix socket measured 25–35 ms from a Bun script and 8–10 ms from a
native client, and a warm `kb ui` answered `node.get` in about 8 ms of its
own work. The recommendation is one `kb` executable whose entry module
forwards to the root's host when one runs and imports the in-process CLI
when none does, so the host stays an accelerator.

**Background work is a job** (§6): an idempotent action whose state is in
the store, named by a `#job` node whose schedule and placement are data.
Any process runs it: the host's scheduler, `kb jobs run --due` from cron,
or one call. A host adds only triggers (a write, a webhook, a watcher),
and nothing is server-only for correctness.

Rule audit (§3): two features keep truth only in a running process. The
first is routines' Google Calendar sync: the push queue, deletion detection,
the cursor, the last-pushed state and the mass-deletion hold. The second is
the sidebar agent's conversations, which already have a gap. One-time OAuth
connect attempts are a minor case. Backups, days, the store watcher,
subscriptions, trust, locations, governance, docs and the transaction tail
already comply.

## 1. Where the startup time goes

### 1.1 Method

Every measurement runs a scratch `KB_HOME`, `KB_DATA` and root (`kb init`,
360 nodes, 160 KB). Section 1.4 repeats the run on a copy of this repository's
own `.kb` (1,209 nodes, 725 KB).

- **A release-shaped bundle.** `bun build --target=bun` builds it exactly as
  `bin/release-bundle` and `nix/package.nix` do. Its entry is a stand-in for
  `main.ts` that `import()`s `cli.ts` as `main.ts` does and stamps three
  times: before the import, after it, and after `main()` returns. The stand-in
  skips the launch-flag check, because the check refuses `--cpu-prof` (its
  arguments must match `kb-launch-flags.txt` exactly). Its wall times match
  the installed nightly to within about 10% (368 ms against 380 ms for
  `--version`).
- **A parse-only variant.** The same bundle exits before its first statement
  runs.
- **Per-package floors.** Each package is bundled on its own and run, with
  the minimum of 10 runs taken.
- **CPU profiles.** `bun --cpu-prof` profiles were mapped back to bundle
  modules through the module header comments, and the metafile gives bytes
  and import chains.
- **Timing and load.** Every time in this record is the minimum of 8–12 runs
  taken at load average 3–6. Mid-session the host's load reached 14–19, and
  the same runs then took 2–3 times as long. Profile milliseconds read about
  1.3× high, so profiles are used for shares, never for budgets.

### 1.2 Phases (min of 12, scratch store)

| Run | ms |
|---|---:|
| `bun -e 0` | 19 (5–6 when measured alone) |
| single bundle, parse only | 243 |
| `--splitting` build, parse only | 20 |
| single bundle `--version` / nightly `kb --version` | 380 / 368 |
| `--splitting` build `--version` | 319 |
| single bundle `get` / nightly `kb get` | 602 / 557 |
| `--splitting` build `get` | 466 |
| single bundle `search` / nightly `kb search` | 539 / 561 |
| in-process: import of `cli.ts`, then `main()`, for `--version` | 145, then 11 |
| the same for `get` | 132, then 198 |
| the same for `search` | 131, then 205 |

### 1.3 By package

**What the bundle holds.** It is 10.98 MB in 1,310 modules. By bytes the
largest packages are:

| Package | MB |
|---|---:|
| `@kb/gallery-net` | 1.86 |
| `@anthropic-ai/claude-agent-sdk` | 1.52 |
| QuickJS (single-file wasm) | 1.30 |
| datascript | 0.76 |
| effect | 0.70 |
| zod | 0.66 |
| vega-lite | 0.56 |
| ajv | 0.19 |
| `@kb/canvas` | 0.18 |
| `@kb/model` | 0.18 |
| `@kb/operations` | 0.16 |
| `@modelcontextprotocol/sdk` | 0.12 |

Vega's other packages and d3 add about 0.9 MB.

**What each package costs.** Each package below was bundled on its own and
run (min of 10). Every figure includes Bun's ~5 ms start and the package's own
dependencies, so read the marginal cost against the effect + model baseline:

| Package | Bundle | ms |
|---|---:|---:|
| effect (`Effect`, `Schema`) | 0.15 MB | 22 |
| commander | 0.08 MB | 23 |
| zod (tree-shaken to `z.object`; the bundle carries 0.66 MB) | 0.09 MB | 20 |
| effect + `@kb/model` | 0.47 MB | 37–43 |
| `@kb/query` (datascript) | 1.20 MB | 61 |
| `@kb/operations` | 0.84 MB | 66 |
| `@kb/store-jsonl` | 0.54 MB | 68 |
| `@kb/store-sqlite` | 0.51 MB | 67 |
| `@kb/sandbox-quickjs` | 1.91 MB | 69 |
| `@kb/gallery-net` | 2.38 MB | 63 |
| `@kb/contracts` | 0.95 MB | 77 |
| `@kb/bundled` (every family's declaration and the seed fold) | 0.76 MB | 85 |
| effect + model + query + store-jsonl | 1.60 MB | 86 |
| `@kb/chart-vega` | 2.13 MB | 116 |
| **`@kb/runtime` (its barrel)** | **8.1 MB** | **254** |

**Shares of the init phase.** By profile, the init phase splits as effect
~20%, zod ~15% (action schemas, mode-neutral), datascript ~8%, Vega and d3
~7%, and `@kb/views` ~5%. The rest is spread thin.

**Node built-ins.** Bun hoists every `import … from "node:…"` in a bundle
to its top, so the server's `node:net` and `node:zlib`, and the agent SDK's
`node:readline` and `node:async_hooks`, load for every command. Timed
directly, each costs 1–9 ms over a bare Bun, so they matter less than the
profile suggests. `cli/src/command.ts` imports `readline/promises` itself.

**The floor.** effect, `@kb/model`, `@kb/query` and the JSONL store alone
already take ~86 ms. A `get` under 100 ms therefore cannot load datascript
and the registry's whole schema set as it does today (§4.5, steps 7–8).

### 1.4 The command phase

This is the `get` profile on the repository's own store (1,209 nodes). Its
milliseconds are inflated, and its shares hold:

| Work | Profiled ms | Share of `main()` |
|---|---:|---:|
| index build (`DatascriptIndex`, `#buildDatoms`, `nodeToDatoms`): the whole index from every node, on every run | ~120 | ~30% |
| derived sets (`setDerived`, `rebuild`, `nodeRefs`) | ~60 | ~15% |
| the action table and manifest (`actionTable` → `actionToManifestEntry`, which builds JSON Schema from every action's schema), though `get` invokes one action | ~30 | ~8% |

The rest is opening and migrating the store, checking the system seed,
loading the families and passing governance. The phase grows with the store:
198 ms at 360 nodes, 270 ms at 1,209.

## 2. The leaks

**Already lazy.** `cli.ts` already loads these through `import()`:

- `@kb/server` (for `kb ui` and `kb open`) and `@kb/mcp`;
- through `host-plugins.ts`: `@kb/agent-claude`, `@kb/agent-openai`,
  `@kb/routines-host` and `@kb/routines-gcal`, so neither the Claude agent
  SDK nor the MCP SDK and ajv runs in a one-shot command.

**Static chains from `packages/app/cli/src/cli.ts`.** These are evaluated by
every command:

| Reaches | Through |
|---|---|
| every family's server entry: `@kb/chart-vega` (vega-lite, vega-*, d3-*), `@kb/gallery-net`, `@kb/ext-canvas` (its `bun:sqlite` tldraw reader), `@kb/locations-fs`, `@kb/graph`, … | `@kb/runtime` → `extension-loader.ts` → `bundled.ts` (`BUNDLED_EXTENSIONS` is a module-level constant that builds every plugin) |
| `@kb/sandbox-quickjs` → `@jitl/quickjs-singlefile-browser-release-sync` (1.3 MB, the wasm inlined); `@kb/source-git` | `@kb/runtime` → `layers.ts` |
| `@kb/store-sqlite`, even for a JSONL store | `@kb/runtime` → `store-selection.ts` |
| every family's declaration, `@kb/agent` and `@kb/routines` (rrule) included | `@kb/bundled` |

The first three rows cross one barrel, `@kb/runtime`, which both modes
import whole. The CLI cannot use a little of it.

**The build undoes the lazy edges.** Both `bin/release-bundle` and
`nix/package.nix` run the same
`bun build packages/app/cli/src/main.ts --target=bun` without
`--splitting`, and ship one `cli.js`. In a single-file Bun build an
`import()` becomes an `__esm` initializer in that file, so evaluation waits
but parsing does not. The 1.5 MB agent SDK, the MCP SDK, ajv and the server
are parsed by every `kb get`.

The build line is written twice, which is a mirror: a fix to one would
silently miss the other. With `--splitting` the entry parses in ~20 ms. The
static graph behind it then becomes the cost, which is why splitting is
necessary but not enough.

## 3. Audit: truth that lives only in a running process

The audit searched for timers and loops (`Effect.forever`, `forkScoped`,
`sleep`, `setInterval`, `Schedule`), module- or host-scoped maps consulted as
authority, watchers, debounced or write-behind paths, and features that only
`kb ui` composes. The rule is in
[AGENTS.md](../../AGENTS.md#hosts-are-accelerators).

### Violations

No routine fires on a local timer today. Nothing in a process computes
"what is due", so the owner's first example already holds. The violation
is the sync engine that projects routines to Google.

**Routines → Google Calendar sync** (`@kb/routines-host`, `engine.ts`).
**Violates.**

- The truth the host holds is the push queue, with each item's attempts and
  due time; `seen`, the deletion baseline, which is empty at every start;
  `applied`, the last pushed; the change cursor `revision`; and `releases`,
  the mass-deletion hold. A 1 s `Effect.forever` loop drives it.
- The family is hosted by `kb ui` alone (`HOSTED_FAMILIES`), so the CLI and
  `kb mcp` cannot reach even `preview` or `status`.
- With only one-shot commands, nothing is ever pushed.
- With a host that restarts, the losses are:
  - a routine deleted while no host ran is never retired in Google;
  - every routine is put again from scratch;
  - the give-up after ten attempts and any granted release are lost.
- This was a deliberate trade-off in
  [the routines design](2026-11-02-kb-routines-gcal.md) ("a deletion made
  while it is stopped cannot be recovered"; "retry counters reset on process
  restart"). **The new rule reverses that decision**, so the owner should
  confirm it (§10, decision 4).
- Fix: `ext.routines.sync` becomes a job (§6) that any process can run
  one-shot: it projects the live routines, pushes what is owed, and exits.
  - Each routine's last-pushed signature, the attempts, and the held
    deletions with their release signatures are props on the routine and
    calendar nodes.
  - Deletions come from a sync ledger on the calendar node, the set of
    units kb has pushed to that Google calendar (§7). The first version of
    this record read them from the transaction tail since a cursor, which
    fails once compaction passes the cursor; the ledger needs no cursor.
  - A write to a routine only makes the job due sooner (a reaction with
    today's settle window), so the host is only a trigger.
  - Trust (`host.trusted`) gates the one-shot path as it gates the host, and
    the Google adapter stays a lazy import.

**Sidebar agent conversations** (`@kb/agent`, `bridge.ts`). **Violates;
already a gap** (`01M40WSVNKVH3ZY8QE0GN5DY8X`). The transcript, the
provider's resume handle and pending approvals live in a `Map`. A restart or
a closed connection loses them. The fix the gap already names, a thread node
whose messages are nodes, is the rule's fix. This change links that gap to
the rule.

**OAuth connect attempts** (`@kb/routines-host`, `connections.ts`).
**Minor violation.** A `connecting` map with a 10-minute TTL ties `connect`
and `finish` to one host process. The resulting refresh token is stored
durably. Fix: make `state` verifiable without the process: signed with a
host secret, or a pending attempt written to the store.

### Compliant or accelerator-only

| Feature | Verdict | Why |
|---|---|---|
| Backups and retention (`runtime/backups.ts`) | complies | taken by an explicit action; pruned at write time under the cross-process lock (E2a/E2c); no scheduler |
| Transaction tail compaction (`store-jsonl/tx-tail.ts`) | complies | compacts at append; the store mark detects a tail behind the store |
| Day rollover (`days/capture.ts`, `today.ts`) | complies | `storeToday` decides the day when read or captured; the plugin loads on both hosts; no timer |
| Store watcher (`server.ts`, `fingerprintChanges`) | accelerator | feeds `reloadEffect`, a no-op on a known fingerprint; every one-shot command reads fresh |
| Extension change signal (`runtime/extension-changes.ts`) | accelerator | registry and family caches are keyed by the lock fingerprint, not by the signal |
| Live push (`SubscriptionHub`) | accelerator | per-connection transport only |
| Saved queries in the UI (`saved-queries.ts`) | accelerator | a projection of `.kb/queries/*.edn` |
| Screens (`ui.*`, `.kb/ui.json`) | complies | tab state is the UI's; with no live server the answer is "no tab", and `servingUi` checks the server is live |
| Trust, locations, governance | complies | file- or node-backed under the lock |
| Docs materialization | complies | explicit `docs.materialize` and `docs.check`; the commit gate runs the check |
| Google access-token cache (`routines-gcal/oauth.ts`) | accelerator | derived again from the stored refresh token |
| Reaction failure health (`operations/reactions.ts`) | accelerator | diagnostics, rebuilt per process |

Not found: no `setInterval`, cron or `Schedule` at feature level, and no
write-behind buffer on either store's write path.

## 4. The split

### 4.1 Module boundaries

Three groups, by which mode runs them:

**The mode-neutral core.** Both modes run it.

- The domain packages: `@kb/model`, `@kb/query`, `@kb/views` and
  `@kb/plugin`.
- The contracts: `@kb/contracts`, `@kb/ext-sdk`, `@kb/extension-source`, and
  the `@kb/sandbox` port.
- `@kb/operations`.
- The store adapters and file infrastructure.
- `@kb/runtime`, reduced to opening a root, selecting the store, the
  registry and families, backups, migrations and the governance deployment.
- Each family's shared and server entries, which hold actions, guards,
  derived data, seeds and migrations.

**Host-only code.** Only `kb ui` and `kb mcp` run it.

- `@kb/server`: the HTTP and WebSocket listener, `SubscriptionHub`, channels,
  ingesting the store-changes stream, saved-query and extension-change
  watching, and the UI assets.
- `@kb/mcp`, with the MCP SDK and ajv.
- The agent runtime adapters.
- The routines push loop, once it is only a trigger (§3).
- The runtime modules only a host uses (the extension-change watcher today)
  move out of the `@kb/runtime` barrel into `@kb/server`, so the barrel is
  the core and nothing else.

**Lazy at the point of use.** These are needed by one-shot commands, but
rarely. Each owner loads its heavy dependency the first time it is needed, so
no new mechanism is added:

- a chart figure loads Vega;
- gallery-net loads its network and image code;
- canvas loads its tldraw file reader;
- the QuickJS engine loads its wasm on its first run;
- the SQLite adapter loads only when store selection picks it;
- the git source reader loads on its first fetch.

A family's server entry stays one plugin. Only what it paints with moves
behind `import()`, which matches DESIGN.md's rule that "a painter belongs to
the view that paints with it".

### 4.2 Entry points

There stays **one process entry**, `packages/app/cli/src/main.ts`, and one
launcher, so the [runtime launch contract](../../DESIGN.md#runtime-launch-contract)
and the "Minimal valid entrypoints" rule are unchanged.

- `main.ts` answers `--version` before it imports the runtime. The version
  comes from the SDK module alone. `help` stays in `cli.ts`, whose command
  table is the one place commands are declared. It gets cheap once that
  table stops importing the runtime eagerly (steps 4–6), not through a
  second copy of the table.
- `cli.ts` keeps the `kb ui`, `kb mcp` and `kb open` handlers behind
  `import()`, as it does today.
- The build gains `--splitting`, so each lazy edge is its own file under
  `lib/kb/` that a one-shot command never parses.
- The two `bun build` lines become one script that both
  `bin/release-bundle` and `nix/package.nix` call.
- The `KB startup contract` suite runs over the chunked layout. Its
  hostile-cwd property must still hold when chunks resolve beside `cli.js`.

A second binary or a second entry file buys nothing over this. Splitting
already gives the host graph its own chunks, and a second entry would be a
second launch path to keep under the contract. What does change, per §5, is
the first thing `main.ts` does: it is the launcher, and it forwards the
command to the root's host when one runs, before it imports `cli.ts`.

### 4.3 Keeping accelerated work correct without a host

Every host behaviour is a one-shot computation run sooner. The pattern has
three parts:

- the host runs **the same registry action** a person could run one-shot;
- state that must outlive a call is **in the store**, written under its
  lock;
- a cache is **keyed by the store fingerprint and the code version**, so
  deleting it costs only time.

Applied:

- **Push and live views.** A one-shot command has no viewers, so nothing is
  lost without a host. A viewer that connects later reads the store.
- **Watch.** The watcher only saves a reload. Each one-shot command reloads
  at open, and `reloadEffect` already treats a fingerprint it has seen as a
  no-op.
- **Routines.** As fixed in §3: `ext.routines.sync` is a job (§6), the
  host only triggers it, and the ledger, signatures, attempts and holds are
  props (§7).
- **Day rollover and backup retention.** Both already comply: decided when
  read, and pruned at write time under the lock.
- **Optionally, the CLI's own speed.** An index or manifest snapshot keyed
  by the store fingerprint would make `get` cheap without a host and stay
  inside the rule. Building lazily (§4.5, step 7) comes first, because it
  needs no cache at all.

### 4.4 Mechanical enforcement

Items 1–3 enforce the module boundary that the first version stated as a
second rule, and §8 explains why it is no longer one.

1. **One lazy fence, keyed by entry.** `UI_LAZY_ONLY` and `UI_LAZY_DEPTH`
   (`harness/src/constraints.ts`, applied by `ui-lazy-fence.test.ts`) become
   a table of fences: the UI's row as it is today, and a CLI row.
   - The CLI row's entry is `packages/app/cli/src/main.ts` over the backend
     import graph (`harness/src/import-graph.ts`). With §5's launcher it
     has two depths: the launcher's own graph (the presence reader and the
     socket client only) and, behind its one `import()`, the command path.
   - Its host-only specifiers are `@kb/server`, `@kb/mcp`,
     `@kb/routines-host`, `@kb/routines-gcal`, `@kb/agent-claude`,
     `@kb/agent-openai`, `@modelcontextprotocol/sdk`,
     `@anthropic-ai/claude-agent-sdk`, `vega*` and `@jitl/quickjs-*`, at
     depth 1.
   - Existing breaches are listed under the gap, as `EXTENSION_ROOT_BREACHES`
     lists its breaches, so the fence lands green and shrinks.
   - This is the existing mechanism with a second row, not a second fence.
     The "Lazy 3D chunk" rule becomes its UI row.
2. **A static-closure budget.** A harness test builds the CLI with
   `--splitting --metafile` and holds the entry chunk's bytes and module
   count to a committed baseline that may only fall. The ratchet lane is the
   precedent. It is deterministic and does not flake.
3. **A wall-clock startup budget, as a sensor.** Startup time is reported
   and never a threshold, as the testing doctrine does with coverage. In
   this record's own runs the same command swung 2–3× with load, so a
   wall-clock gate would flake.
4. **Hostless correctness** (the gate of the truth rule). A property in
   `extensionContract` (`@kb/test-kit`): for a family with a host loop, its
   catch-up action run one-shot after any sequence of writes, deletions
   included, reaches the store state and remote effects that a host running
   throughout reaches. Of the hosted families, only the agent runs under
   `extensionContract` today (`cli/tests/extension-contract.test.ts`), so
   routines joins the suite first. For routines, the memory Calendar fake already
   satisfies `calendarContract`. Until the property exists, the rule's
   enforcement is `prose`.

### 4.5 Migration, in small PRs, in order

Each PR restructures first, in a commit that preserves behaviour, and adds
behaviour in a separate commit (Rule 1).

| # | PR | Effect |
|---|---|---|
| 0 | This record, the rule, and the gaps | — |
| 1 | Generalize the UI lazy fence into a table, with the UI row only, preserving behaviour. Then add the CLI row with today's breaches listed, and the static-closure baseline. | the split cannot regress from here |
| 2 | One build script with `--splitting`, called by `bin/release-bundle` and `nix/package.nix`; the chunked `lib/kb/` layout; the startup contract over it | about −225 ms of parse moves to chunks that are parsed only when imported (−60 to −135 ms wall today) |
| 3 | `--version` answered in `main.ts` without the runtime | `--version` drops to an estimated ~30–50 ms |
| 4 | One PR per family: painters behind first use (chart-vega, gallery-net, canvas' tldraw reader); each removes its breach row | Vega and d3 (~70 ms marginal) and gallery-net leave the eager graph |
| 5 | Engines and adapters behind first use: QuickJS, store-sqlite at selection, source-git | ~1.3 MB of wasm and both adapters leave the eager graph |
| 6 | Split the `@kb/runtime` barrel: host-only modules move to `@kb/server`; the barrel is the core | the CLI fence holds with no breach rows |
| 7 | Open only what a command reads: build manifest JSON Schemas only for `kb.manifest` and MCP's `tools/list`; build the index on first datalog use (`get`, `children` and `backlinks` read the node table and mentions); compute derived sets on demand | the ~200–270 ms command phase becomes mostly proportional to what is read |
| 8 | The core's own init diet, measured against the closure budget: what `@kb/contracts` and `@kb/bundled` (the seed fold) do at module load | the last step toward `get` < 100 ms |
| 9 | Routines sync as a job (§6) with the sync ledger, signatures, attempts and holds in the store (§7); the host loop becomes a trigger. Then the OAuth connect state. Then agent threads as nodes (the existing gap). | the truth rule's violations close |
| 10 | The hostless property in `extensionContract` | the truth rule moves from `prose` to `ci` |
| 11 | Jobs (§6): the `#job` tag and fields, `job: true` on an action definition, `jobs.list` and `jobs.run`, `kb jobs`, and the host's scheduler as a trigger. Lands before step 9, whose sync is its first job. | background work needs no host |
| 12 | The launcher (§5): `main.ts` reads the root's presence and forwards argv over the host's socket, `POST /api/cli` runs the command table on the CLI's wire, and a dispatch contract test runs the same commands both ways | with a host, a command takes 25–35 ms |

Steps 1–6 are the mode split, steps 7–8 are the speed target without a host,
step 12 is the speed with one, and steps 9–11 are the rule. The
groups are independent after step 1, except that step 12 needs every
family's actions to load in-process (§6.4) and so follows step 11.

## 5. Topology: what makes a one-shot command fast

The owner asked for one-shot commands as fast as curl, in single-digit to
low tens of milliseconds, and whether separate apps, modules or topologies
are the answer.

### 5.1 Measured

These were measured on shared-server on 2026-11-12, at load average 1–3,
taking the minimum and median of 25–40 runs. The scripts are described in
§11.

| Path | min ms | median ms |
|---|---:|---:|
| spawning a process (`true`) | 1.2 | 1.5 |
| `bun -e 0`, not niced | 14.1 | 16.1 |
| `bun build --compile` of an empty script (an 81 MB binary) | 14.9 | 16.0 |
| Bun thin client → warm Bun server, HTTP over a Unix socket (`fetch` with `unix`) | 25.1 | 28.6 |
| the same client with raw `Bun.connect` | 24.2–26.2 | ~28 |
| the same client compiled, with or without `--bytecode` | 25.0–25.6 | ~28.5 |
| C client → warm Bun server | 0.4 | 0.5 |
| `curl --unix-socket` → warm Bun server | 5.9 | 7.3 |
| the transport alone, 2,000 requests in one warm Bun process | 0.04 per request | — |
| `kb --version`, the installed release | 418 | 454 |
| `kb get`, one-shot, 360-node scratch store | 591 | 674 |
| `kb get`, one-shot, this repository's store (1,218 nodes) | 731 | 749 |
| warm `kb ui --socket`, `node.get` from the C client, scratch store | 7.7 | 9.1 |
| the same, this repository's store | 8.5 | 9.5 |
| the same, from curl | 5.7–13.6 | 7–15 |
| the same, from the Bun thin client (script or compiled) | 32.4–34.3 | 36–40 |

What the numbers say:

- **Bun's own start is 14–16 ms on this host.** §1's 5–6 ms was a quieter
  moment, so read 14–19 ms as the floor here. Compiling does not lower it:
  `--compile` embeds the same runtime, and `--bytecode` saves nothing on a
  one-module script.
- **A warm host does a `node.get` in about 7–8 ms of its own work**: the C
  client's time minus its 0.5 ms transport. Its answers were fresh. A node
  that a one-shot `kb add` made, and then one that a `kb rm` removed a
  moment later, were both seen correctly on the next call through the
  socket. That is by design: `serverInvoke` (`@kb/server`, `invoke.ts`)
  runs `reloadEffect` before every invocation, so a write another process
  made is never missed. The ~8 ms includes that check.
- **kb already has the pieces.** `kb ui --socket` listens on a Unix socket
  only its owner can connect to (mode 0600). `.kb/ui.json`, which the CLI
  already reads for screens (`servingUi` in `@kb/workspace-fs`), says which
  host serves a root. `POST /api/action` invokes an action.

**The in-process path's baseline.** The module builder's PR 2 on
popemkt/kb measured it (commit `b2c2a6d8`, gap
`01M7896YXTKZJVQFW9G3GF0144`, both on that branch and not yet on `main`
when this was written). It measured
the CLI dispatch entry's static closure: `packages/app/cli/src/cli.ts` at
depth 1, following shared output chunks through the esbuild metafile. It is
**7,169,864 bytes in 1,107 modules** today. Four breaches are pulled in
eagerly: Vega (three) and QuickJS (one). This agrees with §1: 1,116 modules
run for `--version`. So a split build alone still leaves about 7.2 MB on the
command path. Option A's ~100 ms assumes steps 4–8 bring that closure down
to the core (§1.3's ~86 ms floor) before the command reads anything. The
launcher of option B has to stay tiny: the presence reader and the socket
client, a few kilobytes, with the 7.2 MB behind its one `import()`. The
closure budget of §4.4 (item 2) uses this figure as its first baseline.
When that PR lands, its gap and this record's "no fence or budget" gap
(`01M75MA3QTAABRAE6N0069CB8R`) should become one.

Three sizes in this record measure three different closures:

- **5.2 MB (§0):** the static graph behind this record's own `--splitting`
  build of `main.ts`, at `d94876c5`;
- **7.2 MB:** `cli.ts` at depth 1, following shared chunks, on a later
  `main`;
- **8.1 MB (§1.3):** the `@kb/runtime` barrel bundled alone, where nothing
  is shaken out by the CLI's use.

They agree on what matters here: the command path is megabytes, and the
launcher has to be kilobytes.

### 5.2 The options

| Option | One-shot time | Cost |
|---|---|---|
| **A. In-process only, made lazy** (steps 1–8) | about 100 ms at best: Bun's start plus the ~86 ms core floor of §1.3, plus whatever the command reads, once the command path shrinks from today's 7.2 MB, 1,107-module closure | none beyond the migration; never curl-like |
| **B. Bun launcher, plus an optional host over its socket**, falling back to A | 25–35 ms with a host; A without one | one forwarding module and one host route |
| **C. Native launcher plus host**, falling back to A | 8–10 ms with a host, dominated by the host's own work | a second toolchain (C, Zig or Rust) built for macOS and Linux in `nix/package.nix` and `bin/release-bundle`, and the launcher's few rules written a second time |
| **D. Separate apps**: a `kb` client package and a `kbd` daemon package | as B | two packages to version together, where skew is the main failure; it buys nothing over one package |

The same pattern appears in git's fsmonitor daemon, docker's client and
daemon, Gradle's daemon, and language servers. The client is thin, the
daemon is warm, and the daemon is never the only way to get an answer.

### 5.3 Recommendation: B

Use **one package and one topology, split into modules.** A store has any
number of processes, and at most one host per root makes them faster.

- **Separate apps:** no. Option D adds version skew and buys nothing.
- **Separate topologies:** no. "With a host" and "without one" are the same
  topology, with or without the accelerator.
- **Separate modules:** yes. They are laid out below.

| Group | What | Runs in |
|---|---|---|
| **Core library** | the domain packages, contracts, `@kb/operations`, the store adapters, `@kb/runtime` reduced to the core (§4.1), and every family's shared and server entries | both modes |
| **Command table** | `cli.ts`: argv → action calls → text, the one place commands are declared | the in-process path, and the host for a forwarded command |
| **Thin hosts** | `@kb/server` (HTTP, WebSocket and socket listeners, presence, the job scheduler and webhook triggers of §6), and `@kb/mcp` (stdio) | a host only |
| **Entry point** | `main.ts`, the launcher: `--version`, the presence read, then forward or `import("./cli.ts")` | every `kb` process |

**The wire.**

- **Request.** The launcher sends `POST /api/cli` on the host's Unix socket
  with `{argv, cwd, root, version, env}`. `env` carries only what the CLI
  reads: `KB_VIA`, `KB_HOME`, `KB_DATA`, `KB_CACHE`. The reply is
  `{stdout, stderr, exit}`, streamed for long output.
- **Running it.** The host runs the same command table in-process, on the
  CLI's own wire (`ACTION_INVOKE_WIRE` in `cli/src/command.ts`: actor
  `cli`, and the JSON envelope carries no approval), so a command forwarded
  this way is decided exactly as it would be locally. The CLI approves
  through a confirmation on the controlling terminal (`invokeCliEffect`),
  which a forwarded command has no access to. A command that would ask is
  therefore one of those that run locally (below).
  `POST /api/action` stays what it is today, a local program's wire with no
  approval and actor `agent`, so the launcher does not reuse it.
- **Who may call.** The route is admitted on the owner-only socket only,
  checking the peer's uid where the platform gives it. It is never offered
  over TCP, where kb cannot tell who the caller is.
- **Commands that always run locally:**
  - commands that read stdin or prompt (`procedure --run` without `--yes`,
    `--outline -`, and any call whose action asks for approval at the
    terminal);
  - the host commands (`kb ui`, `kb mcp`, `kb open`) and `kb init`;
  - a `--root` other than the host's.
- **Skew and stale presence.** The request names the root and the build
  version, and a host that serves another root or another build refuses
  it. The launcher then runs the command locally. A stale `ui.json` costs
  one failed connect (under 1 ms) or one refusal (about 8 ms). It never
  costs `servingUi`'s 500 ms probe timeout, because the forwarded request
  is the probe.
- **Parity is the rule.** A command gives the same answer whichever way it
  runs. That requires every family's actions to load in-process, including
  the agent's and routines', so `HOSTED_FAMILIES` shrinks to families with
  host-only triggers or channels (§6.4). A dispatch contract test runs a
  set of CLI commands both ways and compares their output and their store
  writes.
- **Who starts the host.** The host is started explicitly, as today: `kb ui`
  (headless with `--no-open`), or a login service (a launchd agent or a
  systemd user unit) for the roots a person uses most. The CLI does not
  spawn one by itself (§10, decision 3).

**Expected.** With a host running, a command takes 25–35 ms: Bun's ~15 ms,
reading `ui.json`, one round trip, and the host's ~8 ms. Without a host, it
takes the in-process time, about 100 ms once steps 2–8 land. A native
launcher (C) could later replace only the launcher half of `main.ts` and
speak the same `/api/cli`, for 8–10 ms. It is a drop-in, not a new topology,
and the owner may choose it later (§10, decision 2).

## 6. Plugin background work: jobs

The owner asked how this generalizes to other plugins. Should a plugin
declare that it relies on work outside the lifecycle hooks, such as a sync
worker, and is that server-only?

### 6.1 What kb already has

- **Actions** (`ActionPoint`): every verb, on every surface, through the
  invoke core.
- **Procedures** (`ProcedurePoint`, DESIGN.md → Procedures): data over
  actions. A step's done-ness is read from the store, never recorded.
- **Transaction reactions** (`tx/after`): a callback after a commit. They are
  at most once, lost when the process exits, with no replay or durable
  cursor (DESIGN.md → Transaction reactions).
- **`via`**: a caller's label for the work a call belongs to. DESIGN.md
  already names "a job" as one such caller.
- **Events (routines)**: a person's RRULE events. This family is off by
  default, and its engine refuses sub-daily rules.
- **Gap `01M6EKEE8P040W6592ZZ3HDVGC`**: "routine background runner placement
  has no general job contract", deferred "until another family needs it".
  Inbound Google Calendar
  (its design is kb#194, `docs/research/2026-11-12-gcal-inbound.md`) is that family, so this
  section is the contract the gap waits for.

### 6.2 Does an existing concept already cover it? (Rule 1)

- **Routines or events: no.** A job's cadence belongs to a machine, not to
  a person's plan. Core cannot depend on a family that is off by default.
  The RRULE engine refuses `FREQ=MINUTELY` and `HOURLY`. A sync job drawn
  on the person's calendar would be noise.
- **Procedures: the shape, not the point.** Both are data over actions
  with state read from the store. A procedure, though, is walked by a
  person, in order, with decisions, while a job runs unattended. Jobs reuse
  the pattern, "a step names an action, and its state is read, not
  recorded", but not the point.
- **Reactions: the accelerator.** A reaction can make a job due sooner, but
  it never does the job's work alone, because it is lost on exit.

A job is therefore new, but it is built only from parts kb already has: an
action, a node, and a `via`.

### 6.3 The mechanism: jobs are actions, schedules are data

The suggested direction holds, with two refinements: the schedule is a
node, and placement is data too.

- **A job is an action** whose definition says `job: true`. That declares
  four things:
  - it is an idempotent catch-up: it reads what is owed and its cursor from
    the store, does the work, and writes results and cursor under the lock;
  - it takes no input, or a fixed input held on the job node;
  - it needs no person's approval, and an action that requires approval is
    refused as a job;
  - a run with nothing to do commits nothing.
- **A schedule is a node.** Core seeds the `#job` tag with these fields:

  | Field | Meaning | Who writes it |
  |---|---|---|
  | `runs` | the action id | the family, or the person on their own job |
  | `every` | an ISO 8601 duration, such as `PT10M` | the person may change it |
  | `runs on` | host names (text, many) | the person may change it |
  | `paused` | a checkbox | the person may change it |
  | `last error`, `failures`, `retry after` | the job's own state, managed, written only when it changes | the runner |

  A family ships its job as a node in its own seed, owned by the family.
  The seeded `every` is the default schedule, and a person may change it,
  as any setting on a seeded node
  ([AGENTS.md → Data-plane freedom](../../AGENTS.md#data-plane-freedom)).
  A person may also make their own `#job` over any action that meets the
  contract, for example `docs.materialize` every hour.
- **Any process runs due jobs**, always through one core action,
  `jobs.run {job?, due?}`:
  1. the host's scheduler, a timer in `@kb/server` that invokes
     `jobs.run {due: true}`;
  2. `kb jobs run --due`, from cron, a launchd agent or a systemd timer;
  3. `kb jobs run <job>`, or the action itself, one-shot.

  Each run is made as actor `{kind: "job", id}` with `via: "job:<job id>"`,
  on a wire that carries no approval. `kb jobs list` shows each job, where
  it runs, and its state.
- **`every` bounds staleness; it never decides correctness.** A runner
  remembers its last attempt only as an accelerator: the host keeps it in
  memory, and `kb jobs run --due` keeps it in `KB_CACHE`. Losing it costs one
  extra idempotent run. Nothing records a timestamp in the store on a run
  that did nothing, so a git-tracked store does not churn every ten minutes.
- **Placement is data.** A job runs only on the machines `runs on` names.
  Anywhere else, `kb jobs list` says where it runs. This replaces the
  routines prose "run sync from one server only". There are no leases: on
  one machine, the store's lock and idempotence serialize two runners, and
  across machines, `runs on` keeps a job with remote effects to one place.
- **Trust.** Jobs run only in roots the machine trusts (`host.trusted`), as
  routines' sync is gated today. The trust sheet lists the `#job` nodes a
  family seeds: what each runs and how often. **That is how a plugin
  declares that it relies on work outside the lifecycle hooks.** It is
  data the person approves, not a worker the plugin owns.
- **Failure.** Backoff state is on the job node and is written when it
  changes, so a restart no longer resets retry counters. That reverses
  another 2026-11-04 trade-off. An authentication failure pauses the job,
  with the reason in `last error`.

### 6.4 What "server-only" can mean: triggers, never jobs

A host adds **triggers**: ways to make a job due sooner. A trigger carries
no data and decides nothing.

| Trigger | Needs | Without it |
|---|---|---|
| `every`, through any runner | any process | — |
| a write that makes work owed (a `tx/after` reaction marks the job due, with routines' 5 s settle and 30 s maximum) | the committing process | the next `every` |
| a push notification (Google's `events.watch` POSTs to an HTTPS URL with a valid certificate; the POST has no body, only a change signal, and the channel must be renewed by hand) | a host with a public HTTPS listener | the next `every` |
| a file watch | a host | the next run |

So "server-only" names a trigger, never a job. A webhook receiver is a pure
accelerator with polling as its fallback, which matches Google's own advice
that notifications can be dropped. A family contributes its webhook route
from its host half (`@kb/routines-host`), and the route calls
`jobs.run {job}`. Its actions and jobs load in every process, and only its
triggers and channels are host code. `HOSTED_FAMILIES` then means "families
with host-only triggers or channels" (§5.3, parity).

### 6.5 Applied

| Job | `runs` | Default `every` | Triggers |
|---|---|---|---|
| routines push | `ext.routines.sync` | `PT15M` | a write to a routine, an occurrence or a calendar (settled) |
| inbound Google Calendar | `ext.routines.import` | `PT10M` | Google push, later and optional |
| (a person's own) | `docs.materialize` | as they choose | — |

## 7. Routines: a deletion made while no host runs

**This reverses the owner's acceptance of 2026-11-04.** The routines design
accepted that "a deletion made while it is stopped cannot be recovered" and
asked the person to end a routine through its until field before deleting
it offline. Under the truth rule, the next sync recovers it.

The options:

- **Read the transaction tail since a cursor** (the first version of this
  record). It fails once compaction passes the cursor, and then it can only
  report "unknown". That is not acceptable for the truth.
- **Tombstones.** Every deleted node would leave a record behind. That is
  core-wide, grows forever, and copies what the tail already says, which is
  a mirror (Rule 1), all for one family's need.
- **A sync ledger in the store (recommended).** The ledger is kept on the
  calendar node, which outlives the routine's deletion. Deleting the
  calendar node itself is already handled: its series end. The ledger is a
  hidden, managed field `gcal pushed` (text, many). It holds one value per
  unit kb has pushed to that Google calendar: `<routine id>` for a series,
  and `<routine id>@<on>` for an exception. These are the engine's existing
  `unit` keys.

How a sync run uses the ledger:

1. **Desired** is the projection of the live routines on the calendar.
2. **Owed retirements** are ledger minus desired. For each, the series ends
   at yesterday, or the exception returns to its default. They go through
   the existing mass-deletion hold: more than five series wait for a
   release, and the held keys with their exact signatures are a prop on the
   calendar node, so a release survives a restart.
3. **Owed puts** are the desired units whose signature differs from the
   routine's last-pushed signature.
4. A unit **enters** the ledger in the transaction that records its first
   successful put, and **leaves** it in the transaction that records its
   retirement.

The ledger is a bridge, not a mirror. It records what kb did to Google, a
fact that only the sync knows and that no node holds once the routine is
deleted. It is not a copy of a node. `events.list` on the kb-owned calendar,
filtered on the `kbRunner` private property, is used once to seed the
ledger for calendars pushed before it existed, and afterwards only as an
audit action, not on every run.

**Example.**

1. Routine R is pushed, so the ledger holds R.
2. The host stops.
3. On a laptop, the person deletes R and syncs the repository with git.
4. A week later, `kb jobs run --due` runs on the shared server.
5. Desired lacks R and the ledger holds R, so one retirement is owed. One is
   under the hold's five, so the series ends at yesterday and R leaves the
   ledger.

An occurrence fact removed offline (`R@2026-11-20`) is restored the same way.

## 8. The second rule, folded

**Recommendation: fold it.** "One-shot commands load no host code" is two
things:

- **a module boundary:** the launcher and the command path import no host
  package;
- **a budget:** the size of the command's eager graph.

kb states boundaries once, in `harness/src/constraints.ts`
([AGENTS.md → Shape](../../AGENTS.md#shape), "Linting & boundaries"), and
holds budgets with ratchets. A prose rule beside them would be a second
statement of the same fact. After §5, "host code" is not even the
interesting line anymore. What matters is that the launcher's graph stays
tiny and the command path's graph is the core plus one command.

So, in this revision:

- the second `#rule` node is withdrawn;
- the three gaps that named it (the one-file bundle, the eager painters and
  engines, and the missing fence and budget) stay as gaps with no rule;
- the truth rule absorbs parity: "a command gives the same answer whether
  a host serves it or it runs in-process";
- §4.4's fence row and closure budget become the enforcement, with startup
  wall-clock time as a sensor only.

## 9. Storage outside the store: a gap, not a rule

Today, everything under `KB_DATA` is generic:

| Path | What | Why it is not in the store |
|---|---|---|
| `home/` | the home store | it is a store |
| `trust.json` | the machine's trust ledger | authority must not travel with a store |
| `secrets/` | sealed host secrets | secrets are never nodes |
| `extensions/` | installed extension bytes and selection | code, per machine |
| `backups/` | copies of the store | a copy, not state |

Beside these there are `.kb/ui.json` and the socket, which are runtime
presence like a pidfile, and `KB_CACHE`, which holds rebuildable caches.

None of these is a feature's own state. The first one planned was decision
D8 of the 2026-11-10 data-plane design: a Google sync cache under
`KB_DATA`. The inbound calendar design (kb#194, `docs/research/2026-11-12-gcal-inbound.md`) replaces it
with nodes. As the owner asked, this is recorded as a gap, not
a rule: "No feature-specific storage outside the store (an allowed-file
list under KB_DATA) — debatable; refine later".

This design's own files fall under it as follows:

- presence and the socket are runtime state;
- the last-attempt memory of `kb jobs run --due` is a cache, in `KB_CACHE`;
- job state, the ledger, holds and sync tokens are in the store.

## 10. For the owner

Each decision has a recommendation.

1. **Topology.** One `kb`, whose launcher forwards to the root's host over
   its owner-only socket and otherwise runs in-process. **Recommend yes.**
   It measured 25–35 ms with a host, against ~100 ms without one after
   steps 2–8 and 420–730 ms today.
2. **A native launcher** for single-digit times (8–10 ms measured).
   **Recommend not now.** Revisit once the Bun launcher ships, and only if
   25–35 ms is felt. It would add a second toolchain to the build.
3. **Who starts the host.** **Recommend explicitly**: `kb ui`, or a login
   service. The CLI does not auto-spawn a background process.
4. **Routines' offline deletions.** This reverses the 2026-11-04 acceptance.
   The next sync recovers them from a ledger on the calendar node (§7), and
   retry counters and release holds become durable too.
   **Recommend yes.**
5. **Jobs.** `#job` nodes over `job: true` actions, run by any process, with
   `every` and `runs on` as data (§6). **Recommend yes.** Inbound Google
   Calendar is the second family, which the "general job contract" gap was
   waiting for.
6. **Server-only.** Nothing is server-only for correctness. Webhooks, push
   notifications and watchers are triggers over a job that polling also
   runs. **Recommend yes.**
7. **The second rule.** Fold it into the lazy fence's CLI row and the
   closure budget, and withdraw its `#rule` node (§8). **Recommend yes.**
8. **The 100 ms target for `get` without a host.** It is still staged
   (steps 2–8); curl-like times come only with a host. **Recommend
   confirming the staged target.**
9. **Hosted families.** Every family's actions and jobs load in every
   process, and only triggers and channels are host code. The agent chat
   stays a host feature with its truth in nodes. **Recommend yes.** This
   replaces the first version's "hosted families stay hosted".
10. **Storage outside the store** is a gap, not a rule, as the owner asked
    (§9). **Recommend revisiting** once the gcal and jobs work shows whether
    an allowed-file list is worth a check.

## 11. Reproducing

These steps reproduce the measurements; none of them is committed:

- Bundle a stand-in entry that `import()`s
  `packages/app/cli/src/cli.ts` and stamps `performance.now()` around the
  import and `main()`.
- Build it with and without `--splitting --metafile`.
- Time it with `KB_HOME`, `KB_DATA` and a `--root` of your own, taking the
  minimum of N runs.
- Profile with `bun --cpu-prof`.
- For a per-package floor, bundle a one-line entry that imports only that
  package.

For §5 (2026-11-12):

- A Bun server answering `Bun.serve({unix})`, and four clients sending one
  `POST` over the socket: a Bun script using `fetch` with `unix`, a Bun
  script using `Bun.connect`, the same scripts built with
  `bun build --compile` (with and without `--bytecode`), and a 40-line C
  client. Add `curl --unix-socket` for comparison.
- A scratch root with `kb init`, served by
  `kb ui --socket <path> --public-origin https://kb.invalid --no-open`.
  Each client sends
  `{"id":"node.get","input":{"id":…}}` with `Host: kb.invalid` (the host
  refuses any other host header). Repeat on a copy of this repository's
  `.kb`.
- For freshness: `kb add`, then a socket `node.get` of the new id; `kb rm`,
  then the same call, which must answer `not_found`.
- Each command is timed by spawning it N times from a Python harness and
  taking the minimum and median.
