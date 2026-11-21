# Outliner parity: Tana and the AI-infused field

Research for the owner, 2026-11-20. Question: what would make kb's outliner
feel as good as Tana's, and what should it learn from the newer AI-infused
tools, while staying outliner-only (nodes, fields and tags in an outline; no
new data model)?

This is a record, not a spec. Where it says what kb does today, the code is
the authority; where it proposes, nothing is decided until the owner says so.
The build briefs in §7 are written so an Opus builder can run one overnight.

## 0. Verdict

kb is further along than the question assumes. The grammar is already
Tana's: Esc toggles edit and selection, `#` `>` `@` `[[` triggers, range
selection, drag, one undo stack, a node-anchored command palette (⌘K), typed
field slots with natural-language dates, tag templates that extend, fill from
ancestors, build titles and map a checkbox, an inline query node with a
condition builder, and List/Table/Board/Cards/Calendar views on any node. It
also has things Tana does not (Tana Paste _and_ Markdown paste, a datalog
query, shortcuts as nodes).

What is missing is mostly **the last ten percent of flow**, plus **AI as an
outline operation**:

1. The `#` and `>` pickers are noisy: they pad the list with system tags and
   fields that do not match the query, show no type, and ignore recency
   (§2 F2, F3). This is the first thing a Tana user touches and the cheapest
   fix on the list.
2. No inline `/` menu, no in-app Back/Forward, no subtree expand-all key, no
   previous/next day, a new query node that matches every node in the store.
3. AI: kb has an agent chat dock and a one-shot completion port, but nothing
   that runs on a node. Nobody except Notion has an AI-filled field, and no
   pure outliner has one, so the open slot is real (§4).

Fifteen ranked gaps are in §5. Eight briefs in seven work packages that touch
disjoint files are in §6 and §7.

**How this was made, honestly.** Web research (three parallel agents over
official docs and changelogs, raw reports in the thread storage, URLs in §10),
a read of kb's outliner code and docs, and about 11 minutes of scripted
keyboard driving of the real UI in headless Chrome (Linux, so `Ctrl` is
`Mod`) on a scratch store seeded from an outline paste. That is **not** the 30
minutes of hands-on use the brief asked for: the feel of latency and motion,
mouse-first flows and every ⌘ chord on macOS were not judged. §2 lists what
was observed; §9 lists what was not verified.

## 1. What "Tana" means in November 2026

Since March 2026 there are two products. **Tana Outliner**
(`outliner.tana.inc`, the product everyone meant until 2025) is still
developed; the old `tana.inc/docs` URLs redirect to it. **The new Tana**
(`tana.inc`) is an agentic meeting and document platform with a block editor,
supertags renamed Types and fields renamed Attributes. This study means
Tana Outliner. Its 2026 direction, from the changelog and the Tana Current
posts: pivot tables (2026-11-16), Lanes, collapsible and hideable groups,
"each command undoes as one step" (2026-10-12), a "Paused" guard against
runaway edits from automation or MCP, local and hosted MCP (94% of new nodes
in one October snapshot came through MCP), AI chat that writes Mermaid, and
"Copy node ID" for agent workflows.

## 2. Friction log: kb's outliner as a Tana user feels it

Scripted session, scratch store `kb init` plus an outline paste, kb UI at a
loopback port. Screenshots are in
[`assets/2026-11-20-outliner-parity/`](assets/2026-11-20-outliner-parity/).
"Works" lines matter as much as the friction: they say what not to rebuild.

**Works, and as good as Tana or better**

- **W1. `>` makes a field.** Typing `>du` opens a picker; Enter adds the row
  and puts the caret in the value ([01](assets/2026-11-20-outliner-parity/01-field-picker-gt.jpg)).
  `outline-triggers.ts` `fieldOpen`, `enterFields`.
- **W2. Natural-language dates.** In a date slot, `tom` offers Saturday
  Nov 21 with a calendar that has day, week and month keys
  ([03](assets/2026-11-20-outliner-parity/03-date-natural-language-tom.jpg)).
- **W3. Esc, Shift+↓, Tab on a range, ⌃Z.** A range of rows indents as one
  and one ⌃Z takes it back
  ([06](assets/2026-11-20-outliner-parity/06-multi-select-range.jpg),
  [07](assets/2026-11-20-outliner-parity/07-multi-select-indent.jpg)).
- **W4. Bullet drag** shows the drop line and the dragged label
  ([10](assets/2026-11-20-outliner-parity/10-bullet-drag-indicator.jpg)).
- **W5. ⌘K on a row** lists 31 commands (Add tag, Turn into query, Add
  field, Move to…, Move and leave reference…, View as ×6, Filter…, Copy as…,
  Pin, Copy node ID, Delete) anchored to that row
  ([04](assets/2026-11-20-outliner-parity/04-node-palette-cmd-k.jpg)).
- **W6. Enter at the end of an expanded parent** makes the first child, as
  Tana does ([12](assets/2026-11-20-outliner-parity/12-enter-first-child.jpg)).
- **W7. Fast typing after Enter** (`Enter`, `fastone`, `Enter`, `fasttwo`,
  `Tab`, ` #ta` with no delays) landed correctly.
- **W8. `⌃.` zooms**, breadcrumbs show Daily notes › 2026 › Week 47 › day ›
  node ([05](assets/2026-11-20-outliner-parity/05-zoomed-backlog.jpg)); `⌃⇧D`
  goes to today; `⌃↑` collapses.

**Friction**

- **F1. `/` does nothing.** Typed ` /` in a row: no menu. Tana, Workflowy,
  Heptabase, Dotflowy and Amplenote all put their command and AI entry
  points there.
- **F2. `#` picker noise.** Typing `#ta` lists `task`, `status-option`, then
  `agent-provider`, `approval-policy`, `calendar`, `canvas`, `comment`,
  `day`, `event`, `facet`, `google-account` under it, none containing the
  query
  ([08](assets/2026-11-20-outliner-parity/08-tag-picker-sys-tags-first.jpg)).
  Root cause: `matchCandidate` (`kit/ui-sdk/src/lib/picker.ts`) has a tier
  "the _id_ contains the query", and every shipped tag's id is
  `sys.tag.…`, which contains `ta`. The row shows the label, so the match is
  invisible. `outline-triggers.ts` `stepTrigger` then calls `pickerRows` over
  an alphabetical `nodesOfKind` list: `orderCandidates` and
  `picker-recency.ts` exist but only the value picker uses them
  (`field-picker.tsx`), so a declared seam is unused here (Rule 1: a dead
  seam is a duplicate).
- **F3. `>` picker noise.** `>du` also offers `Sky · Stars and dust`,
  `Captured URL`, `view.saved-query`, `show child counts`
  ([01](assets/2026-11-20-outliner-parity/01-field-picker-gt.jpg)). No type
  glyph, no "used by N nodes", no recency; `Create field "du"` makes a text
  field with no way to say a date at creation.
- **F4. `> due` (space) is dead.** The pattern needs the name to follow `>`
  at once; with a space the picker never opens and the text stays literal.
- **F5. New query matches the whole store.** "Turn into query" on a row
  writes `[:find ?id :where [?n :node/id ?id]]`; the page shows "870 nodes"
  and pours system nodes under the row
  ([09](assets/2026-11-20-outliner-parity/09-new-query-matches-all-nodes.jpg)).
  Tana asks for the first condition.
- **F6. ⌘S is advertised and unbound.** The node palette's "Search
  everything… ⌘S" (`app/ui/src/lib/commands.tsx:494`); `page-keys.ts` says ⌘S
  is left to the browser. Ctrl+S did nothing in the test.
- **F7. No in-app Back/Forward.** `kit/ui-sdk/src/lib/router.ts` is
  `pushState` plus `popstate`; no button, no key. A browser tab has the
  browser's Back; the desktop app's store window (Electrobun,
  `packages/app/desktop`, which shows the store's own kb page) has no
  navigation chrome of its own and only its menu and keys. The phone app
  planned in `docs/research/2026-11-18-desktop-and-phone-apps.md` is
  capture-only and shows no kb page, so Back does not apply to it. `Alt+←`
  and `Ctrl+[` were inert in the test.
- **F8. Zoom is a selection key only.** `⌘.` is bound in
  `selection-keymap`, not in `EDITING_BINDINGS`
  (`outline/src/keyboard.ts`); there is no zoom-out key.
- **F9. Expand/collapse all has no key**, and works on the whole scope only:
  `outline-commands.tsx:87–95` (global commands), `outline.store.ts:670`.
- **F10. Misleading refusal.** Tab on a range that starts at the first child
  toasts "Only rows next to each other under one parent move together"
  (`app/ui/src/actions/mutations.ts:78`,
  [06](assets/2026-11-20-outliner-parity/06-multi-select-range.jpg)), but the
  rows are adjacent; the first row has no previous sibling to indent into.
- **F11. `[[` offers the row itself.** The picker for `see [[Ship` lists the
  row's own text as a candidate
  ([11](assets/2026-11-20-outliner-parity/11-ref-picker-double-bracket.jpg));
  `@` excludes self and ancestors (`selfAndAbove`), `[[` does not.
- **F12. Two writes per pick.** A `#`/`>` pick removes the trigger text and
  commits the step as separate writes, so one ⌃Z takes back only the step
  (`GAP 01M7D4AYQFJGZQGJZ3KD7M388R`, `outline-triggers.ts`). Tana made every
  command one undo step in October.
- **F13. One merged-text accident, not reproduced.** The first scripted
  `Enter`, type, `Tab`, type run on a parent that had children ended with
  "Standup notesAgenda" in one row; the identical fast sequence later worked
  (W7). Filed here as a possible race, not as a bug.

## 3. Parity matrix

Columns: **Tana** = Tana Outliner (Mac | Windows keys, `Cmd`→`Ctrl`);
**Others** = what the competitors do; **kb today** = Have / Partial / Missing
with code refs (kb's `Mod` is ⌘ on macOS and Ctrl elsewhere); **O?** =
outliner-only (yes means it needs nothing but nodes, fields, tags and
projections of them); **Val** 1–5; **Eff** S/M/L; **Deps**.
`UNV` marks a Tana or competitor fact the research could not verify.

### 3.0 The two tests, and what fails them

Every row and every brief had to pass two tests, and the owner asked that
anything failing either be marked excluded with the reason.

- **Outliner-only.** The feature is nodes, fields, tags, or an operation or
  projection on them. It adds no data model and no app surface (a page, dock,
  pane, wizard or review screen). A command, a key, a trigger, a picker row,
  a section the node page already has or a chip on a row is a presentation of
  something that exists, not a surface.
- **AGENTS.md.** **Rule 1** (abstraction before addition: one mechanism per
  concept, one owner, no parallel path, no dead seam), **one contract, every
  implementation** (a capability is a port member with one shared contract
  suite), **canonical statements** (the spec has one home and other files
  link to it). Each brief ends with a "Passes both tests" paragraph.

Excluded, with the test each fails:

| Idea (source) | Fails | Why |
|---|---|---|
| Voice, live transcription, meeting bot, botless notetaker (Tana, Mem, Capacities) | outliner-only | an audio and calendar pipeline plus a capture surface; only its output would be nodes |
| Image generation (Tana) | outliner-only | an asset-making surface, not an outline operation |
| Whiteboards, mind maps, canvas, sections (Heptabase, Capacities, RemNote) | outliner-only | a spatial data model; kb's canvas is its own track |
| Typed object stores, Notion-style databases (Capacities, Anytype, Notion) | outliner-only | a second model beside tags and fields |
| Flashcards and spaced repetition (RemNote, Logseq) | outliner-only | a card queue and scheduler |
| Global clipper, `⌘⇧Space` capture, floating capture windows (Tana, Roam Sidecar) | outliner-only | an OS-level surface; kb has a capture track |
| AI chats sidebar and a hub of chat threads (Tana) | outliner-only, Rule 1 | a parallel surface beside the agent dock; only "insert the reply as nodes" survives (rank 6) |
| A review or diff pane for AI edits (Mem Clean Up) | outliner-only, Rule 1 | a bespoke screen; review is a tag, a query and a palette step instead (Briefs 5 and 8) |
| AI that creates tags, collections or options (Mem auto-organize) | Rule 1, data-plane freedom | the model would mint structure; the rule is existing structure only |
| Diagram and slide generation (Napkin AI) | outliner-only | output is not nodes |
| Credit meter and the "Paused" runaway guard (Tana) | outliner-only | product metering; kb's approval guards cover the write case |
| Whiteboard-over-MCP, canvas skills (Heptabase) | outliner-only | needs the whiteboard model |

Reshaped to pass: Tana's AI command nodes (a command node with child
parameters) become `#prompt` nodes behind one palette step, because the
command-as-nodes track is undecided (§8, item 4); Notion's Autofill triggers
become a manual "Fill fields with AI…" command, because triggers are
transaction reactions and need their own design; Tana's "Open in new
panel" stays the existing command with no new gesture.

### 3.1 Navigation

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Zoom in | click bullet; `⌘.` \| `Alt+→` | Workflowy bullet click; Dotflowy Cmd-K | **Partial.** Bullet and `⌘.` in selection mode only (`selection-keymap.ts`); not in edit mode (F8) | yes | 3 | S | Brief 4 |
| Zoom out / Back | `⌘,` \| `Alt+←`; Back and Forward buttons (Forward key UNV) | Reflect `⌘[` `⌘]`; Workflowy Back/Forward per pane | **Missing** in-app (F7); browser history only | yes | 4 | S | Brief 3 |
| Breadcrumbs | each crumb jumps up the owner chain | all | **Have** (`breadcrumbs.tsx`, 05) | yes | 4 | — | |
| Focus between nodes | ↑ ↓; `Shift+↑↓` extend | Heptabase Up/Down select | **Have** (Mode A and B; `editing-keymap.ts`, `selection-keymap.ts`) | yes | 5 | — | |
| Collapse / expand one level | `⌘↑` `⌘↓` \| `Ctrl+↑↓` | Capacities `⌘Enter`; Heptabase `⌘Enter` | **Have** (`collapse-or-leave`, `expand`, both ⌘ and ⌃) | yes | 4 | — | |
| Collapse / expand all levels | `Ctrl+⌘↑↓` \| `Ctrl+Alt+↑↓` | Capacities `⌘O` folds every toggle | **Partial.** Global commands only, whole scope, no key (F9) | yes | 3 | S | Brief 4 |
| Jump / search palette | `⌘S` jump, `⌘K` command line, `⌘E` quick add, `⌘N` create | Capacities `⌘P`; Reflect `⌘K`; Heptabase `⌘O` | **Have** ⌘K = global search or row palette (`page-keys.ts`). `⌘S` label is false (F6) | yes | 4 | S | Brief 6 |
| Search result → query node | `Alt+Enter` in search; `Tab` = search within | Capacities Search 3.0 modes | **Missing** | yes | 3 | M | Brief 6 |
| Quick capture from anywhere | `⌘⇧Space` clipper, `⌘⇧E` voice | Mem, Reflect, Capacities widgets | **Partial.** Desktop quick capture and share receivers (docs/research/2026-11-18-desktop-and-phone-apps.md); not outline UX | no (platform) | — | — | out of scope |
| Sidebar / pinned | pinned nodes and searches; drag to pin | Workflowy | **Have** (Pinned, Recent, `Pin`) | yes | 3 | — | |
| Side panels | `Shift+click`; `⌥⇧.` | Workflowy Panes (Alt+click, Sep 2026) | **Partial.** "Open in panel" command (`commands.tsx` `open-beside`); no click gesture or key | yes | 2 | S | backlog |
| Day stepping | `Ctrl+[` `Ctrl+]` prev/next calendar node | Amplenote jots | **Missing** (Today is `Mod-Shift-D`, `days/src/extension.ts`) | yes | 3 | S | Brief 3 |

### 3.2 Node editing

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| New sibling / first child | `Enter`; Enter at end of expanded parent = first child (UNV) | all | **Have** (W6) | yes | 5 | — | |
| Insert node before | `⌘⇧Enter` | — | **Partial.** `O` in selection mode only (`selection-keymap.ts`) | yes | 2 | S | Brief 4 |
| Indent / outdent | `Tab` `Shift+Tab` | all | **Have**; the refusal toast is wrong for the first child (F10) | yes | 5 | S | Brief 4 |
| Move among siblings | `⌘⇧↑↓` | Capacities `Alt+↑↓` | **Have** both modes; `⌘⇧←→` moves between groups | yes | 4 | — | |
| Multi-select, bulk ops | `Shift+↑↓`; bulk tag, Set field, move, merge | Heptabase `⌘/` menu | **Have** range selection and bulk steps (`palette-steps.contract.test.tsx`); mouse range and rubber band UNV | yes | 4 | — | |
| Drag and drop | drag bullet; drop on sidebar pins | Workflowy drag to divider | **Have** (`row-drag.ts`, W4); sidebar-pin drop UNV | yes | 4 | — | |
| Paste outline | Markdown or `%%tana%%` Tana Paste; "paste options" | Workflowy OPML | **Have** (`outline-paste.ts`: Markdown and `%%tana%%`, `[[ref]]`, `#tag`, `field:: value`) | yes | 4 | — | |
| Copy out | Markdown, Tana Paste, full content | Workflowy daily OPML export | **Have** (`Copy as…` `⌘⇧C`, `copy-as.tsx`) | yes | 3 | — | |
| Undo granularity | each command = one step (2026-10-12); content-only (Apr) | Logseq undo for property schemas | **Partial.** Rows and ranges yes; trigger picks are two writes (F12) | yes | 4 | S | Brief 1 |
| Delete subtree | `⌘⇧⌫` (to Trash) | | **Have** (`⌘⌫`, `⌘Delete`, palette Delete; see docs/research/2026-11-17-safe-deletion.md) | yes | 4 | — | |
| Duplicate | `⌘⇧D` (collides with Today on Windows, UNV) | Heptabase `⌘D` | **Missing.** `⌘⇧D` is kb's Go to today | yes | 3 | M | backlog; chord decision |
| Merge nodes | command "Merge node", refs repointed | | **Partial.** Action `node.merge` exists (`operations/src/actions.ts:133`); no palette entry | yes | 2 | S | backlog |
| Checkbox | `⌘Enter` | Reflect `⌘Enter`; Capacities `⇧⌘Enter` | **Have** | yes | 4 | — | |
| Descriptions under a node | `Ctrl+I` | Capacities Description property | **Missing** | yes | 3 | M | rank 13 |
| Text formatting keys | `⌘B` `⌘I` `⌘U`, `Ctrl+H` highlight | all | **Partial.** Inline Markdown renders live, no chords | yes | 2 | S | backlog |
| Move-to finder | `⌘⇧M`; `Enter` / `⌘Enter` / `Alt+Enter` leave a reference | | **Partial.** "Move to…" and "Move and leave reference…" steps in ⌘K (`outline-steps.tsx` `moveTo`); no chord | yes | 3 | S | needs Brief 1's palette seam |
| Soft line break | none (nodes are atomic) | | **Have** `Shift+Enter` (kb is not atomic-text) | yes | — | — | no change |

### 3.3 Fields

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Create with `>` | `>` then name, `Tab` into the value | Logseq property picker; Obsidian properties | **Have** (W1); `> name` with a space is dead (F4) | yes | 5 | — | |
| Name autocomplete | existing fields first; type avoids duplicates | | **Partial.** Noisy, untyped, unranked (F2, F3) | yes | 5 | S | Brief 2 |
| Type at creation | no inference (UNV); "Set Datatype" later | Notion picks at creation | **Partial.** `defineField(name)` makes a text field; type set in field config | yes | 3 | S | follow-up of Brief 2 |
| Typed value editors | 9 types (plain, options, options from tag, date, number, user, url, email, checkbox) | Logseq 7 types | **Have** (`value-kind.ts`, `value-slot-keymap.ts`; DESIGN-UI.md → Field values) | yes | 5 | — | |
| Natural-language dates | `@fri 3p`; `Space` on empty date; `J H D W M Q Y` shift keys | Reflect, Logseq | **Have** (W2) | yes | 5 | — | |
| Options / instance fields | options sources: children, reference list, search node; auto-collect | Capacities Label vs tags | **Have** (ref fields with option children or a tag source, `refSearchOf`) | yes | 4 | — | |
| Static default values from a tag | value typed in the template is the default (2026-11 semantics: unset stays empty) | Logseq property defaults | **Missing.** Templates hold fields, not values; `fillFrom` copies from an ancestor | yes | 4 | L | rank 15; data-plane decision |
| Auto-initialize | from ancestor, current date, current user | | **Partial.** `sys.f.fillFrom` copies from ancestor and days (`DESIGN.md` → tag behaviours); no "current date" / "current user" source | yes | 3 | M | backlog |
| Keyboard flow through values | Enter on a field name goes to value (2026-11-16); `Tab` | Obsidian ↓/Tab | **Have** (`value-slot-nav.ts`; Enter adds next value, ⌫ on empty removes) | yes | 5 | — | |
| Hide when empty, required, cardinality | Hide field conditions; `Alt+click` hides | Logseq hide when empty | **Have** (`sys.f.*` settings, `hidden-fields-chips.tsx`) | yes | 4 | — | |

### 3.4 Supertags

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Apply with `#` | menu; new name = new supertag; bulk on selection | Mem `#Collection`; Amplenote inline tags | **Have**; picker noise (F2) | yes | 5 | S | Brief 2 |
| Template fields | template, optional fields | Logseq class properties; RemNote powerups | **Have** (`sys.f.fields`, `tag-fields-config.tsx`) | yes | 5 | — | |
| Extend / inheritance | Extend | Logseq multiple parents | **Have** (`sys.f.extends`, `tag-kinds.ts`) | yes | 4 | — | |
| Build title from fields | `${field}` expression | | **Have** (`sys.f.tag.title`, `nodeTitleOf`) | yes | 3 | — | |
| Child tag, checkbox mapping | Default child supertag, Done state mapping | Logseq Task statuses | **Have** (`sys.f.tag.childTag`, `check`, `checkedValue`) | yes | 4 | — | |
| Tag page of instances | first tab = table of all instances | Heptabase Tag Database | **Have** (`tagViewsOf`) | yes | 4 | — | |
| Create supertag from content | "Convert to supertag" | | **Have** (`Make supertag`) | yes | 3 | — | |
| Tag buttons and event commands | command palette on tag; on added/removed/checked | Workflowy templates | **Missing.** `docs/research/2026-11-17-commands-as-nodes.md` phases 0–1 not shipped (`callOfNode` still in `@kb/keybindings`) | yes | 3 | M | owner decision |
| Related content on a tag | search nodes beside tagged nodes | | **Missing** | yes | 2 | M | backlog |

### 3.5 References and mentions

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| `@` mention / date | `@` node or date; narrow `@#tag words` | Amplenote `@`, Reflect `[[` | **Have** (`mentionTrigger`: date first); `@#tag` narrowing missing | yes | 5 | S | backlog |
| `[[` | UNV as live trigger | Roam, Reflect, Logseq | **Have** (11); lists the row itself (F11) | yes | 5 | S | Brief 2 |
| `@` on an empty row = node reference | Enter = reference row; `Space` makes it inline | | **Missing** (only "Turn into reference…" in ⌘K) | yes | 3 | S | Brief 1 |
| Create on the fly | new name in `@`, `#`, `>` creates | | **Have** (`Create tag "x"`, `Create field "x"`) | yes | 5 | — | |
| Node references (mirrors) | dashed bullet; one owner, many parents; "Bring referenced node here" | Workflowy mirrors, Dotflowy mirrors | **Have** reference rows with the dashed ring (`isReferenceRow`); owner semantics differ | yes | 4 | — | |
| Backlinks | References section; unlinked mentions with Link; reference counter; inline-only mentions included (2026-10-09) | Amplenote carries the subtree; Heptabase hover previews; Capacities tabs | **Partial.** Shallow References list (`references-section.tsx`, `backlinks.ts`); no unlinked, no counter, no children | yes | 4 | M | Brief 7 |
| Peek a reference in place | `Shift+click` or `⌘↓` on an inline ref | Heptabase hover | **Missing** | yes | 3 | M | backlog |

### 3.6 Search nodes and views

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Create a query | `?` on empty row, "Find nodes" wizard, `Alt+Enter` from search | Logseq `#Query` node; Capacities AI-built queries | **Partial.** "Turn into query" writes an all-matching query (F5, 09); no `?` | yes | 4 | M | Brief 6 |
| Condition builder | popup; AND/OR; tag, field, text, date, regex, reference | Logseq builder; Workflowy `has:children` | **Have** (`query-builder/`, Conditions + EDN tabs) | yes | 4 | — | |
| Live results | live while expanded; limit 2500, page 100 | | **Have** (count chip); limit and paging UNV | yes | 4 | — | |
| Group / sort / filter | toolbar; commands "Group by", "Sort by" | Logseq | **Partial.** View settings popover and "Filter…" in ⌘K; no Group/Sort commands | yes | 3 | S | Brief 6 |
| Views on any node | Outline, Table, Pivot, Cards, Lanes, List, Calendar, Side menu, Tabs | Workflowy Table/Board/Calendar; Logseq Table/List/Gallery | **Have** List, Table, Board, Cards, List with detail, Calendar (`View as:`, 09). **Missing** Lanes, Pivot, table calculations (UNV) | yes | 3 | M–L | backlog |

### 3.7 Daily notes, commands

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Today | sidebar Today; `Ctrl+⇧D` | Reflect, Heptabase `⌘⇧D` | **Have** (Today button; `Mod-Shift-D`) | yes | 5 | — | |
| Calendar hierarchy | day › week › year | Amplenote | **Have** (breadcrumbs show week and year) | yes | 3 | — | |
| Node command line | `⌘K`, highlight + `⌘⇧K` makes a shortcut | all | **Have** `⌘K` (W5); shortcuts as nodes (docs/research/2026-11-11-shortcuts-as-nodes.md) | yes | 5 | — | |
| Inline `/` menu | `/` in text | Workflowy, Heptabase, Dotflowy, Amplenote | **Missing** (F1) | yes | 5 | M | Brief 1 |
| Custom command nodes | convert node to command; steps are child nodes | | **Missing** (see above) | yes | 3 | M | owner decision |

### 3.8 AI, expressed as outline operations

"Writes back" is what lands in the outline.

| Capability | Tana | Others | kb today | O? | Val | Eff | Deps |
|---|---|---|---|---|---|---|---|
| Run a prompt on a node | `Ask AI` (⌘K): node text is the prompt, answer streams as a child; AI command nodes with `${sys:context}`; prompt workbench | Workflowy AI Node and `/ai` quick actions; Capacities `/Ask AI`; Reflect `⌘J`; Amplenote `/agent` | **Missing.** `ModelCompletionService` exists (`ui-sdk/src/lib/model-completion.ts`, only the gallery uses it) | yes | 5 | M | Brief 5 |
| AI-filled field | field config "AI-enhanced" + instructions; "Run AI fields", "Autofill fields" | Capacities per-property autofill (only links existing); Notion Autofill (manual, on create, on edit) | **Missing** | yes | 5 | L | Brief 8 |
| AI tagging / structure | `Autotag` with tag candidates; "Suggest AI fields" | Capacities auto-tag (existing tags only); Mem auto-organize (creates collections); Napkin topics | **Missing** | yes | 4 | M | Brief 8 |
| Chat over the outline | `Space` on an empty trailing node; `@` adds context; chats saved as nodes | Capacities `⌘J` (chats are objects); Workflowy `/chat`; Heptabase context picks | **Partial.** Agent dock gets the screen, focus and selection with every message and calls kb's actions (`agent/src/prompt.ts`, DESIGN.md → Agent packages); transcript is not nodes; no "insert reply as nodes" | yes | 4 | S–M | rank 6 follow-up |
| Preview, then apply | Prompt workbench; chat insert buttons | Capacities Generate/Approve; Mem Refine/Accept/Reject diff; Logseq "pretend"; Amplenote accept/reject score | **Partial.** Action approval dialog and one-tx undo; no content preview | yes | 4 | M | Briefs 5, 8 use palette steps |
| Attribution and review of AI edits | "Paused" guard; none in-row | Roam "(AI)" author; Dotflowy agent-name label; Mem version diff | **Partial.** `KbTx.actor`/`via` is recorded; nothing shows it in a row | yes | 3 | M | rank 12 |
| "Private: never send to AI" | — | Reflect per-note Private flag | **Missing** | yes | 3 | M | rank 14 |
| Agent guidelines node | — | Roam `get_graph_guidelines`; Heptabase Space Instructions; Obsidian skills file | **Partial.** `AGENT_SYSTEM_PROMPT` is code | yes | 3 | S | backlog |
| MCP / API | local `:8262/mcp`, hosted beta, `Copy node ID` | Roam, Workflowy, RemNote, Logseq, Heptabase, Capacities, Dotflowy, Checkvist | **Have** (`kb mcp`, WebMCP, `Copy node ID`) | yes | 5 | — | |
| Transcribe / meeting agent | botless notetaker, meeting bot | Mem, Capacities audio | **DROP.** Needs an audio and calendar pipeline, not the outline | no | — | — | |
| Image generation | `Generate image(s)` | | **DROP** | no | — | — | |
| Whiteboard, mind map, canvas | — | Heptabase, Capacities, RemNote | **DROP** for this study (kb has canvas as its own track) | no | — | — | |

## 4. How the AI-infused tools put AI on the user's content

Condensed from the raw reports (competitor reports A and B). Seven patterns,
and which ones an outline-only tool should take.

1. **Agent writes are ordinary node edits, attributed and reviewable in
   place.** Roam tags edits "(AI)"; Dotflowy labels them with the agent's
   name and shows them live; Logseq and Capacities keep history. kb already
   records `KbTx.actor` and `via`; it does not show them. _Take._
2. **Preview, then apply.** Capacities (Generate/Approve cards, auto-approve
   toggle), Mem (inline diff with Refine, Accept, Reject), Amplenote (accept,
   reject or edit each score), Logseq ("pretend" mode). A diff and a revert
   on every AI write is table stakes. kb's palette steps already show a
   pickable list before a commit, so a proposal can be a step. _Take._
3. **Existing structure only.** Capacities' autofill and auto-tag only link
   existing tags and objects, and a November 2026 release made that strict
   (autofill no longer creates objects). Mem's auto-organize creates
   collections and is the cautionary opposite. kb's rule: AI picks among
   existing tags and options, never mints one. _Take._
4. **AI as a field setting.** Capacities and Tana put the instruction on the
   field definition; Notion adds a trigger (manual, on create, on edit).
   No pure outliner has it. In kb this is one more setting on `sys.field`,
   next to `fillFrom`. _Take; it is the open slot._
5. **AI as a node.** Workflowy's AI Node holds a prompt whose output becomes
   nodes in the document. Tana's AI command node is the same idea with
   parameters. In kb the prompt is a node and "Ask AI…" is a palette step
   over those nodes. _Take, small._
6. **Block-granular write surface for external agents** (Reflect insert at a
   position, rewrite a block, restyle, toggle; Heptabase edit part of a note;
   Logseq batch + pretend). kb's MCP and actions already are this. _Have._
7. **Per-node Private flag, and a guidelines node the agent reads first**
   (Reflect, Roam, Heptabase Space Instructions). _Take, later._

Dropped as non-outline: whiteboards, mind maps, PDF panes, flashcard queues,
separate object databases, floating capture windows, diagram generation
(Napkin AI), audio pipelines.

Market note: in 2026 nearly every outliner shipped an MCP server instead of,
or beside, a built-in AI; differentiation moved to the safety model around
writes. Mem announced on 2026-11-16 that it is shutting down (read-only 18
Dec 2026, access ends 15 Jan 2027).

## 5. Top 15 gaps, ranked by value / effort

Ratio = value ÷ effort (S=1, M=2, L=3). Ties break by value.

| # | Gap | Val | Eff | Ratio | Brief |
|---|---|---|---|---|---|
| 1 | `#` / `>` / `[[` pickers: drop non-matching system rows, rank by recency and use, show type and use count | 5 | S | 5.0 | 2 |
| 2 | In-app Back / Forward, plus previous / next day | 4 | S | 4.0 | 3 |
| 3 | Structure keys: subtree expand/collapse all, insert before and zoom in edit mode, zoom out, an honest first-child refusal | 4 | S | 4.0 | 4 |
| 4 | One undo step per trigger pick (closes `GAP 01M7D4AYQFJGZQGJZ3KD7M388R`) | 4 | S | 4.0 | 1 |
| 5 | `@` on an empty row makes a node-reference row | 3 | S | 3.0 | 1 |
| 6 | Insert an agent reply into the outline as nodes | 3 | S | 3.0 | rides in 5 |
| 7 | Inline `/` command menu | 5 | M | 2.5 | 1 |
| 8 | Run a prompt on a node; result as child nodes | 5 | M | 2.5 | 5 |
| 9 | Query ergonomics: first condition at creation, Open as query from search, Group/Sort commands, honest ⌘S | 4 | M | 2.0 | 6 |
| 10 | Backlinks: unlinked mentions with Link, breadcrumbs and children, reference counter | 4 | M | 2.0 | 7 |
| 11 | AI-filled fields and AI tagging, preview then apply | 5 | L | 1.7 | 8 |
| 12 | Show and review AI edits in place (actor chip, accept or reject all) | 3 | M | 1.5 | follow-up |
| 13 | Descriptions under a node | 3 | M | 1.5 | follow-up |
| 14 | Per-node Private flag honoured by every AI path | 3 | M | 1.5 | follow-up |
| 15 | Static default values in tag templates (data-plane decision) | 4 | L | 1.3 | follow-up |

The eight briefs cover ranks 1–5 and 7–11. Gaps 4, 5 and 7 are one brief
because all three edit `stepTrigger` and `outlineTriggers`; splitting them
would make two builders edit the same function. Rank 6 is a small optional
last step of Brief 5. Brief 8 is ranked 11th by ratio but is the one that
completes the AI story, and depends on Brief 5's plumbing; the owner may
stop after Brief 5.

## 6. Work packages

Seven packages, each owning a disjoint set of files, so they can run in
parallel. "Owns" means no other package edits that file; a package may read
anything. Briefs 5 and 8 share one package because they share one runner and
must be serial.

| WP | Briefs | Owns (files) | Touches shared docs |
|---|---|---|---|
| **WP-1 Row triggers** (after WP-2, see below) | 1 | `outline-ui/src/outline-triggers.ts`, new `outline-ui/src/slash-trigger.ts`, `kit/ui-sdk/src/components/node-text-host.tsx` (`applyPick`), `kit/ui-sdk/src/host.ts` (+ its test host), `app/ui/src/browser-host.ts` | DESIGN-UI.md → "Triggers in the text" paragraph (~line 1699); the BrowserHost contract |
| **WP-2 Pickers** | 2 | `kit/ui-sdk/src/lib/picker.ts`, `text-triggers.ts`, `refs.ts`, `use-picker.ts`, `outline-ui/src/outline-steps.tsx`, `picker-recency.ts`, `field-picker.tsx`, and both trigger test files, `kit/ui-sdk/src/lib/text-triggers.test.ts` and `app/ui/src/page-tests/outline/text-triggers.test.tsx` | DESIGN-UI.md → pickers |
| **WP-3 History** | 3 | `kit/ui-sdk/src/lib/router.ts`, `app/ui/src/components/App.tsx` (header), `domain/model/src/model.ts` + `domain/seed/src/seed.ts` (two command ids), `days-ui/src/command.ts`, `days/src/extension.ts` | DESIGN-UI.md → Days; Panes |
| **WP-4 Structure keys** | 4 | `outline/src/keyboard.ts`, `outline-ui/src/editing-intents.ts`, `editing-keymap.ts`, `selection-keymap.ts`, `outline.store.ts`, `app/ui/src/actions/mutations.ts` | DESIGN-UI.md → Outline editor keymap tables |
| **WP-5 Queries** | 6 | `app/ui/src/lib/commands.tsx`, `app/ui/src/lib/query-node.ts`, `outline-ui/src/query-builder/*`, new `outline-ui/src/query-steps.tsx` and its one contribution line in `outline-ui/src/plugin.ts`, `view-settings-*.ts(x)`, `app/ui/src/components/palette/command-palette.tsx` | DESIGN-UI.md → query node, node menu |
| **WP-6 Backlinks** | 7 | `outline-ui/src/references-section.tsx`, `backlinks.ts`, new `unlinked-mentions.*`, the row counter in `row-view.tsx` / `node-block.tsx`, `outline/src/settings.ts` | DESIGN-UI.md → Contextual references |
| **WP-7 AI on nodes** | 5 then 8 | `extension/agent/src/*`, `extension/agent-ui/src/*`, the agent family's seeds | DESIGN.md → Agent packages; DESIGN-UI.md → the node menu |

Cross-package edges (all but the first are order hints, not file conflicts):

- **WP-1 runs after WP-2.** Both briefs add cases to the two trigger test
  files, so one package owns them: WP-2, whose picker work is already being
  built and lands first. WP-1 starts from WP-2's merged branch (rebase onto
  it before adding its own cases) and appends to those files; it does not
  create parallel copies. Every other file stays disjoint, so WP-1's source
  edits can be written meanwhile, only its tests wait.

- WP-1's `/` menu lists the node palette's commands, so WP-5's and WP-7's new
  commands show up in it with no further work.
- WP-1 adds a `BrowserHost` member (`nodeCommands`, `openNodePalette`);
  nothing else edits `host.ts`.
- WP-5 reads `addTag` (exported from `outline-steps.tsx`, which WP-2 owns)
  and does not edit it.
- WP-3 adds commands through the plugin path that `days` and `outline`
  use, not `commands.tsx`, which WP-5 owns.
- `DESIGN-UI.md` is edited by every package, in different sections. Rebase
  over each other; do not reformat.

**Gate notes for every builder** (stated once; the sources are `AGENTS.md`
and `docs/ci.md`): work in `nix develop`; run the cheap chain (typecheck, the
repo's lint, the focused tests of what you touched), never the full core
suite; the pre-commit hook (`bun run verify` plus generated docs) is the
gate and is never skipped; any change in a browser package needs the whole
`bun run test:ui` before you push, since `tokens.test.ts` scans every
package; a changed action or schema needs `packages/app/server/tests/wire-protocol.test.ts`
and the fingerprint recorded in that commit; eager UI code changes need the
page-bundle budget run from a short path; rebase and merge under
`nix develop` so the `nodes.jsonl` merge driver runs; leftover problems
become `#gap` nodes via `kb add … --tag gap --create`, not TODO comments.
Restructure first, then add, as separate commits (Rule 1).

## 7. Build briefs

Each brief: **Goal**, **Behaviour** (exact keys), **Where**, **Rule 1 notes**,
**Acceptance tests**, **Screenshots**, **Out of scope**. Screenshot scripts are
the ones used here (§2): scratch store, outline pasted from
`- Project Atlas` / `  - Backlog` / `    - Write spec` …, loopback port, a
headless browser at 1400×900, before and after, saved to your thread
storage.

---

### Brief 1: Row-text triggers: `/` menu, `@` on an empty row, one undo step per pick (WP-1)

**Goal.** A power user types `/` and gets the same commands ⌘K offers, runs
one, and ⌃Z takes back exactly that. `@` on an empty row makes a reference
row.

**Behaviour.**

- `/` opens a picker when it is the first character of the row's text or
  follows a space (the `openedAfterSpace` pattern `#` uses; query `[^\s/]*`).
  A `/` inside a word or URL (`a/b`, `http://x`) never opens it. Rows are the
  node-menu commands that apply to this row, the same set and order ⌘K shows
  with nothing typed, filtered by `pickerRows`. Esc closes it and leaves the
  text. Enter or Tab picks.
- A pick removes `/query` from the text, then runs the command about this
  row. A command that is a picker step (Add tag, Add field, Move to…, Turn
  into reference…) opens the node palette on that row seeded with the
  command's label, since a key has no picker to open (DESIGN-UI.md → Outline
  editor, the sentence that says a key-run step "needs the node palette").
- `@` as the row's whole text, then a pick (node or date): the row becomes a
  reference row to that node, the write `Turn into reference…` makes, not an
  inline `[[id|label]]`. `@` after other text keeps today's inline behaviour.
- A `#`, `>`, `@` or `/` pick is one undo entry. ⌃Z once restores the row as
  it was before the pick (the typed trigger text back, the tag, field or
  reference gone). Typing itself keeps the text host's history.
  Today a pick is two writes: `applyPick` emits the text through
  `updateNodeContent`, a keystroke write that records no undo step and never
  joins a gesture (`app/ui/src/actions/mutations.ts`, `updateNodeContent`
  bypasses `runPlan`), then runs the pick's `write`, which records its own
  step.

**Where.** `outline-ui/src/outline-triggers.ts`: add `slashTrigger` in a new
`slash-trigger.ts` and register it in `outlineTriggers`; change `stepTrigger`
so the whole pick is one transaction. `asOneWrite`
(`kit/ui-sdk/src/lib/command-point.ts:254`) is not the tool: it skips
batching for a single row (`rows.length > 1 ? together(...) : gesture()`),
so a one-row pick would still be two writes. The mechanism is
`PageWrites.together` itself (`kit/ui-sdk/src/lib/page-writes.ts`, implemented
by `together` and `runPlan` in `app/ui/src/actions/mutations.ts`): inside it
each planned write is queued and sent as one `node.batch` call, recorded as
one undo step whose inverse is built from the graph as the gesture found it.
Only plan-based writes join it, so the text removal must be `setNodeText`
(which goes through `applyPlan`), not `updateNodeContent`. In
`kit/ui-sdk/src/components/node-text-host.tsx`, `applyPick` keeps laying the
span's replacement into the editor and moving the caret as now (that is the
editor's local state), but its persisted write moves into the pick's
`write`: `host.writes.together(async () => { await setNodeText(nodeId,
nextText); await step.commit(...) })`. Every trigger's pick (`[[`, `@`,
`#`, `>`, `/`) takes the same path, so there is one way a pick writes, not a
step-only branch (Rule 1). Two things the builder must prove: the keystroke
text before the pick (`x #ta`) has landed before the batch plans, since the
batch's undo restores what the graph held when it opened; and a step that
awaits a minted id (`defineTag`) still gets it, because a write inside
`together` answers the id it will make before it lands. Then delete the
`GAP [[01M7D4AYQFJGZQGJZ3KD7M388R]]` comment and its `#gap` node (`kb rm`). The listing needs a port: add to `BrowserHost`
(`kit/ui-sdk/src/host.ts`) `nodeCommands(nodeId): readonly {id; label; icon?;
step: boolean}[]` and `openNodePalette(nodeId, query)`, implemented in
`app/ui/src/browser-host.ts` over `listNodeCommands` and the palette opener
(`components/palette/command-palette.tsx`, `lib/commands.tsx`: read, do not
edit). `runCommand` already exists (`host.ts:112`).

**Rule 1.** One mechanism per concept: the slash menu is the node menu's
command list through the host, not a second command registry. The interface
names the capability (`nodeCommands`), and the test host in `ui-sdk`
implements it too, so the unit tests and the real page meet one contract.
Do not copy `listNodeCommands`.

**Acceptance tests** (add to `app/ui/src/page-tests/outline/text-triggers.test.tsx`
and `kit/ui-sdk/src/lib/text-triggers.test.ts`):

1. `open` pattern: opens at start and after a space, not in `a/b`,
   `https://x`, or after `[[`; the query stops at a space.
2. Component: type `/ind` on a row with a previous sibling, Enter: the row
   is indented and its text is empty.
3. Component: `/tag` lists "Add tag" first; Enter opens the palette on that
   step; picking a tag applies it.
4. Undo: type `x #ta`, pick `task`: ⌃Z once leaves `x #ta` and no tag; ⌃⇧Z
   redoes. Same for `>due` and `/indent`. Assert the history gained exactly
   one entry for the pick (one `node.batch` call carrying the text write and
   the tag write), including on a single row, where `asOneWrite` would have
   made two.
5. `@` as whole text, pick "Ship beta": the row is a reference row (has the
   dashed ring, `isReferenceRow`) and the text is not duplicated; `see @Ship`
   keeps the inline ref.
6. `palette-steps.contract.test.tsx` still passes unchanged.

**Screenshots.** Slash menu open with nothing typed; filtered to `/ind`;
a reference row made by `@`; before and after ⌃Z of a `#` pick.

**Passes both tests.** _Outliner-only:_ a trigger in a row's text and a
picker over commands; the result is a tag, a field, an indent or a reference
row, all existing outline operations; no new surface (the menu is the picker
every trigger already opens). _AGENTS.md:_ **Rule 1**, the slash menu reads
the node menu's one command list through the host, so there is no second
registry, and the undo fix removes a split write rather than adding a
workaround (it closes a `#gap`); **one contract**, `nodeCommands` and
`openNodePalette` are `BrowserHost` members, implemented by the page host and
the `ui-sdk` test host and proved by one contract test run over both (beside
`palette-steps.contract.test.tsx`); **canonical statement**, the `/` row goes
into the existing "Triggers in the text" paragraph of DESIGN-UI.md and the
two members into the BrowserHost contract, nowhere else.

**Out of scope.** AI entries (WP-7 adds them as commands); a `?` trigger
(Brief 6's creation flow is reachable from `/`).

---

### Brief 2: Picker hygiene and ranking (WP-2)

**Goal.** `#`, `>`, `@` and `[[` offer what you meant first, and nothing that
does not match.

**Behaviour.**

- A candidate matches only by its **label**, or by its id's last segment
  when the query is at least two characters and the id is not a ULID. The
  "id contains the query" tier stops matching `sys.tag.*` prefixes: `#ta`
  lists `task` and `status-option` (label match) and not `calendar`.
- With **nothing typed**, `#` and `>` show: recently picked (by trigger
  scope, `picker-recency.ts`, now noted on pick), then tags or fields in use
  by count (graph-derived, as `field-picker.tsx` does), then nothing else.
  Shipped schema nobody uses appears only when the query matches its label.
- Rows carry a leading glyph (the field's type glyph via `fieldGlyphOf`,
  `value-views.ts`; the tag hash for tags) and a trailing `note` such as
  "12 nodes". `PickerCandidate` and `PickerRow` gain an optional `glyph`;
  `PickerList` draws it.
- `[[` excludes the row it is typed in, as `@` does (`selfAndAbove`).

**Where.** `kit/ui-sdk/src/lib/picker.ts` (`matchCandidate`, `pickerRows`,
`orderCandidates`), `text-triggers.ts` (`refTrigger`), `refs.ts`
(`nodeCandidates`), `use-picker.ts`; `outline-ui/src/outline-steps.tsx`
(`addTag.candidates`, `addField.candidates`: sort through `orderCandidates`
with `recentPicks("tag")` / `("field")` and a use-count map; `notePick` in
the commit); `picker-recency.ts`. Do not edit `outline-triggers.ts`
(WP-1 owns it): `stepTrigger` already reads `step.candidates`, so the order
arrives through it.

**Rule 1.** The recency seam and `orderCandidates` already exist and the
value picker uses them; applying them to the trigger steps removes the dead
seam. Do not add a second ranking function.

**Acceptance tests.**

1. `picker.test.ts` (new, in `kit/ui-sdk/src/lib/`): query `ta` over
   candidates whose ids are `sys.tag.calendar`, `ex.tag.task`,
   `sys.tag.status-option` returns `task`, `status-option` only; a ULID id
   never matches; a query `sys.` still reaches system ids.
2. `orderCandidates` with recents and uses: empty query returns recents
   first, then by use count, then (only matching) the rest.
3. `text-triggers.test.tsx`: with an empty `#`, an unused shipped tag is
   absent; after picking `task` once it is first next time in the session.
4. `[[` does not list its own row.
5. Existing `field-picker.component.test.tsx` and
   `palette-steps.contract.test.tsx` pass.

**Screenshots.** The F2 and F3 screens before and after: `#ta` (08), `>du`
(01), and an empty `#`.

**Passes both tests.** _Outliner-only:_ it reorders and filters the rows of
pickers that already exist; no data, no surface. _AGENTS.md:_ **Rule 1**,
this deletes a dead seam (the recency and use-count ordering exists and only
one picker uses it) and keeps one ranking function for every picker;
**one contract**, `pickerRows` and `orderCandidates` are the single contract
every picker meets (value picker, triggers, palette steps), and the new
cases go in `picker.test.ts` over that contract, not in a trigger-only test;
**canonical statement**, the picker rules stay in the DESIGN-UI.md paragraph
that owns them and the new tiers replace the old text there.

**Out of scope.** Type chooser on field creation (`>due:date`); that is a
follow-up once glyphs exist.

---

### Brief 3: In-app Back / Forward and day stepping (WP-3)

**Goal.** Back and Forward exist as buttons and keys in every shell, and a
day page steps to the next or previous day.

**Behaviour.**

- Two buttons beside the sidebar toggle in the header
  (`app/ui/src/components/App.tsx`, next to `SidebarToggle`): Back and
  Forward, disabled when there is nowhere to go; tooltips name the key.
- Keys through the page context (`core.page`, offered before any surface):
  `Mod-[` Back and `Mod-]` Forward. `Mod` is ⌘ or Ctrl on every platform:
  chord matching reads `meta || ctrl` and has no platform branch
  (`domain/keybindings/src/chord.ts`, `modifiersMatch`), so one binding
  covers ⌘[ on macOS and Ctrl-[ elsewhere. They are commands (`Go back`,
  `Go forward`), so ⌘K lists them and a person can rebind them as any
  shortcut. No `Alt`-only chord: `core.page` reserves every chord without ⌘ or
  Ctrl (`reserved: [{ mod: false }, PALETTE_CHORD]`,
  `application/operations/src/keyboard.ts`), so `Alt-ArrowLeft` and
  `Alt-ArrowRight` are refused for any plugin that is not core ("reserved in
  core.page"). Core itself may hold one, but then `admitKeymaps` evicts the
  outline's own `ArrowLeft` / `ArrowRight` selection keys
  (`close-or-climb`, `open-or-descend` are `mod: false` with `alt`
  unconstrained, so they overlap), and on macOS Alt-←/→ is also the text
  caret's word jump. Checked with `admitKeymaps` over `CORE_KEYBOARD` and
  `OUTLINE_KEYBOARD`.
- Day stepping: commands `Previous day` and `Next day`, bound in `core.page`
  by the days family as `Mod-Alt-ArrowLeft` and `Mod-Alt-ArrowRight` (admitted
  for a non-core owner: they hold ⌘ or Ctrl, and no outline binding
  overlaps them). A `Keybinding` has no `when`, and one binding per chord is
  held per context, so Tana's `Ctrl-[` pair cannot be a day-page-only chord:
  `Ctrl-[` is the same chord as `Mod-[` and is refused beside it. The commands
  therefore work everywhere: on a day page they step from that day, made if
  need be through `dateTarget`; elsewhere they step from today, as
  `goToTodayCommand` already reaches a day from any page. macOS Chrome takes
  ⌘⌥←/→ for tab switching before the page sees it; the builder checks that
  on a Mac and, if the browser wins, ships the two commands unbound (⌘K and
  rebindable) rather than choosing another chord blind. §8 asks the owner.
- The stack: `router.ts` keeps `window.history`, and records the entry index
  in `history.state` so `canGoBack` / `canGoForward` are known without the
  Navigation API; forward after a reload is unknown and shows disabled
  (memory only: no new browser storage).

**Where.** `kit/ui-sdk/src/lib/router.ts` (`navigate`, `replacePath`,
`subscribePath`: add `canGo(): {back; forward}` and `go(delta)`);
`app/ui/src/components/App.tsx`; two ids in `domain/model/src/model.ts`
(`SYSTEM_IDS`) and `domain/seed/src/seed.ts` (`cmd(...)`, as
`cmdExpandAll`); the commands and bindings contributed as days contributes
`goToTodayCommand` and `provideKeybinding("today", …)`
(`days-ui/src/command.ts`, `days/src/extension.ts`); day stepping in
`days-ui`. Do not edit `lib/commands.tsx` (WP-5).

**Rule 1.** Back and Forward are commands (nodes, bindable), not
hard-coded listeners; the day pair lives in the days family that owns days.

**Acceptance tests.**

1. `router.test.ts` (new): `navigate` then `go(-1)` fires subscribers and
   `canGo()` flips; replace does not add an entry.
2. Component: the header buttons are disabled at the first page, enabled
   after navigating, and click moves.
3. Keybinding, both platform mappings: a key event with `metaKey` (the macOS
   ⌘ mapping) and one with `ctrlKey` (the Windows/Linux mapping) each resolve
   `[` to Go back and `]` to Go forward from a zoomed node, and the same two
   events for `Mod-Alt-ArrowLeft` / `Mod-Alt-ArrowRight` resolve to
   Previous day / Next day; the chords are held by `core.page` and show in
   the shortcuts list.
4. `admitKeymaps` over the real `CORE_KEYBOARD`, `OUTLINE_KEYBOARD` and days
   bindings leaves `refused` empty in every context, so the outline's
   `ArrowLeft` / `ArrowRight` selection keys are still held; a negative case
   shows `Alt-ArrowLeft` from a non-core owner is refused (the rule this brief
   depends on, held by a test rather than by this paragraph).
5. `days-ui`: Next day on `days.2026-11-20` opens `days.2026-11-21`,
   creating it; from a non-day page it steps from today.
6. `keybindings.test.ts` (outline) and the page-keys tests still pass: no
   overlap with a held chord.

**Screenshots.** Header with disabled Back; after navigating, both states;
a day page after Next day.

**Passes both tests.** _Outliner-only:_ a zoom is a route to a node, so Back
is movement between nodes; a day step is a move between day nodes. The
commands are `sys.command` nodes and the keys are shortcut data. **One flag
for the owner:** the two header buttons are those same commands drawn in the
existing header, not a new surface; if "no new app surface" is read strictly,
ship the commands and keys and drop the buttons (the desktop shell then has
the keys and ⌘K only). _AGENTS.md:_ **Rule 1**, two commands rather than
listeners, and one stack, owned by `router.ts`; **one contract**,
`canGo`/`go` are the router's promise and a test over a fake `History`
proves them the same in a browser tab and in the Electrobun store window,
since both are `window.history`; **canonical statement**, DESIGN-UI.md → Days (day
stepping) and → Panes and layouts (Back and Forward) each get one sentence,
and the header is described once.

**Out of scope.** A history dropdown; per-pane history (panes keep their own
routes).

---

### Brief 4: Structure keys (WP-4)

**Goal.** The structural keys a Tana user reaches for exist in edit mode and
say the right thing when they refuse.

**Behaviour** (chords in kb's `Mod` notation; Tana's are in §3):

- `Mod-Alt-ArrowDown` / `Mod-Alt-ArrowUp`: expand / collapse the **whole
  subtree** of the row, in both modes. (Tana: `Ctrl+⌘↓/↑` on Mac,
  `Ctrl+Alt+↓/↑` on Windows.) The existing global "Expand all" / "Collapse
  all" commands keep their scope meaning.
- `Mod-Shift-Enter` in edit mode: a new empty row **before** this one, the
  caret in it (`createNodeBefore`, already used by `O`).
- `Mod-.` in edit mode zooms into the row (as it does in selection mode), and
  `Mod-,` zooms out to the parent of the zoomed node in both modes.
- The refusal for a range that starts at the first child says what is true:
  "The first row has no row above it to move under." Keep the existing text
  only for the real case (non-contiguous or mixed-parent ranges).

**Where.** `outline/src/keyboard.ts` (add bindings and intents to
`EDITING_BINDINGS` / `SELECTION_KEYS`); `outline-ui/src/editing-intents.ts`
and `editing-keymap.ts` (the intent bodies); `selection-keymap.ts`;
`outline.store.ts` (add `expandSubtree(instanceKey)` /
`collapseSubtree(instanceKey)` beside `expandAllInScope` at line 670);
`app/ui/src/actions/mutations.ts:78` (the toast, which also needs to know
why the range was refused).

**Rule 1.** Every new key is a binding to an intent of an existing context
(`outline.editing`, `outline.selection`); no listener elsewhere. Subtree
expansion is one store function that `expandAllInScope` is the special case
of; do not write a second walker. Keys are overlap-checked by
`admitKeymaps`: if `Mod-Alt-Arrow*` collides with a held chord, name the
holder in `replaces` or pick another and say so in the brief's report.

**Acceptance tests.**

1. `keybindings.test.ts` (outline): the new chords overlap nothing; every
   intent is declared in the context's list.
2. `use-node-keydown.characterization.test.tsx`: `Mod-Shift-Enter` makes a
   row before with the caret in it and does not split.
3. `outline.store.expansion.test.ts`: `expandSubtree` opens every
   descendant, `collapseSubtree` closes them, siblings untouched.
4. `selection-range.test.tsx`: a range from the first child refused with the
   new message; a range across parents keeps the old one.
5. `⌘.` in edit mode zooms; `⌘,` goes to the parent; both leave the editing
   row's text unchanged.

**Screenshots.** A tree before and after `Mod-Alt-ArrowDown`; the refusal
toast for the first child.

**Passes both tests.** _Outliner-only:_ keys on rows that run existing
structure operations. _AGENTS.md:_ **Rule 1**, every key is a binding to an
intent of `outline.editing` or `outline.selection`, and subtree expansion is
the general case that `expandAllInScope` becomes, not a second walker;
**one contract**, `admitKeymaps` is the one admission of every context's
chords and the overlap test proves the new ones; **canonical statement**, the
keymap tables in DESIGN-UI.md → Outline editor get the new rows and nothing
repeats them.

**Out of scope.** Duplicate (the chord `Mod-Shift-D` is Go to today; needs an
owner decision); formatting keys; Move-to chord (needs Brief 1's palette
seam).

---

### Brief 5: Run a prompt on a node (WP-7, first half)

**Goal.** Select a row or a range, run "Ask AI…", pick a prompt, and the
answer arrives as child rows, tagged so it can be reviewed and reverted in
one step.

**Behaviour.**

- A **prompt is a node**: a node tagged `#prompt` (seeded by the agent
  family, additive and removable) whose text is its name and whose
  `instruction` field is the prompt. The family seeds five, as Workflowy's
  quick actions do: Summarize, Extract tasks, Create outline, Fix grammar,
  Shorten. A person adds their own by tagging a node.
- ⌘K on a row (or `/` after Brief 1) offers **Ask AI…**: a palette step
  whose candidates are the `#prompt` nodes plus "Custom prompt…" (typed
  text). It is hidden while no model is provided (the page's
  `ModelCompletionService` waits, pending, when the agent is off).
- Running asks the configured provider once, with the prompt and the target
  subtree as Markdown (`exportOutline` from `@kb/outline-paste`, depth ≤ 4,
  ≤ 8,000 characters, ancestors named by title). The reply is read as an
  outline (`outlineFormat`) and added as the **last children** of the target
  row through `node.addTree`, in one transaction, one undo step. Each new
  top-level row is tagged `#ai` (seeded, removable). The tag is the
  provenance and the review handle: a saved query on `#ai` lists everything
  AI wrote; removing the tag accepts a row; deleting rows rejects.
- The action is a guarded write: the normal approval dialog names the
  prompt and the node. A failure ("no provider", "the model answered
  nothing") is a toast with the reason, and writes nothing.
- Optional last step (rank 6): an "Insert as nodes" button on an agent
  reply in the dock, using the same outline-ingest path.

**Where.** `extension/agent/src/`: a new apply action `ext.agent.transform`
(input `{ ids, prompt }`) beside `complete.ts`, reusing `selection.ts`
(provider choice) and the step loop's completion call, plus seeds for
`#prompt`, `#ai`, `instruction` and the five prompts in the family's
declaration (`extension.ts`; see DESIGN.md → Extension families for
seeding and "the seed retires what it renames"). `extension/agent-ui/src/`:
the `Ask AI…` `PaletteStep` and its registration in `plugin.ts`
(precedent: the outline's `addTag` step, `outline-steps.tsx`;
`PaletteStepPoint`), and the completion service (`completion.ts`).

**Rule 1.** One new action; prompts are nodes and tags, not a settings
screen; the result is rows, not a bespoke result widget; review is a tag and
a query, not a review pane. Do not build a second approval or diff
mechanism: use the guard's approval and the one-tx undo. This is _not_ the
commands-as-nodes track (docs/research/2026-11-17-commands-as-nodes.md
phases 0–1 are unshipped); if that lands first, `#prompt` nodes can become
`#call` command nodes with no change to the action.

**Acceptance tests** (`scriptedRuntime`, no network; the pattern of
`app/ui/src/agent-host.acceptance.test.tsx` and the tests in
`packages/extension/agent/tests`):

1. Action contract: scripted reply `- a\n  - b` adds two nested rows as
   last children in one tx; both top-level rows carry `#ai`; undo removes
   them all.
2. A reply with `#tag` or `[[ref]]` text that does not exist is refused by
   the outline codec's rule (it never creates tags); the call fails with
   that reason and writes nothing.
3. No provider: the step is absent and the action refuses with the
   provider's message.
4. Range: two selected rows send both subtrees; the answer lands under the
   last selected row.
5. Approval: the call needs approval and shows the prompt text.
6. The wire fingerprint test is updated and the new fingerprint is in the
   commit (`packages/app/server/tests/wire-protocol.test.ts`).

**Screenshots.** ⌘K showing Ask AI…; the prompt step; children arriving
with `#ai`; ⌃Z removing them; the saved `#ai` query.

**Passes both tests.** _Outliner-only:_ a prompt is a node with a tag and a
field, the answer is child rows, provenance is a tag and review is a query
and a delete. There is no chat pane, no result panel and no new store.
Anything that would need one is excluded (§3.0). _AGENTS.md:_ **Rule 1**,
one action, the existing palette step, the existing approval guard and the
one-tx undo, with no second review or diff mechanism; **one contract**,
`ext.agent.transform` is an action, so the page, the CLI and MCP call the
same thing under the same guards, proved by a contract test over the invoke
core with `scriptedRuntime` (the way `procedure-contract.test.ts` proves
procedures); **canonical statement**, DESIGN.md → Agent packages names the
action and the seeds, DESIGN-UI.md → The node menu names the step, and the
seeds live in the family's declaration only.

**Out of scope.** Streaming into the row; per-prompt model choice; a
Private flag (rank 14, an owner decision before this ships widely, since it
sends subtree text to the model).

---

### Brief 6: Query ergonomics (WP-5)

**Goal.** A new query asks for its first condition, a search becomes a query
in one gesture, and Group / Sort are commands.

**Behaviour.**

- "Turn into query" (⌘K, and `/query` after Brief 1) opens a tag step first,
  titled "Find nodes tagged…", and writes the query with that tag condition.
  Esc makes no query. It is not the Add tag step: that step's `commit`
  writes a tag on the row and, for a typed name that matches nothing, mints
  one (`outline-steps.tsx`, `addTag.commit`: `defineTag` then `addTag`).
  Turning a row into a query must tag nothing and create nothing, so the new
  step reuses Add tag's candidate selection (`addTag.candidates`, over
  `nodesOfKind`: the same tags in the same order) with its own commit, which
  writes only the query condition, and offers no "Create tag" row
  (`createLabel` absent: a condition on a tag that does not exist matches
  nothing, and a gesture that mints structure is not a search). A query with no conditions stays legal
  (existing tests assert its text) but is never what a gesture makes by
  default, so the flood in F5 stops.
- In the global search (⌘K with no row), `Alt+Enter` on the typed text makes
  a query node under the zoomed node (or today) whose condition is that text
  and opens it. If the query builder has no text condition, add one as a
  condition kind (the builder's own `conditions.tsx`), not a special case.
- ⌘K gains **Group by…** and **Sort by…** next to **Filter…**: the same
  step type, writing the node's view settings
  (`view-settings-fields.ts`), one write each.
- The false hint goes: "Search everything… ⌘S" becomes "Search
  everything…" (⌘S stays the browser's; see the owner decision in §8).

**Where.** `app/ui/src/lib/commands.tsx` (`turn-query` at ~417, which
becomes `ctx.palette.openStep("outline.find-tagged")` as `add-tag` does at
~382; the `search-all` label at 494, the Filter command's neighbours),
`app/ui/src/lib/query-node.ts` (`DEFAULT_QUERY_EDN` stays for the empty
case; add a builder from a tag id), a new `outline-ui/src/query-steps.tsx`
holding the `findTagged` `PaletteStep` (`label`, `placeholder`, `icon` of its
own; `candidates: addTag.candidates`; `commit` writes
`updateProp(nodeId, SYSTEM_IDS.queryField, …)` and nothing else), contributed
beside `OUTLINE_STEPS` in `outline-ui/src/plugin.ts`,
`outline-ui/src/query-builder/*`, `view-settings-fields.ts`,
`components/palette/command-palette.tsx` (`Alt+Enter`). WP-2 owns
`outline-steps.tsx`, so this reads `addTag` and does not edit it.

**Rule 1.** The query kind is still "a node with the query field"; the step
is one more `PaletteStep` over the existing tag candidates (a bridge to
`addTag.candidates`, not a copy of the tag list), not a query-specific
wizard.
Group and Sort are two more settings written through the same view-settings
path the popover uses.

**Acceptance tests.**

1. `query-builder.component.test.tsx`: Turn into query opens the tag step;
   picking `task` writes `[:find ?id :where … :f/sys.f.type … "task-id"]`
   (by id, never text: AGENTS.md → data-plane freedom); Esc writes nothing;
   the existing "No conditions" assertions stay green. The row carries no
   tag afterwards (its type slot is as it was), typing a name no tag has
   offers no create row and mints no node (the node count is unchanged), and
   the pick is one undo step.
2. Palette test: `Alt+Enter` in global search creates a query node with the
   text condition under the zoomed node.
3. Group by… and Sort by… write the view settings; the view reflects them.
4. No `⌘S` string remains in `commands.tsx`.
5. `kb check audit` (`ref-by-text`) stays green: no stored reference by text.

**Screenshots.** The tag step opening from Turn into query; the resulting
query with a count; the palette entries; Alt+Enter from search.

**Passes both tests.** _Outliner-only:_ a query is already a node with a
field, the builder is its editor, and Group and Sort are view settings, which
are fields; nothing new is stored or drawn. _AGENTS.md:_ **Rule 1**, the
tag step reuses `addTag`'s candidate selection with a commit that writes only
the condition (no query wizard, no tag written or minted) and a text
condition is a builder condition kind, not a special case; **one contract**,
the query EDN a gesture writes is evaluated by the same datalog layer for the
UI, `kb run` and MCP, and the new tag condition is written by id; **canonical
statement**, DESIGN-UI.md's query-node paragraph gets the creation flow, and
the hint text is fixed in the one place that owns the palette's labels.

**Out of scope.** `?` as a trigger (the `/` menu reaches this); Lanes and
Pivot views; result limit and paging.

---

### Brief 7: Backlinks that work like Tana's (WP-6)

**Goal.** From a node you see what links to it with context, what mentions it
without linking, and, on any row, that something links to it.

**Behaviour.**

- The References section on a zoomed node (`references-section.tsx`) shows
  each referencing row with its **breadcrumb** (the path above it), and a
  chevron that expands the row's children as ordinary rows (the subtree is
  the context, as Amplenote does).
- Below it, **Unlinked mentions (N)**: rows whose text contains the node's
  title (case-insensitive, word boundaries, at least 3 characters) and hold
  no mention edge to it, excluding the node itself, its ancestors and
  descendants, and system or schema nodes. Each row has a **Link** button
  that rewrites the matched span to `[[id|text]]` in one write. Up to 50 rows
  then "Show more".
- A **reference counter** at the right edge of a row (not in the text) when
  other rows reference it; click opens that node scrolled to References. A
  setting (a node in the outline family's settings, `outline/src/settings.ts`)
  turns it off; default on.

**Where.** `outline-ui/src/references-section.tsx`, `backlinks.ts`
(`backlinkRows`; add `unlinkedMentionRows` the same way, over the replica
through `useAnswered`), a new `unlinked-mentions.tsx`, the counter in
`row-view.tsx` / `node-block.tsx` through the row chrome seam
(`kit/ui-sdk/src/lib/row-chrome.ts`: read; extend only through its
documented slot), `outline/src/settings.ts`.

**Rule 1.** The mention relation is `:node/mentions` (DESIGN.md); unlinked
mention is "text contains title and no edge", derived from the same replica,
never stored. Link is an ordinary text write, one undo step. The counter
reads the same query as the section.

**Acceptance tests** (`references-section.test.tsx`, `backlinks.test.ts`):

1. A node with two referencing rows shows two rows with breadcrumbs; expand
   shows children.
2. `unlinkedMentionRows`: finds "Write spec" in `we should write spec soon`;
   skips a row that already has the edge, the node itself, its ancestors,
   and `sys.*` nodes; respects word boundaries (`prototypes` ≠ `prototype`
   only when the title is `proto`).
3. Link: the row text becomes `we should [[id|write spec]] soon`; one ⌃Z
   restores it; the row leaves Unlinked and joins References.
4. Counter shows on a referenced row, click zooms to its References; off
   when the setting is off.
5. `update-cost.test.tsx` (outline) still holds: the counter does not
   re-render unrelated rows.

**Screenshots.** References with breadcrumbs and an expanded child;
Unlinked mentions with Link; a row with its counter.

**Passes both tests.** _Outliner-only:_ an unlinked mention is derived from
node text and the existing mention edges, Link is a text write, the section
is the same kind of section as References (a projection of the graph on the
node page), and the counter is a chip on a row. Nothing is stored. _AGENTS.md:_
**Rule 1**, one query pattern (`backlinkRows`) that the new one follows, one
fact (`:node/mentions`) and no mirror; **one contract**, `:node/mentions`
extraction is the store's contract on every backend and this brief adds no
store-side query, so it stays a replica read with nothing to add to
`store-contract.ts` (if a builder adds one, it joins that suite); **canonical
statement**, DESIGN-UI.md → Contextual references gets the two sections and
the counter.

**Out of scope.** Peek a reference inline (`Shift+click` / `⌘↓`); unlinked
mentions across stores.

---

### Brief 8: AI-filled fields and AI tagging, preview then apply (WP-7, second half; after Brief 5)

**Goal.** A field can carry an instruction, "Fill with AI…" proposes values
for the empty ones, and the person applies the ones they want. "Suggest
tags…" does the same for tags, from existing tags only.

**Behaviour.**

- A field gains one setting, **AI instruction** (text), on `sys.field`'s
  template beside `fillFrom` (DESIGN.md → tag behaviours).
- ⌘K (and `/`) on a row or range: **Fill fields with AI…**. The family asks
  the model once per row, with the row's text, children, tags and held values
  and, for each templated field that is empty and has an instruction, the
  field's name, type and (for an option or reference field) its existing
  options. The reply is a proposal list `field: value`.
- The proposal is shown as a **multi-select palette step** (rows like
  `owner: Ana`, all pre-checked); Enter applies the checked ones in one
  write. A proposed value is judged by the graph's own constraints, not by
  `conformsToType`, which checks a value's kind and form only
  (`domain/model/src/field-value.ts`) and would pass `owner: Zed` for a
  ref field whose options are Ana and Bo. The check is the shared pair, which
  proposal and apply must both call: `valueConformanceError(fieldId, value,
  nodes)` for kind, form and a ref naming a stored node (the commit's own
  integrity check), and `allowedRefIdsOf(fieldNode, nodes, runQuery)`
  (`domain/model/src/field-type.ts`) for option membership, which today only
  the UI picker consults. That one resolver answers for all three ways a field
  names its targets: its own children (an option set), `targetTag`, or
  `targetQuery`; `null` means unrestricted. A ref value outside the set, a
  value that fails `valueConformanceError`, or a value the field would close
  a cycle with (`sys.f.acyclic`, `closesCycle`), is dropped and counted in
  the step's header ("2 of 3 filled; `owner` had no matching option").
  Nothing is created: no new option, tag or node.
- The same check runs again when the step applies, against the graph as it
  is then: the commit does not yet refuse a ref outside the allowed set
  (`GAP 01M39YM7FQ9S231XW8JBA5MG0E`; only the picker does), and the graph can
  change between the read and Enter (an option deleted, the field given a
  value by hand or retyped, the row deleted). A row that fails then is
  skipped and reported, never written. If that gap closes first, the
  commit enforces it for every writer and the apply-time call is the same
  function, not a second rule.
- **Suggest tags…**: candidates are existing tags in use (or non-shipped);
  the model picks; the same multi-select step applies them with `addTag`.
- Both are read-then-apply: two actions, a read (`ext.agent.propose`) that
  returns the proposal and the existing write path (`updateProp`, `addTag`)
  that applies it, so the approval dialog and undo are the ordinary ones.

**Where.** `extension/agent/src/` (the `propose` read action, the setting
and its seed, the prompt for proposals), `extension/agent-ui/src/` (the two
palette steps in `plugin.ts`; reuse Brief 5's runner for provider choice and
context export). Check `PaletteStep` supports `selected` multi-select
(`kit/ui-sdk/src/lib/picker.ts` carries `selected`; `outline-steps.tsx`
`removeTag` is the multi-target precedent) and extend the step type only if
it does not.

**Rule 1.** A proposal is a list the person edits before applying, using the
palette's own list; there is no review pane. The instruction is a field
setting like `fillFrom`, one reader, no second config surface. The model
never mints structure (Capacities' November 2026 rule).

**Acceptance tests.**

1. Read action contract (`scriptedRuntime`): for a `#task` row with empty
   `status` (options Todo, Doing, Done) and `owner` (ref, options Ana, Bo),
   a scripted reply proposes `status: Doing`, `owner: Zed`; the proposal
   keeps `status` and drops `owner` with a reason. Also a `targetTag` field
   and a `targetQuery` field each drop a ref outside what `allowedRefIdsOf`
   returns for them, so all three carriers go through the one resolver.
2. The step applies only the checked rows, in one write and one undo. A
   proposal made, then an option deleted (or the field filled by hand)
   before Enter: that row is skipped and reported, the others apply.
3. A field with no instruction is never proposed; a field that already has a
   value is never proposed.
4. Suggest tags never returns an id that is not an existing tag; a reply
   naming a new tag yields "no matching tag".
5. Approval: the read action needs no approval by default (it writes
   nothing), the apply path uses the normal write guards.
6. Wire fingerprint updated and recorded in the commit.

**Screenshots.** Field config showing the instruction; the proposal step with
checked rows and the header count; the applied row; ⌃Z.

**Passes both tests.** _Outliner-only:_ the instruction is a field setting on
`sys.field` (a field node), a proposal is rows in a palette step, and applying
it is `updateProp` and `addTag`. No review pane, no new store, and the model
never creates a tag, option or node. _AGENTS.md:_ **Rule 1**, one more
setting beside `fillFrom` with one reader and a proposal the person edits in
the palette's own list; **one contract**, `valueConformanceError` and
`allowedRefIdsOf` are the one shared validity check, and the proposal step
and the apply step both call it (the commit enforces only the first; the
commit-level gap `01M39YM7FQ9S231XW8JBA5MG0E` stays open, and this brief
does not close it), so a proposal is judged the same by the UI, the CLI and
MCP, and `ext.agent.propose` has a
contract test over the invoke core; **canonical
statement**, DESIGN.md → tag behaviours gains the setting (its one reader)
and → Agent packages names the action, with no copy in the UI doc.

**Out of scope.** Triggers (fill on create or on edit: transaction reactions,
`GAP 01M6EKEE8P040W6592ZZ3HDVGC`); AI columns in a table; Autofill title.

## 8. Decisions for the owner

1. **⌘S.** Default in Brief 6: drop the false label and leave ⌘S to the
   browser (`page-keys.ts` says why). Tana's ⌘S is search; binding it takes
   Save from the browser. Your call.
2. **Chords.** `Mod-Alt-Arrow*` (Brief 4: structure keys; Brief 3: Previous
   and Next day) may collide with window managers on Linux and with macOS
   system keys or the browser (⌘⌥←/→ switches tabs in Chrome on macOS); the
   builders check `admitKeymaps` but not your desktops. Brief 3's Back and
   Forward are `Mod-[` and `Mod-]`, which `admitKeymaps` admits.
3. **AI spend and exposure.** Briefs 5 and 8 call the configured agent
   provider and send subtree text. The chat dock already sends the screen's
   node names. Decide whether the Private flag (rank 14) must precede Brief 5
   reaching real stores.
4. **Commands as nodes.** Phases 0–1 in the 2026-11-17 research would give
   `#prompt` a more general home; Brief 5 does not need them. Decide
   whether to run them first.
5. **Static defaults on tag templates** (rank 15) change the data plane
   (AGENTS.md → Data-plane freedom); it needs a design pass, not an
   overnight brief.
6. **Header buttons for Back and Forward (Brief 3).** They are the two
   commands drawn in the existing header, which this study reads as a
   presentation of existing commands, not a new surface. If the owner reads
   "no new app surface" strictly, drop the buttons; the commands and keys
   stay.
7. **Dropping Brief 8.** It is the largest and the only one with real
   product risk; stopping after Brief 5 still gives a Workflowy-grade AI.

## 9. Not verified, and what was not covered

- **Hands-on time.** About 11 minutes of scripted browser driving, not 30,
  headless Chrome on Linux. macOS ⌘ chords, mouse-first flows (click, hover,
  rubber band, Shift+click range), motion, latency and the Electrobun desktop app were
  not exercised.
- **Not tested in the UI** (read from code or docs only): paste of a
  `%%tana%%` list, Copy as…, table view calculations, board drag between
  groups, the sidebar-pin drop, the shortcut rebinding UI, `Open in panel`.
- **Not reproduced:** F13, the merged-text accident.
- **Tana facts marked UNVERIFIED in the source report**: Esc as a selection
  key, Enter splitting mid-text, mouse range select, typed `[[` as an editor
  trigger, field-type inference on `>`, a Forward key, Windows `Ctrl+I` vs
  `Alt+I`, Windows `Ctrl+Shift+D` listed twice, an AI-Builder button in
  Outliner. Changelog entries before 2026-09-25 were not visible.
- **Competitor gaps.** Amplenote's site refused the fetcher (403), RemNote's
  2026 changelog and Roam's own release notes did not load, so 2026 claims
  for those three rest on help pages and third-party roundups; Capacities
  release dates 66–70 come from an aggregator; Napkin is two unrelated
  products (idea resurfacing; diagram generator). The "newer entrants"
  search found few real AI outliners: Dotflowy, openOutliner and Checkvist's
  MCP are small and first-party-documented; none is venture-scale.

## 10. Sources

Tana Outliner (all fetched 2026-11-20): keyboard shortcuts and navigation
<https://outliner.tana.inc/learn/features/keyboard-shortcuts>,
<https://outliner.tana.inc/learn/features/navigation>; fields, supertags,
search nodes, views, command nodes, AI command nodes, AI chat, local MCP under
<https://outliner.tana.inc/learn/features/>; changelog
<https://outliner.tana.inc/changelog>; product split
<https://outliner.tana.inc/blog/tana-current-march-2026>,
<https://outliner.tana.inc/blog/how-tana-differs-from-tana-outliner>.

Competitors, with per-fact URLs in the raw reports (thread storage, not in
the repo): Capacities <https://docs.capacities.io/reference/ai-assistant>,
<https://capacities.io/whats-new>; Reflect
<https://reflect.app/blog/reflect-open>,
<https://reflect.app/blog/edit-notes-with-coding-agents>; Heptabase
<https://wiki.heptabase.com/changelog>; Mem
<https://get.mem.ai/blog/mem-is-shutting-down>; Amplenote
<https://www.amplenote.com/help/backlinking_bidirectional_linking>; Logseq
<https://github.com/logseq/docs/blob/master/db-version.md>; Workflowy
<https://workflowy.com/whats-new/>; RemNote
<https://help.remnote.com/en/articles/16424066-connecting-ai-agents-to-remnote-with-mcp>;
Roam <https://claude.com/connectors/roam-research>; Dotflowy
<https://dotflowy.com/>; Checkvist <https://checkvist.com/help/mcp>; Notion
Autofill <https://www.notion.com/en-gb/help/autofill>.

kb: `DESIGN-UI.md` (Outline editor, Triggers in the text, Field values: one
slot grammar, The node menu), `DESIGN.md` (tag behaviours, Agent packages),
`docs/research/field-ux.md`, `2026-11-11-shortcuts-as-nodes.md`,
`2026-11-17-commands-as-nodes.md`, `2026-11-17-safe-deletion.md`,
`2026-11-18-desktop-and-phone-apps.md`.
