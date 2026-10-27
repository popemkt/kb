# Canvas: what the owner did with tldraw, and how kb does all of it (research and plan)

Date: 2026-10-28. Base: `main` at `3a1b88e`. This record is the plan for the
second round of canvas parity. The first round's plan is
[`docs/brainstorms/2026-10-17-kb-canvas-tldraw-parity`](../brainstorms/2026-10-17-kb-canvas-tldraw-parity/README.md),
and the canvas's spec is [DESIGN.md → Canvas documents](../../DESIGN.md#canvas-documents)
and [→ Scripts](../../DESIGN.md#scripts). This record restates neither; it
links to them.

The owner's ask: *"Refine the canvas extension so that everything we did with
tldraw recently, and in future, can be replicated by our extension, including
things like tldraw computer, and so that kb handles a good amount of that kind
of data."* The canvas is a generic tldraw-like product. The owner's tldraw
conventions (drill-down, agent ledger, audit log, back badges) are usage built
on generic features. They are not features to hard-code here.

Inputs (not committed; they are the owner's files):

- the owner's board `outstanding.tldraw`, unzipped and read with sqlite;
- the `tldraw-conventions` skill, with its drill-down pattern and handler
  script;
- the `tldraw-offline` skill, which is the agent API of the tldraw desktop
  app;
- a gather of tldraw's SDK and AI products, with sources;
- the 2026-10-25 canvas UX pass (dotfiles `docs/research/2026-10-25-canvas-ux-pass.md`);
- [`2026-10-24-canvas-perf.md`](2026-10-24-canvas-perf.md).

## 1. What the owner used

### The board

`outstanding.tldraw` is a ZIP. It holds `db.sqlite` (tldraw-sync's storage:
`documents(id, state json, lastChangedClock)`), `metadata.json`,
`session.json` (camera per page), `preview.png` and `script/main.js`.

- **Records.** 5 pages and 221 shapes: 174 `geo` (all rectangles), 25
  `frame` and 22 `text`. There are no arrows, bindings, images, notes or
  draws. It is a dashboard of grouped cards with page navigation, not a
  diagram. The shape JSON is 210 KB, and 56 KB of that is `meta`.
- **Cards are records.** 131 "item" cards carry
  `meta {kind, id, lane, pri, owner, flag, desc, source, nodeIds[], area, theme}`.
  27 "research" cards carry `meta {topic, date, stale, staleReason, file, url, citedBy[], gist}`.
  `meta.nodeIds` holds kb node ids. **The owner was keeping kb-shaped records
  inside tldraw shapes.**
- **Frames nest** (area, then theme, then card), and a frame's name holds a
  count (`Decide (16)`). A child's coordinates are relative to its frame.
- **Rich text.** There are 160 bold marks and 61 link marks (PR references
  such as `kb#41`). A card also carries a `url`, set on every research card.
- **Drill-down.** There are 6 locked controls with `meta.drill = {to: pageId, focus?}`:
  2 summary cards, 2 `↘` badges and 2 `‹ Overview` back badges. One
  1.4 KB `main.js` arms a control on pointer down. On pointer up it switches
  page and zooms to `focus` or fits the page.
- **Ledger pages.** `Agents` holds one row per agent session, with a stable
  id `shape:ledger-<session>`. `Audit log` holds free text.
- **Legends** are small coloured swatches beside words.
- **Styles.** 9 colours, solid or semi fill, solid or dashed (dashed means
  stale), and mostly size `s`.

### The conventions (usage)

- Every board ends with the pages `Agents` and `Audit log`.
- Colour follows the concept family, and the board shows a legend.
- Drill-down has these rules:
  - Overview cards are uniform.
  - A `↘` badge goes only on an item that has a page.
  - An item page is named `Overview / Item`.
  - An item page carries a back badge to every page that drills into it.
  - Each page keeps one altitude.
  - Navigation is data plus one handler.
- The checks are: no dead badges, a back badge for every referrer, every page
  reachable from the root, and clean lints.
- Elsewhere: connections are bound arrows, diagrams come from mermaid,
  comments are threads, and a card's words are its label.

### The agent API the owner's agents used (`tldraw-offline`)

There are eight HTTP endpoints. Two run code: `/api/search` runs JS with a
read-side `api`, and `/api/doc/:id/exec` runs JS against the live `editor`
with `helpers`. The others handle create-doc, the script workspace, script
status, the snippet list, aborting a snippet and reload. §3 maps every member
the agents reach.

### tldraw computer and its relatives

- **tldraw computer** (experimental; Gemini 2.0 Flash):
  - Components (text, image, audio, drawing, camera) are nodes.
  - Arrows carry data.
  - Each component has an *instruction*, a reusable prompt. A model performs
    it on what flows in from the components connected to it.
  - Outputs pass forward step by step, so a flow can branch, loop and
    iterate.
  - Loops can run without bound and spend credits.
  - Sources:
    [the-decoder](https://the-decoder.com/tldraw-unveils-experimental-natural-language-computer-powered-by-gemini-2-0/),
    [talk](https://www.ai.engineer/talks/1C2TdPkj6aQ-tldraw-computer).
    Nothing official describes the engine.
- **The workflow starter kit** is the developer version of the same idea.
  - Nodes are custom shapes, and ports are bindings.
  - An `ExecutionGraph` runs each node's `execute`, upstream nodes first.
  - Values are numbers, and a `STOP_EXECUTION` flag stops a branch.
  - No AI node ships with it.
  - Source: [tldraw.dev/starter-kits/workflow](https://tldraw.dev/starter-kits/workflow).
- **Make real** sends the selection as an image to a vision model. The HTML
  it returns is placed in a sandboxed iframe shape, and the person annotates
  over it and runs it again.
- **The agent starter kit** gives the agent a screenshot, blurred shape data,
  the selection, the history and lints. The agent works through typed
  actions, in modes, with streaming.

## 2. What kb has today

See DESIGN.md → Canvas documents for the full statement. In short:

- One JSON Canvas document per `#canvas` node, in `sys.f.canvas`. Writes go
  through `commitCanvasEffect`.
- Pages are child canvases.
- `link {url | node | node+item | item}` on any item.
- Lints include `dead-link` and `unreachable-page`.
- `locked`, frames that nest (`group`), the style table, and a named palette.
- Bound edges with anchors, routes and heads.
- `path` items, including freehand and highlight strokes.
- Comments are `#comment` nodes.
- Scripts are `#script` nodes. They are trusted per digest, run in a Worker,
  receive `canvas.selection`, `canvas.change`, `canvas.item.click` and
  `canvas.page`, and draw anchored overlays.
- `ext.code.script.run` is tldraw's exec.
- The verbs: `describe`, `lint`, `place`, `arrange`, `connect`, `group`,
  `ungroup`, `promote`, `comment`, `export` (json-canvas, svg), `diagram`
  (query or mermaid flowchart) and `camera.migrate`.
- 2D and 3D projections of one document.

**kb is already ahead in one way.** Any item may carry a `nodeId`: the item
*stands for* a store node. Its words are then the node's text (`itemWords`),
and a `kb-node` card renders that text formatted (bold, links, refs) through
the outline's text surface. The canvas references the node, so the node's
backlinks list the canvas.

## 3. The agent API, member by member

Each tldraw-offline member an agent reaches is listed with kb's answer.
"Slice" names the build step in §6 that closes a gap.

| tldraw-offline | kb today | Status / slice |
|---|---|---|
| `api.getDocs`, `getFocusedDoc` | `graph.query` over `#canvas`; `ui.screen` for the focused tab | have |
| `api.getShapes`, `getBindings` | `describe` (relational, three levels); `export json-canvas` (raw) | have |
| `api.getComments` | `describe` → `comments` | have |
| `api.getScreenshot` | `ui.capture` of an open tab; `export svg` of any canvas | have (no png: GAP `01M54EPF1QB5MKA6WRK9DF2X1Y`) |
| `api.getScriptStatus`, `GET /scripts` | `ext.code.script.list` (grant, trust); no last outcome | gap, slice F |
| `POST /docs/create` | `node.add` tagged `canvas`, or `diagram` | have |
| `helpers.createShapeIfMissing(s)` (stable ids, idempotent) | `place` with `make.id` takes a caller's id but refuses one already there (not idempotent); `tx.apply` takes the whole document | **partial** (an idempotent create is not built) |
| `editor.updateShapes` (words, colour, style, url, lock, size) | only `tx.apply` (whole document) | **gap, slice B** |
| `editor.deleteShapes` | only `tx.apply` | **gap, slice B** |
| `helpers.translateShapes(ids, dx, dy)` | `place … at` one item at a time | **gap, slice B** (`edit` moves by `dx, dy`) |
| `createArrowBetweenShapes` | `connect` | have |
| `boxShapes` | `group` | have |
| `alignShapes`, `stackShapes`, `distributeShapes` | `arrange` | have |
| `reparentShapes` | `place … in` | have |
| `helpers.mermaid` onto an open board | `diagram` makes a *new* canvas, flowchart only | partial; deferred (§7) |
| `helpers.getLints`, `lints:{new,resolved}` | `lint`; every write answers `lints` | have |
| pages: create, rename, order | `node.add` / `node.update` of the page node | have |
| `setCurrentPage`, `zoomToBounds(focus)` | `ui.navigate` to `/canvas/<page>/<item>` | have |
| the board's page graph (drill checks) | `unreachable-page` lint only | **gap, slice A** (`describe → pages`) |
| `moveShapesToPage` | none | **gap, slice B** (`edit` with `toPage`) |
| `renderEphemeral` | script overlays (`kb.draw`, anchored) | have |
| `onShapeTranslate` | `canvas.change` event | have |
| comments: put, reply, resolve | `comment`; `node.update` of `sys.f.comment.state` | have |
| durable `main.js` | `#script` on `sys.f.scripts`, trusted per digest | have |
| `config.js` custom shapes, bindings and tools | none, by decision (parity plan, Non-adoptions) | not adopted |
| exec arbitrary JS against the editor | `ext.code.script.run` (verbs, not internals) | by design |
| `.tldraw` / `.tldr` files | none (question 6 of the parity plan) | **slice C** (import only, D4) |

## 4. Gap map

These are the gaps that matter for the owner's use and for "a good amount of
that kind of data", in order of value. Sizes are S (under a day), M (a few
days) and L (a week or more).

| # | Gap | Why it matters | Size | Slice |
|---|---|---|---|---|
| 1 | Records on cards: the board's `meta` has nowhere typed to live | 131 + 27 cards are records; kb is a graph of records | S (decision D1, then import) | C |
| 2 | Agents edit only by whole-document `tx.apply`, outside the relational verbs: no update, delete, stable-id create, move-by or move-to-page | the most-used tldraw calls; whole-document writes race | M | B |
| 3 | No import of the owner's existing boards | "replicate everything we did" starts with what is on disk | M | C |
| 4 | Drill-down: a locked linked control is not followed on a press; agents cannot read the page graph to check back badges | the owner's main navigation pattern | S | A |
| 5 | No dataflow ("computer") | named in the ask | L | E |
| 6 | Scale: nothing measures many pages, large records, many media items, or a write on a big board | "a good amount of that data" | M | F |
| 7 | Script overlays cannot take a press (GAP `01M54DFMDJFYRDM8ZZXQB749PQ`); no ticks for animation; no script status | tldraw's "little apps" and button recipes | M | D |
| 8 | Rich text per span on plain items | 160 bold and 61 link marks on the board | covered by D1 for record cards; text items stay plain | — |
| 9 | Diagram onto an existing canvas; mermaid sequence, state and mindmap | `helpers.mermaid` | M | later |
| 10 | Half-bound arrow (GAP `01M5QP271PQ15E7WZ36KEN055N`), png export, auto-size text, eraser | parity polish | S–L each | later |

## 5. Decisions

### D1. A card's record is a node; there is no `meta` field

tldraw's `shape.meta` is an untyped JSON bag. kb's answer to "a card carries a
record" already exists: an item carries a `nodeId` and stands for a node, and
the record is that node's fields. Fields are nodes, so they are typed,
queryable with datalog, shown in the outline and the inspector, and readable
by scripts through `kb.node`. A `meta` bag on items would be a second record
store beside fields. It would be untyped, unqueryable and invisible. That is
the bespoke storage shape that AGENTS.md → Rule 1 ("everything is a node")
names as the signal that the model is wrong.

So:

- **An item that carries a record stands for a node.** An item that is only a
  drawing (a swatch, a title, a frame) stays an item. This is a
  usage-driven half of roadmap step 7b. The other half stays deferred (owner
  question 1 of the parity plan): items do not *all* become nodes. A board of
  2000 items would mint 2000 nodes of decoration, and the measured cost in §8
  says the document model is the right home for drawings.
- Rich text on a record card is its node's text: bold, links and `[[refs]]`
  in the outline's one formatted surface. A plain item keeps plain words, and
  a single link mark on it becomes the item's `link {url}`.
- Unknown JSON keys still round-trip untouched (`extra`). Nothing reads
  them, and nothing new is added to them.

### D2. Storage and writes: one document, written by patch

- **The document stays one prop** (roadmap decision 6). The cost of a write
  is not the canvas's to fix. The JSONL store rewrites its whole file on
  every commit, whatever changed, and the SQLite store rewrites one row. §8
  measures it. If big layouts make the JSONL rewrite slow, the fix is the
  store-level sidecar for large props that decision 6 already names. A
  canvas-only file format is not the fix.
- **Writes become patch-shaped at the API.** A new verb, `ext.canvas.edit`,
  takes item and edge operations by id: update fields, move by a delta,
  move to another page, and delete. (Creating with a caller's id stays
  `place` with `make.id`; see Results.) It is a pure function over the document
  (`editCanvas`, `@kb/canvas`) like every other verb, committed by
  `commitCanvasEffect`. It reads the document as the call starts, not as the
  caller last saw it, so two agents editing different items of one board no longer
  overwrite each other through stale whole documents. `tx.apply` stays the
  whole-document write the UI and the importer use.

### D3. Drill-down is links plus pages; two primitives make it whole

- A drill badge is an item with `link {node: page, item?: focus}`, and a back
  badge is a link back. This is already the spec (Pages); no widget is added.
- **A locked item that leads somewhere is a control: a press follows it.** A
  locked item cannot be dragged, so a press on it has no other meaning. This
  is tldraw's locked-control convention without a handler script, and it
  makes the owner's `main.js` unnecessary. An unlocked item is still
  followed through its link mark, ⌘↵ or Follow.
- **`describe` answers the board's page graph** (`pages`): each page in order
  with its name, the links its items make to other pages (item, page, focus),
  and the pages that link into it. With it, a convention check ("a back badge
  for every referrer") is a few lines of an agent's or a script's code, and
  kb does not hard-code a lint for one person's convention.

### D4. Import `.tldraw` and `.tldr`, one way, lowered to kb's features

The parity plan's question 6 dropped `.tldr` import ("parity in feature,
built on top of existing features, not interoperable with tldraw"). The new
ask is that everything the owner did in tldraw can be replicated, and the
boards on disk are the first thing to replicate. So import comes back, held
to the old answer's intent:

- **One way.** There is no export to tldraw, and kb never stores tldraw's
  format.
- **Lowered to existing features.** Every record becomes something kb
  already has:

  | tldraw | kb |
  |---|---|
  | first page | a board |
  | other pages | child canvases |
  | frame | a `group` with a `label`; nesting becomes `parent` with absolute coordinates |
  | geo rectangle (and the other forms) | a `shape` |
  | text | a `text` item |
  | `meta` | a node's fields (D1); `meta.drill` becomes `link {node, item}` |
  | colour | the nearest palette name |
  | fill, dash, size, font | `style` |
  | `isLocked` | `locked` |
  | `url` | `link {url}` |
  | arrow plus bindings | a bound edge |

  What has no kb counterpart is named in the receipt (`reported`), as
  `diagram` reports mermaid statements it does not draw.
- `@kb/canvas` holds the pure lowering (`tldrawBoard`: records in, pages and
  nodes out). `ext.canvas.import` reads the file: a `.tldraw` ZIP's
  `db.sqlite`, or a `.tldr`'s JSON. It writes the board, its pages, the
  record nodes and the fields they need in one transaction.
- **The owner should confirm this reversal.** If it is declined, slice C is
  dropped and the rest of the plan stands.

### D5. Scripts: close the press gap; the rest exists

Scripts already react to clicks (`canvas.item.click`), to changes and to
pages, draw anchored overlays and write through the verbs. Most of the owner's
`main.js` uses are covered:

- the drill handler is covered by D3;
- "connection-dependent behaviour" by `canvas.change`;
- "furniture with anchored internals" by anchors.

What is missing:

- **Overlay controls take no press.** This is GAP `01M54DFMDJFYRDM8ZZXQB749PQ`,
  and the gap already states the fix: the frame tells the page the boxes of
  what it drew that take presses, and the page lets presses through only
  there. That is slice D.
- **No time.** The sandbox has no timers by design. Animation and simulation
  loops would need a view event the host paces (a `canvas.tick` a script asks
  for, bounded in rate). This is deferred, with a gap.
- **No last outcome in `script.list`.** This is slice F.

### D6. The computer is a run over the canvas's graph

The design follows tldraw computer, built from kb's parts:

- **A component is an item that stands for a node** (D1). Its node's text is
  the component's instruction. An edge is a connection: the data flows from
  its `fromNode` to its `toNode`.
- **The node says how it performs.**
  - A node tagged `#script` (or one whose `sys.f.scripts` names one) runs
    that script in the sandbox, with its inputs.
  - Any other node is an instruction for a model. Its node's text is the
    prompt, and the inputs are appended in edge order.
  - A component with no inputs and no instruction is a constant: its text
    is its output.
- **Its output is a field of its node** (`output`, text, one). The card shows
  it, the outline shows it, datalog reads it, and the next component reads it
  as an input. A run writes every output in one transaction per component.
  Each step is visible and can be undone.
- **The engine is pure and deterministic** (`flowPlan` in `@kb/canvas`).
  - It orders components by dependency: upstream first, ties broken by
    document order.
  - A cycle runs only to a bound the caller gives (`rounds`, default 1, at
    most 8). This is tldraw computer's loops without its unbounded credit
    spend.
  - A component whose input failed is skipped and named, like
    `STOP_EXECUTION`.
  - The engine is given a performer (a port). The engine never names a model.
- **Performers are the families that already own the work.**
  - A model instruction is one tool-less turn of the agent family's selected
    provider. It goes through a new action of that family
    (`ext.agent.complete {instruction, inputs}`, hosted where the agent
    bridge is, in `kb ui`), so provider choice, trust
    of its binding, credentials and the scripted runtime in tests are the
    agent family's, unchanged.
  - A script is `ext.code.script.run`'s runner.
  - The canvas family calls both through `CoreInvoke`, as `describe` calls
    `ext.code.script.list` today.
  - Tests use a stub performer, and the agent family's own test uses
    `scriptedRuntime`.
- **Action:** `ext.canvas.run {canvasId, from?, rounds?}` answers the order
  and each component's outcome.
- **Make real is a later component kind.** It needs a picture input (the
  png gap) and an HTML output drawn in the sandbox frame.

### D7. Scale targets

"A good amount of that kind of data" is set at 10x the owner's board, and at
the 2026-10-24 benchmark for one canvas:

- one board of 40 pages (tldraw's default page cap);
- 2,000 items on one page;
- 1,000 record cards (nodes with about 10 fields each);
- 200 picture items.

Each of these is measured by a test that runs in `bun test` and asserts the
operations stay within a stated budget:

- parse and stringify;
- `describe` and `lint` (both read the whole board's page graph);
- `edit` of one item on a 2,000-item canvas;
- the commit;
- import of the owner's board.

Whatever misses its budget is fixed in that slice, or named as a gap with
its number.

## 6. Build plan

Each slice is its own PR, stacked on the one before where it reads it. Each
carries its tests, and its DESIGN.md text where it adds behaviour. UX slices
carry screenshots in `.kb/assets/kb-canvas/2026-10-27/` (not committed).

| Slice | What | Packages | Size | Stacks on |
|---|---|---|---|---|
| A | Drill-down primitives: `describe → pages` (page graph with referrers); a press on a locked item that leads somewhere follows it | `canvas` (`pages.ts`, `describe.ts`), `canvas-ui` | S | main |
| B | `ext.canvas.edit`: create with ids, update, move by, move to page, delete; tests over locks, frames carrying members, lints | `canvas` (`edit.ts`), `ext-canvas` | M | A |
| C | `ext.canvas.import` of `.tldraw` / `.tldr`; the owner's board as the fixture (5 pages, 25 frames, 158 record nodes, 6 drill links) | `canvas` (`tldraw.ts`), `ext-canvas` | M | B |
| E | `ext.canvas.run` (dataflow) with `ext.agent.complete`; stub performer in tests | `canvas` (`flow.ts`), `ext-canvas`, `agent` | L | B |
| F | Scale suite (D7) and the fixes it calls for; last outcome in `script.list` | `canvas`, `ext-canvas`, `code` | M | C |
| D | Script overlay controls take presses (closes `01M54DFMDJFYRDM8ZZXQB749PQ`) | `sandbox`, `code-ui`, `canvas-ui` | M | main |

The order is A, B, C, E, F, then D. A and B are what every later slice uses.
C brings the owner's boards in. E is the named feature. F proves the data
volume. D is the deepest UI change and is independent of the others.

## 7. Not adopted, or later

- **Not adopted:**
  - `config.js` custom shapes, bindings and tools;
  - code against editor internals;
  - export to tldraw;
  - embeds;
  - LAN sharing (kb's tabs already share one store);
  - a `meta` bag (D1).
- **Later, each with a node:**
  - mermaid sequence, state and mindmap, and a diagram onto an existing
    canvas;
  - the half-bound arrow;
  - png export;
  - auto-size text;
  - `canvas.tick` for script animation;
  - make real;
  - a canvas mode for the in-kb agent (agent starter kit).

## 8. Results

What landed overnight on 2026-10-28, one PR per slice, each stacked on the one before:

| Slice | PR | What it does |
|---|---|---|
| A | #53 | `describe → pages` (the board's page graph, with referrers); `boardPages`; pressing a locked item that leads somewhere follows its link (`controlLead`) |
| B | #55 | `ext.canvas.edit {update, move, delete, toPage}` by id, in order, as one write; `nudgeItems` is shared with the keyboard |
| C | #56 | `ext.canvas.import` of `.tldraw` and `.tldr`, one way; pure lowering `tldrawBoard` |
| E | #57 | `ext.canvas.run`: engine `flowPlan` and `runFlow`; constant, script and model performers; outputs in an `output` field |
| F | #58 | Scale suite at D7's targets, and the fixes it needed |
| D | — | Not started (see below) |

**Tests** (each suite run alone):
- `@kb/canvas` package: 311 pass. That includes `tldraw.test.ts` (7) and `flow.test.ts` (7).
- Runtime:
  - `canvas-verbs`: drill-down across pages;
  - `canvas-edit`: 3 pass;
  - `canvas-import`: 4 pass. It builds a `.tldraw` zip holding a sync `db.sqlite` in the test.
  - `canvas-run`: 2 pass. A real trusted sandboxed script doubles its input.
  - `canvas-scale`: 7 pass.
- `canvas-ui` vitest: 826 pass (slice B).

**The owner's `outstanding.tldraw`** imports in 167 ms:
- 5 pages, 221 items, 192 record nodes, 23 fields;
- nothing reported;
- `describe.pages` shows Overview → Gaps / Research and both back-links;
- pressing the Gaps drill card in the browser opens the Gaps page.

Screenshots are in `.kb/assets/kb-canvas/2026-10-27/` (not committed).

**Scale (D7)** on shared-server, at 40 pages, 2,000 items, 1,000 records and 200 pictures:

| Operation | Before | After | Budget |
|---|---:|---:|---:|
| Import (40 pages, 1,020 records) | 632 ms | 428 ms | 5,000 |
| Commit the whole page | 220 | 193 | 2,000 |
| Parse / stringify | 9 / 3 | 8 / 2 | 150 |
| `describe` the page | 877 | 85–128 | 600 |
| `lint` the page | 50 | 49 | 600 |
| `edit` one item | 187 | 178 | 1,500 |
| Reopen the store | 147 | 132 | 1,500 |

**Changes to the plan:**
- **D2.** `edit` does not create items. Creating with a caller's id is `place` with `make.id`, which refuses an id that already exists. It is therefore not idempotent the way `createShapeIfMissing` is.
- **D6, the model performer.** `ext.agent.complete` cannot be registered yet. The agent family is hosted by `kb ui` only, and hosted plugins contribute no registry actions: GAP `01M53F2M2S6J3WW0Z0KR136J6A`, which now names it. Until then, a run fails instruction components by name and skips everything downstream of them. The engine is tested with a stub model performer.
- **D6, outputs on cards.** The card shows its node's text, not its `output` field. The output can be read in the outline and through datalog.

**Left, and why:**
- **Slice D** (script overlays take presses, gap `01M54DFMDJFYRDM8ZZXQB749PQ`): the deepest UI change, and it is independent of the others.
- **`ext.agent.complete`**: waits on hosted actions (the gap above).
- **Last outcome in `script.list`**: from slice F; not done.
- **Import fidelity:**
  - Text height is estimated, so some imported text items are clipped.
  - Rotation is not kept.
  - Image shapes are not imported.
- **Showing `output` on a card**: not done.
