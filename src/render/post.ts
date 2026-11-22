// Постобробка на TSL: сцена (+нормалі, швидкості) → тіні в кутах (GTAO) → часове згладжування (TRAA)
// → свічення (bloom) → «радянська плівка»: експозиція, ACES, плівкова крива й грейдинг палітри рівня, halation, дрібне зерно
// в напівтонах. Без рамки й вигину: віньєтка, аберація й «плавання» — лише від страху; видошукач — лише з камерою в руках.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, uniform, Fn,
  vec2, vec3, vec4, float, screenUV, screenCoordinate, mix, smoothstep, dot, clamp, fract, sin, length,
  neutralToneMapping, acesFilmicToneMapping, agxToneMapping, sRGBTransferOETF, max, time
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { QualityProfile } from './quality';

type V2 = THREE.Node<'vec2'>;
/** TRAANode/BloomNode мають getTextureNode(), але в типах @types/three його ще немає. */
const texOf = (n: unknown) => (n as { getTextureNode(): THREE.TextureNode }).getTextureNode();

/** Параметри «камери», які змінює гра (страх, пошкодження, затемнення). */
export const look = {
  exposure: uniform(1.9),
  aoStrength: uniform(1.0),
  bloomStrength: uniform(0.32),
  bloomThreshold: uniform(1.05),
  grain: uniform(0.012),
  /** Постійна віньєтка — 0 (рішення власника 21.11: затемнення країв лише від страху). */
  vignette: uniform(0.0),
  aberration: uniform(0.0),
  saturation: uniform(1.0),
  /** Камера піднята до ока (0..1): холодніший кадр видошукача, легка віньєтка об'єктива. */
  cam: uniform(0.0),
  /** Нерви (0 — спокій, 1 — на межі): світ вицвітає й «пливе». */
  dread: uniform(0.0),
  /** Подих страху: посилює аберацію, віньєтку й зерно (0..1). */
  fear: uniform(0.0),
  /** Затемнення екрана (0 — нема, 1 — чорний). */
  fade: uniform(0.0),
  /** Червоний наліт при пошкодженні (0..1). */
  hurt: uniform(0.0),
  aspect: uniform(16 / 9)
};

/** Палітра «радянської плівки» рівня: відтінок тіней і світел, підняті чорні, насиченість, контраст, колір halation. */
export interface FilmLook { shadow: [number, number, number]; high: [number, number, number]; lift: [number, number, number]; sat: number; contrast: number; halation: [number, number, number] }
const film = {
  shadow: uniform(new THREE.Vector3(0.0, 0.0, 0.0)),
  high: uniform(new THREE.Vector3(0.0, 0.0, 0.0)),
  lift: uniform(new THREE.Vector3(0.02, 0.02, 0.02)),
  sat: uniform(0.88),
  contrast: uniform(1.0),
  halation: uniform(new THREE.Vector3(1.0, 0.85, 0.75))
};
/** Палітри рівнів (ART.md §2): 0 НИИ — охра й оливкові тіні; 1 база — холодна зелень; 2 парковка — натрій і синя тінь. */
export const FILM: Record<number, FilmLook> = {
  0: { shadow: [-0.012, 0.006, -0.004], high: [0.024, 0.012, -0.03], lift: [0.009, 0.009, 0.007], sat: 0.82, contrast: 1.06, halation: [1.0, 0.78, 0.64] },
  1: { shadow: [-0.009, 0.005, 0.003], high: [0.0, 0.016, 0.006], lift: [0.003, 0.004, 0.0035], sat: 0.78, contrast: 1.08, halation: [0.86, 0.92, 0.9] },
  2: { shadow: [-0.006, -0.001, 0.008], high: [0.03, 0.01, -0.03], lift: [0.0035, 0.003, 0.004], sat: 0.84, contrast: 1.1, halation: [1.0, 0.7, 0.5] },
  // дитсадок: вицвіла «Свема» — тіні зеленкувато-бурі, світло тепле, жовтаве, як від старих ламп розжарювання
  3: { shadow: [-0.004, 0.006, -0.006], high: [0.03, 0.018, -0.026], lift: [0.008, 0.007, 0.004], sat: 0.74, contrast: 1.04, halation: [1.0, 0.82, 0.58] },
  // басейн: холодна хлорна бірюза в тінях, біле кахельне світло
  4: { shadow: [-0.012, 0.006, 0.01], high: [-0.004, 0.012, 0.01], lift: [0.002, 0.005, 0.006], sat: 0.8, contrast: 1.09, halation: [0.78, 0.94, 1.0] }
};
export function setFilm(level: number): void {
  const f = FILM[level] ?? FILM[0] as FilmLook;
  film.shadow.value.set(...f.shadow); film.high.value.set(...f.high); film.lift.value.set(...f.lift);
  film.sat.value = f.sat; film.contrast.value = f.contrast; film.halation.value.set(...f.halation);
}
setFilm(0);

/** Тональна корекція (правило власника: AgX або ACES). ?tm=agx|aces|neutral — для порівняння скріншотами. */
const TM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tm') : null;
const TONEMAP = TM === 'neutral' ? neutralToneMapping : TM === 'agx' ? agxToneMapping : acesFilmicToneMapping;

export class PostPipeline {
  readonly pipeline: THREE.RenderPipeline;
  private profile: QualityProfile | null = null;
  /** Вузли з власними буферами (render targets): звільняються при перебудові. */
  private owned: { dispose(): void }[] = [];
  private scenePass: ReturnType<typeof pass> | null = null;
  private sceneMRT: ReturnType<typeof mrt> | null = null;

  constructor(private readonly renderer: THREE.WebGPURenderer, public scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // тон і sRGB робимо самі у фінальному проході
  }

  /** Інша сцена (новий рівень) — той самий конвеєр, без перебудови й нових буферів. */
  setScene(scene: THREE.Scene, profile: QualityProfile): void {
    this.scene = scene;
    if (this.scenePass && this.profile === profile) this.scenePass.scene = scene;
    else this.apply(profile);
  }

  apply(profile: QualityProfile): void {
    this.profile = profile;
    for (const n of this.owned) n.dispose();
    this.owned = [];
    const { scene, camera } = this;
    const scenePass = pass(scene, camera);
    this.scenePass = scenePass;
    this.owned.push(scenePass);
    // той самий MRT-вузол на всі перебудови: three.js ключує ним кеш шейдерів сцени. Новий вузол при зміні пресета
    // означав, що КОЖЕН матеріал рівня збирався заново при першому погляді на нього — ривки після автозниження якості.
    this.sceneMRT ??= mrt({ output, normal: packNormalToRGB(normalView), velocity });
    scenePass.setMRT(this.sceneMRT);
    const normalTex = scenePass.getTexture('normal');
    normalTex.type = THREE.UnsignedByteType; // нормалям вистачає 8 біт — удвічі менше пам'яті й трафіку
    const colorNode = scenePass.getTextureNode('output');
    const depthNode = scenePass.getTextureNode('depth');
    const velocityNode = scenePass.getTextureNode('velocity');

    let lit = colorNode.rgb;
    if (profile.ao > 0) {
      const normalSample = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uv)));
      const aoPass = ao(depthNode, normalSample, camera);
      aoPass.resolutionScale = profile.ao;
      aoPass.useTemporalFiltering = profile.traa; // шум GTAO гасить TRAA
      aoPass.radius.value = 0.6;
      aoPass.thickness.value = 1.2;
      this.owned.push(aoPass);
      const aoValue = aoPass.getTextureNode().sample(screenUV).r;
      lit = lit.mul(mix(float(1), aoValue, look.aoStrength));
    }
    const aa = profile.traa ? traa(vec4(lit, 1), depthNode, velocityNode, camera) : null;
    if (aa) this.owned.push(aa);
    const beauty = aa ? texOf(aa) : null;
    const S0 = (uv: V2) => (beauty ? beauty.sample(uv).rgb : colorNode.sample(uv).rgb);

    let bloomTex: ReturnType<typeof bloom> | null = null;
    if (profile.bloom > 0) {
      bloomTex = bloom(aa ?? vec4(lit, 1), look.bloomStrength.value, 0.32, look.bloomThreshold.value);
      this.owned.push(bloomTex);
      bloomTex.strength = look.bloomStrength;
      bloomTex.threshold = look.bloomThreshold;
      bloomTex.setResolutionScale(profile.bloom);
    }
    const bloomNode = bloomTex ? texOf(bloomTex) : null;
    // halation плівки: сяйво довкола ламп трохи червонувате (світло розсіюється в підкладці емульсії)
    const S = (uv: V2) => (bloomNode ? S0(uv).add(bloomNode.sample(uv).rgb.mul(film.halation)) : S0(uv));

    const finalPass = Fn(() => {
      const c = screenUV.sub(0.5);
      const ca = vec2(c.x.mul(look.aspect), c.y);
      const r2 = dot(ca, ca);
      // «плавання» картинки лише від страху й нервів: легке дихання лінзи, без вигину країв і чорних кутів
      const wob = look.fear.mul(0.012).add(look.dread.mul(0.006));
      const uvd = c.mul(float(1).add(wob.mul(sin(time.mul(1.7)).mul(r2).mul(4)))).add(0.5).toVar();
      // аберація — лише від страху (за замовчуванням нуль)
      const ab = c.mul(look.aberration.add(look.fear.mul(0.0045)).add(look.dread.mul(0.0015))).mul(r2.mul(4).add(0.4));
      const col = vec3(S(uvd.add(ab)).r, S(uvd).g, S(uvd.sub(ab)).b).toVar();
      col.assign(TONEMAP(col.mul(look.exposure), float(1)));
      // плівкова крива: контраст довкола середнього сірого, м'яко підняті чорні (вицвіла плівка)
      col.assign(clamp(col.sub(0.42).mul(film.contrast).add(0.42), 0, 1));
      const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // розщеплене тонування: відтінок тіней і світел палітри рівня
      // (у лінійному просторі: чисті чорні не тонуємо — інакше темрява стає синьою/бірюзовою після sRGB)
      col.addAssign(film.shadow.mul(smoothstep(0, 0.1, lum)).mul(float(1).sub(smoothstep(0, 0.45, lum))));
      col.addAssign(film.high.mul(smoothstep(0.45, 1, lum)));
      col.assign(mix(vec3(lum), col, film.sat.mul(look.saturation).mul(float(1).sub(look.dread.mul(0.35)))));
      col.assign(col.mul(float(1).sub(film.lift)).add(film.lift));
      // видошукач камери: трохи холодніше й зеленкувато (відикон), легка віньєтка об'єктива
      col.assign(mix(col, col.mul(vec3(0.93, 1.0, 1.02)), look.cam));
      // віньєтка — від страху, нервів і об'єктива камери (постійної немає)
      const vk = look.vignette.add(look.fear.mul(0.55)).add(look.dread.mul(0.3)).add(look.cam.mul(0.25));
      const v = smoothstep(0.95, 0.25, length(ca).mul(float(1).add(vk)));
      col.mulAssign(mix(float(1), v, clamp(vk.mul(1.4), 0, 0.9)));
      // пошкодження: червоний край
      col.assign(mix(col, col.mul(vec3(1.25, 0.35, 0.3)).add(vec3(0.05, 0, 0)), look.hurt.mul(clamp(length(ca).mul(1.6), 0.2, 1))));
      // дрібне плівкове зерно лише в напівтонах (у глибоких тінях і світлах майже немає — жодного «снігу»)
      const seed = screenCoordinate.xy.add(fract(time.mul(7.31)).mul(vec2(173.1, 91.7)));
      const n = fract(sin(dot(seed, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
      const mid = lum.mul(float(1).sub(lum)).mul(4);
      col.addAssign(n.mul(look.grain.add(look.fear.mul(0.012)).add(look.cam.mul(0.01))).mul(mid));
      col.mulAssign(float(1).sub(look.fade));
      return vec4(sRGBTransferOETF(max(col, vec3(0))) as THREE.Node<'vec3'>, 1);
    });

    this.pipeline.outputNode = finalPass();
    this.pipeline.needsUpdate = true;
  }

  get current(): QualityProfile | null { return this.profile; }

  render(): void {
    this.pipeline.render();
  }
}
