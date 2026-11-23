// Фізика речей у грі: що взяти, як тримати, покласти й кинути; звуки ударів; скло, що б'ється на друзки
// (настільна лампа об підлогу, стельовий плафон від кинутої речі — лампа гасне, довкола темніє); шум для монстрів.
// Сама фізика — physics/knock.ts (тіла) і physics/carry.ts (рука); тут — гра довкола них.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute } from 'three/tsl';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from '../physics/physics';
import type { Knockables, KnockKind, PropItem } from '../physics/knock';
import { Carry, type Eye } from '../physics/carry';
import type { Player } from './player';
import type { AudioEngine } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import type { Lamps } from '../world/lamps';
import type { LightPanel } from '../world/layout';
import { probeLit } from '../world/materials';

/** Скільки уламків скла живе одночасно (найстаріші зникають). */
const SHARDS = 40;

export interface PropDeps {
  physics: Physics;
  knock: Knockables;
  audio: AudioEngine;
  sfx: SoundBank;
  /** Шум для монстрів (гучність 0..1). */
  noise(x: number, y: number, z: number, loud: number): void;
}

interface Shard { body: RAPIER.RigidBody | null; t: number }

const SOUND: Record<KnockKind, string> = { wood: 'knock_wood_', metal: 'knock_metal_', soft: 'knock_soft_', paper: 'knock_soft_', glass: 'glass_hit_' };

export class PropPlay {
  readonly carry: Carry;
  /** Уламки скла: один InstancedMesh (прогрівається з рівнем, поки всі сховані). */
  private shardMesh: THREE.InstancedMesh | null = null;
  private shardE: THREE.InstancedBufferAttribute | null = null;
  private readonly shards: Shard[] = Array.from({ length: SHARDS }, () => ({ body: null, t: 0 }));
  private nextShard = 0;
  private lamps: Lamps | null = null;
  private panels: LightPanel[] = [];
  private ceiling = 3;
  private probe: (x: number, z: number) => number = () => 1;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly eyeV: Eye = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, yaw: 0 };

  constructor(private readonly d: PropDeps) {
    this.carry = new Carry(d.physics, d.knock);
    const k = d.knock;
    k.onImpact = (x, y, z, s, kind, topple, thrown) => {
      // стілець перекинувся, відро покотилось, кинута книга вдарилась об стіну: справжній звук — і монстр чує
      const b = d.sfx.pick(topple && kind === 'wood' ? 'topple_' : SOUND[kind]);
      const soft = kind === 'soft' || kind === 'paper';
      if (b) d.audio.play3D(b, x, y, z, { gain: (soft ? 0.3 : 0.4) + s * 0.6, rate: (soft ? 1.1 : 0.92) + Math.random() * 0.14, ref: 2.5, wet: 0.45 });
      // кинута річ гримить для монстра сильніше: він іде туди, де впало, а не туди, де стоїш ти
      if (!soft || s > 0.5 || thrown) d.noise(x, y, z, Math.min(1, 0.25 + s * 0.75 + (thrown ? 0.3 : 0)));
    };
    k.onBreak = (_it, x, y, z, vx, vy, vz) => this.glass(x, y + 0.15, z, 7, vx * 0.3, vy * 0.2, vz * 0.3);
    k.onFlight = (it, x, y, z, speed) => this.hitCeiling(it, x, y, z, speed);
    this.carry.onGrab = (it) => this.handSound(it, 0.7);
    this.carry.onRelease = (it, thrown) => { if (thrown) this.handSound(it, 1); };
  }

  /** Новий рівень: лампи, висота стелі, освітленість, уламки — у сцену заздалегідь (усі сховані). */
  attach(scene: THREE.Scene, lamps: Lamps, panels: LightPanel[], ceiling: number, probe: (x: number, z: number) => number): void {
    this.carry.reset();
    this.lamps = lamps; this.panels = panels; this.ceiling = ceiling; this.probe = probe;
    this.d.knock.probe = probe;
    for (const sh of this.shards) { sh.body = null; sh.t = 0; }
    // уламок — неправильний трикутник товстого скла (плафон, колба лампи): 1–3 см
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, 0, -0.008, 0.014, 0, -0.004, -0.002, 0, 0.013, -0.012, 0.003, -0.008, 0.014, 0.003, -0.004, -0.002, 0.003, 0.013], 3));
    g.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]);
    g.computeVertexNormals();
    this.shardE = new THREE.InstancedBufferAttribute(new Float32Array(SHARDS).fill(1), 1);
    const glass = new THREE.MeshStandardMaterial({ color: 0xd8dccf, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55 });
    this.shardMesh = new THREE.InstancedMesh(g, probeLit(glass, instancedBufferAttribute(this.shardE) as unknown as THREE.Node<'float'>), SHARDS);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.name = 'glass-shards';
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < SHARDS; i++) this.shardMesh.setMatrixAt(i, this.m);
    scene.add(this.shardMesh);
  }

  /** Очі й погляд гравця (на кроці фізики — з позиції тіла, а не з камери, що згладжується). */
  eye(pl: Player): Eye {
    const e = this.eyeV, cp = Math.cos(pl.pitch);
    e.x = pl.pos.x; e.y = pl.pos.y + pl.eye; e.z = pl.pos.z;
    e.dx = -Math.sin(pl.yaw) * cp; e.dy = Math.sin(pl.pitch); e.dz = -Math.cos(pl.yaw) * cp;
    e.yaw = pl.yaw;
    return e;
  }

  /** Крок фізики: рука тягне річ (до world.step). */
  step(dt: number, pl: Player): void { this.carry.step(dt, this.eye(pl)); }

  /** Після кроків фізики: уламки скла, що ще летять. */
  sync(dt: number): void {
    const mesh = this.shardMesh;
    if (!mesh) return;
    let dirty = false;
    for (let i = 0; i < SHARDS; i++) {
      const sh = this.shards[i] as Shard;
      if (!sh.body) continue;
      sh.t += dt;
      if (sh.body.isSleeping()) continue;
      const t = sh.body.translation(), r = sh.body.rotation();
      mesh.setMatrixAt(i, this.m.compose(this.p.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), this.s));
      dirty = true;
      // друзки дзенькають, коли падають (тихо, лише перші миті)
      if (sh.t < 1.2 && t.y < 0.05 && Math.random() < 0.04) { const b = this.d.sfx.pick('glass_hit_'); if (b) this.d.audio.play3D(b, t.x, t.y, t.z, { gain: 0.12, rate: 1.3 + Math.random() * 0.4, ref: 1.5, wet: 0.3 }); }
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Скло б'ється: звук, шум, уламки розлітаються з точки. */
  glass(x: number, y: number, z: number, n: number, vx = 0, vy = 0, vz = 0, loud = 0.85): void {
    const b = this.d.sfx.pick('glass_break_');
    if (b) this.d.audio.play3D(b, x, y, z, { gain: 0.9, rate: 0.95 + Math.random() * 0.12, ref: 3, wet: 0.55 });
    this.d.noise(x, y, z, loud);
    const R = this.d.physics.R, w = this.d.physics.world, E = this.probe(x, z);
    for (let k = 0; k < n; k++) {
      const i = this.nextShard; this.nextShard = (this.nextShard + 1) % SHARDS;
      const sh = this.shards[i] as Shard;
      if (sh.body) w.removeRigidBody(sh.body);
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.2;
      sh.body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1)
        .setLinvel(vx + Math.cos(a) * sp, vy + Math.random() * 1.5, vz + Math.sin(a) * sp)
        .setAngvel({ x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 30 })
        .setLinearDamping(0.2).setAngularDamping(1.5).setCanSleep(true));
      w.createCollider(R.ColliderDesc.cuboid(0.012, 0.002, 0.01).setDensity(2500).setFriction(0.7).setRestitution(0.25)
        .setCollisionGroups(groups(G.PROP, G.STATIC | G.DOOR)), sh.body);
      sh.t = 0;
      this.shardE?.setX(i, E);
    }
    if (this.shardE) this.shardE.needsUpdate = true;
  }

  /** Кинута річ біля стелі: влучила в плафон — лампа лопає, гасне назавжди, на підлогу сиплеться скло. */
  private hitCeiling(it: PropItem, x: number, y: number, z: number, speed: number): void {
    if (!this.lamps || y + it.size * 0.4 < this.ceiling - 0.3 || speed < 2.5) return;
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i] as LightPanel;
      if (Math.abs(p.x - x) > p.w / 2 + 0.12 || Math.abs(p.z - z) > p.d / 2 + 0.12) continue;
      const lit = this.lamps.levelOf(i) > 0.05;
      this.lamps.kill(i);
      this.glass(p.x, this.ceiling - 0.08, p.z, lit ? 12 : 8, 0, -0.5, 0, 1);
      // річ відскакує від плафона вниз
      const v = it.body.linvel();
      it.body.setLinvel({ x: v.x * 0.5, y: -Math.abs(v.y) * 0.4, z: v.z * 0.5 }, true);
      it.thrown = Math.min(it.thrown, 0.6);
      return;
    }
  }

  private handSound(it: PropItem, gain: number): void {
    const b = this.d.sfx.pick(it.spec.kind === 'metal' ? 'knock_metal_' : 'cloth');
    if (!b) return;
    const t = it.body.translation();
    this.d.audio.play3D(b, t.x, t.y, t.z, { gain: 0.18 * gain, rate: 1.3 + Math.random() * 0.2, ref: 1.2, wet: 0.2 });
  }

  /** Прибрати уламки (зміна рівня: тіла видаляє рівень). */
  detach(): void {
    this.carry.reset();
    for (const sh of this.shards) { if (sh.body) this.d.physics.world.removeRigidBody(sh.body); sh.body = null; sh.t = 0; }
    this.shardMesh = null; this.shardE = null; this.lamps = null;
  }
}
