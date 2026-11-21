// Атлас наочної агітації «Бесконечного НИИ»: стенди, стінгазета, Доска почёта, таблички, транспарант.
// Це документи й написи (як папери в блокноті), а не поверхні стін, тож малюються текстом на canvas один раз при завантаженні.
// Усе — в одній текстурі (один матеріал, один виклик малювання на всі деталі рівня).
import * as THREE from 'three/webgpu';

export type PosterId = 'tb' | 'go' | 'gaz' | 'hon' | 'graf' | 'slava' | 'tish' | 'post' | 'svet' | `kab${number}` | 'edge';

/** Розмір у метрах і щільність (пікселів на метр) — щоб дрібний текст лишався чітким зблизька. */
const SIZES: [PosterId, number, number, number][] = [
  ['tb', 1.2, 0.9, 600], ['gaz', 1.4, 0.75, 560], ['graf', 0.3, 0.42, 900],
  ['go', 1.0, 0.8, 600], ['hon', 1.2, 0.8, 560], ['tish', 0.6, 0.2, 700], ['post', 0.42, 0.15, 700],
  ['slava', 2.6, 0.42, 460],
  ['kab0', 0.24, 0.1, 1000], ['kab1', 0.24, 0.1, 1000], ['kab2', 0.24, 0.1, 1000], ['kab3', 0.24, 0.1, 1000],
  ['kab4', 0.24, 0.1, 1000], ['kab5', 0.24, 0.1, 1000], ['kab6', 0.24, 0.1, 1000], ['kab7', 0.24, 0.1, 1000],
  ['svet', 0.22, 0.09, 1000], ['edge', 0.02, 0.02, 800]
];

export const PLAQUES = ['Каб. 31', 'Отдел кадров', 'Лаборатория № 4', 'Первый отдел', 'Канцелярия', 'Каб. 7', 'Архив', 'Партбюро'];

export interface Slot { u0: number; v0: number; u1: number; v1: number; w: number; h: number }

const SANS = '"PT Sans Narrow", "Arial Narrow", sans-serif';
const HAND = 'Neucha, cursive';
const TYPE = '"Anonymous Pro", "Courier New", monospace';

type G = CanvasRenderingContext2D;

function fit(g: G, text: string, font: (px: number) => string, px: number, maxW: number): void {
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > maxW) g.font = font(Math.floor(px * maxW / w));
}

/** Пожовкле паперове тло з плямами й загином. */
function paper(g: G, x: number, y: number, w: number, h: number, tone = [232, 224, 196], seed = 1): void {
  g.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
  g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, 'rgba(120,90,40,0.10)'); gr.addColorStop(0.5, 'rgba(120,90,40,0)'); gr.addColorStop(1, 'rgba(110,80,30,0.18)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  let s = seed * 9301;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 4; i++) {
    const cx = x + r() * w, cy = y + r() * h, rad = (0.05 + r() * 0.12) * Math.min(w, h);
    const st = g.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
    st.addColorStop(0, 'rgba(140,100,40,0.10)'); st.addColorStop(0.85, 'rgba(120,80,30,0.16)'); st.addColorStop(1, 'rgba(120,80,30,0)');
    g.fillStyle = st; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
}

function frame(g: G, x: number, y: number, w: number, h: number, b: number, col = '#3b2618'): void {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, 'rgba(255,220,170,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + b - 2, y + b - 2, w - 2 * b + 4, h - 2 * b + 4);
}

function lines(g: G, text: string[], x: number, y: number, lh: number, maxW: number): number {
  for (const t of text) {
    const words = t.split(' ');
    let cur = '';
    for (const wd of words) {
      const nx = cur ? cur + ' ' + wd : wd;
      if (g.measureText(nx).width > maxW && cur) { g.fillText(cur, x, y); y += lh; cur = wd; } else cur = nx;
    }
    if (cur) { g.fillText(cur, x, y); y += lh; }
    y += lh * 0.35;
  }
  return y;
}

/** Силует «на фото»: голова й плечі, розмито й зі зерном (вицвіла чорно-біла фотографія). */
function photo(g: G, x: number, y: number, w: number, h: number, sepia: boolean, seed: number): void {
  const bg = g.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, sepia ? '#b9a988' : '#a9a9a2'); bg.addColorStop(1, sepia ? '#8c7c60' : '#7c7c78');
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.save();
  g.filter = `blur(${Math.max(1, w * 0.03)}px)`;
  g.fillStyle = sepia ? 'rgba(52,40,28,0.85)' : 'rgba(38,38,36,0.85)';
  const cx = x + w * (0.5 + ((seed * 37) % 7 - 3) * 0.015), hy = y + h * 0.4;
  g.beginPath(); g.ellipse(cx, hy, w * 0.19, h * 0.17, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, y + h * 1.02, w * 0.46, h * 0.36, 0, Math.PI, 0); g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(x, y, w, h * 0.06);
}

function header(g: G, x: number, y: number, w: number, h: number, text: string, bg = '#9b1f1a', fg = '#f3ead2'): void {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, text, (p) => `700 ${p}px ${SANS}`, h * 0.72, w * 0.92);
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

/** Стенд «Техника безопасности» — правила, що з кожним пунктом звучать дивніше. */
function drawTB(g: G, x: number, y: number, w: number, h: number): void {
  const b = w * 0.035;
  frame(g, x, y, w, h, b);
  paper(g, x + b, y + b, w - 2 * b, h - 2 * b, [226, 222, 204], 3);
  header(g, x + b, y + b, w - 2 * b, h * 0.13, 'ТЕХНИКА БЕЗОПАСНОСТИ');
  const rules = [
    '1. Не входить в неосвещённые помещения без сопровождающего.',
    '2. При отключении света стоять неподвижно. Не оборачиваться.',
    '3. Не открывать двери, за которыми слышна речь.',
    '4. Посторонних лиц в здании нет. О замеченных не сообщать.',
    '5. Количество дверей в коридоре постоянно. Не пересчитывать.',
    '6. Сотрудника, стоящего лицом к стене, не окликать.'
  ];
  const colW = (w - 2 * b) / 2 - w * 0.04;
  g.fillStyle = '#232018';
  g.font = `700 ${Math.round(h * 0.036)}px ${TYPE}`;
  lines(g, rules.slice(0, 3), x + b + w * 0.03, y + h * 0.25, h * 0.045, colW);
  lines(g, rules.slice(3), x + w / 2 + w * 0.01, y + h * 0.25, h * 0.045, colW);
  // підпис і печатка
  g.font = `${Math.round(h * 0.03)}px ${TYPE}`;
  g.fillText('Утверждаю. Главный инженер ___________', x + b + w * 0.03, y + h - b - h * 0.06);
  g.strokeStyle = 'rgba(40,60,140,0.55)'; g.lineWidth = 3;
  g.beginPath(); g.arc(x + w * 0.78, y + h * 0.86, h * 0.07, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(x + w * 0.78, y + h * 0.86, h * 0.05, 0, Math.PI * 2); g.stroke();
}

/** «Гражданская оборона» — фігури в протигазах. */
function drawGO(g: G, x: number, y: number, w: number, h: number): void {
  const b = w * 0.035;
  frame(g, x, y, w, h, b, '#2e3326');
  paper(g, x + b, y + b, w - 2 * b, h - 2 * b, [214, 216, 196], 5);
  header(g, x + b, y + b, w - 2 * b, h * 0.12, 'ГРАЖДАНСКАЯ ОБОРОНА — ДЕЛО ВСЕНАРОДНОЕ', '#33452c');
  const caps = ['Сигнал «Внимание всем!»', 'Надеть противогаз', 'Укрыться. Ждать.'];
  for (let i = 0; i < 3; i++) {
    const px = x + b + w * 0.04 + i * (w - 2 * b) / 3, pw = (w - 2 * b) / 3 - w * 0.06, py = y + h * 0.2, ph = h * 0.52;
    g.fillStyle = '#e8e4d2'; g.fillRect(px, py, pw, ph);
    // фігура в протигазі: голова, скельця, коробка фільтра
    const cx = px + pw / 2, cy = py + ph * 0.38, r = pw * 0.2;
    g.fillStyle = '#3c4a34';
    g.beginPath(); g.ellipse(cx, cy, r, r * 1.2, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(cx - pw * 0.32, cy + r * 1.3, pw * 0.64, ph * 0.4);
    g.fillStyle = '#c9cbb6';
    if (i < 2) { g.beginPath(); g.arc(cx - r * 0.42, cy - r * 0.15, r * 0.3, 0, Math.PI * 2); g.arc(cx + r * 0.42, cy - r * 0.15, r * 0.3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#26301f';
    g.beginPath(); g.ellipse(cx, cy + r * 0.85, r * 0.3, r * 0.38, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#26221a'; g.textAlign = 'center';
    fit(g, caps[i] as string, (p) => `700 ${p}px ${SANS}`, h * 0.05, pw);
    g.fillText(caps[i] as string, cx, py + ph + h * 0.07);
    g.textAlign = 'left';
  }
  g.font = `${Math.round(h * 0.03)}px ${TYPE}`; g.fillStyle = '#2a281e';
  g.fillText('Штаб ГО НИИ. Вывешено 26.04.1986', x + b + w * 0.04, y + h - b - h * 0.05);
}

/** Стінгазета «За науку!» — від руки, з фотографіями; одна новина вітає експедицію, що не повернулась. */
function drawGaz(g: G, x: number, y: number, w: number, h: number): void {
  paper(g, x, y, w, h, [238, 232, 210], 8);
  g.strokeStyle = 'rgba(80,60,30,0.3)'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
  g.fillStyle = '#a8231c';
  fit(g, 'ЗА НАУКУ!', (p) => `${p}px ${HAND}`, h * 0.2, w * 0.6);
  g.fillText('ЗА НАУКУ!', x + w * 0.05, y + h * 0.2);
  g.fillStyle = '#2c3d7a'; g.font = `${Math.round(h * 0.045)}px ${HAND}`;
  g.fillText('стенная газета партбюро и месткома НИИ · № 4 (112)', x + w * 0.05, y + h * 0.28);
  photo(g, x + w * 0.68, y + h * 0.06, w * 0.12, h * 0.26, true, 1);
  photo(g, x + w * 0.82, y + h * 0.06, w * 0.12, h * 0.26, true, 2);
  g.fillStyle = '#232018'; g.font = `${Math.round(h * 0.04)}px ${HAND}`;
  lines(g, ['Поздравляем шестую экспедицию с успешным возвращением! Товарищи вернулись все, в полном составе, в хорошем настроении.',
    'Напоминаем: собрание переносится. Новая дата будет объявлена по громкой связи.'], x + w * 0.05, y + h * 0.4, h * 0.055, w * 0.42);
  lines(g, ['Наши передовики — лаборатория № 4. Норма перевыполнена на 140%.', 'Кто ходит по третьему коридору ночью? Просьба прекратить. Местком.',
    'Не забывайте сдавать пропуска на вахте.'], x + w * 0.52, y + h * 0.44, h * 0.055, w * 0.42);
  g.fillStyle = 'rgba(160,40,30,0.8)'; g.font = `${Math.round(h * 0.05)}px ${HAND}`;
  g.fillText('Ответственный за выпуск: Белова Н.И.', x + w * 0.52, y + h * 0.94);
}

/** Доска почёта: вісім портретів; «Оператор № 7» — фото видряпане. */
function drawHon(g: G, x: number, y: number, w: number, h: number): void {
  const bg = g.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, '#7a1612'); bg.addColorStop(1, '#4e0d0b');
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.fillStyle = '#d9b45a'; g.textAlign = 'center';
  fit(g, 'ДОСКА ПОЧЁТА', (p) => `700 ${p}px ${SANS}`, h * 0.11, w * 0.8);
  g.fillText('ДОСКА ПОЧЁТА', x + w / 2, y + h * 0.13);
  const names = ['Захаров Ю.П.', 'Белова Н.И.', 'Шевчук А.М.', 'Гринберг Л.С.', 'Орлов В.Д.', 'Исаева Т.К.', 'Мельник О.Г.', 'Оператор № 7'];
  const cw = w / 4, ch = h * 0.4;
  names.forEach((n, i) => {
    const cx = x + (i % 4) * cw + cw * 0.18, cy = y + h * 0.18 + Math.floor(i / 4) * ch;
    const pw = cw * 0.64, ph = ch * 0.72;
    g.fillStyle = '#d9cfb0'; g.fillRect(cx - 4, cy - 4, pw + 8, ph + 8);
    photo(g, cx, cy, pw, ph, false, i + 3);
    if (i === 7) {
      // видряпане обличчя: густі нерівні штрихи
      g.strokeStyle = 'rgba(235,230,215,0.85)'; g.lineWidth = 2;
      for (let k = 0; k < 40; k++) {
        g.beginPath();
        g.moveTo(cx + pw * (0.2 + ((k * 13) % 17) / 30), cy + ph * (0.15 + ((k * 7) % 11) / 30));
        g.lineTo(cx + pw * (0.35 + ((k * 29) % 13) / 28), cy + ph * (0.3 + ((k * 11) % 9) / 25));
        g.stroke();
      }
    }
    g.fillStyle = '#e8dcc0';
    fit(g, n, (p) => `${p}px ${SANS}`, h * 0.05, cw * 0.9);
    g.fillText(n, cx + pw / 2, cy + ph + h * 0.065);
  });
  g.textAlign = 'left';
}

/** Графік чергувань: друкарська машинка; останній рядок — від руки. */
function drawGraf(g: G, x: number, y: number, w: number, h: number): void {
  paper(g, x, y, w, h, [236, 232, 218], 11);
  g.fillStyle = '#1e1c18'; g.textAlign = 'center';
  fit(g, 'ГРАФИК ДЕЖУРСТВ ПО ЭТАЖУ', (p) => `700 ${p}px ${TYPE}`, h * 0.04, w * 0.86);
  g.fillText('ГРАФИК ДЕЖУРСТВ ПО ЭТАЖУ', x + w / 2, y + h * 0.08);
  g.textAlign = 'left';
  const rows = [['21.04', 'Захаров'], ['22.04', 'Орлов'], ['23.04', 'Исаева'], ['24.04', 'Шевчук'], ['25.04', 'Мельник'], ['26.04', '']];
  g.strokeStyle = 'rgba(30,28,24,0.6)'; g.lineWidth = 1.5;
  const top = y + h * 0.14, rh = h * 0.1;
  for (let i = 0; i <= rows.length; i++) { g.beginPath(); g.moveTo(x + w * 0.08, top + i * rh); g.lineTo(x + w * 0.92, top + i * rh); g.stroke(); }
  g.beginPath(); g.moveTo(x + w * 0.34, top); g.lineTo(x + w * 0.34, top + rows.length * rh); g.stroke();
  g.font = `${Math.round(h * 0.04)}px ${TYPE}`;
  rows.forEach(([d, n], i) => { g.fillText(d as string, x + w * 0.11, top + i * rh + rh * 0.68); g.fillText(n as string, x + w * 0.38, top + i * rh + rh * 0.68); });
  g.fillStyle = 'rgba(40,40,110,0.85)'; g.font = `${Math.round(h * 0.05)}px ${HAND}`;
  g.fillText('Оператор № 7 — бессрочно', x + w * 0.36, top + 5 * rh + rh * 0.72);
}

function drawSlava(g: G, x: number, y: number, w: number, h: number): void {
  const bg = g.createLinearGradient(x, y, x + w, y);
  for (let i = 0; i <= 12; i++) bg.addColorStop(i / 12, i % 2 ? '#8e1a14' : '#a5231b');
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + h * 0.9, w, h * 0.1);
  g.fillStyle = '#f1e6c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, 'СЛАВА СОВЕТСКОЙ НАУКЕ!', (p) => `700 ${p}px ${SANS}`, h * 0.7, w * 0.9);
  g.fillText('СЛАВА СОВЕТСКОЙ НАУКЕ!', x + w / 2, y + h * 0.52);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

/** Емальована табличка: біле тло, червоний текст, рамка. */
function plate(g: G, x: number, y: number, w: number, h: number, text: string[], col = '#a5231b', bg = '#ece8dc'): void {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.strokeStyle = col; g.lineWidth = Math.max(2, h * 0.05); g.strokeRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16);
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  text.forEach((t, i) => {
    fit(g, t, (p) => `700 ${p}px ${SANS}`, h * (text.length > 1 ? 0.34 : 0.5), w * 0.86);
    g.fillText(t, x + w / 2, y + h * (text.length > 1 ? 0.33 + i * 0.36 : 0.53));
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

/** Дверна табличка: чорне скло, золоті літери. */
function plaque(g: G, x: number, y: number, w: number, h: number, text: string): void {
  g.fillStyle = '#141311'; g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.strokeStyle = '#b8954c'; g.lineWidth = 2; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
  g.fillStyle = '#d4b066'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, text, (p) => `700 ${p}px ${SANS}`, h * 0.48, w * 0.84);
  g.fillText(text, x + w / 2, y + h * 0.54);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

export interface PosterAtlas { texture: THREE.CanvasTexture; slots: Record<string, Slot> }

export async function buildPosterAtlas(): Promise<PosterAtlas> {
  try {
    await Promise.all([`700 40px ${SANS}`, `40px ${SANS}`, `40px ${HAND}`, `700 20px ${TYPE}`, `20px ${TYPE}`].map((f) => document.fonts.load(f, 'АБВ абв 123')));
  } catch { /* запасні шрифти */ }
  const W = 2048, H = 2048, pad = 8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d') as G;
  g.fillStyle = '#3b2618'; g.fillRect(0, 0, W, H);
  const slots: Record<string, Slot> = {};
  let sx = 0, sy = 0, rowH = 0;
  for (const [id, mw, mh, ppm] of SIZES) {
    const pw = Math.round(mw * ppm), ph = Math.round(mh * ppm);
    if (sx + pw > W) { sx = 0; sy += rowH + pad; rowH = 0; }
    const x = sx, y = sy;
    sx += pw + pad; rowH = Math.max(rowH, ph);
    slots[id] = { u0: x / W, v0: 1 - (y + ph) / H, u1: (x + pw) / W, v1: 1 - y / H, w: mw, h: mh };
    if (id === 'tb') drawTB(g, x, y, pw, ph);
    else if (id === 'go') drawGO(g, x, y, pw, ph);
    else if (id === 'gaz') drawGaz(g, x, y, pw, ph);
    else if (id === 'hon') drawHon(g, x, y, pw, ph);
    else if (id === 'graf') drawGraf(g, x, y, pw, ph);
    else if (id === 'slava') drawSlava(g, x, y, pw, ph);
    else if (id === 'tish') plate(g, x, y, pw, ph, ['ТИШИНА!', 'ИДЁТ ЭКСПЕРИМЕНТ']);
    else if (id === 'post') plate(g, x, y, pw, ph, ['ПОСТОРОННИМ', 'ВХОД ВОСПРЕЩЁН']);
    else if (id === 'svet') plate(g, x, y, pw, ph, ['Уходя, гасите свет'], '#2a2a2a', '#e6e1d0');
    else if (id.startsWith('kab')) plaque(g, x, y, pw, ph, PLAQUES[Number(id.slice(3))] as string);
    else if (id === 'edge') { g.fillStyle = '#4a3221'; g.fillRect(x, y, pw, ph); }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, slots };
}
