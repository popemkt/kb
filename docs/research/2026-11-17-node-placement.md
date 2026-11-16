# Node placement: where a new node lands, as one value every creator takes

Status: **design, for the owner.** Nothing here changes code.

Date: 2026-11-17.
Inputs:
- kb `main` at `e4383f17`;
- DESIGN.md → [Days](../../DESIGN.md#days), [Provider roles](../../DESIGN.md#provider-roles),
  [Action registry](../../DESIGN.md#action-registry) (interception, approval),
  [Batches of writes](../../DESIGN.md#batches-of-writes--nodebatch),
  [Outline paste](../../DESIGN.md#outline-paste--nodeaddtree),
  [Transaction reactions](../../DESIGN.md#transaction-reactions), Sandbox → Grants;
- DESIGN-UI.md → Days, _Adding to a frame_, the date-field calendar, paste ingest;
- the [data-plane design](2026-11-10-data-plane-fields-events.md) (§6 events, §8 days, D11)
  and the [inbound Google Calendar design](2026-11-12-gcal-inbound.md) (#194);
- the Tana, Logseq, Notion, Capacities and Anytype documentation, read on 2026-11-17 (§3).

The owner asked:

> can we have hook, to where locations can be specified for a node. for
> example calendar can create node into today's node. what should be a
> clean design? a special function to get a node, which would be getToday
> or something, and the event plugin accept a handler, or a plain Node for
> destination? or the plugin can hook into a creation hook? and move it or
> set its target location.

## 0. The answer in one screen

**Recommendation: (d), a placement port. kb already has most of it,
behind the wrong name.** The registry half of `ui.capture-target`
(`CapturePlanner` in `packages/contract/contracts/src/capture-target.ts`) is
already a placement resolver. Given the store's nodes, it answers a parent
and the nodes that parent needs made first, and `node.add` and
`node.addTree` commit both inside the add's own planned transaction
(`commitAddEffect` in `packages/application/operations/src/actions.ts`). The
design below generalises that one thing. It does not add a second one.

| Piece | Design |
|---|---|
| The concept | **Placement**: where a node a caller makes lands, when the caller has not named a node. It is decided once, at creation, and never re-files a node later |
| The value | `Placement = NodeId \| null \| PlacementCall`, where `PlacementCall = {resolver, args?}`. A node id is "here", null is the top level, and a call is "ask this resolver" |
| The port | `PlacementPoint`, a keyed point on the registry and the page. Each family contributes named resolvers with typed args: core contributes `core.top-level`, days contributes `days.today` and `days.day`, and so on. A resolver is a pure planner over the store's nodes, plus an optional *fill* that turns ambient context (the clock, a zone) into explicit args |
| Where it runs | inside the creating transaction (`persistPlannedEffect`): one commit, one undo step, the same guards, re-planned on a conflicting commit, with no second write |
| As data | every resolver is a seeded node tagged `#placement`, and a configured one (day of *starts*) is a `#placement` node too. A setting that holds a placement is an ordinary ref field, `goes into` (`sys.f.placement`), whose value is any node, meaning "there", or a `#placement` node, meaning "resolve this" |
| Who sets it | a call (`parent`, which the call insists on), a query (`matching`'s `child-of`), a tag (`goes into` on the tag node), the creator (`fallback`, which it only suggests), the store (`goes into` on core's family node, which today is the capture target). One fixed order, and one read action that answers it: `node.placement` |
| What it retires | the `ui.capture-target` role (both kernel halves), days' `captures` setting, gallery's `save into` field, the page's separate "make today, wait 3 s, then add" write, and `asPlaced` in the tab runtime |
| Calendar | "Put new events in their day" is the value *day of: starts* in `#event`'s `goes into`. It is the person's choice, and it is off by default (§7) |

Rejected: (a) a getter like `getToday()`, which is hidden coupling and a
second write; (b) a bare destination node, which cannot say "today"; (c) an
on-create hook that moves the node, which needs two writes or an
interceptor rewriting input that no one can read back.

**Say no, or stop early, if** per-tag defaults turn out to have no real user
past the capture target, or the owner wants *re-filing* (Tana's move on tag
added) rather than placement at creation. §10 has the full list.

## 1. The concept, named

Rule 1 asks for a name before code. Two different things decide a new
node's parent today, and only one of them is in scope:

- **Structure.** The parent is part of what the node *is*: an
  `#occurrence` under its routine
  (`addOccurrence` in `packages/extension/routines/src/calendar-edits.ts`),
  a pin under its look (`packages/extension/gallery/src/look.ts`), a day under its week, a
  pasted child under the line above it, a row from a create strip under the
  row it was drawn under. The creator knows the parent, and nobody else
  may change it. **This is out of scope, and stays an explicit `parent`.**
- **Filing.** The node is a thing of its own, and the parent is only
  *where it lives*: a capture, a new `#person` made from a picker, an
  imported event, a saved gallery visual, a new routine. The creator
  usually does not care, the person does, and the right answer depends on
  data the creator does not own: is days on, what is today in the store's
  zone, has the person chosen an inbox. **This is placement.**

kb gives a node one parent (DESIGN.md → Kinds, roles and options: "A node has
one parent"), so filing is a real choice. Tana keeps an owner apart from its
references, and Capacities and Anytype have no location at all; kb has
neither escape (§3).

## 2. Where kb decides a new node's parent today

Every creating path on `main`, grouped by who decides:

| # | Creator | Decides by | Where | Kind |
|---|---|---|---|---|
| 1 | `node.add` with `parent` omitted (`kb add`, MCP `node_add`, a script, WebMCP) | role `ui.capture-target`, registry half: `kernelCaptureTarget`, then `CapturePlan {parent, upserts}`, planned in the add's own transaction | `operations/src/place.ts` (`placeOf`), `actions.ts` (`commitAddEffect`) | filing |
| 2 | `node.addTree` with `parent` omitted | the same `placeOf` | `operations/src/node-add-tree.ts` | filing |
| 3 | Days' answer to (1) and (2) | `captureToday`: the `captures` setting, then `planToday(nodes, storeToday(nodes))`, whose upserts are the journal, year, week and day | `extension/days/src/capture.ts` | filing |
| 4 | The page's captures: ⌘K "Add node" with nothing selected, a picker's "create" row | role `ui.capture-target`, page half: `PageCaptureTarget = () => Promise<string \| null>`. Days answers it by **invoking `ext.days.today` as a write of its own**, waits up to `ARRIVAL_MS` (3 s) for the day to reach the replica, then `captureNode` adds the node in a **second** write. A picker's tag is a **third** (`addTag`) | `days-ui/src/today.ts` (`dayNode`), `days-ui/src/plugin.ts`, `ui/src/actions/mutations.ts` (`captureNode`) | filing |
| 5 | A `node.add` with no parent run in a tab | the page half answers, and the tab pushes the chosen parent to the server through a side channel (`asPlaced`, beside `asFilled`) so the server does not ask its own half | `ui/src/session/runtime.ts` | filing |
| 6 | "+ Add" on a query's results | `matching`: the query's `child-of` if it names one, else the capture target | `operations/src/node-add-matching.ts`, DESIGN-UI.md → _Adding to a frame_ | filing |
| 7 | "+ Add to Fri, Nov 14" on a date-field calendar | (6) with `field-is` for the date. **It lands in today's node while it is dated Friday**, because nothing says "the day it is dated" | DESIGN-UI.md → the date-field calendar | filing |
| 8 | Gallery: a saved visual or look | its own ref setting `save into` (`sys.f.gallery.save-into`), read by hand in `gallery-net/src/actions.ts` (`visual.parent ?? refOf(…saveIntoField)`) and threaded through the page (`gallery-ui/src/frame.ts`, `save-look.ts`) | gallery | filing |
| 9 | Days: where years go | its own ref setting `journal` (`sys.f.days.journal`); empty, it makes "Daily notes" | `days/src/plan.ts` | filing (of the journal root) |
| 10 | Routines: a new routine, account or calendar | `parent: null`, hard-coded, which means "never the capture target" | `routines/src/calendar-edits.ts` (`addRoutine`), `setup.ts` (`addAccount`, `addSetupCalendar`) | filing, decided by the creator |
| 11 | Imported Google events (designed, not built) | under the subscribed calendar's node | [gcal design §2](2026-11-12-gcal-inbound.md#2-an-event-as-a-node) | filing, decided by the creator |
| 12 | Occurrences, look pins, period nodes, outline children, create strips, Tab/Enter in the outline, lanes | explicit parent | many | structure |
| 13 | Paste and ingest (`node.addTree` from a row) | always names a parent; at a top-level row it is `parent: null`, "never the capture target" | DESIGN-UI.md → paste ingest | structure |
| 14 | `node.batch` | always names a parent: "a batch decides every place itself and never asks the capture target" | DESIGN.md → Batches of writes | structure |
| 15 | Canvas: a new canvas | `parent ?? null` | `canvas-ui/src/canvas-api.ts` | either |

What this shows:

- **F1. The port exists, for one resolver.** Rows 1–3 are option (d)
  with a single resolver and no args. The planner runs over the store's
  nodes, answers a parent with the upserts it needs, and the add commits
  all of them once, through `persistPlannedEffect`'s conditional commit,
  which re-plans over a store that moved meanwhile. The days design relies
  on this so that two writers making one day still leave one day.
- **F2. The page half is a mirror, and a worse one.** One role is
  implemented on two kernels in two shapes. The registry answers a
  `CapturePlan`; the page answers only an id, so the page has to make the
  place first, in a separate write, and wait for it to arrive. That wait is
  the fixed budget that gap `01M7CC1GD0A1J314ZTAR54F8AD` records for the
  landing, and `dayNode` shares it. A capture made on a new day therefore
  costs two writes and two undo steps: undo removes the capture and leaves
  the day. `asPlaced` is a second channel that exists only to carry the
  page half's answer to the server.
- **F3. Three bespoke destination settings.** Days' `journal`, days'
  `captures` (`today` · `top level`) and gallery's `save into` each answer
  "where do new X go?". Each is read by its own code, and none of them can
  say "today".
- **F4. `parent: null` is overloaded.** Routines and paste use it to mean
  "not the capture target", not "the top level is where this belongs".
- **F5. Nothing can say "the day it is dated".** Rows 7 and 11 both want it.
- **F6. A day already shows what is dated to it, without moving anything.**
  Days' `refCarriers` make every date value mention its day, so a day's
  References and `kb backlinks <day>` list the events on it. The data-plane
  design chose to file events under their calendar ("a library like Tana's,
  not the day") because of that. Filing an event *under* its day is a
  second, optional thing a person may want. It is not needed for the day to
  show the event.

## 3. What other tools do

| Tool | Where a new thing lives | Mechanism | Lesson for kb |
|---|---|---|---|
| **Tana** | its *owner*, where it was made, often today's node. "A node has only one owner, but can have many parents" | To file by tag, a person builds a command node with **Move node** (target: Library, a node, "a field or a dropdown option") and attaches it to the supertag's **On added** event. The node is **moved after creation**, and by default leaves a reference behind. Tana warns that its event system disables itself on loops | This is option (c). It works in Tana because the reference keeps the original place meaningful, and kb has no such reference. It is also a person-built automation over events, not a placement anyone can read back |
| **Logseq** | the page you type on, by default today's journal (`:default-home`) | no per-type routing. People reach for a page's backlinks to the journal | The journal as default capture is what days already does |
| **Notion** | a database entry is a page *in* the database. The database is the home | **Buttons** "Add page to" a chosen database, with property values | A destination is chosen per creator (per button), as a value. That is a plain destination (b), and it works because a database is a fixed place, with no "today" |
| **Capacities** | nowhere. "You don't decide where a note should live. You decide what kind of thing it is" | every object is auto-linked to the day it was made ("Created on this day" on the daily note) | The day shows what was made in it by **link, not location**. kb already does this with days' "made or edited" section and the date carriers (F6) |
| **Anytype** | nowhere: "Folders ask 'where does this go?'; objects ask 'what does this relate to?'". Collections are links | a type, and a default type per channel | The same as Capacities |

Sources: [Tana, move node to Library when a supertag is used](https://outliner.tana.inc/faq/move-node-to-library-when-a-supertag-is-used);
[Tana command nodes](https://outliner.tana.inc/learn/features/command-nodes);
[Logseq `:default-home` discussion](https://discuss.logseq.com/t/how-to-set-default-home-to-today-not-journals/17180);
[Notion databases](https://www.notion.com/help/intro-to-databases), [Notion buttons](https://www.notion.com/help/buttons);
[Capacities object types vs folders](https://docs.capacities.io/tutorials/object-types-vs-folders),
[Capacities dates and daily notes](https://docs.capacities.io/reference/dates-and-daily-notes);
[Anytype collections](https://doc.anytype.io/anytype-docs/basics/collections). Tana's
docs name no "default location" on a supertag and no Today target for Move
node. Its tag-based filing is only the On added + Move node recipe.

The locationless tools show that "show it on the day" does not need
filing; kb already has it (F6). The tree tools show that once a node has
one parent, *some* rule picks it. That rule is best kept as data a person
can see and change, not as an event automation.

## 4. The options

### (a) A getter, `getToday()`, that creators call

The calendar imports days, calls `getToday()` (or `dayOf(date)`), and
passes the id as `parent`.

- **Coupling:** the events family takes a hard dependency on days, a
  plugin-to-plugin call graph that Rule 1 and the declared-points model
  avoid. With days off, events has to branch on it. With an inbox plugin
  instead, events has to learn that too.
- **One place to read:** no. The answer is inside each creator's code.
- **Undo and atomicity:** the getter makes the day, so the page path
  becomes two writes (F2 is exactly this, today). It can be one
  transaction only if the getter returns *a plan* and not an id, and then
  it is (d) without the name.
- **Agents and CLI:** each needs its own flag or call.
- **In the UI:** no; a person cannot choose.
- **Failure:** the creator's problem, solved differently each time.

### (b) A plain destination node, as a setting

A setting per creator (gallery's `save into`), or per tag, holding a node.

- **Coupling:** none. **One place:** per setting, but there are already
  three, each read by its own code (F3).
- **Undo:** one write. **Agents and CLI:** they read the setting if they
  know about it.
- **In the UI:** yes, a ref field.
- **Failure:** a deleted node reads as empty, the existing convention.
- **Fatal flaw:** it cannot say "today" or "the day it is dated". A node
  is a fixed place, and the owner's example is a moving one. (b) is the
  right answer for half the values, and (d) keeps it as exactly that: a
  `Placement` may be a plain node.

### (c) An on-create hook that moves or retargets

Either a `tx/after` reaction that moves the new node (Tana's On added + Move
node), or an interceptor on `node.add` (`ActionInterceptorPoint`) that
rewrites `parent` before the handler runs.

- **Reaction:** a second transaction with actor `{kind: "reaction"}`, at
  most once and lost on exit (DESIGN.md → Transaction reactions), so a
  crash leaves the node unfiled. Undo takes two steps. The node is
  visibly made in one place and then jumps. A batch or paste that names
  its parent gets moved anyway unless every reaction re-implements
  "structure versus filing".
- **Interceptor:** a single transaction, but placement becomes an input
  rewrite that any number of plugins may chain, in kernel order. Nothing
  can say ahead of time where a node will land, because the answer is "run
  every interceptor". It also needs the day made in the same transaction,
  so the interceptor would have to smuggle upserts through `node.add`'s
  input. And interceptors exist for *transforming calls*. Placement is a
  value a person chooses, not a transform.
- **One place to read:** no. **In the UI:** only as an automation. **Failure:** an
  interceptor failure aborts the call as `internal`, and a reaction failure
  is a log line with the node unfiled.
- **Coupling:** low, but invisible.

### (d) A placement port

Families contribute named, typed resolvers to one declared point. Every
creator takes a `Placement` value (a node, null, or a resolver call); a
stored setting or a tag default holds the same value as a ref; and the add
resolves it inside its own planned transaction.

- **Coupling:** none between families. Events never imports days. The
  person, or a seeded default, writes the value *day of: starts*, which
  names days' resolver as data. With days off, the value dangles, which is
  a stated failure (§6.6).
- **One place to read:** `node.placement` answers, for a given input and
  tag set, where the node would land and why ("Mon, Nov 17, from `#event`'s
  `goes into`").
- **Undo and atomicity:** one transaction, as rows 1–3 already prove: the
  day and the node commit together and are undone together, and a
  conflicting commit re-plans.
- **Agents and CLI:** `parent` accepts the same value on every surface:
  `kb add --parent today`, MCP `parent: {resolver: "days.day", args: {day}}`.
- **In the UI:** yes. `goes into` is a ref field whose options are nodes
  and `#placement` nodes, chosen with the ordinary ref picker.
- **Failure:** stated once (§6.6).

### Scorecard

| | (a) getter | (b) node setting | (c) hook / move | (d) port |
|---|---|---|---|---|
| No hidden plugin coupling | ✗ imports days | ✓ | ~ invisible | ✓ data names the resolver |
| One place to read where it lands | ✗ | ~ one per setting | ✗ | ✓ `node.placement` |
| One write, one undo | ✗ on the page | ✓ | ✗ (reaction) / ~ (interceptor) | ✓ |
| Same for page, CLI, MCP, agents | ✗ | ~ | ~ | ✓ one input value |
| A person can set it as a field value | ✗ | ✓ | ✗ an automation | ✓ |
| Defined failure when the family is off | ✗ ad hoc | ✓ but can't say today | ✗ | ✓ §6.6 |
| Can say "today" / "the day it is dated" | ✓ | ✗ | ✓ | ✓ |

## 5. Recommendation

**Build (d), as a generalisation of the capture target, and retire the
capture-target role into it.**

The reason is Rule 1 and the evidence, not taste:

1. The concept already lives in kb, as `CapturePlanner`, with the hard
   part (planning inside the commit) done and tested
   (`capture-zones.scenario.test.ts`). Generalising it adds no mechanism.
2. It lives in **three more places** besides (F2, F3). Collapsing them is
   the first commit Rule 1 asks for.
3. `ui.capture-target` is a **value dressed as a role**. A provider role is
   for "another implementation is another provider" (DESIGN.md → What kinds
   of extension kb supports). But top level, today and an inbox are not
   implementations of one answer. They are different answers a person
   picks, and today the person picks them through two mechanisms at once:
   `sys.f.provider` on the role node *and* days' `captures` setting. A
   value in a field is the shape that matches the concept.
4. Option (c) is how Tana does it, and that design is an automation layer
   kb would have to grow just for this.

`ui.landing` and `ui.date-target` stay roles. They choose *where the page
navigates*, not where a node is made. `ui.date-target`'s days provider will
call the same `days.day` resolver underneath (one implementation of "a
date's day"), but its contract is navigation.

## 6. The contract

### 6.1 Types: `@kb/contracts`, `src/placement.ts`

This replaces `capture-target.ts`. `CapturePlan` keeps its shape under its
real name.

```ts
/** Where a node lands, once `upserts` are written: under `parent`, or the top level for null. */
export interface PlacementPlan {
  readonly parent: NodeId | null;
  /** What the place needs first (a day not made yet), written in the add's own transaction. */
  readonly upserts: readonly KbNode[];
}

/** A resolver named, with its args. JSON on every wire. */
export interface PlacementCall {
  readonly resolver: PlacementId;              // "days.day", "core.top-level"
  readonly args?: Readonly<Record<string, unknown>>;
}

/** What a creator takes: a node, the top level, or a resolver to ask. */
export type Placement = NodeId | null | PlacementCall;

/** What a resolver sees: the store, and the node being made (its tags and props as planned). */
export interface PlacementSubject {
  readonly nodes: readonly KbNode[];
  readonly made: Pick<KbNode, "id" | "props" | "tags">;
}

/** A family's resolver, a keyed contribution to `PlacementPoint`. */
export interface PlacementResolver<A> {
  readonly id: PlacementId;
  readonly label: string;                      // "Today", "Day of a date field"
  readonly args: Schema.Codec<A>;              // checked before plan; published in kb.manifest
  /**
   * Ambient context → explicit args, run by the surface that holds the
   * context (the page's clock and zone; the store's zone on the server).
   * Absent: the resolver reads nothing ambient.
   */
  readonly fill?: (ambient: Ambient, given: Partial<A>) => Effect<A, DomainError>;
  /** Pure over the store: no I/O, deterministic for (nodes, args, made). */
  readonly plan: (subject: PlacementSubject, args: A) => Effect<PlacementPlan, DomainError>;
}
```

- **`PlacementPoint`** is a core point (`CORE_POINT_DEFINITIONS`), keyed by
  `id`, accepted on the `registry` and `page` kernels, combined by lookup.
  It is not replaceable. Core contributes one resolver, `core.top-level`,
  which is the data form of `null`: a ref field cannot hold null, so a
  person who chooses "the top level" in `goes into` needs a node to pick.
  There is no `core.node`, because a node id already is that value. A
  resolver id belongs to the family that contributes it, namespaced as
  every keyed contribution is.
- **`fill` / `plan`** is the split that removes F2. "Today" depends on
  where you stand, and "the day `2026-11-17`" does not. `days.today` is
  `days.day` with a `fill` that supplies `day` from the ambient clock and
  zone. The tab fills from the page's day, so a capture made just after the
  person's midnight lands in the person's today. The server fills from the
  store's zone setting. Either way, the call that is *pushed* carries the
  filled args (the existing `asFilled` channel), so the server *plans* the
  same day, makes it in the same transaction if it is missing, and lands
  the node where the tab did. The tab's `asPlaced` side channel is deleted.
- **Purity of `plan`** is what makes re-planning on conflict, the page's
  optimistic commit and the server's commit agree. A resolver that needs
  I/O is not placement (§10).

### 6.2 Where a creator takes it

- `node.add`, `node.addTree`: `parent: Placement | undefined`. Today's
  `string | null | undefined` stays valid on the wire. They also take
  `fallback?: Placement`, the creator's *suggestion*, which applies only
  when neither the query nor the node's tags say otherwise (§6.4). This is
  a separate input because it is a separate concept: `parent` is where the
  creator insists the node goes, and `fallback` is where the creator would
  put it if the person has not said. Gallery's `goes into` and the import's
  calendar node are fallbacks. `placeOf` becomes
  `resolvePlacement(input, subject)`, still called from inside
  `commitAddEffect`'s planner.
- `node.batch`: a `node.add` call may name a `Placement`, resolved over the
  batch's working copy (so two adds into one new day make it once). Batches
  still never take an *omitted* parent. Those calls decide their place, and
  now they can decide it as "today".
- Surfaces: the CLI's `--parent` accepts `today`, `day:YYYY-MM-DD`,
  `top`, a node id, or `@<placement-node-id>`. MCP and WebMCP get the
  input's JSON Schema from the action, so they need no work of their own.
  The page's `captureNode` becomes `node.add` with `parent` omitted. It no
  longer asks a role first.

### 6.3 As data: a placement is a node

Everything is a node, so:

- Each resolver is a **seeded node** tagged `#placement`
  (`sys.tag.placement`), with id `placement.<resolver-id>`
  (`placement.days.today`, `placement.core.top-level`), seeded by the
  family that contributes it, as days seeds its tags. It carries
  `sys.f.placement.resolver` (text, the id).
- A **configured** placement, one whose args are fixed, is a person's or a
  family's `#placement` node whose `resolver` refs the seeded one and whose
  args are its props, read by the resolver's `args` schema. For example,
  *day of: starts* is `{resolver → placement.days.day-of, field → starts}`.
  A configured placement can be renamed, reused across tags, and found with
  `kb backlinks`.
- **`goes into`** (`sys.f.placement`, ref, one value) is the one field that
  stores a placement. Its value is a node: a `#placement` node means
  "resolve this", and any other node means "there". It sits on:
  - **core's family node**, where it is the store default and replaces
    `ui.capture-target`, days' `captures` setting, and the "Capture target"
    role node;
  - **a tag node**, where it is the per-tag default;
  - **a family's settings node** where the family makes filed nodes. The
    family passes it as the call's `fallback`, which a tag default can
    still override. It replaces gallery's `save into`.

  Days' `journal` stays: it says where the hierarchy is rooted, and the
  `days.*` resolvers read it.

### 6.4 One order, read in one place

For a node being made, the first of these that answers wins:

1. the call's `parent` (a node, null, or a `PlacementCall`);
2. `matching`'s `child-of`, as today;
3. `goes into` on the node's tags, in the order the input lists them. A
   tag inherits it through `sys.f.extends` the way it inherits fields;
4. the call's `fallback`;
5. `goes into` on the store (core's family node);
6. the top level.

`node.placement` (read, isomorphic) takes `node.add`'s input less `text`
and answers `{parent, via, resolver?, skipped[]}`. Here `via` names the step
that answered and `skipped` names any dangling value it read past, so a
person and an agent see the same reason. The node menu's "Lands in…"
hint, `kb add --dry-run` and an MCP agent all read it.

### 6.5 Guards, approval, scripts, undo

- Resolution runs **inside the planner** given to `persistPlannedEffect`.
  So the commit's integrity check, guards, approval decision and
  transaction-tail record cover the node *and* what its place needed, as
  one write and one undo step. Rows 1–3 already work this way.
- Interception sees the input as it was given, with the placement value,
  plus the session's fill. The commit-time checks see the resolved parent.
  An approval guard that cares where a node lands reads the commit, as the
  script bound already does.
- **Scripts:** a grant bounds a call by the nodes its `targets` name
  (`callTargets` in `@kb/sandbox`). A `PlacementCall` names no node, so a
  script's `node.add` with one is refused at the call, as an omitted
  parent is today. The commit-time bound (`scriptWriteRefusal`) holds
  regardless. A script that wants today passes an id it resolved through
  `node.placement`.
- **No interceptor** takes part in placement. The days interceptor
  `ext.days.untag-period` is unaffected.

### 6.6 Failure

One rule, stated where kb already states it for settings, and for inputs:

- **A stored value that dangles reads as empty.** A deleted node, or a
  `#placement` node whose resolver is not loaded because its family is off,
  is skipped, and the order falls through to the next step.
  `node.placement` reports it in `skipped`. This is how days' `journal`
  pointing at a deleted node already reads. With days off, the store
  default `placement.days.today` dangles and captures go to the top level,
  the same behaviour as today's role demotion.
- **An explicit value that cannot resolve fails the write.** A call that
  names `days.today` with days off fails `placement_unavailable`, naming
  the resolver and the family. An agent asked for today did not ask for the
  top level.
- **A resolver that fails or overruns fails the write.** It runs inside a
  commit, so there is nothing to demote to without relocating the node
  silently. This changes one thing: today a faulted days provider is
  demoted and the capture lands at the top level. With this design, the
  capture fails, with a toast naming why. Decision 3 asks the owner to
  confirm.

## 7. How "today" and the calendar fall out

**Today.** `placement.days.today`, seeded by days, is the resolver `days.day`
with a `fill` from the ambient clock and zone. A days migration (a plugin
data migration: a planned transaction, previewed, recorded in the ledger)
sets the store's `goes into` to it once, when it is empty and days'
`captures` is not `top level`. The migration then removes the `captures`
field. Every surface's capture lands where it lands now; the page makes it
in one write, not two; and "send captures to the top level" becomes
clearing one field. The "Go to today" key, the Today row and `ui.landing`
call the same resolver through `ext.days.today`, which stays as the
navigation verb.

**"Put new events into the day's node."** Days contributes
`days.day-of` with args `{field}`. Its `fill` is empty, and its `plan` reads
the made node's value in `field`, a date stored as `YYYY-MM-DD`, which is
the day's key (DESIGN.md → Days), and plans that day. A person, or the
events family's setup, creates a `#placement` node *day of: starts* and
puts it in `#event`'s `goes into`. Then:

- the gcal import's `node.add` names no parent (§8), so each event lands
  under the day it starts on, with that day made in the same transaction;
- the date-field calendar's "+ Add to Fri, Nov 14" carries `field-is` for
  the date, so the node it makes is dated Friday and, when its tag's
  `goes into` is *day of* that field, lands in Friday (F5). Without a tag
  default it lands where captures go, as now;
- a recurring series lands in the day of its first start;
- an event whose `starts` later changes **stays where it was**. Placement
  is a creation decision, and moving nodes when a field changes is
  re-filing, a different feature (§10).

**Default:** `#event` ships with `goes into` empty, so the import's
`fallback` (the subscribed calendar node, §8 row 11) answers. That keeps
the gcal design's §2 and its reasons (a day already lists its events through
the date carrier, F6), and leaves day-filing as the person's choice.

## 8. Migrating the creators

| # (§2) | Creator | Change |
|---|---|---|
| 1–3 | `node.add`, `node.addTree`, days' `captureToday` | `placeOf` → `resolvePlacement`. `captureToday` splits into the `days.day` resolver and the `days.today` fill. The `captures` check moves to data (§7) |
| 4–5 | the page's captures | `captureNode` = `node.add` with no parent. Delete `PageCaptureTarget`, `CaptureTargetService`, `pageCapturePlanner`, `asPlaced`, and `dayNode`'s use as a capture target. `ARRIVAL_MS` remains only for navigation (gap `01M7CC1GD0A1J314ZTAR54F8AD`), and leaves the write path |
| picker "create" with a tag | `captureNode` + `addTag` (two writes) becomes one `node.add {tags}`, which also lets the tag's `goes into` apply. Closes a two-step undo |
| 6–7 | `matching` / "+ Add" | unchanged order; tag defaults now apply after `child-of` |
| 8 | gallery `save into` | migrated to gallery's `goes into` by a gallery data migration; `visual.parent ?? refOf(…saveIntoField)` becomes `fallback: <gallery's goes into>`, so `#visual`'s own default, if a person sets one, wins |
| 10 | routines' `parent: null` | a routine is a person's thing: **omit** `parent`, so `#routine`'s `goes into` and then the store apply. Accounts and calendars are the family's own records, so they keep `null` as structure |
| 11 | gcal import (unbuilt) | builds against this: `node.add` with no `parent` and `fallback: <the subscribed calendar node>`. With `#event`'s `goes into` empty, events land under their calendar, as the gcal design says; with *day of: starts*, under their day. The gcal plan's PR list gains this as a dependency, not a change of shape |
| 12–14 | structure: occurrences, pins, periods, paste, strips, batches | unchanged. Explicit `parent` is the rule for structure, and `null` there means top level, not "not capture" |
| 15 | canvas | `parent ?? null` → `parent` omitted when none is given, so a new canvas files like any capture |

## 9. Phased plan and cost

Each phase is one PR, behaviour-preserving where marked. Restructure lands
first and addition second, as Rule 1 asks.

| PR | What | Behaviour | Size |
|---|---|---|---|
| P1 | **Rename and widen, no new behaviour.** `capture-target.ts` → `placement.ts`; `CapturePlan` → `PlacementPlan`; `PlacementPoint`, with `core.top-level` and days' `captureToday` contributed as the `days.today` resolver, so the point has a reader and a real contribution from the first commit; `placeOf` → `resolvePlacement`; the capture role's registry providers become calls through the point. The store contract suite gains "a placement's upserts and the node commit as one transaction, re-planned on conflict" over `STORE_BACKENDS` | preserved | S–M, ~1 day |
| P2 | **Days resolvers and the page fill.** `days.day`, `days.today` (fill), and the page fill through `asFilled`; delete the page half of the role, `asPlaced` and `dayNode`'s capture use; `capture-zones.scenario.test.ts` re-pinned on one write per capture; a test that undo of a first-of-day capture removes the day too | preserved, except one undo step where there were two | M, ~2 days |
| P3 | **Placement as data.** `#placement`, `sys.f.placement` (`goes into`), seeded resolver nodes, the store default; the days migration for `captures`; retire the `ui.capture-target` role node; `node.placement`; CLI `--parent today\|day:…\|@id`, `--dry-run`. Wire fingerprint recorded | captures unchanged; new: choosing in the UI | M–L, ~3 days |
| P4 | **Tag defaults.** Step 3 of the order, inherited through `extends`; the picker "create" as one `node.add`; `fallback`; gallery `save into` migrated; routines omit `parent`; the "Lands in…" hint | new | M, ~2 days |
| P5 | **Day of a date field.** `days.day-of`; the date-field calendar's "+ Add" lands on its day; a *day of: starts* example for `#event`; the gcal plan rebased onto it | new | S, ~1 day |

The total is about 9 working days. Stop after P3 if §10's first test
fails: the capture target as a value is worth having on its own, because it
deletes two mirrors.

Spec changes ride in each PR (Spec-first changes): DESIGN.md gains a
**Placement** section, the canonical home; Provider roles loses
`ui.capture-target`; Days points to Placement; and DESIGN-UI.md → _Adding
to a frame_ names the order.

## 10. What would make us say no

- **No one sets a tag default.** If, after P3, the owner and the store's
  own agents never use per-tag `goes into`, P4 and P5 are a seam no data
  reads, and Rule 1 says a dead seam is a duplicate. Stop at P3.
- **The owner wants re-filing, not placement.** "When an event's start
  moves, move it to the new day" or "when I tag it `#project`, move it to
  Projects" is Tana's On added + Move node. That is a reaction over field
  and tag changes with its own loop rules, and §4(c)'s costs come with it.
  This design deliberately does not do that. If re-filing is the real ask,
  it needs its own design. Placement would then become its first input and
  stop being the whole answer.
- **A resolver needs I/O.** "Into the Google calendar's matching
  project" or "into whatever the agent picks" cannot be a pure `plan`, and
  forcing it in would break re-planning and the page's optimistic commit.
  That signals a different concept (a procedure or a job that names an
  explicit parent), not a bigger resolver.
- **The order grows exceptions.** If any surface needs "the order, except
  for me", for example a sixth step only the page reads, the model is
  wrong. Reopen it; do not patch it.
- **Multiple tags fight often.** Input order is a deterministic tie-break,
  but if people regularly make nodes with two tags that each have a
  default, "first listed wins" will feel arbitrary. Revisit only with real
  conflicts in hand.
- **Day-of filing makes the journal unreadable.** If the owner's
  calendars import hundreds of events a month into day nodes, the day page
  becomes an event dump. The carrier (F6) already shows them there, so the
  answer would be to leave `#event`'s default empty, not to change this
  design.

## 11. Decisions for the owner

1. **Adopt (d), retiring `ui.capture-target` into a `goes into` value?**
   The recommendation is yes, with `ui.landing` and `ui.date-target` kept as
   navigation roles.
2. **`#event` default:** empty (under the subscribed calendar, as the gcal
   design says; the day lists events through references), or *day of:
   starts*? The recommendation is empty, with day-of offered as a one-click
   choice.
3. **A failing resolver fails the write** instead of demoting to the top
   level (§6.6). The recommendation is yes: inside a commit, a silent
   relocation is worse than a refused capture with a toast.
4. **Tag tie-break:** first tag in input order (the recommendation), or
   refuse a node whose tags disagree.
5. **Stop line:** build P1–P3 now, and P4–P5 when a second consumer (the
   gcal import, or the owner's own tag) asks for them?
