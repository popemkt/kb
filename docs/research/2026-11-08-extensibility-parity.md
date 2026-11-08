# Extensibility parity with DeepSeek Harness: extending and replacing the editor

Date: 2026-11-08. Base: `main` at `bc7ad490`. A research record; no code
changed. It answers the owner's ask: *"I want as good as dsh, since at some
point we want to extend the editor, or cover editor. I thought we have a
good architecture there, that's why editor is a plugin as well."*

It builds on these records and does not restate them:

- the Cordis and dsh survey: [`docs/brainstorms/2026-10-16-kb-cordis-layers/`](../brainstorms/2026-10-16-kb-cordis-layers/README.md)
  ("the survey");
- the map of every point and service, and its ranked findings:
  [`2026-10-20-extension-points-mece/`](2026-10-20-extension-points-mece/README.md)
  ("the MECE map", findings cited as "MECE n");
- installing, trust and the threat table T1–T15:
  [`2026-11-06-plugin-install-plan.md`](2026-11-06-plugin-install-plan.md)
  ("the install plan");
- the isolation tiers T0–T3: [`2026-11-08-plugin-ui-isolation.md`](2026-11-08-plugin-ui-isolation.md)
  ("the isolation record").

Sources. kb claims are read from the code at `bc7ad490` and cited
`path:line` from the repository root. dsh claims are read from
`deepseek-ai/deepseek-harness` at `master` `fcc0ad4621` (2026-11-04), files
named in each row. A claim I inferred and did not read says so.

## 0. The answer in one screen

The editor already being a plugin is the right foundation, and it is not
enough. Today the outline *consumes* the kernel: it contributes views,
commands and palette steps, and it provides three services
(`packages/extension/outline-ui/src/plugin.ts:96-112`). It *mints* almost
nothing that another plugin can contribute to, and every service it
provides can be held by nobody else. To "extend the editor, or cover it",
kb needs four mechanisms, then the editor's points on top of them:

1. **Declared points.** A point states its cardinality, its combination
   rule, the kernel that reads it and its isolation tier, and the kernel
   enforces what it can. Any plugin, bundled or installed, may declare one
   in its own namespace, and others reach it by name. This closes MECE 3
   and MECE 11, and it is what dsh's slot declarations are (§2.1, §4).
2. **Roles that a person may let an extension replace.** A service or a
   single-cell point marked replaceable holds a ranked set of candidates.
   An extension's declaration says `replaces: <role>` with a priority. A
   person approves that line on the trust sheet. The kernel elects the
   winner and falls back to the next one when the winner fails. Without
   approval a second provider is still a `service-conflict` (§5).
3. **`tx/after`.** A point in the registry kernel, fed after the outermost
   committing call settles, whose reactions write only through the invoke
   core, under budgets and a depth cap (§6, MECE 2).
4. **A page SDK confined by value.** Today a page half receives the whole
   `@kb/ui-sdk` at run time (`packages/app/ui/src/ui-plugins.ts:234-242`).
   The narrower `kb-ext-sdk/page` exists only as types. That has to be
   fixed before the surface grows (§1, finding A).

On those, the editor mints eight seams (§3). Most are *not* new points:
block renderers become a `row` placement of the existing views, the node
menu becomes a facet of commands, and field editors become a keyed point
over field types, which are already nodes. Each seam names its
cardinality, combination, kernel and tier.

What stays refused, with reasons: YAML patch layers and profiles, `isolate`
and `intercept` realms, per-agent scope, a generic `emit`, `hoc` slots, and
anything that lets an extension grant approval or take a bundled name (§2,
§7).

## 1. Where kb stands, verified

| Fact | Where |
|---|---|
| Two kinds of key: a service (one provider) and a point (many contributions). Neither carries cardinality, combination or host. | `packages/domain/plugin/src/keys.ts:17-35` |
| A second provider is refused, `service-conflict`. | `packages/domain/plugin/src/kernel.ts:379-401` |
| Keys compare by identity; a second key object with the same name is `key-mismatch`. | `kernel.ts:264-275` |
| A contribution's id is namespaced and unique within its point (`contribution-conflict`). Readers get load order; there is no priority. | `kernel.ts:418-456`, `kernel.ts:496-502`, DESIGN.md:5628 |
| A failed `apply` leaves nothing behind. A plugin whose injected service leaves goes back to `pending`. | `kernel.ts:304-324`, `kernel.ts:292-302` |
| The kernel has no events. | DESIGN.md:3066 |
| 23 points and about 11 service keys today (by grep of `Point<…>()(` and `Service<…>()(`). New since the MECE map: `kb.context`, `ui.backdrop-actions`, `gallery.model`, `gallery.moodboard`, and services `ui.board` and `ui.model-completion`. | `packages/contract/contracts/src/context.ts:28`, `packages/kit/ui-sdk/src/lib/plugins.ts:478`, `packages/extension/gallery-ui/src/model.ts:57`, `packages/extension/gallery-ui/src/moodboard.ts:14` |
| The server SDK is confined by value: `kb-ext-sdk` is an object listing exactly what it serves. | `packages/contract/contracts/src/extension.ts:146-171` |
| The outline is one plugin. It provides the page's projection, its editor store and the field editor, and contributes views, the Pinned section, commands, palette steps and one overlay. | `packages/extension/outline-ui/src/plugin.ts:79-116` |
| Installed extensions may not take a bundled name. | `packages/app/runtime/src/installed-extensions.ts:25-27,33-34,70-72` |

Three findings this record adds to the MECE map.

**A. The page SDK confines by types only.** `installPageModules` serves
`"kb-ext-sdk/page": uiSdk`, the whole `@kb/ui-sdk` namespace
(`packages/app/ui/src/ui-plugins.ts:234-242`). `page-surface.ts` declares a
subset (`packages/contract/ext-sdk/src/page-surface.ts:1-10`), but at run
time a page half can read `FieldEditorService`, `PaletteStepPoint`,
`PageEditorService` or `BrowserHostService` by name and contribute to
them. So "a third party cannot contribute to `ui.palette-steps`" is true of
what is advertised, not of what runs. The server is different: it serves
`EXTENSION_SDK`, a value (`packages/contract/contracts/src/extension.ts:146`).
This is the same honesty gap as `#gap` `01M6WVFMGB5PP2AANF0E5R921V`, at the
level of keys rather than the DOM. A T3 half has the page's power anyway,
so this is not a new hole. It does mean that the SDK's shape is not yet an
enforcement point, and every power below that is "exposed through the
SDK" has to be exposed by value.

**B. A point an extension mints is unreachable by any other extension.**
The SDK exports `Point` and `Service`
(`packages/contract/ext-sdk/src/surface.ts:590-591`), so an extension can
mint a key. Another extension cannot import that key object: an installed
closure resolves only inside its own tree (install plan T8), and
`HOST_MODULES` serves only kb's modules. Minting a second key with the same
name is `key-mismatch` (`kernel.ts:264-275`). Today, "family-minted points"
(`graph.themes`, `lab.studies`) work only because the family's own
packages share one build.

**C. The editor's per-row behaviour is mostly closed tables.**
- The keymaps are data tables read first-match: `EDITING_KEYMAP`
  (`packages/extension/outline-ui/src/editing-keymap.ts:230`) and
  `SELECTION_KEYMAP` (`selection-keymap.ts:126`), through `lookupChord`
  (`packages/kit/ui-sdk/src/lib/keychord.ts:84-90`). The global ⌘K is a
  fixed function (`packages/app/ui/src/lib/keyboard-shortcuts.ts:12-20`).
- Field types are option nodes, children of `sys.f.fieldType`, but the set
  is closed in code: an unknown option reads as `text`
  (`packages/domain/model/src/field-type.ts:29-38,165-171`). So is the
  slot behaviour per kind (`VALUE_KINDS`,
  `packages/extension/outline-ui/src/value-kind.ts:120`).
- Node text has no paste handler. Drop handles files only
  (`packages/kit/ui-sdk/src/components/node-text-host.tsx:312-329`).
  Typing `/` at the start of an empty row opens the node palette
  (`node-text-host.tsx:351-369`).
- The row's chrome is resolved inside the outline
  (`packages/extension/outline-ui/src/node-block.tsx:134`).

They are tables already, which makes them cheap to open (§3).

What does exist, and should be reused rather than duplicated: a tag can
name the view its nodes open in (`tagDefaultViews`,
`packages/contract/ext-sdk/src/surface.ts:340-345`; the first tag holding
one wins, `packages/domain/views/src/node-view.ts:237-250`). A view may
draw a read-only preview under the row (`placement: "preview"`,
`packages/kit/ui-sdk/src/lib/plugins.ts:58-67`;
`packages/extension/outline-ui/src/node-block.tsx:205`). And the placements
`card`, `beside`, `float` and `hover` are an open gap
(`01M3EZR20H0CDF5MD01M2S26C5`, cited at `plugins.ts:65`).

## 2. dsh/Cordis and kb, side by side

One row per mechanism: what dsh does, what kb has, what kb lacks, the
verdict, and why. The survey's October non-adoptions assumed "kb's
extensions are repo-local and trusted" (survey, Non-adoptions). Since the
install plan they are not, so each refusal is re-argued here, not just
repeated.

### 2.1 Slots with cardinality and scope — **adapt**

- **dsh.** The component that renders a location declares a child slot
  (`docs/subsystems/slots.md`, "Declaration and lifecycle"). The
  declaration fixes cardinality (`single | list | keyed | chain | hoc`)
  and scope (`root | session-maybe | session`). Registering into an
  undeclared slot fails at activation, and disposing the owner collapses
  its children. `priority` is a shadowing rank: lower renders first. "Intentionally reusing a shipped cell replaces its presentation"
  (same page, "Cardinality and scope").
- **kb.** A point is a name and a type (`keys.ts:24`). Contributing to a
  point nobody reads succeeds silently (MECE 3). Combination is the
  reader's (MECE 11). There is no owner, so there is nothing to collapse.
- **Missing.** Declared cardinality and combination, a declared host
  kernel, an owner whose unload retires the point, and a way to replace a
  cell.
- **Verdict.** Adapt cardinality, combination and owner as a `PointSpec`
  (§4). Adapt `priority` only where a person approved a replacement (§5).
  Unapproved shadowing, which dsh allows to any plugin, is refused: in kb
  an installed extension comes from a stranger, and replacing a shipped
  cell is a power the person should see. Refuse `hoc` (§4.2).
- **Scope.** kb's analogue is the kernel (registry, server, page). A
  point's spec names it, and contributing in the wrong kernel is refused.
  dsh's `session` scope is per-conversation state handed to occupants. kb
  hands per-render context as props (a row's node id and instance key),
  and needs no kernel concept for it.

### 2.2 Service swap and capability seams — **adapt**

- **dsh.** One provider per service name in a scope, as in Cordis. A swap
  is a profile patch that disables one entry and enables another. "A seam
  is a swappable capability with three roles … one role alone is not a
  seam" (`docs/architecture.md`, "Capability seams"). Per-preset realms
  use `isolate` (same file, "Where new behavior goes").
- **kb.** `service-conflict` (`kernel.ts:388-394`). The design says
  "another implementation is another provider, chosen by configuration"
  (DESIGN.md:5612). But nothing chooses among providers: the outline
  provides `FieldEditorService` whenever it is loaded (`plugin.ts:99`), so
  the only way to replace it is to switch the whole outline off. Three
  other "implementations" arrive as factory arguments (MECE 7).
- **Missing.** A choice among candidates that does not need the
  incumbent's family switched off. A declared fallback.
- **Verdict.** Adapt as roles (§5): a replaceable service holds ranked
  candidates, the election is data, approval is a person's, and fallback
  is the kernel's. Copy "one role alone is not a seam" into the kernel
  contract suite: a replaceable role must have a definition (its key and
  spec), a default provider, and at least one consumer reading through the
  fallback boundary. Refuse `isolate` (DESIGN.md:5665): nothing needs two
  live implementations of one name at once.

### 2.3 Patch layers and profiles — **refuse the layers; keep kb's scopes**

- **dsh.** An app is composed at boot from a profile, its bundles, the
  profile's `cordis.patch.yml`, a home patch and `--patch` overlays. A
  patch replaces a row's config or inserts rows
  (`packages/boot/app-boot/README.md`, Summary).
- **kb.** Selection already has three ordered scopes, store, local and user,
  with nearest-wins discovery (DESIGN.md, Core boundary & extensions →
  Installed extension state). Configuration is fields on
  `sys.extension.<name>`, merged by id (`mergeNodeSets`). A role's elected
  provider (§5) is one more field, so it merges, travels with the store
  and has history.
- **Verdict.** Refuse YAML layers, for the survey's reason: they would
  mirror the store. The one thing worth taking is `dsh --dump-config`, the
  effective tree printed without booting. kb's `extension.list` is close
  to it already. It gains each point's spec and each role's candidates in
  election order (§4, §5).

### 2.4 Scoped registration — **refuse for now**

- **dsh.** A `ScopeKey` (the live agent) makes one registration context
  carry both visibility and lifetime, and a scoped entry shadows its global
  twin (`docs/subsystems/scope.md`).
- **kb.** Lifetime yes: a child plugin unloads with its parent
  (`kernel.ts:346-377`). Visibility no.
- **Verdict.** Refuse. The editor's need for "this renderer only here" is
  subject scoping (a tag, a view, a field type), and kb expresses that as
  data on the contribution's key. No kernel scope is needed for it. Revisit
  when a kb agent needs its own tool set (survey, Non-adoptions).

### 2.5 `emit` and events — **adapt one point, refuse the bus**

- **dsh.** Durable session events, live `agent/*` events, and capability
  events (`fs/*`, `tools/*`) that attach policy to a seam
  (`docs/architecture.md`, "Events"). Each event documents its dispatch
  mode, and tooling checks it (survey, layer 9). Cordis offers
  `emit | parallel | serial | bail | waterfall`.
- **kb.** `on`/`emit` were deleted for lack of a consumer (DESIGN.md:3066).
  `bail` and `waterfall` live as combination rules of the identity and
  interception points (MECE §5). Durable change is the transaction log
  (`packages/contract/contracts/src/tx-log.ts:34-87`), which plugins
  cannot read (DESIGN.md:5638-5654).
- **Verdict.** Adapt by adding exactly one point, `tx/after` (§6), with
  its dispatch mode in its `PointSpec`. That is dsh's `@mode` tag,
  checked by the kernel rather than by a comment linter. Refuse a generic
  bus. DESIGN.md's rule stands: an event key returns with its first
  consumer, and `tx/after` is the first.

### 2.6 HMR — **mostly present; adapt one dev loop**

- **dsh.** `dsh-hmr` serialises module replacement, Include refreshes and
  profile changes in one queue. "A replacement that fails to load stops
  the previous plugin and is reported as `failed`"
  (`packages/boot/hmr/README.md`, "Use this package").
- **kb.** Live in every case that changes bytes through a lock or trust:
  - lock changes from any process are followed, and the registry and page
    converge (DESIGN.md, Installed extension state; `syncUiPlugins`,
    `packages/kit/ui-sdk/src/lib/plugins.ts:605-614`);
  - trust is read on every load;
  - page halves are addressed by digest, so new bytes are a new import.

  kb is stronger than dsh on failure: `apply` is atomic, so a failed
  replacement can leave the old plugin standing. dsh stops it. Missing: a
  watcher over the root's own `.kb/extensions/`. A module cannot be
  un-imported (DESIGN.md:3044), so a long dev session accumulates dead
  module instances.
- **Verdict.** Adapt a dev-only watcher for the root's own folder (a late
  build step). Every save is a new digest, so the person trusts again. That
  stays: an agent must never get a path that skips it (Q9).

### 2.7 Admission — **adapt by capability, not by version**

- **dsh.** `engines.dsh` and DSH peers are checked before import, with
  per-version exemptions (`allow-version`) and a risk warning
  (`packages/boot/plugin-manager/README.md`). Code is not reviewed or
  trusted per digest.
- **kb.** Stronger on code:
  - a person trusts each digest (install plan §4);
  - the closure is text-checked (DESIGN.md, A text check);
  - bundled names are refused;
  - `kb ext validate` runs in `verify`.

  Weaker on compatibility: an installed extension depends only on host
  keys (install plan §9), and nothing checks before import that those keys
  exist.
- **Verdict.** Adapt admission keyed by capability. A declaration lists
  what it reaches, as data the trust sheet can read without running code:
  - `uses`, the declared points it contributes to beyond core's;
  - `replaces`, the roles it asks for;
  - `reacts`, its `tx/after` matches.

  Admission refuses a `uses` or `replaces` that names no point or role this
  kb declares, before import. That is `engines.dsh` without semver: the
  question is whether the thing it plugs into exists, not which version
  is running. Refuse exemptions; the person's gesture is trust.

### 2.8 Summary

| dsh mechanism | kb today | Verdict |
|---|---|---|
| Slots: cardinality, scope, owner | flat points, reader decides | **adapt**: `PointSpec` (§4) |
| `priority` shadowing | none | **adapt**, only for approved roles (§5) |
| `hoc` layers | none | **refuse** |
| Service swap via patch | `service-conflict`, no choice | **adapt**: roles, election, fallback (§5) |
| Capability seam rule | partial (`extensionContract`) | **copy** into the kernel suite |
| Patch layers, profiles | lock scopes, nodes merged by id | **refuse** layers; print the effective tree |
| Scoped registration | child lifetime only | **refuse** for now |
| Events with modes | none (deleted) | **adapt**: `tx/after` only, mode in spec (§6) |
| HMR | live via locks and trust | **adapt**: dev watcher, late |
| Admission by `engines` | trust per digest, names | **adapt**: `uses`/`replaces`/`reacts` checked before import |
| Vendored, patched framework | own ~550-line Effect kernel | **refuse** (survey) |

## 3. The editor's extension points

The outline family declares these, through §4's mechanism, and the SDK
serves them by value (finding A). The tiers are the isolation record's
(§6 there):
- **T0** data;
- **T1** a drawing returned from sandboxed code under a grant;
- **T2** a canvas scene;
- **T3** page power.

Per the isolation record, the point states the weakest tier that serves it,
and T3 is opt-in, labelled, and not a marketplace default.

"Combination" is how the reader combines contributions. With §4 it is part
of the point, not the reader's private choice.

| # | Seam | Kind | Cardinality | Combination | Kernel | Tier | Built on |
|---|---|---|---|---|---|---|---|
| 1 | Block or node renderers by tag | **placement `row` on `ui.views`** + tag field `sys.f.view.row` | keyed (by view id) | the tag field chooses; first tag of the node holding one wins | page | T1 drawing; T3 to edit in place | `tagDefaultViews`, `heldTagDefaultOf` (`node-view.ts:237`), `preview` placement |
| 2 | Inline marks and widgets | point `outline.inline` | list | non-overlapping claims, by priority, then load; core's refs and markdown first | page | match T0 (a pattern); draw T1 or T3 | `parseInlineSource` (`packages/kit/ui-sdk/src/lib/md-inline.ts:98`) |
| 3 | Keymaps | point `ui.keybindings` | keyed (by context + chord) | one binding per chord per context; an occupied chord needs `replaces` | page | T0 (binding → command or action id) | `EDITING_KEYMAP`, `SELECTION_KEYMAP`, `lookupChord` |
| 4 | Slash and palette steps | existing `ui.palette-steps`, declared | keyed | opened by id; listed by order | page | T0 form (query + action); T3 form as today | `PaletteStepPoint` (`packages/kit/ui-sdk/src/lib/command-point.ts:107`) |
| 5 | Paste and drop handlers | point `outline.ingest` | chain | first claim by priority; the outline's plain-text paste is the fallback | page | match T0 (mime + pattern); transform T1 → a node tree; T3 labelled | `parseOutline` (`packages/domain/model/src/outline.ts:225`), `node.addTree` |
| 6 | Field editors by type | point `ui.value-kinds` | keyed (by field-type option id) | one per type; the 8 built-ins are the outline's contributions | page | spec T0; display T1; editor T3 | `VALUE_KINDS`, `FIELD_TYPE_OPTION_IDS` |
| 7 | The node menu | **facet `menus` on `ui.commands`** | list | grouped, then `order`, then load; `leads` first (as today) | page | T0 (label, icon name, action id, `when` as a query); T3 closure as today | `Command.leads` (`command-point.ts:152-163`) |
| 8 | Outline decorations | point `outline.decorations` | list per anchor | all render, by `order`; at most N per anchor per row | page | T0 (badge text, icon, colour from a field); T1 drawing | `resolveRowChrome` (`node-block.tsx:134`) |

Detail, one seam at a time. Each paragraph says what the contribution
holds, what the outline keeps, and what would be wrong.

**1. Block renderers are views.** "Render a node tagged `#callout` as a
callout" is a view of that node, drawn where its row is. kb has the
pieces:
- a tag names a view (`tagDefaultViews`);
- the first tag holding one wins (`node-view.ts:237-250`);
- a view can draw at a placement other than `page`.

Minting `outline.blocks` beside `ui.views` would be the second mechanism
for "a component that draws a node" that Rule 1 forbids. So:
- `Placement` gains `row`, which joins the placements the open gap
  `01M3EZR20H0CDF5MD01M2S26C5` lists;
- a tag gains a field `sys.f.view.row`, a ref to a view option, beside
  `sys.f.view.default`;
- the declaration gains `tagRowViews`, as it has `tagDefaultViews`.

The outline draws the elected view in place of the row's text while the
row is not being edited. While editing, the text host stays the outline's,
so caret, history and keymaps are never a plugin's.

A view that wants to edit in place is T3. A static one is T1 once the
isolation record's step 9 lands (a `Drawing` returned under a grant whose
`reads` is the subject). The person chooses per tag, because the choice
is a field. Two families claiming one tag is today's fold refusal
(`surface.ts:340-345`), unless §5 applies.

**2. Inline marks and widgets.** A mark is a text pattern drawn
differently (a highlight, inline math). A widget is an atomic token drawn
as an object, as a ref pill is. Text remains the only store: a widget
holds no state outside the node's text and props.
- The matcher runs on every keystroke, so it is T0 data: a regular
  expression with a length cap and no backreferences. Code would run in
  the hot path.
- The drawing is T1 or T3.
- Claims are non-overlapping. Core's ref and markdown spans are priority
  0, so a plugin can never re-render a ref.
- Atomic widgets use the serialized-offset rule refs already use (D06,
  `use-node-keydown.ts:40-42`).

**3. Keymaps.** A binding is data: `{context, chord, run}`. `context` is
`outline.editing`, `outline.selection` or `global`. `run` is a command id
or an action id. Prefer action ids, so the key runs through the invoke
core and its guards (MECE 5).

The outline first gives its intents ids (`outline.indent`,
`outline.split`, …), so that a person can rebind a built-in. That is a
behaviour-preserving restructure of `EDITING_KEYMAP`. Its rows become the
outline's contributions at priority 100. A chord already held in its
context is a `contribution-conflict`, unless the binding declares
`replaces` for that binding (§5). Reserved and unbindable: `Escape`, IME
composition, and the text-history chords
(`node-text-host.tsx:343-349`), so that a plugin cannot trap a person in a
row.

**4. Palette steps.** The point exists. Through the SDK it is served by
value in two forms:
- **T0:** `{label, placeholder, candidates: <saved query>, commit:
  <action id>}`. The host runs the picker. The pick is an action call.
- **T3:** today's `PaletteStep`, with functions.

The T0 form covers "pick a node and do X to the row", the common case,
and needs no page power.

**5. Paste and drop.** Today node text has no paste handler. Multi-line
paste does not become nodes, although the parser exists (`parseOutline`)
and so does the action (`node.addTree`). The point is a chain:
- each handler declares a T0 `match`: mime types and an optional text
  pattern;
- the first match by priority claims the paste;
- its transform maps the clipboard to an outline. The outline is data,
  Tana-paste text or a node tree, and the host commits it through
  `node.addTree`, so a handler never writes.
- the transform is T1: text in, outline out, in the sandbox with
  `connect-src 'none'`. So a paste handler sees the clipboard and cannot
  send it anywhere.

The outline contributes the first handler, Tana paste. The fallback,
plain text into the row, is not a contribution. Drop is the same chain
over `DataTransfer`, and the outline's file attach is its first
contribution.

**6. Field editors by type.**
- **Types.** Field types are already option nodes
  (`field-type.ts:1-12`). An extension declares a new option, a child of
  `sys.f.fieldType` named `<ext>.ft.<x>`. The declared-option namespace
  rule already refuses one outside its namespace
  (`packages/contract/ext-sdk/src/module.ts:75-86`).
- **Storage.** The declaration says which `PropValue` kind it stores in
  (`stores: "str" | "num" | "bool" | "date" | "ref"`), so the store, the
  CLI and datalog change nothing.
- **Behaviour.** `ui.value-kinds` is keyed by the option id. Its value is
  `ValueKindSpec` (`value-kind.ts:75-112`):
  - as data where it can be: editor mode, layout;
  - T1 where it is a pure function: `text`, `parse`;
  - T3 for an editor component.
- **Validation.** It is a commit guard (`ActionGuardPoint`), as MECE 12
  says, so the CLI and MCP refuse what the page refuses.
- **Built-ins.** `fieldTypeOf`'s fallback to `text` becomes "an option
  with no contributed kind reads as text", so a switched-off extension's
  fields degrade instead of breaking.

The whole field editor (`FieldEditorService`) is a separate thing: a
replaceable role (§5).

**7. The node menu.** The node menu is the node palette, opened from the
bullet (`node-block.tsx:102-105`). It lists views, default-view rows and
`ui.commands` contributions. So it needs no new point. A command gains a
`menus` facet (`{where: "node" | "palette" | "global", group, order}`),
the "menu placements as a facet of a command" direction of MECE 10. The
SDK gains `leads` and a T0 command form:
- `{label, icon: <name>, action: <id>, when: <query>}`;
- invoked through the invoke core, as MECE 5 asks.

The SDK's `CommandContext` today exposes only `target`
(`page-surface.ts:171-174`), while the page's has six members
(`command-point.ts:122-130`). The T3 form keeps that restriction.

**8. Decorations.** Anchors: `row.trailing`, `row.gutter`, `bullet.badge`,
`row.tint`. A decoration's `when` is a tag or a saved query, evaluated by
the host. Its content is:
- T0: text, an icon name, or a colour read from a field;
- or T1: a drawing.

Decorations are per-row on the hot path, so T3 is not offered here. At
most N per anchor per row (proposed 3), shown in `order`. A decoration
never takes input. Input is a command, through the node menu.

**What the outline keeps, closed:** the text host, the caret, text
history, the projection and the editor store
(`PageProjectionService`, `PageEditorService`). Those are the editor
itself. Replacing them is replacing the outline: switch it off and provide
another family. That is what "cover the editor" means at the largest
scale, and §5 makes the smaller covers possible without it.

## 4. Declared points

### 4.1 The spec

```ts
interface PointSpec {
  readonly cardinality: "list" | "keyed" | "single" | "chain";
  /** What the reader does, in one line, shown by `extension.list`. */
  readonly combine: string;
  /** The kernel that reads it; contributing elsewhere is refused. */
  readonly kernel: "registry" | "server" | "page";
  /** The weakest tier that serves it; the SDK serves the forms at or above it. */
  readonly tier: "T0" | "T1" | "T2" | "T3";
  /** For keyed points: the member a contribution is keyed by, when it is not the id. */
  readonly keyBy?: string;
  /** Decodes a contribution's data before the kernel accepts it (Standard Schema). */
  readonly contract?: StandardSchemaV1Like;
  /** A person may let an extension replace a cell (§5). */
  readonly replaceable?: boolean;
}
Point<C>()(name, spec)
```

What the kernel enforces, and what stays the reader's:

- **`kernel`.** `makeKernel({host})` knows its host. A contribution to a
  point declared for another kernel fails with a new reason,
  `wrong-kernel`. Closes MECE 3. The channel GAP
  (`01M579MHGHVT2FNGJJRK81J9GY`, DESIGN.md) becomes a refusal at load
  instead of a silent no-op.
- **`single`.** A second contribution is refused, unless it is an approved
  replacement (§5).
- **`keyed`.** A duplicate key is `contribution-conflict`, which closes
  the silent `.find` shadowing of MECE 11 (`lab.studies`,
  `ui.option-previews`).
- **`list` and `chain`.** Order is priority, then load. Priority is
  allowed only where the spec says so; otherwise it is the kernel's order,
  as today.
- **`combine`.** Prose, by design. The kernel cannot run every reader's
  rule, and pretending to would be the dead seam Rule 1 forbids. It is
  printed by `extension.list` beside the contributions in order. That
  extends DESIGN.md's promise of "each point's listeners in that order"
  (the MECE map, §5 item 4) from two points to all of them.
- **`contract`.** Decoded at `contribute`. Data from a stranger is checked
  before any reader sees it, as declared options already are
  (`module.ts:69-86`).

Every existing point states its spec in the first build step. That is a
behaviour-preserving restructure, and it is valuable on its own: it makes
the MECE map's cardinality column a property of the code rather than of a
document. For example:
- `kb.actions`: keyed, registry;
- `action/guard`: list, "strictest verdict", registry and page (a spec
  may name two kernels; DESIGN.md's interception section says both read
  it);
- `identity.providers`: chain, server;
- `ui.backdrops`: keyed, page, T2 once the scene host lands;
- `lab.studies`: keyed by scene.

### 4.2 Why not `hoc`

dsh's `hoc` nests plugin components around the owner's content
(`slots.md`, "Hoc layers"). That is a wrapper around something the plugin
does not own. In kb, it would be a T3 component holding the outline's DOM,
able to read and rewrite every row it wraps, with no tier below it.
Decorations (seam 8) and the `row` placement (seam 1) cover what wrapping
is wanted for, with content that is data or a drawing. Refused. It can be
revisited only for bundled families, and only if a case appears.

### 4.3 Any plugin may declare a point

```ts
// in a plugin's apply
const Studies = yield* ctx.declare<Study>("studies", spec);  // → "<namespace>.studies"
// in another plugin
definePlugin({ name, uses: ["ext.lab.studies"], apply: (ctx) =>
  ctx.point<Study>("ext.lab.studies").pipe(Effect.flatMap((p) => ctx.contribute(p, entry))) })
```

- **Namespace.** A declared point is named in its declarer's namespace,
  as declared options are. A name outside it is refused. Install plan T5,
  name squatting, does not reopen.
- **The kernel holds the key.** `declare` mints the key object inside the
  kernel and records its owner. `ctx.point(name)` returns that same
  object, so identity comparison (`kernel.ts:264-275`) keeps its meaning.
  The key is reached through the kernel, not imported. That closes
  finding B.
- **`uses` waits as `inject` does.** A plugin that lists a point in `uses`
  stays `pending` until the point is declared, and returns to `pending`
  when the declarer unloads, exactly as when a service leaves
  (`kernel.ts:292-302`). One waiting mechanism, not two. This is dsh's
  "disposing an owner collapses its children" in kb's terms.
- **Types.** A bundled family's points are typed in the SDK surface,
  restated and bridge-tested like the rest (`surface-bridge.test.ts`). For
  an installed declarer, v1 asks the contributor to restate the type and
  relies on `contract` at run time. Generating `.d.ts` for installed
  declarers' points is later, and only when a second-party ecosystem
  exists.
- **Migration.** `graph.themes`, `lab.studies`, `gallery.model`,
  `gallery.moodboard` and `ui.palette-steps` become declared points of
  their families. Their behaviour does not change. Their reachability
  does.
- **Report.** `extension.list` (`organisationOf`) shows, per family, the
  points it declares with their specs, and per point, its contributors in
  combination order.

## 5. Covering and replacing

### 5.1 Roles

A **role** is something only one thing can be at a time:
- a service key;
- a `single` point;
- one cell of a `keyed` point, such as a view id, a field-type option, or
  a chord in a context.

A role is replaceable only if its owner's spec says `replaceable: true`.
The owner decides what may be covered, as dsh's slot owner does.

Replaceable, proposed:
- `ui.field-editor`, the whole field row;
- each `ui.views` cell, so the outline's page view `outline.outline`, a
  frame view, or a backdrop;
- each `ui.value-kinds` cell;
- each `ui.keybindings` cell;
- `ui.design-systems` and `ui.backdrops` cells;
- `ui.model-completion`.

Not replaceable, ever (§7.3): `ui.host`, identity, the governance
family's points, the invoke core, `CodeTrust` and everything else a plugin
cannot provide (MECE §3).

### 5.2 The declaration

```ts
defineExtension({
  name: "plain-fields",
  replaces: [{ role: "ui.field-editor", priority: 50, why: "One-line field rows" }],
  …
})
```

- **Data, in the declaration.** Admission checks that each role exists and
  is replaceable before the module is imported (§2.7). The trust sheet
  shows each line. The digest covers the declaration, so a change to
  `replaces` is new code and needs trust again (install plan §4).
- **Bundled names stay reserved.** The extension keeps its own name and
  namespace, and the bundled-name refusal is unchanged
  (`installed-extensions.ts:25-27`). It takes the role, not the name. A
  stored view node naming `outline.outline` still resolves, because the
  role is the key and the elected contribution answers to it, the way
  `chosenDeclared` answers to a declared id (`plugins.ts:588-593`).

### 5.3 Election

- **Candidates.** A role holds a ranked set: the default provider (the
  owner's, priority 100) and each approved replacement (its declared
  priority, default 50). Lower wins, as in dsh.
- **Without approval**, a second provider is `service-conflict` or
  `contribution-conflict`, exactly as today. Nothing changes for an
  extension that does not ask.
- **The person's choice is data.** Each replaceable role is a node
  (`sys.role.<name>`, seeded by its owner). Its field `sys.f.provider` is a
  ref to the elected extension's node. Empty means "the best approved
  candidate". This is "another implementation is another provider, chosen
  by configuration" made real (DESIGN.md:5612): the configuration is a
  field, the field is a node, and switching back is one edit with history.
  Settings lists each role, its candidates and the elected one.
- **Approval** is trust: a person trusts the digest that declares the
  replacement, on the trust sheet, where the line is shown. Electing
  among approved candidates is an ordinary write to the role node. An
  agent may do it; it cannot make an unapproved candidate one.

### 5.4 Fallback

The kernel cannot catch a page component's render error, or a service
function's failure, by itself: services are plain values (`kernel.ts:403-416`).
So fallback is a contract of the consuming site, stated once per role:

- **Page.** Every consumer of a role reads it through `useRole(role)`,
  which renders inside a role boundary (an error boundary). A failure:
  1. reports `kernel.fault(role, provider, cause)`;
  2. demotes the provider for this page session;
  3. re-elects, so the next candidate renders (the default, normally);
  4. shows a toast naming the extension.

  `useFieldEditor` (`packages/kit/ui-sdk/src/lib/field-editor.ts:41-43`) is
  the first consumer to move.
- **Server.** A role service is called through `roleCall`. A defect or a
  budget overrun demotes, as on the page, and the call is retried once on
  the next candidate.
- **Load failure.** A replacement whose `apply` fails is never a
  candidate. Atomic apply already gives that.
- **Demotion lasts until reload, or until a new digest.** It does not
  retry on every render. `extension.list` shows "faulted" with the cause.

The role contract suite proves, over every replaceable role: a throwing
candidate falls back; the default is always a candidate while its family
is on; an unapproved provider is refused. That is "One contract, every
implementation" applied to roles.

### 5.5 Covering the whole editor

To replace the outline view and keep the rest, an extension declares
`replaces: [{role: "view:outline.outline"}]` and contributes a `page`
view. The home, tag openings and pinned rows then open in it.

To replace the editor entirely, including its projection and store,
switch the outline family off. kb already falls back to core's read view
(DESIGN.md, Which families can be switched). Then provide a family that
provides `PageProjectionService` and `PageEditorService`. Both are free
while the outline is off. No new mechanism is needed, and none is
proposed.

## 6. `tx/after`

The after-commit point, MECE 2. DESIGN.md:5652-5654 already sketches it:
"a point fed by the log, after the commit, with the same budgets, failure
rules and nesting limit as the interception points".

```ts
interface TxReaction {
  /** Data: which changes it wants. The host matches; no code runs for a non-match. */
  readonly match: {
    readonly tagged?: readonly NodeId[];      // tag added
    readonly untagged?: readonly NodeId[];
    readonly fields?: readonly NodeId[];      // a value of the field changed
    readonly created?: boolean;
    readonly deleted?: boolean;
  };
  readonly react: (change: TxChange, kb: ReactionHost) => Effect.Effect<void>;
}
// spec: { cardinality: "list", combine: "all, independently, after the commit",
//         kernel: "registry", tier: "T3" }
```

- **When.** After the outermost call that committed settles, not after
  each commit inside it, so a reaction never sees a half-done call. The
  commit point is `persistEffect`
  (`packages/application/operations/src/session.ts:188-207`). It hands
  the committed `KbTx` to the call's frame, and `invokeWith`
  (`packages/application/operations/src/invoke.ts:157`) drains the frame
  when depth returns to 0.
- **Where.** In the process that committed. That covers the CLI and MCP
  (their registries are live while the call runs) and the `kb ui` server
  for page writes. Transactions another process committed and this one
  adopts by `refresh()` (`tx-log.ts:44-53`) do not react, since they
  reacted where they were made. A hand-edited `nodes.jsonl`, recovered by
  diff (`tx-log.ts:55-66`), reacts nowhere, because no call made it. Both
  limits are stated, not hidden.
- **What a reaction may do.** It reads the changed nodes and invokes
  actions through `ReactionHost.invoke`, as actor
  `{kind: "reaction", id}`. Its writes pass the guards and the commit
  rules like anyone's. It is never handed the store or the log.
- **Loops.** A reaction is not fed its own writes. The chain of
  reaction-made commits is capped at depth 4 (`MAX_REACTION_DEPTH`),
  beside `MAX_CALL_DEPTH = 16` (`invoke.ts:150`), and past it the chain
  stops and is reported.
- **Budgets and failure.** Each reaction gets the interception budget
  (`DEFAULT_BUDGET_MS`,
  `packages/contract/contracts/src/interception.ts:124`). A failure or
  overrun is logged and reported in `extension.list`. It never fails the
  call that committed, which has already succeeded. Reactions run
  independently (`parallel`), so one slow reaction does not delay
  another.
- **Approval.** A reaction has no person. An action that requires
  approval answers `approval_required` (install plan §4, "an inner call
  cannot create approval"). So a reaction cannot launder a person's
  approval of the outer call.
- **Delivery.** At most once, in process. If the process dies between
  commit and reaction, the reaction is lost. A durable at-least-once mode,
  with a per-reaction cursor over `since(rev)` (`tx-log.ts:68-83`) kept in
  per-user state and never in the graph (a cursor in the graph would
  write on every transaction), is deferred until a reaction needs it (Q4).
- **The page.** No page kernel reactions in v1. The page already renders
  from the replica. A UI that reacts is a view.

## 7. Trust and isolation

### 7.1 Each new power, mapped

| Power | Tier | Approval | Trust sheet line | Enforced by |
|---|---|---|---|---|
| Contribute data to a T0 point (keybinding, T0 palette step, T0 command, decoration, field-type spec, paste match) | T0 | the extension's trust, as today | "Adds: 3 keybindings, 1 decoration" (derived from the declaration) | `contract` decoded at `contribute`; the SDK serves T0 forms by value |
| A T1 drawing (row view, inline mark, decoration, paste transform, value text/parse) | T1 | trust | "Draws rows of #callout; reads only the row" | the sandbox frame and its grant (isolation record §6) |
| A T3 component (in-place row editor, field editor, value editor, T3 command or step) | T3 | trust, with the page-power sentence | "Runs with the page's power: …" (`reach.page`) | trust only; T3 is never a marketplace default (isolation §6) |
| Declare a point | — | none beyond trust | "Declares: ext.x.studies" | namespace rule; kernel holds the key |
| Replace a role | that role's tier | trust, with the line shown per role | "Replaces: the field editor (outline's), priority 50" | `replaces` in the declaration, checked before import; election is a store field |
| Take an occupied chord | T0 | as replacing a role | "Rebinds ⌘⇧↑ (outline: move up)" | keyed point + `replaces` |
| React after commit | server, owner code | trust | "Reacts when: tagged #inbox" (from `match`) | registry kernel; actions only; depth and budget caps |

### 7.2 Threat table additions

These continue the install plan's T1–T15.

| # | Threat | Fence | Pinned by |
|---|---|---|---|
| T16 | **Role hijack.** A replacement takes the field editor and reads every value it draws. | Replacement needs a person's trust of a digest whose declaration says so, shown per role. The election is a visible store field. `ui.host` and identity are never roles. Honest limit: a T3 page half can already read every field without replacing anything (finding A). Replacing adds visibility, not reach. | role contract suite; trust-sheet test |
| T17 | **Reaction loop or amplification.** Two reactions feed each other, or one write fans out. | Own writes are not fed back. Depth cap 4. Budget per reaction. Report on overrun. | `tx/after` contract: a ping-pong pair stops at depth 4 and the outer call still succeeds |
| T18 | **Reaction launders approval.** A reaction calls an approval-required action after a person approved something else. | Reactions run with no person, so `approval_required`. Inner calls cannot create approval. | surface contract under `required` and `off` |
| T19 | **Key capture.** A binding takes ⌘K, Enter or Escape to trap the person or swallow input. | Occupied chords need `replaces`. `Escape`, IME composition and the text-history chords are reserved. | keymap point tests |
| T20 | **Clipboard exfiltration.** A paste handler sends what it sees. | The match is data. The transform is T1 in the sandbox frame with `connect-src 'none'`. A T3 handler is labelled page power. | `sandboxContract` over the ingest kind |
| T21 | **Point squatting.** An extension declares a point under another's name to collect its contributions. | Declared names live in the declarer's namespace. A second declaration of a name is refused. | kernel tests |
| T22 | **Contribution type confusion.** A contributor hands a declarer malformed data. | `contract` decoded at `contribute`. Refused as a unit. | kernel tests |
| T23 | **Unadvertised SDK reach.** A page half reads keys the surface does not list (finding A). | The page serves `kb-ext-sdk/page` by value, as the server does. `page-surface-bridge.test.ts` asserts the served object equals the surface. | bridge test (build step 2) |
| T24 | **Fallback as a downgrade.** A hostile store pins a faulty provider so the person falls back to a provider of its choosing. | Election only among approved candidates. The default is always the owner's, and a person's field edit is history. | role contract suite |

### 7.3 What stays forbidden

- Taking a bundled **name** (install plan T5). A role, yes; a name, no.
- Replacing or wrapping `ui.host`, identity providers, the page token,
  governance, the invoke core, `CodeTrust`, the sandbox frame and its
  flags, or anything a plugin cannot provide today (MECE §3).
- Any path by which an extension, an agent or a reaction grants trust or
  approval. There is no `--yes` (install plan §9).
- A reaction touching the store or the log directly.
- `hoc` wrapping of the editor's DOM (§4.2).
- T3 as the marketplace default for any of §3's seams (isolation §6). A
  marketplace extension that needs T3 says so, and the sheet says "page
  power" in words.
- A second severity of any of this by deployment flag. `--governance off`
  drops policy, never these.

## 8. Build plan

One PR per step. A restructure step is behaviour-preserving and lands
before the step that uses it (AGENTS.md, Restructure then add). Each step
amends DESIGN.md first, and each `add` step ships one sample in
`popemkt/kb-extensions` (today it holds `binary-orbits` only). Sizes: S
under a day, M a few days, L a week or more.

| # | Step | Kind | Size | Gate |
|---|---|---|---|---|
| 1 | **`PointSpec` on every key.** `Point(name, spec)`; all 23 points state cardinality, combine, kernel and tier; `makeKernel({host})` refuses `wrong-kernel`; keyed duplicates conflict; `extension.list` prints specs and contributions in order. | restructure | S–M | kernel tests; a harness check that every `Point` has a spec; existing suites unchanged |
| 2 | **Page SDK by value.** `PAGE_EXTENSION_SDK` serves exactly `page-surface.ts`; `installPageModules` serves it, not `uiSdk`. | restructure | S | `page-surface-bridge.test.ts` asserts the served object equals the surface; `binary-orbits` still loads (Q6) |
| 3 | **Editor keymaps.** The outline's intents get ids; `EDITING_KEYMAP` and `SELECTION_KEYMAP` become the outline's contributions to `ui.keybindings`; the SDK serves the T0 binding form. Sample: `kb-extensions/extensions/outline-keys` binds a chord to an action. | restructure, then add | M | keymap tests unchanged after the restructure; sample e2e: the chord runs the action through the invoke core |
| 4 | **Row renderers.** `row` placement; tag field `sys.f.view.row`; `tagRowViews` in the declaration; the outline draws the elected view when the row is not being edited. SDK: `provideView` accepts `row`. Sample: `callout` (T3 until isolation step 9, then T1). | add | M | view contract over `row`; sample e2e: a `#callout` row draws the sample and edits as text on focus |
| 5 | **Declared points.** `ctx.declare`, `ctx.point`, `uses` waiting like `inject`; `graph.themes`, `lab.studies`, `gallery.*` and `ui.palette-steps` migrate. | restructure | M | kernel tests: `uses` pending and return; migrated families' suites unchanged |
| 6 | **Palette steps and node menu through the SDK.** T0 step form; command `menus` facet and `leads`; T0 command form calling an action. Sample: `link-to` (a step that picks a node and invokes `node.link`). | add | M | bridge tests; sample e2e |
| 7 | **Roles.** Candidates and election in the kernel; `replaceable` in specs; role nodes and `sys.f.provider`; `useRole` boundary; `kernel.fault`. Only bundled candidates exist yet. | restructure | M | role contract suite (throwing candidate, default always present, unapproved refused) |
| 8 | **`replaces`.** In the declaration, checked at admission, shown on the trust sheet. Sample: `plain-fields` replaces `ui.field-editor`. | add | M | install e2e: untrusted → no election; trusted → elected; throw → falls back with a toast |
| 9 | **Field types as declared options.** `ui.value-kinds`; the outline contributes the 8; `fieldTypeOf` falls back to text only for an uncontributed option. Sample: `rating` (stores `num`). | restructure, then add | M–L | value-kind tests unchanged; sample e2e; CLI writes are refused by the sample's commit guard |
| 10 | **`tx/after`.** Point, frame drain in `invokeWith`, `ReactionHost`, caps; SDK `onCommit`. Sample: `inbox-router` (a node tagged `#inbox` is moved under the store's Inbox node). | add | L | `tx/after` contract (loop stops at 4, approval refused, outer call unaffected); CLI and `kb ui` both react |
| 11 | **Paste and drop.** `outline.ingest`; the outline's Tana-paste handler first; T1 transform once isolation step 9 lands. | add | M | ingest tests; multi-line paste becomes nodes |
| 12 | **Inline marks** and **decorations.** | add | M each | render budget tests on a 2,000-row outline |
| 13 | **Admission by capability.** `uses`/`replaces`/`reacts` checked before import; `extension.list` as the effective tree. | add | S | admission tests |
| 14 | Later: dev watcher for the root's own `.kb/extensions/` (§2.6). | add | M | — |

**Why step 1 first, and not the owner's suggested start.** Editor points
are the visible win, and step 3 delivers them soon. But minting
`outline.blocks` and a keymap point on today's undeclared points would add
two more points whose combination is the reader's secret: the MECE debt
this record exists to pay. Step 1 is small and behaviour-preserving, and
it is valuable on its own (MECE 3 and 11 close). Step 2 closes a real
confinement gap before anything is added to the surface. Step 3 is then
the first third-party editor extension, with a sample. Step 4 is the
owner's "blocks", reshaped as a placement (§3.1).

T1 forms depend on the isolation record's steps 9 and 10 (T1 for
extensions, per-point tiers). Until those land, each §3 seam offers its T0
form and a labelled T3 form, never an unlabelled one.

Each step that defers part of its clean shape files a `#gap` in kb, with
`// GAP [[id]]` at the deferral site (AGENTS.md, Drift markers and gaps).
This record files none, because it changes no code.

## 9. Questions for the owner

Each has a default, and the build follows it unless the owner says
otherwise.

1. **Where does the choice of a role's provider live?** Default: per
   store, as a field on the role's node, so it merges, has history and
   travels with the repository. The alternative is per machine, in the
   user lock scope.
2. **Priority semantics.** Default: lower wins, as in dsh. Bundled
   defaults are 100, and a replacement declares its own, default 50.
3. **How long does a faulted provider stay demoted?** Default: until the
   page reloads (page) or the process restarts (server), or until a new
   digest. The alternative retries on the next render, which can flicker.
4. **`tx/after` delivery.** Default: at most once, in the committing
   process. Durable at-least-once, with a cursor in per-user state, comes
   when a reaction needs it.
5. **Do reactions run in the CLI?** Default: yes, bounded by budgets,
   before the CLI exits, so a CLI write reacts the same as a page write.
   The alternative is `kb ui` only, which loses CLI and MCP writes when no
   server runs.
6. **Narrowing the page SDK by value (step 2) can break a page half that
   reads unadvertised exports.** Default: accept. Only `binary-orbits`
   is published, and the step checks it. Anything needed is added to the
   surface on purpose.
7. **Keybinding conflicts.** Default: an occupied chord is refused unless
   the binding declares `replaces`. The alternative is last-loaded wins,
   dsh's behaviour for an unapproved re-registration, which lets a stranger
   take ⌘K silently.
8. **Marketplace tiers for editor seams.** Default: the isolation record's
   rule applies unchanged. Marketplace extensions get T0 and T1 forms. T3
   is for the owner's own code and known authors, and is labelled. So
   until isolation step 9, a marketplace row renderer can only be a
   static T3 shown with the page-power sentence, or wait.
9. **Dev loop for the root's own extensions.** Default: no exception to
   trust-per-digest. A watcher re-bundles, and the person approves at the
   TTY or on the page. An agent can never take that path. The alternative,
   "trust the root's own folder while `kb ui --dev` runs", is refused by
   default, because an agent can edit that folder.
10. **Name of the row placement.** Default: `row`, joining the gap's
    `card`, `beside`, `float` and `hover`. The alternative is to reuse
    `card`, whose box rules (fixed height) do not fit a row.
