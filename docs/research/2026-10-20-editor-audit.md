# Editor audit: every core concept, created and edited in the editor

Date: 2026-10-20. Branch `feat/editor-ux`, at the commit that adds this file.

The principle is the "Editing surface" row of
[DESIGN-UI.md → Decisions](../../DESIGN-UI.md#decisions-from-qa), and its `#rule` node is
"Editor first". The editor is the outline (`@kb/outline`) and its UI (`@kb/outline-ui`),
together with the shell around them. It is the main surface where a person creates and edits
every core concept. The CLI and MCP are equal surfaces for agents and are not the editor's
fallback.

This audit walks each core concept and asks two questions: can a person create it in the
editor, and can they edit it there? A concept the editor cannot create or edit is a gap. Each
real gap has a `#gap` node and a `// GAP [[id]]` marker at the place it bends. A gap that was
already recorded is cited by its id.

Every reference below was checked against the code at this commit.

## Root cause

Most of the high-ranked gaps have one cause. The page keeps a list of the `sys.*` fields a
person may edit, `SCHEMA_SURFACE_FIELDS`
(`packages/kit/ui-sdk/src/lib/field-visibility.ts:14`), which holds color, hidden, fieldType,
targetTag and targetQuery. `isIntrinsicSystemPropKey` hides every other `sys.*` prop. "Debug:
show all fields" draws them, but read-only
(`packages/extension/outline-ui/src/fields-section.tsx:442`). Through `node.update`
(`packages/application/operations/src/actions.ts:81`), the CLI (`kb set` / `kb unset`) and MCP
(tools built from the action list, `packages/app/mcp/src/mcp.ts:218`) can write all of them.

That makes the allow-list a second decision about what a person may write, beside the data
(the field node's `hidden`, and the system-write rule in `@kb/model`). Rule 1 calls that a
mirror. **GAP `01M5CRYK42Y4G74JD62AD00BZS`** records it. Deriving visibility from the field
node would close it, and with it items 1 (in part), 3, 4, 7 and 9 below.

## Ranked

Ranking is by how often a person would need the concept, times how far the editor is from
letting them do it.

| #   | Concept                                          | Create in editor                                                                                           | Edit in editor                                                                                                                                                                                                                                    | Gap                                                                                                                                               |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Query nodes (`sys.f.query`, `sys.f.query.limit`) | yes: ⌘K "New query node", "Turn into query" (`app/ui/src/lib/commands.tsx:178`, `:298`)                    | **no**: nothing edits the EDN or the limit afterwards                                                                                                                                                                                             | **new `01M5CRYKQAHJNG5SSRVSYE77GN`**. The query builder design ([brainstorm](../brainstorms/2026-10-20-query-builder/README.md)) is how it closes |
| 2   | View settings: group, display, page size         | n/a                                                                                                        | **no**: `setViewGroup` / `setViewDisplay` / `setViewPagesize` (`kit/ui-sdk/src/lib/page-writes.ts:145`) have no caller outside tests. The board says "Set view.group to use the board." (`extension/collections-ui/src/board-cards-view.tsx:157`) | **new `01M5CRYMAK7SZT2PPBBS849NNQ`**, a dead seam (Rule 1)                                                                                        |
| 3   | Field cardinality, relation inverse              | with the field                                                                                             | **no**: `sys.f.cardinality` and `sys.f.relation.inverse` (`domain/model/src/model.ts:89`, `:102`) are hidden                                                                                                                                      | root `01M5CRYK42Y4G74JD62AD00BZS`                                                                                                                 |
| 4   | Agent providers (`#agent-provider`)              | yes, as a tagged node                                                                                      | **partly**: the dock edits the provider and model (`extension/agent-ui/src/settings.tsx:44`). Adapter, endpoint, credential and executable (`extension/agent/src/provider.ts:93`) are hidden                                                      | root `01M5CRYK42Y4G74JD62AD00BZS` (marker at `settings.tsx`, whose comment claimed otherwise)                                                     |
| 5   | Code views and scripts                           | **no** code view from the UI (`proposeView` callers make layouts, charts, canvas cameras and graph lenses) | trust only (`extension/code-ui/src/scripts-host.tsx:112`)                                                                                                                                                                                         | existing `01M41DKW6PFA4FX6FRNWBV03ED` (code and grant) and `01M41DKTE1T51M031N231VGQJR` (scripts on existing views)                               |
| 6   | Reference targets                                | yes (`extension/outline-ui/src/outline-steps.tsx:72`)                                                      | **no**: "Turn into reference…" is withheld on a reference (`app/ui/src/lib/commands.tsx:319`)                                                                                                                                                     | existing `01M3KA3AZTJVQNADZ12SDPE9X1`                                                                                                             |
| 7   | Saved layouts                                    | yes: "Save layout" (`app/ui/src/lib/commands.tsx:260`)                                                     | **no**: saving again makes a new node, and `sys.f.layout` is hidden JSON                                                                                                                                                                          | **new `01M5CRYMXMMZC9S8GS00CE6DFB`** (the false comment in `layout-view.tsx` is corrected)                                                        |
| 8   | Approval policies                                | yes, as rows of the governance table (`extension/governance/src/seed.ts:140`)                              | in the table (`extension/collections-ui/src/table-view.tsx:319`); hidden on the policy's own page                                                                                                                                                 | existing `01M536CH4P48SXV9B0HH8B4XTG`                                                                                                             |
| 9   | Docs views (template, output, saved query)       | through the CLI                                                                                            | **no**: hidden `sys.f.view.*` fields (`domain/views/src/docs.ts:39`)                                                                                                                                                                              | root `01M5CRYK42Y4G74JD62AD00BZS`                                                                                                                 |
| 10  | Locations                                        | **no**: `kb locations add` only (`app/cli/src/locations.ts:120`)                                           | open and forget (`extension/locations-ui/src/section.tsx:58`)                                                                                                                                                                                     | **new `01M5CRYNGRHH8HHBHV2KQ3MNAV`**. `01M53VP7RKJG53B305MM26AYVG` is a different gap, about ⌘K "Open location…"                                  |
| 11  | Chart specs                                      | yes (`extension/chart-ui/src/add-chart.tsx:24`)                                                            | as raw JSON                                                                                                                                                                                                                                       | existing `01M4187E5QQYRD8ENHQM968EEJ`                                                                                                             |
| 12  | References inside text field values              | no                                                                                                         | no                                                                                                                                                                                                                                                | existing `01M3KA394XS9DCGY9RHS151G6F`                                                                                                             |
| 13  | A tag's template field order                     | n/a                                                                                                        | **no**: add and remove only (`extension/outline-ui/src/tag-fields-config.tsx:173`, `:183`)                                                                                                                                                        | **new `01M5CRYP40YAHA2ZQFB850ARVZ`**                                                                                                              |
| 14  | Moving a node far                                | n/a                                                                                                        | one step at a time (`extension/outline-ui/src/editing-intents.ts:108`); no move-to, no drag                                                                                                                                                       | **new `01M5CRYPQ3CGJKP20TQFADPRH1`**                                                                                                              |
| 15  | Adding a value from ⌘K                           | n/a                                                                                                        | no                                                                                                                                                                                                                                                | existing `01M3KA39PQAJZJ6C6ZY4RV1SPZ`                                                                                                             |
| 16  | A field's target query                           | with the field                                                                                             | as raw EDN text (it is on the allow-list, `field-visibility.ts:19`)                                                                                                                                                                               | covered by the query builder (item 1), not a gap of its own                                                                                       |

### Closed by this branch

- **Extension families' settings and switches.** A family's settings are the fields whose
  `sys.f.configures` names its node, for example graph's "suggest relations"
  (`extension/graph/src/seed.ts:133`). Before this branch nothing drew them, except core's
  appearance settings in Preferences. The Extensions panel now draws every family's settings
  with the page's field editor, beside its switch, trust, contributions and failures
  ([DESIGN-UI.md → Extensions panel](../../DESIGN-UI.md#extensions-panel)). A page's own
  backdrop remains open: `01M54CEM0Z5SMAS7KABS7QZ67C`.

### Where the editor already holds

Nodes, tags, template fields (`tag-fields-config.tsx`), field types, options, references,
views (toolbar, filter popover, table sort by header), ontologies, trust, and core's
appearance settings.

## What no editor gesture should ever need

The CLI and MCP also reach `kb.manifest`, `extension.list`, `docs.materialize`,
`check.audit` and the other read and maintenance actions. These are agent and operator
surfaces, and the principle does not ask the editor to mirror them. It asks only that a
_concept_ a person keeps in kb, a node of some kind or a setting, can be created and edited
where they work.
