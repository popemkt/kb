# Safe deletion: Trash is a place, and delete is a move there

Status: **design, for the owner.** Nothing here changes code.

Date: 2026-11-17.
Inputs:
- kb `main` at `46bf7053`;
- DESIGN.md → [Data model](../../DESIGN.md#data-model--everything-is-a-node)
  (the write rule for `sys.*`, hiding `sys.*` as a display rule),
  [The plan graph](../../DESIGN.md#the-plan-graph), [Merge](../../DESIGN.md#merge),
  [Backups](../../DESIGN.md#backups),
  [The transaction tail](../../DESIGN.md#the-transaction-tail--the-store-records-what-changed-in-order),
  [Action registry](../../DESIGN.md#action-registry) (declared approval,
  Current stance), [Plugin data migrations](../../DESIGN.md#plugin-data-migrations),
  [Days](../../DESIGN.md#days);
- DESIGN-UI.md → Contextual references, the commit decides, Move and leave
  reference, Canvas (i3), transient prune;
- AGENTS.md → [Data-plane freedom](../../AGENTS.md#data-plane-freedom);
- the [node placement design](2026-11-17-node-placement.md) (#254, #255),
  the [inbound Google Calendar design](2026-11-12-gcal-inbound.md) (#194) and
  the [data-plane design](2026-11-10-data-plane-fields-events.md) §6.4;
- #251 (display text), which is where a reference to a deleted node gets its words today;
- the Tana, Logseq, Notion, Obsidian, Roam, Anytype and Capacities
  documentation and forums, read on 2026-11-17 (§3).

The owner asked:

> do a research on safe deletion and delete-protected nodes. I think usually
> Tana doesn't delete nodes, it just moves them to trash, and leaves a
> reference to a trashed node, and you can always restore. That helps with a
> lot of quirks (keeping traceability, also keeping the node functional more
> or less).

## 0. The answer in one screen

**Recommendation: (A), Trash is a node and deleting is a move into it.**
`node.delete` keeps its name and changes its meaning. It moves the node, with
its subtree, under a seeded `sys.trash` node, and stamps where the node came
from. "Trashed" is not stored anywhere. It is read from the node's place, the
way kinds are read from tags. A reference to a trashed node still resolves,
so the node keeps working: its tag still types its members, its field still
keys their values, and a query still finds it. Display surfaces mark it as
trashed, or hide it. Permanent deletion is a new action, `node.purge`. It
declares required approval, so an agent over MCP never sees it, and it only
takes a node that is already in Trash.

| Piece | Design |
|---|---|
| The concept | **Removal**: a person takes a node out of their graph. It has two depths: *trash*, which can be undone and keeps everything, and *purge*, which cannot be undone and is final |
| The place | `sys.trash` ("Trash"), a node core seeds. Its children are the trashed roots, newest first. It is a page like any other, with a table view over the trash fields |
| The state | **trashed** = the node has `sys.trash` as an ancestor. This is derived and never stored: `trashRootOf(id)` in `@kb/model` is the one reader, and the index derives a `:node/trashed` datom from it, as it derives mentions |
| The provenance | three fields on the trashed root, managed by core: `trashed from` (ref to the old parent), `trashed rank` (its sibling rank there) and `trashed at` (date). The commit stamps them on any move in and clears them on any move out, so a drag works the same as the action |
| The actions | `node.delete` moves to Trash, or purges when nothing would be lost (§6.3). `node.restore {id, to?}` moves back. `node.purge {id}` declares approval required. `trash.empty {olderThan?}` is a purge of many |
| The promise | **`node.delete` never loses content and never leaves a reference dangling.** It is one property in the store contract suite, run over every backend |
| Display rule | Trash is a display rule, never a resolution rule, which is the rule kb already has for `sys.*`. Resolution (kinds, ref values, field keys, datalog) sees trashed nodes. Search, pickers, views and backlinks hide them by default. A reference draws them struck through, as "in Trash" |
| Protection | the system-write rule reads "moved under `sys.trash`" as a delete, so the same refusal covers `sys.*`, with no new lock. Purging a field that holds values or a tag that has members is refused until they are detached (§7) |
| Agents and CLI | `kb rm` and MCP `node_delete` trash. `kb rm --purge` is `node.purge`, which asks on the tty. MCP cannot purge |

Rejected: (B) a `trashed` flag on a node left in place, which needs every
reader that walks children to filter, and so puts a filter at many call
sites. Also rejected: (C) tombstones kept outside the graph (a trash file or
a log), which keeps the content but not the node: references still dangle and
nothing keeps working.

**Say no, or stop early, if** the owner wants git to be the trash for
repository stores (§10), or the derived `trashed` datom costs more on a large
move than the index budget allows. §10 has the full list.

## 1. The concept, named

Rule 1 asks for a name first. Today kb has one word, *delete*, for three acts
that do not mean the same thing:

1. **A person removes a node** they no longer want: ⌘⌫, the Delete command,
   `kb rm`, an agent's `node_delete`. It should be safe, so it can be
   undone after a reload, on another machine, or by another person.
2. **A surface retracts something that was never content**: an empty
   transient row the page made and pruned, the empty row a paste replaces,
   a pin a person unpins, the source of a merge after its text and children
   have moved. Nothing is lost when these go. A Trash full of empty rows
   would be noise.
3. **The store forgets a node for good**: a purge. Content is gone, and
   anything that pointed at it now dangles.

The first and third are the two depths of one concept, **removal**. The
second is the first applied to a node that holds nothing, so the trash step
has nothing to keep. That distinction can be read from the node (§6.3), so it
belongs in the data and not at the call sites. Today it lives in one page
predicate, `isPrunableTransient` (`packages/extension/outline-ui/src/outline.store.ts:454`).

## 2. What kb does today

### 2.1 The write

`node.delete` (`packages/application/operations/src/actions.ts:104-125`,
`planNodeDelete` at `:478-490`) is a **hard delete**:

- It removes the node, and by default its whole subtree
  (`collectSubtreeIds`), from the store, and detaches it from its parent's
  `children` (`detachFromParents`). Nothing of it is kept.
- `descendants: "reparent"` is meant to keep the children, but **it is
  broken**. It deletes only `[id]` and never moves the children, so the
  commit's `orphanError` (`packages/domain/model/src/tx.ts:106-127`, "delete
  would orphan descendant") refuses it for any node that has children. No
  caller uses it: the UI always sends `cascade` (`ui/src/actions/plan.ts:113`)
  and `kb rm` has no flag. It is a dead seam (Rule 1: wire it or delete it).
- `force` bypasses the system-write rule. `node.batch` takes deletes without
  `force` (`node-batch.ts:49-52`). `node.merge` appends the source's text and
  children to the target, then deletes the source. **The source's props are
  dropped, and references to it are not redirected.**
- `systemTxRefusal` (`packages/domain/model/src/system-write.ts:190-201`)
  checks deletes first. Any `sys.*` id in the deleted set, a descendant in a
  cascade included, refuses the whole write with `rule: "delete"` and the
  wording "… is its owner's to delete". The check goes by id prefix only, so a
  family's seeded nodes with plain ids (`days.journal`,
  `approval.policies`, `view.approval.policies`) can be deleted without
  force. A virtual node (a saved query's `.edn`) is refused with "change it
  there".
- **No approval.** `node.delete` declares `{kind: "write"}`. MCP lists it
  (`node_delete`), with `force`. The decision node
  `01M3R2KDV741XFGS3509BQ443X` lists "which actions require approval" as
  open. Governance does not gate it, because graph policies are deferred
  (`01M5E2DAVRH5CWKM27BVDYW19T`).

### 2.2 What points at a deleted node

**Nothing is cleaned up, by decision.** `packages/app/test-kit/src/harness.ts:44-68`
states it: "inbound content refs to a deleted node are intended (resolver
warn, never rewrite); dangling structural children are a violation".
`contentDanglingRefs` (`:405-423`) tolerates three kinds:

- a `{t:"ref"}` prop value whose target is gone. The index stores it as a
  string sentinel, not a ref join (`query/src/index/datoms.ts:36-46`);
- an `[[id|label]]` in text. The mention datom is skipped
  (`datoms.ts:190-196`), so `kb backlinks` simply stops listing it;
- **a prop key naming a deleted field**. Deleting a field orphans every value
  keyed by it, on every node, invisibly.

Deleting a tag leaves its members' `sys.f.type` refs dangling. Their chip
disappears without a trace (`chipTagsOf`, `model/src/node-like.ts:66-75`).
Views are not cascaded (GAP `01M3YM5Y5XYDZ1C7G0PCQ1RMK8`). A write is held to
`refs missing node` only for values it writes itself
(`writtenValueError`, `tx.ts:160-185`), so an old dangling ref survives
edits, but re-adding one fails.

One useful property already exists: the index re-reads a node's referrers
when a target "starts or stops existing" (`datoms.ts:58-63`,
`node-table.ts:205-208`). **A node that comes back with the same id re-links
every old reference.** Undo depends on this, and so does every design below.

### 2.3 How a reference to a deleted node looks (#251)

#251 made a node's display text one projection. A reference reads as
`refName` (`packages/domain/model/src/display-text.ts:33-50`): "its label,
when it has one; else the name of the node it names; else, that node gone,
its id". `RefLook` (`kit/ui-sdk/src/lib/ref-look.ts:15-25`) has `ink` and
`name`, and **no missing state**. So:

| Surface | A deleted target reads as |
|---|---|
| inline pill `[[id\|Rob]]` | **"Rob", as an ordinary pill**. Nothing shows it is gone; a click opens "“id” is not in this workspace" |
| inline pill `[[id]]` | the raw id |
| reference row (`sys.f.ref.target`) | the `[[id]]` token, read-only, "Reference target is missing" (`contextual-ref.ts:88-93, 158`) |
| ref field value | a warning glyph and the id, "Unresolved ref: {id}" (`UnresolvedRefChip`, `outline-ui/src/field-value.tsx:632-662`); with a label, quiet |
| tag chip | gone, silently |
| canvas card | a red box, "missing {id}" (`canvas-ui/src/canvas-card.tsx:117-125`); a link item "Leads to {id}, which is gone" |
| pinned entry | dropped from the sidebar; the pin node stays |
| a pane on it | `NotFound`, "“{id}” is not in this workspace." |

So there are five different looks for one state, and the most common one
(a labelled pill) shows no sign at all. That needs fixing whatever is
decided here (§9, P0).

### 2.4 Undo, history and backups

- **Undo is per tab and lost on reload.** `restoreInvocations`
  (`ui/src/actions/restore.ts:59-125`) diffs the graph before and after and
  re-adds each missing node with `node.add {id, text, props, parent,
  position}`, shallowest first. The ids are the same, so references re-link.
  `createdAt` is re-stamped. The stacks hold 200 steps in the zustand store
  and are reset by `hydrateFromWire`. DESIGN-UI.md: "there is **no**
  server-authoritative undo journal".
- **The tail keeps ids, not content.** `KbTx.ops.deletes` is `NodeId[]`.
  `.kb/tx.jsonl` is not committed and compacts at 2048 records. Nothing
  server-side can undo a delete.
- **Backups are whole-graph and manual.** `store.backup` keeps 3 by default.
  `store.restore` (approval required) commits `diffTx(now, backup)`, which
  also rolls back every other write since the backup. It is a rollback, not
  a restore of one node.
- **Git** keeps a deleted node in a repository store's history once
  `nodes.jsonl` was committed. That is a real recovery path for this
  repository, but not for the home store, not for a delete made since the
  last commit, and never with its references still working.

### 2.5 Every delete in the code, by intent

| Caller | Intent (§1) | Confirm today |
|---|---|---|
| ⌘⌫ / ⌘⌦ subtree, selection ⌫, ⌘X, Delete command (`commands.tsx:632`) | 1, person | none |
| Backspace on an empty leaf (`deleteEmptyRow`) | 2, nothing to keep | none |
| transient prune (`browser-host.ts:85-89`, `graph.drop`) | 2 | none, no undo entry |
| paste into an empty row (`ingest.ts:224`) | 2 | none |
| unpin (`mutations.ts:451-455`), gallery pins dropped from a draft (`gallery/src/look.ts:224-227`) | 2 (a reference row with nothing of its own) | none |
| `node.merge` source | 2 if its props are empty and no one references it, else 1 | none |
| routine editor "Delete it and its history", sync setup removal | 1, with side effects in Google | two-step / dialog |
| `kb rm`, MCP `node_delete`, `node.batch` deletes | 1 | none |
| canvas ⌫ | removes the card only, never the node | — |

### 2.6 Families that depend on deletion

- **Seeds.** `ensureSystemSeed` re-adds every seeded id it misses on open
  (`domain/seed/src/seed.ts:738-744`, GAP `01M413SPC35K20DFC4TRP4DJYH`). A
  seeded node its owner deletes comes back.
- **Days.** A period's id is derived from its key (`days.2026-11-16`). It is
  found by `sys.f.days.key`, and one node per key is a commit guard. A deleted
  day is re-made silently on the next capture. A deleted journal root is
  re-made and the `sys.f.days.journal` setting rewritten.
- **Routines** push to Google and have no inbound import yet. The engine
  notices that a routine is gone through an in-memory `seen` map
  (`routines-host/src/engine.ts:166-230`), ends the series at yesterday or
  cancels a one-off (`push-plan.ts:37-60`), and holds more than five at once
  for release. **A routine deleted while the host is stopped is never
  retired in Google**, because the node is gone and nothing durable says it
  was there (the routines design's "no durable deletion journal"). Event ids
  are deterministic (`projection.ts:264-270`), so a routine that comes back
  with the same id re-targets the same Google event.
- **Inbound Google Calendar** (designed, #194, not built) treats a missing
  node as "not imported yet", so a deleted imported event comes back on the
  next sync. Its decision 8 asks whether a dismissed event should stay away.
- **Merge between clones** records a `deleted-and-modified` conflict when one
  side deletes and the other edits (`model/src/merge.ts:18,148-153`).

## 3. What other tools do

Read on 2026-11-17. Where the documentation is silent, the table says so
rather than guessing. Tana's docs now live at `outliner.tana.inc`.

| Tool | Shape | Children | References to a trashed item | Restore | Purge and retention | Schema objects |
|---|---|---|---|---|---|---|
| **Tana** | a move to a per-workspace **Trash node** (`Open trash`) | owned nodes are part of their owner and go with it | **kept, with a trash-can icon; clicking it brings the node out of Trash** | position not documented | `Empty trash` by hand, sometimes in several passes; `Hard delete including references` (⌘⇧⌫) also removes references in this workspace. No automatic emptying found | deleting a tag in use leaves its nodes and name marked with the trash icon; "will never delete data that is indirectly associated" |
| **Logseq (files)** | the `.md` file goes to `logseq/.recycle/`, with no UI | — | `[[page]]` stays and re-creates an empty page; `((block))` refs break | through the file manager | none | — |
| **Logseq (DB)** | pages recycled for 30 days; blocks deleted at once | — | not documented | ⋯ → Recycle → Restore | 30 days | **tags, properties and today's journal are deleted permanently**; deleting a property choice removes it from every block |
| **Notion** | a flag (`in_trash`), shown as a sidebar Trash | trashed and restored with the parent | relation cells keep the name, link broken; hidden from pickers (third-party reports) | **to the end of its old container**, not its position; not editable while trashed | 30 days, then 30 more on the back end; no Empty all | deleted database properties have their own bin. Archive is a separate state: links work, hidden from search and views |
| **Obsidian** | system trash, a vault `.trash`, or permanent, by setting | folder | an ordinary unresolved link; a click makes a new empty note | through the file manager; plugins cannot know the origin | File recovery snapshots, 7 days | — |
| **Roam** | no trash found; undo and exports | — | title links re-create the page; block refs break (inferred) | undo only | — | — |
| **Anytype** | the **Bin**, a flag ("archived") | a "Created in" property records origin; cleanup *suggests* orphans, never deletes them | greyed, "deleted"; after purge "Non-existent object" (community reports) | "with all of its previous links and settings" | kept indefinitely; purge confirms each time | deleting a Type asks whether to delete its objects |
| **Capacities** | Trash in the sidebar | not documented | not documented | per item, within 30 days | 30 days, Empty Trash; API `hardDelete=true` | **object type deletion is irreversible** |

Tombstone and history models:

- **git:** delete is unreachability, and purge is a timed GC (reflog 90/30
  days, prune grace 2 weeks).
- **Datomic:** retraction keeps history, and excision is the deliberate,
  logged purge. Schema datoms cannot be excised.
- **Yjs and Automerge:** keep tombstones (and Automerge keeps history), and
  purge by compaction.
- **SQL `deleted_at`:** the well-known cost is a filter in every query, and
  live children under a deleted parent. The alternative is a hard delete
  with a trigger that copies the row aside. These are (B) and (C) below.

What this says for kb:

1. **Two depths are nearly universal**: something reversible, then a
   deliberate purge.
2. **Tana is the only graph tool whose trash is a node, and the only one
   that keeps references working.** Its "click the trash icon to restore"
   is the gesture §7.1 adopts.
3. **Tana separates removing a reference from deleting a node.** kb has
   this already: deleting a reference row deletes the reference, never the
   original (DESIGN-UI.md → Contextual references).
4. **Restore position is lossy everywhere.** Notion appends to the end,
   and no tool documents a parent that is gone. kb can do better because a
   node has a rank (§6.5).
5. **Schema is where tools differ most.** Logseq DB and Capacities delete
   tags and types permanently, and Logseq cascades a choice's removal into
   every block. Tana keeps the data and marks the tag. kb follows Tana
   (§7.4, D5).
6. **Anytype 0.55's cascade incident** is the warning: a silent cascade
   over *related* objects (collection members, files) surprised people, and
   was rolled back. kb's cascade follows only the forest, meaning a node's
   own children, and never references or tag members.
7. **Retention converges on 30 days** where it is automatic (Notion,
   Capacities, Logseq DB). Tana and Anytype keep the trash until the person
   empties it.
8. **No tool documents deleting a calendar-synced event.** Tana's calendar
   sync is one-way and keeps annotated events on reset.

Sources: [Tana getting started](https://outliner.tana.inc/help/getting-started),
[nodes and references](https://outliner.tana.inc/learn/features/nodes-and-references),
[supertags](https://outliner.tana.inc/docs/supertags),
[calendar](https://outliner.tana.inc/learn/features/calendar-integration);
[Logseq DB version](https://raw.githubusercontent.com/logseq/docs/master/db-version.md),
[Logseq recycle](https://discuss.logseq.com/t/where-do-deleted-pages-go/18742);
[Notion delete and restore](https://www.notion.com/help/duplicate-delete-and-restore-content),
[Notion archive](https://www.notion.com/help/archive-pages),
[Notion API trash](https://developers.notion.com/reference/trash-page);
[Obsidian manage notes](https://obsidian.md/help/Files+and+folders/Manage+notes),
[file recovery](https://obsidian.md/help/plugins/file-recovery);
[Roam FAQ](https://roamdocs.fyi/help/faq);
[Anytype deletion](https://doc.anytype.io/anytype/organize/deletion),
[Anytype 0.55 cascade](https://community.anytype.io/t/cascade-deletion-in-0-55-0-what-happened-what-were-doing/30747);
[Capacities trash](https://docs.capacities.io/reference/trash);
[git gc](https://git-scm.com/docs/git-gc),
[Datomic excision](https://docs.datomic.com/operation/excision.html),
[brandur on soft deletion](https://brandur.org/soft-deletion).

## 4. The options

Each option has to answer the same questions: what "trashed" is, where the
node sits, what references see, what children do, how restore finds its way
back, and what purge does.

### (A) Trash is a node; deleting moves there

A seeded `sys.trash` node. Deleting moves the node (with its subtree, since
the outline is a forest and a subtree moves whole) to the top of
`sys.trash`'s children. The node keeps its id, text, props, children, tags
and `createdAt`. Being trashed is having `sys.trash` as an ancestor, which is
read and never written.

- **Fits "everything is a node."** Trash is a page you open, outline, search
  and give a view to. Its table view's columns are three ordinary fields. A
  drag to Trash deletes and a drag out of it restores, because the state is
  the place.
- **References keep working.** The target exists, so every resolver works
  unchanged: a tag in Trash still types its members, a field in Trash still
  keys its values, a ref value still joins in datalog, and backlinks are
  still there. The one change is how display surfaces draw it.
- **Children travel with it** and come back with it. That is a move, which
  kb already does.
- **Merge between clones improves.** A trash is a move, and `mergeNodeSets`
  merges a move on one side with an edit on the other, where today it
  reports `deleted-and-modified`.
- **Cost:** the provenance (where it came from) must not go stale when a
  node is dragged out by hand. One core interceptor stamps and clears it,
  on the same pattern as `ext.days.untag-period`. "Trashed" must be cheap to
  read: an ancestor walk in the model (the forest gives `parentOf`), and one
  derived datom in the index, re-derived over the subtree on a move in or
  out of Trash.

### (B) A `trashed` flag on the node, left in place

`sys.f.trashed` (a date) on the node. It stays under its parent, at its
rank. Restore unsets the flag, so its position is never lost.

- **Breaks Rule 1 at the call sites.** The node is still in its parent's
  `children`, so every reader that walks children has to skip it: the
  outline, the keyboard walk, sibling ranks and placement, the canvas,
  export and Copy as…, materialize, `pullSubtree` for `node.get` and MCP,
  the CLI tree, `crumbsTo`, `child counts`, ingest. That is a second `if` on
  one distinction at a dozen sites, and the next surface will forget it.
- Descendants need a derived "trashed by an ancestor" anyway, so (B) ends up
  with (A)'s derivation plus a flag.
- A Trash page has to be a query; it is not a place. A drag cannot express
  restore.
- **Its one advantage** is that restore never needs a fallback parent. (A)
  gets most of that from a recorded parent and rank, and from the placement
  port (§6.5).

### (C) Tombstones outside the graph

`node.delete` stays a hard delete but writes the removed nodes (the whole
subtree, whole) to a trash record: a `.kb/trash.jsonl`, or a sys node holding
a JSON snapshot, or the tail extended to keep content. Restore re-adds them
with their ids, as undo does today.

- **Keeps the content, not the node.** References dangle until a restore
  (§2.3's looks), tags stop typing, fields stop keying, the node cannot be
  opened or searched. It solves recovery and none of the owner's
  "keeping the node functional".
- A second storage shape beside nodes, needing its own merge, backup scope
  and contract tests (one contract, every implementation): a bespoke surface
  standing beside nodes.
- **Its advantage** is that the store does not grow and no reader changes.
  It is the right shape for *purge's* undo window, if one were wanted, and it
  is what git already is for a repository store.

### Scorecard

| | (A) Trash node | (B) flag | (C) tombstone |
|---|---|---|---|
| Everything is a node | yes: a page | half: a query | no: a file |
| References keep working | yes | yes | no, until restored |
| Readers that change | display only, through one reader | every child walk | none, but restore is new |
| Children | move with it | need derivation | snapshot |
| Restore position | recorded parent and rank, placement fallback | exact | recorded |
| Drag in/out | delete/restore | no | no |
| Clone merge | move vs edit merges | flag vs edit merges | delete vs edit conflicts |
| Store growth | yes, until purged | yes | outside the store |
| Rule 1 risk | one interceptor, one reader | filters at call sites | second storage shape |

## 5. Recommendation

**(A).** It is the only option where the owner's two reasons both hold.
Traceability holds because the node, its id and its provenance stay in the
graph. "Functional more or less" holds because nothing that resolves by id
can tell that the node moved. It reuses what kb has: a move (`node.update`
with a placement), a seeded node, managed fields, an interceptor pattern, the
`sys.*` display rule, declared approval, and the placement port.

Three principles come with it. Each has one home (DESIGN.md → a new
**Removal** section, with AGENTS.md → Data-plane freedom linking to it):

1. **Delete loses nothing.** `node.delete` either moves to Trash, or purges
   a node that holds nothing and that nothing references. It never makes a
   dangling reference. This is the guarantee the contract suite checks.
2. **Trash is a display rule, never a resolution rule.** This is stated
   beside the `sys.*` rule, and it is the same rule.
3. **Only purge forgets, and only with a person behind it.** `node.purge`
   declares required approval, and only takes a node already in Trash.

## 6. The contract

### 6.1 Data, seeded by core

| Id | Kind | Shape | Notes |
|---|---|---|---|
| `sys.trash` | node | text "Trash" | a root, seeded by core. Its children are trash roots, newest first. Its default view is a table over the three fields below |
| `sys.f.trash.from` | field | ref, one, hidden | the parent the root left. Absent when it was a top-level node |
| `sys.f.trash.rank` | field | text, one, hidden | its `order` among its old siblings, so it returns between the same neighbours |
| `sys.f.trash.at` | field | date, one | when it was trashed. Retention reads it |

The three fields are `sys.f.managedBy` core: the person can see them and,
after the one deliberate step, edit them (data-plane freedom; for example,
re-aim where a node will be restored to). Only a trash root holds them. A
node inside a trashed subtree is trashed through its root.

Who trashed it is not a field. The tail records the actor of the commit, and
a field would be a second copy.

### 6.2 The reader, in `@kb/model`

```ts
/** The node under `sys.trash` that `id` is in (itself, or an ancestor), or undefined when it is not trashed. */
export function trashRootOf(graph: Pick<NodeGraph, "parentOf">, id: NodeId): NodeId | undefined;
export const isTrashed = (graph, id) => trashRootOf(graph, id) !== undefined;
```

This is the one reader, as `kindsOf` is for tags. The index derives
`[?n :node/trashed true]` from it, the way it derives `:node/mentions`, and
re-derives it over a subtree when a node moves into or out of Trash (the
index already re-reads referrers when a target starts or stops existing).
`RefLook` gains `state(id): "live" | "trashed" | "gone"` from the same
reader, so every surface that draws a reference draws one state the same way.

### 6.3 Actions, in `@kb/operations`

| Action | Mode | Input | What it plans |
|---|---|---|---|
| `node.delete` | write | `{id, force?}` | `planRemoval`: when the node **keeps nothing** (below), purge it; otherwise move it under `sys.trash` at the top. Output `{id, outcome: "trashed" \| "purged"}`. The `descendants` input is removed |
| `node.restore` | write | `{id, to?: Placement}` | move a trash root back to `trashed from` at `trashed rank` (`placedRank`), or to `to`. When `trashed from` is gone or itself trashed, see §6.5 |
| `node.purge` | write, **approval required** | `{id}` | the old hard delete of a node in Trash, with its subtree. A node not in Trash is refused: "move it to Trash first" |
| `trash.empty` | write, approval required | `{olderThan?: duration}` | the purge of every trash root, or of those whose `trashed at` is older. One transaction |

**Keeps nothing** is one predicate, `keepsNothing(node, graph)` in `@kb/model`,
which replaces the page's `isPrunableTransient`. The page keeps only its own
condition (that the row is transient), and that bridges to the model (Rule 1,
bridges over mirrors). A node keeps nothing when all of these hold:

- it is not `sys.*`;
- its text is empty, or it is a reference row (`sys.f.ref.target`), whose
  text is its target's;
- it has no children;
- it holds no value other than its tags and its reference target;
- **no other node references it**: no `:node/mentions` and no ref value.

So an empty row, a paste's placeholder, an unpin, a dropped gallery pin and
a transient prune all purge, as they do today. A person's delete of anything
with content goes to Trash. The "no referrers" clause is what makes "delete
never dangles" hold. `node.merge`'s delete half plans through the same
`planRemoval`, over the source as the merge leaves it (its text and children
gone to the target): a source that held props, or that is referenced, goes to
Trash, where today it is lost.

`node.batch` takes `node.delete`, `node.restore` and `node.purge` items through
the same planners. A batch with a purge needs approval, as core already
enforces for a batch.

### 6.4 The commit

- **Moves in and out of Trash stamp and clear provenance** in the same write,
  whatever made the move (`node.delete`, a drag, `kb mv`, an agent's
  `node.update`). One core interceptor on the planned write: a node that
  becomes a child of `sys.trash` gets `from`, `rank` and `at`; a node that
  stops being one loses them. This is the `ext.days.untag-period` pattern,
  and it means a drag and the action cannot disagree.
- **The system-write rule reads a move under `sys.trash` as a delete.**
  `systemTxRefusal` already asks deletes first. It now also asks: does this
  write put a `sys.*` node, or a subtree holding one, under Trash? If so it
  refuses with `rule: "delete"` and the wording it has today
  (`refusal.ts:65-67`, "… comes with …, so it can't be deleted"). `force`
  overrides it, as it does today. Purge is checked the same way.
- **Nothing else changes about writes to a trashed node.** It can be edited,
  tagged and moved inside Trash. Data-plane freedom does not stop at a
  place.

### 6.5 Restore when the way back moved

Restore puts the root back where `trashed from` says, between the same
neighbours (`trashed rank`). There are three cases where that is not
possible:

| Case | Restore does |
|---|---|
| `trashed from` is gone (purged) | the node goes where a new node would go: `node.placement` (#254), so today's day, or the capture target. The answer says where |
| `trashed from` is itself trashed | refuse, naming it, with two ways out. `node.restore {id, to}` puts it somewhere else, or restoring the parent first restores the child with it. The page offers both. Restoring into Trash would leave it trashed, which is not a restore |
| `trashed from` exists but moved | restore under it wherever it is now. The parent's identity is what was recorded, not its place |

A node dragged out of Trash by hand goes where it is dropped. The
interceptor clears its provenance, and that is a restore.

### 6.6 Surfaces

| Surface | Trash | Restore | Purge |
|---|---|---|---|
| CLI | `kb rm <id>` prints "moved to Trash · `kb restore <id>`", or "removed (empty)"; `kb trash` lists | `kb restore <id> [--to <id>]` | `kb rm --purge <id>` (= trash then purge in one batch, asks on the tty), `kb trash empty [--older-than 30d]` |
| MCP | `node_delete` | `node_restore` | not listed (approval required) |
| page | every gesture in §2.5 unchanged; the toast says "Moved to Trash · Undo" | the Trash page, the banner on a trashed node, a drag out | Delete forever on the Trash page and the banner, with a dialog naming what still references it; Empty Trash |

The MCP tool description says what `node_delete` does now: it moves to Trash
and can be undone. An agent that wanted the old effect has no way to get it,
and that is the point (GAP `01M413SP3QSSQJMKKDK3W3J6G8` still applies:
governance is not a security boundary).

### 6.7 Where it lives

Core, not an extension. Removal is mechanism. The store, the commit, the
index and the reader all need it, and every family's nodes can be trashed. The
pieces sit in the packages that already own the neighbouring concepts:

- `@kb/model`: `trashRootOf`, `keepsNothing`, the system-write rule's
  Trash clause, `refName`'s third state;
- `@kb/seed`: `sys.trash` and its three fields, and the table view;
- `@kb/operations`: `planRemoval`, the four actions, the interceptor;
- `@kb/query`: the derived datom, and the "not trashed" default on
  `graph.search`, `nodeCandidates` and the view/query runners;
- `@kb/ui-sdk`: `RefLook.state` and the one look per state;
- the store contract suite (`store-contract.ts`): the removal properties,
  run over `STORE_BACKENDS` (§8).

## 7. What a trashed node does, case by case

### 7.1 References

| Where | Trashed | Purged |
|---|---|---|
| inline pill | the label, struck through, muted, with a small trash mark (Tana's icon); tooltip "In Trash · from <parent>". The mark restores; the label opens the node, whose page has a banner "In Trash · Restore · Delete forever" | the label (or id), dashed, muted; tooltip "Deleted"; a click shows NotFound as now |
| reference row | the row as it would be, struck; its bullet dashed as now | `[[id]]`, read-only, as now |
| ref field value | the value chip, struck | the one gone chip (`UnresolvedRefChip`'s look, used everywhere) |
| tag chip | the chip, struck | a gone chip "#?" with the id, not silence |
| canvas card | the card, faded, with an "In Trash" corner and Restore | the red "missing" box, as now |
| pinned | shown struck; unpin or restore | dropped, as now |

The purged column is P0: one "gone" look in place of five, read from
`RefLook.state`.

### 7.2 Queries, views, search and backlinks

Trash is a display rule. A display surface hides trashed nodes by default
and resolution does not:

- **Hidden by default:** `graph.search`, the ⌘K palette, every node picker
  (`nodeCandidates`), query and view results, backlinks lists, the
  ontology's members, daily "made or edited", `docs materialize`. Each
  takes the default from one place, the index's `:node/trashed`, and a
  query node may say `include trashed`.
- **Not hidden:** datalog (`kb query`), which is raw, as it is for `sys.*`;
  `kindsOf` and templates; ref values and joins; `node.get`. A trashed tag's
  members are still its members. A trashed field's values are still its
  values, and their row label is struck.
- **Trash's own page** is the Trash node, with a table view: the node, `from`,
  `at`, and how many references point into it.

### 7.3 Children

A subtree is trashed whole and restored whole. A descendant cannot be
restored on its own through `node.restore`, which takes only trash roots,
but it can be dragged or moved out of a trashed subtree like any node, which
makes it live again. A descendant that was trashed before its parent stays
its own root in Trash, so restoring the parent does not bring it back.
That matches what the person did: two deletes.

### 7.4 Protected nodes

Data-plane freedom says the person owns the data and a family owns its
promises. So protection follows the reason it exists:

| Node | Trash | Purge | Why |
|---|---|---|---|
| `sys.*` | refused, as delete is today; `force` overrides | refused; `force` overrides | identity and structure (AGENTS.md) |
| a family's seeded node with a plain id (`days.journal`, `approval.policies`) | allowed | allowed | the person's to remove. While it is in Trash the seed sees it and does not re-add it; after a purge the seed adds it again (GAP `01M413SPC35K20DFC4TRP4DJYH`, unchanged) |
| a field that holds values, a tag with members | allowed, with a dialog: "Used on 42 nodes. They keep their values; restore brings it back." | **refused** while values or members exist: "Remove it from them first, or keep it in Trash." | a purge would orphan prop keys or type refs no one can see (§2.2). Constrain before you lock |
| a node others reference | allowed (it stays functional) | allowed, after a dialog naming the count; references become the gone look | a reference is the referrer's, and its stored label stays theirs |
| a node a setting names (`sys.f.days.journal`, `sys.f.views`, a capture target) | allowed; the setting keeps resolving | allowed; the setting reads missing, as now | settings resolve by id; a family that needs a live node re-makes it, as days does |
| a period node (`#day`) | allowed; see §7.5 | allowed | the key is the family's identity data |
| a synced event or routine | allowed; see §7.6 | allowed | Google side effects follow trash, not purge |
| a virtual node (saved query) | refused, "change it there", as now | refused | file-backed |

**Approval** stays where it is: on `node.purge` and `trash.empty`, by
declaration. Trash needs none, because it can be undone. The approval guard
is not a substitute for Trash, and Trash is not a substitute for approval.
When governance policies arrive (`01M5E2DAVRH5CWKM27BVDYW19T`), "ask before an
agent trashes more than N nodes" is a policy over `node.delete`, and nothing
here needs to change for it.

### 7.5 Days

A trashed day still holds its key, so it is still "the" `2026-11-16`: the
unique-key guard and `ext.days.today` both find it. Without a decision,
captures would land in Trash. There are two coherent answers:

1. **Today, needed, comes back.** `ext.days.today` finding its period in
   Trash restores it in the same write, and the page says "Today was in
   Trash; restored". One node per key holds, and the person's notes come
   back with it. *Recommended.*
2. **A trashed period gives up its key.** Trashing unsets the key, which
   frees the id-derived slot, and a new day is made. Restoring the old one
   then collides with the new one on the key, and the guard refuses.
   Rejected, because it turns restore into a merge.

The journal root works the same way: a trashed journal is still the
setting's value, and capture restores it.

### 7.6 Routines and Google Calendar

- **A trashed routine is retired**: the engine treats "trashed" as it treats
  "gone" today (end the series at yesterday, or cancel a one-off), and the
  hold of more than five applies. **Restore republishes** it to the same
  Google event, because event ids are deterministic. Purging a trashed
  routine sends nothing more.
- This **closes the offline gap** in §2.6. A trashed routine is durable state,
  so a host that starts after the delete reads it from Trash and retires it.
  Only a purge made while the host is stopped is still lost. That is
  narrower, and a purge is deliberate.
- **Inbound sync (#194)** finds an imported event in Trash by its key, as it
  finds any node, so a dismissed event stays dismissed until it is purged.
  That answers that design's decision 8 with no new state. A cancellation in
  Google still sets `event status = cancelled`, never trashes. Trash is the
  person's act, and cancelled is Google's fact.

### 7.7 Undo, the tail, backups and growth

- **Undo of a trash is a move back.** `restoreInvocations` already plans a
  changed placement as `node.update`, so undoing a trash keeps `createdAt`,
  and the interceptor clears the provenance. Undo still dies with the tab,
  but Trash does not.
- **The tail** records a trash as an upsert, so `graph.changes` reports it
  as "wrote", not "deleted". `deleted` keeps meaning purged.
- **Backups** need nothing: Trash is in the graph, so it is in every backup.
- **Growth.** Trashed nodes stay in `nodes.jsonl` and in the index until
  purged. kb's nodes are small and a person's trash is small next to their
  graph, so retention is off by default and Settings shows the Trash's size
  (§11, D4). In a repository store, a purge removes the node from the working
  tree, never from git history. "Delete forever" says "from this store".
  Scrubbing history is a git operation and out of scope.

### 7.8 Migration of today's behaviour

- **Data:** nothing to migrate. Nothing is trashed today. Existing dangling
  references stay dangling, now with the one gone look. `sys.trash` and its
  fields arrive by seed, as every system node does.
- **Behaviour:** `node.delete`'s output changes from `{deleted: true}` to
  `{outcome}`, and its `descendants` input goes. That changes the wire
  fingerprint (`wire-protocol.test.ts`), the MCP tool schema and the CLI's
  JSON. Every caller in §2.5 keeps its call. The ones that delete nothing of
  value purge through `keepsNothing`, and the rest now trash.
- **Tests** that assert a node is gone after `node.delete` change to assert
  it is in Trash, or switch to `node.purge`. The harness's tolerated dangling
  refs (`contentDanglingRefs`) can then only come from a purge, and the
  harness can say so.

## 8. The contract suite

These go in the shared store contract, over every backend, as the removal
properties:

1. After `node.delete` of a node that keeps something, every node, text and
   prop the store held before is still in the store. Only placements under
   `sys.trash` changed, and the root holds `from`, `rank` and `at`.
2. `node.delete` never adds a dangling reference: the set of
   `contentDanglingRefs` is the same before and after.
3. `node.restore` after `node.delete`, with nothing in between, gives back
   the store as it was (minus `updatedAt`), position included.
4. A move out of Trash by `node.update` leaves no trash field, and a move in
   stamps them.
5. `node.purge` of a node not in Trash is refused. `node.purge` without
   approval is refused on every surface (`approval_required`).
6. A write that puts a `sys.*` node under Trash is refused with
   `rule: "delete"`, unless forced.
7. `isTrashed` and `:node/trashed` agree on every node after any write
   (a property test over random moves, as `merge.forest.property.test.ts`
   does).

## 9. Phased plan and cost

Each phase is one PR, restructure first (Rule 1).

| Phase | What | Size | Notes |
|---|---|---|---|
| **P0** restructure, behaviour-preserving | delete `descendants: "reparent"` (the dead seam); `planRemoval` is the one planner for delete, merge's delete half and batch deletes; `keepsNothing` moves to `@kb/model` and the page's prune reads it; `RefLook.state` with `live`/`gone`, and the one gone look on every surface in §7.1 | S–M, 1–2 days | fixes the invisible deleted pill on its own; no data change |
| **P1** Trash in core | seed `sys.trash` and its fields; `node.delete` moves to Trash; `node.restore`, `node.purge`, `trash.empty`; the interceptor; the system-write clause; `trashRootOf` and the derived datom; CLI and MCP; the contract properties in §8; spec in DESIGN.md → Removal | M–L, 3–4 days | the wire fingerprint changes in this commit |
| **P2** the page | Trash in the sidebar; the Trash page's table view; the trashed look and the banner; "Moved to Trash · Undo"; Delete forever and Empty Trash dialogs; search, picker and view defaults; the canvas card state; the protected-node dialogs in §7.4 | M, 2–3 days | `bun run test:ui` in full |
| **P3** families | days restores a trashed period on need; routines retire on trash and republish on restore, read from Trash at startup; the gcal inbound design takes "in Trash" as dismissed | S–M, 1–2 days | live Google acceptance for restore |
| **P4** optional | retention: `trash keeps` on core's node and a scheduled `trash.empty` through an automation (opening never writes, so not on open) | S | only if the owner wants it (D4) |

About 8–11 days in all. P0 is worth doing even if the answer to the rest is no.

## 10. What would make us say no

- **The owner wants git to be the trash.** For a repository store, git
  already keeps every deleted node, and a hard delete is honest. That is
  coherent, but it does not cover the home store, a delete made since the
  last commit, or references that keep working. If that is the answer,
  do P0 and stop.
- **The derived `trashed` state is too expensive.** Trashing a subtree of
  10,000 nodes re-derives 10,000 datoms. If the index budget cannot take
  that, the datom could be held on trash roots only, with "hidden by
  default" read as a rule over ancestry. That is slower to query, but it is
  the same design.
- **The owner wants Tana's exact semantics where they differ** (§3), such
  as automatic emptying after a fixed time, or references removed on purge.
  Both fit (A) as settings, so neither is a reason to choose another option.
- **A family needs a hard delete as part of its own write** that
  `keepsNothing` does not cover, and that is not a person's removal. If one
  turns up, it purges through `system` writes (as migrations do). If several
  turn up, the predicate is wrong.
- **Trash becomes a second home.** If people keep live work there, because
  trashed nodes keep working, the struck look and the hidden-by-default
  rule are failing. The answer then is stronger hiding, not another design.

## 11. Decisions for the owner

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| D1 | The model | **(A)**, a Trash node and delete as a move | (B) flag, (C) tombstone, or P0 only with git as the trash |
| D2 | `node.delete`'s meaning | **becomes trash**, so every existing caller (agents included) is safe at once | a new `node.trash`, with `node.delete` left hard, which leaves every agent on the hard path |
| D3 | Delete of an empty, unreferenced node | **purges** (`keepsNothing`), so Trash holds only what was worth keeping | everything goes to Trash, which fills it with empty rows (Tana's documentation does not say which it does) |
| D4 | Retention | **none by default**; Empty Trash and `trash.empty --older-than` | Notion-style 30 days, as a setting and an automation (P4) |
| D5 | Purging a field with values or a tag with members | **refused until detached** | allowed, orphaning invisibly as today; or detach as part of the purge |
| D6 | References on purge | **left as written, with the gone look** | removed, as Tana's `Hard delete including references` does; or rewritten to plain text. Both change the referrer's own text |
| D10 | `node.merge` redirects references to the survivor, as Tana's merge does | **later, as its own change**; until then a referenced merge source goes to Trash (§6.3) | redirect in P1 |
| D7 | A trashed day needed by capture | **restored, with a notice** | refuse the capture; or give up the key on trash |
| D8 | A trashed routine | **retired in Google; restore republishes** | keeps publishing until purged |
| D9 | Trash in search and pickers | **hidden by default, with a "show trashed" switch** | shown, struck |
