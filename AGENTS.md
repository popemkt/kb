# kb — Agent Notes

kb is a repo-native graph datastore with an outliner projection, and this
repository is both its code and its first user: kb's own todos, gaps, rules
and checks live as nodes in `.kb/nodes.jsonl`. Specs: `DESIGN.md`,
`DESIGN-UI.md`, `DESIGN-REFINE.md`. Records — wave plans and reports,
research, brainstorms — are under `docs/`; a commit SHA in a record dated
before 2026-10-18 refers to the history of `popemkt/mac-backup`, where kb
was developed until then (README → History).

The four rules below are the engineering rules for kb, and their home is
here. Other repositories that adopt them link to these sections.

## Rule 1 — Abstraction before addition

This is the first rule and it outranks every other consideration in this repo:
speed, diff size, and "it already works" all lose to it.

Every change lands as a clean abstraction. Nothing gets bolted onto the side of
an existing one. When new behavior does not fit the current model, the job is to
fix the model, not to special-case around it.

Before writing code:

- Name the concept the change is actually about, then find where that concept
  already lives. If it lives in two places, collapse them **first**.
- Prefer deleting a special case to adding one. A second `if` on the same
  distinction means that distinction belongs in the data or the type, not at
  the call site.
- One mechanism per concept, and one place that owns it. No parallel path that
  "also" does the thing — no `fooV2`, no `handleSpecialFoo`, no second picker
  for an enum that already has one.
- If a token, option, or module exists for a purpose, make it actually apply.
  A declared abstraction that no code path reads is worse than none, because it
  reads as covered — **a dead seam is still a duplicate**. Wire it or delete it.
- **Bridges over mirrors.** When two things turn out to be the same concept,
  make one derive from or resolve to the other. Two copies kept in sync by hand
  are drift waiting to happen.
- If the clean version is too big for the moment, say so and stop. Do not ship
  the patch as a stopgap. A named gap is cheaper than a silent fork.

**Restructure, then add — as separate commits.** When the current shape resists
the change, first rework the structure so the change becomes a natural addition
(behavior-preserving, proven by the tests that already pass), then add the
behavior. Two clean commits beat one entangled one. The redesign radius is the
unit whose contract the change touches, not the subsystem around it.

Symptoms that this rule is being broken:

- a new boolean parameter that forks an existing function's behavior;
- a second, slightly-different copy of an existing path;
- a guard clause that exempts one caller;
- a wrapper that exists only to avoid touching the thing it wraps;
- special-casing that grows at call sites instead of moving into the unit that
  owns the distinction.

**The reviewer test:** could a reader reconstruct why the code has this shape
from the current requirement alone, without knowing the edit history? If the
shape is only explainable by "it used to do X, then Y was added", it is a patch,
not an implementation.

Corollary for the knowledge base: **everything is a node.** New capability is
expressed as nodes, fields, and tags behaving like every other node — never as
a bespoke surface standing beside them. A tag is a node that is tagged as a
tag; a field is a node; a field's allowed values are nodes. If a feature needs
its own widget, its own storage shape, or its own editing gesture, that is the
signal the model is wrong, not that the widget is needed.

**kb is a graph of everything.** Relationships are the core model. Fields are
relationships we choose to display as fields; field definitions, tags, and their
allowed values are themselves nodes. Outlines, tables, task boards, canvases,
and visual graphs are projections of that same graph, not separate product
models. Do not let outliner or task-management conventions become the default
meaning of kb, or add bespoke workflows that weaken this principle. New
interactions, playful details, and milestones should express creating,
connecting, discovering, or understanding nodes and relationships. Task
completion is meaningful only within an explicitly chosen task model, never
as a universal kb milestone.

## One contract, every implementation

When a concept has more than one implementation (a port with several
adapters, a store with a JSONL and a SQLite backend, a renderer with a WebGPU
and a WebGL path), the promise belongs to the concept, not to any one
implementation.

- **The interface names the capability.** Anything a caller relies on,
  including behaviour such as "notices writes from another process",
  "opening never writes" or "ids are unique after a merge", is a member or a
  documented guarantee of the port. Callers never name a backend, a file or a
  flag to get it.
- **One shared contract suite proves it.** The guarantee is a property in the
  suite that runs over every implementation, for example `store-contract.ts`
  over `STORE_BACKENDS`. It is not a test of one adapter. A new implementation
  joins that suite, and a guarantee that one adapter keeps and another breaks
  makes it go red.
- **The spec states it once.** The design doc says what the port promises, and
  the adapters point to it. An adapter-specific test may add detail, but it
  never replaces the shared property.

This is Rule 1 applied to implementations. Two backends that meet one promise
in two unrelated ways are a mirror; the contract suite is the bridge.

## Data-plane freedom

The data plane is the nodes, fields, tags and values a store holds. A person
owns it; a family, core included, owns only its promises. Freedom is the
default, and every protection names the reason it exists. These are
Rule 1's corollary ("everything is a node") seen from the person's side: a
family's tags and fields are nodes like the person's, so the person can work
on them as they work on their own.

- **Additive edits are always allowed.** On any node, a `sys.*` or family
  node included, a person may add a field to a tag's template, a child, an
  option to an open option set, a tag that extends it, or a setting, and may
  take back what they added. What a family ships stays as it shipped: its
  seeded fields, options and children, in their order.
- **Labels are cosmetic; ids are identity.** A node's text is the person's to
  change, a family's tag, field or option included, without `--force`. The
  seed keeps a label the person edited
  ([DESIGN.md → Extension families](DESIGN.md#extension-families), "The seed
  retires what it renames").
- **Everything references by id.** A stored reference, a saved query, a lens,
  a view's filter and a check name nodes by id (`[?t :node/id "<id>"]`,
  `:f/<field-id>`), never by text, so a rename changes what is shown and
  never what is meant. A name a person types (`kb add --tag todo`) resolves to
  an id once, at the entry point; matching by text belongs to search.
- **Constrain before you lock.** A family protects its data first with the
  field's constraints, enforced at the commit on every surface: the type and
  its form, the option source (children, a tag or a query), a closed option
  set, and the family's commit guard. A bad value is refused with a reason.
  A lock covers two things only: the family's identity and structure (its
  ids, the existence of its seeded nodes and what they ship), and values
  that mirror something outside the person's hand which no constraint can
  check, such as a synced event's Google Calendar id. A locked value
  changes through the family's actions, and the editor says which ones. A
  value the family's constraints keep valid is managed, not locked
  (`sys.f.managedBy`): days' period key is kept to one real period by its
  guards, so a person may re-key a day after the page's one deliberate
  step.
- **Families migrate their own data, declared and previewed.** A family whose
  update changes the shape of data it owns ships the change as declared
  migration steps. The steps are pure, deterministic and idempotent. The
  person sees them as a dry-run diff before approving the update, and they
  apply as one transaction that can be undone and is recorded as a node. A
  rename is an alias or a retirement row, and no step deletes or rewrites
  what the person added.

Where the code falls short of these today, a `#gap` names the rule it bends
(`kb backlinks` on the rule lists them). The proposal that motivated them is
`docs/research/2026-11-10-data-plane-fields-events.md`.

## Hosts are accelerators

kb runs in two modes. One-shot commands (`kb get`, `kb add`,
`kb search`, …) open a store, act, and exit. Long-running hosts (`kb ui`
and `kb mcp`) stay up and serve. Two rules keep the modes apart:

- **The store is the truth; a host only makes it arrive sooner.** Every
  feature is correct when only one-shot commands ever run against a store.
  A result that something is due, retained, rolled over or synced is worked
  out from the store when it is asked for, never from a timer or a map in a
  process. State that must outlive a call is written to the store under its
  lock. Some features already work this way:
  - backup retention is done at write time under the lock;
  - a day rolls over when it is read;
  - the store watcher only saves a reload that the next command would do
    anyway.

  A host loop calls the same action a person could run one-shot, and a
  cache is keyed by the store's fingerprint, so deleting it costs only
  time.
- **One-shot commands load no host code.** Servers, sockets, watchers,
  schedulers, agent runtimes and MCP are host code. One-shot commands reach
  them from the CLI entry only through a dynamic `import()`, and so are
  painters and engines that a command does not use. The release build
  emits that code in chunks a one-shot command never parses. The two modes
  share one mode-neutral core: the domain, the store, and the actions.

Where the code falls short of these today, a `#gap` names the rule it bends
(`kb backlinks` on the rule lists them). The evidence and the migration plan
are in `docs/research/2026-11-11-cli-host-modes.md`.

## Canonical statements

Every rule, principle, and decision has exactly one home. Other files link to
it; they never restate the body. Restatement is drift — two copies diverge
silently and a reader cannot tell which one is live.

The index of rules is data, not a document: `#rule` nodes in kb, materialized
to `docs/rules.md`. Each rule names its `home` (the file that states it),
`scope`, `principle`, `enforcement`, and `gate`.

`enforcement` is honest, never aspirational. It is one of `prose`, `lint`,
`tsc`, `harness`, `hook`, `ci`. **`prose` means nothing checks it** — the next
agent can break that rule and nothing goes red. That is information worth
seeing, not an embarrassment to paper over; `gate` names the check that will
close it.

## Drift markers and gaps

The goal is not zero drift. The goal is *visible, intentional* drift.

- **A workaround is a decision, and decisions are recorded.** When the clean
  shape is deferred, the deferral site carries `// GAP [[<node-id>]]` and kb
  carries the matching `#gap` node: `expected` (the canonical shape),
  `current` (what is there instead), `impact` (what it costs or risks),
  `closes` (what would close it), and `rule` when it bends a specific `#rule`.
  An unlabelled workaround is drift.
- Same for tests: every `.skip` / `.todo` names a `GAP [[<node-id>]]`. A
  skipped test is a debt, not a solved problem.
- **A soft lint rule uses exactly one of two mechanisms, chosen by count —
  never both, never a third.** Up to roughly 30 sites: the rule is `error` and
  each site carries `// oxlint-disable-next-line <rule> -- GAP [[<node-id>]]`.
  More than that: the ratchet lane — `warn`, the count frozen in a committed
  baseline, a rise fails the build, and the rule is promoted to `error` when
  its count reaches 0. A second severity tier for the same rule in the same
  config is a second quality stack wearing a disguise.

```bash
kb add "GAP: <one line>" --tag gap --create \
  --prop expected="…" --prop current="…" --prop impact="…" --prop closes="…"
```

## Gate (run first)

Admission is gated. Before doing any work here, enter the toolchain and set
the clone up once:

```bash
nix develop        # the bun, jq, shellcheck and actionlint the gates run
bun install        # dependencies, and bun.nix regenerated from bun.lock
bun run setup      # core.hooksPath=.githooks and the kb-jsonl merge driver
```

A missing tool is restored — `nix develop`, `bun install` — never worked
around. Every commit is admitted by `.githooks/pre-commit`, which runs
`bun run verify` and the generated-docs check against the staged index;
never `--no-verify`. What triggers what, and what CI adds, is
[`docs/ci.md`](docs/ci.md).

## kb — repo knowledge base

kb is this repo's graph datastore: todos, gaps, rules, checks and notes live
as nodes in `.kb/nodes.jsonl` (committed). Everything is a node — fields and
tags too. Props are keyed by field-node id; tags template fields; values may
reference other nodes. Query with datalog (DataScript), or through the MCP
server (`kb mcp`). `kb ui` serves the outliner UI on 127.0.0.1:4321. From a
checkout, `bin/kb` runs the CLI from source.

```bash
kb add "Fix drift audit" --tag todo --prop status=doing
kb add --outline plan.md --parent <id>   # a whole outline (Tana Paste) in one tx; DESIGN.md → Outline paste
kb search "drift" --json
kb query '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/id "01KZFW1A5BT06QS7V6X6EBQMZ4"] [?n :node/id ?id] [?n :node/text ?text]]'   # #todo, by id
kb run <saved-query>            # .kb/queries/<name>.edn
kb docs materialize             # regenerate docs/rules.md and docs/todos.md
kb ext list                     # loaded extensions + their actions
```

Rules for agents:
- Prefer `kb` over ad-hoc TODO files for durable todos and notes; `--json` for
  machine output.
- Props are multi-valued: `set` appends — `unset` the old value when changing
  e.g. `status`.
- `[[id|label]]` in node text and any `{t:"ref"}` prop value are both the ref
  form; load extracts `:node/mentions` datoms from either (`DESIGN.md`). Use
  `kb backlinks <id>`.
- `docs/rules.md` and `docs/todos.md` are generated (a header marks them);
  edit data, then materialize. Pre-commit runs `docs.check` and blocks stale
  generated docs.
- Rules and gaps are nodes like everything else: `#rule` (fields `home`,
  `scope`, `principle`, `enforcement`, `gate`) and `#gap` (fields `expected`,
  `current`, `impact`, `closes`, `rule`), rendered to `docs/rules.md` by the
  `rules` view. Add a gap with the `kb add` line under
  [Drift markers and gaps](#drift-markers-and-gaps).

## Shape

Core is mechanism only (store, datalog, plugin kernel, subscriptions, render
backbone). Repo-specific policy lives in extensions, and every extension —
bundled or `.kb/extensions/*.ts` — loads as a plugin into the one
`@kb/plugin` kernel. A repository extension is a family as a bundled one
is, a declaration and its plugin, from trusted bytes in the root rather
than the build. Points, namespacing, aliases and failure handling are stated
once, in `DESIGN.md` →
[Core boundary & extensions](DESIGN.md#core-boundary--extensions).

- Workspace: kb is a Bun workspace; every concept is a package under
  `packages/<layer>/<name>` named `@kb/<name>`, with one curated
  barrel at `src/index.ts`. Its two axes have two homes: the **layer** is the
  folder it sits in (`domain`, `contract`, `infrastructure`, `application`,
  `kit`, `extension`, `app`, `test-support` — exactly the `LAYER_ALLOWS` keys), and
  the **scope** is one `scope:*` tag in its `nx` key. A `layer:*` tag is a
  duplicate of the folder and fails `workspace-shape`. There is
  no alias map — `@kb/*` resolve as workspace packages, and a package name
  never encodes its layer. Internal deps are
  `workspace:*`, external deps are `catalog:`, and the catalog in the root
  `package.json` is the only file that names a version.
- Runtime/tooling boundary: Bun is the production runtime (Bun APIs stay where
  appropriate); TS 7 + Vite+ (`vp` 0.2.8) + oxlint + Nx own the tooling. Run
  `bun run verify` (the entry point a human or CI runs; what it runs is its
  definition in `package.json`, stated nowhere else), `bun run typecheck`
  (authoritative zero-error `tsc --noEmit` per package via Nx),
  `bun run test`, `bun run test:ui`, `bun run test:render`. Two runners split by package: every `scope:browser`
  package runs on Vitest, everything else on `bun test`. See `DESIGN.md`.
- Admission: `.githooks/pre-commit` runs `verify`, the generated-docs check
  and the `.kb/assets` ownership check against a reconstructed **index
  snapshot**, not the working tree, so an unstaged fix cannot mask a staged
  defect. Which staged paths trigger which check is stated once, in
  [`docs/ci.md`](docs/ci.md#pre-commit-the-same-questions-one-commit-earlier).
- Linting & boundaries: every boundary — layer and scope
  direction, the isomorphism fence (a `scope:shared` package may not import
  `node:*`, `bun:*`, or `@effect/platform-bun`), the extension family axis
  and composition-root fence (`EXTENSION_ROOTS`; `DESIGN.md` → Extension
  families), and the zone matrix inside
  `packages/app/ui` (`UI_ALLOWS`, whose sanctioned breaches carry
  `// GAP [[id]]` on the import line) — is stated once in
  `harness/src/constraints.ts` and enforced by `harness/`
  (root tooling, not a workspace package) over what the code imports.
  Three tsconfig presets sit under the one strictness base and a package picks
  one by its scope tag: `tsconfig.iso.json` for `scope:shared` (no `types`, so
  `Buffer` and `process` are compile errors — the half of the fence the import
  graph cannot see), `tsconfig.bun.json` for everything else, and
  `tsconfig.browser.json` for `scope:browser`; a `scope:shared` package carries
  a second `tests/tsconfig.json` on the Bun preset, because `bun test` is Bun
  whatever the code under test targets.
  `.oxlintrc.json` is the single oxlint ruleset: the three categories at `error`, the rules
  beyond them, and overrides only for two file classes — test and tooling
  files (tests, render specs, `harness/`, the runner configs; not stories,
  which are UI) and `.d.ts`.
  A file that legitimately breaks a rule carries a pinpoint
  `// oxlint-disable-next-line <rule> -- <reason>`, not an override.
  Rules oxlint does not ship are JS plugins under `harness/lint/`, registered
  in that same file: a vendored subset of anti-slop
  (`harness/lint/anti-slop/UPSTREAM.md` says which rules and why), and kb's
  own `design-tokens` (what it enforces is in `DESIGN-UI.md` → Design
  tokens). `@oxlint/plugins` is
  pinned exactly to the `oxlint` version, and the two move together.
- Merging `nodes.jsonl`: the store is a set of nodes keyed by id, so git's
  line-based merge reports conflicts that are not conflicts — ULIDs put every
  newly created node at the tail, and two branches that each add one collide
  there. `.gitattributes` routes the store through the `kb-jsonl` driver:
  `bin/merge-jsonl`, a POSIX wrapper around
  `kb merge-jsonl` (`packages/app/cli/src/merge-driver.ts`), whose resolution rules are
  `@kb/model`'s `mergeNodeSets` (`DESIGN.md` → Merge). Git config is per clone
  and is not versioned, so `bun run setup` (`bin/setup`) registers it, with
  `core.hooksPath`; re-run it after a change to either.

  A conflict never leaves `%A` as our side alone, or a `git add` would drop
  theirs. When the id-based merge cannot run on what git handed it, the driver
  runs `git merge-file` over the same three files itself; when the driver
  cannot run at all — no `bun` on PATH, the workspace's dependencies not
  installed, a crash — the wrapper does. Either prints why on one line and
  exits non-zero, so git leaves the path conflicted for a human. An
  unregistered driver gets git's default text merge: noisy, but never wrong
  about content.

## Extensions

`@kb/ext-check` owns the `ext.check.audit` read action and `ext.check.sync` apply action: it proves that every `rule.check` points to a `#check` whose evidence exists and whose invocation is wired into its declared surface (a surface's files are the `files` of its `enforcement` option node, so each repository says where its hook and CI live), rejects stale enforcement, simultaneous `gate` and `check`, and broken rule homes (a home is a file in this repository, with an optional heading anchor, or an `https:` URL into another one, which is checked for its form only), and derives `rule.enforcement` from the check surface. To remove it, delete `packages/extension/ext-check` and `packages/extension/check`, the family's `BUNDLED_FAMILIES` entry in `packages/app/bundled/src/index.ts` (`checkExtension`) and its server entry in `packages/app/runtime/src/bundled.ts` (`checkPlugin`), `kb check audit` in `packages/app/cli/src/gates.ts`, and the `check:audit` script plus its `verify` mention; remove the `@kb/ext-check` and `@kb/check` manifest dependencies and refresh `bun.lock`; the `check` tag, the `enforcement` field's option children and `rule.check` refs are data and may stay or be removed with `kb rm`, after which the rules index is hand-typed again.

### Effect

kb is written in Effect (v4). **Before writing any Effect code, read
`node_modules/effect/AGENTS.md` completely** and follow the links in it; for
APIs it does not cover, read the source under `node_modules/effect/src`.
Never external docs or v3 muscle memory — both are wrong for v4. That file
ships inside the `effect` tarball, so it is absent on a fresh clone until
`bun install`; the pre-commit hook refuses a checkout without dependencies
for the same reason.

v4 non-negotiables: `Effect.gen` for inline code; `Effect.fn("name")` (or
`Effect.fnUntraced` on hot paths) for reusable functions, never a plain wrapper
that just returns an `Effect.gen`; `Schema.TaggedError` for errors, not
`Data.TaggedError`; `Context.Service` classes for services, not `Context.Tag`;
`Effect.catch`, not `Effect.catchAll`; `Schema` imported from `"effect"` core,
never `@effect/schema`; `return yield*` when raising, so control flow narrows.

The official Effect skills (`effect-ts`, `effect-v3-to-v4`) are installed at
repo scope by the skills CLI, with their lockfile committed; `effect-ts` is a
setup skill and is redundant once the pointer above is followed, and
`effect-v3-to-v4` is explicit-invoke only (kb was born on v4).
