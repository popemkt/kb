# kb art direction

This is the canonical home for what each of kb's themes is *after*, and where that lives in the source. Each
theme is mapped from its source look, to UI concepts, to the file, token, component or class that carries
each concept. How a theme is built (its tokens, its art planes, its pairing, its contract) is
[DESIGN-UI.md → Design tokens → Themes](DESIGN-UI.md#themes); this file does not restate it.

## How a section is laid out

Every theme has the same two parts.

**A. Topic analysis (portable).**
- What defines the source, written with no kb terms, so another product can reuse it unchanged. It uses
  five headings, **World**, **Art**, **UI**, **Motion** and **Sound → motion**, and an **Anchors** line that
  lists source colours by what they are in the source. Hex values marked `~` are approximate (sampled by eye
  or from memory), not measured. No anchor is a kb value: kb's colours are its own oklch values, picked
  near the anchors and held to WCAG AA by the contrast guard.
- The owner's bb-lively plugin keeps an art-direction file with the same layout, in the dotfiles
  repository ([popemkt/mac-backup](https://github.com/popemkt/mac-backup),
  `assets/bb-plugins/bb-lively/ART-DIRECTION.md`). A part A here is a verbatim copy of that file's, so the
  two stay comparable; a path inside a part A is that repository's. kb depends on nothing there.

**B. kb translation.** A table with one row per concept:
- **Concept**: the UI idea.
- **From**: the cue in part A it comes from.
- **Lives in**: file · token, component or class. Paths are under `packages/`; `themes-ui/` is
  `packages/extension/themes-ui/src/`, and `app/ui/` is `packages/app/ui/src/`.
- **Status**: `shipped`, `planned` (designed here, not built), or `gap` (needs something kb does not
  offer yet; a `#gap` node in `.kb/nodes.jsonl` says what).

**Copyright.** The kb repository is public (MIT). Every piece of art here is drawn in SVG and CSS for kb,
in the spirit of its source; every word on it is kb's own. No game art, screenshot, logo or font is
committed. The faces are free ones under the SIL Open Font License, installed from npm
(`@fontsource*`), never copied into the tree. A user's own art would go through the **user art slot**
(planned: a local path, never committed).

---

## ZZZ — New Eridu

**A. Topic analysis.** HoYoverse's *Zenless Zone Zero* (2024). Source and measurements are in
`docs/research/2026-10-24-bb-lively-zzz-wobble.md` §1.
- **World**: New Eridu, a city-pop, 90s–2000s urban fantasy. Its story is told like an interactive comic,
  and its machines are CRT and VHS era.
- **Art**:
  - near-black panels with thick lighter bezels, like a CRT;
  - lime and yellow for "active", orange and red for events, cyan for reveals;
  - hard offset shadows and thick outlines, so things read as stickers;
  - halftone dots; parallelogram (skewed) shapes.
- **UI**:
  - heavy italic grotesque type, and letter-spaced small-caps strips;
  - tab pills that cut to the new tab, then swell once;
  - slanted, dotted wipe panels;
  - result tiles that pop in one per frame with a flash.
- **Motion**:
  - a hard attack (≤ 1–3 frames to full presence), then one short secondary motion (a swell, flash or
    settle);
  - exits are cuts;
  - the "wobble" people remember is the characters' squash, stretch and overlap, not the widgets.
- **Sound → motion**: the snap lands on the click. Idle loops belong to characters and marquees.
- **Anchors**: near-black `#0e0e10`, lime `#c8f031`, pressed-yellow `#f7da00`, event orange `#ff8a1f`,
  reveal cyan `#3fd4ff`.

**B. kb translation.** Design system `themes.zzz` (label *ZZZ*), with page-head backdrop `themes.broadcast`.

| Concept | From | Lives in | Status |
|---|---|---|---|
| Near-black street: lime for selected, yellow for pressed, orange and red for events, cyan for a reveal | Art | `themes-ui/design-systems/zzz.css` · dark block `--background` `--primary` `--warning` `--destructive` `--info` `--chart-1..5` | shipped |
| The same voice on newsprint (light) | Art | `zzz.css` · base block: off-white ground, black ink, a darker lime that reads on it, black sticker shadows | shipped |
| Stickers: hard offset shadows and thick outlines | Art | `zzz.css` · `--elevation-*` (no blur), `--border-width: 2px`; in dark, what floats highest throws a yellow or lime slab, since black vanishes on black | shipped |
| Parallelograms: cut corners, leaning tab chips | Art | `zzz.css` · `--corner-shape: bevel`, `--chip-skew: -12deg`; `app/ui/index.css` (corner-shape on every `rounded-*`), `app/ui/tokens.css` `.kb-tag` | shipped |
| Heavy italic grotesque titles | UI | `zzz.css` · `--app-font` Archivo, `--display-*` (`"wght" 900, "wdth" 78`, italic, uppercase); `.kb-display` on the page title (`layout/node-read.tsx`, `outline-ui/zoomed-root-header.tsx`), the brand (`App.tsx`), the graph and canvas bars | shipped |
| Letter-spaced small-caps strips | UI | `zzz.css` · `--label-*` (wide italic, `0.2em`); `.kb-label` on every section label | shipped |
| Halftone dots and a hazard stripe on the chrome | Art | `zzz.css` · `--art-chrome`; `.kb-chrome` on the header, the sidebar, the graph's and the canvas's bars | shipped |
| Fast attack, multi-bounce settle | Motion | `zzz.css` · `--motion-spring` (a `linear()` jelly spring: dotfiles research 2026-10-24, wobbly × lively), `--motion-duration-quick: 140ms` | shipped |
| Tile pop with a flash (a popover, the palette, a toast arriving) | UI | `app/ui/motion.css` · `kb-enter-sticker` (scale, a small twist, a brightness flash); `zzz.css` · `--motion-enter` | shipped |
| Exits are cuts: a page arrives as a hard cut with a flash | Motion | `motion.css` · `kb-reveal-cut`; `zzz.css` · `--motion-reveal`, `--motion-duration-reveal: 180ms` | shipped |
| Slanted, dotted wipe panel on a page change, a "changing channel" strip leading it | UI | `themes-ui/art/zzz-art.tsx` · `StreetVeil` (veil plane); `art/art.css` · `.kb-zzz-wipe` `.kb-zzz-wipe-strip` | shipped |
| A comic page under everything: halftone fields bleeding in from two corners, panel gutters | World (interactive comic) | `zzz-art.tsx` · `StreetGround` (ground plane); `.kb-zzz-dots` `.kb-zzz-gutters` | shipped |
| A slanted hazard band with a crawling marquee (kb's own words) | Sound → motion (idle loops belong to marquees) | `zzz-art.tsx` · `MARQUEE`; `.kb-zzz-band` `.kb-zzz-marquee`, period ≥ `--motion-ambient-period` | shipped |
| The snap lands on the click: a structural write slaps a sound-effect sticker | Sound → motion | `zzz-art.tsx` · `SFX`, `.kb-zzz-sfx`; `art/beat.ts` · `useStructuralWrites` (typing is not a write here), `useBeat` (a burst is one sticker) | shipped |
| CRT broadcast in the page head: slabs, a TV with colour bars, ON AIR tab, a REC lamp that blinks while editing, a static burst on a write | World (CRT and VHS) | `themes-ui/art/broadcast-backdrop.tsx` (`themes.broadcast`); paired in `themes-ui/plugin.ts` · `backdrop: BROADCAST_BACKDROP.id` | shipped |
| A lime-striped, dotted scrim under a modal | Art | `zzz.css` · `--art-scrim`; `.kb-scrim` on the command palette and the canvas node picker | shipped |
| Tab pills that cut to the new tab, then swell once | UI | the pane switcher and segmented controls (`app/ui/components/layout/pane-switcher.tsx`): a selected-indicator gesture keyed on `--motion-spring` | planned |
| Squash on press, jelly on release | Motion (the wobble is squash and overlap) | a shared `kb-press` gesture in `motion.css`, scale on `:active` over `--motion-spring`, applied by the button primitive | planned |
| Result tiles that pop in one per frame | UI | outline children and search results staggering in by `--motion-stagger` on a page's arrival; needs a stagger slot in the outline's row renderer | planned |
| Canvas cards as a wall of TVs (bezels; static between channels while a card loads) | World (CRT) | `canvas-ui` card face (`canvas-card-layer.tsx`) reading a per-system card frame token | planned |
| A graph look of its own (outlined sticker nodes, lime edges) | Art | needs a design system to pair a graph lens theme (`GraphThemePoint`); a family may not import the graph family. Gap `01M5S0HPNDEZ9RSQW4W679VP03` | gap |

The planned rows are tracked as todo `01M5S0J2YYS7KMTJEZ78AKNQMD`.


## Transistor — Cloudbank

**A. Topic analysis.** Supergiant Games' *Transistor* (2014). Art direction by Jen Zee, music by Darren Korb.
- **World**:
  - Cloudbank is a city where citizens vote on the weather and the colour of the sky.
  - The Process, an intelligence of white, blocky machines, erases the city into blank geometry.
  - A singer, Red, carries the Transistor, a talking sword that holds a voice.
- **Art**:
  - painterly, with Art Nouveau composition (Mucha, Klimt, Waterhouse are her stated influences): long
    curving lines, gold linework, arched and domed towers;
  - a muted night palette under a vivid atmosphere: violet-blue dusk, warm orange-red and magenta glows
    at the horizon;
  - the sword's turquoise light;
  - the Process reads as white blocks with red-orange points, and erased areas as white cells.
- **UI**:
  - functions are written as programs (`Crash()`, `Breach()`, `Jaunt()`); menus read like a computer
    terminal inside an Art Nouveau frame;
  - **Turn()** freezes time and draws the world as a plan:
    - a bar at the top drains as actions are queued;
    - the planned path is drawn;
    - on release the queued actions run at super-speed;
    - a recovery follows while the bar refills.
  - Limiters are optional handicaps chosen at Access Points.
- **Motion**:
  - long, graceful arcs in the art against sharp, instant execution in combat: plan slowly, then act at
    once;
  - the Process breaks things into square cells;
  - the sword-light hums and brightens as it speaks.
- **Sound → motion**:
  - the score is muffled (an EQ low-pass) during Turn() and pause, which is a "freeze" cue;
  - Red's held hum (holding a button) is a sustained, breathing note;
  - the sword's flash is synced to its voice.
- **Anchors** (all `~`):
  - dusk violet `#13142a`–`#2a1c48`;
  - turquoise sword-light `#3ee6d4`;
  - gold line `#e0b25a`;
  - Red's orange-red `#e8503a`, Cloudbank magenta `#d94f8a`;
  - Process white `#f2efe6`.

**B. kb translation.** Design system `themes.transistor` (label *Transistor*), with page-head backdrop
`themes.cloudbank`.

| Concept | From | Lives in | Status |
|---|---|---|---|
| Night palette: turquoise sword-light as the accent, magenta and Red's orange-red for events, gold for highlights | Art | `themes-ui/design-systems/transistor.css` · dark block `--primary` `--chart-1..5` `--destructive` `--warning` | shipped |
| The night is teal-blue, not violet | Art (muted night palette) | `transistor.css` · `--background` `--card` `--sidebar`: a teal night keeps cyan and ivory at AA on every ground; the violet-magenta dusk lives in the art (the ground's wash, the head's sky) | shipped |
| Cloudbank by day (light) | Art | `transistor.css` · base block: warm ivory, deep teal ink, a teal accent | shipped |
| Art Nouveau lettering for titles | Art | `transistor.css` · `--app-font-display` Federant (flared display), `.kb-display` | shipped |
| Functions written as programs: tracked geometric capitals | UI (`Crash()`, `Breach()`) | `transistor.css` · `--label-*` Josefin Sans, `0.24em`; `.kb-label` | shipped |
| A clean 1920s sans for all-day reading | Art | `transistor.css` · `--app-font` Jost, a half step up the type scale | shipped |
| Ornamental frames | Art (Art Nouveau composition) | `transistor.css` · `--corner-shape: scoop` | shipped |
| The sword's light instead of a cast shadow | Art (turquoise sword-light) | `transistor.css` · `--elevation-*`: a cyan hairline and glow | shipped |
| Painterly wash and a gilt hairline over the chrome | Art (gold linework) | `transistor.css` · `--art-chrome`; `.kb-chrome` | shipped |
| Cloudbank's skyline under the page: far and near towers, domes, onion bulbs, spires, ringed towers, arched bridges, lit windows | Art (arched and domed towers) | `themes-ui/art/skyline.ts` (seeded, deterministic, every crown inside the drawing), `art/skyline-svg.tsx`; `art/transistor-art.tsx` · `CloudbankGround`; `.kb-cloudbank-city` | shipped |
| Light rails gliding through the city | World (Cloudbank) | `transistor-art.tsx` · `RAILS`; `.kb-cloudbank-rail` (transform only, periods ≥ 16s) | shipped |
| A function executing: one bright trail across the city on a structural write | Motion (sharp, instant execution) | `transistor-art.tsx` · `useStructuralWrites`, `useBeat`; `.kb-cloudbank-trail` | shipped |
| Turn(): a page change freezes the frame under a cyan sheet while the bar along the top fills, then the new page runs | UI (Turn()) | `transistor-art.tsx` · `TurnVeil` (veil plane); `.kb-turn` `.kb-turn-sheet` `.kb-turn-bar` `.kb-turn-fill` | shipped |
| The muffled score as a freeze cue: a surface arrives grey and the colour runs back in | Sound → motion (EQ muffle) | `app/ui/motion.css` · `kb-enter-turn`, `kb-reveal-turn`; `transistor.css` · `--motion-enter` `--motion-reveal` | shipped |
| Plan slowly, then act at once | Motion | `transistor.css` · `--motion-settle` with no overshoot, long `--motion-duration-*` | shipped |
| Turn()'s translucent cyan sheet over a modal's scrim, with scanlines | UI (Turn()) | `transistor.css` · `--art-scrim`; `.kb-scrim` | shipped |
| A painted dusk in the page head: a sun with its rings, the skyline, a rail; the windows brighten while the owner edits | Art, Sound (Red's held hum) | `themes-ui/art/cloudbank-backdrop.tsx` (`themes.cloudbank`, `data-editing`); paired in `themes-ui/plugin.ts` | shipped |
| **Turn() as a plan mode**: queue structural edits (moves, retags, deletes) without applying them, see them drawn as a plan over the outline, then execute them as one transaction | UI (Turn(): the bar drains as actions queue; release runs them at once) | a staged-transaction preview: the outline drawing a pending transaction, and a palette command to start and release a turn. Gap `01M5S0J203QE0ZMB7MGN7GJXD8` | gap |
| **Functions as cards** in the command palette: `name()`, a MEM cost, slots | UI (functions) | the palette's command rows drawn as function cards by the shown system; needs a command presentation slot on the palette. Gap `01M5S0J1FVEGHTYJVY4HRS857S` | gap |
| **Limiters**: optional handicaps the owner opts into (a focus limiter hides everything but the zoomed subtree) | UI (Limiters at Access Points) | a perspective setting on a page, chosen like a backdrop | planned |
| The Process erasing: a deleted node dissolves through square cells | World (the Process) | a delete gesture on a row, a stepped `mask` keyed on the write | planned |
| Light trails along the graph's edges | World (Cloudbank) | a graph lens theme for the system. Gap `01M5S0HPNDEZ9RSQW4W679VP03` (as ZZZ's graph look) | gap |
| The owner's own key art behind the ground | (owner's art) | **user art slot**: a local path in a device preference, layered under the theme's ground at ≤ 50% with a mask that keeps the reading column clear; never committed. Todo `01M5S0J2FD47A4G62D9YBPS9AN` | planned |
| The game's own art, logo or font | — | never committed (public repo); only through the user art slot | — |

The planned rows other than the art slot are tracked as todo `01M5S0J3D9PV76EV83ZZM9XN1Q`.
