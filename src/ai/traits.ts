// Характеристики мисливців рівнів 1–2 (окремо від моделей, щоб тестувати поведінку в Node).
import type { Traits } from './brain';

export type StalkerKind = 'watcher' | 'blind' | 'smiler' | 'drowned';

export const TRAITS: Record<StalkerKind, Traits> = {
  // «Наблюдатель»: стоїть статуєю, доки не помітив гравця; далі підходить лише тоді, коли на нього не дивляться.
  // Ціль балансу (Назар, 23.11: «важко, але можливо»): з 10 м ловить на 3–4-й раз, коли гравець відвернувся на 1.5 с;
  // того, хто просто йде геть, не озираючись, — ловить завжди. Було 1.8 м/с — повільніше за крок, тож не ловив ніколи.
  // Рух — ривками (див. watcherSpeed): щойно відвів погляд — за мить він уже на 2 м ближче, далі йде швидше за твій крок.
  // Втекти спиною не вийде — лише бігом (поки є сили) або дивлячись на нього й відступаючи.
  watcher: { sightRange: 34, fovHalf: 1.2, hearing: 0.5, walkSpeed: 1.2, runSpeed: 2.3, searchTime: 30, alertness: 0.9, movesWhenUnseen: true, cutsOff: true, stillUntilNoticed: true },
  blind: { sightRange: 0, fovHalf: 0, hearing: 1.5, walkSpeed: 0.95, runSpeed: 3.9, searchTime: 22, alertness: 0 },
  // «Улыбака» (дитсадок): живе в темряві й не виходить на світло ламп; ліхтарик бачить здалеку, але промінь в обличчя
  // змушує її відступити. Швидка: у темряві від неї не втекти — лише до лампи.
  smiler: { sightRange: 24, fovHalf: 1.3, hearing: 0.6, walkSpeed: 1.0, runSpeed: 3.5, searchTime: 26, alertness: 1.1, fearsLight: true, darkOnly: true },
  // «Утопленник» (басейн): лежить на дні чаші, доки не почує; погано бачить, чує кожен хлюпіт. У воді швидкий,
  // на сухій плитці — повільний і важкий. Втративши слід, повертається в чашу.
  // Баланс (бот, 22.11): на сухому погоня 1.5 м/с — повільніше за крок гравця (1.85), тож від нього можна відійти, але
  // не зупинятися; у калюжі 1.5 × 2.2 = 3.3 м/с — наздоганяє того, хто йде (1.5 у воді), і ледь не того, хто біжить (3.4).
  // Було 2.0 на сухому: повільний за задумом мисливець був швидший за крок і ловив бота 4–5 разів поспіль.
  drowned: { sightRange: 12, fovHalf: 1.0, hearing: 1.35, walkSpeed: 0.75, runSpeed: 1.5, searchTime: 20, alertness: 0.6, waterSpeed: 2.2, submerges: true }
};

/**
 * «Слепой» клацає язиком (ехолокація): що ближче до гравця, то частіше (до ×2.2 впритул), у полюванні — ще частіше.
 * Повертає швидкість відтворення петлі клацань.
 */
export function blindClickRate(dist: number, hunting: boolean): number {
  const near = Math.max(0, Math.min(1, 1 - (dist - 1.5) / 14));
  return Math.min(2.6, 1 + near * near * 1.2 + (hunting ? 0.35 : 0));
}

/** Ривок «Наблюдателя»: за якою реакцією, наскільки далеко й як швидко. */
export const WATCHER_LUNGE = { react: 0.3, dist: 2.0, speed: 7 };

/** Стан ривків «Наблюдателя» (скільки його не бачать, скільки ще лишилось ривка). */
export interface LungeState { unseen: number; lunge: number }

/**
 * Швидкість «Наблюдателя» цього кадру. Поки на нього дивляться — 0 і ривок «заряджається»; відвернувся — після
 * короткої реакції він робить ривок (≈2 м за третину секунди — гравець не встигає побачити руху), далі йде за тобою з
 * базовою швидкістю погоні.
 */
export function watcherSpeed(st: LungeState, seen: boolean, dt: number, base: number, moving = true): number {
  if (seen) { st.unseen = 0; st.lunge = WATCHER_LUNGE.dist; return 0; }
  st.unseen += dt;
  if (st.unseen < WATCHER_LUNGE.react || !moving) return 0;
  if (st.lunge > 0) { st.lunge -= WATCHER_LUNGE.speed * dt; return WATCHER_LUNGE.speed; }
  return base;
}
