# Canvas on a phone

Date: 2026-10-28. Branch `bb/kb-canvas-mobile-friendly-thr_6u9edsgs72`, based on `main`
at `f3b7041b`.

The owner opened a canvas on an Android phone, held upright, and found it hard to use. The
tool strip stood two columns wide down the left edge and covered about a quarter of the
screen. The axis gizmo and the dock floated over the cards, and the header wrapped. One finger
dragged the page and not the canvas, and a pinch zoomed the whole page. This note says how
the canvas should behave on a touch screen, based on how tldraw, Excalidraw, Figma and Miro
behave on phones. The spec it changes is
[DESIGN-UI.md → Canvas (i3)](../../DESIGN-UI.md#canvas-i3); this note gives the reasons, and
DESIGN-UI.md states the result.

Screenshots from before and after the change are in
`.kb/assets/kb-canvas/2026-10-28/mobile/`. Assets are backup-owned and are not committed.

## What was wrong, by cause

1. **The browser took the gestures.** The 2D stage had no `touch-action`, so a touch that
   moved became a page scroll and its pointer was cancelled. A pinch zoomed bb's page instead
   of the canvas. Nothing in either projection handled more than one pointer: "a pinch zooms"
   only meant a trackpad pinch, which arrives as a wheel event with Ctrl held.
2. **A tap was read as a drag.** The one slop, `POINTER_SLOP`, was 4 CSS px, a mouse's
   tolerance. A finger moves 5 to 10 px during a tap. So a tap on a card moved it by a few px
   and wrote an undo step, and a tap on empty canvas started a marquee.
3. **The chrome was built for a desktop stage.** The tool strip held 14 tools and 2
   projections in one column, which wraps into more columns on a short stage. The gizmo, the
   comments switch, the selection toolbar ("1 selected · Group · ↑ Front · ↓ Back · Delete")
   and the header ("← canvases", "Add node", zoom) were all sized for a mouse. Only the dock
   already knew a narrow stage (`DOCK_COMPACT_WIDTH`).

## What others do

| | one finger on empty canvas | two fingers | long press | toolbar on a phone |
|---|---|---|---|---|
| tldraw | the tool; select draws a marquee | pan and pinch zoom, any tool | context menu | bottom row with an overflow; style panel behind a button |
| Excalidraw | the tool; selection box | pan and pinch zoom | context menu | bottom bar; shapes in a popover |
| Figma (mobile) | pans (it is mostly a viewer) | pan and pinch zoom | — | bottom sheet |
| Miro | select: marquee; hand: pan | pan and pinch zoom | context menu | bottom bar, "more" sheet |

All four agree on these points:

- Two fingers always move the camera, whatever tool is armed.
- When the second finger lands, the first finger's gesture is abandoned.
- A long press is the touch version of a right click.
- On a small screen, a short toolbar runs along the bottom and the rest of the tools sit
  behind an overflow.

tldraw also uses a larger drag distance for a coarse pointer than for a mouse (its
`coarseDragDistance`). Android's platform touch slop is 8 dp.

Orientation: the web cannot lock orientation in a normal tab. `screen.orientation.lock()`
works only in fullscreen or an installed PWA. It works on Android Chrome, and iPhone Safari
has neither. So the layout must work upright, and landscape is offered where the platform
allows it.

## Decisions

1. **Gestures: one recognizer, both projections** (`canvas-touch.ts`). It hears touch
   pointers over either projection layer before the projection does (capture phase), and the
   layers are `touch-action: none`.
   - One finger is a press, exactly as a mouse's: the armed tool's (select: marquee or
     carry; in 3D, orbit). This follows tldraw and Excalidraw, so a person can still select
     and draw with one finger. The hand tool sits in the compact strip for one-finger panning.
   - A second finger turns the touch into a **camera gesture**. The first finger's press is
     cancelled the way the browser cancels a touch it takes for itself: a `pointercancel` to
     the target the press went to. Both projections already undo a cancelled press, so a
     half-made drag, marquee or stroke goes. From then until every finger is up, the spread
     of the fingers zooms about their midpoint and the midpoint's travel pans. With one finger
     left, it pans. Both projections answer this through the camera controls the keymap
     already uses (`CanvasViewportControls`), which gain `panBy`, `zoomAt` and `settle`. The
     2D wheel zoom goes through `zoomAt` too, which reads the camera model's `zoomViewAt`, so
     a pinch, a wheel and the 3D rig zoom by one rule. A 3D pose is saved when the fingers
     lift.
   - A **long press** is a press held for `LONG_PRESS_MS` (500 ms, Android's) without
     passing the touch slop. It opens the context menu by the same path as a right click: the
     recognizer cancels the press and sends a `contextmenu` at that point. While a finger is
     down, the browser's own long-press menu is swallowed, so only one menu opens.
2. **Slop belongs to the pointer kind.** `POINTER_SLOPS` is `{ mouse: 4, pen: 4, touch: 8 }`,
   and `pastSlop(dx, dy, kind)` takes the kind of the pointer that pressed. Every surface that
   tells a tap from a drag uses this one table: the canvas reducer (through its context), the
   3D gestures, the scene kit's taps, and the graph's node drag.
3. **One compact stage.** The dock's narrow-stage rule becomes the stage's rule
   (`canvas-stage-layout.ts`, `compactStage`). A stage narrower than 720 px (a phone, or a
   side panel) or shorter than 480 px (a phone on its side) is compact. Every piece of chrome
   reads this one answer:
   - The **tool strip** is one row centred along the bottom edge. Its buttons are 40 px
     (tldraw's), and the strip clears the safe-area inset. It holds the tools the strip names
     as first (`select`, `hand`, `draw`, `arrow`, `text`, the shapes), and a **More** button
     opens a sheet with every other tool and the 2D/3D toggle. Which tools come first is data
     on the strip's one table, so there is no second toolbar.
   - The **view widget** folds its axis gizmo away and keeps its name, which opens the view
     menu.
   - The **selection toolbar** shows icons with labels for screen readers, and stands above
     the tool strip.
   - The **dock** folds its panels to their titles, as it already did.
   - The **header** drops "Add node", because the kb-node tool in More places a node the same
     way (`pickTool`). "← canvases" becomes an arrow.
4. **Fullscreen, and landscape where allowed.** The view menu gets a "Full screen" row (a
   command in the shortcut table, with no key). It puts the canvas page in fullscreen and
   then asks for landscape (`screen.orientation.lock`). A refusal is ignored, so the canvas
   stays usable upright. The row is disabled where `document.fullscreenEnabled` is false, as on
   an iPhone.
5. **Out of scope, recorded as gaps:**
   - Coarse-pointer hit areas for the resize and rotate handles and the ports. Their size is
     one statement (`canvas-chrome.ts`) that the scripts' press mask also reads, so enlarging
     them for touch must change that statement, not add CSS beside it.
   - A long press in 3D (there is no 3D context menu yet, gap `01M5QQVBJFGF3GKZJVF151CABJ`).
   - A marquee in 3D, as before (gap `01M41AB88FH1G58NR7AZE0SZJF`).

## Proof

`canvas-touch.test.ts` checks the recognizer as a pure state machine: tap, drag, second-finger
takeover, pinch about the midpoint, the long press, and the slop. Two e2e specs
(`canvas-mobile.e2e.ts`) run Chromium at a Pixel 7 size (412×915, `hasTouch`, `isMobile`) and
at an iPhone 14 size (390×844), upright and on its side:

- The compact strip is a single row along the bottom, and every primary tool is 40 px or more.
- More opens and picks a tool.
- A two-finger pinch zooms the 2D canvas about the midpoint, and a two-finger drag pans it.
  The same pinch zooms the 3D canvas.
- A one-finger tap selects a card without moving it.
- A long press opens the context menu.
- No chrome covers the cards' middle at the opening view.

The touches are sent as CDP `Input.dispatchTouchEvent`, the same path a real screen's
touches take.
