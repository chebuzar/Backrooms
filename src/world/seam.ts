// «Шов»: вертикальний розріз у реальності на поверхні стіни. Холодне біло-блакитне світло, рваний край,
// повільна «пульсація», власне живе світло, що холодить жовті стіни довкола.
import * as THREE from 'three/webgpu';
import { uv, time, vec3, float, abs, smoothstep, sin, mix, fract, uniform } from 'three/tsl';

export class Seam {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  readonly open = uniform(0); // 0 — ледь помітна щілина, 1 — розкрита
  /** 1 — Шов є; 0 — затягнувся без сліду (Шов прибуття за спиною гравця). */
  readonly life = uniform(1);

  constructor(x: number, z: number, yaw: number, height: number) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const u = uv();
    // рваний край: ширина щілини «тремтить» уздовж висоти
    const jag = sin(u.y.mul(41.0).add(time.mul(1.3))).mul(0.012).add(sin(u.y.mul(113.0).sub(time.mul(2.1))).mul(0.006));
    const halfW = float(0.006).add(this.open.mul(0.08)).add(jag.abs());
    const d = abs(u.x.sub(0.5).add(jag.mul(0.5)));
    const core = smoothstep(halfW, halfW.mul(0.2), d);
    const glow = smoothstep(halfW.mul(6.0), float(0), d).mul(0.12);
    const ends = smoothstep(0.0, 0.18, u.y).mul(smoothstep(1.0, 0.82, u.y));
    const pulse = sin(time.mul(0.9)).mul(0.15).add(0.85).add(fract(time.mul(0.37)).mul(0.05));
    const intensity = core.mul(3.2).add(glow).mul(ends).mul(pulse);
    mat.colorNode = mix(vec3(0.55, 0.8, 1.0), vec3(1.0), core).mul(intensity).mul(this.life);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, height * 0.86), mat);
    plane.position.set(0, height * 0.46, 0);
    plane.renderOrder = 5;
    this.group.add(plane);
    // холодна «паморозь» довкола розрізу: на жовтій стіні — блакитна пляма, ніби тут холодніше
    const frostMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const fu = uv().sub(0.5).mul(vec3(1.0, 0.55, 1).xy);
    const fr = fu.length();
    frostMat.colorNode = vec3(0.03, 0.08, 0.16).mul(smoothstep(0.45, 0.0, fr)).mul(sin(time.mul(0.6)).mul(0.1).add(0.9)).mul(this.life);
    const frost = new THREE.Mesh(new THREE.PlaneGeometry(2.4, height * 0.95), frostMat);
    frost.position.set(0, height * 0.47, -0.002);
    frost.renderOrder = 4;
    this.group.add(frost);
    this.light = new THREE.PointLight(0x7fb8ff, 1.6, 7, 2);
    this.light.position.set(0, height * 0.5, 0.25);
    this.group.add(this.light);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }

  update(t: number): void {
    this.light.intensity = (1.5 + Math.sin(t * 0.9) * 0.25 + (Math.sin(t * 13.7) > 0.97 ? 1.2 : 0)) * (1 + this.open.value * 3) * this.life.value;
    // ховаємо лише видиму частину: світло лишається в сцені з нульовою яскравістю. Якщо прибрати джерело світла,
    // three.js перебудовує шейдери ВСІХ освітлених матеріалів — це ривок саме тоді, коли Шов прибуття затягується.
    const on = this.life.value > 0.001;
    for (const c of this.group.children) if (c !== this.light) c.visible = on;
  }
}
