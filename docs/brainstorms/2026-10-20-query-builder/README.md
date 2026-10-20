# Query builder — a projection of the query's EDN

**Status: design for the owner's review, not built.** Date: 2026-10-20.
Revised the same day after two rounds of independent review
(GPT-6.1-Sol); what changed and why is under [Review](#review).
Mockup: published beside this record (T3 `html_render`); the same page is
`mockup.html` in this directory.

A query node is a node with `sys.f.query`, whose value is an EDN datalog
string (`@kb/model` `query-node.ts`). Today a person cannot write that
string in the editor: the field is hidden (`SCHEMA_SURFACE_FIELDS`,
`field-visibility.ts`), the debug view shows it read-only, and the only EDN
editor is the ontology page's. "Turn into query" mints
`[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]`, which
matches every node, and nothing in the editor changes it
(audit: [`docs/research/2026-10-20-editor-audit.md`](../../research/2026-10-20-editor-audit.md),
row 1; GAP [[01M5CRYKQAHJNG5SSRVSYE77GN]]). This design gives the editor a way to write a query without
writing datalog, without adding a second query language.

## Decisions this design rests on

1. **EDN in `sys.f.query` stays the one source of truth.** The builder has
   no storage of its own: no condition nodes, no JSON beside the EDN. What
   it shows is computed from the EDN on every render, and what it writes is
   EDN. A query written by an agent, by `kb set`, or by hand in the
   advanced editor is shown by the builder exactly as one the builder
   wrote. (DESIGN-REFINE.md: "the builder is UI sugar over props".)
2. **The builder is a projection through the IR.** EDN → `parseEdn` → IR
   (`@kb/query` `ir/ir.ts`) → _lift_ → conditions; and back, conditions →
   _lower_ → IR → **`printEdn`** (new) → EDN. The IR is the one model both
   directions pass through, so the builder never parses or prints EDN
   itself.
3. **One condition vocabulary, owned by `@kb/query`.** The vocabulary —
   which IR shapes are which condition — is a pure module beside the IR
   (`ir/conditions.ts`), not UI code. The page's builder, an agent and a
   test read the same lift and lower.
4. **No normalisation churn.** Opening, reading or closing the builder
   never writes. Only a change a person makes to a condition writes, and
   then the whole query is printed canonically. A hand-written query keeps
   its text, byte for byte, until someone edits it in the builder.

## What a person can say (the vocabulary)

The subject of every condition is the result node, `?n`. Conditions at
the top level are ANDed. A group is AND, OR, or NOT (none of).

| Condition                     | Builder row (example)                 | IR                                        | EDN printed                                                                                                    |
| ----------------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Has tag                       | **has tag** `#todo`                   | pattern + pattern                         | `[?n :f/sys.f.type ?t1] [?t1 :node/id "<tag>"]`                                                                |
| Lacks tag                     | **does not have tag** `#todo`         | not( has tag )                            | `(not-join [?n] [?n :f/sys.f.type ?t1] [?t1 :node/id "<tag>"])`                                                |
| Field is set                  | **status** `is set`                   | pattern, `_` value                        | `[?n :f/<field> _]`                                                                                            |
| Field is not set              | **status** `is not set`               | not( is set )                             | `(not-join [?n] [?n :f/<field> _])`                                                                            |
| Field is (ref/option)         | **status** `is` `Doing`, `Review`     | pattern + id pattern; several values → or | `[?n :f/<field> ?v1] [?v1 :node/id "<opt>"]`                                                                   |
| Field is (text/number/bool)   | **estimate** `is` `3`                 | pattern, literal value                    | `[?n :f/<field> 3]`                                                                                            |
| Field is not                  | **status** `is not` `Done`            | not( is )                                 | `(not-join [?n] [?n :f/<field> ?v1] [?v1 :node/id "<opt>"])`                                                   |
| Field contains (text)         | **title** `contains` `draft`          | pattern + predicate                       | `[?n :f/<field> ?v1] [(kb/includes-ci? ?v1 "draft")]`                                                          |
| Field compares (number, date) | **due** `before` `2026-11-01`         | pattern + predicate                       | `[?n :f/<field> ?v1] [(< ?v1 "2026-11-01")]`                                                                   |
| Text contains                 | **text** `contains` `retro`           | pattern + predicate                       | `[?n :node/text ?x1] [(kb/includes-ci? ?x1 "retro")]`                                                          |
| Created / edited              | **created** `in the last` `7 days`    | pattern + 2 kb fns + 2 predicates         | `[?n :node/created-at ?c1] [(kb/instant-days-ago 7) ?s1] [(kb/instant-now) ?s2] [(<= ?s1 ?c1)] [(<= ?c1 ?s2)]` |
| Date field relative           | **due** `within the next` `14 days`   | pattern + 2 kb fns + 2 predicates         | `[?n :f/<field> ?v1] [(kb/today) ?s1] [(kb/date-in-days 14) ?s2] [(<= ?s1 ?v1)] [(<= ?v1 ?s2)]`                |
| Under (descendant of)         | **is under** `Projects`               | pattern + reach                           | `[?a1 :node/id "<node>"] (reach ?a1 :node/child ?n)`                                                           |
| Above (ancestor of)           | **is above** `Retro notes`            | pattern + reach                           | `[?a1 :node/id "<node>"] (reach ?n :node/child ?a1)`                                                           |
| Child of                      | **is a child of** `Inbox`             | pattern + children                        | `[?a1 :node/id "<node>"] [?a1 :node/child ?n]`                                                                 |
| Has children                  | **has children**                      | pattern, `_` value                        | `[?n :node/child _]`                                                                                           |
| Links to                      | **links to** `Alice`                  | pattern + pattern                         | `[?a1 :node/id "<node>"] [?n :node/mentions ?a1]`                                                              |
| Linked from                   | **is linked from** `Weekly`           | pattern + pattern                         | `[?a1 :node/id "<node>"] [?a1 :node/mentions ?n]`                                                              |
| Group                         | **any of** / **all of** / **none of** | or / and / not( or )                      | `(or-join [?n] (and …) (and …))`; all of is the rows inline; `(not-join [?n] (or-join [?n] (and …) (and …)))`  |

The query the builder writes is `[:find ?id :where [?n :node/id ?id] …]`:
`[?n :node/id ?id]` comes **first**, so `?n` is bound before any negation,
and the find is what `resultNodeIds` reads.

- **Scope is lowering's job, not the IR's.** Every `or` and `not` the
  builder writes is the `-join` form over `[?n]`, and each branch or
  negation gets its own variables. DataScript requires the branches of a
  plain `or` to share their free variables (a branch that walks `reach`
  binds `?a1`, one that matches a value binds `?v3`; verified: "All
  clauses in 'or' must use same set of free vars") and a `not` to find its
  variables bound. `lowerIr` therefore always sets `join` to `["n"]`, and
  allocates variables per branch. Verified on kb's index: the mockup's
  `or-join` with branch-local `?v3` and `?a1` answers as meant.
- **"None of" is the negation of "any of".** "None of A, B" means
  not (A or B), so it lowers to `(not-join [?n] (or-join [?n] A B))`.
  `(not A B)` would mean not (A and B), which keeps a node that matches
  only one of them (verified: on four nodes, `(not [?n :node/text "a"]
[?n :node/text "b"])` keeps all four).
- **"Is not" includes the absent.** `status is not Done` keeps a node with
  no status, and drops a node whose status values include Done among
  others (status is multi-valued; verified). Lacking a value is
  `is not set`.

- **Reach takes an edge.** "Is under" walks `:node/child`; the same row
  offers, behind a "via" chip, `:node/mentions` (Tana's "WITH REFS") or a
  ref field, since `reach` takes any node-valued attribute (DESIGN.md →
  Query layer). A depth limit is the `reach` bound (`within 2 levels`).
- **"Set" and "defined" are one thing here.** Tana distinguishes a field
  that is on the template but empty from one that is absent. kb has no
  empty values (a prop with no values is no prop), so `is set` and
  `is not set` are the whole story.
- **Dates are two kinds, compared within their kind.** A date field holds a
  civil date, `YYYY-MM-DD` in the person's calendar; `created` and `edited`
  are instants, ISO-8601 in UTC (`currentIso`). Both compare correctly as
  strings only within one canonical form, so each kind has its own kb
  functions: `kb/today` and `kb/date-in-days n` answer civil dates in the
  person's time zone, and `kb/instant-now` and `kb/instant-days-ago n`
  answer instants in UTC. A relative condition is a window, bounded on
  both ends: "within the next 14 days" is today through today + 14, so
  an overdue date is not in it, and "in the last 7 days" ends at now, so a
  future instant is not in it.
- **Case.** Text conditions are case-insensitive by default, as every
  comparable tool's are. DataScript has `clojure.string/includes?` but no
  `lower-case`, and a `(?i)` regex prefix is not portable to the browser's
  engine, so case-insensitivity is a kb function (below).

## What the IR gets

`ir.ts` today is a flat AND of `pattern`, `children`, `reach` and rule
calls over `var | str | num | bool` terms. `_`, predicates, `or` and `not`
make the whole query `raw` (`patternFromEdn`, `termFromEdn`,
`ruleFromEdn` in `parse.ts`; GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]). The
additions:

```ts
// ir.ts — additions
export type Term =
  | { t: "var"; name: string }
  | { t: "str"; value: string }
  | { t: "num"; value: number }
  | { t: "bool"; value: boolean }
  | { t: "blank" }; // `_`

/** `[(f arg…)]` or `[(f arg…) ?out]`: a call to one function of PREDICATES. */
export type PredicateClause = {
  kind: "predicate";
  fn: PredicateName; // closed set, below
  args: Term[];
  bind?: string; // `?out` for a function, absent for a test
};

/** `(or …)` / `(or-join [?v…] …)`: each branch a conjunction. */
export type OrClause = { kind: "or"; join?: string[]; branches: Clause[][] };

/** `(not …)` / `(not-join [?v…] …)`: none of its clauses holds. */
export type NotClause = { kind: "not"; join?: string[]; clauses: Clause[] };

export type Clause =
  | PatternClause
  | ChildrenClause
  | ReachClause
  | RuleCallClause
  | PredicateClause
  | OrClause
  | NotClause;
```

- **`PREDICATES` is a closed set**, so the IR stays a kb-owned language and
  not "any Clojure": `=`, `not=`, `<`, `<=`, `>`, `>=`,
  `clojure.string/includes?`, `clojure.string/starts-with?`,
  `clojure.string/ends-with?`, `missing?`, and the kb functions. A call to
  anything else is still `raw`. Each was run against the DataScript build kb
  ships (1.8.1) while writing this: comparisons on numbers and on ISO date
  strings, `includes?`, `or`, `not`, `missing?` and `not=` all evaluate;
  `clojure.string/lower-case` is "Unknown function".
- **kb functions** are the predicates DataScript lacks, namespaced `kb/`:
  `kb/includes-ci?` (case-insensitive substring), and the date functions
  above. They are written in EDN as ordinary calls, so the stored query
  reads as datalog. `compile` rewrites each `kb/<name>` call to a variable
  it binds as a function input (`:in $ … ?__kb_fn_<name>`; DataScript calls
  a function passed as an input, in predicate and in binding position;
  verified by the review), the way it already adds `%` and owns the
  `__kb_reach_<n>` rules. The namespaced name alone is unknown to
  DataScript; only the closed registry resolves it, so a stored query
  cannot name a host function kb did not register.
- **One clock sample per run.** The date functions read one instant, taken
  from Effect's `Clock` (`@kb/model` `currentIso`) when the run starts, so
  every condition in a query agrees on "now" and a test pins it. A query
  that uses them also goes stale with time, not only with writes: its
  subscription re-runs at the next local midnight (civil dates) or on a
  coarse timer (instants), beside re-running on graph activity as every
  query does.
- **`reach` inside `or`/`not` works**, because the query no longer goes raw
  for using them. That closes GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]] for the
  builder's shapes; a query with a construct still outside the set stays
  raw, as today.
- **Find positions do not change.** The builder writes `[:find ?id]`.

### First, a restructure: the parser and the IR's canonical domain

The printer below cannot be the inverse of `parseEdn` as `parseEdn` is
today; the review found, by experiment:

- a string escape reads wrong (`"\n"` parses as the letter `n`), and a
  number JavaScript prints with an exponent (`1e-7`, `1e+21`) makes the
  query `raw`;
- the find spec is inferred rather than kept, and some find variables are
  dropped;
- `children` and `:node/child-order` patterns collapse into one clause, so
  the written form is not recoverable;
- the existing property gives less than it seems: a query `compile` prints
  uses quoted attributes, so `parseEdn` of it is `raw`.

So, before any builder code and as its own behaviour-preserving change
(Rule 1: restructure, then add), `@kb/query` gets:

1. **A canonical IR domain.** `isCanonicalIr(ir)` states which `IrQuery`
   values are ones `parseEdn` can produce: the find spec kept as written,
   `children` in one surface form, `reach` in its storage form
   `(reach ?from :edge ?to [max])` (distinct from the
   `__kb_reach_<n>` rules `compile` generates), terms in the forms the
   reader reads. The properties range over that domain, and the generator
   produces only canonical values.
2. **A repaired reader.** EDN string escapes and every number form
   JavaScript prints.

### The printer

`printEdn(ir: IrQuery): string` in `ir/print.ts`, the inverse of
`parseEdn` on the canonical domain. It is canonical: one space between
forms, `:where` clauses one per line in IR order, strings escaped as EDN
does, numbers in a form the reader reads back exactly, `or`/`not` as lists
with their `-join` vector when set, `reach` in its storage form. `compile`
stays what it is (IR → the DataScript query value); the printer is for
storage and for showing a person the query, never for running it.

## How the round trip is guaranteed

Three properties, each a fast-check property in `@kb/query`'s tests,
extending the generator that `ir.test.ts` already has (`irArb`) with the new
clauses, `_`, and the kb functions:

1. **Print then parse is the identity on the IR.**
   For every generated canonical `ir`: `parseEdn(printEdn(ir))` deep-equals
   `ir`.
   This is what makes the IR, not the text, the model.
2. **Parse then print is stable.**
   For every EDN text `e` whose parse is an `IrQuery`:
   `printEdn(parseEdn(printEdn(parseEdn(e))))` equals
   `printEdn(parseEdn(e))`. Run over generated text and over a corpus: every
   query in the seed, `.kb/queries/*.edn`, the repo's own `.kb/nodes.jsonl`,
   and every EDN literal in the test suites.
3. **Printing keeps the answer.** For every generated `ir` over a generated
   store: the rows of `compile(parseEdn(printEdn(ir)))` equal the rows of
   `compile(ir)`. Today's property (`ir.test.ts:200-233`) compares rows for
   `compile(parseEdn(compile(ir)))`; this makes the same check go through
   the printer.

And three for the builder's own layer, in `ir/conditions.ts`'s tests:

4. **Lower then lift is the identity on canonical conditions.** Two
   condition trees can mean the same and lower to the same IR (two
   top-level rows and an "all of" group holding them; "status is Doing,
   Review" and an "any of" group of two "status is" rows), so lift cannot
   tell them apart. Conditions therefore have a canonical form too
   (`canonicalConditions`): an "all of" group is flattened into its parent
   (top level, or a branch of "any of" / "none of"), so "all of" exists
   only as a branch; an "any of" whose branches are all "is" on one field
   becomes one multi-value row; a group with one child is that child; an
   empty group is dropped and never lowered (DataScript rejects an empty
   `(or-join [?n])`). The UI keeps a person's tree as they build it and
   canonicalises on write. For every generated tree `b`, with
   `c = canonicalConditions(b)`: `lift(lowerIr(c))` deep-equals `c`, and so
   does `lift(parseEdn(printEdn(lowerIr(c))))`.
5. **Lift recognises up to renaming.** Lift matches by structure, not by
   variable name: renaming every variable of a lowered query consistently
   (alpha-renaming) lifts to the same conditions. A hand-written
   `[?task :f/sys.f.type ?tag] [?tag :node/id "todo"]` is "has tag #todo".
6. **Lift loses nothing.** `lift(ir)` is defined exactly when
   `lowerIr(lift(ir))` is alpha-equivalent to `ir`: there is a bijection
   between their variable bindings that respects scope (each `or-join` /
   `not-join` branch is its own scope, so a branch may reuse a name
   another branch uses) and maps every occurrence, in the find spec, the
   inputs and the join vectors included; and under it, the same clauses
   in the same order, duplicates kept, the same constants, the same
   sharing. Lift proposes a condition tree and accepts it only if that
   check passes.
   A query for which that does not hold does not lift; it is shown in the
   EDN tab only. This is what lets the builder rewrite a query a person or
   an agent wrote without changing what it asks.

Round trips cannot catch a vocabulary row that is consistently wrong (one
that lowers "none of" to the wrong Boolean would round-trip perfectly), so
beside the properties each row has **semantic examples**: a small graph,
the condition, and the nodes it must answer, run through `compile` on
kb's index.

A raw query is never printed: `parseEdn` returned `raw`, so there is no IR
to print, and the text is kept as written.

## Switching between the builder and the advanced editor

The query node's header has two tabs, **Conditions** and **EDN**. Both
read and write the same `sys.f.query`.

- **Conditions → EDN: always.** The EDN tab shows the stored text as it
  is. It is a plain monospace textarea, as the ontology page's query
  editor is (`ontology-page.tsx`, `QueryEditor`), and saving writes the
  text as typed. Syntax highlighting is not part of this design: kb has no
  code editor component, and adding one is its own decision.
- **EDN → Conditions: when the query lifts, whole.** On every change to
  the stored text (from either tab, or from anyone else's write) the page
  runs `parseEdn` then `lift`. Lifting is all-or-nothing (property 6):
  - lifts: the Conditions tab shows it;
  - does not lift — a clause outside the vocabulary, a find spec or input
    the builder does not write, a `raw` query, or a parse error: the
    Conditions tab says which (`get-else` is outside the vocabulary;
    `:with`; a parse error at line/column) and offers only the EDN tab.
    Nothing is rewritten.
- **Which tab opens.** The one last used for this node, kept in the
  screen state; for a new query node, Conditions. That needs "New query
  node" and "Turn into query" to mint the builder's canonical query,
  `[:find ?id :where [?n :node/id ?id]]` (every node, no conditions yet),
  instead of today's `[:find ?id ?text …]` (`app/ui/src/lib/query-node.ts`),
  whose extra find column would not lift (property 6). `resultNodeIds`
  reads the first column, so the results are the same.
- **A write from elsewhere while the builder is open** re-lifts, as a
  field shows a value that changed under it. There is no draft: every
  condition edit is a write, as every edit in kb is, and undo is the
  store's.

## Interaction

Mockup: published beside this record. The shape, in the outline:

- The query node's row shows its text and a result count chip
  (**"12 nodes"**). Expanding it shows the conditions panel above the
  results, as Tana puts its search expression above its results.
- **A condition row is a sentence of slots**: subject (field or
  attribute), operator, value(s). Each slot is a picker that reuses what the
  editor already has, so there is no second picker for anything:
  - the tag slot is the add-tag picker (`nodesOfKind` over tags, as
    `outline-steps.tsx` builds it);
  - the field slot is `FieldPicker` (`field-picker.tsx`), listing the
    fields of the tags already in the query first;
  - a ref or option value is the field's own value picker:
    `nodeCandidates` narrowed by `allowedRefIdsOf` / `declaresOptionSet`,
    so an option field offers its options and a ref field its target
    query's nodes;
  - a node slot ("is under", "links to") is `nodeCandidates` unfiltered;
  - a text, number or date value is the `ValueSlot` editor for that value
    kind, with its grammar (DESIGN-UI.md → slot grammar), so `today`, `+7d`
    and ISO dates parse as they do in a field.
- **The operator adapts to the field's type** (Notion, Linear): a text
  field offers is / is not / contains / is set / is not set; a number or
  date adds before/after/between; an option or ref field offers is (any
  of) / is not (none of) / is set / is not set; picking two values in
  `is` turns it into "is any of" (an `or` of branches) without a group.
- **Groups** are an "Add group" row: any of / all of / none of. Nesting is
  unbounded in the model; the UI indents. A NOT group is "none of"; a
  single negated condition is an operator ("is not", "does not have tag"),
  not a group.
- **Live count.** Each change recomputes the count, debounced ~150 ms;
  while the EDN tab holds unparsable text the count shows the last good
  one, dimmed. The count is the number of distinct result nodes. A run
  that overruns its budget shows "took too long to count", never a
  number it did not establish: a slow query is not a large one (the
  review's `reach` over a 201-node chain, followed by a condition nothing
  met, answered zero rows after 11.8 s).
- **Execution is a prerequisite, and it is not the builder's.** Every
  condition edit writes, and every write re-runs the query's results as
  well as its count: on the page, the results hook runs the new EDN
  synchronously while rendering (`use-query-node-rows.ts`) when the socket
  is down, and the server runs its results subscription synchronously
  when it is up. DataScript materialises every row before anything can
  cap it (the review measured ~3.1 s for `reach` over a 201-node chain).
  So a budget on the count alone would not keep the page responsive. The
  builder needs **one budgeted execution mechanism, shared by results and
  count**, on the page and on the server. Where the page's replica runs
  is that mechanism's decision: moving the one `KbIndex` behind
  `GraphSource.index()` into a worker changes its synchronous contract
  for every reader; a second index in a worker would be a copy kept in
  step by hand (a mirror, Rule 1). That choice is open question 7, and
  the builder waits for it. Once there is a worker, the date functions'
  closures are built inside it over the run's one clock sample, not sent
  through `postMessage`.
- **Results render where they render today**: as the query node's results
  (`QueryResultsSection`, `outline-ui/src/query-results.tsx`), in the
  node's views (list, table, board…), with no new result surface. "No
  results" says which condition removed the last node when it can (the
  count with that condition dropped is non-zero), at most one such run per
  top-level condition, each under the same budget, and only once the
  query's own count is zero.
- **Keyboard.** `Tab`/`Shift-Tab` move between slots, `Enter` opens a slot's
  picker, `⌫` on an empty row removes it, `⌘↵` adds a condition below.
  Every slot is a button with an accessible name ("field: status").

## Prior art

|                       | Tana                                                                                                                                              | Notion                                                                | Linear                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Where the query lives | A search node; expression + results under it                                                                                                      | A database view's filter                                              | A view's filter; URL holds a temporary one                                                                                |
| Conditions            | Supertag, field = value, HAS FIELD, LINKS TO, CHILD OF, OWNED BY, text, regex, CREATED/EDITED LAST n DAYS, relative dates; `>AND >OR >NOT` groups | Per-property operators by type; advanced AND/OR groups, 3 levels deep | `is` / `is not` → `is either of` by count; `includes any/all/neither`; before/after; nested AND/OR                        |
| Text form             | The expression _is_ the query; a linter shows it as code                                                                                          | None for people (API JSON)                                            | None                                                                                                                      |
| Results               | Children/references of the search node; capped at 2,500                                                                                           | The database's rows                                                   | The view's issues                                                                                                         |
| Copy                  | Query on a node; results as references; edge choice (WITH REFS); set vs defined; new nodes in results take the query's tag                        | Operators by type; promote a single filter to a group                 | Chip operator adapts to value count; filter separate from display; a temporary filter that does not change the saved view |
| Avoid                 | Keyword zoo; hidden typed operators; silent result cap                                                                                            | Nesting limit; separate personal and shared filter stores             | Emptiness only by flipping an operator; fixed groupable properties                                                        |

Where kb differs from all three: the query is text a person, an agent or a
script can write, and the builder is a view of it, so nothing a person
builds is locked into a UI-only format.

## What this does not decide

- **The view filter is a second filter language.** A view node's
  `sys.f.view.filter` (`views/src/frame.ts:34-100`, `{:field … :eq …}` or
  `{:text …}`, AND only, evaluated in JS by `frame-layout.ts`) narrows a
  query's results per view. Two languages for "which nodes" is a mirror
  (Rule 1). The builder above is the query's; the clean shape is one
  condition model with two placements (the query's `:where`, and a view's
  narrowing, ANDed onto it at compile). Recommended **before** the builder
  ships, as its own restructure (Rule 1: restructure, then add), keeping
  today's label and text matching and handling a frame whose query
  aggregates, where appending clauses to its `:where` is not enough.
- **Partial lift.** An "advanced clause" chip, keeping an unknown clause
  in place inside an otherwise lifted query, needs a preservation law over
  that clause's shared variables as well as its text. Until one is
  written, lifting is all-or-nothing (above).
- **New nodes in a query's results.** Tana gives a node created under a
  search its tag and field values. kb could derive the same from the
  conditions (each "has tag" and "field is" that is a single value), but
  that is a write rule, not a view, and belongs in its own design.

## Open questions for the owner

Each with the reviewer's position, which this revision adopts where it
says so.

1. Partial lift (advanced-clause chips) or all-or-nothing? **Reviewer:
   all-or-nothing until partial lift has a preservation contract. Adopted.**
2. Case-insensitive text by default via `kb/includes-ci?`, with a toggle for
   exact case, or exact by default? **Reviewer: case-insensitive by
   default, with an exact-case toggle.**
3. kb functions as `kb/`-namespaced calls bound by `compile` (proposed), or
   as rules over pre-lowercased datoms (a `:node/text-lc` attribute the
   index derives, no function inputs)? **Reviewer: namespaced calls
   compiled to function inputs, compilation kept pure, the clock supplied
   by one execution mechanism. Adopted (one clock sample per run).**
4. Should the view filter move onto this condition model now (one model,
   two placements), or after the builder ships? **Reviewer: before, as a
   separate restructure. Adopted as the recommendation.**
5. Relative dates: are day offsets enough, or does the vocabulary need
   "this week", "last month" (calendar-aligned)? **Reviewer: day offsets
   are enough at first, once civil dates vs instants, both bounds, time
   zone and refresh are explicit. Those are now stated above.**
6. Is a soft cap on counting (say, "10,000+") wanted? **Reviewer: a display
   cap is fine but does not bound the cost; an execution budget is the
   prerequisite. Adopted (Live count, Execution).**
7. **New, from the second review.** One budgeted query execution, shared by
   results and count: move the page's one replica index into a worker
   (and make its readers asynchronous), or keep it on the main thread and
   budget cooperatively (DataScript cannot be interrupted mid-query, so
   this bounds less)? The builder should not ship before this is decided,
   and the decision is bigger than the builder.

## Where it would land

| Change                                                     | Where                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Canonical IR domain, reader repairs (a restructure, first) | `packages/domain/query/src/ir/ir.ts`, `parse.ts`                                         |
| `blank` term, `predicate`/`or`/`not` clauses, `PREDICATES` | `packages/domain/query/src/ir/ir.ts`, `parse.ts`                                         |
| kb functions bound as inputs                               | `ir/compile.ts`, the clock from the determinism seam                                     |
| `printEdn`                                                 | `ir/print.ts` (new)                                                                      |
| `lift` / `lowerIr`, the vocabulary                         | `ir/conditions.ts` (new)                                                                 |
| Properties 1–6, semantic examples                          | `packages/domain/query/tests/ir.test.ts`, `conditions.test.ts` (new)                     |
| One budgeted execution for results and count               | open question 7; `GraphSource.index`, the server's results subscription                  |
| "Turn into query" mints the canonical query                | `packages/app/ui/src/lib/query-node.ts`                                                  |
| Conditions/EDN tabs, rows, count                           | `packages/extension/outline-ui/src/query-builder/` (new), mounted by `query-results.tsx` |
| `sys.f.query` editable                                     | the field-visibility root cause, GAP [[01M5CRYK42Y4G74JD62AD00BZS]]                      |

## Review

An independent review (GPT-6.1-Sol, 2026-10-20) checked this design
against the code and against DataScript 1.8.1. The first round found six
problems, all confirmed by experiment. Each is answered above:

| #   | Finding                                                                                        | Where it is answered                                                                   |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Print-then-parse identity cannot hold over today's IR: escapes, numbers, find specs, children  | [First, a restructure](#first-a-restructure-the-parser-and-the-irs-canonical-domain)   |
| 2   | No property said lift then lower keeps an existing query; the opaque chip broke variable links | property 6; all-or-nothing lift                                                        |
| 3   | "None of" lowered to `(not A B)`, which is not (A and B)                                       | the vocabulary: `(not-join [?n] (or-join [?n] …))`, and semantic examples              |
| 4   | Negation before `?n` is bound, and `or` branches with different variables, are rejected        | the vocabulary: `[?n :node/id ?id]` first, `-join` forms over `[?n]`; the mockup's EDN |
| 5   | Relative dates were one-sided, and mixed civil dates with instants                             | Dates are two kinds; one clock sample per run, and refresh with time                   |
| 6   | Debounce and a result cap do not bound the count's cost                                        | Live count; Execution is a prerequisite (round 2 closed it in part, below)             |

The reviewer also confirmed: one stored EDN value, the shared IR and a
pure vocabulary in `@kb/query` fit Rule 1; opening never writes; function
inputs work in both positions; ref negation and `missing?` behave as the
rows say; and the slot and picker reuse is sound. The static mockup says
nothing about keyboard or screen-reader behaviour; that is for the build.

A second round marked findings 1 to 5 closed and 6 partly closed, and
found four more, all confirmed:

| #   | Finding                                                                           | Where it is answered                                           |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 7   | A budget on the count leaves the results, which re-run on every write, unbounded  | Execution is a prerequisite; open question 7                   |
| 8   | "Turn into query" mints `[:find ?id ?text …]`, which the builder could never lift | Which tab opens: the canonical query is minted instead         |
| 9   | Property 4 cannot hold: different condition trees lower to the same IR            | property 4 over canonical conditions; empty groups are dropped |
| 10  | A timed-out count is not a large one                                              | Live count: "took too long to count"                           |

It also pinned property 6 down as a partial inverse with scoped
alpha-equivalence (now its wording), and confirmed that function inputs
fit "one clock sample per run" with `compile` kept pure.
