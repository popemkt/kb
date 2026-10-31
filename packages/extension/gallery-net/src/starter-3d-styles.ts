/**
 * The starter's 3D style facet, the largest part of its 3D vocabulary
 * (`./starter-3d.ts` says where it comes from and how it was curated).
 */
import type { StyleSeed } from "./starter.ts";

/** The 3D style facet: a whole look, made with the techniques it names. */
export const STYLES_3D: readonly StyleSeed[] = [
  {
    name: "cel-shaded",
    description:
      "Lighting collapses into 2-3 hard-edged bands (lit, shadow, optional deep shadow) with flat colour inside each band, a small hard specular dot or none, and a uniform dark outline around silhouettes and inner creases. Palette is saturated and simple; textures are minimal flat colour.",
    prompt:
      "{prompt}, cel-shaded 3D render, two-tone hard shadow bands, bold uniform black outlines, flat saturated colours, small hard highlight, clean simple textures",
    negative:
      "photorealistic, soft gradients, noisy texture, film grain, blurry, realistic skin pores",
    madeWith: ["toon ramp", "inverted hull outline", "cel specular", "fresnel rim", "flat shading"],
    seenIn: ["The Legend of Zelda: The Wind Waker", "Jet Set Radio", "Borderlands", "Hi-Fi Rush"],
    howTo: [
      "Three.js: MeshToonMaterial with a gradientMap (a 2-4 pixel DataTexture, minFilter and magFilter set to NearestFilter) gives the bands. For outlines use OutlineEffect (WebGLRenderer only) or add a back-face-culled, normal-extruded second mesh (inverted hull); on WebGPURenderer the docs point to ToonOutlinePassNode instead. A hard specular dot needs onBeforeCompile or TSL (step on the half vector).",
      "Blender: EEVEE: Diffuse BSDF -> Shader to RGB -> Color Ramp (Constant interpolation) -> Emission/Material Output; outline with a Solidify modifier (Flip Normals on, second material with Backface Culling) or Freestyle. Shader to RGB is EEVEE-only and breaks PBR effects like SSR and SSS.",
    ],
  },
  {
    name: "3D anime",
    description:
      "Character-style cel shading pushed to illustration quality: soft-edged but crisp two-layer shadow (a second, tinted outer shadow band), tinted shadow colours instead of black, face-shadow control, thin variable-width outlines that are darker versions of the local colour, rim light, and bloomy highlights. Hand-drawn texture detail is high and materials are mostly flat.",
    prompt:
      "{prompt}, 3D anime style render, soft two-layer cel shadows with tinted colour shadows, thin coloured outlines, rim light, bloom on highlights, hand-painted detail, clean illustration finish",
    negative: "photorealistic, harsh black shadows, low-poly, flat grey, noisy, muddy colours",
    madeWith: [
      "toon ramp",
      "inverted hull outline",
      "fresnel rim",
      "bloom",
      "colour grading LUT",
      "hand-painted texture",
    ],
    seenIn: ["Genshin Impact", "Guilty Gear Strive", "Dragon Ball FighterZ", "Hi-Fi Rush"],
    howTo: [
      "Three.js: Custom ShaderMaterial/onBeforeCompile (or TSL): N.L through a smoothstep with a threshold near 0.1, a second offset N.L layer for the tinted outer shadow, Fresnel rim, and an inverted-hull outline whose width is baked into vertex colours. Add EffectComposer with UnrealBloomPass and a LUTPass for grading. Buildings suit this better with a ramp texture per material than per-character light-map tricks.",
      "Blender: EEVEE: Shader to RGB + Color Ramp with a soft transition, second ramp on a biased normal for the outer shadow, Fresnel/Layer Weight for rim; outline via Solidify inverted hull with vertex-group thickness or Line Art. A community EEVEE node group imitating Genshin character shading exists (see source).",
    ],
  },
  {
    name: "painterly 3D",
    description:
      "The render reads as brushwork: colour regions are smoothed into visible dabs, edges are softened or broken, fine texture detail is removed, and shadows carry colour shifts (warm lights, cool shadows). Silhouettes stay readable while interiors look oil- or gouache-painted.",
    prompt:
      "{prompt}, painterly 3D render, visible brush strokes, oil paint texture, smoothed colour regions, warm light and cool shadows, soft broken edges, canvas texture",
    negative: "photorealistic, sharp CG, noisy, plastic, hard outlines, pixelated",
    madeWith: [
      "Kuwahara filter",
      "hand-painted texture",
      "paper texture overlay",
      "colour grading LUT",
      "baked lighting",
    ],
    seenIn: [
      "Monet-style Impressionist paintings (historical)",
      "Dishonored",
      "Ni no Kuni",
      "Child of Light",
    ],
    howTo: [
      "Three.js: Render to a target and run a (anisotropic) Kuwahara filter as a custom ShaderPass or TSL node; three.js has no built-in Kuwahara pass. Add a paper/canvas overlay texture and a LUTPass; keep the underlying materials simple (MeshLambertMaterial or hand-painted maps).",
      "Blender: Compositor Kuwahara node (anisotropic variant, tune Size/Uniformity/Sharpness/Eccentricity; downscale then upscale for speed) over an EEVEE or Cycles render with hand-painted textures; Grease Pencil strokes can add brushy accents.",
    ],
  },
  {
    name: "low-poly",
    description:
      "Deliberately few, large triangular facets, each shaded as a single flat colour, hard faceted silhouettes, no or tiny textures, simple saturated or pastel palette, soft ambient lighting with faint gradient sky.",
    prompt:
      "{prompt}, low-poly 3D render, flat-shaded triangular facets, minimal geometry, solid pastel colours, no textures, soft gradient sky, clean simple lighting",
    negative: "photorealistic, high detail, smooth shading, textures, noisy, bump map, subdivision",
    madeWith: [
      "flat shading",
      "vertex colour",
      "gradient sky",
      "baked lighting",
      "normal-based shading",
    ],
    seenIn: ["Monument Valley", "Superhot", "Kenney asset packs", "Proteus"],
    howTo: [
      "Three.js: MeshStandardMaterial or MeshLambertMaterial with flatShading: true (or toNonIndexed() geometry so each face gets its own normal), vertexColors: true for per-face colour, simple HemisphereLight plus one DirectionalLight. Keep instances via InstancedMesh for repeated roof tiles.",
      "Blender: Decimate (Planar or Collapse) or hand-model with few edges; Shade Flat; colours via a Color Attribute (vertex colour) node into Principled BSDF or Emission; EEVEE with one sun and world gradient.",
    ],
  },
  {
    name: "voxel",
    description:
      "Everything is built from equal-size cubes on a visible grid; edges are axis-aligned and stair-stepped, colour per cube (palette-limited), simple shading with soft ambient occlusion in the creases between cubes.",
    prompt:
      "{prompt}, voxel art 3D render, built from uniform cubes, stair-stepped edges, limited colour palette, soft ambient occlusion between blocks, clean lighting",
    negative: "smooth surfaces, photorealistic, curved, high-poly, noisy, outlines",
    madeWith: ["vertex colour", "flat shading", "screen-space ambient occlusion", "baked lighting"],
    seenIn: ["Minecraft", "Teardown", "Crossy Road", "Cube World"],
    howTo: [
      "Three.js: One InstancedMesh of BoxGeometry with per-instance colour (setColorAt) is simplest; for large scenes build a single merged mesh with greedy meshing and vertex colours. Add GTAOPass or SSAOPass, or bake AO per vertex, for the block-crease darkening. Voxelising an existing mesh is possible (Codrops tutorial).",
      "Blender: Remesh modifier in Blocks mode, or Geometry Nodes (Mesh to Volume -> Volume to Mesh, or Distribute Points in Volume + Instance on Points with a cube); MagicaVoxel importer add-ons exist. Render with EEVEE and AO, or Cycles for baked-look lighting.",
    ],
  },
  {
    name: "claymation",
    description:
      "Matte plasticine surface with soft rounded forms, visible thumbprint and tool-mark bumps, slightly uneven proportions, saturated single-colour parts, soft studio lighting with shallow depth of field. A touch of subsurface softness at thin edges.",
    prompt:
      "{prompt}, claymation style 3D render, plasticine clay surface, soft rounded forms, visible fingerprints and tool marks, matte, soft studio light, shallow depth of field",
    negative: "glossy, sharp edges, photorealistic, metal, low-poly, outlines, noisy",
    madeWith: [
      "physically based shading",
      "subsurface scattering",
      "screen-space ambient occlusion",
      "shallow depth of field",
      "hand-painted texture",
    ],
    seenIn: ["Wallace & Gromit", "Chicken Run", "Coraline", "The Neverhood"],
    howTo: [
      "Three.js: MeshPhysicalMaterial with high roughness (~0.8), a tiling noise bump/normal map with fingerprint-like detail, optional sheen; fake subsurface softness with a hemisphere light and wrap lighting via onBeforeCompile. Add GTAOPass and BokehPass for the macro look; round forms by beveling geometry.",
      "Blender: Cycles or EEVEE: Principled BSDF with roughness ~0.7 and low Subsurface Weight, Noise/Musgrave texture and a fingerprint bump map via Bump node, Displace/Sculpt for wobble; camera Depth of Field with a macro focus distance.",
    ],
  },
  {
    name: "clay render",
    description:
      "Every object uses the same neutral matte grey/beige diffuse material so only form, light and ambient occlusion remain; soft shadows, no textures, no colour. Used to show modelling quality.",
    prompt:
      "{prompt}, clay render, uniform matte grey material, soft global illumination, ambient occlusion shadows, no textures, studio lighting, high detail sculpt",
    negative: "colour, textures, glossy, photo, background clutter, outlines",
    madeWith: [
      "physically based shading",
      "screen-space ambient occlusion",
      "baked lighting",
      "normal-based shading",
    ],
    seenIn: [
      "ZBrush and Blender model showcase turntables",
      "ArtStation clay-render breakdowns",
      "Architectural massing study renders",
    ],
    howTo: [
      "Three.js: Use scene.overrideMaterial = new MeshStandardMaterial({color: 0xcfcac2, roughness: 0.9}) or swap materials, plus RoomEnvironment or a soft HDR, GTAOPass for contact shadows, and PCFSoftShadowMap. Alternatively MeshMatcapMaterial with a grey clay matcap (no lights needed).",
      "Blender: Workbench with Studio lighting, Single colour, Cavity and Ambient Occlusion options for a quick clay, or Cycles with a View Layer Material Override of a grey Diffuse for a true clay render.",
    ],
  },
  {
    name: "white model",
    description:
      "Architectural massing look: all surfaces plain white or off-white, no textures, thin dark line edges where planes meet, soft shadows and ambient occlusion, often a neutral light-grey ground. Reads as a physical foam or card model; detail is shown only through geometry.",
    prompt:
      "{prompt}, white architectural model, pure white matte surfaces, no textures, thin dark line edges, soft shadows, ambient occlusion, neutral light grey ground, clean studio light",
    negative: "colour, textures, wood, photorealistic materials, dirt, noisy, people, glossy",
    madeWith: [
      "edge-detection outline",
      "screen-space ambient occlusion",
      "baked lighting",
      "physically based shading",
      "volumetric fog",
      "hemisphere ambient light",
    ],
    seenIn: ["Architectural foam-core massing models", "Mirror's Edge"],
    howTo: [
      "Three.js: MeshStandardMaterial white, roughness ~0.95, shadows on a DirectionalLight, GTAOPass; crisp edges with EdgesGeometry rendered as LineSegments (or LineSegments2 from addons/lines for thickness) on a creaseAngle threshold. Optionally OutlinePass for hover/selection.",
      "Blender: Workbench with Studio light, Cavity, Outline on; or Cycles with white diffuse override, AO, and Freestyle edge lines (Crease angle) for the drafted line work.",
    ],
  },
  {
    name: "CAD render",
    description:
      "Engineering drawing look: flat-ish shaded parts in muted grey/blue, crisp dark edge lines on all feature edges, thin hidden-line dashes optionally, orthographic projection, labelled sections. Little ambient occlusion, no texture, matcap-like gradients.",
    prompt:
      "{prompt}, technical CAD render, orthographic view, crisp dark feature edge lines, flat grey-blue shaded surfaces, no textures, section lines, clean neutral background",
    negative: "photorealistic, perspective distortion, colourful, painterly, noise, texture, blur",
    madeWith: [
      "edge-detection outline",
      "matcap",
      "flat shading",
      "wireframe",
      "normal-based shading",
      "orthographic",
    ],
    seenIn: ["Technical cut-away illustrations", "Engineering CAD viewport renders"],
    howTo: [
      "Three.js: OrthographicCamera, MeshMatcapMaterial or MeshNormalMaterial for the part shading, EdgesGeometry + LineSegments for feature edges; clipping planes (material.clippingPlanes) for section cuts. Hidden lines need a second pass with depthFunc: GreaterDepth and a dashed LineDashedMaterial.",
      "Blender: Workbench with Matcap or Flat lighting and Outline; Freestyle for feature-edge lines (Silhouette, Crease, Border); Line Art modifier for vector-style edges; orthographic camera.",
    ],
  },
  {
    name: "blueprint",
    description:
      "White or light-cyan thin lines on a deep cyan-blue background, faint grid, no filled shading, dimension lines and hand-lettered notes; only edges and contours exist. Sometimes subtle paper or cyanotype fade at the edges.",
    prompt:
      "{prompt}, blueprint style, thin white lines on deep cyan blue background, technical drawing, grid paper, dimension lines, no shading, orthographic view",
    negative: "colour fills, photo, shadows, textures, soft gradients, 3D shading, people",
    madeWith: [
      "orthographic",
      "wireframe",
      "edge-detection outline",
      "paper texture overlay",
      "colour grading LUT",
    ],
    seenIn: [
      "Architectural blueprints and cyanotype drawings (historical)",
      "Kerbal Space Program build screens",
    ],
    howTo: [
      "Three.js: LineSegments with EdgesGeometry (or LineSegments2 for width) in white on a cyan scene.background, a grid via GridHelper or a shader grid, MeshBasicMaterial with polygonOffset for hidden-line removal. Flat colour only, no lights.",
      "Blender: Freestyle or Line Art modifier with a white line material, world colour set to blue, Holdout or Emission-white material on the fill; or Workbench Wireframe-style overlay.",
    ],
  },
  {
    name: "isometric diorama",
    description:
      "Orthographic camera at the classic ~35 degree isometric angle, a self-contained floating block or platform with a clearly cut base, uniform scale with no perspective falloff, clean lighting, miniature-scene detail and soft shadows.",
    prompt:
      "{prompt}, isometric diorama, floating platform cutaway, orthographic view, clean pastel colours, soft shadows, miniature scene, simple stylized shapes",
    negative: "perspective distortion, photorealistic, fisheye, noisy, dark, horror",
    madeWith: [
      "isometric",
      "diorama on a plinth",
      "baked lighting",
      "flat shading",
      "gradient sky",
      "screen-space ambient occlusion",
      "fresnel rim",
    ],
    seenIn: ["Monument Valley", "Hitman GO", "Townscaper", "Islanders"],
    howTo: [
      "Three.js: OrthographicCamera positioned at (d, d, d) looking at the origin (about 35.264 degrees elevation), OrbitControls with limited polar angle; low-poly meshes, lighting baked or one shadow-casting DirectionalLight, GTAOPass for depth.",
      "Blender: Orthographic camera with rotation X=54.736, Z=45; EEVEE with soft light and AO; Bake lighting into textures for export to three.js.",
    ],
  },
  {
    name: "miniature",
    description:
      "Real scenes made to look like tabletop models: strong blur gradient away from a sharp horizontal band, elevated three-quarter camera, boosted saturation and contrast, slightly toy-like proportions.",
    prompt:
      "{prompt}, tilt-shift miniature photograph look, strong blur at top and bottom, sharp horizontal band, high saturation, elevated camera angle, toy model feel",
    negative: "uniform sharpness, desaturated, flat lighting, ground-level view, noise",
    madeWith: [
      "tilt-shift",
      "shallow depth of field",
      "colour grading LUT",
      "bloom",
      "baked lighting",
    ],
    seenIn: ["Tilt-shift photography of cities", "Animal Crossing: New Horizons"],
    howTo: [
      "Three.js: Use HorizontalTiltShiftShader and VerticalTiltShiftShader as two ShaderPass entries (set the h / v uniforms to 1 / width and 1 / height, r for the focus line), or BokehPass. Use a narrow-FOV camera from above and a saturation LUT/ColorCorrection pass.",
      "Blender: Camera Depth of Field with a short focus distance and a high aperture (low f-stop) in EEVEE/Cycles, or the compositor Defocus/Bokeh Blur with a gradient mask; boost saturation in the Color Management Look.",
    ],
  },
  {
    name: "PBR realism",
    description:
      "Photographic physically based look: measured roughness/metalness textures, normal maps with real surface relief, image-based lighting, filmic tone mapping, soft shadows, optional bloom, depth of field and fog. Weathering, wear and aged materials carry most of the realism.",
    prompt:
      "{prompt}, photorealistic 3D render, physically based materials, weathered stone and wood, realistic lighting, global illumination, atmospheric haze, 8k detail",
    negative: "cartoon, illustration, flat colours, low-poly, outlines, oversaturated, plastic",
    madeWith: [
      "physically based shading",
      "screen-space ambient occlusion",
      "bloom",
      "shallow depth of field",
      "volumetric fog",
      "subsurface scattering",
    ],
    seenIn: ["Red Dead Redemption 2", "The Last of Us Part II", "Ghost of Tsushima"],
    howTo: [
      "Three.js: MeshStandardMaterial/MeshPhysicalMaterial with albedo, normal, roughness/metalness, AO maps, an HDR environment (PMREM), renderer.toneMapping = ACESFilmicToneMapping or AgXToneMapping, shadows, GTAOPass, UnrealBloomPass and fog. Wear comes from textures, so source scanned or Substance maps.",
      "Blender: Cycles with Principled BSDF, HDRI world, Filmic/AgX view transform and Denoise; EEVEE with Raytracing (4.2+) and Shadows for a faster approximation.",
    ],
  },
  {
    name: "stylized PBR",
    description:
      "Physically based lighting with simplified art: smooth painted colour maps with little micro-detail, exaggerated proportions and bevels, saturated palette, strong rim and fill light, clean readable silhouettes, optional gentle outline or bloom.",
    prompt:
      "{prompt}, stylized PBR 3D render, smooth hand-painted colour textures, simplified forms, exaggerated bevels, saturated palette, strong rim light, clean readable silhouettes",
    negative: "photorealistic grit, noisy normal maps, dull colours, low-poly flat, outlines",
    madeWith: [
      "physically based shading",
      "hand-painted texture",
      "fresnel rim",
      "bloom",
      "colour grading LUT",
      "screen-space ambient occlusion",
    ],
    seenIn: ["Overwatch", "Fortnite", "Valorant", "Sea of Thieves"],
    howTo: [
      "Three.js: MeshStandardMaterial with low-frequency painted albedo, mild normal map, roughness 0.5-0.8, HDRI plus a coloured rim DirectionalLight, GTAOPass, gentle UnrealBloomPass and LUT. Bevel edges in geometry so highlights catch.",
      "Blender: EEVEE with Principled BSDF using painted albedo and no heavy bump; add a Fresnel/Layer Weight rim into Emission; Compositor Glare (Bloom) and a Color Balance grade.",
    ],
  },
  {
    name: "hand-painted game art",
    description:
      "Textures carry the form: brushy colour variation, painted-in highlights and shadows (top-lit gradient), dark edge-wear lines, outlined shapes in the texture itself, low-poly geometry, and lighting that is either flat or unlit so painted values stay intact.",
    prompt:
      "{prompt}, hand-painted texture style, visible brush strokes, painted-in highlights and shadows, warm top light gradient, low-poly shapes, saturated fantasy palette",
    negative: "photorealistic, PBR, noise, grit, scanned texture, plastic, 8k",
    madeWith: [
      "hand-painted texture",
      "baked lighting",
      "flat shading",
      "vertex colour",
      "gradient sky",
    ],
    seenIn: ["World of Warcraft", "Guild Wars 2", "Dota 2"],
    howTo: [
      "Three.js: MeshLambertMaterial or MeshBasicMaterial with the painted map (so the paint is not fought by dynamic lights), vertex colours or an AO bake multiplied in, low-poly geometry with careful UV atlas, sRGB colourSpace on the map, mipmaps off the saturation of fine strokes.",
      "Blender: Texture Paint mode with soft round brushes or Substance/Krita, previewed in EEVEE with Emission or Diffuse; Bake (Combined/AO) for light details; keep UVs with generous padding.",
    ],
  },
  {
    name: "ink wash 3D",
    description:
      "Monochrome grey-black washes with soft bleeding gradients, calligraphic dry-brush edges, large areas of empty paper, atmospheric mist that fades distant layers into grey, and very restrained colour (one red seal or pale tint).",
    prompt:
      "{prompt}, sumi-e ink wash style 3D render, black and grey ink gradients, dry-brush edges, soft bleeding washes, misty layered depth, empty paper negative space, rice paper texture",
    negative:
      "saturated colour, glossy, photorealistic, hard CG edges, fine detail everywhere, noise",
    madeWith: [
      "Kuwahara filter",
      "paper texture overlay",
      "volumetric fog",
      "edge-detection outline",
      "normal-based shading",
    ],
    seenIn: [
      "Okami",
      "Ni no Kuni (painted backgrounds, in part)",
      "Chinese and Vietnamese ink landscape paintings (historical)",
    ],
    howTo: [
      "Three.js: Render greyscale diffuse or a depth-mapped value to a target, then custom ShaderPass: Sobel on depth/normal for brush-varied outlines, noise-driven edge breakup, depth-fade into paper colour (distance fog), and a paper normal/alpha overlay. Mist sheets with transparent planes help layer pagoda silhouettes in valleys. Needs custom shader/TSL.",
      "Blender: Freestyle with a brush-stroke line style texture and Thickness modifiers, over an EEVEE or Workbench render run through the Kuwahara and Color Ramp nodes; mist pass for atmospheric depth.",
    ],
  },
  {
    name: "woodblock print 3D",
    description:
      "Flat colour fields with no gradients, a limited palette of 4-6 hues, thick black keyline outlines drawn last, slight mis-registration between colour plates, and grainy off-white paper. For Vietnamese Dong Ho prints: folk subjects, flat bold forms, outlines in black, and a faintly shimmering shell-powder (diep) paper background.",
    prompt:
      "{prompt}, woodblock print style, flat colour fields, limited palette, bold black keyline outlines, slight colour mis-registration, textured off-white paper, folk art simplicity",
    negative: "gradients, photorealistic, 3D shading, soft shadows, glossy, noise, bloom",
    madeWith: [
      "posterize",
      "edge-detection outline",
      "paper texture overlay",
      "flat shading",
      "toon ramp",
    ],
    seenIn: [
      "Đông Hồ folk woodblock prints",
      "Hokusai and Hiroshige ukiyo-e (historical)",
      "Okami",
    ],
    howTo: [
      "Three.js: MeshBasicMaterial or a 1-step toon ramp so surfaces are flat, a posterize step in a ShaderPass to a palette, edge outline from depth/normal Sobel or inverted hull (thick), and a paper texture multiply with per-plate UV offset noise for mis-registration. Palette quantisation to a lookup texture needs custom shader.",
      "Blender: Flat Emission shading with Color Ramp (Constant) or Posterize in the compositor, Freestyle outlines with Thickness modifier, paper texture multiplied in the compositor; offset colour layers by 1-3 px for plate misregistration.",
    ],
  },
  {
    name: "lacquer (sơn mài)",
    description:
      "Deep, glossy near-black or oxblood ground that looks poured and polished; gold or silver leaf as luminous flat fields and line accents, crushed-eggshell inlay as irregular cream-white crackled fragments, and warm red, brown and amber translucent depth. Edges are smooth and softly melted, never outlined.",
    prompt:
      "{prompt}, lacquer painting style, deep black and oxblood red glossy lacquer ground, gold leaf accents, crushed eggshell inlay fragments, polished smooth depth, warm amber glow",
    negative:
      "matte, photorealistic, cartoon outlines, flat plastic, bright primary colours, noise",
    madeWith: [
      "physically based shading",
      "matcap",
      "decals",
      "hand-painted texture",
      "colour grading LUT",
      "bloom",
    ],
    seenIn: [
      "Vietnamese sơn mài lacquer paintings of the 1930s school (historical)",
      "Japanese maki-e lacquerware (historical)",
    ],
    howTo: [
      "Three.js: MeshPhysicalMaterial: dark albedo, roughness 0.15-0.35, clearcoat = 1, clearcoatRoughness = 0.05, dark moody RoomEnvironment or HDR with strip lights; gold leaf as metalness = 1 patches via a mask map with a crinkled normal map; eggshell as an irregular-shard alphaMap/decal over a bump map. Add mild UnrealBloomPass and a warm LUT.",
      "Blender: Principled BSDF with Coat Weight 1 and dark base colour; gold leaf via Metallic = 1 with a Noise or Voronoi bump; eggshell fragments from Voronoi (Distance to Edge) into a Color Ramp as mask for white, rougher patches; Cycles for the deep gloss.",
    ],
  },
  {
    name: "pixel-art 3D",
    description:
      "A real 3D scene rendered into a tiny render target and upscaled with nearest-neighbour so individual pixels are visible; palette is limited, silhouettes get 1px outlines, edges between depth and normal changes are detected, lighting is simplified and often quantised.",
    prompt:
      "{prompt}, pixel-art 3D render, low resolution upscaled with sharp pixels, limited colour palette, one-pixel outlines, dithered shadows, clean pixel clusters",
    negative: "smooth, anti-aliased, blurry, photorealistic, high resolution, gradients",
    madeWith: [
      "pixelation",
      "posterize",
      "ordered dithering",
      "edge-detection outline",
      "toon ramp",
    ],
    seenIn: [
      "Octopath Traveler (HD-2D)",
      "Dead Cells (3D-to-2D pipeline)",
      "Return of the Obra Dinn",
    ],
    howTo: [
      "Three.js: RenderPixelatedPass(pixelSize, scene, camera) from addons/postprocessing renders the scene at low res with optional normal and depth edge strength (normalEdgeStrength, depthEdgeStrength); pair with an orthographic camera and NearestFilter. Palette quantisation and dithering need a custom ShaderPass.",
      "Blender: Render at low resolution (e.g. 320x180) with Film Filter Size 0, Closest texture interpolation, compositor Pixelate or scale with nearest-neighbour, Posterize node for palette; Freestyle for 1px outlines.",
    ],
  },
  {
    name: "PS1 retro",
    description:
      "Very low polygon counts, wobbling vertices that snap to the pixel grid, textures that swim and warp across large triangles (affine mapping), tiny low-colour textures with no filtering, vertex-lit flat colour, and short draw distance with heavy fog pop-in.",
    prompt:
      "{prompt}, PS1 retro 3D render, low-poly jittering vertices, warped affine textures, 128x128 low-colour textures, vertex lighting, short fog distance, dithering",
    negative: "smooth, modern, PBR, high-poly, anti-aliased, clean textures, bloom",
    madeWith: [
      "vertex snapping",
      "affine texture mapping",
      "ordered dithering",
      "flat shading",
      "vertex colour",
      "volumetric fog",
      "pixelation",
    ],
    seenIn: ["Crash Bandicoot", "Final Fantasy VII", "Resident Evil (1996)", "Silent Hill"],
    howTo: [
      "Three.js: onBeforeCompile (or TSL) on the vertex stage: round gl_Position.xy/w to a coarse grid for vertex snapping; for affine mapping multiply uv by w in the vertex stage and divide by the interpolated w in the fragment stage, because GLSL ES 3.00 has no noperspective qualifier. Use NearestFilter textures at 128x128, a low-res render target, fog and optional dither.",
      "Blender: Not native; use a PSX shader add-on (e.g. Psx Cycles) or fake with Vertex Snap via Geometry Nodes (Set Position with rounding), Closest image interpolation, a low-res render and Posterize; remember Blender uses perspective-correct mapping so affine warp must be baked.",
    ],
  },
  {
    name: "N64 low-res",
    description:
      "Low poly with smooth Gouraud vertex lighting, blurry three-point-filtered textures (soft bilinear mush rather than crisp pixels), draw distance fog, 16-bit-feeling colours, and simple geometry with painted-on detail and little or no outline.",
    prompt:
      "{prompt}, late-1990s console 3D render, low polygon count, blurry low-res textures, smooth vertex shading, distance fog, simple painted details",
    negative: "sharp textures, high-poly, PBR, photorealistic, normal maps, bloom, outlines",
    madeWith: [
      "vertex colour",
      "volumetric fog",
      "pixelation",
      "ordered dithering",
      "baked lighting",
    ],
    seenIn: [
      "Super Mario 64",
      "The Legend of Zelda: Ocarina of Time",
      "GoldenEye 007",
      "Banjo-Kazooie",
    ],
    howTo: [
      "Three.js: MeshLambertMaterial with vertexColors and low-res textures; a custom fragment shader (onBeforeCompile/ShaderMaterial) is needed for authentic three-point texture filtering. Add scene.fog, a small render target upscaled bilinearly, and optional dithering.",
      "Blender: Principled BSDF with Linear interpolation on 64x64 textures, Vertex Colors for lighting, a Mist pass fog in the compositor, low-res render with Posterize for colour depth.",
    ],
  },
  {
    name: "vaporwave 3D",
    description:
      "Magenta, cyan and pastel purple gradients, grid floors, Greek-style marble busts and columns, chrome and glass, sunset discs, glitchy text, scan lines, and dreamy bloom. Everything is slightly retro and 80s-90s computer-render shaped.",
    prompt:
      "{prompt}, vaporwave 3D render, magenta and cyan gradient sky, glowing grid floor, pastel purple, chrome and marble, retro sunset, soft bloom, scanlines",
    negative: "natural colours, realism, dull, brown, grit, daytime sun",
    madeWith: ["gradient sky", "bloom", "colour grading LUT", "matcap", "wireframe"],
    seenIn: ["Vaporwave album art and internet art", "Hotline Miami (palette)"],
    howTo: [
      "Three.js: Gradient scene.background (CanvasTexture or shader sky), a GridHelper or shader grid floor, MeshMatcapMaterial with a chrome matcap, UnrealBloomPass, FilmPass scan lines, and a pink-cyan LUT or ColorCorrection pass.",
      "Blender: World gradient shader, emissive grid via Wave/Checker texture, Principled BSDF Metallic = 1 with low Roughness for chrome; Compositor Glare (Fog Glow) and Color Balance for the pink/cyan split.",
    ],
  },
  {
    name: "paper craft 3D",
    description:
      "Scene built of layered flat paper sheets with slightly uneven die-cut edges, visible stacked depth with soft drop shadows between layers, fibrous paper grain, folds and creases, matte pastel or screen-printed colours, optional backlight glow through thin layers.",
    prompt:
      "{prompt}, layered paper craft 3D render, cut paper sheets stacked with soft drop shadows, paper fibre texture, folded edges, matte pastel colours, shallow depth",
    negative: "glossy, photorealistic, outlines, 3D realism, metal, noise",
    madeWith: [
      "paper texture overlay",
      "baked lighting",
      "screen-space ambient occlusion",
      "flat shading",
      "decals",
    ],
    seenIn: [
      "Paper Mario: The Thousand-Year Door",
      "Tearaway",
      "Paper Mario: Color Splash",
      "LittleBigPlanet (papercraft aesthetic)",
    ],
    howTo: [
      "Three.js: Stack thin ExtrudeGeometry/ShapeGeometry layers (or planes with alphaMap) at small Z offsets with MeshStandardMaterial roughness ~1 and a paper map, a DirectionalLight with PCFSoftShadowMap shadows between layers, and GTAOPass for crevices. Backlight glow with MeshPhysicalMaterial transmission/thickness is possible.",
      "Blender: Stacked planes or thin Solidify slabs with a Principled BSDF (high roughness, Subsurface or Translucent BSDF for backlit paper), paper bump/fibre texture, area-light backlight, Cycles for soft contact shadows.",
    ],
  },
  {
    name: "vinyl toy",
    description:
      "Smooth, glossy or semi-gloss plastic with rounded bevels, bright single-colour parts, visible moulding seams and tiny parting lines, soft studio reflections, gentle subsurface translucency on vinyl, and a macro-scale feel.",
    prompt:
      "{prompt}, plastic toy figure 3D render, smooth glossy vinyl, rounded bevels, bright solid colours, studio softbox reflections, subtle seam lines, macro depth of field",
    negative: "gritty, weathered, matte stone, photorealistic skin, low-poly, outlines, noisy",
    madeWith: [
      "physically based shading",
      "subsurface scattering",
      "fresnel rim",
      "screen-space ambient occlusion",
      "shallow depth of field",
    ],
    seenIn: ["Lego Builder's Journey", "Toy Story", "Designer vinyl collectible figures"],
    howTo: [
      "Three.js: MeshPhysicalMaterial with roughness 0.2-0.4, clearcoat 0.5, sheen or thickness-based subsurface fakes, RoomEnvironment for softbox reflections, beveled geometry, GTAOPass and BokehPass.",
      "Blender: Principled BSDF with Roughness 0.3, Coat, and Subsurface Weight 0.1-0.3 for vinyl; Bevel modifier or Bevel shader node for rounded edges; Cycles with a large area light as the softbox.",
    ],
  },
  {
    name: "hologram",
    description:
      "Geometry shown only as glowing thin lines, or a translucent cyan/teal shape with Fresnel edge glow, scan-line bands, flicker and slight chromatic offset, on a dark background. No solid surface shading.",
    prompt:
      "{prompt}, holographic wireframe, glowing cyan thin lines, translucent edge glow, scan lines, flicker, dark background, sci-fi interface look",
    negative: "solid shading, daylight, realistic textures, opaque, warm colours, painterly",
    madeWith: ["wireframe", "fresnel rim", "bloom", "volumetric fog", "colour grading LUT"],
    seenIn: ["TRON: Legacy", "Iron Man HUD holograms", "Alien (1979) wireframe monitors"],
    howTo: [
      "Three.js: WireframeGeometry/EdgesGeometry with LineSegments (LineSegments2 + LineMaterial for width) or MeshBasicMaterial wireframe: true; hologram surface via ShaderMaterial/onBeforeCompile with additive blending, a Fresnel term, scan-line sin(y) bands and time-based flicker; UnrealBloomPass for glow.",
      "Blender: Wireframe modifier or Wireframe shader node, Emission + Layer Weight (Fresnel) with Transparent BSDF mixing in EEVEE (Blend mode), Compositor Glare for glow.",
    ],
  },
  {
    name: "ligne claire 3D",
    description:
      "Fine, even-weight ink contour lines with little line-weight variation, flat or lightly hatched interior shading, desaturated pastel landscapes with orange-red and turquoise-blue accents, open skies, clear readable shapes. Cross-hatching only for shadows, never smooth gradients.",
    prompt:
      "{prompt}, ligne claire 3D render, thin even ink outlines, flat pastel colour fills, light cross-hatched shadows, clear shapes, wide clean sky, desaturated palette with orange and turquoise accents",
    negative: "photorealistic, soft gradients, thick outlines, noisy, glossy, gritty",
    madeWith: ["edge-detection outline", "hatching", "toon ramp", "flat shading", "gradient sky"],
    seenIn: [
      "The Adventures of Tintin comics (historical)",
      "Moebius comic landscapes (historical)",
      "Jet Set Radio",
    ],
    howTo: [
      "Three.js: Depth-plus-normal Sobel edge detection as a custom ShaderPass (or an OutlinePass/OutlineEffect for simple cases), a 2-band MeshToonMaterial, and a hatching texture sampled by screen-space or triplanar mapping (custom shader) where N.L falls below a threshold.",
      "Blender: Freestyle or Line Art for the thin contours, Shader to RGB + Color Ramp for flat colours, and a procedural hatching shader in Cycles/EEVEE driven by the dot product of the normal and light.",
    ],
  },
  {
    name: "painted storybook 3D",
    description:
      "3D forms placed in a painted-background aesthetic: soft hand-painted textures with brush grain, billowing cumulus clouds, saturated blue skies, lush greens, warm interior light, slightly warm shadows, and an overall gouache feel; edges are soft, not outlined.",
    prompt:
      "{prompt}, soft hand-painted look, gouache texture, billowing cumulus clouds, saturated blue sky, lush green foliage, warm interior light, gentle coloured shadows, no outlines",
    negative: "photorealistic, harsh outlines, CG plastic, grim, desaturated, noisy",
    madeWith: [
      "hand-painted texture",
      "gradient sky",
      "toon ramp",
      "colour grading LUT",
      "bloom",
      "volumetric fog",
    ],
    seenIn: [
      "Studio Ghibli painted backgrounds (e.g. Spirited Away)",
      "Ni no Kuni",
      "A Short Hike",
    ],
    howTo: [
      "Three.js: Hand-painted albedo on MeshLambertMaterial or a soft 3-band toon ramp, billboard painted-cloud sprites in a gradient sky, hemisphere light with warm-cool split, UnrealBloomPass (mild), LUT for warm grading, and optional Kuwahara for brushy softening.",
      "Blender: EEVEE with painted textures, Shader to RGB with a soft ramp, volumetric world haze, Sun with warm colour, and Compositor Glare plus Kuwahara for a gouache finish.",
    ],
  },
  {
    name: "1-bit dithered",
    description:
      "Only two colours, usually black and white (or a paper tint), with shading expressed solely by ordered or error-diffusion dither patterns, hard-pixel edges, low internal resolution, and strong contrast between lit and unlit areas.",
    prompt:
      "{prompt}, 1-bit dithered 3D render, black and white only, ordered dither shading, low-resolution hard pixels, strong contrast, early desktop computer look",
    negative: "grayscale gradients, colour, smooth, anti-aliased, photorealistic, high res",
    madeWith: ["ordered dithering", "pixelation", "posterize", "edge-detection outline"],
    seenIn: ["Return of the Obra Dinn", "Early Macintosh games (historical)"],
    howTo: [
      "Three.js: Render to a low-res target and run a ShaderPass that compares luminance to a Bayer-matrix threshold (ordered dithering). Needs custom shader (no built-in pass). RenderPixelatedPass handles the low-res and edge bits.",
      "Blender: Render greyscale at low resolution, then Compositor nodes: Posterize or a Math > Compare against a tiled Bayer texture; Freestyle for crisp edge lines.",
    ],
  },
  {
    name: "risograph 3D",
    description:
      "Comic-print dot patterns for tonal shading, limited spot-ink colours with overprint and slight misregistration, grainy paper, bold flat shapes and a retro newsprint feel.",
    prompt:
      "{prompt}, halftone comic print 3D render, visible dot-pattern shading, limited spot colours with overprint, slight misregistration, newsprint paper grain, bold flat shapes",
    negative: "smooth gradient, photorealistic, glossy, 3D plastic, noise-free, high bit-depth",
    madeWith: ["halftone", "posterize", "paper texture overlay", "toon ramp", "colour grading LUT"],
    seenIn: ["Comic book print pop art (historical)", "Spider-Man: Into the Spider-Verse", "XIII"],
    howTo: [
      "Three.js: HalftonePass from addons/postprocessing (params: shape, radius, rotateR/G/B, scatter, blending, greyscale) after a toon pass; add a paper overlay and offset the RGB screen angles for misregistration.",
      "Blender: Shader to RGB + Color Ramp for the base, then a Compositor halftone built with Texture/Checker or Pixelate + Math nodes; Freestyle for inked lines.",
    ],
  },
  {
    name: "flat pastel minimal",
    description:
      "Geometric clean shapes with 1-3 flat colours each, extremely soft gradients, soft diffuse shadows, no outlines, a harmonious pastel palette, generous negative space and calm lighting. Detail is architectural proportion rather than texture.",
    prompt:
      "{prompt}, minimal flat 3D render, clean geometric shapes, pastel palette, soft diffuse shadows, subtle gradient, no outlines, calm light, lots of empty space",
    negative: "texture, noise, realism, harsh shadows, outlines, clutter, dark",
    madeWith: [
      "flat shading",
      "gradient sky",
      "baked lighting",
      "screen-space ambient occlusion",
      "colour grading LUT",
    ],
    seenIn: ["Monument Valley", "Mini Motorways", "Journey"],
    howTo: [
      "Three.js: MeshLambertMaterial or MeshBasicMaterial with flat colours and baked vertex AO, HemisphereLight plus one shadow-casting DirectionalLight, gradient scene.background, optional gentle GTAOPass.",
      "Blender: EEVEE with Diffuse BSDF in flat colours, a Sun with soft shadows, a gradient world, and Color Management Filmic/AgX with a pastel Color Balance.",
    ],
  },
  {
    name: "neon night glow",
    description:
      "Dark night scene lit by saturated emissive points (lanterns, signs, windows), strong bloom halos, wet reflective ground, volumetric haze shafts, deep blue shadows against warm orange or magenta lights.",
    prompt:
      "{prompt}, night scene, glowing lanterns and neon, strong bloom halos, wet reflective ground, volumetric haze, deep blue shadows, warm magenta and orange lights",
    negative:
      "daylight, flat lighting, desaturated, low contrast, noise-free blur, cartoon outlines",
    madeWith: [
      "bloom",
      "volumetric fog",
      "fresnel rim",
      "colour grading LUT",
      "physically based shading",
    ],
    seenIn: ["Blade Runner 2049", "Cyberpunk 2077", "Ghostwire: Tokyo"],
    howTo: [
      "Three.js: Emissive materials with emissiveIntensity > 1 and UnrealBloomPass (selective bloom via layers or a mask), PointLights/RectAreaLight, fog with exponential density, MeshPhysicalMaterial wet ground (low roughness) with environment map; add volumetric shafts via fake light cone meshes or a custom raymarch.",
      "Blender: EEVEE with Emission shaders, Bloom/Glare (Compositor Fog Glow), Volume Scatter in the World for fog and Raytracing for reflections; Cycles for physically accurate haze.",
    ],
  },
  {
    name: "watercolour 3D",
    description:
      "Translucent colour washes with pigment pooling at edges, wet-edge darkening, soft bleeding between regions, white paper showing through highlights, and sparse light pencil outlines; colours are light and layered.",
    prompt:
      "{prompt}, watercolour 3D render, translucent washes, pigment pooling at edges, soft colour bleeding, white paper showing through, light pencil outlines, delicate palette",
    negative: "hard black outlines, glossy, photorealistic, saturated, plastic, noise",
    madeWith: [
      "Kuwahara filter",
      "paper texture overlay",
      "edge-detection outline",
      "hand-painted texture",
      "colour grading LUT",
    ],
    seenIn: ["Child of Light", "Watercolour architectural renderings (historical)"],
    howTo: [
      "Three.js: Custom ShaderPass: Kuwahara (or blur) for wash, edge darkening from depth/normal gradients for pigment pooling, noise-modulated paper multiply, and lowered saturation. Needs custom shader/TSL.",
      "Blender: Compositor Kuwahara plus edge-darkening (Filter > Sobel) blended into the image, Noise/Voronoi to modulate pigment, paper texture overlay; Freestyle for light pencil outlines.",
    ],
  },
  {
    name: "matcap sculpt",
    description:
      "Surfaces shaded purely by a pre-lit sphere image: lighting follows the camera, so form reads consistently from every angle; clay, jade, ceramic or metal looks come from the matcap texture alone. Used for sculpting previews and stylised asset showcases.",
    prompt:
      "{prompt}, matcap sculpt render, sphere-lit shading that follows the view, smooth material look like clay or jade, no cast shadows, clean neutral background",
    negative: "cast shadows, textures, outlines, photorealistic, complex lighting",
    madeWith: ["matcap", "normal-based shading", "baked lighting"],
    seenIn: ["ZBrush and Blender sculpt viewports", "Sketchfab model viewer matcaps"],
    howTo: [
      "Three.js: MeshMatcapMaterial with a matcap texture (sRGB for LDR); the material ignores scene lights, so it is cheap and consistent. Combine with an outline pass if wanted.",
      "Blender: Workbench engine with Lighting: MatCap in the render or viewport shading; matcap images can be replaced by custom ones.",
    ],
  },
];
