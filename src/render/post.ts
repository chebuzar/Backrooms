// Постобробка на TSL: сцена (+нормалі, швидкості) → тіні в кутах (GTAO) → часове згладжування (TRAA)
// → свічення (bloom) → фінальний «об'єктив камери»: експозиція, AgX, грейдинг, аберація, віньєтка, зерно.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, uniform, Fn,
  vec2, vec3, vec4, float, screenUV, screenCoordinate, mix, smoothstep, dot, clamp, fract, sin, length,
  agxToneMapping, sRGBTransferOETF, max, time
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
  exposure: uniform(1.0),
  aoStrength: uniform(1.0),
  bloomStrength: uniform(0.55),
  bloomThreshold: uniform(0.9),
  grain: uniform(0.045),
  vignette: uniform(0.42),
  aberration: uniform(0.0025),
  distortion: uniform(0.06),
  saturation: uniform(0.92),
  /** Подих страху: посилює аберацію, віньєтку й зерно (0..1). */
  fear: uniform(0.0),
  /** Затемнення екрана (0 — нема, 1 — чорний). */
  fade: uniform(0.0),
  /** Червоний наліт при пошкодженні (0..1). */
  hurt: uniform(0.0),
  aspect: uniform(16 / 9)
};

export class PostPipeline {
  readonly pipeline: THREE.RenderPipeline;
  private profile: QualityProfile | null = null;

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // тон і sRGB робимо самі у фінальному проході
  }

  apply(profile: QualityProfile): void {
    this.profile = profile;
    const { scene, camera } = this;
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
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
      const aoValue = aoPass.getTextureNode().sample(screenUV).r;
      lit = lit.mul(mix(float(1), aoValue, look.aoStrength));
    }
    const aa = profile.traa ? traa(vec4(lit, 1), depthNode, velocityNode, camera) : null;
    const beauty = aa ? texOf(aa) : null;
    const S0 = (uv: V2) => (beauty ? beauty.sample(uv).rgb : colorNode.sample(uv).rgb);

    let bloomTex: ReturnType<typeof bloom> | null = null;
    if (profile.bloom > 0) {
      bloomTex = bloom(aa ?? vec4(lit, 1), look.bloomStrength.value, 0.55, look.bloomThreshold.value);
      bloomTex.strength = look.bloomStrength;
      bloomTex.threshold = look.bloomThreshold;
      bloomTex.setResolutionScale(profile.bloom);
    }
    const bloomNode = bloomTex ? texOf(bloomTex) : null;
    const S = (uv: V2) => (bloomNode ? S0(uv).add(bloomNode.sample(uv).rgb) : S0(uv));

    const finalPass = Fn(() => {
      const c = screenUV.sub(0.5);
      // об'єктив: легка бочкоподібна дисторсія + більше на страху
      const ca = vec2(c.x.mul(look.aspect), c.y);
      const r2 = dot(ca, ca);
      const k = look.distortion.add(look.fear.mul(0.05));
      const uvd = c.mul(float(1).add(k.mul(r2))).div(float(1).add(k.mul(0.35))).add(0.5).toVar();
      // хроматична аберація до країв
      const ab = c.mul(look.aberration.add(look.fear.mul(0.006))).mul(r2.mul(4).add(0.4));
      const col = vec3(S(uvd.add(ab)).r, S(uvd).g, S(uvd.sub(ab)).b).toVar();
      // експозиція й тональна компресія AgX (м'які світла, глибокі тіні)
      col.assign(agxToneMapping(col.mul(look.exposure), float(1)));
      // грейдинг: тіні трохи в холодну зелень, світла в теплий жовтий (флуоресцентні лампи)
      const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col.addAssign(vec3(-0.008, 0.004, 0.01).mul(float(1).sub(smoothstep(0, 0.4, lum))));
      col.addAssign(vec3(0.02, 0.012, -0.018).mul(smoothstep(0.5, 1, lum)));
      col.assign(mix(vec3(lum), col, look.saturation));
      // віньєтка
      const v = smoothstep(0.85, 0.2, length(ca).mul(float(1).add(look.vignette.add(look.fear.mul(0.4)))));
      col.mulAssign(mix(float(1), v, 0.85));
      // пошкодження: червоний край
      col.assign(mix(col, col.mul(vec3(1.25, 0.35, 0.3)).add(vec3(0.05, 0, 0)), look.hurt.mul(clamp(length(ca).mul(1.6), 0.2, 1))));
      // поза об'єктивом — чорне
      const edge = vec2(smoothstep(vec2(0.5), vec2(0.495), uvd.sub(0.5).abs()));
      col.mulAssign(edge.x.mul(edge.y));
      // плівкове зерно: сильніше в тінях
      const seed = screenCoordinate.xy.add(fract(time.mul(7.31)).mul(vec2(173.1, 91.7)));
      const n = fract(sin(dot(seed, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
      col.addAssign(n.mul(look.grain.add(look.fear.mul(0.04))).mul(mix(float(1.4), float(0.6), lum)));
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
