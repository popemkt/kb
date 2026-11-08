# Isolating third-party UI code: what others do, and what kb should do

Date: 2026-11-08. A research record; no code changed. It answers one
question: **how should kb isolate a trusted plugin's UI code so that the
plugin gets only what it is handed?** It starts from backdrops, the first
thing a third party ships ([plugin-install plan §7](2026-11-06-plugin-install-plan.md)),
and generalises to page halves.

The gap this record is about is `#gap` `01M6WVFMGB5PP2AANF0E5R921V`
("a trusted backdrop has the page's power; the SDK's types confine
nothing"). It is filed by PR #126 (plugin backdrops through the extension
SDK) and lives in that branch's `.kb/nodes.jsonl`; this record does not
touch it. **The owner keeps the gap open.** Nothing below closes it. The
steps at the end say what would.

Where a statement comes from, the source is linked. Every claim is marked
by how I came to it: **read** (the page's own text), **secondary** (a
search summary or a third party, not the primary page), or **not
verified** (from memory or inference; a spike must check it). The list of
what I could not read is at the end ([Verification status](#verification-status)).

## 1. The problem, as kb has it today

- **A page half is page code.** A repository extension may ship
  `<name>.page.tsx`. A person trusts it per digest, and the `kb ui` server
  then serves it at the path its closure's digest addresses
  (`extensionPagePath`). The page `import()`s it. It is a bundle that
  reads the page's own modules (`HOST_MODULES`: React, `@kb/ui-sdk` as
  `kb-ext-sdk/page`) and "runs with the page's power, which is the trust a
  person gave it" (DESIGN-UI.md → Extension UI halves). That power is the
  DOM, `fetch` to kb's server with the page's session, `localStorage`,
  and every other extension's UI.
- **A backdrop is handed little, and may take everything.** Under #126 a
  plugin's backdrop is a `Backdrop` contributed to `BackdropPoint`. Its
  `Component: FunctionComponent<BackdropProps>` is handed its colour, the
  node id, strength, direction, knobs, budget, `activity` and `pointer`.
  That is a convention. `BackdropProps` carries the marker
  `// GAP [[01M6WVFMGB5PP2AANF0E5R921V]]`: "a trusted backdrop has the
  page's power; these types confine nothing".
- **The frame budget is honest only if the scene is.** `meterFrames`
  (`@kb/ui-sdk`) is handed the canvas, records a smoothed cost per frame,
  gives a verdict every 30 frames, and after three verdicts over budget
  steps quality down by 0.15 to a floor (0.45 by default). The scene calls
  it itself.
- **kb already has an isolation mechanism, for another kind of code.**
  DESIGN.md → Sandbox: guest code (a code view, a canvas script) runs in
  an iframe sandboxed with `allow-scripts` alone (`SANDBOX_IFRAME_FLAGS`),
  so its origin is opaque. `kb ui` serves the frame at `/sandbox` with
  `SANDBOX_FRAME_CSP`: `default-src 'none'`, `script-src 'self'
  'wasm-unsafe-eval'`, `worker-src blob:`, `connect-src` and images,
  fonts, media, frames and `form-action` all `'none'`, `frame-ancestors
  'self'`. The frame speaks the MCP Apps JSON-RPC dialect to its parent
  (`ui/initialize`, `tools/call`, `kb/draw`, `kb/status`), and the page's
  end answers through `answerToolCall` under a **grant** (`reads`,
  `actions`) bounded to the subject. Untrusted code runs in QuickJS-wasm;
  trusted code runs in a **blob Worker inside that frame** ("the
  removal is a courtesy; the boundary is the frame's CSP, which the
  Worker inherits"). `SandboxLimits` bound time, messages per second,
  message size and waiting calls, and the page cuts off a frame that sends
  more than 400 messages a second. One contract suite, `sandboxContract`,
  holds both engines.

So the question is not "how do we build a sandbox". kb has one. The
question is **why a plugin's UI half does not go through it**, and what a
UI half that does would look like. Rule 1 (bridges over mirrors) says the
answer resolves to the one sandbox, not to a second one beside it.

## 2. Survey

One table, then one note per system. "Escapes" are documented failures,
not speculation.

| System | Isolation of plugin UI | Host ⇄ plugin | Reaches | Cost | Documented escapes / limits |
|---|---|---|---|---|---|
| **bb** (this IDE) | None. Same origin, same realm; `bb.app` is shimmed React in the app shell | Direct calls into the SDK | The app DOM, authenticated client state, host SDK | None | "Not a security sandbox"; trust is the control |
| **VS Code webviews** | iframe-like context per webview; scripts off by default; CSP; `localResourceRoots` | `postMessage` both ways; `acquireVsCodeApi()` once | Only its own content and the roots it is given | "Resource heavy"; `retainContextWhenHidden` has high memory cost | Doc says `localResourceRoots` is not complete protection on its own |
| **VS Code extension host** | A separate host (Node, web Worker or remote); not a sandbox for the extension's code | API objects | Whatever the host's process can | Keeps extensions off the UI thread | Extension code itself is trusted |
| **Figma** | Plugin logic in a QuickJS-in-wasm realm on the main thread; UI in an iframe | `postMessage` between the two | Logic: the document, no browser APIs. UI: browser APIs, not the document | QuickJS is slower than JIT; messages ~0.1 ms round trip (2019) | Realms shim had independent escapes, replaced in 2019 |
| **Obsidian** | None | Direct | Everything Obsidian can: files, network, programs | None | Obsidian: it "cannot reliably restrict plugins to specific permissions" |
| **Logseq** | Plugins run in sandboxed iframes; RPC bridge (**secondary**) | RPC (`logseq.provideUI` injects HTML) | Through the RPC API | iframe per plugin | Not verified from primary source |
| **Grafana** | "Frontend sandbox": a separate JS context per plugin, opt-in | In-process | Narrowed browser capabilities | "Might impact the performance of certain plugins" | **Deprecated; removal in 13.4** |
| **Shopify UI extensions** | Web Worker with no `window` or DOM; UI as remote-rendered web components | Remote DOM over a message channel; `shopify` global of promise APIs | Only declared APIs; network is a requested capability | 64 KB bundle cap | None documented; limited to Shopify's components |
| **Chrome MV3** | Extension pages: strict CSP, no remote code. **Sandboxed pages**: unique origin, no extension APIs. Content scripts: isolated world | `postMessage`; message passing; shared DOM only | Sandboxed page: nothing but what it is sent | None stated | Content scripts share the DOM; web-accessible resources are exposed to any script on the site |
| **tldraw** | None for custom shapes (React in the app's realm). Embeds: sandboxed iframes | Props and store; iframe via `src` | Custom shapes: everything | None | Default embed sandbox includes `allow-same-origin` + `allow-scripts` |
| **Excalidraw** | No third-party code runtime; host passes render props; embeddables are iframes | React props | n/a | n/a | Sandbox attribute value not verified |
| **Cloudflare Workers** | V8 isolates, plus a second sandbox and process cordons | Request/response | Nothing but its bindings | Process-per-tenant "easily 10x" CPU | Spectre cannot be fixed in V8; Cloudflare removes timers and threads |
| **SES / Endo / LavaMoat** | Hardened JS: frozen intrinsics + Compartments; per-package policy | Passing hardened objects | Only what a compartment is endowed with | Compat breaks (monkey-patching libraries) | Same realm: no DOM isolation; autopolicy generation is unsafe if a bad package is present (**secondary**) |
| **MetaMask Snaps** | SES environment with no DOM, no `fetch` unless permitted | JSON-RPC | Only granted endowments | 30 s idle / 60 s per-request shutdown | Not stated |

### bb: the IDE this runs in

**Read** from `bb guide plugins` and the `bb-plugin-authoring` references
on this machine.

- "A bb plugin is a TypeScript package that extends bb with server code,
  an optional entry that runs on enrolled hosts, UI, agent skills and
  tools… **Plugins are full-trust code.**" (`bb guide plugins`)
- The frontend bundle (`bb.app`) never bundles React or the SDK; `bb
  plugin build` shims them "to the host's" copies. The plugin's UI is the
  app's own React tree.
- Trusted content scripts: "ordinary bundled JavaScript/TypeScript in the
  bb app shell… It is full-trust, same-origin page code — **not a security
  sandbox**. It can access the app DOM and any authenticated client state
  available to ordinary page code, so install only plugins you trust."
  (`frontend-core-slots.md`)
- `bb.host` is a "full-trust Node 22 ESM entry".
- What bb does instead of isolation: it **validates data** (a plugin's
  SVG icons pass a reject-only validator: no `script`, `foreignObject`,
  `on*`, external `href`), it **contains failure** (each slot has its own
  error boundary: "crash isolation stays local to the slot"), it
  **bounds lifetime** (async mount is time-boxed to 10 s, a generation's
  listeners are aborted before the next mounts), and it **asks for trust
  at install**.
- I found no iframe or realm boundary for plugin UI in the references I
  read. The public Plugin Guide (getbb.app/plugin-guide) I did not open.

bb is the same position kb is in today, stated plainly. It is the
baseline: trust as the only control, plus failure containment.

### VS Code

- Webviews (**read**, [webview guide](https://code.visualstudio.com/api/extension-guides/webview)):
  "Think of a webview as an `iframe` within VS Code that your extension
  controls." "Webviews run in isolated contexts that cannot directly
  access local resources." Local files load only through
  `Webview.asWebviewUri`, from `localResourceRoots`. JavaScript is off
  unless `enableScripts` is set, and the guide tells authors to add a
  `Content-Security-Policy` starting from `default-src 'none'`. The
  guide says `localResourceRoots` "does not offer complete security
  protection on its own".
- Host and webview talk by `webview.postMessage()` and the webview's
  `message` event; the webview reaches the extension through
  `acquireVsCodeApi()`, which can be called once. (**Secondary**: the
  tail of the page was truncated when I read it.)
- Cost: webviews are "resource heavy", and `retainContextWhenHidden` "has
  high memory overhead", so authors save state and rebuild instead.
- The [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)
  page names three hosts (local Node, web Worker, remote) and says the
  host keeps extensions from "slowing down UI operations" and "modifying
  the UI". It does **not** say extensions are sandboxed from the file
  system or each other, and I did not find a source for that. Extension
  code is trusted code; the webview is where VS Code isolates *UI*.

The shape worth noting: VS Code splits *logic* (trusted, in a host that
cannot touch the UI) from *UI* (an iframe-like context that can touch
nothing but messages). That is the same split Figma makes.

### Figma

All **read**.

- [How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/):
  "plugin code runs on the main thread in a sandbox", a minimal JS
  environment that "does not expose browser APIs". The UI is an iframe
  (`figma.showUI`). "The main thread can access the Figma 'scene'… but not
  the browser APIs. Conversely, the iframe can access the browser APIs,
  but not the Figma scene." They talk through "message passing".
- [An update on plugin security](https://www.figma.com/blog/an-update-on-plugin-security/)
  (2019): "We no longer use the Realms shim at all. We now use QuickJS, a
  JavaScript VM written in C and cross-compiled to WebAssembly."
  "Several independent vulnerabilities were recently discovered with the
  Realms shim that could have allowed code inside the sandbox to escape."
  A wasm VM makes the confusion between an in-sandbox and an
  out-of-sandbox object "not possible… because the object representations
  are too different". The trade is stated: "somewhat slower for certain
  plugins, but intrinsically more secure".
- [How we built the plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
  (**read**, with the tail **secondary**): the first attempt, a plain
  null-origin iframe, put the document behind messages whose overhead is
  "on the order of 0.1 ms per round-trip", about 1000 per second;
  serialising a large file took "14 seconds… before the plugin could even
  run". That is why logic and UI are split: a fast in-process realm for
  the document, a null-origin iframe for the browser APIs. The lesson for
  kb: a message boundary is cheap per message and ruinous per node.

### Obsidian and Logseq

- Obsidian, **read**, [Plugin security](https://obsidian.md/help/plugin-security):
  "Due to technical limitations, Obsidian cannot reliably restrict
  plugins to specific permissions or access levels. This means that
  plugins will inherit Obsidian's access levels." Community plugins "can
  access files on your computer", "can connect to internet" and "can
  install additional programs". Restricted Mode is the default; review
  is an automated scan of every version plus manual review for popular
  plugins. This is "trust, plus a scan", bb's position.
- Logseq, **secondary** only (the primary source timed out; summaries on
  [Smithery](https://smithery.ai/skills/neversight/logseq-plugin-dev) and a
  [developer gist](https://gist.github.com/JM-Mendez/b27efdc8efe1d338fbf610646702fe01)):
  plugins run in a sandboxed iframe and talk to the app over an RPC
  bridge; `logseq.provideUI` injects HTML. I could not confirm the
  sandbox attribute's flags. Treat Logseq as "iframe + RPC", unverified.

### Grafana: a sandbox that was walked back

**Read**, the
[frontend sandbox page](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/)
and its [v13.1 archive](https://archive.grafana.com/docs/grafana/v13.1/administration/plugin-management/plugin-frontend-sandbox/).

- v13.1: "isolates plugin frontend code from the main Grafana
  application. When enabled, plugins run in a separate JavaScript
  context", "public preview", "breaking changes might occur". It is
  opt-in per plugin (`enable_frontend_sandbox_for_plugins`), off by
  default, excludes Grafana-signed plugins and Angular plugins, and warns
  it "might impact the performance of certain plugins".
- Latest: "The Plugin Frontend Sandbox public preview has been deprecated
  and will be removed in Grafana 13.4." No reason and no replacement are
  stated on the page.
- A [2023 commit](https://forger.sitiv.fr/apitech/grafana/commit/ed5a697825465d2a3c4a1bcbc317551dc2ac4557)
  (**secondary**, an unofficial mirror) says it was built on Salesforce's
  near-membrane. The pages never use the word.

Read it as a data point, not a verdict: an **in-process realm sandbox over
a DOM-heavy plugin API** shipped as an opt-in public preview (off by
default, per plugin, since 11.5; the troubleshooting advice is to turn it
off when a plugin breaks) and is now being removed. The cause is not stated, so do not over-read it. It
is the one survey entry that tried to give plugins *the page's DOM, behind
a membrane*, which is the thing kb should not try.

### Shopify UI extensions

**Read**, [checkout UI extensions](https://shopify.dev/docs/api/checkout-ui-extensions)
(the transport detail is **secondary**, see below).

- "They run in an isolated sandbox, separate from the checkout page and
  other UI extensions." "UI extensions run inside of a Web Worker which
  doesn't have access to `window` or the DOM."
- What they reach: "specific UI components and APIs that are exposed by
  the platform": the `shopify` global's target APIs, mutations through
  methods such as `applyAttributeChange`, and capabilities declared in the
  extension's TOML (`network_access`, `api_access`, …). "You must request
  network access to transmit errors to a third party service."
- UI is Shopify's own web components, "built with remote-dom"; the
  extension renders (Preact) inside the worker and the host mirrors the
  tree. It is "limited to specific UI components".
- Cost: bundles are capped at 64 KB (128 KB for full-page extensions) "to
  ensure fast loading times", changes are batched, and a rate-limited
  extension "can't make further changes during the buyer's session".
- Transport (**secondary**, the README text did not load): Remote DOM's
  simplest path is a hidden iframe whose `postMessage` events feed a
  receiver on the host, with a Web Worker as the alternative sandbox and a
  minimal DOM polyfill for it ([ecosyste.ms mirror of the
  README](https://awesome.ecosyste.ms/projects/github.com%2FShopify%2Fremote-dom),
  repo: [Shopify/remote-dom](https://github.com/Shopify/remote-dom)).

This is the closest match to what kb wants for ordinary views: **the
plugin sends a tree of host-owned components; it never touches a DOM.**
kb's `Drawing` (an allowlisted tree of HTML and SVG elements, built
element by element with no parser) is the same idea, already built.

### Chrome / MV3

All **read**.

- [Sandboxed pages](https://developer.chrome.com/docs/extensions/mv3/manifest/sandbox/):
  "served in a sandboxed unique origin"; no extension APIs; "direct access
  to non-sandboxed pages (it may communicate with them using
  `postMessage()`)". Their own CSP may allow `eval` but "MUST NOT have the
  `allow-same-origin` token".
- [MV3 security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security):
  no `eval`, `new Function`, or remote code in extension pages; "Remotely
  hosted code is supported in sandboxed iframes", with the caveat that "this
  approach does not work if the code requires access to the embedding
  page's DOM". This is the strongest precedent for kb's frame: the browser
  vendor's own answer to "run code I do not trust, at a distance" is the
  opaque-origin iframe.
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts):
  isolated worlds protect JS variables but "they share access to the
  page's DOM", and the page talks to them "through the shared DOM". An
  isolated world is **not** isolation from the DOM; it is isolation from
  the page's variables. bb's content scripts are the unisolated version of
  this.

### tldraw and Excalidraw

- tldraw custom shapes (**read**, [shapes](https://tldraw.dev/docs/shapes)):
  a `ShapeUtil` whose `component` returns React, registered by the host
  app. No sandbox: the shapes are the app's code. Only the *data* (JSON
  records, `meta`) is portable.
- tldraw embeds (**read**, [embed shape](https://tldraw.dev/sdk-features/embed-shape)):
  "Embeds run in sandboxed iframes with restricted permissions." The
  default set includes `allow-scripts`, `allow-same-origin`, `allow-forms`,
  `allow-popups`; pasted `<iframe>` HTML of an unknown source gets "no
  `allow-same-origin`, no forms, no popups" because "tldraw can't make any
  safety guarantees about the source". Gist embeds use `srcDoc` and drop
  `allow-same-origin`. Per-definition `overridePermissions` can loosen it.
  The lesson is MDN's: `allow-scripts` with `allow-same-origin` on a
  same-origin document "lets the embedded document remove the `sandbox`
  attribute — making it no more secure than not using the `sandbox`
  attribute at all".
- Excalidraw (**read**, [SDK docs](https://plus.excalidraw.com/docs/sdk)):
  no third-party code runtime. The host supplies UI through React render
  props; embeddables render as iframes through `renderEmbeddable` and a
  `validateEmbeddable` allowlist. Its iframe sandbox string is **not
  verified** (GitHub was unreachable).

### Notion and Linear

Not relevant. I did not read their docs. From general knowledge neither runs
third-party UI code inside the app (Notion embeds are iframes; Linear's
integrations are OAuth and webhooks); **not verified**, and nothing here
depends on it.

### Cloudflare Workers

All **read**: [how Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
and [the security model](https://blog.cloudflare.com/mitigating-spectre-and-other-security-threats-the-cloudflare-workers-security-model/).

- V8 isolates "prevent that code from accessing memory outside the
  isolate — even within the same process", with a second layer
  (namespaces and seccomp: "totally prohibit all access to the filesystem
  and network") and "cordons" by trust level.
- "V8 itself cannot defend against Spectre." Cloudflare's mitigations are
  to withhold the clock (`Date.now()` is fixed while code runs), forbid
  threads and shared memory so none can be raced into a timer, and move
  suspicious workers to their own process, at "easily 10x" the CPU.
- Mapping to a browser is **my inference**: a browser page cannot choose
  the process model (the browser does), and a plugin's Worker has
  `performance.now()`. So a browser host can bound *what a plugin can
  reach* but not *what it can infer through a side channel* about the
  rest of the page, and the honest position is to say that.

### SES, Endo, LavaMoat, MetaMask Snaps

The READMEs timed out (GitHub 504), so this is mostly **secondary**.

- Hardened JavaScript freezes the intrinsics (`lockdown`) and gives each
  program a `Compartment` with its own global object; "together,
  Compartment and lockdown isolate client code in an environment with
  limited powers and communication channels" ([SES guide](https://github.com/endojs/endo/blob/HEAD/packages/ses/docs/guide.md),
  [README](https://github.com/endojs/endo/blob/HEAD/packages/ses/README.md)
  via search snippets). Its stated scope is "boundaries between programs in
  the same process and JavaScript realm": it protects *objects and
  authority*, not the DOM or a shared GPU.
- LavaMoat runs each package in a Compartment under a per-package policy
  of the globals and builtins it may touch
  ([runtime environment](https://lavamoat.github.io/about/runtime-environment/));
  policy is generated by a recording run, which can be bypassed if a
  malicious package is present while recording, and some libraries break
  under SES (**secondary**, [overview](https://stackharbor.com/en/knowledge-base/nodejs-supply-chain-security-lavamoat/)).
  It is aimed at supply-chain risk in *your own bundle*, not at running a
  stranger's UI.
- MetaMask Snaps (**read**, [execution environment](https://docs.metamask.io/snaps/learn/about-snaps/execution-environment/),
  [about](https://docs.metamask.io/snaps/learn/about-snaps/)): "untrusted
  JavaScript programs that execute safely in a sandboxed environment that
  runs Secure ECMAScript (SES)", with "no DOM, Node.js built-ins, or
  platform-specific APIs other than the default `snap` global and
  MetaMask's `ethereum` global", `fetch` only behind
  `endowment:network-access`, and shutdown after 30 s without a request or
  60 s on one. It is a **logic** sandbox: no DOM at all.

SES is a way to run a plugin's *logic* in the page's own realm without a
second realm. It needs no iframe and is cheap. It does nothing for a
plugin that must hold a canvas, and a DOM-capable plugin is the reason for
this record.

## 3. What the survey says

1. **Every system that actually isolates UI withholds the DOM.** VS Code,
   Figma, Shopify, Chrome's sandboxed pages, Snaps and Logseq (by
   report) give the plugin either a context with no host DOM, or a tree of
   data the host renders. The ones that try to give the plugin a DOM
   behind a membrane (Figma's Realms, Grafana's sandbox) are the ones
   that were replaced or are being removed.
2. **The boundary is a message channel, and it is cheap enough for state,
   not for bulk.** Figma measured ~0.1 ms per round trip in 2019. Anything
   per-frame goes through counts, not objects.
3. **Opaque-origin iframe, or a Worker with no globals, are the two
   browser-native boundaries.** Chrome's own docs send remote code to the
   first. Shopify chose the second.
4. **A capability list on top, declared at install**, is universal
   (Shopify's TOML, Snaps' endowments, Chrome's permissions). kb's
   `CodeGrant` is already that.
5. **Nobody solves side channels in the browser.** Cloudflare, with full
   control of the process model, removes clocks and threads. A browser page
   cannot.
6. **Platforms with no sandbox (bb, Obsidian) say so plainly and lean on
   trust and review.** kb's trust prompt already does.

## 4. Canvas and GPU in a boundary

The question: can a plugin draw to the page without being in the page?

- **OffscreenCanvas in a Worker** (**read**, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas),
  [web.dev](https://web.dev/articles/offscreen-canvas)): "Widely
  available" since March 2023; the host calls
  `canvas.transferControlToOffscreen()` and posts the result to a worker
  in the transfer list; the worker draws and `requestAnimationFrame` is
  available in it. "The busy main thread does not influence the animation
  running on a worker." The canvas element **stays in the host's DOM** and
  the host keeps layout, stacking and `pointer-events`; the worker holds
  the pixels. This is a shared *surface*, not a shared context.
- **WebGPU in a Worker**: **read** from MDN that `WorkerNavigator.gpu`
  exists ("`Navigator.gpu` (or `WorkerNavigator.gpu` if you are using
  WebGPU functionality from inside a worker)"), and that WebGPU is
  secure-context only and "Limited availability — not Baseline". The
  browser matrix did not render for me, so per-browser versions are **not
  verified** here.
- **Sandboxed opaque-origin iframe**: **read** from MDN that without
  `allow-same-origin` the document "is treated as being from a special
  origin that always fails the same-origin policy (potentially preventing
  access to data storage/cookies and some JavaScript APIs)"; `allow` sets
  a Permissions Policy and is "a further restriction on top of" the
  header. **Not verified**: whether WebGPU's default Permissions Policy
  lets an opaque-origin iframe (or a Worker it spawns) get an adapter. The
  only source I found was a 2023 WebGPU working-group
  [minutes](https://github.com/gpuweb/gpuweb/wiki/Minutes-2023-01-18)
  discussing a Permissions Policy for it; its shipped state is unknown to
  me. A spike must test it (step 0).
- **Process separation** (**secondary**, [Chromium site-isolation-dev
  thread](https://groups.google.com/a/chromium.org/g/site-isolation-dev/c/LYoOkEljw_A)
  and the [threat-model note](https://chromium.googlesource.com/chromium/src/+show/main/docs/security/compromised-renderers.md)):
  without `allow-same-origin` a sandboxed frame *can* be put in its own
  process; whether it is by default is not confirmed by the sources I
  found. [MDN's Origin-Agent-Cluster page](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin-Agent-Cluster)
  (**read**) says origin-keyed clusters "should not be viewed as a
  security feature: browsers may ignore the request". So do not count on
  a process boundary; count on the origin boundary.
- **"Sharing a GPU context across the boundary" does not exist.** A
  `GPUDevice` cannot be handed to another document. What is shared is the
  *surface*: the placeholder canvas in the host's DOM presents what the
  Worker commits, and the compositor does it with no readback to the
  host. The plugin's Worker owns its own `GPUDevice`. The 60 fps story is
  therefore: the worker's `requestAnimationFrame` drives a commit; the
  host's main thread, busy or not, does not stand in the way
  (web.dev, above); the iframe is not in the paint path at all if the
  Worker draws to a canvas that sits in the host's DOM. **Not
  verified**: that an `OffscreenCanvas` can be *transferred* across the
  window → opaque-origin frame → blob-Worker chain (the HTML spec makes
  it `Transferable`, and kb's frame already spawns blob Workers because
  its CSP has `worker-src blob:`, but I have not run it). That is the first
  thing the spike measures.
- **COOP/COEP is not needed.** `SharedArrayBuffer` between host and scene
  would need cross-origin isolation of the whole page chain
  ([web.dev](https://web.dev/articles/coop-coep): "the entire chain of the
  documents, including parent frames and child frames, must be
  cross-origin isolated") and would hand the plugin a high-resolution
  timer. Messages are enough, and the absence of a shared buffer is a
  feature.

## 5. Recommendation for backdrops

**A plugin backdrop becomes a scene: a function that draws to an
`OffscreenCanvas` the host transferred, run in a blob Worker inside kb's
existing opaque-origin sandbox frame, with knobs and the declared inputs
coming over the frame's one bridge.** Not a new sandbox, not a new bridge,
not an iframe per backdrop: one more capability of the sandbox kb has.

Why this and not the alternatives:

| Option | What it fixes | Why not (alone) |
|---|---|---|
| **Worker on the page's origin** (`new Worker(url)`) | Moves drawing off main | A same-origin Worker has `fetch` with the page's cookies and `localStorage`'s sibling APIs (IndexedDB, `BroadcastChannel`, the server). It confines nothing; only the DOM is missing. |
| **Sandboxed iframe, scene draws in the iframe's own canvas** | Opaque origin, CSP | The iframe is a separate paint layer the host must place and size, with main-thread drawing inside it (its throughput is the frame's, not the compositor's). Works, but a Worker draws off any main thread and keeps the canvas in the host's DOM, where the slot's stacking (`isolation: isolate`, the negative paint layer) already works. |
| **Worker inside the opaque frame, canvas transferred from the host** | Opaque origin + CSP + off-main-thread drawing + host-owned surface | Needs the spike to confirm WebGPU and the transfer chain. **Recommended.** |
| **SES Compartment in the page** | Cheap, no frame | No DOM isolation; the scene needs a canvas, so it needs a DOM node's methods: that is a DOM capability. Fits plugin *logic*, not a scene. |
| **In-process realm (near-membrane)** | None kb needs | Grafana's route; being removed. |
| **Status quo** | None | The gap. |

What the plugin can reach under the recommendation: the transferred
canvas; its knobs' values; its budget; the presentation; the node id;
`reducedMotion`; pointer and activity as messages; assets the host chose
to hand it (as transferred `ImageBitmap`s or buffers, since `connect-src`
is `'none'`). What it cannot: the page's DOM, storage, session, network,
other extensions' UI, other nodes (the grant is `reads: none` plus the
subject id).

### Why the existing frame, not a new one

Rule 1: one mechanism per concept. The concept is "code kb did not write,
run at a distance, asking the host for what it needs". kb has that
(DESIGN.md → Sandbox: one prelude, one bridge in MCP Apps JSON-RPC, two
engines, `sandboxContract`). The delta for a scene is small:

- a new run **kind** (a scene, not a code view): its `RunInput` carries
  an `OffscreenCanvas` in the transfer list instead of code + subject;
- the engine is the **Worker** engine ("trusted code"). A trusted
  plugin (a person trusted its digest) runs in the Worker, as a trusted
  script does. An **untrusted** scene has no engine (QuickJS has no
  canvas), so it simply does not run: "awaiting approval", as today;
- **one more bridge method family** (`scene/*`, below), decoded like
  `kb/*` is.

The two things not to do: open a second `/sandbox2` frame with its own
CSP, and give the backdrop slot a private `postMessage` dialect.

## 6. Recommendation for general page halves

A page half is a bundle that today contributes to many points (views,
docks, overlays, commands, palette steps, backdrops, routes) with React
components in the page's tree. One boundary cannot fit all of them; the
survey's answer (Shopify, Snaps, VS Code) is to **choose the tier by what
the point needs, and give the plugin the weakest tier that serves it.**

| Tier | For | How it runs | Reach |
|---|---|---|---|
| **T0: data** | commands, palette steps, declared options, routes' metadata, knob schemas, tag/field definitions, themes' tokens | Declaration only; no code in the page | None; decoded and refused if it names something outside its namespace (already done for backdrops: "decode refuses an option outside `<extension>.`") |
| **T1: drawing** | a view or card that shows data | **Guest code in the sandbox returns a `Drawing`** (allowlisted tree: no script, no `src`, no `href`); the host builds the DOM | The grant: `reads` subject, named `actions`. This is the code view, available to extensions |
| **T2: canvas scene** | backdrops, and any other ambient or generative surface | Worker in the sandbox frame with a transferred `OffscreenCanvas` | The scene bridge only |
| **T3: page power** | what must hold the page's DOM: overlays that trap focus, editor integration (`NodeTextHost`), docks with their own React state, anything that composes `@kb/ui-sdk` components | In-page, as today | Everything; labelled so |

Rules for the tiers:

- The **point** declares its tier, not the plugin. `BackdropPoint` is T2;
  `ViewPoint` is T1 unless the view says T3. A plugin that needs T3 says
  so in its manifest, and the trust prompt says "full page power" in
  words, as `reach.page` already says. A person sees which of its halves
  run where.
- **T3 is never the default for anything installed from a marketplace.**
  It is what a bundled family is, and what a person's own repository
  extension is, and it stays so for known authors. This keeps the
  marketplace story the PR #126 body accepted ("accept 'trust means page
  power' for now") true for T3 and false for the rest.
- A T1 or T2 plugin **cannot import `kb-ext-sdk/page`'s React and
  `@kb/ui-sdk` modules**, because its bundle does not run where React
  is. Its SDK entry is a smaller one (`kb-ext-sdk/scene`, below). The
  absence of the import is a build failure, not a convention: it is the
  enforcement the gap names as missing.
- **Where T1 is too weak** (a plugin wants a real editor, a chart with
  hover), the answer is not a fatter bridge; it is T1's drawing language
  growing (more allowlisted elements, events as data), or the plugin
  asking for T3.

This is deliberately the order in which the work should be done: T2 first,
because backdrops are the thing being shipped; T1 is largely built; T0 is
built; T3 is today.

## 7. The minimal API surface (scenes)

`kb-ext-sdk/scene` is a small module a scene bundle imports. It contains
**no React, no DOM types**. A scene is a module-level function.

```ts
// Host → scene is data; scene → host is data. No functions cross.
export interface SceneInit {
  readonly canvas: OffscreenCanvas;     // transferred; the host owns its CSS box
  readonly size: { width: number; height: number; dpr: number };
  readonly node: { id: string } | undefined;
  readonly knobs: KnobValues;           // the one KnobSchema's decode
  readonly budget: BackdropBudget;
  readonly presentation: BackdropPresentation;
  readonly variant: string | null;
  readonly reducedMotion: boolean;
  readonly color: string;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
}

export interface SceneHost {
  /** Called per frame; the host may pause, throttle or stop it. */
  frame(cb: (t: Timing) => void): void;
  /** Declared inputs, read in the frame, never listeners. */
  readonly pointer: PointerSource;      // fed by `scene/pointer`
  readonly activity: () => PageActivity;// fed by `scene/activity`
  /** The host's chosen detail, 1 down to the floor. */
  readonly quality: () => number;
  /** Tell the host a frame cost this much (ms, and which kind). */
  report(ms: number, cost?: FrameCost): void;
  on(event: "knobs" | "resize" | "visibility" | "dispose", h: (e: unknown) => void): void;
  /** A host-chosen asset, by the name the plugin's declaration lists. */
  asset(name: string): Promise<ImageBitmap | ArrayBuffer>;
}

export type Scene = (init: SceneInit, host: SceneHost) => void | (() => void);
export declare function provideBackdropScene(
  key: SeedBackdrop,
  backdrop: { presentation: BackdropPresentation; budget: BackdropBudget; scene: Scene },
): ContributionEntry<Backdrop>;
```

Wire (the sandbox frame's `scene/*` family, in the same MCP Apps JSON-RPC
dialect, each decoded before anything reads it):

| Direction | Method | Carries | Rate |
|---|---|---|---|
| host → frame | `scene/init` | `SceneInit` (canvas in the transfer list) | once |
| host → frame | `scene/knobs` | changed knob values | on change |
| host → frame | `scene/resize` | size, dpr | on change; the host picks the pixel size (quality × dpr) |
| host → frame | `scene/visibility` | `visible`, `reduced` | on change |
| host → frame | `scene/pointer` | `{x,y}` or null | ≤ 30 Hz, only while over |
| host → frame | `scene/activity` | the counters | on change, coalesced |
| host → frame | `scene/quality` | number | on a verdict |
| frame → host | `scene/stats` | frames, mean and p95 cost, cost kind, heartbeat | every 30 frames |
| frame → host | `kb/fail`, `kb/status` | as today | on event |
| frame → host | `tools/call` | **refused** for a scene: its grant is `reads: none` | |

Properties:

- **The host picks the surface.** The plugin never chooses canvas
  dimensions or CSS; the host resizes by message and the worker sets
  `offscreen.width/height`. That is the single strongest budget lever
  (fill cost is area × quality).
- **Pointer and activity cost a few messages a second**, not a listener.
  This keeps the existing design rule ("a backdrop adds no listener of its
  own") and makes it enforceable.
- **Plugin time is bounded by `SandboxLimits`** as today: messages per
  second, message size, and the page's 400 messages/second cut-off.
- The grant for a scene is a constant: `{ reads: none, actions: [] }` plus
  the node id it was told. A backdrop that wants to read the node's
  fields is a T1/T3 question.

## 8. Frame budgets across the boundary

What `meterFrames` does today works because it shares a thread with the
scene. Across a boundary the same three jobs split:

1. **Measure the cost.** The scene measures its own cost inside the
   Worker (`performance.now()` around the frame; for WebGPU, a
   `timestamp-query` where the device has the feature, else frame
   interval) and `report`s it. The reporting is the `FrameMeter`'s
   `record(ms, cost)`; the aggregation moves into the worker; `scene/stats`
   carries the aggregate. **This is self-reported and a plugin can lie.**
2. **Decide the verdict.** The host's `FrameMeter` core takes the stats
   (the same rule: a verdict per 30 frames, three over budget, step down
   0.15 to the floor) and answers with `scene/quality`. The decision does
   not live in the plugin.
3. **Enforce, with signals the host observes itself.** Because (1) is
   untrusted, the host adds three it can see without the plugin:
   - **Delivered cadence**: the host counts `scene/stats` heartbeats per
     second; no heartbeat for 2 s, or a verdict stuck over budget at the
     floor for N verdicts, **terminates the Worker** and shows the
     Studio's "stopped, over budget" state (the PR's "a later step could
     stop a scene that stays over budget at its floor").
   - **Area**: the host owns the canvas pixel size. Quality is applied as
     resolution scale by the host, not as advice the scene may ignore.
   - **Main-thread jank**: a `PerformanceObserver` for long animation
     frames on the host page attributes nothing to a Worker, so a rise in
     it while a scene runs is evidence against the *other* thing (the
     proxy), not the scene. The proxy's own cost (decode, post) must stay
     at ~0 and is held to the 1 ms bar kb uses for CSS-driven art.

Budget kinds (`BACKDROP_BUDGETS`) keep their numbers and change what they
mean: `gpu` 6 ms (the scene's `timestamp-query` or interval), `frame` 2 ms
(the Worker's own CPU, no longer the main thread's), `css` 1 ms (unchanged,
not metered).

`meterFrames(canvas, budget)` today also writes `data-quality`,
`data-frame-ms` and `data-gpu-ms` on the canvas, which Backdrop Studio
reads (`readFrameMeter`). Keep the readout: split the meter into its
**core** (record, verdict, quality: pure, no DOM) and a **projection onto
an element** (the data attributes), and let the isolated host feed the
core from `scene/stats` and project onto the host's own canvas element.
Studio and the readout then do not change. That split is a
behaviour-preserving restructure and should land before the capability
(step 2).

## 9. Migration from #126's in-page model

The in-page model stays as T3, named. The migration is additive and per
contract, in the order Rule 1 asks for (restructure, then add).

1. **One contract, two hosts.** `Backdrop` (`key`, `presentation`,
   `budget`, `Component`) is what the slot consumes. Do not add a second
   kind to the slot. Instead `provideBackdropScene` returns a
   `Backdrop` whose `Component` is **a host-made component** that mounts
   the canvas, spawns the scene in the frame, and speaks `scene/*`. The
   slot, Settings, Studio and the contract suites see a `Backdrop`, as they
   do for plugins today. The same `Scene` function can also run **in the
   page** through an adapter (`sceneComponent(scene)`), which is what a
   bundled or T3 backdrop uses. So a backdrop is a scene or a component,
   one `Backdrop` either way, and one **contract suite**
   (`backdrop-point.contract.test.tsx`) runs over **both hosts**
   ("one contract, every implementation": the guarantee "a scene is held
   to its budget and gets only SceneInit" is a property of the suite,
   not of one host).
2. **A manifest line and a label.** The install plan's `reach` gains
   `scene` beside `page`; a plugin whose halves are all scenes (and T0/T1)
   has `reach.page: false`, and the trust sheet says what it draws and
   nothing about the page.
3. **tide-backdrop** (the marketplace sample from #126) is ported to a scene
   as the first customer and the acceptance test. Its #126 form stays in
   the test suite as the T3 witness until the gap closes.
4. **Bundled backdrops do not move** (unicorn, gradient, the GPU
   scenes). They are kb's own code and are T3 by being bundled. They *may*
   move later because three.js runs in a Worker, which would be the
   proof that one host serves both; it is not part of closing the gap.
5. **The gap does not close at step 4.** It closes when installing a
   backdrop from a marketplace *cannot* produce a T3 backdrop: the SDK's
   `provideBackdrop` (the `Component` form) is refused for an extension
   not marked as page-power at install, and the build of a scene bundle
   fails on a `kb-ext-sdk/page` import. At that point the `GAP [[…]]`
   marker on `BackdropProps` is changed to name only the T3 case.

## 10. Honest limits

What this design does **not** do, and what it **cannot**.

- **It does not stop a hostile shader.** A scene's `GPUDevice` is a real
  device: a pathological shader can hang the GPU or make the page slow,
  and a browser's watchdog resets it (device loss), not kb. The host's
  levers are resolution, termination and refusal at install; none is a
  GPU time cap. The GPU time is also unmeasurable by the host except
  through what the plugin reports.
- **It does not stop timing or side channels.** A Worker has
  `performance.now()`; a scene can build a coarse timer and measure
  contention. Cloudflare, who control the process model, remove clocks and
  threads and still say "no one has fixed Spectre". In a browser the
  honest claim is: *a scene cannot read the page's data or call the
  server; it can observe its own timing.* The sandbox frame's origin
  boundary, not process isolation, is what is relied on (the Chromium
  sources I found do not confirm a process per sandboxed frame).
- **It does not hide the node id or anything the plugin is handed.** A
  scene sees the id of the node it draws for, and its own colour and
  knobs. Handing it more is a decision with a grant, not a leak.
- **It does not make a plugin's *logic* safe.** A scene can draw
  something offensive or misleading, flash, or run a wasm miner inside its
  Worker (CPU, until the heartbeat or budget stops it). Termination at the
  floor limits the damage; it is not a content filter.
- **Frame navigation is the one thing a CSP cannot forbid** (DESIGN.md →
  Sandbox says it for the frame today; the page cuts the frame off if it
  loads a second document). That holds here too.
- **The opaque origin is only as good as `allow-scripts` without
  `allow-same-origin`.** MDN's warning (the combination "is no more
  secure than not using the `sandbox` attribute") and tldraw's default of
  both flags is the cautionary example. `SANDBOX_IFRAME_FLAGS` is pinned
  by `sandboxContract`; a flag change must go red there.
- **Messages cost.** Figma measured 0.1 ms per round trip. A scene
  that wants the node's text, or every pointer move, will find the
  boundary slow. The surface is shaped so it cannot ask for those
  things per frame, and that is a limit on what plugins can do.
- **It is a larger build for plugin authors.** A scene bundle is a
  classic, self-contained file (every import inlined, as kb's own
  `frame.js` is, because a module script needs CORS from an opaque origin
  and a second file needs a connection), with no React, no `three` from
  the page (it bundles its own, so a scene pays its own bytes). Shopify
  imposes a 64 KB cap for this reason; kb should set a size limit, too.
- **WebGPU in the frame is unproven here.** If a browser does not give an
  opaque-origin Worker a WebGPU adapter, the design falls back to 2D and
  WebGL2 in the Worker (which OffscreenCanvas supports) for that browser,
  and a GPU scene reports "unavailable" instead of running in the page.
  The spike decides.
- **The T3 tier remains.** Anything that needs the page's DOM stays on
  trust. This is not a limit of this design; it is the limit of the
  problem. bb and Obsidian live there entirely.

## 11. Steps, sized for later building

Sizes: S under a day, M a few days, L a week or more. Each step is its own
PR; `restructure` steps are behaviour-preserving and land before the
`add` steps that depend on them. None of this is built here.

| # | Step | Kind | Size | Gate |
|---|---|---|---|---|
| 0 | **Spike**, throwaway branch, no PR to main: in Chromium, Firefox and Safari, transfer an `OffscreenCanvas` from the page through `/sandbox` into a blob Worker and draw (a) 2D, (b) WebGL2, (c) WebGPU; record fps with a busy main thread, `timestamp-query` availability, and whether `navigator.gpu` exists in an opaque-origin Worker. Write numbers into this record's successor. | research | S–M | A table per browser: works / fps / reason |
| 1 | `FrameMeter` core split from its DOM projection (`meterFrames` = core + `projectOnto(canvas)`), meter tests unchanged | restructure | S | `frame-meter.test.ts` and the Studio readout pass untouched |
| 2 | `Scene` as a contract: `SceneInit`/`SceneHost` types in `@kb/contracts` or `@kb/sandbox`, and `sceneComponent(scene)` running a scene **in page**; one bundled backdrop (the simplest) rewritten as a scene to prove the adapter | restructure | M | `backdrop-point.contract.test.tsx` passes with the bundled backdrop expressed as a scene |
| 3 | `scene/*` in the frame and its host: transfer, init, knobs, resize, visibility, pointer, stats, quality; engine = Worker; decode every message; `SandboxLimits` for it | add | L | `sandboxContract` gains a "scene" kind; a backdrop contract runs over both hosts |
| 4 | Host-side enforcement: heartbeat timeout, terminate at floor, host-owned canvas size, "stopped" state in Studio | add | M | Contract: a scene that never reports, one that reports 100 ms, one that loops are each stopped and the page stays up |
| 5 | `kb-ext-sdk/scene` entry and build (`<name>.scene.js`, classic, inlined, size cap), `provideBackdropScene`, decode refuses a `Component` backdrop from a non-page-power install | add | M | `ext-sdk-fresh` and the bridge tests (`page-surface-bridge`) cover the new entry |
| 6 | Manifest and trust: `reach.scene`, the trust sheet's sentence ("draws a backdrop; reaches no page data"), `reach.page: false` for scene-only plugins | add | S–M | Install acceptance: a scene-only plugin shows no page-power warning |
| 7 | Port `tide-backdrop` to a scene; keep its page-half form as the T3 witness | add | S | e2e install of the sample draws in the frame |
| 8 | Close the backdrop gap in the data: marker narrowed to T3; the gap node's `current` rewritten (the owner decides to close it) | docs/data | S | `kb docs materialize`, `check:audit` |
| 9 | T1 for extensions: a plugin may contribute a code view's guest (a `Drawing`-returning function) at a `ViewPoint`, under a grant | add | M–L | `sandboxContract` over an extension-owned guest |
| 10 | Per-point tier declaration, and the build check that a T1/T2 bundle imports no React/`@kb/ui-sdk` | add | M | Build fails on the import; the gap for general halves is filed with the remaining T3 points listed |
| 11 | Optional: bundled GPU scenes onto the scene host (proof of one contract) | restructure | L | Studio perf numbers unchanged within noise |

Steps 0–8 close the *backdrop* gap. Steps 9–10 start the general one;
what is left after them is T3, and it is a decision about trust, not a
task.

## Verification status

What I could and could not read, so no one has to trust this record more
than its sources.

- **Read in full or in the part that matters:** bb's `bb guide plugins`
  and `bb-plugin-authoring` references (`frontend-core-slots.md`,
  `quickstart.md`, `frontend-hooks-and-ui.md`); VS Code, Figma, Obsidian
  (`obsidian.md/help/plugin-security`), Grafana (latest and v13.1
  archive), Shopify checkout UI extensions, Chrome MV3 (sandbox, content
  scripts, security), tldraw shapes and embed, Excalidraw SDK docs,
  Cloudflare (two pages), MetaMask Snaps (two pages), MDN
  (OffscreenCanvas, WebGPU, iframe, same-origin policy,
  Origin-Agent-Cluster, Permissions Policy), web.dev (OffscreenCanvas,
  COOP/COEP).
- **Truncated:** the VS Code webview guide (its tail) and the Figma
  origin post (its tail) came as model summaries; marked **secondary**.
- **Not readable (GitHub returned 504 repeatedly):** the SES, LavaMoat,
  near-membrane, Remote DOM and Logseq READMEs and sources, and
  Excalidraw's `App.tsx`. Statements about them come from search
  snippets and are marked **secondary**.
- **Not found:** Grafana's reason for deprecating the sandbox; WebGPU's
  per-browser matrix and Permissions Policy status; whether Chromium
  puts opaque-origin frames in their own process by default; whether an
  `OffscreenCanvas` transfers through window → opaque frame → blob Worker
  (the HTML spec's `Transferable` suggests yes; unproven). Step 0 closes
  the last three.
- **Not checked at all:** Notion, Linear.
- **About kb:** read from PR #126's branch
  (`bb/kb-step-11-plugin-backdrops-via-sdk-thr_j7k3nydk6n`), which is not
  on `main`: `BackdropProps`, `BackdropPoint`, `meterFrames` and the
  gap marker exist only there. DESIGN.md → Sandbox and DESIGN-UI.md →
  Extension UI halves were read at that commit. If #126 changes before it
  merges, §1 and §9 are the places to re-check.
