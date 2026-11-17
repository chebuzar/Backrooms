// Розклад прологу: коли друкується кожен рядок і скільки все триває. Рахується від реального часу (не ланцюжком
// таймерів), тож завантаження рівня у фоні не розтягує пролог.
export const PROLOGUE_TIMING = {
  /** Пауза перед першим рядком, с. */
  lead: 0.9,
  /** Секунд на символ (машинопис). */
  perChar: 0.045,
  /** Пауза після рядка: база + час на прочитання (с на символ). */
  pause: 1.2,
  readPerChar: 0.025,
  /** Скільки тримати останній рядок і згасання, с. */
  hold: 2.2,
  fade: 0.9
};

export interface PrologueLine { start: number; typeEnd: number; end: number }

export function prologueTimeline(lines: string[], k = PROLOGUE_TIMING): { lines: PrologueLine[]; total: number } {
  let t = k.lead;
  const out: PrologueLine[] = [];
  for (const l of lines) {
    const typeEnd = t + l.length * k.perChar;
    const end = typeEnd + k.pause + l.length * k.readPerChar;
    out.push({ start: t, typeEnd, end });
    t = end;
  }
  // після останнього рядка — не пауза на читання, а утримання й згасання
  const last = out[out.length - 1];
  const total = (last ? last.typeEnd : t) + k.hold + k.fade;
  return { lines: out, total };
}
