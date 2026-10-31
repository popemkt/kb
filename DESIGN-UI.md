# `kb ui` — browser outliner + subscription backend (design doc)

Tana-style outliner UI for kb, served locally by `kb ui`, opened in the
browser. Client-side DataScript for instant interaction; a **subscription
layer that lives in the backend** so other apps (not just this UI) can
subscribe to live queries later. MCP Apps generative UI is phase 2.

## Decisions (from Q&A)

| Decision        | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell           | Browser app served by `kb ui` (no Electron/Tauri). **Why not Electron for "local ops like materialization":** those ops run in the `kb ui` bun server, which has full fs access — the browser only calls actions. Electron's sole trick is bundling Chromium+Node to get fs in one process; we already have a local server process. Zero gain, +200MB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Frontend build  | **Vite+ (`vite-plus@0.2.8`, on npm, Evan You et al — confirmed installable)** + React 19 + Tailwind 4 + Zustand — same stack as nxus, so its outliner forks in cleanly. If vp misbehaves anywhere, its config is Vite config; plain-Vite fallback is a dependency swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bun's role      | Runtime for the server only (`kb ui` = Bun.serve listen + WS upgrade + `Bun.file` bodies). HTTP routing, asset/static reads, SubscriptionHub message/broadcast/cleanup, and fs-watch reloads are Effect v4 programs (`@effect/platform-bun` FileSystem). **Not** `@effect/platform-bun` `BunHttpServer` as the outer server: on effect@4.0.0-beta.106 its `HttpServerRequest.upgrade` path deadlocks on the request fiber when awaiting the open deferred / forking `socket.runRaw` from that fiber (empirically verified). Protocol-preserving Bun.serve WS + Effect hub is the working single boundary. Bun ≠ bundler here; Vite builds the frontend. No Effect in the browser bundle.                                                                                                                                                                                                                                                                                                                                                                                 |
| Reactivity      | Client-side DataScript (Logseq architecture) **plus** backend subscription hub designed for third-party consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Edit scope v1   | Solid basics (outline CRUD, props/tags panel, [[ref]] autocomplete, query page, backlinks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| MCP Apps        | **Backbone now, apps later**: shared render layer (query + template → HTML) ships in this wave and kb MCP serves one `ui://` resource through it. Adding an "app" later = adding a template + query, nothing structural.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Editing surface | **The editor is the main human editing surface.** The outline (`@kb/outline`) and its UI (`@kb/outline-ui`) are where a person creates and edits every core concept: nodes, tags, fields and their types and options, references, queries, views and their settings, layouts, and the switches and settings of extension families. A concept that can be written only through the CLI or MCP, or only as a raw `sys.*` value, is a gap, recorded as a `#gap` node (the editor audit: `docs/research/2026-10-20-editor-audit.md`). The CLI and MCP are equal surfaces for agents: they reach the same actions, and neither is the editor's fallback.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Navigation      | **Every navigation is in the URL.** Going somewhere (opening a node, zooming or unzooming the outline, entering or leaving an ontology scope, switching a page, a perspective, a canvas or a lab scene) goes through the router: the focused pane moves by `navigate`, which pushes a history entry, so back and forward walk it and a reload lands where the page was. No gesture moves the place the focused pane shows by writing a store alone; the page's zoom follows the URL (Panes and layouts: the zoom is a location). Minor state a page chooses to reflect is replaced, not pushed (`replacePath`): which pane is focused, including a pane just opened beside (its predecessor stays on screen), and a location the page cannot show. The URL names the focused pane only: a pane that is not focused moves in the layout, without a history entry, and a link restores the focused pane, not the arrangement around it. Not places: selection, a reveal within the zoom, a popover, an expanded row, entering a canvas group, presenting a canvas, scroll. |

## Why bun _and_ vite (your question)

The backend must be bun — kb's store/query/registry code is bun TS, and
`kb ui` is just another surface over the same registry. The frontend is a
normal web app; Vite is its dev server + bundler. They compose:
`kb ui --dev` proxies to Vite HMR; production `kb ui` serves `ui/dist/`
static files. Vite+ ("vp") is a superset CLI — if you install it later the
config carries over unchanged.

## Architecture

```
browser ──HTTP GET /api/graph────────► kb ui server (bun)
   │  ◄──full node set (jsonl parse)──   │
   │                                     ├─ registry.invoke (same actions as CLI/MCP)
   │ ──POST /api/action {id,input}─────► ├─ JsonlStore commit
   │  ◄──receipt───────────────────────  ├─ fs.watch .kb/nodes.jsonl
   │                                     └─ SubscriptionHub
   │ ◄──WS: tx events / query rows ─────────┘
DataScript (client) ← re-run open queries on tx
```

Server ownership lives behind the stable facade `packages/app/server/src/index.ts`, which
re-exports the public CLI/server seam (`startUi`, `runUiCli`, …). The
implementation modules under `packages/app/server/src/` split by concern:

| Module             | Owns                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| `server.ts`        | Bun.serve / Effect runtime boundary, fs-watch, CLI entry, Scope shutdown          |
| `http.ts`          | Effect REST/API routing, failure mapping, kb asset GET, SPA static fallback       |
| `delivery.ts`      | how every answer is sent: `304` revalidation, brotli/gzip ([Delivery](#delivery)) |
| `invoke.ts`        | how the server runs an invocation it is handed: reload, then the invoke core      |
| `session.ts`       | Effect `SubscriptionHub` (clients, message processing, broadcast, cleanup)        |
| `assets.ts`        | Effect SPA `ui/dist` static + `.kb/assets` serving (`Bun.file` body at boundary)  |
| `saved-queries.ts` | Effect list/materialize `.kb/queries/*.edn`                                       |
| `paths.ts`         | `KB_PKG_ROOT`, `UI_DIST`                                                          |

- **Client DataScript**: browser loads all nodes once, builds the same datom
  set the CLI builds (shared `foundation/query` code — it's isomorphic TS, no
  node APIs in the datom builder). Keystrokes never wait on the network.
- **Mutations**: `session/runtime.ts` invokes isomorphic actions against the
  browser's `BrowserStore` and existing DataScript index first, then sends the
  same invocation through one ordered `POST /api/action` push lane. The local
  write stays visible until its receipt is confirmed, under the hold rules of
  [Replica sync](#replica-sync). An isomorphic action whose declared mode is
  a read is answered from the replica and never pushed, since it has nothing
  to replicate. Port-only actions remain server-owned.
  Cold-boot `loadGraph` may fall back to fixtures; `hydrateFromWire` is
  boot-only — live resync uses `refreshFromWire` so `loadSource` stays `api`.
  No temp-id dance (nxus's pain): client mints final ULIDs, server accepts
  explicit ids (already supported by `node.add`).
- **Change flow**: server fs-watches `.kb/` (catches CLI/MCP/agent writes
  too) → reloads nodes → rebuilds a DataScript database → broadcasts node-level
  deltas on WS → the client applies deltas → open queries re-run.

### Replica sync

The browser replica is the server's graph as of one `rev`, with the local
writes the server has not confirmed laid over it. One state machine,
`BrowserReplica` in `session/replica.ts`, owns that. `KbWsClient` carries its
messages and asks `since` on its behalf, `api/live.ts` runs the snapshot fetch
it asks for, the graph store (`stores/graph.store.ts`) holds what it applies,
and the outline reads its rows from that (`outlineNodes`). None of them reads
a rev.

**State.**

- `rev` is the server rev the replica stands on. There is one rev space, the
  server's. Only an applied frame or an installed snapshot moves it.
- The **server image** is every node as the server had it at `rev`, including
  held ones.
- A **hold** is opened by each local write that is pushed. It carries the ids
  that write's local commit touched, and `at`, the rev named by its receipt
  (unknown until the receipt arrives). A held id shows its local image, and
  every other id shows its server image.
- The **phase** is one of `live`, `catching-up(from)` (a `since(from)` is
  outstanding) or `awaiting-snapshot(fetching, failures)`.

**Transitions.** Each row is an event and each column a phase. "fetch" means
`GET /api/graph`, and "fetch unless fetching" leaves an in-flight fetch alone.

| Event                       | `live`                             | `catching-up(from)`                                          | `awaiting-snapshot`                                           |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `tx`, rev ≤ `rev`           | ignore                             | ignore                                                       | ignore                                                        |
| `tx`, rev = `rev`+1         | apply                              | apply, → `live`                                              | ignore: the snapshot and its `since` cover it                 |
| `tx`, rev > `rev`+1         | `since(rev)`, → `catching-up(rev)` | `since(rev)` unless `from` = `rev`                           | ignore                                                        |
| `hello`, head = `rev`       | stay                               | → `live`                                                     | fetch unless fetching                                         |
| `hello`, head ≠ `rev`       | `since(rev)`, → `catching-up(rev)` | `since(rev)` again: a new socket has no question outstanding | fetch unless fetching                                         |
| `snapshot-required`         | fetch, → `awaiting-snapshot`       | fetch, → `awaiting-snapshot`                                 | fetch unless fetching                                         |
| snapshot fetched            | ignore                             | ignore                                                       | install, `since(snapshot.rev)`, → `catching-up(snapshot.rev)` |
| snapshot fetch failed       | —                                  | —                                                            | not fetching; retry after 500 ms, doubling to 10 s            |
| retry due                   | —                                  | —                                                            | fetch unless fetching                                         |
| `reconcile` (a push failed) | `since(rev)`, → `catching-up(rev)` | `since(rev)` unless `from` = `rev`                           | ignore                                                        |

**Apply a frame.** The frame's upserts and deletes go into the server image.
The visible replica takes them only for ids that no hold holds. `rev` becomes
the frame's rev, and every hold whose `at` ≤ `rev` is released.

**One view update per entry point.** The machine is moved through events in
bursts (`receiveAll`; `receive` is a burst of one), and what a burst — or a
settle, or a drop — decided the visible replica takes is applied once, at
its end, at the rev it ended on: the net change per id, so a burst of frames
is one outline projection, not one per frame. An installed snapshot replaces
whatever the burst had taken before it. `api/live.ts`, the one place live
events enter the machine (socket messages, the fetched snapshot, a retry),
queues them and hands them over as one burst per animation frame (on a timer
in a hidden tab), so the live stream costs at most one store update per
frame. Holding an event for a frame is latency to the machine, which the
table already tolerates.

**Install a snapshot.** The snapshot becomes the server image and `rev`
becomes its rev, even when that is below the old one. Every hold whose `at` ≤
`snapshot.rev` is released, because the snapshot contains that write whether
or not a frame for it was seen. The visible replica becomes the snapshot, with
each id that is still held keeping its local image.

**Holds.**

- A write's hold is settled by its push's receipt. A succeeded receipt
  carries `rev`, the server log's head once the invocation had committed, so
  every frame it caused is at or below it. The hold records `at` and is
  released when `rev` reaches it, at once if `rev` already has. While the
  replica awaits a snapshot, the snapshot's install decides instead. A write
  the server commits as a no-op causes no frame, and is released the same way.
- A failed receipt or a thrown push drops its hold at once, then reconciles.
- Releasing a hold shows the server image, including an absence, for each of
  its ids that no other hold still holds.
- Typed text is a write too. The node's first keystroke opens a hold, later
  keystrokes join it, and the coalesced flush is the push that settles it. A
  structural write flushes every pending text first, and the one push lane
  keeps them in order, so no text is discarded, including that of a node
  about to be deleted.

**What the table guarantees.**

- Only the server escalates to a snapshot. The browser fetches `/api/graph`
  only after the server answered `snapshot-required`. A failed push asks
  `since` and nothing more.
- `awaiting-snapshot` is left only by installing a snapshot. A hello at the
  replica's rev does not clear it, and a failed fetch is retried until one
  lands.
- No frame is applied over a snapshot it predates, and none is lost to one.
  Frames that arrive while the snapshot is fetched are ignored, and are
  replayed by the `since(snapshot.rev)` that follows its install.
- A frame never rolls back a local write that is newer than it. The frame
  lands in the server image, under the hold.

A server whose head is behind the replica's rev (its tail was replaced, not
restarted: `rev` survives a restart, see `protocol.ts` → `GraphSnapshotSchema`)
is not treated as a special case. The replica asks `since(rev)`, the server
answers `snapshot-required` for a rev ahead of its head, and the snapshot's rev
is authoritative. The browser never infers a restart from a head.

### Replica queries

The page asks datalog of the replica's engine, and the engine answers in
its own time: no page code holds a synchronous query handle. What the page
holds is its **query answers** (`ReplicaQueries`, `@kb/ui-sdk`), one per
query text, each as of a generation of the replica.

- **The engine lives in a Web Worker.** The page's replica index is a
  `RemoteIndex` (`@kb/query`): the node table and its point reads stay on
  the main thread, and the derived datalog database lives in a worker
  (`engine/index.worker.ts`, `serveIndex`), fed the same txs. A query is
  a message to it and its answer a message back, so a slow query never
  holds the page. The server and the CLI keep their in-process index; the
  worker is the page's alone. A host without workers (the unit tests)
  serves the same protocol in-thread (`inThreadPort`, which a test takes
  from `@kb/ui-test-kit`). DataScript is the worker's: the page SDK carries
  no index (`@kb/ui-sdk` exports neither `DatascriptIndex` nor
  `inThreadPort`) and `@kb/query` declares itself free of side effects, so
  the page's own bundle carries no DataScript. A build holds it to that:
  `packages/app/server/tests/page-bundle.test.ts` fails when a chunk
  `index.html` loads carries DataScript, or when those chunks pass their
  byte budget.
- **Every run has a budget.** A query is given `QUERY_BUDGET_MS` from the
  moment the engine starts it. A run that overruns is stopped — the worker
  is terminated, a fresh one is loaded from the table, and the runs it had
  queued are asked again — and its answer is `over-budget`, which readers
  show as "took too long" rather than as wrong datalog. A run the engine
  cannot interrupt (in-thread) is still answered `over-budget` when it
  returns late. A move of the replica asks every watched query again, and
  the engine runs only those whose last run read something the move
  touched; the others it answers from what it remembers (DESIGN.md → Query
  layer → A run's read set). A restarted engine remembers nothing.
- **Time moves answers too.** An answer whose run read the clock
  (`kb/today`, `kb/instant-now`, …) holds until a time (`holdsUntilMs`,
  DESIGN.md → Query layer); from then it is not current, and a watched one
  is asked again, so a page left open past midnight shows the new day
  without a write. The page holds answers against its wall clock
  (`AnswerClock`, `pageClock`).
- **Query nodes too.** The rows under a query node, a chart over it and a
  count of it are answers like any other: the page subscribes to no query
  over `/ws`, whether the socket is open or not.

- **A read never blocks.** A reader reads the last answer the page has for a
  query and whether it is current. A query not yet answered reads as no
  rows; one the engine refused reads as the error it threw. Reading a query
  that is not current asks the engine for it, after the reader's turn.
- **One execution per query.** Every reader of one query text shares its
  answer, so the results under a query node, its count and a chart over it
  are one run, and a query asked twice before it is answered is asked once.
- **Live while watched.** A mounted reader watches the queries it read
  (`useQueryAnswer`, `useAnswered`); when the replica moves, the watched ones
  are asked again, and until their new answers arrive readers keep the last
  ones, so a write never blanks what the page shows. A new answer whose rows
  are the last one's keeps the last one's rows array, so a reader that
  derives from the rows does no work for a move that did not change them. A query nobody watches
  is asked again only when read, and is forgotten once enough others have
  been read since.
- **Pure readers stay pure.** A `@kb/model` reader that takes a synchronous
  runner (`resolveOntology`, `allowedRefIdsOf`, `relationFieldsFor`) runs
  over the answers' runner, and a React reader re-runs it when an answer it
  read arrives (`useAnswered`); an event handler waits for every query it
  asks to be answered as of now (`settle`, the page's `answered`).
- **A value that must not be drawn half-built** (a graph) is held at its
  last settled value for the same subject (`useLastSettled`).
- **Actions.** An isomorphic action that runs on the page asks datalog of
  `QueryEngineService`, which the page binds to the same engine, one query
  at a time, outside the shared answers (its query may carry inputs).

### Delivery

How the page's bytes reach a browser, which is often across a tailnet relay
with a round trip of 100 ms or more. The server's HTTP boundary
(`packages/app/server/src/delivery.ts`) is the one place an answer is
encoded or answered `304`; a route says what it answers and how long it may
be kept, never how it is sent.

- **Kept by name.** Everything under `ui/dist/static/` is the bundler's
  output, named by its digest (Vite's `build.assetsDir`), and is sent
  `Cache-Control: public, max-age=31536000, immutable`: a browser that has
  it never asks again. Every other `ui/dist` file (`index.html` and the SPA
  fallback, the public files, the sandbox frame's script) is `no-cache`
  with a weak `ETag` from its size and mtime, so a reload revalidates it in
  one round trip and gets `304` when it has not changed
  (`staticCacheHeaders`, `assets.ts`). A repository extension's page half
  is kept by its digest the same way (`EXTENSION_PAGE_HEADERS`, `http.ts`).
- **Compressed when it is text.** A `200` whose type is script, style,
  markup, JSON or SVG and whose body is at least 1 KiB goes out in brotli
  or gzip, whichever the request's `Accept-Encoding` weighs highest (its
  q-values, `*` for a coding it leaves unnamed, brotli on a tie). Every
  answer that could be encoded says `Vary: Accept-Encoding`, its `304`
  too. Media, which is compressed already, an event stream and any
  streamed body go as they are. A `POST /api/action` receipt is encoded as
  a read is (the manifest is the largest JSON the page reads). A body the
  client may keep (it has an `ETag`, or is `immutable`) is encoded once per
  process at brotli quality 6 and kept by its SHA-256, within a 64 MiB
  budget; any other body (`/api/graph` after each change, a receipt) is
  encoded afresh at quality 4 and not kept.
- **Asked early.** `index.html` preloads `/api/graph`, so the snapshot
  downloads beside the bundle rather than after it, and the boot asks for
  `kb.manifest` beside the graph and follows it once the graph is in
  (`components/App.tsx`).

## SubscriptionHub — the "other apps can subscribe" layer

Designed as a backend service now, minimal v1, clear growth path:

```
WS protocol (JSON):
→ {op:"subscribe",   id:"s1", query:"[:find ?id ... ]"}   // EDN datalog
→ {op:"unsubscribe", id:"s1"}
← {op:"rows",  id:"s1", rows:[...], rev:N}   // full rows on change (v1)
← {op:"delta", id:"s1", ...}                  // future: diffed rows
← {op:"tx",    datoms:[...], rev:N}           // broadcast to graph subscribers
```

- v1 implementation: on every load, the server rebuilds a DataScript database
  from the current nodes; on fs change it re-runs each subscription's query and
  pushes rows if the result hash changed. The index runs only the queries a
  change touched (DESIGN.md → Query layer → A run's read set) and answers
  the rest from what it remembers.
- The browser UI subscribes to `tx` only and answers every query from its
  own replica (→ Replica queries); `rows` subscriptions are for thin
  clients, which need no DataScript.
- Growth path kept open, not built: result diffing, auth token if ever
  exposed beyond localhost. Server binds 127.0.0.1 only.

## Fork from nxus (verdict: fork the tree, ignore the plumbing)

nxus's outliner is genuinely portable — components import only a classname
helper; the tree algebra is a pure store over `Map<id,node>`; all data
coupling sits in two seam files we replace with kb calls.

Taking:

- `outline.store.ts` (419 LOC + tests) — indent/outdent/move/fractional
  order/visible-node flattening. Adapt node shape to kb (`children` array
  instead of fractional order props — simpler, kb owns order).
- `node-block.tsx`, `node-content.tsx`, `bullet.tsx` — recursive row,
  contentEditable + cursor/IME handling, keyboard map (Enter/Tab/merge).
- `field-value.tsx`, `fields-section.tsx` — per-type inline prop editors.
- `docs/outline-editor-prd.md` — feature checklist to track against.

Not taking: SQLite/Drizzle spine, server-fn sync hook (temp-id swap dance),
event-bus/dependency-tracker (DataScript tx listener replaces it), TanStack
Start/Router (we need one page + panels, not an app framework).

Known nxus gaps we must add ourselves: `[[ref]]` autocomplete, backlinks
pane, persistent collapse state (localStorage), query page.

## v1 feature list

- Outline: expand/collapse (persisted), zoom/breadcrumbs, add/edit/delete,
  indent/outdent, keyboard reorder; Enter/Tab/Shift-Tab/Backspace-merge.
- Node: props panel (typed editors, add/remove field values), tag chips,
  `[[` autocomplete inserting refs, backlinks pane.
- Query page: datalog textarea + run, saved queries (`.kb/queries/*.edn`)
  listed and runnable, results as table with node links.
- Search box (text substring) with jump-to-node.
- Live updates: edits from CLI/agents appear without reload (fs-watch → WS).
- ~~No drag-drop, no undo/redo, no table/board views in v1 (explicitly out).~~
  **Superseded.** Table/Board/Cards views shipped with the refinement wave,
  outline and canvas both have undo/redo, and board cards drag between groups.
  Outline row drag-and-drop is still not implemented (keyboard reorder only).
  See [Interaction model](#interaction-model-as-shipped-2026-08-23-wave).

## Interaction model (as shipped, 2026-08-23 wave)

The v1 list above is the original contract. Implementation waves rebuilt
the interaction layer on top of it — i1 (editor), i2 (graph), i3 (canvas),
i5 (cross-surface polish), i6 (ontology), i12 (contextual references). The
normative specs are
`docs/waves/2026-08-23/reports/r1-editor.md`, `r2-graph.md`, `r3-canvas.md`,
`r7-ux-sweep.md` and `r5-ontology.md`; each carries its own implementation
handoff with the honest cut list.

### Transient-prune remote compensation

When an empty session-transient is pruned after its optimistic `node.add` has
already reached the server, the mutation path MUST post a compensating delete.
Pre-existing nodes remain ineligible for this cleanup.

### Outline editor (i1)

**Transient nodes replace ghost rows.** There is no permanent phantom bullet at
the end of a list: `GhostNodeRow`, with its async character buffering and
`beforeinput` interception, is deleted outright. Tana semantics instead —
the outline's `createTransientNode` (`outline-ui/src/editing-writes.ts`)
mints a _real_ node synchronously through the write path's `createEmptyNode`,
the normal optimistic path, which activates it at offset 0, and marks it in the
outline store's `transientIds`. The click-to-create affordance is a whitespace strip
(`data-create-child-zone`) rendered at the end of every expanded container and
at zoom-root level. `pruneOutgoingTransient` silently drops a session-transient
node when focus leaves it while it is still empty; a node that existed before
this session is never pruned, so committed content cannot evaporate.

**Two keymaps, one row.** The authoritative tables are r1-editor.md §3.2; the
split is what matters here:

| Mode                                             | When                         | Owner                                                                           |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| **A — active edit** (caret inside node text)     | typing                       | `outline-ui/src/use-node-keydown.ts`                                            |
| **B — selection** (row selected, caret inactive) | after `Escape`, or arrow-nav | `outline-ui/src/selection-keymap.ts` + `outline-ui/src/use-selection-keymap.ts` |

Mode A owns split/merge/indent/outdent, soft line break (`Shift+Enter`),
vertical caret motion, and autocomplete interception. Mode B owns
`ArrowLeft/Right` collapse-expand-parent-firstchild, `o` / `Shift+O`
create-below/above, `Space` toggle, `Cmd+.` zoom, and printable-character
re-entry into Mode A. Focus hand-offs are specified per operation (split → new
node at 0; indent/outdent → same offset; merge → the join boundary; delete →
neighbour) and tested.

**Caret geometry is measured, not guessed.** `lib/caret.ts`
exposes `readCaretGeometry` (range rects → real line detection),
`verticalArrowDecision` (pure: is this arrow a line move or a row move?) and
`nearestOffsetForX` (column restoration), fed by `outlineStore.focusX`. Offsets
into the _serialized markdown_ — not the DOM text — come from
`lib/md-edit.ts` (`getCaretSerializedOffset` / `setCaretSerializedOffset`), a
recursive measure that survives element boundaries and counts an atomic ref
pill at its full token length. A layout-free environment (unit tests, headless)
degrades to offset-based behaviour rather than breaking. `focusSeq` forces
caret re-placement when a row remounts.

**Undo/redo is action-level, not keystroke-level.** `actions/mutations.ts`
`restoreInvocations` compares the graph states before and after a plan and
derives compensating shared-action invocations. The graph store keeps bounded
`undoStack` / `redoStack` of `{ undo, redo }`, each `UNDO_DEPTH` deep (`@kb/ui-sdk`: the one depth of every undo ring the UI keeps, 200 steps).
`Cmd/Ctrl+Z` binds outside editable targets, and in api mode compensation uses
the same local invocation + ordered push lane — there is **no** server-authoritative
undo journal, and rapid same-node text edits are not coalesced. Structural
operations (split, merge, indent, outdent, delete, move) are the covered case.

**Node text is one surface, read or edited.** There is no raw-source edit
mode. `lib/md-edit.ts` `inlineNodes` is the one description of what inline
markdown renders as; `renderInlineMarkdown` builds it as DOM and `InlineMarkdown`
(`components/ui/md-view.tsx`) as React, and a parity test holds the two to the
same markup. Every source character is in that tree: a formatted segment keeps
its delimiters (`**`, `` ` ``, `[`/`](href)`) as `.kb-md-mark` text beside the
formatted element, hidden, so the DOM serializes back to the stored string
byte for byte and a DOM caret position _is_ a serialized offset. Entering edit
mode therefore swaps nothing visible: the row's text element becomes
contentEditable over the same tree, a click lands where it was aimed
(`offsetFromPoint` on the tree the editor edits), and only the segment the
selection touches shows its delimiters, faint (Obsidian-style live preview;
`revealMarkupAtSelection`). Typing that changes what the text means — the
second `*` of `**`, breaking a link — rebuilds the tree around the caret
(`isCanonicalInline`); typing inside a segment leaves the browser's DOM alone. A
boundary caret rests outside hidden markup, so typing after `**b**` is plain.
While editing, the DOM is the text: it is rebuilt from `content` on mount and
when `content` moved on its own (a merge), never from a `content` still behind
the editor's own writes. Text undo inside the row is the host's
(`lib/text-history.ts`, `components/ui/use-text-history.ts`), recorded from the
row's `content` stream so every write path — typing, `[[` completion,
Shift+Enter — is covered, because native undo cannot follow a rebuilt tree;
structural undo stays the store's (below).

**Refs are atomic in the editor.** `[[id|label]]` renders as a
`contenteditable=false` link carrying its serialized token, in both states, so
a raw ULID never faces the caret and serialization round-trips canonical
markdown. The caret rests beside a pill (in its parent), never inside it. A
click on it navigates whether the row is being read or edited
(`routeInlineClick`).

**A bare url is a link.** The inline grammar (`lib/md-inline.ts`) autolinks a
bare `http://`, `https://` or `www.` url the way GFM's extended autolink does:
it starts at the text's start, a space or one of `*_~(`, runs to whitespace or
`<`, and leaves trailing sentence punctuation and a `)` it did not open
outside it. It is the same link segment `[label](url)` makes, with no markup of
its own — its label is its own spelling, so it rebuilds byte for byte, and
`www.` gains its scheme in the href only (`@kb/model`'s `normalizeUrl`, the url
field's form) — so it renders, edits and follows exactly like a markdown link,
in node text and text field values alike. Segments are flat, so a url inside
code, emphasis or a link's label stays what that segment makes it. A url or a
number _value_ is not markdown: its editor is its plain string, so the url
field's own text is never autolinked while it is typed.

**Links are two kinds, told apart at a glance** (Tana's). A reference
(`[[id|label]]`) stays in the graph: it wears no mark, and its label is drawn in
its target's first tag colour, inked the way a tag chip's text is (`refInkOf`
and `tagInk` in `lib/tag-color.ts`), or in the link colour when the target is
untagged. A link — `[label](url)`, a bare url, a url field's value — leaves
the graph and wears the external-link mark before its label
(`.kb-md-link::before` in `tokens.css`: a pseudo-element, so it is never text
the editor serializes or a caret offset counts). The kind is decided once, in
the inline tree: `inlineNodes(text, ink)` takes a `RefInk` — how a reference's
target is inked — from the surface, because `lib/md-edit.ts` knows no graph,
and carries it on the reference as the `--kb-ref-ink` custom property. Every
surface passes one (`useRefInk` for the read-only `MdView` surfaces, the
schema they already hold for node text and text values); a missing one is a
compile error, not an uncoloured reference. Tana also shows a target's own
icon or emoji before its label; kb's model has no node icon, so there is none
to show.

**The bullet is one definition.** `lib/bullet-mode.ts` decides everything a
bullet shows — its kind and shape, its glyph, whether it has a halo, the
paints of its halo, dot and ring (a node's tag colours, or the ink at a
stated strength when it has none) and its geometry (the 24px box, the 4px
leaf and 5px parent dot, the halo inset, the 18px ring with its stroke and
its dashes fitted whole to the circle, and the query magnifier as a lens and
a handle rather than a copied path) — as one record,
`BulletAppearance`, and `outlineBulletAppearance` reads it off an outline
node. `Bullet` renders that record and decides nothing; the graph's bullet
theme paints the same record (Graph → The themes), so the two cannot drift.

**Expansion is the reader's, per tab.** `expansion` holds a choice per row,
open or closed, only while the reader can undo it: a choice that equals the
row's default, or names a row that can no longer expand, is dropped
(`undoable`), so no row is held collapsed with no gesture to open it. A row
the graph does not hold now keeps its choice, so a row restored by an undo
comes back as the reader left it. A row shown open stays open when the graph
gives it children or fields. Each tab keeps its own expansion while it is
open, and storage seeds it at load: another tab's choices are read at the
next load, never merged in by a graph move. Storage is shared, so a save
applies only the ids this tab changed onto what storage holds at that moment
(`saveExpansionChanges`), never a snapshot of the tab's, and drops stored
choices that are no longer undoable on the way. A load writes nothing. The
stored form is one key, `kb-expansion`, holding `{ open, closed }` and
written in one `setItem`. While it is absent, the legacy `kb-expanded` (open
ids) is read in its place. The legacy key is never written or deleted, so a
tab on an older build still reads it.

**A row depends on what it reads, not on the graph.** The page holds the
graph as whole values — the outline's rows (`outlineNodes`), and the graph
store's schema (`schemaOf`) and query index — and every graph change, expand
or collapse renews them. The rows are not stored: they are read from the graph
store's snapshot, opened and closed by the outline store's `expansion`, so no
reader can see the rows of one snapshot beside another. Two properties keep
that from costing a render per row:

- The projection is persistent. `wireToOutlineMap` takes the map it replaces
  and keeps a node's object when the node projects to the same value, which
  the schema does per snapshot. Unscoped, the outline's rows are the schema
  itself, read through the expansion (`withExpansion`, a view that builds no
  map): a row shown as its default is the schema's own object, and one shown
  the other way is one object per schema node. Under a scope they are the
  scope's projection read the same way. So a node's identity changes exactly
  when what it shows does. Each snapshot builds the schema map, a scope
  builds its own projection, and expanding or collapsing builds nothing.
- A row reads the graph through a tracked read (`useGraphReadThrough`,
  `@kb/ui-sdk` → `lib/graph-read`, over a `GraphSource`; the shell's
  `useGraphRead` binds it to the graph store and the projection the page
  stands in, `pageGraph`): the outline, schema and
  index as views that record which ids were asked for (a walk records the
  whole map, a query the index generation). The view is renewed, and the
  row re-renders, only when one of those reads changed — an outline entry
  by identity, a schema entry by `sameMeaning`, since a schema reader never
  asks about expansion. Reads always answer from the source's current maps,
  so a read added later is never stale. It is a selector over the one
  store, not a second copy of it. The rows, their text host binding
  (`useNodeTextBindingThrough` over a `NodeTextPort`), their fields section
  and the list frame view read this way; focus, selection and caret placement are selected per instance
  (`activeNodeId === nodeId && activeInstanceKey === instanceKey`), not as
  store-wide values.

So a one-node change re-renders that node's row (and the list frame view
above it, which renders the same memoized children); an expand re-renders
the toggled row and mounts its subtree; moving the selection re-renders the
two rows it moves between. `@kb/ui`'s `page-tests/outline/update-cost.test.tsx` pins
all three. The `[[` candidates (`nodeCandidates`, label order derived once
per map) are computed only while a popup is open.

Every expanded row is mounted; the outline is not windowed, because a
windowed list fights the contentEditable focus and caret model (a row that
unmounts takes its editor, its selection and its scroll anchor with it). Nor
do row blocks carry `content-visibility: auto`. Measured on a 427-row
outline, it removed the long frame of a first scroll only under a 6× CPU
throttle (101 → 26 ms; 1× was already ≤ 17 ms), and did not change load. It
costs too much for that: the containment it implies makes every block the
containing block of the fixed-position pickers anchored in its rows, and
clips them; estimated sizes make the scrollbar jump by thousands of pixels
on the first scroll; and `scrollIntoView` targets drift as the skipped
blocks above them are laid out. What remains is mount cost, linear in
expanded rows (load ≈ 0.2 s at 1×, 1.1 s at 6×), named as
`GAP [[01M41062Z83M38GYHC276XJ8RF]]` where the list renders its rows.

**`sys.*` rows are read-only at the door.** `store.activateNode` degrades a
`sys.*` id to selection so no caret ever enters one; the row shows a hover
padlock instead of failing on write.

**A query node's query is tucked away; its results are its content.** As
Tana keeps a search node's expression behind "Edit query", the builder
(`outline-ui/src/query-builder/`) is drawn only while open, and the control
that opens it is the node's own view toolbar, beside its view modes and
filters: a Query button (`data-query-toggle`, `aria-expanded`,
`aria-controls` the builder). On a row the toolbar shows on hover or focus
within, and stays while anything it opened is open; on a zoomed query page it
sits in the header, one click from the query, never behind the plain list's
gear. A zoomed query page draws the query's results as its rows, as under a
query row, and offers no create strip. Open or closed is the outline's
screen state per node (`queryBuilders`), kept for the session and never
written to the graph. A query that says nothing yet — no EDN, or no
conditions, as a new one starts — opens its builder; one that says something
opens closed. A write from the builder pins it open, so the first condition
never folds it away under the caret. A query that fails shows its error
with an "Edit query" button beside it, the way to its editor while it is
tucked. From the keyboard: Tab reaches the
button, and the node menu offers "Edit query" / "Hide query", opening a
closed row to show it (`outline-ui/src/outline-commands.tsx`).

### Contextual references (2026-08-27)

Tana's _reference_, expressed with no new storage shape and no new
widget: a **contextual reference is an ordinary node** carrying its target on
the `sys.f.ref.target` ref field. The field is the whole declaration — no tag —
because a node with no target is not a reference (DESIGN.md → [Kinds, roles and
options](./DESIGN.md#kinds-roles-and-options)). Same anatomy as a query node
(`sys.f.query`), so collapse state, instance keys, both keymaps, undo and the
transient rules are the ordinary ones, and `frame-rows.ts` did not change:
a reference row's frame is simply its target.

`packages/app/ui/src/lib/contextual-ref.ts` owns the rules that make it read as a
reference:

- **Display is the target's text, verbatim.** `rowText(node, nodes)` returns
  `node.text` for an ordinary row and the _target's_ text for a reference, so the
  row renders through the same inline-markdown path as every other row: bold,
  code, inline refs and `assets/` media all render as content. Returning a
  `[[targetId|label]]` token instead was tried and rejected after looking at the
  rendered page — a ref label is terminal in the inline grammar, so `**bold**`
  showed up literally and the entire row went link-coloured. A missing target
  renders as the `[[id]]` token, the way every other dangling ref renders, never
  a blank row and never a throw. `ReferencesSection` calls the same function, so
  a referrer whose own text is empty is not a blank line in a backlinks list.
  What a ref _prop_ buys over a hand-typed `[[id|label]]`: the hand-typed label
  freezes at insert time, this resolves every render.
- **The row shows its target; its place is its own.** `shownNode(node,
schema)` is the one answer to "which node does this row show" — the target
  for a reference, the row itself otherwise (and for a dangling reference) —
  and every content read of a row goes through it, on every surface (list row,
  table row, card) and in the keyboard walk: the text (`rowText`, the one text
  channel `NodeContent` renders and writes), the tag chips, the bullet's
  paint, the field rows and table/card cells, the children and query results
  under the row, its view, what the reveal chords and ←/→ count as its
  children, where `o` and the create-child strip mint a child, and the page
  ⌘-click and the zoom chord open. So a reference row reads exactly like its
  target as an ordinary row, and every write it makes lands on the target, as
  in Tana. What stays on the reference node is its **place** — the parent
  edge, sibling order, selection, instance key, collapse, Tab, moves and
  delete — so the one row↔node identity that instance keys, both keymaps,
  optimistic mutations and undo are built on is not forked, and deleting the
  row deletes the reference, never the original. Children of the target drawn
  under a reference get instance keys under the _reference's_ key
  (`tree/…/ref/child`), so the same node shows at two places with two
  identities, exactly like a query result. The keymap's `ownsText` is the one
  place the text difference shows: Enter on a reference opens the next row
  instead of cutting the original's text (`planSplit(…, "end")`), and the
  text-joining chords (Backspace at offset 0 merging up, Delete at the end
  merging the next row in) are claimed inert when either string is not its
  row's own, because there is no string of the row's to join.
- **A reference never expands into itself.** Showing the target's children
  makes the outline a graph walk, so a reference under its own target (or two
  references pointing into each other's subtrees) would recurse forever.
  `showsAncestor(instanceKey, node, schema)` is the stop — the row's shown node
  is already shown by a row on its instance path (`instanceAncestorIds` in
  `lib/instance-key.ts` reads the path) — and `resolveRowChrome` and the
  visible-instance walk both read it, so such a row is a leaf in the render
  and in keyboard navigation alike.
  `rowTextReadOnlyReason(id, node, schema)` owns what cannot be written: `sys.*`
  text (whether the row is the sys node or a reference to it, r1 D20) and a
  reference whose target is missing; it supplies the padlock's wording.
  _History:_ until 2026-09-27 the reference's text was read-only and a click
  opened the original; that was rejected on the grounds that it made a
  reference a different kind of row to click and type into. Until 2026-09-28
  only the text was routed — tags, fields and children were the reference
  node's own ("contextual content") — which made a reference to a tagged node
  render as bare text; the owner's rule since is that a reference row renders
  exactly as its target would, the dashed bullet being the only difference.
- **The bullet reuses the existing reference treatment** (dashed ring). Only the
  bullet: a _query-result_ row — read from its instance key by
  `isQueryResultInstance` (`lib/instance-key.ts`), never passed as a flag —
  keeps suppressing nested query results, the create-child strip and the
  structural chords, because its place under the query is computed rather than
  a child edge. A contextual reference is a real child whose children **are**
  its own, and creating them is the whole point. `isReferenceRow(node,
isQueryResult)` in the kit's `lib/row-chrome.ts` is the one answer, read by the list
  row's chrome and by table and card rows alike. Apart from those gates a
  result row is clicked like any row in every view: a row click selects, a
  text click edits, a bullet click toggles and ⌘-click opens the node.

**A reference shows its target's children, not its own.** The reference
node's own children, if it has any, are not drawn anywhere: nothing creates
them any more (the create-child gestures under a reference mint under the
target), and a store written before 2026-09-28 holds none.

**Creation** is a node-⌘K step, next to _Turn into query_: **Turn into
reference…** opens the picker, which is the same picker `Add tag` and `Add field`
use — generalized from two kinds to three, with the candidate _source_ as the
only difference. A reference's candidates come from `nodeCandidates`, the
source the `[[` autocomplete and the field picker share, over the one picker
engine (→ [Field values](#field-values-one-slot-grammar)), so no fourth node
picker was added. The gesture itself is `mutations.addTag` +
`mutations.updateProp`, i.e. plain `node.update` — no new registry action, and
the CLI/MCP form is in DESIGN.md.

**Named gaps.** The reference node's own props — its target among them — are
not drawn by its row, since every field row is the target's; the target is
repointable only from the CLI or MCP (`node.update`), and _Turn into
reference…_ is withheld from a row that already is one. View filters, sort and
board grouping read a row's own props, so a reference inside a table or board
sorts and groups as an empty node. Enter at the end of an expanded reference
opens a sibling, where an expanded ordinary row opens its first child, because
`planSplit` reads the row's own children. The References list shows a
reference by its rendered target text rather than by the ancestor context it
sits in, so on the original's own page a reference row reads as a copy of the
original's text; a context breadcrumb is the obvious next step and is not
built. There is no global ⌘K entry: a contextual reference needs both a host
row and a target, and the global palette has no two-step for that.

A References row names each typed relation its referrer holds to the node
(a non-system ref field pointing here), worded from the node's side: the
field's inverse label when it names one ("influenced by"), else its label
read toward the node ("influences →"); a referrer that only mentions the
node shows none. A mention is typed where it is read: with the graph
family's setting `graph.suggest-relations` on, a row that mentions a node
offers "Type this reference…" in its node menu. The graph contributes the
command and the palette step it opens (`PaletteStepPoint`, `graph-ui`
`type-reference.tsx`). The step lists each relation the row's mentions can
be typed as and are not yet, "field → node", by the one rule every relation
write reads (`relationFieldsFor`), and picking one types it through
`graph.relation.type` as the person's own gesture. A chip itself has no
menu; `kb relate`, the agent and the graph's "Link as…" type relations too.

### Field values: one slot grammar

A node's field values are drawn by one component on every surface —
`NodeField` (`outline-ui/src/fields-section.tsx`): the outline's field
rows, a table's cells and a card's fields are `FieldRow` chrome around the one
`FieldValueStack`, so none of them has its own loop of editors. Each value sits
in a **value slot** (`ValueSlot`, `outline-ui/src/value-slot.tsx`), and
**the slot owns every gesture**; a value's kind contributes only data. A kind
is a row in `VALUE_KINDS` (`outline-ui/src/value-kind.ts`: its editor
mode, how it reads as text and back, when it is blank, where it points, how its values sit
together) and a row in the slot's view registry (its glyph and its surface).
The surfaces in `field-value.tsx` draw and edit; none has a click or key
handler of its own. A new type is two rows, never a component deciding its
own clicks.

**The label column belongs to the field, not to its values.** The type glyph
is the field's own button (`FieldRow`, labelled "Configure field <name>"). A
field is a node and its page is where it is configured — its type, its
target, its values' kinds — so the glyph follows the field the way a bullet
follows its node: a plain click opens it, ⌘/Ctrl-click reveals it. A row that
stands for no field node (a preference) draws the glyph inert. `FieldRow` is
the row's anatomy, a primitive of `@kb/ui-sdk` that prefs renders too
(`PrefFieldRow`); it is handed its glyph. A field's glyph is its kind's row
in the value views' registry (`fieldGlyphOf`), so the glyph and the editor
come from one row.

**Three verbs, the same on every kind.**

| Verb                                               | Mouse                                                                                                                                                                  | Keyboard                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Follow** (a ref's node, an option's page, a url) | plain click on a _pointer segment_ — a ref label, an option chip, a url's link, a `[[ref]]` pill in text — exactly as in node text; ⌘/Ctrl-click anywhere on the value | ⌘Enter, at rest or editing                                                                                                                 |
| **Edit**                                           | plain click anywhere else in the slot; a caret lands where the click did                                                                                               | Enter or F2; a printable key opens it with that key typed (replacing the value; a picker starts its query with it); Space flips a checkbox |
| **Add** (many-valued fields only)                  | the "+" in the trailing space of the last value, on hover or focus                                                                                                     | Enter at the end of a typed value; the picker, which stays open                                                                            |

Following is one function for every pointer in kb (`lib/follow.ts`:
`routePointerClick`, the bullet rule `bulletClickIntent`, and `useFollow`,
which carries a follow out); a url's link is a real anchor, so the browser's
open, middle-click and context menu work.

**Keys.** At rest (the slot focused, its editor closed): ↑/↓ and
Tab/Shift-Tab move through the field's values and out to the row; Backspace or
Delete takes the value out; Escape hands the keyboard back to the row,
selected. While a caret editor is open: Enter commits (Shift+Enter is a line
break in text), Escape reverts and leaves the value focused, Tab or an arrow
off the text's first or last character commits and moves on, and Backspace in
an emptied value takes it out and opens the one before. A picker and the date
editor keep their own keys. The chord tables are
`outline-ui/src/value-slot-keymap.ts`.
The rows' keymaps pass through the values: ↓ off a row's last line (editing
or selected) lands on its first value, ↓ from its last value goes to the next
row, ↑ comes back the same way (`enterFields`; the order is read off the DOM
by `outline-ui/src/value-slot-nav.ts`, never kept a second time).

**Adding has no line of its own.** Enter at the end of a value of a
many-valued field commits it and opens the next value's slot; Enter on that
empty slot closes it. A typed value emptied is taken out, not kept blank.
Picked values are added in the picker. A one-valued field — and a checkbox,
which holds one value by its type (`cardinalityOf`) — offers no add.

**Per kind.**

- **text** is node text: it renders and edits through the same live preview
  (`readInlineInput`, `useRevealMarkup`), and a `[[id]]` token in it is a
  mention like one in node text (DESIGN.md → Refs, `nodeMentions`).
- **url** is a link at rest, labelled short (`urlLabel`), the full url its
  title. Its form is `@kb/model`'s (`normalizeUrl`: http(s)/mailto, a bare
  host made https, every other scheme refused), and every surface parses
  input through the one `parseTypedValue`, which the write check agrees with.
- **number** reads and writes in the browser's locale
  (`outline-ui/src/number-format`), grouped at rest and ungrouped while edited.
- **date** is a local calendar day (`@kb/model` `local-date`), labelled near
  today (Today, Fri, Oct 12), edited in `DateEditor`: typed phrases
  (`parseDateInput`: tomorrow, next fri, in 2 weeks, oct 3) with a live
  preview, over a keyboard-first calendar.
- **checkbox** is a checkbox, not a switch.
- **secret** is the reference to where a key lives (`env:NAME`,
  `keychain:<service>[/<account>]`), shown as a code chip under a key
  glyph. What the slot refuses is a key itself: `parseTypedValue` reads only
  a reference, as the write check does (DESIGN.md → A written value
  conforms). Refused input is never shown back, unlike every other type's:
  it rests as a mask with the reason, and the next edit starts from the
  stored reference, so a pasted key never stays on screen.
- **ref** is its target's row; the label follows, the rest of the row edits.
- **option** — a ref field that declares its values by parenting them
  (`declaresOptionSet`) — is a chip drawn in the tag chip's box, in the
  option's colour (`optionColorOf`); a field's chips wrap on one line.

**Option previews.** An option of a declared kind (DESIGN.md → Extension
families → Declared options) may be drawn with a live sample of what it
names: `OptionPreviewPoint` (`ui.option-previews`, `@kb/ui-sdk`) holds one
preview per kind (`{kind, sizes, Preview}`), and the field editor, for a
field it draws, asks the point by the field and a size
(`useOptionPreview(field, size)`), hands `Preview` the option's declared id
and the size, and draws what it returns. Every preview draws `chip`, the
small sample before the option's chip at rest and before its row in the
picker (`PickerList`'s `leadOf`, the one lead slot a row has, a glyph's
included). A kind whose options are best chosen by sight also draws
`card`, a sample large enough to choose by. The editor names no kind:
core's design-system plugin previews a design system with its swatch and,
at card size, a small page its sheet paints with what the theme brings
under it (its extension, the backdrop it pairs, its motion preset); and
a backdrop with its theme's swatch at chip size and, at card size, the
backdrop itself (`BackdropCard`): its own renderer in the frame the head
draws (`BackdropFrame`), laid out at a side panel's width and scaled into
the card, at the strength and direction in force, hearing no owner, and
held still (`HoldStill`, Motion options), mounted once the card is on
screen, so a gallery costs what it shows. A graph theme would fill the
same slot. A preview draws nothing for a thing nobody
contributes now.

**Option galleries.** A one-valued option field whose kind previews at
`card` size is laid out as a gallery (`OptionGallery`, outline-ui): every
option at once, each a card of its preview under its label, the chosen one
checked and marked _in use_, in a radiogroup whose arrow keys move the
choice. Choosing a card is what picking that option in the field's picker
is (noted among the field's recent picks, then the one-valued field's
write), so the gallery is the field's picker shown open, not a second
picker. An option nobody contributes now is offered by its label alone,
as the picker offers it; choosing it is a choice that paints the default. The field editor decides it from the kind, wherever the
field is drawn (the Settings page, core's node in the outline), and no
surface asks for it: there is no layout prop to fork on. The gallery
loads the first time a field draws as one, so the page's first load does
not carry it; until then the field shows its picker. A many-valued
field, a field drawn value-only (a table cell) and a kind without a card
keep the chips and the picker.

Input a kind cannot read is never dropped: the slot keeps it, marked with the
reason, and the next edit starts from it.

**The one node picker.** Every "which node?" in the UI is one engine
(`lib/picker.ts`: candidates in, ranked rows out; `usePickerKeys`) and one
list (`components/ui/picker-list.tsx`): the field picker (`FieldPicker`), the
`[[` completion, every node-palette step (`PaletteStepPoint`; the outline's
add-tag, add-field and reference steps among them),
the ontology page's include/extends, the canvas's "add existing node" and the
tag page's add-field. A query matches fuzzily (prefix, substring, id, word
initials, a compact subsequence) and the matched letters are marked; with
nothing typed an option set keeps its own order, other fields offer the
session's recent picks and then the most used. The field picker shows what the
field holds checked; in a many-valued field Enter toggles and it stays open,
Backspace on an empty query takes back the last value, and in a one-valued
field a pick replaces and closes. Its last row creates the query as a node
where the field's declaration says a target goes (`refCreationOf`: an option
under the field, a node with the field's target tag, a top-level node) — never
for a query-constrained field. The list is anchored to its input, flipped and
clamped to the viewport (`useAnchoredPosition`), so a cell or a column never
clips it. The global ⌘K palette is a different gesture — search and open —
and keeps its own index.

**Named gaps.** A ref value's bullet follows on a plain click (a value's
bullet has no children of its own to expand) rather than expanding the
target's children inline under the field. `[[` completion is not offered while
editing a text value (a typed token still mentions). The date editor's Enter
commits without opening a next value, and its Tab does not move on. Pasting
several lines into a many-valued field is not split into values. The node
palette has no "Add value to …" command. `sys.f.color` keeps its always-open
swatch row. The PropValue union still carries the legacy `date` variant so old
stores decode (opening rewrites it). Table and board cells are not in the
arrow path (the outline's rows are).

### Ontology scope (i6)

The reading-mode consumption of the resolver documented in
[DESIGN.md → Ontologies](./DESIGN.md#ontologies--a-lens-over-the-graph).

**Scope lives in the URL**, so it is linkable, survives reload, and the back
button exits it: `/o` (list), `/o/<id>` (members page), `/o/<id>/outline`
(zoomed: `/o/<id>/outline/<zoom>`), `/o/<id>/graph` (`lib/router.ts`,
`ontologyPath()`, `outlinePath()`). Leaving the scope (`leaveScope`) is a
navigation to the outline where the page stood before it entered.

**Scope is a projection, not a sandbox.** The graph store holds `ontologyId`,
`ontologyMembers`, `ontologyWarnings`, `preScopeRootId` and `setOntologyScope`,
and what a scope shows is decided in one place, `scopedWireOf`, which every
wire→outline conversion projects. Crucially `queryDb` stays
built over the **full** snapshot — backlinks, `#query` nodes and WS
subscriptions keep honest reach while the outline, search, keyboard navigation
and breadcrumbs see members only. Membership is memoized in a `WeakMap` keyed
on the wire-snapshot array (inner key `rev` + ontology id), which is exact
under optimistic local edits where `rev` does not move.

**Scope filters content, never meaning.** A member's field and tag
definitions — field name, type, cardinality, hidden flag, option set, tag
name and template, the label of a ref value — are schema, and schema is
resolved against the whole graph whatever the scope. It is a type of its own:
`lib/schema.ts`'s `SchemaIndex`, which only `schemaOf` produces, and every
function that reads a definition takes one, so handing a schema reader the
projection (`NodeMap`) does not compile. A ref field's declared option set is
schema too, and its picker offers it whole; a ref field that declares no
targets is an open search, which is navigation, so it searches the outline as
shown. The ref editor decides both itself, from its field id and one
`FieldContext` (`fieldContextOf`: the schema, the outline and the index), in
`refSearchOf` (`lib/refs.ts`), so no surface computes an allowed set or can
forget to. The projection itself stays
members only, and resolves its rows' tag chips against the full snapshot.

**Scope never dead-ends.** Navigating to a non-member leaves the scope with a
toast rather than silently doing nothing, and the scope chip
(`⬡ Name · N members · Members/Outline/Graph · Exit`) always offers the exit.
Members whose real parent is a non-member hang off the ontology node itself, so
displayed depth inside a scope is _synthetic_ — structural editing
(Tab/Shift-Tab/move) still operates on the real graph. That mismatch is a named
follow-up, not a fixed contract.

**Graph under scope** is one additive `restrictTo?: Set<string>` on
`ExtractLensOptions`, intersected in `resolveNodeSet`; internal-edges-only falls
out of the existing endpoint check. Ontology and perspective are orthogonal —
the ontology picks _which nodes_, the perspective picks renderer/color-by/
cluster-by — and both pickers sit in the graph header.

Elsewhere: an **Ontologies** sidebar section, the `⬡` bullet kind, three
`sys.command` palette entries (new / enter / exit). The ⌘K palette stays
**global** on purpose — it is the escape hatch out of a scope.

### Graph (i2)

The graph is the CodeFlow-parity surface: every renderer is
`datalog query → {nodes, edges} → renderer`, and interaction happens _in place_
rather than by navigation.

- **Select-in-place.** A single click selects: the neighbourhood stays lit,
  non-neighbours dim to ~15% alpha, and an info card (label, tags, degree,
  Open/Focus) appears. Background click and `Escape` clear. Double-click,
  `Enter`, ⌘/Ctrl-click and the card's Open button all navigate to the outline.
  Hover does the same lighting through `nodeReducer`/`edgeReducer` only — hover
  and selection never mutate graph data.
- **Animated camera.** `graph-camera.ts` owns `fitView`, `zoomIn`, `zoomOut`,
  `resetCamera`, `focusNode` — `--motion-duration-follow` on the one ease
  (`lib/timing.ts`). Toolbar buttons plus
  `+`/`=`, `−`, `0`, `f`, `/`. Camera state survives data updates and theme
  switches, and a module-level positions cache keyed by layout restores a
  perspective's layout when you return to it.
- **Worker layout.** `fa2-layout.ts` runs ForceAtlas2 in a web worker with a
  2.5s auto-settle (`SETTLE_TIMEOUT_MS`), falling back to a synchronous
  rAF-chunked loop by feature detection.
- **Dragging a node runs the layout live**, in 2D and 3D alike: one gesture,
  `NodeDrag` in `graph-ui/src/graph-drag.ts`, over a `DragLayout` port every layout
  implements. A press on a node suspends what else the pointer drives (the
  2D pan, the 3D orbit); past the pointer slop it is a drag, and a press
  that never passed it is a click (select, open) as before. While a node is
  held, a force layout pins it under the pointer and keeps running — 2D
  holds it as ForceAtlas2's `fixed`, 3D at d3's drag heat (alpha target
  0.3) — so its neighbours follow; the drop frees it, and the layout cools
  and stops (2D after an 800ms burst, 3D as alpha falls back to rest), so
  nothing draws after the settle. A placed layout (radial, hierarchical,
  grid, the cluster placement) only moves the held node. The dropped node is
  **not left pinned**: a graph view is a projection of the graph, and a pin
  would be view state with no node to live on and no gesture to undo it, and
  would bend the layout for good; the layout stays the truth, and a drag is
  a way to pull on it and watch what comes along. Where the pointer puts the
  node is the renderer's (`DragSurface`): sigma's camera inverted, its frame
  held at its extent during the drag so a node dragged outward does not
  rescale the view under the pointer; in 3D the camera holds still
  (`GraphCamera.hold`) and the node follows the pointer's ray on the plane
  through where it was grabbed, facing the eye (`force3d-drag.ts`). A 3D
  press is taken ahead of the orbit (a capture listener), the pressed node
  stays hovered so its neighbourhood stays lit, and the ambient turn waits
  while the pointer is on a node. `drag-layout.contract.test.ts` proves the
  port over every layout (2D force, placed, 3D force on the page and through
  its worker protocol), and the render suite drags through both force
  renderers' workers in a browser.
- **Tracing.** With a node selected, the card's "Trace to…" and then a
  second node, or a ⇧-click on it, trace from the selection: the page runs
  `@kb/graph`'s `traceOf` over the nodes drawn and the lens's edge kinds
  (DESIGN.md → [Trace and suggest](DESIGN.md#trace-and-suggest)), and the
  paths light in place through the shared emphasis alpha (`traceIds`, beside
  search, legend and neighbourhood) while everything else dims. The trace
  card takes the selection card's place and lists each path's hops as
  sentences, the reason when there is no path, and "Save as perspective",
  which writes a graph view node whose lens names the trace. The trace is
  ephemeral, like search, and belongs to the perspective it was begun in;
  `Escape` and the card's ✕ end it. Trace mode is a renderer capability
  (`capabilities.trace`), which the 2D renderers declare; a saved trace
  draws in every renderer, because its node set is extraction's.
- **Link labels.** `lens.edge-labels` is a perspective setting, the toggle
  "Label links", enabled where the renderer declares it (2D). On, each link
  carries its relation's label as sigma's edge label: a typed relation by
  its field node's text, a mention or containment by its verb, read by the
  labels a trace's hops are worded with (`relationOfEdge`); a receding
  link's label recedes with it. 3D draws none yet (a recorded gap, beside
  its link weight).
- **Related, not connected.** With the graph family's setting
  `graph.suggest-relations` on, the selection card lists the drawn nodes
  `suggestOf` finds for the selection, each with its evidence and a
  "Link as…" picker of the ref fields that allow it (`relationFieldsFor`);
  picking one types the relation through `graph.relation.type` as the
  person's own gesture, so it never asks.
- **Search and filter compose.** The toolbar search (`/` focuses) does
  case-insensitive substring matching on labels, `Enter` cycles matches with an
  animated camera move; the collapsible tag legend isolates a colour bucket on
  click. The two intersect — a node must pass both to stay lit. Both are
  **ephemeral**: filters, search and selection never persist, while a renderer
  switch is a persisted prop write (`mutations.setLensRenderer`).
- **Directed, weighted edges.** A 2D edge is an arrow, straight or curved
  as the perspective's link style says (below); a curved pair of opposite
  links bows apart instead of overlapping. The edge projection (`@kb/graph`'s
  `collectEdges`) deduplicates
  parallel edges into a `weight` count, and stroke width scales as
  `√weight` (`linkWidth`, in the layout's units like the discs below) —
  repeated relationships read as thicker, single links are a hairline. (3D draws one-pixel links, so weight is not yet drawn there: a
  recorded gap.)
- **A 2D node is a disc in the layout's space.** Its radius is in the
  layout's own units, not in screen pixels (sigma's `itemSizesReference:
"positions"`), so a disc and the spacing around it scale together with
  the viewport and the zoom: a small window or a zoom out never makes the
  nodes grow over each other. `graph-discs.ts` owns the relation, once:
  the lens size maps to a radius bounded against the layout's spacing
  (`discRadius`); the discs are separated (`separateDiscs`) after every
  write that changes the graph's shape or any disc's radius, by one rule,
  `DiscSettle` — by the force layout when it settles if it is still
  moving, at once otherwise, so a new size encoding on a still layout
  settles too; a placed layout (radial, hierarchical, grid) sets
  neighbours at least their radii apart (`discSpacing`, so a ring, column
  or cell grows to hold them); and the cluster placement packs each group
  as a sunflower stepped by its members' radii, so a hub's leaves ring it
  clear before any separation runs, and sets the groups on a ring just
  wide enough that every two of them stand their widths apart (two groups
  are one chord across it). `separateDiscs` is a bounded pass of
  noverlap, not a solver that always converges: from a badly overlapping
  start it can stop short, which is why every layout places its discs
  clear first and leaves it only the remainder. `graph-discs.test.ts` proves it after
  settle on the fixture graph and on a dense graph of hubs and leaves, in
  every 2D layout, for two and three unequal cluster groups before and
  after separation, and after a size change on a still one: no two discs
  overlap beyond a hair, and the
  largest radius stays under its stated bound.
- **Honest empty and large states.** Zero matches renders guidance rather than
  a blank canvas; invalid EDN surfaces an amber warning chip (`queryError` on
  the lens); a capped lens reports "top N of M nodes by degree" in the header's
  node count, beside an "edit max-nodes" jump to the perspective node, so the
  report stays in flow and never covers canvas chrome. Above
  `LARGE_GRAPH_THRESHOLD` = 1500 nodes the renderer degrades deliberately:
  `hideEdgesOnMove`, label threshold 12 (from 7), label density 0.5 (from 0.8).
- Cluster renderer: padded hulls with member-count labels, top-15 cluster cap,
  drag with live hull redraw, hull-click isolation. Tree renderer: pointer
  pan/zoom plus Fit / Collapse-all / Expand-all. A small forest (60 nodes
  or fewer) opens whole, a larger one two levels deep (deeper branches
  start folded); the fold belongs to the view (perspective, query, focus, sys
  switch, ontology), so a new view folds afresh while a store update keeps
  the user's fold and folds only the nodes it adds, each root's subtree runs left to
  right, and a forest of many roots is packed into columns in root order,
  as many as bring the packed shape nearest the frame's (`tree-layout.ts`),
  so a hundred roots fill the frame instead of one sliver.

#### Look and motion

The graph views apply the [Lab principles](#lab-principles); this says only
where each one lives. Everything below reads the tokens through
`useAppearance()`, so every contributed design system in both variants
looks like itself (P5).

- **One renderer contract.** Every renderer view the graph plugin provides
  promises the same things, and `renderer-contract.test.tsx` proves them over
  each one, drawn through a slot inside a graph frame as the page draws it:
  another renderer taking the frame leaves nothing of
  it behind; a renderer that copies token values out (a canvas, a GPU
  palette) reads them again when the appearance changes, while a DOM
  renderer paints live `var()`s and copies none; with a node selected, a
  hover never moves the focus — the one rule, `graphFocus` in
  `graph-ui/src/graph-interaction.ts`, which every renderer asks. The suite's table
  must list exactly the provided renderer views, so a new renderer joins it; the 2D
  renderers need WebGL, and their rows wait on a named gap.
- **Emphasis eases, in every renderer.** What should be lit is one
  definition (`graph-interaction`, `graph-dim`); how it gets there is one
  mechanism, `graph-ui/src/graph-fade.ts` (`EmphasisFade`): a hover's neighbourhood
  fades in over `--motion-duration-quick` and back out the same way, and
  a node in focus swells a little. 2D does it through `sigma-emphasis.ts`,
  which owns sigma's reducers; 3D through `force3d-emphasis.ts`. Sigma blends
  `ONE, ONE_MINUS_SRC_ALPHA`, so its colours are premultiplied
  (`premultipliedGraphColor`) — a straight-alpha colour drew faint links and
  dimmed nodes at full brightness.
- **A link at rest is one token**, `--graph-edge` (colour and alpha
  together, set per design system and variant), read by the 2D edges, the
  tree's links and the 3D links alike.
- **2D (force, cluster).** Arrow edges in the link style's shape; every node ringed in the
  ground colour (`@sigma/node-border`), in the ink when in focus (the
  bullet theme draws bullets instead, below); labels in the theme's label
  style over a halo of the ground (the default's is soft), their colours
  read once per appearance. A
  label sits right of its node, else left, else centred above or below it,
  and never over another label or a drawn node at least as well connected
  (a hub ringed by its leaves is named over a leaf), so crowded clusters
  thin their own labels; label density
  also falls with the square root of the node count past 400. Labels are
  placed in one priority, stated once in `graph-ui/src/graph-label-layout.ts`
  (`byLabelPriority`) and used by 2D, cluster and 3D alike: the node in
  focus, then the best-connected, then by id — so a hub is labelled before
  the leaves around it, whatever order the renderer asks in. A cluster's
  title takes its place in the same layout before any node label, so titles
  never pile on each other or on labels, and labels come in only once the
  nodes they name have arrived — one threshold, `labelArrived` in
  `graph-ui/src/graph-arrival.ts`, for 2D and 3D alike. A new
  graph arrives from its hubs, in 2D and 3D alike (`graph-ui/src/graph-arrival.ts`):
  the best-connected nodes first, their neighbours one `--motion-stagger`
  per hop outward, each growing in over `--motion-duration-reveal`, so the
  whole graph has settled in 300–400ms while the layout settles (P2, M3). Cluster hulls
  are soft regions — a faint fill and a glow for an edge, in the cluster's
  colour — and the hull under the pointer comes forward.
- **Tree and treemap.** A layout change (collapse, expand, resize, a new
  encoding) glides on `--motion-duration-follow`; hover and emphasis fade on
  the quick duration; an arriving element fades in. One class,
  `.kb-graph-move` in `motion.css`, and a tree link's path (`d`) moves with
  its nodes. A tree hover lights its neighbourhood like a selection does.
- **3D** is drawn on the scene kit (`@kb/scene`, see [The lab](#the-lab)):
  the same WebGPU + TSL stage, post chain, palette uniforms, frame loop and
  reveal as the studies (T1, P4) — `force3d-scene.ts` owns no renderer.
  Nodes are one instanced draw with the rig baked into the material; only
  the focused, hovered, searched-for and best-connected nodes glow past 1,
  so only they bloom (L2). Degree sets a quiet hierarchy: the top 3% of
  nodes by degree glow and stand a little larger, the next 10% are only a
  little brighter, the rest stay matte. Which light may cross 1 is
  enforced in the shader, not assumed of the palette: a node can carry any
  stored colour (a tag colour, a `sys.f.color` taken verbatim, any swatch
  hex), so its rest is capped at white, and the rising tier's and a focus's
  neighbours' light is a _lift_ the shader caps at each fragment's own
  headroom under white; only a _glow_ (focus, hover, a search match, a hub)
  may pass it. the light is written once (`shadeNode` in
  `force3d-light.ts`) over the scene kit's shading arithmetic, run as TSL
  nodes by the material and as numbers by `force3d-light.test.ts`, which checks
  it over the unit cube's corners, every pure channel and a seeded spread of
  colours, under every design system's ink in both variants. The scene's dress is its theme's (below); in the default theme, range fog follows the camera's distance, a
  restrained starfield stands at infinity, the backdrop is the page's own
  surface — the card at the focal point, falling to the background on a dark
  ground and to the muted surface on a light one, under a fine grain, so a
  light stage has a ground (P5) — and dither breaks banding (L3, L4); there is no tone mapping, so
  the tokens are reproduced exactly and the canvas meets the page. Links
  brighten from source to target, and particles run along the focused
  node's links only (M4). Select flies the camera to the node on critically
  damped springs (`force3d-flight.ts`, M1, M5), backing off until the
  node's whole 1-hop neighbourhood fits with margin; fit, zoom and search jumps
  fly the same way, and the camera follows the layout until the user takes
  it. The layout is d3-force-3d in a worker (`force3d-layout.ts`), with a
  faint pull to the centre so orphans do not shrink the frame. Frames are
  drawn only while something moves, the device pixel ratio is clamped to 2,
  a hidden tab draws nothing, and a renderer switch or unmount disposes the
  scene, its worker and its listeners (`force3d-graph.lifecycle.test.tsx`).
- **Graph themes** are data, and a declared kind (DESIGN.md → Extension
  families → Declared options): the graph family owns `lens.theme`'s kind
  (`GRAPH_THEME_OPTIONS`, `@kb/graph` `themes.ts`), a family lists its
  themes' keys on its declaration, and the seed fold derives each one's
  option node under the field (`sys.graph.theme.<id>`; the graph's own
  have no family part). A perspective's `lens.theme` is a ref to one,
  picked in the settings panel from the contributed themes. Each theme is
  contributed to the graph's theme point (`GraphThemePoint`, `graph.themes`,
  in `@kb/graph-ui`) under its key; the graph family's own six come from
  `graphThemesPlugin`, which its page entry loads. The lens reads any
  declared id; the page draws the contributed theme it names
  (`shownGraphTheme`, by `chosenDeclared`), and one nobody contributes now
  draws the default, matte. Each renderer is handed the theme itself,
  resolved once where the lens reaches it. `graph-theme-point.contract.test.ts`
  holds every contributed theme, a test plugin's included, to being
  declared, seeded, labelled and chosen, and the fallback to the default.
  A theme is a whole scene, not a material: `graph-themes.ts` states each
  of the family's own once, as one record in two parts. The parts any renderer draws — what a node is drawn as (its
  `form`), how links take their colour and gradient, and the label's
  face, weight, case, halo and placement — are the theme's, and each
  renderer realises them in its own terms; the label is painted by one
  canvas painter wherever it is drawn (`graph-ui/src/graph-label-paint.ts`), and a
  bullet from one GPU form (`graph-ui/src/bullet-gpu.ts`). The 3D scene's dress —
  which tokens fill the ground and its edge, the backdrop's pool, warmth
  and haze, the fog, the starfield, the grain, the bloom (and so whether
  any light may cross white at all) and the node surface — is its
  `scene`, which only the 3D graph has. The 2D graphs (force and
  cluster) wear the theme too, through the same record: a solid form is
  drawn as the node's disc and the bullet form as the outline's bullet
  (below); labels are set in the theme's face, weight and case under its
  halo, still placed by the 2D label layout (beside first), so `placement`
  is the 3D label's anchor; links take the tone's strength and accent lean
  (`restingLink`, the one reading both renderers draw links from) but not
  its gradient, since a sigma link is one colour. What the themes are, and
  why, is below. Switching one redraws what it shapes
  in place: the palette eases across like a theme change, the stage's
  knobs move, the nodes and labels are redrawn; nothing moves, lays out or
  arrives again, and the link layer's motion is carried on.
  Every theme's node light runs through the one `shadeNode`: its surface,
  then the shared rest cap, lift cap and glow. A theme without bloom turns
  its glow into lift, so no fragment of it passes white, and its stage's
  bloom is zero. `force3d-light.test.ts` proves the bloom rule over every
  theme, every storable colour and every design system in both variants,
  on the ground that theme stands on: at rest and under any lift nothing
  passes white, a blooming theme's hubs do, and a theme without bloom
  never does. A surface must grow with the key and depend on the view only
  through the rim — what lets that proof find each sphere's brightest
  fragment ring by ring. Each form states where its fragments stand in
  (key, rim) — a sphere's rings, a cube's whole square (a face may meet
  the key squarely while its edge line is drawn), a bullet's one flat
  fragment — so the proof runs over what that theme's nodes can show. The scene contract and the renderer contract run
  the 3D graph in every contributed theme.
- **The themes.** Each reads only the design system's tokens (L1), so it
  looks like itself in kb, paper and terminal, light and dark (P5):
  - _Matte_ (the default) — the studio: the card's colour pooled at the
    focal point over the page, fine stars, range fog, a soft key and an
    ink rim, links brightening source to target, labels in the graph face
    on a soft halo of the ground. The quiet look the others are measured
    against.
  - _Cel_ — ink on paper: a flat ground with no pool, stars or fog, the key
    in three hard bands under a heavy ink outline, links drawn as even ink
    strokes, bold labels on a ruled plate of the ground. No bloom: a graphic
    print does not glow; focus reads through the outline and the swell.
  - _Fresnel_ — the night instrument: a pool falling away to the frame
    under a still haze, more and brighter stars, a quiet body under a
    bright grazing rim, links leaning toward the accent, labels in the
    monospace face, upper case and tracked, and the strongest bloom.
  - _Glass_ — the aquarium: a faint warm pool of the accent and a soft
    haze, fog that starts close so depth reads, no stars; the ground seen
    through a tinted bead with a tight glint and a thin ink edge, faint
    links, and light labels on a frosted chip.
  - _Bullet_ — the outline, in space. Every node is drawn as the outline
    draws its bullet, from the same definition: `lib/bullet-mode.ts` owns a
    bullet's appearance (kind, shape, glyph, halo, dot, ring, their paints
    and their geometry — box, dot, halo and ring sizes, the ring's stroke
    and dashes, the magnifier's lens and handle), and the outline's
    `Bullet` and the graph's GPU form of it (`graph-ui/src/bullet-gpu.ts`) both
    read that record, so a change to the bullet changes both. A graph
    node's appearance is `outlineBulletAppearance` of the same outline node
    the editor renders — its kind, its children, its collapsed state, its
    tag colours through `tagPalette`. A bullet is drawn analytically: the
    shape is a handful of uniforms (`BULLET_UNIFORMS`: the ring, the
    magnifier, the glyph box, in px of the box), each node carries its
    mark, its halo and dot radii and where its colours sit in a small
    colour table (`BulletTable`: one row per distinct bullet — the page's
    ground and ink, the ring, then every tag's wedge of the halo and dot),
    and each fragment measures its signed distance to the marks and
    antialiases it over one screen pixel, laying the halo, ring, dot and
    ink over the ground in the outline's order. So a bullet is as sharp
    zoomed in as the outline's is, and nothing is painted per frame: the
    table is painted again only when some bullet or the page changes. The
    kind glyphs (# ⌗ ⚙ ▣ ◇ ⬡) are type, not geometry: they are set once in
    the UI face and read back as a signed distance field
    (`BulletGlyphs`, one cell per glyph, shared by every renderer for the
    session), which the same antialiasing draws, set again only when the
    face or its size changes or it finishes loading. A multi-channel field
    would keep a glyph's corners sharper under extreme zoom, but needs the
    glyph's outline, which a canvas does not give; a raster re-set to the
    zoom would be per-frame work. Each 3D node is one camera-facing
    sprite, one draw; the scene stays orbitable 3D. The ground is
    the page's plain background, the light is flat (the surface is the
    laid colour), there is no bloom, fog, stars or grain, links are even
    lines of `--graph-edge`, and labels sit right of their bullet in the UI
    face, as a row's text does. A bullet carries no lift or glow, so at rest
    each one looks as the outline's does whatever its degree; focus swells
    it, and a dimmed node sinks into the ground. Its halo spans twice the
    sphere the node would be in another theme, so its small dot reads, and
    it is picked, framed and labelled by as far as it shows
    (`bulletExtent`: its halo when it has one, else its dot or glyph). In
    2D the same GPU form is drawn by a sigma node program
    (`sigma-bullets.ts`, one instanced quad per node), and a bullet
    stands exactly as far as its disc — its halo, else its dot or glyph —
    so the disc rules above (separation, picking, label clearance) hold
    unchanged and a plain leaf is the disc it always was; a dimmed bullet
    fades as a disc does.
  - _Cube_ — the model on the bench. Every node is a cube of its colour
    (`SOLIDS` in `force3d-nodes.ts`: the solid layer is one instanced
    draw whatever the solid, and a theme's `form` picks it), holding the
    volume of the sphere it replaces, so it is picked, framed and
    labelled by the same radius and sizes compare across themes. Every
    cube is set once in the isometric attitude, a corner toward the
    default eye, so three faces show and each takes the key differently;
    it does not turn, because a moving cube would keep the stage drawing
    and one shared attitude lets light, not angle, carry the hierarchy.
    Its rim is a face's grazing rim or a thin line along each edge, so the
    matte surface draws the silhouette and every edge in the ink. The
    card's pool under a faint warm haze, range fog, a few stars on dark,
    a restrained bloom, even links, labels in a firmer weight of the
    graph face. In 2D a cube is the node's disc.
- **Link styles** are one choice for both renderers: a perspective's
  `lens.link-style` is one of its option nodes — _straight_ (the default),
  _curved_, _flow_ — and `graph-link-styles.ts` states what each one means
  as two parts, its shape (straight or curved) and its motion (still, or
  dashes drifting source to target, one passing in the ambient period,
  still under reduced motion). Flow is drawn on curves. The renderers that
  draw the graph's links (2D, cluster and 3D; the tree draws its own
  elbows) read the shape; only the 3D graph can move a dash, so the 2D
  graphs draw flow as its shape, still, and the settings panel says so.
  Switching one redraws only the links (and the particles, which follow the
  curve), in place and carrying their motion.
- **Reduced motion (M7)** everywhere: fades and flights cut, the 3D layout
  settles unseen and posts once (and so does each move of a node drag, the
  layout at rest around where the node now stands), particles and the ambient turn stop, and
  the DOM renderers' transitions are flattened by the global rule.

Not shipped, named: the settings popover (the FA2 live-layout API is wired but
has no UI), a committed perf fixture, picker keyboard nav, weight-scaled 3D
links.

### Canvas (i3)

The canvas is a thinking surface (draw.io lineage), and this wave made direct
manipulation feel professional rather than merely functional.

- **Selection is a set.** `canvas-ui/src/canvas-selection.ts` owns one
  `CanvasSelection { nodeIds, edgeIds }` with single / Shift-toggle /
  rubber-band marquee / `Cmd+A`. Dragging any card in a multi-selection
  translates all of them. Delete/Backspace removes every selected node and edge
  with cascade edge removal — and deleting a kb-node _card_ never touches the
  underlying graph node.
- **The clipboard.** ⌘C writes the selection, with its members and the
  edges among them, as a canvas document. A paste is the browser's paste
  event — ⌘V is left to the browser, as every ⌘ chord without a canvas
  command is (a tool is a plain key) — so it carries what the clipboard
  holds with no permission asked: image files become pictures at the
  pointer, and otherwise its text becomes what it reads as
  (`canvas-paste.ts`): a canvas document with items in it becomes them, 24
  units from where they were, selected; SVG markup becomes a picture, an
  `.svg` file on the pictures' path, which `asset.upload` keeps sanitised
  and the canvas shows as an image, never as markup in the page; and any
  other words become a text card centred at the pointer, selected. A field
  keeps its own paste, and a modal transform takes none.
  ⌘X is ⌘C and then, once the clipboard holds the copy, the Delete of what
  was cut, written as the delete's one undo step; a copy the browser
  refuses deletes nothing.
- **Pictures** (plan 2026-10-02, step 7). An image is a `file` item showing
  an asset (DESIGN.md → Canvas documents): the image preset over the one
  item record, so it moves, turns, lifts, extrudes and belongs to frames as
  every item does. It comes in three ways, each stored through the host's
  one upload (`uploadAsset`, which is `asset.upload`, as a note's media is)
  and placed in one write, selected (`canvas-media.ts`): pasted, at the
  pointer; dropped on either projection, on the floor where it was let go
  as the showing camera sees it; or chosen with the image tool, whose file
  chooser places at the header's placement point (a tool placed with
  something chosen first, as the card is with its node: `pickTool`). It
  lands centred, at its own aspect, its longer side at most 320, never
  larger than itself. The 2D face is an `<img>` from the asset route
  (`assetSrcUrl`), covering its box; the 3D face paints the same picture
  into its texture (`canvas-face-pictures.ts`: one load per source, its
  faces repainted when it settles, a source no face shows let go). A missing
  asset says so in both; assets are backup-owned and never committed.
- **Undo/redo.** `canvas-ui/src/canvas-history.ts` is an immutable ring buffer
  (`UNDO_DEPTH`, the one depth every undo ring shares, 200 steps) with reference-equality skip; `Cmd+Z` /
  `Cmd+Shift+Z` / `Cmd+Y`. An edit the store brings from elsewhere —
  another tab's, or an agent's canvas verb, each one canvas write — is one
  step too, which ⌘Z takes back as it takes back the person's own
  (`adoptStored`). How the canvas is looked at is its view node's camera,
  not the document's (DESIGN.md → Canvas documents → Camera), so no step
  ever holds it.
- **Direct-manipulation invariants.** A pointer slop by the kind of pointer
  that pressed (`POINTER_SLOPS` in `lib/pointer-slop.ts`: 4px for a mouse or
  a pen, 8px for a finger, Android's touch slop; the one table the scene
  kit's taps and a graph node's drag read too, each by its press's
  `pointerType`) kills hair-trigger moves and keeps a finger's tap a tap, pointer capture on card drags and resize handles survives a fast drag,
  four corner resize handles clamp at 80×40 (`Shift` locks aspect ratio) and
  resize a turned card along its own sides, tldraw's rotate handle on a
  stem above a selected card turns the selection about its centre
  (`turn/start`, a transform drag in the pointer reducer), and
  arrow keys nudge 1px / 10px with `Shift`.
- **Snap guides and fit.** Alignment snapping is magnetic within 5px
  (`SNAP_TOL`, `@kb/canvas` `snap.ts`, which an agent's placements snap by too), one rule on all three axes: a move
  across the floor snaps on x and y and draws dashed guide lines, and an
  Alt-lift in 3D snaps to the bases and tops of other items (no line is
  drawn up the z axis). The same module owns **surface snap**: an item
  carried across the floor stands on the top of the highest solid its
  centre comes over (its footprint, not its box), and one taken off a pile
  comes down to the floor; an item raised off every solid keeps its
  height. It owns **angle snap** too: a turn, from any handle, goes in 15°
  steps about its own axis (`snapTurn`). And it owns the **grid**
  (`GRID_STEP`, 20 units: the dot grid both projections draw). A transform
  is snapped one of two ways by what made it: a carry across the floor
  plan (a drag, an unconstrained grab) aligns and stands on surfaces
  (`snapCarry`); every other one — a constrained or Alt grab, a rotate, a
  scale, an extrude, any gizmo handle — snaps precisely (`snapPrecise`): its
  move aligns on each canvas axis it runs along within the tolerance and
  otherwise steps by the grid from where it began (Blender's increment
  snap), along a local axis too; its stretch lands the selection's extent
  on grid multiples (alike every way for a uniform scale; a size under one
  step is left as it is, so a small item still scales); its extrude lands
  the lead item's depth on one. Steps round halves away from zero, either
  way. Holding ⌘ or Ctrl suspends every
  snap, and a typed value is never snapped.
  `Shift+1` zoom-to-fit frames the
  bounding box with 40px padding. Zoom range is 0.1–3.0 (`MIN_ZOOM`/`MAX_ZOOM`).
  A pinch, or the wheel with ⌘ or Ctrl, zooms about the cursor in either
  projection by as much as the event says (`wheelZoomFactor`: a percent a
  pixel, at most a tenth an event), as tldraw's does, so a trackpad's stream
  of small deltas zooms as gently as the fingers move; each event starts
  from the camera the one before left, not from the last frame drawn.
  Both stages hear the wheel themselves, not passively, so the zoom is the
  canvas's alone and the page around it (bb's) does not zoom too.
- **Touch** (`canvas-touch.ts`, `use-canvas-touch.ts`; the design note
  `docs/research/2026-10-28-canvas-mobile.md`), as tldraw's, Excalidraw's
  and Miro's on a phone. Both projection layers are `touch-action: none`,
  and one recognizer hears every touch over either of them before the
  projection or React does (on the window, in the capture phase), so both
  projections take fingers alike. One finger is a press, exactly as a
  mouse's: the armed tool's, a marquee or a carry with select, an orbit on
  empty canvas in 3D. A second finger makes it a camera gesture: the first
  finger's press is cancelled as the browser cancels a touch it takes for
  itself (a `pointercancel` to its target, which either projection already
  undoes), and until the last finger lifts their midpoint's travel pans
  and their spread zooms about it, through the showing camera's
  `CanvasViewportControls` (`panBy`, `zoomAt`, and `settle` at the lift,
  where 3D saves its pose); one finger left pans. A finger held still
  `LONG_PRESS_MS` (500 ms) is a long press: its press is cancelled and a
  `contextmenu` is sent where it is, so the context menu opens as a right
  click's does, and the browser's own long-press menu is swallowed while a
  finger is down. Chrome over the stage takes its taps as any button does,
  and words being typed (`isTyping`: the focused entry) keep the browser's
  touch. A finger carries an item by its words, and a tap on the one item
  selected opens them (Editing a face, below); a scroller inside a closed
  card is `touch-action: none` too, since a scroller starts its own.
- **The compact stage** (`compactStage`, `canvas-stage-layout.ts`; the
  design note `docs/research/2026-10-28-canvas-mobile.md`): a stage
  narrower than 720px (a phone upright, a side panel) or shorter than 480px
  (a phone on its side) stands its chrome compact, and every piece of
  chrome reads that one answer. The tools stand in one row along the
  bottom, clear of the safe area, the rest behind More; the dock's panels
  stand folded; the view widget folds its axis gizmo away and keeps the
  view's name, which opens the view menu; the selection toolbar, present
  mode's bar and a modal transform's readout stand above the tools
  (`bottomBarClass`), the selection toolbar's commands as marks named for a
  screen reader; and the header holds the board's pages in the node's
  place, the way back as a mark, Add node left to the kb node tool. The
  view menu's **Full screen** (a view command with no key,
  `canvas-fullscreen.ts`) puts the canvas page in full screen and then asks
  for landscape (`screen.orientation.lock`), which only full screen allows
  and only some platforms grant (Android's Chrome; not iOS, not a desktop):
  a refusal leaves the canvas upright, which it works in. Where the browser
  has no full screen (an iPhone's) the row is disabled.
- **The tool strip** is drawn from one table (`STRIP`,
  `canvas-tool-looks.tsx`): every tool that stands alone and every family,
  in order, each marked `more` when a compact stage keeps it behind More.
  On a wide stage it stands down the stage's left edge, inside the stage:
  where the stage is too short for one column of tools it wraps into a
  second rather than running over the page strip above it. On a compact
  stage it is one row of 40px buttons (tldraw's), the first tools of the
  table and More, a sheet (`canvas-tool-sheet.tsx`) with every tool behind
  it, each family's tools by themselves, and the 2D/3D toggle; a family's
  picker opens above the row as a grid of marks.
- **Sticky tools.** `canvas-ui/src/canvas-tool.ts` is a pure reducer: picking a tool is
  one-shot (it returns to `select` after placing), double-clicking the tool icon
  makes it **sticky** for repeated placement, `Escape` always returns to select.
  Tools: select (V), text (T), rect (R), ellipse (O / C), diamond (D),
  draw (P) and highlight (⇧D, tldraw's),
  group (F), kb node (N), solid (B), comment (M); digits `1`–`8` mirror
  the same order, up to the solid. A family of tools (`TOOL_FAMILIES`,
  `canvas-tool.ts`) is tldraw's geo-tool pattern: one button wearing the
  tool of the family last picked, with a picker beside it over every tool
  of it, and picking the family picks that one again. The flat shapes are
  one (`CANVAS_SHAPE_PRESETS`: rectangle, ellipse, diamond, triangle,
  hexagon, star, cloud, the four arrows and the check box), with no key of
  its own (R, O and D pick theirs); the solids are another
  (`CANVAS_SOLID_PRESETS`: box, pillar, sphere, cone, shelf, wall), which
  B picks. The stroke tools (`STROKE_TOOLS`) draw rather than place: a
  press anywhere, on an item or not, begins a stroke in either projection
  (2D on the stage, 3D on the floor under the pointer, where an empty drag
  would orbit), which the shared pointer reducer runs (`stroke/start`),
  writing the item as it goes and placing it in its frame as one history
  step (`freehandItem`); they stay armed for the next stroke, as tldraw's
  do. A placing tool draws too (`draftItem`, the reducer's `draft/start`):
  dragged on empty canvas or a frame's face, its item spans the drag from
  corner to corner, a line or arrow runs from the press to the pointer
  (⇧ squares a box and steps a line by 15°), drawn as it goes and placed
  as one history step; a click places it at its preset size, centred on
  the pointer, as tldraw's do. Click or drag is read where the pointer is
  let go — within the slop of the press it is a click, however it wandered
  — and a drag shorter than `MIN_DRAFT` both ways places the preset as a
  click does, while a box drawn is at least `MIN_DRAFT` each way. The
  arrow tool pressed on an item and let go on another connects them
  (`connectItems`, the one edge record, bound at both ends, its ports the
  sides that face each other); let go on nothing, it draws a free arrow
  from the press; let go back on its own item, or clicked there, it draws
  nothing. A shape is data: its outline is a row of `CANVAS_FOOTPRINTS`,
  and what it wears inside it (a check box's tick) is a mark every painter
  draws from `itemMarks`, so a new shape is a row, not a painter's case.
  One table (`TOOL_LOOKS`, typed over every tool) names and marks them. The
  numpad's digits are views, not tools (Projections → view widget). G is
  not a tool: it grabs. The label tool (a text card facing the camera,
  below) has no key, and neither has the image tool, which opens a file chooser
  (Pictures, above).
- **Modal transforms** (Blender's G, S and E; plan 2026-10-02 decision 9),
  in both projections. With something selected, G grabs, S scales and E
  extrudes the selection, following the pointer with no button held; inside
  one, R rotates, G grabs and S scales, each starting afresh from where the
  pointer is. X, Y or Z holds it to that canvas axis, the same key again to
  the first selected item's own axis, and a third time lets go; ⇧X ⇧Y ⇧Z
  hold it to the plane across that axis. Digits, `.`, `-` (negates) and
  Backspace type an exact value — a distance along the axis (unconstrained,
  along X), degrees, a factor, or a depth. A plain left press or ↵
  confirms, as one history step written through `ext.canvas.tx.apply`;
  Esc, any other press (the right or middle button, or a Ctrl-click,
  macOS's right click, its context menu swallowed) cancels and the preview
  goes, and so does focus leaving the canvas — the window losing it, or
  focus moving anywhere, such as a palette ⌘K opens — since the modal's
  keys could no longer reach it. A press is told to the pointer reducer
  as one event from either projection (`transform/press`), which alone
  decides confirm or cancel. While one runs its own chord map comes first
  and claims every key, so a digit types rather than picks a tool, and
  nothing else (a tool, Delete, undo) happens; a held key acts once
  (Backspace repeats).
  Unconstrained, a grab carries across the floor plan as a drag does, a
  rotate turns about the axis toward the eye (Z from the top, so in 2D it
  is the rotate handle's turn) and a scale stretches every way about the
  pivot (the centre of the selection's box); an extrude always grows along
  the lead item's own Z from its base, which is how a flat item becomes a
  solid. Each is one of the inputs every pointer-made transform is
  (`canvas-transform-input.ts`): a drag is a grab held to the floor plan,
  Alt-drag a grab held to Z, the rotate handle a rotate about Z, so a modal
  transform is the same transform drag the pointer reducer previews and
  writes for them and for the gizmo, and `transformItem` applies it. An
  axis is read along the screen as it shows that axis (and up the screen
  where it points at the eye), a plane through the camera's ray. While one
  runs a guide line in the axis's colour runs through the pivot along each
  axis it is held to (`canvas-transform-guides.tsx`, drawn from the camera
  model over either projection), and a readout where the selection toolbar
  stands says what it does, what it is held to and its value — the depth
  badge an extrude shows in 2D.
- **Groups and frames are one concept** (plan 2026-10-02, decision 12): a
  group is a `group` item drawn as a frame, and its members name it as
  their `parent` (DESIGN.md → Canvas documents). Membership is stored, and
  geometry only proposes it: an item placed — by a tool, a paste, a
  duplicate — or let go after any transform belongs to the frame nested
  deepest of those no smaller than it whose face holds its centre seen
  face-on — carried along the frame's normal onto its plane, so a frame on
  the floor holds what stands over it and one stood up as a wall what is
  laid on its face — or to none (`settleMembership`);
  a placing tool places on a frame it is pressed on (`placeUnder`): on the
  floor under one that lies flat facing up, and on the face of one that
  stands or tips, turned as it is and a hair off it (`placedOnFace`), so
  stickies go on a wall, then move along it with G ⇧Y (the plane across
  its normal) and stay its members.
  ⌘G gathers the selection into a new frame a grid step round it (at the
  lowest base among them, belonging where they all did), ⌘⇧G takes the
  selected groups apart, their members belonging where the group did; the
  selection toolbar has both. A group carries its members (`carriedBy`):
  every transform — a carry, a nudge, the rotate handle, the gizmo, modal
  G/R/S — moves, turns and scales them by the motion it makes about the
  selected items' pivot, through the one transform drag, previewed and
  written as one history step; an extrude grows only the items it names.
  An edit of a group's box in the item inspector (its lift or turn) carries
  them by the motion of its base (`editItem`); a corner resize reshapes the
  frame alone. Delete, copy and duplicate take the members too. At one
  height a group paints and hit-tests under its members, nested to any
  depth (`paintOrder`). Selection is made in a scope: outside a group a
  press on a member reaches the group (its own editor never takes the
  press; its ports still start an edge), a double-click goes one group
  deeper toward the item under it — on a frame's own body, into it — and
  Esc puts an armed tool down, then steps out of the group, selecting it, before it clears anything
  else; a press outside the scope, or on empty canvas, steps out as far as
  it must, and a marquee or ⌘A selects what a press would there. A chip in
  the corner names the group entered. Both projections share all of it.
- **Frames clip what they hold** (tldraw's frame; `@kb/canvas` `clip.ts`).
  An item a frame holds is drawn, and hit, only where every frame above it
  reaches, seen from above: its clip (`itemClips`) is the meeting of its
  frames' top views, a convex region of the floor standing up through every
  height. One model answers for every projection. The 2D stage cuts the
  item and its shadow with a CSS `clip-path` in canvas units; the 3D scene
  puts each item in a `ClippingGroup` whose planes stand along the clip's
  sides; the SVG export wraps it in a `<clipPath>`; the model hit test
  (`hitTest`) counts a hit only where the ray meets the item inside its
  clip. The projection contract holds both projections to that hit test
  over a member that spills past its frame, and the probes read the cut
  each painter made.
- **Frames are viewpoints** (decision 7): the view menu lists the canvas's
  frames (the groups that belong to no other, `viewpointFrames`) and goes
  to each face-on (`faceOnView`: the eye on the side its face points to,
  squared to its own x from the top, framed as ⇧2 frames); the 2D view
  frames a floor frame from the top and enters 3D for one stood up.
  **Present frames** steps through them in document order: → ↓ Space
  PageDown forward, ← ↑ ⇧Space PageUp back, Esc stops (a modal transform's
  keys still come first); a bar where the selection toolbar stands names
  the frame and its place. It stands at a frame, not a place, so frames
  added or taken away elsewhere move no slide, and it ends when its frame
  goes. While presenting, the pointer is a laser (`canvas-laser.ts`): it
  leaves a trail over the stage that fades as it ages and is gone
  `LASER_TRAIL_MS` after the pointer stops, in viewport pixels in either
  projection; it takes no pointer and nothing of it is written.
- **Edges are drawings** (the Logseq-whiteboards decision, unchanged): the
  record a drag makes is `connectItems`'s (`@kb/canvas`), the one an agent's
  `ext.canvas.connect` makes, by the ports the drag chose; a live
  dashed bezier ghost during creation, smart port snapping by nearest Euclidean
  distance (let go with ⌘ held, the end lands exactly where it was dropped on
  the item's outline: `anchorNear`), 18×18px port targets, a 20px transparent
  hit path under the visible stroke, and labels halfway along the route
  (`routeMidpoint`), editable by double-click. Where an end meets its item,
  the route (curve, straight, arc, elbow) and the head each end wears are
  `@kb/canvas` `edges.ts`'s (`edgeRoute`, `edgeHead`); an edge's line and
  heads are drawn as `edgePaint` says (`@kb/canvas` `paint.ts`); the edge
  inspector (The style panel, below) picks them.
- **The context menu** (`canvas-context-menu.tsx`), tldraw's: a
  right-click on the 2D stage selects what it lands on unless it is
  selected already, and nothing on empty canvas (`selectForMenu`), and
  opens there, kept inside the stage, a menu of the keymap's own commands
  with their keys (`CANVAS_MENUS`, `menuRows`, `canvas-keymap.ts`), sent through the
  keymap's applier, so a row and its key cannot mean different things. On
  the selection: edit its words and follow its link, cut, copy, duplicate
  and delete, group, ungroup and lock, front and back, the flips, and
  framing it; on empty canvas: undo and redo, select all, frame all and
  100%. Each command names the menus it stands in and where (`menus` on
  its row of the table), so no menu joins the table by its words. A row
  with nothing to act on is left out (`intentApplies`, `menuCommands`). A
  menu a modal transform's press swallowed opens nothing, and a
  right-click on words being typed keeps the browser's own menu. The header's zoom
  readout is a button that opens the zoom menu, drawn the same way
  (`CommandMenu`, `canvas-menu.tsx`, which keeps a menu opened at a point inside the stage): in, out, 100%, frame all and the
  selection. The view menu shares their surface, rows and keys
  (`use-canvas-menu.ts`).
- **Floating selection toolbar** with Group / Ungroup / Delete /
  Bring-to-front / Send-to-back. Items paint by the height of their top
  (`z + depth`), then in document order, and the two buttons reorder the
  document (`paintOrder`, DESIGN.md → Canvas documents).
- **The dock** (`canvas-dock.tsx`) is the column down the stage's right
  edge, always in the same place, as tldraw's style panel is: the view
  widget heads it, and under it stand the style panel of what is selected
  and the comments list. A panel there is never anchored to what it is
  about, so it never opens over the selection it edits; it is as tall as
  its rows, scrolls inside itself once the column is full (which ends above
  the selection toolbar), and folds to its title. On a compact stage
  (`compactStage`, above) every panel stands folded to its title until
  opened, as tldraw's style panel waits behind a button on
  a small screen. A pick in it keeps the keyboard where it was, so the
  canvas's shortcuts still reach it. What the dock remembers — the fold a
  person chose for a panel, which holds however the stage is sized (one
  no one has folded or opened follows the stage), More open — lasts while
  the canvas is open.
- **The style panel** (`canvas-style-panel.tsx`) follows the selection:
  one item shows the item inspector, one edge the edge inspector, none or
  more nothing; nothing opens or closes it, and it stands aside while a
  canvas is presented. The **item inspector**
  (`item-inspector.tsx`) shows, icon first, the rows that apply to the
  item: its colour among the palette's swatches and its opacity (a slider,
  committed once when let go), and its looks (`item-style-rows.tsx`: fill
  and outline for an item that draws its own ground, size, and the face and
  alignment of words that are its own, each a row of icons whose pick is
  one change through `withStyle`). Its rarer rows stand under More:
  Locked, its link, and in 3D only — what the top view cannot show — Face
  the camera, its height (Lift, `z`, and Depth, with Extrude: a sticky
  becomes a block, a rectangle a box; and Flatten), and its Rotation about
  X and Y; 2D shows the turn about Z alone. Each field commits as one
  change. It is a canvas widget, not kb's node inspector, until items are
  nodes (plan 2026-10-02, step 7b). The **edge inspector**
  (`edge-inspector.tsx`) shows its label and colour, its route and bend,
  its line's dash and size, and the head each end wears, each head drawn at
  its end (`EdgeLookRows`); under More, whether it is a relationship
  between its ends' nodes and through which ref field, and its delete.
- **A press with the armed tool** is one spot in both projections
  (`pressWithTool`, `canvas-tool.ts`): the place under it — on the face of
  a frame it was pressed on, or the floor — and the item it was pressed on,
  when the tool takes that item's press (`toolTakes`). A placing tool takes
  a frame's, and places on it rather than selecting it; the comment tool
  takes any item's. The 2D stage, the 2D press on an item and the 3D tap
  each hand the spot over, so no projection decides what a tool means.
- **Comments** (DESIGN.md → Canvas documents → Comments) are drawn from the
  threads the canvas's world reads (`threadsOn`), with no store of their
  own. The comment tool (M) starts a thread where it is pressed: on the
  item under it (a card's thread is on its node) or at the point on the
  floor, and returns to select; while it is armed, the item it would
  comment on — the one a press there hits (`hitTest` over `paintOrder`) —
  is marked, with what it is in words (`targetLabel`: the
  item's kind and what it says, `itemKind` and `itemWords`). A pin
  (`canvas-comments.tsx`) stands at the top right of each item a thread is
  pinned on as the shown projection draws it, or where its point is drawn
  (`threadPins`, over `anchorRects`, from the item anchors scripts stand
  on), cut off at the stage's edge as the items are; a thread whose pin is
  lost has none. An open thread's pin is filled in the primary and says
  how many comments it holds; a resolved one is faint. The pins lie above
  the scripts' drawing, as the toolbars do. Pointing at a pin or focusing
  it, or pointing at a thread in the list, marks what it is on with the selection's outline,
  and pointing at an item with threads swells its pin. A pin opens the
  thread's panel (`canvas-comment-thread.tsx`): what it is on, its
  comments in order, a reply, and Resolve or Reopen. What is written stays
  in the field until kb holds it: a write kb does not take says why, in
  the panel, and nothing more is sent while one is on its way. It stands beside what
  it is on — right of it, else left, else under or over it, clear of the
  pin and the dock (`placeBeside`) — and goes with it as the camera moves,
  while what it is on stays marked; it dismisses as every popover does.
  The **comments list** (`canvas-comment-list.tsx`) stands in the dock,
  put out by the switch at the dock's head, which counts the open
  threads: every thread on the canvas, open, resolved or all — the same
  filter says which pins are drawn — each with what it is on and how many
  replies; picking one frames what it is on (`anchorFrame`: its items, or
  the floor about its point at the zoom it has) and opens it. Every write
  is the agent's: a comment through `ext.canvas.comment`, resolving through
  `node.update` of `sys.f.comment.state` (`use-canvas-comments.ts`). A
  comment shows what it says and not who said it
  (gap `01M54GBYH3K67TAW016HFCJHBC`, marked at the panel). The projection
  contract holds where each pin stands.
- **Item links**: an item that carries a link (DESIGN.md → Canvas
  documents, `link`) wears a small link mark under its bottom right corner
  as the shown projection draws it, in either projection
  (`canvas-link-marks.tsx`), as tldraw's shape link button does. It says
  where the link leads (`leadsTo`), and a click follows it as ⌘↵ does.
  A locked item that leads somewhere is a control (`controlLead`): a
  plain press on it follows it, in either projection, as tldraw's locked
  controls do with a board script; ⇧, ⌘ or Ctrl selects it as any press
  with a modifier selects (`togglesSelection`), so it can still be
  inspected and unlocked. The scripts hear the press first
  (`canvas.item.click`).

#### Projections

A canvas is drawn through one camera model, `canvas-ui/src/canvas-camera.ts`. The
canvas plane is the floor, with z up, as in Blender. A view is a focus point
in canvas space, a zoom measured on the plane through that focus, a
turntable orbit (`yaw` about z; `pitch` from 0, the top view, to π/2, level
with the floor; no orbit goes under it) and a field of view, where `fov` 0 is
orthographic. The DOM canvas is that camera from the top and orthographic,
which is exactly its CSS `translate(pan) scale(zoom)`; `viewOfPan` and `panOfView`
are the bridge, and zoom-to-fit, client-to-canvas conversion and the edge
drop target (`hitTest`: the nearest item the ray enters, each item a box on
its footprint, turned about its centre by its `rotation` (the ray is read
in the box's own frame, `boxFrame` in `@kb/canvas` `box.ts`), filled
exactly by the volume its shape names — a prism of
the footprint, an ellipsoid or a cone, and a flat item its footprint on its
plane; a rectangle's rounded corners are a look and are picked square;
`paintPlanes`: its base raised a hair per earlier item whose top is at the
same height, so paint order decides from above and nothing ever ties) all
go through
the camera rather than through pan
arithmetic or `elementFromPoint`. A gesture reaches the pointer reducer as a
viewport point, which decides slop and panning, and the reducer reads it
through the showing camera (its context carries the view and the viewport
size), which decides where a moved or resized card goes — so one reading
serves both projections.

Two projections hold that camera (`CANVAS_PROJECTIONS`,
`canvas-ui/src/canvas-projections.ts`): **2D**, from the top and
orthographic, drawn as DOM cards over SVG edges; and **3D**, on its
turntable through a perspective or an orthographic lens, drawn on the scene
kit's stage
(`canvas-scene.ts` and its card and edge layers in `@kb/canvas-ui`, the
canvas's only three modules, loaded in their own chunk behind the lazy
fence). A projection declares only how it holds the camera
(`settle`) and the view it opens at when it takes over (`arrive`: the saved
pose, or the same focus and zoom turned to the oblique preset, in
perspective). The camera of the canvas view node the page shows the canvas
through names the projection it opens in and its last 3D pose (DESIGN.md →
Canvas documents → Camera; `use-canvas-camera.ts`): the toolbar's 2D/3D
toggle writes it and a 3D gesture that comes to rest saves its pose, shown
at once and written once gestures pause, the undo history never holding
it; another view of the same canvas keeps its own, and an agent's write to
the view node switches every page showing the canvas through it.

- **One contract.** `canvas-projection.contract.test.tsx` runs one suite over
  every registered projection: each draws every item once in paint order and
  every edge whose ends exist, marks exactly the shared selection, draws
  every item's face (the plane `faceShare` names, turned with the item)
  where the camera model projects it over its paint plane, draws on top at
  a point what `hitTest` finds there (in the DOM the topmost card whose
  body or face covers it, the face read back through its CSS transform; in
  the scene the first drawn surface a ray meets, asked of the real meshes),
  proves **footprint parity** over a grid across every item's box (what 2D
  draws and hits is each item's top view), and draws a moved and turned
  card where it went — from a desk tilt, an oblique orbit, low across the
  floor from the far side and through the orthographic lens, with raised,
  sunk and same-height overlapping cards, every solid shape, a flat
  ellipse, and turned items: flat and solid, spun about z and tilted. Each
  item's anchor, where a script's drawing stands on it (`itemScreenRects`),
  holds its face as drawn, and a flat item's face fills it. The 3D scene also joins the scene
  contract, whose disposal check covers every geometry and material a scene
  drew with.
- **One camera in motion.** `canvas-ui/src/canvas-camera-rig.ts` holds the view the 3D
  scene draws with: gestures move it at once, flights ease over
  `--motion-duration-arrive` on `--motion-settle`, and under reduced motion
  a flight lands at once. The keymap's zoom and frame reach whichever camera
  is showing through `CanvasViewportControls`. The scene draws the
  orthographic lens, and the orthographic end of a dolly, with an exact
  orthographic projection, so it is the same picture as the DOM canvas.
- **Views, the widget and the view menu.** The camera model names six
  orientations (`CANVAS_VIEW_PRESETS`): top, front, right, back, left (each
  named for where the eye stands; front is the +y side) and the oblique look
  a canvas first opens at. The view commands (`CANVAS_VIEW_COMMANDS`) are
  rows of the canvas's one shortcut table (`CANVAS_SHORTCUTS`,
  `canvas-ui/src/canvas-keymap.ts`), the single statement of its keys: the
  keymap matches chords against it, and the view menu, the toolbar's key
  hints and the shortcut sheet (`?`, `canvas-shortcuts-sheet.tsx`, every
  named row by section) list from it. Its Arrange rows reach `@kb/canvas`'s
  arrangements, as the `arrange` verb does: `]` and `[` to the front and
  back, ⌥ with them one step; ⌥A, ⌥H, ⌥D align left, centres and right,
  ⌥W, ⌥V, ⌥S top, middles and bottom (⌥ letters match by physical key,
  since ⌥ makes another character of them on a Mac); ⌥⇧H and ⌥⇧V spread
  evenly; ⇧H and ⇧V flip. An arrangement that moves nothing writes nothing.
  ⇧L locks the selection, or unlocks it when all of it is locked; the
  inspector's Locked switch is the same field, and while it is on the
  inspector's height and turn rows are read-only. A locked item is pressed and
  inspected, but no drag, handle, key or marquee takes it (`freeItems`).
  H arms the hand, with which any press pans, as Space held does
  (`pressPans`). Both reach the camera through `CanvasViewportControls`:
  numpad 7 / 1 / 3 look from the top, front and right (⌃ for back and left;
  there is no view from under the floor), numpad 5 swaps the lens, ⇧1 frames
  everything, ⇧2 and numpad `.` frame the selection, and `` ` `` opens the
  menu (which also holds the oblique view and 2D/3D). Numpad keys match by
  physical key, so NumLock and the layout do not matter. In 2D, which is the
  top view through the orthographic lens, any other view or lens enters 3D
  there. The widget in the stage's corner is an axis gizmo computed from the
  camera's frame (`screenAxes`), with no second scene: X red, Y green, Z
  blue (`--axis-*`, derived from the document colour presets), each end a
  button that looks from that side; under it the view's name opens the menu.
- **The handover** (`canvas-handover.ts`): into 3D, the rig stands where the
  2D view is, the scene mounts behind the DOM canvas, the two crossfade
  while they are identical (`--motion-duration-reveal`), and then the field of
  view opens at a fixed zoom — a dolly zoom out of orthographic. Back to 2D
  the rig flies to the top view first and the DOM canvas takes its pan and zoom on
  arrival. A scene that cannot start leaves the canvas in 2D for the visit.
- **Every item is a box its shape fills.** The shape table
  (`CANVAS_SHAPES`, `@kb/canvas` `shapes.ts`) gives each shape its footprint
  and its volume, and a footprint is its outline (`CANVAS_FOOTPRINTS`, path
  data): what covers a point, where a ray crosses a prism and where an edge
  meets an item are all read from that outline's polygon
  (`footprintPolygon`), whatever the shape, concave or round. Both
  projections trace the one outline (the DOM as an SVG path and a clip path, the scene into faces and
  meshes), and the corner radius comes from one rule (`cornerRadius`). The
  mesh builders (`canvas-scene-solids.ts`, behind the 3D stage's chunk) are the three
  side, one per volume and typed by it, built at each item's size: a prism
  of the footprint with smooth sides round curves and creases at corners,
  an ellipsoid, a cone, and a flat item's footprint. A solid wears the card
  face on its top and the rig's matcap finish (shaded without lights)
  tinted by its colour on its body; every item draws its edges as a diagram
  does. In 2D a shape's footprint is what the pointer hits (its clip path),
  a solid's top view is marked (a lit dome, a cone's point), and anything
  standing off the floor casts its top view as a soft shadow.
- **A turned item** is turned in both projections by the one rotation
  matrix (`@kb/canvas` `rotation.ts`: degrees about x, then y, then z,
  Blender's XYZ Euler). The scene sets each mesh's turn from it, canvas y
  flipped. The DOM lays a turned item's face on its footprint box under a
  `matrix3d` of that matrix, carried to the plane its face lies on (a
  prism's top, an ellipsoid's equator, a cone's base: `faceShare`); CSS's
  axes are the top view's, and with no perspective on the stage the browser
  flattens the face straight down, so it paints and hit-tests the face's
  exact top view. Under its face a solid draws its body as its top view
  (`topView`: everything it fills seen from above, as pieces whose union
  it is — a turned prism's two caps and every side between them, an
  ellipsoid's or a cone's hull — filled nonzero, its caps stroked), which
  a tilted solid shows round its face and the pointer takes it by. Side anchors and their outward directions turn with the
  item (`sideTerminal`, `@kb/canvas` `edges.ts`), and the marquee and
  framing read its turned box.
- **A line is an item** (`path`, `@kb/canvas` `paths.ts`): the line and
  arrow tools (L, A) place one across a box, which moves, resizes and turns
  as any item's does. Its outline is its line (`itemOutline`, the one
  answer both projections stroke every item's chrome from), drawn as heavy
  as an edge, and its open ends wear the heads an edge wears
  (`pathHeads`, `headOnLine`). Heads are an item's marks (`itemMarks`):
  what it wears beyond its outline, in its outline's ink, filled or
  stroked. The DOM draws them in its outline's SVG, the 3D face paints
  them into its texture, the SVG export writes them after the outline, all
  from `itemMarks`. The look contract reads all three back along the line
  and each mark. A line drawn by hand (`freehand`) is the same outline run smooth
  (`smoothThrough`), so every painter draws it from `itemOutline` with no
  case of its own; a line's ends and corners are round (`ChromePaint.round`,
  read back by the look contract), and a highlighter's stroke (`highlight`)
  is its width, its paint's opacity and its place behind its siblings.
- **Looks are one paint in both projections** (`@kb/canvas` `paint.ts`,
  `itemPaint`): an item's style (DESIGN.md → Canvas documents) is turned
  once into what is drawn — the outline's width (by size) and dash pattern
  in canvas units, the type step and face (as tokens) its words are set in,
  where they sit, its fill and its opacity, and every colour it is drawn
  in as a **tone** (`Tone`): an amount of the ink, the ground, the primary
  or its own paint laid over the ground (or over another tone: words on a
  solid fill), composited in sRGB. Every amount lives once, in
  `paint.ts` — a semi fill's wash, each kind's outline, words and
  placeholder ink (`KIND_INKS`), an edge's ink at rest and while its field
  is gone, the selection's stroke and halo — and the heads a line or an
  edge wears take its line's tone, drawn or not. The DOM says a tone as
  `color-mix(in srgb, …)` of the tokens (`toneCss`, `paint-css.ts`, beside
  it in the family's shared package, so any painter that writes CSS says a
  tone the same way); the 3D face mixes the
  tokens' resolved channels into its texture (`toneColor`). The DOM draws
  every kind's ground and outline as one SVG outline traced from the shape
  table (`canvas-item-outline.tsx`), its words in the step's and the face's
  tokens; the 3D face paints the same into its texture and its materials
  take the opacity. An edge's look is `edgePaint`: its line's width (by
  size, a step heavier selected) and dash pattern, its heads' length, its
  opacity and its ink. The look contract (`canvas-look.contract.test.tsx`)
  reads both projections back — an item's stroke dash, width and colour,
  its ground's colour, opacity, and words' ink, face, step and alignment;
  an edge's points along its route, its line and its colour, its opacity
  and each head's kind, outline and colour — and holds them to `itemPaint`
  and `edgePaint` for every look, every route and head, and each kind's
  defaults, colours compared resolved through one look. It reads the SVG
  export (`canvasSvg`, DESIGN.md → Canvas documents → Export) the same way,
  as a painter with no camera, so the exported file looks as the canvas does.
- **Cards stay cards.** Each card's face is painted into a canvas texture as
  it looks in 2D (`canvas-card-face.ts`): its text in the face and step its
  style names (a card's in the UI face at the body step), its bullet and tag
  chips, its shape, fill, outline and colour, the selection ring. A face is repainted only when what it shows changes; a resized card
  keeps its face stretched until sizes hold still, faces painted before the
  page's fonts arrived are repainted once they do, and texture density
  follows the display's pixel ratio up to a cap. Edges are rebuilt only when
  what they are drawn from changes. Translucent colours are composited over
  the face in sRGB before
  upload, because the GPU blends in linear light and would thin a faint
  hairline and brighten a faint wash. A raised item or a solid casts its
  footprint as a soft shadow on the canvas plane, which carries the 2D dot
  grid, and a selected raised item drops a stem to the floor; edges are
  lines between their ends' anchors, halfway up a solid's side, climbing
  from one height to the other, through the points of the one route the 2D
  path draws (`edgeRoute`, `routePoints`), dashed as its line is, with its
  heads' outlines (`edgeHead`) laid flat at their ends. The ground is the
  page's, edge to edge, so the crossfade is between equal grounds.
  Faces stay canvas textures on three r186: its `HTMLTexture` needs Chrome's
  HTML-in-Canvas origin trial (`copyElementImageToTexture`) and silently
  draws nothing without it, so it would ride on this path as a second one
  rather than replace it.
- **Faces that stand** (plan 2026-10-02, step 7; `faceStands`). Every view
  is a camera, with its own axes (`viewAxes`: the screen's right and down,
  and back toward the eye), and a face that stands turns to them. A flat
  billboard (`billboard`; the label preset is a text card that is one) is
  drawn and picked square to the screen (`facingFrame`, through `itemFrame`,
  which `hitTest`, the screen bounds, framing and both projections read):
  its centre over its footprint's, raised by half its height as far as the
  view is tipped toward level, so its lower edge stays on its plane — from
  the top it is its footprint, unturned, and level with the floor it stands
  up from it, which is what keeps a label legible in the front and side
  views. A solid's face stands when it is a billboard or has no flat top to
  carry it — a sphere, a cone: its top is then plain, and a label of its
  face's words on a pill of card stock (`paintLabel`) stands square to the
  camera in front of the whole body (`frontFrame`: the box's reach toward
  the eye; `canvas-scene-labels.ts`). The label sets its words as its look
  does in 2D — face, step, alignment across and place up and down, in its
  words' ink — and is drawn at its look's opacity; the look contract holds
  it to `itemPaint`. A label is a look, not a surface: the
  solid is picked by its body. Both turn only when the orbit does. In 2D a
  standing face shows as it always did. The inspector's "Face the camera"
  sets `billboard`, and hides the rotation a flat billboard does not draw.
- **Gestures in 3D** are the 2D ones where they mean the same: a press on an
  item selects it (a modifier toggles), a drag carries it on the plane of
  its top and Alt-drag lifts it. Both are one transform drag in the pointer
  reducer, made by a grab (`canvas-transform-input.ts`): held to the floor
  plan, or for Alt held to the Z axis — the axis's travel read along it as
  the screen shows it, and up the screen where Z points at the eye — and
  both are history steps written through `ext.canvas.tx.apply`. A carry
  reads the pointer where it visibly is: on the top of a solid it passes
  over (one it does not carry), so dragging an item onto another stands it
  there through surface snap.
  **The gizmo** (`canvas-scene-gizmo.ts`) stands on the selection in 3D:
  three's `TransformControls`, built with no DOM element, fed the camera
  model's own ray (`screenRay`) by the gestures, which ask it before
  anything behind it. It sits at the selection's pivot (the centre of the
  box bounding it) and shows Move, Rotate or Scale, along the canvas's axes
  or, Local, the first selected item's; the floating selection toolbar
  switches both, and the last mode chosen stays. A drag reads the stand-in
  the controls move back as one `CanvasTransform` (canvas y flipped back,
  `canvas-scene-space.ts`), which the pointer reducer previews and writes
  on release as one history step: the same transform drag the 2D rotate
  handle and a modal transform make, snapped precisely (its move by the
  grid, its turn by 15°, its scale to grid multiples), ⌘ or Ctrl free. The
  controls' own snapping is off. A press during a modal transform ends it
  rather than reaching a handle or an item. Through the orthographic lens they are handed an orthographic
  twin of the stage's camera, so handles keep their size and turns their
  pace.
  A drag on empty canvas orbits the turntable (across turns the floor with
  the hand, down tips toward the top view) unless the armed tool draws
  (`drawsFromPress`: a stroke tool or a placing tool, which then draws on
  the floor as in 2D), a tap places the current tool on the plane
  (or clears the selection), the right or middle button, Space or the hand
  tool pans, the
  wheel pans and a pinch zooms about the cursor (`canvas-scene-gestures.ts`).
  A card let go where its plane is edge-on stays where the drag last had it,
  and a tap that moved no camera saves no pose; a pose equal to the saved one
  is not written again. Edge labels and resize handles are 2D only. Texture
  memory and culling for very large canvases are not built
  (`GAP [[01M3S5DDC3JYX8871YMJ7C6PAN]]`).
- **Editing a face in 3D** (plan 2026-10-02, decision 14). Which item's
  editor is open is one page state (`use-face-editing.ts`), and the
  projection that is showing edits it: the 2D canvas in place, as it always
  did (a shape's label opens on a double-click, a text card's textarea
  while it has focus, a card's node text while the node is active there).
  A closed editor takes no press: a press anywhere on an item selects and
  carries it, by its words as by its edge, so a finger moves a note as a
  mouse does. A click on the one item selected opens its editor, as
  tldraw's second click on a selected shape does (`opens` on the pointer
  reducer's transform, read against the selection before the press), so a
  double-click or a double tap opens it from nothing selected; a press that
  goes past the slop carries instead. Closed, a card's node text still
  follows a reference clicked in it. An open editor closes when it loses
  the focus.
  The node a card shows is a projected instance, one per projection
  (`canvasInstanceKey`), which the outline activates as it does a query's
  rows, so only the projection showing edits it.
  In 3D a double-click on an item steps into the group on the way to it as
  in 2D, and otherwise, for an item with an editor (text, shape, card),
  selects it, opens its editor and flies face-on to it (`faceOnView`; a face
  that stands is only framed). The editor is the item's own DOM face
  (`CanvasCardFace`, laid out by its projection), laid over the 3D canvas
  exactly on the plane its face is drawn on (`faceFrameOf`): its four
  corners go through the camera model and the element is mapped onto them
  by the homography that takes a rectangle to any four points, as CSS
  `matrix3d` (`canvas-face-overlay.ts`). So it fits a turned and tipped face
  through either lens, follows the camera every frame of the flight and of
  any orbit; while the face is seen from behind or edge-on it is not shown
  and takes no pointer, but keeps its focus and stays open. A face
  turned upside down to the camera is edited upside down, as tldraw edits a
  turned shape in place: the turntable camera never rolls. Typing goes to
  the editor, so G, S and E type; Escape, Enter (in a label or a card) or a
  press elsewhere closes it, and the camera flies back to where it was —
  unless it was taken elsewhere meanwhile (`CanvasCameraRig.visit`). A
  text card or a label placed with its tool, or the text card a
  double-click on empty canvas makes, opens its editor at once, in
  either projection, as tldraw's text does (where it lands; no flight); and
  ↵ opens the editor of the one item selected that has one, as a
  double-click does (`edit`, the page's one `openEditor`); with none to
  open (a frame, two items) ↵ is the browser's, so a focused button or
  menu row still takes it — a shortcut that needs a selection treats one
  with nothing to act on as none (`acts`, `intentApplies`).
  Switching to 2D while editing hands the edit to the 2D canvas, which
  opens the same editor in place; the 3D camera is not flown back.
- **A note grows to fit its words** (tldraw's note). A text card's editor
  is its textarea in both projections (above), so it is the one place that
  measures them: typing past the card's bottom grows it down by what ran
  over, from its top edge as it stands (`withBox`, `@kb/canvas`
  `transform.ts`, the box a resize gives a turned item too). It never
  shrinks under a box it was given; resizing it smaller is still a resize.

Not shipped, named: cursor-centred scroll zoom (zoom is viewport-centred),
a copy in any form but a canvas document's text, snap guides during keyboard nudge, edge colour
on the stroke itself, edge endpoint re-routing, a paste row in the context
menu (the browser's paste event is the canvas's one paste), the context menu
in 3D (`GAP [[01M5QQVBJFGF3GKZJVF151CABJ]]`); in 3D, a flat item that is
not a billboard seen exactly level (the front and side presets), which is a
hairline on its plane (`GAP [[01M41AB7YM5801ZJNM1Q647SYD]]`). From the top, a cone or a sphere paints by
the height of its point, so a raised card floating over its rim is drawn
under it there.

#### Update cost

The bar is tldraw's: 60fps panning, zooming and dragging one item or fifty
on a canvas of 2000 items and 1000 bound edges, and no dropped frame for a
write elsewhere in the store. It is measured, not gated
(`GAP [[01M5PMJEGCJPMVNCKBDYZ0V57G]]`): the benchmark, its harness and its
numbers are [docs/research/2026-10-24-canvas-perf.md](docs/research/2026-10-24-canvas-perf.md).
What is gated is the contract it rests on: each change draws again only
what it changed.

- **A camera move draws no item and no edge again**, and a pan inside the
  stage's floor window (`floorWindow`) does not draw the layers either.
  The camera stays the page's state, so the stage itself is drawn.
- **A moved item draws itself and the edges at its ends**; a selection
  draws what it selects and lets go; an edit elsewhere in the document, or
  a write elsewhere in the store, draws nothing, framed items included.
  Each item (`CanvasItem`) and edge (`CanvasEdgeView`) is memoised on what
  it draws, with handlers that last the stage's life (`useStableActions`),
  and what derives from the document is held by the document: routes
  (`edgeRoute`), membership, paint order, clips (`itemClips`).
- **The stage draws what its window meets, and what it holds wherever it
  is**: an item whose floor at rest (`restingReach`) meets it, an edge
  whose line (`edgeReach`) or label (`labelReach`) does; and the selection,
  the item edited, the item holding the focus and the edge whose label is
  edited, wherever they are. A crossing draws only what it brings in, as a
  deferred update. A stage not yet measured draws everything, which is
  what the projection contract runs on.
- **What is drawn over the stage moves with the camera, not the page**:
  the link marks and the comment layer are memoised on the document, the
  threads and the camera (`useShownCamera`, which reads the view and the
  stage's size as one, so a resize leaves a mark on its item), with
  handlers that last the page's life; a page drawing again for a pointer
  move draws neither.
- **Nothing costs the compositor per item in motion**: a carried item's
  handles are hidden while it moves (`carriesItems`), and the grid is one
  layer slid by a transform.
- **What reads the canvas waits for rest**: the pane's screen in 2D once
  the view and the document stand still (`useCanvasScreen`), a view's
  layout only while a script listens (`ViewLayout.set`), and
  `canvas.change` once a gesture is let go of.

`canvas-update-cost.test.tsx` proves each bullet as render counts.

### Cross-surface polish (i5)

The rules that hold everywhere, so no surface re-invents them:

- **One captured global shortcut.** `lib/keyboard-shortcuts.ts`
  `matchGlobalShortcut` owns ⌘/Ctrl-K and nothing else: `"node-palette"` when
  an outline row anchors it (selected or edited), `"global-search"` otherwise
  — ⌘S is deliberately left to the browser, because kb has no save action to
  bind it to. App-level dispatch lives in `components/App.tsx`. Zooming never
  leaves the selection on the zoom root, which is a header and not a row: it
  moves to the first row under it, or clears.
- **The palette behaves like a dialog.** `components/palette/command-palette.tsx`
  records `document.activeElement` on open and restores focus on close, traps
  `Tab` inside itself, and keeps the active result scrolled into view.
- **Popovers dismiss one way.** Every popover, menu and picker that floats
  over the page — the canvas's comment thread, solid picker,
  view menu, shortcuts sheet and node picker; the graph's settings and
  perspective picker; the outline's frame filter; the
  ontology picker, the add-a-ref picker and the pane switcher — dismisses
  through `@kb/ui-sdk`'s `useDismiss`, never a listener of its own. The
  open popovers are a stack, the last opened on top. Escape dismisses the
  one on top, reaches nothing else (no listener below the window, and none
  on the window after the popover's, which it stops immediately; a window
  capture listener added before any popover opened hears it first, so the
  page's own, its global shortcuts, act on no Escape), and gives focus back
  to what had it as that one opened (read in the commit that opens it,
  before an input it renders takes focus). A press dismisses every popover above the one it
  lands in, so a press in a popover opened from another leaves both open,
  and one on the page dismisses them all. A popover names its parts
  (`{inside, trigger}`): what counts as itself, its panel, and its
  trigger, the control whose own click toggles it (an element, or a
  selector for triggers such as the outline's filter buttons), or null for
  one nothing toggles (an inspector, a sheet a key opens). The trigger is
  the popover's own, so a press on it dismisses nothing and its click
  closes an open popover exactly once, rather than the press closing it and
  the click opening it again. A trigger lives with its popover. Both are heard on the window in the capture phase, so no
  handler under a press or a key keeps them from it. One contract holds it over every popover:
  `@kb/ui-test-kit`'s `dismissContract`, which each package runs over the
  popovers it renders, keyed by each one's file, every mount saying its
  trigger, so a press and click on it is held to closing it exactly once; the harness's
  `popover-dismiss-coverage` check fails when a file calls `useDismiss` and
  no suite names it.
- **IME composition is never interrupted.** Field editors track
  `compositionstart`/`compositionend` _and_ check `nativeEvent.isComposing`
  before treating a key as a commit, so a composing CJK/dead-key sequence is not
  swallowed by Enter.
- **Load failures are recoverable, not raw.** An initial graph/workspace error
  renders a human-readable state with a Retry action and the technical detail
  behind a disclosure, rather than dumping the error.
- **Motion is a preference.** `index.css` carries one global
  `@media (prefers-reduced-motion: reduce)` block that flattens animation,
  transition and scroll behaviour across _every_ surface — the graph cross-fade,
  the canvas, the outline — so an animated surface added later inherits the
  policy for free rather than opting in.
- **Focus follows the selection.** A `NodeRow` that becomes selected takes
  focus when it would otherwise fall to `<body>` or is still inside the row
  (Escape out of its editor), never from anything else. The first Tab stop is
  a "Skip to content" link past the sidebar to the main column.
- Navigation affordances are keyboard-reachable: sidebar Home exits zoom, a
  closed sidebar is inert with focus returned to its toggle, breadcrumbs carry
  an accessible label and current-page marker, and tag chips expose real
  navigate / remove / configure buttons instead of click-only regions.

Deferred from i5 and still open: the Add-field flow, palette ranking/highlighting, URL and
history handling, and a toast-model redesign.

### Node-scoped commands: debug fields, pin

Two questions that look like settings are actually questions about one node, and
both are answered from the node ⌘K menu rather than from a device switch.

- **Debug fields are per node.** "Show me the hidden props" (the fields whose
  nodes say hidden, [DESIGN.md → Data model](DESIGN.md#data-model--everything-is-a-node))
  is asked of the node you are inspecting; a debug row is written wherever the
  system-write rule lets a person write it. `stores/debug-fields.store.ts` owns the set of
  node ids that answer yes, persisted with the same `loadIdSet`/`saveIdSet`
  encoding the expanded rows use (key `kb-debug-fields`); it is the only reader
  and writer, so no component touches `localStorage`. The old device-wide
  `showAllFields` pref is **deleted**, not kept alongside — one switch that
  turned every page into a schema dump was the bug. `sys.cmd.debug-show-fields`
  in the global palette now toggles the selected row (or the zoomed root), the
  way the view-mode commands target a frame.
  - **Table and Board columns belong to the frame.** A header serves every row,
    so "per node" there can only mean the frame node that owns the view; a
    row's own field rows still follow the row's own flag. One flag, two
    honest readings of "which node".
  - _Migration (intentional breakage, same idiom as `loadExpandedIds`):_ a
    user who had the global switch on has no id set to migrate to, so debug
    starts off and is re-armed per node. The stale key inside
    `localStorage["kb-prefs"]` is ignored on read and dropped on next write.
- **Pinning is listing.** `@kb/ui-sdk`'s `lib/pinned.ts` owns it: the
  seeded `pinned` node's **children** are contextual references (`sys.f.ref.target`) to the pinned
  nodes, and that list _is_ the sidebar section. `mutations.togglePin` appends
  one such child or deletes it, and nothing else. Three things follow that a
  `pinned` supertag could not give (DESIGN.md →
  [Kinds, roles and options](./DESIGN.md#kinds-roles-and-options)):
  - **Order is data.** A tag is a set, so the sidebar had to invent an order
    and sorted by label. Children are ordered, and the outline's existing
    drag-reorder writes that order — the sidebar learned nothing about
    dragging, because `pinned` is an ordinary node you can open and rearrange.
  - **One node kind, reused.** A pin _is_ a contextual reference: the row the
    outline already renders, backlinks already count, and ⌘K already mints.
  - **Nothing is written to the pinned node.** That is why the toggle no
    longer refuses `sys.*` targets — tagging edited the node's kind slot, so
    pinning `sys.queries` was a write to it; pointing at a node is not.
  - The list node is deliberately **not** `sys.`-prefixed, for the same reason
    `lens.all-mentions` is not: its whole purpose is to be written to.
  - **Naming collision, deliberately not merged:** an _ontology's_ pins are
    `sys.f.onto.member` props with their own Unpin control on the ontology
    page. Same English word, different field, different mechanism.

### UI points: routes and views

The UI is assembled from contributions to the browser's `@kb/plugin` kernel
(`@kb/ui-sdk`'s `lib/plugins.ts`), and five points hold them: `RoutePoint`, `ViewPoint`,
`SidebarSectionPoint`, `DockPoint` and `OverlayPoint`. This section is the one statement of
the first two; [Docks](#docks) states the last two.
The plan they come from is
`docs/waves/2026-09-24/briefs/plugin-composition.md`, and this is its
phase R1.

**A view is the concept, and a page is a route to a view.** A graph page and
an ontology that shows the graph are one thing: a projection of the graph,
rendered in a box the host owns. So there is one point for it, and routing is
a separate point that only points at it.

- **`ViewPoint`** (`ui.views`) holds a `View<P>`: its `key`, the `placements`
  it can fill, a `sample: P` (the params the contract suite mounts it with),
  and `Component`, which receives `{ params: P, host: ViewHost }`. A view owns
  no route and no chrome. A page view no route opens may say how a page it is
  the whole of is framed (`frame`): the outline and core's read view scroll.
- **`RoutePoint`** (`ui.routes`) holds a route: the `view` key it renders,
  `match(path) → P | null`, and, from those params, the shell `frame`
  (`scroll`, `fixed` or `full`), the `pendingTitle`, and an optional `Chrome`
  (a bar the shell renders outside the scroll region, such as the ontology
  scope bar). A route owns no page component. A pane resolves its path to
  the first route that matches, then renders that route's view through a
  `<ViewSlot>` at placement `page` (`PaneFrame`, Panes and layouts below). A
  path that no route owns is not found. A route may name its `entry`, the
  path that opens its view with nothing chosen, which a pane's view
  switcher offers. A host that shows a view no route led it to (a node
  opened in its default view) frames that view's page as the route that
  opens the view frames it (`pageFrameOf`), else as the view's own `frame`
  says, and lets it fill its box when neither says.
- **`ViewHost`** is what a host guarantees a view. It is never a store and
  never `ctx`. It carries `placement`, which is `page` (the view fills
  the box its host gives it: the shell's page, the graph's canvas) or
  `inline` (the view sits in the outline's flow, under the row of the frame
  it shows), and, when the host draws the view from a view node, that node
  (`viewNode`, which the slot takes and the node route passes): where a view
  that edits its own settings writes them (the chart's spec editor). A view
  drawn from a view type or from code has none. The rest of the host contract (size, appearance, reduced motion,
  and the other placements) arrives with its first consumer
  (GAP [[01M3EZR20H0CDF5MD01M2S26C5]]). Nesting is separate from placement,
  and it is already live: the ontology's view embeds the graph and outline
  views, each in a page-placed slot inside the shell's page slot, and the
  outline shows each frame's children in an inline slot. The slot owns the
  depth guard (promise 6).

**Keys.** A `ViewKey<P>` is made once, by `viewKey("<namespace>.<local>", params)`,
and is compared **by identity**, like `Service`, `Event` and `Point` keys. A
key with the same id that was created somewhere else is a different key.
`params` is an Effect `Schema` decoder of `P`: the view's settings, stated
once. It is what types `P` for the compiler, and it is read at run time: a
host decodes the view's stored config through it (`paramsFrom`, which keeps
only the settings the key declares), a settings panel asks it which settings
the view reads, and the contract decodes each view's `sample` with it. A view
that renders from the store alone declares `NoParams`. A key also names the
view in data: `option` is the id of the option node that stands for it in
the store (`sys.view.<id>`, derived from the id, so the two cannot disagree),
and `config.read(props, host, report)` reads stored props into the input
`params` decodes (`paramsFromProps`), for the node the view is shown for;
`config.write` is its inverse (DESIGN.md → View nodes). A frame view reads
the `sys.f.view.*` settings, a renderer the lens props, and a view whose
settings nothing stores reads nothing.
`provideView(key, view)` builds the
contribution under the key's local id, and `provideRoute(route)` builds a
route under its view's local id. A plugin's namespace is therefore the key's
namespace, and a view contributed under any other id cannot be found by its
key, which the contract suite reports.

**Asking.** `useView(key)` returns the `View<P>` provided under the key's id
only when that contribution's key is this very key object. That identity
check is the one place an erased view is read as `View<P>`, and it is the
same trust `asKeyType` spends in the kernel. `paramsOf(route, key)` reads a
matched route the same way: it returns the route's `P` when the route renders
this key, and `null` otherwise. A sidebar section uses it to know whether the
current page is its own, without naming an id as a string.

**The slot's promises.** `<ViewSlot view params placement fallback subject?
pending?>` is the only way to render a view, both for the shell's page and
for one plugin embedding another's view. `subject` is what the host shows the
view for (a frame's id, a perspective's), where it may show the same view for
another.

1. It renders the view provided under `view`, with `params` and
   `host = { placement }`.
2. It renders `fallback` when no view is provided under that key, when the
   one there was made with a different key object, or when the view does not
   offer `placement`. `fallback` is a required element, so a slot never
   renders nothing. This is live: unloading the owning plugin switches the
   slot to its fallback, and reloading it brings the view back.
3. It wraps the view in its own `ViewErrorBoundary`, reset by the key's id
   and the `subject`. A view that throws shows `ViewError` in its own box,
   and the host around it stays up.
4. It wraps the view in its own `Suspense`, showing `pending` in its box
   while the view's code or data loads (by default a quiet token-coloured
   placeholder; the shell's page passes its own loading state), so a host
   that embeds a lazy view never blanks a boundary above it. A load that
   fails and knows how to be tried again (`RetryableError`, from
   `lib/kept-load`) is told so by the boundary's "Try again".
5. It adds no DOM of its own, so the box is exactly what the host gives it.
6. It knows the slots around it, outermost first, as a chain of links
   (`SlotChain`: each slot's view and subject), through a React context that
   only the slot writes, and renders only when `slotRenders` says so
   (`lib/view-key.ts`): not when any slot around it shows the same view for
   the same subject, which is a cycle however many other views lie between,
   and not past `MAX_VIEW_DEPTH` (32), a safety net against runaway nesting
   of ever-new subjects. A list's rows each showing their frame as a list
   are links for other subjects, so they are no cycle. A view that embeds
   itself, directly or through another view, stops at the first repeat. The
   chain is the slot's to keep; it is not part of `ViewHost`, because no view
   reads it. The keyboard walk asks the same rule of the chain it walks,
   starting from the chain around the outline's root frame, which the outline
   host hands the store, so it never offers a row a slot refused to render.

**Views are soft and services are hard.** A missing view never makes its
consumer `pending`. The consumer shows the fallback. A computation that
another plugin must have is a `Service`, injected in `inject`, and it makes
the consumer pending while its provider is off. Use that form only when a
hard dependency is what you mean.

**Where keys live.** Every view key kb provides, with its param types and the
settings it reads from a view node, is data in a `scope:shared` package, with
no React and no store: core's in `@kb/views` (`packages/domain/views`), one
module per plugin namespace; the graph's in `@kb/graph`; a family's in its
shared package (`@kb/canvas`, …). The server holds the same keys, to list, check
and render views (DESIGN.md → View nodes), so a key is never written twice.
Any zone may import the package. A host imports the key and never the
component. That is how the ontology embeds the graph and the outline
(`components/ontology/surfaces.tsx`) without importing either one.

**Families of views.** Some views are alternatives a host chooses between by
config. A family's key extends `ViewKey` under a discriminant, `family`
(`graph.renderer`, `outline.frame`), with what that host must know before it
renders one; keys are data (`@kb/views` knows no kernel, React or
store). A picker names a view by its key's `label`; how it shows it
(`picker`: its `order` among the family, and where the family has them a
glyph, an icon and a `sys.command` node) is presentation, so it is part of the view's contribution, not of its
key; `provideView` requires it for a key with a `family`, and takes none
for a key without. A family is enumerated one way: `familyViews` over `ViewPoint`, which
keeps the views of that family that are provided, in `picker.order`. While
config is text, a view goes by its key's local id (`localIdOf`), which is
how the stored name resolves to the key among them.

- _Graph renderers._ Each renderer is a view whose `RendererKey`
  (`@kb/graph`, `views.ts`) adds its capabilities, encodings and whether
  it moves links. Its params are the lens every renderer draws through
  (`LensParams`), then the `LENS_SETTINGS` it draws with, so the settings
  panel enables exactly the settings its params declare. A graph view node's `sys.f.view` names it by its key's `option`
  (a neighbourhood's `lens.renderer` names the renderer it hosts the same
  way); the renderer switch lists the renderer views provided. The graph page decodes the perspective through the
  renderer's params and draws it through a `<ViewSlot>`. What the renderer
  draws from beyond its settings (the extracted graph, selection, camera and
  search) is not config, so it travels in the page's `GraphFrame` context,
  never in the params; a renderer view outside a graph host says there is
  nothing to draw. The graph page is one graph host, and a node's
  neighbourhood (`graph.neighbourhood`, below) is another. The renderers' components load in their own chunk,
  prefetched when the graph page loads; a renderer view suspends in its own
  slot until the chunk arrives, and a failed load is tried again from that
  slot's error.
- _Frame views._ A frame's children are shown by one of four frame views,
  each a view at placement `inline`: the outline's list, which nests them,
  and the collections family's table, board and cards
  (`@kb/collections-ui`), which lay them out as a node set inside the
  outline that hosts the frame. Every frame view's key is made by
  `frameViewKey` (`@kb/views`, `outline.ts`): its page is the outline at its
  frame, and its id is frozen in the `outline.` namespace it was first
  stored under, so a collection view answers to that id as an alias of the
  one its plugin contributes it at. The keys carry the one trait the row walk needs
  beside the params: how the view lays rows out (`outline`, nested; `rows`;
  `columns`). The frame's first frame view node (DESIGN.md → View nodes)
  names the view, and `frameViewOf` (`@kb/ui-sdk`'s `lib/frame-view.ts`)
  looks that node up in the schema (`frameViewNodeOf`, the one test of what
  a frame's view node is, which every reader shares), resolves its view
  among the frame views provided, the list's when the frame has no frame
  view node (it names none, or only nodes that name no frame view), and
  decodes the view
  node's props through that view's params, so the view gets exactly the
  settings it reads. A frame whose view node names a view not provided here
  (its family switched off) shows the kit's one "cannot be shown here" state
  (`ViewNotLoaded`, drawn inline), named by its option node, and offers the
  row walk no rows; its view node stays. A host
  that already selected the view node from the store (`useFrameView`) hands
  it to `frameViewThrough`, the same resolution without the lookup. What
  `frameRows` does with the rows follows from the params: every view
  narrows them by its filter (DESIGN.md → View nodes), and a view sorts, groups its columns by a field, or pages exactly
  when its params declare `sort`, `groupFieldId` or `pagesize`. The
  toolbar, the node menu and the `view-as` commands list the provided frame
  views by their pickers, and every one of them, the toolbar's settings
  included, writes the frame's view node (`planEditFrameView`), making it on
  the first edit; none writes the frame's own props. A view node's
  settings are fields its seed hides from field rows (DESIGN.md → Data
  model → field visibility), since the toolbar draws and writes them; its
  debug fields show them where it is filed. The toolbar's gear (and ⌘K
  "Filter…") opens the frame's one view settings popover
  (`ViewSettingsPopoverHost`): above the filters every view reads, a section
  for each setting the view's params declare, group by (`groupFieldId`),
  fields (`display`) and page size (`pagesize`), so which controls a view
  offers is its declaration, as what `frameRows` does is. Each is drawn
  with the query builder's slot (`ChoiceSlot` over the one node picker):
  a field is picked from the rows' fields, those their tags template first;
  the fields shown are chips, removed one by one and added from the same
  candidates, and "tags' fields" names none again. A board with no group
  field says so and opens the popover. A view node is
  one node however many hosts name it, so editing it — from any host's
  toolbar or its own row — edits it for every host that names it; a host
  that should differ names a view node of its own.
  The store's row walk (`visible-instances`) and the command registry read
  the same enumeration from the UI kernel (`@kb/ui-sdk`'s
  `providedFrameViews`, the frame views `ViewPoint` holds now), so a frame
  view a plugin provides is walked and offered while it is loaded and not
  after. The frame a view shows (its id, instance key, query rows
  and depth) is not config, so it travels in the host's `FrameSubject`
  context (`@kb/ui-sdk`'s `lib/frame-subject.ts`). The subject also carries
  what the host draws each row with: a view lays the rows out, and the host
  edits each row's text (`RowText`) and keeps how many pages of them are
  revealed (`pages`, `revealMorePages`). A row's fields are drawn with the
  page's field editor (`useFieldEditor`, the `FieldEditorService` the
  outline provides while it is loaded), the one editor every surface that
  shows a field draws it with, a frame view's cells and cards and the
  agent's settings in its dock alike. So a frame view of
  any family lays out rows the outline edits, and draws exactly the rows the
  keyboard walk reaches. Its row chrome reads the page's selection and the
  rows' expansion through `BrowserHost` (`useIsActive`, `useIsSelected`,
  `selectNode`, `toggleCollapse`). The outline builds the subject once
  (`outlineFrameSubject`). Every outline host (the outline's root, a row of the list, a
  query's projected results) renders a frame view through `FrameViewSlot`,
  with the frame's id as the slot's `subject`, so a list of lists is a chain
  of links for other frames, never a cycle (promise 6). A query's results
  in the list view are the one rows
  the list draws itself, as references, through the query row's
  `renderNode`.

**The contract.** `src/view-contract.test.tsx` runs over every view that the
built-in and optional UI plugins contribute. A new view joins it by being
registered. For each view the view must: be found by its key; have a
`sample` that its key's `params` decodes; mount in a slot with its `sample`,
in each placement it offers, and show neither the fallback nor the slot's
error (a family's view outside its host shows its own empty state: no graph,
or no frame); show the fallback while its owner is unloaded
and come back when the owner reloads; have a throw from a provider under its
key contained by the slot; stop at the first repeat when a provider under
its key embeds that key again; and, once settled, leave nothing behind in its
box or elsewhere in the document when it unmounts. "Comes back" means
settled, with neither the fallback, a suspended state, nor an error showing.
The route table in `ui-plugins.test.ts` also checks that every route renders
a registered view that offers `page`. The slot is checked on its own too: a
view shown again down its own tree for other subjects renders up to
`MAX_VIEW_DEPTH`; a cycle through another view stops at its first repeat; a
view that suspends waits in its own box; and a view whose code failed to
load loads again when its error is retried. The remaining properties (sizing,
disposal of instrumented resources, appearance, reduced motion and bad
config) are deferred with the host contract, in the same gap as above.

**Decisions.** These are the defaults R1 takes for the brief's open
questions. Each one can be overridden.

1. _Name._ The concept is called **view** (`ViewPoint`, `ViewKey`,
   `ViewSlot`). "Lens" already means a graph perspective, and "embed" names
   the consumer's act, not the thing. The overlap with the outline's
   `sys.f.view.*` prefix is accepted: those modes are views now
   (Families of views).
2. _Where built-in keys live._ In `@kb/views`, as above: the package split
   this decision anticipated, made so the server holds the same keys. A key
   is data, so the package never pulls in the kernel, React or a store.
3. _Which nodes get embeds._ Per-node refs only (`sys.f.views`), decided in
   A1; DESIGN.md → Kinds, roles and options → View nodes.
4. _Neighbourhood direction._ The union of both directions, decided in A1;
   stated in the same section.
5. _Isolation._ Views are trusted and run in the same realm. Each one is
   contained by its slot's error boundary and its fallback. Untrusted code
   is the code view's, which runs in a sandbox frame inside its own view
   (Code views below; DESIGN.md → Sandbox).

**View nodes (A1).** A view someone chose is a node (DESIGN.md → Kinds,
roles and options → View nodes): its `sys.f.view` names the key whose
`option` it is (`viewKeyOfNode`), and its props are that view's params for
the node it is shown for (`paramsFromProps`). A code caller's params are
checked by `tsc`; nothing decodes them at the slot.

- _`graph.neighbourhood`_ (graph plugin; `inline`, `page`) draws the
  neighbourhood of `root` — the nodes within `hops` of it along `edges`,
  either way — by hosting a renderer view the way the graph page does: it
  extracts the graph (`extractNeighbourhood`, the page's extraction over
  that node set), provides the `GraphFrame`, and draws the renderer named by
  `renderer` with `settings` in a page-placed slot filling its box, for
  `root`. Stored, its root is `lens.focus`, else the node it is shown for.
- _`outline.snippet`_ (outline plugin; `inline`) is a read-only glimpse of
  the outline under `root`: its text, then descendants `depth` levels down,
  at most `maxRows` rows. Stored, its root is `lens.focus`, else the node it
  is shown for.

These points, and `ViewSlot`, live in `@kb/ui-sdk`
([Extension UI halves](#extension-ui-halves)), so a plugin package contributes
and embeds views through the package, as the shell does.

### Docks

A dock is chrome, like a sidebar section, not a view. It is a tool window
at the workspace's right edge, beside every page, and it shows no
projection of the graph. A plugin contributes it to `DockPoint`
(`ui.docks`) as `{order, label, icon, Component}`. The shell (`src/docks.tsx`)
draws one toggle per dock in the workspace header, in `order`, and the open
dock in the row beside the page. At most one dock is open (`openDock` in the
ui store, transient). Below 768px the open dock floats over the page, as the
sidebar does. Unloading the plugin removes its toggle and its window.

A page overlay is chrome too, with no toggle: something a plugin mounts once
for the whole page, beside every pane, such as a popover host that portals to
the document. A plugin contributes it to `OverlayPoint` (`ui.overlays`) as
`{order, Component}`, and the shell (`src/overlays.tsx`) mounts every one, in
`order`. The first is the outline's frame view settings popover host, which
the toolbar's gear and the "Filter…" command open on a frame. The outline is a
required family, so the page loads its browser half on every convergence, and
its host is mounted on every page, as it was when the shell mounted it.

The first dock is the agent's chat (`@kb/agent-ui`), the optional `agent`
plugin. It draws the conversation the agent channel reports
(`DESIGN.md` → Agent packages): the text as it streams, each tool call as a
line that opens onto its input and receipt, a running turn's stop button, and
a "new conversation" button that forgets the old one.

**Approval** is drawn as a card that waits on a call the invoke core
answered `approval_required` (the agent channel's `approval` event). Below
the call's input it lists what a write to configuration runs with, from the
event's `ask`: each node it configures or names and its settings, so a
selection's card shows the provider's endpoint and executable.
Approve and Decline are both the same call, made by this tab as the agent's
through the browser's one invoke path (`invokeSettled`), with `approved` set
to the person's answer. The receipt that comes back is what the agent is
told. A decline is therefore refused by the invoke core with
`approval_required`, exactly as an unapproved call from anywhere would be.
The package (`@kb/agent-ui`) reaches neither the socket nor the invoke path
itself: the shell binds them as its ports where it loads it (`ui-plugins.ts`).

### Who the tab is

Every kb page is the person's (`DESIGN.md` → Surfaces → Who the person
is), however it was opened and however kb is served: there is no link to
open it by and no unverified tab. The server tells each connection, after
`hello`, the name the deployment knows the person by; the page keeps it in
the ui store (`person`). The tab names itself: it mints a session id once
and keeps it in its sessionStorage (`DESIGN.md` → Surfaces → The tab
session), the id its screen is published as and an agent's screen command
names. While policies are deferred nothing the page does asks for approval
(`DESIGN.md` → Action registry → Current stance), so neither approval card
(the agent dock's, above, and a code view's, Code views) shows.

### Panes and layouts

The workspace is the layout open as the whole screen (DESIGN.md → View
nodes → Layout views states the tree and the node route). Its arrangement
and focus are the workspace store's (`stores/workspace.store`). They are
per device, kept in `localStorage["kb-workspace"]`, and never in the graph
until "Save workspace".

- **The URL names the focused pane.** The address bar shows the focused
  pane's location. A navigation (a link, a command, back and forward) moves
  the focused pane (`startWorkspace`). Moving the focus shows the newly
  focused pane's location without adding a history step (`replacePath`). On
  load, the URL wins over the stored location of the focused pane.
- **One pane has no chrome.** A workspace of one pane is drawn as the page
  always was: the header, then the pane. Two or more panes are a movable
  layout grid, and the header stays. A page that takes the whole column
  (the graph) takes the header's place only when it is the only pane.
- **A pane's body outlives its place on screen** (`pane-bodies.tsx`). Each
  body is drawn once, into an element of its own, under its pane id
  (`PaneContext`, `lib/pane`). The layout only places that element, so
  opening a pane, closing one, moving a tab or resizing never remounts
  another pane's view. A pane's scroll offset is put back after a move. A
  pointer or the keyboard entering a pane focuses it.
- **dockview draws the grid, behind an adapter.** `dockview-adapter.ts`
  projects kb's tree to dockview's serialized form and reads every change
  that dockview reports back into a kb tree. The kb tree is canonical, and
  dockview's JSON is never kept: projecting a tree and reading it back is
  the identity (a property test). A tree changed from outside is shown to
  dockview again. dockview (MIT) and kb's theme (`dockview-theme.css`, every
  value a design-system token) load in the grid's own chunk, only when a
  second pane opens or a dashboard is shown. Floating and pop-out windows
  are off (GAP [[01M3Q5DP9TQF0E9DZMHAKHMGWD]]).
- **Panels first, then splits and tabs, on the one tree.** A Shift-click on
  a bullet or a reference follows into a new pane to the right of the
  pane it was clicked in (`FollowHow` `beside`, Tana's panels), and so does
  the node menu's "Open in panel". Dragging a tab docks it as a split or
  as a tab of another group. A tab's ✕ or "Close pane" closes a pane, and
  the last pane stays. Each workspace pane's tab is its view switcher. It
  lists the node the pane is shown for, through its default view, each of
  its view nodes, and each view type that a node can be shown in. Then it
  lists every route's `entry`. Choosing one moves the pane, and nothing is
  written.
- **Opening a node is the pane's.** `open` (a bullet's follow, a crumb, a
  reference) zooms the outline when the pane shows the page's outline. When
  the pane shows an outline rooted at a node (`/node/<id>`), it moves that
  pane to the node instead (`OpenNodeContext`, `useOpenNode`).
- **Opening a node** goes through its default (DESIGN.md → View nodes): its
  own view nodes, then its tags' default view types (`#canvas` opens in its
  canvas), then the store's, then the read view. A Shift-click, "Open in
  panel" and a rooted pane's `open` all go to `/node/<id>`, so a canvas
  opens as a canvas there; the page's own zoom stays the outline's, since
  the zoom is the outline's location (`/outline/<id>`).
- **"Open with…"** is the node menu's row per way this page can open the
  node: `pageOpeningsOf` (`lib/node-openings`), which is `nodeOpenings`
  (`@kb/views`) less the view types this page draws no page of — the same
  list the pane switcher offers. Its tags' defaults come first and the one
  it opens in by default says "(default)". A row moves the focused pane to
  `/node/<id>/<view>`, so the step is in the history, and writes nothing.
  It is reached from the keyboard as every node command is: the node menu
  is a palette, so typing "open with" finds the rows. Which view a tag
  opens in is the tag's `view.default` row, a field like any other.
- **The zoom is a location.** The page's home is `/`, and zoomed to a node
  it is `/outline/<id>`; in an ontology's scope they are
  `/o/<s>/outline` and `/o/<s>/outline/<id>` (`outlinePath`,
  `outlineLocationOf`). A zoom (`zoomTo`, `zoomHome`, and every gesture that
  ends in one) pushes that location, and the page stands where the URL names
  (`followOutlineLocation`), so back and forward walk the zooms and a reload
  or a link lands at one. A location whose node the page cannot show is
  replaced by the scope's home, and reaching a node outside the scope pushes
  the unscoped location it lands at. A zoom key (⌘., ⌘↑) opens as its row's
  outline opens a node (`openFromRow`): a rooted outline moves its pane. A
  zoom in a dashboard's outline moves the pane that holds the dashboard, as
  every open from a dashboard does (`navigatePane`). The page still has one
  zoom, so every pane at an outline location shows, and is titled by, the
  focused pane's (GAP [[01M411FP5AGQ4VB5SGJWCJAN66]]).
- **The home is core's, the outline draws it.** The unscoped zoom
  locations are the route of core's home view (`layout.home`, the layout
  plugin), which shows the zoom in the store's default view type for no
  node (DESIGN.md → Layout views → the home is core's), as an ontology's
  scope does. With the outline loaded that is the outline at the zoom, and
  the outline contributes no route of its own; with it switched off, the
  zoom is read in core's read view (`layout.read`): its text and its
  descendants as links, a row opening its node in the pane (rooted) or
  zooming (at the home), and a line saying which view it is read in place
  of. The sidebar's Home row is the layout plugin's; the outline adds its
  Pinned section.
- **Each outline on screen is its own host.** An outline keys its rows
  under its pane's outline host (`outlineHostOfPane`; the main pane's is the
  canonical `tree/`), so the same node open in two panes is two rows,
  edited one at a time. Each outline says where it is rooted and which
  slots surround it (`outline-ui/src/outline-hosts`). The keyboard walks the rows
  of the host that a row is keyed under, and a row activated without an
  instance takes its row in the outline being worked in. The page-wide
  parts of editing (the selection keymap, undo, the node palette) are
  owned by the one outline that leads (`useLeadsOutlines`). A query's
  projected rows name their query, not their host
  (GAP [[01M411FPC839XBJJ873V1VYYYD]]).
- **A dashboard is fixed.** The layout view in a pane draws its own panes
  with the same grid, locked. Its panes take ids under their pane's
  (`<outer>:<inner>`), and each draws its page through a slot shown for its
  location. "Open as the workspace" (its corner button, or the node menu
  on a layout node) replaces the workspace with its tree, movable again.

### Chart views

The chart plugin (`@kb/chart-ui`) draws `chart.vega-lite` (DESIGN.md
→ View nodes → Chart views states its params and data) at placement
`page`. It owns no route: a node opens it through `/node/<id>/<view>`,
so a pane, a dashboard's pane and the pane switcher (which offers it for
every node by its key) reach it with nothing of its own.

- **Its rows are live.** `useChartData` (`@kb/chart-ui`'s `chart-data`)
  reads the source query node's rows as the replica answers them
  (`useQueryRows`, the one path a query node's rows take, so the chart and
  the query's results are one run; → Replica queries), and names and caps
  them through `@kb/chart`'s `chartRecords`, as the server's text does.
  When there is nothing to draw the page says why: no source, a source
  that is no query, a query that fails, a query stopped at its budget.
- **Vega loads in a chunk of its own**, inside the page's chunk, only once
  there are rows (`chart-canvas`, the one UI module that imports
  `@kb/chart-vega`; the lazy-chunk fence in `harness/src/constraints.ts`
  holds `@kb/chart-vega` and
  `vega*` as it holds three). The page's header and its states never wait
  on it. It keeps one Vega view per spec and appearance: new rows are
  swapped into it by name (`CHART_DATA`) and a new box resizes it
  (`ResizeObserver`), so a live update or a pane resize never builds it
  again. It draws SVG, and its tooltip is a popover drawn inside the
  chart's own box, so unmounting leaves nothing behind.
- **Its look is the design system's.** `chartTheme()` is a Vega-Lite config
  from resolved tokens (`readTokenColor`, because Vega paints SVG attributes,
  which hold no `var()`): ink and muted ink for text, the rule colour for
  grids and domains, the accent for a single series, the chart ramp
  (`--chart-1…5`) for magnitude, the UI face and the label, meta and ui type
  steps. It is read again when `useAppearance().key` changes. A spec's own
  `config` wins over it. Categories reorder the ramp for contrast, because a
  design system carries no categorical palette (GAP [[01M4187DVGXP15CV2JX8Z5Q6V2]]).
- **Its settings are edited as what they are.** The `{ }` toggle opens the
  spec as JSON, checked as it is typed by the chart's key (`paramsIssues`,
  strict, the check `view.propose` makes), each issue at its path, with the
  query's column names beside it. Save writes `sys.f.chart` on the view node
  the chart is drawn from (`ViewHost.viewNode`), through the same check;
  drawn from the view type alone (the switcher's "Chart"), it proposes a view
  node for its source and moves the pane to it. There is no chart builder
  (GAP [[01M4187E5QQYRD8ENHQM968EEJ]]).
- **"Add chart"** in a query node's node menu proposes a chart view node for
  it, started from the query's columns (`starterChartSpec`: its first
  aggregate column by its first non-id column, else a count of rows by that
  column), and opens it in a panel beside. `lib/propose-view` is the UI's
  one way to call `view.propose`; "Save workspace" goes through it too.

### Code views

The code plugin (`@kb/code-ui`) draws `code.view` (DESIGN.md → View
nodes → Code views states its params, DESIGN.md → Sandbox how it runs) at
placement `page`. It owns no route: a node opens it through
`/node/<id>/<view>`, in a pane, a dashboard or the pane switcher.

- **The page is a header and a frame.** The header names the view, which
  engine runs it ("Untrusted · QuickJS" or "Trusted · Worker") and how the
  run stands: running, or the end's sentence ("ran longer than 500 ms in one
  turn and was interrupted"). The frame (`SandboxFrame`, `@kb/ui-sdk`) is an iframe
  at `/sandbox`, sandboxed with `allow-scripts` alone, filling the box, and
  bound to the page's end of the bridge (`lib/sandbox-host`) while it is
  mounted. A new run is a new frame: the frame is keyed by the engine, the
  subject, the digest of what runs and "Run again", so no realm outlives the
  code it ran. Nothing runs until the digest's trust is known, because it
  decides the engine. The graph changing reaches the code as a `data`
  event, once the graph has been still for 150 ms.
- **Trust is a gesture beside the code.** "Show the code" opens the code and
  what its grant lets it ask; "Trust this code" calls `sandbox.trust` with
  the digest of exactly that code, as the page's own (human) call, and the
  frame starts again in a Worker; "Stop trusting" takes it back. The grant
  is compared by value, so an edit elsewhere never restarts the run.
- **A write that asks is a card in the view.** When the invoke core answers
  a call of the code `approval_required`, the call waits on a card showing
  the action and its input: Approve once makes the same call as the
  script's with `approved`; Decline makes it without, so the code is told
  `approval_required`. The trust lookup, the ports and that queue, the
  frame and the card are the page's one way to run sandboxed code
  (`@kb/ui-sdk` `sandbox-run.ts`, `SandboxFrame`, `SandboxApprovalCard`),
  which every run it hosts uses. The code's console goes to the
  page's log seam.

### Scripts

A view that runs scripts (DESIGN.md → Sandbox → Scripts; the canvas is the
first) mounts the code family's host, which lists the scripts its subjects
name in a small panel at the view's bottom left (`scripts-host.tsx`):

- each script by its node's text and how it stands — "Not trusted: it does
  not run", running, or the end's sentence;
- **Review** opens its code and what its grant lets it ask; **Trust** calls
  `sandbox.trust` with the digest of exactly that code and grant, as the
  page's own (human) call, and the script starts; **Stop trusting** stops
  it;
- **Run once**, on a trusted script, runs it again from the start against
  its node where kb runs code (`ext.code.script.run`), as the person;
- a call that asks shows the sandbox's approval card under its row.

The panel is absent when no subject names a script. A trusted script's frame
lies over the whole view, under the view's chrome and see-through, and lets
every gesture pass: what a script draws is a picture over the view, and an
element it anchors to an item (`data-anchor`) stands on that item as the
shown projection draws it, following the camera in 2D and 3D
(`canvas-script-layout.tsx`). The layer is masked off everywhere a press
reaches something (`pressRegions`): every item and the ports and handles
round it, every edge and its label, and the 3D gizmo; so a script's drawing
shows only on open canvas and never passes for a control over something a
press would reach.

### Optional UI plugins

Every optional family (canvas, chart, code, the lab, the agent) is on or
off as its store says, the lab off by default and the rest on, and the
agent is there only when a `kb ui` hosts it. None is a browser
preference: the server decides, and the page follows
`kb.manifest.extensions` ([DESIGN → Extension families](DESIGN.md#extension-families)).
There is one mechanism, not a second path beside the core plugins:

- `ui-plugins.ts` holds `CORE_UI_PLUGINS` (always loaded) and the
  `BROWSER_EXTENSIONS` resolver ([Extension UI halves](#extension-ui-halves)).
  `familiesToLoad` turns the server's report into the families whose
  browser entries the kernel should hold: each reported loaded that the
  resolver has. Until a server answers, the page reads the bundled list as
  a server over a store with no switch written, so each family is as it is
  by default and no agent is reported.
- Settings' Extensions part ([Settings](#settings)) has one
  on/off switch per optional extension the server reports, showing what it
  reports. Choosing calls
  `extension.switch` and reads the manifest again; the switch shows the
  server's answer, never the choice. A switch written anywhere else (another
  tab, the CLI) reaches the page's graph, and the page reads the manifest
  again.
- **The `enabledPlugins` preference is gone.** It used to keep the lab and
  the agent on per device, in `localStorage["kb-prefs"]`; a stale key is
  ignored on read and dropped on the next write. A browser that had the
  lab on sees it off until it is switched on for the kb, from Settings'
  Extensions or with `kb action-invoke '{"id":"extension.switch","input":{"name":"lab","on":true}}'`.
  The agent needs nothing: it is on by default, and switched like the rest.
- **Until a server answers, the workspace waits.** A page served by `kb ui`
  opens its workspace only once the manifest has landed and the plugins it
  reports are loaded, so a layout never shows a lab view, or any family's
  view, as unavailable on the way. An offline page has no server to wait
  for and opens on its own reading.
- `syncUiPlugins` (`@kb/ui-sdk`) converges the UI kernel on that set:
  it loads what is missing and unloads each top-level plugin no longer
  listed. `startUiPlugins` runs it at boot and again whenever the server's
  report changes.
- Unloading closes the plugin's scope, so its routes, views and sidebar
  section leave the kernel and every `useContributions` reader re-renders
  without a reload. A slot that embedded one of its views shows its fallback. A path the plugin owned then resolves like any unmatched path: it
  is not found (`components/ui/not-found.tsx`).
- A family the server reports that the page has no entry for is inert: its
  views are listed by the server's entries and open as "cannot be shown
  here". An entry the server does not report is never loaded.

### Settings

The Settings page is every choice the kb makes, the few this device makes,
and each extension's switch. The header's gear and ⌘K's _Settings_
(`sys.cmd.settings`) open it in the focused pane; ⌘K's _Settings:
Extensions_ (`sys.cmd.extensions`) opens its Extensions part. It replaced
the Preferences popover, which overflowed a short window and drew core's
settings only, and the Extensions page, which drew each switch apart from
the settings. The record of why is
`docs/research/2026-10-27-settings-parts.md`.

- **One way in.** Every page shows exactly one way to Settings, the gear in
  its header's corner (`SettingsTrigger`, `@kb/ui-sdk`): the shell's header
  renders it, and a page that takes the header's place (the graph's, the
  lab's) renders the same one in its own header's corner. The sidebar has
  no Settings row. The gear is Settings' alone: an extension's settings
  are fields of its node, drawn in its section of Extensions, never behind
  an icon of its own, and a view's own options (a graph's layout and lens,
  an outline frame's view and filters) stay in the view and wear
  `ViewOptionsGlyph` (sliders). `eslint/no-restricted-imports` in
  `.oxlintrc.json` refuses the gear icons anywhere but `SettingsTrigger`.
- **Four parts, each a path.** `SettingsView`'s one param is the part
  (`SETTINGS_PARTS`, `@kb/views`): _General_ at `/settings`, _Appearance_,
  _Extensions_ and _Advanced_ at `/settings/<part>`
  (`lib/settings-parts.ts`). A rail names the parts (a row above the page
  in a narrow window), and the part is the path, so a part is linked to
  and history moves between parts. The paths the page had before lead to
  their part, `/extensions` to Extensions and `/preferences` to
  Appearance, and the page then replaces the path with the part's own.
  The Extensions view key is retired for Settings' in the seed's table,
  so a view node that named it opens Settings.
- **A part is a list of sections, each a fold.** A section's heading is a
  button (`aria-expanded`), so Enter or Space toggles it and a screen
  reader says whether it is open. Which sections a person opened or closed
  is this device's (`kb-prefs`' `settingsFolds`, by section id), kept as a
  difference from how each opens by default, so a reload keeps it.
- **The filter** reads across every part. With text in it, the page shows
  each part's sections whose title, or any of whose rows, match, under
  the part's name, each open whatever was remembered: a section whose
  title matches whole, any other with only its matching rows. Escape
  clears it.
- **General** holds this device's width and sidebar (`kb-prefs`, never
  the graph, and the section says so), then any setting of core's that
  Appearance does not group, under _Other settings_, so none is left off.
- **Appearance** holds light, dark or system (this device's, for the
  reasons under Design systems), then core's settings in the page's
  arrangement of core's node: _Theme_, _Page head_, _Motion_, _Effects_.
  Each motion setting notes the value in force and where it comes from
  (set here, the shown theme's preset, the default), and a page-head
  setting core's node leaves unset notes what the head shows instead; an
  unset row says _unset here_ first, since its field shows nothing stored
  (an unset checkbox reads as off) while a value applies. _Reset motion to
  <theme>_ clears every motion setting of core's. Effects are labelled in
  words (`hoverLift` is _hover lift_) and drawn as a grid. The backdrop's
  direction is drawn whatever the backdrop, and notes when the shown
  backdrop faces no way. The theme and the backdrop are galleries because
  their kinds preview at card size
  ([Field values → option galleries](#field-values-one-slot-grammar));
  the page asks for nothing.
- **Extensions** holds one section per extension node under
  `sys.extensions`, in that list's order, read from the whole graph (the
  schema, never a scoped projection), then any the server reports with
  no node. Its heading carries the extension's switch when it is
  optional, which calls `extension.switch` and then shows what the server
  reports (never the choice), with _off: contributes nothing_ beside it;
  otherwise _required_. The switch is a load decision: switched off, the
  extension's actions, views and MCP tools leave, which the part's lede
  says. Under the heading are its settings, exactly what `settingsOf`
  reads for its node, each drawn with the page's field editor; core's
  section says its settings are in Appearance and General instead. Then
  why any of its plugins failed, on the server or in the page, and a fold,
  _What it composes_, closed by default:
  - its trust: part of kb's build, composed by `kb ui`, or trusted at a
    digest from a repository path, and its tags;
  - what it contributed to each point, server and page side by side, and
    how many nodes it seeds;
  - what it injects and from whom, and what it provides.
- **Advanced** holds the points whose listeners are asked in turn
  (identity providers, interceptors, guards), per kernel and in that
  order; the repository extensions refused, where an untrusted one names
  its digest; and how the CLI reaches the same settings.
- **One report.** The server's half is `extension.list`, which is also
  what `kb ext list` prints, and `extension.footprint`
  ([DESIGN → Plugin organisation](DESIGN.md#plugin-organisation--tags-and-derived-dependencies)).
  The page's own kernel is joined in through the same readers
  (`organisationOf`, `orderedPoints`, `pageFootprint`), so the page
  computes nothing a CLI caller could not read (`lib/extension-report.ts`).
  When either action fails, or the server cannot be asked, Extensions and
  Advanced say why and offer to ask again; an extension's settings stay,
  read from the graph, and its switch and what it composes are not drawn,
  never a half it could not read as an empty one. A failure is tried
  again at the next convergence, and the same failure is the same value,
  so a dropped chunk recovers without a reload and nothing moves while it
  keeps failing. A page half the page could not import counts as a
  failure, because `loadEntry` loads it as a plugin of the family's name
  that fails with why.
- **Settings are fields.** A family's settings are the fields whose
  `sys.f.configures` names its node, as `settingsOf` reads them (DESIGN.md
  → Extension families → configuration). The same reader answers
  `extension.settings`, so the page shows what `kb ext settings` lists,
  and a setting a family adds is on the page with nothing to update. The
  switch is the one setting drawn as its own control, because it goes
  through the checked `extension.switch`.
- **The contracts.** `components/prefs/settings-page.test.tsx`: over the
  bundled seed, the rows the page draws across its parts are exactly the
  settings `settingsOf` reads for every extension node, each once and for
  that node (`[data-setting]` with `[data-setting-of]`), each one field
  row; the device's rows write `kb-prefs` and nothing in the graph; the
  motion notes, the page-head _unset here_ note, General's _Other
  settings_, the motion reset, a fold remembered on this device, the
  filter and the former paths each have a case.
  `components/prefs/settings-extensions.acceptance.test.tsx` drives the
  Extensions and Advanced parts through the real App. The design-system
  and backdrop contracts choose through Appearance, each by a card of its
  gallery.
- The page's body loads when it is first opened, not with the shell.

### Extension UI halves

A family's browser half ([DESIGN → Extension families](DESIGN.md#extension-families))
is a workspace package, `@kb/<family>-ui`, that the shell's Vite build
compiles from source. It builds against `@kb/ui-sdk` and nothing else of
the shell.

- **The browser holds a resolver, not a second list.**
  - `CORE_UI_PLUGINS` holds the shell's own projections: ontology,
    extensions, layout, webmcp and screen, beside core's declaration and the page's host.
  - `BROWSER_EXTENSIONS: Record<family, {load: () => Promise<Plugin>}>` maps
    a family, keyed by its declaration's `name`, to its browser entry.
  - `syncUiPlugins` converges the page kernel on the core plugins, plus the
    browser entry of every family `kb.manifest.extensions` reports as
    enabled that the resolver has.
  - Settings' switch for an optional family writes the
    server-side setting, and the page follows the manifest. A page served without a
    family therefore never offers that family's UI.
- **One `load` shape for every source.** A bundled family's `load` is a
  static import for a family that is always on, and `import()` for an
  optional one, which keeps it out of the main bundle. A repository
  extension's `load` imports its closure's page half from the path its row
  names (`page`, which the `kb ui` server serves by the closure's digest;
  DESIGN.md → Core boundary & extensions), so `syncUiPlugins` converges on
  bundled and repository halves alike. That half is a bundle that reads
  the page's own modules rather than carrying them (`HOST_MODULES`): the
  page installs them once (`installHostModules`), so the half builds
  against `@kb/ui-sdk` as `kb-ext-sdk/page`, holds the page's one React,
  and runs with the page's power, which is the trust a person gave it.
- **The browser entry** is the family's shared plugin, loaded as a child
  (`ctx.plugin`), plus its UI contributions. So the page kernel holds the
  family's view keys, and the page's catalog is the manifest's catalog
  restricted to them.
- **`@kb/ui-sdk` is the host API**, a package of the `kit` layer: browser
  host libraries a plugin builds against, which only extensions and
  composition roots build on. The shell builds on it too, so each piece has
  one home. It holds:
  - the UI points ([UI points](#ui-points-routes-and-views), [Docks](#docks)),
    `ViewSlot` and `CommandPoint`, a command contributed to the shell's
    palette and node menu;
  - `PaletteStepPoint` (`ui.palette-steps`), a picker step a node command
    hands the node palette to (`palette.openStep(id)`, by the contribution's
    namespaced id): its label, placeholder and icon, its candidates, whether
    one may be minted, and its write. The outline's own add-tag, add-field
    and reference steps are its contributions (`outline.add-tag`, …), so a
    family's steps come and go with it and the palette reads no closed list;
  - the primitives and the design tokens;
  - `BrowserHost`, a kernel service the shell provides. Through it a half
    reaches what it would otherwise take from the shell's stores, actions
    and lib: the live graph, the page's one write path (`writes`, the kit's
    `PageWrites`, which `actions/mutations` implements), appearance,
    navigation, panes, the invoke path and the sandbox host. It is a
    subscribe, reads and gestures, never hooks: a hook selected from a
    service at run time is one React cannot check. The sdk's own hooks
    (`useNode`, `useAppearance`, `useFollow`, …) are built over it once,
    with `useSyncExternalStore`. It is also a `NodeTextPort` (tracked graph
    reads, the caret hand-off, the text-host registry), so a half binds a
    `NodeTextHost` with `useNodeTextBinding` through the same body
    (`useNodeTextBindingThrough`) the shell binds its own with, over its
    stores.
  - the page's two ports a projection provides while its plugin is loaded,
    `PageProjectionService` and `PageEditorService` (`lib/page-ports`): the
    projection the graph store tells of each move, and the editor the shell
    lands the caret through. Each is a kernel service, so the page stands
    in one projection, and the shell installs whichever is provided. What
    the page shows of the graph (`shownNodesOf`, over `PageGraphState`) is
    the kit's too, so a projection and the shell read it through one cache.
  - the services one family's half provides for another's, each a key in
    the sdk so neither names the other: `NodeLinkGraphService` (the graph's
    lens graphs, for the lab's Sky) and `ModelCompletionService` (the
    agent's one-shot completion, for the gallery's Enhance). The reader
    injects the key, from a child when the need is optional, so the kernel
    holds the edge, and that child waits, pending, while the provider is
    off. No half calls another family's action by id.

  The sdk never imports the shell's stores. The 3D scene kit is two kit
  packages beside it, for canvas 3D, the lab and the graph's `graph.force3d`
  renderer: `@kb/scene`, which touches no GPU, and `@kb/scene-gpu`, which is
  three, so a 3D host can mount a scene without carrying three itself
  ([The lab](#the-lab)).

- **Every half is a package.** The outline, collections, graph, chart,
  code, agent, lab and canvas halves are `@kb/<family>-ui` packages, so
  `UI_ALLOWS` in `harness/src/constraints.ts` holds the shell's zones only. A half's tests
  hold it to `BrowserHost` through `@kb/ui-test-kit`'s test host, never to
  the shell's stores; the shell's side of the port is tested in `@kb/ui`.
  The outline's tests that drive the page (its store over the shell's graph
  store, the shell's commands and palettes) are the exception: they run in
  `@kb/ui`, under `src/page-tests/outline/`, over `@kb/outline-ui`'s barrel,
  until each is rewritten over the test host: GAP [[01M531QT1YPM9NTF6NKH9BP66S]].
  The graph's are too, under `src/page-tests/graph/`: its page and a node's
  neighbourhood over the shell's graph store, and the 3D light checked
  against the shell's design-system sheets. Its barrel names only what the
  entry already loads, and the light arithmetic, so the page tests pull no
  renderer into the entry's chunk.
- **The lazy fence follows packages.** `UI_LAZY_ONLY` applies to the import
  closure from `UI_ENTRY`, walking into `scope:browser` workspace packages
  too, so a chart page moved out of `app/ui` is still fenced from Vega.

### The lab

The lab (`@kb/lab-ui`, `/lab`) is an off-by-default sketchbook for
real-time 3D: a place to study effects, lighting, polish and motion before
anything reaches a working view. It is the first optional family: off until
a person switches it on, on the server (above).
Its view key, `lab.page`, and the list of its studies are the lab family's
(`@kb/lab`, [DESIGN → Extension families](DESIGN.md#extension-families)).
Its studies are exercises, not product features: a study **may** read the
graph (the Sky's stars are nodes), but it does not have to, and nothing a
study does is a kb milestone. What a study proves graduates into functional
views only through the shared kit — the graph-polish work (wave item g) builds
on the same stage, palette and timing, never on a copy of a study.

Seven studies, each with a collapsible info card naming its technique, the
principles below it applies, and two to four live parameters:

| study  | technique                                                                                                                                                                                                                      | parameters                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Embers | TSL compute: a GPU spatial hash grid, contact heat, pops; bloom; four looks over one heat curve (glow, toon with an inverted-hull outline, ridged-noise molten, thin-film interference); heat haze and ash                     | look, heat gain, cooling rate, pop threshold |
| Sky    | a sun that lights the moon (terminator, phase and earthshine follow where they stand), node stars in a 3D volume (parallax), a domain-warped nebula, orbit controls; four-point glints, dither                                 | glint length, nebula, earthshine, dither     |
| Glass  | sphere tracing a signed distance field: smooth-min metaballs, normals from the gradient, Fresnel, refraction traced through the glass, per-channel dispersion, Beer–Lambert absorption, a studio of light strips and ink cards | blend, index, dispersion, absorption         |
| River  | a GPU curl-noise flow field: 131 072 particles advected by one TSL compute kernel (divergence-free swirl, a meandering current, a pointer vortex, recycling), drawn as velocity-aligned streak sprites                         | current, eddy scale, turbulence, streak      |
| Ocean  | Gerstner waves (steepness summed to at most 1), the analytic normal and a Jacobian foam mask, one sky function read by the dome, the reflections and the distance haze; Fresnel, a subsurface cheat, an HDR glitter path       | waves, wavelength, sun height, foam          |
| Light  | key/fill/rim rig, soft shadows, GTAO, tone mapping, finishes                                                                                                                                                                   | tone mapping, PBR/matcap, AO, key angle      |
| Motion | staggered critically damped springs against an eased tween                                                                                                                                                                     | settle, stagger, drive, overlap              |

Embers keeps its theme rather than forcing a dark stage: on a light ground
the heat ramp moves from the emissive into the surface (`heatAlbedo`: pale
ash warming through the accent's ember to the accent), and only the hot
end's emissive still blooms. A forced dark stage would paint colours no
light-theme `--lab-*` token names (L1); the ramp makes both themes
intentional (P5).

Every study is built from one kit (P4), in two homes. What any real-time 3D
view needs is the **scene kit**, two packages of the `kit` layer:
`@kb/scene` touches no GPU and `@kb/scene-gpu` is three, so a surface's 3D
host mounts through the first and only its lazily loaded scene imports the
second. `@kb/scene` holds `host` (`SceneHandle`, the one interface
every mounted scene meets — sized, paused while the tab is hidden, told of
reduced motion, disposed — and `attachScene`, the one non-React mechanism
that keeps a scene in step with its element and disposes one whose mount
lands after the element has gone; each surface wraps it in a thin React
host of its own, so the kit holds no React), `palette` (the five palette
roles, filled from whichever tokens the caller names), `sphere` (seeded
places on a sphere) and `shade-ops` (the arithmetic a shading formula is
written over once, run as TSL nodes through `@kb/scene-gpu`'s `NODE_OPS` and
as numbers through `NUMBER_OPS`, so a test proves the shader itself: Embers'
heat curve and the 3D graph's node light). `@kb/scene-gpu` holds `screen` (`toScreen`, the
one projection of a world point to canvas pixels, decided in view space;
every label, pick and hover asks it), `pointer` (`PointerField`: where
the pointer is over a scene, where its ray meets a plane, and which presses
were taps — every study and the 3D graph read the one field), `stage` (renderer, post chain, tone
mapping, palette uniforms, frame loop, reveal; optionally a camera's
artefacts after bloom (`lens`: chromatic aberration, an anamorphic streak,
film grain, only where the scene's art is, never on its ground, so the
grain cannot shift the ground's level and draw the frame), a feather along the frame's own sides, a presence knob and a
GPU frame meter, `gpuMs`), `offscreen` (`offscreenPass`: a full-frame
shader drawn into a render target of its own size, optionally reading its
last picture back, which a scene samples as a texture), `tone` (the
shoulder curve and its pre-image), `tsl` (the typed TSL seam
and the ease as a shader function), `rig` (lights and finishes),
`backdrop` (every view's ground, through the stage's `backdrop()`: the
ground pooled at a focal point and falling to the edge colour, plus the
warmth, domain-warped haze and heat shimmer a study asks for — never a flat
fill), `starfield` and `dispose`. The timing vocabulary (the motion tokens,
springs, eases) is `@kb/ui-sdk`'s `lib/timing.ts`, beside `lib/motion.ts`,
because DOM motion reads it too.
What only the lab needs stays in `@kb/lab-ui`'s `kit`: `study`
(`mountStudy`: a study's side of `mountScene`, and the theme hand-off), `palette` (the
`--lab-*` roles), `pan`, `pan-control` and `velocity` (drag-to-turn with
momentum, the pointer's smoothed speed; a press is a pan or a grab of what
it landed on), `orbit` (the pan read as a bearing round a target, plus a
dolly and eased flights), `entrance`
(a study's pieces arriving over the arrive duration, staggered by a lag the
study chooses; already arrived under reduced motion), `seeded` (the one
seeded random a study scatters from), `scene-host` (its React wrapper over
`attachScene`) and `info-card`.
`three` loads only in a chunk of its own: each study's scene and the 3D
graph sit behind a dynamic `import()` inside their surface's own lazy route
chunk, so every path from the entry to a three import, direct or through
`@kb/scene-gpu`, crosses two of them. That is one
rule over the import graph (`UI_LAZY_ONLY` in `harness/src/constraints.ts`,
applied by the harness's `ui-lazy-fence` check), so no surface lists which of
its files may import three.

**The scene contract.** A lab study and the 3D graph are implementations of
one `SceneHandle`, and each is built through the stage's `mountScene`, which
answers the handle from the stage. What the handle promises belongs to the
handle, and one contract suite (`@kb/ui`'s `scene-contract.test.ts`) proves it over
every registered scene — each study in `LAB_STUDIES`, the 3D graph and the
3D canvas, and `@kb/backdrops-ui` runs it over the GPU backdrops:
disposing leaves no live renderer, loop or canvas; a hidden scene draws
nothing; under reduced motion no animation loop runs, and a change draws one
still frame (M7); the device pixel ratio never exceeds 2 (P3); a scene whose
build or reveal fails gives its stage back. The loop that keeps these is the
stage's: it runs while the scene is visible, motion is not reduced, and the
scene's frame reports that something still moves, so a study (always moving)
and the graph (moving while it lays out, flies or fades) share one rule.
Shadows (`StageOptions.shadows`) and ambient occlusion (`ao`) are decided
once, when the stage is built; the rig casts shadows exactly on a stage that
has them. Under occlusion the scene pass is single-sampled: three r186's GTAO
cannot read a multisampled depth texture (fixed in r187), a gap.

The renderer is three's `WebGPURenderer` (T1): WebGPU where the browser has
it, three's own WebGL2 backend where it does not, the same node code
compiling to both. Embers' collision grid needs storage atomics, which the
WebGL2 backend lacks, so that one study needs WebGPU (a recorded gap).

#### Lab principles

Every study follows these. They are the lab's rules, stated here once; a
study's info card cites them by id.

**Motion**

- **M1.** Nothing moves linearly except constant ambient rotation.
  Pointer-follow and settling use a critically damped spring or a
  frame-rate-independent approach (`1 - exp(-k·dt)`, `lib/timing.ts`
  `approachShare`, the one place it is written).
- **M2.** dt is clamped, so a tab switch never causes a jump.
- **M3.** Momentum and follow-through: drags carry inertia and decay;
  secondary elements lag the primary (overlap); stagger is small and
  consistent.
- **M4.** One hero motion at a time. Ambient motion is slow (periods of 8s or
  more) and small.
- **M5.** A visible reaction on the next frame, full settle in roughly
  300–600ms.
- **M6.** One timing vocabulary: durations, the ease and spring settle times
  come from the layer-1 motion tokens in `design-system.css`, which a
  design system restates (Themes); `lib/timing.ts` reads them, and its
  fallback mirror is checked against that sheet. Never retyped per study.
- **M7.** `prefers-reduced-motion` gives a still composition or a crossfade,
  never a half-animation.

**Light and colour**

- **L1.** A limited palette: one hue family and one accent, from the
  `--lab-*` tokens (the accent is `--primary`) through `lib/css-color.ts`.
  Value contrast over hue contrast.
- **L2.** Physically plausible light: a named key/fill/rim rig, a set tone
  mapping (ACES by default; AgX greys a light ground), sRGB output. Bloom's
  threshold is 1 (`BLOOM_THRESHOLD` in `@kb/scene`'s `shade-ops`), so only HDR values
  glow and nothing glows by accident.
- **L3.** Depth cues: fog or atmospheric perspective, size attenuation, and
  falloff at the edges.
- **L4.** No banding in dark gradients: dither (a half-step of noise) in the
  post chain; the vignette is subtle.
- **L5.** A small shared material set with fixed roughness and metalness; never
  three's default grey.

**Composition and polish**

- **P1.** The hero sits at a focal point with negative space around it; the
  edges fade into the ground, no hard canvas edges.
- **P2.** No popping: shaders compile before the first frame is shown, and
  the canvas fades in over the ground.
- **P3.** A loading state, smooth resize, device pixel ratio at most 2,
  antialiasing, a steady 60fps, and no per-frame allocation in hot loops.
- **P4.** Uniformity: every study is built from the one kit; no per-study
  copy of a mechanism the kit owns.
- **P5.** The dark and the light theme both look intentional.

**Technology**

- **T1.** WebGPU plus TSL only: `WebGPURenderer` from `three/webgpu` (its
  WebGL2 fallback is three's, never a hand-rolled second path); every shader
  and compute kernel a TSL node graph (`Fn`, `uniform`, storage buffers,
  `compute()`) on node materials, never GLSL/WGSL strings or
  `ShaderMaterial`; post-processing a TSL graph (`RenderPipeline`, `pass()`,
  `bloom()`, tone mapping, dither); the info card's parameters drive TSL
  `uniform()`s. Where three's TSL typings are looser than the nodes, the one
  typed seam is `@kb/scene-gpu`'s `tsl.ts`. Plain CPU arithmetic that feeds instance data
  (the Motion field's springs) is not a shader and stays TypeScript. TypeGPU
  or raw WGSL only where TSL cannot express the thing, recorded as a gap.

Enforcement is honest, and split across two `#rule` nodes. The measured
bounds — the timing mirror and the principle bounds on the timing tokens
(follow 300–600ms, ambient period 8s+), the Embers pop budget, and T1's
fallback (each study on WebGL2 without WebGPU, or saying why it cannot
start, in the render suite) — are tests; the lazy three chunk is the
harness's fence above. Everything else here is prose, and its rule says so.

### The gallery

The gallery (`@kb/gallery-ui`, `/gallery`) is a visual composer over a
library of references: it helps a person find references and articulate
the image in their head, whichever way they come in. The library is a
structured Pinterest of one's own: styles, shots, camera angles and
motions, lenses, lighting, palettes, artists, each a node, and the images
that show them. It is optional and off by default. The model and the
reasons are two research records: the library,
[docs/research/2026-10-28-visual-reference-gallery.md](docs/research/2026-10-28-visual-reference-gallery.md),
and the ways in,
[docs/research/2026-10-30-visual-composer.md](docs/research/2026-10-30-visual-composer.md),
which also lists the workflows judged and not built.

- **Ways in are workflows, and a workflow is a view.** A workflow is a
  view of the family `gallery.workflow` (`WorkflowKey`, `@kb/gallery`):
  its key carries the question it answers (where the person is coming
  from), its steps, and the tags it reads and writes. The page lists the
  workflows provided (`familyViews`), in their pickers' order, and draws
  the chosen one through a `<ViewSlot>`; another family adds a workflow by
  providing a view of the family from its own UI half. What a workflow
  works on is the host's, not config: the library, the look being made
  and the services the page has travel in the `ComposerFrame` context, as
  a graph renderer's frame does. A workflow's params name what it starts
  from (`from`, a node id), so `/gallery/<workflow>/<id>` opens a
  workflow on a visual, a look or any node.
- **Opening `/gallery` asks where the person is starting from.** The
  chooser lists the workflows by their questions and the looks made so
  far. The family's first two, the two the gallery is for (I know what I
  want; help me articulate it), are drawn large with their steps, and
  the rest under "More ways in", each naming what it reads and makes; the
  last workflow chosen on this device is offered first, and large. A look
  carried on, or a new one, replaces unsaved work only when the person
  says so. Each
  workflow page carries the same choice as a row of tabs, so a person can
  change their way in without losing what they have made.
- **Every workflow makes one thing: a look.** A look is a node tagged
  `#look`: its `description` (the brief, and the composer's subject), its
  `styles`, its `negative`, its `palette` (hex swatches), its pins (child
  nodes whose text is the note and whose `reference` is the visual), the
  node it is `for`, and its moodboard (a child `#canvas`). The page holds
  one draft look, shared by every workflow, and the look panel beside the
  workflow edits it: the description, the chosen styles by facet, the
  prompts per model family (read from the look by the composer's rule,
  never stored), Enhance, the palette, the pins and their notes. Saving
  writes the look; a saved look reopens as the draft. A look opens as a
  moodboard, and exports through one contract (`LOOK_EXPORTS`, each entry
  a label, what its file is named after the look's name (`exportFileName`),
  and a rendering of the look), offered by one picker
  to copy, download or preview: the brief for a person (`briefOf`), and
  the 3D art direction a builder follows (`artDirectionOf`). The art
  direction writes each chosen style under its facet with its notes (what
  it looks like, what it is made with, where it is seen, how to make it
  per tool), and every style a chosen one is made with, however deep,
  under its own facet and marked with the style that calls for it; then
  the palette, what to avoid and the references. It is for building, so
  it holds no image model's prompt, and a look with no styles has none.
- **The moodboard is the canvas family's, through a declared need.** The
  canvas family's page half provides `BoardService` (`@kb/ui-sdk`): a
  board under a node, and a card placed on it for each node not yet there,
  with the node's picture beside it. The gallery's `moodboard` child
  injects it and offers the look's moodboard at `MoodboardPoint`; while
  canvas is off the child pends and the look panel says the moodboard
  needs the canvas and where to switch it on. A pin's card shows the pin
  node, so a note edited on the board is the note in the look.
- **The palette is extracted in the browser** from the look's pins
  (`paletteOf`, `@kb/gallery`: a median cut over the pinned images'
  pixels, drawn small on a canvas element), so it costs nothing on the
  server and nothing until a look has pins.
- **On a phone** the workflow and the look are two panes under the
  workflow's tabs, and a workflow that has panes of its own (Browse:
  visuals, facets, sources) shows them one at a time.

- **Everything in it is a node.** A visual is a node tagged `#visual` whose
  `media` field embeds its image (`![…](assets/…)`, so it renders as node
  text does) and whose `styles` field refers to the styles it shows. A style
  is a node tagged `#style`; its facet is the nearest ancestor tagged
  `#facet`, a reading of structure, not a field, so moving a style re-files
  it everywhere. A style's `prompt` and `negative` are templates; one with
  no template composes as its name. A style also carries what a builder
  reads: its `description` (what it looks like), what it is `made with`
  (other styles, so "cel-shaded" names its toon ramp and outline), the
  works it is `seen in`, and `how to` make it, one value per tool (Three.js,
  Blender, Godot). The starter's 3D facets (3D style, presentation,
  projection, rendering technique, and 3D setups under Lighting) carry all
  of them. An online source is a node tagged
  `#image source`, with a `search url` (`{query}` stands for the query)
  and a `source kind`. The family seeds the tags, the fields and sixteen
  sources, image and 3D; the page offers a starter, which the server adds
  (`ext.gallery.starter`; `starter.ts` in the server half: facets of
  styles, and a `Library` that becomes where saves go, the gallery's
  `save into` setting), so its vocabulary is never in a page's download.
  The library starts with a dozen
  public-domain works (`starter-visuals.ts`, beside it: Hokusai to
  Dorothea Lange, from Wikimedia Commons, credited with their pages) and
  one scene rendered in fourteen of the 3D styles (kb's own, CC0, made by
  the three.js scene in `docs/research/assets/2026-10-31-3d-styles/`), each
  filed under the starter's styles it shows, so Browse and Remix have
  something to work on from the first minute. Each carries its bytes in
  source, so a release's one bundle carries them and a page never does.
- **The page reads its replica, never the store.** `libraryOf`,
  `filterVisuals` and `facetCounts` (`@kb/gallery`) are pure over the node
  set, so a facet click is a pass over memory: about 70 ms at fifty thousand
  visuals where the same counts as datalog take 750 ms (research record §7).
- **Facets filter by OR within a facet, AND across**, and count
  disjunctively: a style's count is over the visuals every _other_ facet's
  choice lets through, so choosing within a facet never zeroes its siblings.
- **The grid is a virtualised masonry.** Tiles go, in order, into the
  shortest column, at the aspect the visual records (`width`, `height`;
  square when it records none). Only the tiles within one viewport of the
  window, either way, are elements; the window's tiles are found per column
  by binary search, so a scroll frame costs what it shows, not the library.
- **The gallery's workflows**, each a view of the family, in the tabs'
  order:
  - _I know what I want_ (`know`): a term typed is completed from the
    style library at the start of a word ("toon" finds "toon ramp", not
    "cartoon"), each suggestion named with its facet, then the styles made
    with those, named with what they are made with ("cel-shaded, with toon
    ramp"); a suggestion's description shows on hover, as it does on a
    facet's styles and the look's, and Enter takes the first; a word the library lacks joins the brief or becomes a style
    under a facet (`addStyle`), so the library grows as it is used. The
    references that show every chosen style appear beneath, or, when none
    does, those that show the most (`nearest`).
  - _Help me articulate it_ (`articulate`): start from words and pictures
    dropped or pasted (kept as assets); Reflect asks the model to break it
    into axes (`axesOf`: subject, mood, lighting, camera and lens, palette,
    era or style, artists, composition, motion, each reading the library's
    facets by name, and a facet no axis names is an axis of its own), and
    each axis offers chips drawn with an example picture (`examplesOf`), a
    new word dashed. With no model, every axis offers its styles to pick by
    hand. Then react: references nearest the look to like (pin it and take
    its styles), refuse (offer less like it) or take one axis from (its
    styles on that axis, pinned with that note), and either/or cards, two
    styles of an axis the look has nothing in (`eitherOrs`).
  - _I have a picture_ (`reference`): one visual (`from`), picked or
    dropped in; its styles as chips, the model's reading of the picture
    (read as it opens when the person's model sees, which the completion
    says without asking a model, and on asking otherwise), more like it (`moreLike`, by shared styles), and its
    variations along one axis (`variationsOf`), each a whole look.
  - _Browse my library_ (`browse`): the virtualised grid beside one column
    of facets or online sources, and an open visual's detail in their
    place; in a narrow viewport the grid is a pane of its own under the
    same tabs.
  - _I found something_ (`capture`): a picture dropped, pasted or chosen
    is kept through `asset.upload` and becomes a visual with no styles. An
    https link to a picture is fetched by the server
    (`ext.gallery.capture`), but only from the image hosts its server entry
    lists, and those of its search sources (`captureHosts`), and becomes a
    visual whose `source` is the link; a link to any other host is refused
    and kept as a link alone, a visual with no media, which the page says.
    Untriaged is a visual with no styles,
    read, never stored. Triage shows one at a time: a type-ahead over the
    styles that gives a style to the visual itself, a pin to the look, and
    Next (Enter takes the first suggestion; ArrowRight or `n` moves on).
  - _Mix what I have_ (`remix`): two or three sources, visuals or saved
    looks, laid out one axis at a time with a choice per axis of whose
    styles to take; "Make the look" takes the union and pins the visual
    sources, each noted with the axes taken from it. Varying one look along
    one axis is the same move with one source (`variationsOf`).
  - _It is for something in kb_ (`node`): a node opened on or found by its
    text becomes the look's `for`, so its backlinks show its art
    direction; its words fill an empty brief, its looks can be carried on,
    and the workflow hands on to Articulate or Compose.
- **The look's styles are the selection.** Browse filters by them and
  Compose shows their references (`referencesOf`): every visual while the
  look has none, the ones that show all of them, or, when none does, the
  closest, the ones that show most of them, said to be so, never an empty
  grid. The prompt composes them: in facet order,
  they wrap the look's brief by A1111's rule (`{prompt}` in a template is
  replaced; a template without it is appended) for one model family; a
  family that reads no negative prompt gets none. The composition is tidied
  as a person pastes it: an empty brief leaves no dangling comma, and a
  part several styles add is kept once. A visual's "Add its styles" adds
  them to the look.
- **The model is asked through a declared need.** The gallery's `model`
  child injects `ModelCompletionService`, which the agent's half provides
  over its `ext.agent.complete`, and offers the composer's model at
  `ComposerModelPoint`: Enhance, Reflect and "Ask your model" use it.
  Whether the model sees is the completion's to say (`sees`, over the
  agent's `ext.agent.sight`, which reads the provider and asks no model).
  Reflect sends the person's pictures as asset paths, as many as the
  completion says it takes (`ModelCompletion.pictures`); the reply says how
  many the model saw, and a model that cannot see is sent the words alone,
  which the page says. A request with pictures that fails is asked again,
  by the composer's model, with the words alone, and the page says why the
  pictures were not read. Enhance sends the
  prompt as the message and a system prompt for the family
  (`enhanceInput`, `@kb/gallery`: an instruction-LLM's role, how that
  family reads a prompt, whether it reads a negative, and the rewrite
  alone as the answer), and shows the reply as an editable prompt of its
  own, with its Copy and "Use as brief", while the composition it was made
  from stands. While no family provides a completion (the agent off, or no
  `kb ui` to host it) the child pends and each use stays, dimmed: its title
  and a tap say that it needs the agent and where to switch it on. The gallery holds no
  model client and names nothing of the agent family; a failed completion
  is a toast, with its reason.
- **Online sources keep their terms.** A link source (Pinterest, Are.na,
  Unsplash, Lexica; for 3D, ArtStation, Shadertoy, Godot Shaders, Blender
  Studio, Blender Artists, BlendKit, YouTube) is its search page opened in
  a new tab; kb never calls it. An API source (Civitai, Openverse;
  Sketchfab, Poly Haven, the three.js examples) is searched through
  `ext.gallery.search` (`@kb/gallery-net`), PG only. A source that
  publishes a catalogue instead of a search (Poly Haven, the three.js
  examples) is read for the query by its adapter: an entry matches a word
  of the query that begins one of its own words, the entries matching most
  first, and one that matches none is left out. A result is kept
  through `ext.gallery.save`, which downloads it only from hosts the source's
  adapter names, over https, through at most two redirects, and then writes
  only through core's `asset.upload` and `node.add`, with the result's page,
  creator and licence on the visual. A source's answer is remote text, so
  every adapter's results are held to one rule (`admitted`): the image and
  the thumbnail the page shows on the adapter's hosts, and the page it
  links over https, each as a request would be sent. A search drops a
  result that breaks it, and a save refuses one before it fetches.

### Locations

The locations family's browser half (`@kb/locations-ui`; the model is
DESIGN.md → [Locations](./DESIGN.md#locations)). It contributes no view and
no route, only a sidebar section and a command, and it loads while the server
reports the family on.

- **The Locations section** sits below Pinned (`order: 110`) and draws the
  rows `location.list` answers, in its order: pinned first, then most
  recently opened. The current root is the active row; every row carries a
  dot for its status (`served` success, `closed` faint, `missing` and
  `not-a-store` warning, `broken` destructive), named for assistive
  technology.
- **Opening is navigation.** A click runs `location.open` and goes to the URL
  it answers in the same tab (`location.assign`); ⌘-click (Ctrl-click) goes
  there in a new tab. The tab is opened before the call, while the click
  still counts as the person's gesture, and closed again when the open is
  refused, which is shown as a toast. The section hears the click through
  `SidebarRow`'s `onClick(event)`.
- **A row that cannot be opened says why.** It is muted, and an indented
  "Forget · <reason>" row under it runs `location.forget`. Re-pointing it is
  a field edit of its path in the home store, not a gesture of the section.
- **The section never breaks the page.** A home store that cannot be read,
  or a page no server answers, is one muted row, "Locations unavailable",
  with the reason; a warning (no home store yet) is one muted row.
  Clicking either reads the list again, as regaining focus does, since the
  servers it reports start and stop outside this page.
- **⌘K "Open location…"** is the `sys.command` node the family seeds. It
  opens the home store, whose own page lists every location here.
  Listing the rows inside ⌘K waits on a palette step a command can hand a
  list of choices to (GAP [[01M53VP7RKJG53B305MM26AYVG]]).

## Design tokens

A whole design system (colour, type, faces, weights, radius, elevation,
border width, density) can be swapped by redefining one set of custom
properties. Components never carry a raw value, so nothing has to be edited
beside that set.

### Layers

| layer              | file                                                                                   | holds                                                                                                                                      | may name    |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1. design system   | `ui/src/design-system.css` (the default); each contributed system's sheet (the others) | the values a skin chooses, as plain custom properties, with the colour overrides for dark                                                  | values only |
| 2. bridge          | `ui/src/index.css`, `@theme inline`                                                    | the mapping from layer 1 into Tailwind's namespaces (`--color-*`, `--text-*`, `--font-*`, …)                                               | layer 1     |
| 3. component roles | `ui/src/tokens.css`                                                                    | row metrics, and the classes that compose layer 1 into a role (`.kb-text` is body text at the body step, `.kb-tag` a chip at the tag step) | layer 1     |

Components use layer-2 utilities (`text-meta`, `bg-popover`) and layer-3
classes (`kb-text`). The bridge is `inline`, so every utility compiles to a
`var()` of a layer-1 property rather than a copy of its value: redefining the
property on another selector re-skins every utility that reads it, at run
time, with no rebuild.

For every namespace kb owns, the bridge first resets Tailwind's defaults
(`--text-*: initial`). The only steps that exist are then the design
system's. A Tailwind default such as `text-sm` does not compile at all, so it
cannot pass as tokenized while bypassing the scale.

### Design systems

A design system is one complete set of layer-1 values, with a light and a
dark variant. Which systems exist is a plugin point: core contributes its
default, families contribute the rest, and the page names none of them.
kb ships six; the last three are whole themes (Themes, below):

| id                 | from                  | character                                                                                                                                                                                                                                                            |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kb` (default)     | core                  | the nxus palette: neutral grounds, a warm amber accent, Inter, 8px corners                                                                                                                                                                                           |
| `themes.paper`     | the themes family     | warm off-white and ink, an ink-blue accent; the platform serif (`ui-serif`, New York on macOS, so nothing is downloaded); 5px corners, 0.5px hairline borders, soft low shadows, density 1.08. Dark is warm charcoal                                                 |
| `themes.terminal`  | the themes family     | dark-first phosphor green on near-black; one monospace face throughout, a type scale half a step smaller to suit it; 4px corners, density 0.875, and elevation drawn as an accent outline and glow rather than a cast shadow. Light is green ink on white            |
| `zzz.theme`        | the ZZZ family        | after Zenless Zone Zero: a near-black street, lime and yellow; Archivo in black narrow italic capitals for titles and a wide italic strip for labels; bevelled corners, 2px outlines, hard offset sticker shadows, leaning chips; a jelly spring. Light is newsprint |
| `transistor.theme` | the Transistor family | after Transistor: a teal Cloudbank night, ivory ink, cyan with magenta, red and gold; Marcellus SC titles, amber Share Tech Mono labels, Jost text; scooped corners, elevation as a cyan glow; a slow, deliberate settle. Light is Cloudbank by day                  |
| `yorha.theme`      | the YoRHa family      | after NieR:Automata: light-first warm beige paper, khaki ink, a rust accent; Barlow text, Barlow Condensed capitals for titles and labels; square corners, flat ink offset blocks; mechanical motion with no bounce, a glitch on failure. Dark is a khaki night      |

- **The point.** `DesignSystemPoint` (`ui.design-systems`, `@kb/ui-sdk`,
  beside `BackdropPoint`) holds one `DesignSystem` per contribution: its
  `key` and its `stylesheet`.
  - The key is the system as its declaration names it (`SeedOption`: an id,
    `<family>.<local id>`, and a label). `provideDesignSystem` contributes
    it under the key's local id, so it answers to the declared id, as a
    backdrop does. Core's key, `kb`, has no family part: core contributes
    it in the root namespace.
  - The stylesheet is the CSS the page adds to paint it: exactly two
    blocks, under its own id.

    ```css
    [data-theme="themes.paper"] {
      /* every layer-1 value: base and light colours */
    }
    .dark[data-theme="themes.paper"],
    .dark [data-theme="themes.paper"] {
      /* the colours layer 1 varies in dark */
    }
    ```

    The default's stylesheet is empty: it is layer 1 itself.
    `design-system.css` declares its values on `:root, [data-theme="kb"]`
    and its dark set on `.dark, .dark [data-theme="kb"]`, so the default's
    two blocks are layer 1's own.

  - No renderer reads a value off a contribution. Canvas and WebGL
    renderers copy token values out of the computed style, and re-read
    them on the one appearance signal (see Radius, borders, faces, colour →
    _Canvas renderers re-read on one signal_). A change of system is an
    appearance change like light and dark, so the point carries no
    per-system values beside the sheet.
- **The painter.** `stores/design-system.store.ts` is the one owner of
  `<html data-theme>` and of the systems' sheets on the page.
  - It adds every contributed system's sheet as a `<style>` element
    (`data-design-system="<id>"`) after every sheet already on the page.
    The bundle's own stylesheet comes first, so a system's base block beats
    layer 1's `:root` and `.dark` (equal specificity, later source), and its
    dark block beats both (higher specificity).
  - It adds every sheet, not only the chosen one, because each option's
    swatch is a live sample of its system. The selectors are
    attributes, not `html[…]`, so the same blocks paint any subtree that
    carries the attribute.
  - A system whose plugin unloads takes its sheet with it, and a page it
    painted falls to the default.
  - It sets `data-theme` to the system shown, and crossfades a change like
    a theme change, whoever writes the choice.
  - It records what it painted, the id and its sheet, in
    `localStorage["kb-design-system"]`. A blocking script at the top of
    `<body>` in `index.html` paints that record before first paint, so a
    non-default system does not flash the default while the page boots and
    the graph loads. The script sits in `<body>` so that its sheet lands
    after the bundle's stylesheet, as the painter's does; the painter
    adopts the element. The record is derived from the last paint, and is
    never read as the choice.
- **A design system is declared, and its option is derived.** A family
  lists its systems' keys on its declaration, as declared options of the
  design-system kind (`declaredOptions`, `DESIGN_SYSTEM_OPTIONS`). The seed fold derives one option node per key under
  `sys.f.design-system` (`designSystemOptionId`), in declaration order and
  owned by the family (DESIGN.md → Extension families → Declared options).
  Core declares its default (`KB_DESIGN_SYSTEM`, `@kb/operations`). A
  contribution whose key no declaration lists has no option, so it cannot
  be chosen.
- **kb's other systems are families'.** The `themes` family
  (`@kb/themes`, `@kb/themes-ui`; optional, on by default) declares and
  contributes Paper and Terminal, sheets under its `src/design-systems/`.
  A whole theme (Themes, below) is a family of its own, one per theme:
  `zzz` (`@kb/zzz`, `@kb/zzz-ui`), `transistor` and `yorha`, each optional
  and on by default. Each declares its system, `<family>.theme`, and the
  page heads it brings under their local names (`zzz.broadcast`,
  `yorha.arena`), with `themeSystem` and `themeBackdrop` (`@kb/model`), so
  every theme's options have one shape; its browser half holds its sheet
  (`src/<family>.css`), its faces and its art (`src/art/`), drawn with the
  art kit `@kb/theme-art` (`useBeat`, `useGesture`, `deferred`, `band`),
  which knows no theme. Switched off, a family takes its systems and heads
  and nothing else; the page offers the default and whatever another
  family contributes.
  - **The themes were one family's once.** ZZZ, Transistor and YoRHa were
    the themes family's, under `themes.*` ids. Each theme family retires
    its old ids (`retires`, `retiredOption`; DESIGN.md → Extension
    families → the seed retires what it renames), so a store whose core
    node chose `themes.yorha` chooses `yorha.theme` on open, and a page
    head that chose `themes.arena` chooses `yorha.arena`.
  - **Version skew.** `.kb/nodes.jsonl` is committed and hosts pin
    different releases. An older build re-seeds the old option nodes (the
    seed adds what is missing) but writes no choice: core's choice names an
    option it does not declare, so it shows the default, as any choice
    nobody contributes does. The next newer open retires the re-seeded
    nodes again, and a store merged with a clone that still holds them
    converges the same way. Alternating builds on one committed store churn
    the file (the old nodes added, then retired); that is the cost of never
    rewriting a choice, and it ends when every host runs a build with the
    rows. `bundled/tests/theme-families.test.ts` holds all three cases; the
    theme-family contract (`app/ui/src/theme-family.contract.test.ts`)
    holds every theme family, and a test one, to its rows, its pairing and
    switching off alone.
- **The choice is core's setting.** Which system paints the page is a
  setting of core's node (`sys.extension.core`), since the page is core's
  and names no system. Core seeds the field, `sys.f.design-system`: it
  configures core, takes one value, and is a ref to one of its children,
  the declared systems' options.
  - The choice is read by `designSystemChoice` (`@kb/model`, `declaredChoice`
    over the design-system kind) and resolved against what is contributed
    by `shownDesignSystem` (`@kb/ui-sdk`). Where core's node chooses
    nothing, or a system nobody contributes now, the page shows the first
    contributed, which is core's default, since core's plugins load before
    every family's.
  - **Why a setting, not a preference.** A design system is a contributed
    option, as a backdrop is, so it is chosen the way a backdrop is: one
    choice mechanism for a thing a family declares. A choice made in one
    tab, on another device or by the CLI (`kb set`) paints every page of
    the knowledge base, and the option list is the field's own children.
  - **Light, dark and system stay device preferences** (`theme` in
    `kb-prefs`). `system` follows the OS, which a graph value cannot, and
    the right variant depends on the room the device is in, not on the
    knowledge base. Width stays one too.
  - **A page has no choice of its own.** Unlike a backdrop, the system is
    read from core's node alone: a design system skins the whole page,
    chrome included, not one node's head.
  - The choice was a device preference once (`designSystem` in
    `kb-prefs`), and before that the UI face was one (`font`). A stale key
    is ignored on read and dropped on the next write. A device that held
    `paper` or `terminal` holds no option of the field, so it shows the
    default until the setting is written.
- **The field is drawn as any field is.** The Settings page draws core's
  design-system field with the page's field editor, as it draws the
  backdrop's, and core's node shows the same field row. Its kind previews
  at card size, so the editor lays it out as a gallery (Option galleries):
  each card a small page carrying `data-theme`, so the system's own sheet
  paints its ground, ink, accent, faces, radius and border, with what the
  theme brings under it. At chip size the preview is a swatch, at rest and
  in the picker wherever the field is drawn value-only. The palette's
  _Switch design system_ command (`sys.cmd.switch-design-system`) steps the
  setting through the contributed systems from the one shown, and wraps
  (`chooseDesignSystem`).
- **The contract** (`app/ui/src/design-system-point.contract.test.tsx`)
  runs over every contributed design system: core's default, the page's
  families' and one from a test plugin, whose sheet restates layer 1 under
  its own id.
  - Each system answers to its declared id, and the seed holds its option,
    labelled, under the design-system field.
  - Its sheet holds only its own two blocks, and with layer 1 its id names
    exactly one base block and one dark block.
  - _Completeness_: it restates every token layer 1 sets, in every variant
    layer 1 sets it. Two exceptions, and only these: **shared** tokens (the
    JSON Canvas presets, `--canvas-color-*`, are document colours — a card
    saved as red is red in every skin — so no sheet may set them) and
    **derived** tokens (a layer-1 value that is only `var(--other)`, such as
    `--lab-accent`, follows that token and is inherited unless restated). A
    sheet sets no token layer 1 does not.
  - Every layer-1 token resolves for it in light and in dark, and every
    colour among them parses.
  - The painter adds its sheet after the page's own; choosing it, by core's
    setting or on the Settings page, paints the page in it and names it in the
    appearance; a stale choice, or its plugin unloading, paints the default.
  - A rejecting case for each check holds the checks to failing: a missing
    token, a block under another id, a shared or unknown token, a colour
    that does not parse.
- **Guards over the same list** (each reads the contributed systems through
  `test-support/design-systems.ts`, which loads core's plugin and the
  families on by default into a kernel of its own, so a family's new
  system is checked with no list to update):
  - _contrast_ (`lib/design-systems.test.ts`): for every system and
    variant, each text/ground pair (foreground on background, card,
    popover, secondary, accent, muted and sidebar surfaces; muted text; the
    accent as link text and as a fill; destructive and warning text; lab
    ink on lab ground) meets WCAG AA for body text, 4.5:1, computed from
    the oklch values in the sheets. There is no exception list: a pair
    below AA fails. The same bound holds on the grounds the UI composes:
    every element holding text is read from the JSX (classes split by
    Tailwind's scanner), its ancestors' and its own `bg-*` tints are
    composited in sRGB over each page surface, and its opaque text colour
    is measured on each result — `text-primary` on `bg-primary/10`, a link
    in a selected row's stacked tints. What a class paints is what Tailwind
    compiles it to, and a colour class that paints no design-system token
    (a palette value such as `text-amber-600`) fails. Content one component
    mounts into another's element is declared in the guard's `MOUNTS`.
    Secondary text is solid: `--muted-foreground`, and the lighter
    `--faint-foreground` (a placeholder, a hint, a count, a field's label, a
    faded row), both held to AA on the background, popover, sidebar and
    their tints. Text still set in translucent foreground is not yet checked
    (gap `01M3BEJDX4YP2DPHSCFS66NZK1`).
  - _tag chips_: a tag colour is data, so a chip paints inline styles that
    no class walk sees. The guard evaluates what `tagChipColors` returns
    (`color-mix()` in oklab, `var()` resolved per system and variant) for
    every `TAG_PALETTE` entry on every page surface, at 4.5:1. The ink's
    pull toward `--foreground` is each system's `--tag-ink-mix`.
  - the lab's bloom bound (`lab-heat.test.ts`) and the 3D graph's light
    bound (`force3d-light.test.ts`) run over every system's accent and ink
    in both variants.
  - In a real engine (`design-system.e2e.ts`), choosing each system the
    field's picker offers paints the root as the chosen value's own
    swatch, no two alike, and the choice survives a reload.

**Adding a design system:**

1. Declare its key on the family's declaration
   (`declaredOptions: [{kind: DESIGN_SYSTEM_OPTIONS, options: [...]}]`), as
   `<family>.<local id>`.
2. Write its sheet under the family's `src/design-systems/` with the two
   blocks above. Start from a copy of the default's values: the contract
   names every token still missing, and the contrast guard every pair
   below AA.
3. Contribute it from the family's page plugin:
   `ctx.contribute(DesignSystemPoint, provideDesignSystem(key, { stylesheet }))`,
   the sheet imported as text (`./design-systems/<id>.css?raw`).
4. Look at it: every surface in both variants, the graph renderers and the
   lab included (they read the same tokens).

Nothing else changes: the seed derives its option, and layers 2 and 3, the
components, the painter, the picker and the command all follow the point
and the tokens.

### Themes

A theme is a design system that goes past colour: its own faces for titles
and labels, its own shapes, its own motion, its art, and the page-head
backdrop it pairs with. There is no second mechanism for it. Everything a
theme sets is layer 1 or the design system's contribution, so a theme is
added, chosen, painted and checked exactly as Paper is (Design systems,
above). What each of kb's themes is after, and where each idea lives, is
`ART-DIRECTION.md` at the repository root.

- **Layer-1 tokens a theme restates.** Layer 1 gives each the default's
  value, so a system that wants nothing new restates the default and looks
  as it did.

  | token                                                                                                                                                                                                    | says                                                                                                                                                                                                                                                                                   | read by                                                                                 |
  | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | `--app-font-display`, `--display-style`, `--display-case`, `--display-tracking`, `--display-variation`                                                                                                   | the display face: page titles, the brand, a view's name                                                                                                                                                                                                                                | `.kb-display` (`tokens.css`)                                                            |
  | `--app-font-label`, `--label-style`, `--label-tracking`, `--label-variation`                                                                                                                             | the label face: small uppercase section labels                                                                                                                                                                                                                                         | `.kb-label`                                                                             |
  | `--label-ink`                                                                                                                                                                                            | the labels' glyph ink: `currentcolor` by default; a system may paint every label one ink (Transistor's amber terminal text)                                                                                                                                                            | `.kb-label`                                                                             |
  | `--palette-mark`, `--palette-bar`, `--palette-bar-width`                                                                                                                                                 | a mark before the command palette's input (a `content` string) and a bar after it (a `background`, filled in eight steps as the palette opens); none by default                                                                                                                        | `.kb-palette-mark` (`command-palette.tsx`)                                              |
  | `--scrim-filter`                                                                                                                                                                                         | a backdrop filter a modal's scrim adds to its blur (Transistor's colourless frozen world); `saturate(1)` by default                                                                                                                                                                    | `.kb-scrim`                                                                             |
  | `--art-chrome`, `--art-scrim`                                                                                                                                                                            | `background` layers drawn over the chrome (header, sidebar, a view's bar; each layer may say how it is placed or attached, e.g. `fixed` to the window, and the bar keeps its own colour) and a `background-image` over a modal's scrim; `none` by default                              | `.kb-chrome`, `.kb-scrim`                                                               |
  | `--corner-shape`                                                                                                                                                                                         | CSS `corner-shape` of every rounded utility but `rounded-full` (`round`, `bevel`, `scoop`); a browser without it draws round corners                                                                                                                                                   | `index.css` base                                                                        |
  | `--chip-skew`                                                                                                                                                                                            | the lean of a tag chip                                                                                                                                                                                                                                                                 | `.kb-tag`                                                                               |
  | `--selection`, `--scrollbar-thumb`                                                                                                                                                                       | the tint of selected text and of a scroller's thumb, each mixed with transparency by the shell; `--primary` and `--foreground` by default (derived, so a system restates them only for a colour of its own: ZZZ's lime highlighter, Transistor's gold by day and sword-light by night) | `::selection` and the scrollbar rules (`index.css`, the scroll region's thumb included) |
  | `--motion-settle`, `--motion-spring`, `--motion-duration-{quick,enter,reveal,theme,arrive,follow}`, `--motion-stagger`, `--motion-ambient-period`, `--motion-enter`, `--motion-reveal`, `--motion-alert` | the motion personality: the ease (a cubic-bezier, which `lib/timing.ts` parses), the spring (any easing, `linear()` included), the durations, an ambient loop's least period, and which keyframes a surface's entry and a page's reveal play                                           | `motion.css`, `lib/timing.ts`, the art                                                  |

- **One gesture vocabulary.** `motion.css` keeps the gestures and their
  keyframes; a theme only picks among them. A surface entering (a popover,
  the palette, a toast; `.kb-surface-enter`) plays `--motion-enter` on the
  spring, a page's content arriving (`.kb-workspace-reveal`) plays
  `--motion-reveal`, and a failure arriving (an error toast,
  `.kb-alert-enter`) plays `--motion-alert`, which is `--motion-enter`
  unless a system says otherwise. Shipped: `kb-surface-enter` and
  `kb-workspace-reveal` (the default's), `kb-enter-sticker` and
  `kb-reveal-cut` (a slap and a flash), `kb-enter-turn` and `kb-reveal-turn`
  (a grey frame warming into colour), `kb-enter-scan`, `kb-reveal-scan` and
  `kb-alert-glitch` (a mechanical wipe, and a glitch on failure), and
  `kb-palette-bar` (a bar filling in steps). Every keyframe moves transform,
  opacity, filter or a small element's clip only.
- **The art slot.** A `DesignSystem` may carry `Art`, a component
  (`ThemeArtProps`: its `plane`, what the owner is doing as a backdrop is
  told it, `PageActivity`, and a path). The shell names no system: it
  renders `ThemeArt` as the `ground` plane under everything it draws, the
  `veil` over everything (DockHost included), and a `pane` plane over each
  pane, given that pane's own path. `ThemeArt` draws the art of the system
  shown and of no other, in a `contain: strict`, `pointer-events: none`,
  `aria-hidden` box that is a size container (art sizes its gestures in
  `cqw`/`cqh`, so one fits the pane it plays in); a system with no art draws
  nothing. Neither its planes nor a page-head backdrop are ever selected as
  text (`index.css`): a drag across the page takes its words, not the art's.
  - The ground is ambient: it sits under opaque surfaces, so it shows only
    where the chrome lets it, and stays faint (a few percent of ink).
  - The veil and the pane planes are for passing gestures only, and hold
    nothing at rest: a structural write plays on the veil, a page change on
    the plane of the pane whose page changed and nowhere else. A pane's path
    is its own, so moving the focus between panes (which rewrites the URL
    and nothing else) changes no pane's path and plays nothing. A gesture
    keyed on a change never
    plays on arrival: a boot, its redirects and switching to the system are
    not events (`useBeat`, `@kb/theme-art`). Typing is not a write: the
    art leaves alone every write made while a node is edited, and the text's
    last save, which lands just after the editor closes (`useBeat`'s
    `hold`, given `editing`).
  - Nothing restarts. An ambient loop keeps one clock for the life of the
    page head: editing may resume a paused loop or fade a layer in, never
    change a running animation's name or duration (which jumps or replays
    it), and a re-render on a keystroke changes no key or class.
  - A gesture is gone by `THEME_GESTURE_MAX_MS` (`@kb/ui-sdk`) whatever
    becomes of its animation: a hidden tab, an animation cancelled or held
    on a frame, reduced motion turned on midway. However fast the pages
    change, the veil draws what one change draws, one at a time: a change
    that comes while a gesture plays is merged into it, which carries on
    rather than replaying from its start (`useGesture` in `@kb/theme-art`
    removes it on `animationend` and on a timer, whichever comes first).
  - Art paints with tokens alone (the chart palette is a theme's art
    palette), mixing in `oklab` so a colour never swings through another
    hue against a near-neutral ground.
- **A theme's backdrops, and its pairing, are data.** A declared option may
  choose other declared options (`SeedOption.chooses`: a kind and an id),
  and the seed writes each as a ref on the option's node, in the field of
  that kind (`chosenProps`). So a theme's option node carries the backdrop
  it pairs with in `sys.f.backdrop`, and each backdrop's option node the
  theme it belongs to in `sys.f.design-system`; kb's actions read them, and
  a write changes them. A theme may bring several backdrops, each
  contributed through `BackdropPoint` as any backdrop is.
  - The page head resolves the backdrop from the page's node, then core's
    setting, then the shown theme's option node (`usePageBackdrop`,
    `backdropChoice`), so an explicit choice in Settings still wins: a
    pairing is a default, not a lock.
  - The backdrop field tags each backdrop with the swatch of the theme it belongs
    to, and marks the shown theme's pairing `default` (`BackdropThemeTag`,
    the backdrop field's option preview, which core contributes and reads
    from the graph).
- **Faces ship with the family, never in git.** A family imports its faces
  from npm packages under the SIL Open Font License (`@fontsource*`), so the
  bundle carries them and the repository does not; a face downloads only
  when a system sets it. No game's own art, logo or font is committed: the
  art is drawn in SVG and CSS here.
- **The contract** (`app/ui/src/theme-art.contract.test.tsx`) runs over
  every contributed design system: the slot draws the shown system's art
  and only its, in each plane, hidden and inert; a system with art draws a
  ground and holds nothing in the veil at rest; a burst of page changes
  draws what one draws, and nothing once `THEME_GESTURE_MAX_MS` has passed;
  a pairing names a contributed backdrop of the theme's own, which the head
  shows while nothing else chooses, and core's choice beats it; writing the
  theme's option node changes the head; the backdrop field tags each backdrop with
  its theme. The design-system contract and the contrast
  guard hold a theme's tokens as they hold any system's.
- **Budgets.** Ambient loops run at periods of `--motion-ambient-period`
  or more (Lab M4), only on transform and opacity, on a handful of
  elements; a gesture is one short-lived element. The art does no work per
  frame in script, and nothing it draws is measured by layout. Under
  `prefers-reduced-motion` no gesture is drawn (the shell hides the veil,
  `motion-reduce:hidden`, and the art hides its own in the ground and the
  heads), and the global rule stops every ambient loop: a cut, never a
  frame of a flash. The art's code loads when first drawn (`deferred`, a
  frame drawn at once), so it costs the page's eager bundle nothing; a
  sheet is in it, so `vite.config.ts` drops a sheet's comments, spare
  whitespace and leading zeros (`compactRawSheets`).

**Adding a theme:** add a design system (above), then any of: restate the
tokens above in its sheet; import its faces in the family's page plugin;
contribute `Art` with it; declare its backdrops as choosing it, and it as
choosing the one it pairs with, and contribute them; write its section in
`ART-DIRECTION.md`. Nothing in the shell changes.

#### Theming: what is data and what is code

The canonical list of what a theme is made of, and how far each piece is
reachable through kb's own API (actions, the CLI, MCP) rather than only
through code. _Data_ means a node or prop in the graph, read and written
by actions; _code_ means a file in a family's or the shell's source,
changed only by a release. Every piece that should be data and is not has
a `#gap` node, named in the last column.

| piece                                                                                         | where it lives                                                                                                                                  | through kb's API                                                                                             | gap                                        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Which theme the page shows                                                                    | core's `sys.f.design-system`, a ref to the theme's option node                                                                                  | data: read and set like any field (`kb set sys.extension.core sys.f.design-system …`, Settings)              | —                                          |
| The catalogue of themes and backdrops (ids, labels)                                           | option nodes the seed derives from declarations (`<family>/src/extension.ts`, `foldSeed`)                                                       | data, read-only by convention (`sys.*`, written with `--force`)                                              | —                                          |
| A theme's backdrops and its pairing                                                           | `sys.f.design-system` on each backdrop's option node; `sys.f.backdrop` on the theme's (`SeedOption.chooses`)                                    | data: read by actions; a write changes what the head shows                                                   | —                                          |
| The backdrop shown, its strength and direction                                                | `sys.f.backdrop`, `…-strength`, `…-direction` on the page's node or core's                                                                      | data                                                                                                         | —                                          |
| A backdrop's renderer                                                                         | a component contributed through `BackdropPoint` under the declared id (`<family>-ui/src/art/*-backdrop.tsx`)                                    | code, chosen by data: the entry is data, the art a registered renderer                                       | — (the intended split)                     |
| Token values: colours, faces, shapes, marks, motion timing                                    | each theme's sheet, `<family>-ui/src/<family>.css` (Paper's and Terminal's `themes-ui/src/design-systems/*.css`), mounted by the painter        | code                                                                                                         | `01M5SNSPSGYCF6AKWVXQS2GJQJ`               |
| The design-system layers (layer-1 defaults, the bridge, roles)                                | `app/ui/src/design-system.css`, `index.css`, `tokens.css`                                                                                       | code: the renderer every theme feeds                                                                         | — (the renderer)                           |
| Theme art: ground and veil                                                                    | `<family>-ui/src/art/*-art.tsx`, `art/art.css`; one `Art` component on the theme's contribution                                                 | code: words, gestures and timing inside                                                                      | `01M5SNSQ4Y11AHAHDA43PCV5D6`               |
| Page-change and write overlays (ZZZ's wipe, Jaunt(), YoRHa's scan, the sound-effect stickers) | the pane plane (page changes) and veil plane (writes) of each theme's art; their removal limit `THEME_GESTURE_MAX_MS` (`ui-sdk/lib/plugins.ts`) | code; data only switches them on or off (the `pageWipe` motion option)                                       | `01M5SNSQ4Y11AHAHDA43PCV5D6`               |
| Faces                                                                                         | `@fontsource*` imports in each `<family>-ui/src/plugin.ts`, named by the sheets' `--app-font*`                                                  | code                                                                                                         | `01M5SNSQH2HMD784PCD51W46D5`               |
| Motion options: mode, intensity, style, speed, each effect                                    | `sys.f.motion.*` on core's node; a theme's preset as the same fields on its option node (`motionPresetProps`)                                   | data: read and set like any field, Settings shows each value in force and its source (Motion options, below) | — (gap `01M5SNSQXBAM8P7K25GSM5ASP5`, done) |
| Motion keyframes and a theme's base timing                                                    | keyframes in `app/ui/src/motion.css`, `motion-fx.css`; a sheet's `--motion-*`                                                                   | code: the options rescale and swap them, never name new ones                                                 | `01M5SNSPSGYCF6AKWVXQS2GJQJ` (as tokens)   |
| The selected row's paint                                                                      | `kit/ui-sdk/src/components/sidebar-row.tsx` (fixed classes)                                                                                     | code, and no token reaches it                                                                                | `01M5SNSR9AC5V1NA31QY8DNEX6`               |
| Settings a person picks (theme, backdrop, its strength and way)                               | core's node, in Settings                                                                                                                        | data                                                                                                         | —                                          |

The direction (Rule 1, one contract): a theme becomes one node, the theme's
option node, that carries its tokens, its art's renderer ids with their
parameters, and its motion preset; the UI renders it. Renderers stay code,
registered by id as backdrops are. The gaps above are the steps.

### Motion options

How much the page moves is the person's, as settings of core's node, and
every option defaults to the shown theme's: a theme is a preset. The value
in force is core's, else the theme's, else the default, and each says
which (`motionChoice`, `@kb/model/motion-choice`).

- **The options.** `sys.f.motion.mode` (`system`, `full`, `reduced`,
  `off`), `sys.f.motion.intensity` (`subtle`, `lively`, `bold`),
  `sys.f.motion.style` (`clean`, `wobbly`), `sys.f.motion.speed`
  (`snappy`, `normal`, `relaxed`): option fields of core's node, each
  option its field's child (`sys.motion-<setting>.<value>`). One checkbox
  field per effect, `sys.f.motion.fx.<effect>`: `press`, `hoverLift`,
  `listEnter` (rows arriving), `focusRing`, `toastSpring`, `overlayEnter`
  (menus and dialogs), `toggles`, `pageEnter`, `pageWipe` (a theme's veil
  gestures) and `workingGlow`. Unset is "from the theme"; any of them is
  read and written through kb's actions as any field is.
- **A theme is a preset.** A design system's option node holds the same
  fields (`SeedOption.props`, written by `motionPresetProps`): ZZZ is
  wobbly, lively and snappy with press, hover lift, rows and toggles;
  Transistor clean, lively and relaxed with rows, focus glow and the
  working glow; YoRHa clean, subtle and snappy with press, rows and focus
  glow. The defaults are kb as it moved before there were options: the
  existing gestures on, the newer micro-interactions off.
- **The painter** (`stores/motion.store.ts`, loaded once the graph is in)
  writes `<html data-motion data-fx>` and the amplitudes `--motion-lift`
  and `--motion-press` (by intensity). A theme's sheet already moves at its
  preset's speed and on its preset's spring, so following the theme writes
  no timing; a speed of the person's own rescales the duration tokens by
  the ratio of the two speeds (`SPEED_FACTOR`, read from the sheet as
  computed), and a style or intensity of their own swaps `--motion-spring`
  (`springEasing`, a damped spring sampled into `linear()`; clean is the
  settle ease).
- **The effects** are CSS in `app/ui/src/motion-fx.css`, each keyed on
  `data-fx~="<effect>"`, on transform, opacity or filter only. The mode is
  `data-motion`: `reduced` and `off` take the global reduced-motion rule
  whatever the OS says, `full` overrides the OS, `system` asks it; `off`
  also turns every effect off. Script motion hears it too:
  `prefersReducedMotion` reads the mode before the media query.
- **A subtree may hold still** whatever the mode (`HoldStill`, `@kb/ui-sdk`):
  `useReducedMotion` answers true inside it, and its element carries
  `data-motion="reduced"`, which the global rule reads on any element, so
  CSS motion stops there too. A sample drawn to be chosen by (a backdrop's
  option card) is a still, as everything is under reduced motion.
- **Settings** draws each option with the page's field editor and, under
  it, the value in force and its source (`set here`, `from <theme>`,
  `by default`, the last two after `unset here`); the effects sit in their own group, two to a row; a reset
  clears every motion setting of core's, so the theme's preset applies
  again.
- **The contract** (`stores/motion.contract.test.ts`, `model/tests/motion.test.ts`):
  explicit over theme over default, with sources; following the theme
  paints no timing; a speed of one's own rescales by the ratio; `off`
  turns every effect off; every whole theme carries a preset as data.

**Engine: one contract, implemented twice** (decided 2026-10-25). The
owner's bb-lively plugin (popemkt/mac-backup) has the same options, presets
and effect ids. Three ways were weighed: (a) a standalone package both
consume; (b) kb owns the engine and bb-lively consumes it; (c) each product
implements one written contract. kb takes (c) now:

- kb depends on neither bb nor the dotfiles, and bb-lively styles a host it
  does not own through selectors it injects (`Targets`), while kb owns its
  DOM and moves through its own tokens and classes; the shareable half is
  the domain (names, values, resolution order, spring, speed factors), a
  few hundred lines.
- The contract is the option names and values, the effect ids, the
  resolution order (explicit, theme, default, with sources), `off` and
  `reduced` semantics, and the speed factors (0.8, 1, 1.25). This section
  is kb's statement of it; bb-lively's `core/src/domain` is the other.
- The cost of (c) is drift; the trigger to move to (a) is a third consumer,
  or the second time the two disagree. (a) then extracts `core/src/domain`
  (it already imports only `effect`) once its bb tokens and naming are
  generalised; (b) is rejected because kb's packages are private to its
  monorepo, and bb-lively would pin a kb release to move.

### Page-head backdrops

A page head paints an ambient backdrop behind its content. Which backdrops
exist is a plugin point, and the kit names none of them.

Every backdrop is built and judged against the backdrop framework,
[`docs/backdrops.md`](docs/backdrops.md): its criteria (headed by premium,
like a game's title screen; the document lists the rest) are
`#backdrop-criterion` nodes, each with the owner's words (`asks`), how it is
judged, its target and what it applies to, and the document is their
projection (`kb docs materialize`). Below them it keeps the floor: six
reference experiments, `#reference` nodes with their licences, that a new
backdrop or theme is held beside
([`docs/research/2026-10-31-3d-quality-bar.md`](docs/research/2026-10-31-3d-quality-bar.md)).
A PR for a backdrop reports a score against each criterion.

- **The point.** `BackdropPoint` (`ui.backdrops`, `@kb/ui-sdk`, beside
  `ViewPoint`, `DockPoint` and `OverlayPoint`) holds one `Backdrop` per
  contribution: its `key`, its `presentation` and its `Component`.
  - The key is the backdrop as its family declares it: an id
    (`<family>.<local id>`) and a label. `provideBackdrop` contributes it
    under the key's local id, so the contribution answers to the declared
    id, as a view answers to its key.
  - The presentation is how a head frames it: the breathing room it
    reserves above the title (`space`), its frame's `height`, `span` and
    vertical `offset`, the `directions` it can face (none for one with no
    direction), and its `opacity` at each strength. The span is how far
    across the page the frame reaches: centred under the head's content and
    at most `maxWidth` wide (`reach: "content"`), or across the whole
    scroll region behind it (`reach: "region"`), so a wider window or the
    full content width adds field at its sides.
  - The component receives what the head knows (`BackdropProps`): its
    colour (the shown node's tag colour, else the accent), the node it shows
    if any, the strength, the direction, the opacity at that strength, what
    the owner is doing (`activity`) and where the pointer is (`pointer`).
  - **Activity is a declared input, not a listener.** `PageActivity` is
    whether a node's text is being edited (`editing`, the host's read of the
    page editor), how many writes the graph has taken (`writes`, the
    index's generation), and what has happened on the page (`PageEvents`,
    the host's `events`): how many changes made elsewhere it has been shown
    (`arrivals`: a frame from the server that changed what the page shows,
    none of it this page's own held write; the replica says so,
    `ReplicaView.arrived`), how many errors the owner has been told of
    (`errors`: every one passes the toast list), and how many turns the
    sidebar's agent finished with its answer (`turns`: the agent's UI half
    says so through its ports, `AgentPorts.finished`). All of it is read
    through `BrowserHost`, so the slot hands every backdrop the same signal
    (`usePageActivity`). A backdrop that reacts to the owner compares a
    count with the one it last saw and reads `editing` as a state;
    navigation is the `node` it is handed changing. It adds no document
    listener for app events. Art drawn where no owner acts (a backdrop's
    card, the veil on a pane's plane) is handed `QUIET_ACTIVITY`.
  - **The pointer is declared too.** The frame is `pointer-events: none`, so
    it hears no pointer; the slot owns the one passive listener, on the
    smallest ancestor whose box covers the frame (`usePointerOver`). Every
    backdrop receives a `PointerSource` (`pointer.now()`): the pointer's
    place from the frame's corner, or null when it is outside. It is polled
    in the backdrop's own loop and never re-renders it, so a backdrop adds
    no listener of its own: one per head, not one per scene. Polling reads
    no layout: the frame's box is measured when the pointer moves, when
    anything scrolls and when the size of the frame, of what covers it or of
    the page changes (so a shift above the frame that moves it is
    measured), and a change of size resolves again what covers it
    (`trackPointerOver`). The slot hands the hook's callback ref to its
    frame (`usePointerOver`'s `attach`), so a frame that mounts late is
    followed from the moment it attaches.
- **One slot.** `PageBackdrop` (`@kb/ui-sdk`) is the one page-head slot.
  It frames the chosen backdrop by its presentation, behind the head's
  content, and renders nothing when nothing is contributed. Any page head
  renders it with its colour and its node. The outline's home head and its
  zoomed head are the heads that render it today; canvas and graph pages
  have no head yet, so nothing renders it there
  (gap 01M54CEKJJXNDPYNT55AR6KEV8).
- **A backdrop is declared, and its option is derived.** A family lists its
  backdrops' keys on its declaration, as declared options of the backdrop
  kind (`declaredOptions`, `BACKDROP_OPTIONS`). The seed
  fold derives one option node per key under `sys.f.backdrop`
  (`backdropOptionId`), in declaration order and owned by the family, as it
  derives view options under `sys.views` (DESIGN.md → Extension families).
  A contribution whose key no declaration lists has no option, so it cannot
  be chosen.
- **kb's backdrops are a family's.** The `backdrops` family
  (`@kb/backdrops`, `@kb/backdrops-ui`; optional, on by default) declares
  and contributes the backdrops kb ships, the unicorn first:
  - `backdrops.unicorn` is the Unicorn Studio homepage scene over the wash,
    in a taller frame that keeps its stars, feathered at its sides;
  - `backdrops.gradient` is the compact tag/accent wash alone, with no
    direction and no feather, so it is not masked twice;
  - `backdrops.sky` is the open sky: bats against a moon glow by night,
    swallows against a sun glow by day, one backdrop with two moods, which
    it reads from the page's appearance (see **2D scenes** below);
  - `backdrops.roost` is a house with a long overhang and bats hanging under
    its eave, with the sun or moon behind them: asleep by day, stirring and
    flying at night;
  - `backdrops.lens` is a dark star drifting through a nebula and bending its
    light, a new nebula each load (see **GPU scenes** below);
  - `backdrops.black-hole` is Gargantua: a black hole whose thick gas disk
    streams round it, lensed over and under its shadow;
  - `backdrops.toon-sea` is an open sea under anime-game cumulus,
    cel-shaded: a day sea, and at night a moonlit indigo with
    bioluminescent wakes;
  - `backdrops.silk` is silk ribbons in three depths, lit on a stage that
    opens onto a faint cosmos;
  - `backdrops.floating-geometry` is a web of low-poly glass facets on a
    deep navy field, gold light gathering where they meet;
  - `backdrops.gradient-orbs` is two great orbs floating in front of a
    deep blue field, lit from the upper right in violet, pink and cream;
  - `backdrops.wolf-medallion` is kb's own steel wolf medallion over smoke
    and rising embers, a faint circle of five glyphs turning behind it; its
    eyes flare when something happens on the page.

  They are page ambience, owned by no view family, so not by the outline,
  whose heads only render the slot.

- **The choice is fields.** Which backdrop, its strength, its direction and
  its art are four settings of core's node (`sys.extension.core`), since the
  slot is core's and names no backdrop. Core seeds the fields, and each
  configures core and takes one value. The first three are each a ref to
  one of their own children:
  - `sys.f.backdrop`: the declared backdrops' options;
  - `sys.f.backdrop.strength`: `subtle`, `soft` or `vivid`;
  - `sys.f.backdrop.direction`: `down` (vertically inverted) or `up`. A
    backdrop with no directions ignores it.

  The fourth, `sys.f.backdrop.art`, is text (**The art setting**, below).

  The same fields on a node choose for that node's page. Each setting is read
  from the node shown first, then from core's node (`backdropChoice` in
  `@kb/model`, `usePageBackdrop` in `@kb/ui-sdk`).
  - Where neither says, the head shows the backdrop the shown design
    system pairs with (Themes), else the first contributed, `subtle`,
    facing `down`.
  - A choice whose backdrop nobody contributes (its plugin not loaded, its
    declaration gone) is no choice: it falls through to the next node, as
    an unknown strength does, so a page's stale choice shows core's.
  - Field rows hide `sys.*` fields, so no gesture writes a page's own choice
    yet (gap 01M54CEM0Z5SMAS7KABS7QZ67C).
  - The three settings were device preferences once (`headerBackdrop`,
    `backdropStrength`, `backdropDirection`). A stale key is ignored on read
    and dropped on the next write.

- **The art setting.** `sys.f.backdrop.art` names a file of kb's own
  assets (`assets/…`, DESIGN.md → Assets) naming the art the backdrop
  draws in place of its own, where it has art to replace. It is how an
  owner's own picture reaches a backdrop without entering the repository:
  a file in their `.kb/assets/` is theirs, and the backdrop's code is the
  same for it as for its own art. The file is one of two forms, and both
  read as one `BackdropArt` (`@kb/model`'s `backdrop-art.ts`), whose parts a
  backdrop takes where it has them and draws its own for the rest:
  - **An image** is the hero picture alone.
  - **An art manifest** (`.json`) names several parts: `image`, the hero
    picture, and `glyphs`, up to eight, each a `color` (`#rrggbb`) and a
    shape: SVG `path` data in a `viewBox` (default `[0, 0, 100, 100]`),
    stroked `stroke` wide with round caps and joins, or filled with none;
    or an `image` whose alpha is its shape. References are files beside
    the manifest, named plainly (no scheme, root or `..`), and must be
    images, so a manifest can only name kb's own assets. A part left out
    or named wrongly is the backdrop's own, a glyph with no colour takes
    the colour of the backdrop's own glyph in its place, and a manifest
    that will not load leaves the backdrop all its own.

    ```json
    {
      "image": "medallion.png",
      "glyphs": [
        {
          "name": "first",
          "color": "#7cc4ff",
          "viewBox": [0, 0, 100, 100],
          "path": "M 50,13 L 12,84 L 88,84 Z",
          "stroke": 7
        }
      ]
    }
    ```

  - A backdrop's own glyphs are the default implementation of the same
    part: the Wolf medallion's runes are a `BackdropGlyph` list
    (`RUNES`), drawn by the one path an owner's glyphs take (`gpu/glyph-atlas.ts`).
  - It is read as the others are, the page's node first, then core's
    (`BackdropChoice.art`). Anything that is not an image or an art
    manifest of kb's assets is no value and falls through, so a setting can
    never make the page fetch from elsewhere.
  - The slot hands every backdrop its URL (`BackdropProps.art`, null for
    none); a backdrop with no art to replace ignores it, as one with no
    directions ignores direction.
  - The Wolf medallion replaces its relief with the art's image: red is
    height, green where it glows (its eyes, each sunk into a socket and lit
    from inside), alpha its silhouette, square, its round
    body 0.4 of its width about its centre. The chain leaves from the top of
    its silhouette on the centre column. It replaces its circle's runes with
    the art's glyphs, one to a slot round the circle, the first at the top.
    An image that will not load leaves kb's sigil, and glyphs that will not
    load leave its runes.
  - Set it in Settings → Appearance (the `art` row under Page head), or
    `kb set sys.extension.core sys.f.backdrop.art assets/<file>.png` (or
    `.json`). An asset route serves a manifest as `application/json`; the
    upload takes media only, so a manifest is a file the owner places in
    `.kb/assets/` themselves.
- **One picker.** Settings draws core's settings with the page's
  field editor, as it draws any field, so the backdrop field's own options
  are the one list of backdrops, laid out as a gallery of cards, each the
  backdrop drawn still (Option previews). It draws direction whatever the backdrop,
  as it draws every setting it lists, and says so under it when the shown
  backdrop faces no way.
- **The contract** (`app/ui/src/backdrop-point.contract.test.tsx`) runs over
  every contributed backdrop: the page's families' backdrops and one from a
  test plugin.
  - Each backdrop answers to its declared id.
  - The seed holds each backdrop's option, labelled, under the backdrop
    field.
  - The slot shows each backdrop, framed by its presentation, at every
    strength and direction.
  - Settings draws each backdrop as a card of the gallery, by its own
    renderer, still, at core's strength, hearing no owner; choosing a card
    writes core's setting, and the row and the slot then show it.
  - A page's own node chooses for that page over core's.
- **The continuity contract** (`app/ui/src/backdrop-continuity.contract.test.tsx`)
  renders the page head with each declared backdrop chosen, types 30 keys
  into a node and makes an edit: the slot keeps the instance it mounted, and
  a GPU backdrop's scene mounts once and its clock only moves forward.

#### Variation

Every load of the page shows a backdrop a little differently, as a
reference picture would be redrawn rather than replayed: where its subject
sits, how large, a few degrees of its hue, where in its cycle its motion
starts. The variation is the art direction's, never dice: each way a
backdrop may differ is a named draw within a range that still reads as its
picture.

- **One seed a load** (`scene/seed.ts`, `useBackdropSeed`), for the 2D
  stage and the GPU one alike: a backdrop mounted again in the same load
  (Settings' cards, the head) shows the same variation. Reduced motion
  shows the one curated still.
- **Draws by name** (`variation(seed)`): `range`, `pick`, `sign`, `phase`,
  and a `stream` for a layout that draws many. Each name has a stream of its
  own, so adding a draw never moves another, and a fixed seed draws the same
  every time. A hue offset turns a colour about the grey axis (`turnHue`).
- **Pinned for pictures.** `?backdrop-seed=<n>` in the page's address pins
  the seed, so a screenshot shows the same variation each time; a test
  passes its own seed.

#### 2D scenes

Sky (and Roost) are compositions over one scene kit, `@kb/backdrops-ui`'s
`scene/`: nothing about light, bodies, flight or time is stated twice.

- **The silhouette trick.** Every actor is filled with the page's own
  background tone (`--background`, so Paper and Terminal paint their own),
  and a soft glow behind them is the only thing that reveals one: an outline
  where it crosses the light, nearly nothing away from it. A thin rim, the
  figure laid a hair toward the light under its body, catches the edge that
  faces the glow, and a far actor is veiled toward the haze. The palette is
  derived from the tokens and the head's colour (`paletteOf`), never
  authored.
- **No frame.** The glow is computed per pixel with the frame's feather
  baked in and rounded with noise (`paintGlow`), so no edge shows and a dark
  page does not band; actors fade by the same feather where they stand.
- **Bodies are poses.** A bat or swallow is built from a wing beat in three
  dimensions (`wing.ts`, `gait.ts`): a planform swung about the body's axis,
  tip lagging root, seen from slightly above, so fingers fold on the
  up-stroke and a far wing rises over the back. Gliding and beating are one
  continuous parameter.
- **Flight** is a light flocking model with a wander of each flier's own
  (`flock.ts`), over three depths, with rare moments (a chase, a straggler
  catching up) on exponentially spaced waits (`moments.ts`).
- **The stage** (`stage.ts`) owns the canvas, a time-based loop (`dt`
  clamped, so any frame rate moves the same and a stall resumes without a
  leap), the pause (`watchPlayback`), the declared pointer and activity, and
  a frame-cost meter: over its 2 ms budget it lowers detail rather than
  costing the page. Under reduced motion it draws one still composition.
- **Reactions** are eased signals (`reactions.ts`): the pointer scatters
  fliers locally and they regather; typing calms the scene; a write is a
  small stir (none while typing); a move to another page re-forms the flock.
- **Input is an impulse, never a restart.** Every write adds energy to one
  running `impulse`: at most one lands every 150 ms (writes in between merge
  into the next), it adds to the energy under way rather than starting a
  pulse again, and it decays by itself. Typing writes on every keystroke, so
  a keystroke adds a little: continuous typing is a gentle sustained
  response that eases away when it stops. `stir` is the impulse without
  typing's share, for a scene that keeps still while the owner types.
- **What happens is noticed.** A page event that moved (`PageEvents`: a
  change from elsewhere, an error, a turn the agent finished) is a
  `notice`: a short `startle` pulse, and `noticed`, the kind last noticed
  and how many have been, for a scene that answers each kind its own way
  or holds what it noticed while it cannot move. Both stages' hosts tell
  the owner to their reactions through one bridge (`scene/owner.ts`): a
  count that moved is one event, a page change a navigation, editing a
  state.

Roost is the same kit with another layout:

- **The house is the light's silhouette.** Roof, post, brace and the
  wall's right edge are the page's tone, so they are drawn by the glow that
  sits under the overhang (wide and low, `GlowSpec.squash`). The wall
  dissolves downward, so nothing has a foot. By night one window glows warm;
  `direction` raises the eave (`down`) or lowers it (`up`).
- **Hanging is a pose of the flying wing** (`hangState`, blended by `hold`
  with the flight pose), so letting go and taking hold are one body at every
  point between. A bat is asleep wrapped in its wings, breathing, and now and
  then stretches, shuffles along the beam, or re-wraps; by night some keep a
  watch with open eyes, and some peel off, circle the house and return to
  the same perch (`perch` task: it slows to arrive). By day a bat rarely
  drops, flutters and re-hangs, and a swallow rarely darts by (`cross`).
- **Reactions are physical and local.** The pointer near a bat is a shiver
  and an eye cracking (fully open by night, a glint by day); a write makes
  one bat shuffle; navigating sends a ripple of shivers along the row;
  typing keeps every bat still and asleep.

The exported scene and matching runtime are served from `public/vendor/unicorn`;
its README records their sources. Preserve those upstream assets unmodified.
The canvas retains the reference scene's aspect ratio. Dark pages blend its
light with screen. Light pages turn the flowing rays into warm sunlight, with a
soft solar core and halo painted by `--header-sun`; multiply blending keeps the
canvas ground transparent on the page. It has no pointer targets,
pauses for reduced motion, background tabs and offscreen headers, and is released
when the header unmounts or the choice changes. Failed loading or unavailable
WebGL leaves the wash it paints over. Rendering needs no external requests.

#### GPU scenes

Lens, Black hole, Toon sea, Silk, Floating geometry, Gradient orbs, Wolf medallion and Light trails are shaders on the scene kit (`@kb/scene-gpu`, T1: TSL,
WebGPU with three's WebGL2 fallback), hosted by `@kb/backdrops-ui`'s `gpu/`.

- **Two lazy boundaries.** The plugin's eager module holds only the
  contribution and a `lazy()` host (`gpu/gpu-backdrop.tsx`), which imports
  each scene with `import()`: three never reaches the first-load bundle
  (`UI_LAZY_ONLY`). Until a scene is ready, and on a machine that cannot
  start one, the head shows the wash.
- **One mount** (`gpu/gpu-scene.ts`'s `mountBackdrop`) gives every GPU
  backdrop the same stage and the same promises; a backdrop is its shader
  and its `BackdropParts`.
  - The stage curves with the shoulder (`tone.ts`: identity below a knee, a
    soft roll-off above), so a dark page's ground is the page's to the level.
    The frame's sides, top and bottom feather into that ground; a feather of
    0 leaves that edge unfaded, for a frame whose sides are the scroll
    region's own.
  - A dark page's scene is light over the stage's ground. A light page's
    picture is composed in the page's own terms (the ground times a shade)
    and painted through the curve (`stage.paint`, `Grounds`), or the curve
    would wash it to white.
  - The frame is opaque, so a theme's ground art would show a rectangle
    (gap 01M5STYVFCKQ7TZ8XBSGSRHRH9).
  - **Art dissolves by its own shape** (`gpu/dissolve.ts`). Anything still
    on the frame where the side feather begins reads as a box, however soft
    the feather. So a scene keeps its art to a reach about its composition:
    a superellipse (fuller than an ellipse, so art that fills the frame
    keeps its corners) slid inward until it clears every side, whose rim
    noise eats into (only ever inward, so nothing is left past it). How much
    of it is whole is the scene's: a subject in the open keeps little, a
    field that fills the frame keeps more. A field lit by its subject (the
    air round a glass piece, the glow round an orb) is a round glow about
    that subject (`glowAbout`): it stays on the subject and shrinks as a
    whole until it clears the frame's sides and bottom (its top may run on
    under the app's bar), so however near a side the subject stands the
    field fades by its own round shape, never by a band along the side.
    Every pixel of a field dissolves by the ragged rim (`dissolve`). A scene
    that does so asks the stage for only a thin feather, as a last guard.
  - **A far layer across the region** (`farField`). A frame that spans the
    scroll region carries its far layers (distant shards, far orbs, plumes of
    smoke, sparks, glyph haze) across its whole width, seeded one to a cell
    in heights, so a wider frame adds more of the same. A far shape is never
    cut by a reach: it fades whole by where its centre stands, toward the
    frame's sides as far as the scene asks (not at all for a full-bleed
    field), toward its bottom and under the head's text, each a little sooner
    or later by its own draw, so the layer thins out shape by shape and no
    line marks where.
  - **Objects stand in front of their field.** Where a scene has objects
    (orbs, glass, a medallion), only the field behind them dissolves; the
    objects are whole and in focus, kept inside the frame by their
    composition or cut only by its top. What sets them in front is the
    scene's: a back light on their edges, a shadow they cast on the field,
    parallax against it, and the farther ones hazier. The text scrim quiets
    the field under the head's text, never an object.
- **One load, one reveal.** A load mounts a backdrop's scene once and
  shows it once: one GPU context, configured at the frame's own size, a
  first frame already laid out and in the page's look, then one fade-in.
  What a flicker on load is made of, and where each is closed:
  - the host (`gpu/gpu-backdrop.tsx`) mounts again only for another
    backdrop: reduced motion reaches the scene it mounted
    (`setReducedMotion`), and the seed is the mount's;
  - the renderer takes its host's size before its context is configured, so
    no frame is drawn at the canvas's default 300×150 (`mountRenderer`);
  - `mountScene` lays the view out at its host's size, waits for what it
    needs before its first frame (`SceneParts.ready`: the medallion's art,
    so the sigil never shows before the image), then reveals;
    `mountBackdrop` gives the scene its look before that frame;
  - a resize redraws in the same task (`redraw`), so a cleared canvas is
    never shown;
  - the head's wash is the fallback of a machine that cannot start the
    scene, never a placeholder while it loads: the load's one change is
    the scene fading in over the page's ground.

  `render-tests/tests-render/backdrop-load.e2e.ts` loads every GPU
  backdrop in a fresh tab and holds each load to this: one adapter, one
  canvas never replaced, no context at 300×150, no wash, ready once, faded
  in once.

- **Framing by width** (`framing.ts`). The head keeps one height
  whatever its width, so a hero is composed from the height and an anchor,
  never from the width: its size is a share of the height, and its place
  is so many heights right of the centre of the head's content, the column
  the title stands in (`anchorIn`). A wider frame adds field at the sides;
  the hero stays where it was, as large as it was. The host measures where
  the content lies across the frame (`ContentBox`, the part of the frame
  its holder covers) and tells the scene when it moves (`setContent`); the
  text scrim is laid out from it too. Each backdrop has a panel composition
  and a wide one: where its hero sits, its scale and how present it is. A
  frame 480px wide and below (a side panel, a phone) takes the first, one
  900px wide the second, and the widths between ease from one to the
  other. In a panel the hero is smaller, set high and right, away from the
  title and the list, and quieter. A scene's layout returns where it drew
  its hero (an `Anchor`, moved or made smaller only where the frame obliged,
  so it stays whole; null for a field with no one hero, as Silk is), and
  the canvas carries it as `data-hero`: heights right of the content's
  centre, heights up from the frame's middle, and its scale.
- **A frame that spans the region.** A backdrop whose field should reach
  past the content (Floating geometry, Gradient orbs, Wolf medallion) has
  the span `reach: "region"`: its
  frame is a breakout (`BREAKOUT_CLASS`, `useBreakoutShift`), as wide as the
  scroll region whatever the content width, and the hero is still placed
  from the content (`ContentBox`), so both content widths at one window
  width draw the same hero, and a wider window adds field at the sides.
  The region keeps no scrollbar gutter, since nothing inside a scroller
  can paint under its own classic scrollbar: its scrollbar is kb's thumb
  (`RegionScrollbar`), a thin bar over its right edge, shown while it
  scrolls, under the pointer and while dragged, and taking only drags and
  wheels over it. So the frame fills the layer under the thumb, while the
  content never sits there: every column the region shows keeps a right
  inset of at least 1rem, wider than the thumb's 12px track.
  `region-scrollbar.e2e.ts` holds both with classic scrollbars on, at both
  content widths and on a phone: the region has no gutter, no text or
  control meets the track, and the thumb drags.
  `backdrop-width.e2e.ts` proves it under reduced motion (one piece per
  load): through both content widths and windows from 1280 to 2560px
  wide, resized while it runs, the reported hero holds within a rounding,
  the frame spans the region's whole width without scrolling the page sideways, the
  canvas is never replaced and no frame is blank; on a phone it is drawn
  in its panel composition. Below a frame about 1000px wide the glass is
  slid in and made smaller to stay whole.
- **Cost.** It runs only while the tab is shown and the frame is in view
  (`watchPlayback`). Each frame's GPU time is metered against 6 ms; while it
  runs over, the backdrop steps its quality down (the offscreen pass's
  resolution; a ray's steps are never cut, or the photon ring goes first). On WebGPU the meter reads
  the stage's `gpuMs` (queue completion; gap 01M5STYVVX474T8WBT4FY341CM); on
  WebGL2 it reads the frame interval. The canvas carries `data-quality` and
  `data-gpu-ms`.
- **Reduced motion** shows one still frame, of the curated seed (**Variation**).
- **One scene for the life of the head.** The host mounts a scene once for
  its head: an edit, a keystroke, a new colour or theme reaches it as a
  call (`setLook`, `write`, `setEditing`), never as a remount, and its
  clock (`data-clock`) only moves forward. Writes reach the frame as the
  reactions' `impulse` and `stir` (see **2D scenes**).
- **Lens.** The nebula is drawn offscreen (`offscreenPass`) a few times a
  second at a fraction of the frame's pixels, since it changes over minutes;
  the lens equation, the stars, the shadow and the photon ring are per
  pixel.
  - Each load seeds its own nebula: a palette, its structure, its star
    density and where the star rests.
  - The star follows the pointer on a critically damped spring and circles
    where it rests without one.
  - Typing barely eases its pull, and each keystroke swells its mass a
    little. A write is a supernova beside it, lensed into two images, which
    a further write brightens rather than starts again.
  - A light page shows the plate's negative.
- **Black hole.** Rays are traced through a Schwarzschild field into a
  volumetric disk, drawn offscreen with history.
  - The gas streams on Keplerian shear. Two copies of its pattern, half a
    period apart, crossfade, so the shear never winds it into rings.
  - The disk is sampled at a jitter that moves each frame, and the history
    settles the jitter; most of each new frame enters, so the stream is not
    smeared.
  - Crisp first: the hole is drawn at 1.5 texels a CSS pixel at full
    quality and never under 1, however long frames run, and a ray's
    steps are never cut short (the rays that wind round the hole are the
    photon ring). Each frame's rays leave from a new point in their texel,
    so the history antialiases the ring and the filaments' edges; a step
    through the slab near the inner edge takes three samples, so the ring's
    thin crossings are not missed. The upscale is sharpened
    (contrast-adaptive), and the stage adds fine grain.
  - The pointer swings the camera slowly. Typing dims the disk a little and
    each keystroke breathes into it. A write sets a hot flare orbiting in
    it, which a further write brightens rather than starts again.
  - A light page is an eclipse by day: a charcoal shadow, the disk's dust
    lit amber.
- **Toon sea.** An open sea under anime-game cumulus, cel-shaded: a day
  sea, and at night a moonlit indigo with bioluminescent wakes.
  - The sky (gradient, sun or moon with its halo and rays, cirrus, a far
    bank, and hero clouds built as a body under a crown of puffs, their
    outlines from a signed distance) is drawn offscreen at a share of the
    frame's pixels a few times a second; the sea is per pixel below the
    horizon only, reading the sky for its reflection.
  - The sea is a plane in perspective with peaked waves filtered by each
    pixel's footprint, stepped body bands, a toon Fresnel, foam on crests,
    anime wave lines, and a banded glitter path of star glints.
  - Under the head's text the shared scrim (`gpu/text-scrim.ts`: a soft
    block just behind the title and the meta row, sized in CSS pixels from
    the content's left (`ContentBox`), so
    the rest of the picture keeps its colour) keeps them readable, and the
    glitter stays out from under it.
  - The pointer resting over the water spreads ripple rings. Typing calms
    the swell. Three splash rings with bursts of glints take turns on one
    running clock, and the reactions' `impulse` scales them: the owner's
    activity lifts them, a quiet page leaves them still, and nothing starts
    one again.
- **Silk.** Silk ribbons in three depths on a stage that opens onto a faint
  cosmos, drawn offscreen at a share of the frame's pixels; the cosmos's
  slow fields (gas, a galactic band and its dust lane) in a pass of their
  own, a few times a second.
  - Each ribbon is solved analytically per pixel: a twisted strip whose
    across-coordinate and normal each pixel finds exactly, so there are no
    meshes and the one edge is filtered, widened per layer for depth of
    field. BG ribbons are soft in the haze, the MG hero (a double-faced
    satin and a sheer organza) is in focus, and two large defocused FG
    edges frame the right-hand corners, clear of the title. The layers
    slide at their own parallax rates, and the focus breathes now and then.
  - Silk's material: anisotropic GGX, thin-film interference (Belcour and
    Barla), transmission for the sheer one, a woven warp only in focus.
  - A key spot, a cool back gel, and a strip light that sweeps across,
    reaching each layer in turn and shadowed by every nearer ribbon; the
    hero casts a coloured shadow and a caustic on the backdrop.
  - The pointer is a breath of wind that lifts and flips the ribbons and
    stirs the dust (summed on the CPU into a strip the shader reads). Typing
    slows everything and rests the sweep. A shimmer runs along every
    ribbon without end, as bright as the reactions' `impulse`, and `stir`
    quickens the ribbons' twist.
  - The same scrim sits under the head's text, the cosmos keeps clear of
    it, and in a panel the ribbons rise above the title.
  - A light page is the paper itself, with a pastel breath of gas.
- **Floating geometry.** A crumpled piece of low-poly glass floating in
  front of deep navy air, gold light gathering where its facets meet (the
  owner's reference: crumpled, gold-lit glass). Each load lays out its own
  glass (`web.ts`): three sheets of facets, each a lattice of jittered
  triangles solved per pixel, so shared corners and seams are one, never
  pieces apart. Its frame spans the scroll region (**A frame that spans the
  region**): the piece is placed from the content, and the field behind it
  reaches the region's sides. Each load also moves the main knot a little, sizes the
  glass within a tenth, and turns the light's hue a few degrees
  (**Variation**).
  - **Two layers.** The near sheet is the piece: the facets whose three
    corners, strayed as they rest (`restingAt`), lie within reach of three
    knots, the main one, where the light gathers, and one either side of
    it, a little above at the right and a little below at the left, so the
    piece is one mass wider than tall. Each facet is whole, so the piece's
    edge is its own seams. It never fades and is never cut: the
    composition places it right of the title and fits the whole cluster
    inside the frame, clear of its sides, of the strip under the app's bar
    and a little of its bottom (`fitPiece`, from the reach of its knots,
    how far a corner sways and how far the sheet slides; a corner judged
    where it rests needs no room for its stray, so the bound is tight and
    the piece fills the head's height), sliding it in before it shrinks
    it. The wide composition leaves room at a desktop head's right, so
    at 1280 the piece seldom needs to slide and the hero holds whatever the
    width. In a panel or on a phone, where the
    title and the rows cross the frame, it is small and sits above the
    title's row. Between the piece and the web hang a few **great
    shards** (`shards.ts`), one to a cell of the frame's width in heights
    (so a wider frame has more): long planes of clear glass crossing the
    head, hazed inside and brighter toward the lamp, their edges glowing,
    warm near the lamp and cool far from it, each fading whole by where it
    stands and thinning where it crosses the text or nears the frame's
    bottom, its lowest corner kept clear of it, so they fill the head as
    the reference's sweep of big shards does. Behind them, a middle and a far sheet, larger facets turned against
    it, are part of the field: every facet, out of focus (each pane's edges
    soft, the farther the softer), barely warmed by the lamps, a few of its
    planes catching the light, in broad slow pools of light across the
    frame with the web dark between them, all half lost in the haze.
    **Far glints** burn in it: one to a cell of the frame's width in heights
    (so a wider frame has more), above the title's line and clear of the
    piece, each heating the vertices of the sheets behind near it as the
    lamps heat the piece's, so a corner there burns and light runs along
    its creases, smaller and hazier than the piece's. The frame has two or
    three lights, never one, and the field round the title has a focus.
    Each pane, seam and corner of theirs fades whole by where it stands
    (`farField`), a seam or corner by itself so the facets either side of
    it agree, thinning out toward the frame's sides, low under the head's
    rows and under the title (over a little of the frame at either side, so
    the field and its glints reach the title's side), and a long seam thins
    along its own length too, so none runs on to the frame's bottom. The
    field is a dark, contrasty navy air lit by the lamps and the
    piece, brightest about the piece and falling away from it by its own
    light within a round glow about it (`glowAbout`), over a haze that is
    the piece's light in the air, dimmer away from it in heights, lit by
    the pools, its lower edge softened by its smoke and spread over half
    the frame's height, gone before its bottom, so no level line marks it.
    The frame has no side feather: the haze meets the region's own sides.
  - **In front of the field**: the piece is translucent, hiding a little of
    the air behind it, so the warm air the lamps light shows through its
    faces; its outline is lit from behind, cool, warming where light runs along
    it; it casts a soft shadow on the field below it; and the near sheet
    slides further than the far one and the field as the eye leans
    (parallax).
  - **The light**: three lamps stand behind the knots, the main one
    brightest, the second nearly as hot, a second warm core, and the third
    a glint of its own; a corner's heat is
    the lamps near it, squared, so a few points burn and the rest barely
    warm. The near sheet has a
    corner on the main knot and the main lamp rests on it: a warm-white core
    with a long soft amber bloom. Light runs along a crease from a hot
    corner and dies out within a quarter of the piece, a fine stroke turning
    white-hot where it is hottest with a soft spill and a broad bloom into
    both facets (the caustic where they fold), so the light, not the line,
    carries the edges that meet at a hot point; each crease is as sharp as
    its own hash, and most seams fall to a hair of steel. A hot corner pours a fan of light into
    each facet that meets there, hugging the seams that leave it, as much as
    the facet passes of the lamp behind (transmission; a sheet behind passes
    little, so a far glint is a point and its creases, never a muddy pane).
    Each facet's body is
    dark slate glass, lighter as it faces the key and toward the lamp's side
    of the facet, so every plane reads by its turn, and it holds light as
    glass does, never a wireframe: its edges glow from within, where the
    glass is thickest, a haze fills it, and the core's light sweeps through
    it, warm near the core and cooling to a blue-violet across the piece.
    Where light piles up it rolls off softly, keeping its hue.
  - Every vertex folds in depth on a clock of its own (9 to 17 s) and
    sways a little; each sheet slides slowly about its rest, and the
    piece's knots slide with it, so its facets never change. The glass is
    drawn offscreen at up to 1.5 texels a CSS pixel, fewer as quality
    steps down; the field (the sheets behind it, the air and the haze) is a
    pass of its own at half a texel a CSS pixel, so it is cheap however wide
    the frame, and as out of focus as a far layer; a pixel spends nothing on
    the piece where it cannot be.
  - A band of light sweeps across every 11 seconds (typing rests it), so
    seam after seam of the piece glints, the sheets behind barely; a still
    rests with it through the main knot.
  - The main lamp follows the pointer on a soft spring (about two
    seconds) and wanders a little about its corner without one; the other
    two breathe on their own clocks. Typing slows the drift. Writes swell
    the lamps (`impulse`), and a write outside typing (`stir`) or a new
    page (`ripple`) folds the glass a little further, which eases back.
  - A light page is the glass as an engraving on the paper: a periwinkle
    wash for the air, each facet a frost, deeper as it turns from the key
    and peach where light passes it, its edges deepening inward to a
    periwinkle the glass holds, so each plane has body, its seams fine
    periwinkle ink turning apricot where light runs along them, the hot
    point an apricot bloom, and the piece's lilac shadow; the shards in
    periwinkle and apricot ink, and the web behind in fainter ink over the
    wash, its panes fainter still. The text scrim keeps the field quiet under the head's text in
    both, never the piece.
- **Gradient orbs.** Two great orbs floating in front of a deep blue field,
  after the owner's reference: a great orb right of the title, half again
  as wide as the frame is tall, cut by the frame's top and lit on its
  right; a second, two thirds its size, high at the left above the title,
  only its lower cap showing under the frame's top, lit on its lower right;
  and a dim one far behind between them, part of the field. In a panel or
  on a phone, where the title and the first rows cross the whole frame,
  they stand small and high, off the text, the great orb whole in the top
  right corner. Each load varies
  that composition a little and turns the whole hue a few degrees
  (`orbs.ts`, **Variation**). Its frame spans the scroll region
  (**A frame that spans the region**): the field is full-bleed to the
  region's sides at every width, a phone's too, and the orbs are placed
  from the content, so they hold their place and size whatever the width.
  - One pass, no offscreen picture: each orb is a circle's distance field
    shaded as a sphere and laid over the ones behind it. One key, high
    toward the side its lit limb faces, lights it (where the composition
    turns it, the lamp leaning it, `litToward`), wrapped, so the light
    falls off smoothly across the whole face: deep blue in shadow through
    periwinkle and rose to a cream crescent on the lit side. No gloss, no
    hot spot, no bands; a limb softened as a lens's depth of field softens a
    large near shape, a little for the great orb, more the farther. Where
    the light turns away, the face runs through a richer, darker violet
    terminator before the shadow, as light scattered just under a soft
    surface does.
  - **Two layers.** The field is deep blue air, royal toward the top and
    the lamp, lit by the orbs' glows, with the far orb far out of focus in
    it. Behind the great orbs, far orbs are seeded one to a broad cell in
    heights, few and large and far out of focus (no speckle of small ones),
    under half the cells showing a soft, dim disc lit toward the lamp, each
    fading whole by where it stands (`farField`). Every cell's orb lights the
    field about it with a glow much wider than tall, shrunk until it clears
    the frame's bottom, and the field is the union of those glows and the
    great orbs' own (`glowAbout`), each whole out to its orb's limb, so an
    orb always sits in its own light, and easing smoothly to nothing past
    it: full-bleed across the frame, its lower edge their round glows, wide
    and gone well above the frame's bottom, so it falls away as a few long,
    smooth curves, never a ragged bank, a band, a scallop, an ellipse or a
    side feather (the frame has none). Where it thins out it is a lit haze
    thinning, never a dark bank. Its light falls away from the great orbs
    in heights, so a wider frame adds a dimmer field, graded by broad, slow
    banks of violet haze so it has depth, never a flat indigo. The two great
    orbs are never faded, the text scrim included, and stay clear of the
    frame's bottom wherever they drift; only its top cuts them.
  - **In front of the field**: Fresnel on the lit side only, the face
    brightening toward its limb where the light wraps it, the shadowed limb
    left dark, so no line outlines an orb; its light spilling off the lit
    limb, a tight glow hugging it and a deep bloom past it, broad and soft
    out into the field, and a faint cool glow all round, the shadowed limb
    too, each falling away from the limb, never a ring, dissolving with the
    field; a soft shadow each casts on the field away from the lamp and a
    little below, wider than itself and deep, as it hangs over the field,
    and a darker contact close round each near orb where it crosses what is
    behind it, deepest on its shadowed side; the second orb a little hazier and bluer
    than the first, the far one far out of focus; and parallax, the near
    orb sliding further than the far one as the eye leans with the pointer
    (idly without one).
  - Each orb drifts about its rest on paths of its own (twenty to forty
    seconds round), and breathes; the hue leans from periwinkle, rose and
    cream toward indigo, magenta and amber and back over 48 seconds. The
    lamp follows the pointer on a slow spring, so the orbs turn their lit
    sides toward it, and wanders at the upper right without one. Typing
    slows the drift; writes (`impulse`) swell the orbs a little and lift
    their glow, and they ease back.
  - A light page paints the pastel pair on the paper: lilac and periwinkle
    shadow, blush and cream toward the lamp, each in a lilac glow of its own
    over a periwinkle wash that is the field's light version, full-bleed
    and paling away from the orbs, the far orbs pastel in it, their shadows
    lilac on it. On paper an orb's limb is softer than on a dark page and
    its shadowed limb pales toward the wash, as haze would take it, so a
    pastel orb never sits on the white as a cut-out.
- **Wolf medallion.** kb's own sigil, never another work's emblem: a round
  steel disk with a raised, notched rim, and on it a front-facing wolf mask
  cut in straight planes (pointed ears, a ruff in two steps, a long closed
  muzzle), gabled down its middle, its eyes engraved slits (`medallion.ts`).
  Behind it a faint circle of five glyphs turns once in two minutes, each
  kb's own evocation of one Sign by its nature, in a few straight strokes:
  a force pushed out, a flame, a ward, a shield, a mind turned. Each glows
  faintly as light leaking from a groove, more light than colour: a warm
  pale white tinted by the colour of its nature (a pale cold blue, ember,
  violet, amber, a soft green), a little in its stroke and more in the
  soft bloom round it, breathing on
  a slow clock of its own with a faint flicker, never in step (still under
  reduced motion), and the circle keeps
  clear of the head's text and fades before it reaches the rows' tags low
  at its right. Smoke curls close round it and embers climb, and a warm
  back light stands behind it, glowing in the air and the smoke about it,
  so all its warmth is the medallion's own, never a stain beside it. Its frame
  spans the scroll region (**A frame that spans the region**), and the
  medallion is placed from the content. The near smoke keeps to a round
  glow about the disk (`glowAbout`), little of it whole, and dissolves at
  its ragged rim (`gpu/dissolve.ts`), so it tapers out by its own folds,
  never a box or a side of the frame. The far layers cross the whole frame
  (`farField`): the far smoke in soft banks one to a cell in heights, each
  a broad, low puff wider than tall, drifting and swelling on its own
  clock and torn by the far smoke's folds, which are drawn out across
  rather than up, so nothing stands as a column or a streak (rising
  plumes from a narrow foot, and a far fold drawn upward, read as faint
  vertical streaks across a wide frame);
  sparks, fewer than about the disk; and glyph haze, faint out-of-focus
  glyphs one to a cell, rising a little and breathing, clear of the
  medallion's circle. Each bank, spark and glyph fades whole where it
  stands, toward the frame's sides, its bottom and the text.
  - **The relief is baked once** (`medallion/relief.ts`), in passes run
    only when its source changes: the source as height, where it glows and
    its silhouette; its edge cleaned, the silhouette eroded past any matte
    its edge carries and the height run on flat past the cut (the highest
    round each point there), so no cliff at the cut lights as an outline or
    a halo, an image's or the sigil's; its sockets, a bowl sunk into the
    height wherever it glows (**Its eyes**, below); the material's maps,
    height, cavity (how far a point lies below the relief round it, near
    for engraving and far for recesses) and heat; and the sockets' light.
    The source is kb's sigil (disk, a rim
    a few thousandths out of round and notched, the gabled mask, the
    engraving, and a bail for the chain), or an image the backdrop's art
    setting points at (**The art setting**, above). The maps keep their mip
    chain and are read over the pixel's footprint by explicit derivatives
    (`offscreenPass`'s `mipmapped`: a frame is a scene's background, which
    three reads at one fixed level), so the silhouette, the engraving's
    edges and the casting's grain are filtered at their source, never
    read at their finest level into stairs at a fifth of their size. The frame takes
    the slope from the baked height over the same footprint (never finer
    than a texel), so its normals are smooth and never the screen's 2×2
    derivatives, and a grain finer than a pixel is averaged away rather
    than sparkling.
  - **Worn steel**, physically motivated: a metal's reflectance (Schlick
    Fresnel) over its surroundings reflected (a warm floor the embers
    light, a cool sky, a soft window up left), and a brushed anisotropic
    highlight (Ward), since it was turned on a lathe and the brushing runs
    round the centre, so the highlight stretches across it. The key falls
    across the face from its upper left, a gradient, so the relic is lit
    rather than printed, and a bevel facing it square takes a pin-hot
    highlight. A glint circles its bevels, a broad, bright specular sheen
    sweeps across the face every 9 seconds, and the bevels on the smoke's
    side catch a hot, narrow rim from below. The cavity puts grime and a
    brown-black patina deep in the recesses and occludes them; convex edges
    are rubbed bright; fine scratches score it and catch the key; casting
    pits are rare small hollows. Scratches and pits fade out where they
    grow finer than a pixel. Every highlight is antialiased by the
    normal's own variance across the pixel (geometric specular AA): each
    lobe widens by it and dims as it widens, so a bevel's pin-hot highlight
    never sparkles as the medallion swings.
  - **Its eyes are lights deep in sockets** (`medallion/eye-shader.ts`),
    never a glow painted on the face; an owner's image and kb's sigil
    alike, from where they glow and nothing else:
    - The bake sinks a socket round each glow: a bowl whose walls fall
      smoothly from the metal past it to a floor under the glow (the glow
      blurred, so no ring of the blur shows as a terrace).
    - The core is the glow on the socket's floor, hottest where it lies
      deepest inside the glow (its heat, measured in from the glow's edge
      in medallion units, so a thin slit and a broad almond both have a
      heart), near white there and the light's own colour at its edge. It
      lies below the face: it shows low in the socket's mouth, the brow over
      it hiding its top, and it shifts against the mouth as the medallion
      twists a little on its chain while it swings.
    - Its light is baked as a flux at every point near it: the glow
      gathered on a coarse grid, each cell a point light a little above
      the floor, its light falling with the square of distance and hidden
      where the relief between them stands above the line to it, so a brow
      shades what lies past it. The frame lights the steel by it as by any
      light: through the steel's reflectance (Schlick Fresnel), a GGX lobe
      as rough as its grime and widened by the pixel's own spread (the
      specular AA), and a little diffuse in the patina. The socket's walls
      facing the core take its light, the rims catch it from inside, and a
      face turned from it or above it stays dark.
    - Its halo is that light's strength from every side, so it bleeds out
      of the socket where the light reaches and is hidden where it is
      hidden; on a dark page the stage's bloom carries the core further.
      Awake, the light wavers a little on the scene's clock, more as the
      eyes wake, so a still frame is still. On a light page the core is
      light on the paper, covering it as far as its light runs.
    - A flat glowing ellipse on the face was tried first, a core and a
      halo added where the relief glowed: it read as a texture in front of
      the eye, not a light inside it.
  - **The chain** (`medallion/chain-shader.ts`) is three-dimensional: oval
    links of round wire (a stadium swept by the wire), interlocking, every
    other one turned a quarter about the chain's line, from the bail up past
    the frame's top. Each is solved where the eye's ray meets it,
    analytically for the pixel (a face-on link a stadium torus seen from the
    front, an edge-on one its straight runs and the half tori at its ends
    seen from the side), so it costs two links a pixel and no geometry;
    where two cross the nearer shows, softened over the pixel's footprint,
    and where one passes close by another's wire it is shadowed. It is the
    medallion's own metal under the same lights (`medallion/metal-shader.ts`,
    one model for both), brushed along its wire, its lobes widened by the
    same specular AA; the eyes' light ends long before it. A flat chain, a
    ring and a bar drawn by turns with a tube's shading, was tried first.
  - **It hangs.** The medallion and its chain are one pendulum from a pivot
    above the frame (`swingOn`, `HANGING`, in `medallion.ts`): slow (7.5 s),
    lightly damped, kept swaying by two slow breaths of air just off its own
    swing, so its sway is very small (about a hundredth of a radian each
    way) and drifts; something happening on the page pushes it a little
    further, and the swing dies back. It twists a little on its chain as it
    swings, which only the depth of its eyes shows. It never moves toward
    the pointer: a pendant that leaned to follow a cursor read as physically
    wrong, so the pointer stirs the air instead, the embers drifting and
    swirling away from a gust that follows the pointer with a lag and
    settling back once it has passed (`AIR`). Under reduced motion it hangs
    straight and the embers are never stirred.
  - **Glyphs are one atlas** (`gpu/glyph-atlas.ts`): every glyph, a rune or
    the art's, is drawn once into a cell, its coverage and its glow (the
    coverage blurred), and the atlas keeps its mip chain. The circle reads
    the glyph of the slot a pixel falls in, and the far haze a glyph's glow,
    one read each, with explicit derivatives, so a glyph is antialiased at
    device pixels at any size and the slots' seams pick no wrong level. A
    glyph's colour tints its light on a dark page (a warm white, the colour
    taken at its own brightest so every glyph tints alike) and its ink, sepia
    faintly tinted, on a light one. Glyphs in their full colours were tried
    first and read as coloured paint, not light. The rings are lines covered by the
    pixel's footprint (`hairline`), broken into arcs;
    the smoke is two layers, a far slow fold and a near one curled by a
    slow fold of its own into eddies and wisps, thickest close about the
    medallion, lit by the embers from below and by the back light behind
    it, brightest just past its silhouette; the embers are sparks on a
    grid's cells, mostly specks and a few large and bright.
  - **It stands in front of its field.** The field stays a local glow of
    smoke and embers; the medallion over it is whole, never cut by the
    smoke's dissolve. Dark steel on a near-black ground needs light behind
    it: a warm back light glows in the air behind the medallion, round it
    and a little toward the smoke's side, kept within the near smoke's
    reach so it is gone before the frame's bottom; it hugs the silhouette
    just past its edge all round, the shadow side too, broader on the
    smoke's side; and it grazes the medallion's own edge as a thin rim of
    light all round (an image's lower jaw parts from the ground), wrapping
    further in on the smoke's side (a back light, never a line drawn round
    it); its shadow cast on the smoke,
    and a darker contact where the chain meets the bail set it in front. Its halo, edge light and shadow are its own
    silhouette softened, so they follow its shape, a sigil's or an
    image's.
  - Light over the page's ground, never under it: the text scrim and the
    disk's shadow quiet the field, never the ground itself, and never the
    medallion or its chain.
  - **It senses the page, by light.** On a `notice` its eyes flare in that
    event's colour (and its swing is pushed a little), their light on the
    sockets' walls with them (silver for a change
    from elsewhere, red for an error, gold for a finished agent turn), with
    a halo round the disk, and settles back to its faint amber. Under
    reduced motion it never moves: the eyes light, still, and go dark again
    a few seconds later, two still frames the scene asks the stage for.
  - The pointer near the disk wakes its eyes a little and stirs the embers;
    typing slows the smoke; writes (`stir`) turn the circle faster for a
    while.
  - A light page is the same scene on paper, the medallion a real object
    on the page: polished darker steel, its light exposed for the day on a
    curve that keeps its darks, so its engraving lies in deep shadow and
    its bevels and glints are brightest, never a flat grey disc; the soft
    window's reflection partly held back, or it is a fog over the steel;
    the smoke's rim laying gold in its bevels as on a dark page, a thin
    warm rim on the smoke's side and a warm glint sweeping its bevels; its
    edge darkening where it turns away and its silhouette taken from its
    solid part, so no pale fringe rings it, an image's spikes included; the
    chain the same metal, exposed alike; and a soft contact shadow on the paper just below and
    right (the one it casts on the smoke), with a wider, softer one past it,
    so it rests on the page. The
    lens draws no aberration on this backdrop, so no colour fringes an
    edge. It fades into the page in display values
    (`fadeSpace: "display"`), so a strength's veil leaves the steel its
    darks. The same holds for kb's sigil and for an image the art setting
    names. Then a smoke wash, sepia rings, glyphs in sepia faintly tinted by their colours and rust specks. An engraving in
    faint ink was tried first and all but vanished on white; a steel toned
    between a light and a shade by its luminance read as a grey pewter
    ghost.
- **Light trails.** Long-exposure light streaking across the head from the
  upper left down to the right in a gentle S, after the owner's reference
  tile 09: hairline strands, crisp cyan and blue with a few gold, gathering
  in a white-hot knot right of the title, finer and denser there, and
  fanning out away from it, in the navy glow of its own light
  (`light-trails/`). In a panel or on a phone the knot rests high and
  right, above the title's row. Each load varies the strands a little
  and turns the hue a few degrees (**Variation**).
  - One pass, no offscreen picture. Every strand is a curve in the hero's
    units, heights from the knot at its scale (`trails.ts`), so a wider
    frame shows more of each strand, never more or larger ones; the frame
    spans the scroll region and the knot is placed from the content
    (**A frame that spans the region**), and the canvas reports the knot
    (`data-hero`).
  - **Depth is focus.** A near strand is a hairline a pixel or two wide
    with a faint short glow; focus falls off late (as the cube of depth), so
    the mid strands stay fine and only the farthest widen, dimmer and bluer,
    into the field's broad sheens: one kind of thing at every depth. A few
    sparks, warm white, drift with the flow near the bundle.
  - **The knot** is a sharp cyan-white core in a tight bloom, with a long
    hairline lens streak along the bundle and a softer, shorter one under
    it, as a lens draws a bright point; its wide bloom is a gaussian, gone
    well short of the frame's bottom.
  - **It fades by its own shapes.** The dark field is no slab: it is the
    bundle's own glow, navy about its path and round the knot, in slow
    smoke, with the far sheens; toward the head's rows it thins by its
    smoke's ragged edge, gone before the frame's bottom. A strand comes and
    goes along its length, never at the knot, and dies out down the frame
    at a height of its own (`trails.ts`, `low`), so the bundle thins strand
    by strand and its bottom is never one line; under the head's text it
    all but goes, so the title and the first rows stand clear. The strands
    run to the frame's top, under the app's bar, and past its sides, so no
    side of the frame is a fade and no gap opens under the header.
  - The owner: where the pointer rests the trails burn brighter, as a
    longer exposure would, and the knot leans toward it on a slow spring;
    typing slows the light; writes brighten the packets of light that run
    along the strands. Under reduced motion it is one still frame.
  - A light page is the same strands as ink on the page's paper: deep
    cobalt and amber hairlines, inked strongly enough to hold on white and
    on a phone, over a pale periwinkle wash along the bundle; the knot a
    point of bare paper in a cyan bloom and streak, so the core still
    reads.
- **Painted scenes keep their colour.** Toon sea and Silk were drawn as
  high-key pictures, and the page must show them as drawn (Gradient orbs
  takes the frame and the fade too; it is drawn for the dark page, so it
  needs no grade):
  - a strength barely veils them (`sceneFrame`: 0.95, 0.98, 1), since a
    veil toward a light page is a wash;
  - they fade into the page in display values (`fadeSpace: "display"`), as
    a CSS mask over the page would: halfway to white in linear light reads
    nearly white;
  - a dark page grades them by ACES above the ground (`gpu/dark-grade.ts`),
    the contrast they were drawn under, while the ground meets the page to
    the level.
- **The head's rows paint above the frame.** The frame is absolute and
  reaches below the title, so every row of the head is positioned, the
  fields row too, or it paints under the scene.
- **The contract.** `@kb/backdrops-ui` runs the scene contract over every
  GPU scene, each on a dark page and a light one.

### Type scale

One step per font size the UI sets. A step sets font-size only; leading stays
with the element (`leading-*`, or the `.kb-text` role's `--kb-text-leading`).

| step      |   px | typical use                                      |
| --------- | ---: | ------------------------------------------------ |
| `micro`   |    9 | count badges                                     |
| `caption` |   10 | mono ids, micro labels                           |
| `label`   |   11 | chrome labels, buttons, uppercase section labels |
| `tag`     | 11.5 | tag chips (`.kb-tag`)                            |
| `meta`    |   12 | secondary text, menu rows, toasts                |
| `ui`      |   13 | inputs, palette rows, breadcrumbs                |
| `note`    |   14 | empty-state notes                                |
| `body`    | 14.5 | node and field text (`.kb-text`)                 |
| `lead`    |   16 | lead paragraphs, sub-headings                    |
| `heading` |   18 | section headings                                 |
| `title`   |   20 | the zoomed-root and page titles                  |

- **The names are ordered roles, one size each,** like Apple's text styles
  (caption, footnote, body, title). They are not t-shirt sizes. Tailwind's
  `xs`/`sm` already mean 12px/14px with a paired line-height, and kb's steps
  sit between them (11, 11.5, 13, 14.5px), so reusing those names would make
  `text-sm` mean something other than what every Tailwind reader expects. Nor
  are they a pure semantic set: several roles share a size, and the scale
  maps each px to exactly one step. "Typical use" says where a step is used;
  it does not restrict it.
- **Body text is a step, not a variable beside the scale.** `.kb-text` and
  `--kb-text-line` read `--type-body`. The tag chip likewise reads
  `--type-tag`.
- **tailwind-merge learns the names** (`lib/cn.ts`, `TYPE_STEPS`). Without
  that it reads an unknown `text-<name>` as a colour, and
  `cn("text-label", "text-foreground/50")` would drop the size.
  `lib/tokens.test.ts` fails if `TYPE_STEPS`, the bridge and the layer-1
  values ever list different names.

### Long text

A node's text wraps, all of it, wherever it is the content: a row, and the
zoomed page's title, in view and in edit alike (`.kb-text-row`, pre-wrap).
A title is never cut short on the page it heads: the page is where a person
reads it whole, as Notion, Logseq, Workflowy and Tana all wrap a page
heading. Text clamps to one line with an ellipsis (`truncate`, or
`.kb-text-clamp`) only where room is the constraint and the text is a
pointer to somewhere else: breadcrumbs, sidebar entries, chips, picker
rows. A clamped label carries its full text in a `title` tooltip.
`outline-layout.e2e.ts` measures the title in a real engine at a desktop
and a phone width.

### Elevation

How far a surface floats above the page, lowest first. `--elevation-<level>`
in layer 1 is bridged as `shadow-<level>`, and Tailwind's `shadow-*` scale is
reset.

| level      | used by                                                              |
| ---------- | -------------------------------------------------------------------- |
| `edge`     | the active segment of a segmented control                            |
| `raised`   | canvas cards, ports and handles, a toggle's knob, small status chips |
| `lifted`   | toasts, the ref autocomplete dropdown                                |
| `floating` | floating toolbars and legends over a canvas, graph tooltips          |
| `overlay`  | popovers and pickers (the popover anatomy of DESIGN-RESKIN §1.5)     |
| `modal`    | the command palette                                                  |

The levels are ordered and name a height, not a component. A new surface
picks the level it floats at. It does not get a level named after itself.
`ELEVATIONS` in `lib/cn.ts` is held to the bridge the same way `TYPE_STEPS`
is.

### Radius, borders, faces, colour

- **Radius** derives from one layer-1 value, `--radius` (the `md` step). The
  bridge computes `xs` (−4px), `sm` (−2px), `lg` (+4px), `xl` (+10px) and
  `2xl` (×2) from it, after resetting Tailwind's steps. Bare `rounded`
  (Tailwind's fixed 4px) is `rounded-xs`, and `.kb-md-media` applies the
  same step. `rounded-full` is a shape, not a step. Three corners are still
  off the scale (2px resize handles, the 3px inline-code chip, the 5px
  ontology segmented control), under one gap: putting them on a step moves
  each by 1–2px, which is a visible change.
- **Borders.** `--border-width` is what a bare `border` and `divide-*`
  draw: the bridge maps it onto Tailwind's `--default-border-width`, so it
  is read, not merely declared (an earlier unread `--border-width` was
  deleted for exactly that reason). Explicit widths (`border-2`) stay
  Tailwind's.
- **Density** is one multiplier, `--density`. The bridge sets Tailwind's
  spacing unit to `0.25rem × --density`, so every `p-*`, `gap-*`, `w-*`
  and `inset-*` step scales with it, and `tokens.css` derives the outline
  row metrics (`--kb-row-h`, `--kb-indent`, 24px each at density 1) from it.
  Density 1 is Tailwind's own unit, so it reproduces the unscaled layout
  exactly.
- **Faces.** `--app-font` is the UI face, a design-system value like any
  other (Design systems, above).
  `--app-font-mono` sets ids, code and EDN (`font-mono`, `.kb-md-code`).
  `--app-font-graph` sets graph labels: `font-graph` in the DOM, and on
  canvas through `graphLabelFont()` (`lib/graph-label.ts`), because a canvas
  `font` string cannot hold a `var()`. No `font-family` outside layer 1 names
  a family.
- **Colour** is the oklch palette, bridged as `--color-*`. Two
  theme-independent tokens cover what used to be Tailwind's `black` and
  `white`: `scrim` (the dimming layer behind a modal) and `knob` (a toggle's
  knob). Canvas renderers read colour through `readTokenColor`
  (`lib/css-color.ts`). Each token's no-document fallback is a contract
  (`COLOR_TOKEN_FALLBACKS`, `@kb/contracts` `design-tokens.ts`), so a
  painter with no document, a server's included, reads the same value, and
  no component carries a colour literal. The lab's palette (`--lab-*`, Lab
  principles L1) is layer 1 too, read the same way by `lab/kit/palette.ts` through `@kb/scene`'s `palette.ts`.
- **Canvas renderers re-read on one signal.** A DOM utility follows a token
  change by itself; a renderer that copied a value out (a colour, the
  graph label face) does not. `useAppearance()` (the kit's, over the host's
  `appearance`, which `appearanceIn` in `stores/prefs.store.ts` answers)
  resolves everything that changes what the tokens hold, and its `key`
  changes exactly when that does. The graph page hands the key to every
  renderer (`appearanceKey`), and the lab's scene host re-reads the lab
  palette when the appearance changes. Nothing listens to the `.dark` class
  or a preference directly.
- **Canvas-drawn values are outside the Tailwind scale, on purpose.** What a
  renderer paints on canvas or WebGPU is not a class: the graph label sizes
  (11–12px in `sigma-labels.ts`, `cluster-hulls.ts`, `tree-graph.tsx`,
  `force3d-graph.tsx`) and the lab scenes' geometry, light and bloom
  values belong to their renderers. Their colours and faces still come from
  layer 1 (`readTokenColor`, `graphLabelFont()`). Their sizes are scene
  parameters, and no type step names them. The lab's DOM chrome (info card,
  curve panel, scene switcher) is ordinary UI and uses the scale.

### Enforcement

Two questions, two mechanisms, one owner each.

**Policy — "don't bypass the tokens."** `design-tokens/no-raw-design-value`
(oxlint, `harness/lint/design-tokens/`, at `error`) reads every string a UI
module writes. It rejects the forms that do compile but skip the design
system:

- an arbitrary font size, in any data type Tailwind reads as a size (length,
  percentage, absolute-size, relative-size), untyped or typed, in `[…]` or
  `(…)` form, with or without a leading modifier: `text-[11px]`,
  `text-[large]/5`, `text-[length:11px]`, `text-(percentage:--x)`. An
  arbitrary colour (`text-[color:…]`, `text-(--x)`) is not a size and
  passes;
- an arbitrary shadow (`shadow-[…]`), and the shadow families the bridge
  does not own (`drop-shadow-*`, `inset-shadow-*`, `text-shadow-*`);
- an arbitrary radius (`rounded-[5px]`, `rounded-t-[2px]`);
- a Tailwind palette colour (`bg-amber-500`, `text-white`);
- in `components/`, and in a `.tsx` module of a family's browser half, a hex
  colour literal.

It runs in `bun run lint`. Test and tooling files are exempt — the one
override class in `.oxlintrc.json`: tests, render specs, the harness and the
runner configs, whose hex strings are tag-colour fixtures or rule cases, not
styling. Stories are not in it: a story is UI and is held to the tokens.

**Liveness — "this class emits CSS."** Resetting Tailwind's namespaces
leaves every default step (`text-sm`, `text-sm/6`, `shadow-xl`, bare
`rounded`, `rounded-3xl`) reading like a class while compiling to nothing.
`harness/tests/ui-utilities-live.test.ts` asks Tailwind itself. Its own
`Scanner` extracts the class candidates from each non-test UI module, with
comments blanked, and each candidate is compiled against stock Tailwind and
against `index.css`. A candidate that stock Tailwind turns into CSS and kb's
stylesheet does not is dead, and the test names its file and line.
Comparing against stock Tailwind is what separates a dead class from the
scanner's noise, which emits nothing under either. A fixture test pins the
comparison itself: `text-sm/6` is dead and `rounded-md` is not.
`NOT_CLASSES` exempts the few scanned occurrences that are not classes.
Today there are two, both the word `shadow`: tailwind-merge's theme key in
`lib/cn.ts`, and prose in the lab's Light study description. Each entry
exempts one occurrence, the candidate inside an exact snippet of its file,
so the same word written as a class elsewhere in that file is still checked.
An entry that no longer covers any occurrence fails as stale.

The lint rule does not ask the liveness question, and the harness does not
ask the policy one. Both run in `bun run verify`, so pre-commit and CI apply
them. They are two `#rule` nodes, "Design tokens: no bypass" (lint) and
"Design tokens: every class is live" (harness), each with its `#check`. A
rule's enforcement is derived from one shared check surface, so two
surfaces make two rules.

A sanctioned exception is the soft-rule mechanism for few sites (root
`CLAUDE.md` → Drift markers and gaps): a pinpoint
`oxlint-disable-next-line design-tokens/no-raw-design-value -- GAP [[id]]`
and a `#gap` node. One gap uses it today: three corners sit off the
radius scale (see Radius above), left out of the no-visual-change
restructure because closing it is a visible change. (The graph's
query-error chip, the other one, reads the `warning` token now.) A stylesheet cannot carry a lint disable, so the one CSS site
(`.kb-md-code`) carries a bare `GAP [[id]]` comment, which the harness's
gap-marker check resolves like any other.

### A dead token is a duplicate

`lib/tokens.test.ts` fails when a layer-1 property is read by nothing, which
is how `--border-width`, `--font-weight-emphasis` and the one-use radius
aliases were found and deleted. It also fails when the scale lists in
`lib/cn.ts`, the bridge and layer 1 disagree.

## Layout

```
./
  packages/app/server/src/index.ts              # stable facade (re-exports startUi / runUiCli / …)
  packages/app/server/src/
    server.ts                    # Bun.serve boundary + Effect Scope stop + fs-watch
    http.ts                      # Effect REST/API + asset GET + SPA fallback
    delivery.ts                  # 304 revalidation + brotli/gzip for every answer
    session.ts                   # Effect SubscriptionHub (WS protocol)
    assets.ts                    # Effect ui/dist static + .kb/assets
    saved-queries.ts             # Effect .kb/queries listing / virtual nodes
    paths.ts                     # KB_PKG_ROOT, UI_DIST
  packages/contract/contracts/src/protocol.ts        # WS/HTTP message types (zod) — shared contract
  ui/                            # Vite app (own package.json)
    src/{stores,components,ds}/ ...
    dist/                        # built assets, committed? → no: built on demand
```

`kb ui` with no `ui/dist`: auto-builds on first run and caches — the command
shells out to `bun install && bun run build` (`vp build`) in `ui/` when the
SPA is missing or **stale** (a source fingerprint written to
`ui/dist/.kb-build-hash` at build time vs the current sources; a rebuilt
install that touches lockfiles cannot loop). Fresh build = fast no-op.
`kb ui --dev`: spawns the Vite dev server (`vp dev` on 5173, `--dev-port` to
override) as a child of the kb backend and proxies `/api`, `/assets`, `/ws` to
it via `KB_UI_API_PORT`; the child is killed on SIGINT/SIGTERM and the backend
stops when the child exits. No new global deps.

## Milestones (max parallel)

Contract first, then two independent tracks, then join:

- **U0 (me, small)**: `packages/contract/contracts/src/protocol.ts` — zod types for HTTP/WS
  messages + written API contract in DESIGN-UI.md. Everything else codes
  against this.
- **U1 server (cursor)**: `kb ui` command — Bun.serve static+API, fs-watch,
  SubscriptionHub v1, tests via WS client. Depends on U0 only.
- **U2 frontend shell (cursor)**: Vite app, graph load → client DataScript,
  read-only outline (fork nxus components), search, collapse/zoom. Talks to
  a mock server built from protocol.ts fixtures. Depends on U0 only. ∥ U1.
- **U3 editing (cursor)**: mutations pipeline (optimistic tx → action POST),
  props/tags editors, [[ref]] autocomplete, backlinks. After U2; runs ∥ U4.
- **U4 query page + live wiring (claude)**: datalog/saved-query page, WS
  client, tx-delta ingestion, persistence polish. After U1+U2; ∥ U3.
- **U5 (me)**: integrate on main, e2e smoke (playwright against `kb ui`),
  docs (AGENTS.md note), commit.

Cursor:claude stays ≈3:1. Same orchestration recipe as last wave
(explicit `cursor-agent --trust -f` terminals, inject, verify, review each
diff with cavecrew-reviewer, I fix and merge).

## MCP Apps backbone (this wave), apps later

New module `packages/application/operations/src/render.ts`: `render(queryRows, template, format: "html" | "md")`
— pure functions, no deps. Consumed by three surfaces from day 1:

1. md materializer (existing templates migrate onto it),
2. web UI's rendered-view panel (saved query → html block),
3. kb MCP registers `ui://kb/view/<name>` resources (MCP Apps extension
   shape); the `render_view` tool is the `render.view` registry action,
   projected like every other action.
   Later "apps" = new template + query pair, registered by name. On-the-fly
   generative UI (model writes the template at answer time) also lands on this
   API — the client just passes a template string instead of a name.

## Packaging ("app like other apps") and dist

Decision: **don't commit `ui/dist`** — built artifacts in git churn every
diff. Instead, two install shapes:

- Now: checkout-based (global `kb` wrapper already installed by HM); first
  `kb ui` run builds `ui/dist` into a gitignored dir, cached until sources
  change (source fingerprint vs `ui/dist/.kb-build-hash`). Fresh machine cost:
  one `vp build` (~seconds), automatic.
- Clean "like other apps" shape, when the tool stabilizes: a **nix package
  in `pkgs/`** (buildable derivation: bun deps pinned via lockfile hash, vp
  build in the sandbox, wrapper binary), installed from `home.packages` like
  chat2db/logseq-nightly. Then `rebuild` ships kb+UI as a versioned unit and
  no checkout is needed. Homebrew cask adds nothing over that for a personal
  tool. Backlogged as a kb todo, not in this wave.

## Workspace motion and exploration

`WorkspaceState` owns loading and empty-state presentation across the app. Its
decorative node companion uses CSS shading and vector curves, stays sharp at any
pixel ratio, and performs one finite arrival and glance. Readiness never waits
for animation. Loading copy is a live status; decorative shapes are hidden from
assistive technology. `motion.css` owns these gestures and the shared palette /
toast entrance; the global reduced-motion rule applies to all of them. Editing
rows and text do not move.

`WorkspaceBoundary` unifies explicit data loading and lazy module loading.
Ready content fades in over 280ms using opacity only; it mounts and accepts input
immediately, with no minimum loading time. Ordinary data updates preserve the
mounted content and any active edit. The catalog includes a loading-to-ready
study to inspect this transition.

Explicit device-theme changes use a single browser View Transition around the
preference commit, so text, DOM surfaces, and canvas snapshots crossfade together.
The shared theme glyph turns between sun, moon, and system icons. Reduced motion
and browsers without the snapshot API apply the preference immediately. Rapid
choices supersede earlier pending transitions; boot and cross-tab synchronization
stay immediate.

The component catalog's `Workspace/WorkspaceState/Study` is the isolated motion
preview: replayable light/dark examples, with no workspace data access. This is
the first place to review visual experiments.

Proposed in-app playground: an ordinary canvas named Playground, reached through
existing canvas navigation (and existing pinning if desired). Contents remain
nodes and assets, with the same editing and deletion model as other canvases.
Future interactive 3D scenes need a reusable asset/view contract before adding a
renderer; a bespoke playground datastore or app-wide pet overlay is not part of
this direction. (Technique studies live in the lab — see The lab — and reach
working views only through its shared kit.) Three.js WebGPU/TSL and Blender glTF assets are candidates for
that renderer. TypeGPU requires a measured compute use case. Smooth silhouettes,
antialiasing, readable text, and no accidental polygon faceting are acceptance
criteria. See `docs/graph-audit-2026-09-06.md` at the repository root for the
graph interaction and rendering repair proposal.

Milestone direction (proposal): **a new bridge**. After a successful, deliberate
relationship creation joins two previously disconnected groups in the current
graph perspective, the new edge receives one short pulse and its endpoints
respond. This marks a structural event rather than guessing that more nodes or
completed tasks mean progress. All relation forms participate according to the
perspective's semantics. Loading, imports, filtering, failed writes, undo/redo,
and remote changes must not trigger a celebration. Keep it transient and local
to the relationship; do not add a parallel achievement datastore or a universal
task/streak model. Implementation is deferred until the shared relationship
creation path exposes the confirmed gesture and before/after graph consistently.

Art direction for future graph atmospheres (proposal): Observatory (nodes as
stars, relationships as constellations), Porcelain (smooth ceramic forms in
daylight), and Ink (precise points and fine lines). Atmosphere belongs to the
existing perspective as a relationship to an allowed-value node. A curated
shuffle may change this presentation without changing node identity, query,
semantic color mapping, selection, or camera. It must use the renderer's supported
settings contract and preserve readable labels, smooth silhouettes, and a clear
distinction between real graph elements and decoration. This is not implemented
by the current graph repair.

## Port

Fixed default `4321`, `--port` override, auto-open browser on start, bind
127.0.0.1 only. `--port 0` binds any free port: the server prints the URL it
bound, and `.kb/ui.json` records it, so a process that starts a server for
another root reads its address back from presence. **Portless later** (noted
as backlog): unix-domain-socket transport for local subscriber apps; the
browser still needs a TCP port, everything else can go UDS.

### Field-based graph perspectives (2026-09-07)

The graph-first product principle lives in
[AGENTS.md → Rule 1](AGENTS.md#rule-1--abstraction-before-addition).
A graph perspective is a view node whose view is a renderer (DESIGN.md →
Kinds, roles and options → View nodes): its `sys.f.view` names the renderer,
and its lens props are that renderer's params. Its query selects nodes; its
relationship sources select edges; its encodings map fields to label, color,
size/area and group. The graphs the page's picker and the sidebar's Graph
section list are a query over view nodes whose view is in the renderer family
(`familyViewNodesQuery`), not a tag. The UI edits the existing lens fields,
the renderer switch replaces the node's view, and “Save as new perspective”
creates a new view node, filed in the Views list, through the shared action
pipeline. It does not create a separate preset store. New source values
reference field nodes or the seeded source options. The ten sources are one
`sys.graph.sources` list that each source-selecting lens field narrows by
`kind` through a `targetQuery` (DESIGN.md → Kinds, roles and options).
Legacy string settings remain readable and existing values are not rewritten by
seeding. A pinned graph stays pinned: the node keeps its id, so its pin (a
reference to it) still resolves. Search, selection, legend dimming and camera position are transient.
Ontology membership remains a separate scope on the same projection.

Each renderer is a view in `ViewPoint` (UI points: routes and views →
Families of views). Its key, in `@kb/graph` (`views.ts`), owns its settings
(its `params`), its supported encodings and its interaction capabilities; the
graph plugin provides its component. The shared frame disables unsupported
camera operations with a reason, and the settings panel disables every
setting the renderer's params do not declare. A new renderer contributes a
view under such a key and draws the same extracted nodes and edges. The
stable source/renderer vocabulary lives in `@kb/model`; browser components never
reach into backend files through aliases.

Tree is a deterministic spanning projection of the chosen directed edges. Each
node occurs once, including in graphs with cycles or shared descendants; this
never changes the stored relationships. Collapse preserves scale and anchors
the clicked branch at its prior screen position. Treemap uses the selected group
and area encodings. Numeric fields sum finite values, clamped to zero; zero and
missing measures receive no area and are counted explicitly. Equal size shows
all nodes. Category and label fields use their displayed values, resolving node
references to human text. Legend toggles dim the chosen category; overlapping
search/filter/focus constraints preserve a readable minimum opacity.

Engine direction: retain Sigma/Graphology for 2D networks, d3-hierarchy for tree
and treemap, and three's WebGPU renderer on the scene kit, laid out by
d3-force-3d, for 3D (3d-force-graph was retired in wave 2026-09-24 g: its
WebGL renderer and composer could not take the kit's stage and post chain).
This change does not add another rendering dependency. [Cytoscape.js](https://js.cytoscape.org/) and
[AntV G6](https://github.com/antvis/G6/tree/v5) are viable graph-engine alternatives,
but adopting either would require a measured capability/performance advantage.
Borrow [G2's](https://github.com/antvis/G2/tree/v5) separation of data, transforms,
and encoding channels, and [Bloom perspectives](https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/bloom-perspectives/)
as a product precedent for saved views of one graph.
[Neo4j NVL](https://neo4j.com/docs/nvl/current/) accepts node/relationship data
through adapters; using a Cypher ecosystem renderer would not require changing
kb's datastore or query model.
