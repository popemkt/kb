# A visual reference gallery for kb

Date: 2026-10-28. Branch `docs/visual-reference-gallery`.

The owner asked for "a plugin that acts as a reference gallery/library for
visual styles: all kinds of stuff, motion, camera angles, artists, style,
etc. The sort of thing you see when using Higgsfield, Automatic1111,
ComfyUI. Eventually a gallery extension where I browse all my visual items:
a structured Pinterest of my own. Also functions to display online sources
like Pinterest or Civitai that match our keywords."

This record surveys what those tools do, how they store it, how prompts are
built from it, and what each online source allows. It then chooses a kb data
model, designs the extension, and plans for media at 10k–50k items. The rules
it is judged by are [AGENTS.md](../../AGENTS.md) (Rule 1, one contract,
canonical statements, drift markers). The specs it would extend are
[DESIGN.md → Data model](../../DESIGN.md#data-model--everything-is-a-node),
[Extension families](../../DESIGN.md#extension-families) and
[DESIGN-UI.md → UI points: routes and views](../../DESIGN-UI.md#ui-points-routes-and-views).
The facts come from a research gather made the same day (sources are cited
inline). Anything marked *unverified* there is marked so here.

**Recommendation in one paragraph.** Build a bundled `gallery` family with
three tags and no new storage shape. A **style** is a named look with an
optional prompt template (`{prompt}`) and negative. It is also the facet
value: "Dolly in", "Rembrandt lighting", "Kodak Portra 400" and "Art
Nouveau" are each one style node. A **facet** (Lighting, Camera motion,
Artist, …) is the node the styles sit under, so a new facet is a new node,
not a new field. A **visual** is one picture or clip: its media is a text
field holding the ordinary `![](assets/…)` embed, and its `styles` field
refers to style nodes. A **board** is any node whose children are contextual
references to visuals. That is the Are.na model (one item, many boards),
built from what the outline already has. The page draws one virtualised
masonry grid, with facet counts (OR within a facet, AND across facets), a
detail panel, and a compose panel that applies the selected styles to a
subject by A1111's `{prompt}` rule. A sources panel searches Civitai's public
API (PG only by default) and opens a search link for every source whose
terms or access rules forbid more (Pinterest, Are.na, Midjourney, Lexica).
Thumbnails are not a second store: the asset route derives a sized WebP on
request with `Bun.Image`, which ships in Bun 1.4 and adds no dependency. The
LLM enhancer waits for a one-shot completion seam on the agent family, and
that is recorded as a gap.

## 1. The market: what these tools are

| Tool | What a "style" is | How it is applied | Data a user keeps |
| --- | --- | --- | --- |
| Higgsfield | A named preset with a tagline, a thumbnail or sample clip and its own page. About 100 image presets (Soul), ~65 camera-motion presets, 23–40+ VFX presets, "Mix" stacking 2–3 motions. | Picked in the web app; the preset's underlying prompt is never shown. **The public API has no preset parameter**: camera motion goes in prompt text. | Nothing exportable; Moodboards (20+ images) mint a private style. |
| Midjourney | No style object. `--sref <code\|url>`, `--sw 0–1000`, `--sv`, `--p` profiles, moodboards. Codes are version-bound numbers. | Prompt parameters. | Users keep sref codes, the sample image and the `--sv` era (a third-party library guide's advice). |
| Krea | A first-class Style object (LoRA): `id, title, urls[], prompt, owner, cover_url, models[]`. | `styles: [{id, strength 0–1}]`. | Trained styles, private unless shared. |
| Leonardo | A `presetStyle` enum (older models) or `style_ids` UUIDs (Flux, Phoenix); "Elements" are LoRA-like `{akUUID, weight}`. | Request fields. | — |
| Recraft | `style` + `substyle` enums, or a custom `style_id` minted from 1–10 reference images. | Request fields. | Custom styles. |
| A1111 | `styles.csv`: `name, prompt, negative_prompt`. No category column; grouping is a naming convention. | `{prompt}` substitution (below). | The CSV. |
| sdxl_prompt_styler / Fooocus | JSON arrays of `{name, prompt, negative_prompt}`. 107 styles in twri's styler, 277 in Fooocus across six packs; the category lives only in a name prefix (`artstyle-…`, `photo-…`). Fooocus ships a sample thumbnail per style. | `{prompt}` substitution; Fooocus stacks several. | The JSON. |
| ComfyUI packs | Styler nodes reading the same JSON; Prompt Composer's per-axis lists (`lens_type.txt`, `painting_style.txt`) with a weight per axis; Impact/Dynamic Prompts wildcards. | Node graphs. | Text and YAML files. |
| Eagle | A local library. Item `metadata.json`: `name, ext, tags[], folders[], url, annotation, width, height, star, palettes[{color, ratio}]`. Folders are virtual (one file, many folders), plus smart folders. | — | Everything, on disk, with a localhost API. |
| Are.na | Blocks connected to channels; one block in unlimited channels; image blocks carry `blurhash, width, height` and size variants. | — | Channels. |
| Pinterest | Pins on boards and sections; `dominant_color`, `media` sizes. | — | Boards. |

Two shapes recur across all of them:

1. **A style is a name plus a prompt fragment plus a sample.** A1111, the
   stylers, Fooocus, Krea and Leonardo all reduce to `{name, prompt with a
   {prompt} slot, negative, preview}`, and the category is either absent or
   squeezed into the name. Higgsfield hides the prompt but keeps the name, the
   tagline and the sample. Nobody models the taxonomy as data, which is the
   gap a graph store fills naturally.
2. **A library item is media plus metadata plus virtual membership.** Eagle,
   Are.na and Pinterest all store dimensions and a colour summary with the
   item, let one item sit in many collections, and keep the source URL.

Prompt text also travels inside the files: A1111 writes a `parameters` PNG
text chunk (`prompt\nNegative prompt: …\nSteps: …`), ComfyUI writes a
`prompt` (API graph) and a `workflow` chunk, and Civitai returns the same
data as an image's `meta`. A gallery that reads those on import gets the
prompt for free (phase 3).

## 2. The prompt side

### Weighting and control syntax

| Tool | Emphasis | Negatives | Other |
| --- | --- | --- | --- |
| A1111 | `(w)` ×1.1, `((w))` ×1.21, `(w:1.5)`, `[w]` ÷1.1 | a separate field (the unconditional conditioning) | `BREAK`, `a AND b`, `[from:to:when]`, `[a\|b]` |
| ComfyUI | `(w:1.2)` | a separate encoder input | `embedding:name`, `<lora:name:w>` (packs) |
| NovelAI | `{w}` ×1.05, `[w]` ÷1.05 | separate | — |
| Midjourney | `a::2 b::1` (weights must sum positive) | `--no x, y` (= weight −0.5) | `--stylize`, `--chaos`, `--weird`, `--sref`, `--sw` |
| FLUX.2 | none; word order is attention | **not supported** | `prompt_upsampling`; JSON camera keys `lens-mm`, `f-number`, `ISO` |
| Veo | none | "describe what you want instead" | — |

Emphasis syntax is model-family specific, so kb must store **plain text** and
render syntax only at compose time, for a chosen target. A style's
`negative` is meaningful only for SD-family targets; composing for FLUX or
Veo drops it (or, for Veo, could be rephrased by the enhancer).

### The `{prompt}` rule, as each tool implements it

| Tool | Template has `{prompt}` | It does not | Negative |
| --- | --- | --- | --- |
| A1111 `styles.py` | replace every occurrence | append, joined with `", "`, empties dropped | the same function, separately |
| twri styler | replace | template returned unchanged (user text lost) | `style_neg, user_neg` |
| Fooocus | replace, then split to lines | caller appends the style as an extra prompt | lines |
| Easy-Use | first style replaces, later ones strip `{prompt}` and append | append | join |
| Dynamic Prompts | `%{… $$ inner}` uses `...` as the slot | — | — |

A1111's rule is the only one that is total (no input loses text), it stacks
(each later style wraps the result so far), and it is the most widely copied.
kb adopts it exactly, for positive and negative separately:

```
merge(style, prompt) = style contains "{prompt}"
                       ? style.replaceAll("{prompt}", prompt)
                       : [prompt.trim(), style.trim()].filter(nonEmpty).join(", ")
compose(subject, styles) = styles.reduce((p, s) => merge(s.prompt, p), subject)
```

### Composers: the order of a prompt

Every published structure is "subject first, then ordered modifier groups":
FLUX.2 (subject, action, style, context), Veo (subject, action, scene,
camera angle, camera movement, lens, style, lighting, mood), Sora 2 (scene
prose, then a cinematography block), Higgsfield's blog (subject, environment,
style, motion, lighting, output intent), Midjourney guides (subject,
style/medium, lighting and colour, composition, parameters last). So the
compose panel orders the chosen styles **by their facet's order**, and the
facets' sibling order is the composer's order. Reordering the facets in the
outline reorders every composed prompt; no setting is needed.

### Enhancers

Two classes exist. Small fine-tuned LMs (Fooocus V2, MagicPrompt, Promptist)
append Lexica-style modifier tags; they are local models with their own
licences (Fooocus's expansion is CC-BY-NC outside Fooocus). Instruction LLMs
with a fixed system prompt (Qwen-Image's `prompt_utils.py`, ChatGPT for
DALL-E 3, FLUX.2's `prompt_upsampling`) are the current pattern: a role line,
rules (keep intent, add concrete visual detail, quote literal text, avoid
negation, cap length), a few examples, an output cue. kb already has
instruction LLMs behind the agent family's providers, so only the second
class is in scope (§6.5).

Wildcards and combinatorial prompts (`{a|b}`, `__colour__`) are a generator,
not a library. They are out of scope; a style whose prompt contains them is
stored and copied verbatim.

## 3. Online sources: what each one allows

| Source | Search API | Auth | What the terms allow | kb's choice |
| --- | --- | --- | --- | --- |
| **Civitai** | `GET /api/v1/images` (no text query: filter by `modelId`, `username`, tag ids, `baseModels`), `GET /api/v1/models?query=` (full text, cursor). Image objects carry `url, width, height, hash` (BlurHash), `nsfwLevel`, `browsingLevel`, `meta.prompt`. | None for public GETs; open CORS. Anonymous answers verified live from shared-server on 2026-10-28. | ToS 11.4 forbids crawlers *except* "our public API … within any applicable rate limits". Users keep copyright; the licence to other users is "through the Service". No published rate limit; back off on 429. | **API.** Search models by keyword, show their sample images. Default `browsingLevel=1` (PG); a per-machine setting may raise it. Saving stores the source URL, creator and model licence flags, and downloads the preview for personal reference (see risk below). |
| **Openverse** | `GET /v1/images/?q=` with `license_type`, `category`, `aspect_ratio`; results carry `attribution`, `license`, `thumbnail`. | Anonymous allowed (page size 20); registered clients get more. | Must not scrape the catalogue; must respect each work's licence and attribution. | **API, when it answers.** Anonymous `/v1/images/?q=` timed out (40 s) from shared-server and from the Mac on 2026-10-28, while `/v1/rate_limit/` answered at once. Built after Civitai, behind the same port; registered credentials may be what it needs. |
| **Unsplash** | `GET /search/photos`; `blur_hash`, `color`, `urls.thumb/small/regular`. | `Client-ID` key; 50 req/h demo, 1000 after review. | Must **hotlink** the returned URLs (no copying), keep `ixid`, call the download-tracking endpoint, credit photographer and Unsplash. | **Link first**, API later. Its hotlink rule conflicts with kb drawing only its own assets, so a saved Unsplash item keeps the link and attribution, not the file. Needs a key, i.e. a `secret` field, and bundled actions have no `SecretSource` yet (§6.4). |
| **Pinterest** | `GET /search/pins` searches only *your own* pins; global search (`/search/partner/pins`) is beta and partner-only. | OAuth; Trial tier, with approvals reported stuck in Oct 2026. | "You may not store any information accessed through … the API"; no scraping; link pins back. | **Link only**: `https://www.pinterest.com/search/pins/?q={query}`. Nothing is fetched or stored. |
| **Are.na** | v3 `GET /v3/search` is **Premium only**. | Bearer token. | No scraping or bulk harvesting; content viewable for personal non-commercial use. | **Link only**: `https://www.are.na/search?q={query}` (HTTP 200 on 2026-10-28). A channel import (`/v3/channels/{id}/contents`, anonymous) is a later, explicit, per-channel action. |
| **Midjourney** | None. | — | ToS forbids automated access. | **Link only**, to the person's own explore page. Store the sref codes and images the person saves by hand. |
| **Lexica** | `GET /api/v1/search?q=` documented, but it returned HTTP 500 on 2026-10-27, and the site did not answer on 2026-10-28. | Unknown. | Unknown. | **Link only**, kept as data so it can be removed. |
| **Higgsfield, Krea, Recraft** | Each has an API, but no preset catalogue in it (Higgsfield), or catalogues behind a paid key (Krea, Recraft). Each ToS forbids scraping its pages. | Keys. | Names are facts; their thumbnails are not ours. | **Not a source.** Seed the preset *names* as styles (camera motions, lighting, Recraft substyles) with no media. |
| Wikimedia Commons, Danbooru/Safebooru, Pexels | Anonymous or keyed APIs. | — | Per-file licences (Commons), no licence field (boorus), new keys paused (Pexels). | Out of scope for the first slices; any of them is a new adapter behind the same port. |

**The rule the panel follows.** Use an official API only where its terms
allow programmatic search, call it only when the person searches, and never
crawl a page. Everything else is a search link opened in a new tab. Two
risks are named rather than designed around. First, Civitai's licence to
other users is worded "through the Service", so keeping a downloaded
preview is personal reference use whose standing is unclear. kb keeps the
source URL and creator with every save so that the item can always be
traced and removed. Second, the panel draws remote thumbnails in the page
(the page sets no `img-src` policy), which tells the CDN the viewer's
address; that happens only after the person searches.

**Artist names.** CLIP Interrogator's `artists.txt` (5,265 names, MIT) is the
obvious seed for an Artist facet. Living artists' names in prompts are the
subject of *Andersen v. Stability AI* and of OpenAI's descriptor-substitution
rule. kb seeds **no artist list**. The Artist facet ships empty, and the
person adds the names they choose to use.

## 4. The kb data model

Everything is a node, and nothing here needs a new storage shape, field type
or widget.

### Tags and fields

| Node | Kind | Fields it templates | Notes |
| --- | --- | --- | --- |
| `sys.tag.visual` "visual" | tag | `media`, `source`, `styles`, `prompt`, `negative`, `width`, `height` | One picture or clip. |
| `sys.tag.style` "style" | tag | `prompt`, `negative`, `media` | A named, composable look, and a facet value. |
| `sys.tag.facet` "facet" | tag | — | An axis: its descendants that are styles are its values. |
| `sys.tag.image-source` "image source" | tag | `search url`, `adapter` | An online source. |

| Field | Type | Card. | Meaning |
| --- | --- | --- | --- |
| `sys.f.gallery.media` "media" | text | many | Markdown embeds, `![alt](assets/<id>.webp)`. A text value renders exactly as node text does, so the outline shows the image with no new widget. The first asset embed is the item's cover. |
| `sys.f.gallery.source` "source" | url | one | Where the item came from. |
| `sys.f.gallery.styles` "styles" | ref | many | `sys.f.targetTag` = style. |
| `sys.f.gallery.prompt` "prompt" | text | one | A style's template, or the prompt a visual was made with. |
| `sys.f.gallery.negative` "negative" | text | one | The negative counterpart. |
| `sys.f.gallery.width`, `.height` | number | one | Pixel size of the cover, written when kb imports the file. The grid needs an aspect ratio before the image arrives. |
| `sys.f.gallery.search-url` "search url" | text | one | A URL template with `{query}`. |
| `sys.f.gallery.adapter` "adapter" | ref | one | Option children: `link`, `civitai`, `openverse`. |

**Why a style is the facet value.** The alternative is one ref field per
axis (`lighting`, `camera angle`, `artist`, …), each with option children.
That breaks in three ways. A new axis would need a new field. Option children
cannot carry a prompt, a negative and a sample. And a Higgsfield preset,
which is both "a camera motion" and "a look with a sample", would be two
nodes. With one `styles` field and the facet read from the outline (a
style's facet is its nearest ancestor tagged `facet`), an axis is a node, a
value is a node that composes, and hierarchy comes free (Art movement →
Impressionism → Post-impressionism). The facet is a reading of structure,
like a reference row's frame. No field duplicates it, so nothing can drift.

**Why media is a text field and not a new type.** kb's one media carrier is
the `![](assets/…)` embed, and a text field's value is "written, rendered and
followed exactly like node text" (DESIGN-UI.md → Field values). A `media`
field holding embeds is drawn by the existing renderer in the outline, the
table and the card. The gallery reads the first asset path through
`@kb/model`'s `isAssetPath`. A dedicated image type would be a second media
carrier, the mirror Rule 1 forbids.

**Boards are nodes, membership is a reference.** A board is any node; adding
a visual to it adds a child that is a contextual reference
(`sys.f.ref.target`) to the visual. The visual stays where it lives. One
visual can be on any number of boards (Are.na's model), removing it from a
board deletes the reference and never the visual, and the outline already
renders a reference row exactly as its target. No `board` tag is needed. A
board is shown as a gallery by choosing the gallery frame view for it (§6.1).

**Sources are nodes.** Seeded sources are option-like nodes under one list
node, and the person adds their own (a link source is one node with a
`search url`). `{query}` is URL-encoded on substitution. That is a different
operation from `{prompt}` merging, so it is a different function, but both
templates are stored as plain text fields.

### What is seeded

The family seeds the tags, fields and sources above. It also seeds the facet
skeleton with **style names only, no media and no prompts**, from public
vocabularies the gather verified: shot size and camera angle (StudioBinder,
Veo), camera motion (the union of Higgsfield, Luma, Kling and Veo names),
lens and optics, lighting (Veo, StudioBinder), mood, palette (colour-scheme
names), film stock, medium (CLIP Interrogator `mediums.txt`, MIT), art
movement (`movements.txt`, MIT) and an empty Artist facet. Seeding them under
a `sys.*` list would make them write-guarded, which a person's library must
not be. So the skeleton is an **import**, not a seed: the action
`ext.gallery.starter` adds the skeleton as ordinary nodes through
`node.addTree`, once, where the person asks. Style packs (Fooocus's 277,
the styler's 107) are a later import from their JSON files by the same path,
each style becoming a style node with its `prompt` and `negative`.

## 5. Where the data model is checked

- `prompt` templates are plain text: no syntax is parsed at write time.
- `styles` targets `#style` through `sys.f.targetTag`. Today only the picker
  applies a target constraint (an existing gap), so a write of a non-style
  ref succeeds; the gallery ignores such refs when it reads.
- `width` and `height` are numbers, so the write check refuses a string.
- The cover is the first `assets/` embed of `media`; a visual without one is
  drawn as a text card.

## 6. The extension

A bundled family `gallery`, off by default (like `lab`), in three packages:

- `@kb/gallery` (shared): ids, seed, declaration, view keys, the action
  schemas, and the pure functions: `composePrompt`, `facetIndex`,
  `filterVisuals`, `coverOf`, `searchUrlOf`.
- `@kb/gallery-ui` (browser): the page, the grid, the panels.
- `@kb/gallery-net` (backend): the `ext.gallery.search` and
  `ext.gallery.save` handlers that talk to Civitai and Openverse, built on the
  network posture `agent-openai/src/chat.ts` already states: https only,
  redirects refused, bounded time, bounded error bodies.

### 6.1 Views

- **Library page**, route `/gallery`, view `gallery.library`, frame `full`:
  every visual in the graph. The page shows the facet rail on the left, the
  grid in the middle and the detail and compose panels on the right. A
  sidebar row opens it.
- **Gallery frame view**, `gallery.masonry`, in the `outline.frame` family
  beside list, table, board and cards: any node's rows drawn as the same
  grid. This is how a board is browsed. Phase 2.

### 6.2 The grid

kb has no list virtualisation today, and at 50k items a plain grid would put
hundreds of thousands of DOM nodes on the page (Lighthouse fails at 1,400).
The grid is a small, dependency-free virtualiser:

- `layoutMasonry(items, width, column, gap)` places each item in the shortest
  column (the rule TanStack's `lanes` and masonic use), from its aspect ratio:
  `width`/`height` when the visual has them, a 1:1 estimate otherwise,
  corrected once the image reports its natural size.
- `visibleRange(layout, scrollTop, viewport, overscan)` finds the items to
  mount by binary search on each column's offsets. Overscan is one viewport
  above and below.
- Tiles are absolutely positioned; only the visible range is in the DOM.
  Images are `loading="lazy"`, `decoding="async"`, at the thumbnail size.
- Keyboard: arrow keys move focus through the layout order, Enter opens the
  detail, Space toggles selection (W3C APG grid pattern).

### 6.3 Facets, detail, compose

- **Facet rail.** One group per facet, each value with its count over the
  current result. OR within a facet, AND across facets (Baymard's finding:
  counts beside values, multi-select within a group, an applied-filter bar).
  A free-text box matches text and prompt. The index is computed from the
  page's graph replica in one pass (`facetIndex`): it is a pure function of
  the node map, as the collections frame rows are.
- **Detail panel.** The cover at preview size, the title, the source link,
  the styles grouped by facet (each a link to the style node), the prompt and
  negative with copy buttons, and "Open as node".
- **Compose panel.** A subject box plus the styles currently selected
  (from facets or from a visual's "use these styles"), ordered by facet
  order. It shows the composed positive and negative live, by
  `composePrompt`, with copy buttons and a target switch (SD keeps the
  negative; FLUX and Veo drop it). Saving writes a visual-less style node
  (`prompt` = the composition) so a good combination becomes a reusable style.

### 6.4 Sources panel

The keywords default to the names of the selected styles plus the subject;
the person can edit them. One row per source node:

- `link` sources open `search url` with `{query}` filled, in a new tab.
- `civitai` calls `ext.gallery.search {source, query, cursor?}`. The handler
  calls `/api/v1/models?query=…&types=LORA,Checkpoint&limit=20` with
  `browsingLevel=1` and flattens each model's first sample images into one
  result row shape: `{id, title, thumb, width, height, pageUrl, creator,
  licence, prompt?}`. Results are drawn in the same grid component.
- "Save" on a result calls `ext.gallery.save`. It downloads the image into
  `.kb/assets` through the `Assets` port (the 25 MiB cap and type list
  apply), reads its size with `Bun.Image.metadata()`, and creates a visual
  with `media`, `source`, `prompt`, `width` and `height`, in one transaction.

Keyed sources (Unsplash, a registered Openverse, Civitai above PG) need a
`secret`-typed `credential` field and a `SecretSource` in the handler. Today
only the hosted agent family receives `systemSecrets()`. A bundled action
gets none, so keyed sources wait for that seam, recorded as a gap.

### 6.5 The enhancer, and why it waits

The ask allows an LLM enhancer "via a general one-shot completion seam if
Rule 1 allows". kb's one LLM mechanism is the agent family's `AgentAdapter`
(`claude`, `openai-chat`), chosen per kb by `#agent-provider` nodes. A
one-shot completion is an agent turn with no tools and one message. So Rule 1
allows it as **a member of that family**, an action `ext.agent.complete
{system, message} → {text}` served by the provider the person chose, and
forbids a second client inside the gallery. The gallery may not import the
agent family (a family imports only its own packages), so it would call the
action by id. Two things block it today. The agent is a hosted family, and
"the server routes no action to a hosted plugin" (GAP
`01M53F2M2S6J3WW0Z0KR136J6A`). The completion member does not exist yet.
The first slice therefore ships no enhancer, and a gap node names the seam.
Its system prompt, when it lands, follows the instruction-LLM pattern of §2
and receives the target model, so it can drop or rephrase negatives.

## 7. Media at scale

### What kb does today

- **The page holds the whole graph.** `GET /api/graph` sends every node, and
  the page builds its own DataScript index in a worker (GAP
  `01M1M08XEH901FXF4MRKJKCSQA`, "the browser holds the whole graph").
- **Opening is a full load and a full index build.** A recorded benchmark of
  50k *bare* nodes shows SQLite load 69 ms and datom build 161 ms. A visual
  carries about 20 datoms (4 base, 7–10 props, a mention per ref), so 50k
  visuals is about a million datoms.
- **Every commit with an upsert reads every row.** SqliteStore settles
  sibling ranks over the whole node set (`rankTx(storedNodes(db))`), and the
  session's integrity check copies all nodes. Saving one visual into a 50k
  library is O(N).
- **Assets** are `<ulid>.<ext>`, not content-addressed, at most 25 MiB, with
  no thumbnails, no dimensions and no placeholder. The grid would download
  originals.

### Plan: measure first

Seed a scratch store (never a person's) with N = 10k, 25k and 50k visuals.
Each gets 3–6 style refs over ~600 styles in 10 facets, a source URL, a
prompt and one generated image. Then measure, on shared-server:

1. store open (`loadEffect`), index build, and full `openKbEffect`;
2. a tag query, a two-facet filter query and facet counts, in datalog and in
   the page's JS index;
3. one save into the full library (commit latency);
4. `/api/graph` time and bytes, and the page's time to a ready grid;
5. scroll: frame time and DOM size in the virtualised grid while scrolling
   end to end;
6. asset serving: originals against derived thumbnails, cold and warm.

### Candidate optimisations, each its own PR with before and after numbers

1. **Derived thumbnails at the asset route** (likely needed). `GET
   /assets/<id>.<ext>?w=256` answers a WebP derived by `Bun.Image` (`resize
   fit inside`, `webp quality 80`), cached under `.kb/cache/thumbs/`
   (regenerable, never backed up). The original is never altered, and the
   query parameter is the only new surface, on the one asset route. Sizes
   are a fixed ladder (256, 512, 1280) so a caller cannot fill the disk.
   `Bun.Image` decodes JPEG, PNG, WebP, GIF and BMP on Linux; on macOS it
   also reads HEIC and AVIF.
2. **The virtualised grid** (§6.2), part of the extension itself.
3. **Placeholders**: `Bun.Image.placeholder()` returns a ThumbHash data URL.
   Kept as a derived artefact beside the thumbnail, not as a prop, unless the
   numbers say the first paint needs it inline.
4. **Content-addressed assets** (`<sha256>.<ext>`): dedupes repeated saves
   and makes a cache key free. It changes `asset.upload`'s contract, so it is
   a separate decision with its own migration story, taken only if
   duplicates show up in practice.
5. **The O(N) commit**: rank settling and the integrity check could read only
   the touched sibling groups and ancestors. This matters for every large kb,
   not just the gallery, and belongs to the store's contract suite.
6. **The whole-graph page** is the existing u1 gap, and too large for this
   task. If the page's time to a ready grid at 50k is unacceptable, the
   finding is reported against that gap with numbers.

## 8. Phases

1. **This record** (docs only).
2. **Measure** (§7), and the optimisation PRs the numbers justify.
3. **First working slice**, a UX PR: the family, its seed, the starter
   import, the library page with the virtualised grid, facet rail, detail,
   compose, and the sources panel (links plus Civitai). Tests: the pure
   functions under `bun test`, the view under Vitest, a render test for the
   page.
4. Later: the gallery frame view for boards; drag-and-drop import with
   PNG/ComfyUI metadata parsing; style-pack import (Fooocus, styler JSON,
   A1111 CSV); Openverse and Unsplash with credentials; colour facets from a
   palette; the enhancer once its seam exists; video tiles with a poster
   frame.

## 9. Open questions for the owner

- Is "visual" the right name for an item, and "style" for a look? (Higgsfield
  says preset, A1111 says style, Eagle says item.)
- Should Civitai saves default to the preview image (smaller, enough for
  reference) or the original?
- Should the Artist facet stay empty, or seed a short list of public-domain
  artists (died before 1955) as a starting point?
