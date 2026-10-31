# The gallery as a visual composer: ways in

Date: 2026-10-30. Branch `feat/gallery-extension` (#59).

The owner reframed the gallery: "a visual composer - reference gallery. One
that can: help me look for reference, articulate my visual image in my
head", supporting "both work flows and more. Since sometimes I know
already, but sometimes I need inspiration. I think we'll have more
workflows in the future, depending at which point you're coming from."
And later: "along with any other workflow you identify".

The first slice (the [gallery record](2026-10-28-visual-reference-gallery.md))
is catalog-first: facets, a grid, and a composer as one panel. That serves
someone who already knows the words. It fails someone with a fuzzy image
in their head, who needs to react to pictures before they can name what
they want. This record surveys how people actually reach a visual idea,
judges the workflows that come out of it, and states the model the page is
rebuilt on. The spec it lands in is
[DESIGN-UI.md → The gallery](../../DESIGN-UI.md#the-gallery).

## 1. How people reach a visual idea

What the tools in the gallery record do, read for the step a person is on
rather than for features:

| Tool           | The way in it is built around                                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Midjourney     | Words first, then reaction: four results, pick, vary (subtle, strong), re-roll. `/describe` turns an image into candidate prompts. Style references (`--sref`) and moodboards (a profile made of uploaded images) carry a look without naming it. Personalisation is built by ranking pairs of images: an either/or, not a description. |
| Krea           | Image first: a real-time canvas where a sketch and a prompt drive the output together; "enhance" and style transfer from a reference.                                                                                                                                                                                                   |
| Higgsfield     | Vocabulary first: presets (camera motions, effects) shown as looping clips, so a person learns "crash zoom" by seeing it.                                                                                                                                                                                                               |
| Pinterest      | Reaction first: a feed, save to a board, "more like this" by image similarity, and boards as the moodboard a brief is cut from.                                                                                                                                                                                                         |
| Are.na         | Collection first: blocks connected into channels, one block in many channels, slow curation over time.                                                                                                                                                                                                                                  |
| Eagle          | Capture first: a browser extension and drag-drop into an inbox of untagged items, then triage (tags, folders, colour filter from an extracted palette).                                                                                                                                                                                 |
| ComfyUI, A1111 | Pipeline first: the prompt is assembled from style templates; CLIP Interrogator turns an image into words.                                                                                                                                                                                                                              |

Art-direction practice runs the same steps by hand. A **brief** says what
the piece is for in plain language. A **moodboard** collects references,
each **annotated with what it is for** ("the lighting from this, not the
palette"). **Tone words** (three to five adjectives) name the feeling. The
director narrows by **contrast** ("warmer or cooler?", "closer or wider?")
because people recognise faster than they recall. A **palette** is pulled
from the references. **Style frames** fix the look on a few key images, and a
**shot list** carries it across a sequence. The **look book** is the hand-off
to the people who make it.

So there are two different starting states, and several in between:

- The person **knows the words**: they need speed (autocomplete over their
  vocabulary, a prompt per model, the references that match).
- The person **has a feeling or a fragment**: they need to externalise it
  (say it in their own words, drop the screenshot), have it **reflected**
  back as named axes, and then **react** to pictures, since reacting is
  easier than naming.
- The person **has one picture**: they need its vocabulary ("what is this
  called?"), its neighbours and its variations.
- The person **has a library**: they browse it.
- The person **is collecting**: they need capture to be instant and triage
  to be fast, often days later.

## 2. The workflows, judged

Built on the workflow contract (§3), in this PR:

| Workflow               | Coming from                     | Why it is in                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I know what I want     | The words                       | The existing flow, made fast: autocomplete over the style library, chips, the matching references beside the prompt.                                                                                                                                                                                                                                                                                                        |
| Help me articulate it  | A feeling, words, images, URLs  | The owner's core ask. Start from anything; the model reflects it into axes (subject, mood, lighting, camera and lens, palette, era or style, artists, composition, motion) with candidate chips, each chip drawn with an example image, so the library is a visual dictionary. Then a reference strip to react to (like, not this, "take the lighting from this") and either/or cards. Works by hand when the agent is off. |
| Start from a reference | One picture                     | "What is this called?" (its styles, and the model's reading of it when it can see), "more like this" (shared styles), and variations along one axis.                                                                                                                                                                                                                                                                        |
| Browse my library      | The library                     | The first slice's facets and grid, unchanged in substance.                                                                                                                                                                                                                                                                                                                                                                  |
| Capture                | Something seen elsewhere        | Probably the most used day to day (Eagle's inbox). Paste a URL or an image, drop files: each becomes a visual with no styles, which is what "untriaged" means, read and never stored. Triage gives it styles and pins it to a look.                                                                                                                                                                                         |
| Remix                  | Two or more references or looks | "The lighting of A, the palette of B": per axis, choose whose styles to take. Varying a saved look along one axis is the same move with one source. Cheap on the contract: it reads styles the library already has.                                                                                                                                                                                                         |
| From a kb node         | A project, scene, story or note | A look is often _for_ something in kb. The node's text seeds the description and the saved look refers back to it (`for`), so the node's backlinks show its art direction. Cheap: one picker and one field.                                                                                                                                                                                                                 |

Recorded as candidates, not built:

| Candidate                            | Why not now                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Palette-first, mood-first            | Mood-first is "Help me articulate it" with mood words as the start; it needs no entry of its own. Palette-first wants colour matching (a visual's palette against chosen swatches), which waits for palettes on saved visuals (a gap, below).                                  |
| Vocabulary explorer                  | Every chip in "Help me articulate it" already shows its example image, and Browse filters by any facet. A facet walked side by side earns its own entry once styles carry their own samples (`media` on a style) in numbers; until then it would show the same pictures twice. |
| Sequence / shot list                 | High value for video, and it fits the model (a shot is a look that inherits one and varies motion and shot size). It needs an editor of its own (ordering, per-shot overrides), which is a slice, not a cheap addition.                                                        |
| A look as a backdrop's art direction | The backdrop framework (docs/backdrops.md) takes reference images; a look's pins are exactly those. It needs the backdrops family to read a look, a cross-family edge that should be declared with `inject` on its side; this PR makes the look a node it can read.            |
| More like this, by image             | Needs local image embeddings: a gap. Shared styles stand in.                                                                                                                                                                                                                   |
| A palette for every saved visual     | Extraction at save time on the server, or a backfill: a gap. A look's palette is extracted in the browser from its pins, which is cheap.                                                                                                                                       |
| "Close, but not quite"               | From any picture, "more of this axis, less of that" (warmer, wider, quieter) re-ranks the library. It is how a person refines an image in their head, and needs no model; it wants an ordering on each axis's styles, which the starter does not record yet.                   |
| What is missing                      | The look's empty axes, each with three pictures from the library to fill it by seeing. Cheap over `axesOf` and `examplesOf`; it wants examples chosen by how strongly a visual shows a style, not the first one found.                                                         |
| A shorter look panel                 | The prompt, styles and pins first; avoid, the negative prompt and the palette folded to one row. The panel is the thing being articulated, and below the fold on a laptop.                                                                                                     |

Hand-off is not a workflow: it is what a look _does_. A look exports as a
brief in Markdown (description, tone, styles by facet, prompts per model,
palette, references with their notes and credits) and opens as a canvas
moodboard.

## 3. The model

**A workflow is a view of one family.** kb already has the mechanism for
alternatives a host chooses between: a view family (DESIGN-UI.md →
Families of views), enumerated by `familyViews`. A workflow is a view whose
key carries `family: "gallery.workflow"` and the workflow's traits: the
question it answers ("where are you coming from?"), its steps, and what it
reads and writes, as tag ids. The gallery ships its workflows as views of
that family; another family adds one by providing a view whose key carries
the same family, from its own UI half. No list in the page names them. The
page is the workflow host, as the graph page is the renderer host: what a
workflow works on (the library, the look being made, what the agent and
the canvas offer) travels in the host's context, never in the params.

**One output: the look.** Whichever way in, the person is building one
thing, a look: a node tagged `#look` with

- `description`, the plain-language brief (also the composer's subject);
- `styles`, the chosen styles (the same field a visual uses);
- `negative`, what to avoid;
- `palette`, swatches as hex text, extracted from its pins;
- its **pins**: child nodes whose text is the note ("the lighting from
  here") and whose `reference` refers to the visual;
- `for`, the kb node it art-directs, when it has one;
- its **moodboard**: a child `#canvas`, laid out by the canvas family.

Prompts per model (SD/SDXL, FLUX, video) are _read_ from the look by the
composer's one rule, never stored, so they cannot drift from its styles.
The draft is shared by every workflow on the page: switching workflow
keeps it.

**The moodboard is a canvas, through a declared need.** The canvas family
provides a board service (`BoardService` in `@kb/ui-sdk`): make a board
under a node, and place cards for nodes on it. The gallery's `moodboard`
child injects it, as `enhance` injects the model completion, so it is
pending while canvas is off and the look says what the moodboard needs. A
pin's card shows the pin node itself, so a note edited on the board is the
note in the look.

**The model is asked, never required.** Reflection, "what is this
called?" and Enhance go through `ModelCompletionService`. When it is
missing, every workflow still works by hand: the axes show their facets'
styles to pick from, and the page says what the agent would add. When the
model cannot see images, it is sent the words alone, and the page says so.
