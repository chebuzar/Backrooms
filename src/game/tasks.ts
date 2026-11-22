// Задачі рівнів: що треба зробити, щоб Шов пропустив далі.
// • Рівень 0 «Бесконечный НИИ»: допуск — три печаті (відділ кадрів, Перший відділ, канцелярія), потім пред'явити на вахті.
// • Рівень 1 «Глубина-1»: три запобіжники в щит живлення біля Шва; рація з пораненим із шостої експедиції.
// • Рівень 2 «Парковка»: ключ від генераторної → завести генератор (гучний: приманює Сліпого).
// Стан — у збереженні (progress.items, ключі `рівень:річ`).
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import type { Level } from '../world/level0';
import { freeNear, lightProp, seamPlacement } from '../world/level0';
import { spotOnPath } from '../world/findings';
import { probeAt, probeLit } from '../world/materials';
import type { Interactions } from './interact';
import { TASKS, type TaskDef } from '../story/tasks';

export interface TaskDeps {
  have: (key: string) => boolean;
  give: (key: string) => void;
  say: (text: string, sec: number) => void;
  objective: (text: string) => void;
  sound: (name: 'take' | 'stamp' | 'fuse' | 'gen' | 'radio', x: number, y: number, z: number) => void;
  /** Генератор працює: гучний шум для мисливця. */
  noise: (x: number, z: number, loud: number) => void;
  radio: (x: number, z: number) => void;
}

interface Placed { def: TaskDef['items'][number]; obj: THREE.Object3D; x: number; y: number; z: number; yaw: number }

const mat = (color: number, E: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => probeLit(new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }), E);

/** Печатка на штемпельній подушці: дерев'яна ручка, гумова основа, синя подушка. */
function stampMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.08), mat(0x1d2c5e, E, { roughness: 0.9 }));
  pad.position.y = 0.009;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 20), mat(0x24221f, E));
  base.position.set(0.1, 0.007, 0);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.07, 14), mat(0x6b4426, E, { roughness: 0.45 }));
  handle.position.set(0.1, 0.05, 0);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), mat(0x6b4426, E, { roughness: 0.45 }));
  knob.position.set(0.1, 0.09, 0);
  g.add(pad, base, handle, knob);
  return g;
}

/** Плавкий запобіжник ПК-45: порцеляновий циліндр з латунними ковпачками. */
function fuseMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 16), mat(0xe8e3d6, E, { roughness: 0.3 }));
  const capM = mat(0xb08d4a, E, { roughness: 0.3, metalness: 0.9 });
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 16), capM); c.position.y = s * 0.04; g.add(c); }
  g.add(body);
  g.rotation.z = Math.PI / 2;
  return g;
}

/** Ключ на кільці з картонною біркою. */
function keyMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const metal = mat(0x8e877a, E, { roughness: 0.35, metalness: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0025, 8, 20), metal);
  ring.rotation.x = Math.PI / 2;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.003, 0.012), metal);
  blade.position.x = 0.045;
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.002, 0.028), mat(0xc9b98f, E, { roughness: 0.95 }));
  tag.position.set(-0.04, 0, 0.01); tag.rotation.y = 0.4;
  g.add(ring, blade, tag);
  g.position.y = 0.003;
  return g;
}

/** Щит живлення: сіро-зелена шафа на стіні з трьома гніздами й сигнальною лампою. */
function shieldMesh(E: number, lamp: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.18), mat(0x56604f, E, { roughness: 0.55, metalness: 0.3 }));
  box.position.z = 0.09;
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10), lamp);
  l.position.set(0.17, 0.27, 0.185);
  g.add(box, l);
  for (let i = 0; i < 3; i++) {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 14), mat(0x1c1c1a, E));
    sock.rotation.x = Math.PI / 2; sock.position.set(-0.12 + i * 0.12, -0.05, 0.19);
    g.add(sock);
  }
  return g;
}

/** Дизель-генератор: оливкова рама, бак, глушник. */
function generatorMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const olive = mat(0x4b5235, E, { roughness: 0.6, metalness: 0.35 });
  const dark = mat(0x222320, E, { roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.7), olive); body.position.y = 0.48;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 18), olive); tank.rotation.z = Math.PI / 2; tank.position.set(0, 1.0, 0);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12), dark); pipe.position.set(0.5, 1.1, -0.2);
  const skid = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.1, 0.8), dark); skid.position.y = 0.05;
  g.add(body, tank, pipe, skid);
  return g;
}

export class Tasks {
  private lvl: Level | null = null;
  private def: TaskDef | null = null;
  private placed: Placed[] = [];
  private gate: { x: number; y: number; z: number; yaw: number; obj: THREE.Object3D } | null = null;
  private radioAt: { x: number; y: number; z: number } | null = null;
  private lamp = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: 0.6 });
  private genT = 0;
  private genVoice = false;

  constructor(private readonly d: TaskDeps) {}

  private key(id: string): string { return `${this.lvl?.id ?? 0}:${id}`; }
  has(id: string): boolean { return this.d.have(this.key(id)); }

  /** Задача рівня виконана — Шов пропускає. */
  get gateOpen(): boolean { return !this.def || this.has(this.def.gate.id); }
  get running(): boolean { return this.def?.gate.kind === 'generator' && this.has(this.def.gate.id); }

  async build(assets: Assets, physics: Physics, lvl: Level, taken: { x: number; z: number }[]): Promise<void> {
    this.lvl = lvl;
    this.def = TASKS[lvl.id] ?? null;
    this.placed = []; this.gate = null; this.radioAt = null; this.genVoice = false;
    const def = this.def;
    if (!def) return;
    const L = lvl.layout, busy = [...taken];
    const desk = def.items.some((i) => i.kind === 'stamp') || def.gate.kind === 'vahta' ? await assets.model('assets/models/desk.glb') : null;
    const box = await assets.model('assets/models/box.glb');
    const sp = lvl.seam.group.position;
    busy.push({ x: sp.x, z: sp.z }, { x: L.spawn.x, z: L.spawn.z });
    // предмет біля стіни: стіл (печатка) або ящик (запобіжник, ключ)
    const atWall = (frac: number, depth: number) => {
      const p = spotOnPath(lvl, frac, busy);
      const s = seamPlacement(L, p.x, p.z);
      const nx = Math.sin(s.yaw), nz = Math.cos(s.yaw);
      busy.push({ x: s.x, z: s.z });
      return { x: s.x + nx * depth, z: s.z + nz * depth, yaw: s.yaw };
    };
    for (const it of def.items) {
      const onDesk = it.kind === 'stamp';
      const at = atWall(it.at, onDesk ? 0.45 : 0.3);
      const E = probeAt(L.lights, at.x, at.z);
      const stand = (onDesk ? desk : box)?.scene.clone(true);
      let top = 0.45;
      if (stand) {
        stand.position.set(at.x, 0, at.z);
        stand.rotation.y = at.yaw + (onDesk ? Math.PI : 0.2);
        lightProp(stand, E);
        lvl.scene.add(stand);
        stand.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(stand), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
        top = bb.max.y;
        physics.addBox(c.x, c.y, c.z, Math.max(0.05, s.x / 2 - 0.02), s.y / 2, Math.max(0.05, s.z / 2 - 0.02), 0, G.PROP);
      }
      if (this.has(it.id)) continue; // уже взято/поставлено
      const obj = it.kind === 'stamp' ? stampMesh(E) : it.kind === 'fuse' ? fuseMesh(E) : keyMesh(E);
      obj.position.set(at.x, top + 0.002, at.z);
      obj.rotation.y = at.yaw + 0.6;
      if (it.kind === 'fuse') obj.position.y += 0.018;
      lvl.scene.add(obj);
      this.placed.push({ def: it, obj, x: at.x, y: top + 0.03, z: at.z, yaw: at.yaw });
    }
    // «ворота»: вахта (стіл із журналом і телефоном), щит живлення або генератор — поруч із Швом
    const g = def.gate;
    const near = freeNear(L, sp.x + Math.sin(lvl.seam.group.rotation.y) * 2.2, sp.z + Math.cos(lvl.seam.group.rotation.y) * 2.2, 0.8);
    const gw = seamPlacement(L, near[0], near[1], [{ t: 'door', x: sp.x, y: 0, z: sp.z, yaw: 0, w: 1.6 }]);
    const nx = Math.sin(gw.yaw), nz = Math.cos(gw.yaw), E = probeAt(L.lights, gw.x, gw.z);
    let obj: THREE.Object3D;
    let gy: number;
    if (g.kind === 'vahta' && desk) {
      obj = desk.scene.clone(true);
      obj.position.set(gw.x + nx * 0.5, 0, gw.z + nz * 0.5);
      obj.rotation.y = gw.yaw + Math.PI;
      lightProp(obj, E);
      try {
        const ph = (await assets.model('assets/models/phone.glb')).scene.clone(true);
        ph.position.set(gw.x + nx * 0.4 - nz * 0.35, 0.77, gw.z + nz * 0.4 + nx * 0.35);
        ph.rotation.y = gw.yaw;
        lightProp(ph, E);
        lvl.scene.add(ph);
      } catch { /* без телефона */ }
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), mat(0x5a2620, E, { roughness: 0.8 }));
      book.position.set(gw.x + nx * 0.5 + nz * 0.15, 0.78, gw.z + nz * 0.5 - nx * 0.15);
      book.rotation.y = gw.yaw + 0.15;
      lvl.scene.add(book);
      gy = 0.8;
      physics.addBox(gw.x + nx * 0.5, 0.4, gw.z + nz * 0.5, 0.7, 0.4, 0.4, gw.yaw, G.PROP);
    } else if (g.kind === 'shield') {
      obj = shieldMesh(E, this.lamp);
      obj.position.set(gw.x, 1.35, gw.z);
      obj.rotation.y = gw.yaw;
      gy = 1.35;
      if (this.has(g.id)) this.lamp.emissive.setHex(0x30ff60);
    } else {
      // справжня модель генератора (Poly Haven, CC0); якщо не завантажилась — проста рама
      try { obj = (await assets.model('assets/models/generator.glb')).scene.clone(true); lightProp(obj, E); }
      catch { obj = generatorMesh(E); }
      obj.position.set(gw.x + nx * 0.6, 0, gw.z + nz * 0.6);
      obj.rotation.y = gw.yaw;
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      gy = Math.max(0.5, bb.max.y * 0.8);
      physics.addBox(c.x, c.y, c.z, sz.x / 2, sz.y / 2, sz.z / 2, 0, G.PROP);
    }
    lvl.scene.add(obj);
    this.gate = { x: gw.x + nx * 0.45, y: gy, z: gw.z + nz * 0.45, yaw: gw.yaw, obj };
    // рація пораненого (рівень 1)
    if (def.radio !== undefined) {
      const at = atWall(def.radio, 0.3);
      const E2 = probeAt(L.lights, at.x, at.z);
      const st = box.scene.clone(true);
      st.position.set(at.x, 0, at.z); st.rotation.y = at.yaw;
      lightProp(st, E2); lvl.scene.add(st);
      st.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(st).max.y;
      const radio = (await assets.model('assets/models/radio.glb')).scene.clone(true);
      radio.position.set(at.x, top + 0.005, at.z); radio.rotation.y = at.yaw;
      lightProp(radio, E2); lvl.scene.add(radio);
      radio.updateMatrixWorld(true);
      this.radioAt = { x: at.x, y: (top + new THREE.Box3().setFromObject(radio).max.y) / 2, z: at.z };
    }
    physics.step();
  }

  /** Де стоять речі задачі (щоб обстановка рівня їх не закрила). */
  spots(): { x: number; z: number }[] {
    const out = this.placed.map((p) => ({ x: p.x, z: p.z }));
    if (this.gate) out.push({ x: this.gate.x, z: this.gate.z });
    if (this.radioAt) out.push({ x: this.radioAt.x, z: this.radioAt.z });
    return out;
  }

  /** Поточна мета для рядка цілі й блокнота. */
  objective(): string | null {
    const def = this.def;
    if (!def) return null;
    if (this.has(def.gate.id)) return def.done;
    const got = def.items.filter((i) => this.has(i.id)).length;
    return got < def.items.length ? def.collect.replace('{n}', String(got)).replace('{of}', String(def.items.length)) : def.gate.goal;
  }

  items(): { text: string; done: boolean }[] {
    const def = this.def;
    if (!def) return [];
    return [...def.items.map((i) => ({ text: i.label, done: this.has(i.id) })), { text: def.gate.label, done: this.has(def.gate.id) }];
  }

  register(ia: Interactions): void {
    for (const p of this.placed) {
      const it = p.def;
      ia.add({ id: `task-${it.id}`, x: p.x, y: p.y, z: p.z, reach: 1.7, prompt: it.prompt, enabled: true, use: () => {
        this.d.give(this.key(it.id));
        this.d.sound(it.kind === 'stamp' ? 'stamp' : 'take', p.x, p.y, p.z);
        if (it.kind !== 'stamp') p.obj.removeFromParent();
        ia.remove(`task-${it.id}`);
        this.d.say(it.got, 3.5);
        const o = this.objective();
        if (o) this.d.objective(o);
      } });
    }
    const g = this.gate, def = this.def;
    if (g && def && !this.has(def.gate.id)) {
      ia.add({ id: 'task-gate', x: g.x, y: g.y, z: g.z, reach: 1.9, enabled: true,
        get prompt() { return def.gate.prompt; },
        use: () => {
          const ready = def.items.every((i) => this.has(i.id));
          if (!ready) { this.d.say(def.gate.notReady, 3.5); return; }
          this.d.give(this.key(def.gate.id));
          ia.remove('task-gate');
          if (def.gate.kind !== 'generator') this.d.sound(def.gate.kind === 'shield' ? 'fuse' : 'stamp', g.x, g.y, g.z);
          if (def.gate.kind === 'shield') this.lamp.emissive.setHex(0x30ff60);
          this.d.say(def.gate.got, 6);
          const o = this.objective();
          if (o) this.d.objective(o);
        } });
    }
    const r = this.radioAt;
    if (r) ia.add({ id: 'task-radio', x: r.x, y: r.y, z: r.z, reach: 1.7, prompt: 'Слушать рацию', enabled: true, use: () => { ia.remove('task-radio'); this.d.radio(r.x, r.z); } });
  }

  /** Генератор працює: гуде й гримить — Сліпий іде на звук. */
  update(dt: number): void {
    const g = this.gate;
    if (!g || !this.running) return;
    if (!this.genVoice) { this.genVoice = true; this.d.sound('gen', g.x, 0.6, g.z); }
    g.obj.position.y = Math.sin(performance.now() * 0.09) * 0.004;
    this.genT -= dt;
    if (this.genT <= 0) { this.genT = 1.5; this.d.noise(g.x, g.z, 1); }
  }
}
