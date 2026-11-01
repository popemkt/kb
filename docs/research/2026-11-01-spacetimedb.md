# SpacetimeDB for kb: what it covers, four topologies, and SurrealDB for graph queries (research, for the owner to read)

Date: 2026-11-01. Base: `main` at `ded4a366`. This record surveys and
proposes; nothing in it is built. Its canvas is in the owner's home store:
*SpacetimeDB for kb — topologies (2026-11-01)*, node
`01M6AYBFGZK9PMGXHQA792ZY1X`. It builds on, and does not restate:

- [`2026-10-31-online-stores.md`](2026-10-31-online-stores.md) (kb#84):
  the `RemoteAuthority` port, the Durable Object design, and its §6 verdict on
  SpacetimeDB ("skip"), which §10 here corrects in part;
- [`2026-10-31-offline-first.md`](2026-10-31-offline-first.md) (kb#85):
  "git for the graph" — local store, persisted base, `SyncAgent`,
  `mergeNodeSets`, CAS push;
- [`2026-10-31-rust-wasm-in-kb.md`](2026-10-31-rust-wasm-in-kb.md) (kb#78):
  where kb's time goes at 50k nodes;
- axioms' live mode on SpacetimeDB 2.14 (`~/Projects/axioms`,
  `docs/DESIGN.md` → SpacetimeDB), which is our own experience with it.

Specs that own each mechanism: the store port, tail and changes —
[DESIGN.md → Storage](../../DESIGN.md#storage-horizontal); the query layer and
`reach` — [DESIGN.md → Query layer](../../DESIGN.md#query-layer-horizontal);
trace — [DESIGN.md → Trace and suggest](../../DESIGN.md#trace-and-suggest);
the browser replica — [DESIGN-UI.md → Replica sync](../../DESIGN-UI.md#replica-sync).

The owner's question, verbatim: *"I heard SpacetimeDB is very fast; maybe it
covers a lot of the functionality we built ourselves. Is there a deployment
topology that actually makes use of a SpacetimeDB server?"* Added later: a
dedicated list of SpacetimeDB's kinks; whether kb's graph queries can run on it;
and, if they cannot, SurrealDB compared the same way.

"unv." marks a claim I could not verify against a primary source or by running
it; §12 lists them. SpacetimeDB facts are from spacetimedb.com docs, its blog,
and the GitHub repository at `master` = v2.14.0 (released 2026-10-30), read on
2026-11-01. Nothing was benchmarked: the host's load was above 12 during the
research, and the brief says research-heavy, light on the machine.

## 0. The answer

1. **SpacetimeDB covers kb's transport, not kb's model.** It is a serial,
   transactional, in-memory writer that pushes row changes to subscribed
   clients. That is what kb's `SubscriptionHub` and the planned sync authority
   do. It does not cover datalog, recursive `reach`, trace, extensions, the
   action registry, or the offline merge (§3).
2. **Its speed is spent where kb is not slow.** kb's costs at 50k nodes are on
   the client: DataScript's index build (~2.8 s) and cold queries (150–760 ms),
   and the O(N) ingest of every foreign commit (kb#78, kb#84 G2). A faster
   server commit does not touch them (§7).
3. **One topology uses an STDB server well: C**, SpacetimeDB as the sync
   authority behind kb#85's local-first loop, a second adapter of the
   `RemoteAuthority` port beside the Durable Object. It keeps the `.kb/`
   folder, offline writes and the MIT stack, and it runs on software the owner
   already operates (§6).
4. **A (STDB as store + hub) and B (kb as an STDB module) are rejected.**
   They trade kb's folder, offline mode, licence independence and query layer
   for latency kb does not need.
5. **Graph queries:** on STDB, kb's queries run only client-side over a
   subscribed cache — where they run today. Subscriptions cannot recurse (§5).
   **SurrealDB** does recursion, backlinks and shortest paths natively in
   SurrealQL, but has no embedded-to-server sync and is a second query
   language beside datalog. It is a candidate *server query engine* for a
   future thin-client or very-large-graph mode, not a store swap (§8).
6. **Smallest experiment** (§9): an STDB `RemoteAuthority` module plus a Bun
   adapter, run against an `authorityContract` and three latency measurements,
   after kb#85's in-memory prototype exists. It proves or kills topology C in
   about a day.

### Summary table

| | **Today** (kb, + kb#85 plan) | **SpacetimeDB 2.14** | **SurrealDB** (see §8) |
|---|---|---|---|
| Data at rest | `.kb/nodes.jsonl` (git) or `.kb/kb.sqlite` | RAM + commitlog/snapshots | RocksDB / SurrealKV / memory; IndexedDB in the browser |
| Folder in git, merge driver | yes | no | no |
| Offline writes | yes (local store; kb#85 sync) | no (in-memory client cache) | embedded instance offline, but no sync to a server |
| Live push to clients | own hub, `tx` frames by rev | yes, row deltas | `LIVE SELECT` (limits, §8) |
| Recursive / graph queries | DataScript `reach`; trace in TS | no (module code per shape) | yes, SurrealQL (§8) |
| kb's datalog unchanged | yes | client-side only | client-side only; SurrealQL is a second language |
| Server logic | Effect action registry, plugins | reducers / procedures / views | functions, events, embedded JS (§8) |
| Licence | MIT | BSL 1.1 → AGPL+exception | BSL 1.1 → Apache 2.0 (§8) |
| Self-host ops | none (a folder) or `kb ui` | one daemon, single node | one daemon or embedded |
| Best-fit topology | — | **C**: sync authority | server query engine (§8) |

## 1. What kb built, in the terms this record compares

Pointers only; the specs own the detail.

- **Store.** `EffectStore` with two adapters, `JsonlStore` (`.kb/nodes.jsonl`,
  committed, merged by the `kb-jsonl` driver) and `SqliteStore`. A commit is
  one atomic act over node bodies (`canonicalJson`) and a tail record; the
  tail's `rev` is the total order. Datoms are never stored: each session
  derives a DataScript index from the nodes.
- **Live sync.** `kb ui` (Bun) watches the store, and its `SubscriptionHub`
  sends `tx` frames over `/ws`. Each browser is a replica at a `rev`, with
  holds for unconfirmed local writes, `since(rev)` and `snapshot-required`
  (DESIGN-UI → Replica sync). Datalog runs in the page, in a worker.
- **Actions.** One registry, served by the CLI, MCP, HTTP and WebMCP;
  isomorphic actions run on the page's replica first, then on the server.
- **Extensions.** Bundled families and `.kb/extensions/*.ts`, loaded as
  plugins into one kernel at open; a sandbox for scripts; guards.
- **Identity.** `IdentityPoint` providers; by default the person is the
  server's owner; a hosted deployment trusts a proxy header. `kb ui` binds
  127.0.0.1 and is reached over the tailnet.
- **Planned (kb#84, kb#85).** A `RemoteAuthority` port (`snapshot`, `since`,
  `append(expectedRev, …)` as compare-and-swap, `heads`), a Durable Object
  adapter first, and a `SyncAgent` that pulls, merges with `mergeNodeSets`
  and pushes, so every device stays a full local kb.

## 2. SpacetimeDB 2.x in one page

| Topic | What it is (2.14.0) | Source |
|---|---|---|
| Model | "a relational database that is also a server": you publish a *module*, clients connect to the database directly | README |
| Module languages | Rust, C#, C++ (compiled to WASM), TypeScript (runs on V8) | /docs/intro/language-support |
| Execution | each database is a single-threaded actor; every reducer is one transaction, all-or-nothing; reducers cannot touch network, filesystem or globals | /docs/functions/reducers, /blog/how-does-spacetime-scale |
| Isolation | docs: "reducers don't see changes from other concurrent reducers"; the benchmark post claims strong serializability; no Jepsen analysis | /docs/databases/transactions-atomicity, /blog/benchmarking |
| Storage | all table data in RAM; every transaction appended to a commitlog (never compacted), group-committed (up to 4096 tx per fsync, 10 ms interval since 2.0.2); snapshots shorten replay | README → Durability, `crates/durability/src/imp/local.rs` |
| Confirmed reads | default since 2.0: subscription updates and reducer results are held until durable | README, 2.0 release |
| Tables | private by default, `public` to expose; PK, unique, auto-inc; B-tree (multi-column) and direct indexes; types incl. strings, arrays, `Option`, sum types, `Identity`, `Timestamp` | /docs/tables, …/column-types, …/indexes |
| Procedures | since 2.0, stable in 2.5: not transactional by default, `withTx` to open one, `ctx.http.fetch` outside a transaction | /docs/functions/procedures |
| HTTP handlers | 2.4, beta: routes under `/v1/database/:name/route`, anonymous identity per request | /docs/functions/http-handlers |
| Views | public read-only functions, subscribable; per-caller filtering through `ViewContext`; *procedural* views re-run when anything read changes, *query-builder* views are incremental; a view reads tables only through indexed `find`/`filter`/`count` | /docs/functions/views |
| Row-level security | `client_visibility_filter` still exists, "experimental, unstable"; docs say use views | how-to/row-level-security |
| Subscriptions | SQL subset: rows of one table, `*` only, at most a two-table join on indexed columns, `WHERE` with `AND`/`OR`; no aggregates, `ORDER BY`, `LIMIT` or recursion. One-off queries are a little richer (projections, `COUNT(*)`, `LIMIT`, multi-joins) | /docs/reference/sql, /docs/clients/subscriptions |
| TS client cache | in memory; `onInsert`/`onDelete`, `onUpdate` only with a primary key; unique-index `find` on the cache, no non-unique indexes; opt-in auto-reconnect; React/Vue/Svelte/… hooks; persistence across reloads is "the application's responsibility" | /docs/clients/typescript |
| Identity | `Identity` = BLAKE3 of a JWT's `iss`+`sub`; anonymous tokens signed by the server, or any OIDC issuer (the module checks `iss`/`aud` itself); HS256 refused since 2.12 | /docs/core-concepts/authentication |
| SDKs | TypeScript (browser, Node, Bun, Deno), Rust (also in the browser via WASM), C#/Unity, C++/Unreal, Godot; `spacetime generate` writes typed bindings | /docs/clients |
| Self-host | `spacetime start` (default `0.0.0.0:3000`, data in `~/.local/share/spacetime/data`); Standalone is "the single-node version"; replication and clustering are the proprietary Cloud's | `crates/standalone/…/start.rs`, scale post |
| Maincloud | free tier 2,500 TeV/month (~3 M reducer calls); Pro $25/month; storage $1/GB/month | pricing post |
| Licence | BSL 1.1: one production instance, no "Database Service"; converts to AGPL v3 with a linking exception at 2031-10-25 or four years after a version's release, whichever is first; per-directory exceptions (§4) | LICENSE.txt |
| Cadence | 1.0 on 2025-03-04; 2.0 on 2026-02-20; 2.14.0 on 2026-10-30 | GitHub releases |

## 3. Feature map: what kb built, and what SpacetimeDB covers

| kb built | SpacetimeDB 2.14 | Covers? | What we would lose by moving it |
|---|---|---|---|
| Transactions (`commitEffect`: `rankTx` + nodes + tail row, atomic) | every reducer is one serial ACID transaction; a CAS `append` is ~20 lines | **yes** | nothing |
| Multi-client fan-out (`SubscriptionHub`, `tx` frames) | its core: row deltas to every subscriber, confirmed reads | **yes** | nothing, but kb already has it for one server |
| Durable store (JSONL in git, SQLite) | RAM + commitlog + snapshots | partly | *a kb is a folder*: diffable, mergeable, editable, no daemon; "opening never writes" |
| Live subscriptions to the UI (rev frames, `since`, snapshots, holds; datalog `rows`) | SQL subscriptions into a client cache | partly | a `tx` table maps onto frames; datalog subscriptions do not map |
| Auth / identity (`IdentityPoint`, tailnet) | `Identity` from JWT; anonymous or OIDC | partly | nothing if it is one more identity provider |
| Server actions (one registry, CLI/MCP/HTTP/WebMCP, isomorphic) | reducers (no I/O), procedures (HTTP), views | partly | rewriting actions as reducers is a second implementation of every action (Rule 1) |
| History / changes feed (tail with `origin`, `actor`, `via`; `graph.changes`) | commitlog for durability, not a queried history | partly | the tail becomes a table we write ourselves |
| Offline-first (kb#85) | none: in-memory client cache, no write queue, no merge | **no** | everything, if STDB were the client store |
| Extensions server-side (plugin kernel, `.kb/extensions`, sandbox) | one module, published whole | **no** | run-time extension loading |
| Datalog, `reach`, saved `.edn`, trace | SQL subset, no recursion | **no** | server-side querying (§5) |
| Search (`graph.search`, substring) | no full-text index documented | **no** | nothing — kb has none either |
| — (not built) | scheduled reducers, inter-database outbox calls, pg-wire | bonus | — |

**What kb would lose across topologies A and B:** DataScript datalog on the
server, local-first and offline, the file-backed `.kb/nodes.jsonl` in git,
licence independence (kb is MIT; STDB is BSL), the single `kb` CLI that works
on a folder with no server, and browser-only mode. Topology C loses none of
these.

## 4. SpacetimeDB's kinks

1. **Query language.** A subscription returns rows of one table, `*` only, with
   at most one join on indexed columns; no aggregates, `ORDER BY`, `LIMIT` or
   recursion. Every graph walk is module code written per query shape (§5).
2. **Schema migration.** Automatic only when additive: tables, indexes,
   reducers, a column at the end with a default (which needs
   `--break-clients`). Removing or changing a column, removing a non-empty
   table, adding a unique or primary-key constraint are refused; the ways out
   are `--delete-data` or an incremental-migration table
   (/docs/databases/automatic-migrations). The 2.7 notes mention adding
   unique/PK constraints by migration, which the docs still forbid (unv. which
   is current). kb's `node(id, body)` shape never changes columns, so this
   bites topology B, not C.
3. **Module redeploy.** `spacetime publish` hot-swaps the whole module with
   clients connected; bindings are regenerated; the CLI, the module crate and
   the SDK move together (axioms pins 2.14.0 in three places). Fourteen minor
   releases in eight months, and 2.0 renamed core APIs (`ctx.sender` became a
   method in Rust, `update()` became primary-key only).
4. **Blobs and large values.** No hard row limit, but every row is in RAM; the
   docs suggest "several megabytes per row" and external storage past ~100 MB
   (/docs/tables/file-storage). `.kb/assets` stays out; a large node body costs
   RAM on the server and again in every client cache.
5. **Licence.** BSL 1.1, one production instance, no database service. Each
   version converts to AGPL v3 with a linking exception at 2031-10-25 *or four
   years after its release*, whichever is first. Per directory: the Rust
   module bindings, the C# SDK and the Unreal SDK are Apache-2.0; the core,
   standalone, CLI, the Rust client SDK, and `crates/bindings-typescript` are
   BSL. That last one is the npm package `spacetimedb` — the TypeScript
   *client* and module bindings together — whose `LICENSE.txt` is BSL while its
   `package.json` says ISC. The base licence also contradicts itself on which
   licence wins in a subdirectory. For an MIT kb, the client SDK is the
   question, not the server (§11, Q2).
6. **Self-host ops.** One more daemon: axioms' instance idles at ~70 MB with a
   512 MiB page pool, `MemoryMax=1G`, `CPUQuota=200%`. nixpkgs has 2.10.1
   (unfree, would build from source), so axioms runs the official glibc binary
   through nix-ld. Single node only.
7. **Client cache size.** Every subscribed row is held in memory by the SDK,
   with no paging and no persistence; the TS cache has no non-unique indexes.
   kb's 50k graph is ~44 MB of JSON (kb#78), which a browser would hold in the
   cache and again in DataScript.
8. **Auth model.** Tokens are anonymous and self-issued unless an OIDC issuer
   is used, and *any* valid OIDC token is accepted: the module must check
   `iss`/`aud` in `client_connected`. Every public reducer is callable by
   anyone who reaches the endpoint, so each checks `ctx.sender`. HTTP handlers
   get an anonymous identity. A JWT impersonation flaw was fixed in 2.10.0
   (2.11 security notice).
9. **Single node.** Standalone is the single-node edition, whole database in
   RAM (disk-backed tiered storage was scheduled for 2026-10-31; unv. whether
   it shipped). No cross-database transactions; 2.14 adds asynchronous,
   exactly-once outbox calls between databases on one server.
10. **Determinism and budgets.** Reducers cannot do I/O; procedures may
    `fetch`, never inside a transaction; the docs recommend a sidecar for
    model calls. A WASM call gets roughly a minute of budget; a TypeScript (V8)
    module has no enforced timeout yet (`budget.rs` returns `Duration::MAX`
    with a TODO).
11. **What axioms hit.** Browsers needed a same-origin relay
    (`POST /v1/identity/websocket-token` and `/subscribe` through
    axioms-server); a public table exposed every person's knowledge rows; a
    dropped socket reloads the page; deletes were dropped so one person's
    older copy cannot shrink a shared graph; views refetch in full per change.
12. **Inspect and back up.** Data is not in git or an editor; `spacetime sql`
    and the module's reducers are the way in. A backup is the data directory
    while stopped, or an export you write; no online backup tool found (unv.).

## 5. Graph queries: can kb's datalog run on SpacetimeDB?

kb's query surface (DESIGN.md → Query layer, Trace and suggest):

- a DataScript datalog subset — patterns, rules, `or`/`not`, `pull`, the `kb/`
  functions — with one parser and one compiler for every surface;
- `reach`, compiler-emitted recursive rules over `:node/child`,
  `:node/mentions` or `:f/<ref field>`, 1..∞ or 1..max hops;
- saved `.edn` queries (`kb run`, `graph.run`) and `rows` subscriptions;
- `graph.trace` (k shortest simple paths, Yen over Dijkstra) and
  `graph.suggest`, TypeScript over an edge projection — "a path is not a
  datalog relation".

There are three places a query could run against SpacetimeDB: natively as a
subscription, inside the module (a reducer, procedure or view), or on the
client over the subscribed cache.

**Query 1 — backlinks** (`backlinksQuery`, `packages/domain/query/src/queries.ts`):

```clojure
[:find ?from ?text
 :where [?e :node/mentions ?m] [?e :node/id ?from]
        [?e :node/text ?text] [?m :node/id "X"]]
```

With a decoded `mention(src, dst)` table, indexed on both columns:

```sql
SELECT node.* FROM node
JOIN mention ON node.id = mention.src
WHERE mention.dst = 'X'
```

That is a legal subscription: rows of one table, one join on indexed columns.
But it needs the module to decode node bodies into a `mention` table, which it
does only in topology B. In A and C the bodies are opaque, by design (kb#84
§4.2), so there is nothing to join.

**Query 2 — open todos anywhere under P** (`reach`):

```clojure
[:find ?id
 :where [?p :node/id "P"]
        (reach ?p :node/child ?n)
        [?n :f/sys.f.type ?t] [?t :node/text "todo"]
        [?n :node/id ?id]]
```

Not expressible in subscription SQL: there is no recursion and no CTE. The
options are:

- a **procedural view** that walks down from P through `filter` on a B-tree
  index over `parent` and then filters by tag. It is subscribable, but it is
  code for one query shape, and it re-runs whole whenever any row it read
  changes;
- or **client-side** over the subscribed cache, which is what kb does today.

**Trace and suggest** would have to be ported into the module as code (Rust
or TypeScript). **Saved `.edn` queries and arbitrary datalog** cannot run
server-side at all: there is no datalog engine. Bundling DataScript into a
TypeScript module is untried (unv.), and since views read only through indexed
lookups it could not maintain an index the way the page's worker does.

**Verdict.** On SpacetimeDB kb's queries run only on the client, over the
subscribed cache — exactly where they run today. STDB adds nothing to
querying, which is why §8 looks at SurrealDB.
## 6. Four deployment topologies

Each topology is a frame on the canvas, with the same boxes and arrows.

Hosts: **shared-server** (the tailnet box that runs `kb ui` trials and axioms),
the **Mac**, a **phone** (a browser only), and **Cloudflare** (the Durable
Object of kb#84/kb#85, not built). Ports are today's: `kb ui` on 4321
(`DESIGN.md` → Surfaces), axioms' SpacetimeDB on 127.0.0.1:4420.

### A. SpacetimeDB as kb's store and hub (kb ui keeps the actions)

```
 Browser (Mac, phone)                    kb ui · shared-server :4321 (Bun)
 kb UI · replica · DataScript worker ──► actions · extensions · MCP
   ▲          POST /api/action            store = StdbStore (no .kb file)
   │                                          │ reducer call (ws)
   │  subscribe SELECT * FROM tx              ▼
   └──────────────────────────────── SpacetimeDB · shared-server :44xx
                                       module kb: node(id, body), tx(rev, ops)
 kb CLI / MCP agents ──actions──► kb ui  reducer append(expectedRev, tx) = CAS
                                              ┆ kb export (cron)
                                              ▼
                                       git: .kb/nodes.jsonl (an export only)
```

- **Data flow.** The browser writes through `kb ui` as today. `kb ui`'s store
  is a `StdbStore` whose `commitEffect` is one `append` reducer call. Every
  browser subscribes to the module's `tx` table directly, so STDB, not the
  `SubscriptionHub`, fans frames out. The CLI has no local store and goes
  through `kb ui`.
- **Offline.** None. Every write needs STDB, and the browser needs both servers.
- **Auth.** The browser carries an STDB token and a kb session: two
  identities for one person, reconciled by hand.
- **Migration cost.** `StdbStore` joins `storeContract`/`logContract`/
  `tailContract`; the replica's `KbWsClient` is replaced by an STDB
  subscription that feeds the same `BrowserReplica` events; the hub's frames
  move. Moderate code, large blast radius.
- **Licence.** kb cannot run at all without a BSL server.
- **What breaks.** "A kb is a folder"; the CLI without a server; browser-only
  mode; the `kb-jsonl` merge driver (nothing to merge).
- **Perf.** A commit is one websocket round trip plus a reducer (sub-ms in
  memory; the commit-log flush policy decides durability, §2). What does not
  change is the cost kb actually pays at 50k: each foreign commit is ingested
  into DataScript on every client (kb#84 G2, kb#78).
- **Verdict: no.** It moves kb's hot path onto STDB for latency kb does not lack.

### B. kb as a SpacetimeDB module (no kb server)

```
 Browser ──call reducer node_add(…)──► SpacetimeDB :3000
 TS SDK cache → DataScript    ◄─rows── module kb: node, edge, prop, tx
                                        reducers = kb actions, rewritten
 kb CLI (an STDB client) ──reducers──►  views = per-person visibility
                                              ▲ subscribe + call
 Agents ──MCP──► Sidecar (Bun): MCP · extensions with I/O · model calls
```

- **Data flow.** Clients call reducers and subscribe to rows. No kb process
  stands between them and the database. MCP, extensions that need I/O, and
  model calls run in a sidecar client (or in procedures, for HTTP).
- **What is rewritten.** The Effect action registry (the one served by CLI,
  MCP, HTTP and WebMCP), the plugin kernel, the sandbox, governance guards,
  datalog subscriptions, docs materialisation. Every `.kb/extensions/*.ts`
  becomes a module republish.
- **Schema.** A column per field is the relational mapping kb's Rule 1 forbids
  ("everything is a node"; kb#85 §4 calls it a migration treadmill). So the
  module stores `node(id, body)` plus derived `edge`/`prop` tables, and then it
  is topology A with the actions moved inside.
- **Queries.** Recursive and graph queries are module code per shape (§5);
  saved `.edn` queries cannot run server-side.
- **Offline, browser-only:** none. **Licence:** kb (MIT) is unusable without a
  BSL server. **Perf:** the lowest multiplayer latency of the four.
- **Verdict: no.** It is a different product.

### C. Local-first kb + SpacetimeDB as the sync authority (replaces the Durable Object)

```
 Mac · kb ui + local store (.kb/nodes.jsonl in git)
   SyncAgent: pull · mergeNodeSets · push ──append(r, diff)──┐
            ▲                                                ▼
            └──────────tx rows pushed (heads)─── SpacetimeDB · shared-server (tailnet)
                                                 authority module:
 shared-server · kb ui + local store             node(id, body) · tx(rev, …)
   SyncAgent ◄──────── append / heads ─────────► meta(backendId) · writer(identity)
     ▲                                           append(expectedRev, …) = CAS
     │ ws frames (today's protocol)                     ┆ same port, other adapter
 Phone browser                                   Cloudflare Durable Object (kb#84 §4.2)
```

- **Data flow.** Exactly kb#85 §3. Each device's kb writes to its own store
  at once; the `SyncAgent` pulls the authority's records past its base, runs
  `mergeNodeSets(base, local, remote)`, and pushes one compare-and-swap
  `append`. STDB is the `RemoteAuthority` adapter:
  - `append(expectedRev, tx, record)` is one reducer: read `max(rev)`, refuse
    with `{stale: head}` when it is not `expectedRev`, write the deletes and
    upserts to `node`, insert `tx` row `expectedRev + 1`, compact past 2048.
    A reducer is one serial transaction, so the CAS needs no lock.
  - `heads` is a subscription to `tx` (or to a one-row `head` table);
    `since(rev)` is a subscription or one-off query `WHERE rev > r`;
    `snapshot` is a one-off query over `node` plus the tail.
  - Bodies stay opaque `canonicalJson` strings, ranks are settled client-side
    (kb#84 §4.2), so the module never decodes a node and never changes schema.
- **Offline.** Full: writes queue in the local tail by construction.
- **Auth.** One STDB identity per kb process, kept as a secret reference in
  `.kb/sync.json` (kb#85 §6); the module allowlists identities in a `writer`
  table and every reducer checks `ctx.sender`. Browsers never see STDB.
- **Migration cost.** One adapter package (the module, ~150 lines, and a
  `StdbAuthority` over the TS SDK under Bun) that joins `authorityContract`.
  Nothing else in kb moves, because the port is the seam.
- **Licence.** An optional backend the owner runs. One instance fits the
  grant (it may host axioms' database too). kb stays MIT; the SDK is a
  dependency of the adapter package only (§4, the SDK licence question).
- **What breaks.** Nothing. **Reach:** tailnet only, where a DO is reachable
  from anywhere; that is the honest difference between the two adapters.
- **Perf.** The authority is not the bottleneck; merge and index ingest are.
- **Verdict: viable.** It is the DO's slot, self-hosted, with push included,
  on a database the owner already operates.

### D. SpacetimeDB for specific apps; kb core unchanged

```
 axioms · app-axioms-db :4420 + app-axioms :4401 ──KbStore via kb mcp──► kb ui :4321 (unchanged)
 multiplayer-first app (idea)  ◄┄rows┄┄ Browser ──graph + actions──────►
```

- **Already true.** axioms keeps its shared concept graph in STDB and reaches
  kb through `KbStore` over `kb mcp` (axioms `docs/DESIGN.md` → kb integration).
- **Canvas presence is not a reason on its own.** kb's hub already carries
  plugin channels (`{op: "channel"}` on `/ws`, `DESIGN.md` → Plugin channels),
  so cursors and selections in a shared canvas need no second server.
- **Verdict: status quo.** Use STDB where an app is multiplayer-first and its
  data is not the owner's graph.

### Topologies side by side

| | A · store + hub | B · kb as a module | C · sync authority | D · apps only |
|---|---|---|---|---|
| STDB in kb's hot path | yes | yes, the only path | no (background sync) | no |
| Offline | none | none | full (kb#85) | kb unaffected |
| `.kb/` folder in git | export only | gone | kept | kept |
| kb code rewritten | store, replica feed | most of the server | one adapter | none |
| kb runs without STDB | no | no | yes | yes |
| Licence exposure | kb needs BSL server | kb needs BSL server | optional backend | per app |
| Verdict | no | no | **viable** | status quo |

## 7. "Very fast": the claim, the evidence, and kb's actual costs

- **The claim.** The homepage: "Millions of Transactions. Zero Bottlenecks."
  The 2.0 release: "well over 100k TPS" (TypeScript) and 170k (Rust). I found
  no primary-source "~1M TPS" figure.
- **The evidence.** One vendor benchmark with a published method
  (/blog/benchmarking, 2026-05-14; code in `templates/keynote-2`): a
  bank-transfer reducer end to end, 5-minute runs, one Intel 14900K. Standalone
  did 279k TPS uncontended and 304k contended (TypeScript module), 266k (Rust);
  the Postgres stacks did 1k–11k. The post itself admits that only SpacetimeDB
  used 40-deep pipelining and that competitors ran default configurations, and
  that its earlier SQLite numbers were invalid. No independent replication
  found (unv.).
- **Why it does not matter much for kb.** The figure measures a serial,
  in-memory writer with group commit and no network per transaction. kb's
  write rate is a person typing plus agents; its measured costs are elsewhere
  (kb#78): DataScript build ~2.8 s and cold queries 150–760 ms at 50k nodes,
  `/api/graph` 94 ms repeated, a single-node save 0.10 s on SQLite. And each
  foreign commit is ingested O(N) into every client's index (kb#84 G2). None of
  these move if the authority commits in microseconds. Where STDB's design
  *would* show is fan-out latency to many clients and confirmed-read
  durability, neither of which is kb's bottleneck at one person and a few
  devices.
- **Expected numbers for topology C** (unv., to be measured by §9): a
  same-host `append` round trip in low milliseconds; over the tailnet, the
  tailnet RTT plus a reducer and one group-commit fsync window (≤ 10 ms).
  That is comparable to a Durable Object call from a nearby colo, minus the
  public-internet hop, plus the restriction to the tailnet.

## 8. SurrealDB, for the graph queries SpacetimeDB cannot run

SurrealDB facts are from surrealdb.com docs, its blog, and
github.com/surrealdb/surrealdb (releases, LICENSE, issues, advisories), read on
2026-11-01. The docs site is already written for 4.0, which is in beta; where
behaviour differs, the 3.x behaviour is given.

### 8.1 What it is

- **Versions.** 1.0 on 2023-09-13, 2.0 on 2024-09-17, 3.0 on 2026-02-17;
  latest stable 3.3.5 (2026-10-29); 4.0 in beta. Monthly releases since
  January 2024.
- **Model.** Records `table:id`, schemaless by default (`SCHEMAFULL` rejects
  undefined fields since 3.0). Record links are typed fields; with
  `REFERENCE` they can be read backwards with `<~`. Graph edges are records in
  their own table, made by `RELATE a->edge->b`, with `in`, `out` and any fields.
- **Deployment.** A server (`surreal start`) on `memory`, `rocksdb`
  (recommended), `surrealkv` or `tikv` (multi-node only for experimentation in
  Community); embedded in Node, **Bun** and Deno (`@surrealdb/node`); in the
  browser through WASM (`@surrealdb/wasm`: `mem://`, and IndexedDB before 4.0;
  in 4.0, SurrealKV on OPFS in a dedicated worker, Chrome-only tested, one tab
  per database).
- **Transactions.** ACID; snapshot isolation with write conflicts detected at
  commit, on every engine; `BEGIN … COMMIT` within one request.
- **Auth.** Root/namespace/database users; `DEFINE ACCESS … TYPE RECORD|JWT|BEARER`;
  table `PERMISSIONS … WHERE` with `$auth` (a refused write returns `[]`).
- **Server logic.** `DEFINE FUNCTION`, `DEFINE EVENT` (`ASYNC` since 3.0),
  embedded JavaScript behind `--allow-scripting`, `http::*` behind
  `--allow-net`, Surrealism WASM extensions (3.0).
- **Search.** Full-text (`DEFINE ANALYZER`, `FULLTEXT … BM25`), vectors (HNSW;
  DiskANN since 3.1, not on WASM).

### 8.2 Feature map against kb

| kb built | SurrealDB 3.x | Covers? |
|---|---|---|
| Datalog, `reach`, backlinks | recursive idioms (2.1), `<-` backlinks, `<~` references | **graph yes; datalog no** — SurrealQL is a second language |
| `graph.trace` (k shortest, hub-aware) | `+shortest=` (2.2): one shortest path, ids only | partly |
| Search | BM25 full-text, HNSW vectors | **yes** (kb has only substring) |
| Transactions | snapshot isolation, optimistic | yes (weaker than serial for the CAS; a unique `rev` key makes it safe) |
| Live subscriptions | `LIVE SELECT` of one table, full record or JSON-Patch `DIFF`; no graph traversal; best-effort ordering; reconnect re-subscribes with no catch-up; single node in Community | partly |
| Offline-first sync | none: "Replication to a central instance runs through your application"; changefeeds (`CHANGEFEED 3d`, `SHOW CHANGES … SINCE`) need a system user and have fixed retention | **no** |
| Embedded local store | yes, in Bun and the browser | yes, but kb's queries would not use it |
| Extensions, action registry | functions, events, scripting | no (a different runtime) |
| Folder in git | export/import only | no |

### 8.3 Kinks

1. **Licence.** The core is BSL 1.1 with an anti-database-service grant;
   each version converts to **Apache 2.0** at its change date or four years
   after release (3.x: 2030-01-01; 2.x: 2029-09-17; 1.x: 2027-04-01). The JS
   SDK is Apache-2.0. The embedded engines' npm packages say Apache-2.0 but
   are built from the BSL core crates — the same metadata-versus-file conflict
   as SpacetimeDB's SDK.
2. **Every major has been a migration.** 1→2 needed `surreal db fix` and
   changed auth and function names; 2→3 needs export and import with many
   SurrealQL breaks (`SEARCH` → `FULLTEXT`, MTREE removed, futures removed);
   3→4 (beta) is in place and one-way, and drops RocksDB and IndexedDB.
3. **Graph performance is unproven at scale.** The repository's open issues:
   graph hops inside `WHERE` full-scan and the planner does not use indexes for
   graph edges (#4880, #5441); a traversal filter ran over an hour on 3.0.5
   (#7332); RocksDB memory growth and OOMs (#7383, #7424); no server-side
   query timeout (#7192). The 3.0 benchmark compares only against 2.x
   (crud-bench), claiming 8–22× faster graph queries and admitting slower
   single-record reads.
4. **Stability and security.** A silent data loss with `.bind()` on embedded
   RocksDB in a 3.0 beta (#6735); SurrealKV failing to start after an unclean
   shutdown (#7426); critical cross-tenant advisories and live-query
   field-permission bypasses in September–October 2026.
5. **Live queries are table-level**, best-effort ordered, and lose changes
   across a reconnect: they cannot replace kb's rev-ordered frames without a
   `since` read beside them.
6. **Recursion is capped** at 256 steps, and shortest path returns one path
   when several tie.

### 8.4 kb's queries in SurrealQL

Schema assumed: `node:<id>` with `text`, `children: array<record<node>>`
(kb keeps ordered children) and `parent`, and one edge per ref prop,
`RELATE node:a->ref->node:b SET field = <field-id>`.

**Backlinks** — the same `backlinksQuery` as §5:

```surql
SELECT <-ref<-node.{ id, text } AS backlinks FROM ONLY node:X;
-- keeping which field refers:
SELECT <-ref.{ field, from: in.{ id, text } } AS backlinks FROM ONLY node:X;
```

Each piece is documented on the 3.x RELATE and references pages; the
combinations are untested. A node referring through two fields appears twice
(`array::distinct` folds it).

**Open todos anywhere under P** — the `reach` query of §5:

```surql
SELECT id FROM node:P.{..+collect}.children
WHERE ->tagged->node.text CONTAINS 'todo';   -- tags as edges; unv.
```

The `{..+collect}` over a record-link field follows the documented form
(`person:you.{..+shortest=person:star}.knows` "works with any idiom parts");
the `WHERE` over the collected set, and tags as `tagged` edges, are my
inference (unv.).

**Shortest path A → B** — kb's `graph.trace` with k = 1:

```surql
node:A.{..+shortest=node:B+inclusive}->ref->node;   -- outgoing refs: documented form, 2.2+
node:A.{..16+shortest=node:B}<->ref<->node;          -- either direction, bounded: inferred (unv.)
```

Compared with kb: one path, not the k shortest; no hub-aware tie-break; hop
explanations are kb's to add.

So SurrealDB can run these three natively, which SpacetimeDB cannot. It
still cannot run kb's datalog: a saved `.edn` query would need a compiler from
kb's IR to SurrealQL — a second backend for the one compiler `DESIGN.md`
insists on (Query layer → "One parser, one compiler").

### 8.5 Where it would fit

- **As topology C's authority.** Possible: `append` is a transaction that
  inserts `tx:<expectedRev + 1>` (a unique id, so a stale append conflicts),
  and `heads` is a `LIVE SELECT` on `tx` with a `since` read after every
  reconnect. It gains nothing over SpacetimeDB or the DO, and its ordering and
  reconnect guarantees are weaker.
- **As the local store, embedded.** No. kb's queries run on DataScript; an
  embedded SurrealDB would be a BSL engine with migration-per-major churn
  inside MIT kb, used as a key-value store.
- **As a server query engine (call it topology E).** A derived, read-only
  projection of kb's graph (`node`, `child`, `ref` edges) maintained from the
  tail, answering graph queries for thin clients — an MCP agent or a phone that
  should not load the whole graph — and graphs too large to ship whole. This
  is kb#85 §4's "when to revisit" condition (i). It is the one place where
  SurrealDB's strength meets a kb need, and kb does not have that need yet.

**Verdict.** SurrealDB answers the graph-query question and not the sync
question. Not now; revisit with topology E when a thin-client or 100k-node
requirement exists, and measure the graph-planner issues first.

## 9. Recommendation and the smallest experiment

**Recommendation.**

1. **Do not adopt SpacetimeDB as kb's store, hub or runtime** (topologies A
   and B). It covers the transport kb already has and none of the model.
2. **Topology C is the one worth a spike**: SpacetimeDB as a second adapter of
   kb#84's `RemoteAuthority` port, behind kb#85's `SyncAgent`. It competes with
   the Durable Object on one axis — self-hosted on a box the owner runs, versus
   reachable from anywhere — and it needs no Cloudflare account.
3. **Order:** kb#85's P0 first (the pure `reconcile`, the in-memory authority,
   `authorityContract` and the convergence test). The authority is the easy
   part; spiking it before the loop exists measures nothing kb can use.
4. **Keep D as is**: STDB for multiplayer-first apps (axioms), kb reached
   through its actions.
5. **SurrealDB** is not a store swap. Revisit it if kb grows a thin-client or
   very-large-graph mode where queries must run on a server (§8).

**The smallest experiment that proves or kills topology C** (about a day; not
run here). Run on shared-server under `nice`, only while `/proc/loadavg` is
below 12, on a *separate* dev instance (`spacetime start --listen-addr
127.0.0.1:4430`, its own data directory) — never the `app-axioms-db` unit.

1. **Module** `kb-authority` (TypeScript module, so kb needs no Rust
   toolchain; ~150 lines): tables `node(id PK, body)`, `tx(rev PK, ops,
   origin, actor, at)`, `meta(backend_id)`, `writer(identity PK)`; reducer
   `append(expected_rev, upserts, deletes, record)` that refuses a stale rev
   with `{stale: head}`, writes, inserts `tx` row `expected_rev + 1`, and
   compacts past 2048 to 1024; `client_connected` refusing non-writers.
2. **Adapter** `StdbAuthority` over the `spacetimedb` npm SDK under Bun:
   `snapshot` = subscribe `node` + `tx` and read the cache; `since(r)` =
   subscription `SELECT * FROM tx WHERE rev > r`; `heads` = `onInsert` on `tx`;
   `append` = the reducer call, awaited (confirmed reads on).
3. **Contract.** It joins `authorityContract` beside the in-memory authority:
   append-lands, stale-collides, since-after-compaction (`snapshot-required`),
   heads-armed-then-news, two-writers-never-share-a-rank.
4. **Measure**, against the in-memory authority and today's `kb ui`:
   - `append` round trip, p50 and p99, for a one-node tx: same host, and from
     the Mac over the tailnet;
   - fan-out: commit in process 1 → `heads` in process 2;
   - `snapshot` of kb's own `.kb/nodes.jsonl` and of the 50k fixture kb#78
     used (bodies mirrored into `node`), versus `/api/graph` at 94 ms;
   - the instance's RSS at 50k nodes.

**Prove:** the contract is green unchanged; `append` p99 under 50 ms over the
tailnet; fan-out p99 under 50 ms; a 50k snapshot under 1 s; RSS under 300 MB.
**Kill:** the contract needs an exception for STDB (a guarantee it cannot
keep); the SDK's licence is unacceptable to the owner for a package in kb's
workspace; or the numbers are not better than a DO's by a margin that pays
for running a BSL daemon. If killed, the DO stays first and this record says
why.

## 10. Corrections to kb#84 §6

kb#84 concluded "SpacetimeDB: skip … never". Two parts of that need correcting:

- **"Fits the store port: no; replaces store, hub and query layer."** That is
  true of topologies A and B only. As a `RemoteAuthority` adapter (C), STDB
  holds opaque bodies and a tail, serialises appends in a reducer, and pushes
  heads by subscription. It fits the port as cleanly as the Durable Object
  does, and the migration objection disappears with it, since the module's
  schema never changes.
- **Licence conversion.** kb#84 gave the change date only (2031-10-25). The
  BSL's own text converts each version at that date *or four years after its
  release, whichever is first*; and the npm SDK's licence is ambiguous (BSL
  file, ISC metadata). The one-instance grant holds as stated.

"Never" becomes "not as the store; a candidate authority adapter after kb#85
P0". The duplicated-reactive-layer objection stands for A and B.

## 11. Questions for the owner

1. **C at all?** Is a self-hosted authority on the tailnet worth a second
   adapter beside the DO, or is "reachable from anywhere" the point of syncing?
2. **The SDK licence.** May a workspace package of MIT kb depend on npm
   `spacetimedb`, whose LICENSE is BSL and whose metadata says ISC? Or should
   the adapter live outside the repo, as an extension the owner installs?
3. **One instance.** The grant counts instances per application or service,
   so kb may have its own (my reading, not legal advice). Should it instead be a second database on
   `app-axioms-db` (one daemon fewer, but kb's sync then shares axioms'
   restarts and upgrades)?
4. **SurrealDB.** Is a server query engine a direction you want (thin clients,
   graphs past ~100k nodes), or is "every device holds the whole graph" a
   principle?

## 12. What I could not verify (unv.)

- Any SpacetimeDB number on this host: nothing was run (load above 12).
- Independent replication of SpacetimeDB's benchmark.
- Whether the TypeScript SDK supports one-off queries (documented for C#).
- Whether disk-backed tiered storage shipped (scheduled 2026-10-31).
- Which of the 2.7 notes and the migration docs is current on adding
  unique/primary-key constraints.
- An online backup tool for Standalone.
- How often Standalone takes snapshots.
- Bundling DataScript into a TypeScript module.
- The expected latencies in §7.
- SurrealDB items marked in §8.

## Sources

SpacetimeDB (read 2026-11-01; repository at v2.14.0):

- README and LICENSE.txt: <https://github.com/clockworklabs/SpacetimeDB>,
  <https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt>
- Releases (1.0, 2.0.1, 2.1–2.14): <https://github.com/clockworklabs/SpacetimeDB/releases>
- Language support, key architecture, FAQ: <https://spacetimedb.com/docs/intro/language-support>
- Reducers, context, lifecycle: <https://spacetimedb.com/docs/functions/reducers>
- Procedures: <https://spacetimedb.com/docs/functions/procedures>
- HTTP handlers: <https://spacetimedb.com/docs/functions/http-handlers>
- Views: <https://spacetimedb.com/docs/functions/views>
- Tables, column types, indexes, file storage, schedule tables:
  <https://spacetimedb.com/docs/tables>
- Access permissions: <https://spacetimedb.com/docs/tables/access-permissions>
- SQL reference: <https://spacetimedb.com/docs/reference/sql>
- Subscriptions: <https://spacetimedb.com/docs/clients/subscriptions>
- TypeScript client: <https://spacetimedb.com/docs/clients/typescript>
- Authentication: <https://spacetimedb.com/docs/core-concepts/authentication>
- Automatic and incremental migrations: <https://spacetimedb.com/docs/databases/automatic-migrations>
- Transactions: <https://spacetimedb.com/docs/databases/transactions-atomicity>
- Inter-database communication: <https://spacetimedb.com/docs/databases/inter-database-communication>
- Self-hosting: <https://spacetimedb.com/docs/how-to/deploy/self-hosting>
- Commitlog internals: <https://spacetimedb.com/docs/reference/internals/commitlog>
- Benchmark post: <https://spacetimedb.com/blog/benchmarking>; scale post:
  <https://spacetimedb.com/blog/how-does-spacetime-scale>; pricing post:
  <https://spacetimedb.com/blog/all-new-spacetimedb-pricing>
- Source files: `crates/durability/src/imp/local.rs`, `crates/standalone/src/subcommands/start.rs`,
  `crates/core/src/host/v8/budget.rs`, `crates/bindings-typescript/package.json`, `licenses/`

SurrealDB (read 2026-11-01):

- Releases and LICENSE (main, v2.0.0, v1.0.0): <https://github.com/surrealdb/surrealdb/releases>,
  <https://raw.githubusercontent.com/surrealdb/surrealdb/main/LICENSE>, <https://surrealdb.com/license>
- 3.0 release and benchmarks: <https://surrealdb.com/releases/3.0>,
  <https://surrealdb.com/blog/surrealdb-3-0-benchmarks-a-new-foundation-for-performance>
- Idioms (recursion, shortest path): <https://surrealdb.com/docs/surrealql/datamodel/idioms>
- RELATE, references, DEFINE TABLE/ACCESS/FUNCTION/EVENT/INDEX, LIVE, SHOW:
  <https://surrealdb.com/docs/surrealql/statements/relate>,
  <https://surrealdb.com/docs/surrealql/datamodel/references>,
  <https://surrealdb.com/docs/surrealql/statements/live>,
  <https://surrealdb.com/docs/surrealql/statements/show>
- Transactions: <https://surrealdb.com/docs/surrealql/transactions>
- JS engines (Node/Bun, WASM): <https://surrealdb.com/docs/sdk/javascript/engines/node>,
  <https://surrealdb.com/docs/sdk/javascript/engines/wasm>
- Embedded and edge: <https://surrealdb.com/use-cases/embedded-edge>
- Migration guides: <https://surrealdb.com/docs/build/migrating/from-old-surrealdb-versions/>
- Issues: #4880, #5441, #6735, #7192, #7332, #7383, #7424, #7426, #7536;
  security advisories <https://github.com/surrealdb/surrealdb/security/advisories>

kb and axioms: `DESIGN.md`, `DESIGN-UI.md`, `packages/domain/query/src/queries.ts`,
the three research records above; `~/Projects/axioms` `docs/DESIGN.md`
(SpacetimeDB, kb integration) and `spacetime/src/lib.rs`; the
`app-axioms-db` and `app-axioms` units on shared-server (read, not touched).
