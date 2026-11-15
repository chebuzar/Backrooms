import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from './render/n8ao/N8AOPass.js';
import { clamp, lerp, easeOut, angleDiff, pick, store, sleep, frames } from './core/util.js';
import { monsterFor, MONSTERS as MON } from './data/game-data.js';
import { theme, THEMES, DIFF, NOTES, ACH, PROLOGUE, ENDING, WHISPERS, LAST, notesFor, SECRETS, QUICK } from './data/game-data.js';
import { Net, makeCode } from './net/net.js';
import { buildExtras, updateExtras, addMark, taskFor, TASK_GOAL, ANOMS, ANOM_KEYS } from './world/extras.js';
import { genGrid, buildLevel, S, BAKE, AMBK, solidMove } from './world/level.js';
import { Entity, makeEntityMesh, disposeMesh } from './world/entity.js';
import { Sound } from './audio/sound.js';
import { setTexScale } from './render/textures.js';
import { t as tr } from './i18n/index.js';
import { device, detectDevice, autoProfile, isAndroid } from './core/device.js';
import { FIND_KINDS, FIND_IDS, buildFinds, updateFinds, findPoint } from './world/finds.js';
import { makeWrist, poseWrist, drawRadar } from './world/wrist.js';
import { createMinimap, drawMinimap, trackTrail, resetMinimap } from './ui/minimap.js';
import { makeDust, updateDust } from './render/dust.js';
import { preloadMonsters, makeMonsterMesh } from './world/monster-models.js';
import { updateLockers } from './world/lockers.js';
// готовая модель, если загрузилась; иначе — процедурный монстр
const monsterMesh = (look) => makeMonsterMesh(look) || makeEntityMesh(look);
import { themeTex, setAniso, setTexHi, texSet } from './render/assets.js';

const $ = (id) => document.getElementById(id);
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
document.documentElement.classList.toggle('touch', isTouch);
// платформа и сила видеокарты (src/core/device.js) → профиль графики (PROFILES ниже)
const DEV = device;

// ---------- сохранение ----------
const DEF = { sens: 1, vol: 80, q: 'auto', diff: 'normal', vib: true };
const SAVE = Object.assign({ max: -1, cont: 0, notes: [], ach: [], anom: [] }, store.load());
if (!Array.isArray(SAVE.anom)) SAVE.anom = [];
SAVE.set = Object.assign({}, DEF, SAVE.set || {});
const persist = () => store.save(SAVE);

// ---------- рендер ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const m = $('loadMsg'); show('loading'); if (m) { m.classList.add('err'); m.textContent = 'Графика перезапускается… Если экран не вернётся, обнови страницу и выбери графику «Низкая».'; }
  setTimeout(() => location.reload(), 2500);
});
const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2b2309, 0.07);
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
const amb = new THREE.AmbientLight(0xfff0d0, 1);
scene.add(amb);
const flash = new THREE.SpotLight(0xfff2dc, 0, 32, 0.5, 0.65, 1.0);
flash.position.set(0.15, -0.1, 0.45);
const fTarget = new THREE.Object3D(); fTarget.position.set(0, -0.15, -5);
camera.add(flash); camera.add(fTarget); flash.target = fTarget;
const wrist = makeWrist(); camera.add(wrist.root);
let dust = null;

// Настройки «картинки» в одном месте (подбираются по скриншотам; в отладке — __zk.LOOK).
// h — внутренняя высота кадра в пикселях: стиль старой камеры, крупный пиксель, заодно быстрее на телефонах.
const LOOK = { vhsPixel: false, vhs: 0.25, dyn: { n: 3, I: 2.2, dist: 9 }, amb0: 0.25, ambK: 1.3, wallAmb: 0.22, bake: 1.0, h: { low: 300, med: 400, high: 480 }, bloom: [0.55, 0.5, 0.88], exposure: 1.05 };
renderer.toneMappingExposure = LOOK.exposure;
const composerRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
// Мягкие тени в углах и под предметами (SSAO, N8AO, CC0 — src/render/n8ao). Заменяет RenderPass, когда включено профилем.
// Запечённый AO стен уже есть — этот добавляет контакт мебели, шкафчиков, монстра, находок.
const aoPass = new N8AOPass(scene, camera, 16, 16);
Object.assign(aoPass.configuration, { gammaCorrection: false, aoRadius: 1.3, distanceFalloff: 1.0, intensity: 3.6, depthAwareUpsampling: true });
let aoMode = 0;
function setAO(mode, samples) {
  aoMode = mode;
  if (mode) {
    aoPass.setQualityMode(mode === 2 ? 'Medium' : 'Performance');
    aoPass.configuration.halfRes = mode === 1;
    if (aoPass.beautyRenderTarget.samples !== samples) { aoPass.beautyRenderTarget.samples = samples; aoPass.beautyRenderTarget.dispose(); }
  }
  composer.passes[0] = mode ? aoPass : renderPass;
}
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), LOOK.bloom[0], LOOK.bloom[1], LOOK.bloom[2]);
composer.addPass(bloom);
// свечение можно считать в ¼ кадра вместо ½ (bloomDiv = 2) — 10 проходов размытия в 4 раза дешевле
{ const bs = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => bs(w / bloomDiv, h / bloomDiv); }
composer.addPass(new OutputPass());
const FX = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(640, 360) }, uVhs: { value: 0.25 }, uTime: { value: 0 }, uGrain: { value: 0.08 }, uVig: { value: 0.3 }, uAb: { value: 0.15 },
    uDist: { value: 0 }, uRed: { value: 0 }, uFade: { value: 0 }, uWhite: { value: 0 }, uSat: { value: 1 }, uNV: { value: 0 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uVhs;
    uniform float uTime,uGrain,uVig,uAb,uDist,uRed,uFade,uWhite,uSat,uNV;
    float rnd(vec2 c){ return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv=vUv; vec2 c=uv-0.5;
      float band=step(0.993,rnd(vec2(floor(uv.y*90.0),floor(uTime*18.0))));
      uv.x+=(band*0.025+sin(uv.y*38.0+uTime*7.0)*0.003)*uDist;
      uv+=c*dot(c,c)*0.08*uDist;
      // полоса «трекинга» видеокассеты медленно ползёт по кадру
      float ty=fract(uTime*0.045); float trk=smoothstep(0.012,0.0,abs(uv.y-ty));
      trk*=uVhs; uv.x+=trk*0.004*sin(uv.y*900.0+uTime*40.0);
      vec2 off=c*uAb*0.008;
      // цвет «плывёт» вправо относительно яркости, как на VHS
      vec2 cb=vec2(1.6/uRes.x,0.0)*uVhs*(uRes.y/480.0);
      vec3 col=vec3(texture2D(tDiffuse,uv+off+cb).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-off-cb*0.6).b);
      vec3 bl=(texture2D(tDiffuse,uv+cb*2.0).rgb+texture2D(tDiffuse,uv-cb*2.0).rgb)*0.5;
      float ly=dot(col,vec3(0.299,0.587,0.114)); col=mix(col,vec3(ly)+(bl-vec3(dot(bl,vec3(0.299,0.587,0.114))))*1.0,0.35*uVhs);
      // цветокор: мягкая S-кривая, тени в холодную зелень, света тёплые
      col=clamp(col,0.0,1.0); col=mix(col,col*col*(3.0-2.0*col),0.35);
      float lum=dot(col,vec3(0.299,0.587,0.114));
      col+=vec3(-0.012,0.006,0.012)*(1.0-smoothstep(0.0,0.45,lum))+vec3(0.025,0.012,-0.02)*smoothstep(0.55,1.0,lum);
      col+=trk*(rnd(vec2(uv.x*400.0,uTime))-0.3)*0.12;
      float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(l),col,uSat);
      col*=1.0-0.035*uVhs+0.035*uVhs*sin(vUv.y*uRes.y*3.14159);
      col+=(rnd(vUv*vec2(731.0,519.0)+fract(uTime*7.3))-0.5)*uGrain;
      float v=smoothstep(0.9,0.25,length(c)*(1.0+uVig)); col*=mix(1.0,v,0.9);
      col=mix(col,col*vec3(1.35,0.4,0.35)+vec3(0.06,0.0,0.0),uRed*clamp(0.3+length(c)*1.5,0.0,1.0));
      float nl=dot(col,vec3(0.3,0.59,0.11)); vec3 nvc=vec3(0.15,1.0,0.3)*(pow(nl,0.6)*1.6+0.03)*(0.9+0.1*sin(vUv.y*600.0));
      col=mix(col,nvc,uNV);
      col=mix(col,vec3(1.0),uWhite);
      col*=1.0-uFade;
      gl_FragColor=vec4(col,1.0);
    }`
};
const fxPass = new ShaderPass(FX);
composer.addPass(fxPass);
const U = fxPass.uniforms;
U.uVhs.value = LOOK.vhs;
// Живой свет ближайших ламп: даёт блики и рельеф на фото-текстурах. Основной свет по-прежнему запечён.
const lampLights = [];
for (let i = 0; i < LOOK.dyn.n; i++) { const L = new THREE.PointLight(0xfff0d0, 0, LOOK.dyn.dist, 2); scene.add(L); lampLights.push(L); }
let lampPickT = 0;
function updateLampLights(dt, P) {
  const hi = Math.min(prof.lamps, LOOK.dyn.n);
  lampPickT -= dt;
  if (lampPickT <= 0 && lvl) {
    lampPickT = 0.25;
    const cx = camera.position.x, cz = camera.position.z, best = [];
    for (const l of lvl.lamps) {
      if (l.dead || l.on5) continue;
      const d = (l.x - cx) ** 2 + (l.z - cz) ** 2; if (d > 200) continue;
      best.push([d, l]);
    }
    best.sort((a, b) => a[0] - b[0]);
    const col = game.th.lampCol || [1, 0.95, 0.85];
    lampLights.forEach((L, i) => {
      const b = best[i];
      L.userData.on = !!b && i < hi;
      if (b) { L.position.set(b[1].x, (lvl.HH || 2.7) - 0.25, b[1].z); L.color.setRGB(col[0], col[1], col[2]); L.userData.emerg = b[1].emerg; }
    });
  }
  for (const L of lampLights) L.intensity = L.userData.on ? LOOK.dyn.I * P * (L.userData.emerg ? 0.4 : 1) * (game.th.lampI || 1) : 0;
}

// ---------- профили графики ----------
// pr(dpr, h) — плотность кадра (h — высота окна в CSS-px; 1080/h = Full HD по высоте),
// floor(base, h, fps) — ниже чего авто-разрешение не опускается, msaa — сглаживание,
// tex2k — 2K-текстуры (≈180 МБ видеопамяти) или 1K, lamps — живые лампы (каждая утяжеляет каждый пиксель),
// bloom: 0 — нет, 1 — в ¼ кадра, 2 — в ½, aniso — чёткость текстур под углом,
// ao — мягкие тени N8AO: 0 — нет, 1 — в ½ разрешения (быстро), 2 — полное.
const PROFILES = {
  low: { pr: (d) => Math.min(d, 1) * 0.75, floor: (b) => b * 0.5, msaa: 0, tex2k: false, lamps: 0, bloom: 0, aniso: 4, ao: 0 },
  med: { pr: (d, h) => Math.min(2, Math.max(d * 0.85, 900 / h)), floor: (b) => b * 0.5, msaa: 2, tex2k: true, lamps: 2, bloom: 2, aniso: 8, ao: 1 },
  // на Retina (DPR ≥ 2) пиксели мелкие — хватает MSAA 2×
  high: { pr: (d, h) => Math.min(2, Math.max(d, 1080 / h)), floor: (b, h, fps) => (DEV.form === 'desktop' ? Math.min(b, 1080 / h) * (fps < 30 ? 0.75 : 1) : b * 0.7), msaa: (b) => (b >= 1.9 ? 2 : 4), tex2k: true, lamps: 3, bloom: 2, aniso: 8, ao: 1 },
  // «Ультра» — мощные Apple: родное разрешение экрана до 3× (iPhone Pro — 1179 строк), MSAA 4× (на чипах Apple почти бесплатно), анизотропия 16×
  ultra: { pr: (d, h) => Math.min(3, Math.max(d, 1080 / h)), floor: (b) => Math.min(b, 2), msaa: 4, tex2k: true, lamps: 3, bloom: 2, aniso: 16, ao: 2 },
  // Android: кадры ≤ 60; MSAA на HalfFloat-кадре дорогое на Mali/Adreno; 1K-текстуры; свечение в ¼
  droidLow: { pr: (d, h) => Math.min(d, 600 / h), floor: (b, h) => Math.min(b, 400 / h), msaa: 0, tex2k: false, lamps: 0, bloom: 1, aniso: 2, ao: 0 },
  droid: { pr: (d, h) => Math.min(d, 720 / h), floor: (b, h) => Math.min(b, 480 / h), msaa: 0, tex2k: false, lamps: 1, bloom: 1, aniso: 4, ao: 0 },
  droidHigh: { pr: (d, h) => Math.min(2, d, 900 / h), floor: (b, h) => Math.min(b, 600 / h), msaa: 2, tex2k: true, lamps: 2, bloom: 2, aniso: 8, ao: 1 }
};
// выбор игрока → профиль. «Авто» — по устройству; «Средняя» на Android — облегчённая.
function profileName() {
  const q = SAVE.set.q;
  if (q === 'auto') return autoProfile(DEV);
  if (q === 'med' && isAndroid) return 'droid';
  return PROFILES[q] ? q : 'med';
}
let quality = 'med', prof = PROFILES.med, basePR = 1, curPR = 1, bloomDiv = 1;
const anisoNow = () => Math.min(prof.aniso, maxAniso);
function applyQuality() {
  const q = profileName(); quality = q; prof = PROFILES[q];
  const dpr = window.devicePixelRatio || 1, h = Math.max(240, innerHeight);
  basePR = prof.pr(dpr, h);
  if (LOOK.vhsPixel && LOOK.h[q]) basePR = Math.min(dpr, Math.max(0.25, LOOK.h[q] / h));
  setTexHi(prof.tex2k); setTexScale(q === 'low' ? 1 : 2); setAniso(anisoNow());
  const samples = typeof prof.msaa === 'function' ? prof.msaa(basePR) : prof.msaa;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
  setAO(prof.ao, samples);
  // выключенная лампа исключается из шейдера (одна перекомпиляция при смене профиля, а не каждый кадр)
  lampLights.forEach((L, i) => { L.visible = i < prof.lamps; });
  bloom.enabled = prof.bloom > 0; bloomDiv = prof.bloom === 1 ? 2 : 1;
  curPR = basePR; setPR(curPR);
}
function setPR(pr) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize(); }
// авто-качество: если кадров мало, снижаем разрешение рендера; если много — возвращаем
const perf = { t: 0, n: 0 };
function autoRes(dt) {
  if (SAVE.set.q !== 'auto' || game.mode !== 'play') { perf.t = 0; perf.n = 0; return; }
  perf.t += dt; perf.n++;
  if (perf.t < 2.5) return;
  const fps = perf.n / perf.t; perf.t = 0; perf.n = 0;
  const floor = prof.floor(basePR, Math.max(240, innerHeight), fps);
  if (fps < 45 && curPR > floor) { curPR = Math.max(floor, curPR * 0.88); setPR(curPR); }
  else if (fps > 56 && curPR < basePR) { curPR = Math.min(basePR, curPR * 1.12); setPR(curPR); }
}
function resize() {
  const w = innerWidth, h = innerHeight;
  if (LOOK.vhsPixel && quality && LOOK.h[quality]) { const want = Math.min(window.devicePixelRatio || 1, Math.max(0.25, LOOK.h[quality] / Math.max(240, h))); if (Math.abs(want - basePR) > 0.01) { basePR = want; curPR = Math.min(curPR, basePR); if (renderer.getPixelRatio() !== curPR) { renderer.setPixelRatio(curPR); composer.setPixelRatio(curPR); } } }
  renderer.setSize(w, h, false); composer.setSize(w, h);
  if (typeof fxPass !== 'undefined') { const pr = renderer.getPixelRatio(); fxPass.uniforms.uRes.value.set(w * pr, h * pr); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
// поворот экрана, Stage Manager на iPad, изменение окна: пересчитать разрешение кадра (Full HD держится по высоте)
let rsT = 0;
const onResize = () => { clearTimeout(rsT); rsT = setTimeout(() => { if (typeof applyQuality === 'function' && quality) applyQuality(); else resize(); }, 60); };
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 350));
if (window.visualViewport) visualViewport.addEventListener('resize', onResize);

const sound = new Sound();
sound.vol = SAVE.set.vol / 100;

// ---------- состояние ----------
const game = {
  mode: 'loading', level: 0, th: theme(0), time: 0, runTime: 0, deaths: 0, power: 1, black: false, bkT: 60, warned: false, warnF: 0, warnOn: true,
  flT: 0, dip: 1, dipT: 0, evT: 20, halT: 20, dripT: 3, whT: 15, lampFT: 3, hbT: 0, stare: 0, minSan: 100, prox: 0,
  scT: 0, trT: 0, trDone: false, endless: false, ghostT: 0, secretSeen: false, notesLv: 0, act: null,
  coop: null, overlay: false, netBlack: false, netEnt: null, netT: 0, seed: 0, taken: new Set(), roster: [], respawnT: 0, pending: null, rosterT: 0
};
const pl = { x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, sta: 100, staDelay: 0, tired: false, san: 100, bat: 100, light: false, hasKey: false, bobPh: 0, bob: 0, noise: 0, fov: 72, wake: 1, running: false, dist: 0, gy: 0, hidden: null, hideYaw: 0, crouch: false, ch: 0, nv: false, emp: 1, empT: 0, scanCD: 0, actT: 0, burst: 0 };
let lvl = null, ent = null, ghost = null, tAll = 0;
const input = { keys: {}, jx: 0, jy: 0, jmag: 0, joyId: null, jox: 0, joy0: 0, lookId: null, lx: 0, ly: 0, ldx: 0, ldy: 0 };
const vib = (p) => { if (SAVE.set.vib) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } } };

function disposeWorld() {
  if (game.finds) { for (const tx of game.finds.textures) tx.dispose(); game.finds = null; }
  if (lvl) { scene.remove(lvl.root); lvl.dispose(); lvl = null; }
  if (ent) { scene.remove(ent.m.group); disposeMesh(ent.m.group); ent = null; }
  if (ghost) { scene.remove(ghost.group); disposeMesh(ghost.group); ghost = null; }
}

let demoPbr = null; // фото-текстуры уровня 0 для фона меню (грузятся при запуске)
function buildDemo() {
  disposeWorld();
  const th = theme(0), seed = 20261114;
  const G = genGrid(th, 0, seed, { demo: true });
  lvl = buildLevel(th, G, { seed, demo: true, aniso: anisoNow(), pbr: demoPbr });
  scene.add(lvl.root);
  scene.fog.color.set(th.fog); scene.fog.density = th.fogD;
  game.th = th; game.black = false;
  pl.x = lvl.spawn.x; pl.z = lvl.spawn.z; pl.yaw = lvl.spawn.yaw; pl.pitch = 0.04; pl.wake = 1; pl.bob = 0;
  flash.intensity = 0;
}

// ---------- свет ----------
function lights(dt, allowBlack) {
  const th = game.th; let p = 1;
  if (allowBlack && game.coop && !game.coop.host) {
    if (game.netBlack !== game.black) { game.black = game.netBlack; if (game.black) { sound.lightsOff(); vib(60); } else sound.lightsOn(); }
    if (game.black) p = 0.015;
  } else if (allowBlack && th.black > 0) {
    game.bkT -= dt;
    if (!game.black && game.bkT < 1.3) {
      game.warnF -= dt;
      if (game.warnF <= 0) { game.warnF = 0.04 + Math.random() * 0.1; game.warnOn = !game.warnOn; }
      p *= game.warnOn ? 1 : 0.2;
      if (!game.warned) { game.warned = true; sound.buzz(); }
    }
    if (game.bkT <= 0) {
      if (game.black) { game.black = false; game.bkT = (30 + Math.random() * 40) / th.black; sound.lightsOn(); game.afterBlack = true; }
      else { game.black = true; game.bkT = 4.5 + Math.random() * 3.5; game.warned = false; game.bkFl = 0.7; game.blackGhost = false; sound.lightsOff(); sound.powerDown(); vib(60); }
    }
    if (game.black) p = 0.015;
  }
  game.flT -= dt;
  if (game.flT <= 0) {
    game.flT = 0.15 + Math.random() * 1.6;
    if (Math.random() < 0.28) { game.dip = 0.5 + Math.random() * 0.3; game.dipT = 0.03 + Math.random() * 0.12; if (allowBlack && Math.random() < 0.4) sound.buzz(); }
  }
  if (game.dipT > 0) { game.dipT -= dt; if (!game.black) p *= game.dip; }
  game.power = p;
  const P = p * th.power;
  BAKE.value = Math.PI * P * LOOK.bake; AMBK.value = LOOK.wallAmb;
  amb.intensity = LOOK.amb0 + LOOK.ambK * P + (pl.nv ? 2.2 : 0);
  return P;
}

// ---------- игрок ----------
function blocked(x, z) {
  const r = 0.3;
  const t0x = Math.floor((x - r) / S), t1x = Math.floor((x + r) / S), t0z = Math.floor((z - r) / S), t1z = Math.floor((z + r) / S);
  for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
    if (!solidMove(lvl.tile(tx, tz))) continue;
    const cx = clamp(x, tx * S, tx * S + S), cz = clamp(z, tz * S, tz * S + S);
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  for (const c of lvl.colliders) {
    const cx = clamp(x, c.x0, c.x1), cz = clamp(z, c.z0, c.z1);
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  return false;
}
function moveCollide(dx, dz) {
  if (!blocked(pl.x + dx, pl.z)) pl.x += dx; else pl.vx *= 0.3;
  if (!blocked(pl.x, pl.z + dz)) pl.z += dz; else pl.vz *= 0.3;
}
// Открытый мир вместо «собери 3 предмета»: цель уровня — найти выход в дальнем конце мира.
const WORLD = true;
const levelTask = (lv, seed) => (WORLD ? { kind: 'exit' } : taskFor(lv, seed));
const inPuddle = () => lvl.puddles.some(([x, z, r]) => (pl.x - x) ** 2 + (pl.z - z) ** 2 < r * r);
// Реверб по типу пространства: [длина хвоста, с; громкость]
const REVERB = { pool: [4.6, 0.6], halls: [3.6, 0.5], shelves: [4.0, 0.5], parking: [3.4, 0.45], circus: [2.4, 0.32], rooms: [1.1, 0.16], maze: [2.0, 0.3], smiles: [2.2, 0.34] };
function updatePlayer(dt, canMove) {
  canMove = canMove && !pl.hidden && !game.overlay && !(pl.actT > 0) && !game.kpOpen;
  if (game.overlay) { input.ldx = input.ldy = 0; }
  const sens = SAVE.set.sens, k = input.keys;
  pl.yaw -= input.ldx * 0.0042 * sens; pl.pitch -= input.ldy * 0.0042 * sens; input.ldx = input.ldy = 0;
  pl.yaw -= ((k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0)) * 2.2 * dt;
  pl.pitch = clamp(pl.pitch, -1.3, 1.3);
  if (pl.hidden) {
    pl.yaw = pl.hideYaw + clamp(angleDiff(pl.hideYaw, pl.yaw), -0.55, 0.55);
    pl.pitch = clamp(pl.pitch, -0.35, 0.35);
    canMove = false; pl.vx = pl.vz = 0;
  }
  const inWater = lvl.tile(Math.floor(pl.x / S), Math.floor(pl.z / S)) === 6;
  game.wade = inWater && game.th.props !== 'smiles' ? clamp(Math.hypot(pl.vx, pl.vz) / 2.5, 0, 1) : 0;
  pl.gy += (lvl.groundY(pl.x, pl.z) - pl.gy) * Math.min(1, dt * 6);
  let fw = 0, st = 0;
  if (canMove) {
    if (k.KeyW || k.ArrowUp) fw += 1; if (k.KeyS || k.ArrowDown) fw -= 1;
    if (k.KeyD) st += 1; if (k.KeyA) st -= 1;
    if (input.joyId !== null) { fw -= input.jy; st += input.jx; }
  }
  let mag = Math.hypot(fw, st); if (mag > 1) { fw /= mag; st /= mag; mag = 1; }
  const wantRun = (k.ShiftLeft || k.ShiftRight || (input.joyId !== null && input.jmag > 0.92)) && mag > 0.3 && fw > -0.2;
  if (pl.tired && pl.sta > 30) pl.tired = false;
  if (wantRun && pl.crouch) { pl.crouch = false; syncTools(); }
  const run = wantRun && !pl.tired && pl.sta > 0;
  if (run) { pl.sta -= 22 * dt * (game.chase ? 0.5 : 1); pl.staDelay = 0.9; if (pl.sta <= 0) { pl.sta = 0; pl.tired = true; sound.breath(); } }
  else { pl.staDelay -= dt; if (pl.staDelay <= 0) pl.sta = Math.min(100, pl.sta + 14 * dt); }
  pl.running = run;
  $('joy').classList.toggle('run', run);
  const sp = (run ? 5 : pl.crouch ? 1.5 : 2.9) * (inWater ? 0.58 : 1), sy = Math.sin(pl.yaw), cy = Math.cos(pl.yaw);
  const tvx = (-sy * fw + cy * st) * sp, tvz = (-cy * fw - sy * st) * sp;
  const a = Math.min(1, dt * (mag > 0.05 ? 9 : 12));
  pl.vx += (tvx - pl.vx) * a; pl.vz += (tvz - pl.vz) * a;
  moveCollide(pl.vx * dt, pl.vz * dt);
  const spd = Math.hypot(pl.vx, pl.vz);
  if (spd > 0.25) {
    const prev = Math.sin(pl.bobPh); pl.bobPh += dt * spd * 2.15; const s = Math.sin(pl.bobPh);
    if ((prev < 0) !== (s < 0)) { sound.step(inWater ? (game.th.props === 'smiles' ? 'balls' : 'water') : inPuddle() ? 'puddle' : game.th.step, run); if (ent && ent.active && ent.ai.mimic && ent.dist < 30) setTimeout(() => ent && sound.entStep(ent.x, ent.z, 2), 90); }
    pl.bob = Math.abs(s) * 0.055 * Math.min(1, spd / 3) - 0.027;
  } else pl.bob *= Math.max(0, 1 - dt * 8);
  pl.noise = (run && spd > 3.5 ? 16 : spd > 0.5 ? (pl.crouch ? 0.8 : 4.5) : 0) * (inWater ? 1.7 : 1);
  if (pl.burst > 0) { pl.burst -= dt; pl.noise = Math.max(pl.noise, 14); }
  pl.dist += spd * dt;
}
const tv = new THREE.Vector3(), tdir = new THREE.Vector3();
function applyCamera(dt) {
  const wk = easeOut(pl.wake);
  const sway = pl.san < 40 ? Math.sin(tAll * 0.7) * 0.05 * (1 - pl.san / 40) : 0;
  if (game.shakeT > 0) game.shakeT -= dt;
  const shake = (game.prox > 0.3 ? (Math.random() - 0.5) * 0.006 * game.prox : 0) + (game.shakeT > 0 ? (Math.random() - 0.5) * 0.04 * game.shakeT : 0);
  pl.ch += ((pl.crouch ? 1 : 0) - pl.ch) * Math.min(1, dt * 8);
  camera.position.set(pl.x, lerp(0.3, 1.62 - pl.ch * 0.62, wk) + pl.bob + pl.gy * wk, pl.z);
  camera.rotation.set(pl.pitch - (1 - wk) * 0.55 + shake, pl.yaw + shake, (1 - wk) * 0.35 + sway);
  const tf = (camera.aspect < 1 ? 92 : 72) + (pl.running ? 7 : 0) + (1 - pl.san / 100) * 6;
  pl.fov += (tf - pl.fov) * Math.min(1, dt * 4);
  camera.fov = pl.fov; camera.updateProjectionMatrix();
}
function listener() {
  camera.getWorldDirection(tdir);
  sound.listen(camera.position.x, camera.position.y, camera.position.z, tdir.x, tdir.y, tdir.z);
}

// ---------- взгляд на «Него» ----------
function checkStare() {
  if (!ent || !ent.active) return false;
  tv.set(ent.x, 1.85, ent.z).project(camera);
  if (tv.z > 1 || Math.abs(tv.x) > 0.82 || Math.abs(tv.y) > 0.95) return false;
  const P = game.power * game.th.power;
  const vis = game.black ? (pl.light ? 13 : 4) : (pl.light ? 26 : 8 + 16 * clamp(P, 0, 1));
  if (ent.dist > vis) return false;
  return lvl.los(pl.x, pl.z, ent.x, ent.z);
}

// ---------- предметы и действия ----------
function take(it) {
  if (it.taken) return;
  if (game.coop && it.type !== 'note') {
    const i = lvl.items.indexOf(it);
    game.taken.add(i);
    if (game.coop.host) net.broadcast({ t: 'taken', i, by: net.id }); else net.send(hostId(), { t: 'take', i });
  }
  applyItem(it, null, false);
}
// предмет взят (мной или другом): одинаковые последствия у всех
function applyItem(it, by, silent) {
  if (it.taken) return;
  it.taken = true; if (!it.keep) it.obj.visible = false;
  const who = by ? nameOf(by) + ': ' : '';
  const T = game.task || { kind: 'exit' };
  if (it.type === 'water') { if (!by) { pl.san = Math.min(100, pl.san + 30); sound.pickup(); toast('💧 Вода · рассудок +30%'); } }
  else if (it.type === 'batt') { if (!by) { pl.bat = Math.min(100, pl.bat + 45); sound.battery(); toast('🔋 Батарейка · фонарик +45%'); } }
  else if (it.type === 'key') {
    pl.hasKey = true; sound.key(); vib(40);
    if (!silent) toast('🗝 ' + who + 'ключ-карта найдена', 'gold');
    if (T.chase && (!game.coop || game.coop.host)) startChase();
  } else if (it.type === 'fuse' || it.type === 'ticket') {
    game.parts++; sound.part(); vib(25);
    if (!silent) toast(`${it.type === 'fuse' ? '🔌 ' + who + 'Предохранитель' : '🎟 ' + who + 'Билет'} ${game.parts}/${T.n}`, game.parts >= T.n ? 'gold' : '');
  } else if (it.type === 'valve' || it.type === 'lever') {
    game.parts++;
    it.lampM.color.setRGB(0.2, 3, 0.6); it.glow.material.color.setHex(0x33ff77);
    if (it.type === 'valve') it.part.rotation.z = 2.4; else it.part.rotation.x = -0.7;
    if (!silent) toast(`${it.type === 'valve' ? '🔧 ' + who + 'Вентиль перекрыт' : '⚡ ' + who + 'Рубильник включён'} ${game.parts}/${T.n}`, game.parts >= T.n ? 'gold' : '');
    if (game.parts >= T.n && !silent) { sound.lightsOn(); toast('🚪 Выход открыт!', 'gold'); }
  } else if (it.type === 'clue') {
    game.ex.code.known[it.pos] = true; sound.part();
    if (!silent) toast(`🔢 ${who}Цифра ${it.pos + 1}: ${it.digit}`, 'gold');
  }
  setObjective();
}
function taskDone() {
  const T = game.task || { kind: 'exit' };
  if (T.kind === 'exit') return true;
  if (T.kind === 'key') return pl.hasKey;
  if (T.kind === 'code') return !!game.codeOK;
  return game.parts >= T.n;
}
function doorLabel() {
  const T = game.task || { kind: 'exit' };
  if (taskDone()) return T.kind === 'fuse' ? 'Вставить предохранители и открыть' : T.kind === 'ticket' ? 'Показать билеты и выйти' : 'Открыть дверь';
  if (T.kind === 'key') return 'Заперто: нужна ключ-карта';
  if (T.kind === 'code') return 'Ввести код';
  if (T.kind === 'fuse') return `Щиток пуст: предохранители ${game.parts}/${T.n}`;
  if (T.kind === 'ticket') return `Нужны билеты: ${game.parts}/${T.n}`;
  if (T.kind === 'valve') return `Заперто: вентили ${game.parts}/${T.n}`;
  return `Нет тока: рубильники ${game.parts}/${T.n}`;
}
function updateInteract() {
  let a = null;
  if (pl.hidden) { setAct({ type: 'unhide', label: 'Выйти из шкафчика' }); return; }
  for (const it of lvl.items) {
    if (it.taken || it.type !== 'note') continue;
    if (Math.hypot(it.x - pl.x, it.z - pl.z) < 1.5) { a = { type: 'note', it, label: 'Читать записку' }; break; }
  }
  if (!a) {
    const d = nearestExit();
    if (d && Math.hypot(d.x - pl.x, d.z - pl.z) < 1.9) {
      const ok = taskDone(), code = !ok && game.task && game.task.kind === 'code';
      a = { type: 'door', ok: ok || code, label: doorLabel() };
    }
  }
  if (!a && game.ex) for (const it of game.ex.items) {
    if (it.taken || (it.type !== 'valve' && it.type !== 'lever')) continue;
    if (Math.hypot(it.x - pl.x, it.z - pl.z) < 1.25) { a = { type: 'part', it, label: it.type === 'valve' ? 'Перекрыть вентиль' : 'Включить рубильник' }; break; }
  }
  if (!a && game.ex) for (const an of game.ex.anoms) {
    if (an.used || !['phone', 'tv', 'door', 'bed'].includes(an.kind)) continue;
    if (Math.hypot(an.ax - pl.x, an.az - pl.z) < 1.5) { a = { type: 'anom', an, label: { phone: 'Ответить на звонок', tv: 'Выключить телевизор', door: 'Постучать в ответ', bed: 'Прилечь отдохнуть' }[an.kind] }; break; }
  }
  if (!a) {
    let best = null, bd = 0.95;
    for (const lk of lvl.lockers) { const d = Math.hypot(lk.x + lk.fx * 0.72 - pl.x, lk.z + lk.fz * 0.72 - pl.z); if (d < bd) { bd = d; best = lk; } }
    if (best) a = { type: 'locker', lk: best, label: 'Спрятаться в шкафчике' };
  }
  setAct(a);
}
let lastAct = '';
function setAct(a) {
  game.act = a;
  const key = a ? a.type + a.label : '';
  if (key === lastAct) return;
  lastAct = key;
  const p = $('prompt');
  if (a) { p.textContent = (isTouch ? '' : '[E] ') + a.label; p.classList.add('on'); p.classList.toggle('bad', a.type === 'door' && !a.ok); }
  else p.classList.remove('on');
  $('bAct').classList.toggle('on', !!a);
  $('cross').classList.toggle('act', !!a);
}
function doAct() {
  const a = game.act; if (!a || game.mode !== 'play') return;
  if (a.type === 'note') openNote(a.it);
  else if (a.type === 'locker') hideIn(a.lk);
  else if (a.type === 'unhide') unhide();
  else if (a.type === 'door') {
    if (taskDone()) { if (game.coop && !game.coop.host) { net.send(hostId(), { t: 'door' }); toast('🚪 Открываем дверь…'); } else exitLevel(); }
    else if (game.task && game.task.kind === 'code') openKeypad();
    else { sound.locked(); vib(80); toast(doorLabel()); }
  }
  else if (a.type === 'part') {
    const it = a.it; pl.actT = 1.2; game.actIt = it; it.anim = 1.2; pl.burst = 1.2;
    if (it.type === 'valve') sound.valve(it.wx, it.wz); else sound.lever(it.wx, it.wz);
  }
  else if (a.type === 'anom') useAnom(a.an);
}
function toggleLight() {
  if (game.mode !== 'play') return;
  if (pl.bat <= 0) { toast('🔋 Фонарик сел. Найди батарейку.'); return; }
  if (pl.hidden) return;
  pl.light = !pl.light; sound.click();
  $('bLight').classList.toggle('on', pl.light);
}

// ---------- шкафчики ----------
function hideIn(lk) {
  // Он «знает», только если прямо сейчас видит, как ты залезаешь (не сквозь стены и не по памяти)
  const knows = !!(ent && ent.active && ent.seeMeT < 0.4 && ent.dist < 20 && lvl.los(ent.x, ent.z, pl.x, pl.z));
  pl.hidden = { lk, knows, near: false, bt: 2, t: 0 };
  pl.x = lk.x - lk.fx * 0.02; pl.z = lk.z - lk.fz * 0.02; pl.vx = pl.vz = 0;
  lk.want = 1; setTimeout(() => { if (pl.hidden && pl.hidden.lk === lk) lk.want = 0; }, 260);
  if (knows) whisper(tr('lock.seen'), 2600);
  pl.hideYaw = Math.atan2(-lk.fx, -lk.fz); pl.yaw = pl.hideYaw; pl.pitch = 0;
  if (pl.light) { pl.light = false; $('bLight').classList.remove('on'); }
  show('slats'); sound.lockerIn(); vib(30);
}
function unhide() {
  const lk = pl.hidden.lk; pl.hidden = null;
  pl.x = lk.x + lk.fx * 0.85; pl.z = lk.z + lk.fz * 0.85;
  lk.want = 1; setTimeout(() => { if (!pl.hidden || pl.hidden.lk !== lk) lk.want = 0; }, 650);
  hide('slats'); sound.lockerOut();
}

// ---------- записки ----------
function openNote(it) {
  it.taken = true; it.obj.visible = false;
  if (game.coop) game.overlay = true; else game.mode = 'reading';
  setAct(null); unlockPointer();
  const n = NOTES[it.id];
  $('rTitle').textContent = n.t; $('rBody').textContent = n.b;
  show('reader');
  sound.paper(); game.notesLv++;
  if (!SAVE.notes.includes(it.id)) { SAVE.notes.push(it.id); persist(); }
  if (SAVE.notes.length >= NOTES.length) unlock('archive');
}
function closeNote() { hide('reader'); game.overlay = false; if (game.mode === 'reading') game.mode = 'play'; }

// ---------- события ----------
function farPoint(a, b) {
  for (let k = 0; k < 24; k++) {
    const i = lvl.floorList[(Math.random() * lvl.floorList.length) | 0];
    const x = (i % lvl.mw + 0.5) * S, z = (((i / lvl.mw) | 0) + 0.5) * S, d = Math.hypot(x - pl.x, z - pl.z);
    if (d >= a && d <= b) return { x, z };
  }
  return null;
}
function ambientEvents(dt) {
  game.evT -= dt;
  if (game.evT <= 0) {
    game.evT = 7 + Math.random() * 11;
    const p = farPoint(8, 22), k = Math.random();
    if (k < 0.12) { sound.breathBehind(pl.x + Math.sin(pl.yaw) * 1.2, pl.z + Math.cos(pl.yaw) * 1.2); return; }
    if (k < 0.2) { sound.whisperEar(); whisper(pick(WHISPERS), 2200); return; }
    const q = farPoint(4, 9);
    if (k < 0.3 && q) { sound.scratch(q.x, q.z); return; }
    if (k < 0.4 && p && q) { sound.runSteps(p.x, p.z, q.x, q.z); return; }
    if (k < 0.48 && p) { sound.screamFar(p.x, p.z); return; }
    if (p) {
      if (k < 0.25) sound.knock(p.x, p.z);
      else if (k < 0.5) sound.distantSteps(p.x, p.z);
      else if (k < 0.62) sound.slam(p.x, p.z);
      else if (k < 0.78) sound.creak(p.x, p.z);
      else { const l = lvl.flickerOne({ x: pl.x, z: pl.z }); if (l) sound.spark(l.x, l.z); else sound.knock(p.x, p.z); }
    }
  }
  if (game.th.props === 'puddles') {
    game.dripT -= dt;
    if (game.dripT <= 0) { game.dripT = 0.8 + Math.random() * 2.5; const p = farPoint(2, 9); if (p) sound.drip(p.x, p.z); }
  }
}
// ---------- страх: голоса, звуки рядом, засады, ужас в темноте ----------
function spotInView(dMin, dMax) {
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
  let d = 1, last = -1;
  while (d < dMax) {
    const x = pl.x + fx * d, z = pl.z + fz * d, t = lvl.tile(Math.floor(x / S), Math.floor(z / S));
    if (t !== 0 && t !== 6) break;
    if (d >= dMin) last = d;
    d += 0.5;
  }
  if (last < 0) return null;
  return { x: pl.x + fx * last, z: pl.z + fz * last };
}
function scares(dt, stared, safe) {
  const host = !game.coop || game.coop.host;
  // голос монстра
  if (ent && ent.active) {
    game.voiceT -= dt;
    if (game.voiceT <= 0) { game.voiceT = (ent.state === 'chase' ? 2.2 : 4) + Math.random() * 4; sound.voice(ent.kind, ent.x, ent.z, ent.state === 'chase'); }
  }
  // шарманка: играет и замолкает (для Марионетки)
  if (lvl.circus && host) {
    game.musicT -= dt;
    if (game.musicT <= 0) {
      game.musicOn = !game.musicOn; game.musicT = game.musicOn ? 11 + Math.random() * 9 : 4 + Math.random() * 3.5;
      if (!game.musicOn && ent && ent.active) { whisper('музыка стихла…', 2000); sound.voice('puppet', ent.x, ent.z, true); }
    }
  }
  if (!host || !ent || !ent.active || safe || pl.hidden) return;
  // засада: монстр резко появляется прямо перед тобой
  game.ambT -= dt;
  if (game.ambT <= 0 && ent.unseen > 8 && !stared && game.time > 25) {
    game.ambT = 38 + Math.random() * 35;
    const sp = spotInView(6.5, 12);
    if (sp && Math.random() < 0.75) jumpIn(sp);
  }
  // после темноты он уже стоит перед тобой
  if (game.afterBlack) {
    game.afterBlack = false;
    if (Math.random() < 0.4) { const sp = spotInView(7, 10); if (sp) jumpIn(sp); }
  }
  // в темноте: светящиеся глаза впереди и дыхание за спиной
  if (game.black && !game.blackGhost && ghost && game.bkT < 3.2) {
    game.blackGhost = true;
    const sp = spotInView(4.5, 8);
    if (sp) { ghost.group.position.set(sp.x, 0, sp.z); ghost.group.rotation.y = Math.atan2(pl.x - sp.x, pl.z - sp.z); ghost.group.visible = true; game.ghostT = 1.3; }
    const bx = pl.x + Math.sin(pl.yaw) * 1.1, bz = pl.z + Math.cos(pl.yaw) * 1.1;
    sound.breathBehind(bx, bz);
  }
}
function jumpIn(sp) {
  ent.appear(sp.x, sp.z, pl.x, pl.z);
  sound.hit(); vib([80, 40, 160]);
  game.shakeT = 0.6;
  U.uRed.value = 0.6; U.uAb.value = 2.2; U.uWhite.value = 0.12;
}
function hallucinate() {
  if (!ghost || (ent && ent.dist < 10)) return;
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
  let d = 1;
  while (d < 16) { if (lvl.tile(Math.floor((pl.x + fx * d) / S), Math.floor((pl.z + fz * d) / S)) !== 0) break; d += 0.25; }
  if (d < 7) return;
  const gd = d - 0.9;
  ghost.group.position.set(pl.x + fx * gd, 0, pl.z + fz * gd);
  ghost.group.rotation.y = Math.atan2(-fx, -fz);
  ghost.group.visible = true; game.ghostT = 0.35;
  sound.whisper();
}
let whTimer = 0;
const EMO = /(\p{Extended_Pictographic}|\p{Regional_Indicator})(\uFE0F|\u200D\p{Extended_Pictographic})*\s*/gu;
const plain = (t) => String(t).replace(EMO, '').replace(/\s{2,}/g, ' ').trim();
function whisper(text, ms = 2600) {
  text = plain(text);
  const w = $('whisper'); w.textContent = text; w.style.top = (30 + Math.random() * 20) + '%'; w.classList.add('on');
  clearTimeout(whTimer); whTimer = setTimeout(() => w.classList.remove('on'), ms);
}
function toast(text, cls = '') {
  if (cls !== 'chat' && cls !== 'pink') text = plain(text);
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = text;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), 3400);
}
function unlock(id) {
  if (SAVE.ach.includes(id)) return;
  SAVE.ach.push(id); persist();
  const a = ACH.find((x) => x.id === id);
  if (a) { toast(`Достижение: ${a.name}`, id === 'secret' ? 'pink' : 'gold'); sound.ach(); }
}
function foundSecret(kind) {
  const S_ = SECRETS[kind] || SECRETS.love;
  unlock(S_.ach);
  sound.secret();
  const b = $('bigmsg'); b.querySelector('b').textContent = S_.ic; b.querySelector('span').textContent = S_.title;
  b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 4200);
}

// ---------- игровой кадр ----------
function updatePlay(dt) {
  const th = game.th, D = DIFF[game.diff] || DIFF.normal;
  game.time += dt; game.runTime += dt;
  pl.wake = Math.min(1, pl.wake + dt / 2.4);
  updatePlayer(dt, pl.wake > 0.45);
  updateTools(dt);
  const P = lights(dt, true);
  updateLampLights(dt, P);
  const ptile = lvl.tile(Math.floor(pl.x / S), Math.floor(pl.z / S));
  const safe = ptile === 3 || ptile === 4 || !!(pl.hidden && !pl.hidden.knows);
  if (ptile === 4 && !game.secretSeen) { game.secretSeen = true; foundSecret(lvl.secret ? lvl.secret.kind : 'love'); }
  for (const it of lvl.items) {
    if (it.taken || it.type === 'note' || it.type === 'valve' || it.type === 'lever') continue;
    if (it.type === 'clue') { if (Math.hypot(it.wx - pl.x, it.wz - pl.z) < 6 && seesPoint(it.wx, 1.35, it.wz, 0.75) && lvl.los(pl.x, pl.z, it.x, it.z)) take(it); continue; }
    if (Math.hypot(it.x - pl.x, it.z - pl.z) < 0.95) take(it);
  }
  let stared = false;
  pl.safe = safe;
  if (ent) {
    stared = checkStare(); pl.stare = stared;
    if (game.coop && !game.coop.host) ent.remote(dt, game.netEnt, pl.x, pl.z);
    else if (entTick(dt, stared)) return;
  }
  const eD = ent && ent.active ? ent.dist : 99;
  game.prox = clamp(1 - eD / 9, 0, 1);
  if (stared) { game.stare += dt; if (game.stare >= 5) unlock('stare'); } else game.stare = 0;
  updateLockers(lvl.lockers, dt);
  if (pl.hidden) {
    pl.hidden.t += dt;
    // знал, но потерял интерес (сдался или ушёл далеко) — снова в безопасности
    if (pl.hidden.knows && ent && (ent.state === 'roam' || ent.dist > 25)) pl.hidden.knows = false;
    if (!pl.hidden.knows && eD < 6) pl.hidden.near = true;
    if (pl.hidden.near && eD > 12) { unlock('hide'); pl.hidden.near = false; }
    pl.hidden.bt -= dt; if (pl.hidden.bt <= 0) { pl.hidden.bt = 2.6 + Math.random(); sound.breath(); }
  }
  let drain = (0.3 + game.level * 0.04) * D.drain;
  if (eD < 9) drain += (9 - eD) * 0.3 * D.drain * (ent && ent.ai.drain ? ent.ai.drain : 1);
  if (stared) drain += 2.2 * D.drain;
  if (game.black) drain += 1.0 * D.drain;
  // в шкафчике рассудок тает как обычно: без доплаты за укрытие и за выключенный фонарик (он там недоступен)
  if (!pl.light && P < 0.3 && !pl.hidden) drain += 0.4;
  if (ptile === 3 || ptile === 4) drain = -4;
  pl.san = clamp(pl.san - drain * dt, 0, 100);
  game.minSan = Math.min(game.minSan, pl.san);
  if (pl.san <= 0 && !game.god) { die('san'); return; }
  if (pl.light) {
    pl.bat = Math.max(0, pl.bat - 0.75 * dt * (ent && ent.lit && ent.ai.fear ? 3 : 1));
    if (pl.bat <= 0) { pl.light = false; $('bLight').classList.remove('on'); sound.click(); toast('🔋 Фонарик сел'); }
  }
  let fI = pl.light ? 6.5 : 0;
  if (game.black && game.bkFl > 0) { game.bkFl -= dt; fI *= Math.random() < 0.5 ? 0 : 1; }
  if (ent && ent.ai.shadow) ent.setVisibility(game.black || pl.nv ? 1 : (stared && pl.light ? 0.55 : 0.16));
  if (pl.light && pl.bat < 15 && Math.random() < 0.12) fI *= 0.15;
  flash.intensity = fI;
  if (eD < 10 || game.black) { game.hbT -= dt; if (game.hbT <= 0) { sound.heart(); game.hbT = game.black ? 0.55 : 0.36 + eD * 0.09; } }
  updateZone(dt);
  updateFindsPlay(dt);
  ambientEvents(dt);
  scares(dt, stared, safe);
  if (pl.san < 45) { game.halT -= dt; if (game.halT <= 0) { game.halT = 10 + Math.random() * 16; hallucinate(); } }
  if (game.ghostT > 0) { game.ghostT -= dt; if (game.ghostT <= 0 && ghost) ghost.group.visible = false; }
  game.whT -= dt * (pl.san < 35 ? 2.5 : 1);
  if (game.whT <= 0) { game.whT = 16 + Math.random() * 18; whisper(pick(WHISPERS)); sound.whisper(); }
  game.lampFT -= dt;
  if (game.lampFT <= 0) { game.lampFT = 2 + Math.random() * 5; lvl.flickerOne(); }
  lvl.setKeypad(taskDone(), tAll);
  lvl.update(dt, tAll, P, game.black ? 0.45 : 0.6);
  { const fk = Math.min(1, dt * 3), tc = game.black ? 0 : 1; game.fogK = (game.fogK ?? 1) + (tc - (game.fogK ?? 1)) * fk;
    scene.fog.color.setHex(th.fog).multiplyScalar(game.fogK); scene.fog.density = th.fogD * (1.6 - 0.6 * game.fogK); }
  updateInteract();
  applyCamera(dt);
  updateWristMap(dt);
  if (!dust && lvl.glowT) { dust = makeDust(lvl.glowT); scene.add(dust.pts); }
  if (dust) { dust.m.map = lvl.glowT; updateDust(dust, camera.position, tAll, game.black ? 0.05 : P * (pl.light ? 1.2 : 1), (lvl.HH || 2.7) - 0.1); }
  // эффекты
  const ls = clamp((60 - pl.san) / 60, 0, 1);
  setFX({
    uGrain: 0.035 + ls * 0.12 + game.prox * 0.15, uVig: 0.25 + ls * 0.7 + game.prox * 0.5,
    uAb: 0.03 + ls * 1.2 + game.prox * 1.6 + (stared ? 0.6 : 0), uDist: (pl.san < 30 ? (30 - pl.san) / 30 : 0) * 0.8 + game.prox * game.prox * 0.7,
    uRed: game.prox * 0.4 + (pl.san < 25 ? 0.12 + 0.12 * Math.sin(tAll * 6) : 0) + (game.chase ? 0.35 + 0.25 * Math.sin(tAll * 7) : 0), uSat: 1 - ls * 0.55, uFade: 0, uWhite: 0, uNV: pl.nv ? 1 : 0
  }, dt);
  hud();
}
// Мир хоста: «Оно» охотится на всех игроков (вызывается и когда сам хост мёртв)
function entTick(dt, stared) {
  const th = game.th, D = DIFF[game.diff] || DIFF.normal;
  const targets = [{ id: net.id || 'me', x: pl.x, z: pl.z, yaw: pl.yaw, safe: !!pl.safe, dead: game.mode !== 'play', noise: pl.noise, lit: !!pl.light, crouch: !!pl.crouch, mv: Math.hypot(pl.vx, pl.vz) }];
  let st = stared;
  if (game.coop) for (const [id, r] of rp) { if (!r.inLvl) continue; targets.push({ id, x: r.x, z: r.z, yaw: r.yaw, safe: !!r.safe, dead: !!r.dead, noise: r.noise || 0, lit: !!r.l, mv: 1 }); if (r.stare && !r.dead) st = true; }
  const lit = stared && pl.light && ent.dist < 14;
  const res = ent.update(dt, { targets, stared: st, lit, black: game.black, music: game.musicOn, moving: Math.hypot(pl.vx, pl.vz) > 0.5, force: game.chase, mul: th.entSpeed * D.speed * (game.chase ? 1.12 : 1) });
  if (res && res.kill) {
    if (res.kill === targets[0].id) { if (game.mode === 'play' && !game.god) { startScare(); return true; } }
    else { const r = rp.get(res.kill); if (r && !r.dead) { r.dead = true; net.send(res.kill, { t: 'caught', id: res.kill }); } }
  }
  return false;
}
function setFX(o, dt) {
  const k = dt ? Math.min(1, dt * 6) : 1;
  for (const key in o) U[key].value += (o[key] - U[key].value) * (key === 'uFade' || key === 'uWhite' ? 1 : k);
}

// ---------- HUD ----------
let lastClock = '';
function hud() {
  const sb = $('barSan'), bb = $('barBat'), tb = $('barSta');
  sb.querySelector('i').style.transform = `scaleX(${(pl.san / 100).toFixed(3)})`; sb.classList.toggle('low', pl.san < 30);
  bb.querySelector('i').style.transform = `scaleX(${(pl.bat / 100).toFixed(3)})`; bb.classList.toggle('low', pl.bat < 15);
  tb.querySelector('i').style.transform = `scaleX(${(pl.sta / 100).toFixed(3)})`; tb.classList.toggle('low', pl.tired); tb.classList.toggle('hide', pl.sta >= 99.5);
  const s = Math.floor(game.runTime), c = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  if (c !== lastClock) { $('hClock').textContent = c; lastClock = c; }
}
// ---------- выходы (их несколько, все ведут на следующий уровень) ----------
const exitsOf = () => (lvl && lvl.exits && lvl.exits.length ? lvl.exits : lvl ? [lvl.door] : []);
function nearestExit(x = pl.x, z = pl.z) { let b = null, bd = 1e9; for (const e of exitsOf()) { const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; b = e; } } return b; }
const exitSeen = (e) => !!game.seen[lvl.idx(e.x - e.nx * 0.5, e.z - e.nz * 0.5)] || game.exitKnown;

// ---------- сканер на руке и мини-карта ----------
let minimap = null;
function scanBlips() {
  const b = [];
  for (const it of lvl.items) {
    if (it.taken || !['key', 'fuse', 'ticket', 'valve', 'lever', 'clue', 'note', 'batt', 'water'].includes(it.type)) continue;
    b.push({ id: 'i' + (it.wx ?? it.x) + ',' + (it.wz ?? it.z), x: it.wx ?? it.x, z: it.wz ?? it.z, kind: 'item' });
  }
  for (const an of game.ex.anoms) if (!an.used) b.push({ id: 'a' + an.ax + ',' + an.az, x: an.ax, z: an.az, kind: 'anom' });
  for (const f of game.finds || []) if (!f.found) { const [x, z] = findPoint(f); b.push({ id: 'f' + f.kind, x, z, kind: 'find' }); }
  if (ent && ent.active) b.push({ id: 'ent', x: ent.x, z: ent.z, kind: 'ent' });
  return b;
}
function updateWristMap(dt) {
  const up = game.scanT > 0 && !pl.hidden && game.mode === 'play';
  poseWrist(wrist, dt, up, tAll, pl.bob || 0, camera.aspect);
  const sc = wrist.raise > 0.3; if (sc !== game.scanUI) { game.scanUI = sc; document.body.classList.toggle('scanning', sc); }
  if (wrist.root.visible) drawRadar(wrist, dt, tAll, pl.x, pl.z, pl.yaw, scanBlips());
  if (!minimap) minimap = createMinimap($('minimap'));
  trackTrail(minimap, pl.x, pl.z);
  minimap.t -= dt;
  if (minimap.t <= 0) {
    minimap.t = 1 / 15;
    drawMinimap(minimap, { lvl, seen: game.seen, px: pl.x, pz: pl.z, yaw: pl.yaw, finds: game.finds, exits: exitsOf().filter(exitSeen), solid: (tt) => tt === 1 || tt === 2 || tt === 5 });
    // звуковой маячок — у ближайшего выхода
    const ne = nearestExit(); if (ne && ne !== game.beaconAt) { game.beaconAt = ne; sound.setBeacon(ne.x, 1.6, ne.z); }
  }
}

// ---------- дивные находки ----------
function updateFindsPlay(dt) {
  if (!game.finds || !game.finds.length) return;
  updateFinds(game.finds, dt, tAll, pl);
  for (const f of game.finds) {
    const [px, pz] = findPoint(f), d = Math.hypot(px - pl.x, pz - pl.z);
    if (!f.found && f.group.visible && d < 9 && seesPoint(px, 1.2, pz, 0.8) && lvl.los(pl.x, pl.z, px, pz)) discoverFind(f);
    // процессия: рядом с ними тает рассудок и слышен шёпот
    if (f.kind === 'procession' && f.found && d < 3.5) {
      pl.san = Math.max(0, pl.san - dt * 2.2);
      f.whT = (f.whT || 0) - dt; if (f.whT <= 0) { f.whT = 6; sound.whisperEar(); }
    }
  }
}
function discoverFind(f) {
  f.found = true;
  SAVE.finds = SAVE.finds || [];
  const first = !SAVE.finds.includes(f.kind);
  if (first) { SAVE.finds.push(f.kind); persist(); }
  const bonus = FIND_KINDS[f.kind].san;
  pl.san = Math.min(100, pl.san + bonus);
  const zc = $('zoneCap');
  zc.querySelector('b').textContent = tr('find.' + f.kind);
  zc.querySelector('span').textContent = `${tr(first ? 'find.new' : 'find.found')} · +${bonus}% ${tr('hud.san')}`;
  zc.classList.remove('on'); void zc.offsetWidth; zc.classList.add('on');
  sound.find(); vib([30, 40, 30]);
}

// ---------- зоны открытого мира ----------
const zoneName = (z) => tr('zone.' + z.type);
function updateZone(dt) {
  game.zoneT = (game.zoneT || 0) - dt;
  if (game.zoneT > 0 || !lvl.zoneAt) return;
  game.zoneT = 0.25;
  const z = lvl.zoneAt(pl.x, pl.z);
  if (!z || z.id === game.zoneId) return;
  const first = game.zoneId === undefined || game.zoneId === null;
  game.zoneId = z.id; game.zone = z;
  hudStatic();
  game.zonesSeen = game.zonesSeen || new Set();
  const fresh = !game.zonesSeen.has(z.id); game.zonesSeen.add(z.id);
  const zc = $('zoneCap');
  zc.querySelector('b').textContent = zoneName(z);
  zc.querySelector('span').textContent = (fresh && !first ? tr('zone.new') + ' · ' : '') + tr('zone.sector') + ' ' + z.code;
  zc.classList.remove('on'); void zc.offsetWidth; zc.classList.add('on');
  if (fresh && !first) sound.zone();
}
function hudStatic() {
  const zn = game.zone ? ` · ${zoneName(game.zone)} ${game.zone.code}` : '';
  $('hLv').textContent = `УР. ${game.level} · ${game.th.name.toUpperCase()}${zn}`;
  $('hKey').hidden = !pl.hasKey || game.chase;
  const total = game.level <= LAST ? notesFor(game.level).length : 0;
  $('hNotes').textContent = total ? `ЗАПИСКИ ${game.notesLv}/${total}` : '';
  $('bLight').classList.toggle('on', pl.light);
}
function setObjective() {
  const T = game.task || { kind: 'exit' };
  let t = '🚪 Найди выход';
  if (game.chase) t = '🏃 БЕГИ К ВЫХОДУ!';
  else if (!taskDone()) {
    if (T.kind === 'key') t = '🗝 Найди ключ-карту';
    else if (T.kind === 'fuse') t = `🔌 Предохранители ${game.parts}/${T.n}`;
    else if (T.kind === 'ticket') t = `🎟 Билеты ${game.parts}/${T.n}`;
    else if (T.kind === 'valve') t = `🔧 Вентили ${game.parts}/${T.n}`;
    else if (T.kind === 'lever') t = `⚡ Рубильники ${game.parts}/${T.n}`;
    else if (T.kind === 'code') t = '🔢 Код: ' + game.ex.code.digits.map((d, i) => (game.ex.code.known[i] ? d : '_')).join(' ');
  } else if (T.kind === 'fuse') t = '🚪 Вставь предохранители в щиток у выхода';
  else if (T.kind === 'ticket') t = '🚪 Покажи билеты у выхода';
  else if (T.kind === 'code' && !game.codeOK) t = '🚪 Введи код у выхода';
  t = plain(t);
  const o = $('obj');
  if (o.textContent !== t) { o.textContent = t; o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }
  hudStatic();
}

// ---------- инструменты: сканер, ЭМИ, карта, метки, присед, камера ----------
const tvp = new THREE.Vector3();
function seesPoint(x, y, z, lim = 0.9) {
  tvp.set(x, y, z).project(camera);
  return tvp.z < 1 && Math.abs(tvp.x) < lim && Math.abs(tvp.y) < lim;
}
function syncTools() {
  $('tCrouch').classList.toggle('on', pl.crouch);
  $('tNV').classList.toggle('on', pl.nv);
  $('tEmp').classList.toggle('off', pl.emp <= 0);
  $('tEmp').dataset.n = pl.emp > 0 ? pl.emp : '';
  $('tScan').classList.toggle('off', pl.scanCD > 0);
  $('tMap').classList.toggle('on', !!game.mapOpen);
}
function toolScan() {
  if (game.mode !== 'play' || pl.scanCD > 0 || pl.hidden) return;
  if (pl.bat < 8) { toast('Сканеру не хватает заряда'); return; }
  pl.scanCD = 25; game.scanT = 4.2; pl.burst = 3; pl.bat = Math.max(0, pl.bat - 8);
  sound.scan(); vib(20);
  const box = $('scanLayer'); box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
  buildScanMarks();
  syncTools();
  if (!SAVE.scanTip) { SAVE.scanTip = 1; persist(); toast('Сканер ловит только то, что рядом. И его писк слышно издалека'); }
}
// сканер ловит только электромагнитный «шум» рядом: части задания, аномалии и Его. Без значков и расстояний.
function buildScanMarks() {
  const box = $('scanLayer'); box.querySelectorAll('.sm').forEach((e) => e.remove());
  const marks = [];
  const addM = (x, y, z, cls) => { const e = document.createElement('div'); e.className = 'sm ' + cls; box.appendChild(e); marks.push({ x, y, z, e, jx: 0, jy: 0 }); };
  const R = 16;
  const near = (x, z) => Math.hypot(x - pl.x, z - pl.z) < R;
  for (const it of lvl.items) {
    if (it.taken || !['key', 'fuse', 'ticket', 'valve', 'lever', 'clue'].includes(it.type)) continue;
    const x = it.wx ?? it.x, z = it.wz ?? it.z;
    if (near(x, z)) addM(x, 1, z, 'task');
  }
  for (const an of game.ex.anoms) if (!an.used && near(an.ax, an.az)) addM(an.ax, 1.2, an.az, 'anom');
  if (ent && ent.active && ent.dist < R) addM(ent.x, 1.6, ent.z, 'ent');
  game.scanMarks = marks;
}
function updateScan(dt) {
  if (pl.scanCD > 0) { pl.scanCD -= dt; if (pl.scanCD <= 0) syncTools(); }
  if (game.scanT <= 0) return;
  game.scanT -= dt;
  const W = innerWidth, H = innerHeight, op = Math.min(1, game.scanT / 0.8) * (0.55 + Math.random() * 0.45);
  for (const m of game.scanMarks || []) {
    tvp.set(m.x, m.y, m.z).project(camera);
    let x = tvp.x, y = tvp.y;
    if (tvp.z > 1) { m.e.style.opacity = '0'; continue; }
    if (Math.random() < 0.2) { m.jx = (Math.random() - 0.5) * 18; m.jy = (Math.random() - 0.5) * 18; }
    x = clamp(x, -0.95, 0.95); y = clamp(y, -0.92, 0.92);
    m.e.style.transform = `translate(${((x + 1) / 2 * W + m.jx).toFixed(0)}px,${((1 - y) / 2 * H + m.jy).toFixed(0)}px)`;
    m.e.style.opacity = op.toFixed(2);
  }
  if (game.scanT <= 0) $('scanLayer').querySelectorAll('.sm').forEach((e) => e.remove());
}
function toolEmp() {
  if (game.mode !== 'play' || pl.hidden) return;
  if (pl.emp <= 0) { toast('ЭМИ разряжен. Он одноразовый на уровень'); return; }
  pl.emp--; syncTools();
  sound.emp(); vib([30, 30, 90]);
  U.uWhite.value = 0.55; U.uAb.value = 3;
  lvl.flickerOne({ x: pl.x, z: pl.z });
  if (pl.light) { game.bkFl = 0.5; }
  if (game.coop && !game.coop.host) net.send(hostId(), { t: 'emp', x: pl.x, z: pl.z });
  else empAt(pl.x, pl.z, true);
}
function empAt(x, z, mine) {
  if (!ent || !ent.active) return;
  const d = Math.hypot(ent.x - x, ent.z - z);
  if (d < 9) { ent.stunT = 3.5; sound.zap(ent.x, ent.z); if (mine) { toast('Оно оглушено. Три секунды', 'gold'); unlock('emp'); } }
  else if (mine) toast('Импульс ушёл в пустоту');
}
function toolMark() {
  if (game.mode !== 'play' || pl.hidden) return;
  const x = pl.x - Math.sin(pl.yaw) * 0.6, z = pl.z - Math.cos(pl.yaw) * 0.6, yaw = pl.yaw;
  addMark(game.ex, x, z, yaw, 0.012 + Math.max(0, lvl.groundY(x, z)));
  sound.chalk();
  if (game.coop) { if (game.coop.host) net.broadcast({ t: 'mark', x, z, yaw }); else net.send(hostId(), { t: 'mark', x, z, yaw }); }
}
function toolCrouch() {
  if (game.mode !== 'play' || pl.hidden) return;
  pl.crouch = !pl.crouch; sound.crouch(pl.crouch); syncTools();
}
function toolNV() {
  if (game.mode !== 'play' || pl.hidden) return;
  if (!pl.nv && pl.bat <= 2) { toast('🔋 Камере не хватает заряда'); return; }
  pl.nv = !pl.nv; sound.nv(pl.nv); syncTools();
  if (pl.nv && !SAVE.nvTip) { SAVE.nvTip = 1; persist(); toast('📹 Ночное видение: видно в темноте, но садит батарею'); }
}
function toolMap() {
  if (game.mode !== 'play') return;
  game.mapOpen = !game.mapOpen;
  if (game.mapOpen) { show('mapBox'); drawMap(); } else hide('mapBox');
  syncTools();
}
function updateSeen(dt) {
  game.seenT -= dt; if (game.seenT > 0) return; game.seenT = 0.25;
  const ptx = Math.floor(pl.x / S), ptz = Math.floor(pl.z / S), R = 6;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const tx = ptx + dx, tz = ptz + dz; if (tx < 0 || tz < 0 || tx >= lvl.mw || tz >= lvl.mh || dx * dx + dz * dz > R * R) continue;
    const i = tz * lvl.mw + tx; if (game.seen[i]) continue;
    const t = lvl.tile(tx, tz);
    const cx = (tx + 0.5) * S, cz = (tz + 0.5) * S;
    if (t === 0 || t === 6) { if (lvl.los(pl.x, pl.z, cx, cz)) game.seen[i] = 1; }
    else if (Math.abs(dx) + Math.abs(dz) <= 1 || lvl.los(pl.x, pl.z, cx - Math.sign(dx) * S * 0.55, cz - Math.sign(dz) * S * 0.55)) game.seen[i] = 1;
  }
  if (game.mapOpen) drawMap();
}
function drawMap() {
  const c = $('mapC'), L = lvl, W = L.mw, H = L.mh;
  const k = Math.max(3, Math.floor(Math.min((innerWidth * 0.82) / W, (innerHeight * 0.7) / H)));
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (c.width !== W * k * dpr || c.height !== H * k * dpr) { c.width = W * k * dpr; c.height = H * k * dpr; c.style.width = W * k + 'px'; c.style.height = H * k + 'px'; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#0c0b08'; x.fillRect(0, 0, W * k, H * k);
  for (let tz = 0; tz < H; tz++) for (let tx = 0; tx < W; tx++) {
    const i = tz * W + tx; if (!game.seen[i]) continue;
    const t = L.tile(tx, tz);
    x.fillStyle = t === 0 ? '#c9b46a' : t === 6 ? '#5a9ad0' : t === 5 ? '#6a5a3a' : t === 2 ? '#2fd06a' : '#3a3424';
    x.fillRect(tx * k, tz * k, k, k);
  }
  const dot = (wx, wz, col, r = 0.35) => { x.fillStyle = col; x.beginPath(); x.arc(wx / S * k, wz / S * k, Math.max(2, k * r), 0, 7); x.fill(); };
  for (const e of exitsOf()) if (exitSeen(e)) { x.fillStyle = '#2fd06a'; x.fillRect(e.x / S * k - k * 0.45, e.z / S * k - k * 0.45, k * 0.9, k * 0.9); }
  for (const m of game.ex.marks) { x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); const mx = m.x / S * k, mz = m.z / S * k; x.moveTo(mx, mz); x.lineTo(mx - Math.sin(m.yaw) * k * 0.6, mz - Math.cos(m.yaw) * k * 0.6); x.stroke(); }
  for (const it of L.items) {
    if (it.taken && it.type !== 'valve' && it.type !== 'lever') continue;
    const wx = it.wx ?? it.x, wz = it.wz ?? it.z;
    if (!game.seen[L.idx(it.x, it.z)]) continue;
    const col = { key: '#5fe8ff', fuse: '#ff9a3c', ticket: '#ff7ab8', valve: it.taken ? '#33ff77' : '#ff4433', lever: it.taken ? '#33ff77' : '#ff4433', clue: '#ff4040', water: '#66c8ff', batt: '#ffd23a', note: '#fff1c8' }[it.type];
    if (col) dot(wx, wz, col, 0.3);
  }
  for (const an of game.ex.anoms) if (an.found) dot(an.ax, an.az, '#c58cff', 0.32);
  if (game.coop) for (const r of rp.values()) if (r.inLvl) dot(r.x, r.z, r.col || '#ff6f9a', 0.4);
  // игрок: стрелка
  const px = pl.x / S * k, pz = pl.z / S * k, a = pl.yaw;
  x.fillStyle = '#ff3b30'; x.beginPath();
  x.moveTo(px - Math.sin(a) * k * 0.9, pz - Math.cos(a) * k * 0.9);
  x.lineTo(px - Math.sin(a + 2.5) * k * 0.6, pz - Math.cos(a + 2.5) * k * 0.6);
  x.lineTo(px - Math.sin(a - 2.5) * k * 0.6, pz - Math.cos(a - 2.5) * k * 0.6); x.fill();
}

// ---------- погоня ----------
function startChase() {
  if (game.chase) return;
  game.chase = true; game.chaseT = 0;
  sound.alarm(3); sound.hit(); vib([100, 50, 200]);
  bigText('', 'БЕГИ');
  setObjective();
  if (ent && (!game.coop || game.coop.host)) {
    if (!ent.active) { ent.spawn(pl.x, pl.z); }
    // ставим его позади, но не вплотную
    const L = lvl, f = L.bfs(Math.floor(pl.x / S), Math.floor(pl.z / S)), c = [];
    for (let i = 0; i < f.length; i++) if (f[i] >= 7 && f[i] <= 10) c.push(i);
    if (c.length) ent.place(c[(Math.random() * c.length) | 0]);
    ent.state = 'chase'; ent.mem = 99;
  }
}
function bigText(ic, t) { const b = $('bigmsg'); b.querySelector('b').textContent = ic; b.querySelector('span').textContent = t; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 2600); }

// ---------- кодовый замок ----------
let kpVal = '';
function openKeypad() {
  if (game.codeOK) return;
  kpVal = ''; renderKeypad(); show('keypad'); game.kpOpen = true;
}
function closeKeypad(silent) { hide('keypad'); game.kpOpen = false; }
function renderKeypad() {
  const n = (game.task && game.task.n) || 4;
  $('kpDisp').textContent = (kpVal + '_'.repeat(n)).slice(0, n).split('').join(' ');
}
function kpPress(k) {
  const n = game.task.n || 4;
  if (k === 'x') { kpVal = kpVal.slice(0, -1); sound.key0(); renderKeypad(); return; }
  if (k === 'ok' || kpVal.length >= n) {
    if (kpVal.length < n) return;
    if (kpVal === game.ex.code.digits.join('')) {
      sound.beep(true); closeKeypad(); codeSolved(null);
      if (game.coop) { if (game.coop.host) net.broadcast({ t: 'codeok' }); else net.send(hostId(), { t: 'code', v: kpVal }); }
    } else {
      sound.beep(false); vib(120); pl.burst = 2.5; kpVal = '';
      $('kpDisp').classList.add('bad'); setTimeout(() => $('kpDisp').classList.remove('bad'), 500);
      renderKeypad(); toast('❌ Неверный код. Писк слышно далеко…');
    }
    return;
  }
  kpVal += k; sound.key0(); renderKeypad();
  if (kpVal.length >= n) setTimeout(() => kpPress('ok'), 180);
}
function codeSolved(by) {
  if (game.codeOK) return;
  game.codeOK = true; toast('🔓 ' + (by ? nameOf(by) + ' ввёл код. ' : '') + 'Замок открыт!', 'gold'); setObjective();
}

// ---------- аномалии ----------
function updateAnoms(dt) {
  const ex = game.ex; if (!ex) return;
  updateExtras(ex, dt, tAll, { px: pl.x, pz: pl.z, sees: (x, y, z) => seesPoint(x, y, z, 0.95) && lvl.los(pl.x, pl.z, x, z), walk: (x, z) => !blocked(x, z) });
  game.anomT -= dt;
  const tick = game.anomT <= 0; if (tick) game.anomT = 0.35;
  for (const an of ex.anoms) {
    const d = Math.hypot(an.ax - pl.x, an.az - pl.z);
    if (!an.found && tick && d < 7 && seesPoint(an.obj.position.x, 1, an.obj.position.z, 0.7) && lvl.los(pl.x, pl.z, an.ax, an.az)) discoverAnom(an);
    an.sT = (an.sT ?? 2) - dt;
    if (an.sT <= 0 && !an.used) {
      if (an.kind === 'phone' && d < 22) { sound.ring(an.ax, an.az); an.sT = 3; }
      else if (an.kind === 'door' && d < 9) { sound.knock(an.ax, an.az, 3); an.sT = 5 + Math.random() * 4; }
      else if (an.kind === 'clock' && d < 10) { sound.tick(an.ax, an.az); an.sT = 1 - Math.min(0.6, an.t * 0.004); }
      else an.sT = 1;
    }
    if (an.kind === 'mannequin' && !an.used && d < 1.8) { an.used = true; an.obj.visible = false; whisper('он стоял прямо за тобой', 2500); sound.whisperEar(); if (!an.found) discoverAnom(an); }
    if (an.kind === 'tv' && !an.used && d < 4) pl.san = Math.max(0, pl.san - dt * 0.8);
  }
}
function discoverAnom(an) {
  an.found = true;
  const A = ANOMS[an.kind];
  const isNew = !SAVE.anom.includes(an.kind);
  if (isNew) { SAVE.anom.push(an.kind); persist(); }
  toast(`Аномалия: ${A.name.toLowerCase()}${isNew ? '. Записано в журнал' : ''}`, 'anom');
  if (SAVE.anom.length >= ANOM_KEYS.length) unlock('anom');
}
function useAnom(an) {
  an.used = true;
  if (an.kind === 'phone') {
    sound.phoneVoice();
    // голос говорит только сторону, куда идти, и то не всегда правду
    const ne = nearestExit(), dx = ne.x - pl.x, dz = ne.z - pl.z, a = angleDiff(pl.yaw, Math.atan2(-dx, -dz));
    let side = Math.abs(a) < 0.8 ? 'прямо' : Math.abs(a) > 2.3 ? 'назад' : a > 0 ? 'налево' : 'направо';
    if (Math.random() < 0.25) side = pick(['прямо', 'назад', 'налево', 'направо']);
    whisper(`…иди ${side}… не оборачивайся…`, 4200);
  } else if (an.kind === 'tv') {
    an.screen.material.color.setRGB(0.02, 0.02, 0.02); an.light.intensity = 0; pl.san = Math.min(100, pl.san + 15); sound.click(); toast('📺 Тишина. Рассудок +15%');
  } else if (an.kind === 'door') {
    sound.knock(an.ax, an.az, 2);
    setTimeout(() => { if (!lvl) return; sound.knock(an.ax, an.az, 5); sound.voice('grinner', an.ax, an.az, true); an.obj.visible = false; whisper('теперь он знает, что ты здесь', 3000); pl.burst = 2; }, 1400);
  } else if (an.kind === 'bed') {
    U.uFade.value = 1; pl.actT = 2.2; setTimeout(() => { pl.san = Math.min(100, pl.san + 35); pl.sta = 100; toast('🛏 Рассудок +35%. Но кровать скрипела…'); }, 1800);
    if (ent && ent.active && (!game.coop || game.coop.host)) ent.relocate(pl.x, pl.z, pl.yaw);
  }
  if (!an.found) discoverAnom(an);
}
function updateTools(dt) {
  if (pl.actT > 0) {
    pl.actT -= dt;
    if (pl.actT <= 0 && game.actIt) { const it = game.actIt; game.actIt = null; take(it); }
  }
  if (pl.nv) { pl.bat = Math.max(0, pl.bat - 2.4 * dt); if (pl.bat <= 0) { pl.nv = false; syncTools(); toast('🔋 Камера села'); } }
  if (game.chase) {
    game.chaseT += dt;
    if (Math.floor(game.chaseT / 3) !== Math.floor((game.chaseT - dt) / 3)) sound.alarm(1.2);
  }
  updateScan(dt); updateSeen(dt); updateAnoms(dt);
}

// ---------- уровни ----------
let busy = false;
async function startLevel(lv, fresh = false, opt = {}) {
  if (busy) { game.pending = [lv, fresh, opt]; return; }
  busy = true;
  const seed = opt.seed || ((Math.random() * 2147483646) | 0) + 1;
  game.diff = opt.diff || SAVE.set.diff;
  if (game.coop && game.coop.host) net.broadcast({ t: 'start', lv, seed, diff: game.diff, fresh });
  game.overlay = false;
  game.mode = 'loading'; setAct(null); hideHUD(); unlockPointer();
  hideAllPanels();
  const th = theme(lv);
  $('cNum').textContent = lv <= LAST ? `УРОВЕНЬ ${lv} / ${LAST}` : `УРОВЕНЬ ${lv} · БЕСКОНЕЧНОСТЬ`;
  $('cName').textContent = th.name;
  { const tk = levelTask(lv, seed); $('cObj').textContent = 'ЦЕЛЬ: ' + TASK_GOAL[tk.chase ? 'chase' : tk.kind].toUpperCase(); }
  $('cTip').textContent = th.tip;
  const mdef = monsterFor(lv);
  $('cMon').textContent = `${mdef.name.toUpperCase()}: ${mdef.trait}`;
  const card = $('card'); card.classList.remove('fade'); show('card');
  const t0 = performance.now();
  await frames(2);
  disposeWorld();
  const D = DIFF[game.diff] || DIFF.normal;
  game.seed = seed; game.taken = new Set();
  const task = levelTask(lv, seed);
  const thG = Object.assign({}, th, { needKey: task.kind === 'key' }), thB = Object.assign({}, th, { needKey: task.kind !== 'exit' });
  // Открытый мир: в ~9 раз больше площади, поэтому воды и батареек больше (но не в 9 раз — их надо искать).
  const G = genGrid(thG, lv, seed, { world: WORLD, allowSecret: lv <= LAST, noteIds: lv <= LAST ? notesFor(lv) : [], water: Math.max(2, Math.round(th.water * D.items * (WORLD ? 2.5 : 1))), batt: Math.max(1, Math.round(th.batt * D.items * (WORLD ? 2.5 : 1))) });
  setAniso(anisoNow());
  const pbr = (await themeTex(th)) || {};
  const [lockMetal, lockWood] = await Promise.all([texSet('PaintedMetal012'), texSet('Wood066')]);
  pbr.locker = { metal: lockMetal, wood: lockWood };
  await Promise.race([preloadMonsters(), sleep(12000)]);
  lvl = buildLevel(thB, G, { seed, aniso: anisoNow(), pbr });
  scene.add(lvl.root);
  game.finds = buildFinds(lvl, G.finds, seed, lvl.glowT);
  game.task = task; game.ex = buildExtras(lvl, task, seed, lv);
  for (const it of game.ex.items) lvl.items.push(it);
  Object.assign(game, { parts: 0, codeOK: false, chase: false, chaseT: 0, scanT: 0, seen: new Uint8Array(lvl.mw * lvl.mh), seenT: 0, actIt: null, anomT: 0 });
  scene.fog.color.set(th.fog); scene.fog.density = th.fogD;
  ent = new Entity(lvl, monsterMesh(mdef.look), {
    step: (x, z, sp) => sound.entStep(x, z, sp),
    spot: () => { sound.spotted(); },
    // заметил что-то краем глаза: тихий звук монстра — у игрока есть пара секунд, чтобы спрятаться
    notice: () => { if (ent) sound.voice(ent.kind, ent.x, ent.z, false); },
    wake: () => { sound.wake(); whisper(mdef.name.toLowerCase() + (/[ая]$|ь$/.test(mdef.name) ? ' проснулась' : ' проснулся'), 3000); toast(`${mdef.name}: ${mdef.trait}`); },
    blink: (x, z) => { sound.blinkSnd(x, z); }
  }, mdef);
  ent.kind = Object.keys(MON).find((k) => MON[k] === mdef) || 'watcher';
  scene.add(ent.m.group);
  ent.timer = th.spawn * D.spawn;
  ghost = monsterMesh(mdef.look); ghost.group.visible = false; scene.add(ghost.group);
  Object.assign(pl, { x: lvl.spawn.x, z: lvl.spawn.z, yaw: lvl.spawn.yaw, pitch: 0, vx: 0, vz: 0, sta: 100, staDelay: 0, tired: false, san: 100, hasKey: false, wake: 0, bob: 0, light: false, running: false, gy: 0, hidden: null, crouch: false, ch: 0, nv: false, emp: 1, empT: 0, scanCD: 0, actT: 0, burst: 0 });
  hide('mapBox'); closeKeypad(true); game.mapOpen = false; game.scanT = 0; game.exitKnown = false; $('scanLayer').querySelectorAll('.sm').forEach((e) => e.remove()); syncTools();
  hide('slats');
  pl.bat = fresh || lv === 0 ? 100 : Math.max(pl.bat, 60);
  if (opt.secret && lvl.secret) { pl.x = lvl.secret.wallX - 1.3; pl.z = lvl.secret.wallZ; pl.yaw = -Math.PI / 2; }
  Object.assign(game, {
    level: lv, th, time: 0, black: false, warned: false, bkT: (25 + Math.random() * 30) / Math.max(0.5, th.black), minSan: 100, stare: 0, secretSeen: false,
    trDone: false, prox: 0, halT: 12, evT: 8 + Math.random() * 6, whT: 14, notesLv: 0, ghostT: 0, dipT: 0,
    voiceT: 5, ambT: 30 + Math.random() * 20, musicOn: true, musicT: 14, shakeT: 0, blackGhost: false
  });
  if (fresh) { game.runTime = 0; game.deaths = 0; }
  game.zoneId = null; game.zone = null; game.zoneT = 0; game.zonesSeen = new Set();
  if (minimap) resetMinimap(minimap); wrist.raise = 0; wrist.root.visible = false; game.scanUI = false; document.body.classList.remove('scanning');
  if (!SAVE.toolsTip) { SAVE.toolsTip = 1; persist(); setTimeout(() => { if (game.mode === 'play') toast(isTouch ? 'Кнопки внизу: сканер, ЭМИ, карта, метка, тихий шаг, камера. Всё садит батарею или шумит' : 'Q сканер · R ЭМИ · M карта · G метка · C присесть · V камера. Всё садит батарею или шумит'); }, 6000); }
  SAVE.max = Math.max(SAVE.max, lv); SAVE.cont = lv; persist();
  if (lv >= 10) unlock('deep');
  sound.setReverb(...(REVERB[th.layout] || REVERB.maze));
  sound.setBeacon(lvl.door.x, 1.6, lvl.door.z); game.beaconAt = null;
  if (lvl.secret) sound.setBox(lvl.secret.x, 1.4, lvl.secret.z);
  if (lvl.circus) sound.setCircus(lvl.circus.x, 3, lvl.circus.z);
  if (opt.taken) for (const i of opt.taken) markTaken(i, null, true);
  for (const r of rp.values()) { r.inLvl = false; r.dead = false; }
  applyCamera(0.016);
  try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  setObjective();
  await sleep(Math.max(0, 4200 - (performance.now() - t0)));
  card.classList.add('fade'); showHUD();
  game.mode = 'play'; busy = false;
  sound.stinger();
  if (game.pending) { const a = game.pending; game.pending = null; startLevel(a[0], a[1], a[2]); return; }
  setTimeout(() => { hide('card'); card.classList.remove('fade'); }, 950);
  if (!SAVE.tut) {
    SAVE.tut = true; persist();
    const tips = isTouch
      ? ['🕹️ Левый палец: ходить. До края: бежать', '👆 Правый палец: осматриваться', '🔦 Кнопка справа: фонарик']
      : ['⌨️ WASD: ходить, Shift: бег', '🖱️ Кликни по экрану и смотри мышью', '🔦 F: фонарик, E: действие'];
    tips.forEach((t, k) => setTimeout(() => { if (game.mode === 'play') toast(t); }, 2600 + k * 3300));
  }
}
function exitLevel() {
  if (game.mode !== 'play') return;
  if (game.coop) { unlock('friend'); if (game.coop.host) net.broadcast({ t: 'exit' }); }
  if (game.chase) { unlock('run'); game.chase = false; }
  closeKeypad(); game.mapOpen = false; hide('mapBox'); pl.nv = false; game.scanT = 0; $('scanLayer').querySelectorAll('.sm').forEach((e) => e.remove());
  game.overlay = false; hide('pause'); hide('reader'); hide('chatBox');
  game.mode = 'transition'; game.trT = 0; game.trDone = false; setAct(null); hideHUD(); unlockPointer();
  sound.doorOpen(); setTimeout(() => sound.noclip(), 300); vib(50);
  const lv = game.level;
  if (lv === 0) unlock('first');
  if (game.minSan >= 50) unlock('calm');
  if (lv === LAST) unlock('escape');
  if (game.th.props === 'pool') unlock('swim');
  if (game.th.props === 'circus') unlock('clown');
}
function updateTransition(dt) {
  game.trT += dt; const t = game.trT;
  pl.yaw += 0; camera.position.y -= dt * (t > 0.4 ? 2.5 : 0);
  setFX({ uWhite: t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.5), uFade: t > 0.6 ? Math.min(1, (t - 0.6) / 0.4) : 0, uDist: 1, uAb: 2 });
  if (t > 1.15 && !game.trDone) {
    game.trDone = true;
    if (game.coop && !game.coop.host) return;   // гость ждёт команды хоста
    if (game.level === LAST && !game.endless) { if (game.coop) net.broadcast({ t: 'ending' }); showEnding(); }
    else startLevel(game.level + 1);
  }
}
function startScare() {
  if (pl.hidden) { pl.hidden.lk.want = 1; hide('slats'); }
  game.mode = 'scare'; game.scT = 0; setAct(null); hideHUD(); unlockPointer();
  sound.scream(); vib([300, 60, 300, 60, 500]);
}
function updateScare(dt) {
  game.scT += dt; const t = game.scT;
  const want = Math.atan2(-(ent.x - pl.x), -(ent.z - pl.z));
  pl.yaw += angleDiff(pl.yaw, want) * Math.min(1, dt * 14);
  pl.pitch += (0.18 - pl.pitch) * Math.min(1, dt * 10);
  pl.pitch += (0 - pl.pitch) * Math.min(1, dt * 10);
  camera.position.set(pl.x + (Math.random() - 0.5) * 0.03, 1.62 + pl.gy + (Math.random() - 0.5) * 0.03, pl.z);
  camera.rotation.set(pl.pitch, pl.yaw, (Math.random() - 0.5) * 0.05);
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), dd = lerp(1.4, 0.5, Math.min(1, t * 3.5));
  ent.yaw = Math.atan2(-fx, -fz); ent.m.group.rotation.y = ent.yaw; ent.m.group.position.set(0, 0, 0);
  ent.scarePose(t);
  ent.m.group.updateMatrixWorld(true);
  ent.m.head.localToWorld(tv.set(0, 0.17, 0));
  ent.x = pl.x + fx * dd - tv.x; ent.z = pl.z + fz * dd - tv.z;
  ent.m.group.position.set(ent.x, camera.position.y - tv.y + Math.sin(t * 40) * 0.015, ent.z);
  flash.intensity = 0;
  setFX({ uNV: 0, uAb: 1.6, uDist: 0.6, uRed: 0.3, uGrain: 0.3, uVig: 0.45, uSat: 0.8, uFade: t > 0.95 ? Math.min(1, (t - 0.95) / 0.25) : 0, uWhite: 0 });
  if (t > 1.3) die('caught');
}
function die(reason) {
  hide('slats'); pl.hidden = null;
  game.mode = 'dead'; game.deaths++; hideHUD(); setAct(null); unlockPointer();
  game.overlay = false; hide('pause'); hide('reader'); hide('chatBox');
  $('bRetry').hidden = !!game.coop;
  if (game.coop) game.respawnT = 6;
  sound.deathDrone();
  $('dTitle').textContent = reason === 'caught' ? 'ОНО НАШЛО ТЕБЯ' : 'РАССУДОК ПОТЕРЯН';
  $('dText').textContent = reason === 'caught' ? 'Не стоило отворачиваться.' : 'Ты забыл, как выглядит небо. Теперь ты часть Закулисья.';
  fillStats($('dStats'), [['Уровень', `${game.level} · ${game.th.name}`], ['Время в игре', fmtTime(game.runTime)], ['Записки', `${SAVE.notes.length}/${NOTES.length}`], ['Смертей', String(game.deaths)]]);
  setFX({ uFade: 0.75 });
  if (game.coop) $('dText').textContent = 'Ты очнёшься у входа через 6 с. Друзья ещё здесь.';
  show('dead');
}
function respawn() {
  hide('dead'); $('bRetry').hidden = false;
  Object.assign(pl, { x: lvl.spawn.x, z: lvl.spawn.z, yaw: lvl.spawn.yaw, pitch: 0, vx: 0, vz: 0, san: 60, wake: 0, hidden: null, light: false });
  if (ent && !game.coop.host && ent.dist < 4) { /* хост переместит сущность сам */ }
  showHUD(); setFX({ uFade: 0 }); game.mode = 'play';
}
function fmtTime(s) { s = Math.floor(s); return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`; }
function fillStats(el, rows) {
  el.textContent = '';
  for (const [k, v] of rows) { const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; el.append(a, b); }
}
async function showEnding() {
  game.mode = 'ending'; hideHUD();
  const e = $('ending'); e.classList.remove('dark'); $('endFinal').classList.remove('on');
  const box = $('endLines'); box.textContent = '';
  const ls = ENDING.map((t) => { const p = document.createElement('p'); p.className = 'ln'; p.textContent = t; box.appendChild(p); return p; });
  show('ending');
  for (const p of ls) { await sleep(1500); p.classList.add('on'); }
  await sleep(2600);
  e.classList.add('dark'); box.textContent = '';
  await sleep(3100);
  fillStats($('endStats'), [['Время', fmtTime(game.runTime)], ['Записки', `${SAVE.notes.length}/${NOTES.length}`], ['Смертей', String(game.deaths)], ['Достижения', `${SAVE.ach.length}/${ACH.length}`]]);
  $('bEndless').hidden = !!(game.coop && !game.coop.host);
  $('endFinal').classList.add('on');
}

// ---------- меню и экраны ----------
const show = (id) => $(id).classList.add('on');
const hide = (id) => $(id).classList.remove('on');
const PANELS = ['menu', 'settings', 'journal', 'ach', 'help', 'about', 'pause', 'dead', 'ending', 'reader', 'prologue', 'levels', 'online', 'chatBox'];
function hideAllPanels() { PANELS.forEach(hide); }
function showHUD() { show('hud'); show('controls'); hudStatic(); }
function hideHUD() { hide('hud'); hide('controls'); input.joyId = null; input.lookId = null; joyReset(); }
let backTo = 'menu';
function openPanel(id, from) { backTo = from; hide(from); render(id); show(id); }
function render(id) {
  if (id === 'settings') syncSettings();
  if (id === 'levels') renderLevels();
  if (id === 'online') { if (!game.coop) { $('onStart').hidden = false; $('onRoom').hidden = true; status(''); } else renderRoom(); }
  if (id === 'journal') {
    const ul = $('jList'); ul.textContent = '';
    NOTES.forEach((n, i) => {
      const li = document.createElement('li'), got = SAVE.notes.includes(i);
      li.className = 'item' + (got ? ' click' : ' lock');
      li.innerHTML = '<span class="ic"></span><div><h3></h3><p></p></div>';
      li.querySelector('.ic').textContent = got ? '📜' : '🔒';
      li.querySelector('h3').textContent = got ? n.t : `${n.t} · не найдена`;
      li.querySelector('p').textContent = got ? n.b.slice(0, 70) + '…' : `Лежит где-то на уровне ${n.lv}.`;
      if (got) li.addEventListener('click', () => { $('rTitle').textContent = n.t; $('rBody').textContent = n.b; show('reader'); sound.paper(); });
      ul.appendChild(li);
    });
  }
  if (id === 'journal') {
    const ul = $('jList');
    const h = document.createElement('li'); h.className = 'jsec'; h.textContent = `Аномалии · ${SAVE.anom.length}/${ANOM_KEYS.length}`; ul.prepend(h);
    let after = h;
    for (const k of ANOM_KEYS) {
      const A = ANOMS[k], got = SAVE.anom.includes(k), li = document.createElement('li');
      li.className = 'item' + (got ? '' : ' lock');
      li.innerHTML = '<span class="ic"></span><div><h3></h3><p></p></div>';
      li.querySelector('.ic').textContent = got ? '◉' : '?';
      li.querySelector('h3').textContent = got ? A.name : 'Не найдена';
      li.querySelector('p').textContent = got ? A.d : 'Где-то в Закулисье';
      after.after(li); after = li;
    }
    const fs = SAVE.finds || [];
    const hf = document.createElement('li'); hf.className = 'jsec'; hf.textContent = `${tr('find.title')} · ${fs.length}/${FIND_IDS.length}`; h.before(hf);
    for (const k of FIND_IDS) {
      const got = fs.includes(k), li = document.createElement('li');
      li.className = 'item' + (got ? '' : ' lock');
      li.innerHTML = '<span class="ic"></span><div><h3></h3><p></p></div>';
      li.querySelector('.ic').textContent = got ? '✦' : '?';
      li.querySelector('h3').textContent = got ? tr('find.' + k) : tr('find.unknown');
      li.querySelector('p').textContent = got ? tr('find.' + k + '.d') : tr('find.where');
      h.before(li);
    }
    const h2 = document.createElement('li'); h2.className = 'jsec'; h2.textContent = `Записки · ${SAVE.notes.length}/${NOTES.length}`; after.after(h2);
  }
  if (id === 'ach') {
    const ul = $('aList'); ul.textContent = '';
    for (const a of ACH) {
      const got = SAVE.ach.includes(a.id), li = document.createElement('li');
      li.className = 'item' + (got ? '' : ' lock');
      li.innerHTML = '<span class="ic"></span><div><h3></h3><p></p></div>';
      const hid = a.hidden && !got;
      li.querySelector('.ic').textContent = hid ? '❔' : a.ic;
      li.querySelector('h3').textContent = hid ? '???' : a.name;
      li.querySelector('p').textContent = hid ? 'Секретное достижение' : a.d;
      ul.appendChild(li);
    }
  }
}
function refreshMenu() {
  const c = $('bCont');
  c.hidden = !(SAVE.cont > 0);
  $('contSub').textContent = SAVE.cont > 0 ? `уровень ${SAVE.cont}` : '';
  $('subNotes').textContent = `${SAVE.notes.length}/${NOTES.length}`;
  $('subAch').textContent = `${SAVE.ach.length}/${ACH.length}`;
  $('verRec').textContent = SAVE.max >= 0 ? `рекорд: уровень ${SAVE.max}` : 'рекорда пока нет';
}
function toMenu() {
  if (game.coop && game.mode !== 'menu') leaveCoop();
  hide('slats'); pl.hidden = null; $('bRetry').hidden = false;
  hideAllPanels(); hideHUD(); hide('card'); unlockPointer();
  buildDemo();
  game.mode = 'menu'; refreshMenu(); show('menu');
  sound.resume();
  setFX({ uFade: 0, uWhite: 0, uRed: 0, uDist: 0 });
}
function pauseGame() {
  if (game.mode !== 'play') return;
  if (game.coop) { if (game.overlay) return; game.overlay = true; unlockPointer(); show('pause'); return; }
  game.mode = 'paused'; unlockPointer(); hideHUD(); show('pause'); sound.suspend();
}
function resumeGame() {
  if (game.coop && game.overlay) { hideAllPanels(); game.overlay = false; return; }
  if (game.mode !== 'paused') return;
  hideAllPanels(); showHUD(); game.mode = 'play'; sound.resume();
}
async function newGame() {
  hideAllPanels(); game.mode = 'prologue'; game.endless = false;
  const box = $('proLines'); box.textContent = '';
  const pro = $('prologue'); pro.classList.remove('fade'); show('prologue');
  const ps = PROLOGUE.map((t) => { const p = document.createElement('p'); p.textContent = t; box.appendChild(p); return p; });
  let skip = false; const sk = () => { skip = true; }; pro.addEventListener('pointerdown', sk, { once: true });
  for (const p of ps) { if (skip) break; p.classList.add('on'); for (let k = 0; k < 16 && !skip; k++) await sleep(100); }
  if (!skip) await sleep(800);
  pro.removeEventListener('pointerdown', sk);
  hide('prologue');
  startLevel(0, true);
}

// настройки
function syncSettings() {
  const s = SAVE.set;
  $('sSens').value = s.sens; $('vSens').textContent = Number(s.sens).toFixed(1);
  $('sVol').value = s.vol; $('vVol').textContent = s.vol;
  for (const [id, v] of [['segQ', s.q], ['segD', s.diff], ['segV', s.vib ? '1' : '0']]) $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  // что определилось: «Устройство: Apple · мощное. Авто = Ультра»
  const di = $('devInfo');
  if (di) {
    const ap = autoProfile(DEV), qn = { droidLow: 'low', droid: 'med', droidHigh: 'high' }[ap] || ap;
    di.textContent = tr('set.dev', { dev: tr('dev.' + DEV.platform), power: tr('dev.t' + DEV.tier), q: tr('set.q.' + qn) });
  }
}
window.addEventListener('langchange', () => syncSettings());
$('sSens').addEventListener('input', (e) => { SAVE.set.sens = +e.target.value; persist(); syncSettings(); });
$('sVol').addEventListener('input', (e) => { SAVE.set.vol = +e.target.value; sound.setVol(SAVE.set.vol / 100); persist(); syncSettings(); });
$('segQ').addEventListener('click', (e) => { const v = e.target.dataset.v; if (!v) return; SAVE.set.q = v; persist(); applyQuality(); syncSettings(); });
$('segD').addEventListener('click', (e) => { const v = e.target.dataset.v; if (!v) return; SAVE.set.diff = v; persist(); syncSettings(); });
$('segV').addEventListener('click', (e) => { const v = e.target.dataset.v; if (!v) return; SAVE.set.vib = v === '1'; persist(); syncSettings(); vib(30); });

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { sound.ui(); openPanel(b.dataset.go, b.closest('.layer').id); }));
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
  sound.ui(); hide(b.closest('.layer').id); show(backTo); refreshMenu();
}));
$('bNew').addEventListener('click', () => { sound.ui(); newGame(); });
$('bCont').addEventListener('click', () => { sound.ui(); game.endless = SAVE.cont > LAST; startLevel(SAVE.cont, true); });
$('bResume').addEventListener('click', () => { sound.ui(); resumeGame(); });
$('bQuit').addEventListener('click', () => { sound.ui(); toMenu(); });
$('bPause').addEventListener('click', () => pauseGame());
$('rClose').addEventListener('click', () => { sound.ui(); closeNote(); });
$('bRetry').addEventListener('click', () => { sound.ui(); startLevel(game.level); });
$('bDeadMenu').addEventListener('click', () => { sound.ui(); toMenu(); });
$('bEndless').addEventListener('click', () => { sound.ui(); game.endless = true; hide('ending'); startLevel(LAST + 1); });
$('bEndMenu').addEventListener('click', () => { sound.ui(); hide('ending'); if (game.coop) leaveCoop(); toMenu(); });
$('splash').addEventListener('click', () => {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  sound.init(); sound.setVol(SAVE.set.vol / 100);
  hide('splash'); toMenu();
  if (isTouch) { try { const el = document.documentElement; if (!el.requestFullscreen && el.webkitRequestFullscreen) el.webkitRequestFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ } }).catch(() => {}); } catch (e) { /* ignore */ } }
});

// ---------- секретные коды ----------
// В «Об игре» нажимать по словам строки «Иногда стены помнят имена». Без подсказок; пауза > 5 с сбрасывает.
const CODES = [
  { seq: ['i', 'i', 'i', 's', 's', 'p'], lv: 0, msg: '❤ Стены вспомнили имя' },
  { seq: ['p', 'p', 'i', 'i', 'a'], lv: 3, msg: '💛 Улыбки вспомнили имя' },
  { seq: ['a', 's', 'p', 'i', 'i', 's'], lv: 6, msg: '🎈 Цирк вспомнил имя' }
];
let taps = [], codeT = 0;
$('wLine').addEventListener('click', (e) => {
  const w = e.target && e.target.dataset ? e.target.dataset.w : null;
  if (!w) { taps = []; return; }
  const now = performance.now();
  if (now - codeT > 5000) taps = [];
  codeT = now; taps.push(w); if (taps.length > 8) taps.shift();
  for (const c of CODES) {
    const tail = taps.slice(-c.seq.length);
    if (tail.length === c.seq.length && tail.every((v, k) => v === c.seq[k])) {
      taps = [];
      sound.secret(); vib([40, 60, 40]);
      toast(c.msg, 'pink');
      game.endless = false;
      setTimeout(() => startLevel(c.lv, true, { secret: true }), 1400);
      return;
    }
  }
});

// ---------- управление ----------
const joyZone = $('joyZone'), lookZone = $('lookZone'), joyEl = $('joy'), knob = $('knob');
function joyReset() {
  input.joyId = null; input.jx = input.jy = input.jmag = 0;
  joyEl.classList.remove('live', 'run'); joyEl.style.left = ''; joyEl.style.top = ''; joyEl.style.bottom = ''; knob.style.transform = '';
}
const TOUCH_EV = 'ontouchstart' in window;
joyZone.addEventListener('pointerdown', (e) => {
  if (TOUCH_EV && e.pointerType === 'touch') return;
  if (input.joyId !== null) return;
  e.preventDefault(); try { joyZone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  input.joyId = e.pointerId; input.jox = e.clientX; input.joy0 = e.clientY;
  joyEl.classList.add('live'); joyEl.style.left = (e.clientX - 62) + 'px'; joyEl.style.top = (e.clientY - 62) + 'px'; joyEl.style.bottom = 'auto';
});
joyZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== input.joyId) return;
  let dx = e.clientX - input.jox, dy = e.clientY - input.joy0; const R = 58, d = Math.hypot(dx, dy);
  if (d > R) { dx *= R / d; dy *= R / d; }
  input.jx = dx / R; input.jy = dy / R; input.jmag = Math.min(1, d / R);
  knob.style.transform = `translate(${dx}px,${dy}px)`;
});
const joyEnd = (e) => { if (e.pointerId === input.joyId) joyReset(); };
joyZone.addEventListener('pointerup', joyEnd); joyZone.addEventListener('pointercancel', joyEnd);
lookZone.addEventListener('pointerdown', (e) => {
  if (TOUCH_EV && e.pointerType === 'touch') return;
  if (e.pointerType === 'mouse' && game.mode === 'play') lockPointer();
  if (input.lookId !== null) return;
  e.preventDefault(); try { lookZone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  input.lookId = e.pointerId; input.lx = e.clientX; input.ly = e.clientY;
});
lookZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== input.lookId || document.pointerLockElement) return;
  const k = e.pointerType === 'mouse' ? 1 : 1.25;
  input.ldx += (e.clientX - input.lx) * k; input.ldy += (e.clientY - input.ly) * k;
  input.lx = e.clientX; input.ly = e.clientY;
});
const lookEnd = (e) => { if (e.pointerId === input.lookId) input.lookId = null; };
lookZone.addEventListener('pointerup', lookEnd); lookZone.addEventListener('pointercancel', lookEnd);
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement && game.mode === 'play') { input.ldx += e.movementX; input.ldy += e.movementY; } });
function lockPointer() { if (isTouch || document.pointerLockElement) return; try { const p = lookZone.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
function unlockPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ } }
let lockLost = 0;
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game.mode === 'play') { lockLost = performance.now(); pauseGame(); } });
for (const [id, fn] of [['bLight', toggleLight], ['bAct', doAct], ['tScan', toolScan], ['tEmp', toolEmp], ['tMap', toolMap], ['tMark', toolMark], ['tCrouch', toolCrouch], ['tNV', toolNV]]) $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });

$('mapBox').addEventListener('pointerdown', (e) => { e.preventDefault(); if (game.mapOpen) toolMap(); });
$('kpad').addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); e.stopPropagation(); if (b.dataset.k === 'close') closeKeypad(); else kpPress(b.dataset.k); });
// --- сенсорное управление на Touch Events (надёжнее на iPhone/iPad, чем pointer events)
if (TOUCH_EV) {
  const ctl = $('controls');
  const startJoy = (t) => {
    input.joyId = t.identifier; input.jox = t.clientX; input.joy0 = t.clientY; input.jx = input.jy = input.jmag = 0;
    joyEl.classList.add('live'); joyEl.style.left = (t.clientX - 62) + 'px'; joyEl.style.top = (t.clientY - 62) + 'px'; joyEl.style.bottom = 'auto';
  };
  ctl.addEventListener('touchstart', (e) => {
    if (e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const left = t.clientX < innerWidth * 0.45 && t.clientY > 70;
      if (left && input.joyId === null) startJoy(t);
      else if (input.lookId === null) { input.lookId = t.identifier; input.lx = t.clientX; input.ly = t.clientY; }
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    let used = false;
    for (const t of e.changedTouches) {
      if (t.identifier === input.joyId) {
        let dx = t.clientX - input.jox, dy = t.clientY - input.joy0; const R = 58, d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        input.jx = dx / R; input.jy = dy / R; input.jmag = Math.min(1, d / R);
        knob.style.transform = `translate(${dx}px,${dy}px)`; used = true;
      } else if (t.identifier === input.lookId) {
        input.ldx += (t.clientX - input.lx) * 1.25; input.ldy += (t.clientY - input.ly) * 1.25;
        input.lx = t.clientX; input.ly = t.clientY; used = true;
      }
    }
    if (used && e.cancelable) e.preventDefault();
  }, { passive: false });
  // главное: при любом отпускании проверяем, какие пальцы ещё на экране — джойстик больше не «залипает»
  const touchEnd = (e) => {
    const alive = new Set(); for (const t of e.touches) alive.add(t.identifier);
    if (input.joyId !== null && !alive.has(input.joyId)) joyReset();
    if (input.lookId !== null && !alive.has(input.lookId)) input.lookId = null;
  };
  window.addEventListener('touchend', touchEnd, { passive: true });
  window.addEventListener('touchcancel', touchEnd, { passive: true });
  // запрет зума щипком и двойным тапом в Safari
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}
addEventListener('keydown', (e) => {
  input.keys[e.code] = true;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { input.keys[e.code] = false; return; }
  if (e.code === 'Escape' && game.kpOpen) { closeKeypad(); return; }
  if (e.code === 'Escape') {
    if (game.mode === 'reading' || (game.overlay && $('reader').classList.contains('on'))) closeNote();
    else if (game.coop && game.overlay) resumeGame();
    else if (game.mode === 'paused' && performance.now() - lockLost > 300) resumeGame();
    else if (game.mode === 'play') pauseGame();
  }
  if (game.mode === 'play') {
    if (game.kpOpen) {
      if (/^Digit\d$|^Numpad\d$/.test(e.code)) kpPress(e.code.slice(-1));
      else if (e.code === 'Backspace') kpPress('x');
      else if (e.code === 'Enter') kpPress('ok');
      else if (e.code === 'Escape' || e.code === 'KeyE') closeKeypad();
      return;
    }
    if (e.code === 'KeyF') toggleLight();
    if (e.code === 'KeyE') doAct();
    if (e.code === 'KeyQ') toolScan();
    if (e.code === 'KeyR') toolEmp();
    if (e.code === 'KeyM' || e.code === 'Tab') { toolMap(); e.preventDefault(); }
    if (e.code === 'KeyG') toolMark();
    if (e.code === 'KeyC' || e.code === 'ControlLeft') toolCrouch();
    if (e.code === 'KeyV') toolNV();
  } else if (game.mode === 'reading' && (e.code === 'KeyE' || e.code === 'Enter')) closeNote();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { input.keys[e.code] = false; });
// iOS может «усыпить» звук (звонок, уведомление): будим при каждом касании
document.addEventListener('pointerdown', () => { if (sound.ctx && sound.ctx.state !== 'running' && game.mode !== 'paused') sound.resume(); }, { passive: true });
addEventListener('blur', () => { for (const k in input.keys) input.keys[k] = false; joyReset(); input.lookId = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { joyReset(); input.lookId = null; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && !game.coop) pauseGame(); });


// ---------- онлайн ----------
const COLORS = ['#e6c860', '#ff6f9a', '#5fb8ff', '#7be07a'];
const rp = new Map();   // другие игроки: id → состояние и аватар
const remoteSpots = [0, 1, 2].map(() => { const s_ = new THREE.SpotLight(0xfff2dc, 0, 26, 0.5, 0.6, 1.0); const t_ = new THREE.Object3D(); scene.add(s_); scene.add(t_); s_.target = t_; return s_; });
const net = new Net({
  msg: (from, d) => { try { onNet(from, d); } catch (e) { console.warn(e); } },
  joined: () => {},
  left: (id) => onLeft(id),
  error: (e) => toast('📡 Связь: ' + ((e && (e.type || e.message)) || 'ошибка')),
  audio: () => { $('bHear').hidden = false; }
});
const hostId = () => (game.roster[0] && game.roster[0].id) || '';
const clean = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n); // eslint-disable-line no-control-regex
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const nameOf = (id) => { const r = game.roster.find((p) => p.id === id); return r ? r.name : 'Игрок'; };

function labelSprite(text, col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '600 30px "IBM Plex Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.55)'; const w = Math.min(250, x.measureText(text).width + 24); x.fillRect(128 - w / 2, 8, w, 48);
  x.fillStyle = col; x.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  sp.scale.set(1.1, 0.275, 1); return sp;
}
function makeAvatar(name, col) {
  const g = new THREE.Group(), c = new THREE.Color(col);
  const cloth = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }), dark = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 10), cloth); body.position.y = 1.05; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin); head.position.y = 1.6; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.168, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), dark); hair.position.y = 1.62; g.add(hair);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark); e.position.set(sx * 0.055, 1.62, 0.145); g.add(e); }
  const legs = [];
  for (const sx of [-1, 1]) { const lg = new THREE.Group(); lg.position.set(sx * 0.1, 0.7, 0); const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), dark); m.position.y = -0.33; lg.add(m); g.add(lg); legs.push(lg); }
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0x333333 })); torch.rotation.x = Math.PI / 2; torch.position.set(0.22, 1.1, 0.22); g.add(torch);
  const label = labelSprite(name, col); label.position.y = 2.02; g.add(label);
  return { group: g, legs, torch, label, bubble: null, bubbleT: 0, ph: 0 };
}
function ensureAvatar(r) {
  if (!r.av) { r.av = makeAvatar(r.name || 'Игрок', r.col || '#fff'); scene.add(r.av.group); r.av.group.position.set(r.x, 0, r.z); }
}
function dropAvatar(r) { if (r.av) { scene.remove(r.av.group); disposeMesh(r.av.group); r.av = null; } }
function bubble(r, text) {
  ensureAvatar(r);
  if (r.av.bubble) { r.av.group.remove(r.av.bubble); r.av.bubble.material.map.dispose(); r.av.bubble.material.dispose(); }
  const b = labelSprite(text, '#ffffff'); b.scale.set(1.6, 0.4, 1); b.position.y = 2.35; r.av.group.add(b); r.av.bubble = b; r.av.bubbleT = 4.5;
}
function rosterUpdate(list) {
  if (!Array.isArray(list)) return;
  game.roster = list.slice(0, 4).map((p, k) => ({ id: clean(p.id, 64), name: clean(p.name, 14) || 'Игрок', col: COLORS[k % 4] }));
  for (const p of game.roster) {
    if (p.id === net.id) continue;
    let r = rp.get(p.id);
    if (!r) { r = { x: 0, z: 0, yaw: 0, pitch: 0, inLvl: false }; rp.set(p.id, r); }
    if (r.name !== p.name || r.col !== p.col) { r.name = p.name; r.col = p.col; dropAvatar(r); }
  }
  for (const id of [...rp.keys()]) if (!game.roster.some((p) => p.id === id)) { dropAvatar(rp.get(id)); rp.delete(id); }
  renderRoom(); renderCoopBar();
  if (net.stream) net.callAll(game.roster.map((p) => p.id));
}
function broadcastRoster() { net.broadcast({ t: 'roster', roster: game.roster }); rosterUpdate(game.roster); }

function onNet(from, d) {
  if (!d || typeof d !== 'object') return;
  const host = game.coop && game.coop.host;
  if (host) {
    if (d.t === 'hello') {
      if (game.roster.length >= 4 && !game.roster.some((p) => p.id === from)) { net.send(from, { t: 'full' }); return; }
      if (!game.roster.some((p) => p.id === from)) game.roster.push({ id: from, name: clean(d.name, 14) || 'Игрок' });
      broadcastRoster();
      toast('🤝 ' + nameOf(from) + ' в комнате');
      if (lvl && (game.mode === 'play' || game.mode === 'dead' || game.mode === 'loading')) net.send(from, { t: 'start', lv: game.level, seed: game.seed, diff: game.diff, fresh: false, taken: [...game.taken] });
    } else if (d.t === 'me') {
      const r = rp.get(from); if (!r) return;
      Object.assign(r, { x: num(d.x, r.x), z: num(d.z, r.z), yaw: num(d.yaw), pitch: num(d.pitch), l: !!d.l, dead: !!d.dead, safe: !!d.safe, hidden: !!d.h, stare: !!d.st, noise: Math.min(30, num(d.n)), inLvl: d.lv === game.level });
    } else if (d.t === 'take') {
      const i = num(d.i, -1); if (lvl && i >= 0 && i < lvl.items.length && !game.taken.has(i)) { markTaken(i, from); net.broadcast({ t: 'taken', i, by: from }); }
    } else if (d.t === 'door') {
      if (game.mode === 'play' && taskDone()) { toast('🚪 ' + nameOf(from) + ' открыл дверь'); exitLevel(); }
    } else if (d.t === 'mark') {
      if (game.ex && game.mode !== 'loading') { addMark(game.ex, num(d.x), num(d.z), num(d.yaw)); net.broadcast({ t: 'mark', x: num(d.x), z: num(d.z), yaw: num(d.yaw) }, from); }
    } else if (d.t === 'emp') {
      empAt(num(d.x), num(d.z), false);
    } else if (d.t === 'code') {
      if (game.ex && game.ex.code && String(d.v) === game.ex.code.digits.join('')) { codeSolved(from); net.broadcast({ t: 'codeok', by: from }); }
    } else if (d.t === 'chat') {
      const text = clean(d.text, 80); if (!text) return;
      net.broadcast({ t: 'chat', from, text }, from); showChat(from, text);
    }
    return;
  }
  // гость
  if (d.t === 'roster') rosterUpdate(d.roster);
  else if (d.t === 'full') { toast('Комната заполнена (максимум 4)'); leaveCoop(); }
  else if (d.t === 'start') {
    const lv = Math.max(0, Math.min(99, num(d.lv) | 0));
    startLevel(lv, !!d.fresh, { seed: num(d.seed, 1) | 0, diff: DIFF[d.diff] ? d.diff : 'normal', taken: Array.isArray(d.taken) ? d.taken.filter((i) => typeof i === 'number') : [] });
  } else if (d.t === 'st') {
    game.netEnt = Array.isArray(d.e) ? d.e.map((v) => num(v)) : null;
    game.netBlack = !!d.b; game.musicOn = d.m !== 0;
    if (d.c && !game.chase && game.mode === 'play') startChase();
    if (Array.isArray(d.p)) for (const q of d.p) {
      if (!Array.isArray(q) || q[0] === net.id) continue;
      const r = rp.get(q[0]); if (!r) continue;
      Object.assign(r, { x: num(q[1], r.x), z: num(q[2], r.z), yaw: num(q[3]), pitch: num(q[4]), l: !!q[5], dead: !!q[6], hidden: !!q[7], inLvl: q[8] === game.level });
    }
  } else if (d.t === 'taken') { markTaken(num(d.i, -1), d.by); }
  else if (d.t === 'mark') { if (game.ex) addMark(game.ex, num(d.x), num(d.z), num(d.yaw)); }
  else if (d.t === 'codeok') { codeSolved(d.by && d.by !== net.id ? d.by : null); }
  else if (d.t === 'exit') { exitLevel(); }
  else if (d.t === 'caught') { if (d.id === net.id && game.mode === 'play') startScare(); }
  else if (d.t === 'chat') { showChat(d.from, clean(d.text, 80)); }
  else if (d.t === 'ending') { if (game.mode !== 'ending') { hideHUD(); showEnding(); } }
}
function onLeft(id) {
  if (game.coop && !game.coop.host && id === hostId()) { toast('Создатель комнаты вышел'); leaveCoop(); toMenu(); return; }
  if (game.coop && game.coop.host) {
    const n = nameOf(id);
    game.roster = game.roster.filter((p) => p.id !== id); broadcastRoster();
    toast('👋 ' + n + ' вышел');
  }
}
function markTaken(i, by, silent) {
  if (!lvl || i < 0 || i >= lvl.items.length) return;
  game.taken.add(i);
  const it = lvl.items[i]; if (it.taken) return;
  applyItem(it, by || 'friend', silent);
}
function showChat(from, text) {
  if (!text) return;
  toast(nameOf(from) + ': ' + text, 'chat'); sound.chat();
  const r = rp.get(from); if (r && lvl) bubble(r, text);
}
function sendChat(text) {
  text = clean(text, 80); if (!text || !game.coop) return;
  toast('💬 Ты: ' + text);
  if (game.coop.host) net.broadcast({ t: 'chat', from: net.id, text }); else net.send(hostId(), { t: 'chat', text });
}
function renderCoopBar() {
  const bar = $('coopBar'); bar.hidden = !game.coop; $('coopBtns').hidden = !game.coop;
  if (!game.coop) return;
  bar.textContent = '';
  for (const p of game.roster) {
    const sp = document.createElement('span'); sp.style.setProperty('--c', p.col);
    const r = rp.get(p.id); sp.className = r && r.dead ? 'dead' : '';
    sp.textContent = (p.id === net.id ? '★ ' : '') + p.name; bar.appendChild(sp);
  }
}
function renderRoom() {
  const ul = $('oPlayers'); ul.textContent = '';
  for (const p of game.roster) {
    const li = document.createElement('li'); li.className = 'item';
    li.innerHTML = '<span class="ic">👤</span><div><h3></h3><p></p></div>';
    li.querySelector('h3').textContent = p.name + (p.id === net.id ? ' (ты)' : '');
    li.querySelector('h3').style.color = p.col;
    li.querySelector('p').textContent = p.id === hostId() ? 'создатель комнаты' : 'в комнате';
    ul.appendChild(li);
  }
  const host = game.coop && game.coop.host;
  $('oHostCtl').hidden = !host; $('oGo').hidden = !host; $('oWait').hidden = !!host;
}
function coopFrame(dt) {
  if (!net.active) return;
  game.netT += dt;
  const host = game.coop.host;
  if (host && game.mode === 'dead' && ent && lvl) entTick(dt, false);
  // голос друга тише, когда он далеко (на iPhone громкость задаёт система)
  for (const [id, au] of net.audios) { const r = rp.get(id); try { au.volume = r && lvl && r.inLvl && game.mode === 'play' ? clamp(1.15 - Math.hypot(r.x - pl.x, r.z - pl.z) / 28, 0.12, 1) : 1; } catch (e) { /* ignore */ } }
  if (game.mode === 'dead') {
    game.respawnT -= dt;
    $('dText').textContent = `Ты очнёшься у входа через ${Math.max(0, Math.ceil(game.respawnT))} с. Друзья ещё здесь.`;
    if (game.respawnT <= 0) respawn();
  }
  if (game.netT >= 1 / 12) {
    game.netT = 0;
    const inLvl = !!lvl && game.mode !== 'menu' && game.mode !== 'loading';
    if (host) {
      const P = [[net.id, +pl.x.toFixed(2), +pl.z.toFixed(2), +pl.yaw.toFixed(2), +pl.pitch.toFixed(2), pl.light ? 1 : 0, game.mode !== 'play' ? 1 : 0, pl.hidden ? 1 : 0, inLvl ? game.level : -1]];
      for (const [id, r] of rp) P.push([id, +r.x.toFixed(2), +r.z.toFixed(2), +r.yaw.toFixed(2), +r.pitch.toFixed(2), r.l ? 1 : 0, r.dead ? 1 : 0, r.hidden ? 1 : 0, r.inLvl ? game.level : -1]);
      net.broadcast({ t: 'st', e: ent && inLvl ? ent.pack() : null, b: game.black ? 1 : 0, m: game.musicOn ? 1 : 0, c: game.chase ? 1 : 0, p: P });
    } else {
      net.send(hostId(), { t: 'me', x: +pl.x.toFixed(2), z: +pl.z.toFixed(2), yaw: +pl.yaw.toFixed(2), pitch: +pl.pitch.toFixed(2), l: pl.light ? 1 : 0, dead: game.mode !== 'play', safe: !!pl.safe, h: pl.hidden ? 1 : 0, st: !!pl.stare, n: pl.noise, lv: inLvl ? game.level : -1 });
    }
  }
  game.rosterT -= dt; if (game.rosterT <= 0) { game.rosterT = 1; renderCoopBar(); }
  // аватары и их фонарики
  let si = 0;
  for (const [, r] of rp) {
    const vis = !!lvl && r.inLvl && !r.dead && !r.hidden && game.mode !== 'menu';
    if (!vis) { if (r.av) r.av.group.visible = false; continue; }
    ensureAvatar(r);
    const g = r.av.group; g.visible = true;
    const k = Math.min(1, dt * 12), ox = g.position.x, oz = g.position.z;
    if (Math.hypot(r.x - ox, r.z - oz) > 6) g.position.set(r.x, 0, r.z);
    g.position.x += (r.x - ox) * k; g.position.z += (r.z - oz) * k;
    g.position.y += (lvl.groundY(g.position.x, g.position.z) - g.position.y) * k;
    g.rotation.y += angleDiff(g.rotation.y, r.yaw + Math.PI) * k;
    const sp = Math.hypot(g.position.x - ox, g.position.z - oz) / Math.max(dt, 1e-3);
    r.av.ph += dt * sp * 2.2;
    r.av.legs[0].rotation.x = Math.sin(r.av.ph) * 0.6 * Math.min(1, sp / 2);
    r.av.legs[1].rotation.x = -Math.sin(r.av.ph) * 0.6 * Math.min(1, sp / 2);
    if (r.av.bubble) { r.av.bubbleT -= dt; if (r.av.bubbleT <= 0) { g.remove(r.av.bubble); r.av.bubble.material.map.dispose(); r.av.bubble.material.dispose(); r.av.bubble = null; } }
    if (r.l && si < remoteSpots.length) {
      const S_ = remoteSpots[si++], fx = -Math.sin(r.yaw) * Math.cos(r.pitch), fz = -Math.cos(r.yaw) * Math.cos(r.pitch), fy = Math.sin(r.pitch);
      S_.position.set(g.position.x, g.position.y + 1.4, g.position.z); S_.target.position.set(g.position.x + fx * 5, g.position.y + 1.4 + fy * 5, g.position.z + fz * 5);
      S_.intensity = 6.5;
    }
  }
  for (; si < remoteSpots.length; si++) remoteSpots[si].intensity = 0;
}
function leaveCoop() {
  net.leave(); game.coop = null; game.overlay = false;
  for (const r of rp.values()) dropAvatar(r);
  rp.clear(); game.roster = [];
  remoteSpots.forEach((s_) => { s_.intensity = 0; });
  $('onStart').hidden = false; $('onRoom').hidden = true; $('oMic').textContent = 'Включить микрофон';
  $('bMic').classList.remove('on', 'mute'); $('bHear').hidden = true;
  renderCoopBar();
}
async function toggleMic() {
  if (!game.coop) return;
  if (!net.canVoice) { toast(net.mode === 'room' ? '🎙 Внутри Claude микрофон запрещён. Голос работает на сайте игры, а здесь есть быстрый чат 💬' : '🎙 Голос работает только на сайте игры'); return; }
  try {
    if (!net.stream) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* ignore */ }
      await net.micOn(game.roster.map((p) => p.id));
      sound.resume(); net.unlockAudio();
      toast('🎙 Микрофон включён');
    } else { net.setMuted(!net.muted); toast(net.muted ? '🔇 Микрофон выключен' : '🎙 Микрофон включён'); }
  } catch (e) { toast('🎙 Нет доступа к микрофону. Разреши его в настройках браузера.'); return; }
  const on = !!net.stream && !net.muted;
  $('bMic').classList.toggle('on', on); $('bMic').classList.toggle('mute', !!net.stream && net.muted);
  $('oMic').textContent = on ? 'Выключить микрофон' : 'Включить микрофон';
}

// лобби
$('oName').value = SAVE.name || '';
const nameNow = () => { const n = clean($('oName').value, 14) || 'Игрок'; SAVE.name = n; persist(); return n; };
const status = (t) => { $('oStatus').textContent = t; };
const onlineFail = (e) => {
  const t = (e && (e.type || e.message)) || '';
  const M = {
    noroom: 'Внутри Claude онлайн работает, только если вы оба вошли в Claude и игрой поделились с другом лично. По публичной ссылке — нет. Надёжнее всего играть на сайте игры.',
    noscript: 'Не загрузился модуль онлайна. Проверь интернет или отключи блокировщик рекламы и попробуй ещё раз.',
    server: 'Сервер онлайна не ответил. Проверь интернет и попробуй ещё раз через минуту.',
    taken: 'Такой код уже занят. Нажми «Создать комнату» ещё раз.',
    notfound: 'Комната не найдена. Проверь код: друг должен держать комнату открытой.',
    p2p: 'Комната найдена, но сеть не даёт соединиться. Попробуйте другой Wi-Fi или мобильный интернет.'
  };
  status(M[t] || 'Не получилось подключиться. Проверь интернет и попробуй ещё раз.');
};
function fillLevelSelect() {
  const sel = $('oLevel'); sel.textContent = '';
  THEMES.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i} · ${t.name}`; sel.appendChild(o); });
}
let onlineBusy = false;
$('oHost').addEventListener('click', async () => {
  if (onlineBusy) return; onlineBusy = true;
  sound.ui(); const name = nameNow(); status('Создаём комнату…');
  let code = makeCode();
  try {
    try { await net.host(code); } catch (e) { if (e && e.type === 'taken') { code = makeCode(); await net.host(code); } else throw e; }
    game.coop = { host: true }; game.roster = [{ id: net.id, name }]; rosterUpdate(game.roster);
    $('oRoomCode').textContent = code; $('onStart').hidden = true; $('onRoom').hidden = false; fillLevelSelect();
    status('Комната готова. Ждём друзей.');
  } catch (e) { onlineFail(e); } finally { onlineBusy = false; }
});
$('oJoin').addEventListener('click', async () => {
  if (onlineBusy) return; onlineBusy = true;
  sound.ui(); const name = nameNow(), code = clean($('oCode').value, 5).toUpperCase();
  if (code.length !== 5) { status('Код состоит из 5 знаков.'); onlineBusy = false; return; }
  status('Подключаемся…');
  try {
    await net.join(code);
    game.coop = { host: false };
    net.send(net.conns.keys().next().value, { t: 'hello', name });
    game.roster = [{ id: net.conns.keys().next().value, name: '…' }];
    $('oRoomCode').textContent = code; $('onStart').hidden = true; $('onRoom').hidden = false; renderRoom();
    status('Ты в комнате.');
  } catch (e) { onlineFail(e); } finally { onlineBusy = false; }
});
$('oCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('oGo').addEventListener('click', () => { if (!game.coop || !game.coop.host) return; sound.ui(); game.endless = false; startLevel(+$('oLevel').value || 0, true); });
$('oLeave').addEventListener('click', () => { sound.ui(); leaveCoop(); status(''); });
$('oMic').addEventListener('click', () => toggleMic());
$('bMic').addEventListener('click', () => toggleMic());
$('bHear').addEventListener('click', () => { net.unlockAudio(); sound.resume(); $('bHear').hidden = true; });
$('bChat').addEventListener('click', () => {
  const q = $('quick'); if (!q.children.length) QUICK.forEach((t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', () => { sendChat(t); hide('chatBox'); }); q.appendChild(b); });
  show('chatBox');
});
$('chatClose').addEventListener('click', () => hide('chatBox'));
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('chatIn').value); $('chatIn').value = ''; hide('chatBox'); });

// выбор уровня
function renderLevels() {
  const ul = $('lvList'); ul.textContent = '';
  THEMES.forEach((t, i) => {
    const li = document.createElement('li'); li.className = 'item click';
    li.innerHTML = '<span class="ic"></span><div><h3></h3><p></p></div>';
    const egg = t.secret && SAVE.ach.includes((SECRETS[t.secret] || {}).ach);
    li.querySelector('.ic').textContent = String(i);
    li.querySelector('h3').textContent = t.name + (egg ? ' ' + SECRETS[t.secret].ic : '');
    li.querySelector('p').textContent = t.tip;
    li.addEventListener('click', () => { sound.ui(); game.endless = false; startLevel(i, true); });
    ul.appendChild(li);
  });
}

// ---------- главный цикл ----------
let last = performance.now(), nextFrame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  // Android-экраны 90/120 Гц: без ограничения игра рисует до 120 кадров, телефон греется и сбрасывает частоты.
  // Держим ≤ 60 (Safari на iPhone ограничивает сам).
  if (isAndroid) { if (now < nextFrame - 1.5) return; nextFrame = Math.max(nextFrame + 1000 / 60, now); }
  const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now; tAll += dt;
  autoRes(rawDt);
  U.uTime.value = tAll;
  if (!lvl) return;
  const m = game.mode;
  if (m === 'menu' || m === 'splash' || m === 'prologue') {
    pl.yaw += dt * 0.07; pl.pitch = 0.03 + Math.sin(tAll * 0.3) * 0.03;
    const P = lights(dt, false);
    lvl.update(dt, tAll, P, 0.6);
    camera.position.set(pl.x, 1.6 + Math.sin(tAll * 0.8) * 0.01, pl.z);
    camera.rotation.set(pl.pitch, pl.yaw, 0);
    camera.fov = camera.aspect < 1 ? 92 : 72; camera.updateProjectionMatrix();
    setFX({ uNV: 0, uGrain: 0.045, uVig: 0.5, uAb: 0.08, uDist: 0, uRed: 0, uSat: 0.95, uFade: m === 'prologue' ? 1 : 0, uWhite: 0 }, dt);
  } else if (m === 'play') updatePlay(dt);
  else if (m === 'transition') updateTransition(dt);
  else if (m === 'scare') updateScare(dt);
  if (lvl) listener();
  const inGame = m === 'play' || m === 'transition' || m === 'scare' || m === 'reading';
  if (ent) sound.setEnt(ent.x, 1.8, ent.z);
  sound.frame(dt, {
    mode: (m === 'menu' || m === 'prologue') ? 'menu' : inGame ? 'game' : 'off',
    power: game.power * game.th.power, prox: game.prox, beacon: true, ent: !!(ent && ent.active), chase: !!(ent && ent.state === 'chase'),
    tin: clamp((40 - pl.san) / 40, 0, 1), wade: m === 'play' ? game.wade || 0 : 0, box: !!(lvl && lvl.secret), circus: !!(lvl && lvl.circus) && game.musicOn, black: game.black && inGame
  });
  if (game.coop) coopFrame(dt);
  if (m === 'ending') return;
  composer.render(dt);
}

// ---------- отладка ----------
// Включается на dev-сервере или по ?debug в адресе. Используется автотестами (scripts/shot.mjs).
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  const faceTo = (x, z) => Math.atan2(-(x - pl.x), -(z - pl.z));
  window.__zk = {
    game, pl, SAVE, renderer, scene, camera, sound, THREE, wrist, LOOK, bloom, amb, U, applyQuality, aoPass,
    get lvl() { return lvl; },
    get ent() { return ent; },
    get ready() { return game.mode === 'play' && !busy; },
    // запустить уровень сразу (без пролога); o: { seed, diff, secret }
    start(lv = 0, o = {}) { hideAllPanels(); return startLevel(lv, true, o); },
    god(on = true) { game.god = !!on; return game.god; },
    // усыпить монстра навсегда (для скриншотов уровня)
    calm() { if (ent) { ent.state = 'dormant'; ent.timer = 1e9; ent.m.group.visible = false; } },
    // разбудить монстра рядом с игроком
    wake() { if (ent) { ent.timer = 0; } },
    tp(x, z, yaw) { pl.x = x; pl.z = z; if (yaw !== undefined) pl.yaw = yaw; pl.vx = pl.vz = 0; pl.wake = 1; },
    look(yaw, pitch = 0) { pl.yaw = yaw; pl.pitch = pitch; },
    // встать перед дверью выхода и смотреть на неё
    toExit(dist = 2.2, i = 0) {
      const d = exitsOf()[i] || lvl.door;
      for (const s of [1, -1]) {
        const x = d.x + d.nx * dist * s, z = d.z + d.nz * dist * s;
        if (!blocked(x, z)) { this.tp(x, z, Math.atan2(-(d.x - x), -(d.z - z))); pl.pitch = 0.05; return true; }
      }
      return false;
    },
    // встать перед дивной находкой (kind или индекс) и смотреть на неё
    toFind(k = 0, dist) {
      const fs = game.finds || [], f = typeof k === 'number' ? fs[k] : fs.find((q) => q.kind === k);
      if (!f) return false;
      const [px, pz] = findPoint(f), dd = dist || f.radius + 3.2;
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2 + 0.4, x = px + Math.sin(ang) * dd, z = pz + Math.cos(ang) * dd;
        if (!blocked(x, z) && lvl.los(x, z, px, pz)) { this.tp(x, z, faceTo(px, pz)); pl.yaw = Math.atan2(-(px - x), -(pz - z)); pl.pitch = 0.08; return f.kind; }
      }
      return false;
    },
    finds() { return (game.finds || []).map((f) => f.kind + (f.found ? '*' : '')); },
    // встать перед ближайшим шкафчиком (смотреть на него) или залезть в него
    toLocker(inside = false, dist = 1.35) {
      let lk = null, bd = 1e9; for (const l of lvl.lockers) { const d = Math.hypot(l.x - pl.x, l.z - pl.z); if (d < bd) { bd = d; lk = l; } }
      if (!lk) return false;
      if (inside) { hideIn(lk); return true; }
      const x = lk.x + lk.fx * dist + lk.fz * 0.4, z = lk.z + lk.fz * dist - lk.fx * 0.4; this.tp(x, z, Math.atan2(-(lk.x - x), -(lk.z - z))); pl.pitch = 0.12; return true;
    },
    // поставить монстра перед игроком
    meet(dist = 4) {
      if (!ent) return false;
      const x = pl.x - Math.sin(pl.yaw) * dist, z = pl.z - Math.cos(pl.yaw) * dist;
      ent.appear(x, z, pl.x, pl.z); ent.state = 'roam'; return true;
    },
    info() {
      return { mode: game.mode, level: game.level, theme: game.th && game.th.name, san: +pl.san.toFixed(1), bat: +pl.bat.toFixed(1),
        x: +pl.x.toFixed(2), z: +pl.z.toFixed(2), ent: ent ? ent.state : null, entDist: ent ? +ent.dist.toFixed(1) : null,
        pr: renderer.getPixelRatio(), quality: SAVE.set.q, profile: quality, dev: `${DEV.platform}/${DEV.form}/t${DEV.tier}/${DEV.source}`, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    }
  };
}

// ---------- запуск ----------
async function boot() {
  const lm = $('loadMsg'); if (lm) lm.textContent = tr('load.graphics');
  // сила устройства → профиль «Авто»; detect-gpu рисует пробный кадр в наш контекст — сбросить кэш состояний three.js
  try { await detectDevice(renderer.getContext()); } catch (e) { /* остаётся оценка по имени GPU */ }
  renderer.resetState();
  applyQuality(); syncSettings();
  try { await Promise.race([document.fonts.ready, sleep(2500)]); await Promise.race([Promise.all(['700 100px Caveat', '600 30px "IBM Plex Mono"'].map((f) => document.fonts.load(f))), sleep(2000)]); } catch (e) { /* шрифты не критичны */ }
  if (lm) lm.textContent = tr('load.rooms');
  setAniso(anisoNow());
  try { demoPbr = await Promise.race([themeTex(theme(0)), sleep(15000).then(() => null)]); } catch (e) { demoPbr = null; }
  await frames(1);
  buildDemo();
  game.mode = 'splash';
  refreshMenu();
  requestAnimationFrame(loop);
  await frames(2);
  window.__zkReady = true;
  hide('loading'); show('splash');
}
boot().catch((e) => { console.error(e); window.__zkFail && window.__zkFail(tr('load.startError', { msg: e.message })); });
