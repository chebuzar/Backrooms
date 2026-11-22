// Перенесення ходи UAL → MakeHuman: джерело в T-позі, ціль в A-позі. Перенесена поза має давати ті самі напрями
// кісток, що й у джерела (а не «рука вниз ще на 45°», як у наївного копіювання поворотів).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { retargetUAL2 } from '../../src/world/monsters/locomotion';

function chain(names: string[], offsets: [number, number, number][], parent: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  let p = parent;
  names.forEach((n, i) => {
    const b = new THREE.Bone(); b.name = n; b.position.set(...(offsets[i] as [number, number, number]));
    p.add(b); out.push(b); p = b;
  });
  return out;
}

/** Таз → хребет; від таза — рука (через хребет) і нога. armDown — кут руки вниз від горизонталі. */
function rig(kind: 'ual' | 'mh', armDown: number, hip: number): THREE.Object3D {
  const root = new THREE.Object3D();
  const n = kind === 'ual'
    ? { hips: 'DEF-hips', spine: 'DEF-spine.001', ua: 'DEF-upper_arm.L', fa: 'DEF-forearm.L', hand: 'DEF-hand.L', th: 'DEF-thigh.L', sh: 'DEF-shin.L', ft: 'DEF-foot.L', toe: 'DEF-toe.L' }
    : { hips: 'pelvis', spine: 'spine_01', ua: 'upperarm_l', fa: 'lowerarm_l', hand: 'hand_l', th: 'thigh_l', sh: 'calf_l', ft: 'foot_l', toe: 'ball_l' };
  const [hips, spine] = chain([n.hips, n.spine], [[0, hip, 0], [0, 0.5, 0]], root) as [THREE.Bone, THREE.Bone];
  const L = 0.3, c = Math.cos(armDown) * L, s = -Math.sin(armDown) * L;
  chain([n.ua, n.fa, n.hand], [[0.2, 0.3, 0], [c, s, 0], [c, s, 0]], spine);
  chain([n.th, n.sh, n.ft, n.toe], [[0.1, 0, 0], [0, -hip * 0.5, 0], [0, -hip * 0.45, 0], [0, -0.05, 0.12]], hips);
  root.updateMatrixWorld(true);
  return root;
}

const dir = (root: THREE.Object3D, a: string, b: string) => {
  root.updateMatrixWorld(true);
  const pa = (root.getObjectByName(a) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
  const pb = (root.getObjectByName(b) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
  return pb.sub(pa).normalize();
};

describe('retargetUAL2', () => {
  it('T-pose source drives an A-pose target to the same bone directions', () => {
    const src = rig('ual', 0, 0.9), tgt = rig('mh', Math.PI / 4, 1.2);
    // кліп: плече джерела опускається до -60° (поворот навколо Z), передпліччя згинається ще на 30°
    const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 3);
    const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 6);
    const clip = new THREE.AnimationClip('t', 1, [
      new THREE.QuaternionKeyframeTrack('DEF-upper_arm.L.quaternion', [0, 1], [0, 0, 0, 1, ...qa.toArray()]),
      new THREE.QuaternionKeyframeTrack('DEF-forearm.L.quaternion', [0, 1], [0, 0, 0, 1, ...qb.toArray()]),
      new THREE.VectorKeyframeTrack('DEF-hips.position', [0, 1], [0, 0.9, 0, 0, 0.8, 0.1])
    ]);
    const { clip: out } = retargetUAL2(tgt, src, clip, 10);
    const mixer = new THREE.AnimationMixer(tgt);
    mixer.clipAction(out).play();
    for (const t of [0, 0.5, 0.99]) {
      mixer.setTime(t);
      const sm = new THREE.AnimationMixer(src); sm.clipAction(clip).play(); sm.setTime(t);
      for (const [a, b, sa, sb] of [['upperarm_l', 'lowerarm_l', 'DEF-upper_arm.L', 'DEF-forearm.L'], ['lowerarm_l', 'hand_l', 'DEF-forearm.L', 'DEF-hand.L']] as const) {
        expect(dir(tgt, a, b).angleTo(dir(src, sa, sb))).toBeLessThan(0.01);
      }
      sm.stopAllAction();
    }
    // таз: просідання 0.1 м у джерела (висота 0.9) → 0.133 м у цілі (висота 1.2)
    mixer.setTime(0.99);
    tgt.updateMatrixWorld(true);
    expect((tgt.getObjectByName('pelvis') as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.2 - 0.099 * (1.2 / 0.9), 2);
    // джерело після перенесення — знову в позі спокою (наступний кліп рахується від неї)
    expect(dir(src, 'DEF-upper_arm.L', 'DEF-forearm.L').angleTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-4);
  });
});
