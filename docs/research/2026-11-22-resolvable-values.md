# Resolvable values: a node or a handler, wherever a setting or field takes one

Research and a design proposal for the owner, 2026-11-22. This is a record,
not a spec, and nothing in it is decided until the owner says so.

The owner corrected the placement design
([2026-11-17-node-placement.md](2026-11-17-node-placement.md)), whose
"goes into" setting lived on a tag:

> not necessarily for a tag. It should be an infrastructural thing: nodes or
> handlers can be used in places like configs and stuff, and that can be a
> config for the event extension for example.

**This document supersedes** where they conflict:

- the placement doc's §6.1 (`PlacementResolver`, `fill`, `PlacementPoint`),
  §6.3 (the `#placement` tag and its text id field), §6.6 (failure) and
  §11 (decisions);
- the supertag doc's
  ([2026-11-22-supertag-surface.md](2026-11-22-supertag-surface.md)) §4.2
  point name and return type, and §6.5's failure rule.

The rest of both docs stands. That includes the placement order (§6.4),
its script rules (§6.5) and its deterministic ids, and the supertag doc's
caller-scoped reads, per-call query answers and template semantics.

## 0. Verdict

1. **One value kind: a reference that may name a handler.** A ref field gains
   one setting, `resolvable` (`sys.f.resolvable`). A value of such a field is
   still a `{t:"ref"}` and still round-trips through JSONL, SQLite, the CLI,
   MCP and the page unchanged. What it points at decides what it means:
   - an ordinary node means "this node";
   - a **handler** means "work this out now".
2. **A handler is a node.** A resolver is a tag that extends `sys.resolver`,
   and its template fields are its arguments, as in the supertag doc.
   - A handler with no arguments is a ref to the resolver tag itself
     (`days.today`).
   - A handler with arguments is a node of that tag, whose field values are
     the arguments (`#day of`, with `field = starts`).
3. **One registry, one runtime.** Families contribute resolvers to one point,
   `value.resolvers`, keyed by the resolver tag's id. A resolver is pure and
   synchronous. It reads only what the caller may read, and answers values
   plus the nodes they need made (a missing day). It runs **inside the write
   that uses the value**, so there is one commit and one undo step.
   Resolution happens at use time and is never written back into the
   setting.
4. **Three consumers, one mechanism:**
   - **Extension settings.** The events family's "new events go into" holds
     `days.today`, and a new event lands under today's day, made in the same
     transaction if it is missing.
   - **Placement.** The store's capture target becomes core's own setting
     holding `days.today`, and the `ui.capture-target` role retires into it.
   - **Supertag templates.** A template's dynamic value is the same handler
     node, bound to the field it fills.
5. **Phase 1 delivers the owner's example end to end:** set the events
   family's setting to `days.today`, create an event, and it lands in
   today.

## 1. The value kind

### 1.1 Declared on the field, as a setting of every ref field

`resolvable` (`sys.f.resolvable`) is a checkbox. It sits on `sys.field`'s
template beside `targetTag`, `targetQuery` and `acyclic`, and it is read by
one reader, `isResolvable`, in `@kb/model`'s `field-type.ts`. It means:

- **a value may be a handler**, which whoever uses the value resolves at
  that moment;
- **the field's target constraint** (`targetTag`, `targetQuery`, its option
  children) **applies to the resolved value**, not to the handler. A
  "new events go into" field that targets nothing accepts any node;
- **the field's type stays `ref`.** No new field type and no new value kind
  (`{t:"ref"}` already exists), so nothing on the storage or wire side
  changes. The commit's existing check, "a ref names a node the graph
  stores", holds for a handler as for any node.

It is a flag on ref fields rather than a field type because the stored
value *is* a ref, and only its reading differs. A sixth type would need its
own editor, its own value kind and its own conformance row, all copies of
the ref field's. That is the parallel path Rule 1 forbids. This also
follows GAP `01M7KVYBVC5N8VJSBBJCYE74SE`: the behaviour lives on tags (the
resolver tags), not on a field type.

**Which fields are resolvable.** Configuration fields, which are recipes
used at some later moment: a family's "goes into" settings, core's capture
setting, and later a tag's "goes into". An instance's own fields (an
event's `starts`, a task's `project`) are not. Their values are plain facts,
and a handler there would be a live, recomputed field, which the supertag
doc rejected ("what is stored is a plain value"). A template fills those
fields through a binding instead (§3.3).

### 1.2 What a handler is, as data

```text
sys.resolver                                  (seeded tag; every resolver extends it)
#today        = sys.resolver.days.today       (days; no template fields; yields ref)
#day of       = sys.resolver.days.dayOf       (days; template: field → a date field; yields ref)
#top level    = sys.resolver.core.topLevel    (core; yields no value = the top level)
```

- **The resolver tag's id is the registry key.** That is the one bridge from
  data to code. There is no text field naming the resolver, as the
  placement doc's §6.3 had, because node ids are already identity. Labels
  stay the person's to rename.
- **A ref to a node that extends `sys.resolver` is always a handler.** A
  resolver tag is never meant as a static value, so this reading has no
  exceptions.
- **A handler with arguments** is a node tagged with the resolver tag,
  carrying argument values in its template fields. Its label comes from the
  tag's `title` template ("Day of [[field]]" → "Day of starts"), so no new
  naming rule is needed. It lives under the node whose setting first used
  it (D5), and any other resolvable field may reference it too, which
  `kb backlinks` lists.

In JSONL (abridged), the events family's setting holding each form:

```jsonl
{"id":"sys.f.routines.goesInto","text":"new events go into","props":{"sys.f.type":[{"t":"ref","v":"sys.field"}],"sys.f.fieldType":[{"t":"ref","v":"sys.ft.ref"}],"sys.f.cardinality":[{"t":"ref","v":"sys.cardinality.one"}],"sys.f.resolvable":[{"t":"bool","v":true}],"sys.f.configures":[{"t":"ref","v":"sys.extension.routines"}]}}
{"id":"sys.extension.routines","text":"Events","props":{"sys.f.routines.goesInto":[{"t":"ref","v":"sys.resolver.days.today"}]}}
{"id":"sys.extension.routines","text":"Events","props":{"sys.f.routines.goesInto":[{"t":"ref","v":"01INBOX…"}]}}
{"id":"sys.extension.routines","text":"Events","props":{"sys.f.routines.goesInto":[{"t":"ref","v":"01DAYOF…"}]},"children":["01DAYOF…"]}
{"id":"01DAYOF…","text":"","props":{"sys.f.type":[{"t":"ref","v":"sys.resolver.days.dayOf"}],"sys.f.resolver.field":[{"t":"ref","v":"sys.f.routines.starts"}]}}
```

From the CLI, with no new verb:

```bash
kb set sys.extension.routines "new events go into" sys.resolver.days.today
kb set sys.extension.routines "new events go into" <inbox-id>
```

## 2. Resolution

### 2.1 The contract (one point, shared with the supertag resolvers)

```ts
interface Resolver<A> {
  readonly id: NodeId;                              // the resolver tag's id
  readonly args: Schema.Schema<A>;                  // decoded from the handler's field values (none for an argless one)
  readonly yields: FieldType;                       // what its values are: "ref", "date", …; the picker offers it only where that fits
  readonly reads: ReadonlyArray<"clock" | "actor" | "nodes" | "query">;
  readonly asks?: (args: A) => readonly QueryRef[]; // the queries it needs answered ("query" only)
  readonly resolve: (ctx: ResolveContext, args: A) => Resolution;
}

type Resolution =
  | { readonly values: readonly PropValue[]; readonly upserts: readonly KbNode[] } // upserts: deterministic ids
  | { readonly unresolved: "failed"; readonly why: string };

interface ResolveContext {
  readonly clock: ClockSample;     // the caller's sample (§2.3)
  readonly actor: Actor;
  readonly subject?: { id: NodeId; parent: NodeId | undefined; props: Readonly<Record<NodeId, readonly PropValue[]>> }; // the node being made or tagged
  readonly nodes: ScopedReads;     // the graph this call is planned on, as the caller may read it
  readonly answers: QueryAnswers;  // evaluated over that scoped graph, per call
}
```

- **The point.** `value.resolvers` is a core point, keyed by `id`, in every
  kernel (registry, server, page). It replaces both `tag.resolvers` (the
  supertag doc) and `PlacementPoint` (the placement doc). A family declares
  its resolvers in its declaration (`defineExtension({…, resolvers})`), so
  the page and the server run the same code.
- **One result shape for every consumer.** `values` plus `upserts` is the
  placement doc's `PlacementPlan` and the supertag doc's `PropValue[]` made
  one. A placement takes one ref as its parent, or no values as the top
  level. A template field takes the values. `upserts` lets "today" make the
  day it answers, in the same write. Their ids are deterministic (the
  placement doc's §6.1 rule: `days.<key>`, then `~2`, `~3`), so the page,
  the server and a replan all name the same nodes.
- **Purity.** `resolve` is synchronous and deterministic in `ctx`, with no
  I/O. A shared `resolverContract` in `@kb/test-kit` runs over every
  contributed resolver and checks:
  - two calls over one frozen context agree, ids included;
  - its values conform to its declared type;
  - it leaves `ctx` untouched.

  Anything with I/O (AI, the network, a calendar API) is not a resolver.
  It is a command run after the write.
- **Caller-scoped reads** (supertag doc §4.2, unchanged). `ctx.nodes` is
  `readableNodes(invocation, staged)`. `ctx.answers` is evaluated over an
  index of that scoped graph, never filtered afterwards. Bare nodes must
  not carry timestamps (supertag doc §10).
- **Third-party resolvers** (supertag doc §4.3, unchanged). A resolver tag
  may name a `#script` instead of a declared implementation. It is evaluated
  in QuickJS as a pure function, with inputs serialized from the scoped
  view and no `kb.*` API. Trust works by digest.

### 2.2 When and where it runs

- **At use, inside the write that uses the value.** One function,
  `resolveValue(value, field, ctx)`, is called by the consumer's pure plan
  in the `plan` Effect handed to `persistPlannedEffect`:
  - `node.add`'s placement (`placeOf`);
  - a template's instantiation (`planNodeAdd` / `planNodeUpdate`).

  Its `upserts` join the same transaction. Guards, approval and the commit's
  checks see the whole write, and a conflicting commit replans and
  re-resolves. This is how `placeOf` already makes a missing day for a
  capture today (`operations/src/place.ts`, `days/src/capture.ts`).
- **Never cached into the config.** The setting keeps the handler.
  Settings readers (`decodeNodeConfig`, `settingsOf`) return the stored
  value, never a resolution. A day later, the same setting resolves to the
  next day.
- **Per call in a batch.** Each call resolves over the staged graph it sees,
  and the batch still ends in one conditional commit (supertag doc §6.6).
- **On the page.** The page plans first with the same resolvers, so the new
  event shows under today at once. The server's plan is the truth. A
  resolver that reads `query`, or that the page lacks, is pending locally
  and filled by the server's commit.

### 2.3 Whose clock

The placement doc split each resolver into `fill` (ambient → args) and
`plan`. That split is gone. The **clock sample travels with the call**: the
page attaches its own `ClockSample` (instant and zone) to the invocation,
as it already passes its day to `ext.days.today`. The server resolves with
that sample. Without one (the CLI, MCP), the sample is the process's clock
in the store's zone (days' `time zone` setting, else the process's). So
the page and the server plan the same day, and a capture just after the
person's midnight lands in the person's today (D4).

### 2.4 Failure, one rule

A value is either **stored** (read from a setting or a template) or
**explicit** (a call names it as `parent`).

| Case | Stored value | Explicit value |
| --- | --- | --- |
| its node is gone, or its resolver is not loaded (family off) | reads as **empty**, and the consumer moves on: placement falls through its order (placement doc §6.4), a template field stays empty | the call **fails** (`unresolvable`, naming the resolver and its family) |
| the resolver returns `unresolved`, throws or overruns its budget | the same: **empty**, and moves on | the call **fails** |
| a value that does not conform to the field (wrong type, outside its targets) | dropped, reads as empty | the call **fails** |

Every empty-because-unresolved case is reported in the receipt
(`unresolved: [{field, handler, reason}]`). The page shows one toast, and
`--json` lists it. A setting never blocks a write. A caller that named a
handler explicitly and did not get it is told so. This replaces the
placement doc's "a failing resolver fails the write" for stored values, and
the supertag doc's "leave empty" now holds for both kinds (D3).

## 3. Consumers

### 3.1 Extension settings: "new events go into" (the owner's example)

The events family (`routines`, label "Events", tag `sys.tag.routine`
labelled "event") seeds one setting on its node:

```text
Events (sys.extension.routines)
  new events go into:: ⚡ Today            (sys.f.routines.goesInto, resolvable ref, one)
```

How an event lands under today:

1. The person makes an event in the routines editor. Today `addRoutine`
   (`routines/src/calendar-edits.ts`) builds a `node.add` with
   `parent: null`.
2. It now passes the setting's **stored value** as `parent`:
   `parent: sys.resolver.days.today`. The family's reader returns the
   value, never a resolution. If the setting is empty, or holds a handler
   whose family is off, it passes `null` as before (the stored-value rule).
3. `node.add`'s plan calls `placeOf(parent, …)`, which sees a handler and
   calls `resolveValue`. `days.today` answers `{values: [ref days.2026-11-22],
   upserts: [year, week, day]}`, keeping only the upserts that are not
   already in the store.
4. One conditional commit writes the day (if it is new) and the event under
   it. One ⌘Z removes both. The receipt names the parent.
5. Tomorrow the same setting answers tomorrow.

The other forms work through the same path:

- **"Inbox"**: a plain ref resolves to itself.
- **`#day of {field: starts}`**: resolves over the node being made, so an
  event lands in the day it starts on. The event's `starts` is already in
  the add's props when the plan runs.

### 3.2 Placement: the capture target is a setting

Core gains one setting on its own node, **captures go into**
(`sys.f.core.capturesInto`, resolvable ref, one). It replaces both halves
of the `ui.capture-target` role, days' `captures` option field and the
role node:

```text
Core (sys.extension.core)
  captures go into:: ⚡ Today        (set by days' migration; clear it for the top level)
```

- `placeOf` reads it when a call omits `parent`, through the same
  `resolveValue`. Steps 4–6 of the placement doc's order become
  "the creator's fallback, then this setting, then the top level".
- The page's capture becomes `node.add` with no parent. The page half of
  the role, `asPlaced`, and the "make today, wait, then add" second write
  are deleted. That closes the two-undo-step capture (placement doc F2).
- Days' `captures: top level` migrates to an empty setting, and
  `captures: today` migrates to `⚡ Today`. It is a declared, previewed
  family migration.
- The placement doc's per-tag "goes into" is just another resolvable
  setting, on a tag node. Following the owner's correction it is not
  required, and it is deferred until a consumer asks (D6).

### 3.3 Supertag templates: the same handler, bound to a field

A template fills an instance's own fields, which are not resolvable
(§1.1). So a template binds a handler to a field instead of storing it
there. The handler node sits under the template node P and carries
`sys.f.init.field`, which is the supertag doc's initializer, now named as
what it is: a handler with a binding.

```text
Meeting template                        (P, the tag's sys.f.tag.template)
  status:: Planned                      static
  ├─ ⚡ Today            → date          node of #today, init.field = date
  ├─ ⚡ Day of starts    → day           node of #day of {field: starts}, init.field = day
  └─ Agenda                             content
```

- The handler node, its argument fields, its resolver, its result shape and
  its failure rule are exactly §1–2.
- The only difference is the binding: a setting holds a handler by ref
  (the slot is a ref), and a template binds it by `init.field`, because the
  slot may be a date or any other type. `yields` must fit the bound field's
  type, as the picker and the plan both check.

## 4. The UI (outliner only)

- **The one node picker gains a Handlers group** for a resolvable field,
  above the node results:
  - **Ready**: argless resolvers whose `yields` fits the field, for
    example "Today" or "Top level".
  - **With arguments…**: resolvers that take arguments, for example
    "Day of a date field…".
  - **Existing handlers**: handler nodes already in the store, which can be
    reused.

  A search query matches handlers by label as it matches nodes. Handlers
  whose family is off are not offered.
- **Picking a resolver with arguments** creates its handler node under the
  setting's holder, in the same write as the setting, so one ⌘Z undoes it.
  The value pill then expands **in place** to the handler's own field rows
  ("field: starts"), drawn and edited like any tagged node's fields, with
  the same pickers, constraints and keyboard. There is no handler-specific
  form.
- **The value pill** shows a ⚡ glyph and the handler's title ("⚡ Day of
  starts"), so a person sees "computed when used" at a glance. ⌘-click
  opens the handler node. A dangling handler (family off) shows struck
  through, with the reason, as a dangling ref already does.
- **A template's dynamic value** is offered from the same Handlers group in
  the Content template section's "Add dynamic value…" step (supertag doc
  WP‑3). The binding is written for the person.
- **CLI and MCP** need nothing new: a handler is a node, and `kb set` or
  `node.update` writes the ref. `kb get` shows the ref, and `kb backlinks
  sys.resolver.days.today` lists every setting that uses it.

## 5. Build plan

Each phase is one PR. Restructure commits come first and preserve
behaviour (Rule 1). Every PR runs the cheap chain, its focused tests and
the pre-commit hook. The wire fingerprint is recorded in any commit that
changes an action's input.

**P1. The owner's example, end to end.**

1. *Restructure (behaviour-preserving):* add the `value.resolvers` point
   and `Resolution`, and `resolveValue` in `@kb/model`. Days' `captureToday`
   becomes the `sys.resolver.days.today` contribution, and the registry
   half of `ui.capture-target` calls it through the point. `placeOf` asks
   `resolveValue` only when no parent is given.
   - *Tests:* the existing `place`, capture and days tests pass unchanged.
2. *Add:*
   - the `sys.resolver` tag, the `sys.f.resolvable` flag (seeded on
     `sys.field`'s template) and `#today`, with id
     `sys.resolver.days.today`;
   - `node.add`'s `parent` accepts a handler ref, resolved in `placeOf`;
   - the call carries the page's `ClockSample`;
   - the events family's `new events go into` setting;
   - `addRoutine` passes the stored value as `parent`;
   - the picker's Handlers group, "Ready" only;
   - `unresolved` on `node.add`'s receipt.
   - *Tests:*
     - `resolverContract` over `days.today`;
     - an action test: `node.add {parent: sys.resolver.days.today}` on a
       store with no today makes year, week, day and node in one
       transaction, and one undo removes all four;
     - the same through the CLI and MCP;
     - days off: the stored setting reads empty and the event goes to the
       top level, reported; an explicit `--parent` fails `unresolvable`;
     - a midnight-boundary test: the page's sample wins;
     - a component test of the picker group;
     - a browser check on a scratch store: set the setting, make an event
       in the routines editor, and see it under today.
   - *Acceptance:* the owner's example works from the page, and the same
     `node.add` gives the same result from the CLI and MCP.

**P2. The capture target retires.**

- `sys.f.core.capturesInto`, and days' migration of `captures`.
- Delete the page half of `ui.capture-target`, `asPlaced`, the second
  capture write and the role node.
- *Tests:* captures land as before; a first-of-day capture is one undo
  step; `capture-zones.scenario.test.ts` re-pinned.

**P3. Handlers with arguments.**

- `#day of`, `#parent`, `#ancestor with tag`, `#from ancestor` (`fill from`
  bridged, supertag doc §3.3) and `#relative date`.
- The picker's "With arguments…" and "Existing handlers" groups, and
  in-place argument rows.
- *Tests:* `resolverContract` over each; an event set to day-of `starts`
  lands in its day; the argument rows in a component test.

**P4. Templates use the same kind.** The supertag doc's WP‑2 and WP‑3
build on P1–P3: the template's `init.field` binding, and nothing new in the
runtime.

**P5. Query resolvers and sandboxed resolvers.** These are the supertag
doc's per-call scoped index and its WP‑5, unchanged.

Spec homes, written in the PR that builds each part:

- DESIGN.md gains **Resolvable values**, the canonical home for §1–2.
- Placement points to it.
- Provider roles loses `ui.capture-target` (in P2).
- DESIGN-UI.md → the one node picker gains the Handlers group.

## 6. Decisions for the owner

1. **One kind, "resolvable ref field + handler node", for settings,
   placement and templates?** Recommended: yes. It supersedes the placement
   doc's `#placement` / `PlacementCall` and its `fill`.
2. **An argless handler is a ref to the resolver tag itself.** Recommended:
   yes. The alternative, a handler node for every use, adds a node per
   setting for no information.
3. **Failure.** Recommended: a stored value that cannot resolve reads as
   empty and is reported; an explicit value fails the call. This replaces
   the placement doc's D3.
4. **The page's clock travels with the call**, so the person's today wins
   over the server's. Recommended: yes. It replaces the placement doc's
   `fill`.
5. **Where a handler with arguments lives.** Recommended: under the node
   whose setting first used it, reusable from anywhere by ref.
6. **Per-tag "goes into".** Recommended: defer it until a consumer asks.
   It is one more resolvable setting and needs no new mechanism.

## 7. Not verified

- Whether `ConfigSlots` and `settingsOf` need a change to show
  `resolvable` in Settings, or draw it already as a ref setting. They read
  the field node's type, so they probably need none.
- Whether the routines editor's `addRoutine` runs on the page replica as an
  isomorphic `node.add`. If it does, the event shows under today before the
  receipt, and if not, after it. Both are correct.
- The cost of passing a `ClockSample` on every call, and whether
  `asFilled` is the right carrier or a new envelope field is.
- `planToday`'s fallback ids (`freshId`, `MOST_MADE` in
  `days/src/today-plan.ts`) are minted, not derived. P1's `resolverContract`
  will fail on them until they move to the placement doc's derived
  `days.<key>~n` form, so that change is part of P1.
