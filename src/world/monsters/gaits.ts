// Процедурні пози й хода мисливців глибших рівнів (кістки MakeHuman game_engine, зсуви від пози спокою, рад).
// • «Улыбака»: неприродно рівна, «пливе», руки за спиною, голова схилена набік; у погоні — руки вперед, голова лягає на плече.
// • «Утопленник»: важкий, обвислий, руки звисають до колін, тягне ноги; під водою — лише тінь, з води підводиться ривками.
export type Pose = Record<string, [number, number, number]>;

/** «Улыбака»: s — фаза кроку, a — швидкість 0..1, hunt — у погоні, lit — у промені ліхтарика (затуляється руками). */
export function smilerPose(s: number, a: number, hunt: boolean, lit: boolean, tilt: number): Pose {
  const sw = Math.sin(s), cw = Math.cos(s);
  if (lit) {
    // затуляє обличчя ліктями, відхиляється назад, голова відвернута
    return {
      spine_02: [-0.15, 0, 0], neck_01: [0.4, 0.6, 0], head: [0.3, 0.5, 0.2],
      upperarm_l: [-1.6, 0, -0.3], upperarm_r: [-1.6, 0, 0.3], lowerarm_l: [0, 0, -2.0], lowerarm_r: [0, 0, 2.0],
      thigh_l: [sw * 0.2 * a, 0, 0], thigh_r: [-sw * 0.2 * a, 0, 0]
    };
  }
  const legs = { thigh_l: [sw * 0.42 * a, 0, 0], thigh_r: [-sw * 0.42 * a, 0, 0], calf_l: [-Math.max(0, cw) * 0.5 * a, 0, 0], calf_r: [-Math.max(0, -cw) * 0.5 * a, 0, 0] } as Pose;
  if (hunt) {
    return {
      ...legs, spine_01: [0.25, 0, 0], spine_02: [0.2, 0, 0], neck_01: [-0.3, 0, 1.0 * tilt], head: [-0.2, 0, 0.55 * tilt],
      upperarm_l: [-1.25 + sw * 0.1, 0, -0.35], upperarm_r: [-1.25 - sw * 0.1, 0, 0.35], lowerarm_l: [0, 0, -0.15], lowerarm_r: [0, 0, 0.15],
      hand_l: [0, 0, -0.3], hand_r: [0, 0, 0.3]
    };
  }
  // спокійна: руки за спиною, рівна спина, голова схилена й ледь гойдається
  return {
    ...legs, neck_01: [0.05, 0, 0.55 * tilt], head: [0, Math.sin(s * 0.21) * 0.15, 0.35 * tilt],
    upperarm_l: [0.35, 0, -0.95], upperarm_r: [0.35, 0, 0.95], lowerarm_l: [0, -0.4, -0.9], lowerarm_r: [0, 0.4, 0.9]
  };
}

/** «Утопленник»: важка хода з перевальцем; hunt — тягнеться вперед; rise 0..1 — підводиться з води (0 — лежить на дні). */
export function drownedPose(s: number, a: number, hunt: boolean, rise: number): Pose {
  const sw = Math.sin(s), cw = Math.cos(s);
  const slump = 1 - rise;
  return {
    spine_01: [0.35 + slump * 0.6, 0, sw * 0.08 * a], spine_02: [0.25 + slump * 0.4, 0, 0], spine_03: [0.15, 0, 0],
    neck_01: [hunt ? -0.45 : 0.35, 0, 0.25], head: [hunt ? -0.3 : 0.25, Math.sin(s * 0.33) * 0.2, 0.3],
    upperarm_l: [hunt ? -0.9 : 0.15 - sw * 0.25 * a, 0, -0.85], upperarm_r: [hunt ? -0.9 : 0.15 + sw * 0.25 * a, 0, 0.85],
    lowerarm_l: [hunt ? -0.2 : 0, 0, -0.25], lowerarm_r: [hunt ? -0.2 : 0, 0, 0.25],
    thigh_l: [0.15 + sw * 0.35 * a + slump * 0.9, 0, 0.08], thigh_r: [0.15 - sw * 0.35 * a + slump * 0.9, 0, -0.08],
    calf_l: [-0.25 - Math.max(0, cw) * 0.45 * a - slump * 1.4, 0, 0], calf_r: [-0.25 - Math.max(0, -cw) * 0.45 * a - slump * 1.4, 0, 0]
  };
}

// ── Шари поверх справжньої ходи (Locomotion): ноги, таз і вага тіла — з циклів UAL, характер — тут. ──
// add — поворот додається до анімації; set — кістка ставиться з пози спокою (руки за спиною, затуляє обличчя).
export interface Overlay { add: Pose; set: Pose }

/** «Слепой»: ще більше згорблений, голова задерта (слухає), смикається; руки звисають нижче. */
export function blindOverlay(t: number, listen: number, twitch: number, run = 0): Overlay {
  // у погоні біжить, але не випрямляється: корпус низько, голова задерта
  return {
    add: {
      spine_01: [0.3 * run, 0, 0], spine_02: [0.18 + 0.25 * run, 0, 0], spine_03: [0.1, 0, 0],
      neck_01: [-0.55 - listen - 0.3 * run, twitch, 0], head: [-0.4 - listen * 0.6 - 0.2 * run, Math.sin(t * 0.37) * 0.45, 0.2 + twitch * 0.6],
      upperarm_l: [0.15, 0, 0.25], upperarm_r: [0.15, 0, -0.25], lowerarm_l: [0.25, 0, 0], lowerarm_r: [0.25, 0, 0],
      hand_l: [0.3, 0, 0], hand_r: [0.3, 0, 0]
    },
    set: {}
  };
}

/** «Улыбака»: руки за спиною (спокійна) чи вперед (погоня), голова схилена; у промені — затуляється. */
export function smilerOverlay(t: number, hunt: boolean, lit: boolean, tilt: number): Overlay {
  const sw = Math.sin(t * Math.PI * 2);
  if (lit) {
    return {
      add: { spine_02: [-0.15, 0, 0] },
      set: {
        neck_01: [0.4, 0.6, 0], head: [0.3, 0.5, 0.2],
        upperarm_l: [-1.6, 0, -0.3], upperarm_r: [-1.6, 0, 0.3], lowerarm_l: [0, 0, -2.0], lowerarm_r: [0, 0, 2.0]
      }
    };
  }
  if (hunt) {
    return {
      add: { spine_02: [0.12, 0, 0], neck_01: [-0.3, 0, 1.0 * tilt], head: [-0.2, 0, 0.55 * tilt] },
      set: {
        upperarm_l: [-1.25 + sw * 0.08, 0, -0.35], upperarm_r: [-1.25 - sw * 0.08, 0, 0.35], lowerarm_l: [0, 0, -0.15], lowerarm_r: [0, 0, 0.15],
        hand_l: [0, 0, -0.3], hand_r: [0, 0, 0.3]
      }
    };
  }
  // спокійна: руки за спиною, голова схилена й ледь гойдається
  return {
    add: { neck_01: [0.05, 0, 0.55 * tilt], head: [0, Math.sin(t * 0.21) * 0.15, 0.35 * tilt] },
    set: { upperarm_l: [0.35, 0, -0.95], upperarm_r: [0.35, 0, 0.95], lowerarm_l: [0, -0.4, -0.9], lowerarm_r: [0, 0.4, 0.9] }
  };
}

/** «Утопленник»: обвислий, голова вниз, руки звисають; rise 0..1 — підводиться з води (0 — лежить). */
export function drownedOverlay(t: number, hunt: boolean, rise: number): Overlay {
  const slump = 1 - rise;
  return {
    add: {
      spine_01: [0.3 + slump * 0.6, 0, 0], spine_02: [0.2 + slump * 0.4, 0, 0], spine_03: [0.1, 0, 0],
      neck_01: [hunt ? -0.4 : 0.35, 0, 0.25], head: [hunt ? -0.3 : 0.25, Math.sin(t * 0.33) * 0.2, 0.3],
      thigh_l: [slump * 0.9, 0, 0], thigh_r: [slump * 0.9, 0, 0], calf_l: [-slump * 1.4, 0, 0], calf_r: [-slump * 1.4, 0, 0]
    },
    set: hunt
      ? { upperarm_l: [-0.9, 0, -0.85], upperarm_r: [-0.9, 0, 0.85], lowerarm_l: [-0.2, 0, -0.25], lowerarm_r: [-0.2, 0, 0.25] }
      : { upperarm_l: [0.15, 0, -0.85], upperarm_r: [0.15, 0, 0.85], lowerarm_l: [0, 0, -0.25], lowerarm_r: [0, 0, 0.25] }
  };
}
