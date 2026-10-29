# Plugin codependency: what kb sees, what it misses, and what others do (research, for the owner to read)

Date: 2026-10-29. Base: `main` at `6ce987e`. This record surveys and
proposes. Nothing in it is built except the gap nodes it files (§7). It
links to the specs that own each mechanism and does not restate them:

- the kernel: [DESIGN.md → Core boundary & extensions](../../DESIGN.md#core-boundary--extensions);
- derived dependencies: [→ Plugin organisation](../../DESIGN.md#plugin-organisation--tags-and-derived-dependencies);
- families and switches: [→ Extension families](../../DESIGN.md#extension-families);
- the page's halves: [DESIGN-UI.md → Extension UI halves](../../DESIGN-UI.md#extension-ui-halves).

The earlier Cordis survey,
[`docs/brainstorms/2026-10-16-kb-cordis-layers`](../brainstorms/2026-10-16-kb-cordis-layers/README.md),
is the source for everything this record says about DeepSeek Harness.

The owner's question, verbatim: *"how we can mitigate plugin codependency,
or at least have that surfaced or get visibility there. Check other
solutions? Things like dsh every capability is a plugin, do they overcome
this some how and have plugins as independent as possible, and probably
protect from something unloading breaking something else."*

**"dsh" is taken to be DeepSeek Harness.** Its repository describes it as
"DeepSeek Harness: Everything is a Plugin". It is built on Cordis, and it
is the system kb's kernel is modelled on: DESIGN.md names it, and cites
`vendor/cordis/src/reflect.ts` at `dsh-v0.2.1-rc.2`. Two other readings were
checked and set aside:

- the Unix distributed shell `dsh`;
- `dsh2` on PyPI.

Neither is a plugin system. The phrase "every capability is a plugin" also
fits Fuchsia ("everything is a component"), Eclipse/OSGi and Nix modules,
and §3 covers all three.

## 0. The answer

**kb already prevents the failure the owner is afraid of, for the one kind
of dependency it can see.** A plugin reaches another only through a
service it lists in `inject`. The kernel derives the dependency graph from
that list, and when a provider leaves, its dependants go back to
`pending`. When the provider returns, they come back. Families cannot
import each other's code. This is Cordis's model, made stricter: `apply` is
atomic, and keys are compared by identity. Among the systems surveyed, only
OSGi Declarative Services and Fuchsia are as principled.

**The coupling kb actually has goes through four other channels, and the
graph sees none of them.** `kb ext list` run on this repository reports, for
every family in the server registry, `injects: []` and `provides: []`
(§1.2). So the visibility tool exists and has nothing to show. The real
edges are:

1. **Calls by action id.** For example, canvas calls `ext.agent.complete`,
   `ext.code.script.*` and `ext.graph.edges` as strings.
2. **Data.** These are nodes whose refs land in another family's seed:
   view nodes, backdrop and design-system choices.
3. **Copies.** These are ids and helpers duplicated across the family
   fence because the fence forbids the import.
4. **Kernels.** A call from the registry to a family that only the `kb ui`
   host composes has no edge anywhere.

**The recommendation is to route every cross-family edge through the
mechanism that already works, and add no second one.**

- **Make a call a key.** A call to another family's action becomes a key
  in `inject`, the shape the lab's graph studies already have (§1.3). The
  kernel then derives the edge, and an optional need is a child plugin
  that pends.
- **Make data a query.** The relation "who references what this family
  seeds" is one datalog join over `:node/mentions` and `:node/owner`.
- **Make copies a lint.** Two harness rules catch a string spelling of
  another family's action id or seed id.
- **Read the impact before a switch.** A read action answers "what changes
  if I switch X off". The page's switch shows that answer before it
  writes, and `kb ext graph` prints the whole graph.

None of these adds a field an author must fill in, and none adds a second
dependency list beside `inject`. That is Rule 1, and it is the reason this
record rejects the most common answer in prior art, a manifest list of
depended-on plugins (§4.1).

## 1. kb today

### 1.1 How a dependency is declared and resolved

**Declaration** is `inject` on a plugin:

- the field: `packages/domain/plugin/src/kernel.ts:61`;
- the spec: DESIGN.md:2949, "Dependencies are derived, never declared".

**Resolution:**

- `missingOf` (`kernel.ts:251`) lists the injected services nobody
  provides.
- `reconcile` (`kernel.ts:326`) activates every pending plugin whose
  services now all exist.
- `ctx.get` on a key not in `inject` fails with `not-injected`
  (`kernel.ts:403`), so the declaration cannot drift from use.

**The graph** is `Kernel.dependencies()` (`kernel.ts:167`, `kernel.ts:535`):
an edge `{from, to, service}` joins each inject to its provider. Contributing
to a point is deliberately not an edge.

**Keys** are created once by the package that owns the concept and compared
by identity (`packages/domain/plugin/src/keys.ts:1-15`). A key two families
share therefore has to live in a layer both may import: `@kb/contracts`, or
a kit such as `@kb/ui-sdk`.

**Code edges** are fenced by the harness:

- `familyEdgeViolation` (`harness/src/constraints.ts:112`) refuses an
  import between two families.
- `EXTENSION_ROOTS` (`constraints.ts:188`) confines an import of an
  extension to a composition root.
- `TAG_ALLOWS` (`constraints.ts:136`) holds `core`, `governance` and
  `identity` plugins to core-only providers.

**Shared code** goes to `packages/kit/`. That folder holds `scene`,
`scene-gpu`, `theme-art` and `ui-sdk`, and a kit has no lifecycle: it is
bundled into each consumer.

**A switch** is data: `sys.f.extension.enabled` on `sys.extension.<name>`,
read by `familyOn` (`packages/contract/contracts/src/extension-switch.ts:56`).
Every host converges on it:

- the registry is composed again;
- `composeHosted` runs in `packages/app/server/src/plugins.ts:86`;
- `syncPlugins` runs in `packages/domain/plugin/src/sync.ts:25`.

**Admission** is `admitExtensions` (`packages/app/runtime/src/registry.ts:541`),
which `kb ext validate` runs and `verify` runs as `check:ext`. It refuses:

- a module that does not import or decode;
- a declaration that does not fold;
- a `service-conflict` or a `contribution-conflict`;
- an action that breaks the rules every action keeps.

It says nothing about dependencies.

### 1.2 What switching a family off does

| Dependant | What happens | Where |
| --- | --- | --- |
| A plugin that injects a service the family provided | Goes back to `pending`, and returns when the provider does: a cascade with automatic rebind | `removeService`, `kernel.ts:291-300` |
| A child plugin that injects it | The child pends and the parent stays: a degrade | lab, §1.3 |
| A contribution to a point the family owned (`GraphThemePoint`, `LabStudyPoint`) | Inert. Today only the owning family contributes, because the fence forbids importing the key | `graph-ui/src/graph-themes.ts:311`, `lab-ui/src/kit/study-point.ts:17` |
| A frame or page whose view node names the family's view | Draws `ViewNotLoaded`, and the node stays | DESIGN-UI.md:2334 |
| A page head whose backdrop the family contributed | Falls through to the next choice, then core's | DESIGN-UI.md:3738 |
| A design-system choice naming the family's system | The default is shown | DESIGN-UI.md:3273 |
| A call to the family's action by id | Fails at call time with `not_found`, inside the caller's run | `ext-canvas/src/run.ts:201-218` |
| The family's module top level | Stays until the process restarts: a module cannot be un-imported | DESIGN.md:2782 |
| Its data | Kept: the switch writes only its node | DESIGN.md → "The data stays" |
| A required family (`docs`, `check`, `governance`) | Refused by `extension.switch` | `packages/application/operations/src/extensions.ts:62-90` |

So the policies are already the right ones: service edges cascade and
rebind, UI degrades, and data stays. What is missing is that nobody is told.
`extension.switch` (`extensions.ts:62`) checks only that the family is
optional. It computes no dependants and returns only `{name, on}`.

**What is visible today.** `kb ext list` reports, per family:

- its tags;
- each service it injects and who provides it;
- what it provides;
- why any of its plugins failed.

That report is `organisationOf`, `packages/contract/contracts/src/extension-report.ts:70`.
`kb ext footprint` lists a family's seeded nodes and contributions. Run on
this repository:

```
$ bin/kb ext list --json | jq -c '.output.extensions[] | {name, injects, provides}'
{"name":"governance","injects":[],"provides":[]}
{"name":"outline","injects":[],"provides":[]}
… every family alike …
{"name":"yorha","injects":[],"provides":[]}
```

The registry's derived graph is empty. Real edges exist, but they do not go
through `inject`.

### 1.3 The one cross-family edge done right

`lab-ui` injects `NodeLinkGraphService`, which `graph-ui` provides
(`packages/extension/graph-ui/src/plugin.ts:77`). The key lives in the kit
(`packages/kit/ui-sdk/src/index.ts:220`), and the inject is carried by a
child, `graph-studies` (`packages/extension/lab-ui/src/plugin.ts:30-38`).
With the graph off, those studies pend and the lab keeps the rest.

This one edge has all four properties the prior art below argues for:

- the dependency is on a contract, not on code;
- the edge is derived;
- it is optional by construction, because it hangs off a child;
- unload degrades and rebinds without a line of handling code.

The record's recommendation is, in effect, to make every other edge look
like this.

### 1.4 Where the hidden dependencies are

| # | Channel | Instances on `main` | Seen by the graph? | On switch-off |
| --- | --- | --- | --- | --- |
| H1 | **Action calls by string id.** `CoreInvoke` (`contracts/src/actions.ts:531`) takes `{id}` | canvas → agent: `ext.agent.complete` (`ext-canvas/src/run.ts:42`). canvas → code: `ext.code.script.list` / `.run` (`run.ts:56-57`, `verbs.ts:167`). canvas → graph: `ext.graph.edges` (`ext-canvas/src/diagram.ts:33`) | no | the call fails by name at run time |
| H2 | **Data refs into a family's seed.** View nodes, backdrop, design-system and graph-theme choices, anything a person links | on this store: 5 nodes outside the outline reference outline-seeded nodes and 1 references canvas's, from `[?m :node/owner ?e] [?n :node/mentions ?m] (not [?n :node/owner ?e])` | no | degrades (ViewNotLoaded, fall-through); nobody is told how many nodes are affected |
| H3 | **Copies across the fence**, because the fence forbids the import | `sys.tag.canvas` copied into the kit (`kit/ui-sdk/src/lib/bullet-mode.ts:25`, gap `01M436DVSEHKNYWSF2MR07HPMR`); three helper pairs (gap `01M43ASYY0EC1E4TYFXYXHZEME`); the Arena's own GPU host beside backdrops' (`yorha-ui/src/art/arena-backdrop.tsx:75`, gap `01M5SYY397F5NPN3CHWGCSPQSY`) | no (a mirror, held by a test or by nothing) | nothing breaks; it drifts instead |
| H4 | **Kernels.** The registry, the `kb ui` host and the page each run one | canvas's run is in the registry; the agent is composed by the `kb ui` host only (`run.ts:271`: "where no agent is hosted, it fails by name") | no (an edge cannot cross kernels) | fails by name; the switch is writable only where the host runs (gap `01M43H3T8XEMTNBARC024PZD2W`) |
| H5 | **Kits that name a family** (the inverse leak) | gaps `01M53GQBPC6PR0CPQDNC74MV3R` and `01M53GQC1V4S043899SSX8Q47J` | no | nothing; it is core vocabulary |
| H6 | **Module top-level effects and globals.** `installHostModules` (`contracts/src/extension.ts:86`) | by design, one global per host; no extension writes `globalThis` today | no | they outlive the switch |
| H7 | **"Required" standing in for an edge.** Docs is required because core's docs views render with its templates | DESIGN.md:3048 and the list below it | no (core → docs is prose) | refused, which is correct but undeclared |
| H8 | **CSS tokens** | theme sheets write only layer-1 tokens under `[data-theme="<family>.theme"]`: checked, no foreign selector in `zzz.css`, `yorha.css` or `transistor.css`; `lib/tokens.test.ts` fails a dead token | n/a | the default system is shown; this channel is clean |

Two things follow.

- **H1 and H4 are the only channels where switching a family off breaks
  another family's behaviour** rather than degrading its view. The rest are
  either clean (H8), degrade gracefully (H2), or are drift rather than
  breakage (H3, H5).
- **H2 is the channel that grows with use.** It is where a personal store's
  choices land, and kb is the one system in the survey that can answer it
  with a query, because the seed knows its owner.

## 2. How to read the matrix

Each system is described by five things:

- **declared**: where the edge is written;
- **by**: contract, interface or service, versus code import;
- **versions**: how the edge is versioned;
- **on leave**: what unload, disable or hot-reload does to dependants. It
  takes one of four values: *refuse* (the provider cannot leave), *cascade*
  (dependants are stopped), *degrade* (dependants keep running without it)
  or *rebind* (dependants switch to another provider, or the returning
  one);
- **sees it**: the tools that show the graph.

The sources are primary where marked. "unverified" marks a claim the
gatherers took from memory or from a secondary source.

## 3. Prior art

### 3.1 Matrix

| System | Declared | By | Versions | On leave | Sees it |
| --- | --- | --- | --- | --- | --- |
| **kb today** | `inject` on a plugin | service key (identity), plus string action ids (H1) | none (one build; repo extensions type against `kb ext sdk`) | service: cascade to pending, then rebind; UI and data: degrade; action id: fails by name | `kb ext list` (injects and providers per family), `kb ext footprint` |
| **DeepSeek Harness / Cordis** | `inject: [...]` on a plugin; `provide` | service name | `engines.dsh` admission for packages | cascade to inactive, then rebind on return; optional is a child via `ctx.inject(deps, cb)` | Plugins page, `dsh --dump-config`, `ctx.cordisInspect` |
| **OSGi** | `Import-Package` (`resolution:=optional`), `Require-Bundle`, `Require-Capability` / `Provide-Capability`; DS `@Reference` | package (API) plus service registry; DS cardinality `0..1`/`1..1`/`0..n`/`1..n` | ranges `[1.2,2)` | DS: a static ref cascades (deactivate, reactivate); a dynamic ref rebinds in place; an optional ref never deactivates. Module layer: stale wiring until `refreshBundles`, then a cascade over the importer closure. Never refuses | Felix Web Console (unsatisfied refs), gogo `diag`, `inspect cap/req`, `scr:info` (unverified names) |
| **VS Code** | `extensionDependencies` (ids), `extensionPack`, `activationEvents` | `activate()` return value via `getExtension(id).exports`; untyped | none on dependencies; `engines.vscode` | dependants fail to activate; disabling a dependency prompts to disable dependants (unverified wording); change = host restart | Running Extensions (activation reason), the details' Dependencies tab |
| **IntelliJ** | `<depends>`; `<depends optional="true" config-file="…">`; v2 `<dependencies><plugin/><module/>` (unverified) | classloader delegation; extension points | no ranges for non-bundled plugins; `since-build`/`until-build` | the optional `config-file` unloads with its provider, so the dependant degrades; a required dependant is disabled with it (unverified); unload failure falls back to a restart | Plugin Verifier, DevKit dynamic-plugin inspection, `ide.plugins.snapshot.on.unload.fail` |
| **Eclipse Theia** | npm deps plus `theiaExtensions`; VS Code plugins as above | InversifyJS DI tokens; `ContributionProvider` | npm semver; aligned versions | extensions are build-time (no unload); plugins follow VS Code | none first-class |
| **Emacs** | `require`/`provide`; `Package-Requires: ((pkg "ver"))` | feature symbol, loaded as code | minimum version | `unload-feature` **refuses** while another loaded library `require`s it, unless FORCE; `FEATURE-unload-function` for teardown | `list-packages`, `load-history` |
| **lazy.nvim** | `dependencies`; triggers `event`/`cmd`/`ft`/`keys` | plugin name and Lua `require` | `version`/`tag` pins | no unload; `:Lazy reload` experimental | `:Lazy`, `:checkhealth` (a `health.lua` per plugin) |
| **Obsidian** | nothing (`manifest.json` has `minAppVersion` only) | runtime lookup `app.plugins.plugins[id]?.api` (undocumented) | none between plugins | the dependant breaks or reads a stale reference; the host does nothing. Owner-side cleanup via `Component.register*` | none |
| **Logseq** | nothing found | iframe plus messages; `provideModel` is self-only | n/a | n/a | none |
| **Tana** | no plugin model; supertags and fields are shared schema nodes | data | n/a | deleting a supertag leaves its users dangling (unverified) | n/a |
| **Notion blocks** | none | typed records | n/a | an unknown type renders as `unsupported` (degrade by data, unverified) | n/a |
| **Figma** | none; `sharedPluginData` namespaces | data on the document | `api` pins the host API | plugins are isolated and short-lived; shared data outlives its writer | n/a |
| **Backstage, frontend** | `attachTo`, `inputs` (`createExtensionInput`, optional or singleton), `externalRoutes`, `ApiBlueprint` `deps` | extension data refs and `ApiRef`, never a code import | package semver | a disabled extension "is not instantiated and its parent will effectively not see it in its inputs": degrade decided by the parent's input contract | app-visualizer (unverified) |
| **Backstage, backend** | `registerInit({deps})`, `createServiceRef`, service factory `deps` | service refs; plugins "must never communicate with each other directly through code" | package semver | **refuses to start** on a missing or circular dependency | startup error |
| **Grafana** | `plugin.json`: `dependencies.plugins[]`, `dependencies.extensions.exposedComponents[]`, `extensions.extensionPoints[]` | string ids prefixed by the owner plugin, `/v1` suffix | `grafanaDependency` semver; the contract major version is in the id | `usePluginComponent` gives `component: null`: degrade. The registry rejects anything not declared in `plugin.json` | logs; dev-mode rejection |
| **Nix modules** | `imports`; `options` declared, `config` set | option path and type (a merge target) | none; `mkRenamedOptionModule`/`mkRemovedOptionModule` shims | setting an undeclared option is an evaluation error naming the defining file; `assertions` for cross-module rules; nothing runs, so nothing breaks at run time | the error's provenance, `nixos-option`, `--show-trace` |
| **Erlang/OTP** | `.app`: `applications`, `included_applications`, `optional_applications` (OTP 24) | application name; calls are code | `vsn`; releases pin | `application:stop` checks no dependants (no refuse, no cascade); restart type `permanent`/`transient`/`temporary` decides the node's fate on a crash | `observer`, `which_applications` |
| **Fuchsia** | CML `use`/`offer`/`expose`/`capabilities`, `availability: required/optional/same_as_target/transitional` | capability (FIDL protocol) routed by name through the tree; no code | FIDL versioning, `transitional` | nothing refuses; the channel closes with `NOT_FOUND`: degrade with one typed error. A required `use` of an optional offer is a static analyzer error | `ffx component route`/`capability`/`doctor`/`show`; Scrutiny (static) |
| **Atom** | `providedServices`/`consumedServices` with versions | named service, semver ranges matched by the host | semver | the consumer's `Disposable` runs: degrade and rebind, silent | none |
| **Zed** | `extension.toml` | leaf contributions to host points; no inter-extension dependencies (unverified) | `schema_version` | n/a | n/a |
| **Helix** | no stable plugin system (Steel in progress) | n/a | n/a | n/a | n/a |
| **WASM components / WIT** | world `import`/`export` | interface | `pkg@1.2.0` | link fails ahead of time; no optional import | `wac`/`wasm-tools` |
| **Jenkins** | `Plugin-Dependencies: a:1.13;resolution:=optional` | classloader | minimum version | `disable(NONE)` **refuses** while a mandatory dependant is on; `MANDATORY` and `ALL` cascade | "Dependency errors", disable dialog |

### 3.2 What the systems teach

**1. Edges between plugins should be contracts, not plugin ids.**

- Fuchsia, Backstage, Atom, WIT and OSGi DS all declare a dependency on a
  capability, and whoever provides it satisfies it.
- VS Code, IntelliJ, Emacs, lazy.nvim, Erlang and Jenkins declare a
  dependency on a named plugin. That couples the consumer to a provider,
  forbids a second implementation, and is what makes their unload stories
  hard: classloader leaks, stale wiring, NoClassDefFoundError.
- Backstage says it outright: plugins "must never communicate with each
  other directly through code".
- kb's `inject` is already on the contract side. H1 is a lapse into the id
  side: `"ext.agent.complete"` names the agent family, not a
  "complete a turn" capability.

**2. Required versus optional belongs to the edge, not the plugin.**

- The systems that put it on the edge: DS cardinality, IntelliJ's optional
  `<depends>` with its own `config-file`, Erlang's `optional_applications`,
  Fuchsia's `availability`, Backstage's optional inputs and Jenkins's
  `resolution:=optional`.
- The IntelliJ form is the instructive one. The optional part of a plugin
  is a separate unit that loads and unloads with its provider. That is
  exactly a kb child plugin with its own `inject`, and Cordis's
  `ctx.inject(deps, cb)` is the same idea.

**3. There are three policies, and the good systems choose by edge kind:**

- refuse (Emacs, Jenkins `NONE`, Backstage backend);
- cascade with rebind (OSGi DS static, Cordis, kb);
- degrade (Fuchsia, Grafana, Backstage frontend, Notion, Atom).

Refusing is right only where removal would make the system lie. kb
already refuses for its required families, so that no gate can read as
clean. Cascade-and-rebind is right for runtime services. Degrade is right
for UI and data.

**4. Visibility comes from declarations, read without running code.**

- Grafana reads `plugin.json`, Fuchsia's Scrutiny reads manifests, and Nix
  names the defining file in every error.
- Obsidian declares nothing and therefore can show nothing. Its plugin
  community lives with "my queries broke after I toggled a plugin".
- The second visibility lesson is the "why" question. OSGi's `diag`, `ffx
  component doctor` and VS Code's activation reason each answer "why is X
  not running" in one command.

**5. The dependant closure is computed before the switch, by whoever owns
the lifecycle.**

- Jenkins computes it in `PluginWrapper.disable`. The VS Code and IntelliJ
  dialogs list dependants (unverified wording), and OSGi computes the
  refresh closure.
- None of them leaves it to the UI.

**6. Dynamism costs leaks, and the safe fallback is to admit it.**

- IntelliJ falls back to "restart the IDE" when an unload fails. OSGi
  keeps old exports alive until a refresh.
- kb has the same honest limit: module top-level effects outlive the
  switch (DESIGN.md:2782). It needs nothing new, only a check that keeps
  top-level code inert.

**7. Contracts are versioned by renaming.** Grafana puts `/v1` in the id,
and Backstage says to add a new extension point for a breaking change. kb
is one build, and its repository extensions type against the host's own
SDK, so a semver solver would serve no one. A breaking change to a key is a
new key.

**8. Data that outlives its code is the norm in data tools.** Figma's
`sharedPluginData`, Tana's supertags and Notion's unsupported blocks all
keep the data and degrade the view. kb does the same (DESIGN.md: "The data
stays"). What kb can add, and none of them has, is a query that says how
much data a switch affects. The seed records its owner (`:node/owner`),
and refs are datoms (`:node/mentions`).

### 3.3 What kb should not take

- **A manifest list of depended-on families** (VS Code
  `extensionDependencies`, Grafana `dependencies.plugins`, Jenkins).
  - It is a second statement of what the code does. kb's `inject` is
    already the declaration and is checked at every `ctx.get`, so a list
    beside it would be a mirror.
  - Grafana shows the cost: it carries both `dependencies.plugins` and
    `exposedComponents`, two grains that can disagree.
- **Refusing to switch an optional family off because something uses it.**
  - Every edge kb has either rebinds (services) or degrades (UI, data).
  - Refusal would turn "switch the agent off" into "switch canvas off
    first", and that is the coupling the owner wants less of.
  - kb keeps refusal where it is: for required families.
- **Version ranges and a resolver.** One build, keys by identity (§3.2
  item 7).
- **Process isolation per extension** (the VS Code extension host, Figma's
  sandbox). It answers a different question, untrusted code, which kb
  answers with trust and the sandbox (DESIGN.md → Sandbox).

## 4. The patterns that fit kb, against Rule 1

### 4.1 One edge mechanism: `inject`, widened from services to contributions

**The concept is "this plugin needs something another plugin provides".**
It lives in one place, `inject`, and resolves one way, `missingOf` and
`reconcile`. H1 is the same concept spelled a second way: a string id
handed to `CoreInvoke`, which the kernel cannot see. Rule 1 says collapse
the two, not add a third. "Dependencies are derived, never declared" stays
true: `inject` is the declaration the kernel reads, never a list beside the
code.

**The widening:**

- **What the key is.** A key may stand for a contribution at a point, as
  well as for a service. For an action that is the `kb.actions`
  contribution with a given id.
- **When it counts as provided.** The kernel treats such a key as provided
  while some applied plugin holds a contribution with that id at that
  point. `contributions` and `lookup` already answer this.
- **What the kernel gains.** `missingOf`, `reconcile` and `dependencies()`
  learn one generic case: "provided" means held at the point. They learn
  nothing about actions.
- **What `ctx.get` returns.** For an action key it returns a typed invoker
  over `CoreInvoke`, so the caller gets the action's input and output
  types. Today it hand-parses the output, as `run.ts:214` does.
- **Where the key lives.** In a layer both families may import (§4.4),
  created once, with the id and the two schemas.

**What canvas would look like.** Canvas's run verb becomes a child,
`canvas/model-run`, that injects `CompleteTurn`. With the agent off, the
child pends:

- the verb leaves the catalog, and with it MCP's tools and the agent's;
- `kb ext list` shows `canvas/model-run` missing `ext.agent.complete`;
- `kernel.dependencies()` carries the edge.

The canvas itself is untouched. This is the lab's graph studies (§1.3),
reused, and it removes the "fails by name" path rather than adding to it.

**Restructure, then add.** In Rule 1 order:

1. **Restructure.** Move the action ids canvas calls into keys and have
   canvas call through them, with behaviour unchanged.
2. **Add.** Make those keys injectable, and carry each optional call on a
   child.

**H4, the edge between kernels, is the part that does not fit yet.** A key
injected in the registry cannot be satisfied by a contribution in the
`kb ui` host's kernel. There are two honest options:

- **(a)** The registry's view of "provided" reads the catalog the invoke
  core can reach, which already spans the hosted families when `kb ui`
  runs. That makes the kernel read something that is not its own.
- **(b)** The family the call depends on is composed in the same kernel as
  its caller. Gap `01M43H3T8XEMTNBARC024PZD2W` ("a family a host composes
  is switched only where that host runs") is the same split seen from the
  switch.

This record does not choose. It files the gap (§7, G7), and the owner
should decide (§8, Q2).

### 4.2 Data dependants: a query, not a mirror

A family's seeded nodes carry `:node/owner`. Every ref, whether a
`[[id]]` token, a ref value or a carrier, is a `:node/mentions` datom. So
"which nodes outside family F point into what F seeds" is one query:

```clojure
[:find ?n ?m
 :in $ ?family
 :where [?e :node/id ?family]
        [?m :node/owner ?e]
        [?n :node/mentions ?m]
        (not [?n :node/owner ?e])]
```

It already runs today (§1.4, H2). It is the kb-native answer to the
question no other system in §3 can answer, "what of my data will show as
unavailable". It is read, never stored, like the footprint
(DESIGN.md → "A family's footprint is read, never stored").

### 4.3 Impact before a switch: one read action, not a flag

The switch must not grow a `dryRun` boolean. Rule 1 lists a boolean that
forks an existing function's behaviour as a symptom. The impact is its own
read: **`extension.impact {name, on}`**, which answers with what the switch
would change, grouped by policy:

- **pauses**: plugins that would go to `pending`, each with the key it
  waits on. These are the reverse edges of `dependencies()` over the
  family's provided services and contributions, in every kernel this host
  holds (`FamilyKernels`). A child that pends while its parent stays is
  listed as such.
- **degrades**: the count of nodes outside the family that reference its
  seed (§4.2), grouped by the kind of the referenced node: view, backdrop
  option, design system, other.
- **resumes**: for `on`, the pending plugins it would satisfy.

The switch stays the one write. Every surface reads the same action:

- **The page's Settings.** Before it writes an off, it shows the impact
  when it is not empty, for example: "Switching the agent off pauses
  canvas's Run (needs `ext.agent.complete`). 3 nodes will show as
  unavailable. Nothing is deleted. [Switch off] [Cancel]".
- **The CLI.** `kb ext impact <name> [--on]` prints it. There is no
  `kb ext switch` today, because the switch is reached as an action
  through `kb action-invoke`. If one is added, it prints the impact after
  it writes.
- **MCP and the agent.** They get it as a read tool, so an agent asked to
  switch something off can say what will happen first.

It never refuses. The policies stay the kernel's (cascade and rebind) and
the view's (degrade). This is Jenkins's closure computed by the lifecycle
owner (§3.2 item 5), with Fuchsia's stance that nothing is refused.

### 4.4 Kits for shared code, services for shared runtime

The fence makes cross-family imports impossible. When two families need
the same thing, there are two exits, and the right one depends on whether
the thing has a lifecycle:

- **Code with no lifecycle → a kit.** Helpers, a stateless scene builder,
  the GPU backdrop host as a per-mount function with its scene registry
  passed in. This is gap `01M5SYY397F5NPN3CHWGCSPQSY`'s `closes`. A kit is
  bundled into each consumer, so switching a family off cannot take it
  away. A kit must name no family (H5).
- **Runtime with a lifecycle or a singleton → a service.** One GPU device
  shared by every backdrop, or a lens graph (`NodeLinkGraphService`), is
  provided by one plugin and injected by the others. It then goes through
  §4.1, and its absence pends rather than crashes.
- **Ids → a key or a point.** These are never copied. Gap
  `01M436DVSEHKNYWSF2MR07HPMR` already names the shape: a bullet-kind point
  the canvas contributes to.

The keys §4.1 introduces need a home both families may import. The
candidates are `@kb/contracts`, where `ActionPoint` and `UiHost` live, or
`@kb/ui-sdk`, where `NodeLinkGraphService` lives. There is a tension with
"Core names no feature": a key named `CompleteTurn` names a capability,
not a provider family. The record recommends `@kb/contracts` for
cross-family action keys, because the capability is part of the
action-registry contract, and leaves the call to the owner (§8, Q1).

### 4.5 Lints that make hidden coupling go red

Each lint uses the soft-rule mechanism AGENTS.md prescribes: at error, with
a pinpoint `GAP` disable on each site.

- **L1 — no foreign action id.** A string literal matching
  `ext.<f>.<id>` inside a package of family `g ≠ f` fails. Today it has 4
  sites, all in `ext-canvas`. It belongs in `harness/lint/` beside
  `design-tokens`, and reads the family from the package's `family:` tag.
- **L2 — no foreign seed id.** A string literal equal to a node id whose
  owner (`bundledOwners()`) is another family, or core when the literal is
  in a family package's own non-seed code, fails. This catches the
  `sys.tag.canvas` copy. It is a harness test rather than an oxlint rule,
  because it reads the fold.
- **L3 — inert module top level.** The page and server entries of a
  family, and any repository extension module, may not run effects at top
  level. That means no call outside a declaration, and no write to
  `globalThis`, `window` or `document`. Admission already reads the bundle
  as text (`LOADS_CODE`), so the cheapest form is a lint over the source.
  This keeps DESIGN.md's "a switch does not stop module code" from ever
  mattering.

### 4.6 A switch matrix, generalising the core-only run

`packages/app/runtime/tests/core-only.test.ts` proves core stands alone. Its
generalisation proves every family stands without each other one. For each
optional family `F`, compose each host (the registry, the `kb ui` host and
the page) with every family on except `F`, then assert three things:

- every plugin of another family is `active`, or `pending` only on a key
  whose every provider is `F`'s, and then exactly as `extension.impact`
  predicted;
- every read action of the registry answers without an internal failure;
- no plugin is `failed`.

That is N compositions, sixteen families today, each cheap. It is the
contract suite for "switching one off never breaks another" (DESIGN.md →
"The family is the unit"). That sentence is currently enforced only by the
import fence, which cannot see H1.

## 5. Recommended design

### 5.1 Manifest (the declaration)

There is **no new field.** `defineExtension` stays as it is, and
`Plugin.inject` widens from service keys to service-or-contribution keys
(§4.1). The family's dependency on another family is the union of its
plugins' injects, as `organisationOf` already computes.

### 5.2 `kb ext validate` (admission)

Admission already composes every family on. It adds three checks, each of
which fails `verify`:

- **unprovided**: an injected key that no family in the composition
  provides, even with every family on. Today that is the run-time
  `nobody yet`. With everything on it means a typo, or a dependency on a
  family that does not exist.
- **cycle**: plugins that wait on each other, so none can ever apply. The
  kernel today leaves them pending forever and silently.
- **required on optional**: a top-level entry plugin, not a child, that
  injects a key only an optional family provides. The whole family would
  pause with that family, which is almost always meant to be a child. It
  is a warning with the fix named, and becomes an error once the existing
  sites are moved.

The switch matrix (§4.6) is a test, not part of admission. It runs in
`bun run test` like core-only.

### 5.3 `kb ext list` and `kb ext graph` (visibility)

**One report, read three ways.** `extension.list` rows gain two columns:

- `dependants`: the reverse of `injects`, each with the key;
- `referencedBy`: §4.2's count.

A new read action, `extension.graph {name?}`, returns the edges, so the
CLI, MCP and the page draw one thing. Each edge is
`{from, to, key, kind: "service" | "action" | "contribution", optional, source}`,
plus data edges `{from: family, to: family, nodes: n}`.

The surfaces:

- `kb ext graph` prints it as a list.
- `kb ext graph --dot` prints it as Graphviz.
- `kb ext why <plugin>` prints the `diag` view: why this plugin is not
  active, which key, and who would provide it.

**In the page, the graph is a projection, not a new surface.** Every
family already has a node, `sys.extension.<name>`. The extension graph is
a lens of the graph view over the `sys.extensions` list, with the derived
edges read from `extension.graph` and drawn like any edge. That is "kb is a
graph of everything" applied to kb itself.

Settings' extension rows show the pending reason inline, for example
"Run — waiting for `ext.agent.complete` (agent is off)". This makes the
`missing` that `kb ext list` already reports visible where the switch is.

### 5.4 The UI on unload or disable

- **Off.** The switch reads `extension.impact`. When it is empty, the
  switch writes straight away, as today. When it is not, Settings shows the
  impact and asks once (§4.3). It never refuses an optional family.
- **On.** The switch shows what resumes, without asking.
- **Afterwards.** Each pending plugin keeps its reason visible in Settings,
  and each degraded view keeps its existing "cannot be shown here" state
  (`ViewNotLoaded`). That state gains a link to the family's switch, so the
  person can switch it back on where they see the loss.
- **Required families.** Unchanged: refused, with the reason.

### 5.5 Against Rule 1 and "one contract, every implementation"

**Rule 1:**

- **One mechanism per concept.** `inject` is the only way to need
  something, and string invocation of another family's action goes away
  (H1). There is no manifest list beside it (§3.3).
- **Bridges over mirrors.** Copied ids become keys or points (H3).
  Dependants and data counts are read from the kernel and the index,
  never stored.
- **No boolean that forks a function.** The impact is a read action, not a
  `dryRun` on the switch.
- **A dead seam is a duplicate.** `kernel.dependencies()` is a seam that
  reads as covered while every registry row is empty. Routing H1 through
  it is what makes it true.

**One contract, every implementation.** "Switching an optional family off
pauses or degrades its dependants and never fails them" is a promise of
the family model, kept by three hosts. It belongs in DESIGN.md → Extension
families, stated once. It is proved by one suite over the registry, the
`kb ui` host and the page (§4.6), and by no host-specific test. Each of
the three kernels is an implementation of the same `@kb/plugin` contract,
so the kernel's own properties join the same suite. Those properties are
pending on provider loss, rebind on return, and now contribution keys.
That is item 6 of the Cordis survey.

## 6. Phased plan

| Phase | What | Rule 1 commit order | Size | Closes |
| --- | --- | --- | --- | --- |
| **P0** | Visibility with what exists. Add `dependants` and `referencedBy` to `extension.list`. Add `extension.impact`, with Settings' confirm and the CLI print. Add `extension.graph` with `kb ext graph`, `--dot` and `kb ext why`. Show pending reasons in Settings | add only (reads) | M | G2, G4, G6 |
| **P1** | The switch matrix test (§4.6). It should go green on `main` except for H1, whose cases are named with `GAP` until P2 | add | S | G3 (partly) |
| **P2** | Contribution keys in `inject`. (a) Restructure: give canvas's 4 action ids keys and call through them, behaviour unchanged. (b) Add: the kernel resolves contribution keys; canvas's run, scripts and diagram verbs become children that inject them. Add L1 | restructure, then add | M | G1 |
| **P3** | Admission: unprovided, cycle, and required-on-optional (§5.2). Add L2 and L3 | add | S–M | G5 |
| **P4** | The cross-kernel edge (H4), after the owner's call on §8 Q2 | restructure | M–L | G7 |
| **P5** | Shared runtime out of families. Move the GPU host to a kit, or to a service if it must be a singleton (§4.4), and add the bullet-kind point | restructure | M | `01M5SYY397F5NPN3CHWGCSPQSY`, `01M436DVSEHKNYWSF2MR07HPMR` |
| **P6** | The extension-graph lens in the graph view | add | M | — |

P0 and P1 need no decision and remove most of the risk the owner named,
because a person is now told what a switch will do. P2 is the structural
fix.

## 7. Gaps filed

These are filed as `#gap` nodes in `.kb/nodes.jsonl` and rendered in
`docs/rules.md`. None has a code site to mark yet, because no workaround
was written for them. They record what is missing, and each `closes` names
its phase.

- **G1** `01M63BZRZ4RDTCE1ZFVGRNEXGR` — Cross-family action calls by string id are invisible to the
  dependency graph.
- **G2** `01M63C0GJ5M78G1TFKM00RN4X6` — Switching a family off says nothing about what depends on it.
- **G3** `01M63C0H8G86X7ZBJ48QYYNSAV` — No test holds that switching one optional family off leaves the
  others whole.
- **G4** `01M63C0HZMR1ZSS95YZGJ868PR` — Nodes that reference a family's seed are not counted or shown
  before it is switched off.
- **G5** `01M63C0JP6WDX8CZ0VBPYQY4ER` — Nothing flags another family's action id or seed id spelled as
  a string.
- **G6** `01M63C0KBWMK32SCH1E7AN7BWH` — The extension dependency graph has no command, view or reverse
  edges.
- **G7** `01M63C0M1WRKY0Q09AGK9NK7NJ` — A dependency from one kernel to a family another kernel
  composes cannot be an edge.

## 8. Questions for the owner

1. **The home of cross-family keys.** Should they live in `@kb/contracts`,
   beside `ActionPoint`, or should each capability have a small contract
   package? The second is closer to OSGi's "API bundle separate from the
   implementation", at the price of more packages. The record recommends
   `@kb/contracts` until a second capability family exists.
2. **The kernel edge (H4).** Should the registry see the hosted families'
   contributions when it resolves (a)? Or should a family that another
   needs be composed beside it (b)?
3. **Impact confirmation on.** Should Settings ask before every switch-off
   with a non-empty impact? Or should it only show the impact afterwards,
   as a dismissible note? The record recommends asking, since the action
   is reversible but the person may not know what it touches.

## Sources

kb (at `6ce987e`): every `file:line` above. Also:

- `docs/brainstorms/2026-10-16-kb-cordis-layers/README.md` (DeepSeek
  Harness and Cordis, read from source on 2026-10-16);
- the output of `bin/kb ext list --json` and the datalog query in §4.2,
  run on this repository's store.

Primary, fetched 2026-10-29 unless marked:

- OSGi Core R8, module layer: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.module.html
- OSGi Compendium R8, Declarative Services: https://docs.osgi.org/specification/osgi.cmpn/8.0.0/service.component.html
- OSGi PackageAdmin: https://docs.osgi.org/javadoc/osgi.core/8.0.0/org/osgi/service/packageadmin/ExportedPackage.html
- VS Code extension manifest: https://code.visualstudio.com/api/references/extension-manifest
- VS Code activation events: https://code.visualstudio.com/api/references/activation-events
- VS Code extension host: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code extension management source (dependant-disable, to confirm): https://github.com/microsoft/vscode/tree/main/src/vs/workbench/services/extensionManagement
- IntelliJ plugin dependencies: https://plugins.jetbrains.com/docs/intellij/plugin-dependencies.html
- IntelliJ dynamic plugins: https://plugins.jetbrains.com/docs/intellij/dynamic-plugins.html
- IntelliJ plugin configuration file: https://plugins.jetbrains.com/docs/intellij/plugin-configuration-file.html
- Theia services and contributions: https://theia-ide.org/docs/services_and_contributions/
- Theia extensions: https://theia-ide.org/docs/extensions
- EclipseSource, Theia extensions vs plugins (secondary): https://eclipsesource.com/blogs/2019/10/10/eclipse-theia-extensions-vs-plugins-vs-che-theia-plugins/
- Emacs, Unloading: https://www.gnu.org/software/emacs/manual/html_node/elisp/Unloading.html
- Emacs, Library Headers (`Package-Requires`): https://www.gnu.org/software/emacs/manual/html_node/elisp/Library-Headers.html
- lazy.nvim spec: https://lazy.folke.io/spec
- lazy.nvim usage: https://lazy.folke.io/usage
- Neovim health: https://neovim.io/doc/user/health/
- Obsidian manifest: https://docs.obsidian.md/Reference/Manifest
- Obsidian plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Dataview, develop against Dataview: https://blacksmithgu.github.io/obsidian-dataview/resources/develop-against-dataview/
- Logseq plugins: https://logseq.github.io/plugins/
- Tana Input API (search only): https://outliner.tana.inc/learn/features/input-api
- Figma manifest: https://developers.figma.com/docs/plugins/manifest/
- Figma `setSharedPluginData`: https://developers.figma.com/docs/plugins/api/properties/nodes-setsharedplugindata/
- Figma, how plugins run: https://developers.figma.com/docs/plugins/how-plugins-run/
- Backstage frontend extensions: https://backstage.io/docs/frontend-system/architecture/extensions
- Backstage frontend utility APIs: https://backstage.io/docs/frontend-system/utility-apis/creating
- Backstage backend services: https://backstage.io/docs/backend-system/architecture/services
- Backstage backend plugins: https://backstage.io/docs/backend-system/architecture/plugins
- Backstage backend extension points: https://backstage.io/docs/backend-system/architecture/extension-points
- Grafana `plugin.json`: https://grafana.com/developers/plugin-tools/reference/plugin-json
- Grafana UI extensions reference: https://grafana.com/developers/plugin-tools/reference/ui-extensions-reference/ui-extensions
- Grafana, use an exposed component: https://grafana.com/developers/plugin-tools/how-to-guides/ui-extensions/use-an-exposed-component
- NixOS manual: https://nixos.org/manual/nixos/stable/
- Erlang `.app` file: https://www.erlang.org/doc/apps/kernel/app.html
- Erlang `application`: https://www.erlang.org/doc/apps/kernel/application.html
- Fuchsia, availability: https://fuchsia.dev/fuchsia-src/concepts/components/v2/capabilities/availability
- Fuchsia, connect: https://fuchsia.dev/fuchsia-src/development/components/connect
- Fuchsia, protocol capabilities: https://fuchsia.dev/fuchsia-src/concepts/components/v2/capabilities/protocol
- Atom flight manual, services: https://raw.githubusercontent.com/atom/flight-manual.atom.io/master/content/behind-atom/sections/interacting-with-other-packages-via-services.md
- Jenkins, dependencies and class loading: https://www.jenkins.io/doc/developer/plugin-development/dependencies-and-class-loading/
- Jenkins `PluginWrapper.java`: https://github.com/jenkinsci/jenkins/blob/master/core/src/main/java/hudson/PluginWrapper.java
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- Cordis primer (Harness): https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.md
- Cordis: https://github.com/cordiverse/cordis

Zed, Helix and the WASM component model are from the gatherers' memory and
are marked unverified in the matrix.
