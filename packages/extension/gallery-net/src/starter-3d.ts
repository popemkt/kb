/**
 * The starter's 3D vocabulary: styles, rendering techniques, lighting
 * setups, projections and ways to present a model, each with the notes a
 * builder reads (`StyleSeed`): what it looks like, the techniques it is made
 * with, works that show it, a prompt template, and how to make it in
 * Three.js, Blender and Godot. Curated from the research gather recorded in
 * docs/research/2026-10-31-3d-styles-and-sources.md; a name the starter
 * already has (golden hour, halftone, tilt-shift) is not repeated here, and
 * its notes are in `NOTES_3D`. No style or prompt names an artist, a studio
 * or a work; two name a console's era, as the genre does (PS1 retro, N64
 * low-res).
 */
import type { StyleSeed } from "./starter.ts";

export { STYLES_3D } from "./starter-3d-styles.ts";

/** The rendering technique facet: one shader, pass or modelling choice each. */
export const TECHNIQUES: readonly StyleSeed[] = [
  {
    name: "inverted hull outline",
    description:
      "A second copy of the mesh, scaled or pushed out along its normals and drawn back-faces-only in a flat dark colour, so a constant-width silhouette line wraps every object. Cheap (one extra draw per mesh), but lines vanish on hard edges unless normals are smoothed and width varies with distance.",
    prompt:
      "{prompt}, thick uniform black outline around every silhouette, flat cel-shaded colour fills",
    howTo: [
      "Three.js: Add a duplicate mesh with side: BackSide and a MeshBasicMaterial, then offset vertices along the normal in the vertex stage (onBeforeCompile on project_vertex, a ShaderMaterial, or TSL positionLocal + normalLocal * thickness). Ready-made: OutlineEffect (examples/jsm/effects, WebGLRenderer only, per-material userData.outlineParameters) and, for WebGPURenderer, ToonOutlinePassNode (toonOutlinePass in three/tsl).",
      "Blender: Duplicate or add a Solidify modifier with negative thickness and Flip Normals on, assign a black emission material with Backface Culling enabled on that slot (Material Offset). Freestyle or Line Art are the screen-space alternatives.",
      "Godot: Second material pass with render_mode cull_front and vertex position pushed along NORMAL, or StandardMaterial3D Grow on a next_pass material.",
    ],
  },
  {
    name: "edge-detection outline",
    description:
      "A full-screen pass runs a Sobel or similar kernel over the depth, normal or object-id buffer and draws a line wherever it jumps, so creases and interior edges get lines as well as silhouettes. Cost is one extra normal/depth render plus a cheap full-screen pass; thickness is in screen pixels.",
    prompt: "{prompt}, clean ink contour lines along every edge and crease, flat colour shading",
    howTo: [
      "Three.js: OutlinePass (EffectComposer, outlines selected objects only, webgl_postprocessing_outline), ShaderPass with SobelOperatorShader (luminance-based, webgl_postprocessing_sobel), or RenderPixelatedPass which already computes depth and normal edges. For all-scene normal/depth edges, render MeshNormalMaterial and a DepthTexture to a target and run a custom Sobel ShaderPass. WebGPU: sobel() from tsl/display/SobelOperatorNode.js and OutlineNode.",
      "Blender: Line Art (Grease Pencil modifier) or Freestyle for geometry-based lines; in the Compositor a Filter node set to Sobel over Normal and Depth passes gives the same image-space edges.",
      "Godot: Full-screen quad or CompositorEffect reading DEPTH_TEXTURE and NORMAL_ROUGHNESS_TEXTURE with a Sobel kernel in a spatial shader.",
    ],
  },
  {
    name: "toon ramp",
    description:
      "Diffuse lighting is quantised into 2-5 hard bands by looking up N.L in a tiny ramp texture, giving flat cel-style tone steps. Practically free at runtime.",
    prompt:
      "{prompt}, cel-shaded with two or three hard-edged tone bands, flat lit colours, no gradients",
    howTo: [
      "Three.js: MeshToonMaterial.gradientMap: a DataTexture (e.g. 3-5 texels, RedFormat) with minFilter and magFilter set to NearestFilter so the bands do not blend. webgl_materials_toon and webgpu_materials_toon show it.",
      "Blender: EEVEE: Diffuse BSDF into Shader to RGB, then Color Ramp with Constant interpolation, then an Emission shader. Toon BSDF node is the built-in alternative.",
      "Godot: StandardMaterial3D Diffuse Mode = Toon, or render_mode diffuse_toon in a spatial shader.",
    ],
  },
  {
    name: "cel specular",
    description:
      "The specular highlight is thresholded into a crisp white blob (often stylised or offset) rather than a smooth falloff. Same cost as normal Blinn-Phong plus a step.",
    prompt:
      "{prompt}, cel-shaded with a hard-edged white highlight blob on each surface, flat tone bands",
    howTo: [
      "Three.js: MeshToonMaterial has no specular term, so a custom term is needed: onBeforeCompile appending step(threshold, pow(max(dot(N, H), 0.0), shininess)) to the output light, or a TSL material node. MeshPhongMaterial with a high shininess and a quantising post step is a rough approximation.",
      "Blender: Specular BSDF (or Glossy) into Shader to RGB, then Math Greater Than or a Constant Color Ramp, mixed over the diffuse ramp; EEVEE only.",
      "Godot: render_mode specular_toon, or StandardMaterial3D Specular Mode = Toon.",
    ],
  },
  {
    name: "hatching",
    description:
      "Shadow tone is drawn as pen strokes: sparser lines in light areas, denser or cross-hatched in dark ones, like an engraving. Needs authored stroke textures and a custom shader; costs a few texture taps per pixel.",
    prompt:
      "{prompt}, pen-and-ink cross-hatching for shadows, engraving style, line shading instead of gradients",
    howTo: [
      "Three.js: No built-in. Custom ShaderMaterial or onBeforeCompile that blends 4-6 stroke textures (tonal art maps with mip-levelled strokes, Praun et al.) by light intensity, in UV, object-space/triplanar or screen-space; post-process variant is a ShaderPass that thresholds luminance against a rotated line pattern.",
      "Blender: Shader to RGB then Color Ramp feeding Math thresholds against Wave or Line textures in Object or Window coordinates; or Freestyle with a hatched line style.",
      "Godot: Spatial shader sampling stroke textures chosen by diffuse intensity (custom).",
    ],
  },
  {
    name: "screen-space ambient occlusion",
    description:
      "Darkens creases and contact areas by sampling the depth/normal buffer around each pixel, adding grounded soft shadow without lights. Moderate GPU cost, can halo and needs a blur or denoise.",
    prompt:
      "{prompt}, soft contact shadows in corners and crevices, subtle ambient occlusion darkening",
    howTo: [
      "Three.js: EffectComposer passes: GTAOPass (best quality, webgl_postprocessing_gtao), SSAOPass (webgl_postprocessing_ssao), SAOPass (webgl_postprocessing_sao). WebGPU: ao() from GTAONode and ssao() from SSAONode (webgpu_postprocessing_ao).",
      "Blender: EEVEE: raytracing/horizon scan settings and the Ambient Occlusion shader node; Cycles: Ambient Occlusion node. Bake the result for a static look.",
      "Godot: Environment ssao_enabled (SSAO) and ssil_enabled (indirect light).",
    ],
  },
  {
    name: "bloom",
    description:
      "Bright pixels bleed a soft glow into their surroundings, as if lit through haze or lens glare. Costs a mip-chain of blurs; needs HDR render targets to look right.",
    prompt: "{prompt}, glowing highlights with soft bloom halos around bright lights",
    howTo: [
      "Three.js: UnrealBloomPass (strength, radius, threshold; webgl_postprocessing_unreal_bloom, plus selective variant), followed by OutputPass for tone mapping and sRGB. WebGPU: bloom() from BloomNode (webgpu_postprocessing_bloom, bloom_emissive).",
      "Blender: EEVEE's built-in bloom was removed in 4.2; use the Compositor Glare node (Bloom or Fog Glow mode).",
      "Godot: Environment glow_enabled.",
    ],
  },
  {
    name: "fresnel rim",
    description:
      "Surfaces facing away from the camera get a bright edge band, so objects look backlit or outlined in glow. Almost free in the shader.",
    prompt: "{prompt}, bright glowing rim along the silhouette edges, edge-lit fresnel glow",
    howTo: [
      "Three.js: Custom: onBeforeCompile adding emissive += rimColor * pow(1.0 - saturate(dot(normal, viewDir)), power), or TSL with normalView and positionViewDirection assigned to emissiveNode. MeshPhysicalMaterial.sheen is a related built-in for fabric.",
      "Blender: Layer Weight (Facing) or Fresnel node into a Color Ramp, added to the shader as Emission.",
      "Godot: StandardMaterial3D Rim, or the fresnel() helper in a spatial shader.",
    ],
  },
  {
    name: "matcap",
    description:
      "Shading comes entirely from a pre-painted sphere image looked up by view-space normal; no lights, so the look is frozen and extremely cheap. Good for sculpted clay, jade or ink looks.",
    prompt:
      "{prompt}, sculpt-style material capture shading, clay or ceramic look painted onto the form, no scene lighting",
    howTo: [
      "Three.js: MeshMatcapMaterial.matcap (sRGB texture); optionally normalMap. TSL has matcapUV. See webgl_materials_matcap and webgpu_materials_matcap.",
      "Blender: Workbench viewport/render engine Lighting = MatCap. Not a native shader node; emulate with Vector Transform (to camera space), Mapping, Image Texture.",
      "Godot: No built-in; shader sampling a texture at NORMAL (view space) * 0.5 + 0.5.",
    ],
  },
  {
    name: "ordered dithering",
    description:
      "Tone is quantised to few levels using a Bayer threshold matrix, producing regular cross-hatch-like dot patterns typical of 1-bit and early-palette art. Trivial cost in a full-screen pass.",
    prompt: "{prompt}, ordered Bayer dithering pattern, limited palette, retro 1-bit style shading",
    howTo: [
      "Three.js: Custom ShaderPass comparing luminance with a 4x4 or 8x8 Bayer matrix. TSL: bayerDither from three/addons/tsl/math/Bayer.js (used in webgpu_postprocessing_retro).",
      "Blender: No dither node (Color Management Dither is output noise, not ordered). Recipe: Image Texture of a tiled Bayer matrix in Window coordinates compared with luminance via Math Greater Than.",
      "Godot: Spatial or canvas shader with a Bayer matrix; godotshaders has examples.",
    ],
  },
  {
    name: "posterize",
    description:
      "Colour or tone is snapped to a few discrete levels per channel, creating flat bands like a screen-print. Free in a post pass.",
    prompt:
      "{prompt}, posterized into a few flat colour levels, hard tonal bands, screen-print look",
    howTo: [
      "Three.js: Custom ShaderPass: floor(c * n) / n. TSL has posterize() (used in webgpu_postprocessing_retro).",
      "Blender: Compositor Posterize node; in shaders use Math Floor or a Constant Color Ramp.",
      "Godot: Full-screen shader: floor(color * steps) / steps.",
    ],
  },
  {
    name: "Kuwahara filter",
    description:
      "An edge-preserving smoothing filter that averages the most uniform of several sub-windows around each pixel, flattening detail into painterly oil-paint patches while keeping edges. Expensive: many taps per pixel, anisotropic version needs extra passes.",
    prompt:
      "{prompt}, painterly oil-painting look, flat brush-like colour patches with preserved edges",
    howTo: [
      "Three.js: No addon (none in postprocessing or tsl/display). Needs a custom ShaderPass or TSL node; the anisotropic variant needs a structure-tensor (Sobel) pass first.",
      "Blender: Compositor Kuwahara node (Blender 4.0+), types Classic and Anisotropic, with Size, Uniformity, Sharpness and Eccentricity on the anisotropic mode.",
      "Godot: Custom screen-reading shader (hint_screen_texture) with the sector-average loop.",
    ],
  },
  {
    name: "triplanar mapping",
    description:
      "A texture is projected along the X, Y and Z axes and blended by the surface normal, so rocks and terrain get seamless texturing with no UVs. Costs three texture samples per pixel.",
    prompt:
      "{prompt}, seamless texture projected over the form with no UV seams, blended across faces",
    howTo: [
      "Three.js: TSL: triplanarTexture / triplanarTextures (src/nodes/utils/TriplanarTextures.js). In WebGL, custom onBeforeCompile using world or object position and normal weights pow(abs(n), k).",
      "Blender: Image Texture with Projection = Box and Blend, driven by Object texture coordinates.",
      "Godot: StandardMaterial3D Uses Triplanar (UV1/UV2 triplanar).",
    ],
  },
  {
    name: "flat shading",
    description:
      "Each polygon gets one uniform tone from its face normal, giving a faceted low-poly crystal look. Zero extra cost.",
    prompt: "{prompt}, low-poly faceted look, each polygon a single flat shade, visible facets",
    howTo: [
      "Three.js: material.flatShading = true on MeshStandardMaterial, MeshPhongMaterial, MeshLambertMaterial or MeshToonMaterial (face normals from screen-space derivatives); or geometry.toNonIndexed() then computeVertexNormals().",
      "Blender: Shade Flat on the mesh, or an Edge Split / Smooth by Angle modifier with angle 0.",
      "Godot: Compute normal in the fragment shader from dFdx/dFdy of VERTEX, or import with flat normals.",
    ],
  },
  {
    name: "vertex colour",
    description:
      "Colour is stored per vertex and interpolated across faces, giving soft gradient colouring with no textures; baked AO or tint can live in it. Smallest possible material cost.",
    prompt:
      "{prompt}, smooth colour gradients across faces, painted per-vertex colour with no textures",
    howTo: [
      "Three.js: Add a color BufferAttribute and set material.vertexColors = true (works on MeshBasic, Lambert, Standard, Toon). See webgl_geometry_colors.",
      "Blender: Color Attributes (Vertex Paint) read by the Color Attribute node; exported as COLOR_0 in glTF.",
      "Godot: StandardMaterial3D Vertex Color Use As Albedo.",
    ],
  },
  {
    name: "baked lighting",
    description:
      "Light, shadow and ambient occlusion are pre-computed into textures, so a static scene looks richly lit at near-zero runtime cost. Locked to the baked light and needs a clean second UV set.",
    prompt:
      "{prompt}, soft baked global illumination, gentle light bounce and ambient occlusion in the shading, static lighting",
    howTo: [
      "Three.js: MeshStandardMaterial.lightMap and aoMap on UV channel 1 (texture.channel = 1; lightMapIntensity, aoMapIntensity). In-browser baking: ProgressiveLightMap (webgl_shadowmap_progressive) ; volumetric probes: LightProbeGrid in examples/jsm/lighting. webgpu_materials_lightmap shows lightMap.",
      "Blender: Cycles Bake (Diffuse with Direct and Indirect, or Ambient Occlusion, or Combined) into an image on a second UV map; export via glTF.",
      "Godot: LightmapGI node (baked), VoxelGI, or SDFGI.",
    ],
  },
  {
    name: "physically based shading",
    description:
      "Metal/roughness materials lit by an environment map and physical lights, with Fresnel and energy conservation, giving the realistic default look. Moderate cost; needs good environment lighting and tone mapping.",
    prompt:
      "{prompt}, physically based realistic materials, accurate reflections and roughness, photoreal shading",
    howTo: [
      "Three.js: MeshStandardMaterial / MeshPhysicalMaterial (clearcoat, sheen, iridescence, transmission) with scene.environment from PMREMGenerator (RoomEnvironment or an HDR via HDRLoader) and renderer.toneMapping = ACESFilmicToneMapping, AgXToneMapping or NeutralToneMapping.",
      "Blender: Principled BSDF in Cycles or EEVEE with an HDRI World; view transform AgX or Khronos PBR Neutral (Filmic is the older option).",
      "Godot: StandardMaterial3D (metallic/roughness) with a WorldEnvironment sky.",
    ],
  },
  {
    name: "subsurface scattering",
    description:
      "Light penetrates and diffuses inside a material, softening shadows on skin, wax, jade and leaves. Real SSS is costly; real-time versions are thin-object tricks or screen-space blurs.",
    prompt: "{prompt}, translucent waxy subsurface glow, light bleeding softly through thin edges",
    howTo: [
      "Three.js: WebGL core has no true SSS: fake with MeshPhysicalMaterial transmission/thickness/attenuationColor, or the ShaderMaterial-based thin-object demo webgl_materials_subsurface_scattering (SubsurfaceScatteringShader). WebGPU: SSSNode (webgpu_postprocessing_sss) and webgpu_materials_sss.",
      "Blender: Principled BSDF Subsurface weight/radius, or the Subsurface Scattering node (Cycles and EEVEE).",
      "Godot: StandardMaterial3D Subsurf Scatter, plus Transmittance for thin parts.",
    ],
  },
  {
    name: "pixelation",
    description:
      "The scene is rendered at a very low resolution and upscaled with nearest filtering so each texel becomes a chunky square pixel, often with 1-px outlines. Cheap (fewer pixels shaded); shimmering on camera motion unless snapped.",
    prompt:
      "{prompt}, low-resolution pixel art look, chunky square pixels, crisp one-pixel outlines",
    howTo: [
      "Three.js: RenderPixelatedPass(pixelSize, scene, camera, { normalEdgeStrength, depthEdgeStrength }) with EffectComposer (webgl_postprocessing_pixel). Manual: render to a small WebGLRenderTarget with NearestFilter, or renderer.setPixelRatio(1/N) with CSS image-rendering: pixelated. WebGPU: pixelationPass (PixelationPassNode).",
      "Blender: Compositor Pixelate node; or render at very low resolution and upscale with Closest interpolation.",
      "Godot: Render into a low-res SubViewport displayed with nearest texture filtering.",
    ],
  },
  {
    name: "vertex snapping",
    description:
      "Vertex positions are rounded to a coarse screen grid, so low-poly models wobble and jitter like PS1-era 3D. Free in the vertex shader.",
    prompt: "{prompt}, PS1-era low-poly look, wobbly jittering vertices, crunchy polygons",
    howTo: [
      "Three.js: onBeforeCompile after project_vertex: snap gl_Position.xy / gl_Position.w to a resolution-sized grid and multiply back by w; in TSL, round positionClip's xy/w.",
      "Blender: No native render feature; emulate with a Geometry Nodes Set Position that rounds camera-space coordinates, or just rely on a Decimate (Collapse) modifier for the low-poly part.",
      "Godot: vertex() function: convert to clip space, snap, convert back; many PSX shaders do this.",
    ],
  },
  {
    name: "affine texture mapping",
    description:
      "Textures are interpolated linearly in screen space instead of perspective-correct, so they warp and swim across large polygons (PS1 look). Free; it removes the correction.",
    prompt:
      "{prompt}, warped swimming textures on large polygons, PS1-style affine texture distortion",
    howTo: [
      "Three.js: WebGL interpolates perspective-correctly by default. Trick: in the vertex shader output vUv = uv * gl_Position.w and vW = gl_Position.w, then in the fragment shader use vUv / vW, which yields screen-space linear interpolation. No noperspective qualifier in GLSL ES 3.00.",
      "Blender: No built-in render option; effectively not available in Cycles or EEVEE.",
      "Godot: The same w-divide trick, in a spatial shader.",
    ],
  },
  {
    name: "paper texture overlay",
    description:
      "A tileable paper grain is multiplied or overlaid over the final image so renders feel printed on or painted on paper, often with slightly lifted blacks. Free as a full-screen blend.",
    prompt:
      "{prompt}, printed on textured paper, visible paper grain and fibres, slightly faded matte inks",
    howTo: [
      "Three.js: Custom ShaderPass multiplying/overlaying a tileable texture in screen space, or a CSS layer with mix-blend-mode: multiply above the canvas. TSL: texture(paper, screenUV) combined with the pass output.",
      "Blender: Compositor: Image node (paper) into a Mix node (Multiply or Overlay) over the Render Layers output.",
      "Godot: CanvasLayer with a full-screen ColorRect using a multiply-blend canvas shader.",
    ],
  },
  {
    name: "colour grading LUT",
    description:
      "A 3D lookup table remaps every colour in the final image, applying a film or stylised grade (teal-orange, faded, split-tone) in one step. Cheap.",
    prompt:
      "{prompt}, cinematic colour grade, stylised colour palette, graded shadows and highlights",
    howTo: [
      "Three.js: LUTPass({ lut, intensity }) with a lut from LUTCubeLoader, LUT3dlLoader or LUTImageLoader (webgl_postprocessing_3dlut). WebGPU: lut3D() from Lut3DNode (webgpu_postprocessing_3dlut). Placement relative to OutputPass (tone mapping) matters; check per LUT.",
      "Blender: View transform plus Look and Curves in Color Management; Compositor Color Balance or RGB Curves nodes. Loading a LUT file directly needs an OCIO config.",
      "Godot: Environment Adjustments colour correction with a 1D or 3D LUT texture.",
    ],
  },
  {
    name: "volumetric fog",
    description:
      "Fog that has depth structure and catches light, giving shafts, banks and layered atmosphere. Real volumetrics are costly; depth-only fog is nearly free but flat.",
    prompt: "{prompt}, thick atmospheric volumetric fog with visible depth layers and light shafts",
    howTo: [
      "Three.js: scene.fog (Fog or FogExp2) is distance fog only. WebGPU/TSL: custom and height fog (webgpu_custom_fog, webgpu_fog_height, webgpu_custom_fog_scattering) and webgpu_volume_lighting. WebGL: raymarched ShaderMaterial or layered transparent planes (webgl_volume_cloud as a base).",
      "Blender: Volume Scatter or Principled Volume on the World or a cube; EEVEE Volumes settings; Cycles volume rendering.",
      "Godot: Environment volumetric_fog_enabled plus FogVolume nodes.",
    ],
  },
  {
    name: "gradient sky",
    description:
      "A vertical colour gradient (horizon glow to zenith) replaces a realistic sky, often with a matching fog colour, for a clean stylised atmosphere. Free.",
    prompt:
      "{prompt}, smooth gradient sky from warm horizon to deep colour overhead, no clouds, stylised backdrop",
    howTo: [
      "Three.js: scene.background = a CanvasTexture gradient, or a large BackSide sphere with a ShaderMaterial blending colours by normalised y; match scene.fog colour. Physically based alternative: Sky addon (examples/jsm/objects/Sky.js, webgl_shaders_sky); sampled to scene.environment via PMREMGenerator.",
      "Blender: World nodes: Gradient Texture or Texture Coordinate Z into a Color Ramp feeding Background; or the Sky Texture node.",
      "Godot: Sky with ProceduralSkyMaterial (top, horizon and ground colours).",
    ],
  },
  {
    name: "hand-painted texture",
    description:
      "Albedo textures painted by hand, with light, shadow and wear baked into the paint, usually low resolution and used with unlit or soft lighting. Stylised and cheap; the lighting is in the texture.",
    prompt:
      "{prompt}, hand-painted textures with visible brush strokes, painted-in light and shadow, stylised game art",
    howTo: [
      "Three.js: MeshLambertMaterial or MeshBasicMaterial with a 256-1024 px map (colorSpace = SRGBColorSpace), often NearestFilter or mipmapped; no normal or roughness maps. Vertex colour can add the broad tint.",
      "Blender: Texture Paint mode into an Image Texture feeding Emission or a Diffuse; unlit via Emission for the baked look.",
      "Godot: StandardMaterial3D with only albedo, optionally Shading Mode = Unshaded.",
    ],
  },
  {
    name: "decals",
    description:
      "Projected stickers (grime, graffiti, signs, cracks) are laid onto existing surfaces without editing the base texture, so detail can be placed freely. Cost is extra geometry or an extra projection pass.",
    prompt:
      "{prompt}, weathering stains, peeling paint patches and stencilled marks projected onto the surfaces",
    howTo: [
      "Three.js: DecalGeometry (examples/jsm/geometries, webgl_decals) builds a clipped mesh from a projector box onto a target mesh; use transparent, depthWrite false and polygonOffset to avoid z-fighting.",
      "Blender: Project onto a mesh with a UV Project modifier or a Shrinkwrap'd plane with an alpha texture.",
      "Godot: Decal node (albedo, normal, ORM textures projected in a box).",
    ],
  },
  {
    name: "wireframe",
    description:
      "The model is drawn as its triangle or quad edges, either alone or over a shaded fill, like a technical blueprint or a vector-graphics look. Cheap, but WebGL lines are 1px wide.",
    prompt: "{prompt}, wireframe mesh lines visible over the form, technical blueprint look",
    howTo: [
      "Three.js: material.wireframe = true (1 px lines); WireframeGeometry plus LineSegments; thick lines via LineSegments2 and LineMaterial (webgl_lines_fat_wireframe); anti-aliased shaded-plus-wire via a barycentric-coordinate shader.",
      "Blender: Wireframe modifier on a duplicate, the viewport Wireframe display or overlay, or the Wireframe shader node.",
      "Godot: Viewport debug draw Wireframe (editor/debug), or lines via a custom mesh.",
    ],
  },
  {
    name: "normal-based shading",
    description:
      "Surface shading is driven by (modified) normals rather than geometry: smoothed or hand-edited normals keep toon shading clean on low-poly meshes, and normal maps add fine bumps without geometry. Cost is just normal data.",
    prompt:
      "{prompt}, smooth clean shading across low-poly forms, soft normals with no faceting artefacts",
    howTo: [
      "Three.js: BufferGeometryUtils.toCreasedNormals(geometry, creaseAngle) or mergeVertices plus computeVertexNormals() for smooth normals; for toon, store smoothed normals in an extra attribute and use them in an onBeforeCompile lighting term; normalMap (MeshStandardMaterial) for detail.",
      "Blender: Weighted Normal or Normal Edit modifier, Data Transfer custom normals, Smooth by Angle modifier (auto smooth was removed in 4.1); bake Normal maps with Cycles Bake.",
    ],
  },
  {
    name: "screen-space reflections",
    description:
      "Reflections are ray-marched through the depth buffer, giving wet floors and glossy surfaces a mirror of the visible scene. Fails for off-screen objects and costs a depth march.",
    prompt: "{prompt}, glossy wet surfaces with clear reflections of the scene",
    howTo: [
      "Three.js: SSRPass (EffectComposer, per-object selects; webgl_postprocessing_ssr). WebGPU: ssr() from SSRNode (webgpu_postprocessing_ssr, ssr_denoise). Planar alternative: Reflector (examples/jsm/objects).",
      "Blender: EEVEE raytracing (screen-trace); Cycles traces true reflections.",
      "Godot: Environment ssr_enabled.",
    ],
  },
  {
    name: "chromatic aberration",
    description:
      "Red, green and blue are offset slightly toward the image edges, imitating a cheap lens with colour fringing. One cheap full-screen pass.",
    prompt: "{prompt}, lens chromatic aberration, red and blue colour fringing at the edges",
    howTo: [
      "Three.js: ShaderPass with RGBShiftShader (amount, angle). WebGPU: chromaticAberration() from ChromaticAberrationNode (webgpu_postprocessing_ca), RGBShiftNode.",
      "Blender: Compositor Lens Distortion node with Dispersion.",
      "Godot: Screen-reading shader sampling the colour channels at offset UVs.",
    ],
  },
];

/** Lighting setups for a 3D scene, which join the starter's Lighting facet. */
export const LIGHTING_3D: readonly StyleSeed[] = [
  {
    name: "three-point lighting",
    description:
      "A strong key light from one side, a dimmer fill opposite to lift shadows, and a rim/back light to separate the subject from the background; the classic clean subject-on-background setup. Cheap: three lights, one shadow caster.",
    prompt:
      "{prompt}, classic three-point lighting, bright key light from one side, soft fill on the shadow side, rim light separating the subject from the background",
    howTo: [
      "Three.js: DirectionalLight key (castShadow true, ~45 degrees front-side and above), a weaker DirectionalLight or RectAreaLight fill from the other side (no shadow), and a rim DirectionalLight behind the subject. Lights are physical units since r155, so tune intensities against toneMapping rather than expecting legacy values.",
      "Blender: Three Area lights (Key large and bright, Fill about half to a quarter power, Rim behind) aimed at the subject; Cycles or EEVEE with a dark World.",
      "Godot: Three DirectionalLight3D or OmniLight3D/SpotLight3D nodes arranged as key, fill and rim.",
    ],
  },
  {
    name: "HDRI studio lighting",
    description:
      "The subject is lit by a studio environment image (softboxes, white cove) used as image-based lighting, giving natural reflections and soft even light. One environment lookup per shade; reflections need a good map.",
    prompt:
      "{prompt}, lit in a photography studio with large soft reflections, even soft lighting, clean specular highlights",
    howTo: [
      "Three.js: scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture (RoomEnvironment is a procedural studio, examples/jsm/environments). Or load an HDR/EXR with HDRLoader or EXRLoader and use PMREMGenerator.fromEquirectangular; keep scene.background a plain colour.",
      "Blender: World: Environment Texture node with a studio HDRI into Background, strength about 1; or Studio lights in the viewport for Workbench.",
      "Godot: WorldEnvironment with a PanoramaSkyMaterial using a studio HDRI, Ambient Light Source = Sky.",
    ],
  },
  {
    name: "HDRI sun and sky",
    description:
      "Daylight from a sky HDRI or procedural sky for ambient/reflections plus a matching sun direction for hard shadows, so the scene sits convincingly outdoors. Cost is one environment plus a shadowed sun light.",
    prompt:
      "{prompt}, outdoors in bright sunlight with a blue sky, crisp sun shadows and soft blue skylight fill",
    howTo: [
      "Three.js: Sky addon (examples/jsm/objects/Sky.js, webgl_shaders_sky) or an equirect HDRI converted by PMREMGenerator into scene.environment, plus a DirectionalLight (or SunLight, examples/jsm/lights, with cascaded shadows) placed at the HDRI's sun direction. CSM (examples/jsm/csm, webgl_shadowmap_csm) for large scenes.",
      "Blender: World Sky Texture (Nishita) with Sun Elevation and Rotation, or a sunny HDRI; plus a Sun light for the same direction if using an HDRI.",
      "Godot: WorldEnvironment with ProceduralSkyMaterial or PhysicalSkyMaterial and a DirectionalLight3D with shadows.",
    ],
  },
  {
    name: "key and fill light",
    description:
      "One main shadow-casting light plus a dim non-shadowing ambient or fill so shadows stay readable; the simplest believable setup. Very cheap.",
    prompt:
      "{prompt}, one clear key light with gentle fill, readable soft shadows, simple lighting",
    howTo: [
      "Three.js: One DirectionalLight with castShadow plus an AmbientLight or low-intensity HemisphereLight for fill. Tune shadow.bias and normalBias to avoid acne; use PCFShadowMap (PCFSoftShadowMap is deprecated since r186).",
      "Blender: One Sun or Area light plus a dim uniform grey World colour (strength 0.1-0.3) for fill.",
      "Godot: One DirectionalLight3D with shadows plus Environment ambient light (colour or sky).",
    ],
  },
  {
    name: "hemisphere ambient light",
    description:
      "Ambient light that is one colour from above and another from below (sky blue over ground brown), so surfaces pointing up or down take different tints without any shadow. Almost free; gives soft stylised outdoor ambience.",
    prompt:
      "{prompt}, soft ambient light with cool sky tint from above and warm bounce from below, gentle gradient shading",
    howTo: [
      "Three.js: HemisphereLight(skyColor, groundColor, intensity), see webgl_lights_hemisphere. Often paired with a single DirectionalLight for the sun.",
      "Blender: World with a vertical Gradient Texture or Texture Coordinate Z into a Color Ramp feeding Background (sky colour at top, ground colour at bottom).",
      "Godot: Environment ambient light from Sky, or ProceduralSkyMaterial with distinct sky and ground colours.",
    ],
  },
  {
    name: "unlit",
    description:
      "No lighting at all: surfaces show their own colour or emission everywhere, giving graphic, poster-like images where lighting is baked into the texture or omitted. Cheapest possible shading.",
    prompt:
      "{prompt}, flat unlit colours, no shadows or shading, graphic poster look, uniform lighting",
    howTo: [
      "Three.js: MeshBasicMaterial (ignores lights; set toneMapped false to keep exact colours) or MeshStandardMaterial with emissive and emissiveMap. Pair with an edge or outline pass for readability.",
      "Blender: Emission shader (strength 1) per material, or Workbench engine with Lighting = Flat.",
      "Godot: StandardMaterial3D Shading Mode = Unshaded, or render_mode unshaded.",
    ],
  },
  {
    name: "path-traced global illumination",
    description:
      "Light is simulated bouncing everywhere, giving colour bleeding, soft indirect light and physically correct shadows. Heavy: progressive accumulation, noisy until converged.",
    prompt:
      "{prompt}, physically accurate global illumination, soft colour bleeding between surfaces, realistic indirect lighting",
    howTo: [
      "Three.js: three-gpu-pathtracer (external library by gkjohnson, used in webgl_renderer_pathtracer with v0.0.24 pinned) for progressive path tracing. Real-time approximations: WebGPU SSGINode (webgpu_postprocessing_ssgi), or LightProbeGrid (examples/jsm/lighting).",
      "Blender: Cycles with enough samples and Denoise, Light Paths bounces set per need.",
      "Godot: SDFGI or VoxelGI for real-time approximations; LightmapGI for baked.",
    ],
  },
  {
    name: "toon key light",
    description:
      "A single hard directional light with a quantised toon ramp and almost no ambient, so each object has a crisp lit side and a flat shadow side. Very cheap.",
    prompt:
      "{prompt}, one hard directional light, crisp two-tone cel shading, flat shadow shapes, minimal fill",
    howTo: [
      "Three.js: One DirectionalLight (shadows on) with MeshToonMaterial and a 2-3 step gradientMap; keep AmbientLight very low or use a tinted HemisphereLight for the shadow colour.",
      "Blender: One Sun light with Shader to RGB and a Constant Color Ramp (EEVEE); shadow colour set in the ramp.",
      "Godot: One DirectionalLight3D with materials using Diffuse Mode = Toon.",
    ],
  },
  {
    name: "night with practical lights",
    description:
      "A dark blue ambient with small warm light sources (lanterns, windows, candles) as the only illumination, creating pools of light and strong emissive glows. Many dynamic lights get expensive.",
    prompt:
      "{prompt}, night scene lit only by warm lanterns and windows, deep blue darkness around, glowing pools of light",
    howTo: [
      "Three.js: Very low AmbientLight or HemisphereLight in dark blue; PointLight / SpotLight lanterns with warm colour and physical decay, shadows only on the few that matter; emissive materials plus UnrealBloomPass for glow. Many lights on WebGPU: ClusteredLighting / DynamicLighting (examples/jsm/lighting, webgpu_lights_clustered).",
      "Blender: Dark blue World at very low strength, Point/Spot lights or emission planes for lanterns, Glare (Bloom) in the Compositor for glow.",
      "Godot: OmniLight3D/SpotLight3D nodes with a dark Environment; glow_enabled for emissive bloom.",
    ],
  },
];

/** The projection facet: how the camera maps the scene to the picture. */
export const PROJECTIONS: readonly StyleSeed[] = [
  {
    name: "perspective",
    description:
      "Standard pinhole projection: parallel lines converge, nearer things look larger. Natural-feeling depth; the field of view sets how dramatic or distorted it looks (wide = exaggerated, narrow = flatter).",
    prompt: "{prompt}, natural perspective view with converging lines and a sense of depth",
    howTo: [
      "Three.js: PerspectiveCamera(fov, aspect, near, far). Use setFocalLength(mm) (filmGauge default 35) for photographic framing; 35-50 mm equivalent reads naturally for monuments, the common 75 degree default looks too wide.",
      "Blender: Camera type Perspective; set Focal Length (50 mm default) and Sensor Fit.",
      "Godot: Camera3D projection = Perspective with fov (vertical by default, see keep_aspect).",
    ],
  },
  {
    name: "orthographic",
    description:
      "Parallel projection with no foreshortening: objects keep the same size at any distance and parallel lines stay parallel. Gives a technical, diagrammatic or game-map feel; depth is read through overlap and shading only.",
    prompt:
      "{prompt}, orthographic view with no perspective distortion, parallel lines stay parallel, technical drawing feel",
    howTo: [
      "Three.js: OrthographicCamera(left, right, top, bottom, near, far); derive left/right from aspect * a view-height constant and change zoom with camera.zoom, calling updateProjectionMatrix() after any change. See webgl_interactive_cubes_ortho.",
      "Blender: Camera type Orthographic with Orthographic Scale controlling framing.",
      "Godot: Camera3D projection = Orthogonal with size.",
    ],
  },
  {
    name: "isometric",
    description:
      "True isometric: an orthographic view where all three world axes are equally foreshortened, with edges 120 degrees apart on screen; the classic cube-on-a-corner view. The camera sits at 45 degrees yaw and about 35.264 degrees elevation.",
    prompt:
      "{prompt}, true isometric view, orthographic camera looking down at a corner, all three axes equally foreshortened, diorama-like",
    howTo: [
      "Three.js: OrthographicCamera positioned at (d, d, d) with lookAt(0, 0, 0): that is yaw 45 degrees and pitch atan(1/sqrt(2)) = 35.264 degrees. Equivalent: camera.rotation.order = 'YXZ'; rotation.y = Math.PI / 4; rotation.x = -Math.atan(1 / Math.SQRT2).",
      "Blender: Orthographic camera with rotation X = 54.736 degrees, Z = 45 degrees (that is 90 minus 35.264 for Blender's X-from-vertical convention); Orthographic Scale to frame.",
      "Godot: Camera3D Orthogonal with rotation_degrees = (-35.264, 45, 0).",
    ],
  },
  {
    name: "dimetric",
    description:
      "Two axes share equal foreshortening and the third differs; in games this means the 2:1 pixel-art pseudo-isometric view where tile diamonds are twice as wide as tall and edge lines run at about 26.565 degrees on screen. Not geometrically the same as true isometric.",
    prompt:
      "{prompt}, 2:1 dimetric pixel-art style isometric view, wide diamond tiles, classic strategy-game perspective",
    howTo: [
      "Three.js: OrthographicCamera at yaw 45 degrees and elevation 30 degrees (sin 30 = 0.5 gives 2:1 diamonds): position (0.612, 0.5, 0.612) * d, lookAt(0, 0, 0). The 26.565 degrees (atan 0.5) figure is the screen angle of tile edges, not the camera elevation (derived). Snap the camera to whole texels when combined with pixelation.",
      "Blender: Orthographic camera at Z rotation 45 degrees and X rotation 60 degrees (90 minus a 30 degree elevation).",
      "Godot: Camera3D Orthogonal with rotation_degrees = (-30, 45, 0).",
    ],
  },
  {
    name: "plan view",
    description:
      "The camera looks straight down at the ground, showing plan layout like a map; perspective or orthographic. Excellent for layouts of courtyards and monument complexes, loses elevation.",
    prompt: "{prompt}, top-down view looking straight down, plan view like a map, flat layout",
    howTo: [
      "Three.js: Camera above the scene with camera.position.set(0, h, 0), camera.up.set(0, 0, -1) then lookAt(0, 0, 0) (the up change avoids the degenerate lookAt when looking along the Y axis); works with OrthographicCamera or PerspectiveCamera.",
      "Blender: Camera rotation X = 0 degrees looking down -Z (top view), orthographic for plan; numpad 7 in the viewport.",
      "Godot: Camera3D at height with rotation_degrees = (-90, 0, 0).",
    ],
  },
  {
    name: "oblique projection",
    description:
      "Front face drawn undistorted while depth recedes along a diagonal at half length (cabinet) or full length (cavalier). Looks like an old technical drawing or side-scroller with a hint of depth.",
    prompt:
      "{prompt}, oblique cabinet projection, front face drawn flat and undistorted with the sides receding diagonally, technical illustration",
    howTo: [
      "Three.js: No oblique camera class. Take an OrthographicCamera looking down -Z and shear its projection matrix so depth shifts x and y (elements[8] and [9], reapplied after every updateProjectionMatrix()), or put the content under a Matrix4.makeShear() transform on a root object.",
      "Blender: No oblique camera. Orthographic front camera and apply a shear transform to the content (Shear tool) or a parent matrix; Camera Shift X/Y is lens shift, not oblique.",
      "Godot: No oblique camera; Camera3D frustum offset is off-axis lens shift, not shear; shear in a vertex shader instead.",
    ],
  },
];

/** The presentation facet: how a model is staged to be shown. */
export const PRESENTATIONS: readonly StyleSeed[] = [
  {
    name: "product shot",
    description:
      "The subject is centred on a clean surface and lit like a catalogue photo: soft reflections, contact shadow, neutral backdrop, slightly elevated camera. Calm, neutral, emphasises form and material.",
    prompt:
      "{prompt}, product shot on a clean neutral surface, soft studio lighting, gentle contact shadow, centred and sharp",
    howTo: [
      "Three.js: RoomEnvironment through PMREMGenerator as scene.environment, a plain background colour, a ShadowMaterial ground or contact shadows (webgl_shadow_contact), toneMapping = NeutralToneMapping or AgXToneMapping, camera fov about 30-40.",
      "Blender: Studio HDRI or Area softboxes, large floor plane with Shadow Catcher or a seamless cove, camera 70-100 mm, AgX or Khronos PBR Neutral view transform.",
      "Godot: WorldEnvironment with a studio panorama, a floor mesh receiving shadows, narrow-fov Camera3D.",
    ],
  },
  {
    name: "hero shot",
    description:
      "A dramatic low or three-quarter angle that makes the subject look grand and important, with rim light, atmosphere and strong composition. The opposite of the neutral product shot.",
    prompt:
      "{prompt}, hero shot from a low angle, dramatic rim lighting, atmospheric haze, subject towering against the sky",
    howTo: [
      "Three.js: Camera low and close with moderate fov (24-35), a bright rim DirectionalLight behind plus warm key, fog (scene.fog or webgpu_fog_height), UnrealBloomPass, subtle BokehPass depth of field and a vignette; slow dolly in via camera.position tweens.",
      "Blender: Low-angle camera at 35-50 mm, Sun backlight, volume scatter fog, compositor Glare and vignette.",
      "Godot: Low Camera3D with moderate fov, DirectionalLight3D rim, fog and glow in Environment.",
    ],
  },
  {
    name: "turntable",
    description:
      "The model spins on its vertical axis under fixed camera and fixed lights, so shading and reflections slide across the surfaces. As a still, it differs from the camera motion 'orbit' only by implying a static neutral staging; in motion the difference is that lights and background stay still while the object rotates, whereas an orbit moves the camera around a fixed object (and its lighting and background).",
    prompt:
      "{prompt}, turntable presentation on a neutral stage, subject centred and evenly lit, rotating pedestal feel",
    howTo: [
      "Three.js: Rotate a pivot Group around Y each frame (pivot.rotation.y += speed * delta) with a fixed camera and fixed lights; OrbitControls.autoRotate instead moves the camera (that is the orbit move).",
      "Blender: Parent the model to an Empty and keyframe Z rotation 0 to 360 degrees with Linear interpolation over the loop length (or a Cycles modifier); keep camera and lights un-parented.",
      "Godot: AnimationPlayer or script rotating a Node3D pivot around Y with a static Camera3D.",
    ],
  },
  {
    name: "diorama on a plinth",
    description:
      "The scene is a small self-contained slice of world sitting on a block or cylindrical base, viewed like a museum model or miniature. Gives scale-model charm and a clear frame around the subject.",
    prompt:
      "{prompt}, miniature diorama on a square base block, cut edges visible, tilt-shift miniature photography look",
    howTo: [
      "Three.js: A BoxGeometry or CylinderGeometry plinth under the content; orthographic or long-lens perspective camera at 30-45 degrees; fake miniature depth with HorizontalTiltShiftShader / VerticalTiltShiftShader via ShaderPass; soft shadow and plain backdrop.",
      "Blender: Cube or cylinder base with a Bevel modifier, content on top, long-lens camera, Defocus or camera DOF set close for a miniature look.",
      "Godot: MeshInstance3D base with the content parented to it; SubViewport with a tilt-shift shader if desired.",
    ],
  },
  {
    name: "floating island",
    description:
      "A chunk of terrain with the monument on top, its underside a tapering rock mass hovering in sky or void, often with clouds and a gentle bob. Fantasy framing that isolates the subject.",
    prompt:
      "{prompt}, floating island hovering in the sky, grassy top with the subject on it, rocky underside tapering below, clouds drifting around",
    howTo: [
      "Three.js: Geometry: terrain top plus a displaced inverted cone for the rock underside; bob it with position.y = base + sin(t) * amplitude; sky gradient background, fog and cloud sprites or planes; consider a bit of vertex-colour variation for rock strata.",
      "Blender: Displaced Subdivided plane for the top plus an inverted cone with Displace modifier for rock; World gradient sky, cloud planes with alpha textures.",
      "Godot: MeshInstance3D islands with an AnimationPlayer bob, ProceduralSkyMaterial sky and fog.",
    ],
  },
  {
    name: "exploded view",
    description:
      "A model is pulled apart along its axes with parts separated by gaps, showing how the pieces stack and fit; common in assembly diagrams. Needs the model authored in separate parts.",
    prompt:
      "{prompt}, exploded view diagram, parts separated along vertical axis with even gaps, assembly illustration",
    howTo: [
      "Three.js: No built-in. Keep sub-parts as separate Object3D children and animate each part's position from its assembled position to assembled + direction * distance * t (direction from the model centroid or the vertical axis); draw leader lines with LineSegments if needed.",
      "Blender: Separate parts as objects, animate their offsets with keyframes or drivers, or use Geometry Nodes Translate Instances by index.",
      "Godot: Child Node3D parts tweened outward from a shared centre with Tween.",
    ],
  },
  {
    name: "cutaway",
    description:
      "Part of the exterior is removed with a plane or box so the interior is visible, often with a coloured cut face. Reveals structure and interiors of buildings and monuments.",
    prompt:
      "{prompt}, architectural cutaway section revealing the interior, cut face highlighted, half of the exterior removed",
    howTo: [
      "Three.js: renderer.localClippingEnabled = true and material.clippingPlanes = [new Plane(...)] with clipIntersection / clipShadows as needed; cap the cut with the stencil technique from webgl_clipping_stencil. Boolean subtraction at the geometry level is an alternative (webgl_geometry_csg).",
      "Blender: Boolean modifier (Difference) with a cutting object, Bisect, or the viewport Clipping Region (Alt+B) for viewport only.",
      "Godot: No built-in clipping plane; use a spatial shader that discards fragments past a plane (discard) plus a cap.",
    ],
  },
  {
    name: "model sheet",
    description:
      "Front, side, back (and often top) views of the subject laid out side by side in orthographic projection with even lighting, as in character or architectural turnarounds. Used to document a design.",
    prompt:
      "{prompt}, model sheet with front, side and back orthographic views side by side, even neutral lighting, plain background",
    howTo: [
      "Three.js: Several OrthographicCameras (front, right, back, top) rendered into viewport rectangles using renderer.setViewport / setScissor / setScissorTest in one frame (webgl_multiple_views), or an ArrayCamera (webgl_camera_array); flat even lighting such as hemisphere plus ambient.",
      "Blender: Multiple Orthographic cameras on Front/Right/Back/Top with markers bound to cameras or composite renders in the Compositor, neutral lighting.",
      "Godot: Several Camera3D nodes into SubViewports laid out in a grid.",
    ],
  },
  {
    name: "seamless backdrop",
    description:
      "A curved infinity cove (cyclorama) joins floor and wall in one smooth surface so there is no horizon line or corner, only a gradient of light behind the subject. Standard clean studio staging.",
    prompt:
      "{prompt}, seamless studio backdrop with no horizon line, curved infinity cove, subtle gradient behind the subject",
    howTo: [
      "Three.js: A custom geometry whose profile is a floor, a quarter-circle curve and a wall (ExtrudeGeometry or LatheGeometry-like profile extruded along X), with a MeshStandardMaterial matching scene.background; or a large ShadowMaterial ground over a plain colour. Ground-projected skybox is another option (webgl_materials_envmaps_groundprojected).",
      "Blender: Plane with a wall edge-loop bevelled into a curve (Bevel modifier or Subdivision), or an infinite floor with the Shadow Catcher flag (Cycles Object > Visibility) over a solid world colour.",
      "Godot: MeshInstance3D with a curved cove mesh and a matte StandardMaterial3D matching the background.",
    ],
  },
  {
    name: "wireframe over clay",
    description:
      "A matte grey clay-shaded model with the wireframe lines drawn on top, showing form and topology together, as in modelling portfolio breakdowns.",
    prompt:
      "{prompt}, matte grey clay render with a thin wireframe mesh overlay on top, topology visible",
    howTo: [
      "Three.js: Render the mesh with MeshStandardMaterial (grey, roughness 1) plus a second Mesh sharing the geometry with MeshBasicMaterial { wireframe: true, polygonOffset } or a LineSegments with WireframeGeometry; thick lines via LineSegments2 / LineMaterial (webgl_lines_fat_wireframe).",
      "Blender: Clay material (Workbench or Cycles override) with a Wireframe modifier on a duplicate, or the Wireframe overlay in solid view.",
      "Godot: Grey material plus a second pass; viewport wireframe debug draw is editor/debug only.",
    ],
  },
  {
    name: "lineup",
    description:
      "Several variants of the subject (poses, colourways, levels of detail) arranged in a grid or row under identical lighting for comparison. Gives a catalogue or lookbook feel.",
    prompt:
      "{prompt}, lineup of several variants arranged in a neat grid, identical lighting and camera, catalogue contact sheet",
    howTo: [
      "Three.js: One scene with copies laid out on a grid (or InstancedMesh with per-instance colour), or one renderer with setScissorTest and a viewport per cell (webgl_multiple_elements for per-DOM-element views); keep one shared environment so differences come only from the model.",
      "Blender: Array modifier or Geometry Nodes grid of variants, one orthographic camera, identical lights.",
      "Godot: Grid of Node3D variants under a single Camera3D or SubViewports per cell.",
    ],
  },
];

/**
 * Notes for styles the starter names by name only, in a facet that is not
 * 3D (golden hour, halftone): a style named there takes its notes from here.
 */
export const NOTES_3D: Readonly<Record<string, Omit<StyleSeed, "name">>> = {
  halftone: {
    description:
      "Tone is rendered as a grid of dots (or lines) whose size follows brightness, like comic-book or newspaper print; optional RGB channels give a CMYK-ish misregistration. One cheap full-screen pass.",
    howTo: [
      "Three.js: HalftonePass (RGB halftone: shape, radius, rotateR/G/B, scatter, blending; webgl_postprocessing_rgb_halftone) or DotScreenPass for monochrome. WebGPU: per-material TSL halftone in webgpu_tsl_halftone and DotScreenNode.",
      "Blender: No node. Shader recipe: Shader to RGB, then compare luminance with a rotated dot grid built from sine functions of Window coordinates.",
      "Godot: Spatial or canvas shader using a rotated cell grid (custom).",
    ],
  },
  "shallow depth of field": {
    description:
      "Only a focal plane is sharp; nearer and farther objects blur into bokeh discs, adding scale and focus. Moderate to high cost.",
    howTo: [
      "Three.js: BokehPass (focus, aperture, maxblur; webgl_postprocessing_dof) or the bokeh2 shader in webgl_postprocessing_dof2. WebGPU: dof() from DepthOfFieldNode (webgpu_postprocessing_dof). Fake miniature look: HorizontalTiltShiftShader / VerticalTiltShiftShader.",
      "Blender: Camera Depth of Field (focus object/distance, f-stop) in EEVEE and Cycles; Compositor Defocus node as post.",
      "Godot: CameraAttributesPractical dof_blur_far_enabled / near_enabled.",
    ],
  },
  "film grain": {
    description:
      "Animated noise is added over the image, with luminance-dependent strength, to take the digital edge off and imitate film stock. Cheap.",
    howTo: [
      "Three.js: FilmPass(intensity, grayscale) in EffectComposer. WebGPU: film() from FilmNode (tsl/display/FilmNode.js).",
      "Blender: Compositor: Noise Texture mixed with Overlay or Soft Light over the image; no dedicated grain node.",
      "Godot: Screen-reading shader adding a hashed noise per frame.",
    ],
  },
  "golden hour": {
    howTo: [
      "Three.js: DirectionalLight (or SunLight) at 5-15 degrees elevation, warm colour about 0xffb36b, plus a cool HemisphereLight for sky fill; widen the shadow camera frustum (or use CSM, webgl_shadowmap_csm) so long shadows are not clipped, with PCFShadowMap and normalBias tuned.",
      "Blender: Sun light with elevation 5-10 degrees, blackbody about 3500 K, or Sky Texture Nishita with Sun Elevation near 5 degrees; Cycles for soft long shadows.",
    ],
  },
  "overcast daylight": {
    howTo: [
      "Three.js: No directional shadow: HemisphereLight with grey-blue sky and grey ground at moderate intensity, optionally a huge RectAreaLight overhead (webgl_lights_rectarealight); add GTAOPass for grounded contact darkening.",
      "Blender: World uniform light grey or Sky Texture with Sun Disc off at strength about 1; a very large Area light overhead for soft top light.",
    ],
  },
  "volumetric light": {
    howTo: [
      "Three.js: WebGL: webgl_postprocessing_godrays (screen-space radial pass from a bright source); cheap fake with additive cone or plane meshes that fade by fresnel. WebGPU: godrays() from GodraysNode (webgpu_postprocessing_godrays) and webgpu_volume_lighting for real volumetric shafts.",
      "Blender: Volume Scatter in the World or a cube volume with a Spot/Sun light shining through; EEVEE Volumes or Cycles; Compositor Glare (Streaks) is only a fake.",
    ],
  },
  "135mm telephoto lens": {
    howTo: [
      "Three.js: PerspectiveCamera with fov 8-20 degrees (or setFocalLength(85) to 300) moved far back along the view axis; combine with BokehPass depth of field for the layered look.",
      "Blender: Perspective camera with Focal Length 85-300 mm placed far from the subject.",
      "Godot: Camera3D perspective with fov 10-25 and a large distance.",
    ],
  },
};
