# Settings, and themes as plugins

Date: 2026-10-27. Branch `docs/settings-theme-plugins`.

The owner asked for kb to "move the theming stuff and all to plugins, instead
of configuring themes on that flyer [the Preferences popover], or probably
rework the options/configuration part entirely". This record takes stock of
every configurable thing, names what is wrong with how it is configured,
weighs three ways out, and recommends one with a phased plan. The rules it
is judged by are [AGENTS.md](../../AGENTS.md) (Rule 1, one contract,
canonical statements, drift markers); the specs it would change are
[DESIGN.md → Extension families](../../DESIGN.md#extension-families) and
[DESIGN-UI.md → Design tokens](../../DESIGN-UI.md#design-tokens),
[Extensions panel](../../DESIGN-UI.md#extensions-panel) and
[Motion options](../../DESIGN-UI.md#motion-options).

**Recommendation in one paragraph.** Option C, built B first. kb already
stores settings the right way: a setting is a system field whose
`sys.f.configures` names an extension's node, so the schema is data and
`kb set` writes it. What is missing is a way to *read* that schema through
kb's API, and one place that draws it. So: (1) one reader and one read
action, `extension.settings`, that every surface uses (`kb ext settings`,
MCP and the agent get it as a tool); (2) a Settings page, a kb view at
`/settings`, that replaces the Preferences popover and takes the switch and
settings off the Extensions report, with the theme chosen from a gallery;
(3) each whole theme its own plugin (family), so a theme is installed,
switched and authored as a unit, as bb's `bb.themes` plugins are; (4) a
theme's pieces that are still code become data on the theme's node, closing
the theme gaps one by one.

## 1. What is configurable today, and where it lives

Prod (`https://kb-popemkt.taild98079.ts.net`, 2026-10-27, read only: the
popover opened and its effects fold expanded, nothing chosen):

| Preferences popover | its effects fold | Extensions page |
| --- | --- | --- |
| ![Preferences](assets/2026-10-27-prod-preferences.png) | ![Effects](assets/2026-10-27-prod-preferences-effects.png) | ![Extensions](assets/2026-10-27-prod-extensions.png) |

Every configurable thing, its scope, its storage, where it is drawn and
whether kb's API reaches it:

| Thing | Scope | Stored as | Drawn in | Through actions / CLI / MCP |
| --- | --- | --- | --- | --- |
| Light, dark or system | device | `localStorage["kb-prefs"].theme` | popover row "theme"; ⌘K Toggle theme | no (by design: `system` follows the OS) |
| Width | device | `kb-prefs.width` | popover row; ⌘K Toggle width | no |
| Sidebar open | device | `kb-prefs.sidebarOpen` | the sidebar toggle | no |
| Design system (the theme) | this kb | core's `sys.f.design-system`, a ref to an option node | popover row "design" (field editor + swatch); ⌘K Switch design system | `kb set sys.extension.core sys.f.design-system …`; not listable as a setting |
| Page-head backdrop, strength, direction | this kb, or one page | `sys.f.backdrop`, `…strength`, `…direction` on core's node or a page's | popover rows; a page's own: no gesture (gap `01M54CEM0Z5SMAS7KABS7QZ67C`) | `kb set` |
| Motion mode, intensity, style, speed | this kb; a theme's preset beneath | `sys.f.motion.*` on core's node; the same fields on the theme's option node | popover rows with "value · source" | `kb set`; the value in force is computed only in the page (`motionChoice`) |
| Ten motion effects | same | `sys.f.motion.fx.*` checkboxes | popover fold | `kb set` |
| An optional extension on or off | this kb | `sys.f.extension.enabled` on `sys.extension.<name>` | Extensions page switch | `extension.switch`, `kb action-invoke` |
| An extension's other settings (graph's *suggest relations*, the agent's *provider*, code's *scripts*) | this kb | fields that configure `sys.extension.<name>` | Extensions page card, below the contribution dump | `kb set`; not listable |
| The catalogue of themes and backdrops | this kb's build | option nodes the seed derives from declarations | the fields' pickers | `node.get`, read-only by convention |
| A theme's tokens, faces, art, overlays | the build | CSS, imports and components in `themes-ui` | nowhere | no (gaps `01M5SNSPSGYCF6AKWVXQS2GJQJ`, `01M5SNSQH2HMD784PCD51W46D5`, `01M5SNSQ4Y11AHAHDA43PCV5D6`) |

What ships: six design systems (core's `kb`; the `themes` family's Paper,
Terminal, ZZZ, Transistor and YoRHa), fourteen backdrops (eight from the
`backdrops` family: Unicorn, Gradient, Sky, Roost, Lens, Black hole, Toon
sea, Silk; six from `themes`: Broadcast, Hollow, Cloudbank, OVC, Bunker,
Arena), four motion options and ten effects. One family, `themes`, holds
five systems, their art, their faces and six backdrops; switching it off
takes all five.

## 2. The problems

1. **The flyer is the wrong container.** The popover holds 11 rows and a
   fold of 10 more, each with a second line of "value · source", in a
   320-pixel box anchored to the gear. The owner's most-used choice, the
   theme, is a dropdown chip with a 20-pixel swatch; nothing shows what a
   theme brings (its art, its backdrops, how it moves) before it is chosen.
   With the effects open, the popover runs off the bottom of a 900-pixel
   window (the second screenshot is cut at *toggles*). Each effect shows an
   empty checkbox beside "on · from YoRHa", because the box is core's
   stored value and the line under it the value in force; the effects are
   labelled by their ids (`hoverLift`, `listEnter`); *strength* reads
   "Empty" where the page shows `subtle`.
2. **It mixes two scopes and does not say so.** "theme" (light, dark,
   system) is this browser's; "design" (the theme) paints every tab and
   device. They sit one under the other, named so that the one called
   *theme* is not the theme.
3. **Settings have two homes and two grammars.** Core's settings are drawn
   by the popover; every other extension's are drawn at the bottom of the
   Extensions page, a developer report of points, contributions and seeds.
   A person looking for the agent's provider has to read past
   `ui.palette-steps` to find it. The predicate that decides what is a
   setting (`configures` over the schema) is written in the page
   (`extensions-page.tsx`), and Preferences names core's fields by hand
   (`core-settings.ts`, `motion-rows.tsx`).
4. **The schema is data no caller can list.** DESIGN.md says "which fields
   configure the agent is a query", but no action runs it. An agent or the
   CLI can write any setting with `kb set` only if it already knows the
   field id; MCP has no tool that answers "what can I configure?".
5. **A theme is not a unit.** A whole theme (sheet, faces, art, its two
   backdrops, its motion preset) is spread across one family that holds
   five of them. It cannot be switched alone, a new one cannot be added
   without editing that family, and its own knobs have no home. bb, by
   contrast, lists themes from plugins (`bb.themes`) with a picker and
   per-plugin settings.
6. **A theme's look is code** (the gaps in DESIGN-UI.md → Theming: what is
   data and what is code): tokens, faces, art and overlays, the selected
   row, the graph's look and the palette's presentation are unreachable
   from kb's API.

## 3. Options

### A. Themes as kb extensions, and a Themes gallery

Split the `themes` family into one family per whole theme (`zzz`,
`transistor`, `yorha`; Paper and Terminal stay in `themes`), each a
`@kb/<theme>` and `@kb/<theme>-ui` pair, and replace the design-system
dropdown with a gallery of live cards grouped by the plugin that brings
each theme. Each theme family carries its art, faces, sheet and backdrops;
its switch is the existing `extension.switch`.

- Fixes 5, and most of 1 for the theme itself.
- Leaves 2, 3 and 4: the popover still draws backdrop and motion, the
  Extensions page still hides settings, nothing lists them.
- Costs: about six packages moved, shared art helpers (`useBeat`,
  `useGesture`, `deferred`) to a kit package, and an id migration: a
  declared id is `<family>.<local id>`, so `themes.zzz` becomes
  `zzz.<local>`, and a store whose core node chooses `themes.yorha` (prod's
  does) would fall back to the default without one.

### B. Settings as `sys.*` setting nodes, a Settings page as a kb view, and the schema through actions

Keep every setting where it already is, a system field that configures an
extension's node, and add what is missing:

- **One reader** in `@kb/model`, `extensionSettings(graph, node)`, the
  fields that configure a node, in seed order, with each one's type,
  cardinality and options; the Extensions page and Preferences stop
  carrying their own filter.
- **One read action**, `extension.settings {name?}`: per extension node,
  core's included, its label, whether it is optional and on, and each
  setting with its field id, label, type, one-valued or not, its options
  (id and label) where it is an option set, and the values the node holds.
  `kb ext settings [name]` prints it; MCP and the agent get it as a tool,
  as they get every read action. Writes stay `node.update` / `kb set`
  (the system-write rule already admits exactly these fields) and
  `extension.switch` for the switch.
- **A Settings view** (`@kb/views`' `SettingsView`, route `/settings`, a
  page like the Extensions view, opened by the gear and ⌘K): sections by
  owner. *Appearance* is core's: this device (light/dark, width, marked as
  this browser's), the theme as a gallery, the page head, and motion with
  each value's source. Then one section per extension with its switch and
  every setting the reader lists, drawn with the page's field editor. The
  popover is deleted; the Extensions page keeps the report and links each
  extension to its settings.

- Fixes 1, 2, 3 and 4; the gallery fixes the theme half of 1.
- Leaves 5 and 6.
- Costs: one action and one reader (small); one view and the removal of
  the popover (medium); no data migration.

### C. Both, B first

B's reader, action and page, then A's per-theme families on top, then the
theme gaps, each as the theme's node gaining data. The gallery groups
themes by plugin from the start, so A changes what the gallery shows, not
how it works.

## 4. Comparison

| | A | B | C |
| --- | --- | --- | --- |
| **Rule 1** (one mechanism, one owner) | the theme becomes one family's, one owner per theme; settings stay split across two surfaces with two filters | one reader and one action own "what is a setting"; one page draws them; the popover and the page's second filter are deleted | both |
| **Everything is a node** | unchanged | holds: the schema stays field nodes, the action is a query over them, no settings registry beside them | holds |
| **One contract, every implementation** | the design-system and theme-art contracts already run over every contributed system; a new family joins them with no list to edit | a new contract: every setting the reader lists is drawn on the Settings page and listed by the action, for every bundled family and a test family | both |
| **Canonical statements** | DESIGN-UI's Themes section names the families | DESIGN.md's configuration bullet gains the reader and action; DESIGN-UI's Preferences and Extensions panel sections become one Settings section | both |
| **Owner value tonight** | the theme as a plugin, the gallery | a real settings page; agents can list and set settings | the whole ask, phased |
| **Effort** | large (package moves, alias) | small + medium | B now, A next |
| **Migration** | ids change; needs an alias at read | none (device prefs and graph settings keep their keys) | B none; A the alias |
| **Risk** | breaks a chosen theme without the alias; large diff in art code | low; the popover's tests move to the page | low first, then A's |

## 5. Recommended target

**C, in the order B → A → theme data.** The settings model is already
right; the surface and the API are what is missing, and B delivers them
with no migration. A is then a packaging change the Settings page already
expects. The theme gaps come last, because each one is the theme's node
gaining a field and the page drawing it.

The target's information architecture
([HTML](assets/2026-10-27-settings-ia-mock.html), painted by kb's real
design-system sheets):

![Settings IA mock](assets/2026-10-27-settings-ia-mock.png)

- **One page, two verbs.** *Settings* is what a person chooses (every
  setting, every switch). *Extensions* is what the kb composes (trust,
  contributions, listeners, failures). Each extension appears once in
  each, linked.
- **Scope is said, not implied.** Device choices sit under *This device*;
  everything else is this kb's and paints every tab.
- **The theme is a gallery**: each contributed design system as a live
  sample (its own sheet, through `data-theme`, as the swatch is), with the
  plugin that brings it, the backdrop it pairs with and its motion preset
  read from its option node. Choosing writes core's field through
  `chooseDesignSystem`, the write ⌘K's Switch design system already uses;
  the options are the field's children, so there is still one list and one
  write. A card is a picture of an option, not a second picker.
- **Motion** keeps "value · source" per option and a reset to the theme,
  the effects as a grid rather than a fold.
- **Extensions**: each with its switch and its settings, generic field rows.
- The gear opens the page in the focused pane; ⌘K's *Preferences* command
  opens it too; *Toggle theme*, *Toggle width* and *Switch design system*
  stay as the quick paths the popover used to be.

## 6. Phased plan

Each phase is one PR against kb main, stacked, shippable on its own, with
tests, DESIGN docs and gaps updated in the same PR.

**Phase 1 — the settings schema through the API (B).**
`extensionSettings` in `@kb/model` (the one reader); `extension.settings`
in `@kb/operations` beside `extension.list`; `kb ext settings [name]
[--json]`; the Extensions page and Preferences read the reader. Contract:
over every bundled declaration and a test family, every field that
configures a node is listed under that node, in seed order, with its
options; nothing else is. DESIGN.md → Extension families → configuration
states the reader and the action. Closes problem 4. No gap closes; none is
opened.

**Phase 2 — the Settings page (B).** `SettingsView` (`/settings`),
sections as above; the gallery; the popover, `prefsOpen` and its trigger's
popover role deleted; the Extensions page's switch and settings moved to
Settings, the page linking each extension there. Contract tests: every
setting the reader lists for every family on is drawn on the page;
choosing a gallery card writes core's field and paints the page; device
rows write `kb-prefs` and nothing in the graph. DESIGN-UI: one *Settings*
section replaces Preferences, and the Extensions panel section loses its
switch and settings bullets. Closes problems 1, 2, 3.

**Phase 3 — one family per whole theme (A).** `@kb/zzz(-ui)`,
`@kb/transistor(-ui)`, `@kb/yorha(-ui)`; the art helpers to a kit package;
`themes` keeps Paper and Terminal. Ids: a declared option gains
`formerly` (its earlier declared ids), and `declaredChoice` reads a ref to
a former option as the current one, so a stored `themes.yorha` keeps
painting YoRHa with no store rewrite; the old option nodes linger as every
retired seed node does (gap `01M3FK1PM9P96SNCSHXF0CJZRA`). Arena moves onto
the shared GPU host as it moves into the YoRHa family (closes
`01M5SYY397F5NPN3CHWGCSPQSY`). Contract: a test theme family, declared
and contributed like the others, appears in the gallery, can be switched
off alone, and its former id resolves. Closes problem 5.

**Phase 4 — the theme's node carries the theme (theme data).** One gap per
step, each a field on the theme's option node, read by the painter or the
art, drawn on the Settings page under the theme's card:

| step | closes |
| --- | --- |
| `--selected-row`, `--selected-row-ink` tokens (layer 1, contrast-guarded) | `01M5SNSR9AC5V1NA31QY8DNEX6` |
| faces declared by a family through a face point, named by tokens | `01M5SNSQH2HMD784PCD51W46D5` |
| a tokens field on the option node; the painter writes the sheet from it | `01M5SNSPSGYCF6AKWVXQS2GJQJ` |
| art renderers registered by id; the theme's node names its ground and veil renderers and their words | `01M5SNSQ4Y11AHAHDA43PCV5D6` |
| a graph-theme choice on the theme's option node | `01M5S0HPNDEZ9RSQW4W679VP03` |
| a command presentation slot contributed with a design system | `01M5S0J1FVEGHTYJVY4HRS857S` |

The translucent-text gap (`01M3BEJDX4YP2DPHSCFS66NZK1`) is not a theme
step: the Settings page is written in the solid secondary inks so it adds
no site to it.

## 7. Open questions, answered

1. **Keep a quick popover beside the page?** No. Two surfaces drawing the
   same settings is the problem being fixed. The quick paths are commands
   (⌘K: Toggle theme, Toggle width, Switch design system), and the page
   opens in a pane, so it does not cost the page being read.
2. **Should the theme choice move to the themes plugin's node?** No. The
   choice is "which of every plugin's themes paints the page"; no one
   plugin can own a choice among all plugins. It stays core's setting
   (DESIGN-UI → Design systems → the choice is core's setting). What moves
   to plugins is the catalogue (Phase 3) and each theme's own parameters
   (Phase 4).
3. **A theme's own knobs: on the family's node or the theme's option
   node?** The option node. A family may bring several themes (`themes`
   brings Paper and Terminal), so the family's node is the plugin (its
   switch, its plugin-wide settings) and the option node is the theme (its
   preset, its pairing, later its tokens and art).
4. **Light/dark into the graph?** No. `system` follows the OS, which a
   graph value cannot, and the right variant depends on the room the
   device is in. The page says *this device* instead.
5. **Does every extension need a settings schema object (Effect Schema,
   bb-style descriptors)?** No. The field nodes are the schema (DESIGN.md:
   "There is no second registry of settings"). `extension.settings` reads
   them; a family declares a setting by seeding a field that configures
   its node, as graph and the agent already do.
6. **Settings and Extensions: merge into one page?** Two pages, split by
   verb. The report is for understanding what is loaded and why; settings
   are for choosing. Each links to the other per extension.
7. **Is the gallery a second picker for the design-system field?** It is a
   presentation of that field: its cards are the field's children, in the
   field's order, previewed by the samples the swatch already uses, and a
   choice is the same write. The field row on core's own node remains, as
   any field's row does.
8. **Rename the alias away later?** The `formerly` ids stay declared for as
   long as stores with the old choice may exist. Rewriting every ref to a
   retired option is a migration pass kb does not have (the seed's renames
   move a node, not the refs to it); reading through the alias needs none.
9. **The `Preferences` command's label.** The command keeps its id
   (`sys.cmd.preferences`); the seed labels it *Settings*. A store seeded
   before keeps the text it has (the seed never rewrites a system node's
   text), and the command opens the page either way.
10. **Per-page backdrops?** Out of scope; gap `01M54CEM0Z5SMAS7KABS7QZ67C`
    stays open. The page's own field rows are where it closes.

## 8. Built tonight

What was built, reviewed and left for the owner to try is recorded at the
end of this file once the phases land.
