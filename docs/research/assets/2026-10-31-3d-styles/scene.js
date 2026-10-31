// The gallery starter's 3D pictures (packages/extension/gallery-net/src/starter-visuals.ts).
// A procedural One Pillar Pagoda (Chùa Một Cột) in a square lotus pond, with
// trees and a far tiered tower, rendered in one 3D style per call. Every
// asset is made here, from code, so each picture is our own work (CC0).
import * as THREE from "three";
import { ParametricGeometry } from "three/addons/geometries/ParametricGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const W = 480;
export const H = 360;

// ─── Geometry ───────────────────────────────────────────────────────────────

/** A hip roof with upturned corners: four curved faces meeting at a short ridge. */
function roofGeometry({ eave = 1.1, top = 0.12, height = 0.7, lift = 0.32, flare = 0.18, seg = 16 }) {
  const faces = [];
  for (let f = 0; f < 4; f++) {
    const g = new ParametricGeometry(
      (u, v, target) => {
        const s = (eave * (1 - v) + top * v) * (1 + flare * Math.abs(2 * u - 1) ** 4 * (1 - v) ** 2);
        const uu = (2 * u - 1) * s;
        const y = height * Math.pow(v, 0.65) + lift * Math.abs(2 * u - 1) ** 3 * (1 - v) ** 2.2;
        // face f: rotate (uu, s) by f*90°
        const a = (f * Math.PI) / 2;
        const x = uu, z = s;
        target.set(x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a));
      },
      seg,
      Math.max(2, Math.round(seg / 2)),
    );
    faces.push(g);
  }
  return faces;
}

function mergeish(group, geoms, mat) {
  for (const g of geoms) group.add(new THREE.Mesh(g, mat));
}

/**
 * The scene's parts, each tagged with a role so a style can colour it:
 * ground, rim, water, pillar, deck, wall, column, roof, finial, trunk,
 * leaf, lotus, stair, far.
 */
export function buildPagoda({ lowPoly = false } = {}) {
  const seg = lowPoly ? 6 : 24;
  const parts = [];
  const add = (role, geom, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) => {
    const m = new THREE.Mesh(geom);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.scale.set(...scale);
    m.userData.role = role;
    parts.push(m);
    return m;
  };
  // Ground and the square pond.
  add("ground", new THREE.BoxGeometry(14, 0.4, 14), [0, -0.2, 0]);
  const P = 3.2; // pond half-size
  const rimT = 0.3;
  for (const [x, z, w, d] of [
    [0, P + rimT / 2, 2 * P + 2 * rimT, rimT],
    [0, -P - rimT / 2, 2 * P + 2 * rimT, rimT],
    [P + rimT / 2, 0, rimT, 2 * P],
    [-P - rimT / 2, 0, rimT, 2 * P],
  ])
    add("rim", new THREE.BoxGeometry(w, 0.32, d), [x, 0.12, z]);
  add("water", new THREE.BoxGeometry(2 * P, 0.1, 2 * P), [0, 0.0, 0]);
  // Lotus pads.
  const pads = [
    [1.9, 1.4, 0.32], [2.4, -1.6, 0.26], [-2.1, 2.0, 0.3], [-1.6, -2.3, 0.24],
    [-2.6, -0.4, 0.22], [1.2, 2.5, 0.2], [2.6, 0.6, 0.18], [-0.9, -2.7, 0.2],
  ];
  for (const [x, z, r] of pads) add("lotus", new THREE.CylinderGeometry(r, r, 0.03, lowPoly ? 7 : 20), [x, 0.07, z]);
  for (const [x, z] of [[1.9, 1.4], [-2.1, 2.0], [-1.6, -2.3]])
    add("flower", new THREE.ConeGeometry(0.09, 0.16, lowPoly ? 5 : 10), [x + 0.05, 0.16, z], [Math.PI, 0, 0]);
  // The one pillar and its bracket.
  add("pillar", new THREE.CylinderGeometry(0.22, 0.26, 1.5, seg), [0, 0.8, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const strut = add("deck", new THREE.BoxGeometry(0.08, 0.8, 0.08), [Math.cos(a) * 0.38, 1.25, Math.sin(a) * 0.38]);
    strut.rotation.set(0, 0, 0);
    strut.lookAt(Math.cos(a) * 0.9, 1.65, Math.sin(a) * 0.9);
    strut.rotateX(Math.PI / 2);
  }
  add("deck", new THREE.BoxGeometry(1.9, 0.12, 1.9), [0, 1.62, 0]);
  // Railing.
  for (const [x, z, w, d] of [
    [0, 0.9, 1.84, 0.05], [0, -0.9, 1.84, 0.05], [0.9, 0, 0.05, 1.84], [-0.9, 0, 0.05, 1.84],
  ])
    add("deck", new THREE.BoxGeometry(w, 0.05, d), [x, 1.92, z]);
  // The shrine: walls and corner columns.
  add("wall", new THREE.BoxGeometry(1.15, 0.85, 1.15), [0, 2.1, 0]);
  for (const [x, z] of [[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]])
    add("column", new THREE.CylinderGeometry(0.05, 0.05, 0.95, lowPoly ? 6 : 12), [x, 2.12, z]);
  add("door", new THREE.BoxGeometry(0.42, 0.55, 0.02), [0, 2.0, 0.585]);
  // Roof.
  const roof = new THREE.Group();
  for (const g of roofGeometry({ seg: lowPoly ? 4 : 18 })) {
    const m = new THREE.Mesh(g);
    m.userData.role = "roof";
    roof.add(m);
  }
  roof.position.y = 2.5;
  roof.userData.role = "group";
  parts.push(roof);
  add("finial", new THREE.SphereGeometry(0.09, lowPoly ? 6 : 16, lowPoly ? 4 : 12), [0, 3.28, 0]);
  add("finial", new THREE.CylinderGeometry(0.03, 0.05, 0.22, 8), [0, 3.15, 0]);
  // A stair from the rim to the deck.
  for (let i = 0; i < 9; i++)
    add("stair", new THREE.BoxGeometry(0.55, 0.08, 0.3), [0, 0.2 + i * 0.16, 3.2 - i * 0.27]);
  // Trees.
  const trees = [
    [-4.6, -3.6, 1.0], [4.4, -4.2, 1.2], [-5.2, 2.6, 0.9], [5.0, 1.8, 0.8], [-3.9, -5.4, 0.8],
  ];
  for (const [x, z, s] of trees) {
    add("trunk", new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.6 * s, lowPoly ? 5 : 10), [x, 0.8 * s, z]);
    add("leaf", new THREE.IcosahedronGeometry(1.0 * s, lowPoly ? 0 : 2), [x, 2.0 * s, z]);
    add("leaf", new THREE.IcosahedronGeometry(0.7 * s, lowPoly ? 0 : 2), [x + 0.5 * s, 2.6 * s, z - 0.2 * s]);
  }
  // A far tiered tower.
  const tower = [-1.0, 0, -6.2];
  for (let t = 0; t < 4; t++) {
    const s = 1 - t * 0.17;
    add("far", new THREE.BoxGeometry(1.1 * s, 0.7, 1.1 * s), [tower[0], 0.35 + t * 0.9, tower[2]]);
    const r = new THREE.Group();
    for (const g of roofGeometry({ eave: 0.85 * s, top: 0.5 * s, height: 0.2, lift: 0.14, seg: lowPoly ? 4 : 12 })) {
      const m = new THREE.Mesh(g);
      m.userData.role = "roof";
      r.add(m);
    }
    r.position.set(tower[0], 0.7 + t * 0.9, tower[2]);
    r.userData.role = "group";
    parts.push(r);
  }
  return parts;
}

/** Every mesh, the roof groups' faces included. */
function meshes(parts) {
  const out = [];
  for (const p of parts) p.traverse((o) => o.isMesh && out.push(o));
  return out;
}

// ─── Shaders ────────────────────────────────────────────────────────────────

/** Edges from a normal+depth buffer, multiplied over the colour (Sobel-like). */
const EdgeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(W, H) },
    thickness: { value: 1.0 },
    color: { value: new THREE.Color(0x111111) },
    strength: { value: 1.0 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100 },
    ortho: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse, tNormal, tDepth; uniform vec2 resolution; uniform float thickness, strength, cameraNear, cameraFar, ortho; uniform vec3 color;
    varying vec2 vUv;
    float lin(vec2 uv){ float d=texture2D(tDepth,uv).x; if(ortho>0.5) return d*(cameraFar-cameraNear)+cameraNear; return perspectiveDepthToViewZ(d,cameraNear,cameraFar)*-1.0; }
    vec3 nrm(vec2 uv){ return texture2D(tNormal,uv).xyz*2.0-1.0; }
    void main(){
      vec2 px = thickness/resolution;
      float d0=lin(vUv); vec3 n0=nrm(vUv);
      float de=0.0, ne=0.0;
      for(int i=0;i<4;i++){
        vec2 o = i==0?vec2(px.x,0.):i==1?vec2(-px.x,0.):i==2?vec2(0.,px.y):vec2(0.,-px.y);
        de += abs(lin(vUv+o)-d0);
        ne += 1.0-dot(nrm(vUv+o),n0);
      }
      float e = clamp(smoothstep(0.02*d0, 0.06*d0, de) + smoothstep(0.25,0.6,ne), 0.0, 1.0)*strength;
      vec4 c=texture2D(tDiffuse,vUv);
      gl_FragColor = vec4(mix(c.rgb,color,e), c.a);
    }`,
};

/** Paper: a warm fibre grain multiplied over the image, with an optional misregistration. */
const PaperShader = {
  uniforms: {
    tDiffuse: { value: null },
    paper: { value: new THREE.Color(0xf3e8cf) },
    grain: { value: 0.12 },
    shift: { value: new THREE.Vector2(0, 0) },
    resolution: { value: new THREE.Vector2(W, H) },
    keepWhite: { value: 1.0 },
  },
  vertexShader: EdgeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 paper; uniform float grain, keepWhite; uniform vec2 shift, resolution; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
    void main(){
      vec2 p = vUv*resolution;
      vec3 c = texture2D(tDiffuse,vUv).rgb;
      vec3 s = texture2D(tDiffuse,vUv+shift/resolution).rgb;
      c = min(c, mix(vec3(1.0), s, 0.5));
      float fib = n(p*vec2(0.08,0.9))*0.6 + n(p*0.35)*0.4;
      float g = 1.0 - grain*(fib-0.5)*2.0 - grain*0.5*h(p);
      vec3 base = mix(c, c*paper, keepWhite);
      gl_FragColor = vec4(base*g, 1.0);
    }`,
};

/** A four-sector Kuwahara filter: flat, brushy regions with crisp edges. */
const KuwaharaShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(W, H) }, radius: { value: 4 } },
  vertexShader: EdgeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform int radius; varying vec2 vUv;
    void main(){
      vec2 px=1.0/resolution; vec3 m[4]; vec3 s[4];
      for(int k=0;k<4;k++){ m[k]=vec3(0.); s[k]=vec3(0.); }
      float n=0.;
      for(int j=0;j<=6;j++) for(int i=0;i<=6;i++){
        if(i>radius||j>radius) continue;
        vec3 a=texture2D(tDiffuse,vUv+vec2(-i,-j)*px).rgb; m[0]+=a; s[0]+=a*a;
        vec3 b=texture2D(tDiffuse,vUv+vec2( i,-j)*px).rgb; m[1]+=b; s[1]+=b*b;
        vec3 c=texture2D(tDiffuse,vUv+vec2( i, j)*px).rgb; m[2]+=c; s[2]+=c*c;
        vec3 d=texture2D(tDiffuse,vUv+vec2(-i, j)*px).rgb; m[3]+=d; s[3]+=d*d;
        n+=1.;
      }
      float best=1e9; vec3 col=vec3(0.);
      for(int k=0;k<4;k++){ vec3 mu=m[k]/n; vec3 v=abs(s[k]/n-mu*mu); float sv=v.r+v.g+v.b; if(sv<best){best=sv; col=mu;} }
      gl_FragColor=vec4(col,1.0);
    }`,
};

/** Ordered (Bayer 4×4) dithering to a small palette per channel. */
const DitherShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(W, H) }, levels: { value: 4 }, scale: { value: 1 } },
  vertexShader: EdgeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float levels, scale; varying vec2 vUv;
    float bayer(vec2 p){ int x=int(mod(p.x,4.)), y=int(mod(p.y,4.)); int i=x+y*4;
      int m[16]; m[0]=0;m[1]=8;m[2]=2;m[3]=10;m[4]=12;m[5]=4;m[6]=14;m[7]=6;m[8]=3;m[9]=11;m[10]=1;m[11]=9;m[12]=15;m[13]=7;m[14]=13;m[15]=5;
      for(int k=0;k<16;k++) if(k==i) return float(m[k])/16.0; return 0.; }
    void main(){ vec2 p=floor(vUv*resolution/scale); vec3 c=texture2D(tDiffuse,(p+0.5)*scale/resolution).rgb;
      float t=bayer(p)-0.5; gl_FragColor=vec4(floor(c*levels+t+0.5)/levels,1.0);} `,
};

/** Grade: a tint, contrast and vignette in one pass. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Color(1, 1, 1) },
    contrast: { value: 1.0 },
    saturation: { value: 1.0 },
    vignette: { value: 0.0 },
    mono: { value: 0.0 },
  },
  vertexShader: EdgeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float contrast, saturation, vignette, mono; varying vec2 vUv;
    void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float l=dot(c,vec3(0.299,0.587,0.114));
      c=mix(vec3(l),c,saturation); c=mix(c,vec3(l),mono); c=(c-0.5)*contrast+0.5; c*=tint;
      float v=distance(vUv,vec2(0.5)); c*=1.0-vignette*smoothstep(0.35,0.8,v); gl_FragColor=vec4(c,1.0);} `,
};

/** Two-ink risograph: pink and blue halftone dots on paper, the inks slightly out of register. */
const RisoShader = {
  uniforms: {
    tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(W, H) },
    inkA: { value: new THREE.Color(0xff48b0) }, inkB: { value: new THREE.Color(0x0078bf) },
    paper: { value: new THREE.Color(0xf6efe2) }, size: { value: 4.0 },
  },
  vertexShader: EdgeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform vec3 inkA, inkB, paper; uniform float size; varying vec2 vUv;
    float dots(vec2 p, float a, float v){ mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 q=r*p/size; vec2 cell=fract(q)-0.5; float rad=sqrt(clamp(v,0.,1.))*0.62; return smoothstep(rad+0.06, rad-0.06, length(cell)); }
    void main(){ vec2 p=vUv*resolution;
      vec3 a=texture2D(tDiffuse,vUv).rgb; vec3 b=texture2D(tDiffuse,vUv+vec2(1.5,-1.0)/resolution).rgb;
      float ca=dots(p,0.26,smoothstep(0.2,1.0,1.0-a.g)); float cb=dots(p+vec2(1.5,-1.0),1.05,smoothstep(0.2,1.0,1.0-b.r));
      vec3 c=paper*mix(vec3(1.),inkA,ca*0.9)*mix(vec3(1.),inkB,cb*0.9);
      gl_FragColor=vec4(c,1.0);} `,
};

// ─── Materials helpers ──────────────────────────────────────────────────────

function gradientMap(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const t = new THREE.DataTexture(data, steps.length, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function matcap(stops) {
  return canvasTexture(256, (g, s) => {
    const grad = g.createRadialGradient(s * 0.38, s * 0.32, s * 0.02, s * 0.5, s * 0.5, s * 0.5);
    stops.forEach(([o, c]) => grad.addColorStop(o, c));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** Add an inverted hull: a back-face shell pushed out along normals, drawn in `color`. */
function hull(scene, list, color, width) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 transformed = position + normal * ${width.toFixed(4)};`,
    );
  };
  for (const m of list) {
    if (m.userData.role === "water" || m.userData.role === "ground") continue;
    const h = new THREE.Mesh(m.geometry, mat);
    m.add(h);
  }
}

/** Hard edges drawn as lines. */
function edges(list, color, threshold = 30, opacity = 1) {
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  for (const m of list) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, threshold), mat));
}

/** Snap clip-space vertices to a coarse grid: the PS1's wobble. */
function snapVertices(mat, grid) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       vec2 g = vec2(${grid[0].toFixed(1)}, ${grid[1].toFixed(1)});
       gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g) / g * gl_Position.w;`,
    );
  };
  return mat;
}

/** A fresnel rim added to a standard material's emission. */
function rim(mat, color, power = 2.5, strength = 1.0) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), ${power.toFixed(2)});
       totalEmissiveRadiance += vec3(${color.r.toFixed(3)}, ${color.g.toFixed(3)}, ${color.b.toFixed(3)}) * fr * ${strength.toFixed(2)};`,
    );
  };
  return mat;
}

// ─── Cameras ────────────────────────────────────────────────────────────────

function perspective(pos = [8.5, 5.2, 9.5], target = [0, 1.6, 0], fov = 38) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 100);
  cam.position.set(...pos);
  cam.lookAt(...target);
  return cam;
}

function isometric(size = 7.5, target = [0, 0.8, 0]) {
  const cam = new THREE.OrthographicCamera((-size * W) / H, (size * W) / H, size, -size, 0.1, 100);
  const d = 20;
  cam.position.set(target[0] + d, target[1] + d * Math.tan(Math.atan(1 / Math.SQRT2)) * Math.SQRT2, target[2] + d);
  cam.lookAt(...target);
  return cam;
}

// ─── Render plumbing ────────────────────────────────────────────────────────

function renderer() {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(W, H);
  r.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(r.domElement);
  return r;
}

/** Normal and depth of the scene, for the edge pass. */
function normalDepth(r, scene, cam) {
  const depthTexture = new THREE.DepthTexture(W, H);
  const target = new THREE.WebGLRenderTarget(W, H, { depthTexture, samples: 0 });
  const normalMat = new THREE.MeshNormalMaterial();
  const hidden = [];
  scene.traverse((o) => {
    if ((o.isLineSegments || o.userData.noEdge) && o.visible) {
      hidden.push(o);
      o.visible = false;
    }
  });
  const bg = scene.background;
  scene.background = null;
  scene.overrideMaterial = normalMat;
  r.setRenderTarget(target);
  r.setClearColor(0x8080ff, 1);
  r.clear();
  r.render(scene, cam);
  r.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.background = bg;
  for (const o of hidden) o.visible = true;
  return target;
}

function edgePass(r, scene, cam, opts = {}) {
  const nd = normalDepth(r, scene, cam);
  const pass = new ShaderPass(EdgeShader);
  pass.uniforms.tNormal.value = nd.texture;
  pass.uniforms.tDepth.value = nd.depthTexture;
  pass.uniforms.cameraNear.value = cam.near;
  pass.uniforms.cameraFar.value = cam.far;
  pass.uniforms.ortho.value = cam.isOrthographicCamera ? 1 : 0;
  pass.uniforms.thickness.value = opts.thickness ?? 1;
  pass.uniforms.strength.value = opts.strength ?? 1;
  pass.uniforms.color.value = new THREE.Color(opts.color ?? 0x111111);
  return pass;
}

function sky(top, bottom) {
  return canvasTexture(256, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

function colourParts(list, palette, make) {
  for (const m of list) {
    const c = palette[m.userData.role] ?? palette.default ?? 0xcccccc;
    m.material = make(c, m.userData.role);
  }
}

function sun(scene, { color = 0xffffff, intensity = 2.2, pos = [6, 10, 4], shadow = true, ambient = 0.6, sky: skyC = 0xbfd8ff, groundC = 0x8a7a5a } = {}) {
  const d = new THREE.DirectionalLight(color, intensity);
  d.position.set(...pos);
  if (shadow) {
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    Object.assign(d.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
    d.shadow.bias = -0.0006;
    d.shadow.normalBias = 0.02;
    d.shadow.radius = 4;
  }
  scene.add(d);
  scene.add(new THREE.HemisphereLight(skyC, groundC, ambient));
  return d;
}

function shadows(list) {
  for (const m of list) {
    m.castShadow = m.userData.role !== "ground" && m.userData.role !== "water";
    m.receiveShadow = true;
  }
}

// ─── The styles ─────────────────────────────────────────────────────────────

const WARM = {
  ground: 0x9fb46a, rim: 0x9a8f80, water: 0x4f8fa0, lotus: 0x4e8a3a, flower: 0xe58aa6,
  pillar: 0x8f8a80, deck: 0x7a3b22, wall: 0x9c3a24, column: 0x5a2414, door: 0x3a1a10,
  roof: 0x5c4a3c, finial: 0xc49a3a, stair: 0x9a8f80, trunk: 0x6b4a2e, leaf: 0x4f8a3c, far: 0xb8a690,
};

export const STYLES = {
  "cel-shaded": (r) => {
    const scene = new THREE.Scene();
    scene.background = sky("#5fb3f0", "#cfeeff");
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const grad = gradientMap([90, 170, 255]);
    colourParts(list, { ...WARM, ground: 0x8fd16a, water: 0x3fb3d0, wall: 0xd8462a, roof: 0x3a4f7a, leaf: 0x3fae4a, deck: 0xa8502a }, (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad }));
    hull(scene, list, 0x1a1020, 0.035);
    sun(scene, { intensity: 2.6, ambient: 0.9, shadow: true, pos: [5, 9, 7] });
    shadows(list);
    r.shadowMap.enabled = true;
    const cam = perspective();
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(edgePass(r, scene, cam, { color: 0x1a1020, strength: 0.9 }));
    comp.addPass(new OutputPass());
    return comp;
  },

  "white model": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e9ec);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    colourParts(list, { default: 0xf4f4f2, water: 0xdfe3e6, ground: 0xededeb }, (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    sun(scene, { intensity: 1.6, ambient: 1.4, sky: 0xffffff, groundC: 0xb0b0b0, pos: [-6, 12, 6] });
    shadows(list);
    const cam = perspective([9, 6.5, 8.5]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const ao = new GTAOPass(scene, cam, W, H);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 2.0, scale: 1.4 });
    ao.blendIntensity = 1.0;
    comp.addPass(ao);
    comp.addPass(new OutputPass());
    return comp;
  },

  "low-poly": (r) => {
    const scene = new THREE.Scene();
    scene.background = sky("#f6b06b", "#ffe2b8");
    const parts = buildPagoda({ lowPoly: true });
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    colourParts(list, { ...WARM, ground: 0xc9b25a, leaf: 0x6f9a3a, water: 0x5aa0b0, wall: 0xc0502a, roof: 0x6b3f2a }, (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    r.shadowMap.enabled = true;
    sun(scene, { color: 0xffc58a, intensity: 3.0, ambient: 0.7, sky: 0xffd9a8, groundC: 0x6a4a3a, pos: [9, 4, 3] });
    shadows(list);
    const cam = perspective([8.8, 4.6, 9.6]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(new OutputPass());
    return comp;
  },

  "lacquer (sơn mài)": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070504);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const eggshell = canvasTexture(512, (g, s) => {
      g.fillStyle = "#0b0706";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * s, y = Math.random() * s, k = 3 + Math.random() * 9;
        g.fillStyle = `rgba(${235 + Math.random() * 20},${225 + Math.random() * 20},${200 + Math.random() * 20},0.9)`;
        g.beginPath();
        g.moveTo(x, y);
        for (let j = 0; j < 4; j++) g.lineTo(x + (Math.random() - 0.5) * k * 2, y + (Math.random() - 0.5) * k * 2);
        g.fill();
      }
    });
    eggshell.wrapS = eggshell.wrapT = THREE.RepeatWrapping;
    eggshell.repeat.set(3, 3);
    const gold = new THREE.Color(0xd9a440);
    colourParts(list, { default: 0x6a1a0e }, (c, role) => {
      if (role === "roof" || role === "finial" || role === "lotus" || role === "flower")
        return rim(new THREE.MeshStandardMaterial({ color: 0xc8922c, metalness: 1, roughness: 0.32 }), gold, 2.5, 0.5);
      if (role === "ground") return new THREE.MeshStandardMaterial({ map: eggshell, roughness: 0.35 });
      if (role === "water") return new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 0.08, metalness: 0.2 });
      if (role === "leaf") return rim(new THREE.MeshStandardMaterial({ color: 0x1a0604, roughness: 0.35 }), gold, 3.5, 0.9);
      if (role === "far") return rim(new THREE.MeshStandardMaterial({ color: 0x1a0805, roughness: 0.3 }), gold, 2.5, 0.8);
      return rim(new THREE.MeshStandardMaterial({ color: role === "wall" ? 0x8e1d10 : c, roughness: 0.22 }), new THREE.Color(0xe0a050), 3.0, 0.6);
    });
    const key = new THREE.DirectionalLight(0xffd9a0, 2.2);
    key.position.set(-5, 8, 6);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x402010, 0.6));
    const cam = perspective([8.5, 4.8, 9.8]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.22, 0.4, 0.9));
    comp.addPass(new OutputPass());
    const g = new ShaderPass(GradeShader);
    g.uniforms.contrast.value = 1.12;
    g.uniforms.vignette.value = 0.5;
    comp.addPass(g);
    return comp;
  },

  "woodblock print 3D": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1e3c2);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const grad = gradientMap([150, 255]);
    colourParts(list, {
      ground: 0xe8d6a8, rim: 0xd9c49a, water: 0x6f8fa0, lotus: 0x4a7a3a, flower: 0xc8402a, pillar: 0xd9c49a,
      deck: 0xb8382a, wall: 0xc8402a, column: 0x2a1a14, door: 0x2a1a14, roof: 0x2f3a3a, finial: 0xd9a030,
      stair: 0xd9c49a, trunk: 0x4a3020, leaf: 0x5f8a3a, far: 0xd9b070,
    }, (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad }));
    sun(scene, { intensity: 2.0, ambient: 1.2, shadow: false, pos: [4, 9, 8] });
    const cam = perspective([8.2, 5.6, 9.8]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(edgePass(r, scene, cam, { color: 0x1a120c, thickness: 1.6, strength: 1 }));
    comp.addPass(new OutputPass());
    const paper = new ShaderPass(PaperShader);
    paper.uniforms.grain.value = 0.16;
    paper.uniforms.shift.value.set(2.0, -1.5);
    comp.addPass(paper);
    return comp;
  },

  "ink wash 3D": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2efe6);
    scene.fog = new THREE.Fog(0xf2efe6, 9, 26);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    // Far mountains.
    for (const [x, z, h, s] of [[-9, -16, 7, 6], [-2, -19, 9, 7], [7, -15, 6, 5], [13, -20, 8, 7]]) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(s, h, 7));
      m.position.set(x, h / 2 - 0.5, z);
      m.userData.role = "mountain";
      parts.push(m);
      scene.add(m);
    }
    const list = meshes(parts);
    colourParts(list, {
      default: 0xbab6ae, ground: 0xf2efe6, water: 0xe4e1d9, rim: 0xcfcac0, roof: 0x34322e, leaf: 0x55524c,
      trunk: 0x2a2826, wall: 0x8a867e, mountain: 0x8a877f, far: 0x9f9b93, lotus: 0x6a675f, flower: 0x6a675f,
    }, (c) => new THREE.MeshLambertMaterial({ color: c }));
    sun(scene, { intensity: 1.4, ambient: 1.3, shadow: false, sky: 0xffffff, groundC: 0xb0aaa0, pos: [-4, 10, 6] });
    const cam = perspective([7.5, 4.2, 10.5], [0, 2.2, -1]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const k = new ShaderPass(KuwaharaShader);
    k.uniforms.radius.value = 4;
    comp.addPass(k);
    comp.addPass(edgePass(r, scene, cam, { color: 0x24221f, thickness: 1.4, strength: 0.85 }));
    comp.addPass(new OutputPass());
    const g = new ShaderPass(GradeShader);
    g.uniforms.mono.value = 1.0;
    g.uniforms.contrast.value = 1.1;
    comp.addPass(g);
    const paper = new ShaderPass(PaperShader);
    paper.uniforms.paper.value = new THREE.Color(0xf6f0e0);
    paper.uniforms.grain.value = 0.1;
    comp.addPass(paper);
    return comp;
  },

  "PS1 retro": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6a5a78);
    scene.fog = new THREE.Fog(0x6a5a78, 9, 22);
    const parts = buildPagoda({ lowPoly: true });
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    // A crude, nearest-filtered checker on the ground: the PS1's wobbly texture.
    const tex = canvasTexture(32, (g, s) => {
      for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) {
        g.fillStyle = (x + y) % 8 === 0 ? "#556b2f" : "#4a5e28";
        g.fillRect(x, y, 4, 4);
      }
    });
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    colourParts(list, { ...WARM, water: 0x2f5a7a, roof: 0x4a3a2a }, (c, role) =>
      snapVertices(role === "ground" ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ color: c, flatShading: true }), [80, 60]),
    );
    sun(scene, { color: 0xffd0a0, intensity: 2.6, ambient: 1.3, shadow: false, pos: [5, 7, 4] });
    const cam = perspective([7.6, 3.6, 9.0], [0, 1.8, 0], 50);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPixelatedPass(3, scene, cam, { normalEdgeStrength: 0, depthEdgeStrength: 0 }));
    const d = new ShaderPass(DitherShader);
    d.uniforms.levels.value = 24;
    d.uniforms.scale.value = 3;
    comp.addPass(d);
    comp.addPass(new OutputPass());
    return comp;
  },

  blueprint: (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14427a);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts).filter((m) => !["leaf", "trunk", "lotus", "flower", "ground"].includes(m.userData.role));
    for (const m of meshes(parts)) if (!list.includes(m)) m.visible = false;
    for (const m of list) {
      m.material = new THREE.MeshBasicMaterial({ color: 0x14427a, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    }
    edges(list, 0xe6f0ff, 25);
    const grid = new THREE.GridHelper(16, 32, 0x5f8fc8, 0x2f68a8);
    grid.position.y = -0.01;
    scene.add(grid);
    const cam = isometric(4.9, [0.3, 1.2, -0.6]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(new OutputPass());
    return comp;
  },

  "isometric diorama": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3e6d8);
    const parts = buildPagoda();
    // A plinth with soil layers: the ground becomes a thick block.
    const ground = parts.find((p) => p.userData.role === "ground");
    ground.geometry = new THREE.BoxGeometry(12, 0.4, 12);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 12));
    soil.position.y = -1.1;
    soil.userData.role = "soil";
    parts.push(soil);
    const rock = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 12));
    rock.position.y = -2.05;
    rock.userData.role = "rock";
    parts.push(rock);
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    colourParts(list, { ...WARM, ground: 0x9ccf6a, soil: 0x8a5a3a, rock: 0x6a6460, water: 0x5fc0d8, wall: 0xe0603a, roof: 0x4a5a8a, leaf: 0x5fb04a }, (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    sun(scene, { intensity: 2.4, ambient: 1.1, pos: [-5, 12, 8] });
    shadows(list);
    const cam = isometric(6.3, [0, -0.2, 0]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const ao = new GTAOPass(scene, cam, W, H);
    ao.blendIntensity = 0.8;
    comp.addPass(ao);
    comp.addPass(new OutputPass());
    return comp;
  },

  "clay render": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x3a3634);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const clay = matcap([[0, "#f2d2b8"], [0.45, "#c98a64"], [0.8, "#7a4630"], [1, "#2a1810"]]);
    colourParts(list, {}, () => new THREE.MeshMatcapMaterial({ matcap: clay }));
    const cam = perspective([8.0, 5.0, 9.0], [0, 1.8, 0]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const ao = new GTAOPass(scene, cam, W, H);
    ao.blendIntensity = 0.9;
    comp.addPass(ao);
    comp.addPass(new OutputPass());
    return comp;
  },

  voxel: (r) => {
    const scene = new THREE.Scene();
    scene.background = sky("#8fd0ff", "#e4f5ff");
    const V = 0.2;
    const cells = [];
    const P = 3.2;
    const inside = (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      if (y < 0) return ax < 6.4 && az < 6.4 ? (y > -0.2 ? 0x7fbf4a : 0x8a5a3a) : null;
      if (y < 0.3 && ax < P + 0.3 && az < P + 0.3 && (ax > P || az > P)) return 0x9a948a;
      if (y < 0.1 && ax < P && az < P) return 0x4f9fc8;
      if (Math.hypot(x, z) < 0.25 && y < 1.6) return 0x8f8a80;
      if (y >= 1.55 && y < 1.7 && ax < 0.95 && az < 0.95) return 0x8a3f22;
      if (y >= 1.7 && y < 2.5 && ax < 0.6 && az < 0.6) return az > 0.5 && ax < 0.2 && y < 2.3 ? 0x3a1a10 : 0xb0402a;
      const ry = y - 2.5;
      if (ry >= 0 && ry < 0.8) {
        const s = 1.15 * (1 - ry / 0.8) + 0.1;
        if (Math.max(ax, az) < s && Math.max(ax, az) > s - 0.35) return 0x4a3a30;
      }
      if (Math.hypot(x, z) < 0.12 && y >= 3.3 && y < 3.5) return 0xd0a030;
      for (const [tx, tz, s] of [[-4.6, -3.6, 1], [4.4, -4.2, 1.2], [-5.2, 2.6, 0.9], [5, 1.8, 0.8]]) {
        if (Math.hypot(x - tx, z - tz) < 0.18 * s && y < 1.6 * s) return 0x6b4a2e;
        if (Math.hypot(x - tx, y - 2.0 * s, z - tz) < 1.0 * s) return 0x4f9a3c;
      }
      for (let t = 0; t < 4; t++) {
        const s = (1 - t * 0.17) * 0.55;
        const ly = y - t * 0.9;
        if (ly >= 0 && ly < 0.7 && Math.abs(x + 1) < s && Math.abs(z + 6.2) < s) return 0xb8a690;
        if (ly >= 0.7 && ly < 0.9 && Math.abs(x + 1) < s + 0.3 && Math.abs(z + 6.2) < s + 0.3) return 0x4a3a30;
      }
      for (let i = 0; i < 9; i++) if (Math.abs(x) < 0.28 && Math.abs(z - (3.2 - i * 0.27)) < 0.15 && y < 0.24 + i * 0.16 && y > 0.12 + i * 0.16) return 0x9a948a;
      return null;
    };
    for (let x = -6.3; x < 6.4; x += V)
      for (let y = -0.39; y < 3.6; y += V)
        for (let z = -7.2; z < 6.4; z += V) {
          const c = inside(x, y, z);
          if (c !== null) cells.push([x, y, z, c]);
        }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V, V), new THREE.MeshStandardMaterial({ roughness: 0.9 }), cells.length);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    cells.forEach(([x, y, z, c], i) => {
      mtx.makeTranslation(x, y, z);
      inst.setMatrixAt(i, mtx);
      inst.setColorAt(i, col.setHex(c));
    });
    inst.castShadow = inst.receiveShadow = true;
    scene.add(inst);
    r.shadowMap.enabled = true;
    sun(scene, { intensity: 2.4, ambient: 1.0, pos: [6, 11, 5] });
    const cam = perspective([8.5, 5.4, 9.5]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const ao = new GTAOPass(scene, cam, W, H);
    ao.blendIntensity = 0.7;
    comp.addPass(ao);
    comp.addPass(new OutputPass());
    return comp;
  },

  "vaporwave 3D": (r) => {
    const scene = new THREE.Scene();
    scene.background = canvasTexture(512, (g, s) => {
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, "#1a0638");
      grad.addColorStop(0.55, "#a0207a");
      grad.addColorStop(1, "#ff8a5a");
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      const sg = g.createLinearGradient(0, s * 0.25, 0, s * 0.62);
      sg.addColorStop(0, "#ffe25a");
      sg.addColorStop(1, "#ff3a8a");
      g.fillStyle = sg;
      g.beginPath();
      g.arc(s / 2, s * 0.48, s * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#a0207a";
      for (let i = 0; i < 6; i++) g.fillRect(0, s * (0.5 + i * 0.03), s, 3 + i * 1.5);
    });
    const parts = buildPagoda().filter((p) => !["ground", "trunk", "leaf"].includes(p.userData.role));
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const chrome = matcap([[0, "#ffffff"], [0.3, "#7ff0ff"], [0.55, "#ff5ad0"], [0.8, "#3a1a6a"], [1, "#0a0420"]]);
    colourParts(list, {}, (c, role) => (role === "water" ? new THREE.MeshBasicMaterial({ color: 0x12062a }) : new THREE.MeshMatcapMaterial({ matcap: chrome })));
    const grid = new THREE.GridHelper(40, 40, 0xff4ad8, 0x30e0ff);
    grid.position.y = 0.06;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x12062a }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.0;
    scene.add(floor);
    const cam = perspective([7.0, 2.6, 9.5], [0, 2.2, -2], 44);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.5, 0.55));
    comp.addPass(new OutputPass());
    return comp;
  },

  "risograph 3D": (r) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4eee0);
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    const grad = gradientMap([110, 200, 255]);
    colourParts(list, { ...WARM, ground: 0xf4eee0, water: 0x3a7ab8, wall: 0xe8462a, roof: 0x2a4a8a, leaf: 0x2f9a6a, rim: 0xd8d0c0, stair: 0xd8d0c0 }, (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad }));
    sun(scene, { intensity: 2.2, ambient: 1.0, shadow: false, pos: [5, 9, 6] });
    const cam = perspective([8.2, 5.0, 9.4]);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    comp.addPass(new OutputPass());
    comp.addPass(new ShaderPass(RisoShader));
    const paper = new ShaderPass(PaperShader);
    paper.uniforms.grain.value = 0.08;
    paper.uniforms.shift.value.set(1.5, 1.0);
    comp.addPass(paper);
    return comp;
  },

  miniature: (r) => {
    const scene = new THREE.Scene();
    scene.background = sky("#9fd4ff", "#e8f6ff");
    const parts = buildPagoda();
    parts.forEach((p) => scene.add(p));
    const list = meshes(parts);
    colourParts(list, { ...WARM, ground: 0x7fc04a, water: 0x3fa8c8, wall: 0xd84a2a, leaf: 0x3f9a3a }, (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    sun(scene, { intensity: 3.0, ambient: 1.0, pos: [6, 12, 3] });
    shadows(list);
    const cam = perspective([10.5, 9.0, 10.5], [0, 1.0, 0], 30);
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, cam));
    const hts = new ShaderPass(HorizontalTiltShiftShader);
    hts.uniforms.h.value = 3.4 / W;
    hts.uniforms.r.value = 0.52;
    const vts = new ShaderPass(VerticalTiltShiftShader);
    vts.uniforms.v.value = 3.4 / H;
    vts.uniforms.r.value = 0.52;
    comp.addPass(hts);
    comp.addPass(vts);
    comp.addPass(new OutputPass());
    const g = new ShaderPass(GradeShader);
    g.uniforms.saturation.value = 1.35;
    g.uniforms.contrast.value = 1.08;
    comp.addPass(g);
    return comp;
  },
};

export function render(name) {
  const r = renderer();
  const comp = STYLES[name](r);
  comp.render();
  return r.domElement.toDataURL("image/jpeg", 0.82);
}
