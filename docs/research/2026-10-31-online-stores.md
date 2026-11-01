# Online stores: Turso (libSQL) or a Durable Object, behind `EffectStore` (research, for the owner to read)

Date: 2026-10-31. Base: `main` at `02475783`. This record surveys and
proposes. Nothing in it is built except the gap nodes it files (§8). It links
to the specs that own each mechanism and does not restate them:

- the store port and both adapters: [DESIGN.md → Storage](../../DESIGN.md#storage-horizontal);
- how a store announces writes, and the tail: [The store announces its own changes](../../DESIGN.md#the-store-announces-its-own-changes), [The transaction tail](../../DESIGN.md#the-transaction-tail--the-store-records-what-changed-in-order);
- the rules this must respect: [AGENTS.md → Rule 1](../../AGENTS.md#rule-1--abstraction-before-addition) and "One contract, every implementation";
- the 50k work the ingest path was just made cheap by: [`2026-10-31-rust-wasm-in-kb.md` §2](2026-10-31-rust-wasm-in-kb.md#2-part-a-the-algorithmic-fixes-in-typescript) (#75 own-write ingest, #77 commits read what they write).

The owner's ask: *more kb backends, so kb can have an online database; Turso
(libSQL) first, possibly SpacetimeDB.* The candidate to weigh Turso against is
a Cloudflare Durable Object with SQLite storage, one object per store.

"unv." marks a claim I could not verify against a primary source or by
running it. Each unv. is listed again in §10.

## 0. The answer

1. **The port already fits a remote store; the tail is the only awkward member.**
   `EffectStore` is async everywhere (`loadEffect`, `fingerprint`,
   `commitEffect`, `changes` are Effects and a Stream) except `txTail`, which is
   synchronous by contract. The browser's `BrowserStore` already solved that for
   a store whose authority is elsewhere: a `MemoryTxTail` mirror. A remote store
   is the same shape with a network behind it (§4).
2. **Foreign commits need no second ingest path.** `store.changes` →
   `ingestExternalWrite` → `reloadEffect` → `log.refresh()` is already how a
   commit by another process reaches the hub. A remote store feeds that same
   lane: the mirror tail receives the authority's records in `rev` order, and
   `changes` announces the new rev (§4.3). Own-write ingest (#75) is untouched:
   an own commit returns a `StoreCommit` and the session's fingerprint memory
   recognises the echo.
3. **Both backends reduce to one small `RemoteAuthority` port**, and the store
   logic (mirror, rank settling, retry on a stale commit) is written once above
   it. `tx.rev` being an `INTEGER PRIMARY KEY` is the compare-and-swap: a
   commit inserts `expected + 1`, and a stale one collides and rolls the batch
   back (§4.2).
4. **Recommendation: Durable Object first, Turso second** (§7). The DO is the
   only one that pushes: commits fan out over hibernating websockets, so "live
   updates in both UIs" is true push, one round trip per commit, one writer, no
   locks. Turso has no push channel to a client (polling at the contract's 1 s
   bound, or beta long-poll sync), and its offline-write sync is
   incompatible with kb's total order of revs (§2.4). Turso is the second
   adapter, which is also what proves the port.
5. **SpacetimeDB: skip. Confirmed, with one correction** (§6). BSL 1.1, a second
   reactive layer, and its migrations block column changes. But *row* deletes
   are first-class there; the awkwardness is destructive schema changes, not
   deletes.
6. **Credentials stay out of the store and the repo**: a committed
   `.kb/remote.json` holds a URL and a `secret` reference (`env:KB_ONLINE_TOKEN`),
   resolved by the process that connects. The remote operator sees every node,
   so the trust level is that of a git collaborator with push access (§5).

### Summary table

| | **Turso / libSQL** | **Durable Object (SQLite)** | **SpacetimeDB** |
|---|---|---|---|
| Fits the store port | yes, as an authority behind `RemoteStore` | yes, same | no: replaces store, hub and query layer |
| Writer model | one primary; HTTP/Hrana from clients | one object = one writer, in-object, serial | server module (reducers) |
| Atomic commit with the tail | yes: one write batch (rev PK = CAS) | yes: synchronous `transactionSync` | n/a |
| Foreign writes reach a client | **poll** (`SELECT max(rev)`), or embedded-replica `sync()`; beta Turso Sync long-poll; no change feed found | **push** over websocket, hibernation-safe | push (subscriptions) |
| Meets `STORE_CHANGES_POLL` (1 s) | yes if polled every 1 s; costs rows read | yes, push is sooner | n/a |
| Commit round trips | 1 with a batch; 5+ with an interactive tx | 1 | n/a |
| Needs deployed code | no (a URL and a token) | yes: a Worker and a DO class (about 100 lines) | yes: a module |
| Offline writes | Turso Sync, beta, last-push-wins row merge: **breaks the tail's total order** | none; reads from a mirror | n/a |
| Free plan (verified, §2.5, §3.1) | 100 DBs, 5 GB, 500 M rows read, 10 M rows written / month | SQLite DOs allowed; 100 k requests, 5 M rows read, 100 k rows written / **day**; 5 GB | self-host only for free |
| Licence | libSQL and Turso Database open source (licence text unv.) | proprietary service; the kb code is ours | BSL 1.1, one production instance |
| Bun | `@libsql/client` 0.18.0 verified, `@tursodatabase/*` 0.8.3 loads (§2.3) | client is plain `WebSocket`/`fetch` | TS SDK lists Bun |
| Maturity risk | Turso Database "not yet 1.0"; Sync beta; embedded replicas "fully supported in production" | DO SQLite is GA | n/a |
| Verdict | **second adapter** | **first adapter** | skip |

## 1. What the store contract needs from a backend

Read from `packages/contract/contracts/src/store.ts` (the canonical
statement) and `DESIGN.md → Storage`. Restated here only as a checklist.

| Member | Needs | Sync? | At startup / incrementally |
|---|---|---|---|
| `loadEffect` | every node, decoded, as of one state; fail-closed on a bad row | async | startup: all of them. After that the session keeps the index and only reloads when the fingerprint moved |
| `fingerprint` | a string naming the state; equal across every instance over the root; `null` compares equal to nothing | async | cheap: a counter or a hash, sampled every 1 s |
| `commitEffect(tx, record, expected?)` | one atomic act: check `expected` against the state merged into, settle ranks (`rankTx`) against that state, write deletes then upserts, append the tail record, return `{base, fingerprint, tx: applied}` | async | incremental: only the nodes the tx names. Since #77 an adapter keeps a `StoreState` and a commit on that state reads nothing |
| `changes` | first element is the current fingerprint once armed; then each *different* one; another writer is announced within `STORE_CHANGES_POLL` (1 s) plus one sample; states, not writers; deduplicated | Stream | incremental |
| `txTail` | `head`, `isCurrent`, `entries`, `since(rev, page)`, `append`, `adopt`. Revs allocated by the store, durable, compaction at 2048 → 1024, never ahead of the nodes | **sync** | incremental: `since` pages |
| `path` | a label | value | |

What follows from it:

- **Transactions.** A commit is one atomic act over the node rows and the tail
  row. SQLite does it with `BEGIN IMMEDIATE`; JSONL with a lock and a
  nodes-first order. A remote store needs the same atomicity at its authority.
- **Ordering.** The tail's `rev` is the total order. It is the *tail's* counter,
  not the fingerprint: `meta.rev` counts row changes and can move without a
  record. Revs must not have holes (a hole reads as compaction).
- **The tx log or the datoms.** Datoms are the session's, derived from nodes in
  memory (`DatascriptIndex`); no store holds them. What the store holds is the
  nodes (`canonicalJson` bodies) and the tail (`ops` as `canonicalJson`). A
  remote store therefore ships nodes and tx records, never datoms.
- **Reads at startup versus incrementally.** Startup is one `loadEffect`
  (O(N) rows). After that the session applies `commit.tx` to its index
  (own write) or rebuilds from `loadEffect` (a foreign state, today
  O(N): `reloadEffect` does `ctx.index.rebuild(loaded)`). The tail lets the
  hub send frames instead of a refetch: `ingestExternalWrite` calls
  `ctx.log.refresh()` and only diffs when the tail explained nothing.
- **Synchronous members are the constraint.** `txTail` is sync "because both
  adapters' primitives are synchronous underneath their Effect wrappers"
  (`tx-log.ts`). A remote cannot be read synchronously, so the tail must be a
  local mirror of the remote's, kept current by the store. That is exactly what
  `BrowserStore` + `MemoryTxTail` do today for the server's tail.
- **The contract is the interface.** A new backend joins `storeContract`,
  `logContract` and `tailContract` in `@kb/test-kit` (the shared suites), and
  `STORE_BACKENDS` in `@kb/runtime`. The "another writer is announced within a
  bound" property is already a contract property, so a remote adapter
  cannot satisfy it by documentation.

## 2. Turso and libSQL

### 2.1 Embedded replicas (local file plus sync)

Primary doc: <https://docs.turso.tech/features/embedded-replicas/introduction>.

- Reads are served from a local file named by `url`. Writes go to the remote
  primary at `syncUrl` by default, and the local file is updated after a
  successful write; the writing replica sees its write at once ("read your
  writes"). `offline: true` allows local writes.
- Other replicas see a write only after `sync()` or the next periodic sync
  (`syncInterval`; the doc's examples use 60 and 300 and do not state the unit).
- Docs say embedded replicas are "fully supported in production", and
  recommend **Turso Sync** for new projects that need sync.
- Caveats from the page: do not open the local database while it is syncing
  (corruption); not usable where there is no filesystem; sync moves 4 kB
  frames, so a one-byte write is a 4 kB write; deleting local files forces a
  full resync. The page does not say whether the file may be opened by another
  SQLite client at the same time (unv.).
- **Verified here** against `sqld` 0.24.33 (libSQL's server, from nixpkgs), a
  local stand-in for Turso Cloud: a replica created with `syncUrl` read the
  primary's rows after `sync()` (3 frames, 7 ms), did **not** see a foreign
  write before `sync()`, and an interactive `transaction("write")` made on the
  replica was forwarded and visible on the primary at once. Triggers created on
  the primary (a `meta.rev` bump, like `SqliteStore`'s) fired and replicated.
  Not tested: Turso Cloud itself, and opening the replica file with
  `bun:sqlite` read-only (unv.).

### 2.2 Turso's offline write sync: maturity and status

- **Turso Sync** (`@tursodatabase/sync`; Python `turso.sync`; Go `tursogo`):
  local database, explicit `push()` and `pull()`. Push sends *logical*
  statements; pull fetches physical pages. Conflict resolution is
  **last push wins**, row-level, with a `transform` hook for other strategies;
  the remote is the source of truth and peer-to-peer sync is not supported
  (launch post, 2025-10-08, <https://turso.tech/blog/introducing-databases-anywhere-with-turso-sync>).
  The doc page adds: "COMMITTED WRITE transactions which overlap with WRITE
  transactions that are still open MAY be delayed"
  (<https://docs.turso.tech/sync/usage.md>).
- **Status.** The October 2025 post calls it a "Beta launch" (only Clerk and
  Auth0 as OIDC providers in beta). The earlier March 2025 offline-sync post was
  explicit: "beta quality, and not yet recommended for production use … no
  durability guarantees, which means data loss is possible", with conflict
  *resolution* not yet implemented
  (<https://turso.tech/blog/turso-offline-sync-public-beta>). That post used the
  older `@libsql/client` offline mode and may be stale; the current docs page
  states no beta label, so **current status is unv.**
- `pull()` returns whether anything changed; `connect` takes
  `longPollTimeoutMs` (the post's example: 5000), "how long the server waits
  before answering a pull". That is long polling, so a pull loop is near-push.
  The docs do not describe it further (unv.).

### 2.3 The Rust "Turso Database" engine versus libSQL

- libSQL is a fork of the C SQLite. **Turso Database** is a ground-up Rust
  rewrite; its README says it has "not yet reached 1.0", lists SQLite
  compatibility, `BEGIN CONCURRENT` (MVCC), CDC and exact vector search as
  stable-labelled, and encryption at rest, full-text search, DBSP and
  multi-process WAL coordination (`.tshm`) as experimental. It says Turso
  Database is "where our development effort is focused", that it powers
  production applications (Turso Cloud among them), and that libSQL "has been
  battle-tested for longer"; it recommends independent backups
  (<https://github.com/tursodatabase/turso>).
- Embedded replicas are libSQL. **Turso Sync is built on the new engine**
  (embedded-replica page: "built on the Turso Database engine, … logical
  change-data-capture").
- **Bun, verified** on Bun 1.4.2, Linux x64, in a scratch directory:
  - `@libsql/client` 0.18.0: `file:` mode works, including an interactive
    write transaction; remote mode (Hrana over HTTP) against `sqld` works,
    including interactive transactions; `syncUrl` embedded-replica mode loads
    its native addon and attempts the network (it fails with a DNS error when
    the host is dead), and against `sqld` it synced (§2.1).
  - `@tursodatabase/database` and `@tursodatabase/sync` 0.8.3: both load under
    Bun; the local database ran a query; `connect()` to a dead URL failed with
    a fetch error from the sync engine. No end-to-end sync was run (unv.).
  - So both clients can be used by kb's Bun runtime. The native addons are
    per-platform prebuilds (`@libsql/linux-x64-gnu` etc.); the Nix build and
    `bun.nix` would need them (unv.).

### 2.4 How a client learns of remote writes

| Mode | Learns by | Latency | Fits `changes` (1 s bound)? |
|---|---|---|---|
| Plain remote client (`url: libsql://…`) | **polling** the fingerprint (`SELECT max(rev) FROM tx`) | the poll interval | yes at 1 s; costs about 2.6 M row reads per client-month (free allows 500 M) |
| Embedded replica | `sync()` (manual or `syncInterval`) | seconds to minutes as documented; 7 ms per call locally when idle | only if `sync()` is called every second, which is polling with extra steps |
| Turso Sync (beta) | `pull()`, optionally long-poll (`longPollTimeoutMs`) | near-push, unv. | probably; beta |
| A change feed / subscription to a client | **none found** in the docs I read (unv.) | | |

So Turso answers "none" for push, and the best honest design is a 1 s poll of
one row. That is the same shape `fingerprintChanges` already has for the file
stores (an event-less poll as the bound), minus the directory watch.

**Offline write sync does not compose with kb's tail.** kb's tail is a total
order: `tx.rev INTEGER PRIMARY KEY`, assigned by the store, with no holes.
Two devices that both write offline each allocate "rev 5"; Turso Sync would
merge rows last-push-wins, so one device's `tx` row, and the `meta.rev`
counter, overwrite the other's, or collide. The nodes would merge row by row
and the history would not. Making offline writes work means assigning revs at
push time, which is a change to the tail's contract, not to a backend. Not
recommended (§8, G4).

### 2.5 Free-plan limits (verified)

<https://turso.tech/pricing>, read 2026-10-31. Free: **100 databases, 5 GB
storage, 500 M rows read / month, 10 M rows written / month, 3 GB monthly
syncs**. Paid: Developer $4.99, Scaler $24.92, Pro $416.58 per month. A query
over a limit fails with a `BLOCKED` error
(<https://docs.turso.tech/help/usage-and-billing>). How a trigger's write or an
index entry counts toward rows written is unv.; assume 3 to 4 rows per node
change (the node, its primary-key index, the tail row, the rev bump) as a
budget: 10 M rows is on the order of 2.5 M node writes a month.

## 3. A Cloudflare Durable Object with SQLite storage

### 3.1 Availability and limits (verified)

<https://developers.cloudflare.com/durable-objects/platform/pricing/>,
<https://developers.cloudflare.com/durable-objects/platform/limits/>,
read 2026-10-31.

- **Free plan: yes, SQLite-backed only** (the key-value backend is paid only).
  Daily limits, reset at 00:00 UTC; exceeding one blocks that operation:
  **100,000 requests/day; 13,000 GB-s/day; 5 M rows read/day; 100,000 rows
  written/day; 5 GB SQL storage per account**.
- Paid: 1 M requests then $0.15/M; 400,000 GB-s then $12.50/M; 25 B rows read
  and 50 M rows written included, then $0.001 / $1.00 per M; storage $0.20 per
  GB-month after 5 GB-month. (Workers Paid, $5/month, unv. re-checked.)
- Websocket billing: an incoming message is 1/20 of a request; creating a
  connection is a request; outgoing messages and protocol pings are free. An
  object that can hibernate pays no duration while idle.
- Limits that bite kb: **2 MB per string/BLOB/row**, 100 columns, **100 KB per
  SQL statement, 100 bound parameters per query**, key+value 2 MB, ~1,000 req/s
  soft per object, 32 MiB received websocket message, 30 s CPU per request
  (resets on each message).
- Per-object storage reads 10 GB on paid; the same page says 1 GB on free in
  its `SQLITE_FULL` section while its table says 10 GB, so **the free per-object
  cap is unv.**
- The Worker in front is separate: Workers Free is 100,000 requests/day and
  10 ms CPU per request, 128 MB, 50 subrequests
  (<https://developers.cloudflare.com/workers/platform/limits/>). Whether an
  incoming websocket counts against that daily request limit is unv.

For kb: the 100 bound-parameter cap is why a commit is a loop of statements,
not one multi-row `INSERT`; the 2 MB row cap is a hard ceiling on one node's
`canonicalJson` (gallery nodes with inlined content could meet it; unv.).
Rows written is the binding free-plan limit: at the same 3 to 4 rows per
node change, 100 k/day is on the order of 25–30 k node writes a day. A 5k-node
import fits; a 50k-node import does not on one free day.

### 3.2 Storage and the API from a Worker

- One object per store, addressed by name (`idFromName(storeId)`), reached from
  a Worker through a stub; the Worker authenticates, then forwards the request
  (`stub.fetch`). `idFromName` and location pinning are not on the page I read
  (unv. detail).
- `ctx.storage.sql.exec(query, ...bindings)` returns a cursor
  (`toArray`, `one`, `raw`, `rowsRead`, `rowsWritten`); **it is synchronous**.
  Cursors must be consumed before an `await` (no snapshot isolation across it).
  `exec` cannot run `BEGIN` or `SAVEPOINT`; use `ctx.storage.transactionSync(fn)`,
  which rolls back on a throw. Each storage call is already atomic, and the
  input and output gates make a read-then-write with no `await` in between
  behave like a transaction.
- **That is the same shape as `bun:sqlite`.** The `SqliteStore` commit core
  (`commitTx`: staleness check, deletes, upserts, tail append, in one
  synchronous transaction) is expressible nearly verbatim over `sql.exec`
  and `transactionSync`. This is why the DO fits as an authority without
  becoming a second implementation of the tail (§4.2).
- SQLite features per the page: FTS5, JSON, math functions. **Triggers are not
  mentioned** (unv.): do not depend on a `meta.rev` trigger in the DO; the
  fingerprint can be the tail's head (§4.2).
- Point-in-time recovery: `getCurrentBookmark`, `getBookmarkForTime` (last
  30 days), `onNextSessionRestoreBookmark`; not available in local development;
  free-plan availability unv. That is the undo story for a shared store.

### 3.3 Websocket hibernation, for pushing changes

<https://developers.cloudflare.com/durable-objects/best-practices/websockets/>,
<https://developers.cloudflare.com/durable-objects/api/state/>.

- `ctx.acceptWebSocket(ws, tags?)` (up to 10 tags) attaches a socket under the
  Hibernation API; `webSocketMessage` and `webSocketClose` handlers; and
  `ctx.getWebSockets(tag?)` enumerates the live ones, which is the fan-out:
  after a commit, `for (const ws of ctx.getWebSockets()) ws.send(frame)`.
- While every socket is idle the object is evicted from memory and not billed
  for duration; an incoming message wakes it and **re-runs the constructor with
  in-memory state reset**. Per-connection state survives in
  `serializeAttachment` (16 KiB, not 2 KB). The object must therefore hold no
  state outside SQLite: the head rev and the sockets' last-acked revs are
  derived or attached.
- `setWebSocketAutoResponse(request, response)` answers a keepalive without
  waking the object and without a charge; use it for the client's heartbeat.
  Timers, alarms and `setInterval` prevent hibernation.
- **The push is cheap on the free plan**: outgoing messages are free, so a
  read-mostly store costs a connection request and a fraction of a request per
  client write.

### 3.4 How a local kb talks to it, and offline behaviour

- **Remote store, not sync.** The client is a `RemoteStore` (§4) holding a
  websocket to the object, through the Worker. No local copy is authoritative.
  Nothing here is a replica that can diverge.
- The wire reuses vocabulary kb already has between `kb ui` and a tab
  (`packages/contract/contracts/src/protocol.ts`): `hello {rev}`, `since {rev}`,
  `tx` (a frame), `snapshot-required {head}`, `ping`/`pong`. The object speaks
  that subset to a watching kb process.
- **Offline.** Reads: the mirror (§4.1) lives in memory; the process can keep
  answering from it while disconnected. Writes: refused while disconnected,
  with an error that says so (there is no `FailureCode` for it today; see
  Questions). A cold start offline has nothing to read unless a mirror was
  persisted (G3). Reconnect: `hello` with the mirror's head; the object sends
  the records past it, or `snapshot-required`, and the mirror re-adopts.
- Latency: one commit is one round trip to the object's region (the object is
  pinned near where it was first used; `locationHint` exists, unv.).

## 4. The hard part: remote changes into the subscription hub

### 4.1 What exists

Today kb trusts its own writes and tolerates foreign ones:

- **Own commit.** `persistEffect` calls `store.commitEffect`; when
  `commit.base` equals the fingerprint the session had read, it applies
  `commit.tx` to the index and stamps `seen` with `commit.fingerprint`
  (`session.ts`). `ctx.log.refresh()` then adopts the record the store appended.
  When `base` is not what the session had read, `seen` is forgotten and
  `reloadEffect` re-reads.
- **Foreign commit.** `ctx.store.changes` is ingested by `ingestEach`, one at a
  time: `ingestExternalWrite` → `reloadEffect` (compares the fingerprint to
  `seen`; if equal, it is the echo of our own write and does nothing; else
  `loadEffect`, `index.rebuild`) → `ctx.log.refresh()` (the tail explains the
  change, and the hub sends frames) → only if the tail explained nothing,
  `diffTx` of old and new.
- **A replica store exists.** `BrowserStore`
  (`packages/app/ui/src/session/browser-store.ts`): in-memory `StoreState`, a `MemoryTxTail` ("the server's
  tail is the durable one"), a generation counter as fingerprint, and a
  `commitEffect` with `staleCommitError`, `rankTx` and a tail append.

### 4.2 The design: one `RemoteStore` over one `RemoteAuthority` port

Rule 1 says one mechanism per concept. Turso and the DO differ in transport,
not in what they are asked: *hold the nodes, hold the tail, serialise commits,
say when something moved.* So the concept is a port the authority
implements, and the store logic is written once above it.

```ts
// packages/contract/contracts/src/remote-authority.ts (proposed)
interface RemoteAuthority {
  /** Nodes and the tail's records, as of one rev. Paged by bytes. */
  readonly snapshot: Effect<{ rev: number; nodes: KbNode[]; tail: KbTx[] }, DomainError>;
  /** Records after `rev`, or "snapshot-required" (compacted past it). */
  since(rev: number, page?: TxPage): Effect<KbTx[] | "snapshot-required", DomainError>;
  /**
   * One atomic act: lands only if the head is `expectedRev`. Writes the deletes,
   * upserts (bodies are canonicalJson), and tail row `expectedRev + 1`.
   * A stale `expectedRev` is `{stale: headNow}`, not a throw.
   */
  append(expectedRev: number, tx: StoreTx, record: TxRecord): Effect<KbTx | { stale: number }, DomainError>;
  /** Heads as they move: the current one once armed, then each change. */
  readonly heads: Stream<number>;
}
```

`RemoteStore implements EffectStore` over it:

- **Mirror.** A `StoreState` and a `MemoryTxTail` (adopted from `snapshot`).
  `fingerprint` is `String(mirror head)`; the same string at every instance
  over the store, as the contract requires. `loadEffect` is the mirror.
- **`commitEffect(tx, record, expected?)`**: `ifRev = mirror head`; if
  `expected` is given and differs from `String(ifRev)`, `staleCommitError`
  (conditional commits fail without a network call, exactly the existing
  rule). Else `applied = rankTx(mirror, tx)` and `authority.append(ifRev,
  applied, record)`. On `{stale}` the store catches up (`since`), re-ranks
  against the new mirror, and retries (bounded, e.g. 5; then `conflict`). The
  `StoreCommit.base` is `String(ifRev)` of the attempt that landed, so the
  session's "was that the state I had read?" test works unchanged; the
  returned `tx` is the ranked one.
- **Ranks.** Settled client-side against the mirror, because the authority
  stores opaque bodies and never decodes a node. That is the entire reason the
  DO needs neither `@kb/model` nor Effect (bundle size on a Worker is the
  risk otherwise; unv.), and why Turso needs no stored procedure.
  The "two writers that appended from the same read never leave siblings
  sharing a rank" property holds because the second writer's commit is refused
  as stale and re-ranked.
- **`txTail` is the mirror.** Each record the authority sends is appended in
  order. `MemoryTxTail.append` assigns `head + 1`; as long as records arrive
  contiguously from an `adopt`ed snapshot the locally assigned rev **equals**
  the authority's, and the store asserts it (`rev === head + 1`), resyncing from
  a snapshot on a gap. No new tail member is needed.
- **`changes`** is `authority.heads` mapped to `String(rev)` after the mirror has
  applied the records up to it; the first element is the mirror's fingerprint
  once the subscription is live ("armed, then news"), then `Stream.changes`.

**Authority implementations.**

- **Durable Object.** `append` is one `transactionSync`:
  `SELECT MAX(rev) FROM tx`, compare with `expectedRev`, `DELETE`/`INSERT … ON
  CONFLICT DO UPDATE` over `nodes(id, body)`, `INSERT INTO tx`, compact when
  past 2048. Then broadcast the new record to `ctx.getWebSockets()`. `heads` is
  the websocket. Single writer: the object's event loop. No lock, no busy
  timeout, no `meta.rev` trigger (the fingerprint is the tail's head).
- **Turso.** `append` is one `client.batch([...], "write")`: deletes, upserts,
  and `INSERT INTO tx (rev, …) VALUES (expectedRev + 1, …)`. `tx.rev` is the
  primary key, so a stale commit collides on it and the **whole batch rolls
  back**: the compare-and-swap is the key, and no interactive transaction (which
  holds the primary's write lock across several network round trips) is needed.
  A constraint error maps to `{stale}` after one `SELECT MAX(rev)`. (The
  collision-rolls-back-the-batch behaviour is a property of SQLite batches I am
  confident of and did not exercise on Turso Cloud: unv.) `heads` is a 1 s
  `SELECT MAX(rev) FROM tx` poll, deduplicated. 
- **Same schema as `SqliteStore`** (`nodes(id, body)`, `tx(…)`; `meta` for
  `schema_version`), so a remote database and a `.kb/kb.sqlite` are mutually
  loadable by `kb store migrate`. Per Rule 1 the DDL and row codecs are one
  module both the local store and the authorities import (the first,
  behaviour-preserving commit of §7).
- **One contract suite.** `authorityContract(name, makeAuthority)` in
  `@kb/test-kit` (append-lands, stale-collides, since-after-compaction,
  heads-armed-then-news, two-writers-never-share-a-rank), run over an in-memory
  authority, the DO, and Turso. `RemoteStore` then joins `storeContract`,
  `logContract` and `tailContract` over each. "A guarantee that one adapter
  keeps and another breaks makes it go red."

### 4.3 How foreign commits arrive, are ordered, and merged

| Step | What happens | Reuses |
|---|---|---|
| 1. Peer commits | peer's `append` lands at rev r+1; the authority broadcasts the record (DO), or the next 1 s poll sees head r+1 (Turso) | |
| 2. Our mirror applies | the `RemoteStore` fetches `since(r)` if it only has a head, applies each record to `StoreState`, appends to the mirror tail in order | `StoreState.apply`, `MemoryTxTail.append` |
| 3. Announce | `changes` emits `String(r+1)` | `EffectStore.changes` |
| 4. Ingest | `ingestExternalWrite`: `reloadEffect` sees a fingerprint ≠ `seen`, calls `loadEffect` (the mirror: no network), rebuilds the index; `ctx.log.refresh()` adopts the mirror's new records and notifies the hub; each tab gets a `tx` frame | **the existing lane, unchanged** |
| 5. Our own commit's echo | the authority also pushes our record back; the mirror has it already (rev ≤ head, dropped); `changes` emits nothing new; `reloadEffect` finds fingerprint = `seen` and returns `null` | #75 own-write ingest, unchanged |

- **Ordering.** The authority's `rev` is the only order. Commits are serial at
  the authority, so there is no merge of histories to do.
- **Merging.** The same as across processes today: a commit is whole-node
  upserts and deletes merged into whatever state the authority has. Two
  machines editing *different* nodes both land. Two machines editing the *same*
  node: the later commit wins that node whole (no field-level merge exists
  today, between processes either). A planned write (`persistPlannedEffect`)
  passes `expected` and is re-planned up to three times on a stale state
  (`PLANNED_ATTEMPTS`); an unplanned one is not conditional and lands over the
  other. A deleted-then-edited node is resurrected by the edit, as it is today.
  No new conflict behaviour is introduced; that is the point.
- **A conflict inside `RemoteStore`** is only the stale `append` (a race with a
  peer between our last frame and our commit). It is resolved by catch-up,
  re-rank and retry, below the session. It surfaces as `conflict` only after
  the bound, with the same details as `staleCommitError`.
- **Cost.** Step 4 is O(N) on the index (`index.rebuild`) per foreign commit, the
  same cost the SQLite store pays today for a CLI write. At 5k nodes this is
  tens of milliseconds; at 50k it is the whole-graph cost the perf record
  already named. A peer typing at keystroke rate makes this the first thing
  that hurts. The fix is incremental foreign ingest (apply `since` records to
  the index with `applyTx` when the mirror was current), a change to
  `reloadEffect`, not a second path beside it. G2.
- **Reconnect and gaps.** `hello {rev}` → `since`, or `snapshot-required`
  when the authority compacted past the mirror: `snapshot` is read, the state
  and tail replaced, and `changes` emits; `KbTxLog` already answers
  `snapshot-required` to tabs when the tail is behind. Compaction numbers are
  the port's (2048 → 1024).

### 4.4 Where this bends the existing model

- **The saved-query virtual set appends to the store's tail.** `SavedQuerySet`
  calls `ctx.log.append`, which on a store whose tail is the mirror would
  allocate rev `head + 1` locally, and the authority's next record would collide
  with it. A remote root must hold no saved queries until that set stops using
  the store's rev space (G5). The prototype uses a root without
  `.kb/queries/*.edn`; `sync` of an empty set appends nothing.
- **`FailureCode`** has no "unavailable" (`DomainError` has no `invalid_state`
  either; DESIGN says why a new code is costly). Offline writes use `internal`
  with `{offline: true}` in the details until the owner decides.
- **Presence-based selection** ([Choosing an adapter](../../DESIGN.md#choosing-an-adapter--presence-not-configuration))
  needs a selecting file for a store with no data file: `.kb/remote.json`, the
  pointer. Same table, one more row: it with neither other file → `RemoteStore`;
  with either → the existing `conflict`, naming both paths.

## 5. Security

### 5.1 Credentials

- kb has a `secret` field type: a reference (`env:NAME` or
  `keychain:<service>[/<account>]`, `packages/domain/model/src/secret-ref.ts`),
  never a key, resolved only by the process that needs it through its
  `SecretSource` (`@kb/contracts` `secrets.ts`; `systemSecrets` in `@kb/runtime`).
  The remote store follows it: `.kb/remote.json` (committed) is

  ```json
  { "kind": "durable-object", "url": "wss://kb-online.<account>.workers.dev/s/<store-id>",
    "token": "env:KB_ONLINE_TOKEN" }
  ```

  or `{ "kind": "turso", "url": "libsql://<db>-<org>.turso.io", "token": "env:TURSO_AUTH_TOKEN" }`.
  The value lives in the owner's env file (not committed) or the keychain.
  `selectStore` is an Effect over `FileSystem` and has no `SecretSource`; the
  store receives a `resolveToken` effect and calls it on first connect, so selecting
  a root never needs a secret.
- **Server side.** The DO is reached only through a Worker, which checks a
  bearer token against a Worker secret; with Alchemy the secret is bound from
  the deploy environment (`alchemy.secret`, unv. current API: the docs have a
  `new DurableObjectNamespace(…, {sqlite: true})` form and an older v1 form
  without `new`; check the installed version). Turso: a database token from
  `turso db tokens create`; read-only and expiring tokens exist (unv. flags).
- **Transport.** TLS both ways. Never put the token in the URL or query:
  Cloudflare logs URLs. Send it as an `Authorization` header (Bun's
  `WebSocket` accepts a `headers` option, unv.) or as the first message before
  any other frame.
- **Not logged.** Errors name the reference (`secretRefLabel`), never a value;
  the existing rule for `SecretError`.

### 5.2 Trust

- **The remote operator reads and writes every node.** Cloudflare or Turso
  holds the graph in plaintext (Turso encryption at rest is experimental in the
  new engine; Cloudflare encrypts at rest at the platform level, unv.). Secrets
  are references, so keys never reach it, but the graph may.
- **A peer is a git collaborator with push access, not less.** Foreign commits
  are ingested without the system-write rule or interception: those guard the
  commit owner (`persistEffect`), and a remote's records enter through the
  mirror. A holder of the token can write a `sys.*` node, or a code view with a
  broad `CodeGrant`, and your process will load it. Code views run under the
  sandbox and are shown, not run, on text surfaces, but a grant is data. That is
  the same exposure as pulling someone's `nodes.jsonl`; it is not a new class,
  and it argues for one store per trust boundary and for the token never being
  shared.
- **Mitigations the prototype does not need but the record names.** The
  authority can refuse writes to `sys.*` ids (it sees ids even if it never
  decodes bodies); a read-only token for a reader process; per-store tokens.
  Per-node ACLs are out of scope and would be a model change.
- **Availability and loss.** A quota is a hard stop (DO: blocked for the day;
  Turso: `BLOCKED`), and the mirror makes a stop a read-only session, not a
  crash. A backup is `loadEffect` into a local store (`kb store migrate`-shaped);
  DO point-in-time recovery is a second line (§3.2).

## 6. SpacetimeDB: confirm or refute

**Confirmed: skip for kb.** One correction.

- **Licence.** Business Source License 1.1 on 2.14.0, additional use grant:
  production use is allowed for "no more than one SpacetimeDB instance in
  production" and not as a "Database Service" (a commercial offering that lets
  others create tables whose schemas they control); change date 2031-10-25, to
  AGPL v3 with a linking exception; "applies separately for each version"
  (<https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt>). So
  kb itself could run one instance, but the licence is a constraint a store
  adapter should not impose on whoever runs kb.
- **It duplicates kb's reactive layer and server logic.** Subscriptions are
  row-level pushes into a client cache with `onInsert/onDelete/onUpdate`
  (<https://spacetimedb.com/docs/clients/subscriptions>); kb already has
  frames from a rev-ordered tail, a hub and a query engine, and its server
  logic is actions, which a SpacetimeDB module (reducers) would replace rather
  than sit under. Using it as a dumb row store would pay for the runtime and
  lose the reason to have it. (That reducers are the only write path is
  unv.: the page I read does not say.)
- **Migrations: partly right, with a correction.** Automatic migrations allow
  adding tables, indexes and reducers, and a column only at the end with a
  default. They **block** removing or changing a column, removing a non-empty
  table, and adding a column without a default or a unique/primary-key
  constraint; the dev reset is `--delete-data`
  (<https://spacetimedb.com/docs/databases/automatic-migrations>). **Row
  deletes are normal** (`onDelete` callbacks); the awkwardness is destructive
  *schema* change, not deleting data. kb's `nodes(id, body)` shape would never
  change columns, so the migration objection mostly disappears, which leaves
  the licence and the duplicated layers as the reasons to skip.

## 7. Recommendation and the smallest prototype

**Durable Object first, Turso second, SpacetimeDB never.** The prototype proves
the owner's test: two kb processes editing one store, both UIs updating live.

Three commits, as AGENTS.md asks ("restructure, then add, as separate
commits"), in one PR or three:

1. **Restructure (behaviour-preserving).** Move the SQL both the local store
   and the authorities share into one isomorphic module: the DDL, the
   `nodes`/`tx` statements and the `tx` row codec out of
   `packages/infrastructure/store-sqlite/src/{connection,tx-tail}.ts`. Proved by
   the existing `storeContract`/`logContract`/`tailContract` runs on SQLite
   staying green. If the iso preset makes the package awkward, say so and stop
   (Rule 1: a named gap, not a stopgap).
2. **The port, the mirror store, the in-memory authority.** Adds, and nothing else:
   - `packages/contract/contracts/src/remote-authority.ts` and its export from
     `src/index.ts` (the `RemoteAuthority` port, §4.2);
   - `packages/infrastructure/store-remote/` (`@kb/store-remote`; `RemoteStore`,
     `scope:backend`; depends on `@kb/model`, `@kb/contracts`, `@kb/tx-log`);
   - `packages/app/test-kit/src/authority-contract.ts` (+ `index.ts` export), an
     in-memory authority, and `RemoteStore` joining `storeContract`, `logContract`
     and `tailContract` over it: the contract before any network;
   - `packages/app/runtime/src/store-selection.ts`: a third `BACKENDS` row,
     `remote`, selected by `.kb/remote.json` (`STORE_BACKENDS`, `files`, the
     "two stores" rule); `packages/app/runtime/src/secrets.ts` consumed for the
     token (no change expected).
3. **The DO authority and the proof.**
   - `packages/infrastructure/store-remote-do/` (the Worker + `KbStoreObject`:
     `append` via `transactionSync`, `acceptWebSocket`, `getWebSockets()`
     broadcast, `setWebSocketAutoResponse` heartbeat) and the websocket client
     adapter in `@kb/store-remote`. A new scope for a Worker may be needed:
     `scope:shared` forbids `node:`/`bun:` but has no `types`, so
     `DurableObject` types need a deliberate harness decision
     (`harness/src/constraints.ts`), made in its own commit. See Questions.
   - A deploy file, outside the workspace (e.g. `deploy/online-store/alchemy.run.ts`),
     because the owner's Alchemy setup is theirs; the PR does not deploy.
   - Tests: the authority contract over the DO class driven in-process by
     Cloudflare's local runtime (`workerd`/`wrangler dev`, unv. which harness),
     and `packages/app/server/tests/remote-sync.test.ts`, modelled on
     `cross-process-sync.test.ts`: two `kb ui` servers on two roots with the same
     `.kb/remote.json`, a write on one arriving as a WS `tx` frame on the other,
     within the contract's 1 s.

**Exit test** (the owner's): `bun run verify` green; `kb ui` in two checkouts (or
two machines) with the same pointer file and token; an edit in one UI appears
in the other in about a second without a reload; kill one machine's network,
keep reading, restore, and it catches up by `since` or a snapshot; a write
while disconnected is refused with a message that says why.

**Turso follows** as `packages/infrastructure/store-remote-turso/`: an authority
over `@libsql/client` (`batch` + 1 s `MAX(rev)` poll), joined to the same
`authorityContract`. That is where the port is proven to be one concept and not
a DO wrapper, and it is the no-deploy option.

**Why not Turso first, given the ask.** It would work and meet the 1 s bound by
polling. But it is the weaker answer to "live updates", it offers no place to
put the push, its offline sync cannot be used (§2.4), and the DO is the shape
the owner's new Alchemy/Cloudflare setup already deploys. If the owner prefers
no deployed code, the order flips with no change to the port.

**What not to build:** Turso Sync / offline writes (needs revs assigned at push,
a tail-contract change); embedded replicas (reads are already local after the
first load; a persisted mirror, G3, is the version of that kb needs); a
field-level merge; SpacetimeDB.

## 8. Gaps

Filed as `#gap` nodes in this record's commit (`kb add … --tag gap`):

- **G1** `01M6950VPS4MH8NWDWB4ZF9CP1` — kb can have no store but files in its root: two machines share a
  graph only through git. (closes: this record's prototype.)
- **G2** `01M6950WQN8VDWJMSH8EZ8X3DR` — a foreign commit reloads the whole graph (`reloadEffect` →
  `index.rebuild`). Cheap for a CLI write, painful at a peer's keystroke
  rate. (closes: incremental foreign ingest from the tail, in `reloadEffect`.)
- **G3** `01M6950XSKGDE356Q8RK622WKQ` — a remote root has no persisted mirror: it cannot start offline, and
  a quota stop leaves nothing to read after a restart.
- **G4** `01M6950YQJFX3TYG608GNVHRX4` — offline writes to a shared store are unsupported: the tail is a
  total order with revs assigned by the store, which offline devices cannot
  do. (closes: assigning revs at push, a tail-contract change; not
  recommended.)
- **G5** `01M6950ZTT4AQNADV0RVM9JSW1` — the saved-query virtual set appends to the store's tail, which a
  remote root does not own.

## 9. Questions for the owner

1. **DO first, or Turso first?** The record recommends the DO (push, the shape
   your Alchemy setup deploys). Turso first needs no deployed code and keeps
   the same port.
2. **Who deploys?** The PR proves the DO locally and contains a deploy file; it
   does not deploy. Do you deploy it, or want the prototype thread to?
3. **A new scope for the Worker package?** `scope:shared` has no `types`, so a
   Worker needs either ambient `DurableObject` declarations or a `scope:worker`
   row in `harness/src/constraints.ts`. The record prefers the second, in its
   own commit.
4. **Offline writes: refuse or queue?** The record refuses (G4). A queue needs
   revs assigned at push. Which do you want if a flight matters?
5. **An error code for "remote unreachable"?** Today only `internal` with
   details; a new `FailureCode` widens the receipt mapping and the wire.

## 10. What I could not verify (unv.)

- Turso Cloud itself: the Bun checks ran against `sqld` 0.24.33, not Turso
  Cloud; behaviour of rows-written accounting for triggers and indexes; whether
  a batch whose primary-key insert collides rolls back identically over Hrana
  on Cloud; read-only and expiring token flags; the free plan's idle policy.
- Whether a libSQL embedded-replica file can be opened by `bun:sqlite`
  read-only; whether the Nix build and `bun.nix` can carry the `@libsql/*` or
  `@tursodatabase/*` native prebuilds.
- Turso Sync's current status label (beta or not), `longPollTimeoutMs`
  semantics, and `@tursodatabase/*` end-to-end sync under Bun (they load and
  run local queries; sync was not run).
- DO: triggers in DO SQLite; whether the free per-object cap is 1 GB or 10 GB;
  PITR on the free plan; whether incoming websockets count against the Worker's
  daily request limit; `idFromName` and `locationHint` specifics; Bun's
  `WebSocket` `headers` option; whether `@kb/model` and Effect bundle within a
  Worker's size limit (the design avoids it by keeping node decoding on the
  client).
- Alchemy: the current `DurableObjectNamespace` API (the docs have two forms).
- SpacetimeDB: that reducers are the only write path; hosting prices.

## Sources

- Turso: [embedded replicas](https://docs.turso.tech/features/embedded-replicas/introduction),
  [Sync usage](https://docs.turso.tech/sync/usage.md), [Sync](https://docs.turso.tech/sync),
  [usage and billing](https://docs.turso.tech/help/usage-and-billing),
  [pricing](https://turso.tech/pricing),
  [offline sync beta, 2025-03-31](https://turso.tech/blog/turso-offline-sync-public-beta),
  [Turso Sync beta, 2025-10-08](https://turso.tech/blog/introducing-databases-anywhere-with-turso-sync),
  [Turso Database](https://github.com/tursodatabase/turso).
- Cloudflare: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
  [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
  [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
  [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
  [DurableObjectState](https://developers.cloudflare.com/durable-objects/api/state/),
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Alchemy: [DurableObjectNamespace](https://alchemy.run/providers/cloudflare/durable-object-namespace),
  [v1 guide](https://v1.alchemy.run/guides/cloudflare-durable-objects/).
- SpacetimeDB: [LICENSE](https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt),
  [automatic migrations](https://spacetimedb.com/docs/databases/automatic-migrations),
  [subscriptions](https://spacetimedb.com/docs/clients/subscriptions).
- Local runs (2026-10-31, Bun 1.4.2, Linux x64, scratch directory, `sqld` 0.24.33):
  `@libsql/client` 0.18.0 file, remote and replica modes; `@tursodatabase/database`
  and `/sync` 0.8.3 load.
