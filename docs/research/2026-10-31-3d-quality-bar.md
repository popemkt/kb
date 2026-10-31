# The 3D quality bar: six Bruno Simon experiments, and the workshop black hole (research, for the owner to read)

Date: 2026-10-31. Base: `main` at `d1b4d8cc`. This record studies and
proposes. The only things it changes are the framework nodes and the two
nodes it files (§8); it builds no backdrop. It links to what owns each
mechanism and does not restate it:

- the criteria a backdrop is judged against, as nodes and their generated
  document: [`docs/backdrops.md`](../backdrops.md) (source: the
  `#backdrop-criterion` nodes under "Backdrop framework" in `.kb/nodes.jsonl`);
- how a backdrop plugs in: [DESIGN-UI.md → Page-head backdrops](../../DESIGN-UI.md#page-head-backdrops);
- the rules this must respect: [CLAUDE.md → Rule 1](../../CLAUDE.md#rule-1--abstraction-before-addition) and
  [Canonical statements](../../CLAUDE.md#canonical-statements).

The owner's ask: *"some nice things from the threejs author … I think that's
the quality if we do 3d that we need to at least achieve … look at this and
put the bar for new backdrops/themes in."* Their favourite is the volcano
robot. They also want the black hole of the Awwwards 2022 workshop as a
second mode beside kb's black hole (§6).

"unv." marks a claim I could not verify against a primary source or by
running it; each is listed again in §7.

## 0. The answer

**The bar, in six lines** (the criteria are in `docs/backdrops.md`; this is
what they ask in short):

1. **Graded, not default.** One authored palette, a tone curve or ramp so
   highlights roll off and shadows stay tinted (no `#000`, no clipped
   plateau), and a restrained finish (luminance-weighted grain, a colour
   split that grows toward the edges), never on the text. *(new: Graded and finished)*
2. **Lit with intent.** Every surface is self-luminous with a hot core, or lit
   by a named key plus a rim or fresnel edge; baked or live, said light by
   light. *(new: Lit with intent)*
3. **Depth in three layers and detail at three scales.** Ground, subject,
   atmosphere, shifting by different amounts; macro, middle and fine
   structure from at least two octaves a factor of two apart. *(amended: Objects above the backdrop; new: Detail at several scales)*
4. **Eased, never linear, and the same at any frame rate.** Damping on
   elapsed time; idle motion from unrelated slow frequencies; the pointer
   moves a physical thing, bounded, settling within 3 s. *(amended: Motion; new: Believable interaction)*
5. **No pop-in, no aliasing.** Ready and settled in under 3 s with the first
   visible frame already composed; antialiased at DPR 1 and 2, including
   offscreen targets. *(amended: No load flicker, Sharpness)*
6. **Cheap by construction.** Only what changes is drawn per frame: bake the
   fixed, draw soft things small, instance the repeated, draw nothing when
   hidden, and list the frame's passes in the PR. *(amended: GPU budget)*

**The licence answer.** The workshop black hole is **not MIT, and not
licensed at all.** No public repository of Bruno Simon's holds it (there is no
`awwwards-2022-workshop` under `github.com/brunosimon`); the attendee copy I
read says `"license": "UNLICENSED"` with no `LICENSE` file, and so do four of
the five public repositories of his studied here (the fifth says ISC, with no
licence text; none has a `LICENSE` file). Default copyright applies: all rights
reserved. So **nothing
may be ported, only re-created from the technique described in §6, in kb's own
code, colours and tuning.** A credit line for the idea is good manners and
costs nothing; it is not a licence obligation and does not make a copy
lawful. §2 has the evidence and what an MIT port *would* have needed.

**The black-hole notes** are §6 of this file:
[`docs/research/2026-10-31-3d-quality-bar.md` §6](#6-the-workshop-black-hole-notes-for-the-builder).

## 1. How this was studied, and what that cannot tell us

- Each live site was loaded in headless Chromium (Playwright, software GL:
  SwiftShader), a few frames captured at 1280×720 (smaller for the heavy
  ones: the terrain's million-vertex plane and the sphere's 262k-vertex shader
  time out a software rasteriser at full size), and its network list
  recorded. Frames are in the thread storage, **not committed**: they are a
  third party's artwork, and the framework's own rule is that nothing in the
  repository copies a third party's mark.
- Each repository was cloned shallow and read: shaders, renderer set-up, the
  load path. For the workshop black hole the deployed bundle was read as well
  (its GLSL ships as strings in the bundle, and it matches the copies' sources
  line for line in the composition shader; one constant differs, below).
- **Frame times are not measured.** A software rasteriser says nothing about a
  GPU. The "budget" notes below are structural: passes, vertex counts, targets,
  bytes. The framework's GPU-budget criterion keeps its own measured method.
- Load per site, from the network list (bytes on the wire at first load):
  the procedural ones are small (workshop black hole 0.43 MB in 3 requests,
  infinite world 0.69 MB in 4, terrain 0.79 MB in 6) and the baked or authored
  ones are large (volcano robot 6.7 MB in 7, room 15 MB in 26).

## 2. Licences

| Reference | Repository | Licence evidence |
| --- | --- | --- |
| Woodkid Volcano Robot | [`brunosimon/experiment-woodkid-volcano-robot`](https://github.com/brunosimon/experiment-woodkid-volcano-robot) | no `LICENSE`; `package.json`: `UNLICENSED`; GitHub detects none |
| My Room in 3D | [`brunosimon/my-room-in-3d`](https://github.com/brunosimon/my-room-in-3d) | same |
| Organic Sphere | [`brunosimon/organic-sphere`](https://github.com/brunosimon/organic-sphere) | same |
| Holographic Terrain | [`brunosimon/experiment-holographic-terrain`](https://github.com/brunosimon/experiment-holographic-terrain) | same |
| Infinite World | [`brunosimon/infinite-world`](https://github.com/brunosimon/infinite-world) | no `LICENSE`; `package.json`: `ISC`; GitHub detects none |
| Awwwards 2022 workshop | **none public under `brunosimon`** (`gh repo view` finds no such repository; the account's list has `webgl-black-hole`, a different build: its uniforms are `uBlackHolePosition`, `uInnerColor`, `uRGBShiftRadius`, none of which the deployed bundle has) | copies by attendees, for example [`Kirilbt/awwwards-black-hole`](https://github.com/Kirilbt/awwwards-black-hole) (readme title "Awwwards 2022 - Workshop", built from 2022-10-10, uniforms and shaders match the deployed bundle): `package.json` `UNLICENSED`, no `LICENSE`, no GitHub licence |

What this means:

- **Reading is free; copying is not.** Without a licence, copyright is all
  rights reserved. We may study the technique and write our own. We may not
  copy code, shader text, or art, and "a port" that transcribes a shader into
  TSL is a copy in another syntax. The same holds for the `UNLICENSED` ones
  whatever their authors intend: the field says so.
- **ISC in `infinite-world` is weaker than it looks.** ISC grants use and
  copying *on condition that the copyright notice and the permission text are
  kept*. A `package.json` field with neither is a statement of intent, not a
  grant we can point to. Treated as unlicensed.
- **Is the black hole MIT? No.** Nothing says MIT anywhere in the chain. Had
  it been MIT, a port (or any copy or substantial portion) would need the
  copyright line and the MIT permission text kept with it; nothing else (no
  endorsement or advertising clause). It is not, so none of that applies and
  the safe course is a re-creation (§6.1).
- **What a re-creation may take.** Ideas, algorithms and effects (a ring
  coloured by a ramp, a screen-space pull toward a point, a luminance-weighted
  grain) are not protected; a particular expression of them (their shader text,
  their constants as a set, their art) is. §6 describes the technique in words
  and gives starting ranges to *re-tune against kb's palette*, not values to
  transcribe. This is a reading of the position, not legal advice; the owner
  can settle it for good by asking the author for a licence (I have not
  contacted anyone, and the task forbids posting to external repos or
  chats).
- **kb's own rule agrees.** The framework's "Original marks in the public
  repository" criterion already says what ships is kb's own art.

## 3. The six, one at a time

For each: what it is, what makes it good, the budget tricks, what it avoids.
Frames referred to were captured on 2026-10-31.

### 3.1 Woodkid Volcano Robot (the owner's favourite)

A huge matte grey robot (its arms spread as in Woodkid's *Volcano* live
show) driven from a gamepad or the keyboard, in a dark room. One 5.8 MB model,
no textures, one material.

- **Lighting: real-time, kept to two lights.** A single point light and one
  hard spotlight whose position slowly sweeps up and down, so highlights
  crawl across the plates. The spot throws a 4096² soft (PCF) shadow, which
  is what gives the robot weight against the fog. The robot's material is
  uniformly rough and unmetallic, so all form comes from the one light.
- **Fog is the second light.** Linear fog (three.js `Fog`, near 8.7 and far 12 in the
  default mood) to *black*, the colour of the ground, with the camera at 10:
  the robot's far parts dissolve rather than end.
  This is the depth cue, and it is why a flat grey subject reads as huge.
- **Grade and tone mapping.** A filmic curve (Cineon) with exposure over 1,
  and four *presets* that change the whole mood by data alone, through the
  same scene: dark, silhouette (white ground, black robot, no tone map),
  red (red fog, near-black robot) and wireframe (bloom on, tone exposure 3,
  an orange spotlight). Mood is parameters, not code.
- **Post: one small final pass.** Pixels are jittered by a hash weighted by
  distance from the centre, and red, green and blue are sampled a hair apart
  along three directions, again weighted toward the edges. The centre stays
  clean and the frame's edge looks like a lens. Bloom exists and is off by
  default: it is a mood, not a default.
- **Background.** A radial gradient between two near-blacks drawn as a
  full-screen quad with depth test off; never pure black (`#1c1c1c` to
  `#000000`).
- **Motion and interaction.** Every part of the robot has a target value and
  an eased value: the eased one moves toward the target by a fraction per
  millisecond of elapsed time (frame-rate independent), with a different
  easing per joint, so the shoulders, elbows and claws lag by different
  amounts. Buttons toggle direction and sticks set a target; nothing snaps.
- **Intro.** A title card (`#111`, a serif title, then two small captions
  fading in at 0 s, 3 s and 5 s) covers the model load and starts to lift
  at 9 s. It is an intro *over* the load, not a spinner: by the time it lifts
  the scene is composed. (That is nine seconds; the bar's limit of 3 s is for
  a backdrop, which sits behind a page and must not make anyone wait.)
- **Sound.** None.
- **Budget.** Pixel ratio capped at 2; a multisample render target below DPR
  2 and a plain one at 2 (supersampling replaces MSAA); a model loaded
  through a Draco-capable loader (unv.: whether this file uses Draco); one
  final pass. The one expensive part is the 4096² shadow map.
- **What it avoids.** Metallic highlights on everything, a lit-from-all-sides
  look, bloom as a default, a skybox, bright colour.

### 3.2 My Room in 3D

A cutaway bedroom/office, isometric-ish, with a lit desk, a TV, plants and a
sofa; the room can be orbited within limits.

- **Lighting: baked, completely.** The room is one mesh with one shader and
  *no* real-time light. Three 4096² photographs of its lighting are baked
  offline (day, night, neutral) and cross-faded by two numbers. A fourth
  4096² "light map" stores in its red, green and blue channels *where three
  practical lights fall* (the TV, the desk lamp, the PC), and the shader adds
  each light's colour by a lighten blend scaled by a strength uniform. So the
  night room can have its TV glow pulse without re-baking: the bake is the
  expensive soft light, the uniforms are the cheap live accents.
- **Grade and tone.** There is no tone curve in the renderer: the grade was
  done when baking (the pink TV, orange desk, blue PC are the three accents
  against a violet night). The bakes are tagged sRGB and the renderer outputs sRGB (unv.:
  whether the raw shader re-encodes; the frames look correctly exposed), so
  nothing is left as unmanaged raw albedo.
- **Particles and small live things.** Coffee steam is a plane with a
  scrolling two-dimensional gradient noise multiplied by an edge mask so it
  fades at its borders; screens are video textures; LEDs on a smart speaker
  are a mask texture; a logo bounces. Each is a single cheap quad.
- **Motion and interaction.** The camera is a spherical orbit (radius,
  polar, azimuth) with a *target value* and a *smoothed value* each, the
  smoothed one following by a small fraction per millisecond, and **hard
  limits** on radius, polar angle, azimuth and the look-at target. You can
  not orbit to a bad angle: every reachable view is a composed one.
- **Sound, intro.** None, and no title card. The picture waits for one asset
  group (the models and the four textures: about 1.4 s on this machine's link);
  the two screen videos (3.7 MB and 1.9 MB, done at 11.9 s and 2.9 s here) are
  `<video>` elements loaded outside that group, so they never delay the first
  picture: the right order.
- **Budget.** One draw for the room's geometry; pixel ratio capped at
  2; a multisample target below DPR 2. **Cost:** four 4096² textures are
  about 256 MB of GPU memory uncompressed (my arithmetic: 4 × 4096² × 4
  bytes), which is the price of baking at this fidelity. kb's backdrops should
  bake at 1024–2048 and compress.
- **What it avoids.** Real-time lights and shadow maps (there are none),
  ambient fill, default materials, a free camera.

### 3.3 Organic Sphere

A glowing, writhing sphere of orange and blue light on a deep violet ground,
a letter-spaced title across it; it reacts to the microphone if allowed.

- **Lighting: two coloured lights, gated by fresnel, computed per vertex.**
  The shader never shades the interior: colour is a mix toward light A
  (orange) and light B (blue) weighted by how much the surface faces each
  light *and* by a fresnel term that is zero face-on and strongest at the rim,
  so only the edge of the shape is lit. The most strongly rim-lit areas tip over
  to white. The body stays the ground's colour. This is the entire look.
- **Detail: domain-warped noise.** The sphere's vertices are displaced by 4D
  gradient noise (the fourth axis is time) whose input position was *first*
  displaced by another sample of the same noise: noise on noise, which is what
  makes the forms fold and flow instead of lumping. Normals come from
  displacing two neighbouring points (a tangent step each way) and crossing
  the differences, so the light follows the displacement.
- **Post.** An unreal-style bloom pass whose composite was edited to tint the
  glow violet (15%), so the halo belongs to the ground, not to white.
- **Motion and interaction.** Four parameters (displacement, distortion,
  fresnel multiplier, noise speed) each have a target and a current value
  moved with *two* rates: fast when rising, slow when falling (attack and
  release), the same shape a meter has. Microphone band levels set the targets;
  with no microphone they idle at defaults. Time offsets drift so the shape
  never repeats.
- **Sound.** Input only, optional: a spectrum analyser (fft 256) from the
  microphone, off unless the visitor grants it.
- **Intro.** None; the title is static.
- **Budget.** The cost is vertices, not pixels: a 512×512-segment sphere is
  about 262,000 vertices, each doing three displaced-position evaluations (its
  own point and two neighbours, for the normal) of two 4D noise calls each:
  six noise calls a vertex, a frame; the fragment shader writes one varying
  out. Pixel ratio capped at 2.
  Unverified: the frame time on a real GPU (§7).
- **What it avoids.** A fragment-shaded surface, a texture, a sphere that
  looks like a sphere, white bloom, pure-black ground.
- **Credit.** Its page credits the effect that inspired it ("Alien Ripple by
  Drawfish"): the author names his sources on the page.

### 3.4 Holographic Terrain ("Valley")

A drifting ridge-and-valley landscape drawn as thin contour lines in
rainbow-shifting colour on deep purple, with a title and a menu.

- **Look from a lookup, not from lighting.** There is no lighting. The
  terrain is a plane displaced in the vertex shader by two octaves of
  two-dimensional noise, shaped by a cosine "valley" term so there is a
  channel down the middle. The fragment shader looks the elevation up in a
  one-column canvas texture painted with one thick line and several thin
  ones, which draws *contour lines at fixed heights*. Colour is a
  hue-saturation-lightness value driven by noise that scrolls, so the rainbow
  drifts across the lines.
- **Optics sell the scale.** A depth-of-field pass (focus, aperture, max blur)
  whose focus value is *animated*: it re-focuses with eased tweens (random
  duration 0.5–3.5 s, power2 in-out) so the picture breathes. A vignette
  overlay (its own quad, drawn without the blur) fades in over 3 s with a
  decelerating curve on load. Bloom is present and off.
- **Camera.** Several named views; moving between them is a 1.25 s in-out tween
  of position, rotation and focus. A **parallax** nudges the camera toward the
  pointer: target set from the pointer position, the eased value following it
  at 4 per second (exponential, on elapsed time), applied as a translation.
- **Sound.** None. **Intro.** The overlay fade (0.4 s delay, 3 s).
- **Budget.** A 1000×1000-subdivision plane is a million vertices, and the
  depth-of-field pass re-renders the scene with a depth material (a second
  pass over the same million vertices). No model or texture assets: 0.79 MB in six
  requests. A multisample render target always (not conditional on DPR).
- **What it avoids.** Lit terrain (the tell of a tutorial heightmap), flat
  colour, a hard edge: the sides of the plane fade to transparent.

### 3.5 Infinite World

A walkable endless green landscape under a sky that runs through a day and
night cycle in 15 seconds, with a small capsule character.

- **Lighting: per-vertex, three terms.** Terrain colour is computed in the
  vertex shader from a flat grass colour (darkened by slope and by closeness
  to the grass patch, so the ground meets the blades), a sun-shade term from
  the normal against the sun direction, a fresnel-weighted sun *reflection*
  term, and fog. The fragment shader is one varying written out.
- **The sky is the fog.** The sky sphere is drawn at **a tenth of the
  screen's resolution** into a render target and that texture is both the
  background and the thing the fog samples *at the pixel's own screen
  position*: a distant hill fades into exactly the sky behind it, at any time
  of day, so the horizon never seams. The sky itself is an interpolation
  between low/high colours for day and night, plus an additive dawn band
  where the sun is, an additive sun disc and a glow term.
- **Coloured shade, and a day cycle.** A 15 s cycle moves the sun, and the
  sky's colours (day low and high, night low and high, sun, dawn) blend by
  its progress. Terrain shade is not "darker": it multiplies the base by a
  cool teal, so shadowed ground goes bluer, never grey. (A four-stop terrain
  gradient class exists in the repo but the terrain shader's colours are fixed
  in the shader; I did not trace its use.)
- **LOD and workers.** The world is a tree of chunks that split when the
  player is near (min size 64, max depth 4, split ratio 1.3); each chunk's
  geometry is computed in a **Web Worker** (simplex noise, with fewer noise
  iterations for far chunks) with skirts so neighbours of different detail do
  not crack. Grass is one 40,000-blade (200×200) patch placed at the player.
- **Sound, intro.** None, none.
- **Budget.** No post-processing at all; no tone mapping (colours are
  authored directly); object sorting disabled; DPR capped at 2. Everything
  is vertex-side; 0.69 MB in four requests with no assets.
- **What it avoids.** A skybox image, a fog colour that is a guess, a camera
  cut when chunks load, per-pixel lighting on terrain.

### 3.6 The Awwwards 2022 workshop black hole

The subject of §6. In short: about 350 lines in one file, 427 KB with three.js,
three small meshes and a screen-space lens. Studied here only as a quality
reference (it is the roughest of the six; what it shows is how far a cheap
trick goes).

- **What it does well:** a hot white-to-violet ramp on a streaked ring against a
  dark purple (`#130e16`, never black); a lens warp that produces the arch over
  and the echo under the hole; pastel stars with a long-tail glow; a colour
  split that grows toward the edges and grain scaled by brightness; a handheld
  camera drift.
- **What it lacks (and the bar names):** its scene target has no
  multisampling, so edges alias (visible on the disc's rim in the frames); there
  is no tone curve, so the hot streaks clip to flat white plateaus; the grain is
  a hash at full strength (the deployed build uses 1.0 where the copy I read has
  0.5);
  and no intro. Each of those is a line of the bar (§5), and each is something
  the second mode must do better than its source.

## 4. Across the six

| | Volcano | Room | Sphere | Terrain | World | Workshop |
| --- | --- | --- | --- | --- | --- | --- |
| Lighting | real-time: 1 spot (4096² shadow) + 1 point | baked ×3 + light-map accents | two lights × fresnel, per vertex | none: elevation lookup | per vertex: shade + fresnel reflection | emissive ramp, no lights |
| Tone / grade | Cineon + presets | graded in the bake | hand-set colours, violet-tinted bloom | ramp + vignette overlay | authored colours, coloured shade | raw ramp (the gap) |
| Post | jitter + colour split (edge-weighted), bloom off | none | tinted bloom | depth of field + overlay | none | colour split + grain; lens warp |
| Depth cue | fog to black, soft shadow | baked occlusion, isometric | rim only | depth of field, fading sides | sky-matched fog, LOD | stars far, disc, lens |
| Noise / detail | none (a model) | steam only | 4D noise on noise | 2 octaves + hue noise | worker simplex, LOD iterations | 4 periodic octaves, baked once |
| Motion easing | per-joint exponential | spherical damping + limits | attack/release | tweens + parallax at 4/s | player-driven | damped orbit + shake |
| Intro | 9 s title card | none | none | 3 s overlay fade | none | none |
| Sound | none | none | optional mic input | none | none | none |
| Load | 6.7 MB | 15 MB | small | 0.8 MB | 0.7 MB | 0.43 MB |
| Cost shape | shadow map | memory | vertices | vertices ×2 | vertices + workers | fill + 10k sprites |

**What cheap work does that none of them does.** Pure `#000` ground (every one
uses a tinted near-black); one light from everywhere; a skybox or fixed fog
colour that does not match what is behind it; linear or fixed-step motion
(every reference eases by elapsed time, and the volcano and sphere vary the rate
by direction or joint); bloom or grain on everything (each applies it to light
or to the edge, and two ship with bloom present but off); a single noise octave; a
camera that can reach a bad view (the room's hard limits); a texture where a
formula would do and the reverse (procedural where soft, baked where
expensive); a visible pop (the intro covers the load; the room orders its
assets so the picture comes first and the videos last).

**Frame budget and tricks, as a list of what they are** (and where the bar
asks for the same): pixel ratio capped at 2 (all six); a multisample render
target (four use one: three only below DPR 2, the terrain always); bake the soft, expensive light (room);
draw a soft thing small and sample it (the world's sky at 10%); precompute a
noise tile once and sample it (workshop); do geometry work in workers and by
distance (world); instance or reuse a single patch (grass); put the cost in
vertices when the fragment is trivial (sphere, terrain, world); keep an expensive
effect present but off by default, a preset (bloom, in the volcano and the
terrain). All six run a continuous animation-frame loop and none renders on
demand; I did not check whether any pauses when hidden (kb's scene contract
already requires that a hidden scene draws nothing).

## 5. The bar, and where it lives

The criteria are nodes under "Backdrop framework"; the document is generated
(`kb docs materialize`). Rule 1 applies: a concept lives in one criterion, so
**six existing criteria were amended and four were added**, not mirrored.

| Item of the bar | Where | Why that home | Evidence (§3) |
| --- | --- | --- | --- |
| Hold it beside the nearest reference | amended: Premium, like a game's title screen | the headline criterion already says "set beside" something | all six |
| Three layers that shift by different amounts | amended: Objects above the backdrop (`target`) | the two-layer rule lives there | volcano (fog, spot, ground), world (sky, terrain, grass), terrain (blur, overlay) |
| No aliasing at DPR 1 and 2, including offscreen targets | amended: Sharpness | it already judges 2x crops | four use a multisample target (three only below DPR 2); the workshop's missing one is the visible flaw |
| Intro under 3 s, first frame already composed, nothing pops in | amended: No load flicker | load behaviour is judged there, with `backdrop-load.e2e.ts` | volcano's card over the load; room's asset order |
| Eased by damping on elapsed time; idle from unrelated frequencies | amended: Motion | "eases with no visible steps" is there | volcano, room, terrain (4/s), workshop's shake |
| Only what changes is drawn; list the passes | amended: GPU budget | it holds the measure; this adds the means | room (bake), world (10% sky), workshop (noise once) |
| Palette, tone curve, restrained finish | **new: Graded and finished** | no criterion owns colour grading | volcano (Cineon, edge jitter), sphere (violet bloom), terrain overlay |
| Lit from a named key with a rim, baked or live | **new: Lit with intent** | "rim or back light" is a means of layering, not a lighting rule | sphere (fresnel-gated), volcano (one spot), room (baked) |
| Three scales; two octaves; no tile repeat | **new: Detail at several scales** | none owns procedural detail | sphere (noise on noise), terrain (2 octaves), workshop (4) |
| Pointer moves a physical thing, bounded, settles in 3 s | **new: Believable interaction** | "a reaction to a page event" is in Motion, the pointer is not | room (limits), terrain (parallax), volcano (per-joint) |

Three things the owner's earlier feedback, recorded there, already settles and
the bar does not touch: *premium title-screen feel*, *objects above the
backdrop*, *width-agnostic*, *no load flicker* (the bar only tightens it).

**Two things worth the owner's eye.**

1. **Sound and audio-reactivity are not in the bar.** None of the six uses
   sound; one reads the microphone, optionally. A page-head backdrop that
   asks for a microphone is a permission prompt on a notes app, so it is left
   out. kb's own reactions (writes, arrivals, typing) are the equivalent input,
   and the framework already has them.
2. **The intro length.** The volcano's title card is 9 s and the owner likes
   that robot. A backdrop is behind a page, not the page, so the bar is 3 s to
   a settled composition; a longer title sequence belongs to a *theme's*
   splash, if kb ever has one. Say if the owner wants a different number.

**Which checks are mechanical.** Four items can be scripts, not a reviewer's
read: the same trajectory at two frame steps (the scene contract can drive
`frame(dt)`), the pointer track settling, the ground's darkest pixels and
clipped-white share on a screenshot, and the intro length in
`backdrop-load.e2e.ts`. None exists yet, so they are one gap (§8) rather than a
claim.

## 6. The workshop black hole: notes for the builder

This section is written so a builder can make the second mode from it. It
describes the technique in words, gives the *shape* of the numbers, and does
**not** give the source's code. §2 says why: the source is unlicensed, so the
mode is **written fresh in TSL, tuned to kb's palette and compared to the
reference by eye**, not transcribed. Treat every number below as a starting
range to re-tune, not a value to copy. The reference frames are in the thread
storage (`bar/awwwards-t06.jpg`); the deployed page is at
<https://awwwards-2022-workshop.vercel.app>.

### 6.1 Licence and attribution (for this section's reader)

- Not MIT; unlicensed; see §2. Re-create, do not port.
- Do not copy the GLSL, the file layout, the variable names, or the exact
  ramp stops as a set. Build the ramp from kb's own `blackbody` helper
  (`packages/extension/backdrops-ui/src/gpu/noise.ts`) with a tail toward the
  page's accent, so the colours are kb's.
- Put one line in the scene file's header comment crediting the idea: *"the
  lens-warp black hole after the demo in Bruno Simon's Awwwards 2022
  workshop; code written for kb."* Not required; courteous; accurate.
- If the owner wants a literal port, only the author can grant it.

### 6.2 What the picture is, and how it is built

The deployed scene is three things drawn into one colour target and a fourth
thing, a lens, applied when that target is shown:

1. **Stars: 10,000 points** on a sphere of radius 400 round the camera (far
   plane 500). Each has a size drawn uniformly from 0.5 to 30 pixels (a point
   sprite, so the size is in screen pixels, not perspective), and a random hue
   at 80–100% lightness: pale pastels, almost white. The fragment shader
   draws a glow whose opacity is *inversely proportional to distance from the
   sprite's centre* (a tiny bright core and a long soft tail), multiplied by a
   linear taper so it reaches zero at the sprite's edge. Blending is ordinary
   alpha, not additive.
2. **The accretion disc: one flat ring**, an open-ended cylinder of height 0 at
   the origin, radius 1.5 at its inner edge to 6 at its outer, 64 segments
   round and 8 across (about a thousand triangles), double-sided and
   transparent. Its texture coordinate runs around the ring (`u`) and from the
   outer edge at 0 to the inner edge at 1 (`v`). The fragment shader:
   - samples a baked four-channel noise texture four times, scrolling each
     sample's coordinate down and across at a different speed (about 0.04 to
     0.1 texture-widths per second, slowest in the fourth), and takes the
     *length* of the four values as one "turbulence" number (roughly 0 to 1–2);
   - shapes a radial **falloff**: 1 over the body, ramping to 0 at the outer
     edge over the outer 40% and at the inner edge over the inner 5%, and
     smoothed;
   - **warps the ramp coordinate**: `v' = (v + 0.4 × turbulence) × falloff`;
   - reads the colour from a one-pixel-wide, 128-pixel-high gradient at `v'`:
     white-hot at the top of the range (the inner edge), then pale amber,
     orange, hot red-pink, and violet for the outer range;
   - sets the **opacity to `v'`** too: the more it is pushed toward white, the
     more opaque, so the faint outer gas is nearly clear and the hot streaks
     are solid, and both edges fade to nothing.

   Because the one noise tile is mapped over the whole circle in `u` and
   only over the short span from inner to outer in `v`, its cells are drawn
   long and thin around the ring: that stretching *is* the look of streaming
   gas. The four scroll speeds differ so inner and outer bands slide past
   each other (differential rotation).
3. **The noise tile**, drawn once at start-up into a 256×256 floating-point
   target (four channels): four octaves of *periodic* gradient noise at 5, 10,
   20 and 40 cells across the tile (one octave per channel), periodic so the
   texture wraps with no seam at the ring's `u = 0/1` join. Nothing
   recomputes it afterwards.
4. **A second, tiny scene for the lens**, drawn each frame into a
   *single-channel* target cleared to 0:
   - a square quad (4 units) that **faces the camera**, whose value is 1 inside
     a radius of 0.8 units, 0 beyond 2.0, smoothly between (a smoothstep over
     the radial distance), and
   - a flat 12-unit quad lying **in the disc's plane**, with the same profile
     (1 within 0.8 units, 0 by 2.0), faded to nothing toward its own edge.

   The value is a **pull strength**.
5. **The composite** (a full-screen quad) reads the pull strength at each
   pixel, projects the hole's world centre to the screen, and looks the colour
   target up at `uv + (holeScreenUV − uv) × strength`: *each pixel shows what
   is nearer the hole than it is.* Where strength is 1 the lookup lands on the
   hole's own point, which is empty space, so a clean black disc appears
   without drawing one: **the event horizon is a collapsed lookup, not
   geometry.** Where it is partial the picture is stretched toward the hole.
   Then:
   - **colour split**: red, green and blue are each looked up displaced a
     little along three directions 120° apart, by an amount (up to 2% of the
     frame) that grows with distance from the centre by a smoothstep from 0.3
     to 0.7 in screen-unit coordinates (the corners lie at about 0.7): clean in
     the middle, split at the edges;
   - **grain**: a hash of the pixel and the time, centred on zero, **scaled by
     the pixel's luminance** and added (strength 1.0 in the deployed build, 0.5
     in the attendee copy I read): dark regions stay clean and the hot disc
     speckles.

   The stars sit in the colour target, so they too are pulled toward the hole:
   the lens bends the sky as well as the disc, with no ray tracing.

### 6.3 Why it reads as a black hole (the effect to match)

The camera sits almost level with the disc (about 0.8 units above it at
distance 10, so about 4.6° elevation), field of view 35°, looking at the hole,
with a constant roll of about 0.2 rad (11.5°) applied after the orbit
controls' own update. Seen edge-on, the disc is a thin line crossing the
hole. The pull then does the work: pixels above and below the hole look up
points nearer to it, which is the *same* bright line, so the line appears
**bent over the top as an arch** and **echoed below as a smaller lobe**: the
two images lensing really produces, from one lookup. The flat quad in the
disc's plane makes the pull stronger along the disc than across it. The
screen shows a ring whose far side wraps over the shadow and whose near side
crosses its lower part.

The camera also **drifts**: the camera group's position is offset on each axis
by `0.1 × sin(a·t) × sin(b·t) × sin(c·t)` with `t` = 0.2 × elapsed seconds and
three unrelated frequency triples (never repeating, never settling): a slow
handheld wander of about 1% of the camera distance. This is the idle motion
the bar's "unrelated frequencies" asks for.

### 6.4 How it differs from kb's current black hole

kb's black hole is [`backdrops-ui/src/black-hole/`](../../packages/extension/backdrops-ui/src/black-hole/black-hole-scene.ts) (Gargantua).

| | kb's current (Gargantua) | The workshop's |
| --- | --- | --- |
| Light bending | each pixel integrates a null geodesic of the Schwarzschild metric (up to 300 steps) | none: a screen-space *pull toward a point*, with a hand-made radial profile |
| Disc | a *thick* volumetric slab of gas, sampled through its thickness, composited front to back with emission and absorption | a *flat* sheet, one ramp lookup per pixel; opacity from the same number as the colour |
| Photon ring | yes, from rays winding round | no; none is needed for the look |
| Doppler and redshift | beaming (brighter where it comes toward us), redshift near the hole, blackbody colour | none: colour is a ramp and is symmetric |
| Stars | seeded, lensed physically | 10,000 pastel point sprites, lensed by the same pull |
| Cost shape | per-pixel march, offscreen at 1–1.5 texels per CSS pixel, with a jittered sample and a history blend | about five draw calls and a few texture reads a pixel; a fill-rate cost only |
| Interaction | pointer dollies the camera slowly; writes dim and breathe the disc; a write sets an orbiting flare | orbit controls (drag/zoom with damping) plus constant shake; nothing reacts to the page |
| Light page | an "eclipse by day" look | none: the ground is `#130e16` |
| Look | thick, filamentary, physically asymmetric, restrained | thin, razor-bright streaks, vivid white-to-violet, strong colour split and grain |

The two are different *techniques* with different strengths: the second has a
graphic punch and a tiny cost; the first has physical plausibility. That is why
it is worth a second mode rather than a tweak of the first.

### 6.5 The mode in kb: where it plugs in (a new backdrop, not a flag)

"A second mode" is, in kb's model, **a second backdrop option with its own
scene module** (every GPU backdrop is one; there is no "mode" concept and
Rule 1 forbids adding a boolean that forks `blackHole()`). The wiring,
already in the repository:

1. **Declare it:** a `SeedBackdrop` in
   `packages/extension/backdrops/src/extension.ts` (the id and label, listed in
   `declaredOptions`), exported from its `index.ts`. Suggested id
   `backdrops.black-hole-warp`, label "Black hole (warp)"; the gallery card
   and the seed's option node come from the declaration.
2. **Contribute it:** in `backdrops-ui/src/plugin.ts`, a `Backdrop` using the
   existing `gpuFrame` presentation, `ctx.contribute(BackdropPoint,
   provideBackdrop(…))`, a component in `gpu/backdrops.tsx`
   (`<GpuBackdropHost scene="blackHoleWarp" …>`), and a `SCENES` entry in
   `gpu/gpu-backdrop.tsx` (a lazy `mountBlackHoleWarp`).
3. **The scene:** a new folder `backdrops-ui/src/black-hole-warp/` with a
   `mountBlackHoleWarp(host, init)` built on `mountBackdrop` (the shape of
   `black-hole-scene.ts`: `BackdropParts` with `panel`/`wide` compositions,
   `layout`, `setLook`, `frame`, `dispose`).
4. **Tests:** add it to the `mounts` map in
   `gpu/gpu-scenes.contract.test.ts` (dark and light, hidden draws nothing),
   confirm `backdrop-load.e2e.ts` and `backdrop-width.e2e.ts` pick it up, and
   score it against every criterion in `docs/backdrops.md` in the PR.
5. **Restructure, then add: two commits.** The current scene's pointer-to-
   camera follow (`FOLLOW`, the `aim` selection, `1 − exp(−dt·FOLLOW)`), its
   flare logic (`FLARE_REST`, the phase draw) and the hole's layout mapping
   (`u.center`, `u.focal` from the anchor) will be needed again. Move them
   into one shared unit first (behaviour-preserving, proven by the existing
   contract tests), then add the new scene on top. Do not copy them: that is
   the second path Rule 1 names.

### 6.6 The scene, in TSL, without render targets of its own

kb's stack is three/webgpu with TSL, not GLSL and a scene graph. The
available pieces (read in `packages/kit/scene-gpu/src/` and
`backdrops-ui/src/gpu/`):

- `offscreenPass(renderer, fragment, { history })`: a fragment drawn on one
  quad at its own resolution, sampled by `picture(uv)`. The existing hole uses
  it. The new mode needs **no history** (nothing jitters, so nothing needs
  averaging).
- `mountBackdrop(host, init, { bloom, lens: { aberration, streak, grain } }, parts)`:
  the stage's **lens already does the workshop's final pass**: chromatic
  aberration that grows toward the edges, grain that spares the page's own
  ground, and an edge fade. **Use it; do not write a second one.** The
  workshop's 2% split and full-strength grain are too strong for kb: start at
  `aberration` ~0.01 and `grain` ~0.03, the values the current hole uses.
- `shoulder` (`tone.ts`): the stage's tone curve (identity to a knee at 0.8,
  smooth roll-off above), so the hot streaks roll off instead of clipping: the
  workshop's gap, closed by the stage.
- `pnoise(p, per)` (periodic gradient noise), `fbm4`, `hash`, `blackbody`
  (`gpu/noise.ts`).
- `starfield` (`scene-gpu/starfield.ts`): instanced sprites on a sphere,
  seeded; faint and still by design, so the workshop's bright, large,
  long-tailed pastel stars need either parameters it does not have or a small
  procedural layer in the shader (below).

**Recommended shape: one fragment, analytic.** Instead of a scene graph and
two targets, evaluate the same picture per pixel in a single `offscreenPass`:

1. **Camera model.** A pinhole camera at distance ≈ 10 from the hole, at about
   4–5° above the disc plane, vertical field of view about 35°, with a roll of
   about 0.2 rad, sized from the frame's *height* and placed by the anchor
   (as the current `u.focal`/`u.center` do, so it is width-agnostic). Per
   pixel, build the ray.
2. **The pull, analytically.** The two quads become two functions of the
   ray: the *billboard* term is the distance from the hole measured across the
   view (its radius profile: 1 inside about 0.8 units, 0 beyond about 2, a
   smoothstep between), and the *plane* term is the distance from the hole of
   where the ray meets the disc's plane (same profile; zero when the ray misses
   the plane). Start with `max` of the two and compare to the reference frame:
   the original lets the nearer surface win, which only changes the far half
   of the plane term, behind the billboard, so the difference should be small
   (unv.: confirm by eye).
3. **Look up the scene at the pulled point,** `uv' = uv + (hole − uv) × pull`,
   where "scene" is now a function: build the ray through `uv'`, then
   - **disc:** intersect the plane; if inside the ring (radius 1.5–6), take
     `u = angle/2π`, `v` from the radius (1 at the inner edge), sample the
     four-octave noise with the four time-scrolled offsets, form the
     turbulence, the falloff, the warped ramp coordinate and the opacity as
     described in §6.2;
   - **stars:** a procedural layer: hash a cell grid over the ray's direction,
     one star per cell at a random place, a pastel colour, a size spread across
     two orders of magnitude, the inverse-distance glow with its taper. Because
     the lookup is at `uv'`, the stars are lensed for free;
   - blend disc over stars over ground with `groundsOf(stage)` (see 6.8).
4. **Noise cost.** Start with live `pnoise` at periods 5/10/20/40 on the disc's
   pixels only (the ring covers a minority of the frame). If the measured cost
   is high, bake the four octaves **once** into a 256² texture at mount (the
   workshop's own trick; the bar names it) and sample it with repeat wrapping:
   verify that the offscreen picture's sampler wraps (unv.), else keep the live
   noise.
5. **Resolution.** There is no march and no history, so draw the pass at the
   frame's density (1 to 1.5 texels per CSS pixel like `holeDensity`) with the
   existing quality knob. The disc's edge is an analytic opacity ramp, so it
   does not alias; stars are the only small features, and a size floor of one
   texel keeps them from shimmering. This is the bar's "no aliasing at DPR 1
   and 2" met by construction, where the workshop's unsampled target is its
   flaw.

### 6.7 Parameters (starting ranges to re-tune, not to transcribe)

| Thing | Range to start from | Note |
| --- | --- | --- |
| Camera distance / elevation | 10 / 4–6° | near edge-on gives the arch and the echo; raise elevation to open the hole |
| Field of view | 30–40° | |
| Roll | 0.15–0.25 rad, constant | authored tilt; the existing hole uses −0.06 |
| Disc radii (inner / outer) | 1.5 / 6 of the camera's world unit | outer is wider than the frame: let it leave the frame's sides, which is also why `reach: "region"` may suit |
| Falloff | outer 40% and inner 5% of the radial span, smoothed | |
| Ramp warp | `v' = (v + 0.4 × turbulence) × falloff` | the 0.4 is the streak contrast |
| Noise octaves | 5, 10, 20, 40 cells per tile; scroll 0.04–0.1 per second, slowest for the finest | differential rotation |
| Pull profile | 1 within 0.8 units of the hole, 0 beyond 2.0 | the hole's apparent radius is the 0.8 |
| Stars | tens of thousands in the original; **a few hundred visible** in kb is enough | sizes 0.5–30 px, glow ∝ 1/d with a linear taper, pastel |
| Camera drift | amplitude ≈ 1% of distance; three axes, unrelated frequencies, time × 0.2 | idle motion, per the bar |
| Colour split / grain | the stage `lens`: aberration ≈ 0.01, grain ≈ 0.03 | the original's 2% / 1.0 is far stronger |

### 6.8 What kb needs that the workshop does not have

- **Light page.** The workshop's ground is `#130e16` on a dark page. The
  framework's "Blends into a light page" criterion applies: the current hole
  does it as an eclipse by day (high-key sky, charcoal shadow, the disc as
  amber dust). The new mode needs its own light look (suggested: the disc as
  warm ink with `v'` driving opacity, the hole as a charcoal disc, stars as
  faint dust) and must go through `groundsOf(stage).paint`, as a light page's
  picture must, or the tone curve washes it to white.
- **Reactions.** Wire the shared `Reactions`: the pointer tilts and swings the
  camera slowly (a dolly, not a cursor: the bar's "believable interaction"),
  typing dims the disc and writes breathe into it (raise `0.4 × turbulence`
  and the ramp's brightness a little, eased with the framework's attack and
  release), a write outside typing sets a flare orbiting the ring.
- **Seeded variation.** Draw by name through `variation(seed)`: the star
  scatter, the noise offsets, the ring's phase, a small hue shift of the
  ramp's violet tail.
- **Reduced motion.** One still frame: time and the drift frozen, the pointer
  ignored.
- **No intro, no pop:** the first frame is the composed picture; the stage's
  fade reveals it.

### 6.9 How to check it against the bar

Run the framework: `docs/backdrops.md` is the list. The ones this mode is
most likely to fail first: **Graded and finished** (the ramp must go through
the stage's curve: no plateau of flat white in the streaks; the ground a tint,
not black), **Sharpness** (the hot ring's rim and the stars at DPR 1 and 2),
**Believable interaction** (the dolly settles within 3 s, bounded), **Motion**
(the drift and the dolly are the same at 8 ms and 33 ms steps) and **Original
marks** (nothing of the source's shader text or constants as a set). A
side-by-side with `bar/awwwards-t06.jpg` at the same frame size is the
reference comparison for *Fidelity to the reference*, with the owner's words
"as close as the pic as possible" applying to the arch, the echo and the ramp,
not to the pixel noise.

## 7. Unverified

- **Frame times on a real GPU**, for all six: this host's rasteriser is
  software. §3's "budget" lines are structural.
- **The sphere's 262,000 vertices and six noise calls per vertex** are read
  from its source, not profiled.
- **The attribution of the workshop** to Bruno Simon: it is hosted under a
  `vercel.app` name without his account, its page has no credit line, and I
  found no public repository of his for it. The copies carry the workshop's
  title and match the deployed bundle's uniforms and composition shader; a
  user hosting a copy cannot be ruled out. The black-hole *technique* is what
  the owner asked for either way; the licence answer (no licence found, so
  none granted) holds for both readings.
- **Whether the offscreen picture's sampler wraps** (§6.6, point 4): not read;
  the builder decides between the baked tile and live noise by what it finds.
- **`max` of the two pull terms versus the original's depth-ordered pair**
  (§6.6, point 2): reasoned, not rendered.
- **A literal MIT port's notice requirements** are stated as the MIT text
  has them and are moot here.
- **Per-site pointer behaviour** was read from source, not exercised in the
  headless run (a scripted pointer sweep was captured for the room and the
  workshop; the screenshots were not compared pixel-wise).

## 8. Filed

- **Framework nodes** (`.kb/nodes.jsonl`; `docs/backdrops.md` regenerated):
  four new `#backdrop-criterion` nodes (Graded and finished, Lit with intent,
  Detail at several scales, Believable interaction); six existing criteria
  amended in place (Premium, Objects above the backdrop, Sharpness, No load
  flicker, Motion, GPU budget); the framework's intro names the floor; a
  paragraph "The quality floor" and six `#reference` nodes, the existing
  `reference` tag given the fields `url`, `repo`, `licence` and `learn`.
- **A `#gap`:** the bar's four mechanical checks are read by a reviewer, not
  run (§5).
- **A `#todo`:** build the warp black hole from §6.
- [DESIGN-UI.md → Page-head backdrops](../../DESIGN-UI.md#page-head-backdrops)
  no longer lists the criteria by name (the list is the document's; a second
  copy drifts) and says the floor exists.
