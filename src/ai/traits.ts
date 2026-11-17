// Характеристики мисливців рівнів 1–2 (окремо від моделей, щоб тестувати поведінку в Node).
import type { Traits } from './brain';

export type StalkerKind = 'watcher' | 'blind';

export const TRAITS: Record<StalkerKind, Traits> = {
  // «Наблюдатель»: стоїть статуєю, доки не помітив гравця; далі підходить лише тоді, коли на нього не дивляться —
  // повільно (≈ 1.8 м/с), але невідворотно. Ціль балансу: з 10 м ловить не раніше 3-го разу, коли гравець відвернувся.
  watcher: { sightRange: 34, fovHalf: 1.2, hearing: 0.5, walkSpeed: 1.2, runSpeed: 1.8, searchTime: 30, alertness: 0.9, movesWhenUnseen: true, cutsOff: true, stillUntilNoticed: true },
  blind: { sightRange: 0, fovHalf: 0, hearing: 1.5, walkSpeed: 0.95, runSpeed: 3.9, searchTime: 22, alertness: 0 }
};

/**
 * «Слепой» клацає язиком (ехолокація): що ближче до гравця, то частіше (до ×2.2 впритул), у полюванні — ще частіше.
 * Повертає швидкість відтворення петлі клацань.
 */
export function blindClickRate(dist: number, hunting: boolean): number {
  const near = Math.max(0, Math.min(1, 1 - (dist - 1.5) / 14));
  return Math.min(2.6, 1 + near * near * 1.2 + (hunting ? 0.35 : 0));
}
