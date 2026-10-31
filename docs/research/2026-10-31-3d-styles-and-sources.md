# The gallery in 3D: styles, techniques, and where to find them

Date: 2026-10-31. Branch `bb/kb-gallery-3d-styles-techniques-sources-thr_9mb49kssdn`.

The owner asked for the gallery to cover 3D: "adds styles and techniques in
3d for the gallery plugin, what sources would offer that?" The reason is
practical: they are choosing a stylized look for Vietnamese monuments built
in Three.js. So a 3D style has to tell a builder how to make it, not only
what it is called. This record covers how the vocabulary was chosen, what
each source allows, and how the example pictures were made. The spec is
[DESIGN-UI.md → The gallery](../../DESIGN-UI.md#the-gallery). Earlier
records: the [gallery](2026-10-28-visual-reference-gallery.md) and the
[visual composer](2026-10-30-visual-composer.md).

## 1. The model did not change

Every 3D concept fitted the gallery's existing shape, so nothing was added
beside it:

- **A 3D style is a `#style` under a `#facet`.** That covers a look
  (cel-shaded), a technique (toon ramp), a lighting setup (HDRI studio
  lighting), a projection (orthographic) and a way of presenting a model
  (turntable). The task suggested a "camera" facet. It became two facets,
  Projection and Presentation, because the starter already has Shot size,
  Camera angle, Camera motion and Lens, and an orthographic camera has
  nothing in common with a dolly zoom except the word.
- **What a builder needs is fields on the style.** The existing fields are
  `description` (what it looks like), `prompt` and `negative`, and `styles`
  (the styles it is made with). Two fields are new: `seen in` (the works
  that show it) and `how to` (one value per tool). "Cel-shaded is made
  with a toon ramp and an inverted-hull outline" is a relationship between
  two style nodes, so `kb backlinks` on the toon ramp lists every look that
  uses it.
- **Three of the four export targets already existed.** The "3D
  art-direction brief" is a new target in `LOOK_EXPORTS`, beside the brief.
  It is not a separate export path.
- **Each new source fits an existing contract.** A link source is a
  `#image source` with a search URL. An API source is a `SourceAdapter`,
  and the shared contract suite runs over every adapter.

## 2. The vocabulary

Sonnet subagents gathered 34 styles and about 60 techniques, lighting
setups, projections and presentations, each with Three.js, Blender and Godot
notes. Opus then curated them:

| Facet               | Count | Notes                                                                                                        |
| ------------------- | ----: | ------------------------------------------------------------------------------------------------------------ |
| 3D style            |    33 | Each one names the techniques it is made with                                                                |
| Rendering technique |    31 | One shader, pass or modelling choice each                                                                    |
| Lighting            |   + 9 | The 3D setups joined the existing Lighting facet; golden hour, overcast and god rays merged into its entries |
| Projection          |     6 | Perspective, orthographic, isometric, dimetric, plan view, oblique projection                                |
| Presentation        |    11 | Product shot, turntable, diorama on a plinth, exploded view, cutaway, model sheet, lineup, and others        |

The curation rules:

- **A name is the word a person would type.** For example, "lacquer (sơn
  mài)" rather than "lacquer painting (son mai)", and "Kuwahara filter".
- **A technique the starter already names is merged, not repeated.** Its
  notes go on the existing style (halftone, film grain, shallow depth of
  field, golden hour, overcast daylight, volumetric light, 135mm telephoto
  lens). The starter reads those notes from `NOTES_3D` by name.
- **No style or prompt names an artist, a studio or a work.** "Ghibli-like
  painted 3D" became "painted storybook 3D", "Moebius / ligne claire 3D"
  became "ligne claire 3D", and prompts lost "Nintendo" and "Macintosh".
  Two names keep a console's era because the genre is called that: PS1
  retro and N64 low-res. The works themselves sit in `seen in`, which is a
  fact about the style and never reaches a prompt.
- **Dropped:** "pencil sketch / hatching", which is the existing Medium
  facet's job. Also dropped: the "ambient occlusion only clay" and "baked
  GI" lighting setups, which clay render and white model already cover.
- **What the gather could not verify stayed out of the library.** That
  includes Godot's affine-interpolation qualifier, the exact shear signs for
  an oblique projection, whether Blender has a dedicated grain node, and the
  EEVEE support level of the Toon BSDF. The notes say what is known and
  stop there.

Where the notes are written: `packages/extension/gallery-net/src/starter-3d.ts`
and `starter-3d-styles.ts`. They are generated once from the gather and
edited by hand since. The starter sits in the server half (`ext.gallery.starter`),
so its roughly 100 KB of prose never reaches a page's download.

**Gap: a how-to's tool is a word in its text.** The value reads
"Three.js: …", not a reference to a tool node. Recorded as
`GAP [[01M68CQN0E7CMMEATHT0RDYV10]]`.

## 3. Sources, and what each allows

The rule from the first gallery record still holds: an API source only
where the terms allow anonymous programmatic search, a link source
otherwise, and nothing where neither works. The terms quoted below were
read on 2026-10-31.

| Source                                                                        | Verdict                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sketchfab                                                                     | **API**                      | `api.sketchfab.com/v3/search` answers without a key. `restricted=0` leaves out age-restricted models, and kb also drops any with `isAgeRestricted`. Its `license` filter takes one value only, so kb asks for `downloadable=true` and keeps only CC licences. The API agreement grants a limited licence to use the APIs; it neither names nor forbids anonymous search. The credit is "<licence>, on Sketchfab".                |
| Poly Haven                                                                    | **API** (catalogue)          | The [API ToS](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md): "free to access and use by anyone … for any purpose", a key "will never be required", and a client must send its own User-Agent (kb's every request does) and credit Poly Haven visibly (the source's name heads its results). There is no text search, so kb reads the published catalogue (about 2.5 MB) for the query's words. Everything is CC0. |
| three.js examples                                                             | **API** (catalogue)          | `examples/files.json` is a static index with a screenshot per example. The code is MIT. A scene's models and textures carry their own licences (Flamingo, Soldier and the glTF helmets are not MIT), and the credit says so.                                                                                                                                                                                                     |
| ArtStation                                                                    | link                         | No public API. The operator blocks automated access through Cloudflare and says it has "no agreements permitting AI companies to scrape its content".                                                                                                                                                                                                                                                                            |
| Shadertoy                                                                     | link                         | The API needs a per-developer key, and the whole domain sits behind a Cloudflare challenge.                                                                                                                                                                                                                                                                                                                                      |
| Godot Shaders                                                                 | link                         | No API. A shader's code licence (CC0, MIT or GPLv3) "does not" cover "the featured image, screenshots and videos".                                                                                                                                                                                                                                                                                                               |
| Blender Studio                                                                | link                         | No API. Its content is CC BY 4.0, and robots.txt says `search=yes, ai-train=no, use=reference`.                                                                                                                                                                                                                                                                                                                                  |
| Blender Artists                                                               | link                         | Discourse `search.json` answers, but robots.txt has `Disallow: /search`, so it is a link.                                                                                                                                                                                                                                                                                                                                        |
| BlendKit (was BlenderKit)                                                     | link                         | Search answers anonymously, but robots.txt disallows `/api/`, and the T&C say "you may not … use the content for any purpose without our prior written consent". `blenderkit.com` now redirects to `blendkit.com`.                                                                                                                                                                                                               |
| YouTube                                                                       | link                         | The Data API needs a key and has a 30-day "delete or refresh" rule for stored data, and scraping is forbidden. Channels worth searching are listed below.                                                                                                                                                                                                                                                                        |
| Pinterest, Are.na                                                             | link (already seeded)        | Pinterest's ToS forbid automated access and its API has no pin search. Are.na needs a token and blocks anonymous automated access.                                                                                                                                                                                                                                                                                               |
| Polycount wiki                                                                | not seeded                   | It has an anonymous MediaWiki API and CC BY-SA content, but it is served over **http only**. The gallery holds every source to https, so it cannot even be a link source unless that rule bends for links.                                                                                                                                                                                                                       |
| 80.lv                                                                         | none                         | The ToS forbid "automatic gathering". There is also no search URL: `/articles?title=` does not filter, and `/search?…` is a 404.                                                                                                                                                                                                                                                                                                 |
| glTF Sample Assets                                                            | none                         | It is redistributable and licensed per model, but the 150 models are technical test cases (extensions, edge cases), not styles.                                                                                                                                                                                                                                                                                                  |
| Wikimedia Commons                                                             | none (already via Openverse) | It has an anonymous API and a "Cel shading" category, but Openverse already indexes Commons.                                                                                                                                                                                                                                                                                                                                     |
| Openverse                                                                     | unchanged                    | It has no 3D media type, so it adds nothing for 3D queries.                                                                                                                                                                                                                                                                                                                                                                      |
| Unity Asset Store, CGTrader, TurboSquid, Behance, DeviantArt, Kenney, itch.io | not seeded                   | These are commerce or portfolio sites with no API kb may use. Any of them could be a link source if wanted. Kenney is CC0, but it is one studio's style.                                                                                                                                                                                                                                                                         |

Each link source's search URL was opened live and shown to fill the
query. The exception is Sketchfab's web search, which returns a WAF
challenge to curl; it is the site's own URL pattern. The API sources
returned results live from the server: Sketchfab 24 for "pagoda", Poly Haven
20, and three.js 4.

**Technique channels on YouTube.** The link source opens a search. These
channels are where 3D-technique searches tend to land: Acerola (graphics
programming, NPR), Ben Cloward (shaders, Unity and Unreal), Daniel Ilett
(Unity and Godot shaders), Freya Holmér (tech art and maths), Sebastian
Lague (graphics from code), Brackeys (Shader Graph basics), Blender Guru,
Ian Hubert, Grant Abbitt, Lightning Boy Studio (stylized shaders), Ryan
King Art, MinionsArt (stylized Unity), Thomas Potter, and Blender Studio.
They are not seeded, because a channel is not a search.

## 4. The example pictures

A 3D style has no public-domain painting to file under it, and a Sketchfab
model's CC-BY licence would have to travel with every copy. So the starter's
3D pictures are kb's own. They show one scene, the One Pillar Pagoda on its
pillar in a lotus pond, built from primitives in Three.js r186. It is
rendered in 14 styles: cel-shaded, white model, low-poly, lacquer, woodblock
print 3D, ink wash 3D, PS1 retro, blueprint, isometric diorama, clay render,
voxel, vaporwave 3D, risograph 3D and miniature. Each rendering uses that
style's techniques (toon ramp with an inverted hull, GTAO, RenderPixelatedPass,
a Kuwahara-like paint pass, tilt-shift, and a riso shader).

The scene loads no models, textures or fonts, so the pictures are CC0.
`docs/research/assets/2026-10-31-3d-styles/` holds `scene.js`, its page,
and `render.ts`, which renders every style headless to `out/`. Re-running
it reproduces the pictures.

## 5. Open questions for the owner

1. **Prompts per model as export targets.** The brief and the 3D art
   direction are exports. The SD, FLUX and video prompts are still read in
   the panel. Should each one also be an export?
2. **A "3D pack" for a library that already ran the starter.** The starter
   is offered once, to an empty library. A person who added it before this
   change does not get the 3D facets. Should there be an action that adds
   only what is missing, matched by name?
3. **Polycount over http.** Should a link source be allowed to be http when
   the site has no https? It would only ever open in the person's browser.
4. **80.lv.** A site-scoped web search link
   (`https://duckduckgo.com/?q=site:80.lv+{query}`), or nothing?
5. **CC0 for the renders.** They are licensed CC0 as kb's own work. Should
   they be credited differently?
6. **The sources panel is long.** There are 16 sources now. Should they be
   grouped (images, 3D, technique) or ordered by the facet in use?
7. **Poly Haven's catalogue** is about 2.5 MB, fetched again on each page of
   results. That is fine today, and its `max-age` is 12 h. Should kb cache
   it, or only fetch the HDRI, texture or model list the query needs?
