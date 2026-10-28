# Canvas without kb: a board in a file, and a store that is a file (design, for the owner to read)

Date: 2026-10-29. Base: `main` at `9fcf57c`, after the canvas stack landed
(#53, #55, #56, #57, #58, #61, #62, #64). This record proposes; nothing in
it is built. The canvas's spec is [DESIGN.md → Canvas documents](../../DESIGN.md#canvas-documents),
storage's is [→ Merge](../../DESIGN.md#merge) and the store contract, the
scripts' is [→ Grants](../../DESIGN.md#grants-and-the-script-actor), [→ Trust](../../DESIGN.md#trust)
and [→ Scripts](../../DESIGN.md#scripts), and the last canvas plan is
[`2026-10-28-canvas-tldraw-parity.md`](2026-10-28-canvas-tldraw-parity.md).
This record links to them and restates none of them.

The owner's idea (2026-10-28/29), in their words: *"my idea for canvas is not
super kb tied. It can be independent from kb, so that I can save its json and
related stuff in a file, then give to another person, and if it refers to a kb
node, just put a placeholder there. I think the canvas can be a separate
component from kb."*

The coordinator's proposal, which this record was asked to refine and not
to rubber-stamp: (1) the canvas behind a small host interface (resolve a
reference, load and save, assets, scripts, a model), kb one host and a file
another; (2) a canvas file as a bundle (JSON Canvas, assets, scripts, a
manifest of capabilities); (3) a kb reference carrying a snapshot; (4) item
data in two tiers, card-local in the file and a node inside kb; (5) scripts
declaring capabilities, a host answering "not available here". Order: (a)
the format with export and import, (b) the core behind the host interface,
(c) a standalone viewer and editor.

## 0. The answer

**Separate the canvas from kb's app and server, not from kb's data model
and core.** The canvas is already written against two ports kb has: the
store (`EffectStore`, with one contract suite over every backend) and the
action registry (the invoke core, which the page already runs locally for
every action whose handler needs only the store and the index). A file is
therefore not a second *canvas host*; it is a third *store backend*.

- A **bundle** (`<name>.kbcanvas`, a ZIP) is a small kb: the board's nodes
  in kb's own node format, each page's document as a JSON Canvas file
  beside them, and its pictures. It is read and written by
  `@kb/store-bundle`, which joins the store contract beside JSONL and
  SQLite.
- A node the board shows but does not hold travels as a **stand-in**: a
  node holding what its card showed, which kb it came from and when. In
  its own kb the card is live again.
- A card's record is a node in both homes (D1 holds). There is no data bag
  on an item, in a file or in kb.
- A script's grant is already its declaration of capabilities. An action a
  host does not have is answered `unknown_action`, which the invoke core
  already returns. Nothing in a bundle runs until a person on that machine
  trusts its digest.
- **The viewer** is kb's own page over a bundle store, with the families a
  board needs and no server: no second canvas, no second action table.

Proposal (1) is declined as a new port: it would promise what the store
and the registry already promise, a mirror of both (AGENTS.md → One
contract, every implementation). Proposals (2), (3) and (5) are adopted
with changes. Proposal (4) is adopted as one tier with two homes.

## 1. What is coupled today

Measured on `main` at `9fcf57c`, tests and stories excluded:

| Package | Lines | Reaches into kb for |
|---|---|---|
| `@kb/canvas` (shared) | ~10,600 | `@kb/model` (the node shape, `SYSTEM_IDS`, asset rules), `@kb/contracts` (its family declaration), `@kb/sandbox` (`DATA_EVENT`), `@kb/views` |
| `@kb/canvas-ui` (browser) | ~19,200 | `@kb/ui-sdk` (75 names: the replica, the outline's text surface, routing and panes, `browserHost`, `ViewScripts`, assets, and generic helpers), `@kb/scene`, `@kb/scene-gpu` |
| `@kb/ext-canvas` (backend) | ~2,900 | the invoke core, `persistEffect`, `planNodeAdd`, the query index; and `FileSystem`, which every canvas write requires (`CanvasWriteEnv`, `write.ts`) |

The canvas depends on kb's *core* (nodes, fields, actions, the sandbox)
everywhere, and on kb's *app* (a server, a filesystem, the outline's
panes) in a few named places. Unpicking the first would be a second kb;
unpicking the second is the work.

- **The read side is already a port.** Lints and `describe` read kb only
  through `CanvasWorld` (`world.ts`), built from whatever nodes a host
  holds.
- **The page already runs actions locally.** The browser session builds a
  `KbCtx | KbStore | QueryEngineService | ViewCatalog` layer over its nodes
  and runs `isomorphicActions` there (`app/ui/src/session/runtime.ts`);
  `IsomorphicActionEnv` (`contracts/src/actions.ts`) is the requirement. A
  canvas write is not one of them only because `CanvasWriteEnv` adds
  `FileSystem`.
- **The run engine takes a performer** (`flow.ts`), and the performers in
  `run.ts` call the invoke core: `ext.code.script.list`,
  `ext.code.script.run`, `field.define`, `ext.agent.complete`.

## 2. Decisions

### S1. The bundle is a store backend

One file, `<name>.kbcanvas`: a ZIP (stored or deflated, nothing else) whose
entries are only:

```
manifest.json            the format, its version, the board, and who exported it
nodes.jsonl              the nodes, one per line, as `.kb/nodes.jsonl` holds them
pages/<node-id>.canvas   each page's sys.f.canvas, as a JSON Canvas file
assets/<name>            the pictures, byte for byte, as `.kb/assets` holds them
```

Unzipped, the same layout is a directory, which the same reader opens.

- **`@kb/store-bundle`** (infrastructure, shared) is an `EffectStore`
  adapter over that layout, and joins the store contract
  (`app/test-kit/src/store-contract.ts`) and `STORE_BACKENDS`. What the
  contract promises every store, a bundle keeps: load, commit, the
  transaction tail, noticing an outside write (a directory bundle edited by
  hand, a ZIP replaced). So kb's runtime opens one as it opens a root (`kb
  ui`, `kb mcp` and the CLI over a `.kbcanvas`), and the page opens one with
  no server (S6).
- **A page is a JSON Canvas file** so that "save its json" holds: unzip
  and Obsidian opens each page, drawing the items JSON Canvas knows (text,
  file, link, group; kb's `kb-node`, `shape` and `path` are kb's own types,
  which other readers skip). The page is still a node in `nodes.jsonl`
  (DESIGN.md → Pages); its `sys.f.canvas` value is what the file holds.
  Which props live in files is declared, not known by the store: a field
  may declare a **file form** (a directory, an extension and a media type)
  in its family's declaration; the canvas family declares `pages/*.canvas`
  for `sys.f.canvas`, and the bundle store writes any such prop to its
  file. That is the store-level sidecar for large props that roadmap
  decision 6 names (parity D2), built once, for the one backend that needs
  it now.
- **`manifest.json`:**

  ```json
  {
    "format": "kb.canvas-bundle",
    "version": 1,
    "board": "01K…",
    "exportedBy": { "kb": "01K…", "name": "popemkt/kb", "at": "2026-10-29T10:00:00Z" }
  }
  ```

  Nothing in it repeats what the nodes say: a bundle's needs are its
  scripts' grants (S5), read where they are. No digests: they would give
  integrity without authenticity, and break the round trip through
  Obsidian (edit a page, zip it again).
- **Versioning.** `version` is an integer; a reader opens every version up
  to its own and refuses a later one by name. Within a version, additions
  are optional keys, kept when not understood, as the document keeps fields
  it does not read. The `sys.*` ids a bundle may name are the version's
  vocabulary: core's schema (`sys.field`, `sys.tag`, `sys.f.type`,
  `sys.f.fields`, `sys.f.fieldType` and the `sys.ft.*` options), the canvas
  family's and the code family's. A change to what one of them means is a
  new version, with a migration in the reader.
- **One ZIP reader.** `ext-canvas`'s `tldraw-file.ts` reads ZIPs by hand,
  with no bound on what it inflates. The bundle store's reader replaces it,
  bounded (S7), and the tldraw import reads `.tldraw` through it.

### S2. What a bundle holds: the board's subtree, and stand-ins for the rest

An export takes a board and answers what is **carried** and what is
**stood in for**, by one rule: the rule a grant bounds a script by, "the
subject or under it" (DESIGN.md → Grants).

- **Carried**, as they are: the board and every node under it in the
  outline (its pages, the record nodes the tldraw import files under them,
  the comment threads filed under their canvas), and the nodes those need
  to read as they do here: the field and tag nodes their props and types
  use (an option field with its options), the view nodes the pages name
  (`sys.f.views`, so each page's camera travels) and the `#script` nodes
  the board and its pages name (`sys.f.scripts`; a script must be carried
  to run).
- **Stood in for**: every other node a carried node references. For a
  page, that is what `canvasReferences` (`references.ts`) names — each
  item's `nodeId`, each `link {node}`, each `kbLink` end — the function that
  answers backlinks, so the two cannot disagree; for any other carried
  node, its ref values and `[[refs]]`.
- A carried prop held by a `sys.*` field outside the version's vocabulary
  (another family's, such as `sys.f.gallery.source`) is carried as a field
  node of the bundle with that field's name and type, holding its values,
  and lands by the field rule (S4).

`promote` makes its node at the outline's root (parity D6), so a promoted
card's node is outside the board and is stood in for: open question 3.

### S3. A node of another kb travels as a stand-in

The owner asked for a placeholder; the proposal was a snapshot. Judged: a
**stand-in**, with the placeholder as its smallest setting. ("Snapshot"
already names a code view's server render, DESIGN.md → Sandbox → Snapshots,
and "capture" names `ui.capture`'s pictures.)

- **What it is.** A node with the id of the node it stands for, its text
  the words its card showed, tagged `#stand-in` (`sys.tag.standin`, the
  canvas family's), with three fields of the canvas family's:
  `sys.f.standin.kb` (which kb: its id and name), `sys.f.standin.at` (when
  it was taken) and `sys.f.standin.shown` (what else the card showed, its
  tags and fields, as one text). Its tags and fields are *words*, not refs
  or props: a stand-in never joins a `#todo` query, never adds a backlink,
  and needs no schema of a kb the reader does not have.
- **How much is taken** is the export's `standIn` setting:
  - `shown` (proposed default): the text, the tags and the fields its card
    shows;
  - `text`: the text;
  - `name`: the text's first line;
  - `none`: the placeholder. Nothing of the node but its id and kb; the
    card says "a node of popemkt/kb".

  A `[[ref]]` inside a stand-in's text is kept as written, and the node it
  names is stood in for at `name` (or `none`), one level deep.
- **Which kb.** kb has no identity today. It gets one: a node, `sys.kb`,
  holding a ULID and a name. It is minted by `kb init` for a new root and by
  a migration run on purpose for an existing one (as
  `ext.canvas.camera.migrate` is), never by a read, so opening never writes.
  It is committed, so every clone of the repository is the same kb, which is
  right: its node ids are the same. An export from a root with none refuses,
  naming the migration.
- **How it shows.** A card whose node is a stand-in wears a mark with the
  kb's name and the date ("from popemkt/kb, 29 Oct"), in every projection;
  a `none` stand-in draws as a placeholder card naming the kb, with no tags
  or fields. Its inspector shows `shown` read-only. A stand-in is a node,
  so the outline, search and lints see it as one, and its tag says what it
  is.
- **Live wins.** A stand-in is written only by an import, and only where
  the node it stands for is not: in its own kb the stand-in is dropped and
  the card shows the node (S4). So a card is live wherever its node is.
- **Staleness and refresh.** A stand-in is as of its date. It is refreshed
  by exporting again from its kb; an import refreshes a stand-in the
  importer already holds for the same node and kb when the bundle's is
  newer, since a stand-in is the import's own node, never the person's.
  There is no refresh from a distance (open question 6).
- **A claim, not a proof.** Nothing proves where a stand-in came from. It
  cannot overwrite a node, and the mark says "from", as its bundle says.

### S4. Records are nodes in both homes: D1 holds, restated

The proposal had two tiers: data local to a card in the file, and a node
inside kb. Judged: **one tier, two homes.** A card that carries a record
stands for a node, in kb's store or in the bundle's; there is no `meta` bag
on an item in either.

A bundle node is card-local in every way the owner needs: it lives in the
file, works with no kb, is edited from the card's inspector in the viewer,
and travels with the board. A bag on the item would be a second record
store beside fields (parity D1's reason), and moving it into kb later would
be the meta-to-fields mapping the tldraw import already had to write. D1,
revised: *A card's record is a node, of whichever store the canvas is in.
There is no `meta` field.* The parity record gets a one-line pointer here
when the owner accepts this.

"Promotion" into kb is the import: a bundle's nodes become kb's.

- **`ext.canvas.bundle.export {canvasId, path, standIn?}`** writes the
  bundle at `path`, relative to the root and inside it (no `..`, no absolute
  path; the CLI copies it elsewhere), since a ZIP is not text to hand back.
  It reads assets, which the asset port cannot do today (`AssetsPort` only
  writes), so the port gains `read`, in its contract.
- **`ext.canvas.bundle.import {path, parent?}`** is one transaction, each
  node planned by the `node.add` planner (`planNodeAdd`: the `sys` guard,
  cardinality, values), and a prop keyed by a `sys.*` field outside the
  version's vocabulary refused. Its rules:
  - **No node of the person's is changed**, but the `parent` named, whose
    children gain the board. A carried node whose id this kb holds is
    copied under a fresh id. A stand-in whose node this kb holds is
    dropped; one whose stand-in this kb holds is refreshed when newer.
  - **Ids are rewritten through the reference relation.** A fresh id is
    written wherever the old one is referenced: in documents (`nodeId`,
    `link {node}`, `kbLink`), in props, in `[[refs]]` and in option
    children. Today a ref carrier only reads (`FieldRefCarrier`,
    `declaration.ts`). It gains the write half (`rewrite(value, ids)`), so
    the one declaration that says where a field holds references also says
    how they move, and `canvasReferences` gets its twin in `references.ts`.
    Script code is never rewritten, since that would change its digest; an
    id inside a script's code is the script's to resolve.
  - **A field lands by the field rule.** A bundle field whose id this kb
    holds is that field. Otherwise its name is looked up by the rule
    `ext.canvas.import` keeps since the fix that landed with #56: the one
    field of that name, when it is the person's and its type holds every
    value; else the board's own, named for the field and the board. The
    rule widens from the three types the tldraw import writes to all of
    them: an option field joins only when every value names one of its
    options, and a ref field's values are ids, rewritten as above. Tags
    land by the same rule.
  - **Assets** whose name this kb holds with other bytes land under a fresh
    name, and the references to them are rewritten.
  - **Scripts** land untrusted, and attaching them is configuration
    (`writesConfiguration`), as any attachment is.
- **The tldraw import becomes a bundle import.** `tldrawBoard` already
  lowers records to pages and record nodes. Restructured, it lowers to a
  bundle in memory, and `ext.canvas.import` imports that bundle. One path
  writes a board into kb, with one field rule and one id rule.
- **Bringing a board home is a copy in v1.** A bundle exported from this kb
  and imported back is a second board, its records copies. Merging it into
  the first instead is a three-way merge (`mergeNodeSets`, DESIGN.md →
  Merge), which needs the base the bundle was exported from: open
  question 2.
- `ext.canvas.export` (`json-canvas`, `svg`) is unchanged: an export of one
  page to another tool.

### S5. Scripts and the run: the grant is the capability

A script's grant (`{reads, actions}`) names every action it may call, and
the digest a person trusts covers the grant. That is the declaration of
capabilities; nothing is added beside it.

- **A host answers what it has.** A call its grant allows to an action the
  host has not is answered `unknown_action` (`FailureCodeSchema`; the invoke
  core returns it already), and the prelude rejects with that `code`. The
  viewer reads the bundle's scripts' grants when it opens one and says,
  before anything runs, which of them name actions it has not ("wants
  ext.agent.complete, which this viewer does not have").
- **The run** (#57) keeps its engine and its performers. In the viewer the
  constant performer works; the script performer works for a trusted
  script once `ext.code.script.list` and `ext.code.script.run` run in the
  page (C3), and `field.define` already can; the model performer
  (`ext.agent.complete`, #61, #62) is answered `unknown_action`, so an
  instruction component fails, named, and what follows is skipped, as kb
  does today with no provider. Outputs are the `output` field of the
  component's node, a bundle node in the viewer.

### S6. The viewer is kb's page over a bundle

- **A file session.** The page's session (`app/ui/src/session/runtime.ts`)
  is built over a store that replicates a server. A file session is the
  same layer over `@kb/store-bundle`: every isomorphic action runs locally
  (the canvas's verbs among them once their writes are isomorphic, B1),
  hosted and server-only actions are absent, and saving is the store's
  commit, through the File System Access API where the browser has it,
  else a download.
- **The families a board needs, and no more**: canvas, code (for scripts),
  and the outline's text surface for cards. Routing, panes and the outline
  stay, as a smaller shell; a card's "open" shows a node the bundle holds
  and says "not in this file" for one it does not.
- **Served, never a lone HTML file.** The sandbox's boundary is the frame's
  HTTP headers (`sandbox`, `frame-ancestors`, the CSP), which a `<meta>`
  cannot carry. So the viewer is a static build served with those headers:
  `kb view <file>` on this machine, or one origin kb's releases publish. A
  single HTML file sent with a bundle would be code the recipient runs on
  the sender's word, without the sandbox; it is not offered.
- **Trust in the viewer** is the browser's storage for the viewer's origin,
  per digest, behind the same `CodeTrust` port; `kb view` uses the
  machine's `.kb/trust.json`.

### S7. Security: a bundle is untrusted input

- **Scripts.** A bundle carries no trust; a key that looks like trust is
  not read. Each `#script` is listed with its code and grant and a Trust
  gesture, and nothing runs until a person on this machine trusts its
  digest (`codeDigest`, unchanged). The recorded gap stands: an agent's
  `sandbox.trust` runs as a person's (GAP `01M5E2DAVRH5CWKM27BVDYW19T`),
  so an agent that imports a bundle can trust its scripts. Closing that gap
  matters more once boards arrive from other people.
- **The ZIP.** Only entries in the four places above; no absolute path, no
  `..`, no link, no duplicate; each entry's size checked against its
  header, at most `ASSET_MAX_BYTES` (25 MiB) for an asset, the bundle at
  most 256 MiB unpacked and 100,000 nodes, inflating stopped at the bound,
  not after it.
- **Nodes.** Planned by `planNodeAdd`, within the vocabulary bound of S4: a
  bundle cannot write kb's schema or another family's configuration.
- **Assets** are kept as `asset.upload` keeps them: an `.svg` only as
  `sanitizeSvg` writes it back, the rest only as an image kind
  `mediaKindFromHref` names, drawn as an image, never inlined.
- **No network.** A `file` that is not an `assets/…` image shows its path,
  a link leads only to `http`, `https` or `mailto`, and text renders
  through kb's markdown with no raw HTML. These are today's rules, and they
  hold in the viewer because it is kb's page.

## 3. What changes in what landed

| Landed | Change |
|---|---|
| D1 (parity) | restated as S4: the same rule, two homes |
| #53 drill-down | none: a link to a page is a node id, which a bundle keeps |
| #55 `edit` | none in itself; its write becomes isomorphic with the rest (B1) |
| #56 tldraw import | lowers to a bundle and imports it (A6); its ZIP reading is the bundle store's (A2); its field rule, fixed on landing for keys colliding with kb's fields (`source`), widens to every type |
| #57 `run` | none; in the viewer its model performer is `unknown_action` |
| #58 scale | the suite exports and imports the 40-page board within a budget |
| #61, #62 `complete` | none |
| #64 touch | none; it is how most people will open a board someone sent them |

## 4. Build plan (after the owner reads this)

Each slice is a PR with its tests and its DESIGN.md text; a restructure
lands before the behaviour it makes room for (AGENTS.md → Rule 1).

| # | Slice | Packages | Size | After |
|---|---|---|---|---|
| A1 | kb's identity: `sys.kb`, minted by `kb init` and by a migration | `model`, `runtime`, `cli` | S | — |
| A2 | `@kb/store-bundle`: the layout, ZIP read and write (one bounded reader, the tldraw import moved onto it), file forms declared by fields, the store contract | new infrastructure package, `contracts`, `canvas` | L | — |
| A3 | Ref carriers gain `rewrite`; `references.ts` its twin; a contract over every carrier | `contracts`, `model`, `canvas` | M | — |
| A4 | `AssetsPort.read`, in its contract | `contracts`, `workspace-fs` | S | — |
| A5 | `ext.canvas.bundle.export`: carried and stood in for (S2), `#stand-in` and its fields | `canvas`, `ext-canvas` | M | A1, A2, A4 |
| A6 | `ext.canvas.bundle.import`: the planner, the id rule, the widened field rule; then the tldraw import lowered onto it | `canvas`, `ext-canvas` | L | A3, A5 |
| B1 | Canvas writes without `FileSystem`, so every canvas verb is isomorphic and runs in the page | `ext-canvas`, `operations` | M | — |
| C1 | The file session: the page over a bundle store, a smaller shell, save | `app/ui` | L | A2, B1 |
| C2 | `kb view <file>`: the viewer served with the frame's headers; a released origin | `cli`, `server`, release | M | C1 |
| C3 | Scripts in the viewer: `ext.code.script.list` and `.run` in the page, the viewer's trust record | `code`, `sandbox`, `code-ui` | M | C1 |

A is the owner's "save it in a file and give it to someone" with kb at both
ends; C is the board without kb. A1, A2, A3, A4 and B1 can run side by side.

## 5. Open questions for the owner

1. **The stand-in default.** `shown` (text, tags and the fields the card
   shows) is proposed; `text`, `name` and the bare placeholder `none` are
   the others. By default, what a board shows is what leaves: is that what
   you want?
2. **Bringing a board home.** v1 imports a bundle exported from this kb as
   a copy. Should a later slice merge it back instead (the recipient's
   edits return, conflicts shown as `mergeNodeSets` names them), at the
   cost of the bundle carrying the base it was exported from?
3. **Promoted cards.** A card `promote` made keeps its node at the root, so
   an export stands in for it. Should `promote` file the node under its
   canvas instead (revisiting parity D6), so a board carries its own cards?
4. **Obsidian.** A bundle keeps record cards as `kb-node` items, which
   Obsidian skips. Is an `obsidian` flavour of `ext.canvas.export` wanted,
   one that writes them as text items with their words (one way)?
5. **A model in the viewer.** Proposed: none. The alternative is a key the
   person gives the viewer, kept in that browser.
6. **Refresh from a distance.** A stand-in refreshes only when its kb
   exports again. Re-linking to a kb on another machine needs kb to have an
   address. Out of scope here?
7. **Where the viewer lives.** `kb view` needs kb installed; a released
   origin needs hosting. Which first?

## 6. Review

A first draft proposed a `CanvasHost` port with a kb host and a bundle host
under their own contract suite, captures of foreign nodes as full nodes
with their tags and fields, and per-entry digests in the manifest. An
independent review (Sonnet, read-only, against the code) found that the
bundle host would reimplement the commit, lints, guards and action table
that the store port and the page's local invoke already give any store;
that `unknown_action` already exists; that the asset port cannot read; that
foreign tags and fields would leak into this kb's queries; that ids had no
rewrite mechanism; and that a lone HTML viewer cannot carry the sandbox's
headers. This version is the answer to that review.
