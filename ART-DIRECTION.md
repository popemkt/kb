# kb art direction

This is the canonical home for what each of kb's themes is *after*, and where that lives in the source. Each
theme is mapped from its source look, to UI concepts, to the file, token, component or class that carries
each concept. How a theme is built (its tokens, its art planes, its pairing, its contract) is
[DESIGN-UI.md → Design tokens → Themes](DESIGN-UI.md#themes); this file does not restate it. Which of a
theme's pieces are data in kb, reachable through its actions, and which are code is
[Theming: what is data and what is code](DESIGN-UI.md#theming-what-is-data-and-what-is-code).

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

**B. kb translation.** Design system `themes.zzz` (label *ZZZ*). It brings two page-head backdrops,
`themes.broadcast` (its pairing) and `themes.hollow`; both are declared in `themes/src/extension.ts` as
belonging to it, and it as choosing Broadcast (`SeedOption.chooses`).

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
| CRT broadcast in the page head: slabs, a TV with colour bars, ON AIR tab, a REC lamp that blinks while editing, a static burst on a write | World (CRT and VHS) | `themes-ui/art/broadcast-backdrop.tsx` (`themes.broadcast`, the pairing) | shipped |
| A Hollow in the page head: a comic panel torn open on a turning ether, the head colour at its eye, halftone, a ZONE 06 sticker, caution tape, sparks, a wall of screens whose lit tile steps on each write | World (the Hollows, interactive comic) | `themes-ui/art/hollow-backdrop.tsx` (`themes.hollow`); `art/backdrops-extra.css` · `.kb-hollow-*` | shipped |
| A channel number before the palette's input; a saturated scrim | UI (channel strips) | `zzz.css` · `--palette-mark: "CH 06 ▸"`, `--scrim-filter` | shipped |
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

**B. kb translation.** Design system `themes.transistor` (label *Transistor*). It brings two page-head
backdrops, `themes.cloudbank` (its pairing) and `themes.ovc`. The first-glance cues match bb-lively's
Cloudbank preset: the Turn() bar, the Process wash named `Jaunt()`, functions in amber terminal capitals,
the sword's teal light on the seams.

| Concept | From | Lives in | Status |
|---|---|---|---|
| Night palette: turquoise sword-light as the accent, magenta and Red's orange-red for events, gold for highlights | Art | `themes-ui/design-systems/transistor.css` · dark block `--primary` `--chart-1..5` `--destructive` `--warning` | shipped |
| The night is teal-blue, not violet | Art (muted night palette) | `transistor.css` · `--background` `--card` `--sidebar`: a teal night keeps cyan and ivory at AA on every ground; the violet-magenta dusk lives in the art (the ground's wash, the head's sky) | shipped |
| Cloudbank by day (light) | Art | `transistor.css` · base block: warm ivory, deep teal ink, a teal accent | shipped |
| Art Nouveau lettering for titles: thin flared small capitals | Art | `transistor.css` · `--app-font-display` Marcellus SC, `--display-tracking: 0.04em`; `.kb-display` | shipped |
| Functions written as programs, in an OVC terminal's amber | UI (`Crash()`, `Breach()`), Art (Red's gold) | `transistor.css` · `--app-font-label` Share Tech Mono, `--label-tracking: 0.14em`, `--label-ink` amber (deep amber by day); `.kb-label` | shipped |
| The sword's light along the seams | Art (turquoise sword-light) | `transistor.css` · dark `--border`, `--sidebar-border`: cyan at low alpha | shipped |
| A clean 1920s sans for all-day reading | Art | `transistor.css` · `--app-font` Jost, a half step up the type scale | shipped |
| Ornamental frames | Art (Art Nouveau composition) | `transistor.css` · `--corner-shape: scoop` | shipped |
| The sword's light instead of a cast shadow | Art (turquoise sword-light) | `transistor.css` · `--elevation-*`: a cyan hairline and glow | shipped |
| Painterly wash and a gilt hairline over the chrome | Art (gold linework) | `transistor.css` · `--art-chrome`; `.kb-chrome` | shipped |
| Cloudbank's skyline under the page: far and near towers, domes, onion bulbs, spires, ringed towers, arched bridges, lit windows | Art (arched and domed towers) | `themes-ui/art/skyline.ts` (seeded, deterministic, every crown inside the drawing), `art/skyline-svg.tsx`; `art/transistor-art.tsx` · `CloudbankGround`; `.kb-cloudbank-city` | shipped |
| Light rails gliding through the city | World (Cloudbank) | `transistor-art.tsx` · `RAILS`; `.kb-cloudbank-rail` (transform only, periods ≥ 16s) | shipped |
| A function executing: one bright trail across the city on a structural write | Motion (sharp, instant execution) | `transistor-art.tsx` · `useStructuralWrites`, `useBeat`; `.kb-cloudbank-trail` | shipped |
| **Turn() is the command palette**: opening it freezes the world (the page behind turns colourless under a cyan grid), and the palette is named `Turn()` with its eight-segment bar filling one by one | UI (Turn()), Sound (EQ muffle) | `transistor.css` · `--palette-mark: "Turn()"`, `--palette-bar` (eight cyan segments), `--palette-bar-width`, `--scrim-filter` (`saturate(0.15)`), `--art-scrim` (16px cyan grid); `app/ui/tokens.css` `.kb-palette-mark`, `.kb-scrim`; `motion.css` `kb-palette-bar` (`steps(8)`) | shipped |
| **Jaunt()**: a page change is the Process whitewashing the frame, Process white under a cyan cell grid crossing in steps, its edges dissolving in bands | World (the Process), UI (functions) | `transistor-art.tsx` · `JauntVeil` (veil plane, `useGesture`); `art/art.css` · `.kb-jaunt-cells` `.kb-jaunt-label` (`steps(14)`) | shipped |
| A function loadout down the sidebar's edge (`Crash() Breach() Jaunt()`) | UI (functions) | needs a sidebar-gutter mark token. Gap `01M5SNSR9AC5V1NA31QY8DNEX6` | gap |
| The muffled score as a freeze cue: a surface arrives grey and the colour runs back in | Sound → motion (EQ muffle) | `app/ui/motion.css` · `kb-enter-turn`, `kb-reveal-turn`; `transistor.css` · `--motion-enter` `--motion-reveal` | shipped |
| Plan slowly, then act at once | Motion | `transistor.css` · `--motion-settle` with no overshoot, long `--motion-duration-*` | shipped |
| A painted dusk in the page head: a sun with its rings, the skyline, a rail; the windows brighten while the owner edits | Art, Sound (Red's held hum) | `themes-ui/art/cloudbank-backdrop.tsx` (`themes.cloudbank`, the pairing, `data-editing`) | shipped |
| An OVC voting terminal in the page head: a gold Deco frame with notched corners and a sunburst crown, amber terminal lines in kb's words, a ten-segment tally in the head colour that counts writes, a blinking cursor, amber city lights on a violet night | UI (menus as a terminal in an Art Nouveau frame), World (citizens vote) | `themes-ui/art/ovc-backdrop.tsx` (`themes.ovc`); `art/backdrops-extra.css` · `.kb-ovc-*` | shipped |
| **Turn() as a plan mode**: queue structural edits (moves, retags, deletes) without applying them, see them drawn as a plan over the outline, then execute them as one transaction | UI (Turn(): the bar drains as actions queue; release runs them at once) | a staged-transaction preview: the outline drawing a pending transaction, and a palette command to start and release a turn. Gap `01M5S0J203QE0ZMB7MGN7GJXD8` | gap |
| **Functions as cards** in the command palette: `name()`, a MEM cost, slots | UI (functions) | the palette's command rows drawn as function cards by the shown system; needs a command presentation slot on the palette. Gap `01M5S0J1FVEGHTYJVY4HRS857S` | gap |
| **Limiters**: optional handicaps the owner opts into (a focus limiter hides everything but the zoomed subtree) | UI (Limiters at Access Points) | a perspective setting on a page, chosen like a backdrop | planned |
| The Process erasing: a deleted node dissolves through square cells | World (the Process) | a delete gesture on a row, a stepped `mask` keyed on the write | planned |
| Light trails along the graph's edges | World (Cloudbank) | a graph lens theme for the system. Gap `01M5S0HPNDEZ9RSQW4W679VP03` (as ZZZ's graph look) | gap |
| The owner's own key art behind the ground | (owner's art) | **user art slot**: a local path in a device preference, layered under the theme's ground at ≤ 50% with a mask that keeps the reading column clear; never committed. Todo `01M5S0J2FD47A4G62D9YBPS9AN` | planned |
| The game's own art, logo or font | — | never committed (public repo); only through the user art slot | — |

The planned rows other than the art slot are tracked as todo `01M5S0J3D9PV76EV83ZZM9XN1Q`.

---

## NieR:Automata — YoRHa

**A. Topic analysis.** PlatinumGames / Square Enix's *NieR:Automata* (2017). UI by Kijima, at Yoko Taro's
request for "a nice, warm beige".
- **World**: androids fighting machines for a humanity that is gone; melancholy, uncanny.
- **Art**:
  - warm beige paper with dark khaki ink and a muted red-orange accent;
  - a faint grid, edge darkening, like a convex monitor;
  - motifs from musical scores (staff lines, clefs, colons).
- **UI**:
  - square corners and bracketed corners;
  - inverted (dark-on-beige) selection with a small square marker;
  - condensed, letter-spaced labels;
  - a self-destruct function that breaks the UI itself.
- **Motion**:
  - precise and mechanical: linear slides and steps, scan lines;
  - glitch and slice on damage;
  - the developers tuned animations to look "a little moist", so they are soft, not bouncy.
- **Sound → motion**: Pod chatter and menu blips are short and digital.
- **Anchors**: beige `#cfc8ae`–`#dad4bb`, khaki ink `#4e4b42` ~, rust `#8e3b26` ~.

**B. kb translation.** Design system `themes.yorha` (label *YoRHa*), light-first. It brings the page-head
backdrop `themes.bunker`, its pairing.

| Concept | From | Lives in | Status |
|---|---|---|---|
| Warm beige paper, khaki ink, rust for destruction; a khaki night | Art | `themes-ui/design-systems/yorha.css` · base block `--background` `--foreground` `--primary` `--destructive`; dark block | shipped |
| Square corners | UI | `yorha.css` · `--radius: 0`, `--corner-shape: square` | shipped |
| Flat ink offset blocks instead of shadows | Art | `yorha.css` · `--elevation-*`: a 1px ink ring and a short hard offset, no blur | shipped |
| Condensed, letter-spaced capitals for titles and labels | UI | `yorha.css` · `--app-font` Barlow, `--app-font-display` and `--app-font-label` Barlow Condensed, `--display-case: uppercase`, wide `--label-tracking`; `.kb-display`, `.kb-label` | shipped |
| A small square marker before the palette's input | UI (the square marker) | `yorha.css` · `--palette-mark: "■"` | shipped |
| A faint grid over the chrome; scan lines and a sepia cast under a modal | Art (grid, convex monitor) | `yorha.css` · `--art-chrome`, `--art-scrim`, `--scrim-filter` | shipped |
| Precise and mechanical, soft rather than bouncy ("a little moist") | Motion | `yorha.css` · `--motion-settle` (a soft cubic-bezier, no overshoot), short durations; `--motion-enter: kb-enter-scan`, `--motion-reveal: kb-reveal-scan` (`app/ui/motion.css`) | shipped |
| Glitch and slice on damage: a failure arrives glitching | Motion (damage) | `yorha.css` · `--motion-alert: kb-alert-glitch`; `motion.css` `kb-alert-glitch`; `.kb-alert-enter` on error toasts (`App.tsx`) | shipped |
| The ground: a faint grid, edge darkening like a convex monitor, staff lines with colons, bracketed corners, one slow scan line | Art (grid, edge darkening, musical scores), UI (bracketed corners) | `themes-ui/art/yorha-art.tsx` · `YorhaGround`; `art/yorha.css` · `.kb-yorha-grid` `-vignette` `-staff` `-colon` `-bracket` `-scan` | shipped |
| A page change is a scan-bar wipe: ink bars stepping across, `■ ACCESSING : : NODE RECORD` | Motion (linear slides and steps, scan lines) | `yorha-art.tsx` · `YorhaVeil` (veil plane, `useGesture`); `.kb-yorha-wipe` `.kb-yorha-bar` | shipped |
| Pod chatter: a structural write shows a short report in the corner (`■ NODE WRITTEN`, in kb's words) | Sound → motion (Pod chatter, menu blips) | `yorha-art.tsx` · `REPORTS`; `.kb-yorha-report` | shipped |
| The Bunker's HUD in the page head: brackets, an `■ ARCHIVE` label, staff and ruler, a reticle in the head colour that turns faster while editing and pings on a write | UI (bracketed corners), Art (scores) | `themes-ui/art/bunker-backdrop.tsx` (`themes.bunker`, the pairing); `art/yorha.css` · `.kb-bunker-*` | shipped |
| Inverted selection (dark bar, beige text) with a small square marker | UI | the selected sidebar and picker row take no token: gap `01M5SNSR9AC5V1NA31QY8DNEX6` | gap |
| A self-destruct that breaks the UI itself | UI (self-destruct) | a gesture on deleting a page: its rows slice apart and fall in steps | planned |
| The game's own art, logo or font | — | never committed (public repo); only through the user art slot | — |
