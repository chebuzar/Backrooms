// Перенесення анімацій Quaternius Universal Animation Library (скелет Rigify «DEF-…») на тіла MakeHuman
// зі скелетом «game_engine» (назви як у UE). Обидва скелети — 53 кістки однакової будови, відрізняються назви
// й поза спокою, тому використовуємо SkeletonUtils.retargetClip із таблицею відповідності.
import type * as THREE from 'three/webgpu';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';

const side = (s: 'l' | 'r') => (s === 'l' ? 'L' : 'R');

/** Назва кістки MakeHuman → назва кістки Quaternius. */
export const MH_TO_UAL: Record<string, string> = (() => {
  const m: Record<string, string> = {
    Root: 'root', pelvis: 'DEF-hips', spine_01: 'DEF-spine.001', spine_02: 'DEF-spine.002', spine_03: 'DEF-spine.003',
    neck_01: 'DEF-neck', head: 'DEF-head'
  };
  for (const s of ['l', 'r'] as const) {
    const S = side(s);
    Object.assign(m, {
      [`clavicle_${s}`]: `DEF-shoulder.${S}`, [`upperarm_${s}`]: `DEF-upper_arm.${S}`, [`lowerarm_${s}`]: `DEF-forearm.${S}`, [`hand_${s}`]: `DEF-hand.${S}`,
      [`thigh_${s}`]: `DEF-thigh.${S}`, [`calf_${s}`]: `DEF-shin.${S}`, [`foot_${s}`]: `DEF-foot.${S}`, [`ball_${s}`]: `DEF-toe.${S}`
    });
    for (const f of ['index', 'middle', 'pinky', 'ring'] as const) for (const k of [1, 2, 3]) m[`${f}_0${k}_${s}`] = `DEF-f_${f}.0${k}.${S}`;
    for (const k of [1, 2, 3]) m[`thumb_0${k}_${s}`] = `DEF-thumb.0${k}.${S}`;
  }
  return m;
})();

/**
 * Перенести кліп із джерела (скелет UAL у позі спокою) на ціль (скелет MakeHuman у позі спокою).
 * hip — кістка, переміщення якої переноситься (решта — лише повороти).
 */
export function retargetUAL(target: THREE.SkinnedMesh, source: THREE.Object3D, clip: THREE.AnimationClip, fps = 30): THREE.AnimationClip {
  return retargetClip(target, source, clip, {
    names: MH_TO_UAL,
    hip: 'pelvis',
    useFirstFramePosition: false,
    preserveBoneMatrix: true,
    fps
  });
}
