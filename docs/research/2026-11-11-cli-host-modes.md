# One-shot commands and long-running hosts: separating the two modes

Status: **proposal, for the owner.** The owner approved the direction
(one mode-neutral core, host services in their own modules, and the rule
that a host only accelerates). The rules are stated once, in
[AGENTS.md → Hosts are accelerators](../../AGENTS.md#hosts-are-accelerators),
and today's drift is in `#gap` nodes (`kb backlinks` on each rule lists
them). This record holds the evidence and the plan, and does not restate
the rules. Nothing here changes code.

Date: 2026-11-11.
Inputs: kb `main` at `d94876c5`; host shared-server (16 cores, shared with
other agents); the installed nightly `0.3.1-nightly.20261111044351`; Bun
1.4.2.

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
init** (§1.3 has the floor). `--version` and `help` can reach it with steps
1–3 alone. §5 asks the owner to confirm the target.

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
| zod | 0.09 MB | 20 |
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
  confirm it (§5).
- Fix: a one-shot `routines.sync` action that runs refresh and push against
  the store and exits.
  - The cursor (a tail revision), each routine's last-pushed signature,
    attempts and holds are props on the routine and calendar nodes.
  - Deletions come from the transaction tail since the cursor. When
    compaction has passed the cursor, that is a status, as the tail's store
    mark already is.
  - The host loop runs the same action after its settle window, so it is
    only the trigger.
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

- `main.ts` answers `--version` and `help` before it imports the runtime. The
  version comes from the SDK module alone.
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
second launch path to keep under the contract.

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
- **Routines.** As fixed in §3: `routines.sync` is the unit, the host only
  triggers it, and the cursor, signatures, attempts and holds are props.
- **Day rollover and backup retention.** Both already comply: decided when
  read, and pruned at write time under the lock.
- **Optionally, the CLI's own speed.** An index or manifest snapshot keyed
  by the store fingerprint would make `get` cheap without a host and stay
  inside the rule. Building lazily (§4.5, step 7) comes first, because it
  needs no cache at all.

### 4.4 Mechanical enforcement

1. **One lazy fence, keyed by entry.** `UI_LAZY_ONLY` and `UI_LAZY_DEPTH`
   (`harness/src/constraints.ts`, applied by `ui-lazy-fence.test.ts`) become
   a table of fences: the UI's row as it is today, and a CLI row.
   - The CLI row's entry is `packages/app/cli/src/main.ts` over the backend
     import graph (`harness/src/import-graph.ts`).
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
   throughout reaches. For routines, the memory Calendar fake already
   satisfies `calendarContract`. Until the property exists, the rule's
   enforcement is `prose`.

### 4.5 Migration, in small PRs, in order

Each PR restructures first, in a commit that preserves behaviour, and adds
behaviour in a separate commit (Rule 1).

| # | PR | Effect |
|---|---|---|
| 0 | This record, the two rules, and the gaps | — |
| 1 | Generalize the UI lazy fence into a table, with the UI row only, preserving behaviour. Then add the CLI row with today's breaches listed, and the static-closure baseline. | the split cannot regress from here |
| 2 | One build script with `--splitting`, called by `bin/release-bundle` and `nix/package.nix`; the chunked `lib/kb/` layout; the startup contract over it | about −225 ms of parse moves to chunks that are parsed only when imported (−60 to −135 ms wall today) |
| 3 | `--version` and `help` answered in `main.ts` without the runtime | `--version` drops to ~30–50 ms |
| 4 | One PR per family: painters behind first use (chart-vega, gallery-net, canvas' tldraw reader); each removes its breach row | Vega and d3 (~70 ms marginal) and gallery-net leave the eager graph |
| 5 | Engines and adapters behind first use: QuickJS, store-sqlite at selection, source-git | ~1.3 MB of wasm and both adapters leave the eager graph |
| 6 | Split the `@kb/runtime` barrel: host-only modules move to `@kb/server`; the barrel is the core | the CLI fence holds with no breach rows |
| 7 | Open only what a command reads: build manifest JSON Schemas only for `kb.manifest` and MCP's `tools/list`; build the index on first datalog use (`get`, `children` and `backlinks` read the node table and mentions); compute derived sets on demand | the ~200–270 ms command phase becomes mostly proportional to what is read |
| 8 | The core's own init diet, measured against the closure budget: what `@kb/contracts` and `@kb/bundled` (the seed fold) do at module load | the last step toward `get` < 100 ms |
| 9 | Routines sync as a one-shot action with durable cursor, signatures and holds; the host loop becomes a trigger. Then the OAuth connect state. Then agent threads as nodes (the existing gap). | the truth rule's violations close |
| 10 | The hostless property in `extensionContract` | the truth rule moves from `prose` to `ci` |

Steps 1–6 are the mode split, steps 7–8 are the speed target, and steps 9–10
are the rule. The three groups are independent after step 1.

## 5. For the owner

1. **Routines' offline deletions.** The rule reverses the 2026-11-04
   routines decision (a deletion while no host runs is not recovered; retry
   counters reset on restart). Confirm, and step 9 records it in the
   routines spec.
2. **The 100 ms target for `get`.** It is reachable only after steps 2–8.
   Steps 2–6 alone should bring `get` to roughly 300 ms on the scratch store,
   because the command phase (§1.4) is untouched until step 7.
   The proposal is to treat 100 ms as the final budget with a staged path,
   not as one change.
3. **Hosted families stay hosted.** The agent and routines remain families
   `kb ui` composes. Only routines' sync becomes reachable one-shot; the
   chat stays a host feature, with its truth in nodes.

## 6. Reproducing

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
