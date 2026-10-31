# Offline-first kb: a sync engine, or kb's own tx log and merge (research, for the owner to read)

Date: 2026-10-31. Base: `main` at `d1b4d8cc`. This record surveys and
proposes. Nothing in it is built except the gap nodes it files (§8). It builds
on [`2026-10-31-online-stores.md`](2026-10-31-online-stores.md) (kb#84, "the
online record") and does not restate it. Specs that own each mechanism:

- the store port, the tail, how a session learns of changes:
  [DESIGN.md → Storage](../../DESIGN.md#storage-horizontal);
- the three-way merge of node sets: [DESIGN.md → Merge](../../DESIGN.md#merge);
- the authority port and the Durable Object design: the online record
  [§4.2](2026-10-31-online-stores.md#42-the-design-one-remotestore-over-one-remoteauthority-port)
  and [§3](2026-10-31-online-stores.md#3-a-cloudflare-durable-object-with-sqlite-storage);
- the rules: [AGENTS.md → Rule 1](../../AGENTS.md#rule-1--abstraction-before-addition).

The owner's question, verbatim: *"I'm thinking of having an offline-first kb
version. Should it mean just using some tech like ElectricSQL or similar, then
pipe it with a backend that is idk Postgres?"*

"unv." marks a claim I could not verify against a primary source or by running
it; §10 lists them again. Facts about repositories (licence, last push, latest
release) are from the GitHub API on 2026-10-31.

## 0. The answer

1. **No: Electric plus Postgres is not the offline-first mechanism, and it is not
   the shape kb needs.** Electric is "a read-path sync engine for Postgres";
   writes go through your own API and "offline writes and conflict resolution"
   are left to the app, which must build the outbox, the rollback and the merge
   itself (§2.1). Those are exactly the parts offline-first is made of. What it
   would give kb is a way to fan a Postgres table out to many readers, which kb
   does not need, at the price of a Postgres, a second sync service, and losing
   the tx log's metadata on the way to the hub (§4).
2. **kb already has the hard parts of offline-first.** The merge is
   `mergeNodeSets(base, ours, theirs)`: three-way, per node, per concern
   (existence, content, position), with orphans and cycles closed (DESIGN.md →
   Merge). The local store is a full durable store whose own tail is an outbox.
   The authority is the Durable Object of the online record, which only orders.
   What is missing is a loop that joins them (§3).
3. **The shape is "git for the graph".** The local store is the branch. A
   persisted *base* (the authority's state as last pulled) is the remote-tracking
   branch. `pull` = `mergeNodeSets(base, local, remote)` committed locally;
   `push` = one compare-and-swap `append` of what differs from the base. Writes
   never wait for or fail on the network; there is no queue structure besides
   the local tail; revs are the authority's, assigned at push (§3).
4. **This replaces the online record's `RemoteStore`, and keeps its port.**
   `RemoteAuthority` and the DO/Turso adapters are unchanged. The mirror store
   goes away, and with it a `STORE_BACKENDS` row and a second tail. It settles
   online-record gaps G3, G4, G5 and questions Q4, Q5 (§7).
5. **Surveyed, nothing to adopt as the engine.** Every engine (PowerSync, Zero,
   Replicache, LiveStore, Triplit, Instant, Jazz, TinyBase, cr-sqlite, Turso
   Sync, Electric+PGlite) wants to own the local database, its schema and its
   reactive path, so each puts a second model of change beside kb's tail and
   hub. Zero has no offline writes by design, Replicache is in maintenance,
   Instant's cloud shuts down on 2027-08-31, Triplit and cr-sqlite are dormant,
   Jazz 2 is alpha. **LiveStore is the closest prior art** (event log, total
   order from a Durable Object, rebase) and is the reference worth reading, not
   a dependency (§2.2).
6. **Smallest prototype:** a pure `reconcile` over `mergeNodeSets`, an in-memory
   authority, a sync agent, and a convergence property test with N local stores
   going offline and back, no network. Then wire it into `kb ui` and the DO
   (§7).

### Summary table

Columns: sync model, conflict model, write path, offline writes, Bun/browser,
licence, hosting and free tier, status, and the way it would sit behind kb's
store contract. Details and sources are in §2.

| | Sync model | Conflicts | Write path / offline | Bun, browser | Licence | Hosting, free | Status (Oct 2026) | Behind kb's contract |
|---|---|---|---|---|---|---|---|---|
| **Electric** | Postgres shapes over HTTP, read path | none: the app's | your API; offline = app builds it (4 patterns) | TS client, PGlite in browser; Bun unv. | Apache-2.0 | Electric Cloud PAYG, free under $5/mo; writes $1/M, +$2/M for Postgres Sync; or self-host (Elixir + Postgres) | active; README badge "Beta" linking to the 1.0 post (Mar 2025) | an **authority adapter** (`since`/`heads` over a `tx` shape); no tx metadata unless `tx` is synced too |
| **Zero** | server-authoritative sync of queried rows to a local replica | server wins (custom mutators) | **no offline writes**: rejected when disconnected | browser; Bun unv. | Apache-2.0 repo | self-host only per docs: zero-cache + Postgres (logical replication) | active; repo's tests removed 2026-09-30, PRs ported by maintainers | no: offline is a stated non-goal |
| **PowerSync** | Postgres/Mongo/MySQL (beta)/SQL Server (beta) → client SQLite by sync rules | per-field last-write-wins by server receive order; deletes win | upload queue → your backend API; offline yes | web, Node (`better-sqlite3`); Bun not listed | SDKs Apache-2.0; service FSL (source-available) | Cloud free tier (figures unv.) or Open Edition self-host | active (service 1.27.2) | owns the client SQLite; maps to an agent anyway |
| **Replicache** | push/pull of mutations, server-authoritative | server order; client rebases pending mutations (unv., from its docs) | mutators; offline yes | browser | open source, free (homepage) | any backend | **maintenance mode**, no features, migrate to Zero | dead end |
| **LiveStore** | event log, total order from a sync backend (CF Worker+DO, Electric, S2), clients materialize to SQLite | last-write-wins default; unpushed events rebased on pull | `store.commit(event)`; offline yes | web, Expo, Node, CF DO, Electron, Tauri; Bun not mentioned | Apache-2.0 | Worker + DO (DO SQLite default, D1 optional); free-plan notes unv. | v0.5.0 (2026-10-15); docs "work in progress" | closest prior art; a reference design |
| **Triplit** | client-server, property-level resolution | property-level | local-first writes | browser, node; Bun unv. | AGPL-3.0 | self-host | team joined Supabase Oct 2025; last release 2025-07-31, last push 2026-01-19 | skip: dormant |
| **InstantDB** | Postgres triple store, sync server tails the WAL | server | `db.transact`, optimistic; offline cache | browser, RN; admin SDK unv. | Apache-2.0 | **hosted cloud shuts down 2027-08-31**; self-host stays | team joined OpenAI | skip: hosted product ends |
| **Jazz** | local-first relational DB, trusted sync server | server-enforced permissions | local replica, background sync | TS, React, Expo | MIT (repo) | Jazz Cloud (pricing unv.) | **2.0 alpha** (v2.0.0-alpha.59) | skip: alpha |
| **Automerge** | CRDT documents, `automerge-repo` sync | concurrent edits merge; map conflicts resolved deterministically (unv.) | local doc ops; offline yes | JS/WASM in Node, browsers; Bun unv. | MIT | none: bring a sync server | 3.x, active | no: a second model of change |
| **Yjs** | CRDT shared types, state-vector sync | merges; deletes tombstoned, garbage-collected | local ops; offline yes | JS everywhere | MIT (README) | `y-websocket` or any provider | active | no; at most `Y.Text` for rich text later |
| **cr-sqlite** | SQLite extension; `crsql_changes` pulled by `db_version` | per-column last-write-wins | normal SQL; offline yes | WASM build exists; loading into `bun:sqlite` unv. | MIT | none: bring a transport | **last release v0.16.3, 2024-01-17** | skip: stalled |
| **Turso offline sync** | local DB, `push()`/`pull()` | row-level last-push-wins | local; offline yes | `@tursodatabase/sync` 0.8.3 loads under Bun (verified, online record §2.3) | MIT | Turso Cloud, free 100 DBs / 5 GB | beta | breaks the tail's total order (online record §2.4) |
| **TinyBase** | `MergeableStore` CRDT, WebSocket and BroadcastChannel synchronizers | per-cell merge via metadata (clock unv.) | local; persisters to SQLite, Postgres, PGlite, DO SQL storage | "works anywhere JavaScript does", Bun SQLite named | MIT | none: bring a server | v10.0.0 (2026-09-24), active | overlaps kb's index; no |

## 1. What offline-first adds to the contract of the online record

The online record's contract (§1) holds one sequence: the tail's `rev`, assigned
by the store, durable, never ahead of the nodes. Offline-first adds a second
writer *that cannot be reached*: a device that edits while the authority is
away. Three things follow, and they are the whole problem:

1. **Two sequences.** The device's tail orders what it did; the authority's tail
   orders what everyone did. Their revs are unrelated numbers. A design that
   forces one `rev` namespace (the online record's `RemoteStore`, with one
   mirror tail) cannot take an offline write without allocating a rev it does
   not own (online record G4).
2. **A merge.** Edits made apart must be reconciled when they meet. kb has this:
   `mergeNodeSets`. It is not a CRDT; it needs the common ancestor.
3. **A common ancestor.** The device must remember the authority's state as of
   its last contact. Without a base there is no three-way merge, only a guess.

## 2. The survey

Scope of verification: docs and repositories read on 2026-10-31, through a
summarising page reader. "Not stated" below means the page I got did not say
it, which is not "no".

### 2.1 ElectricSQL and PGlite

- **Sync model.** Postgres → clients over HTTP; the unit is a *shape* (a
  filtered table). The intro calls it "a read-path sync engine for Postgres";
  the sync service is Elixir and needs "a Postgres database with logical
  replication enabled" (<https://electric.ax/docs/intro>, the Electric README).
  PGlite is "embeddable Postgres for the browser, Node.js, and edge"
  (Apache-2.0, repo active).
- **Writes and offline.** The writes guide gives four patterns, from online
  writes to *through-the-database sync* (PGlite as the local database, with
  triggers and a change log). Of offline writes and conflicts it says the app
  must "merge overlapping optimistic state … and roll back writes the server
  rejects" (<https://electric.ax/docs/guides/writes>). So the engine delivers
  Postgres rows to a device; the outbox, rebase and merge are the application.
- **Hosting.** Electric Cloud is pay-as-you-go: writes $1 per million (a write
  is a message up to 10 KB), retention $0.10 per GB-month, Postgres Sync adds
  $2 per million writes; PAYG usage under $5/month is waived, up to 10
  databases (<https://electric.ax/pricing.md>). Self-hosting is the Elixir
  service plus your Postgres. Postgres hosting itself is not part of that price,
  and I did not research Postgres host prices (unv.).
- **Status.** The repository README carries a "Beta" badge linking to the 1.0
  post of 2025-03-17; the site moved to `electric.ax` and now lists Agents and
  Streams sections I did not read. Latest GitHub release object is a client
  package, so the service version is unv.
- **Bun.** Not mentioned for the TypeScript client (unv.).

### 2.2 The engines that own the local store

**Zero (Rocicorp).** "Reads and writes hit that local store first, then sync
continuously with your server in the background"
(<https://zero.rocicorp.dev/docs/introduction>), yet the offline page says
plainly: *"Zero does not support offline writes"*; writes are queued while
`initializing` or `connecting` and **rejected** while `disconnected`, and the
team "may revisit offline support later, but it isn't a priority now"
(<https://zero.rocicorp.dev/docs/offline>). The when-to-use page: "not
local-first … a client-server system with an authoritative server". Deployment
is self-hosted: zero-cache (view-syncers plus a replication-manager) and a
Postgres with `wal_level=logical`, not through PgBouncer, a documented
topology of Docker, Fly.io, SST or Kubernetes
(<https://zero.rocicorp.dev/docs/deployment>). The `rocicorp/mono` README says
tests for zero-cache, zql and others "were removed from the published
repository on September 30, 2026", history was rewritten that day, and
accepted PRs are ported by a maintainer into an internal repository. Licence
Apache-2.0 at the repository root; per-package licence unv. **For kb it fails
the one requirement: offline writes.**

**PowerSync.** Replicates "from your backend database, partitions it based on
what data each user should receive, and streams real-time updates" into
in-app SQLite (<https://docs.powersync.com/intro/powersync-overview>). Sources:
Postgres, MongoDB, MySQL (beta), SQL Server (beta), Azure DocumentDB (alpha),
Convex (experimental). Writes go to an upload queue of `PUT`/`PATCH`/`DELETE`
operations that your `uploadData()` sends to **your own backend API**, which
must apply them to the source database synchronously
(<https://docs.powersync.com/handling-writes/writing-client-changes>). Default
conflict handling is "per-field Last-Write-Wins", the winner being the last
update *as received by the server*; deletes win; concurrent text editing "is
not supported out of the box" (<https://docs.powersync.com/handling-writes/handling-update-conflicts>,
the FAQ). Client-server transactions are not supported. SDKs: web, React
Native, Node (`better-sqlite3` recommended; `node:sqlite` "for testing only"),
Flutter, Kotlin, Swift, .NET, Rust; **Bun is not listed**. Licence: SDKs
Apache-2.0; the service is source-available under the Functional Source
License (converts after two years) (<https://powersync.com/legal/licensing-terms>
via search; the Open Edition is described as beta in places, unv.). It is the
nearest thing to "Electric + Postgres + offline writes in one box", and it is
the clearest picture of what that costs: you run the PowerSync service, a
source database, and an upload API, and the client SQLite is PowerSync's.

**Replicache.** Maintenance mode: the homepage says the code is open source and
no longer charged for, will be supported but not extended, and that users
should move to Zero (<https://replicache.dev/>, via search). Its model (client
mutators replayed on top of server state) is the same idea as §3, but the
product is a dead end, and my claim about its rebase is from its concept docs,
which I did not retrieve (unv.).

**LiveStore.** The closest prior art, so read closely:

- *Event sourcing.* "The reactive SQLite state is a projection of this
  eventlog"; a committed event is "atomically persisted to the local eventlog
  and immediately materialized as state into the SQLite database".
- *Order and rebase.* "The sync backend … is responsible for storing events,
  enforcing the total event order, and notifying clients of new events."
  Clients "must first pull the latest events … before pushing"; "local pending
  events that haven't been pushed are rebased on top of the latest upstream
  events". The default conflict strategy is last-write-wins, with custom merge
  logic available (<https://docs.livestore.dev/evaluation/how-livestore-works>,
  <https://docs.livestore.dev/building-with-livestore/syncing/>).
- *Cloudflare.* `@livestore/sync-cf`: a Worker routes by `storeId` to a Durable
  Object (one per store) that "manages sync state, push/pull, and WebSocket
  connections"; events persist in the DO's SQLite by default or in D1;
  transports are WebSocket (recommended), HTTP polling (5 s default) and DO
  RPC (<https://docs.livestore.dev/sync-providers/cloudflare/>). This is the
  online record's DO design, by another project, which is evidence the design
  works and a source of mechanics to copy.
- *Mechanics worth stealing.* A backend id with reset detection ("if the
  backend is reset, the client detects a changed backend ID", default: clear
  local storage and shut down); a client-id collision check on first push; and
  the advice to "avoid `DELETE` events" for concurrency, i.e. soft deletes.
- *Status.* v0.5.0 (2026-10-15), Apache-2.0, adapters for web, Expo, Node,
  Cloudflare DO, Electron, Tauri; 0.5 moved to **Effect 4**, kb's version.
  Docs say they are "still work in progress". Bun is not mentioned (unv.).
- *Why not the engine.* Its unit is an *event* with a *materializer* into an
  app schema; kb's unit is a whole-node `StoreTx` already ranked, with `origin`,
  `actor`, `session`, `via`. One could define a single event
  `txCommitted(tx, record)` whose materializer upserts `nodes` rows and run kb's
  `rankTx` inside it, and LiveStore would be a transport and an outbox. That is
  a larger bet than §3, replaces the session's change model (a second one), and
  depends on a 0.x project. A reference, not a dependency. Revisit when it is
  1.0 (unv.).

**Triplit.** Client-server, "conflict resolution at the property level",
multiplayer "powered by CRDTs", storage in IndexedDB, SQLite, Durable Objects
(<https://github.com/aspen-cloud/triplit>). AGPL-3.0. Supabase announced it
was welcoming the Triplit co-founder in October 2025 and that it would be
further open-sourced; last release 2025-07-31, last push 2026-01-19. Treated
as dormant (an official statement of that is unv.).

**InstantDB.** Triples stored in one Postgres, a Clojure sync server tailing
the WAL, optimistic updates and an offline query cache (<https://github.com/instantdb/instant>,
Apache-2.0). The triple store is a cousin of kb's datoms, which makes this the
most interesting data model in the list. But the docs banner reads **"Instant is
sunsetting. Services will continue until August 31st, 2027"**, and press
reports say the team joined OpenAI on 2026-08-22 (secondary sources); the code
stays open for self-hosting. Whether it queues offline writes is unv.

**Jazz.** 2.0 is a "local-first relational database" whose server is "a trusted
authority" for permissions; the README calls it an alpha, current tag
`v2.0.0-alpha.59`; MIT in the repository (official pricing unv.). Alpha; skip.

**Turso offline sync.** Covered in the online record §2.2 and §2.4: logical
row-level push with last-push-wins, pull by physical pages, beta; and it
cannot keep a total order of revs. `@tursodatabase/sync` 0.8.3 loads under Bun.

**TinyBase.** MIT, v10.0.0 (2026-09-24). `MergeableStore` is "a native CRDT",
synchronizers run over WebSockets or BroadcastChannel, persisters cover
SQLite, PostgreSQL, PGlite and Durable Object SQL storage (the SQL ones
store a `MergeableStore` in JSON mode only, not tabular). It is an in-memory
reactive store with its own listeners, i.e. a competitor for the index and the
hub, not a layer under them. Its HLC-per-cell clock is from memory (unv.).

**cr-sqlite.** MIT; `crsql_as_crr('table')` makes a table a conflict-free
replicated relation; `crsql_changes` exports and imports changes pulled by
`db_version`; v1 is history-free with per-column last-write-wins; altering a
CRR needs `crsql_begin_alter`/`crsql_commit_alter`; inserts about 2.5× slower
(<https://github.com/vlcn-io/cr-sqlite>). The latest release is v0.16.3 of
**2024-01-17**, though the repository was pushed in 2026-08. Loading a native
extension into `bun:sqlite` is platform-dependent (unv.). Stalled; skip.

### 2.3 CRDT libraries: Automerge and Yjs

Both give a merged document with no authority and no total order. Automerge:
"Conflict-Free Replicated Data Type", local-first, `automerge-repo` for
networking, Rust core compiled to WASM, MIT, 3.5.0 (2026-09-16), "two
maintainers work full time" (<https://github.com/automerge/automerge>). Yjs:
shared types (`Y.Map`, `Y.Array`, `Y.Text`) merged through state vectors,
deleted content garbage-collected, providers `y-websocket` and `y-indexeddb`,
MIT per the README (<https://github.com/yjs/yjs>).

For kb they are the wrong tool for the graph: they replace `StoreTx` and the
tail with a second model of change (Rule 1), keep history that grows
(Automerge; Yjs trims tombstones), and answer a question kb has already
answered (`mergeNodeSets`). Where a CRDT *is* right is inside one field: a
long text value edited by two people at once, which a whole-concern merge
cannot combine. That is a field type later, not a store.

### 2.4 What the survey says

- **Three kinds of thing.** (a) *Engines that own the local database* (Electric
  + PGlite, PowerSync, Zero, Replicache, LiveStore, Triplit, Instant, Jazz,
  TinyBase, cr-sqlite, Turso Sync). Each brings its own schema, its own change
  feed and its own reactive path. kb already has all three, and its store
  contract is where they live; adopting one makes two. (b) *CRDT documents*
  (Automerge, Yjs). (c) *Authorities* (Postgres, a DO, Turso's database): these
  hold and order; they are what the online record designs.
- **Row-level last-write-wins is what everyone ships**, and it is the model kb
  already has at the node level (online record §4.3). The finer step, merging by
  concern, is something the survey's engines mostly do not do and kb has.
- **The engines are weak where kb is strong, and strong where kb does not need
  them.** Their value is partial replication (shapes, sync rules, queries) for
  data too big or too private to ship whole. A kb graph is thousands of nodes
  today and is shipped whole by `/api/graph`.
- **Maturity, 2026.** Of thirteen, two are in maintenance or dormant (Replicache,
  Triplit), one is stalled (cr-sqlite), one hosts until 2027-08-31 (Instant),
  one is alpha (Jazz), one declines offline writes (Zero), one is beta
  (Turso Sync), and LiveStore is 0.x. Of the ones with a Postgres
  backend, only PowerSync and Electric are both active and offline-capable, and
  Electric leaves the conflict logic to you.

## 3. The design: kb's own tx log plus a sync authority

### 3.1 The shape

```
 local store (SqliteStore or JsonlStore)     base store (a SqliteStore, derived)      authority (DO / Turso)
 the session's store; writes land here        the authority's state as last pulled     orders; CAS append(expectedRev, …)
 its tail is the outbox                       its tail adopts the authority's records  tail = the total order
                \                                    |                                       |
                 \___________  SyncAgent: pull / reconcile / push  ________________________/
```

- **Local store.** Exactly today's store, untouched. Edits commit to it at once,
  online or not. The session, hub, index and own-write ingest see an ordinary
  store.
- **Base.** The authority's state as of the last successful `pull`, kept as a
  second store instance under `.kb/cache/sync/<peer>/` (derived, gitignored,
  deletable). Reusing `SqliteStore` for it is a bridge, not a mirror: it is the
  same schema, the same codecs, `adopt` for the authority's tail. Its tail revs
  are the authority's revs (adopted, then one local row per remote record), so
  the cursor is the base's `txTail.head()`. That this stays faithful, despite
  `commitEffect` running `rankTx` on records the authority already ranked, is
  unproven (unv.): see §7 P0.
- **Authority.** The online record's `RemoteAuthority` (`snapshot`, `since`,
  `append(expectedRev, tx, record)`, `heads`), unchanged.
- **SyncAgent.** One Effect loop, in the `kb ui` server or run once by
  `kb sync`. It is an ordinary *writer* of the local store.

### 3.2 pull, reconcile, push

1. **pull.** `since(base.head)` → the authority's records past what the base has;
   `snapshot-required` → re-snapshot (below). Apply them to the base (the base
   now equals the authority at `r`). A pull with no new records ends here.
2. **reconcile.** If the local store differs from the *old* base, run
   `mergeNodeSets(oldBase, local, newBase)`. Where the local side is unchanged
   from the old base, the result is the authority's side and it is a fast
   forward. Commit the difference between `local` and `merged` to the local
   store through `persistEffect` with origin `sync:<peer>` and an actor for the
   agent. The session's own-write ingest applies it to the index and the log;
   tabs get an ordinary `tx` frame. A process that is not `kb ui` writes it as
   any foreign process does, and `changes` announces it: the existing lane.
3. **push.** The nodes where the (merged) local store differs from the new base
   are the *dirty* set. Send them as one `append(r, {upserts, deletes}, record)`
   with the ranks already settled by the merge. The authority's CAS accepts it
   only if its head is still `r`. Accepted: apply the same tx to the base
   (head `r+1`). Stale: go to step 1. Candidate ids come from the local tail
   past the last push; the truth is a byte compare against the base, so a
   `sync:`-origin commit that only copied the authority's nodes is not dirty,
   tail compaction cannot lose a change, and nothing depends on remembering
   origin. Bounded retries, then the loop waits for `heads`.
4. **Live.** `heads` (a DO push, or Turso's 1 s poll) wakes step 1. A local
   commit wakes step 3 after a short debounce. Neither blocks a write.

**Offline** is `append` failing to connect. The loop backs off and the local
tail keeps growing. Nothing else changes: reads, writes, the hub and the
index never knew there was a network.

**Order.** Each device's tail orders the device. The authority's revs are
assigned at `append`, in the order pushes arrive. They never meet the local
revs, and no table maps them: the dirty set is derived from content. That is
what makes G4 of the online record stop being a problem.

### 3.3 Conflicts

`mergeNodeSets` already decides them (DESIGN.md → Merge), and its rules are
the offline-first conflict model:

| situation | result |
|---|---|
| one side changed a concern of a node, the other did not | that side's, whatever the other did to the node's other concerns |
| both changed **content** | the newer `updatedAt` wins; an equal stamp keeps ours, reported `modified-both-same-stamp` |
| both changed **position** (parent and rank) | ours, reported `modified-both-position` |
| one side deleted, the other changed | the node lives, reported `deleted-and-modified`; a deletion the other side did not touch wins |
| a living node whose parent was deleted | the parent is brought back |
| a cycle made of positions from different sides | ours holds; reported |
| two siblings with one rank | `rankTx` settles, order kept |

Three observations:

- **It is finer than every engine's default** (row-level or cell-level
  last-write-wins), because content and position are separate concerns: one
  side's move and the other's edit of the same node both survive.
- **Conflicts have nowhere to go at run time.** `MergeResult.conflicts` is an
  array the git driver prints. A person using kb offline needs them to be data:
  a node tagged for it, naming the node, the reason and which side was kept.
  That follows "everything is a node", and it is the one new model decision in
  the prototype (G7).
- **The content clock is wall time.** `updatedAt` decides a both-changed
  content conflict, so two devices with skewed clocks decide it wrongly. The
  git driver has the same exposure. Named, not fixed (§9, Q3).

### 3.4 What this settles of the online record

| online record | status here |
|---|---|
| G3, a persisted mirror | closed: the local store is persistent and the base is a derived store |
| G4, offline writes unsupported | closed: they queue in the local tail and merge at push; revs are the authority's, assigned at push |
| G5, saved-query virtual set collides with a remote rev | closed: virtual records are in the local tail, in no authority's sequence |
| G2, a foreign commit reloads the whole graph | narrowed: an in-process agent commits through `persistEffect`, whose own-write ingest uses `applyTx`; only an out-of-process agent still pays the reload |
| G1, no online store | the same gap; this is its better closing |
| Q4, refuse or queue offline writes | queue, by construction |
| Q5, an error code for an unreachable remote | not needed: a write never fails for the network; sync state is a status |
| Q1, Q2, Q3 (DO or Turso first, who deploys, a Worker scope) | unchanged |
| §7 commit 2, `RemoteStore` and a `remote` row in `STORE_BACKENDS` | **withdrawn**: no mirror store, no second tail, no `.kb/remote.json` selecting an adapter. The pointer becomes `.kb/sync.json`, which selects nothing |
| §5.2, foreign commits skip the system-write rule | narrowed: the agent commits with `systemWrites: "checked"`; a refusal is a parked conflict, not a silent write |

### 3.5 What it costs

- **A second copy of the graph** (the base). Derived and deletable; its loss
  costs a re-snapshot and, for unpushed local changes, a two-way reconcile (see
  §3.6).
- **A deterministic merge on every device.** Two devices that merge the same
  inputs must produce the same bytes or they will push each other's rewrites
  forever. `mergeNodeSets` is documented as symmetric unless a conflict is
  reported, but convergence of the *loop* (pull, merge, push on N devices) is a
  property nobody has tested. It is the prototype's main test.
- **Push is a net diff.** The authority's tail shows one `sync:` record per
  push, not the keystrokes: `actor`, `session` and `via` of the original edits
  are not carried, and `graph.changes` on the authority sees batches. The
  device's own tail keeps them. Pushing the local records one by one preserves
  attribution at the price of merge-per-record; not recommended first.
- **Coarser than a CRDT** inside one field: two people typing in one text value
  offline lose one side's text (reported). Field-level CRDT text is a later,
  separate decision (§2.3).

### 3.6 Resets, losses, and the first sync

- **First sync.** No base: `snapshot` → base; if the local store is empty, it
  becomes the base (the other device's graph arrives by pull). If the local
  store is not empty and the authority is, push everything. If both are not
  empty and share no ancestry, refuse and ask: merging two unrelated graphs is a
  decision (it is `kb store migrate`'s kind of act, not a sync).
- **Backend identity.** The authority carries an id generated at creation
  (LiveStore's lesson). The base stores it. A different id on connect means the
  authority was reset or replaced: stop and ask, never auto-merge into it, and
  never clear local data (LiveStore's default clears local storage; kb's local
  store is the graph). G8.
- **Compaction.** `since` past the authority's compaction → `snapshot-required`
  → fetch a snapshot, treat it as the new base and run `mergeNodeSets(oldBase,
  local, snapshot)`. The old base is still the right ancestor, so nothing is
  lost; the cost is one snapshot.
- **Base lost.** No ancestor: two-way reconcile against the snapshot, deciding
  by `updatedAt` per node, never deleting a node the authority has. Rare and
  documented, like a lost lock file.

## 4. Answering the owner: Electric plus Postgres, or the tx log plus an authority?

"If offline writes queue locally and rebase on the authority's order": **yes,
and it is §3**, and it needs neither Electric nor Postgres. The comparison on
the axes asked for:

| | Electric (or similar) + Postgres | kb's tx log + DO authority + agent (§3) |
|---|---|---|
| **What you run** | Postgres with logical replication, the Electric sync service (Elixir) or Electric Cloud, and a write API; PowerSync adds its service and an upload API | a Worker and a Durable Object (about 100 lines, online record §4.2), or a Turso database |
| **Schema mapping** | datoms are never stored (DataScript is built in memory from nodes), so the table is `nodes(id, body jsonb)` and a `tx` table. A relational mapping per tag or field would be Rule 1's forbidden "column per field" and a migration treadmill (the SpacetimeDB lesson of the online record §6) | none: the authority holds the same `nodes` and `tx` rows `SqliteStore` already has |
| **Query on the server** | Postgres cannot run kb's datalog; if the body is `jsonb`, SQL over it is a second query language. The reason to choose Postgres disappears | not offered, and not needed: queries run on each device's index |
| **Conflict semantics** | none shipped: Electric leaves it to the app; PowerSync gives per-field last-write-wins by server receive order and "deletes win". Neither knows an orphan, a cycle or a rank | `mergeNodeSets`: by concern, orphans and cycles closed, reported conflicts |
| **Offline writes** | the app builds the outbox, rollback and rebase (Electric's own writes guide) or adopts PowerSync's queue | the local tail is the outbox; the base is the ancestor |
| **Path into the hub** | Electric streams *rows*; the hub wants `KbTx` records with `origin`, `actor`, `session`, `via`. Row changes reach `ingestExternalWrite` as the *fallback* `diffTx` (the path used "because no transaction was ever recorded"). To get records, `tx` must be a shape too, and ordering across two shapes is unv. | tail records are the unit; the agent commits locally, so the hub sees an ordinary `tx` frame |
| **Many readers, partial sync** | the real strength: shapes, CDN-cacheable HTTP, thousands of clients | not offered; a graph is shipped whole |
| **Cost** | Electric Cloud $1 per million writes (+$2 per million for Postgres Sync), plus a Postgres bill (unv.) | DO free plan: 100 k rows written/day (online record §3.1); Workers Paid at $5 otherwise |
| **Lock-in surface** | a Postgres + Electric/PowerSync/Zero deployment | one port (`RemoteAuthority`) and two adapters |

**The bridge, not a fork.** Electric and Postgres fit kb as a *third adapter of
the same port*, if that is ever wanted: `since` and `heads` over an Electric
shape of an append-only `tx` table (offset = rev), and `append` as a
write endpoint doing the same `INSERT … (expectedRev + 1)` compare-and-swap in
a Postgres transaction. The agent, the merge and the contract suite do not
change. That is the answer to "pipe it with Postgres": Postgres is a backend
for the authority port, chosen for operations reasons (an existing database,
SQL access, many readers), never the offline mechanism. Nothing in this
record needs it first.

**When to revisit an engine.** (i) the graph outgrows shipping whole (partial
replication becomes a requirement); (ii) many unrelated users share one store
and per-user filtering is needed; (iii) LiveStore reaches 1.0 and a
`txCommitted` event makes it a transport worth owning less code for; (iv) kb
needs collaborative text, which is a CRDT field, not a store.

## 5. Browser and the "no server" case

Today the browser is a *replica of `kb ui`* (`BrowserStore`, in memory, fed by
the server's frames), so "offline" in a tab means offline from that server. A
PWA that works with no `kb ui` needs a persistent store in the browser and the
agent running there. The model core (`@kb/model`, `mergeNodeSets`, the
contracts) is `scope:shared` and isomorphic, so the agent can be too. The
missing piece is a persistent browser store adapter (OPFS SQLite via WASM,
IndexedDB, or PGlite as a *container* only, never a sync engine). I did not
verify any of these under kb's harness (unv.). It is a second phase after §3
works on Bun, and it is where PGlite or wa-sqlite earns a place: as an adapter
behind `EffectStore`, joined to the same contract suites.

## 6. Security (delta from the online record §5)

- **The merge is a trust boundary.** Remote nodes enter through
  `persistEffect` with `systemWrites: "checked"`, so a remote write to a `sys.*`
  node beyond what a person may write is refused and parked instead of loaded.
  This narrows the online record's §5.2 exposure (a token holder writing a
  broad `CodeGrant` into your process) without removing it: a code view is a
  non-`sys.*` node.
- **The base is a plaintext copy** of the remote graph under `.kb/cache/sync/`.
  It is gitignored like `.kb/cache/`; the owner decides whether the machine's
  disk protection covers it.
- **Credentials** are as in the online record: `.kb/sync.json` holds a URL and a
  secret *reference* (`env:KB_ONLINE_TOKEN`), resolved by the process that
  connects; nothing selects a store by it.
- **Authority reset** must never delete local data (§3.6).

## 7. Recommendation and the smallest prototype

**Build §3. Do not adopt an engine.** Then, in the online record's order, a DO
authority first and Turso second.

Phases, each its own commit (AGENTS.md: restructure, then add):

**P0, pure and offline (no network, no authority).** Proves the loop converges.

- `packages/domain/model/src/merge.ts`: no change to the algorithm. Add a pure
  `dirtyAgainst(base, local)` (the byte compare of §3.2 step 3), beside
  `diffTx` (`tx.ts`), which the agent uses to turn a merged set into a commit.
- `packages/application/sync/` (`@kb/sync`, `scope:shared`, layer `application`):
  `SyncAgent` as Effect programs over three ports: the local `EffectStore` +
  `persistEffect`, the `base` (an `EffectStore`), and the online record's
  `RemoteAuthority`. `pull`, `reconcile`, `push`, `syncOnce`, `syncLoop`.
- `packages/contract/contracts/src/remote-authority.ts`: the port (from the
  online record §4.2).
- `packages/app/test-kit/src/authority-contract.ts` and an in-memory authority;
  `packages/app/test-kit/src/sync-contract.ts`: N local stores, one authority,
  random edits (create, update, move, delete) interleaved with offline periods
  generated by `fast-check` (already in the repo, `fast-check-seed.ts`), then
  everything reconnects: **all stores and the authority hold the same node set,
  every group well ranked, no dangling parent, conflicts only where the merge
  reports them.** Also: a write while offline commits and is readable at once.
  It runs over `SqliteStore` and `JsonlStore` locals, so both adapters join.
- *Exit.* The property holds over many seeds; if it does not, the failing seed
  is the finding (a non-symmetric merge, or `rankTx` fighting between devices),
  and the record's §3.5 risk is real.

**P1, wire it.**

- `packages/app/runtime/src/sync-peer.ts`: read `.kb/sync.json`, bind the secret
  through the existing `SecretSource`.
- `packages/app/server/src/server.ts`: fork the agent lane beside
  `ingestEach(ctx.store.changes, …)` in the server's lifetime scope.
- `packages/app/cli/src/`: `kb sync` (one round), `kb sync --watch`, `kb sync
  status`.
- A `#sync-conflict` tag and the node a reported conflict becomes (G7).
- Tests: `packages/app/server/tests/offline-sync.test.ts`, modelled on
  `cross-process-sync.test.ts`: two `kb ui` servers on two roots, the authority
  down, an edit on each, authority up, a `tx` frame arrives on each tab.

**P2, the real authority.** The DO adapter and `deploy/online-store/` file from
the online record's commit 3, joined to `authorityContract`; then Turso.

**What it settles** of the online record: G3, G4, G5 and Q4, Q5; narrows G2
(§3.4). **What it leaves:** Q1 (DO or Turso first), Q2 (who deploys), Q3 (Worker
scope).

**Exit test (the owner's):** two machines, same `.kb/sync.json`. Edit on both
while online and watch each UI follow within about a second. Turn one machine's
network off, edit on both (one of the edits on the *same* node, one a move
against the other's delete), turn it on. Both UIs converge, each reported
conflict is a visible node, and `bun run verify` is green.

**What not to build:** an event-sourced rewrite of the session (LiveStore's
shape); a CRDT for the graph; field-level text merging; per-record push with
attribution; an auto-merge of two unrelated graphs.

## 8. Gaps

Filed as `#gap` nodes in this record's commit (`kb add … --tag gap`):

- **G6** `01M69E3P6ADBBDTGRP4F6ZSR81` — kb has no way to edit offline and merge later: a device's writes
  cannot meet another's without git.
- **G7** `01M69E3QETRHZH00T7JFMQ0F37` — a merge's conflicts are data returned to a git driver and have no
  place in the graph a person reads.
- **G8** `01M69E3RQH76X44JB9H5NYDWBE` — a store has no identity, so a replaced or reset authority cannot be
  told from the one a device synced with.

## 9. Questions for the owner

1. **Withdraw the online record's `RemoteStore`?** This record says yes: the
   agent makes it redundant and keeps the port. If you want a thin online-only
   mode (no local disk, e.g. a CI box), it is the agent with an in-memory local
   store, not a new adapter.
2. **Conflict visibility.** Should a reported conflict become a node (the
   record's proposal), or a status line and a log, with the merge keeping one
   side?
3. **The content clock.** `updatedAt` (wall clock) decides both-changed content.
   Accept the skew risk as the git driver does, or have the authority stamp
   `pushedAt` and decide by push order (a "last push wins" rule, Turso's)?
4. **Push granularity.** One net diff per push (recommended) or one record per
   local commit (keeps `actor`/`via` on the authority's tail)?
5. **Browser first?** The record puts the PWA (§5) after Bun. If an offline
   *tab* matters more than an offline *machine*, the order flips.

## 10. What I could not verify (unv.)

- Everything about Electric beyond its intro, writes guide and pricing page:
  its service version, whether shapes over two tables are transactionally
  consistent with each other, Bun support for its client, Postgres hosting prices.
- PowerSync: the Open Edition's maturity label, Cloud free-tier figures
  (third-party only), Bun.
- Replicache's rebase mechanics (concept pages not retrieved).
- LiveStore: Bun support, free-plan behaviour of its Worker+DO provider, and
  its conflict and rebase details beyond the pages quoted.
- Triplit's official maintenance status; InstantDB's offline write queue and
  its Bun/Node admin SDK; Jazz's pricing and licence beyond the repository.
- TinyBase's clock; Automerge's concurrent-map resolution rule; Yjs's `Y.Map`
  concurrent-set rule; whether any of them loads under Bun.
- cr-sqlite loading under `bun:sqlite`.
- That a `SqliteStore` base stays byte-faithful to the authority's records
  (§3.1), and that the pull/merge/push loop converges on N devices (§3.5):
  both are the prototype's job to prove or break.
- Browser persistence adapters under kb's harness (§5).

## Sources

- Electric: [intro](https://electric.ax/docs/intro), [writes guide](https://electric.ax/docs/guides/writes),
  [pricing](https://electric.ax/pricing.md), [repository](https://github.com/electric-sql/electric),
  [PGlite](https://github.com/electric-sql/pglite).
- Zero: [introduction](https://zero.rocicorp.dev/docs/introduction),
  [offline](https://zero.rocicorp.dev/docs/offline), [when to use](https://zero.rocicorp.dev/docs/when-to-use),
  [deployment](https://zero.rocicorp.dev/docs/deployment), [rocicorp/mono](https://github.com/rocicorp/mono);
  Replicache: [homepage](https://replicache.dev/).
- PowerSync: [overview](https://docs.powersync.com/intro/powersync-overview),
  [writing client changes](https://docs.powersync.com/handling-writes/writing-client-changes),
  [update conflicts](https://docs.powersync.com/handling-writes/handling-update-conflicts),
  [FAQ](https://docs.powersync.com/resources/faq), [Node SDK](https://docs.powersync.com/client-sdks/reference/node),
  [licensing](https://powersync.com/legal/licensing-terms).
- LiveStore: [docs](https://docs.livestore.dev/), [how it works](https://docs.livestore.dev/evaluation/how-livestore-works),
  [syncing](https://docs.livestore.dev/building-with-livestore/syncing/),
  [events](https://docs.livestore.dev/building-with-livestore/events/),
  [Cloudflare provider](https://docs.livestore.dev/sync-providers/cloudflare/),
  [repository](https://github.com/livestorejs/livestore).
- Triplit: [repository](https://github.com/aspen-cloud/triplit),
  [Supabase announcement](https://supabase.com/blog/triplit-joins-supabase.md).
  InstantDB: [docs](https://www.instantdb.com/docs), [repository](https://github.com/instantdb/instant).
  Jazz: [docs](https://jazz.tools/docs), [repository](https://github.com/garden-co/jazz).
- CRDTs and SQLite: [Automerge](https://github.com/automerge/automerge),
  [Yjs](https://github.com/yjs/yjs), [cr-sqlite](https://github.com/vlcn-io/cr-sqlite),
  [TinyBase](https://github.com/tinyplex/tinybase), [Turso](https://github.com/tursodatabase/turso).
- Repository facts (licence, archived, last push, latest release) read from the
  GitHub API on 2026-10-31.
