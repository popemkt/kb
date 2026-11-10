# The data plane: field options, tag extension, events and days

Status: **build plan.** Every decision in §15 has its default taken, and the
owner may veto any of them. The principles are now kb rules, stated once in
[AGENTS.md → Data-plane freedom](../../AGENTS.md#data-plane-freedom) (kb#148)
with `#gap` nodes for today's drift; this record is the reasoning and the
plan, and does not restate them. Days is built first (§8), and the events
restructure (§6.6) is written for another thread to build.
Date: 2026-11-10.

Inputs: the owner's four asks and three addenda, a structure-only digest of
the owner's Tana workspace (152 supertags in 15 clusters), Tana's, Logseq
DB's, Anytype's and Capacities' public docs, and kb `main` at `f1498129`
(kb#145 merged).

Evidence: a prototype on branch `proto/data-plane-trial`, **not for merge**,
running kb's real UI on a scratch store with demo data. §13 lists what it shows
and which parts are mocks. The screenshots are under
[`2026-11-10-data-plane/`](2026-11-10-data-plane/).

## 0. The answer in one screen

**The principle: a person owns the graph, and a plugin owns its promises.**
A person can always add to any node, a system or plugin node included. That
covers a field on a tag, a child, an option, a tag that extends it, a default
and a field option. A person can always take back what they added. Three
things stay protected, each by the one mechanism that fits it, and nothing
else is locked:

1. **Identity and structure.** A seeded node's id, its existence, and the
   parts it ships (its seeded fields, options and children, in order) are
   the plugin's. kb reads ownership from the id: a person cannot mint
   `sys.*`, so "seeded" needs no extra bookkeeping. **Its text is not
   identity.** A person may rename any tag, field or option, a system or
   plugin one included (`#routine` → "habit", `done` → "finished"), without
   force. Every reader names nodes by id, and the seed already keeps a label
   the person edited. The commit refuses all of these writes today; the
   proposal narrows that refusal to the id and the structure.
2. **Managed values.** A field a plugin's sync writes (`gcal event id`,
   `synced at`, a day node's date) is declared with `managed by
   <extension>`. A person sees its values and changes them through the
   plugin's actions, never by typing. This is the one place a value is
   locked. It is quiet ("routines writes this") and it always says what to
   do instead.
3. **Constrained values.** Every other plugin value is the person's to write.
   It is made foolproof by the field's own constraints: its type and form,
   its option source (enforced at the commit, not only in the picker), a
   closed option set, and the plugin's commit guard. Bad input is refused
   with a reason, and the slot keeps what was typed.

On that principle:

- **Field options are fields of the field node**, drawn on the field's page
  like any field. They are `hide field` (never, when empty, when not empty,
  when value is default, always), `required` (a reminder, never a refusal),
  `auto-initialize`, and the option source kb already has. `sys.f.hidden`
  retires into `hide field = always`. **Defaults are per tag.** They live on
  the tag's **template node**: a child of the tag that holds the values the
  tag's instances start with, edited like any node.
- **Tags extend tags** (`sys.f.extends`, many). Multiple inheritance is
  linearized breadth first. A child inherits its parents' template fields and
  views, and overrides a default with its own template node, nearest first.
  "Is a `#event`" includes subtypes everywhere: in queries (a derived
  `:node/is` datom), the calendar, pickers and tag views. Extending a system
  or plugin tag needs no new permission, because the write lands on the
  person's own tag.
- **Events.** `#event` is the base. A repeating event is an event whose
  `repeat` (RRULE) is set; a routine is not a separate kind. An instance is
  virtual until written, then it becomes an `#occurrence` node keyed by its
  original start. Tasks and reminders are a separate base (`#task`); a
  reminder or habit is a person's tag that extends both. Google comes in
  **read-through, copy-on-write**: Google events show in kb without being
  stored, and become nodes when annotated. Google keeps the fields it owns;
  kb owns what the person adds.
- **Days** is its own plugin and the **first one to build**. It ships base
  `#day`/`#week`/`#month`/`#year` tags, Daily notes › year › week › day made
  lazily, open-to-today, and a replaceable **capture target** role whose
  default is today. Its day page collects sections that other plugins
  contribute. Its base half ships before tag extension, and gains the
  person's day fields when tag extension lands.
- **The editor stops saying "locked".** The padlock becomes a quiet *owned by
  Routines* with the paths that stay open. A refused gesture names the owner
  and offers the additive alternative.
- **Plugin data migrations** become a manifest-declared, versioned, pure step
  list. Its dry-run diff is shown on the update's trust sheet, it applies as
  one transaction, and a migration record node is kept. Renames ride the
  existing seed retirement table. The routines → events relabel is the first
  case, and under "ids are identity" it moves no data.
- **Values stay inline** (primitives plus refs), with "promote a value to a
  node" on demand. Measured on a scratch store, 100k values held as nodes cost
  about 3.4× the open time and 6× the memory of the same values inline (§11).

## 1. Where kb stands (verified on `main`)

| Concern | Today | Where |
| --- | --- | --- |
| Fields and tags | Fields are nodes (`sys.field`), tags are nodes (`sys.tag`), props are keyed by field id, and `sys.f.fields` templates a tag's fields. A tag never restricts which fields a node carries. | DESIGN.md → Data model |
| Option source | Exactly one of `targetQuery` → `targetTag` → the field's children, resolved by `allowedRefIdsOf`. **The picker enforces it; the commit does not** (a recorded gap). | `@kb/model` `field-type.ts` |
| Value checks | Kind, form (url, `HH:MM`, secret ref), cardinality and ref existence run in the commit for every surface. | `valueConformanceError`, `persistEffect` |
| Visibility | `sys.f.hidden` = true is the only option; `isFieldHidden` is its one reader. Template fields show empty until filled. | `ui-sdk/lib/field-visibility.ts` |
| Inheritance | **None for tags.** Ontologies have `onto.extends` (a DAG, cycle-safe), which is a precedent to reuse. | `ontology.ts` |
| System write rule | A `sys.*` node changes only in values of fields that `configure` it; everything else needs `--force`. One rule, checked in the commit. | `system-write.ts` |
| Seed on open | Fills absent props and adopts orphaned seeded children, and **never rewrites what a store holds**, so additive edits to a seeded node would survive opening. | `seed.ts` `ensureSystemSeed` |
| Ownership | `:node/owner` is derived from the fold and never stored. | DESIGN.md → `:node/owner` |
| Renames | The seed retirement table moves ids, values and labels idempotently. | `seed-retirement.ts` |
| Plugin powers | Commit guards and interceptors, `tx/after` reactions, declared points, roles with `replaces`, `ui.value-kinds`, capability admission. | DESIGN.md → Action registry, Declared points, Provider roles |
| Routines | `#routine` (rrule, starts, at, duration, zone, until, repeats-from, calendar and five sync facts), `#occurrence` children holding **facts** (done/skipped/moved) keyed by day, one fact per day. Expansion is lazy. Google sync is **push only**, to a calendar kb creates (`calendar.app.created` scope). | `@kb/routines`, `2026-11-02-kb-routines-gcal.md` |
| "Locked" in the editor | A padlock on `sys.*` page titles, a "System nodes (sys.*) are read-only" toast on any structural gesture under a `sys.*` node, no "add field" on a seeded tag, and read-only rows for fields that do not configure the node. | `zoomed-root-header.tsx`, `mutations.ts`, `tag-fields-config.tsx` |
| Day nodes, journal | None. | — |

The owner's sense that "locked nodes make it feel less free" is exact. Today
a person cannot add a field to the routines `#routine` tag, an option to its
`state` field, a child under any seeded node, or a default anywhere. They also
have no way to make a tag of their own that *is* an event.

## 2. Other tools, briefly

- **Tana.** The field config has Hide field (never / when empty / when not
  empty / when value is default / always), Auto-initialize (value from an
  ancestor with this field, ancestor with this supertag, random node with
  this supertag, current date, date of ancestor day node, current user),
  Required (only a visual warning), and options that are fixed, from a
  supertag, or from search, with auto-collect. **Defaults live on the
  supertag template, not on the field.** For Extends: the child's template is
  a projection of the parent's; inherited content cannot be moved or deleted,
  but fields can be added and defaults overridden; a field added to the
  parent propagates; searching `#parent` includes extending tags. The docs do
  not confirm multiple parents; the owner's workspace uses them. Base types
  are mostly hints for AI. Recurrence is not native (it is on the 2026
  roadmap). Google Calendar sync is one-way into Tana, and Tana edits are
  overwritten.
  Sources: [fields](https://outliner.tana.inc/learn/features/fields),
  [supertags](https://outliner.tana.inc/learn/features/supertags),
  [extend](https://outliner.tana.inc/learn/guides/when-to-use-extend-in-supertags),
  [calendar](https://outliner.tana.inc/learn/features/calendar-integration).
- **Logseq DB.** A tag has multiple parents and inherits their properties.
  **Built-in tags are extensible**: a person adds properties to `#Task`, and
  makes their own task types by giving a tag `Extends: Task`. Built-in status
  choices can be renamed and added to, never deleted. On a built-in
  property's page only its icon, position, hide-by-default and choices are
  editable. A property has a default value, closed choices, "hide empty
  value", "hide by default", and node-tag constraints that include child
  tags. ([db-version](https://github.com/logseq/docs/blob/master/db-version.md))
- **Anytype.** One type per object and no inheritance; properties can be
  added to built-in types. **Capacities.** Basic types cannot be edited and
  take no custom properties; you convert an object to a custom type instead.

Logseq is the closest model to what is proposed here: built-ins are extensible
and additive, and destructive changes to what ships are refused. Tana supplies
the field options and per-tag defaults. Capacities is the feel to avoid.

## 3. The principle

### 3.1 Three owners, one rule

| Owner | Nodes | Who may change what it ships |
| --- | --- | --- |
| **Kernel** | core's `sys.*` (`sys.tag`, `sys.field`, `sys.f.type`, field types…) | core's code, through its seed and retirements |
| **Plugin** | a family's seeded nodes (`:node/owner` names it) | the family, through its seed, migrations and actions |
| **Person** | every node with a ULID id, including the person's additions *to* seeded nodes | the person, always |

The rule is about *edits*, not nodes:

| Edit to a seeded node | Allowed? | Why |
| --- | --- | --- |
| Add your field to its template; add a child (content, a template node); add an option to an open option set | **yes** | Additive. The plugin's code reads its own ids and never sees yours. |
| Make your tag extend it; make it extend your tag | **yes** | The first writes your tag. The second only adds fields to its template. |
| Set a field option or setting on it (`hide field`, `required`, color, default view) | **yes** | Already the `configures` mechanism (a setting of the kind `sys.field` / `sys.tag`). |
| Take back what you added | **yes** | It is yours: its id is a ULID. |
| Rename it (its text) | **yes** | Cosmetic. Its id is what code, queries and docs read, and the seed keeps an edited label on every open (DESIGN.md → "The seed retires what it renames"). §3.3 lists what a rename still breaks today. |
| Delete it, or remove or reorder what it ships | **no** | That is its structure: the plugin's code switches on these ids. |
| Write a value of a field it manages | **no, by typing** | Its sync owns that fact. You change it through the plugin (Sync now, detach). |
| Write a value outside a field's constraint | **no** | The constraint *is* the protection; nothing else is needed. |

**Ownership follows the id.** The system-write rule becomes "keep every
`sys.*` id a seeded list held, in order; add or remove only a person's ids".
It needs no stored provenance and no comparison against the seed. This is
what the prototype runs (`keepsSeeded` in `system-write.ts`), and it is still
one rule checked in the commit. The fields whose values are additive on a
seeded node are named once (`sys.f.fields`, `sys.f.extends`, and the node's
children). A seeded field's option set is open unless it says `closed`
(§4.5).

### 3.2 Constrained, not locked

Prefer a constraint to a lock. A constraint is about the value, so it holds on
every node and every surface. A lock is about the node, so it makes the person
feel watched. Plugin values today are mostly person data that the plugin
*reads*: a routine's rrule, time and duration, an occurrence's state. Those
stay writable, guarded by:

- the type's form, already in the commit: `25:99` in `at` is refused with
  "is not a local time (HH:MM)", and the slot keeps the input marked
  (screenshot `30`);
- **the option source, moved into the commit**. Today a task node can be
  written as an event's `gcal status` and the commit accepts it; the
  prototype shows this. Closing that gap is build step 2;
- a closed option set (§4.5);
- the family's own commit guard, e.g. "an rrule the engine can send". This
  already exists as an interception point.

`managed by` is the exception, and it is declared, never inferred. It is for
values that mirror something outside kb (Google's ids and status, a day
node's date, which is its identity) and that a person's edit would only
corrupt. The commit guard reads the field's `sys.f.managedBy` and the call's
`via` action: a managed value is written only by a call that runs through an
action of that extension. `routines-host` already invokes with
`via: "ext.routines.sync"`.

### 3.3 What a rename breaks today, and references by id

A label is cosmetic only if nothing kept matches by it. These matched by text
on `main` before kb#148:

| Reader | Matched | Status |
| --- | --- | --- |
| the `docs.rules` and `docs.todos` lenses (`[?tag :node/text "rule"]`) | `#rule`, `#todo` | **fixed in kb#148** (by id; `docs/todos.md` byte-identical) |
| the "All todos live" saved query | `#todo` | **fixed in kb#148** |
| AGENTS.md's `kb query` example, which agents copy | `#todo` | **fixed in kb#148** |
| the query IR's `label` atom: a condition value the builder writes as a label compiles to "id = v **or** text = v" (`conditions.ts`) | any option or tag a filter names | open: GAP "stored queries may match a node by its text" |
| tests and research records using `[?t :node/text "todo"]` | fixtures | harmless: they test the query language, not a stored reference |
| `kb add --tag todo`, `kb set <n> status …` | resolve a name once at the entry point | by design: a name a person types resolves to an id at the boundary |

**Saved queries should be stored id-based.** The builder already has the ids
in hand when a person picks a tag or option; it writes the label atom only
because a typed value may not be a node. The fix (the gap's `closes`) is for
the builder to write a ref atom when a label resolves to a node, plus a check
that refuses a stored query, lens or filter matching `:node/text` against a
literal. A query a person *types* may still match text, because that is
search.

### 3.4 Why this is Rule 1

There is one write rule, one ownership reader (the id), one way a plugin
protects a value (`managed by`), and one way it bounds a value (the field's
constraints). There is no per-plugin lock list and no second editor for
seeded tags. A seeded tag's page is the same page as the person's tag, with
the same field rows and template list; it only marks which of its fields are
shipped.

## 4. Field options

### 4.1 The schema, as nodes

Every option is a field node that **configures the kind `sys.field`**
(`sys.f.configures` → `sys.field`). That makes it writable on every field, a
system or plugin field included, and `sys.field`'s template lists it, so it
draws as a row on every field's page. A field's page *is* its options panel.
That is today's rule ("surface the fields your kinds template"), so no bespoke
panel is needed (screenshot `12`).

| Option | Field node | Values | Lives on | Reader |
| --- | --- | --- | --- | --- |
| hide field | `sys.f.hide` | children `never` · `when empty` · `when not empty` · `when value is default` · `always` | the field | `hideModeOf` / `isHiddenBy` |
| required | `sys.f.required` | checkbox | the field (a template node may override) | the field row |
| auto-initialize | `sys.f.autoInit` | children `to current date` · `to date of ancestor day node` · `to ancestor with the target tag` · `to value from ancestor with this field` | the field | tag application |
| default | *(no field)*: a value of the field itself on the tag's **template node** | the field's own type | the tag | `defaultValuesOf` |
| options from | `targetQuery` / `targetTag` / children (unchanged) | — | the field | `allowedRefIdsOf` |
| closed | `sys.f.closed` | checkbox | the field | the picker's create row, and the commit |
| managed by | `sys.f.managedBy` | ref → an extension's node | the field (seeded only) | the field row, and the commit guard |

**`sys.f.hidden` retires** into `sys.f.hide = always`, using one seed
retirement row (`hidden` = true → `always`; false or absent → nothing).
`isFieldHidden` stays the single reader and reads `hide = always`, so the
eleven seeded hidden fields keep their meaning (Rule 1: one carrier for
"hidden").

### 4.2 Defaults belong to the tag: the template node

Tana puts defaults on the template, and the owner's workspace depends on
per-tag overrides. Every "to-\*" reminder flavour sets its own `Reminder
Type`, and `Task Status` defaults to In Backlog. A default is therefore a
property of the (tag, field) pair, and in kb a relationship with attributes
is a node:

> **A tag's template node** is a child of the tag that carries
> `sys.f.templateOf` → the tag. Its field values *are* the defaults.

- It is edited like any node, with the same slots, kinds, picker and write
  check, because it holds real values of the real field. No field holds
  values of a type that depends on where it sits, and no second editor is
  needed. It is drawn with its tag's whole template (inherited fields
  included), so every templated field shows a slot to fill.
- Its *children* are the template's content, which a new instance is
  offered. That is Tana's template content. It is a later step, not in the
  prototype.
- It is a **role carried by a field**, like `sys.f.ref.target` and
  `sys.f.query`: strip `templateOf` and it is a plain node. It is not tagged
  with its tag, so instance queries never see it. It is scaffolding to
  "Made this day", the graph's default lens and search ranking.
- **Resolution: nearest template wins.** For a node's field, go through the
  node's own tags in order, and for each, its `tagAncestors` (breadth first).
  The first template node that holds the field supplies the default. That is
  how `#to buy` overrides `#reminder`'s Reminder type while Status still
  comes from `#task` two levels up (screenshot `16`, prototype
  `defaultValuesOf`).

**Applying a tag materializes the defaults**, in the same transaction. For
each templated field the node does not hold yet, it writes the nearest
default, else the auto-initialized value. Tana does the same. It means
`status = Backlog` is a stored value, so every query and every surface agrees.
Production puts this in the commit as a core interceptor on "a type was
added", so `kb add --tag`, MCP and agents start nodes the same way. The
prototype does it in the page's `planAddTag` only (screenshot `24`: one
palette "Add tag" wrote Status, Due and Reminder type).

"Hide when value is default" compares the stored values with the resolved
default. A value the person sets back to the default hides again. That is
Tana's behaviour, and it is what makes `Event status = Confirmed` vanish
from meetings.

### 4.3 How each option renders

| State | Row |
| --- | --- |
| hidden by option | Not drawn. **"+ Field"** in the node's menu lists the hidden template fields, so they are one gesture away (prototype: debug fields show them; the menu entry is build step 3). |
| required and empty | A small amber `required` beside the empty slot (screenshot `10`). A query `kb run missing-required` lists them. **Never a refusal**: refusing would make `node.add` then `set` impossible, and Tana and Logseq agree. |
| managed | Values at rest, plus a faint "routines writes this" note. A typed edit is refused at the commit with a toast that names the owner and the action ("Sync now, or detach the event"). Empty managed fields hide (their seed says `when empty`). |
| inherited | The tag page lists inherited fields under the tag's own, each "from #event". |
| shipped (on a seeded tag) | "shipped" in place of the remove button. The person's own added fields keep theirs. |
| default | The template node shows the default in an ordinary slot. |
| auto-initialize | Nothing at rest. The option names what happens when the tag is applied. |

### 4.4 Auto-initialize

These run once, when the tag is applied, with no tracking afterwards. All
read the node's ancestry or the clock, so they run in the same commit
interceptor as defaults:

- **to current date**: the local day (prototype: yes);
- **to date of ancestor day node**: the nearest ancestor carrying days'
  identity field (§9). A capture into today gets today;
- **to ancestor with the target tag**: for a ref field with `targetTag`, the
  nearest ancestor that `isA` that tag (a task under a project gets the
  project);
- **to value from ancestor with this field**: copies the nearest ancestor's
  values.

Random node and current user are left out until a real need appears; kb has
one person per store.

### 4.5 Option sources, closed sets, subtypes

- `targetTag` **includes subtypes**: options from `#person` include
  `#friend` when `#friend` extends `#person`. Logseq does the same.
- **The commit enforces the option source** (build step 2). `allowedRefIdsOf`
  already has an injected runner; the commit runs it for ref values a
  transaction writes. This closes the recorded gap, and it is what makes
  "constrained, not locked" true on the CLI and MCP as well as in the picker.
- `closed`: the option set does not grow from the picker (no "create" row),
  and the commit refuses a child added under the field by anyone but its
  owner. A family closes the sets its code switches on (`state`: done /
  skipped / moved; `sync`: preview / on / paused). A person's sets stay
  open, as in Tana with auto-collect. An open seeded set lets a person add an
  option; the family's guard decides whether the code accepts it.

## 5. Tag extension

### 5.1 The model

- `sys.f.extends`: a ref field on `sys.tag`'s template, **many**-valued,
  targeting every tag. It configures `sys.tag`, so it is writable on seeded
  tags too, and it is additive there (§3.1).
- **Linearization.** `tagAncestors(tag)` is the tag itself, then its parents
  breadth first in declared order, each once. Templates merge in that order:
  own fields first, then each ancestor's, without duplicates. Defaults and
  views resolve nearest first. A diamond (#habit extends #event and
  #reminder, and both reach a shared mixin) includes the mixin once. C3 would
  refuse some orders; breadth first never refuses, which matches "nothing
  graph-shaped throws" (the ontology resolver's stance).
- **Cycles.** The picker refuses them (`wouldCreateTagCycle`, like
  `wouldCreateExtendsCycle` for ontologies). The resolver is cycle-safe
  regardless.
- **What a child may do.** It may add fields, override defaults (its own
  template node), override `hide`/`required` on its template node, and
  choose its own views. It may not remove an inherited field. That is Tana's
  rule, and it keeps "is a #event" honest: every #meeting has an event's
  fields.

### 5.2 "Is a" everywhere: one reader, one datom

- `kindsOf(node)` and `isA(node, tag)` in `@kb/model` are the one reader.
  Tag *chips* stay the direct tags (`sys.f.type`), and *membership* is
  `isA`. This is the same split DESIGN.md already makes between the badge
  list and the kind slot.
- **Datalog.** A derived ref attribute `:node/is`, an entry in
  `CORE_DERIVED`, holds the closure of `sys.f.type` over `sys.f.extends`.
  `[?n :f/sys.f.type ?t]` stays "tagged exactly", and `[?n :node/is ?t]` is
  "is a, subtypes included". The query builder's tag filter uses `:node/is`.
  The closure is recomputed when any tag's extends changes; at kb's scale
  that is a rebuild of one attribute.
- **Consumers.** These switch to `isA`: the calendar (prototype: yes, so
  `#meeting` and `#habit` show), the engine's routine scan, `targetTag`
  candidates, a tag page's instance list ("Nodes with this tag", with a
  "direct only" toggle), ontology tag membership, and `#rule`/`#gap`
  readers. Tag views resolve through the chain (prototype:
  `tagViewsOf`), so a `#my day` node opens in the day page `#day` names.

### 5.3 Extending a system or plugin tag

"My #meeting extends the system #event" writes only the person's `#meeting`.
**It already passes today's write rule.** What blocked it was the absence of
`extends`. Adding a field to the system `#event` itself is the additive edit
(§3.1). The prototype does both: `Location` was added to `#event` and shows on
every meeting (screenshots `13b`, `15`).

When a plugin later adds a field to its tag, the seed's "fill missing
template refs" pass (today applied only to `TEMPLATE_TAGS`) is generalized to
every seeded tag. A union keeps the person's additions, and every subtype
gains the field at once, because inheritance is read and never copied.

## 6. Events

### 6.1 The cluster, as kinds and roles

The strip test (DESIGN.md → Kinds, roles and options) decides each line:

| Concept | Carrier | Strip test |
| --- | --- | --- |
| **#event** | tag (base, from the events family) | A thing placed in time: a date, optionally a time and duration, a calendar. |
| repeating event (a "routine") | **the `repeat` field** on an event | Strip the rule and it is a one-off event, still an event. So "routine" is a role, not a tag. Today's code already reads an empty rrule as a one-off. |
| **#occurrence** | tag | One instance of a repeating event that the person wrote to (a fact, notes, attendees). Strip its fields and it is still an instance of that series: a kind. |
| **#task** | tag (base, from a tasks family; the owner's #reminder extends it) | Something to be done: a done state. |
| reminder, habit, meeting | **the person's tags** | #reminder extends #task (add a date and it is also on the calendar if it extends #event). #habit extends #event and #reminder. #meeting extends #event. |
| **#day**, #week, #month, #year | tags (base, from the days family) | §9. |

**No shared date field.** Tana uses a single `Date` field across event,
meeting, reminder and recur. kb gets the same reach from the **type**: the
day page's "dated this day" and the date → day link (§8) read every
date-typed field, so `starts`, a task's `due` and the person's own date
fields all count, and no family's data has to move into a core field.
Decision D7.

### 6.2 RRULE, and simple intervals

There is **one encoding: RRULE.** A "simple interval" (every 3 days, every 2
weeks) is `FREQ=DAILY;INTERVAL=3`, which the repeat picker writes from
presets; it already does. Tana's parallel encoding (`Duration` + `Unit`
beside `RRule`) is two carriers for one fact. The one thing it adds,
*"lapse between recurs"*, is **repeat from completion**, which kb already has
(`repeats from: completion`): the next instance is counted from when the last
was done. The prototype's demo `#habit` hit the engine's refusal for
completion-based rules with an interval. That limitation is worth stating in
the editor, and it is listed in the build steps.

### 6.3 Occurrences: lazy, keyed by original start, stored on write

- **Virtual until written.** The calendar and the day page expand the series
  (`calendarEntries`, `seriesDays`). Nothing is stored for an instance
  nobody touched, so a daily habit does not mint 365 nodes a year.
- **Materialize on first write.** Ticking done, skipping, moving, writing
  notes, adding attendees or opening "Notes" writes the `#occurrence` as a
  child of the series, with `on` = the instance's original start (screenshot
  `22`). This fits the Tana pattern of "an occurrence node with an Ext Ref",
  made lazy.
- **An occurrence may hold no fact.** An occurrence made for its notes has
  no done, skipped or moved fact, and today's reader treats a stateless
  occurrence as invalid. The prototype hit this: the series dropped off the
  day until the reader skipped stateless occurrences. `state` becomes
  optional, and an occurrence without one is an instance someone wrote to,
  still on its schedule. No new option is needed, because absence already
  says it.
- **Key by original start, not by day.** Today one fact is allowed per day
  (`duplicate_occurrence`). The key becomes (`on`, `on at`): the original day
  plus a new optional time field holding the instance's original local time,
  read as the series' `at` when absent. That pair is exactly Google's
  `originalStartTime`. A twice-a-day rule (`BYHOUR=8,20`) then has two
  addressable instances, and the Google mapping is one-to-one. Existing
  occurrences keep their meaning with no rewrite, because their absent
  `on at` reads as the series' time.
- **What an occurrence inherits.** It carries `#occurrence` **and the
  series' own tags minus repeat**, so a meeting's instance is a #meeting with
  Attendees, Transcript and Action items. The series stays the template:
  "Weekly 1:1" holds the default attendees, and each instance starts with
  them. The calendar treats a node that is an `#occurrence` as a fact of its
  parent and never as a second event. Decision D6.
- **Not every logged piece of work is a repeat.** About 371 of the owner's
  work-instance nodes are not routine-shaped: a dated record that work on a
  task was done. In kb those are **plain events** (a one-off `#event`, or the
  person's `#work-session` extending it) with a ref field `for` → the task.
  They need no series and no occurrence. A task's page lists its sessions
  through backlinks. Two shapes cover all of them: an occurrence is an
  instance of a *rule*, and a session is an event *about* something.

### 6.4 Google, both ways (addendum 1)

Today kb is the source of truth and Google is its outbound projection, onto a
calendar kb creates. The owner now wants to bring their *existing* Google
calendars in. The design keeps the two directions apart: **each calendar node
has one owner.**

| Calendar | Owner | Direction | Scope |
| --- | --- | --- | --- |
| a **kb calendar** (today's) | kb | push (unchanged) | `calendar.app.created` |
| a **subscribed Google calendar** (new) | Google | read-through, copy-on-write | `calendar.events.readonly` (or `calendar.events` if D9 opts into push-back) |

**Virtual events, and how they are addressed.** A subscribed calendar's
events live in a **sync cache**, never in `nodes.jsonl`. They are rows in the
family's operational store under `KB_DATA`, kept current with
`events.list` + `syncToken` (incremental; a 410 response means a full
resync). Recurring events are cached as series plus exceptions and expanded
by the same `seriesDays`. A virtual event's address is

```
gcal:<calendarId>/<eventId>              (a single event, or a whole series)
gcal:<calendarId>/<eventId>@<originalStartTime>   (one instance of a series)
```

which is stable across title and time changes. The day page and the calendar
draw virtual events beside stored ones (screenshot `04`: the mock feed).

**Can a query see them?** Yes. The index already holds *virtual nodes*
(saved queries). The cache enters the index the same way, as read-only
virtual nodes with `:node/virtual true`, their Google-owned fields as
datoms, and `:node/is` `#event`. A datalog query for "events this week" sees
them, and a write to one is refused with "annotate it first". They never
reach the store, so they cost no merge and nothing in git. Decision D8.

**Materialize = copy on write.** The first time a person annotates, tags,
links or adds a child to a virtual event (the "Annotate" button, a `[[ref]]`
to it, a tag), kb writes a real `#event` node. It is filed under the
subscribed calendar's node (a library like Tana's, not the day), and it
carries:

- **Google-owned, managed by events:** `title` is the node's text, kept
  current by sync but renameable by a person (D9 says what wins); `date`,
  `at`, `duration`, `timezone`, `rrule` (series only), `attendees`
  (resolved to `#person` by email where one matches, kept as text
  otherwise), `meeting link`, `event status`, `gcal event id`,
  `gcal calendar`, `gcal original start`, `gcal link` and `synced at`;
- **kb-owned:** its tags (the person's #meeting), its children (notes), the
  person's fields, its links. Google never sees these unless D9 opts in.

**Conflicts. Recommendation: per-field ownership, Google wins on its own
fields.** A materialized event's Google-owned fields are managed, so a
person's edit to them is refused with "change it in Google". The sync
overwrites them on the next delta. kb-owned fields are never touched by sync.
There is no merge, because no field has two writers. An opt-in per
subscribed calendar ("let kb change time and title", D9) flips the time and
title fields to kb-owned for that calendar, pushed with `If-Match` on the
event's etag. That is only possible with the wider `calendar.events` scope,
and only where Google says the person can edit the event.

**A series and its exceptions.** Annotating one instance materializes an
`#occurrence` under a materialized *series* node, which itself holds no
notes. That reuses the event → occurrence model exactly. Annotating the
series materializes only the series. A Google exception (a moved or
cancelled instance) is part of the cache. A materialized occurrence's
Google-owned `date`/`at` follow the exception.

**Deletions.**

- Deleted in Google: an unmaterialized event vanishes from the cache. A
  materialized one is **kept**, with `event status = cancelled` and a
  "deleted in Google" note, because the person's notes are theirs. A
  cancelled instance of a series is the same.
- Deleted in kb: deleting a materialized node deletes *the kb copy*, and the
  event becomes virtual again. Nothing is sent to Google for a subscribed
  calendar. kb calendars keep today's behaviour (the series ends at
  yesterday).
- Unsubscribing a calendar keeps every materialized node and drops the cache.

**Offline.** Day pages render from the cache, so no Google call is made on
render. The cache records its `syncToken` and last delta time, and a calendar
older than a day shows "as of <time>". The cache is per machine (KB_DATA),
like today's sync runner, which is hosted only on the shared server. Other
copies see materialized nodes through git and virtual events only where a
cache exists. Decision D8 covers serving the cache to other machines.

**Fit.** A Google series is a repeating event whose `rrule` Google writes. A
Google instance is an occurrence addressed by `originalStartTime`. The
owner's Tana "occurrence with an Ext Ref" is a materialized occurrence whose
ext ref is the address above. The events model needs no second shape for
Google.

**Owner's instinct, evaluated.** Copy-on-write is right. Storing every event
would put years of meetings nobody annotates into git, duplicate Google's
source of truth, and turn every Google edit into a merge. Pure read-through
would make annotating impossible. The one refinement is that *queries* see
virtual events too, through virtual index nodes, so "copy-on-write" covers
storage only, not visibility.

### 6.5 Migrating the routines data

Under "labels are cosmetic, ids are identity", the restructure is nearly
data-free. **No id changes, and no value moves.**

1. **Relabel, never re-id.** `sys.tag.routine` keeps its id, and its label
   becomes `event` through one retirement row `{from: "sys.tag.routine", to:
   "sys.tag.routine", text: "routine"}`. The seed rewrites the label only
   where it still reads `routine`, so a person who renamed it keeps their
   word. The family keeps its id `routines`, and its label becomes "Events".
   Every action id (`ext.routines.sync`), field id (`sys.f.routines.*`) and
   view key stays as it is, so no alias is needed (D10).
2. **Occurrences keep their meaning.** An existing `#occurrence` has `on` and
   a state. Its absent `on at` reads as the series' `at` (§6.3), so its key is
   unchanged.
3. **Google ids derive from node ids**, which do not change, so no pushed
   event is re-created.
4. **The person's extensions survive by construction.** Their `#meeting`
   extends `sys.tag.routine` by id, and their fields on it are ULIDs that no
   step touches.

The one step that needs the migration runner (§10) is cosmetic: the label
row. It can ship before the runner, as a plain retirement row, which the seed
already applies idempotently on open. The runner then only adds the preview
and the record.

### 6.6 The build-ready spec (for @thread:thr_w5rwxk7unc)

**The data model.** Ids are final. New ids are marked *new*.

| Node | Id | Kind / type | Notes |
| --- | --- | --- | --- |
| `#event` | `sys.tag.routine` | tag | label `event` (was `routine`); template unchanged, plus what the person adds |
| `#occurrence` | `sys.tag.occurrence` | tag | template gains `on at` |
| `#calendar` | `sys.tag.calendar` | tag | template gains `source` |
| repeat | `sys.f.routines.rrule` | text (RRULE) | label `repeat`; empty = a one-off event |
| starts, at, duration, timezone, until, repeats from | `sys.f.routines.{starts,at,duration,timezone,until,repeatsFrom}` | unchanged | — |
| on | `sys.f.routines.on` | date | the instance's original day |
| on at *(new)* | `sys.f.routines.onAt` | time, one | the instance's original local time; absent = the series' `at` |
| state | `sys.f.routines.state` | ref, one, **optional** | `done` · `skipped` · `moved`; absent = written to, no fact |
| moved to | `sys.f.routines.movedTo` | date | unchanged |
| source *(new)* | `sys.f.routines.source` | ref, one, closed | `sys.f.routines.source.kb` (default; push, today's behaviour) · `sys.f.routines.source.google` (subscribed, read-through) |
| attendees *(new)* | `sys.f.routines.attendees` | text, many | Google-owned on subscribed events: emails; a person's `#meeting` keeps its own `Attendees` ref field |
| meeting link *(new)* | `sys.f.routines.meetingLink` | url | Google-owned |
| event status *(new)* | `sys.f.routines.eventStatus` | ref, one, closed | `confirmed` · `tentative` · `cancelled`; Google-owned |
| gcal original start *(new)* | `sys.f.routines.originalStart` | text | Google's `originalStartTime` for an instance of a subscribed series |
| gcal etag *(new)* | `sys.f.routines.etag` | text, hide always | for D9's opt-in push-back only |
| gcal link, gcal status, gcal message, gcal event id, synced at | `sys.f.routines.{gcal,status,message,eventId,syncedAt}` | unchanged | **managed by** routines, hide when empty |

Every Google-owned field is `managed by` routines (core step C2), so the
commit admits it only through the family's sync actions. The sync cache is
not in this table, because it is not nodes: it is rows in the family's store
under `KB_DATA` (`events.list` + `syncToken` per subscribed calendar), and
the index exposes them as virtual `#event` nodes whose id is the address in
§6.4.

**Readers that change.** Each is one place:

- the engine's series scan and `calendarEntries` read `isA(node,
  sys.tag.routine)` (needs core C3, tag extension);
- `routineOccurrences` keys by (`on`, `on at` ?? `at`), accepts a missing
  state, and refuses only a second occurrence at the same key;
- the calendar and the day page treat a node that is an `#occurrence` as a
  fact of its parent, never as a second event;
- applying a series' tags to a new occurrence (D6) happens where an
  occurrence is materialized (one function, used by the calendar, the day
  page and the sync).

**PR order.** E1–E3 are restructure-then-add pairs in the Rule 1 sense.

| PR | Contents | Needs |
| --- | --- | --- |
| **E1** | Relabel (the retirement row, family label "Events", `repeat` label); the engine and calendar read `isA` | core C3 |
| **E2** | Occurrences: `on at`, optional state, several per day, one materialize function (with the series' tags, D6), "Notes" on a calendar instance | E1 |
| **E3** | Managed sync fields: `managed by` on the five sync facts | core C2 |
| **E4** | Google read-through: `source = google` calendars, the setup wizard's wider scope (`calendar.events.readonly`), the syncToken cache, virtual index nodes, the day page's events section drawing them, copy-on-write materialization, and the deletion rules of §6.4 | E2, E3, days A (the day page's section point) |
| **E5** *(optional, D9)* | Opt-in push-back of title and time per subscribed calendar, using `If-Match` etags and the `calendar.events` scope | E4 |

## 7. The editor's feel: what replaces "locked"

| Today | Proposed |
| --- | --- |
| A padlock on a `sys.*` page title | A quiet **"owned by Routines"** chip (puzzle glyph) beside the title. Its tooltip says what is open (add fields, children and extending tags) and what is the owner's (the name and what it ships). (Screenshot `13`.) |
| "System nodes (sys.*) are read-only" on any gesture | Additive gestures just work: add a child, add a field, add an option. A refused one gets one toast that names the owner and the open path: *"Owned by Routines. You can add to it — a field, a child, a tag that extends it — but not remove or reorder what Routines ships."* |
| No "Add field" on a seeded tag | "Add field" on every tag. Shipped fields are marked "shipped", and the person's have ✕ (screenshot `13b`). |
| A title you cannot edit | **An editable title.** The rename is the person's, and the chip still says who owns the node. The node menu also offers **"Make your own tag that extends this"**, which creates `#my <name>` extending it, for when a person wants their own *kind* rather than their own *word*. |
| Read-only field rows | Read-only only when managed, with "routines writes this" and the action to use. Everything else is a normal slot with constraints. |

"Proposal path" for a bundled or third-party plugin means extension first, and
then, for a repository extension the person owns, "open its seed". kb has no
upstream to file to from inside the app; the owner can say otherwise (D12).

## 8. The days plugin (addendum 2), built first

A new family, `days`. It is listed first among the build steps (§14) and
ships in two halves.

**Base tags.** It owns `#day`, `#week`, `#month`, `#year` (base, nearly
empty). `#day` carries one managed field, `day` (date), **the day node's
identity**. The person extends the base tags: in the prototype, `#my day`
adds "How do you feel?", Season and Day recap, and `#my week` carries Rituals
with a default of "Next week planning" on its template node (screenshot
`01`). A family setting, `day tag` / `week tag`, chooses which tag new nodes
get. Its default is the base, and the person points it at their extension.
The prototype picks the one tag that extends the base.

**Hierarchy, made lazily.** The structure is Daily notes › 2026 › Week 46 ›
Tue, Nov 10, and each node is made the first time it is visited or captured
into. Week nodes are a setting (`with weeks`, on by default). With weeks off
it is Daily notes › 2026 › November › day. Month nodes exist only as tags
until needed (Tana keeps months outside the main tree, too). Nothing is
pre-created.

**Identity is the only protection.** A day node is found by its managed `day`
value, never by its text or place. A person can rename "Tue, Nov 10", move it
anywhere, add children or tag it; it stays that day. The plugin alone writes
`day`, and the commit refuses a second node with the same `day` (a guard).
Moving a node out of a day is an ordinary move. In part A, `day` is hidden and
guarded for uniqueness only, because `managed by` (C2) does not exist yet.
That is a GAP marker against kb#148's managed-field gap, and part B closes
it.

**Open to today.** A setting, `open on` (`today` | `home` | `last place`),
defaults to `today`. Add a `t t` / ⌘⇧D "Go to today" binding and a sidebar
**Today** row (prototype: open-to-today and the sidebar row; screenshot
`01`).

**The capture target role.** A node made with no chosen place needs a home.
That covers ⌘K → Add node, a picker's "create" row (a new #person while
filling Attendees), MCP or CLI `node.add` without a parent, an agent's
capture, and paste-to-workspace. Each surface asks one replaceable role,
**`kb.capture-target`** (a single-cell role, `replaceable: true`). Core's
default answers "the workspace top level", and days `replaces` it at
priority 50 with "today's day node, made if needed". A person's choice is the
role node's `sys.f.provider`, as for every role, and another plugin (an
inbox plugin, say) can offer itself the same way. The server surfaces ask the
same role, so `kb add "x"` lands in today too. The prototype stands in for it
with a module-level provider in `@kb/ui-sdk`. Capture landed under today in
screenshot `21`. Decision D11 covers the CLI behaviour.

**The day page.** It is `#day`'s default view (a tag view, so `#my day`
nodes open in it through extends). It shows the day node's own outline, its
title, fields and children, and then **sections that other plugins
contribute** to a declared list point, `ext.days.sections`. Each section is
`{order, title, Component}` and gets the day:

- events: that day's events and occurrences, virtual instances included, and
  subscribed Google events (screenshots `02`, `04`);
- core: **dated this day**, every node holding this day in a date field;
- core: **made or edited this day**, from `createdAt`/`updatedAt`, with
  schema and scaffolding left out;
- tasks, later: due today and done today.

Days never imports events; it declares a point that events fills (Rule 1:
dependency points one way, and the parity record's declared points make it
cheap). The prototype hard-wires the sections inside the routines half and
reaches the page through a `/day/<id>` route, because the server's view
catalog does not list the routines family's views (a pre-existing gap, noted
for build step 5).

**Date fields link to days.** A value in any date field references its day
node. That is a `refCarrier` the days family declares: a date value `D`
mentions the node whose `day` is `D`, joined at index build. So the day's
References and `kb backlinks <day>` list every task due and every event on
it, with no stored link. A date value's follow (a click on "Today") opens
that day, made lazily.

**Migration.** Existing nodes are never moved. Only new captures land in
today. A one-off "file these by created date" command is offered, never run
on its own.

**Shipping before tag extension.** Part A has the base tags and identity,
the lazy hierarchy, `ext.days.today`, open-to-today, the Today row and key,
the capture-target role, and a day page with "made or edited this day". It
needs none of §5, because day nodes are tagged `#day` directly. Until C3
lands, a person who wants their own day fields adds them to `#day` itself,
which C1 allows, or tags a day with their own tag. Part B, after C3, adds the
day/week tag settings (a day carries the person's `#my day`, which extends
`#day`), the date → day link, and "dated this day". The events section
arrives with E4. Existing day nodes need no migration: part B's setting
applies to new days, and `kb days retag` offers the old ones.

## 9. A cluster as a plugin

The owner's workspace map has 15 clusters, among them tasks and reminders,
recurrence and work logs, PARA planning, calendar and time, meetings, people,
sources, spaced repetition and places. A cluster is **a set of base tags,
fields, option sets, template nodes, views and a few reactions**, which is
exactly what a kb family declares. The design above is what makes such a
plugin pleasant rather than confining:

- Its base tags are extensible (§3), so a person's `#reminder` flavours
  extend the plugin's `#task`, each with its own defaults (§4.2).
- Mixins such as "past work instances" and "content tag" are multiple
  inheritance (§5).
- Cross-cluster references (a task's Project, a habit's Serves → goal) are
  ref fields whose `targetTag` includes subtypes.
- Status machines (Task Status with 7 states, PARA Status) are closed or open
  option sets with defaults.
- Automation (a "Scheduled" hand-off flag, an RRule generator) is replaced by
  derived state, not copied. An occurrence exists or it does not, and the
  calendar knows.

**Template packs as data, under lighter trust.** Most clusters need no code:
tags, fields, options, template nodes and maybe a saved query or two. Today a
family's seed comes from code, so even a code-free pack needs T3 code trust.
Proposal: a **data pack** is a repository or marketplace source with a
manifest and a `seed.jsonl` of nodes, and no module.

- It is admitted at a new **data** tier. The trust sheet shows a node diff
  (what it adds), and a person approves bytes that cannot execute.
- Its nodes are seeded under the pack's namespace (`sys.pack.<name>.*`, owned
  by the pack through `:node/owner`, so §3 protects them). Seed retirements
  and migrations (§10) are data too.
- It may use what a seed can express: tags, fields, options, template nodes,
  extends, views by key, saved queries and `managed by` none. It gets no
  actions, guards or reactions; a pack that needs one is a family.
- The seed is checked by the same `txIntegrityError` and the same value
  conformance as any write, so a malformed pack is refused as a unit.

This makes "turn my Tana clusters into kb plugins" mostly a data job, and
keeps code trust for the few clusters with behaviour (spaced repetition's
scheduler, events' sync).

## 10. Plugin data migrations (addendum 3)

Today a family has two mechanisms: the fold reconciles seeds on open
(fill-absent, adopt orphans) and the retirement table renames. Some families
also have a bespoke pass (`views.migrate`). There is no general way for a
plugin to migrate *its data*, meaning the values on a person's nodes.

**The shape.**

```ts
// manifest (digest-covered, so trust binds it)
data: {
  version: 3,
  migrations: [
    { to: 2, retires: [{ from: "sys.tag.routine", to: "sys.tag.routine", text: "routine" }] }, // data only
    { to: 3, step: "split-status" },                                                          // a named pure step
  ],
}
```

- **The version** lives on the family's node as `sys.f.extension.dataVersion`,
  managed by the family.
- **A step is pure and deterministic**: `(graph snapshot) → Tx`. It mints ids
  deterministically from what it reads (`sys.*` ids from its namespace, and
  ULIDs derived from source ids where it must create nodes), and it is
  **idempotent**: run twice, the second run is empty. It can be data
  (retirement rows, the default) or a named function in the family's module
  that runs in the sandbox's pure tier, with no store, clock or network.
- **Renames are aliases first.** A retirement row rewrites ids, but where a
  consumer can read through an alias (action ids, view keys, a family name)
  the alias is preferred and the rewrite is deferred. Field renames are label
  rows (text only), and id changes happen only when two concepts are merged.

**When it runs.** On update, before the new code is enabled. The **update's
trust sheet** shows the code diff, as today, and the **data diff**: the dry
run of every pending step over the current store, summarized ("moves 214
values from starts to date; relabels #routine to #event; touches 0 of your
fields") with a full diff to expand. Approving the update approves both. A
declined update keeps the old code and data.

**How it applies.** As **one transaction** (`persistEffect`, with
`systemWrites: "system"`), so every surface sees before or after and never
between. The tx log already keeps the before-images, so **rollback** is a
generated inverse transaction offered for as long as nothing has written the
touched nodes since. After that, it is the ordinary undo of individual
writes. A step that fails aborts the transaction, and the old version keeps
running.

**The record is a node.** A `#migration` record lives under the family's
node, holding the version from and to, the step ids, the digest, the time and
the transaction rev. `kb backlinks` and the family's settings page list it.

**A person's extensions survive.** This is a rule checked by the
migration runner:

- a step may not delete or retarget a node whose id is a ULID, and may not
  remove a value of a field whose id is a ULID (the person's);
- a step may *rewrite* values of the plugin's own fields on the person's
  nodes, which is the point of migrating data;
- `sys.f.extends` refs **to** a retired tag follow its retirement row, so a
  person's `#meeting extends #routine` follows to `#event`;
- the person's fields on a plugin tag's template are kept by the union rule
  (§5.3).

The dry run states these numbers ("your fields touched: 0"), so a step that
breaks the rule shows red before anyone approves it.

**First case:** routines → events (§6.5) is one data step, the label row.
It needs no id changes and no value moves. The runner adds the preview and
the record, but the row works without the runner. The first migration that
truly needs a named step will be the first that changes what a value
*means*.

## 11. Values: inline or as nodes (side question)

Tana makes every field value a node: a reference, multi-valued by
construction. kb keeps primitives inline (`{t:"str"}`, `{t:"num"}`…) and refs
as refs, and props are already multi-valued.

**Recommendation: primitives inline plus refs, with "promote a value to a
node" on demand.** A value that needs a life of its own (an author named in a
text field, a tag-like keyword) is promoted. Its text becomes a node, the
value becomes a ref, and every other node holding the same text in that field
is offered the same promotion. Option sets are already nodes (children of the
field), so the case where Tana's model pays off (a value with its own page
and backlinks) is already covered where it matters.

Measured on a scratch store with the prototype's CLI. Each figure is one
`kb query` process including Bun startup, the median of 3, nice 15. The
store held 10k items with 10 values each, drawn from a 2,000-word vocabulary.
The query was "items holding v42":

| Store | `nodes.jsonl` | Wall time | Peak RSS |
| --- | --- | --- | --- |
| empty (seed only) | 154 KB | 0.65 s | 200 MB |
| 100k values **inline** (10.5k nodes) | 4.4 MB | 1.6 s | ~420 MB |
| 100k values **as nodes** (110.5k nodes, 100k refs) | 22 MB | 3.85 s | ~1.5 GB |

Over the empty baseline, values held as nodes cost about 3.4× the open and
query time and 6× the memory of inline values, and five times the bytes in
git. They also add ten times the merge surface, because every value is a line
that can conflict. Both returned the same 59 rows. The raw runs are in the
PR's thread storage.

## 12. Interactions with other threads

- **Calendar views and wizard** (@thread:thr_w5rwxk7unc). Two parts touch
  that thread's files and should land after it, or be coordinated with it:
  the calendar switching to `isA(#event)` (one line in `calendar.ts`, and
  the engine's scan), and the events rename (labels, `ROUTINE_TAGS.routine`
  readers). The prototype changed nothing in the calendar's views or wizard.
  The day page's events section reuses `calendarEntries` and adds no layout.
  Google read-through adds a calendar kind ("subscribed") to the wizard's
  calendar picker, which is that thread's surface.
- **Backdrop and breadcrumbs** (@thread:thr_ubdaysqiqp). The owned-by chip
  sits in the zoomed header beside `PageBackdrop`, and the day hierarchy
  makes deep breadcrumbs common (Home › Daily notes › 2026 › Week 46 › day).
  The prototype edits `zoomed-root-header.tsx` only to swap the padlock.
  Production should take that thread's header layout as given, and that
  thread may want a "collapse the journal path" rule for day pages.

## 13. The prototype trial

Branch `proto/data-plane-trial` (not for merge) runs kb's real UI on a
scratch store (`KB_DATA`/`KB_HOME` under `/tmp/kbtrial`) with demo data from a
seed script. Everything below is real code in the real editor unless marked
**MOCK**.

| Shows | How | Screens |
| --- | --- | --- |
| Field options panel | The field's page draws `hide field`, `required` and `auto-initialize` as ordinary rows. | `12` |
| Hide when empty and when default | A #task hides Status = Backlog (its default) and empty Notes; a meeting hides Event status = Confirmed and empty Transcript. | `10`, `15`, `16` |
| Per-tag defaults through a chain | #to buy → #reminder → #task, with template nodes and nearest-wins resolution. | `16` |
| Defaults and auto-init on tag apply | ⌘K → Add tag → "to buy" wrote Status, Due (today) and Reminder type in one write. | `24` |
| Required | An amber "required" beside the empty Owner field; nothing refused. | `10`, `24` |
| A user tag extending the system #event, plus a field added to #event | #meeting extends #event; Location was added to the system #event; inherited fields show "from #event"; #event shows "owned by Routines — you can add", "shipped" fields and the person's removable Location. | `13`, `13b`, `14`, `15` |
| Events, repeating events, occurrences in the calendar | #meeting and #habit instances on the week, and a stored done occurrence. | `03` |
| Day page | Open-to-today made Daily notes › 2026 › Week 46 › day lazily, tagged with the person's `#my day`, with the day's events (virtual instances marked), dated-this-day and made-this-day lists, and the day's own outline. | `01`, `02`, `04` |
| Capture into today | ⌘K → Add node landed under today's day node. | `21` |
| Occurrence materialized on write | "Notes" on a virtual instance made the `#occurrence` under the series. | `22` |
| Google read-through and copy-on-write | **MOCK feed** (`mock-google-feed.ts`); "Annotate" made a real `#event` with managed sync facts under the subscribed calendar node, and the real engine then marked it pending. | `04`, `23` |
| Plugin field, constrained | `25:99` typed into a routine's `at`: refused by the commit's form check; the slot keeps it marked. | `30` |
| Plugin field, protected | `gcal event id` and `gcal status` read "routines writes this"; a typed edit is refused by the page guard with the owner and the action. | `23`, `31` |
| Seeded identity, protected | Over the API: renaming #event, or removing its shipped rrule field, is `forbidden`; adding a field is accepted. | (log in the PR thread) |

**Corners cut, honestly:**

- The managed-field guard is the page's, not the commit's. Over the API, a
  person's write to `gcal status` is still accepted, and so is a task node
  written as an option. Both are build step 2.
- Defaults and auto-init run in the page's `planAddTag`, not the commit.
- The days tags and the day page live inside the routines family, reached by
  a `/day/<id>` route rather than `#day`'s tag view. The server's view
  catalog omits the routines views; that is the pre-existing gap noted above.
- The capture target is a module-level provider, not the role.
- `:node/is` is not a datom yet; `isA` is a function the calendar and the
  page call.
- No `closed` option sets, no "Make your own tag that extends this" menu
  entry, and no "+ Field" list of hidden fields.
- The Google feed is a fixed mock. No cache, syncToken or Google call exists.
- A 3-day completion-based habit is refused by today's engine. The demo uses
  an every-3-days schedule instead.

## 14. Build steps, in order, each a reviewable PR

Days goes first, as the owner asked. Its base needs nothing from core, and it
gains the person's day fields once C3 lands. The ids are as in §6.6 and §8.

| # | PR | Builds | Needs |
| --- | --- | --- | --- |
| **A** | **Days, base.** A new family `days`: `#day`/`#week`/`#month`/`#year`, the hidden identity field `day` with a unique-day commit guard, the lazy hierarchy, the `ext.days.today` action (shared by the page, CLI and MCP), open-to-today, the "Go to today" key and Today row, the `kb.capture-target` role (core's default plus days' replacement), and the day page as `#day`'s view with the `ext.days.sections` point and the "made or edited this day" section | — |
| C1 | **One ownership rule.** `systemWriteRefusal` keeps seeded ids and order, admits the person's ids in `sys.f.fields`, `sys.f.extends` and children, and admits text (labels). The padlock becomes the owner chip, and the toasts name the owner. Closes the additive and label gaps of kb#148 | — |
| C2 | **Constrained values in the commit.** `sys.f.managedBy` and its guard reading `via`; the ref target constraint enforced at commit; `sys.f.closed` | — |
| C3 | **Tag extension.** `sys.f.extends`, `tagAncestors`/`kindsOf`/`isA`, the `:node/is` derived datom, inherited templates and views, `targetTag` subtypes, the template-union seed pass, and "Make your own tag that extends this" | C1 |
| **B** | **Days, the person's fields.** The `day tag`/`week tag` settings, so a day carries the person's `#my day`; the date → day ref carrier and the "dated this day" section; `day` moves to `managed by days` | A, C2, C3 |
| C4 | **Field options.** `sys.f.hidden` retires into `sys.f.hide`; `required` and `auto-initialize`; the "+ Field" menu; `missing-required` | — |
| C5 | **Template nodes and defaults.** `sys.f.templateOf`, nearest-wins `defaultValuesOf`, materialized by a core interceptor on "type added", and template content | C3 |
| E1–E5 | **Events**, built by @thread:thr_w5rwxk7unc (§6.6) | C2, C3, A |
| C6 | **Plugin data migrations.** Manifest `data`, the runner and its survival rule, the dry-run diff on the trust sheet, inverse-transaction rollback, and `#migration` nodes | — |
| C7 | **Saved queries by id.** The builder writes ref atoms, and a check guards stored queries (§3.3) | — |
| C8 | **Data packs.** The data trust tier and `seed.jsonl` packs | C6 |

C1–C8 are core steps. Each is independent of days A, and none is assigned
yet.

## 15. Decisions: defaults taken, owner may veto

Each decision lists its options, the **default taken** (in bold, which the
build follows), and the tradeoff a veto would weigh.

| # | Decision | Default taken | Alternatives | Tradeoff |
| --- | --- | --- | --- | --- |
| D1 | How free are seeded nodes? | **Additive edits and renames allowed; deleting, removing or reordering what ships refused** | sealed (Capacities); everything open, with the seed re-healing | Gives Tana's feel. Ids keep the plugin's code honest. Re-healing would fight the person. |
| D2 | Where do defaults live? | **On the tag's template node, nearest wins** | on the field; a node per (tag, field) | Matches Tana and per-flavour defaults, and reuses node editing. It can grow into per-pair overrides later. |
| D3 | Is `required` advisory? | **Advisory: a marker plus a query** | refuse the commit | Refusing breaks `node.add` then `set`, and agents. Tana and Logseq are advisory. |
| D4 | Multiple inheritance? | **Yes, linearized breadth first** | single parent | The owner's mixins need it. A diamond's order follows the declared parents, which the tag page must show. |
| D5 | May a child tag remove an inherited field? | **Hide yes, remove no** | allow remove | Removing would make "is a #event" a lie. |
| D6 | What does an occurrence carry? | **`#occurrence` plus the series' tags** | only `#occurrence` | Instances get a meeting's fields. Counts must say series or instances. |
| D7 | One shared date field? | **No. Every date-typed field counts for days** | core `sys.f.date`, with `starts` retired into it | No data moves. Cross-family "when" queries name each field. |
| D8 | Google read-through storage | **A syncToken cache under KB_DATA, virtual index nodes, nodes only on annotate** | store everything; read-through and invisible to queries | Git stays clean and queries stay complete. Virtual events exist only where a cache does. |
| D9 | Conflicts on materialized Google events | **Per-field ownership: Google wins its fields, no push-back** | opt-in push-back with etags (E5) | No merges, and a read-only scope. Push-back needs the sensitive `calendar.events` scope. |
| D10 | Rename the family? | **No: relabel only (`routines` stays the id, "Events" the label)** | re-id to `events` with an alias | Follows "ids are identity". No alias machinery and no churn in the calendar thread's code. |
| D11 | Unplaced captures from the CLI and MCP | **The same capture-target role as the page (today, when days is on)** | always the top level | One rule everywhere. Scripts can pass `--parent`. |
| D12 | A proposal path beyond extending and renaming? | **None in-app. Extend or rename, and edit the seed for a repository extension you own** | an in-app "suggest upstream" | A suggestion sends content outside and needs an upstream to exist. |
| D13 | Data packs under a lighter trust tier? | **Yes: a data tier, no module, approved on a node diff** | code trust like families | Tana clusters become cheap to share, and a pack cannot run code. |
| D14 | Plugin data migrations | **Declared, pure, idempotent, previewed, one transaction, rollback, a record node** | ad-hoc per family | More machinery up front, but it is the only way a person sees a data change first. |
| D15 | Values as nodes? | **Inline primitives plus refs, with promotion on demand** | every value a node | Measured at about 3.4× the time and 6× the memory (§11). Options are already nodes. |
| D16 | Week nodes by default? | **On** | off (a flatter journal) | The owner's Tana has weekly rituals. |
| D17 | Saved queries | **Stored by id. The builder writes refs, and a check guards stored queries** | allow text matches | Renames stay safe. A typed query may still search text. |
