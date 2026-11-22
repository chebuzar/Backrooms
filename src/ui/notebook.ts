// Блокнот оператора (Tab / J / кнопка): ліва сторінка — завдання олівцем, речі задачі рівня й знайдені папери;
// права — карта, яку гравець «малює» сам: олівцеві лінії стін лише там, де він пройшов (MapMemory).
import type { MapMemory } from '../game/mapmem';
import { T } from '../i18n/ru';

import { esc } from './esc';

export interface NotebookData {
  level: string;
  objective: string;
  /** Речі задачі рівня: «Печать отдела кадров — есть». */
  items: { text: string; done: boolean }[];
  docs: { id: string; title: string }[];
  map: MapMemory | null;
  me: { x: number; z: number; yaw: number } | null;
  /** Позначки олівцем на карті (наприклад, «тело» там, де гравець загинув). */
  marks: { x: number; z: number; label: string }[];
}

/** Детермінований «шум руки» для олівцевих ліній (однаковий щоразу, коли відкриваєш блокнот). */
function hand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
}

export class Notebook {
  private el: HTMLElement | null = null;
  constructor(private readonly root: HTMLElement) {}

  get open(): boolean { return !!this.el; }

  show(d: NotebookData, onDoc: (id: string) => void, onClose: () => void): void {
    this.close(false);
    const n = T.notebook;
    const el = document.createElement('div');
    el.className = 'notebook';
    el.innerHTML = `<div class="nb-book">
      <section class="nb-page nb-left">
        <p class="nb-head">${esc(n.title)} · ${esc(d.level)}</p>
        <p class="nb-task">${esc(d.objective)}</p>
        ${d.items.length ? `<ul class="nb-items">${d.items.map((i) => `<li class="${i.done ? 'done' : ''}">${esc(i.text)}</li>`).join('')}</ul>` : ''}
        <p class="nb-sub">${esc(n.papers)}</p>
        ${d.docs.length ? `<nav class="nb-docs">${d.docs.map((x) => `<button class="nb-doc" data-doc="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</nav>`
          : `<p class="nb-empty">${esc(n.empty)}</p>`}
      </section>
      <section class="nb-page nb-right"><canvas class="nb-map"></canvas><p class="nb-cap">${esc(n.mapCap)}</p></section>
      <button class="nb-close line-btn">${esc(n.close)}</button></div>`;
    this.root.appendChild(el);
    this.el = el;
    void el.offsetWidth; // примусова розкладка: перехід прозорості спрацює без очікування кадру
    el.classList.add('shown');
    el.querySelectorAll<HTMLButtonElement>('.nb-doc').forEach((b) => b.addEventListener('click', () => onDoc(b.dataset.doc as string)));
    const close = () => { this.close(); onClose(); };
    el.querySelector('.nb-close')?.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    (el.querySelector('.nb-close') as HTMLElement).focus({ preventScroll: true });
    const cv = el.querySelector('.nb-map') as HTMLCanvasElement;
    // розмір — після розкладки (сторінка вже має ширину)
    this.drawMap(cv, d);
  }

  close(animate = true): void {
    const el = this.el;
    if (!el) return;
    this.el = null;
    if (!animate) { el.remove(); return; }
    el.classList.remove('shown');
    setTimeout(() => el.remove(), 260);
  }

  private drawMap(cv: HTMLCanvasElement, d: NotebookData): void {
    const m = d.map, rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(10, Math.round(rect.width * dpr)); cv.height = Math.max(10, Math.round(rect.height * dpr));
    const g = cv.getContext('2d');
    if (!g || !m) return;
    const l = m.layout, W = l.cols * l.cell, D = l.rows * l.cell;
    // показуємо лише пройдену частину (з полями), щоб на маленькому екрані карта не була дрібною
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < m.seen.length; i++) if (m.seen[i]) {
      const x = (i % l.cols) * l.cell, z = Math.floor(i / l.cols) * l.cell;
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + l.cell); z1 = Math.max(z1, z + l.cell);
    }
    if (!isFinite(x0)) { x0 = 0; z0 = 0; x1 = W; z1 = D; }
    const pad = 4; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const span = Math.max(x1 - x0, (z1 - z0) * cv.width / cv.height, 24);
    const k = cv.width / span, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const P = (x: number, z: number): [number, number] => [cv.width / 2 + (x - cx) * k, cv.height / 2 + (z - cz) * k];
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(58,52,110,0.78)';
    const walls = m.knownWalls();
    walls.forEach((w, wi) => {
      const r = hand(wi + l.seed * 31);
      if (w.pillar) {
        const [px, pz] = P(w.pillar.x, w.pillar.z), sz = Math.max(2, w.pillar.w * k);
        g.lineWidth = 1.1 * dpr; g.strokeRect(px - sz / 2 + r(), pz - sz / 2 + r(), sz, sz);
        return;
      }
      const a = P(w.a[0], w.a[1]), b = P(w.b[0], w.b[1]);
      // два проходи олівцем зі зсувом — як рука, що веде лінію двічі
      for (let pass = 0; pass < 2; pass++) {
        g.lineWidth = (pass ? 0.9 : 1.5) * dpr;
        g.globalAlpha = pass ? 0.5 : 0.85;
        g.beginPath();
        g.moveTo(a[0] + r() * 2 * dpr, a[1] + r() * 2 * dpr);
        const mx = (a[0] + b[0]) / 2 + r() * 2.5 * dpr, my = (a[1] + b[1]) / 2 + r() * 2.5 * dpr;
        g.quadraticCurveTo(mx, my, b[0] + r() * 2 * dpr, b[1] + r() * 2 * dpr);
        g.stroke();
      }
    });
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(58,52,110,0.85)';
    g.font = `${Math.round(13 * dpr)}px Neucha, cursive`;
    for (const mk of d.marks) {
      const [px, pz] = P(mk.x, mk.z);
      g.lineWidth = 1.4 * dpr;
      g.beginPath(); g.moveTo(px - 5 * dpr, pz - 5 * dpr); g.lineTo(px + 5 * dpr, pz + 5 * dpr); g.moveTo(px + 5 * dpr, pz - 5 * dpr); g.lineTo(px - 5 * dpr, pz + 5 * dpr); g.stroke();
      g.fillText(mk.label, px + 7 * dpr, pz - 6 * dpr);
    }
    if (d.me) {
      // «я»: стрілка олівцем у напрямку погляду
      const [px, pz] = P(d.me.x, d.me.z), fx = -Math.sin(d.me.yaw), fz = -Math.cos(d.me.yaw), s = 9 * dpr;
      g.strokeStyle = 'rgba(150,40,34,0.9)'; g.lineWidth = 2 * dpr;
      g.beginPath();
      g.moveTo(px - fx * s * 0.6, pz - fz * s * 0.6); g.lineTo(px + fx * s, pz + fz * s);
      g.lineTo(px + fx * s * 0.2 - fz * s * 0.5, pz + fz * s * 0.2 + fx * s * 0.5);
      g.moveTo(px + fx * s, pz + fz * s); g.lineTo(px + fx * s * 0.2 + fz * s * 0.5, pz + fz * s * 0.2 - fx * s * 0.5);
      g.stroke();
    }
  }
}
