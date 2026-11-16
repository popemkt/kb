# A node made in a view carries the view's criteria

Research for the owner, 2026-11-17. The question as asked: _"in a query view
(table, query, etc), a node added/created will have the criteria as the
query/filter. This functionality is also there for notion I believe."_

This is a record, not a spec. The behaviour that ships has its canonical home
in DESIGN.md → Query layer → **What a match requires** and DESIGN-UI.md → UI
points → **_Adding to a frame_**; this doc points there and does not restate
them. Proposals here are undecided until the owner says so.

**Verdict, up front.** kb already does the core of this, and on more
surfaces than Notion documents: since #237, "+ Add" in query results, table,
board (per group), cards, lanes, list-with-detail and calendar (per day) makes
a node that carries what the query and the view's filter require, in one
write and one undo, and `kb add --matching` and MCP `node_add` do the same for
a query. What remains is a set of specific gaps, not a missing feature:
negations are over-reported as unmet, view filters and group values are
page-only (CLI/MCP cannot use them), three creation paths ignore the frame,
and a node that does not match vanishes with only a toast. The recommendation
is to close those gaps by making the matcher, not the proposer, the judge, and
by moving frame requirements to the one server-side action.

## 1. Problem

A view is a question ("tasks tagged #task with status Doing, under Project
X"). When a person adds a row while looking at the answer, they mean "a new
one of _these_". If the new node does not carry the criteria, it either
vanishes from the view the moment it is made or shows and then is wrong
everywhere else. The rule to design is: which criteria can a write satisfy by
construction, what happens with those it cannot, where the node lives, and
how one rule holds across every view and every surface (page, CLI, MCP).

## 2. How the others do it

| Tool | Applies what | Unsatisfiable criteria | Where the new item lives | Source quality |
| --- | --- | --- | --- | --- |
| Tana | the search node's conditions, "it will try to create a node that follows the conditions" | kept, shown as a **"mismatch"** | the workspace's **daily page**, not under the search | official |
| Notion | filter values "auto-populated" on simple equality filters; a board group sets its property, a calendar day sets its date (observed, not documented) | a page that fails (e.g. a formula filter) opens as a page and may not show in the view | in the database | community / secondary |
| Logseq (DB) | on a tag or property page, "the new node will have that tag or property"; "different features will behave differently" | not documented | not documented | official, thin |
| Capacities | a query offers **New** only "when the rules are specific enough"; New prefills them | no New action at all | the object type's collection | official |
| Anytype | relation filters populate new objects (2022 notes) | advanced filters silently not applied (open bug, 2026) | the set / collection | official + bug report |
| Airtable | simple conditions (select equals) prefill; group sets its value | record filtered out at once | the table | staff answer |

Sources:

- Tana search nodes, "mismatch", daily page:
  <https://outliner.tana.inc/learn/features/search-nodes>. Card view sets the
  field on a drag between groups; list view does not (request):
  <https://ideas.tana.inc/posts/623-drag-nodes-between-groups-to-change-field-value>.
- Notion: help pages are silent on which filters apply
  (<https://www.notion.com/help/views-filters-and-sorts>,
  <https://www.notion.com/help/boards>); "creating new database pages in a view
  that has a filter you will get all relevant properties auto-populated":
  <https://notionexpert.substack.com/p/notion-tips-and-tricks>; formula
  filters and rows that open as pages instead:
  <https://thomasjfrank.com/formulas/formulas-in-database-filters/>. Which
  operators apply (is / is not / contains / OR groups) is **not documented**
  anywhere I found; treat any claim about it as unverified.
- Logseq DB version: <https://github.com/logseq/docs/blob/master/db-version.md>.
- Capacities "New" on specific-enough queries:
  <https://docs.capacities.io/reference/use-cases/queries-in-practice>.
- Anytype: <https://blog.anytype.io/workflow-nirvana/> (relation
  prefill), <https://community.anytype.io/t/creating-elements-from-query-with-advanced-filters-doesnt-work/30264>
  (advanced filters not applied).
- Airtable staff answer on limits:
  <https://community.airtable.com/base-design-9/adding-records-to-a-filtered-list-view-30911>;
  group-sets-value workaround:
  <https://community.airtable.com/show-and-tell-15/how-to-add-a-new-record-in-a-view-filtered-on-a-lookup-value-1879>.
- Linear: no documented filter prefill; prefill is by URL parameters
  (<https://linear.app/docs/create-new-issue-urls>).

What to take from them:

- **Everyone satisfies equality on a stored value and nothing else.** Tag
  present, select is X, relation contains Y. Negation, emptiness, ranges,
  text match and computed values are skipped by all of them.
- **Three answers to "it won't match":** let it vanish (Notion, Airtable),
  keep it and say so (Tana), refuse to offer the button (Capacities). kb
  today is between the first two: it makes the node and toasts.
- **Group and day are the reliable case.** Board groups and calendar days set
  their value in every tool that has them, often more reliably than filters.
- **Nobody documents the rule.** kb already does: `requirementsOf` has a law
  and a property test. That is worth keeping as the advantage.

## 3. What kb already has

Mapped on `main` at `e4383f17`; "+ Add that matches" landed with #237 (spec
`b990b2ef`, implementation `118e29ea`, caret `2a865d75`, tightening
`55841bc5`). Paths are repo-relative.

**The rule, pure.** `requirementsOf(conditions, read)` in
`packages/domain/query/src/ir/requirements.ts` returns `{tags, props, parent,
unmet}` from the canonical top-level rows, ANDed:

| Row | Written as | Today |
| --- | --- | --- |
| `has-tag T` | the tag | written, if T exists |
| `field-is F` one value | the value (`label` resolved by the field's type: an option, a node id, a number, a checkbox, else text) | written |
| `child-of P` | the parent | written, if P exists |
| `field-is F` with a second, different value of a one-value field; two `child-of` | — | unmet (disagree) |
| `field-is` several values, `any-of` (OR) | — | unmet |
| `lacks-tag`, `field-is-not`, `field-unset`, `none-of` (negations) | — | unmet |
| `field-set`, `field-contains`, `text-contains`, `field-compares`, `date-within`, `instant-within` | — | unmet |
| `under` / `above` (reach), `has-children`, `links-to` / `linked-from` | — | unmet |
| `anywhere-contains` (view filter only) | — | unmet |

Its law (`packages/domain/query/tests/requirements.test.ts`): a node made with
what it gives holds every condition it did not count unmet, checked with
`conditionsMatcher` (`packages/domain/query/src/ir/evaluate.ts`).

**The action.** `node.add`'s `matching` (a query node id;
`packages/application/operations/src/actions.ts` `nodeAddDef`,
`packages/application/operations/src/node-add-matching.ts`
`withMatchingEffect`): adds the query's tags and props beside the input's
own, takes its `child-of` parent if the input names none, and returns `unmet`
as a count. A query that does not lift is one unmet condition and adds
nothing. Contract test over every store backend:
`packages/app/runtime/tests/node-add-matching.test.ts`. Reached by `kb add …
--matching <query>` (`packages/app/cli/src/cli.ts`), MCP `node_add`, WebMCP.

**Placement.** Explicit parent, else the query's `child-of`, else the frame
itself for a children frame, else the capture target (today's day node when
days is on, `placeOf`). This is Tana's daily-page answer, arrived at
independently.

**The page.** One way a view asks for a row: `FrameSubject.addRow(where)`
(`packages/kit/ui-sdk/src/lib/frame-subject.ts`), hosted by `addFrameRow`
(`packages/extension/outline-ui/src/editing-writes.ts`), which runs
`requirementsOf` over the view's filters plus the group's `field-is`, passes
`matching: frameId` for a query frame, marks the node transient (pruned if
left empty), waits for the query to answer, puts the caret in it, and toasts
"Added, but not everything this view asks for could be filled in, so it may
not show here" when anything was unmet. `AddRow`
(`packages/extension/collections-ui/src/add-row.tsx`) is the view side.

**Where "+ Add" matches today.** Query results in the outline list
(`outline-ui/src/query-results.tsx`, "Add a result"); table
(`collections-ui/src/table-view.tsx`); board per group, cards, lanes
(`board-cards-view.tsx`; "No <field>" adds no value, `group-where.ts`); list
with detail (`detail-view.tsx`); calendar per day and the undated list
(`calendar-view.tsx`; no day buttons until a date field is chosen). Tests:
`packages/app/ui/src/page-tests/outline/add-to-frame.component.test.tsx`,
`calendar-view.component.test.tsx`, `detail-view.component.test.tsx`.

**The gaps, found in the code.**

1. **Negations are counted unmet though a new node already holds them.** A
   fresh node holds `lacks-tag X` unless it was given X, `field-unset F`
   unless it was given F, `field-is-not F v`, and most `none-of` groups. The
   proposer counts every row it cannot _write_ as unmet, so a view "#task,
   not #done" toasts "may not show here" on every add, and then the row
   shows. The toast is wrong more often than it is right in exactly the
   views people make most ("open tasks").
2. **View filters and group values are page-only.** `addFrameRow` derives
   them in the page; `node.add`'s `matching` takes only a query node, and a
   view node or a children frame is `not_found`. `kb add` and an agent cannot
   ask for "a row of this board's Doing column". Two homes for one rule (the
   query's requirements on the server, the frame's in the page) is a mirror.
3. **Three creation paths ignore the frame.** The outline list's own create
   strip (`frame-view-slot.tsx`, `createTransientNode`) ignores a list view's
   filters; Enter / split inside a frame (`selection-actions.ts`,
   `createEmptyNode`) carries no frame or group conditions; query results
   pass `[]` for `where` (`query-results.tsx`), so a list view's filters over
   a query are not applied.
4. **The unmet answer is a count, and a toast.** The receipt says how many,
   not which; an agent cannot say what it could not fill in, and the page
   cannot say it either. The row the person is typing into disappears once
   the query re-answers without it.
5. **Input and query values are concatenated unchecked.** `withMatchingEffect`
   appends the query's props to the input's. `--prop status=done --matching
   <status is doing>` on a one-value field yields two values; whether the
   integrity check refuses it was not verified for this doc. Either way the
   disagreement rule `requirementsOf` already has is not applied across the
   two sources.
6. **Ranges with a value the view itself supplies are fine; others are not
   chosen.** The calendar day and board group already supply their witness.
   A "due in the next 7 days" filter on a table does not, by design.

Related, not this feature: a tag's default field values (proposed in
[2026-11-10-data-plane-fields-events](2026-11-10-data-plane-fields-events.md)
§4.2, not built) would apply to any node given the tag, including one "+ Add"
makes; drag between groups is disabled on query-source frames
(`board-cards-view.tsx`, `calendar-view.tsx`), because the value may be what
the query matched. Existing gap nodes that touch this:
01M5E7S398F4GM2490R3RZ3ZPP (view filters in legacy syntax; text-anywhere has no
datalog form), 01M5E7RM5EQ2TSJZSMM330T5DH (view narrowing in JS, not ANDed at
compile).

## 4. Designs

All three keep the rule kb already states: a write never _chooses_ for a
person among values a condition leaves open ("never guessed at",
DESIGN.md → What a match requires).

### A. The matcher judges; the proposer only proposes; frames go to the server

- `requirementsOf` keeps proposing exactly what it does today. The **unmet
  set is no longer "rows I did not propose" but "rows the planned node fails"**:
  after planning, `conditionsMatcher` evaluates the conditions over the graph
  with the planned node in it. Negations a fresh node holds are no longer
  reported; a reach a chosen parent happens to satisfy (`under X` when the
  query also says `child-of X`) is no longer reported either. One judge (the
  matcher the query layer already holds equal to the compiled datalog), one
  proposer, no list of "vacuously true" kinds to keep in sync with the row
  vocabulary.
- `node.add`'s `matching` accepts a **frame**: a query node (as now) or any
  node with frame views. The server reads the frame's query (if it is a query
  source), the view's filters (`sys.f.view.filter` of its first frame view),
  and an optional `group: {field, value}` the caller names (a board column, a
  calendar day). `addFrameRow` stops computing requirements and passes the
  frame and the group; the page and the CLI make one node one way.
- The receipt's `unmet` becomes the list of unmet rows (the canonical rows,
  which the query builder already lifts to labels), not a count.
- Input and frame values merge through the same disagreement rule
  (`requirementsOf` over input-as-conditions + frame conditions), so a
  conflict is unmet, not a two-valued one-value field.
- **Trade-offs.** + Fixes gaps 1, 2, 4, 5 with no new concept; + CLI / MCP get
  board columns and calendar days for free. − `matching` widens (a frame, not
  only a query): a wire change and a wider contract test. − Evaluating with a
  planned node needs a `ConditionGraph` over the store plus one node; the
  server has `IndexedNodes`, so this is a view, not a copy.

### B. A: plus witnesses for finite choices and ranges, chosen by the person

- Where a condition leaves a **finite** choice (`field-is` with several
  values, `any-of` of `has-tag`s, a one-value field filtered "is A or B"),
  "+ Add" opens a picker step (`PaletteStepPoint`, the node palette's existing
  picker) listing the choices; the pick becomes a `field-is` / `has-tag`. The
  person chooses; nothing is guessed.
- Ranges (`date-within`, `field-compares`) and text matches stay unmet unless
  the view supplies the witness (calendar day). A suggested witness ("today"
  for "next 7 days") is offered, not written.
- **Trade-offs.** + Covers the OR filters people write ("Doing or Review").
  − A picker before a row exists is friction on the fastest gesture in the
  UI; it must be skippable (Escape adds the row with what is certain). − CLI
  / MCP need a way to answer it (`--group`, or a second call); an agent would
  rather just set the value.

### C. Capacities: offer "+ Add" only when the conditions fully determine the node

- Hide or disable "+ Add" when anything is unmet.
- **Trade-offs.** + Never a vanishing row. − Contradicts kb's existing
  decision (make the node anyway, say so) and Tana's; a view of "open tasks
  due this week" would have no add at all. − A view's add would appear and
  disappear as the person edits the filter: a control whose presence depends
  on query algebra the person cannot see. Rejected.

## 5. Recommendation and phased plan

**A now; B's picker only for the one case people hit (a one-value field
filtered to a few options), after A ships and if it is asked for; never C.**
Plus one UI change for gap 4 that does not depend on either.

**Phase 1: the matcher is the judge (restructure commit, then behaviour).**
- Restructure: `node-add-matching.ts` plans the node, then asks
  `conditionsMatcher` over the store plus the planned node for the failing
  rows. Behaviour-preserving for every row the proposer writes (its law
  already says they pass).
- Behaviour: unmet is the failing rows. Negations stop toasting. The receipt
  carries `unmet: Condition[]`; the page's toast names them in the query
  builder's words ("not Done", "Due within 7 days").
- Spec edits: DESIGN.md → What a match requires (the unmet definition);
  DESIGN-UI.md → _Adding to a frame_ (what the toast says).
- Tests: `requirements.test.ts` gains the converse property (a row the matcher
  passes on the planned node is never reported); `node-add-matching.test.ts`
  over every backend gains a negation case.

**Phase 2: one home for frame requirements.**
- `matching` takes a frame and an optional `group`; `addFrameRow` passes them
  instead of computing requirements; the disagreement rule spans input and
  frame. `kb add "…" --matching <frame> [--group field=value]`; MCP
  `node_add` has the same fields from the manifest, as every tool does.
- Close gap 3 by routing the three ignoring paths through `FrameSubject.addRow`:
  the list's create strip in a filtered list view, Enter/split inside a frame
  (it adds a sibling row _in that frame_, so it carries the frame and the
  head row's group), and query results' `where` (the list view's filters).
- Wire fingerprint changes once, in this commit.

**Phase 3: the row that does not match stays where it was made, until left.**
- Tana keeps a mismatch visible; Notion opens the page. kb's equivalent: the
  frame keeps drawing the row it just made while it is transient or being
  edited (outline screen state, never written; the frame already has a
  per-session row state for list-with-detail), marked with a quiet "doesn't
  match this view" chip naming the unmet rows; when the caret leaves, it
  goes, and the toast offers "Open" to its page. No row vanishes under the
  person's caret.
- Spec home: DESIGN-UI.md → _Adding to a frame_.

**Phase 4 (on request): the finite-choice picker (design B, narrowed).**

**Where the new node lives**, the same in every phase: an explicit parent,
else the frame's `child-of`, else the frame (children frame), else the capture
target. Do not invent a parent from `under X`; Phase 1 only stops reporting it
as unmet when a chosen parent satisfies it.

**Across views.** One rule because one entry point: table, board (group →
`group`), cards, lanes (a lane is a child of the frame), list with detail,
calendar (day → `group` on the date field; the undated list passes none) and
the plain list all call `FrameSubject.addRow`. Canvas, graph and the routines
calendar are not frames and keep their own creation; a canvas card dropped
on a canvas whose source is a query is a separate question, not designed
here.

## 6. Cost

| Phase | Packages touched | New contracts | Data / migrations |
| --- | --- | --- | --- |
| 1 | `@kb/query` (`requirements.ts` gains a judge over a planned node), `@kb/operations` (`node-add-matching.ts`), `outline-ui` (`editing-writes.ts` toast) | `node.add` output `unmet` count → condition list (wire fingerprint) | none |
| 2 | `@kb/operations`, `@kb/views` (read a frame's filters on the server), `ui-sdk` (`frame-subject.ts`, `page-writes.ts`), `outline-ui` (`editing-writes.ts`, `query-results.tsx`, `frame-view-slot.tsx`, `selection-actions.ts`), `collections-ui` (`group-where.ts` → `group`), `cli` (`--group`) | `node.add` `matching` widens to a frame, adds `group` (wire fingerprint) | none |
| 3 | `outline-ui`, `ui-sdk` (frame row state) | none | none |
| 4 | `outline-ui`, `ui-sdk` (picker step) | none | none |

No stored data changes shape in any phase. The CLI closure budget matters for
phase 2 (`node-add-matching.ts` is lazy-loaded for that reason today; reading
view filters must stay behind the same lazy import).

## 7. What would make us say no

- **Phase 1:** if `conditionsMatcher` over "store plus one planned node" cannot
  be built from what the server holds without materialising a second graph
  copy per add, keep the proposer's count and instead mark the vacuous
  negations explicitly. That would be a second list of row kinds to keep in
  step with the vocabulary, so it needs a `GAP` node naming the matcher as the
  canonical shape.
- **Phase 2:** if reading a view's filters server-side drags UI-only view
  code into the CLI closure, stop and first move the filter decoding to
  `@kb/views` (domain), where `ViewFilterSchema` already is; do not let the
  server import from a `scope:browser` package.
- **Phase 3:** if keeping a non-matching row drawn confuses the row walk
  (keys that select rows the frame does not hold), drop it; the toast with
  "Open" is the fallback.
- **Phase 4:** if a picker before a new row costs more than people gain, or
  if no one writes OR filters on one-value fields, do not build it. The
  unmet list from phase 1 already tells the person what to set.
- **Overall:** if the owner prefers Capacities' strictness (no add unless
  fully determined), that reverses a shipped decision and should be its own
  record, not a phase of this one.
