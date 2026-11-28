// Course Explorer: one three.js viewer for ski resorts and disc golf courses.
// Data comes from web/data/<key>.js (baked by tools/build_*.py).
import * as THREE from "three";
const MARKS = [["module start", Math.round(performance.now())]];   // startup timings: add ?perf=1 to see them in the console
const mark = (n) => MARKS.push([n, Math.round(performance.now())]);
window.__marks = MARKS;
import { MapControls } from "three/addons/controls/MapControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const KEY = /^[a-z0-9-]+$/.test(params.get("c") || "") ? params.get("c") : "maplehill";

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("missing " + src));
    document.head.appendChild(s);
  });
}

await loadScript(`data/${KEY}.js?v=202611280846`);
mark("data loaded");
// Open / closed status: a small JSON next to the data (demo data now; a real feed fills the same shape).
let STATUS = null, statusVisible = true;
try { const r = await fetch(`data/${KEY}.status.json`, { cache: "no-store" }); if (r.ok) STATUS = await r.json(); } catch (e) { /* no status layer */ }
const ST_VAL = { open: 0, preparing: 0.5, closed: 1 };
const stateOf = (f) => (STATUS && statusVisible ? ST_VAL[f.status] ?? 0 : 0);
const D = window.COURSE_DATA[KEY];
const SKI = D.kind === "ski";
if (STATUS) {
  const low = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  STATUS.lifts = low(STATUS.lifts); STATUS.pistes = low(STATUS.pistes);
  for (const f of D.features) f.status = (f.kind === "lift" ? STATUS.lifts[String(f.name).toLowerCase()] : f.kind === "piste" ? STATUS.pistes[String(f.ref || "").toLowerCase()] : null) ?? null;
}
// disc golf: one hole line per number for the chosen tee set + pin position
let LAYOUT = D.layouts && D.layouts.includes(params.get("layout")) ? params.get("layout") : (D.layouts || [])[0];
const PIN = D.pins && D.pins.includes(params.get("pin")) ? params.get("pin") : (D.pins || [])[0];
function computeListed() {
  const byNum = new Map();
  for (const f of D.features) {
    if (f.kind !== "hole") continue;
    f.listed = false;
    const teeOk = !f.tees.length || f.tees.includes(LAYOUT);
    if (!teeOk) continue;
    const score = (f.pin === PIN ? 2 : f.pin == null ? 1 : 0) + (f.tees.length ? 0.5 : 0);
    const prev = byNum.get(f.number);
    if (!prev || score > prev.score) byNum.set(f.number, { f, score });
  }
  // a number with no line for this tee set (unmapped in OSM) falls back to the nearest other set
  const order = ["white", "blue", "red", "gold", "black"].filter((t) => t !== LAYOUT);
  for (const f of D.features) {
    if (f.kind !== "hole" || byNum.has(f.number)) continue;
    const cand = D.features.filter((h) => h.kind === "hole" && h.number === f.number);
    const rank = (h) => (h.pin === PIN ? 0 : 10) + Math.min(...(h.tees.length ? h.tees : ["white"]).map((t) => order.indexOf(t) + 1 || 9));
    cand.sort((a, b) => rank(a) - rank(b));
    byNum.set(f.number, { f: cand[0], score: -1, fallback: true });
  }
  for (const { f, fallback } of byNum.values()) { f.listed = true; f.fallback = !!fallback; }
}
if (!SKI) computeListed();
const WINTER = D.season === "winter";
document.body.classList.toggle("winter", WINTER);
document.title = `${D.name} · 3D ${SKI ? "Resort" : "Course"}`;
$("splash-title").textContent = D.name;
if (D.logo) { const lg = document.querySelector("#splash .logo"); lg.style.filter = "none"; lg.innerHTML = `<img src="${D.logo}" alt="" style="width:130px;border-radius:10px">`; }
if (KEY === "maplehill") {   // club branding: logo in the corner, light theme, no day/night
  document.body.classList.add("t-maple");
  document.documentElement.dataset.theme = "light";
  const lg = document.querySelector("#brand .lg"); lg.classList.add("img");
  lg.innerHTML = `<a href="https://maplehilldiscgolf.com/" target="_blank" rel="noopener" aria-label="Maple Hill Disc Golf"><img src="assets/maplehill-emblem.png" alt="Maple Hill Disc Golf"></a>`;
}
$("splash-sub").textContent = SKI ? "Grooming the pistes" : "Hanging the chains";
$("credits").textContent = $("credits2").textContent = D.attribution;
if (!SKI) $("credits").hidden = true;   // disc golf: the credits are in the settings gear
$("p-course").textContent = `${D.name} / ${D.subtitle}`;

// ---------- units ----------
const IMPERIAL = D.units === "imperial";
const fmtLen = (m) => IMPERIAL ? `${Math.round(m * 3.28084)}` : m >= 1000 ? (m / 1000).toFixed(2) : `${Math.round(m)}`;
const lenUnit = (m) => IMPERIAL ? "ft" : m >= 1000 ? "km" : "m";
const fmtDist = (m) => `≈ ${fmtLen(m)} ${lenUnit(m)}`;
const SMALL = !SKI && (innerWidth <= 640 || (matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) <= 820));   // a phone: lighter textures, fewer trees, smaller shadow map

// ---------- geography: the scene is a metric frame on the lon/lat box (x east, z south). For "where am I" / "disc lost about here". ----------
{
  const G = D.terrain.geo;
  if (G) window.CE = {   // CE.fromLonLat(lon, lat) -> {x, z, y}; CE.toLonLat(x, z) -> {lon, lat}; y = metres above the terrain minimum
    fromLonLat: (lon, lat) => { const x = (lon - G.lon0) * G.kx, z = -(lat - G.lat0) * G.kz; return { x, z, y: heightAt(x, z) }; },
    toLonLat: (x, z) => ({ lon: G.lon0 + x / G.kx, lat: G.lat0 - z / G.kz }),
    view: () => ({ pos: camera.position.toArray(), target: controls.target.toArray() }),   // for checks
    disc: () => ({ visible: discObj.visible, pos: discObj.position.toArray(), spin: discSpin.rotation.y }),
    go: (pos, target) => goTo({ pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) }, 0.2),
  };
}
// ---------- renderer / scene ----------
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = WINTER ? 0.92 : 1.0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(WINTER ? 0xd9e5ef : 0xdde3dc).lerp(new THREE.Color(WINTER ? 0x7fa6cf : 0x6f9fd6), 0.2).getHex();   // haze picks up a little of the sky blue
{ // fog scaled to the venue so the whole-map view stays crisp
  const ext = Math.max(D.terrain.width, D.terrain.depth);
  scene.fog = new THREE.Fog(HORIZON, SKI ? ext * 1.3 * (innerWidth <= 640 ? 2.4 : 1) : 2500, SKI ? ext * 3.2 * (innerWidth <= 640 ? 2.4 : 1) : 3500);   // phones stand further back: push the haze out too
}

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 2, 60000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 30;
controls.maxDistance = SKI ? Math.max(9000, D.terrain.width * 2) * (innerWidth <= 640 ? 1.8 : 1) : 2500;   // phones need to stand further back to fit the width
controls.screenSpacePanning = false;

const hemi = new THREE.HemisphereLight(WINTER ? 0xcfe0ff : 0xdfeaff, WINTER ? 0x8a8f99 : 0x4b5a3c, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(SMALL ? 2048 : 4096, SMALL ? 2048 : 4096);
const SH = SKI ? 1400 : 450;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 12000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5;
scene.add(sun, sun.target);

// ---------- terrain ----------
const T = D.terrain;
const heights = (() => {
  const bin = atob(T.heights_b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(u8.buffer);
  const f = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) f[i] = u16[i] / 10;
  return f;
})();
const X0 = -T.width / 2, Z0 = -T.depth / 2;

function heightAt(x, z) {
  let c = (x - X0) / T.width * (T.cols - 1), r = (z - Z0) / T.depth * (T.rows - 1);
  c = Math.min(Math.max(c, 0), T.cols - 1.001); r = Math.min(Math.max(r, 0), T.rows - 1.001);
  const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * T.cols + c0;
  return heights[i] * (1 - fc) * (1 - fr) + heights[i + 1] * fc * (1 - fr)
    + heights[i + T.cols] * (1 - fc) * fr + heights[i + T.cols + 1] * fc * fr;
}

// Terrain mesh, built straight into typed arrays (fast): positions, normals from the height differences, uvs, and an
// index holding only the cells inside the area of interest; the cut edge gets a side wall (a slab, like a model).
const terrainGeo = new THREE.BufferGeometry();
let inAoi = () => true, skirtMat = null;
{
  const cols = T.cols, rows = T.rows, n = cols * rows, dx = T.width / (cols - 1), dz = T.depth / (rows - 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let r = 0; r < rows; r++) {
    const rU = Math.max(r - 1, 0), rD = Math.min(r + 1, rows - 1);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c, cL = Math.max(c - 1, 0), cR = Math.min(c + 1, cols - 1);
      pos[3 * i] = X0 + c * dx; pos[3 * i + 1] = heights[i]; pos[3 * i + 2] = Z0 + r * dz;
      const gx = (heights[r * cols + cR] - heights[r * cols + cL]) / ((cR - cL) * dx);
      const gz = (heights[rD * cols + c] - heights[rU * cols + c]) / ((rD - rU) * dz);
      const inv = 1 / Math.hypot(gx, 1, gz);
      nor[3 * i] = -gx * inv; nor[3 * i + 1] = inv; nor[3 * i + 2] = -gz * inv;
      uv[2 * i] = c / (cols - 1); uv[2 * i + 1] = 1 - r / (rows - 1);
    }
  }
  terrainGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  terrainGeo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  terrainGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  let inCell = () => 1;
  if (T.aoi_b64) {
    const bin = atob(T.aoi_b64), bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    inCell = (r, c) => (bits[(r * cols + c) >> 3] >> (7 - ((r * cols + c) & 7))) & 1;
    inAoi = (x, z) => {
      const c = Math.round((x - X0) / T.width * (cols - 1)), r = Math.round((z - Z0) / T.depth * (rows - 1));
      return r >= 0 && r < rows && c >= 0 && c < cols && inCell(r, c) === 1;
    };
  }
  const cc = cols - 1, cr = rows - 1, kept = new Uint8Array(cc * cr);
  let count = 0;
  for (let r = 0; r < cr; r++) for (let c = 0; c < cc; c++)
    if (inCell(r, c) && inCell(r + 1, c) && inCell(r, c + 1) && inCell(r + 1, c + 1)) { kept[r * cc + c] = 1; count++; }
  const idx = new Uint32Array(count * 6), sp = [], sc = [];
  const BASE = -45, top = new THREE.Color(WINTER ? 0xe9eef4 : 0x8a7a5c), bot = new THREE.Color(WINTER ? 0xa9b6c6 : 0x4d4333);
  const wall = (u, v) => {   // a side wall under one boundary edge u-v
    for (const [i, down] of [[u, 0], [v, 0], [v, 1], [u, 0], [v, 1], [u, 1]]) {
      sp.push(pos[3 * i], down ? BASE : pos[3 * i + 1], pos[3 * i + 2]); (down ? bot : top).toArray(sc, sc.length);
    }
  };
  let k = 0;
  const has = (r, c) => r >= 0 && r < cr && c >= 0 && c < cc && kept[r * cc + c] === 1;
  for (let r = 0; r < cr; r++) for (let c = 0; c < cc; c++) {
    if (!kept[r * cc + c]) continue;
    const a = r * cols + c, b = (r + 1) * cols + c, e = (r + 1) * cols + c + 1, d = r * cols + c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = b; idx[k++] = e; idx[k++] = d;
    if (!T.aoi_b64) continue;
    if (!has(r - 1, c)) wall(a, d);
    if (!has(r + 1, c)) wall(b, e);
    if (!has(r, c - 1)) wall(a, b);
    if (!has(r, c + 1)) wall(d, e);
  }
  terrainGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (sp.length) {
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    skirtGeo.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
    skirtGeo.computeVertexNormals();
    skirtMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    scene.add(new THREE.Mesh(skirtGeo, skirtMat));   // unlit: a clean gradient
  }
}

// Painted ground texture: base, forest floor, then the playable features.
const PX = SKI ? (T.width > 4000 ? 3072 : 2048) : (SMALL ? 2560 : 4096);
const PY = Math.round(PX * T.depth / T.width);
function makeCanvas(tiny = false) {
  const c = document.createElement("canvas");
  if (tiny) { c.width = c.height = 8; return c; }
  c.width = PX; c.height = Math.min(PY, SKI ? 4096 : (SMALL ? 3200 : 5000));
  return c;
}
// Two ground layers: "real" (snow / grass as it looks up close) and "map" (piste-map colours,
// transparent elsewhere). The terrain shader fades the map layer in with camera distance.
const realCanvas = makeCanvas(), mapCanvas = makeCanvas(!SKI);   // the piste-map overlay is only used by the ski maps
let g = realCanvas.getContext("2d");
const sx = realCanvas.width / T.width, sz = realCanvas.height / T.depth;
const toPx = (x, z) => [(x - X0) * sx, (z - Z0) * sz];
const PPM = (sx + sz) / 2; // pixels per metre

function paintGround() {
  g.fillStyle = WINTER ? "#f3f5f8" : "#7f9a5a";
  g.fillRect(0, 0, realCanvas.width, realCanvas.height);
  // low-frequency mottling so open ground is not flat
  const rnd = mulberry(11);
  for (let i = 0; i < 2600; i++) {
    const r = (8 + rnd() * 40) * PPM;
    g.fillStyle = WINTER
      ? `rgba(${200 + rnd() * 30},${210 + rnd() * 25},${230},${0.05 + rnd() * 0.06})`
      : `rgba(${90 + rnd() * 50},${120 + rnd() * 40},${60 + rnd() * 30},${0.08 + rnd() * 0.1})`;
    g.beginPath(); g.arc(rnd() * realCanvas.width, rnd() * realCanvas.height, r, 0, 7); g.fill();
  }
  // forest floor under trees
  g.fillStyle = WINTER ? "rgba(96,112,110,0.16)" : "rgba(52,70,38,0.30)";
  for (const [x, z, s] of D.trees) {
    const [u, v] = toPx(x, z);
    g.beginPath(); g.arc(u, v, 7 * s * PPM, 0, 7); g.fill();
  }
}

const PISTE_RGB = { green: "#2f9e4f", blue: "#2563c9", red: "#d4312c", black: "#1b1b1b", orange: "#e57a1f" };

function strokePath(path, width, style, dash) {
  g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = width * PPM; g.strokeStyle = style;
  g.setLineDash(dash ? dash.map((d) => d * PPM) : []);
  g.beginPath();
  path.forEach(([x, , z], i) => { const [u, v] = toPx(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v); });
  g.stroke();
  g.setLineDash([]);
}

function paintFeatures() {
  if (SKI) {
    paintSkiContext();
    const runs = D.features.filter((f) => f.kind === "piste")
      .flatMap((f) => [f.path, ...(f.extra_paths || [])].map((path) => ({ f, path })));
    // soft cleared glade around each run; the sharp piste bands themselves are 3D ribbons (buildPisteRibbons)
    for (const { path } of runs) strokePath(path, 40, "#f7f9fc");
    // map layer: trails as on the printed map
    g = mapCanvas.getContext("2d");
    for (const t of D.context?.trails || []) strokePath(t.line.map(([x, z]) => [x, 0, z]), 4, t.kind === "skitour" ? "#e8792b" : t.colour, [14, 10]);
    g = realCanvas.getContext("2d");
  } else {
    // fairway strips first, then water / roads / buildings on top, so a hole crossing a pond stays blue instead of turning grass-green
    for (const f of D.features.filter((h) => h.kind === "hole" && h.listed)) {
      strokePath(f.path, f.fairway_m * 1.25, "rgba(120,150,80,0.55)");
      strokePath(f.path, f.fairway_m, "#93b36a");
      strokePath(f.path, f.fairway_m * 0.62, "#9fbe74");
      strokePath(f.path, f.fairway_m * 0.25, "#93b36a");
      const b = f.path[f.path.length - 1];
      const [u, v] = toPx(b[0], b[2]);
      g.fillStyle = "#a7c47c"; g.beginPath(); g.arc(u, v, 10 * PPM, 0, 7); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 0.4 * PPM;
      g.beginPath(); g.arc(u, v, 10 * PPM, 0, 7); g.stroke(); // circle 1 (10 m putting circle)
      // tee pad
      const t = f.path[0], n = f.path[Math.min(2, f.path.length - 1)];
      const ang = Math.atan2(n[2] - t[2], n[0] - t[0]);
      const [tu, tv] = toPx(t[0], t[2]);
      g.save(); g.translate(tu, tv); g.rotate(ang);
      g.fillStyle = "#b8b4aa"; g.fillRect(-1.5 * PPM, -0.9 * PPM, 4.5 * PPM, 1.8 * PPM);
      g.restore();
    }
    paintContext();
  }
}

function fillPoly(poly, style) {
  g.fillStyle = style; g.beginPath();
  poly.forEach(([x, z], i) => { const [u, v] = toPx(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v); });
  g.closePath(); g.fill();
}
function paintSkiContext() {
  const C = D.context || {};
  for (const r of C.rivers || []) strokePath(r.line.map(([x, z]) => [x, 0, z]), r.w, "#8fb3c9");
  for (const r of C.roads || []) strokePath(r.line.map(([x, z]) => [x, 0, z]), r.w + 2, "#cfc9bb");
  for (const r of C.roads || []) strokePath(r.line.map(([x, z]) => [x, 0, z]), r.w, r.major ? "#ead08a" : "#ebe7dd");
  for (const b of C.buildings || []) fillPoly(b, "#bdb6aa");
  for (const t of C.trails || []) strokePath(t.line.map(([x, z]) => [x, 0, z]), 1.6, "rgba(120,110,95,0.55)");
}
function paintContext() {
  for (const a of D.areas || []) fillPoly(a.poly, a.kind === "parking" ? "#b4b2ab" : "#9dbd6a");
  for (const p of D.paths || []) {
    const pts = p.line.map(([x, z]) => [x, 0, z]);
    if (p.kind === "road") { strokePath(pts, p.w + 1.2, "#d9d5ca"); strokePath(pts, p.w, "#8f9091"); }
    else strokePath(pts, p.w, "#d8cfb9");
  }
  for (const w of D.water || []) {
    fillPoly(w, "#4f7f93");
    g.save(); g.clip(); g.lineJoin = "round";   // shallows: three lighter bands that fade toward the middle
    for (const [wd, col] of [[16, "rgba(130,180,182,0.10)"], [9, "rgba(130,180,182,0.14)"], [4, "rgba(165,205,200,0.22)"]]) { g.lineWidth = wd * PPM; g.strokeStyle = col; g.stroke(); }
    g.restore();
    g.lineWidth = 2.5 * PPM; g.strokeStyle = "#c9c2a6"; g.stroke(); // shoreline
  }
  for (const b of D.buildings || []) fillPoly(b.poly, "#c9c6bf");
}

mark("terrain geometry");
paintGround();
paintFeatures();
mark("ground painted");
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const ORTHO = { uOrtho: { value: null }, uCurtain: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
if (D.ortho) {
  const ot = new THREE.TextureLoader().load(D.ortho, () => invalidate(4));
  ot.colorSpace = THREE.SRGBColorSpace; ot.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ORTHO.uOrtho.value = ot;
}
const slopeU = { value: 0 };   // slope heatmap strength, 0 = off
const terrainMat = new THREE.MeshStandardMaterial({ map: tex(realCanvas), roughness: WINTER ? 0.82 : 0.95 });
const mapTex = tex(mapCanvas);
terrainMat.onBeforeCompile = (sh) => {
  sh.uniforms.mapOverlay = { value: mapTex };
  sh.uniforms.fadeNear = { value: SKI ? 380 : 1e6 };
  sh.uniforms.fadeFar = { value: SKI ? 1500 : 2e6 };
  sh.uniforms.uSlope = slopeU; sh.uniforms.uDetail = { value: SKI ? 0 : 1 };
  Object.assign(sh.uniforms, ORTHO);
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWN;\nvarying vec3 vWPos;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;")
    .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvWN = objectNormal;");
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform sampler2D mapOverlay;\nuniform float fadeNear, fadeFar, uSlope, uCurtain;\nuniform sampler2D uOrtho;\nuniform vec2 uRes;\nvarying vec3 vWN;\nvarying vec3 vWPos;\nuniform float uDetail;\nfloat h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }")
    .replace("#include <map_fragment>", `#include <map_fragment>
      vec4 ov = texture2D(mapOverlay, vMapUv);
      diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a * smoothstep(fadeNear, fadeFar, length(vViewPosition)));
      float sl = degrees(acos(clamp(normalize(vWN).y, 0.0, 1.0)));   // slope angle in degrees
      vec3 hc = mix(vec3(0.30, 0.76, 0.40), vec3(0.20, 0.46, 0.88), smoothstep(4.0, 10.0, sl));
      hc = mix(hc, vec3(0.88, 0.20, 0.18), smoothstep(11.0, 18.0, sl));
      hc = mix(hc, vec3(0.16, 0.08, 0.22), smoothstep(19.0, 28.0, sl));
      diffuseColor.rgb = mix(diffuseColor.rgb, hc, uSlope * 0.9);
      if (uDetail > 0.5) {   // turf that is not one flat green: broad patches, and grain / clumps only close to the camera
        vec3 c0 = diffuseColor.rgb;
        float grassM = smoothstep(0.0, 0.05, c0.g - max(c0.r, c0.b));
        float dC = length(vViewPosition);
        float nearA = 1.0 - smoothstep(30.0, 170.0, dC), nearB = 1.0 - smoothstep(5.0, 55.0, dC);
        float v = (vn(vWPos.xz * 0.045) - 0.5) * 0.16;
        if (nearA > 0.0) v += (vn(vWPos.xz * 0.30) - 0.5) * 0.14 * nearA;
        if (nearB > 0.0) v += (vn(vWPos.xz * 2.6) - 0.5) * 0.24 * nearB;
        diffuseColor.rgb *= 1.0 + v * grassM;
      }
      if (gl_FragCoord.x < uCurtain * uRes.x) diffuseColor.rgb = texture2D(uOrtho, vMapUv).rgb;   // aerial photo curtain`);
};
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.onBeforeRender = (r) => { r.getDrawingBufferSize(ORTHO.uRes.value); };
terrain.receiveShadow = true;
scene.add(terrain);
mark("terrain textured");


// ---------- piste bands: sharp ribbons draped on the terrain ----------
// Near the camera: white corduroy snow with a thin coloured edge marker. Far away: a solid difficulty-coloured band.
const NIGHT_U = { value: 0 };   // 0 = day, 1 = night; drives the glow of the evening-skiing edges
let nightGroup = null;
let nightGlow = null, ribbonGroup = null;
const ribbonRanges = [];   // which vertices of which ribbon mesh belong to which piste (for status updates)
function buildPisteRibbons() {
  const WIDTH = 28, ACROSS = 6;
  const byColour = new Map(), lit = { pos: [], across: [], side: [], idx: [] }, glow = { pos: [], across: [], phase: [], idx: [] };
  for (const f of D.features.filter((x) => x.kind === "piste")) {
    for (const path of [f.path, ...(f.extra_paths || [])]) {
      if (path.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(path.map((q) => new THREE.Vector3(q[0], 0, q[2])), false, "centripetal");
      const n = Math.max(2, Math.ceil(curve.getLength() / 4));
      let bucket = byColour.get(f.difficulty);
      if (!bucket) byColour.set(f.difficulty, (bucket = { pos: [], across: [], along: [], state: [], mute: [], idx: [] }));
      const nLamp = Math.max(1, Math.floor(curve.getLength() / 42));   // same spacing as buildLanterns()
      const targets = f.lit ? (path === f.path ? [bucket, lit, glow] : [bucket, lit]) : [bucket];
      const bases = targets.map((b) => b.pos.length / 3), L = curve.getLength();
      ribbonRanges.push({ f, bucket, start: bases[0], count: (n + 1) * (ACROSS + 1) });
      for (let i = 0; i <= n; i++) {
        const c = curve.getPointAt(i / n), t = curve.getTangentAt(i / n);
        const len = Math.hypot(t.x, t.z) || 1, nx = -t.z / len, nz = t.x / len;
        for (let j = 0; j <= ACROSS; j++) {
          const a = j / ACROSS, off = (a - 0.5) * WIDTH, x = c.x + nx * off, z = c.z + nz * off;
          for (const b of targets) { b.pos.push(x, heightAt(x, z) + 0.35, z); b.across.push(a); if (b.along) { b.along.push(i / n * L); b.state.push(stateOf(f)); b.mute.push(0); } if (b.phase) b.phase.push(i / n * nLamp); }
          if (f.lit) lit.side.push(nx, nz);
        }
        if (i > 0) targets.forEach((b, k) => { for (let j = 0; j < ACROSS; j++) {
          const a0 = bases[k] + (i - 1) * (ACROSS + 1) + j, b0 = bases[k] + i * (ACROSS + 1) + j;
          b.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        } });
      }
    }
  }
  const group = new THREE.Group();
  const ORDER = { green: 0, blue: 1, red: 2, black: 3, orange: 4 };
  for (const [diff, b] of byColour) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute("across", new THREE.Float32BufferAttribute(b.across, 1));
    geo.setAttribute("along", new THREE.Float32BufferAttribute(b.along, 1));
    b.stateAttr = new THREE.Float32BufferAttribute(b.state, 1); b.stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("state", b.stateAttr);
    b.muteAttr = new THREE.Float32BufferAttribute(b.mute, 1); b.muteAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("mute", b.muteAttr);
    geo.setIndex(b.idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: PISTE_RGB[diff], side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float across;\nattribute float along;\nattribute float state;\nattribute float mute;\nvarying float vAcross;\nvarying float vAlong;\nvarying float vState;\nvarying float vMute;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAcross = across; vAlong = along; vState = state; vMute = mute;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vAcross;\nvarying float vAlong;\nvarying float vState;\nvarying float vMute;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          float e = min(vAcross, 1.0 - vAcross);
          float edge = 1.0 - smoothstep(0.04, 0.075, e);
          vec3 snow = vec3(0.965, 0.975, 0.99) * (0.965 + 0.035 * step(0.5, fract(vAcross * 9.0)));
          vec3 nearC = mix(snow, diffuseColor.rgb, edge);
          vec3 farC = mix(diffuseColor.rgb, vec3(1.0), 0.16 * smoothstep(0.1, 0.5, e));
          diffuseColor.rgb = mix(nearC, farC, smoothstep(380.0, 1500.0, length(vViewPosition)));
          float closed = step(0.75, vState), prep = step(0.25, vState) * (1.0 - closed), stripe = step(0.5, fract(vAlong * 0.06));
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum * 0.85 + 0.18), closed * 0.9);
          diffuseColor.rgb *= 1.0 - 0.18 * closed * stripe;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.62, 0.10), prep * 0.6 * stripe);
          float lm = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lm * 0.55 + 0.42), vMute * 0.72);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2 + (ORDER[diff] ?? 5);      // overlapping bands are painted in a fixed order
    group.add(mesh);
  }
  ribbonGroup = group; scene.add(group);
  // evening skiing: a yellow outer edge, widened with distance so it stays about 2-3 px wide on screen
  if (lit.pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(lit.pos, 3));
    geo.setAttribute("across", new THREE.Float32BufferAttribute(lit.across, 1));
    geo.setAttribute("side", new THREE.Float32BufferAttribute(lit.side, 2));
    geo.setIndex(lit.idx);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5c518, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = NIGHT_U;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float across;\nattribute vec2 side;\nuniform float uNight;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float ex = clamp(distance(cameraPosition, wp) * 0.0025, 3.0, 20.0) * (1.0 + 0.9 * uNight);
          transformed += vec3(side.x, 0.0, side.y) * ex * sign(across - 0.5);`);
    };
    nightGroup = new THREE.Mesh(geo, mat);
    nightGroup.frustumCulled = false;
    nightGroup.renderOrder = 1;                     // under every piste band
    nightGroup.visible = false;   // evening skiing is a layer, off by default (see groupOn.night)
    scene.add(nightGroup);
  }
  // the run's own surface glows warmly around every lamp, fading out at the run's edge: the light stays on the track
  if (glow.pos.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(glow.pos, 3));
    gg.setAttribute("across", new THREE.Float32BufferAttribute(glow.across, 1));
    gg.setAttribute("phase", new THREE.Float32BufferAttribute(glow.phase, 1));
    gg.setIndex(glow.idx);
    const gm = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = NIGHT_U;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float across;\nattribute float phase;\nvarying float vAcross;\nvarying float vPhase;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAcross = across; vPhase = phase;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vAcross;\nvarying float vPhase;\nuniform float uNight;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          float dl = (fract(vPhase) - 0.5) * 42.0;
          float pool = exp(-dl * dl / (2.0 * 13.0 * 13.0));
          float edge = smoothstep(0.0, 0.14, min(vAcross, 1.0 - vAcross));
          diffuseColor.a = uNight * (0.16 + 0.62 * pool) * edge;`);
    };
    nightGlow = new THREE.Mesh(gg, gm);
    nightGlow.frustumCulled = false; nightGlow.renderOrder = 8; nightGlow.visible = false; nightGlow.userData.on = false;
    scene.add(nightGlow);
  }
}
if (SKI) buildPisteRibbons();
// a selected piste stays in full colour, every other piste fades to a quiet grey so the one run reads (Fatmap-style)
let legendSel = null;   // {tag, run?}: one legend entry picked; only matching pins show, pistes of other kinds fade
let diffFilter = null;   // null = all pistes, else 'blue' | 'red' | 'black'...
let lastSel = null;
function setMute(sel = lastSel) {
  lastSel = sel;
  if (!ribbonRanges.length) return;
  const hide = (r) => sel ? r.f !== sel : legendSel?.run ? !legendSel.run(r.f) : !!diffFilter && r.f.difficulty !== diffFilter;
  for (const r of ribbonRanges) r.bucket.muteAttr.array.fill(hide(r) ? 1 : 0, r.start, r.start + r.count);
  for (const b of new Set(ribbonRanges.map((r) => r.bucket))) b.muteAttr.needsUpdate = true;
  invalidate(4);
}
mark("piste ribbons");


// ---------- lanterns along the evening-skiing runs ----------
// Posts every ~42 m, alternating sides; at night the lamp heads light up and each throws a warm pool of light on the snow.
let lanternMats = null;
function buildLanterns() {
  const SPACING = 42, OFFSET = 16.5, POLE = 9, spots = [];
  for (const f of D.features.filter((x) => x.kind === "piste" && x.lit)) {
    if (f.path.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(f.path.map((q) => new THREE.Vector3(q[0], 0, q[2])), false, "centripetal");
    const n = Math.max(1, Math.floor(curve.getLength() / SPACING));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, c = curve.getPointAt(t), tan = curve.getTangentAt(t), len = Math.hypot(tan.x, tan.z) || 1, side = i % 2 ? 1 : -1;
      spots.push([c.x - tan.z / len * OFFSET * side, c.z + tan.x / len * OFFSET * side]);
    }
  }
  if (!spots.length) return;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, POLE, 6).translate(0, POLE / 2, 0), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 }), spots.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8d8a82, toneMapped: false }), spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    const y = heightAt(x, z);
    m4.makeTranslation(x, y - 0.2, z); poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, y + POLE + 0.3, z); heads.setMatrixAt(i, m4);
  });
  poles.visible = heads.visible = false;   // part of the evening-skiing layer
  scene.add(poles, heads);
  lanternMats = { head: heads.material, posts: [poles, heads] };
}
buildLanterns();
const HEAD_DAY = new THREE.Color(0x8d8a82), HEAD_NIGHT = new THREE.Color(0xfff1c4);

// ---------- trees ----------
function coniferGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 3, 10); trunk.translate(0, 1.5, 0);
  parts.push([trunk, 0x5a4330]);
  const tiers = [[3.6, 7, 3.2], [2.8, 6, 6.6], [1.9, 5, 9.6]];
  tiers.forEach(([r, h, y], i) => {
    const c = new THREE.ConeGeometry(r, h, 6); c.translate(0, y + h / 2 - 1, 0);
    parts.push([c, WINTER ? [0x24402f, 0x2f5039, 0x6f8a7a][i] : [0x24432c, 0x2c5134, 0x335c3a][i]]);
  });
  return merge(parts);
}
function broadleafGeo() {
  const trunk = new THREE.CylinderGeometry(0.26, 0.40, 5, 10); trunk.translate(0, 2.5, 0);
  const crown = new THREE.IcosahedronGeometry(4.6, 0); crown.scale(1, 0.9, 1); crown.translate(0, 8, 0);
  const crown2 = new THREE.IcosahedronGeometry(3.2, 0); crown2.translate(1.8, 10.2, 0.8);
  return merge([[trunk, 0x5a4330], [crown, 0x4d7a37], [crown2, 0x5b8a40]]);
}
function merge(parts) {
  const geos = parts.map(([geo, hex]) => {
    const gg = geo.toNonIndexed();
    const col = new THREE.Color(hex), n = gg.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    gg.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return gg;
  });
  const total = geos.reduce((s, gg) => s + gg.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const gg of geos) {
    pos.set(gg.attributes.position.array, o * 3); nor.set(gg.attributes.normal.array, o * 3);
    col.set(gg.attributes.color.array, o * 3); o += gg.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const treeGroup = new THREE.Group();
// see-through for disc golf: trees within uRad of the selected hole's line are drawn as a ghost (x-ray)
const TU = { uSeg: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uSegN: { value: 0 }, uRad: { value: 18 }, uXray: { value: 1 } };
// 1 when the tree standing at p is within uRad of the selected hole's line (and x-ray is on); shared by the colour and shadow passes
const GHOST_GLSL = `float treeGhost(vec2 p) {
  for (int i = 0; i < 8; i++) {
    if (i >= uSegN) break;
    vec2 a = uSeg[i].xy, ba = uSeg[i].zw - a, pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    if (length(pa - ba * h) < uRad) return uXray;
  }
  return 0.0;
}`;
let corridorOn = !SKI;
const CLEAR_U = { value: SKI ? 70 : 24 };   // trees collapse within CLEAR_U of the camera (off while flying)
// Trees are split into ~450 m cells. Each cell is its own instanced mesh, so cells outside the view are skipped (also in the
// shadow pass), and cells farther than TREE_FAR swap to a 5-triangle cone that shares the same instance data.
const TREE_FAR = SMALL ? 520 : 950, treeCells = [];
{
  const CELL = 450;
  const rnd = mulberry(3);
  const share = WINTER ? 1.0 : 0.35; // conifer share
  const hiGeo = [coniferGeo(), broadleafGeo()];
  const loGeo = [merge([[new THREE.ConeGeometry(3.3, 15, 5, 1, true).translate(0, 7.5, 0), WINTER ? 0x2b4a38 : 0x2c5134]]),
                 merge([[new THREE.IcosahedronGeometry(4.8, 0).translate(0, 8.5, 0), 0x4d7a37]])];
  const makeMat = () => {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.clearR = CLEAR_U;
    Object.assign(sh.uniforms, TU);
    sh.uniforms.uCurtainT = ORTHO.uCurtain; sh.uniforms.uResT = ORTHO.uRes;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
uniform float clearR, uRad, uXray;
uniform int uSegN;
uniform vec4 uSeg[8];
varying float vGhost;
${GHOST_GLSL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec3 treeBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        // trees right next to the camera collapse away so tee / ground-level views are not blocked
        if (distance(treeBase.xz, cameraPosition.xz) < clearR && cameraPosition.y - treeBase.y < 60.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        vGhost = treeGhost(treeBase.xz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uCurtainT;
uniform vec2 uResT;
varying float vGhost;`)
      .replace("void main() {", `void main() {
        if (gl_FragCoord.x < uCurtainT * uResT.x) discard;   // the aerial photo side shows the ground only
        if (vGhost > 0.5 && fract(dot(floor(gl_FragCoord.xy * 0.5), vec2(0.7548777, 0.5698403))) > 0.3) discard;   // x-ray: a screen-door ghost`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        if (vGhost > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.93, 1.0), 0.5);`);
  };
  mat.customProgramCacheKey = () => "tree";
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {   // the shadow pass: x-ray trees cast no shadow
    Object.assign(sh.uniforms, { uRad: TU.uRad, uXray: TU.uXray, uSegN: TU.uSegN, uSeg: TU.uSeg });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uRad, uXray;
uniform int uSegN;
uniform vec4 uSeg[8];
varying float vGhost;
${GHOST_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vGhost = treeGhost((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vGhost;`)
      .replace("void main() {", `void main() {
        if (vGhost > 0.5) discard;`);
  };
  depth.customProgramCacheKey = () => "treedepth";
  mat.userData.depth = depth;
  return mat; };
  const treeMat = makeMat(), mats = [treeMat, treeMat];
  const cells = new Map();
  for (const t0 of D.trees) {
    if (SMALL && Math.floor(Math.abs(t0[0] * 7.31 + t0[1] * 3.17)) % 5 < 2) continue;   // phones: 60% of the trees, a little larger to keep the look
    const t = SMALL ? [t0[0], t0[1], t0[2] * 1.12, t0[3]] : t0;
    const ix = Math.floor((t[0] - X0) / CELL), iz = Math.floor((t[1] - Z0) / CELL), key = ix * 4096 + iz;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { cx: X0 + (ix + 0.5) * CELL, cz: Z0 + (iz + 0.5) * CELL, lists: [[], []] }));
    c.lists[t[3] ?? (rnd() < share ? 0 : 1)].push(t);   // t[3]: 0 conifer / 1 broadleaf read from the aerial, else a random share
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), jc = new THREE.Color();
  for (const c of cells.values()) {
    const cell = { cx: c.cx, cz: c.cz, hi: [], lo: [] };
    c.lists.forEach((list, kind) => {
      if (!list.length) return;
      const hi = new THREE.InstancedMesh(hiGeo[kind], mats[kind], list.length);
      list.forEach(([x, z, sc], i) => {
        q.setFromAxisAngle(up, rnd() * 6.28);
        const k = sc * (SKI ? 1.55 : 1.0); // Beskid spruce stands run ~20 m tall
        m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.3, z), q, new THREE.Vector3(k, k * (0.85 + rnd() * 0.35), k));
        hi.setMatrixAt(i, m4);
        hi.setColorAt(i, jc.setRGB(0.88 + rnd() * 0.2, 0.86 + rnd() * 0.24, 0.88 + rnd() * 0.16));
      });
      hi.castShadow = true; hi.receiveShadow = true; hi.customDepthMaterial = mats[kind].userData.depth;
      const lo = new THREE.InstancedMesh(loGeo[kind], mats[kind], list.length);
      lo.instanceMatrix = hi.instanceMatrix; lo.instanceColor = hi.instanceColor;              // same instance data, cheaper shape
      lo.receiveShadow = true; lo.visible = false;
      treeGroup.add(hi, lo); cell.hi.push(hi); cell.lo.push(lo);
    });
    treeCells.push(cell);
  }
  scene.add(treeGroup);
  mark("trees");
}
function updateTreeLod() {
  const c = camera.position, lim = TREE_FAR + 320;
  for (const cell of treeCells) {
    const near = Math.hypot(cell.cx - c.x, cell.cz - c.z) < lim;
    for (const m of cell.hi) m.visible = near;
    for (const m of cell.lo) m.visible = !near;
  }
}

// ---------- lifts / baskets ----------
const LIFT_CLEAR = 10;
function liftCable(f) {
  const [a, b] = f.path;
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(2, Math.round(len / 110));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    const lineY = a[1] + (b[1] - a[1]) * t + LIFT_CLEAR + 2;
    pts.push(new THREE.Vector3(x, Math.max(lineY, heightAt(x, z) + LIFT_CLEAR), z));
  }
  return pts;
}

const furniture = new THREE.Group();
let rebuildHoleFurniture = () => {};
scene.add(furniture);
if (SKI) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.4 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x8c2f24, roughness: 0.8 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9 });
  for (const f of D.features.filter((x) => x.kind === "lift")) {
    const pts = liftCable(f);
    f.cable = pts;
    for (const off of [-2, 2]) {
      const dir = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[0]).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(off);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(side))),
        new THREE.LineBasicMaterial({ color: 0x23272b }));
      furniture.add(line);
    }
    pts.forEach((p, i) => {
      if (i === 0 || i === pts.length - 1) {
        const st = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), wall); box.position.y = 3.5;
        const rf = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 12), roof); rf.position.y = 7.6;
        st.add(box, rf); st.position.set(p.x, heightAt(p.x, p.z), p.z);
        st.lookAt(pts[i === 0 ? 1 : i - 1].x, st.position.y, pts[i === 0 ? 1 : i - 1].z);
        st.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        furniture.add(st);
      } else {
        const gy = heightAt(p.x, p.z), h = p.y - gy + 1.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h, 6), steel);
        pole.position.set(p.x, gy + h / 2, p.z); pole.castShadow = true;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.5, 0.5), steel);
        arm.position.set(p.x, p.y + 0.6, p.z);
        arm.rotation.y = -Math.atan2(pts[pts.length - 1].z - pts[0].z, pts[pts.length - 1].x - pts[0].x) + Math.PI / 2;
        furniture.add(pole, arm);
      }
    });
  }
} else {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.35, metalness: 0.7 });
  const band = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.95 });
  const TEE_HEX = { blue: 0x3b6fb6, white: 0xe8e6df, red: 0xc0453a, gold: 0xd4a72c, black: 0x2a2a2a, reds: 0xc0453a, whites: 0xe8e6df, blues: 0x3b6fb6, golds: 0xd4a72c, diamonds: 0x9fd0e8 };
  const padEdge = new THREE.MeshStandardMaterial({ color: TEE_HEX[LAYOUT] ?? 0xa8a49b, roughness: 0.8 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.9 });
  for (const bd of D.buildings || []) {
    const shape = new THREE.Shape(bd.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: bd.h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const base = Math.min(...bd.poly.map(([x, z]) => heightAt(x, z)));
    const m = new THREE.Mesh(geo, wallM); m.position.y = base - 0.5;
    m.castShadow = true; m.receiveShadow = true;
    furniture.add(m);
  }
  let BASKET = null;
  try {   // Pole Hole basket (SketchUp model, thinned to ~19k triangles by data/raw/basket/build_basket.py)
    const r = await fetch("assets/basket.json");
    if (r.ok) {
      const j = await r.json();
      const dec = (b64, Ty) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Ty(u.buffer); };
      BASKET = {};
      for (const k of ["ID5", "ID36"]) {
        const gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.BufferAttribute(dec(j[k].pos, Float32Array), 3));
        gg.setIndex(new THREE.BufferAttribute(dec(j[k].idx, Uint16Array), 1)); gg.computeBoundingSphere();
        BASKET[k] = gg;
      }
    }
  } catch (e) { BASKET = null; }
  const steelD = new THREE.MeshStandardMaterial({ color: 0xc2c7cb, metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide, flatShading: true });
  const yellowD = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, side: THREE.DoubleSide, flatShading: true });
  const holeFurn = new THREE.Group();
  furniture.add(holeFurn);
  const chainMat = new THREE.LineBasicMaterial({ color: 0xdfe3e6 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.45, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xaeb4b8, roughness: 0.3, metalness: 0.85 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.7 });
  const chainGeo = (() => {   // 24 chains from the upper ring (r .30, y 1.22) down to the inner ring (r .15, y .86), with a slight twist
    const v = [];
    for (let i = 0; i < 24; i++) {
      const a0 = i / 24 * Math.PI * 2, a1 = a0 + 0.22;
      v.push(Math.cos(a0) * 0.30, 1.22, Math.sin(a0) * 0.30, Math.cos(a1) * 0.15, 0.86, Math.sin(a1) * 0.15);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); return g;
  })();
  const trayGeo = new THREE.LatheGeometry([[0.045, 0.66], [0.16, 0.7], [0.27, 0.78], [0.335, 0.86], [0.345, 0.93], [0.325, 0.93], [0.315, 0.87], [0.25, 0.8], [0.14, 0.73], [0.045, 0.7]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const capGeo = new THREE.LatheGeometry([[0.0, 1.5], [0.11, 1.47], [0.24, 1.38], [0.31, 1.27], [0.31, 1.22], [0.27, 1.22], [0.2, 1.3], [0.08, 1.37], [0.0, 1.38]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const poleGeo = new THREE.CylinderGeometry(0.028, 0.034, 1.5, 8);
  const bandGeo = new THREE.TorusGeometry(0.31, 0.018, 6, 28);
  function makeBasket() {
    const g = new THREE.Group();
    if (BASKET) {
      g.add(new THREE.Mesh(BASKET.ID5, steelD), new THREE.Mesh(BASKET.ID36, yellowD));
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      return g;
    }
    const pole = new THREE.Mesh(poleGeo, darkSteel); pole.position.y = 0.75;
    const tray = new THREE.Mesh(trayGeo, steel);
    const cap = new THREE.Mesh(capGeo, yellow);
    const band = new THREE.Mesh(bandGeo, yellow); band.rotation.x = Math.PI / 2; band.position.y = 1.2;
    const chains = new THREE.LineSegments(chainGeo, chainMat);
    g.add(pole, tray, cap, band, chains);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  rebuildHoleFurniture = () => {
  for (const o of [...holeFurn.children]) { holeFurn.remove(o); o.traverse((c) => { c.geometry?.dispose(); }); }
  padEdge.color.setHex(TEE_HEX[LAYOUT] ?? 0xa8a49b);
  for (const f of D.features.filter((x) => x.kind === "hole" && x.listed)) {
    const b = f.path[f.path.length - 1];
    const bk = makeBasket();
    bk.scale.setScalar(2.6); // a little larger than life so it reads from the fairway
    bk.position.set(b[0], heightAt(b[0], b[2]), b[2]);
    bk.traverse((o) => { o.castShadow = true; });
    holeFurn.add(bk);
    const t = f.path[0], n = f.path[1];
    const tee = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 1.8), [padEdge, padEdge, pad, pad, padEdge, padEdge]);
    tee.position.set(t[0], heightAt(t[0], t[2]) + 0.1, t[2]);
    tee.rotation.y = -Math.atan2(n[2] - t[2], n[0] - t[0]);
    tee.receiveShadow = true;
    holeFurn.add(tee);
  }
  };
  rebuildHoleFurniture();
}

// ---------- selection highlight ----------
let highlight = null;
const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill(); return new THREE.CanvasTexture(c); })();
function setHighlight(f) {
  if (highlight) { scene.remove(highlight); highlight.traverse((o) => o.geometry && o.geometry.dispose()); }
  const pts = f.kind === "lift" ? f.cable : f.path.map(([x, y, z]) => new THREE.Vector3(x, heightAt(x, z) + (SKI ? 3 : 0.6), z));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const color = f.kind === "lift" ? 0xffc83d : f.kind === "hole" ? 0xffffff : SKI ? 0xed7102 : PISTE_RGB[f.difficulty];
  const segs = Math.max(24, pts.length * 3), r = SKI ? 2.6 : 0.35;
  highlight = new THREE.Group();
  if (SKI) { // white halo so dark (black-run) lines still pop against forest
    const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r * 2.1, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    halo.renderOrder = 1; highlight.add(halo);
  }
  const core = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: f.kind !== "hole" }));
  if (f.kind !== "hole") { core.renderOrder = 2; highlight.add(core); }
  if (SKI && f.kind === "piste") {   // green start dot, white finish dot
    for (const [p, c] of [[pts[0], 0x2ecc71], [pts[pts.length - 1], 0xffffff]]) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r * 2.6, 14, 10), new THREE.MeshBasicMaterial({ color: c })); d.position.copy(p); d.renderOrder = 3; highlight.add(d);
    }
  }
  if (f.kind === "hole") {   // a dotted line: white dots with a dark-blue rim, round and crisp at any zoom, drawn over the trees
    const n = Math.max(10, Math.round(curve.getLength() / 2.4)), dp = curve.getSpacedPoints(n);
    const geo = new THREE.BufferGeometry().setFromPoints(dp);
    const pr = renderer.getPixelRatio();
    for (const [size, col, order] of (SMALL ? [[7, 0x1c4b94, 3], [4.2, 0xffffff, 4]] : [[9, 0x1c4b94, 3], [5.5, 0xffffff, 4]])) {
      const pts2 = new THREE.Points(geo, new THREE.PointsMaterial({ size: size * pr, sizeAttenuation: false, map: dotTex, alphaTest: 0.5, transparent: true, depthTest: false, color: col }));
      pts2.renderOrder = order; pts2.frustumCulled = false; highlight.add(pts2);
    }
  }
  for (const k of f.ob_water || []) {   // out-of-bounds water: red shoreline
    const pts3 = D.water[k].map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.45, z));
    const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3, true), pts3.length * 2, 0.4, 5, true), new THREE.MeshBasicMaterial({ color: 0xe5303f }));
    ring.renderOrder = 2; highlight.add(ring);
  }
  if (f.kind === "hole") {
    const a = V(f.path[0]), b = V(f.path[f.path.length - 1]);
    for (const k of f.ob_water || []) {   // OB water: translucent red fill under the red shoreline
      const poly = D.water[k], sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xe5303f, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = heightAt(poly[0][0], poly[0][1]) + 0.35; fill.renderOrder = 1; highlight.add(fill);
    }
    for (const [mx, mz] of mandosOf(f)) {   // mando: two posts across the line
      const h0 = heightAt(mx, mz), dir = horizDir(a, b), nx = -dir.z, nz = dir.x;
      for (const sgn of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.5, 8), new THREE.MeshBasicMaterial({ color: 0xd4312c, depthTest: false }));
        post.position.set(mx + nx * 1.6 * sgn, h0 + 2.25, mz + nz * 1.6 * sgn); post.renderOrder = 3; highlight.add(post);
      }
    }
    const G = showMarkers ? f.dgpt : null;
    if (G) {
      if (G.trunks.length) {   // marked tree trunks from the caddie book: dark posts that stay visible through the x-ray
        const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.2, 3.0, 8), new THREE.MeshBasicMaterial({ color: 0x0b1730, depthTest: false }), G.trunks.length);
        const m4 = new THREE.Matrix4();
        G.trunks.forEach(([x, z], i) => { m4.makeTranslation(x, heightAt(x, z) + 1.7, z); im.setMatrixAt(i, m4); });
        im.renderOrder = 4; im.frustumCulled = false; highlight.add(im);
      }
      for (const line of G.ob) {   // OB line: a red ribbon on the ground and a low translucent wall
        if (line.length < 2) continue;
        const pos = [], idx = [];
        line.forEach(([x, z], i) => { const y = heightAt(x, z); pos.push(x, y + 0.15, z, x, y + 1.8, z); if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } });
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
        const wall = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xef5266, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
        wall.renderOrder = 2; wall.frustumCulled = false; highlight.add(wall);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.25, z)), false, "centripetal"), Math.max(8, line.length * 2), 0.16, 5),
          new THREE.MeshBasicMaterial({ color: 0xef5266, depthTest: false }));
        tube.renderOrder = 3; highlight.add(tube);
      }
    }
  }
  scene.add(highlight);
  setMute(SKI && f.kind === "piste" ? f : null);
}

// ---------- geometry helpers for cameras ----------
const V = (a) => new THREE.Vector3(a[0], heightAt(a[0], a[2]), a[2]);
function pathCurve(f) {
  if (f.kind === "lift") return new THREE.CatmullRomCurve3(f.cable, false, "centripetal");
  // light smoothing so the flyover camera does not jitter on DEM noise
  const raw = f.path.map((p) => V(p));
  const sm = raw.map((p, i) => {
    const a = raw[Math.max(0, i - 2)], b = raw[Math.min(raw.length - 1, i + 2)];
    return new THREE.Vector3((a.x + p.x * 2 + b.x) / 4, (a.y + p.y * 2 + b.y) / 4, (a.z + p.z * 2 + b.z) / 4);
  });
  return new THREE.CatmullRomCurve3(sm, false, "centripetal");
}
function horizDir(a, b) { return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(); }

function viewFor(f, mode) {
  const c = pathCurve(f), L = c.getLength();
  const start = c.getPointAt(0), end = c.getPointAt(1);
  const at = (m) => c.getPointAt(Math.min(1, Math.max(0, m / L)));
  if (mode === "start") {
    const d = horizDir(start, at(SKI ? 120 : 20));
    if (!SKI) { // golfer's eye: behind the pad, looking down the first leg
      const d2 = horizDir(start, at(Math.min(L * 0.5, 35)));
      return { pos: start.clone().addScaledVector(d2, -11).add(new THREE.Vector3(0, 4.5, 0)), target: at(Math.min(L * 0.6, 55)).add(new THREE.Vector3(0, 1.2, 0)) };
    }
    const look = at(Math.min(L * 0.45, 600));
    return { pos: start.clone().addScaledVector(d, -130).add(new THREE.Vector3(0, 95, 0)), target: look };
  }
  if (mode === "end") {
    if (SKI && f.kind === "piste") {
      const d = horizDir(at(L - 150), end);
      return { pos: end.clone().addScaledVector(d, 140).add(new THREE.Vector3(0, 70, 0)), target: at(L * 0.55) };
    }
    const d = horizDir(at(L - (SKI ? 150 : 25)), end);
    return { pos: end.clone().addScaledVector(d, SKI ? -160 : -22).add(new THREE.Vector3(0, SKI ? 60 : 7, 0)), target: end.clone().add(new THREE.Vector3(0, SKI ? 0 : 1.5, 0)) };
  }
  // overview: side-on, looking across the line
  const box = new THREE.Box3().setFromPoints(c.getSpacedPoints(30));
  const mid = box.getCenter(new THREE.Vector3());
  const d = horizDir(start, end);
  let side = new THREE.Vector3(-d.z, 0, d.x);
  if (SKI) { // prefer the side that looks into the slope (lower ground)
    const s1 = heightAt(mid.x + side.x * 400, mid.z + side.z * 400), s2 = heightAt(mid.x - side.x * 400, mid.z - side.z * 400);
    if (s2 < s1) side.negate();
  }
  const ext = Math.max(box.getSize(new THREE.Vector3()).length(), SKI ? 500 : 60) * (innerWidth / Math.max(innerWidth - panelOcc(), innerWidth * 0.5));   // zoom out a bit when the panel takes room
  // phone ski runs: the same direction as the home view / printed map, tilted down (about 63 deg), centred on the run and zoomed until it fills the free area
  // Phone ski runs (matches the hand-placed reference views): start from the printed map's direction, tilted ~50 deg, and turn the
  // camera only as far as needed for the run to lie as a diagonal from top-left to bottom-right; then zoom until it fills the free area.
  if (SKI && compact() && D.map_view_azimuth_deg != null && f.kind === "piste") {
    const a0 = D.map_view_azimuth_deg * Math.PI / 180, tilt = 0.87, chx = end.x - start.x, chz = end.z - start.z;
    const slopeAt = (a) => {   // the run's on-screen angle, degrees below horizontal going right
      const fx = -Math.sin(a), fz = Math.cos(a), x = -chx * fz + chz * fx, yup = (chx * fx + chz * fz) * Math.sin(tilt);
      let s = Math.atan2(-yup, x) * 180 / Math.PI; if (s > 90) s -= 180; if (s <= -90) s += 180; return s;
    };
    let turn = 0, miss = 1e9;
    for (let k = 0; k <= 12; k++) for (const sg of k ? [-1, 1] : [1]) {   // 0, -5, +5, -10, ... up to 60 deg either way; the first one that fits wins
      const dd = sg * k * 5, s = slopeAt(a0 + dd * Math.PI / 180), m = s < 30 ? 30 - s : s > 65 ? s - 65 : 0;
      if (m < miss) { miss = m; turn = dd; }
      if (!m) break;
    }
    const az = a0 + turn * Math.PI / 180, hd = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
    const mkP = (e) => ({ pos: mid.clone().addScaledVector(hd, e * Math.cos(tilt)).add(new THREE.Vector3(0, e * Math.sin(tilt), 0)), target: mid });
    return mkP(Math.max(fitToScreen(mkP, ext, c.getSpacedPoints(30)), 1200));   // never closer than ~1.2 km, so short runs keep their surroundings
  }
  // (older phone view, kept for resorts without a printed-map direction) stand above the start and look down the run, so it climbs the tall screen instead of lying across the narrow width
  const mkO = SKI && phone() ? (e) => ({ pos: mid.clone().addScaledVector(d, -e * 0.7).add(new THREE.Vector3(0, e * 0.75, 0)), target: mid })
    : SKI ? (e) => ({ pos: mid.clone().addScaledVector(side, e * 0.75).addScaledVector(d, -e * 0.25).add(new THREE.Vector3(0, e * 0.55, 0)), target: mid })
    : (e) => ({ pos: mid.clone().addScaledVector(side, e * 0.32).addScaledVector(d, -e * 0.22).add(new THREE.Vector3(0, e * 0.95, 0)), target: mid });   // disc golf: ~65 deg down, the line and both ends stay in view
  return mkO(compact() ? fitToScreen(mkO, ext, c.getSpacedPoints(30)) : ext);
}

// The side panel covers the left of the window: frame things in the free area to its right.
function panelOcc() {
  const p = $("panel");
  if (innerWidth <= 640 || p.classList.contains("collapsed") || p.style.display === "none") return 0;
  return p.getBoundingClientRect().right + 12;
}
const phone = () => innerWidth <= 640;
function compact() { return innerWidth <= 640 || innerHeight <= 500; }   // phones, portrait or landscape
const sheetH = () => (phone() ? $("panel").getBoundingClientRect().height : 0);
const effAspect = () => { const a = (innerWidth - panelOcc()) / Math.max(innerHeight - sheetH(), 1); return a > 0.2 ? a : 16 / 9; };
// shift the projection centre into the free area (labels, picking and rendering all use the same projection)
function updateViewOffset() {
  const dx = panelOcc() / 2, dy = sheetH() / 2;
  if (dx > 0 || dy > 0) camera.setViewOffset(innerWidth, innerHeight, -dx, dy, innerWidth, innerHeight); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); invalidate();
}

// Starting pose of the intro: looks nearly straight down from the printed map's direction, whole resort in frame.
function paperView() {
  const w = wholeView();
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const f of D.features) for (const q of [f.path[0], f.path[f.path.length - 1]]) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), asp = effAspect();
  const r = Math.max((z1 - z0) * 1.25 / (2 * t), (x1 - x0) * 1.2 / (2 * t * asp));
  const az = toSph(w.pos.clone().sub(w.target)).az, pol = THREE.MathUtils.degToRad(9);
  const pos = new THREE.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)).multiplyScalar(r).add(w.target);
  return { pos, target: w.target.clone() };
}

// portrait phones: back the camera off until every point lands inside the free area above the bottom sheet
function fitToScreen(mkView, dist, pts) {
  const cx = panelOcc() / innerWidth, cy = sheetH() / innerHeight, cam = camera.clone(), yb = 0.86 * (innerHeight - sheetH() - (compact() ? 112 : 0)) / innerHeight *   // phones: keep clear of the top bar too
    (compact() && !phone() ? 1.05 : 1), xb = (compact() && !phone() ? 1.0 : 0.86) * Math.min(1, (innerWidth - panelOcc()) / innerWidth);   // landscape phone: stay clear of the side panel and the top bar
  for (let i = 0; i < 6; i++) {
    const v = mkView(dist); cam.position.copy(v.pos); cam.lookAt(v.target); cam.updateMatrixWorld(true);
    // measure from the centre of the free area: the view offset puts it above (sheet) or right of (side panel) the screen centre
    let r = 0; for (const q of pts) { const nd = q.clone().project(cam); r = Math.max(r, Math.abs(nd.x - cx) / xb, Math.abs(nd.y - cy) / yb); }
    if (Math.abs(r - 1) < 0.03) break;
    dist *= THREE.MathUtils.clamp(r, 0.6, 2);
  }
  return dist;
}

function wholeView() {
  const pist = D.features.filter((f) => f.kind !== "lift");
  const pts = pist.flatMap((f) => [V(f.path[0]), V(f.path[f.path.length - 1])]);
  const box = new THREE.Box3().setFromPoints(pts);
  const mid = box.getCenter(new THREE.Vector3());
  let dir;
  if (SKI && D.map_view_azimuth_deg != null) { // same direction the resort's printed map is drawn from
    const az = D.map_view_azimuth_deg * Math.PI / 180;
    dir = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
  } else if (SKI) { // classic piste-map angle: stand in the valley looking up at the summit
    const tops = pist.map((f) => V(f.path[0])), bots = pist.map((f) => V(f.path[f.path.length - 1]));
    const top = tops.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(tops.length);
    const bot = bots.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(bots.length);
    dir = horizDir(top, bot);
  } else dir = new THREE.Vector3(0, 0, 1);
  const ext = Math.max(box.getSize(new THREE.Vector3()).length(), 200);
  if (SKI && D.map_view_azimuth_deg != null) { // fill the frame like the printed panorama, ~35° down
    const k = Math.max(0.55, 0.62 * (16 / 9) / effAspect());
    // low panorama angle (~28°) like a painted piste map: mountain fills the frame, valley along the bottom
    let tgt = mid.clone();
    // portrait phone: centre on the middle of the mountain (runs 3, 1, 4, 7, 5, 3b, 4A) and fill the screen with them; the outer runs run off the edges
    const focus = phone() ? D.features.filter((f) => f.kind === "piste" && ["3", "1", "4", "7", "5", "3b", "4A"].includes(f.ref)) : [];
    const focusPts = focus.length >= 4 ? focus.flatMap((f) => f.path.filter((_, i) => i % 3 === 0 || i === f.path.length - 1).map((q) => V(q))) : null;
    if (focusPts) tgt = new THREE.Box3().setFromPoints(focusPts).getCenter(new THREE.Vector3());
    tgt.y = heightAt(tgt.x, tgt.z) + 80;
    const tilt = 0.49;   // same angle as the printed map on every screen
    const mkView = (d) => ({ pos: tgt.clone().addScaledVector(dir, d * Math.cos(tilt)).add(new THREE.Vector3(0, d * Math.sin(tilt), 0)), target: tgt });
    let dist = ext * k * 0.84;   // home: the mountain fills the free area
    if (focusPts) dist = fitToScreen(mkView, dist, focusPts) * 0.76;   // then a little closer: the very ends of those runs may touch the screen edge, the numbers stay in
    else if (compact()) dist = fitToScreen(mkView, dist, [...D.features.flatMap((f) => [V(f.path[0]), V(f.path[f.path.length - 1])]), ...(D.hubs || []).map((h) => new THREE.Vector3(h.at[0], heightAt(h.at[0], h.at[1]), h.at[1]))]);
    return mkView(dist);
  }
  return { pos: mid.clone().addScaledVector(dir, ext * 0.95).add(new THREE.Vector3(0, ext * 0.75, 0)), target: mid };
}

// ---------- camera animation ----------
let anim = null;   // {from, to, t, dur}
let fly = null;    // {curve, L, s, onDone}
const tmpT = new THREE.Vector3();
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const toSph = (v) => { const r = v.length(); return { r, polar: Math.acos(Math.min(1, Math.max(-1, v.y / r))), az: Math.atan2(v.x, v.z) }; };
function goTo(view, dur = 1.6, arc = false) {
  fly = null;
  anim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: view.pos, t1: view.target, t: 0, dur, arc };
  if (arc) { anim.s0 = toSph(anim.p0.clone().sub(anim.t0)); anim.s1 = toSph(view.pos.clone().sub(view.target)); }
}

// a ball rolls ahead of the camera along the run during the fly-along (ski resorts only): bright orange with a soft white halo
const ball = new THREE.Group(); ball.visible = false;
if (SKI) {
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), new THREE.MeshStandardMaterial({ color: 0xed7102, emissive: 0xed7102, emissiveIntensity: 0.35, roughness: 0.4 })));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
  halo.renderOrder = 3; ball.add(halo); scene.add(ball);
}
function updateBall() {
  const on = SKI && !!(fly && !fly.lift);
  ball.visible = on;
  if (!on) return;
  const p = fly.curve.getPointAt(Math.min(1, fly.s / fly.L));
  ball.position.set(p.x, heightAt(p.x, p.z) + 2.8, p.z);
}
// ---------- the flying disc (disc golf fly-along) ----------
const discLift = (fl, sPos) => 1.4 + Math.min(9, Math.max(3, 0.05 * fl.L)) * Math.sin(Math.PI * Math.min(1, Math.max(0, sPos / fl.L)));   // metres above the ground: release, rise, fade
const discObj = new THREE.Group(); discObj.visible = false; discObj.rotation.order = "YXZ";
const discSpin = new THREE.Group(); discObj.add(discSpin);
if (!SKI) {
  const prof = [[0, 0.0185], [0.04, 0.0196], [0.072, 0.0172], [0.09, 0.0138], [0.0990, 0.0098], [0.1046, 0.0052], [0.1030, 0.0016], [0.0985, 0.0], [0.0895, 0.0006], [0.0850, 0.0098], [0.045, 0.0136], [0, 0.0136]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48),
    new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide }));
  const stamp = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.058, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide }));
  stamp.rotation.x = -Math.PI / 2; stamp.position.y = 0.0199;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.0022, 6, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.0055;
  discSpin.add(body, stamp, rim);
  discSpin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  discObj.scale.setScalar(5.5);
  scene.add(discObj);
}
function updateDisc(dt) {
  const on = !SKI && !!(fly && !fly.lift);
  discObj.visible = on;
  if (!on) return;
  const fr = Math.min(1, fly.s / fly.L), c = fly.curve, p = c.getPointAt(fr), tg = c.getTangentAt(fr);
  const lift = discLift(fly, fly.s), slope = discLift(fly, fly.s + 1) - lift;
  discObj.position.set(p.x, p.y + lift, p.z);
  const turn = Math.atan2(c.getTangentAt(Math.min(1, fr + 0.03)).x, c.getTangentAt(Math.min(1, fr + 0.03)).z) - Math.atan2(c.getTangentAt(Math.max(0, fr - 0.03)).x, c.getTangentAt(Math.max(0, fr - 0.03)).z);
  discObj.rotation.set(-Math.atan(slope) + 0.1, Math.atan2(tg.x, tg.z), -0.36 + Math.max(-0.3, Math.min(0.3, turn * 2)));   // nose with the arc, a hyzer bank, leaning into bends
  discSpin.rotation.y += dt * 26 * speedMul;
}
const SPEEDS = { Slow: 0.6, Normal: 1, Fast: 1.8, "4×": 4 };
let speedMul = 1;

function startFly(f, onDone, frac = 0) {
  anim = null;
  const c = pathCurve(f);
  const next = { f, curve: c, L: c.getLength(), s: 0, onDone, lift: f.kind === "lift" };
  next.s = frac * next.L;
  goTo(flyPose(next), 1.2); // ease into the first pose, then the loop takes over
  fly = next;
}
function flyPose(fl) {
  const { curve: c, L, s } = fl;
  const p = c.getPointAt(Math.min(1, s / L));
  const ahead = c.getPointAt(Math.min(1, (s + (SKI ? 160 : 18)) / L));
  if (!SKI && !fl.lift) { p.y += discLift(fl, s); ahead.y += discLift(fl, s + 18); }   // the disc is in the air
  const behind = horizDir(p, ahead.distanceTo(p) < 1 ? c.getPointAt(1) : ahead);
  if (fl.lift) {
    return { pos: p.clone().addScaledVector(behind, -25).add(new THREE.Vector3(0, 4, 0)), target: ahead.clone().add(new THREE.Vector3(0, 2, 0)) };
  }
  return SKI
    ? { pos: p.clone().addScaledVector(behind, -75).add(new THREE.Vector3(0, 38, 0)), target: ahead }   // zoomed out, the ball a little ahead
    : { pos: p.clone().addScaledVector(behind, -15).add(new THREE.Vector3(0, 4.5 + 2.5 * Math.sin(Math.PI * Math.min(1, s / L)), 0)), target: ahead.clone().add(new THREE.Vector3(0, -0.6, 0)) };
}

// ---------- labels ----------
// Icon set follows the resort map legend; glyphs are Material Symbols.
const ICONS = {
  wc: ["wc", "#26292b", "WC"], gastro: ["restaurant", "#138d9c", "Gastronomia · Restaurant"],
  bar: ["local_bar", "#138d9c", "Ski bar"], hut: ["cottage", "#8a5a33", "Schronisko · Mountain hut"],
  terrace: ["deck", "#d9a520", "Taras · Terrace deck"], playground: ["toys", "#d9a520", "Plac zabaw · Playground"],
  changing: ["baby_changing_station", "#138d9c", "Przewijak · Changing table"],
  viewpoint: ["landscape", "#3b3f42", "Punkt widokowy · Viewpoint"],
  rescue: ["emergency", "#1f5fb8", "Dyżurka GOPR · Mountain rescue"],
  info: ["info", "#2f9a45", "Infocentrum · Info center"], cash: ["payments", "#2f9a45", "Kasy · Cash desk"],
  ticket_machine: ["point_of_sale", "#2f9a45", "Biletomat · Ticket machine"],
  gopass: ["confirmation_number", "#1d4f9c", "Bilety Gopass"], parking: ["local_parking", "#1d4f9c", "Parking"],
  bus: ["directions_bus", "#1d4f9c", "Skibus stop"], ev: ["ev_station", "#2f9a45", "EV car charger"],
  camper: ["rv_hookup", "#2f9a45", "Camper park"], rental: ["downhill_skiing", "#d6303a", "Wypożyczalnia · Ski rental"],
  service: ["build", "#d6303a", "Ski serwis"], lockers: ["lock", "#d6303a", "Przechowalnia · Ski lockers"],
  shop: ["shopping_bag", "#d6303a", "Sklep · Shop"], school: ["school", "#d6303a", "Szkoła narciarska · Ski school"],
  hotel: ["hotel", "#8c2f3a", "Hotel"], test_center: ["science", "#26292b", "Test center"],
  learning_zone: ["child_care", "#e07b2a", "Strefa nauki jazdy · Ski learning zone"],
  coaster: ["attractions", "#c9a227", "Alpine coaster"], action: ["snowboarding", "#e0408a", "Action slope zone"],
  webcam: ["videocam", "#c0392b", "Kamera online · Webcam (opens the resort page)"],
  snow: ["ac_unit", "#3a8fd6", "System naśnieżania · Snowmaking"], night: ["dark_mode", "#e7b416", "Jazda wieczorna · Evening skiing"],
};
const LIFT_ICON = { gondola: "gondola_lift", cable_car: "gondola_lift", chair_lift: "chair_alt", mixed_lift: "chair_alt",
  platter: "north_east", "t-bar": "north_east", drag_lift: "north_east", j_bar: "north_east", rope_tow: "north_east", magic_carpet: "conveyor_belt" };
const ico = (k, small) => {
  const [glyph, col, text] = ICONS[k] || ["help", "#777", k];
  return `<span class="ico${small ? " s" : ""}" style="background:${col}" title="${text}">${glyph}</span>`;
};

const labelsEl = $("labels");
const labels = []; // {el, pos, prio, group}, kept sorted by priority
const groupOn = { status: true, cams: false, peaks: true, brand: true, pistes: true, lifts: !(innerWidth <= 640 || innerHeight <= 500), places: false, services: false, snow: false, night: false, pois: false, sel: true, icons: true };   // default map: piste numbers only
labelsEl.classList.add("no-snow");
// thin stems tie every pin to its ground point
const stems = document.createElementNS("http://www.w3.org/2000/svg", "svg");
stems.id = "stems";
labelsEl.parentNode.insertBefore(stems, labelsEl);
const svgEl = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); stems.appendChild(e); return e; };
function addLabel(html, pos, cls, onClick, prio = 50, group = "sel", on = null) {
  const el = document.createElement("div");
  el.className = "lbl " + cls; el.innerHTML = html;
  if (onClick) el.addEventListener("click", onClick);
  labelsEl.appendChild(el);
  const ground = new THREE.Vector3(pos.x, heightAt(pos.x, pos.z), pos.z);
  const l = { el, pos, ground, cls, prio, group, on, w: 0, h: 0, line: null, dot: null };
  labels.push(l);
  labels.sort((p, q) => q.prio - p.prio);
  return l;
}
const up = (y) => new THREE.Vector3(0, y, 0);
const at3 = (x, z, lift) => new THREE.Vector3(x, heightAt(x, z) + lift, z);
function pathPoints(path, everyM, firstFrac = 0.35) {
  const pts = path.map(([x, , z]) => new THREE.Vector3(x, 0, z));
  if (pts.length < 2) return [];
  const curve = new THREE.CatmullRomCurve3(pts), L = curve.getLength();
  const n = Math.max(1, Math.floor(L / everyM));
  return Array.from({ length: n }, (_, i) => curve.getPointAt(n === 1 ? firstFrac : (i + 0.5) / n));
}

let selLabels = [];
let listed = [];
const loadListed = () => {
  listed = D.features.filter((f) => f.listed).sort((a, b) => SKI ? 0 : a.number - b.number);
  listed.forEach((f) => { f.num = f.kind === "hole" ? f.number : f.kind === "lift" ? f.name : (f.ref || f.name); });
};
loadListed();
let holeLabels = [];
function buildHoleLabels() {
  for (const l of holeLabels) { l.el.remove(); l.line?.remove(); l.dot?.remove(); labels.splice(labels.indexOf(l), 1); }
  holeLabels = listed.map((f) => {
    const lbl = addLabel(String(f.num), V(f.path[0]).add(up(4)), "badge", () => select(f, "overview"), 60, "pistes");
    lbl.el.style.background = "#1d3b30";
    return lbl;
  });
}

if (SKI) {
  buildPinsWhenFontsReady();
} else {
  buildHoleLabels();
}


// ---------- 3D pins: piste numbers, lift tags, night/snow icons, bus/parking ----------
// Drawn as sprites INSIDE the scene (same camera, same depth buffer as the terrain): they stand on their ground
// point, stay put while the camera moves, and are hidden by ridges exactly like the terrain itself.
const pinCache = new Map();
function canvasTex(w, h, draw) {
  const DPR = 2, c = document.createElement("canvas");
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext("2d"); g.scale(DPR, DPR); draw(g, w, h);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, w, h };
}
const cached = (key, make) => { let v = pinCache.get(key); if (!v) pinCache.set(key, (v = make())); return v; };
function drawIcon(g, k, x, y, size, circle) {
  const [glyph, col] = ICONS[k] || ["help", "#777"];
  g.fillStyle = col; g.beginPath();
  if (circle) g.arc(x + size / 2, y + size / 2, size / 2, 0, 7); else g.roundRect(x, y, size, size, 3);
  g.fill();
  g.fillStyle = "#fff"; g.font = `${Math.round(size * 0.78)}px "Material Symbols Rounded"`;
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(glyph, x + size / 2, y + size / 2 + 0.5);
}
const pnumTex = (ref, color, st = 0) => cached(`p:${ref}:${color}:${st}`, () => canvasTex(26, 26, (g) => {
  g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.fillStyle = st >= 1 ? "#8d96a0" : color; g.beginPath(); g.arc(13, 12.5, 10.5, 0, 7); g.fill();
  g.shadowColor = "transparent"; g.lineWidth = 2; g.strokeStyle = st > 0 && st < 1 ? "#f2a516" : "#fff"; g.stroke();
  g.fillStyle = "#fff"; g.font = `700 ${ref.length > 2 ? 9 : 11}px Montserrat, Manrope, system-ui, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ref, 13, 13);
}));
const liftTex = (name, seats, type, st = 0) => cached(`l:${name}:${seats}:${type}:${st}`, () => {
  const m = document.createElement("canvas").getContext("2d"); m.font = "800 12.5px Montserrat, Manrope, system-ui, sans-serif";
  const tw = m.measureText(name).width, w = Math.ceil(26 + tw + (seats ? 11 : 0) + 4);
  return canvasTex(w, 24, (g) => {
    g.fillStyle = "#fff"; g.strokeStyle = "#111"; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, w - 2, 22, 3); g.fill(); g.stroke();
    g.fillStyle = "#111"; g.fillRect(3, 3, 18, 18);
    g.fillStyle = "#fff"; g.font = '15px "Material Symbols Rounded"'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(LIFT_ICON[type] || "north_east", 12, 12.5);
    g.fillStyle = "#111"; g.font = "800 12.5px Montserrat, Manrope, system-ui, sans-serif"; g.textAlign = "left"; g.fillText(name, 25, 13);
    if (seats) { g.font = "700 9px Montserrat, Manrope, system-ui, sans-serif"; g.fillText(String(seats), 25 + tw + 2, 8); }
    if (STATUS && st !== null) {   // status dot in the corner of the tag (none for lifts the feed does not list)
      g.fillStyle = st >= 1 ? "#9aa3ad" : st > 0 ? "#f2a516" : "#2fb35a"; g.beginPath(); g.arc(w - 5, 5, 3.8, 0, 7); g.fill();
      g.strokeStyle = "#fff"; g.lineWidth = 1.3; g.stroke();
    }
  });
});
const camTex = (c) => cached(`c:${c.name}`, () => {
  const m = document.createElement("canvas").getContext("2d"); m.font = "700 11px Montserrat, Manrope, system-ui, sans-serif";
  const w = Math.ceil(26 + m.measureText(c.name).width + 8);
  return canvasTex(w, 24, (g) => {
    g.fillStyle = "#fff"; g.shadowColor = "rgba(0,0,0,.3)"; g.shadowBlur = 4; g.beginPath(); g.roundRect(1, 1, w - 2, 21, 5); g.fill(); g.shadowColor = "transparent";
    drawIcon(g, "webcam", 3, 3, 17, false);
    g.fillStyle = "#15202b"; g.font = "700 11px Montserrat, Manrope, system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(c.name, 24, 12);
  });
});
const camIconTex = () => cached("cam-icon", () => canvasTex(34, 34, (g) => {   // a bold round camera badge: easy to find from far away
  g.shadowColor = "rgba(0,0,0,.4)"; g.shadowBlur = 4; g.fillStyle = "#fff"; g.beginPath(); g.arc(17, 17, 14, 0, 7); g.fill(); g.shadowColor = "transparent";
  g.fillStyle = "#c0392b"; g.beginPath(); g.arc(17, 17, 11.5, 0, 7); g.fill();
  g.fillStyle = "#fff"; g.font = '16px "Material Symbols Rounded"'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("videocam", 17, 17.5);
}));
const iconTex = (k) => cached(`i:${k}`, () => canvasTex(21, 21, (g) => drawIcon(g, k, 1, 1, 19, false)));
const duoTex = (snow, night) => cached(`d:${snow}:${night}`, () => canvasTex(snow && night ? 36 : 18, 18, (g) => {
  let x = 1; if (snow) { drawIcon(g, "snow", x, 1, 16, true); x += 18; } if (night) drawIcon(g, "night", x, 1, 16, true);
}));


const hubTex = (h) => cached(`h:${h.name}`, () => {
  const title = h.name.toUpperCase(), ele = h.ele ? ` ${h.ele} m` : "";
  const m = document.createElement("canvas").getContext("2d");
  m.font = "800 11.5px Montserrat, Manrope, system-ui, sans-serif"; const tw = m.measureText(title).width;
  m.font = "800 11.5px Montserrat, Manrope, system-ui, sans-serif"; const ew = ele ? m.measureText(ele).width : 0;
  m.font = "600 10px Montserrat, Manrope, system-ui, sans-serif"; const sw = h.sub ? m.measureText(h.sub).width : 0;
  const glyph = h.peak ? 18 : 0, icons = h.peak ? [] : h.icons || [], perRow = 7, rows = Math.ceil(icons.length / perRow);
  const iconW = Math.min(icons.length, perRow) * 21;
  const w = Math.ceil(Math.max(glyph + tw + ew, sw, iconW) + 10), hgt = 18 + (h.sub ? 14 : 0) + rows * 22 + 4;
  return canvasTex(w, hgt, (g) => {
    g.lineJoin = "round"; g.textBaseline = "middle"; g.textAlign = "left";
    const halo = (text, x, y) => { g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 3.5; g.strokeText(text, x, y); g.fillStyle = "#15202b"; g.fillText(text, x, y); };
    let y = 9, x = (w - (glyph + tw + ew)) / 2;
    if (h.peak) { g.font = '16px "Material Symbols Rounded"'; halo("landscape", x, y + 0.5); x += glyph; }
    g.font = "800 11.5px Montserrat, Manrope, system-ui, sans-serif"; halo(title, x, y); if (ele) halo(ele, x + tw, y);
    y += 14;
    if (h.sub) { g.font = "600 10px Montserrat, Manrope, system-ui, sans-serif"; halo(h.sub, (w - sw) / 2, y - 1); y += 14; }
    icons.forEach((k, i) => { const r = Math.floor(i / perRow), c = i % perRow, rowN = Math.min(perRow, icons.length - r * perRow);
      drawIcon(g, k, (w - rowN * 21) / 2 + c * 21 + 1, y - 7 + r * 22, 19, false); });
  });
});
const pinScale = (t) => { const sy = t.h * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight; return [sy * t.w / t.h, sy]; };
const pinMats = new Map();
// depth=false: big labels stay readable over trees; they are hidden only when their ground point is behind terrain (occluded())
function pinMat(t, depth = true) { const k = t.tex.uuid + depth; let m = pinMats.get(k); if (!m) pinMats.set(k, (m = new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, depthTest: depth, sizeAttenuation: false }))); return m; }
const pins = [];
function addPin(t, x, z, prio, group, opts = {}) {
  const gy = heightAt(x, z);
  const sp = new THREE.Sprite(pinMat(t, opts.depth !== false));
  sp.center.set(0.5, opts.lift ? -opts.lift : opts.below ? 1 : 0);              // the pin's bottom edge stands on the ground point (below: it hangs under it)
  sp.position.set(x, gy + 1.5, z);
  const big = opts.kind === "pnum" && compact() ? 0.85 : 1;   // phone: piste numbers are the main thing, so they are drawn bigger
  sp.scale.set(...pinScale(t).map((v) => v * big), 1);
  sp.renderOrder = 5;
  sp.userData.feature = opts.feature || null;
  sp.userData.url = opts.url || null;
  sp.userData.cam = opts.cam || null;
  scene.add(sp);
  const l = { isSprite: true, sprite: sp, pos: sp.position, ground: new THREE.Vector3(x, gy, z), prio, group, on: opts.on || null,
              variants: opts.variants || null, below: !!opts.below, lift: opts.lift || 0, tags: opts.tags || [], pkey: opts.pkey || null, big, kind: opts.kind || null, f: opts.feature || null, cur: null, w: t.w * big, h: t.h * big, t };
  labels.push(l); labels.sort((p, q) => q.prio - p.prio); pins.push(l);
  return l;
}
function rescalePins() { for (const l of pins) { l.sprite.scale.set(...pinScale(l.t).map((v) => v * (l.big || 1)), 1); } }
function pickVariant(l) {
  const key = `${l.variants.snow && groupOn.snow}|${l.variants.night && groupOn.night}`;
  if (key === l.cur) return;
  l.cur = key;
  l.t = duoTex(l.variants.snow && groupOn.snow, l.variants.night && groupOn.night);
  l.sprite.material = pinMat(l.t); l.sprite.scale.set(...pinScale(l.t), 1); l.w = l.t.w; l.h = l.t.h;
}
const liftCat = (type) => type === "gondola" || type === "cable_car" ? "gondola" : type === "chair_lift" || type === "mixed_lift" ? "chair" : "surface";
const peakRank = new Map((D.hubs || []).filter((h) => h.peak).sort((a, b) => a.at[0] - b.at[0]).map((h, i) => [h, i]));   // neighbouring peak names alternate high / low so they never touch
function buildPins() {
  for (const f of D.features.filter((x) => x.kind === "piste" && x.ref && !x.ref.includes("&"))) {
    // Every number gets several spots along its run; the label pass shows the first one that does not collide with a number already placed,
    // so crowded places still end up with (almost) every run numbered. One number per ~900 m of run, extra branches get their own.
    const spots = (path, perSeg, firstFrac) => {
      const cur = new THREE.CatmullRomCurve3(path.map(([x, , z]) => new THREE.Vector3(x, 0, z))), nSeg = Math.max(1, Math.floor(cur.getLength() / perSeg)), out = [];
      for (let i = 0; i < nSeg; i++) {
        const u0 = nSeg === 1 ? firstFrac : (i + 0.5) / nSeg, list = [];
        for (const o of [0, -0.3, 0.3, -0.15, 0.15, -0.45, 0.45]) list.push(cur.getPointAt(Math.min(0.96, Math.max(0.04, u0 + o / nSeg))));
        out.push(list);
      }
      return out;
    };
    const groups = spots(f.path, 900, 0.4);
    (f.extra_paths || []).forEach((q) => { if (q.length > 50) groups.push(...spots(q, 1e9, 0.5)); });
    groups.forEach((list, gi) => list.forEach((m, k) => addPin(pnumTex(f.ref, PISTE_RGB[f.difficulty], stateOf(f)), m.x, m.z, 60 - k * 0.01, "pistes",
      { feature: f, kind: "pnum", depth: false, pkey: f.ref + "#" + gi, tags: ["run:" + f.difficulty, ...(f.lit ? ["run:lit"] : [])], on: () => groupOn.pistes && (!diffFilter || f.difficulty === diffFilter) })));
    if (f.snowmaking)   // snowmaking stays an icon; evening skiing is the yellow edge on the run itself
      for (const m of pathPoints(f.path, 520, 0.5)) addPin(duoTex(true, false), m.x, m.z, 10, "icons", { tags: ["icon:snow"], on: () => groupOn.snow });
  }
  for (const f of D.features.filter((x) => x.kind === "lift")) {
    const m = f.cable[Math.floor(f.cable.length * 0.45)];
    addPin(liftTex(f.name, f.seats, f.lift_type, f.status ? stateOf(f) : null), m.x, m.z, 70, "lifts", { feature: f, depth: false, kind: "lift", tags: ["lift:" + liftCat(f.lift_type)] });
  }
  for (const p of D.pois || []) addPin(iconTex(p.icon), p.at[0], p.at[1], 30, "pois", { tags: ["icon:" + p.icon] });
  for (const c of D.webcams || []) addPin(camIconTex(), c.at[0], c.at[1], 100, "cams", { url: c.url, cam: c, depth: false, tags: ["icon:webcam"] });   // just a camera icon: clickable, no name pill to overlap
  for (const h of D.hubs || []) addPin(hubTex(h), h.at[0], h.at[1], h.peak ? 85 : 80, h.peak ? "peaks" : h.icons?.length ? "services" : "places", { depth: false, lift: h.peak ? (peakRank.get(h) % 2 ? 5.2 : 2.6) : 0, tags: h.peak ? ["peak"] : [] });
  // legend: picking one service shows just that icon at every place that has it, not the whole label with all its icons
  for (const h of D.hubs || []) for (const k of new Set(h.icons || [])) addPin(iconTex(k), h.at[0], h.at[1], 70, "legendicons", { depth: false, tags: ["icon:" + k], on: () => !!legendSel });
  for (const a of D.attractions || []) { const q = a.at || a.line[Math.floor(a.line.length / 2)]; addPin(iconTex(a.icon), q[0], q[1], 50, "places", { depth: false, tags: ["icon:" + a.icon] }); }
}
// the two base stations carry the resort brands on the home view
const brandTex = (name) => cached(`b:${name}`, () => {
  const m = document.createElement("canvas").getContext("2d"); m.font = "800 13px Montserrat, Manrope, system-ui, sans-serif";
  const w = Math.ceil(m.measureText(name).width + 38);
  return canvasTex(w, 28, (g) => {
    g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 5; g.fillStyle = "#14202b"; g.beginPath(); g.roundRect(2, 1, w - 4, 24, 12); g.fill(); g.shadowColor = "transparent";
    g.fillStyle = "#fff"; g.font = '17px "Material Symbols Rounded"'; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText("landscape", 8, 13.5);
    g.font = "800 13px Montserrat, Manrope, system-ui, sans-serif"; g.fillText(name, 28, 13.5);
  });
});
function addBrandPins() {
  for (const [hub, name] of [["Szczyrk Gondola", "SZCZYRK"], ["KL Skrzyczne", "SKRZYCZNE"]]) {
    const h = (D.hubs || []).find((x) => x.name === hub);
    if (h) addPin(brandTex(name), h.at[0], h.at[1], 90, "brand", { depth: false, lift: 2.2, on: () => !groupOn.services });   // out of the way when all services show
  }
}
function buildPinsWhenFontsReady() {
  const ready = Promise.all([document.fonts.load('20px "Material Symbols Rounded"'), document.fonts.load("700 11px Montserrat"), document.fonts.load("800 12px Montserrat")]).catch(() => {});
  Promise.race([ready, new Promise((r) => setTimeout(r, 3000))]).then(() => { buildPins(); invalidate(); });
}

// webcam popup: the same player the resort's own pages embed, closed with the x, Esc or a click outside
let camReturnFocus = null;
function closeCam() {
  const box = $("cam"); if (box.hidden) return;
  box.hidden = true; box.querySelector(".cam-frame").replaceChildren();          // removing the frame stops the stream
  camReturnFocus?.focus?.();
}
function openCam(c) {
  const box = $("cam"); camReturnFocus = document.activeElement;
  $("cam-title").textContent = c.name + (c.ele ? " · " + c.ele + " m" : "");
  $("cam-open").href = c.url;
  const f = document.createElement("iframe");
  f.src = c.player; f.title = c.name; f.allowFullscreen = true; f.referrerPolicy = "origin";
  f.setAttribute("allow", "autoplay; fullscreen");
  box.querySelector(".cam-frame").replaceChildren(f);
  box.hidden = false; $("cam-x").focus();
}
$("cam-x").addEventListener("click", closeCam);
$("cam").addEventListener("pointerdown", (e) => { if (e.target === $("cam")) closeCam(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeCam(); });

// click a pin to select its run / lift (a click, not a drag); the pointer shows a hand over anything clickable
{
  const rc = new THREE.Raycaster(); let down = null, lastMove = 0;
  const pick = (e) => {
    rc.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    return rc.intersectObjects(pins.filter((l) => l.sprite.visible && (l.sprite.userData.feature || l.sprite.userData.url)).map((l) => l.sprite), false)[0];
  };
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY, performance.now()]; });
  renderer.domElement.addEventListener("pointermove", (e) => {
    const t = performance.now(); if (e.buttons || t - lastMove < 80) return; lastMove = t;
    renderer.domElement.style.cursor = pick(e) ? "pointer" : "";
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || performance.now() - down[2] > 500) return;
    const hit = pick(e);
    if (hit && hit.object.userData.cam?.player) openCam(hit.object.userData.cam);           // webcam: live player in a popup
    else if (hit && hit.object.userData.url) window.open(hit.object.userData.url, "_blank", "noopener");
    else if (hit) { stopTour(); select(hit.object.userData.feature, "overview"); }
  });
}

function setSelLabels(f) {
  for (const l of selLabels) { l.el.remove(); l.line?.remove(); l.dot?.remove(); labels.splice(labels.indexOf(l), 1); }   // also drop their stems, or they stay behind in the sky
  selLabels = [];
  const c = pathCurve(f), a = c.getPointAt(0), b = c.getPointAt(1);
  if (f.kind === "hole") {
    for (const k of f.ob_water || []) {
      const poly = D.water[k], cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cz = poly.reduce((a, q) => a + q[1], 0) / poly.length;
      const l = addLabel("OB", new THREE.Vector3(cx, 0, cz).add(up(2)), "badge", null, 90); l.el.style.background = "#d4312c"; selLabels.push(l);
    }
    for (const [mx, mz] of mandosOf(f)) { const l = addLabel("MANDO", new THREE.Vector3(mx, 0, mz).add(up(5)), "badge", null, 95); l.el.style.background = "#d4312c"; selLabels.push(l); }
    if (showMarkers && f.dgpt) {   // drop zones, numbered from the tee outwards
      const t0 = f.path[0], dzs = [...f.dgpt.dz].sort((p, q) => Math.hypot(p[0] - t0[0], p[1] - t0[2]) - Math.hypot(q[0] - t0[0], q[1] - t0[2]));
      dzs.forEach(([x, z], i) => { const l = addLabel(dzs.length > 1 ? `DZ ${i + 1}` : "DZ", new THREE.Vector3(x, 0, z).add(up(4)), "badge", null, 93); l.el.style.background = "#0b1d3a"; l.el.style.boxShadow = "0 0 0 2px #ef5266"; selLabels.push(l); });
    }
  } else if (SKI && compact()) {   // phone: no height tags on the map, they hide the line; the chart has the heights
  } else if (f.kind === "lift") {
    selLabels.push(addLabel(`<b>${Math.round(T.zmin + a.y - LIFT_CLEAR)} m</b><small>${f.from || "valley station"}</small>`, a.clone().add(up(18)), "", null, 100));
    selLabels.push(addLabel(`<b>${Math.round(T.zmin + b.y - LIFT_CLEAR)} m</b><small>${f.to || "top station"}</small>`, b.clone().add(up(18)), "", null, 100));
  } else {
    selLabels.push(addLabel(`<b>${Math.round(T.zmin + a.y)} m</b><small>start</small>`, a.clone().add(up(18)), "", null, 100));
    selLabels.push(addLabel(`<b>${Math.round(T.zmin + b.y)} m</b><small>finish · ${fmtDist(f.length_m)}</small>`, b.clone().add(up(18)), "", null, 100));
  }
}

const v3 = new THREE.Vector3();
let showLabels = true;
// Is the terrain between the camera and the pin's ground point higher than the line of sight? (heightfield march)
// A pin whose ground point is hidden is hidden too, so nothing floats over a ridge it belongs behind.
const _tgt = new THREE.Vector3();
function occluded(l) {
  const c = camera.position;
  _tgt.set(l.ground.x, l.ground.y + 3, l.ground.z);
  const dist = Math.hypot(_tgt.x - c.x, _tgt.z - c.z);
  if (dist < 40) return false;
  const n = Math.min(900, Math.max(24, Math.ceil(dist / 10)));   // ~10 m steps: no ridge slips between samples
  for (let i = 1; i < n; i++) {
    const t = i / n, x = c.x + (_tgt.x - c.x) * t, z = c.z + (_tgt.z - c.z) * t;
    if (x < X0 || x > X0 + T.width || z < Z0 || z > Z0 + T.depth) continue;
    if (!inAoi(x, z)) continue;                      // cut away: no terrain drawn there, nothing to hide behind
    if (heightAt(x, z) > c.y + (_tgt.y - c.y) * t) return true;
  }
  return false;
}
const gp = new THREE.Vector3();
function updateLabels() {
  const w = innerWidth, h = innerHeight, placed = [], placedKeys = new Set();
  const maxD = SKI ? 11000 * (phone() ? 1.8 : 1) : 1500;
  for (const l of labels) { // highest priority first; drop anything that would overlap a placed label
    v3.copy(l.pos).project(camera);
    let enabled = l.on ? l.on() : groupOn[l.group] !== false;
    if (legendSel) enabled = !!l.tags?.includes(legendSel.tag);
    if (fly && l.kind === "pnum") enabled = false;   // no number badge under the ball while flying
    let vis = showLabels && enabled && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05
      && camera.position.distanceTo(l.pos) < maxD;
    if (vis && l.prio < 100 && occluded(l)) vis = false;   // behind a ridge: do not float over it
    if (vis && l.variants) pickVariant(l);
    if (vis) {
      if (!l.isSprite && !l.w) { l.el.classList.remove("hidden"); l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h;
      const gap = l.lift * l.h, pd = l.kind === "pnum" ? 0 : 2, r = l.below ? [x - l.w / 2 - 2, y + 3, x + l.w / 2 + 2, y + l.h + 2] : [x - l.w / 2 - pd, y - gap - l.h - pd, x + l.w / 2 + pd, l.lift ? y - gap + 2 : y + pd];
      if (l.pkey && placedKeys.has(l.pkey)) vis = false;   // this number already has its spot
      else if (l.prio < 100 && placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) vis = false;
      else if (!l.isSprite) {
        placed.push(r); l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        // stem + dot down to the ground point the pin stands for
        gp.copy(l.ground).project(camera);
        const gx = (gp.x * 0.5 + 0.5) * w, gy = (-gp.y * 0.5 + 0.5) * h;
        if (gy - y > 4) {
          if (!l.line) { l.line = svgEl("line", { stroke: "rgba(20,32,43,.6)", "stroke-width": "1.3" }); l.dot = svgEl("circle", { r: "2.6", fill: "#fff", stroke: "rgba(20,32,43,.75)", "stroke-width": "1.2" }); }
          l.line.setAttribute("x1", x); l.line.setAttribute("y1", y); l.line.setAttribute("x2", gx); l.line.setAttribute("y2", gy);
          l.dot.setAttribute("cx", gx); l.dot.setAttribute("cy", gy);
          l.line.style.display = l.dot.style.display = "";
        } else if (l.line) l.line.style.display = l.dot.style.display = "none";
      } else {
        placed.push(r); if (l.pkey) placedKeys.add(l.pkey);
        if (l.lift) {   // the name floats above its point on a thin stem, clear of the icons standing on the ground
          if (!l.line) { l.line = svgEl("line", { stroke: "rgba(20,32,43,.7)", "stroke-width": "1.3" }); l.dot = svgEl("circle", { r: "2.6", fill: "#fff", stroke: "rgba(20,32,43,.75)", "stroke-width": "1.2" }); }
          l.line.setAttribute("x1", x); l.line.setAttribute("y1", y); l.line.setAttribute("x2", x); l.line.setAttribute("y2", y - gap);
          l.dot.setAttribute("cx", x); l.dot.setAttribute("cy", y); l.line.style.display = l.dot.style.display = "";
        }
      }
    }
    if (l.isSprite && l.line && !vis) l.line.style.display = l.dot.style.display = "none";
    if (l.isSprite) l.sprite.visible = vis;
    else {
      l.el.classList.toggle("hidden", !vis);
      if (!vis && l.line) l.line.style.display = l.dot.style.display = "none";
    }
  }
}

// ---------- panel ----------
let current = null, viewMode = "overview";
let renderHoleCard = () => {};
let discIdle = () => {};   // disc golf: back to "no hole selected"
let showMarkers = true;   // caddie-book markers (trunks, OB lines, drop zones, mandatories) on the selected hole
const mandosOf = (f) => (showMarkers && f.dgpt ? f.dgpt.mandos : (f.mando ? [f.mando] : []));   // set by the disc golf block near the end
const groupDefs = () => SKI
  ? [["Pistes", listed.filter((f) => f.kind === "piste"), true], ["Lifts", listed.filter((f) => f.kind === "lift"), true]]
  : [[`${D.subtitle_short || "Holes"}`, listed, false]];
function renderGroups() {
  const open = document.querySelector("#groups .pane:not([hidden])") ? true : false;
  const present = ["green", "blue", "red", "black", "orange"].filter((c) => listed.some((f) => f.kind === "piste" && f.difficulty === c));
  const filterBar = SKI ? `<div class="dfilter" role="group" aria-label="Filter pistes by difficulty"><button data-df="" class="${diffFilter ? "" : "on"}">All</button>${present.map((c) =>
    `<button data-df="${c}" class="${diffFilter === c ? "on" : ""}"><i style="background:${PISTE_RGB[c]}"></i>${{ green: "Green", blue: "Blue", red: "Red", black: "Black", orange: "Freeride" }[c]}</button>`).join("")}</div>` : "";
  $("groups").innerHTML = groupDefs().map(([, list0, wide], gi) => { const list = diffFilter ? list0.filter((f) => f.kind !== "piste" || f.difficulty === diffFilter) : list0;
    return `<div class="pane" data-p="g${gi}" ${open ? "" : "hidden"}>${gi === 0 ? filterBar : ""}<div class="chips${wide ? " wide" : ""}">${list.map((f) =>
    `<button class="chip" data-id="${f.id}" title="${f.name}">${f.kind === "piste" ? `<i style="background:${PISTE_RGB[f.difficulty]}"></i>` : f.kind === "lift" ? `<span class="ms ci">${LIFT_ICON[f.lift_type] || "chair_alt"}</span>` : ""}${f.num}</button>`).join("")}</div></div>`; }).join("");
  if (!SKI && D.layouts) {
    const seg = (name, list, cur) => `<h4>${name}</h4><div class="seg small" data-k="${name === "Tees" ? "layout" : "pin"}" style="margin-bottom:8px;flex-wrap:wrap">${
      list.map((v) => `<button data-val="${v}" class="${v === cur ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>`;
    const step = `<div class="layout-step"><button data-step="-1" class="ms" aria-label="Previous layout">chevron_left</button><b>${LAYOUT[0].toUpperCase() + LAYOUT.slice(1)}</b><button data-step="1" class="ms" aria-label="Next layout">chevron_right</button></div>`;
    $("groups").querySelector(".pane").insertAdjacentHTML("afterbegin", step + seg("Tees", D.layouts, LAYOUT) + (D.pins?.length > 1 ? seg("Basket position", D.pins, PIN) : ""));
  }
  if (current) document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.dataset.id === current.id));
}
renderGroups();
// tabs: one section open at a time, click the open one again to fold it away
$("tabs").innerHTML = [...groupDefs().map(([n], gi) => [`g${gi}`, n]), ...(SKI ? [["layers", "Legend"]] : [])].map(([k, n]) => `<button data-t="${k}">${n}</button>`).join("")
  + `<button id="whole" class="ms" title="Whole map" aria-label="Whole map">home</button>`;
function layersView() {   // closer than home, so icons and lifts read well
  const v = wholeView();
  return { pos: v.target.clone().add(v.pos.clone().sub(v.target).multiplyScalar(0.78)), target: v.target };
}
let tabNow = null, prevTab = null, touched = false;   // touched: the user dragged the map since the last selection
function openTab(k) {
  if (k) $("panel").classList.remove("min");
  if (SKI && !current && k !== tabNow && (k === "layers" || tabNow === "layers")) goTo(k === "layers" ? layersView() : wholeView(), 1.2);
  tabNow = k;
  document.querySelectorAll("#tabs [data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === k));
  document.querySelectorAll("#panel [data-p]").forEach((e) => { e.hidden = e.dataset.p !== k; });
  updateViewOffset();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) openTab(b.classList.contains("on") ? null : b.dataset.t); });
if (!SKI && D.layouts) {
  // switching tees / layout re-lists the holes and redraws the ground in place: no reload, no loading screen
  const switchLayout = (name) => {
    if (name === LAYOUT) return;
    const num = current?.number;
    LAYOUT = name; computeListed(); loadListed();
    paintGround(); paintFeatures(); terrainMat.map.needsUpdate = true;
    rebuildHoleFurniture(); buildHoleLabels();
    current = null; renderGroups();
    const f = listed.find((x) => x.number === num);
    if (f) { current = f; setHighlight(f); setSelLabels(f); renderPanel(f); setCorridor(f); history.replaceState(null, "", `?c=${KEY}&layout=${LAYOUT}&pin=${PIN}&hole=${f.number}`); }
    else { history.replaceState(null, "", `?c=${KEY}&layout=${LAYOUT}`); setCorridor(null); }
    invalidate(4);
  };
  $("groups").addEventListener("click", (e) => {
    const b = e.target.closest("[data-val]"); if (!b) return;
    if (b.parentElement.dataset.k === "layout") switchLayout(b.dataset.val);
    else { const q = new URLSearchParams({ c: KEY, layout: LAYOUT, pin: PIN }); q.set("pin", b.dataset.val); if (current) q.set("hole", current.number); location.replace(`?${q}`); }
  });
}
$("groups").addEventListener("click", (e) => {
  const st = e.target.closest("[data-step]");
  if (st && D.layouts) {   // previous / next layout: press the matching button of the (hidden) list
    const i = D.layouts.indexOf(LAYOUT), next = D.layouts[(i + +st.dataset.step + D.layouts.length) % D.layouts.length];
    $("groups").querySelector(`.seg[data-k="layout"] [data-val="${next}"]`)?.click();
    return;
  }
  const d = e.target.closest("[data-df]");
  if (d) { diffFilter = d.dataset.df || null; renderGroups(); openTab(tabNow); setMute(); labels.forEach((l) => { l.w = 0; }); invalidate(4); return; }
  const b = e.target.closest(".chip"); if (!b) return;
  const f = D.features.find((x) => x.id === b.dataset.id);
  if (f === current) { if (SKI) deselect(); else discIdle(); } else select(f, "overview");
});

// nothing selected yet: the resort's name, no highlight, no extra labels
function deselect() {   // back to the first view: nothing selected, whole map
  current = null;
  if (highlight) { scene.remove(highlight); highlight.traverse((o) => o.geometry && o.geometry.dispose()); highlight = null; }
  for (const l of selLabels) { l.el.remove(); l.line?.remove(); l.dot?.remove(); labels.splice(labels.indexOf(l), 1); }
  selLabels = []; profileDot.visible = false; profileApi = null; setMute(null);
  document.querySelectorAll(".chip.on").forEach((b) => b.classList.remove("on"));
  history.replaceState(null, "", `?c=${KEY}`);
  renderIdle(); goTo(wholeView(), 1.4);
}
function renderIdle() {
  $('p-sub').classList.add('idle');
  $('p-back').hidden = true; if (SKI && prevTab) { openTab(prevTab); prevTab = null; }
  $("p-course").textContent = D.subtitle || ""; $("p-title").textContent = D.name;
  $("p-sub").textContent = "Pick a piste or lift to explore"; $("p-stats").innerHTML = "";
  $("profile").hidden = true; $("p-status").hidden = true;
}

function renderPanel(f) {
  $('p-sub').classList.remove('idle');
  $('p-back').hidden = !SKI;
  if (!SKI) document.body.classList.add("has-hole");
  $("p-course").textContent = `${D.name} / ${D.subtitle}`;
  const diffName = { green: "Beginner", blue: "Easy", red: "Intermediate", black: "Advanced", orange: "Freeride" };
  if (f.kind === "piste") {
    $("p-title").textContent = f.ref ? `Piste ${f.ref}` : f.name;
    $("p-sub").innerHTML = `<span class="dot" style="background:${PISTE_RGB[f.difficulty]}"></span>${f.ref ? f.name + " · " : ""}${diffName[f.difficulty]}${f.snowmaking ? ` ${ico("snow", 1)}` : ""}${f.lit ? ` ${ico("night", 1)}` : ""}`;
    $("p-stats").innerHTML = `<div><b>${fmtLen(f.length_m)}</b><small>${lenUnit(f.length_m)}</small></div><div><b>${f.drop_m}</b><small>m drop</small></div>`;
  } else if (f.kind === "lift") {
    const lt = { chair_lift: "Chairlift", gondola: "Gondola", drag_lift: "Drag lift", "t-bar": "T-bar", platter: "Platter", magic_carpet: "Carpet", mixed_lift: "Combi lift" };
    $("p-title").textContent = f.name;
    $("p-sub").textContent = `${lt[f.lift_type] || "Lift"}${f.seats ? ` · ${f.seats}-seat` : ""} · ${f.from || Math.round(T.zmin + f.path[0][1]) + " m"} → ${f.to || Math.round(T.zmin + f.path[1][1]) + " m"}`;
    $("p-stats").innerHTML = `<div><b>${fmtLen(f.length_m)}</b><small>${lenUnit(f.length_m)}</small></div><div><b>${f.rise_m}</b><small>m rise</small></div>`;
  } else {
    $("p-title").textContent = `Hole ${String(f.number).padStart(2, "0")}.`;
    $("p-sub").textContent = f.fallback ? `No ${LAYOUT} tee mapped for this hole, showing ${f.tees.join("/") || "the shared one"}` : "";   // par, length, slope and rules are in the hole card
    $("p-stats").innerHTML = "";
    $("p-status").hidden = true; $("p-status").textContent = "";
  }
  document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.dataset.id === f.id));
  renderProfile(f);
  showFeatureStatus(f);
  if (!SKI) renderHoleCard(f);
}


// ---------- elevation profile of the selected run, linked to a marker on the map ----------
const markerTex = canvasTex(22, 30, (g) => {     // a small pin: yellow head, thin stem, a dot where it touches the ground
  g.strokeStyle = "rgba(20,32,43,.8)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(11, 17); g.lineTo(11, 27); g.stroke();
  g.fillStyle = SKI ? "#ffd23f" : "#d8342a"; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); if (SKI) g.arc(11, 10, 7, 0, 7); else g.ellipse(11, 10, 8.5, 4.2, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "rgba(20,32,43,.85)"; g.beginPath(); g.arc(11, 27.5, 2, 0, 7); g.fill();
});
const profileDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex.tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
profileDot.center.set(0.5, 0.05); profileDot.visible = false; profileDot.renderOrder = 9; scene.add(profileDot);
let profileApi = null;   // the open profile: {f, tick(frac), setIcon}; the fly loop drives its cursor and the map marker
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const ANG_COL = (g) => g > 20 ? PISTE_RGB.black : g > 12 ? PISTE_RGB.red : PISTE_RGB.blue;   // chart colour = the rank that angle would get
const DIFF_NAME = { green: "Beginner", blue: "Easy", red: "Intermediate", black: "Advanced", orange: "Freeride" };
function renderProfile(f) {
  const box = $("profile");
  profileApi = null;
  if (!f.path || f.path.length < 4) { box.hidden = true; return; }
  const piste = SKI && f.kind === "piste";
  const pts = f.path, step = Math.max(1, Math.floor(pts.length / 110)), s = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i += step) {
    if (i > 0) { const q = pts[Math.max(0, i - step)]; dist += Math.hypot(pts[i][0] - q[0], pts[i][2] - q[2]); }
    s.push({ d: dist, h: pts[i][1] + T.zmin, i });
  }
  // pitch per sample: slope over a +-2 sample window, so DEM noise does not flicker the colours
  s.forEach((q, k) => {
    const a = s[Math.max(0, k - 2)], b = s[Math.min(s.length - 1, k + 2)];
    q.g = Math.abs(Math.atan2(b.h - a.h, Math.max(b.d - a.d, 1))) * 180 / Math.PI;
  });
  const hs = s.map((q) => q.h), hmin = Math.min(...hs), hmax = Math.max(...hs), L = Math.max(dist, 1), W = 268, H = 100;
  const X = (d) => 2 + d / L * (W - 4), Y = (v) => H - 6 - (v - hmin) / Math.max(hmax - hmin, 1) * (H - 26);
  let strips = "", lines = "";
  for (let k = 1; k < s.length; k++) {
    const c = piste ? ANG_COL(s[k].g) : "#cfe3f5", x0 = X(s[k - 1].d).toFixed(1), x1 = X(s[k].d).toFixed(1), y0 = Y(s[k - 1].h).toFixed(1), y1 = Y(s[k].h).toFixed(1);
    strips += `<path d="M${x0},${y0} L${x1},${y1} L${x1},${H - 6} L${x0},${H - 6} Z" fill="${c}" opacity=".32"/>`;
    lines += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  const grid = [0.25, 0.5, 0.75].map((r) => `<line x1="2" x2="${W - 2}" y1="${(H - 6 - r * (H - 26)).toFixed(1)}" y2="${(H - 6 - r * (H - 26)).toFixed(1)}" stroke="currentColor" opacity=".12"/>`).join("");

  let stats = "";
  if (piste) {
    const first = pts[0], last = pts[pts.length - 1];
    const brg = (Math.atan2(last[0] - first[0], -(last[2] - first[2])) * 180 / Math.PI + 360) % 360;   // north is -z
    const cell = (ic, v, u) => `<div><span class="ms">${ic}</span><b>${v}</b><small>${u}</small></div>`;
    const amp = 4.5, dc = PISTE_RGB[f.difficulty] === "#1b1b1b" ? "#e8e8e8" : PISTE_RGB[f.difficulty];
    const beat = `M0 8H46l3-${amp.toFixed(1)}l4 ${(amp * 2).toFixed(1)}l3-${(amp * 1.4).toFixed(1)}l2 ${(amp * 0.4).toFixed(1)}H120`;
    const tags = [f.lit && `${ico("night", 1)} Floodlit`, f.snowmaking && `${ico("snow", 1)} Snowmaking`].filter(Boolean).map((t) => `<span class="pf-tag">${t}</span>`).join("");
    // lifts whose top station is at the start of this run, or whose bottom station is at its end
    const near = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 160;
    const lifts = D.features.filter((l) => l.kind === "lift" && (near(l.path[l.path.length - 1], first) || near(l.path[0], last))).slice(0, 5)
      .map((l) => `<button class="pf-lift" data-id="${l.id}"><span class="ms">${LIFT_ICON[l.lift_type] || "chair_alt"}</span>${l.name}</button>`).join("");
    stats = `<div class="pf-key"><span><i style="background:${PISTE_RGB.blue}"></i>Easy</span><span><i style="background:${PISTE_RGB.red}"></i>Medium</span><span><i style="background:${PISTE_RGB.black}"></i>Steep</span></div><div class="pf-stats">${cell("vertical_align_top", Math.round(hmax), "m top")}${cell("vertical_align_bottom", Math.round(hmin), "m bottom")}${cell("explore", COMPASS[Math.round(brg / 45) % 8], "faces")}</div>
      <div class="pf-diff"><span>Difficulty</span><svg viewBox="0 0 120 16" aria-hidden="true"><path d="${beat}" fill="none" stroke="${dc}" stroke-width="1.6" stroke-linejoin="round"/></svg><b>${DIFF_NAME[f.difficulty]}</b></div>
      ${tags ? `<div class="pf-tags">${tags}</div>` : ""}${lifts ? `<div class="pf-lifts"><span>Connecting lifts</span>${lifts}</div>` : ""}`;
  }

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">${grid}${strips}${lines}
    <text x="3" y="10" font-size="9" fill="currentColor" opacity=".7">${Math.round(hmax)} m</text><text x="3" y="${H - 8}" font-size="9" fill="currentColor" opacity=".7">${Math.round(hmin)} m</text>
    <line id="pf-cur" x1="0" y1="2" x2="0" y2="${H - 6}" stroke="currentColor" opacity=".85" visibility="hidden"/>${SKI ? '<circle id="pf-pt" r="3.4" fill="#ffd23f" stroke="#fff" stroke-width="1.2" visibility="hidden"/>' : '<ellipse id="pf-pt" rx="4.6" ry="2" fill="#d8342a" stroke="#fff" stroke-width="1" visibility="hidden"/>'}</svg>
    <div class="pf-bar"><button id="pf-play" class="ms" aria-label="Fly along the run" title="Fly along the run">play_arrow</button>${SKI ? "" : `<button id="pf-xray" class="ms${corridorOn ? " on" : ""}" aria-label="See through the trees" aria-pressed="${corridorOn}" title="See through the trees (x-ray)">search</button>`}<span id="pf-info">Fly along the run</span><span>${fmtLen(L)} ${lenUnit(L)}</span></div>${stats}`;
  box.hidden = false;

  const svg = box.querySelector("svg"), cur = box.querySelector("#pf-cur"), pt = box.querySelector("#pf-pt"), info = box.querySelector("#pf-info"), play = box.querySelector("#pf-play");
  const IDLE = "Fly along the run";
  const show = (d) => {   // cursor + readout at d metres along the run; returns the sample
    let k = s.findIndex((q) => q.d >= d); if (k < 0) k = s.length - 1;
    const q = s[k];
    cur.setAttribute("x1", X(d)); cur.setAttribute("x2", X(d)); cur.setAttribute("visibility", "visible");
    pt.setAttribute("cx", X(d)); pt.setAttribute("cy", Y(q.h)); pt.setAttribute("visibility", "visible");
    info.textContent = `${fmtLen(d)} ${lenUnit(d)} | ${Math.round(q.h)} m`;
    return q;
  };
  const hide = () => { cur.setAttribute("visibility", "hidden"); pt.setAttribute("visibility", "hidden"); info.textContent = IDLE; profileDot.visible = false; invalidate(4); };
  const api = { f, playing: false, last: 0,
    setIcon(on) { api.playing = on; play.textContent = on ? "pause" : "play_arrow"; },
    tick(fr) {   // fr: 0..1 progress of the fly camera, or -1 when it is not flying this run
      if (fr < 0) { if (api.playing) api.setIcon(false); return; }
      if (!api.playing) api.setIcon(true);
      api.last = fr; show(fr * L);
      profileDot.visible = false;   // the ball is the marker while flying
    } };
  profileApi = api;
  const frac = (e) => { const r = svg.getBoundingClientRect(); return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1); };
  const move = (e) => {
    const fl = fly && fly.f === f ? fly : null;
    if (fl) { if (e.buttons || e.type === "pointerdown") fl.s = frac(e) * fl.L; return; }   // while flying, dragging the chart seeks
    const q = show(frac(e) * L), p = pts[q.i];
    profileDot.scale.set(...pinScale(markerTex), 1); profileDot.position.set(p[0], p[1] + 0.6, p[2]); profileDot.visible = true; invalidate(4);
  };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { if (!(fly && fly.f === f)) hide(); });
  play.addEventListener("click", () => {
    if (fly && fly.f === f) { fly = null; api.setIcon(false); return; }   // pause: the camera stays where it is
    startFly(f, () => { api.setIcon(false); hide(); goTo(viewFor(f, "overview"), 1.4); }, api.last > 0.98 ? 0 : api.last);
    api.setIcon(true);
  });
}
$("profile").addEventListener("click", (e) => {
  const b = e.target.closest(".pf-lift"); if (!b) return;
  select(D.features.find((x) => x.id === b.dataset.id), "overview");
});

function select(f, mode = "overview", onDone) {
  current = f; viewMode = mode;
  setHighlight(f); setSelLabels(f); renderPanel(f); setCorridor(f);
  if (phone() || SKI) { if (tabNow) prevTab = tabNow; openTab(null); }   // fold the list away: the run gets the panel, the back button returns to the list
  history.replaceState(null, "", SKI ? `?c=${KEY}#${f.id}` : `?c=${KEY}&layout=${LAYOUT}&pin=${PIN}&hole=${f.number}`);
  if (mode === "fly") startFly(f, onDone);
  else {
    goTo(viewFor(f, mode), SKI && compact() ? 0.9 : 1.6);
    if (SKI && compact()) setTimeout(() => {   // phones: the sheet and fonts settle after the tap, so frame the run once more with the final layout (unless the user already moved the map)
      if (current === f && !fly && viewMode === mode && !touched) goTo(viewFor(f, mode), 0.5);
    }, 450);
  }
  touched = false;
}

// tour and flyover: UI removed for now, the fly code above stays for later
const tourList = SKI ? listed.filter((f) => f.kind === "piste") : listed;
function stopTour() {}
$("whole").addEventListener("click", () => { if (SKI) deselect(); else goTo(wholeView(), 2); });
$("p-back").addEventListener("click", () => deselect());
$("panel").querySelector(".sheet-grab").addEventListener("click", () => { $("panel").classList.toggle("min"); updateViewOffset(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && SKI && current && $("cam").hidden && $("stpop").hidden) deselect(); });
renderer.domElement.addEventListener("pointerdown", () => { touched = true; if (fly || anim) { fly = null; anim = null; stopTour(); profileApi?.tick(-1); } });

$("panel-toggle").addEventListener("click", () => { $("panel").classList.toggle("collapsed"); updateViewOffset(); });

// ---------- sky, haze, far mountains, day / night ----------
const FOG_DAY = new THREE.Color(HORIZON), FOG_NIGHT = new THREE.Color(0x111a2d);
const MOON_DIR = new THREE.Vector3(-0.45, 0.5, 0.74).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  uniforms: {
    topDay: { value: new THREE.Color(WINTER ? 0x7fa6cf : 0x6f9fd6) }, horDay: { value: new THREE.Color(HORIZON) },
    topNight: { value: new THREE.Color(0x040813) }, horNight: { value: new THREE.Color(0x16213a) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, night: { value: 0 },
  },
  vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }",
  fragmentShader: `uniform vec3 topDay, horDay, topNight, horNight, sunDir; uniform float night; varying vec3 vDir;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main() {
      vec3 d = normalize(vDir); float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
      vec3 col = mix(mix(horDay, topDay, t), mix(horNight, topNight, t), night);
      if (d.y > 0.015) {   // static cloud layer (no animation, so the page still renders only when something changes)
        vec2 q = d.xz / (d.y + 0.22) * 1.15;
        float cl = vn2(q * 0.9 + 3.1) * 0.55 + vn2(q * 2.1 + 7.7) * 0.30 + vn2(q * 4.6 + 1.3) * 0.15;
        cl = smoothstep(0.52, 0.80, cl) * smoothstep(0.015, 0.20, d.y);
        col = mix(col, mix(vec3(1.0, 1.0, 1.0), horDay, 0.25), cl * 0.6 * (1.0 - night));
      }
      float s = max(dot(d, normalize(sunDir)), 0.0);
      col += mix(vec3(1.0, 0.93, 0.78), vec3(0.75, 0.82, 1.0), night) * (pow(s, 700.0) * 1.3 + pow(s, 22.0) * 0.20 * (1.0 - 0.6 * night) + pow(s, 4.0) * 0.05);
      if (night > 0.01 && d.y > 0.03) col += vec3(step(0.9965, hash(floor(d * 320.0)))) * night * smoothstep(0.03, 0.3, d.y) * 0.9;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 24, 12), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
// two rings of hazy ridges far beyond the model, so the slab does not float in an empty sky
function ridgeRing(radius, heightM, seed, mix) {
  const N = 360, pos = [], col = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2;
    const n = 0.5 + 0.5 * (Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + seed * 2) * 0.3 + Math.sin(a * 17 + seed * 3) * 0.2);
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    pos.push(x, -6000, z, x, -500 + n * heightM, z); col.push(1, 1, 1, 1, 1, 1);
    if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -9; mesh.frustumCulled = false; mesh.userData.mix = mix; scene.add(mesh);
  return mesh;
}
const rings = [ridgeRing(15000, 1500, 1.3, 0.55), ridgeRing(21000, 1300, 4.1, 0.30)];
const RING_DAY = new THREE.Color(WINTER ? 0x9fb6cc : 0x8fa9bd), RING_NIGHT = new THREE.Color(0x0b1424);
const HEMI_SKY_DAY = new THREE.Color(WINTER ? 0xcfe0ff : 0xdfeaff), HEMI_GND_DAY = new THREE.Color(WINTER ? 0x8a8f99 : 0x4b5a3c);
const HEMI_SKY_NIGHT = new THREE.Color(0x5a72b8), HEMI_GND_NIGHT = new THREE.Color(0x1d2640), MOON_COL = new THREE.Color(0xa9bcff);
const lightBase = { sunI: 2.4, hemiI: 1.2 };
let nightT = 0, nightTarget = 0;
function applyNight() {
  const n = nightT;
  sun.intensity = lightBase.sunI * (1 - 0.8 * n);
  sun.color.lerp(MOON_COL, n);
  hemi.intensity = lightBase.hemiI * (1 - 0.5 * n) + 0.25 * n;
  hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, n); hemi.groundColor.copy(HEMI_GND_DAY).lerp(HEMI_GND_NIGHT, n);
  renderer.toneMappingExposure = (WINTER ? 0.92 : 1.0) * (1 + 0.05 * n);
  if (skirtMat) skirtMat.color.setScalar(1 - 0.93 * n);
  scene.fog.color.copy(FOG_DAY).lerp(FOG_NIGHT, n);
  skyMat.uniforms.night.value = n; NIGHT_U.value = n;
  if (lanternMats) lanternMats.head.color.copy(HEAD_DAY).lerp(HEAD_NIGHT, n);
  if (nightGlow) nightGlow.visible = n > 0.02 && nightGlow.userData.on !== false;
  document.body.classList.toggle("night", n > 0.5);
  sun.userData.lightDir = sun.userData.dir.clone().lerp(MOON_DIR, n).normalize();
  skyMat.uniforms.sunDir.value.copy(sun.userData.lightDir);
  for (const r of rings) r.material.color.copy(RING_DAY).lerp(skyMat.uniforms.horDay.value, 1 - r.userData.mix).lerp(RING_NIGHT, n);
}

// light: slider 0..1 maps to a day (winter 8:00-16:00, summer 6:00-20:00)
const DAY = WINTER ? [8, 16, 18] : [6, 20, 58]; // start, end, max sun elevation
function setLight(t) {
  const hour = DAY[0] + (DAY[1] - DAY[0]) * t;
  const el = Math.max(3, DAY[2] * Math.sin(Math.PI * t)) * Math.PI / 180;
  const az = (90 + 180 * t) * Math.PI / 180; // east -> south -> west
  sun.userData.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const warm = 1 - Math.min(1, el / (20 * Math.PI / 180));
  sun.color.setRGB(1, 1 - 0.25 * warm, 1 - 0.45 * warm);
  lightBase.sunI = 1.2 + 1.6 * Math.min(1, el / (25 * Math.PI / 180));
  lightBase.hemiI = (WINTER ? 1.25 : 0.7) + 0.5 * (1 - warm); // snow maps read bright, like the printed panorama
  applyNight();
}
function setNightMode(on, instant = false) {
  nightTarget = on ? 1 : 0; if (instant) { nightT = nightTarget; applyNight(); }
  groupOn.night = on;   // evening skiing shows only at night
  if (nightGroup) nightGroup.visible = on;
  if (nightGlow) { nightGlow.userData.on = on; nightGlow.visible = on && nightT > 0.02; }
  if (lanternMats) lanternMats.posts.forEach((m) => { m.visible = on; });
  const b = $("dn"); b.textContent = on ? "dark_mode" : "light_mode"; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  b.title = on ? "Back to day" : "Night mode";
  labels.forEach((l) => { l.w = 0; }); invalidate(8);
}
$("dn").addEventListener("click", () => setNightMode(nightTarget < 0.5));
setLight(0.55);
if (params.get("night") === "1") { nightTarget = nightT = 1; applyNight(); setNightMode(true, true); }

addEventListener("resize", () => {
  updateViewOffset();
  if (!innerWidth || !innerHeight) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (typeof rescalePins === "function") rescalePins();
});



// ---------- open / closed status ----------
function restylePins() {
  for (const l of pins) {
    if (l.kind === "pnum") { l.t = pnumTex(l.f.ref, PISTE_RGB[l.f.difficulty], stateOf(l.f)); l.sprite.material = pinMat(l.t); }
    else if (l.kind === "lift") { l.t = liftTex(l.f.name, l.f.seats, l.f.lift_type, l.f.status ? stateOf(l.f) : null); l.sprite.material = pinMat(l.t, false); }
  }
}
function showFeatureStatus(f) {
  const el = $("p-status");
  if (f.kind === "hole" && f.notes) return;   // OB / mando notes from the course
  if (!STATUS || !statusVisible || !f.status) { el.hidden = true; return; }
  const label = { open: "Open", preparing: "Being prepared", closed: "Closed" }[f.status] || f.status;
  el.innerHTML = `<span class="st-dot st-${f.status}"></span>${label}${STATUS.demo ? " · demo data" : STATUS.updated ? " · updated " + STATUS.updated : ""}`;
  el.hidden = false;
}
function refreshStatusUI() {
  if (!STATUS) return;
  const on = statusVisible, count = (list) => { const c = { open: 0, preparing: 0, closed: 0, n: 0 }; for (const f of list) if (f.status) { c[f.status]++; c.n++; } return c; };
  const lifts = count(D.features.filter((f) => f.kind === "lift")), runs = count(D.features.filter((f) => f.kind === "piste" && f.listed && f.ref));
  $("st-lifts").hidden = !lifts.n; $("st-runs").hidden = !runs.n;   // a feed may cover only lifts
  $("st-lifts").innerHTML = `Lifts <b>${lifts.open}</b>/${lifts.n} open`;
  $("st-runs").innerHTML = `Runs <b>${runs.open}</b>/${runs.n} open${runs.preparing ? ` · ${runs.preparing} being prepared` : ""}`;
  $("st-badge").hidden = !STATUS.demo;
  $("status-strip").hidden = !on; $("stbtn").hidden = !on;
  $("stbtn-t").innerHTML = `<span class="xl">Lifts </span>${lifts.open}/${lifts.n}<span class="xl"> open</span>`;
  const lbl = { open: "Open", preparing: "Being prepared", closed: "Closed" };
  const li = (name, sub, f) => `<li><span class="st-dot st-${f.status}"></span><b>${name}</b><span>${sub}</span><small>${lbl[f.status] || ""}</small></li>`;
  const sec = (h, list) => list.length ? `<h4>${h}</h4><ul>${list.join("")}</ul>` : "";
  $("stlist").innerHTML = sec("Lifts", D.features.filter((f) => f.kind === "lift" && f.status).map((f) => li(f.name, `${f.from || ""} → ${f.to || ""}`, f)))
    + sec("Runs", D.features.filter((f) => f.kind === "piste" && f.listed && f.ref && f.status).map((f) => li(f.ref, f.name, f)));
  for (const r of ribbonRanges) r.bucket.stateAttr.array.fill(stateOf(r.f), r.start, r.start + r.count);
  for (const b of new Set(ribbonRanges.map((r) => r.bucket))) b.stateAttr.needsUpdate = true;
  restylePins();
  document.querySelectorAll(".chip").forEach((c) => {
    const f = D.features.find((x) => x.id === c.dataset.id), s = on && f ? f.status : null;
    c.classList.toggle("st-closed", s === "closed"); c.classList.toggle("st-prep", s === "preparing");
  });
  if (current) showFeatureStatus(current);
  invalidate(4);
}

const stpop = $("stpop"), closeSt = () => { stpop.hidden = true; };
$("stbtn").addEventListener("click", () => { stpop.hidden = false; });
$("stpop-x").addEventListener("click", closeSt);
stpop.addEventListener("click", (e) => { if (e.target === stpop) closeSt(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !stpop.hidden) closeSt(); });

// ---------- weather card (Open-Meteo, model data) ----------
{
  const pts = D.weather?.points;
  if (pts?.length) {
    const card = $("wx"), body = card.querySelector(".wx-body"), KEY_WX = `wx:${KEY}`;
    const ICON = (code, day) => code === 0 ? (day ? "sunny" : "bedtime") : code <= 2 ? (day ? "partly_cloudy_day" : "partly_cloudy_night") : code === 3 ? "cloud"
      : code <= 48 ? "foggy" : code <= 67 ? "rainy" : code <= 77 ? "weather_snowy" : code <= 82 ? "rainy" : code <= 86 ? "weather_snowy" : "thunderstorm";
    const t0 = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v)) + "°";
    const render = (res, when) => {
      const [top, base] = [res[0], res[res.length - 1]], cur = top.current;
      $("wx-ico").textContent = ICON(cur.weather_code, cur.is_day);
      $("wx-now").innerHTML = `${t0(cur.temperature_2m)}<span class="xl"> · snow ${Math.round(cur.snow_depth * 100)} cm</span>`;
      const days = top.daily.time, today = days.indexOf(top.current.time.slice(0, 10)), sn = top.daily.snowfall_sum.map((v) => v ?? 0);
      const past = sn.slice(Math.max(0, today - 3), today).reduce((a, b) => a + b, 0), next = sn.slice(today + 1, today + 4).reduce((a, b) => a + b, 0);
      const max = Math.max(8, ...sn), W = 228, H = 54, bw = W / sn.length;
      const bars = sn.map((v, i) => {
        const h = Math.max(1.5, v / max * (H - 18)), x = i * bw + 4, isToday = i === today;
        const d = new Date(days[i] + "T12:00").toLocaleDateString("en", { weekday: "narrow" });
        return `<rect x="${x}" y="${H - 12 - h}" width="${bw - 8}" height="${h}" rx="2" fill="${isToday ? "#3a8fd6" : i < today ? "#9db4cc" : "#7fb3e8"}" opacity="${i > today ? 0.75 : 1}"/>`
          + (v >= 0.5 ? `<text x="${x + (bw - 8) / 2}" y="${H - 14 - h}" font-size="8" text-anchor="middle" fill="currentColor" opacity=".7">${v.toFixed(v < 10 ? 1 : 0)}</text>` : "")
          + `<text x="${x + (bw - 8) / 2}" y="${H - 2}" font-size="8" text-anchor="middle" fill="currentColor" opacity="${isToday ? 1 : 0.55}">${d}</text>`;
      }).join("");
      const row = (p, r) => `<div class="wx-row"><span class="ms">${ICON(r.current.weather_code, r.current.is_day)}</span><b>${t0(r.current.temperature_2m)}</b>
        <span>${p.name}<br><small style="margin:0">${p.ele} m</small></span><small>wind ${Math.round(r.current.wind_speed_10m)} km/h<br>gusts ${Math.round(r.current.wind_gusts_10m)}<br>snow ${Math.round(r.current.snow_depth * 100)} cm</small></div>`;
      body.innerHTML = `<div class="wx-head"><span>Today at ${pts[0].name}</span><span>model data</span></div>${row(pts[0], top)}${pts.length > 1 ? row(pts[pts.length - 1], base) : ""}
        <div class="wx-snow"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Daily snowfall in cm">${bars}</svg>
        <div class="wx-foot"><span>snowfall cm · last 3 days <b>${past.toFixed(0)}</b> · next 3 <b>${next.toFixed(0)}</b></span></div></div>
        <div class="wx-foot"><span>Updated ${when}</span><a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></div>`;
      card.hidden = false;
    };
    const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
      latitude: pts.map((p) => p.lat).join(","), longitude: pts.map((p) => p.lon).join(","), elevation: pts.map((p) => p.ele).join(","),
      current: "temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code,is_day,snow_depth", daily: "snowfall_sum",
      past_days: 3, forecast_days: 4, timezone: "auto" });
    const load = async () => {
      try {
        const cached = JSON.parse(localStorage.getItem(KEY_WX) || "null");
        if (cached && Date.now() - cached.t < 15 * 60e3) { render(cached.res, new Date(cached.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })); return; }
      } catch (e) { /* storage unavailable */ }
      try {
        const r = await fetch(url); if (!r.ok) throw new Error(r.status);
        const j = await r.json(), res = Array.isArray(j) ? j : [j];
        try { localStorage.setItem(KEY_WX, JSON.stringify({ t: Date.now(), res })); } catch (e) { /* ignore */ }
        render(res, new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) { card.hidden = true; }   // no weather is better than a broken card
    };
    load();
    setInterval(() => { if (document.visibilityState === "visible") load(); }, 15 * 60e3);
  }
}

if (D.webcams?.length) {
  const b = $("cambtn"); b.hidden = false;
  b.addEventListener("click", () => {
    groupOn.cams = !groupOn.cams; b.classList.toggle("on", groupOn.cams); b.setAttribute("aria-pressed", groupOn.cams); invalidate(4);
  });
}

// ---------- map extras: layer switches, legend, rescue, town buildings ----------
if (SKI) {
  { // the map switches live behind a gear, outside the side panel
    const btn = document.createElement("button"); btn.className = "ibtn ms"; btn.id = "gearbtn"; btn.title = "Map settings";
    btn.setAttribute("aria-label", "Map settings"); btn.setAttribute("aria-expanded", "false"); btn.textContent = "settings";
    const pop = document.createElement("div"); pop.id = "gearpop"; pop.hidden = true; pop.innerHTML = "<h4>Map settings</h4>"; pop.append($("layer-checks"));
    $("topright").append(btn); document.body.append(pop);
    const shut = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); if (!pop.hidden) $("wx").open = false; });
    addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) shut(); });
    $("wx").addEventListener("toggle", () => { if ($("wx").open) shut(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  }
  const LAYERS = [...(STATUS ? [["status", "Open / closed"]] : []), ["pistes", "Piste numbers"], ["services", "Services"], ["pois", "Parking & bus"], ["snow", "Snowmaking"], ["lifts", "Lifts"]];
  $("layer-checks").innerHTML = LAYERS.map(([k, n]) =>
    `<label class="tg"><span>${n}</span><input type="checkbox" role="switch" data-g="${k}" ${groupOn[k] ? "checked" : ""}></label>`).join("");
  $("layer-checks").addEventListener("change", (e) => {
    const k = e.target.dataset.g;
    groupOn[k] = e.target.checked;
    if (k === "snow") labelsEl.classList.toggle("no-snow", !e.target.checked);
    if (k === "slope") { slopeU.value = e.target.checked ? 1 : 0; if (ribbonGroup) ribbonGroup.visible = !e.target.checked; treeGroup.visible = !e.target.checked; }   // bare snow surface shows the slope
    if (k === "status") { statusVisible = e.target.checked; refreshStatusUI(); }
    labels.forEach((l) => { l.w = 0; });   // widths changed: measure again
    invalidate(4);
  });

  const used = new Set([...(D.hubs || []).flatMap((h) => h.icons || []), ...(D.pois || []).map((p) => p.icon),
    ...(D.attractions || []).map((a) => a.icon), "snow", ...(D.webcams?.length ? ["webcam"] : [])]);
  // the legend lives in the Layers tab: every entry is a button that shows (or highlights) just that thing on the map
  const row = (sw, txt, tag, run) => tag ? `<button class="lg-row" data-tag="${tag}">${sw}<span>${txt}</span></button>` : `<div class="lg-row static">${sw}<span>${txt}</span></div>`;
  const RUNS = { "run:blue": (f) => f.difficulty === "blue", "run:red": (f) => f.difficulty === "red", "run:black": (f) => f.difficulty === "black", "run:lit": (f) => !!f.lit };
  $("layer-legend").innerHTML = "<h4>Legend · tap to show on the map</h4><h5>Trasy narciarskie · Ski runs</h5>"
    + [["blue", "Łatwa · Easy"], ["red", "Średnia · Intermediate"], ["black", "Trudna · Difficult"]]
      .map(([c, t]) => row(`<span class="sw" style="background:${PISTE_RGB[c]}"></span>`, t, "run:" + c)).join("")
    + row('<span class="sw" style="background:#fff;border:3px solid #f5c518;height:11px;box-sizing:border-box"></span>', "Jazda wieczorna · Evening skiing (yellow edge)", "run:lit")
    + (STATUS ? "<h5>Status</h5>" + [["open", "Otwarte · Open"], ["preparing", "W przygotowaniu · Being prepared"], ["closed", "Zamknięte · Closed"]]
        .map(([k, t]) => row(`<span class="st-dot st-${k}"></span>`, t)).join("") : "")
    + "<h5>Wyciągi · Lifts</h5>"
    + row('<span class="ico" style="background:#111">gondola_lift</span>', "Kolej gondolowa · Gondola lift", "lift:gondola")
    + row('<span class="ico" style="background:#111">chair_alt</span>', "Kolej krzesełkowa · Chairlift", "lift:chair")
    + row('<span class="ico" style="background:#111">north_east</span>', "Wyciąg narciarski · Surface lift", "lift:surface")
    + "<h5>Szlaki · Trails</h5>"
    + row('<span class="sw" style="background:repeating-linear-gradient(90deg,#e8792b 0 6px,transparent 6px 10px)"></span>', "Szlak skiturowy · Ski touring trail")
    + row('<span class="sw" style="background:repeating-linear-gradient(90deg,#2f9a45 0 6px,transparent 6px 10px)"></span>', "Szlak turystyczny · Hiking trail")
    + "<h5>Usługi · Services</h5>"
    + Object.keys(ICONS).filter((k) => used.has(k)).map((k) => row(ico(k), ICONS[k][2], "icon:" + k)).join("");
  const setLegend = (tag, label) => {   // tag null clears; the pill on the map says what is shown and clears it again
    legendSel = tag ? { tag, run: RUNS[tag] } : null;
    $("layer-legend").querySelectorAll(".lg-row").forEach((x) => x.classList.toggle("on", !!tag && x.dataset.tag === tag));
    $("legend-pill").hidden = !tag; $("lp-t").textContent = label || "";
    if (nightGroup) nightGroup.visible = nightTarget > 0.5 || tag === "run:lit";
    if (tag && phone()) $("panel").classList.add("min");   // phone: fold the sheet down to its tab bar so the map is what you see
    updateViewOffset(); labels.forEach((l) => { l.w = 0; }); setMute(); invalidate(6);
  };
  $("layer-legend").addEventListener("click", (e) => {
    const b = e.target.closest(".lg-row[data-tag]"); if (!b) return;
    setLegend(legendSel?.tag === b.dataset.tag ? null : b.dataset.tag, b.querySelector("span:last-child").textContent);
  });
  $("legend-pill").addEventListener("click", () => setLegend(null));

  if (D.info?.rescue_phone) {
    const r = $("rescue");
    r.hidden = false;
    r.href = "tel:" + D.info.rescue_phone.replace(/[^+\d]/g, "");
    r.innerHTML = `<span class="ms">emergency</span><div><span class="num">${D.info.rescue_phone}</span><small>${D.info.rescue_label}</small></div>`;
  }

  // town buildings, merged into one mesh
  const geos = [];
  for (const poly of D.context?.buildings || []) {
    if (poly.length < 4) continue;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const gg = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false });
    gg.rotateX(-Math.PI / 2);
    const base = Math.min(...poly.map(([x, z]) => heightAt(x, z)));
    gg.translate(0, base - 1, 0);
    geos.push(gg.index ? gg.toNonIndexed() : gg);
  }
  if (geos.length) {
    const merged = mergeGeometries(geos.map((gg) => { gg.deleteAttribute("uv"); return gg; }));
    const town = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xe7e1d6, roughness: 0.9 }));
    town.castShadow = true; town.receiveShadow = true;
    scene.add(town);
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
// Draw only when something changed: the camera moved, an animation runs, or a control was used. Idle = no GPU work.
let dirty = 8;
const invalidate = (n = 3) => { dirty = Math.max(dirty, n); };
controls.addEventListener("change", () => invalidate());
for (const ev of ["input", "change", "click", "keydown", "pointerup", "wheel", "resize", "focus"])
  addEventListener(ev, () => invalidate(), { passive: true, capture: true });

// Adaptive quality: if frames keep coming in slow, lower the render resolution (then the shadows) by itself.
let quality = 0, frames = 0, slow = 0, lastFrame = 0;
const Q_DPR = [Math.min(devicePixelRatio, SMALL ? 1.5 : 2), Math.min(devicePixelRatio, 1.25), 1];
function setQuality(q) {
  quality = q;
  renderer.setPixelRatio(Q_DPR[q]); renderer.setSize(innerWidth, innerHeight);
  if (q >= 2) sun.castShadow = false;
  invalidate();
  console.info("course-explorer: quality lowered to level", q);
}
if (params.get("q")) setQuality(Math.min(2, +params.get("q") || 0));

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  CLEAR_U.value = fly ? 0 : SKI ? 70 : 24;   // flying: no tree collapses next to the camera
  if (Math.abs(nightT - nightTarget) > 0.002) {   // day <-> night eases over about a second
    nightT += (nightTarget - nightT) * Math.min(1, dt * 3.5);
    if (Math.abs(nightT - nightTarget) < 0.004) nightT = nightTarget;
    applyNight(); invalidate();
  }
  const moving = !!(anim || fly);
  if (!moving && dirty <= 0) { lastFrame = 0; return; }   // idle: nothing changed, draw nothing
  if (anim) {
    anim.t += dt / anim.dur;
    const k = ease(Math.min(1, anim.t));
    controls.target.lerpVectors(anim.t0, anim.t1, k);
    if (anim.arc) {   // the intro: tilt from the flat "paper map" view down into the 3D view, around the target
      const { s0, s1 } = anim, da = Math.atan2(Math.sin(s1.az - s0.az), Math.cos(s1.az - s0.az));
      const r = s0.r + (s1.r - s0.r) * k, pol = s0.polar + (s1.polar - s0.polar) * k, az = s0.az + da * k;
      camera.position.set(Math.sin(pol) * Math.sin(az) * r, Math.cos(pol) * r, Math.sin(pol) * Math.cos(az) * r).add(controls.target);
    } else camera.position.lerpVectors(anim.p0, anim.p1, k);
    if (anim.t >= 1) anim = null;
  } else if (fly) {
    const speed = (fly.lift ? 6 : SKI ? fly.L / 6 : 16) * speedMul;   // m/s; a ski run always takes about 6 s, whatever its length
    fly.s += speed * dt;
    const v = flyPose(fly), k = 1 - Math.exp(-dt * (SKI ? 8 : 4));
    camera.position.lerp(v.pos, k);
    controls.target.lerp(v.target, k);
    if (fly.s >= fly.L) { const done = fly.onDone; fly = null; done && done(); }
  }
  profileApi?.tick(fly && fly.f === profileApi.f ? fly.s / fly.L : -1);
  updateBall(); updateDisc(dt);
  // keep the camera above ground
  const gy = heightAt(camera.position.x, camera.position.z) + (fly ? 2.5 : SKI ? 8 : 1.5);
  if (camera.position.y < gy) camera.position.y = gy;
  controls.update();
  camera.updateMatrixWorld();   // labels are projected with this matrix: without it they lag one frame behind the scene
  // shadow frustum follows what we look at
  tmpT.copy(controls.target);
  sun.target.position.copy(tmpT);
  sun.position.copy(tmpT).addScaledVector(sun.userData.lightDir || sun.userData.dir, 4000);
  updateTreeLod();
  updateLabels();
  // the selection line reads as tyre tracks up close; show it only from a distance
  if (highlight) highlight.visible = !SKI || camera.position.distanceTo(controls.target) > 450 && !fly;
  // phones back the camera out 15 km+ to fit the wide mountain in a narrow screen: the far ridge rings and the sky must stay behind the terrain, so they grow with the distance
  const farK = Math.max(1, camera.position.distanceTo(controls.target) / 7000);
  sky.scale.setScalar(farK); sky.position.copy(camera.position); for (const r of rings) { r.scale.setScalar(farK); r.position.set(camera.position.x, 0, camera.position.z); }
  renderer.render(scene, camera);
  if (dirty > 0) dirty--;
  if (!window.__ff) { window.__ff = 1; mark("first frame"); if (params.get("perf")) console.table(MARKS); }
  const now = performance.now();
  if (lastFrame && document.visibilityState === "visible") {
    frames++; if (now - lastFrame > 34) slow++;
    if (frames >= 90) { if (slow > 45 && quality < 2) setQuality(quality + 1); frames = slow = 0; }
  }
  lastFrame = now;
}

// debugging / capture handle: snap("p0","start") or snap("p0","fly",0.4) jumps without animation
window.__ce = {
  camera, controls, viewFor, wholeView, V, heightAt, D, labels, terrain, occluded, THREE, T, X0, Z0, renderer, scene,
  flyAt(id, frac) {   // jump straight into the fly-along at frac of the run (debug / capture)
    const f = D.features.find((x) => x.id === id); select(f, "overview"); anim = null;
    const c = pathCurve(f); fly = { f, curve: c, L: c.getLength(), s: frac * c.getLength(), onDone: null, lift: false };
    const v = flyPose(fly); camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); updateBall(); camera.updateMatrixWorld(); renderer.render(scene, camera);
  },
  snap(id, mode, t = 0) {
    const f = D.features.find((x) => x.id === id);
    select(f, mode === "fly" ? "overview" : mode); anim = null; fly = null;
    let v;
    if (mode === "fly") { const c = pathCurve(f); v = flyPose({ curve: c, L: c.getLength(), s: t * c.getLength(), lift: f.kind === "lift" }); }
    else if (mode === "whole") v = wholeView();
    else v = viewFor(f, mode);
    camera.position.copy(v.pos); controls.target.copy(v.target); controls.update();
    camera.updateMatrixWorld(); renderer.render(scene, camera); updateLabels();
  },
};
// ---------- disc golf: see-through trees and the aerial photo curtain ----------
function simplifyLine(pts, tol) {   // Douglas-Peucker on [x, z]
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  let k = 0, dm = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / L; if (d > dm) { dm = d; k = i; } }
  if (dm <= tol) return [a, b];
  return [...simplifyLine(pts.slice(0, k + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(k), tol)];
}
function setCorridor(f) {
  if (SKI) return;
  let n = 0;
  TU.uXray.value = corridorOn ? 1 : 0;
  if (f && f.kind === "hole") {
    let pts = f.path.map((p) => [p[0], p[2]]);
    for (let tol = 1.5; tol < 60; tol *= 1.6) { const q = simplifyLine(pts, tol); if (q.length <= 9) { pts = q; break; } }
    n = Math.min(pts.length - 1, 8);
    for (let i = 0; i < n; i++) TU.uSeg.value[i].set(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  TU.uSegN.value = n;
  invalidate(4);
}
if (!SKI) {
  const photo = !!D.ortho;
  $("layer-checks").innerHTML = "";
  if (photo && !SMALL) {
    document.body.insertAdjacentHTML("beforeend", '<div id="curtain-line"></div><div id="curtain"><button aria-label="Drag to reveal the aerial photo" class="ms">swap_horiz</button></div>');
    const cur = $("curtain");
    const setCurtain = (v) => {
      v = Math.min(Math.max(v, 24 / innerWidth), 1); ORTHO.uCurtain.value = v;
      cur.style.left = $("curtain-line").style.left = `${v * 100}%`; invalidate(4);
    };
    cur.querySelector("button").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const move = (ev) => setCurtain(ev.clientX / innerWidth), up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    });
    setCurtain(params.get("photo") ? +params.get("photo") : 0.035);
  }
  setCorridor(null);
}

// ================= disc golf extras: hole card, weather + wind, where-am-I, lost discs, flyover, seasons, offline =================
if (!SKI) {
const DG = true;
const GEO = T.geo;
let WX = null, ME = null, cardOpen = false, lastCardHole = null, wxTries = 0;
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));   // typed text shown as text
const holeCard = document.createElement("aside");
holeCard.id = "holecard"; holeCard.hidden = true; document.body.appendChild(holeCard);
const toastEl = document.createElement("div");
toastEl.id = "toast"; toastEl.hidden = true; document.body.appendChild(toastEl);
let toastT = 0;
function toast(msg, ms = 3500) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, ms); }

const deg = (r) => r * 180 / Math.PI;
const bearing = (a, b) => (deg(Math.atan2(b.x - a.x, -(b.z - a.z))) + 360) % 360;   // compass bearing, north = -z
const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const u1 = (m) => Math.round(IMPERIAL ? m * 3.28084 : m);
const uName = IMPERIAL ? "ft" : "m";
const spName = IMPERIAL ? "mph" : "km/h";

renderHoleCard = function (f) {
  if (!f) {   // no hole picked: just the booking link
    holeCard.className = "compact"; lastCardHole = null;
    holeCard.innerHTML = D.links?.tee_times ? `<a href="${D.links.tee_times}" target="_blank" rel="noopener">Book a tee time ↗</a>` : "";
    holeCard.hidden = !D.links?.tee_times; return;
  }
  if (!DG || f.kind !== "hole") { holeCard.hidden = true; return; }
  holeCard.className = "";
  const c = pathCurve(f), L = c.getLength(), at = (m) => c.getPointAt(Math.min(1, m / L));
  const a = at(0), b = at(L), rows = [];
  if (!f._facts) {   // shape, water carry and crest do not change: work them out once (GPS fixes re-draw the card every second)
    let carry = 0, hi = -1e9;
    for (let m = 0; m <= L; m += 1) {
      const q = at(m);
      if (D.water.some((w) => inPoly(q.x, q.z, w))) carry++;
      if (m % 3 === 0) hi = Math.max(hi, q.y);
    }
    f._facts = { turn: ((bearing(at(L * 0.7), b) - bearing(a, at(L * 0.3)) + 540) % 360) - 180, carry, hi };
  }
  const { turn, carry, hi } = f._facts;
  rows.push(Math.abs(turn) < 12 ? "Straight line" : `Bends ${turn > 0 ? "right" : "left"} about ${Math.round(Math.abs(turn))}°`);
  if (carry >= 3) rows.push(`Water carry about ${u1(carry)} ${uName}`);
  if (hi - Math.max(a.y, b.y) > 3) rows.push(`Crest ${u1(hi - a.y)} ${uName} above the tee mid-hole`);
  if (WX) {
    const tb = bearing(a, b), rel = (WX.dir - tb) * Math.PI / 180;
    const head = WX.speed * Math.cos(rel), cross = WX.speed * Math.sin(rel);
    rows.push(`Wind: ${Math.round(Math.abs(head))} ${spName} ${head >= 0 ? "headwind" : "tailwind"}${Math.abs(cross) >= 2 ? `, ${Math.round(Math.abs(cross))} crosswind from the ${cross > 0 ? "right" : "left"}` : ""}`);
  }
  if (ME) rows.push(`You: ${u1(Math.hypot(ME.x - b.x, ME.z - b.z))} ${uName} to the basket`);
  const note = (f.notes || "").replace(/^DGPT 2020: /, "");
  const dz = b.y - a.y;
  holeCard.innerHTML = `<div class="hc-h"><b>Hole ${f.number}</b><span>Par ${f.par ?? "–"}${SMALL ? '<i class="ms hc-chev">expand_more</i>' : ""}</span></div>
    <div class="hc-s"><b>${u1(f.length_m)}</b> ${uName} · ${dz >= 0 ? "▲ uphill" : "▼ downhill"} ${Math.abs(u1(dz))} ${uName}</div>
    <ul>${rows.map((r) => `<li>${r}</li>`).join("")}</ul>${note ? `<p>${note}</p>` : ""}
    ${D.links?.tee_times ? `<a href="${D.links.tee_times}" target="_blank" rel="noopener">Book a tee time ↗</a>` : ""}`;
  holeCard.classList.toggle("mini", SMALL && !cardOpen);
  if (f !== lastCardHole) { lastCardHole = f; document.querySelector(".chip.on")?.scrollIntoView({ inline: "center", block: "nearest" }); }
  holeCard.hidden = false;
};
holeCard.addEventListener("click", (e) => { if (!SMALL || e.target.closest("a")) return; cardOpen = !cardOpen; if (current) renderHoleCard(current); });

discIdle = function () {
  current = null; document.body.classList.remove("has-hole");
  if (highlight) { scene.remove(highlight); highlight.traverse((o) => o.geometry && o.geometry.dispose()); highlight = null; }
  for (const l of selLabels) { l.el.remove(); l.line?.remove(); l.dot?.remove(); labels.splice(labels.indexOf(l), 1); }
  selLabels = [];
  TU.uSegN.value = 0;
  $("p-title").textContent = D.name; $("p-sub").textContent = "Pick a hole for its line, rules and a flyover";
  $("p-stats").innerHTML = ""; $("p-status").hidden = true; $("profile").hidden = true;
  document.querySelectorAll(".chip").forEach((b) => b.classList.remove("on"));
  renderHoleCard(null);
  history.replaceState(null, "", `?c=${KEY}&layout=${LAYOUT}`);
  goTo(wholeView(), 1.4);   // back to the whole course
  openTab("g0");            // layouts and holes are on offer again
  invalidate(4);
};
$("whole").addEventListener("click", () => discIdle());
document.addEventListener("click", (e) => {   // the x-ray button in the profile bar
  const b = e.target.closest("#pf-xray"); if (!b) return;
  corridorOn = !corridorOn; b.classList.toggle("on", corridorOn); b.setAttribute("aria-pressed", String(corridorOn));
  setCorridor(current);
});

// ---------- weather for the whole course (Open-Meteo, free, no key) ----------
async function loadWeather() {
  const card = $("wx"), body = card.querySelector(".wx-body"), ck = `wx2:${KEY}`;
  const ICON = (code, day) => code === 0 ? (day ? "sunny" : "bedtime") : code <= 2 ? (day ? "partly_cloudy_day" : "partly_cloudy_night") : code === 3 ? "cloud"
    : code <= 48 ? "foggy" : code <= 67 ? "rainy" : code <= 77 ? "weather_snowy" : code <= 82 ? "rainy" : code <= 86 ? "weather_snowy" : "thunderstorm";
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: GEO.lat0, longitude: GEO.lon0, forecast_days: 3, timezone: "auto",
    current: "temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,is_day,precipitation",
    daily: "temperature_2m_max,temperature_2m_min",
    ...(IMPERIAL ? { temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" } : {}) });
  let j = null, stale = null;
  try { const c = JSON.parse(localStorage.getItem(ck) || "null"); if (c) { stale = c.j; if (Date.now() - c.t < 15 * 60e3) j = c.j; } } catch (e) { /* no storage */ }
  if (!j) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(r.status);
      j = await r.json();
      try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), j })); } catch (e) { /* ignore */ }
    } catch (e) { j = stale; if (!j) { if (++wxTries < 4) setTimeout(loadWeather, 60e3); return; } }   // rate limit or offline: show the last copy, or try again in a minute
  }
  const c = j.current, d = j.daily;
  WX = { speed: c.wind_speed_10m, dir: c.wind_direction_10m, gust: c.wind_gusts_10m };
  $("wx-ico").textContent = ICON(c.weather_code, c.is_day);
  $("wx-now").textContent = `${Math.round(c.temperature_2m)}° · wind ${Math.round(c.wind_speed_10m)} ${spName}`;
  const days = d.time.slice(1).map((t, i) => `${new Date(t + "T12:00").toLocaleDateString("en", { weekday: "short" })} ${Math.round(d.temperature_2m_max[i + 1])}°/${Math.round(d.temperature_2m_min[i + 1])}°`).join(" · ");
  body.innerHTML = `<div class="wx-head"><span>Now at the course</span><span>model data</span></div>
    <div class="wx-row"><span class="ms" style="transform:rotate(${c.wind_direction_10m + 180}deg)" title="Direction the wind blows toward">navigation</span><b>${Math.round(c.wind_speed_10m)} ${spName}</b>
    <span>from the ${compass(c.wind_direction_10m)}<br><small style="margin:0">gusts ${Math.round(c.wind_gusts_10m)}</small></span><small>${Math.round(c.temperature_2m)}°<br>rain ${c.precipitation}</small></div>
    <div class="wx-foot"><span>${days}</span></div>
    <div class="wx-foot"><span>The hole card shows head / crosswind</span><a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></div>`;
  card.hidden = false;
  if (current) renderHoleCard(current);
}
if (DG) loadWeather();
$("wx").addEventListener("toggle", () => { holeCard.style.visibility = $("wx").open ? "hidden" : ""; });

// ---------- where am I (browser GPS; ?fakegps=lon,lat[,accuracy] to test away from the course) ----------
$("brand").insertAdjacentHTML("beforeend", '<button class="ibtn ms" id="locbtn" title="Where am I" aria-label="Show my position" aria-pressed="false">my_location</button>'
  + '<button class="pillbtn" id="lostbtn" title="Mark where a disc was lost" aria-label="Lost a disc"><span class="ms">pin_drop</span>Lost a disc</button>');
const meTex = canvasTex(26, 26, (g) => { g.fillStyle = "#fff"; g.beginPath(); g.arc(13, 13, 12, 0, 7); g.fill(); g.fillStyle = "#2f7bff"; g.beginPath(); g.arc(13, 13, 8.5, 0, 7); g.fill(); });
const meDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: meTex.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
meDot.renderOrder = 10; meDot.visible = false; scene.add(meDot);
const meAcc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false }));
meAcc.rotation.x = -Math.PI / 2; meAcc.renderOrder = 9; meAcc.visible = false; scene.add(meAcc);
let geoWatch = null, firstFix = true, wakeLock = null;
function setMe(lon, lat, acc) {
  const p = window.CE.fromLonLat(lon, lat);
  if (p.x < X0 - 40 || p.x > X0 + T.width + 40 || p.z < Z0 - 40 || p.z > Z0 + T.depth + 40) {
    const km = Math.hypot((lon - GEO.lon0) * GEO.kx, (lat - GEO.lat0) * GEO.kz) / 1000;
    toast(`You are ${km.toFixed(km < 10 ? 1 : 0)} km from the course`); stopLocate(); return;
  }
  ME = { x: p.x, z: p.z, lon, lat, acc };
  meDot.position.set(p.x, p.y + 1.2, p.z); meDot.scale.set(...pinScale(meTex), 1); meDot.visible = true;
  meAcc.position.set(p.x, p.y + 0.6, p.z); meAcc.scale.setScalar(Math.min(Math.max(acc, 3), 60)); meAcc.visible = true;
  if (firstFix) {   // slide the view over to you, keeping the angle
    firstFix = false;
    const d = new THREE.Vector3(p.x - controls.target.x, p.y - controls.target.y, p.z - controls.target.z);
    goTo({ pos: camera.position.clone().add(d), target: controls.target.clone().add(d) }, 1.1);
  }
  invalidate(4);
  if (current) renderHoleCard(current);
}
function stopLocate() {
  if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null; ME = null; try { wakeLock?.release(); } catch (e) { /* ignore */ } wakeLock = null; meDot.visible = meAcc.visible = false; $("locbtn").setAttribute("aria-pressed", "false"); $("locbtn").classList.remove("on");
  invalidate(4); if (current) renderHoleCard(current);
}
$("locbtn").addEventListener("click", () => {
  if (ME || geoWatch != null) { stopLocate(); return; }
  const fake = params.get("fakegps");
  $("locbtn").setAttribute("aria-pressed", "true"); $("locbtn").classList.add("on"); firstFix = true; geoWatch = -1;
  navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {});   // on the course the screen should not go dark
  if (fake) { const [lo, la, ac] = fake.split(",").map(Number); setMe(lo, la, ac || 5); return; }
  if (!navigator.geolocation) { toast("This browser has no location access"); stopLocate(); return; }
  geoWatch = navigator.geolocation.watchPosition((pos) => setMe(pos.coords.longitude, pos.coords.latitude, pos.coords.accuracy),
    (err) => { toast(err.code === 1 ? "Location is blocked for this site" : "No GPS fix yet"); stopLocate(); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
});

// ---------- lost discs: kept on this device for now (a shared map needs a small server later) ----------
const LK = `lost:${KEY}`;
let lost = [], lostLabels = [], lostSprites = [], picking = false;
try { lost = JSON.parse(localStorage.getItem(LK) || "[]"); } catch (e) { /* no storage */ }
const lostTex = canvasTex(26, 34, (g) => {
  g.strokeStyle = "rgba(20,32,43,.8)"; g.lineWidth = 2; g.beginPath(); g.moveTo(13, 20); g.lineTo(13, 31); g.stroke();
  g.fillStyle = "#c62121"; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(13, 12, 9, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.ellipse(13, 12, 5, 2.4, 0, 0, 7); g.fill();
});
groupOn.lost = true;
function drawLost() {
  for (const l of lostLabels) { l.el.remove(); l.line?.remove(); l.dot?.remove(); labels.splice(labels.indexOf(l), 1); }
  for (const sp of lostSprites) scene.remove(sp);
  lostLabels = []; lostSprites = [];
  for (const it of lost) {
    const p = window.CE.fromLonLat(it.lon, it.lat);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lostTex.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    sp.center.set(0.5, 0.05); sp.scale.set(...pinScale(lostTex), 1); sp.position.set(p.x, p.y + 0.5, p.z); sp.renderOrder = 9; scene.add(sp); lostSprites.push(sp);
    const l = addLabel(esc(it.note || "Lost disc"), new THREE.Vector3(p.x, p.y + 4, p.z), "badge", null, 55, "lost"); l.el.style.background = "#c62121"; lostLabels.push(l);
  }
  const box = $("lost-list");
  if (box) {
    box.innerHTML = lost.length ? lost.map((it) => `<div class="lost-row"><span>${esc(it.note || "Lost disc")}<small>${new Date(it.t).toLocaleDateString("en")}</small></span>
      <button data-go="${it.id}" class="ms" title="Show on map">my_location</button><button data-del="${it.id}" class="ms" title="Delete">delete</button></div>`).join("")
      + '<button id="lost-copy" class="linkbtn">Copy as JSON</button>' : '<small>None yet. Tap the pin button to add one.</small>';
  }
  invalidate(4);
}
function addLost(lon, lat) {
  const note = prompt("Which disc, or what to remember? (optional)", "");
  if (note === null) return;
  lost.push({ id: Date.now(), lon, lat, note: note.slice(0, 80), t: new Date().toISOString() });
  try { localStorage.setItem(LK, JSON.stringify(lost)); } catch (e) { toast("Could not save on this device"); }
  drawLost(); toast("Pin saved on this device");
}
$("lostbtn").addEventListener("click", () => {
  if (ME) { addLost(ME.lon, ME.lat); return; }
  picking = !picking; $("lostbtn").classList.toggle("on", picking);
  renderer.domElement.style.cursor = picking ? "crosshair" : "";
  if (picking) toast("Tap the map where the disc went, or switch on your position first");
});
{
  const rc = new THREE.Raycaster(); let dn = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { dn = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!picking || !dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 5) return;
    rc.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObject(terrain, false)[0];
    if (!hit) return;
    picking = false; $("lostbtn").classList.remove("on"); renderer.domElement.style.cursor = "";
    const ll = window.CE.toLonLat(hit.point.x, hit.point.z); addLost(ll.lon, ll.lat);
  });
}

// ---------- layers pane: seasons, lost list, links ----------
{ // the settings live behind a gear next to the weather, like on the ski map
  const btn = document.createElement("button"); btn.className = "ibtn ms"; btn.id = "gearbtn"; btn.title = "Settings";
  btn.setAttribute("aria-label", "Settings"); btn.setAttribute("aria-expanded", "false"); btn.textContent = "settings";
  const pop = document.createElement("div"); pop.id = "gearpop"; pop.hidden = true; pop.innerHTML = "<h4>Map settings</h4>"; pop.append($("layer-checks"));
  $("topright").append(btn); document.body.append(pop);
  const shut = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); if (!pop.hidden) $("wx").open = false; });
  addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) shut(); });
  $("wx").addEventListener("toggle", () => { if ($("wx").open) shut(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
}
$("layer-checks").insertAdjacentHTML("beforeend", `${D.ortho_alt ? '<div class="lc"><span>Aerial photo</span><div class="seg small" id="photo-seg"><button data-ph="summer" class="on">Summer</button><button data-ph="spring">Spring</button></div></div>' : ""}<div class="lc"><span>Light</span><div class="seg small" id="light-seg"><button data-lt="0.14">Morning</button><button data-lt="0.55" class="on">Midday</button><button data-lt="0.9">Golden</button></div></div>
  <label class="tg"><span>Caddie-book markers (trunks, OB lines, DZ, mando)</span><input type="checkbox" role="switch" id="lc-mark" checked></label>
  <div class="lc"><span>Lost discs (this device only)</span><div id="lost-list"></div></div>
  ${D.links ? `<div class="lc links"><a href="${D.links.tee_times}" target="_blank" rel="noopener">Book a tee time ↗</a><a href="${D.links.website}" target="_blank" rel="noopener">Club website ↗</a></div>` : ""}`);
if (D.ortho_alt) {
  const TL = new THREE.TextureLoader(), photos = { summer: ORTHO.uOrtho.value };   // the summer photo is already loading as the default
  const photo = (k) => {
    if (!photos[k]) { photos[k] = TL.load(D.ortho_alt[k], () => invalidate(4)); photos[k].colorSpace = THREE.SRGBColorSpace; photos[k].anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    return photos[k];
  };
  $("photo-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ph]"); if (!b) return;
    ORTHO.uOrtho.value = photo(b.dataset.ph);
    document.querySelectorAll("#photo-seg button").forEach((x) => x.classList.toggle("on", x === b)); invalidate(4);
  });
}
$("light-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-lt]"); if (!b) return;
  setLight(+b.dataset.lt);
  if (+b.dataset.lt > 0.8) { sun.color.setRGB(1, 0.78, 0.56); lightBase.sunI = 3.2; lightBase.hemiI = 0.95; applyNight(); }   // golden hour: a warmer, stronger low sun
  document.querySelectorAll("#light-seg button").forEach((x) => x.classList.toggle("on", x === b)); invalidate(8);
});
$("layer-checks").insertAdjacentHTML("beforeend", `<p class="gp-credit">${D.attribution}</p>`);
$("lc-mark").addEventListener("change", (e) => { showMarkers = e.target.checked; if (current) { setHighlight(current); setSelLabels(current); } invalidate(4); });
$("lost-list").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]"), del = e.target.closest("[data-del]");
  if (go) { const it = lost.find((x) => String(x.id) === go.dataset.go), p = window.CE.fromLonLat(it.lon, it.lat); const d = new THREE.Vector3(p.x - controls.target.x, p.y - controls.target.y, p.z - controls.target.z); goTo({ pos: camera.position.clone().add(d), target: controls.target.clone().add(d) }, 1); }
  if (del) { lost = lost.filter((x) => String(x.id) !== del.dataset.del); try { localStorage.setItem(LK, JSON.stringify(lost)); } catch (err) { /* ignore */ } drawLost(); }
  if (e.target.id === "lost-copy") navigator.clipboard?.writeText(JSON.stringify(lost)).then(() => toast("Copied"));
});
drawLost();

// ---------- previous / next hole in the panel header; the floating buttons follow the sheet's height ----------
{
  const nav = document.createElement("div"); nav.className = "hole-nav";
  nav.innerHTML = '<button id="hole-home" class="ms" aria-label="Back to the whole course" title="Whole course">home</button><button id="hole-prev" class="ms" aria-label="Previous hole">chevron_left</button><button id="hole-next" class="ms" aria-label="Next hole">chevron_right</button>';
  document.querySelector("#panel .ph").append(nav);
  const step = (d) => {
    if (!current) return;
    const all = D.features.filter((x) => x.kind === "hole" && x.listed).sort((a, b) => a.number - b.number);
    const i = all.indexOf(current); if (i < 0) return;
    select(all[(i + d + all.length) % all.length], "overview");
  };
  $("hole-home").addEventListener("click", () => discIdle());
  $("hole-prev").addEventListener("click", () => step(-1));
  $("hole-next").addEventListener("click", () => step(1));
  const panel = $("panel");
  const sheet = () => document.documentElement.style.setProperty("--sheet-h", `${panel.offsetHeight}px`);
  sheet(); if (window.ResizeObserver) new ResizeObserver(sheet).observe(panel);
  if (SMALL && D.ortho) {   // the aerial photo over the whole map, one tap
    const b = document.createElement("button"); b.className = "ibtn ms"; b.id = "photobtn"; b.title = "Aerial photo"; b.setAttribute("aria-label", "Aerial photo"); b.setAttribute("aria-pressed", "false"); b.textContent = "satellite_alt";
    $("brand").append(b);
    b.addEventListener("click", () => { const on = ORTHO.uCurtain.value < 0.5; ORTHO.uCurtain.value = on ? 1 : 0; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); invalidate(4); });
  }
}

}

// start: hash or whole view
const start = SKI ? D.features.find((f) => "#" + f.id === location.hash)
  : D.features.find((f) => f.listed && String(f.number) === params.get("hole"));
refreshStatusUI();
if (!SKI) openTab("g0");   // hole list open from the start (after the loop helpers exist)
updateViewOffset();
const w = wholeView();
const intro = SKI && !start && params.get("intro") !== "0" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const first = intro ? paperView() : w;
camera.position.copy(first.pos); controls.target.copy(first.target);
if (start) select(start, "overview");
else if (SKI) renderIdle();
else discIdle();
mark("scene built");
// phones: the first frame is computed before the layout settles; frame the whole map again once it has
if (phone() && !start) requestAnimationFrame(() => requestAnimationFrame(() => { if (!current && !anim) { const h = wholeView(); camera.position.copy(h.pos); controls.target.copy(h.target); controls.update(); invalidate(); } }));
tick();
setTimeout(() => $("splash")?.classList.add("gone"), 300);
if (intro) {   // hold the paper-map view for a moment, then turn into the 3D map; any touch stops it
  const introTimer = setTimeout(() => goTo(w, 4.2, true), 1500);
  renderer.domElement.addEventListener("pointerdown", () => clearTimeout(introTimer), { once: true });
}
