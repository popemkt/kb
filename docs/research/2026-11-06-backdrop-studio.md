# Backdrop Studio — design note (2026-11-06)

**Ask (owner):** "backdrop can be a fleshed out plugin/studio. Independent
knobs for each backdrop. The existing backdrops could be shipped as part of
the editor plugin, while plugins can add to backdrops against the
editor-plugin-provided surface. Each backdrop viewable in a plugin/dedicated
view, with knobs just like the lab plugin, so each can be a scene of its own.
Double-clicking the backdrop shows a small button, probably in the corner, to
open this view." Closes KB-7. Builds on KB-6 (#104: a variant declares its
default strength; Warp is vivid).

This note records the decisions. The specification is DESIGN-UI.md →
Page-head backdrops, which each phase amends.

## What exists

- **The surface is already a point.** `BackdropPoint` (`@kb/ui-sdk`) holds
  one `Backdrop` per contribution: `key` (the declared `SeedBackdrop`: id,
  label, variants), `presentation`, `Component`. The one slot
  (`PageBackdrop` → `BackdropFrame`) renders it in page heads and in
  Settings' cards. Four families contribute today: `backdrops` (14),
  `yorha` (2), `zzz` and `transistor`.
- **The settings are fields.** Choice, strength, direction, art and
  variants are fields on core's node (`backdropChoice`).
- **The lab has knobs.** `LabControl` (`range`, `toggle`, `choice`) and the
  info card's `Control` component are the lab's private copy of the
  concept "a typed, live parameter".

## Decisions

1. **"The editor plugin" is the backdrops family, presented as Backdrop
   Studio.** It ships the built-in backdrops and the studio. The surface's
   *types* (the point, the knob schema) stay in the kit and the model:
   the family fence (`familyEdgeViolation`) forbids yorha, zzz and
   transistor from importing another family, so a surface every plugin
   can contribute to has to live in the layer every plugin can reach.
   The family owns the policy: the studio, the gallery, and the entry
   button. **Open question for the owner:** if "editor plugin" meant the
   outline (the editing family), say so. DESIGN-UI states that backdrops
   are owned by no view family, and they would disappear with the outline
   switched off, so I did not move them there.
2. **One knob schema for the lab and the backdrops** (Rule 1: one mechanism
   per concept). `Knob` moves to `@kb/model` (`knob.ts`), because it is
   isomorphic and the seed and the CLI read it too. Its kinds are
   `number` (min, max, step, unit), `color` (`#rrggbb`), `enum` (options),
   `boolean` and `seed`. One control, `KnobControl` in `@kb/ui-sdk`, draws
   any knob. The lab's info card and the studio panel both use it. That
   rework is a behaviour-preserving commit of its own, made first.
3. **A backdrop declares its knobs.** `SeedBackdrop` gains:
   - `credit`;
   - `strength`, the backdrop's default (a variant's own strength from #104
     wins over it);
   - `knobs`.

   `BackdropVariant` gains `knobs` for the knobs only that variant has.
   A knob's `default` is its declared default value. The page
   contribution (`Backdrop`) gains `budget`, the frame time a backdrop may
   spend (6 ms of GPU time for a GPU scene and 2 ms of CPU time for a
   canvas scene, as today, so the page-head frame budget does not
   change). The scene factory stays `Component`: the slot instantiates it
   in a head, a card or the studio, and one renderer means one path.
4. **Knob values are fields on the backdrop's own node.** Every declared
   option may declare `knobs` (`SeedOption.knobs`), and the seed fold
   derives one field per knob: `<option id>.knob.<knob id>`, typed (number,
   checkbox, ref with option children, text), single-valued, and
   *configuring the option node*. So a person may write it
   (`system-write.ts`), and a backdrop's values sit on
   `sys.backdrop.<id>`, a variant's on `sys.backdrop-variant.<id>.<variant>`.
   The fold seeds no value. An absent value means the default, and reset
   is `unset` (the seed's fill-absent pass would bring a seeded default
   back after an unset).
   - **CLI:**
     `kb set sys.backdrop.backdrops.black-hole sys.backdrop.backdrops.black-hole.knob.speed 1.5`.
   - **MCP:** `node.update` on the same node and field.
   - **Reading a value** (`knobValues`) resolves the stored value against
     the schema. A number is clamped to its range and stepped, and a value
     of the wrong form falls back to the default. A number field does not
     carry its range as data, so `kb set` accepts an out-of-range number,
     which reads as clamped. That is a recorded gap.
5. **Live, no reload.** `BackdropFrame` resolves the knobs (the
   backdrop's, plus the drawn variant's) and hands them to the component
   as `BackdropProps.knobs`. The GPU host passes them on through
   `setLook`, which already reaches the running scene. A seed knob is the
   one exception: a new seed is a new composition, so the scene is
   remounted.
6. **Generic knobs are implemented once.** `speed` (time scale) and
   `seed` (the load's variation, pinned) are declared constants of the
   backdrops family and implemented by its two hosts: `mountBackdrop` for
   the GPU scenes and the 2D stage. Every built-in that moves declares
   them. Each GPU backdrop adds one to three knobs of its own, each wired
   to a uniform or a parameter. A knob no code reads is not declared.
7. **The studio** is the backdrops family's view `backdrops.studio`, with
   two routes: `/backdrops`, the gallery, and `/backdrops/<id>`, one
   backdrop.
   - **The gallery** shows every contributed backdrop, from any family.
     Its cards are stills, as Settings' cards are.
   - **The one-backdrop page** draws the backdrop through `BackdropFrame`,
     full size, in its own region frame, with:
     - a lab-style panel of its knobs, each with a reset;
     - a variant switcher;
     - a strength preview;
     - a perf readout (the canvas's `data-gpu-ms` and `data-quality`
       against the budget);
     - "Use as my page backdrop" (writes core's `sys.f.backdrop`, and pins
       the variant shown).
   - Only the viewed scene runs.
8. **The entry point is a point.** The slot is core's and names no feature,
   so `BackdropActionPoint` (`@kb/ui-sdk`) holds what a double-click on a
   page-head backdrop offers. The studio contributes "Open in Studio".
   - **Where it fires.** The slot listens for `dblclick` on the element it
     already listens on (`usePointerOver`'s holder). The gesture counts
     only where the pointer is inside the frame and the target is not
     content: not editable, not a control or a link, not text, and no
     selection after the double-click.
   - **Nothing is taken from the page.** The listener never prevents the
     default, so a double-click meant for selecting or editing is never
     taken.
   - **The button.** It sits in the frame's top-right corner, fades after
     4 s, and Esc dismisses it.

## Phases (one PR each, stacked on #104)

1. **Surface.**
   - **Restructure:** the lab's controls become `Knob` and `KnobControl`.
   - **Add:** the contribution's credit, default strength, knob schema
     and budget; `BackdropProps.knobs` from the defaults; the contract
     suite holds every backdrop to them.
2. **Knobs.** The fold derives knob fields, values are read from the option
   nodes and applied live, `speed` and `seed` are implemented in both
   hosts, each built-in's own knobs are wired, and the CLI and MCP usage is
   documented.
3. **Studio.** The view, the gallery, the one-backdrop page and the panel.
4. **Entry.** `BackdropActionPoint`, the double-click and the corner
   button.

## Not in scope

- Named presets (stretch). The knob values are nodes, so a preset is later
  a node holding a set of them.
- Per-page knob values. A page can choose its own backdrop already; its
  own knob values could follow the same nearest-node rule later.
