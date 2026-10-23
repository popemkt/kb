# Sessioned calls — an agent acts in the tab the person is looking at

**Status: built on `feat/tab-sessions` (S1–S9), 2026-10-23, with the
recommended answers to Questions 1 and 2 (the `tab` inputs removed with no
alias; `node.add` unchanged); Questions 3–6 stay open. DESIGN.md is now the
record of what was built; where the build departs from this plan is under
[As built](#as-built).** Date: 2026-10-22.
Written against `origin/main` at `8fd2beb1`. It was revised the same day
after an independent adversarial review; what changed and why is under
[Review](#review). It builds on
[DESIGN.md → Action registry](../../../DESIGN.md#action-registry) (who the
person is, the tab session, wires),
[DESIGN.md → Screen state](../../../DESIGN.md#screen-state),
[DESIGN.md → Agent packages](../../../DESIGN.md#agent-packages) and
[DESIGN-UI.md → Who the tab is](../../../DESIGN-UI.md#who-the-tab-is), and
restates none of them. The agent-native research it leans on is
[agent-native.md](../2026-09-29-kb-genui-canvas-agents/agent-native.md).

## What the owner asked

> When I'm in bb that means I'm a human using/chatting stuff, so having a
> webmcp site next to me is good (same as what codex usually does). I can
> tell you to do stuff on kb to show me, or you can use the mcp url, doesn't
> matter, depends on the situation where i want hands on, you driving the
> ui, or you getting the work done.
>
> Not all action is in a session, for example a ui action should be
> sessioned action, but a direct db modification through cli might not be.
> And sessioned action should get context differently from non sessioned
> action, like which page i'm at etc. […] Some action potentially could live
> on both sides.

The first host is **bb**, an agent IDE. A bb plugin shows the person's kb
page in a panel beside an agent thread, and that thread's agent works on kb.
Nothing below is specific to bb. bb is just the first embedder. Any page
that frames kb, and any agent told which tab is the person's, is the same
case.

## The concept in kb's terms

- A **session** is a tab session: the id a kb tab mints for itself and
  publishes its screen under. It already exists (PR #4).
- A **sessioned call** is an action call made *in* a tab session. It is
  about what that tab shows. Certain *required* inputs the caller leaves out
  ("this", "the open canvas") are filled from that tab's screen.
- An **unsessioned call** is made in no tab: `kb add` in a shell, a script,
  an agent doing bulk work. It names everything it touches, as every call
  must today.

Both kinds call the same actions. Being in a session is a property of the
call, never of the action. That is how "some actions live on both sides"
works without two copies of any action.

## What exists today

All paths are under `packages/`. These are facts, not proposals.

- **The tab session id.** `app/ui/src/api/tab-session.ts` mints it with
  `crypto.randomUUID()` and keeps it in sessionStorage (`kb.tab-session`).
  It is renewed when the server answers `screen-refused` (a duplicated
  tab). The id is sent in three places:
  - **The `X-KB-Origin` header** on `POST /api/action`
    (`api/action.ts:22`). The server provides it as `TxOrigin`
    (`server/src/http.ts:180`), which is recorded as the transaction's
    `origin` (`operations/src/session.ts:139`).
  - **The `tab` of the ws `{op:"screen"}` frame.** `ScreenHub.publish`
    keys the screen by it (`server/src/screens.ts:89-110`).
    `ScreenHub.tabOf(connection)` is what kb's agent reads as `peer.tab()`.
  - **An `?origin=` query on the ws URL** (`api/ws.ts:102`). The server
    **never reads it**: `server.ts:247` upgrades with a random `clientId`.
    DESIGN.md says "no URL carries it", so this is a dead seam.
- **`origin` on the transaction is a free label with three producers:**
  - the page's tab id (above);
  - `@kb/client`'s caller-chosen `Commit.origin` (`app/client/src/index.ts:136`);
  - `VIRTUAL_ORIGIN = "virtual"` for the saved-query set
    (`app/server/src/saved-queries.ts:97`).

  Own writes set none (`app/runtime/src/own-write.ts:61`). Nothing in the
  UI reads it; echo suppression no longer does
  (`server/src/session.ts:82-87`).
- **Which tab a call reaches is decided per action, by an input.**
  - `ui.navigate`, `ui.select`, `ui.capture` and `ui.screen` take `tab`.
    Without it, a command goes to the person's most recently active tab
    (`screens.ts:161-175`).
  - `remoteScreensLayer` forwards that `tab` from another process
    (`runtime/src/screens.ts:61,115`).
  - kb's agent passes it to `ui.screen` (`extension/agent/src/prompt.ts:67`).
  - `ext.canvas.describe` takes its own `tab`. It finds whichever pane shows
    the canvas, returns its pose and visible set, and defaults `focus` to
    the selection, else the visible set (`ext-canvas/src/verbs.ts:189-249`).
- **No surface passes the caller's tab to the call.**
  - WebMCP invokes `onWire(WEBMCP_WIRE, {id, input})`
    (`webmcp/src/webmcp.ts:157`) through the page's `invokeSettled`. So a
    page's own WebMCP `ui.navigate` moves *the most recently active tab*,
    not necessarily the page it was called in.
  - kb's agent invokes its tools with no tab
    (`extension/agent/src/bridge.ts:265`). It does know the sender's tab: it
    puts that tab's screen into the prompt as a `<screen>` block, once per
    user turn (`prompt.ts:62-79`; DESIGN.md → Agent packages). The model
    *could* copy `tab` out of that JSON, but the prompt doesn't tell it to.
- **The browser runs an isomorphic write twice.** `invokeSettled`
  (`app/ui/src/session/runtime.ts:288`) commits it on the local replica
  under `PAGE_WIRE`, then pushes *the same envelope* to the server. The
  browser layer has no `Screens` (`runtime.ts:135-140`).
- **The invoke core's order** (`operations/src/invoke.ts:~286-302`):
  1. interceptors rewrite the input;
  2. guards decide;
  3. the schema parses;
  4. `scriptRefusal` checks the parsed input against a script's grant using
     `def.targets`;
  5. dispatch.

  An interceptor returns `Effect<unknown>` with no requirements and cannot
  add to the receipt (`contracts/src/interception.ts:74-89`).
- **Optional inputs already have meaning when absent.** `node.add`'s
  `parent` is `z.string().optional()`, and absent means a forest root
  (`operations/src/actions.ts:67`). The page relies on that:
  `planDefineOntology` (`ui/src/actions/plan.ts:250`) and
  `createCanvasNode` (`canvas-ui/src/canvas-api.ts:150`).
  `omittable` (`contracts/src/screen.ts:266-272`) reads `null` as absent,
  for MCP clients that send omitted optionals as null.
- **A pane's selection is in the view's own ids**: node ids in the outline,
  item ids on a canvas (`contracts/src/screen.ts:102`).
- **Embedding.**
  - The kb page sends no `frame-ancestors`, no `X-Frame-Options` and no
    CSP, so any page can frame it. Only the sandbox frame sets
    `frame-ancestors 'self'` (`contract/sandbox/src/frame.ts:45`).
  - A framed page still sends kb's own `Origin`, so the guard treats it as
    the page (`server/src/guard.ts:124-152`). The guard returns early for
    non-`/api` paths (`:131`).
  - The page never talks to a parent window. The one prior art for kb
    inside a host is the MCP Apps snapshot, which speaks JSON-RPC to its
    parent with target `"*"` (`app/mcp/src/view-app.ts:44-88`).

### Duplicates this exposes (Rule 1)

**"Which tab session is this call in" lives in five places** that do not
know about each other:
- the `X-KB-Origin` header;
- the `tab` input of the four `ui.*` actions;
- `ext.canvas.describe`'s own `tab` input;
- the agent's `peer.tab()`;
- the ws `?origin=` query that nothing reads.

**"Fill an input from the screen"** lives in one agent's prompt only. This
design collapses the first before it adds the second.

## Prior art

- **agent-native** ([report](../2026-09-29-kb-genui-canvas-agents/agent-native.md)).
  - `ActionRunContext` carries `caller`, `threadId` and `runId`: per-call
    context beside the input, never in it. kb already splits things the
    same way: the wire says who calls.
  - It keeps the current screen in an `application_state` table, and its
    sidebar agent reads it. kb's `ScreenHub` is the same, in memory.
  - Its server agent reaches *page* tools through a DB-backed queue that the
    live tab polls (`run-browser-session-webmcp-tool`). kb needs no queue:
    `ScreenHub` already relays commands to a tab over its socket.
  - It does **not** fill action inputs from the screen. Deixis stays in the
    prompt, as it does in kb's agent today.
- **Codex's and Claude's in-app browsers.** The agent drives the page the
  person sees, and the page's own tools are the agent's tools. In kb's page
  that is WebMCP, and kb already has the adapter (DESIGN.md → Surfaces).
- **Editors' "current selection" commands** (VS Code commands, Figma
  plugins). A command run from the palette acts on the selection unless it
  is given arguments. That is a sessioned call with context filled.

## Decisions this design rests on

1. **A session is the tab session. No new id.** The id `tab-session.ts`
   mints is the session. It stays what DESIGN.md says it is: a name, not a
   credential (decision 9).

2. **`session` is an envelope member, like `approved` and `script`.**
   `ActionRequest` gains `session?: string`. `onWire` keeps or drops it per
   wire, through the same `carries(wire, …)` rule that decides what a wire
   may state. The wire says what it knows, never an input key:

   | Wire | Session |
   |---|---|
   | `PAGE_WIRE` | the page's tab session, in the envelope. The `X-KB-Origin` header goes. |
   | `WEBMCP_WIRE` | the page's own tab session, added by the page's adapter |
   | `AGENT_WIRE` (kb's agent) | the sending connection's tab (`ScreenHub.tabOf`) |
   | `HTTP_WIRE` (a local program) | `session` in the envelope, if it states one |
   | `ACTION_INVOKE_WIRE` | `session` in its JSON, if any |
   | `MCP_WIRE` | `_meta.session` on `tools/call` (MCP's own envelope); else the server's `--session` default (decision 3) |
   | `SCRIPT_WIRE`, `IN_PROCESS_WIRE` | inherited for the record only (decision 7) |

   The Screens port takes the session where it took `tab`, so
   `remoteScreensLayer` forwards it as an envelope member, not an input.

3. **MCP gets a follow mode, not a fixed id.** Ids are minted in the
   browser and renewed when a tab is duplicated, so a fixed
   `kb mcp --session <id>` would go stale. `kb mcp --session follow` instead
   binds each call to *the person's most recently active tab*, resolved per
   call by the same rule unsessioned `ui.*` uses today. That is the
   hands-on mode for an agent that only has MCP, such as Claude Code with
   kb's MCP server. An explicit `_meta.session` overrides it. Without the
   flag, MCP is unsessioned.

4. **The `tab` inputs go, after every wire can state a session.**
   - `ui.navigate`, `ui.select` and `ui.capture` read the session.
   - `ui.screen` keeps a filter, renamed `session`, because listing
     *other* tabs is its job.
   - `ext.canvas.describe` loses `tab` but keeps its own screen read.
     "Where is this canvas shown, and what does it see" is its output, not
     an input default (see Review).
   - The ws `?origin=` query is deleted, not wired.
   - This is a breaking input change with no alias, stated as the
     registry's breaking changes are. It lands last in the restructure, so
     no caller loses the ability to target a tab in between (Steps).

5. **Unsessioned `ui.*` keeps today's default.** A `ui.*` command with no
   session goes to the person's most recently active tab. A plain
   `kb mcp` can still "show the person something" without tab ids. Only
   input *filling* needs a session; steering needs only a person.

6. **An action declares which of its required inputs a session can fill.**
   - **The member.** The definition gains
     `context?: Partial<Record<InputKey, ReferenceId>>`.
   - **Only required keys.** Registration refuses a `context` key that the
     input schema does not require. This keeps the fill from changing what
     any call means today: a key whose absence already means something (a
     `node.add` without `parent` is a forest root) can never be filled.
     Every call that works now still works the same.
   - **References are contributed, not a core enum.** A *context reference*
     is `{id, resolve(pane: PaneScreen) → value | absent}`, contributed
     through a point.
     - Core contributes `focused` and `subject`. Both are node ids that
       every pane reports.
     - The canvas family contributes `canvas.open`, the canvas node the
       active pane shows (absent unless that pane's view is a canvas), and
       `canvas.selection`, that pane's item ids.

     So a selection is never read as node ids in one view and item ids in
     another. Pane state that only a family understands is resolved by
     that family, which is the direction GAP
     [[01M43AT0V9HHVS7ZAEPWXEGE7F]] asks for.
   - **Which pane.** A reference reads the session's *active* pane
     (`activePane`, the one the person last focused). In a split layout,
     "the open canvas" is the canvas the person is working in. A canvas
     shown only in the other pane is not "open"; the call is refused, and
     the refusal says so.
   - **Examples.** `ext.canvas.place {canvasId: "canvas.open"}`,
     `ext.canvas.arrange {canvasId: "canvas.open", ids: "canvas.selection"}`,
     `node.update {id: "focused"}` ("rename this"),
     `graph.trace {from: "focused"}`. `node.add`'s `parent` is optional, so
     it is not fillable. An agent that means "here" passes `parent`, read
     from the screen (Question 2).

7. **The fill is a core step of the invoke core, at depth 1.**
   - **Where it runs.** It runs in `invokeWith` before interceptors, the
     same way `scriptRefusal` reads `def.targets`. Interceptors, guards,
     schema parse and the script-grant check therefore all see the input as
     it will run, so a filled `canvasId` is still checked against a
     script's grant.
   - **What it reads.** The session's screen, through `Screens` in
     `ActionHandlerEnv`, and the contributed references.
   - **What it writes.** It returns the fill record to the receipt
     (decision 8).
   - **Depth 1 only.** Only the outermost call is filled (`callWithin`'s
     `outer === null`). A handler's internal calls and a script's calls
     inherit the session for the record but are never filled. A script must
     not change behaviour with where the person is looking.

8. **One fill per call, and the receipt says what "here" meant.**
   - **The receipt member.** `SucceededReceipt` gains
     `context?: Record<InputKey, {from: ReferenceId, value}>`, and every
     surface maps it: MCP, WebMCP's `receiptFor`, HTTP and the CLI. An agent
     that said "rename this" learns which node "this" was, and a log shows
     it.
   - **Nothing invented.** A key that cannot be filled is not made up. The
     schema refuses the call: "`canvasId` is required; pass it, or open a
     canvas in the session's tab."
   - **Fill once in the browser.** The page gets a `Screens` that answers
     for its own tab, from its live screen. An isomorphic write fills
     locally, and `invokeSettled` pushes the *filled* input, so the server
     fills nothing. Without this, the local commit (live screen) and the
     server (the hub's throttled copy) could fill differently.
   - **The settled receipt.** `invokeSettled` then copies the local
     receipt's `context` onto the settled receipt, since that is where the
     fill happened. WebMCP, which returns the settled receipt, therefore
     reports it too.

9. **A session is a name, not a grant.**
   - **No extra power.** Stating a session gives a caller nothing it could
     not already do. Any local program can already steer any tab through
     `ui.*` and act as an agent (DESIGN.md → Who the person is, the
     accepted trade-off). The boundaries stay where #4 put them: tailnet
     grants, Unix accounts, the owner-only socket, and the guard's
     Host/Origin checks.
   - **Only a person's tab fills.** A fill reads a session's screen only if
     that tab is a person's (`person` non-null). A nobody's tab is a screen
     any program may publish (DESIGN.md → What needs the person), so
     nothing is filled from it. Where a server has several people, a fill
     reads only a tab of the person the call is made for: the page's
     person, or the server's person for a program.
   - **Later: approval.** When policies return (GAP
     [[01M5E2DAVRH5CWKM27BVDYW19T]]), the session is the natural place to
     *ask*: an agent's call in a session can show its approval in that tab,
     where the person is looking. That would also give the approval-less
     wires a way to carry one: GAP [[01M3R2KD6V1AZ9WS62ZVG9T4G2]] (MCP) and
     GAP [[01M3S5DDJ7MP2VZ4WJB007RRR5]] (WebMCP). This design only keeps the
     session on the invocation, where a guard can read it.

10. **The transaction records its session beside its actor; `origin` stays
    a sender's label.**
    - **Why not reuse `origin`.** It has producers that are not tabs
      (`@kb/client`, `virtual`), so it cannot simply become the session.
    - **What changes.** The tail gains `session`, set from the invocation as
      `actor` is (#4). `actor` plus `session` is the whole record of "what
      the agent did in my session".
    - **What happens to `origin`.** The page stops sending `X-KB-Origin`, so
      `origin` is left to `@kb/client` callers and the virtual set. Whether
      `origin` itself should be retired is Question 5.

11. **The page tells its embedder its session; nothing else crosses the
    frame.**
    - **Who may frame kb.** `kb ui --embed-origin <origin>` (repeatable)
      names the pages allowed to frame kb. Static serving (`server/assets.ts`,
      not the `/api` guard) sends `frame-ancestors 'self' <origins>` with the
      page. With none named it sends `frame-ancestors 'self'`, closing
      today's "anyone can frame it", a clickjacking surface on a page whose
      gestures are the person's.
    - **How the page learns them.** The server adds the allowed origins to
      the `{op: "person"}` frame it already sends after `hello`
      (`server/src/session.ts:157`).
    - **What it posts.** When framed, it posts `{type: "kb.session",
      session}` to `window.parent` once per allowed origin, using that
      origin as `targetOrigin`. The browser delivers it only to a matching
      parent, so the page needs no referrer or ancestor detection. It posts
      on load and whenever the id is renewed. No root path is sent.
    - **Calls do not go through the frame.** An embedder's agent calls kb's
      server, and its session routes the call to the tab. That keeps one
      route to a tab (`ScreenHub`). A relay through `postMessage` would be a
      second route, and it would make an agent's work depend on the panel
      being mounted in some browser.

12. **WebMCP stays the in-browser agent's surface, and becomes sessioned.**
    By decision 2, WebMCP calls carry the page's own session. A browser
    agent's "arrange the selected ones" fills from the page it is driving,
    and its `ui.navigate` moves that page, not another tab.

### Two modes, one mechanism

These are the owner's two modes:

- **Hands-on: "do it on my screen."** The agent's calls carry the person's
  session.
  - Its required "this" inputs fill from what the person sees.
  - Its writes land in their tab's live view, recorded with that session.
  - `ui.navigate` shows the result.

  This works from an in-browser agent (WebMCP), kb's agent (its wire), an
  embedder's agent (an explicit session), and an MCP agent
  (`--session follow`).
- **Get the work done.** The agent's calls carry no session: plain
  `kb mcp`, `kb action-invoke`, the CLI. Every input is explicit, nothing
  depends on the screen, and nothing moves the person's view unless the
  agent asks with `ui.*`.

The same actions serve both modes, and both get the same receipts.

## How bb uses it (the first embedder)

This part is not kb's. It lives in the owner's dotfiles as a bb plugin, and
is here only to show that the kb surface is enough.

- **The panel.** It frames the kb page at a configured URL; bb's origin is
  given to kb as `--embed-origin`. The panel listens for `kb.session` and
  reports `{threadId, session}` to its plugin server over bb RPC. The
  server keeps each thread's most recent session.
- **The agent tools.** The plugin registers tools that call kb's
  `POST /api/action` with `session` in the envelope: `kb_call {id, input}`,
  `kb_screen` (`ui.screen` for that session) and `kb_manifest`. They go
  over the owner-only socket on the same host. bb passes each tool its
  `threadId`, which picks the session.
- **No panel open.** The tools then make unsessioned calls, so the agent's
  work does not depend on the person's screen being there.

## Where it lives

| Change | Where |
|---|---|
| `session` on `ActionRequest`; `carries`/`onWire` per wire; `envelopeOf` carries it | `contract/contracts/src/{actions,approval}.ts` |
| The page states it in the envelope; `X-KB-Origin` and the ws `?origin=` go | `app/ui/src/api/{action,ws}.ts`, `app/server/src/http.ts` |
| `Screens` and `remoteScreensLayer` take the session; `ui.*` and `describe` lose `tab` | `contract/contracts/src/screen.ts`, `app/runtime/src/screens.ts`, `application/operations/src/ui.ts`, `extension/canvas` |
| `_meta.session` and `--session follow` | `app/mcp` |
| The context-reference point; core's `focused`/`subject`; canvas's `canvas.open`/`canvas.selection` | `contract/contracts`, `extension/canvas` |
| `context` on `ActionDefinition`, checked at registration; the fill step at depth 1; the receipt's `context` | `contract/contracts/src/actions.ts`, `app/runtime/src/registry.ts`, `application/operations/src/invoke.ts` |
| The browser's own-tab `Screens`; pushing the filled input; copying `context` to the settled receipt | `app/ui/src/session/runtime.ts`, `app/ui/src/screen.ts` |
| `session` on the transaction tail | `contract/contracts/src/tx-log.ts`, both store backends |
| Every surface maps the receipt's `context` | `app/mcp`, `app/webmcp`, `app/cli`, `app/server` |
| `--embed-origin`, `frame-ancestors`, the allowed origins on the `person` frame, the `kb.session` post | `app/cli` (flag), `app/server/src/{assets,session}.ts`, `contract/contracts/src/protocol.ts`, `app/ui` |

## The contract suite

These are properties of the shared surface contract (`@kb/test-kit`). They
run over every surface and both listener kinds.

- **Every surface states a session the same way.** A call in session S, from
  any wire that can state S, fills the same required inputs from S's screen.
  It records `session = S` on the tail and returns the same `context`.
- **No session, no fill.** The same call with no session is refused for the
  missing *required* input on every surface. It is never filled from some
  other tab.
- **Today's calls are unchanged.** Every action's behaviour with an input
  omitted is the same with and without a session, except for keys its
  `context` declares. Registration refuses `context` on keys that are not
  required.
- **Explicit wins.** A given input is never replaced.
- **One fill per call.** For an isomorphic write from the page, the settled
  receipt's `context` equals the local receipt's, and the server's invoke
  core fills nothing.
- **Depth 1.** A nested call or a script's call in session S is never
  filled, and its write records S.
- **Only a person's tab fills.** A session whose tab is nobody's fills
  nothing.
- **Sessioned steering stays in the session.** `ui.navigate` in session S
  reaches S's tab and no other. This holds from the page, WebMCP, kb's
  agent, MCP with `_meta.session = S`, and HTTP stating S.
- **The manifest says what a session fills.** `kb.manifest` lists each
  action's `context`. Where a wire has a session, its tool listing drops
  those keys from `required` and annotates them. Elsewhere they stay
  required, with the annotation saying a session could fill them.

## Steps

Rule 1's order: carry first, then switch callers, then remove. The first
three steps are behaviour-preserving, with the existing suite as the proof.

| Step | What | Kind | Size |
|---|---|---|---|
| S1 | `session` as an envelope member that `onWire` keeps per wire. The Screens port takes it beside `tab` (a `tab` input still wins). The page states it in the envelope as well as `X-KB-Origin`. | restructure | M |
| S2 | Every wire states it: the page and WebMCP, kb's agent (`tabOf`), HTTP, `action-invoke`, MCP `_meta`, `remoteScreensLayer`; kb's agent prompt (`screenContext`) uses it | restructure | M |
| S3 | `tab` inputs removed (`ui.screen` keeps a `session` filter); `describe` reads the session; `X-KB-Origin` and the ws query deleted; DESIGN.md's stale "minted per page load" fixed (Screen state) | change (breaking) | S |
| S4 | `session` recorded on the transaction tail (both backends, with a migration as #4's `actor` had) | add | S |
| S5 | The context-reference point; core and canvas references; `context` on definitions, checked at registration; the depth-1 fill step; the receipt's `context` on every surface; the manifest listing | add | M |
| S6 | The browser's own-tab `Screens`; `invokeSettled` pushes the filled input and carries `context` to the settled receipt | add | S |
| S7 | Context declarations on the canvas verbs, `node.update` and `graph.trace` | add | S |
| S8 | `kb mcp --session follow` | add | S |
| S9 | `--embed-origin`, `frame-ancestors`, the `kb.session` post | add | S |

## As built

Where the implementation departs from the plan above, and why:

- **Reference ids are namespaced like actions.** The canvas family's are
  `ext.canvas.open` and `ext.canvas.selection`, not `canvas.open`: a
  reference belongs to the family that resolves it, and its actions are
  `ext.canvas.*`. Core's stay bare (`focused`, `subject`).
- **References are carried by the family's declaration**
  (`ExtensionDeclaration.context`), and `declarationPlugin` contributes them.
  Both hosts already load every family's declaration through that plugin, so
  the page and the server resolve the same references with no per-host
  wiring. Core's are on core's declaration, contributed like anyone's.
- **The registration check joined the batch check.** `unloadBrokenBatches`
  became `unloadBrokenActions`, one fixpoint over the rules every action
  keeps (a batch's parts; what a session fills), rather than a second pass.
- **One tool-schema rule.** `asObjectSchema` became `toolInputSchema(entry,
  sessioned)`, used by MCP, WebMCP, kb's agent and the Claude tool server, so
  the "may be left out" annotation and the dropped `required` key cannot
  differ between surfaces.
- **The page's own-tab `Screens` is installed by the screen plugin**
  (`setLocalScreens`), as the runtime's other seams are, because the runtime
  importing the screen module made an import cycle. It answers under the id
  the tab publishes as.
- **The surface contract's fill property** covers the surfaces that state a
  session (CLI, MCP, HTTP); WebMCP and kb's agent make calls in their own tab
  and are covered by their own tests. `kb mcp --session follow` has its own
  end-to-end test, since following changes what "no session" means.
- **`embedders` is left off the `person` frame when there are none**, so a
  server with no `--embed-origin` sends what it sent before.

## Questions for the owner

1. **Remove the `tab` inputs outright in S3?** *Recommended: yes*, with no
   alias, as the registry's earlier breaking changes were. Keeping them
   beside a session leaves two ways to say one thing.
2. **"Add a node here."** `node.add`'s `parent` is optional, and absent
   means a root, so a session cannot fill it (decision 6). An agent can
   still read the focus from `ui.screen` and pass it. The alternative is a
   breaking change: make `parent` required, with `null` meaning "a root",
   and update every caller that relies on absent. *Recommended: not now.*
   Revisit when an agent workflow shows the extra read costs something.
3. **Guard against a stale screen?** An agent reads the screen, thinks, and
   calls a few seconds later. If the person has moved, "this" is somewhere
   else. *Recommended: not yet.* The receipt's `context` makes it visible.
   If it bites, add an optional `screenAt` (the screen revision the agent
   read) that refuses a fill against a newer one.
4. **Should an agent's sessioned writes join that tab's undo?**
   *Recommended: yes, later*, together with GAP
   [[01M42Q9JB86BVSVHSQRZ5HW07X]] (undo does not know who authored a step).
   Key it on actor plus the tail's `session` *as the page wire set it*, not
   on a label any program can state.
5. **Retire `origin`?** Once the page stops sending it, `origin` is
   `@kb/client`'s label plus the `virtual` marker. Those are two different
   concepts sharing one field. *Recommended: a follow-up design* that gives
   the virtual set its own marker and decides whether `@kb/client` callers
   need a label at all.
6. **Page-only commands as actions.** Some things exist only in a tab: open
   a panel, expand a subtree, zoom to fit. Today `ui.navigate` and
   `ui.select` reach them through `PaneCommand`. *Recommended: a later
   design* that makes a view's pane commands registry actions run in the
   session's tab, so they too reach every surface.

## Non-adoptions

- **A relay through the frame (`postMessage` calls).** It would be a second
  route to a tab beside `ScreenHub` (decision 11).
- **A WebMCP polyfill in the page.** It would still need an extension or
  relay to reach any agent. The agent-native report reached the same
  conclusion (§6).
- **A queue the tab polls**, as in agent-native. kb's socket already
  delivers commands to a tab.
- **Session as a credential.** A token would prove nothing the Origin
  check and the socket do not already prove, and #4 removed the page token
  for that reason. Approval is governance's job (decision 9).
- **Session as an input key.** That would be the call, not the wire,
  stating where it is.
- **Filling optional inputs.** That would change what calls mean today
  (decision 6).
- **Deixis only in the prompt.** It works only for the agent whose prompt
  carries the screen, and it leaves the receipt silent about what "here"
  was.

## What this does not decide

- Approval UX in a session (governance, when policies return).
- How bb or any other host shows kb, and which agent runtimes it offers.
  That is the host's.
- A remote MCP transport (Streamable HTTP from `kb ui`) for agents on
  another machine. It would carry `_meta.session` and `follow` the same way,
  but it is its own design.

## Review

An independent adversarial review of the first draft, made the same day
against the code at `8fd2beb1`. Every finding was taken.

| Severity | Finding | Change |
|---|---|---|
| High | Filling an absent key changes existing calls: `node.add` without `parent` is a root, and the page relies on that (`plan.ts:250`, `canvas-api.ts:150`). `null` cannot mean "explicit" because `omittable` reads it as absent. | `context` only on required keys, checked at registration (decision 6). `node.add` became Question 2. |
| High | An interceptor cannot read `Screens` or add to the receipt, and no "screen family" exists to contribute one. | The fill is a core step in `invokeWith` before interceptors, at depth 1 (decision 7). |
| High | WebMCP returns the settled (server) receipt, so a fill made locally never reached it. | `invokeSettled` copies the local `context` onto the settled receipt; every surface maps it (decision 8). |
| High | Removing `tab` before every wire could state a session would strand CLI and MCP callers. Calling S1 a pure restructure was wrong. | Steps reordered: carry, switch, remove. |
| Medium | `TxOrigin` has non-tab producers (`@kb/client`, `virtual`). | The session is recorded separately; `origin` became Question 5 (decision 10). |
| Medium | Two carriers on one endpoint (header for the page, envelope for programs). | One envelope member for every wire; the header goes (decision 2). |
| Medium | Wiring `?origin=` contradicts "no URL carries it" and fights renewal. | Deleted (decision 4). |
| Medium | `describe` reads more than a focus default: which pane shows the canvas, its pose, the visible set. | `describe` keeps its own screen read and declares no `context`. |
| Medium | A core `"canvas"` reference deepens GAP 01M43AT0V9HHVS7ZAEPWXEGE7F, and `selection` has two types. | References are contributed; canvas owns `canvas.open` and `canvas.selection` (decision 6). |
| Medium | Nested and script calls would fill from the person's screen. | Depth 1 only (decision 7). |
| Medium | Several people per server: a call could fill from another person's tab. | Only a person's tab, and only the call's person (decision 9). |
| Medium | `kb mcp --session <id>` is impractical, since ids are browser-minted and renewed. | `_meta.session` plus `--session follow` (decisions 2–3). |
| Low | Referrer/ancestor detection is fragile, and `root` leaks a path. | Post per allowed origin; no root (decision 11). |
| Low | Frame headers placed in the `/api` guard. | Static serving, `server/assets.ts`. |
| Low | WebMCP citation pointed at the page host, not `onWire`. | Fixed (`webmcp/src/webmcp.ts:157`). |

The review asked to keep: the session as the existing tab id with no
credential; no `postMessage` relay; the `frame-ancestors 'self'` default;
collapsing the `tab` inputs and the dead query; explicit input wins;
refusal over invention; pushing the filled input; and the unsessioned
`ui.*` default. All of these stayed.
