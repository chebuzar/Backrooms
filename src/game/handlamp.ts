// Ліхтар у руці Оператора: справжня модель (Poly Haven «Portable Searchlight», CC0) — армійський оливковий
// акумуляторний ліхтар-прожектор із ручкою зверху, як у радянських частинах і на об'єктах. Тримається за ручку,
// трохи нижче й правіше погляду; іде за рукою (Hand) з інерцією. Скло світиться самою ниткою лампи:
// заряд видно по ліхтарю (сідає батарея — нитка тьмяніє й жовтіє, перед смертю батареї — блимає).
// Промінь у запиленому повітрі — слабкий світлий конус, що закінчується там, куди влучив промінь (без «прорізання» стін).
import * as THREE from 'three/webgpu';
import { uniform, uv, smoothstep, pow, vec3, normalView, positionView, dot, abs } from 'three/tsl';
import type { Assets } from '../assets/loader';
import { probeLit } from '../world/materials';
import type { Hand } from './hand';

export class HandLamp {
  readonly root = new THREE.Group();
  /** Освітленість довкола гравця (від ламп) — щоб ліхтар у руці не світився в темряві й не був чорним під лампою. */
  private readonly E = uniform(0.4);
  private glass: THREE.MeshStandardNodeMaterial | null = null;
  private readonly beam: THREE.Mesh;
  private readonly beamK = uniform(0);
  private readonly model = new THREE.Group();
  private ready = false;

  constructor() {
    this.root.name = 'hand-lamp';
    this.root.add(this.model);
    // конус променя: вершина — у склі, довжина 1 м уздовж −Z (масштабується до точки влучання)
    const g = new THREE.CylinderGeometry(0.04, 0.34, 1, 32, 1, true);
    g.translate(0, -0.5, 0);
    g.rotateX(Math.PI / 2); // вісь циліндра → −Z (вершина в 0)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    // «об'єм» без справжнього туману: де дивимось крізь товщу конуса (поверхня до нас лицем) — світліше,
    // на силуеті — нуль (жодних різких країв); уздовж — яскравіше біля скла, згасає до кінця (uv.y: 1 — скло)
    const along = uv().y;
    const thick = pow(abs(dot(normalView, positionView.normalize())), 1.6);
    m.colorNode = vec3(1.0, 0.86, 0.64).mul(smoothstep(0.0, 0.85, along).mul(thick).mul(this.beamK).mul(0.06));
    this.beam = new THREE.Mesh(g, m);
    this.beam.name = 'flash-beam';
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 10;
    this.root.add(this.beam);
    this.root.visible = false;
  }

  async load(assets: Assets): Promise<void> {
    const gl = await assets.model('assets/models/flashlight.glb');
    const o = gl.scene.clone(true);
    o.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = probeLit(src, this.E as unknown as THREE.Node<'float'>, false);
      if (src.name.includes('glass')) {
        mat.emissive.setRGB(1.0, 0.72, 0.42);
        mat.emissiveIntensity = 0;
        this.glass = mat;
      }
      mesh.material = mat;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    });
    // модель: скло дивиться в +Z, центр скла — (0, 0, 0.12); тримаємо так, щоб скло було в точці руки й дивилось у −Z
    o.rotation.y = Math.PI;
    o.position.set(0, 0, 0.125);
    this.model.add(o);
    // у кисті ліхтар трохи розвернутий до центру й нахилений: видно бік, ручку й край скла, а не лише «зад»
    this.model.rotation.set(-0.06, 0.2, 0.08, 'YXZ');
    this.model.scale.setScalar(0.7); // менший і нижче: лише край ліхтаря в куті кадру, не «брусок» на пів екрана
    this.ready = true;
  }

  /**
   * hand — рука (положення скла й напрям); light — сила світла ліхтарика 0..1 (з урахуванням батареї й провалів);
   * reach — куди влучив промінь (м); visible — чи в руці зараз (не під час відеокамери, кат-сцени, меню).
   */
  update(hand: Hand, o: { light: number; low: number; reach: number; visible: boolean; E: number; dt: number }): void {
    this.root.visible = this.ready && o.visible;
    if (!this.root.visible) return;
    this.root.position.copy(hand.pos);
    this.root.quaternion.copy(hand.quat);
    this.E.value += (o.E - this.E.value) * Math.min(1, o.dt * 4);
    if (this.glass) {
      // сідає батарея (low < 1) — нитка не лише тьмяніє, а й червоніє: «жовта» лампа, як у старих акумуляторних ліхтарях
      const w = 1 - o.low;
      this.glass.emissive.setRGB(1.0, 0.72 - 0.22 * w, 0.42 - 0.3 * w);
      this.glass.emissiveIntensity = 2.2 * o.light;
    }
    // промінь видно лише в повітрі між склом і першою перешкодою
    const len = Math.max(0.05, Math.min(5, o.reach - 0.05));
    this.beam.scale.set(len, len, len);
    this.beamK.value = o.light * (0.55 + 0.45 * o.low);
    this.beam.visible = o.light > 0.02;
  }
}
