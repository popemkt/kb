# Query builder — a projection of the query's EDN

**Status: design for the owner's review, not built.** Date: 2026-10-20.
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

| Condition                     | Builder row (example)                 | IR                                        | EDN printed                                                      |
| ----------------------------- | ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Has tag                       | **has tag** `#todo`                   | pattern + pattern                         | `[?n :f/sys.f.type ?t1] [?t1 :node/id "<tag>"]`                  |
| Lacks tag                     | **does not have tag** `#todo`         | not( has tag )                            | `(not [?n :f/sys.f.type ?t1] [?t1 :node/id "<tag>"])`            |
| Field is set                  | **status** `is set`                   | pattern, `_` value                        | `[?n :f/<field> _]`                                              |
| Field is not set              | **status** `is not set`               | not( is set )                             | `(not [?n :f/<field> _])`                                        |
| Field is (ref/option)         | **status** `is` `Doing`, `Review`     | pattern + id pattern; several values → or | `[?n :f/<field> ?v1] [?v1 :node/id "<opt>"]`                     |
| Field is (text/number/bool)   | **estimate** `is` `3`                 | pattern, literal value                    | `[?n :f/<field> 3]`                                              |
| Field is not                  | **status** `is not` `Done`            | not( is )                                 | `(not [?n :f/<field> ?v1] [?v1 :node/id "<opt>"])`               |
| Field contains (text)         | **title** `contains` `draft`          | pattern + predicate                       | `[?n :f/<field> ?v1] [(kb/includes-ci? ?v1 "draft")]`            |
| Field compares (number, date) | **due** `before` `2026-11-01`         | pattern + predicate                       | `[?n :f/<field> ?v1] [(< ?v1 "2026-11-01")]`                     |
| Text contains                 | **text** `contains` `retro`           | pattern + predicate                       | `[?n :node/text ?x1] [(kb/includes-ci? ?x1 "retro")]`            |
| Created / edited              | **created** `in the last` `7 days`    | pattern + kb fn + predicate               | `[?n :node/created-at ?c1] [(kb/days-ago 7) ?s1] [(>= ?c1 ?s1)]` |
| Date field relative           | **due** `within the next` `14 days`   | as above, `kb/days-from-now`              | `[?n :f/<field> ?v1] [(kb/days-from-now 14) ?s1] [(<= ?v1 ?s1)]` |
| Under (descendant of)         | **is under** `Projects`               | pattern + reach                           | `[?a1 :node/id "<node>"] (reach ?a1 :node/child ?n)`             |
| Above (ancestor of)           | **is above** `Retro notes`            | pattern + reach                           | `[?a1 :node/id "<node>"] (reach ?n :node/child ?a1)`             |
| Child of                      | **is a child of** `Inbox`             | pattern + children                        | `[?a1 :node/id "<node>"] [?a1 :node/child ?n]`                   |
| Has children                  | **has children**                      | pattern, `_` value                        | `[?n :node/child _]`                                             |
| Links to                      | **links to** `Alice`                  | pattern + pattern                         | `[?a1 :node/id "<node>"] [?n :node/mentions ?a1]`                |
| Linked from                   | **is linked from** `Weekly`           | pattern + pattern                         | `[?a1 :node/id "<node>"] [?a1 :node/mentions ?n]`                |
| Group                         | **any of** / **all of** / **none of** | or / and / not                            | `(or (and …) (and …))`, `(not …)`                                |

Every row ends in `[?n :node/id ?id]` once, and the find is
`[:find ?id …]`, which is what `resultNodeIds` reads.

- **Reach takes an edge.** "Is under" walks `:node/child`; the same row
  offers, behind a "via" chip, `:node/mentions` (Tana's "WITH REFS") or a
  ref field, since `reach` takes any node-valued attribute (DESIGN.md →
  Query layer). A depth limit is the `reach` bound (`within 2 levels`).
- **"Set" and "defined" are one thing here.** Tana distinguishes a field
  that is on the template but empty from one that is absent. kb has no
  empty values (a prop with no values is no prop), so `is set` and
  `is not set` are the whole story.
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
  `kb/includes-ci?` (case-insensitive substring), `kb/days-ago n` and
  `kb/days-from-now n` (an ISO date string relative to the clock). They are
  written in EDN as ordinary calls, so the stored query reads as datalog.
  `compile` binds each one the query uses as a function input
  (`:in $ … ?__kb_fn_<name>`, DataScript calls a function passed as an
  input; verified), the way it already adds `%` and owns the
  `__kb_reach_<n>` rules. The clock is Effect's `Clock` (`@kb/model`
  `currentIso`), so a test pins it and a relative-date query is reproducible.
- **`reach` inside `or`/`not` works**, because the query no longer goes raw
  for using them. That closes GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]] for the
  builder's shapes; a query with a construct still outside the set stays
  raw, as today.
- **Find positions do not change.** The builder writes `[:find ?id]`.

### The printer

`printEdn(ir: IrQuery): string` in `ir/print.ts`, the inverse of
`parseEdn` on the IR subset. It is canonical: one space between forms,
`:where` clauses one per line in IR order, strings escaped as EDN does,
numbers as JavaScript prints them, `or`/`not` as lists, `reach` in its rule
form. `compile` stays what it is (IR → the DataScript query value); the
printer is for storage and for showing a person the query, never for
running it.

## How the round trip is guaranteed

Three properties, each a fast-check property in `@kb/query`'s tests,
extending the generator that `ir.test.ts` already has (`irArb`) with the new
clauses, `_`, and the kb functions:

1. **Print then parse is the identity on the IR.**
   For every generated `ir`: `parseEdn(printEdn(ir))` deep-equals `ir`.
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

And two for the builder's own layer, in `ir/conditions.ts`'s tests:

4. **Lower then lift is the identity on conditions.** For every generated
   condition tree `b`: `lift(lowerIr(b))` deep-equals `b`, and so does
   `lift(parseEdn(printEdn(lowerIr(b))))`.
5. **Lift recognises up to renaming.** Lift matches by structure, not by
   variable name: renaming every variable of a lowered query consistently
   (alpha-renaming) lifts to the same conditions. A hand-written
   `[?task :f/sys.f.type ?tag] [?tag :node/id "todo"]` is "has tag #todo".

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
- **EDN → Conditions: when the query lifts.** On every change to the
  stored text (from either tab, or from anyone else's write) the page runs
  `parseEdn` then `lift`:
  - lifts whole: the Conditions tab shows it;
  - parses to IR but a clause is outside the vocabulary: the Conditions tab
    shows what it can and the rest as a read-only **"advanced clause"**
    chip with that clause's printed text. The chip can be removed, not
    edited; editing the other rows prints the query with the chip's clause
    kept in its place. (Lift returns `opaque` for a clause it does not
    know, and lower prints it back unchanged.)
  - is `raw` (outside the IR) or does not parse: the Conditions tab says
    which construct (`:with`, a function outside `PREDICATES`, a parse
    error at line/column) and offers only the EDN tab. Nothing is
    rewritten.
- **Which tab opens.** The one last used for this node, kept in the
  screen state; for a new query node, Conditions.
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
- **Live count.** Each change recomputes the count on the page's replica
  index (`GraphSource.index`, which runs the same `compile`), debounced ~150 ms; while the
  EDN tab holds unparsable text the count shows the last good one, dimmed.
  The count is the number of distinct result nodes.
- **Results render where they render today**: as the query node's results
  (`QueryResultsSection`, `outline-ui/src/query-results.tsx`), in the
  node's views (list, table, board…), with no new result surface. "No
  results" says which condition removed the last node when it can (the
  count with that condition dropped is non-zero).
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
  narrowing, ANDed onto it at compile). Recommended as the follow-up, not
  folded in here.
- **Opaque clauses** (an advanced clause inside an otherwise lifted query)
  make lift partial rather than all-or-nothing. If the owner prefers
  all-or-nothing, drop the chip: any unknown clause sends the person to the
  EDN tab.
- **New nodes in a query's results.** Tana gives a node created under a
  search its tag and field values. kb could derive the same from the
  conditions (each "has tag" and "field is" that is a single value), but
  that is a write rule, not a view, and belongs in its own design.

## Open questions for the owner

1. Opaque "advanced clause" chips (partial lift), or all-or-nothing?
2. Case-insensitive text by default via `kb/includes-ci?`, with a toggle for
   exact case, or exact by default?
3. kb functions as `kb/`-namespaced calls bound by `compile` (proposed), or
   as rules over pre-lowercased datoms (a `:node/text-lc` attribute the
   index derives, no function inputs)?
4. Should the view filter move onto this condition model now (one model,
   two placements), or after the builder ships?
5. Relative dates: are `kb/days-ago` / `kb/days-from-now` enough, or does
   the vocabulary need "this week", "last month" (calendar-aligned)?
6. Live count on every change runs the query on the page: is a soft cap on
   counting (say, stop at 10,000 and show "10,000+") wanted?

## Where it would land

| Change                                                     | Where                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `blank` term, `predicate`/`or`/`not` clauses, `PREDICATES` | `packages/domain/query/src/ir/ir.ts`, `parse.ts`                                         |
| kb functions bound as inputs                               | `ir/compile.ts`, the clock from the determinism seam                                     |
| `printEdn`                                                 | `ir/print.ts` (new)                                                                      |
| `lift` / `lowerIr`, the vocabulary                         | `ir/conditions.ts` (new)                                                                 |
| Properties 1–5                                             | `packages/domain/query/tests/ir.test.ts`, `conditions.test.ts` (new)                     |
| Conditions/EDN tabs, rows, count                           | `packages/extension/outline-ui/src/query-builder/` (new), mounted by `query-results.tsx` |
| `sys.f.query` editable                                     | the field-visibility root cause, GAP [[01M5CRYK42Y4G74JD62AD00BZS]]                      |
