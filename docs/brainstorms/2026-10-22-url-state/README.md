# UI state in the URL — a link or a reload restores what you saw

**Status: design for the owner's review, not built.** Date: 2026-10-22.

The owner wants kb to keep its UI state in the URL throughout, so that a link
or a reload brings back exactly what was on screen. Today the URL carries the
route path and nothing else. Much of what a person sees lives in memory and is
lost on reload, or lives in `localStorage` and is shared by every tab on the
device. This record lists where each piece of UI state lives today, proposes
one rule for where it belongs, gives a URL schema and the history semantics,
and orders the migration as small PRs.

All `file:line` references are against `main` at `dba6d4fc`.

## Decisions this design rests on

1. **A location is a path and a query string, and nothing else names where
   you are.** Today a location is a path (`LayoutPane.path`,
   `domain/views/src/layout.ts:21-34`; `getPath` reads `location.pathname`
   only, `kit/ui-sdk/src/lib/router.ts:17-19`). It becomes `path?query`
   everywhere the path is used now: the router, a pane, a saved layout, a
   link. There is no second "view state" object beside the location.
2. **The route that owns a path owns its query.** A `Route` already decodes
   its path into the view's params (`provideRoute`, `plugins.ts:189`). It
   gains a codec for its query keys, a `Schema` like the params it already
   has. The shell owns a short list of keys that mean the same thing on every
   route (`sel`, `panel`). No component reads `location.search` itself.
3. **Back and forward move between places; they never undo edits.** Going to
   a different place pushes a history entry. Changing how you look at the
   same place replaces the current one. Graph undo stays `⌘Z`
   (`graph.store.ts` `undoStack`) and never goes through history.
4. **The URL holds ids and small values only.** Node ids, view keys, numbers,
   short enums. It never holds node text or a serialized config, so that a
   link stays short and never copies data out of the graph.
5. **Everything is a node still wins.** How a view is configured (filters,
   sort, group, columns, page size, the renderer, lens settings) is the view
   node's data and stays there. The URL never shadows a view node's settings.
   A link that needs a differently configured view links to another view
   node.

## Where each piece of state lives today

The tiers used below:

- **path:** the route path.
- **graph:** a view node or a setting node in `.kb/nodes.jsonl`. It is shared
  with everyone and survives everything.
- **local:** `localStorage`, shared by every tab on the device.
- **session:** `sessionStorage`, one tab.
- **memory:** a zustand store or React state. It is lost on reload.

| State | Lives in today | Owner | Survives reload | In a link |
|---|---|---|---|---|
| Route: node, view, perspective, canvas, ontology scope, lab scene | path | route matchers (`outline-ui/src/routes.ts`, `layout/routes.ts`, `ontology/routes.ts`, `graph-ui/src/routes.ts`, `canvas-ui/src/routes.ts`, `lab-ui/src/routes.ts`) | yes | yes |
| Outline zoom at `/` | memory: `useGraphStore.rootNodeId` | `graph.store.ts:125,379-390` | no | no |
| Focused pane | path (the URL is the focused pane's path) | `workspace.store.ts:116-118,135` | yes | yes |
| Other panes, splits, sizes | local: `kb-workspace` | `workspace.store.ts:43,76-103` | yes (per device) | no; only through "Save workspace" as a layout node |
| Expanded and collapsed rows | local: `kb-expansion` (`kb-expanded` read as legacy) | `ui-sdk/src/lib/types.ts:28,33`; `outline.store.ts:196-204,376-382` | yes (per device) | no |
| Focused row, caret | memory: `useOutlineStore.activeNodeId`, `pendingCaret` | `outline.store.ts:71-90` | no | no |
| Selected row (outline) | memory: `selectedNodeId` | `outline.store.ts:78-79` | no | no |
| Selected node (graph) | memory: React state | `graph-page.tsx:186` | no | no |
| Selected items (canvas) | memory: React state | `use-canvas-selection.ts:73-80` | no | no |
| Frame view type (list / table / board) | graph: the frame's view node | `view-toolbar.tsx:26-34` | yes | yes |
| Filters, sort, group, columns, column widths, page size | graph: `sys.f.view.*` on the view node | `domain/views/src/frame.ts:38-117,353` | yes | yes |
| Pages revealed in a frame ("show more") | memory: `outline.store.framePages` | `outline.store.ts:106,541-543` | no | no |
| Graph renderer (2D / 3D), lens settings | graph: the perspective node | `graph-ui/src/lens-writes.ts`, `graph/src/perspective.ts:26` | yes | yes |
| Graph camera | memory: renderer and React state | `graph-page.tsx:185` | no | no |
| Graph search, legend filters | memory: React state | `graph-toolbar.tsx:34-35`, `graph-legend.tsx:19-20` | no | no |
| Graph "include system nodes" | local: `kb-graph-include-sys` | `graph-page.tsx:55,76-90` | yes (per device) | no |
| Canvas projection and pose (camera) | graph: the canvas view node, debounce-written | `canvas/src/camera.ts`, `use-canvas-camera.ts:91-119` | yes | yes, but the camera a link shows is the last one anyone saved |
| Canvas tool, zoom, presenting item, menus | memory: React state | `canvas-page.tsx:149-161` | no | no |
| Query panel open, and its Conditions / EDN tab | memory: `outline.store.queryTabs`, `QueryPanel` state | `outline.store.ts:109,538`; `query-panel.tsx:58,134` | no | no |
| Dock | memory: `ui.store.openDock` | `ui.store.ts:57,82` | no | no |
| Popovers (view settings, view filter, preferences, perspective picker, pane switcher) and palettes | memory: `ui.store` flags and React state | `ui.store.ts:41-52`; `view-filter-popover.tsx`; `graph-settings.tsx:29` | no | no |
| Palette and search query text | memory: React state | `command-palette.tsx:46`, `node-command-palette.tsx:55-57` | no | no |
| Scroll position | memory: `WeakMap` keyed by pane body, restored only after a pane moves | `pane-mount.tsx:3-30` | no | no |
| Docked sidebar open, theme, width | local: `kb-prefs` | `prefs.store.ts:25,49-72,129-136` | yes (per device) | no |
| Design system | graph: `sys.f.design-system`; `kb-design-system` in local is a paint cache | `design-system.store.ts:1-19,33` | yes | yes |
| Debug field rows | local: `kb-debug-fields` | `debug-fields.store.ts:30-39` | yes (per device) | no |
| Tab identity | session: `kb.tab-session` | `api/tab-session.ts:11-53` | yes (same tab) | no, by design |

What the table shows:

- **Only the path is URL state.** Nothing reads or writes the query string
  (no `URLSearchParams`, no `location.search` in `packages/`). There is no
  router library; `router.ts` is 65 lines.
- **The zoom is the largest hole.** Reload at a zoomed outline returns to
  the workspace root. Two panes at `/` share one zoom
  (GAP [[01M411FP5AGQ4VB5SGJWCJAN66]], which already names the fix:
  "move the zoom into the pane's location"). "Save workspace" already
  rewrites a pane at a zoomed `/` to `/node/<zoom>` (`keptLayout`,
  `workspace.store.ts:180-187`), so the two are already treated as one
  place in one code path and as two in the others.
- **The canvas camera is in the wrong tier.** Panning a canvas writes the
  view node after 300 ms, so looking around is an edit that every other
  viewer receives, and a link opens wherever the last person stopped.
- **Selection, open panels and scroll are all memory.** None of them
  survives reload.

## Where each piece of state belongs

One question decides the tier. Ask it in this order and stop at the first
yes:

1. **Is it what the thing is, or how it is configured for everyone?** Then
   it is **graph** data on a node: filters, sort, group, columns, page size,
   the frame's view type, the renderer, lens settings, the design system. A
   person changes it on purpose, and every viewer sees the change.
2. **Is it where you are, or what you are looking at there?** Then it is
   **URL** state: the place (path), the zoom, the selection, an open panel
   and its tab, the graph or canvas camera, and a graph search. It can be
   linked, and it survives reload.
3. **Is it how far into the page you are, in this visit?** Then it is
   **history-entry** state, kept in `history.state`: the scroll offset, the
   pages revealed in a frame, and the caret. Reload and back/forward bring
   it back, because the browser keeps `history.state` with each entry. A
   link does not carry it, because the person you send the link to starts
   at the top. This tier is new, and it is the one place scroll goes.
4. **Is it about this device or this person rather than a place?** Then it
   is **local** state: theme, width, the docked sidebar, debug rows,
   "include system nodes", the row expansion, and the other panes of the
   workspace.
5. **Otherwise it is ephemeral memory:** a popover or palette that closes
   on Escape or an outside click, a drag in progress, the text typed into a
   picker, toasts. A reload shows the page under it, as it was.

Placements that need a reason:

- **Expansion stays local.** The set of expanded rows can run to thousands
  of ids, which no URL can hold, and it is a habit of the person more than
  a place. A link restores the zoom and the selection, and the selected row
  is revealed (its ancestors expanded), so the person receiving the link
  sees the row it points at.
- **Popovers are ephemeral, panels are URL.** The line is how they close.
  The query panel and a dock stay open while you work, so they are part of
  what you see and go in the URL. A popover closes when focus leaves it, so
  a reload that reopened it would be a surprise.
- **The other panes stay local.** Only the focused pane is in the URL, as
  today. A shareable multi-pane screen already has a home: a layout node
  ("Save workspace"), opened at `/node/<layout id>`. Encoding a pane tree
  into the query string would be a second way to store a layout.
- **The canvas camera moves to the URL.** The view node keeps a pose, but
  as the canvas's home position, which a person sets on purpose ("Set as
  home view"). Panning stops writing the graph. This changes behaviour, so
  it is an open question below.
- **Tab identity never enters the URL.** See
  [The per-tab session id](#the-per-tab-session-id).

## URL schema

```
/<route path>?<shell keys>&<route keys>
```

**The path is unchanged,** with one addition. The zoomed outline becomes
`/node/<id>`, which `/node/<id>` already shows when the node's default view
is the outline. The zoom stops being separate state. `/` stays the
workspace root. A node whose default view is not the outline is zoomed as
`/node/<id>/outline`.

**Shell keys** are owned by the shell (`@kb/ui`). They mean the same thing on
every route, and the route decides whether it honours them:

| Key | Value | Meaning |
|---|---|---|
| `sel` | node id, or `id,id,…` | The selection. A route that has no multi-select reads the first id. |
| `panel` | `<kind>:<node id>` | The panel open beside the content, e.g. `panel=query:01M…`. One at a time, as the dock is today. |
| `tab` | short enum | The panel's tab, e.g. `tab=edn`. Omitted when it is the default. |

**Route keys** are declared by the route, in its query codec:

| Route | Key | Value |
|---|---|---|
| `/graph[/<perspective>]`, `/o/<id>/graph` | `cam` | `x,y,z` or `x,y,zoom`, rounded |
| | `find` | the graph search text |
| | `only` | legend filters, as `tag,tag` ids |
| `/canvas/<id>[/<item>]` | `cam` | `x,y,zoom[,yaw,pitch]`, rounded; absent means the canvas's home pose |
| `/lab/<scene>` | per scene | its own codec, if it wants one |

Rules for the encoding:

- **Defaults are omitted,** so an untouched page has a bare path, and two
  links to the same view compare equal.
- **Keys are printed in a fixed order** by the codec, so the same state
  always prints the same URL. A replace that would not change the string is
  skipped.
- **A value that does not decode is dropped, never an error.** It is
  treated as the key's default. A stale id in `sel` selects nothing. A link
  never opens on a broken page because of its query string, the same rule
  `matchPath` applies to a malformed path today (`plugins.ts:180`).
- **Free text** (only `find`) is percent-encoded and capped, at 200
  characters say.
- **No `#fragment`.** The skip link already avoids writing one
  (`App.tsx` `SkipLink`).

## History: push, replace, and the entry's own state

| Change | History | Why |
|---|---|---|
| Open a node, follow a reference, a crumb, zoom in or out | **push** | A different place. |
| Change the view (`/node/<id>/<view>`), the perspective, open a canvas, enter or leave an ontology scope | **push** | A different place. |
| Select a row or node, change the selection | **replace** | The same place. Back should not walk through every click. |
| Open or close a panel, change its tab | **replace** | The same place. |
| Pan or zoom a camera; type a graph search; toggle a legend filter | **replace, throttled** (at most every 250 ms, and on idle) | The same place. Safari also refuses more than about 100 history calls in 30 s. |
| Move focus to another pane | **replace** (as today, `workspace.store.ts:116-118`) | The URL names the focused pane. |
| Scroll, reveal more pages, move the caret | **`history.state` of the current entry**, throttled | Restored on reload and on back/forward; not in the link. |
| Any graph write | **none** | Undo is `⌘Z`. |

On back and forward (`popstate`), the router parses the location, and the
stores follow from it, just as they do on a fresh load. There is one path
from a URL to the screen, used on load, on popstate, and when an agent moves
the tab. When a push leaves an entry, the router first flushes any throttled
replace and the entry's scroll, so that coming back lands where you left.

`history.state` is keyed by pane id. An entry records the scroll of the pane
it belongs to, and `PaneMount` (`pane-mount.tsx`) reads it there instead of
from its in-memory `WeakMap`.

## The per-tab session id

PR #4 gave each tab an identity: a UUID in `sessionStorage["kb.tab-session"]`
(`api/tab-session.ts`). It is sent as `X-KB-Origin` on every action and on
the `/ws` handshake, it labels each transaction so a tab can recognise its
own echo, and it is the address under which a tab publishes its screen to
agents (`screen.ts:323-328`). DESIGN.md (`The tab session`) and DESIGN-UI.md
(`Who the tab is`) already say that no URL carries it. This design keeps
that, for these reasons:

- **The two answer different questions.** The URL says what is on screen.
  The session id says which tab is looking. Copying a URL to another tab, or
  to another person, must give them the same screen and not the same
  identity. If the id were in the URL, two tabs opened from one link would
  each claim the other's echo and its agent channel.
- **Duplicating a tab already copies both.** The browser copies
  `sessionStorage` and the history entries, including `history.state`. The
  server's refusal of a second live publisher with the same id, followed by
  `renewTabSession` (`screen.ts:291-296`), already handles the identity. The
  duplicated tab keeps the copied location and scroll, which is what
  "duplicate" means.
- **Agents move a tab through its location.** `ui.navigate` addressed to a
  tab's session id becomes a `navigate` (push) of a location, so that a
  person can press back after an agent has moved their screen. `ui.select`
  becomes a replace of `sel`. The screen a tab publishes (`screen.ts:79-103`)
  reads its active pane's location, query included, so an agent sees the
  same string the person could share.
- **Reload keeps both.** The session id survives a reload of the same tab,
  and so do the URL and `history.state`. After a reload, the tab has the same
  identity and the same screen.

## Migration, as small PRs

Each PR is green on its own and keeps behaviour unless it says otherwise.
The first two restructure, and the rest add (Rule 1: restructure, then add).

1. **A location is `path?query`.** `router.ts` reads and writes
   `pathname + search`. `usePath` becomes `useLocation` and returns
   `{path, query}`. `LayoutPane.path` keeps the whole string (saved layouts
   are unchanged, because they hold no query yet). Route matchers still see
   the path. No behaviour change. Tests: every existing route test, and a
   round trip of a location through a pane and a saved layout.
2. **Routes own their query.** `Route` gains an optional query codec (a
   `Schema`), and the shell registers its `sel`/`panel`/`tab` codec. The
   router decodes both, drops what fails, and prints in canonical order.
   `navigate(location)` pushes, and `replaceQuery(patch)` replaces and skips
   when nothing changed. No route uses it yet. Tests: the codec rules above,
   as properties.
3. **The zoom is the location.** Zooming the outline at `/` navigates to
   `/node/<id>`. `rootNodeId` becomes derived from the focused pane's route,
   and is no longer set on its own. Home and Pinned navigate. `keptLayout`'s
   rewrite is deleted, because there is nothing left to rewrite. This closes
   GAP [[01M411FP5AGQ4VB5SGJWCJAN66]] (two panes at `/` sharing one zoom).
   It is the largest PR, and every later one depends on it.
4. **Selection in the URL.** The outline's `selectedNodeId` reads and writes
   `sel`, and a selected row on load is revealed. Then the graph's
   `selectedId`. Then the canvas selection. The screen report reads the
   same value.
5. **Panels in the URL.** The query panel's open state and its tab
   (`outline.store.queryTabs`) become `panel=query:<id>` and `tab`. `openDock`
   becomes `panel=<dock>:…`. `ui.store` loses the fields.
6. **Scroll and revealed pages in `history.state`.** `PaneMount` restores
   from the entry, keyed by pane. `outline.store.framePages` moves there.
   Tests: a render test that scrolls, reloads, and finds the same offset,
   and one that navigates away, goes back, and finds it.
7. **Cameras in the URL.** The graph camera becomes `cam`. The canvas camera
   becomes `cam`, and, if the owner agrees (open question 1), the view node's
   pose becomes the home pose that a command sets, and panning stops writing
   the graph.
8. **Graph search and legend filters in the URL** (`find`, `only`).
9. **The rule, made canonical and checked.** DESIGN-UI.md gains a
   "Location state" section, stating the tiers and the push/replace table
   once, and the "Panes and layouts" section links to it. A `#rule` node
   names it, and its enforcement is honest. A harness check that allows
   `localStorage`/`sessionStorage` keys only from one registry closes the
   gap between `prose` and a gate, so a new key needs a decision.

PRs 4 to 8 are independent once PR 3 has landed, and can be built in
parallel.

## Open questions for the owner

1. **The canvas camera.** Today panning is saved to the graph for everyone.
   The design moves the live camera to the URL and keeps the view node's pose
   as a home view that a person sets on purpose. The alternative keeps
   auto-save and puts the URL camera on top of it as an override. That
   alternative is two sources for one camera, which Rule 1 argues against.
2. **Expansion.** Is it acceptable that a link restores the zoom and the
   selection, but not the expansion of the rows around it?
3. **Multi-pane links.** Is "Save workspace, then share the layout node"
   enough, or does a plain link need to carry every pane?
4. **Zooming to a node whose default view is not the outline.** Should it
   open `/node/<id>/outline` explicitly, or should zooming open the node's
   default view, as following a link does?
