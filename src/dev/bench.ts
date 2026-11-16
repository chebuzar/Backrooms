// «Тест швидкодії» (?bench): камера сама пролітає маршрутом від старту до виходу на кожному пресеті якості,
// збирає час кадрів і показує таблицю (середній FPS, 1 % найгірших кадрів, мс, draw calls, трикутники).
// Власник відкриває посилання на своєму iPad і надсилає скріншот — це наші справжні заміри.
import * as THREE from 'three/webgpu';
import type { Game } from '../game/game';
import { PROFILES, type QualityName } from '../render/quality';
import type { Layout } from '../world/layout';

interface Row { preset: QualityName; frames: number; fps: number; low1: number; p50: number; p95: number; max: number; draws: number; tris: number; res: string }

const WARMUP = 2.5, MEASURE = 12, SPEED = 1.9;

/** Маршрут від старту до виходу: від клітинки виходу йдемо до сусіда з відстанню на 1 меншою, якщо між ними немає стіни. */
export function benchPath(l: Layout): THREE.Vector3[] {
  const blocked = (x: number, z: number) => l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.02 && Math.abs(z - w.z) < w.d / 2 + 0.02);
  let c = l.exit.cz * l.cols + l.exit.cx;
  const cells = [c];
  for (let guard = 0; guard < l.cols * l.rows && (l.dist[c] as number) > 0; guard++) {
    const x = c % l.cols, y = (c / l.cols) | 0, d = l.dist[c] as number;
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [x + dx, y + dy] as const).find(([nx, ny]) =>
      nx >= 0 && ny >= 0 && nx < l.cols && ny < l.rows && l.dist[ny * l.cols + nx] === d - 1
      && !blocked(((x + nx) / 2 + 0.5) * l.cell, ((y + ny) / 2 + 0.5) * l.cell));
    if (!next) break;
    c = next[1] * l.cols + next[0];
    cells.push(c);
  }
  return cells.reverse().map((k) => new THREE.Vector3(((k % l.cols) + 0.5) * l.cell, 1.62, (((k / l.cols) | 0) + 0.5) * l.cell));
}

/** Точка на ламаній за пройденою відстанню. */
function along(path: THREE.Vector3[], s: number, out: THREE.Vector3): THREE.Vector3 {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as THREE.Vector3, b = path[i + 1] as THREE.Vector3, len = a.distanceTo(b);
    if (s <= len) return out.copy(a).lerp(b, s / len);
    s -= len;
  }
  return out.copy(path[path.length - 1] as THREE.Vector3);
}

export async function runBench(game: Game, presets: QualityName[] = ['ultra', 'high', 'medium', 'low']): Promise<Row[]> {
  const lvl = game.level;
  if (!lvl) throw new Error('level not loaded');
  const path = benchPath(lvl.layout);
  const total = path.slice(1).reduce((a, p, i) => a + p.distanceTo(path[i] as THREE.Vector3), 0);
  game.ui.closeAll(); game.hud.show(false); game.input.touch?.show(false);
  game.autoScale = false; game.governor.scale = 1;
  const prevCap = game.fpsCap, prevFrame = game.onFrame;
  game.fpsCap = 0;
  game.flashlightOn = true;
  const label = overlay('Тест скорости…');
  const rows: Row[] = [];
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), smooth = new THREE.Vector3();
  let s = 0;
  for (const name of presets) {
    game.profile = PROFILES[name];
    game.post.apply(game.profile);
    game.resize();
    const times: number[] = [];
    let draws = 0, tris = 0, t = 0, prev = performance.now();
    smooth.copy(along(path, s % total, pos));
    await new Promise<void>((done) => {
      game.cameraOverride = (cam, dt) => {
        s += SPEED * dt;
        along(path, s % total, pos);
        along(path, (s + 2.5) % total, tgt);
        smooth.lerp(pos, Math.min(1, dt * 4));
        cam.position.copy(smooth);
        tgt.y = 1.5;
        cam.lookAt(tgt);
      };
      game.onFrame = () => {
        // справжній час між кадрами (гра обрізає крок до 100 мс — для заміру це неприпустимо)
        const now = performance.now(), dtMs = now - prev;
        prev = now;
        t += dtMs / 1000;
        if (t > WARMUP) {
          times.push(dtMs);
          const info = game.gfx.renderer.info.render;
          draws += info.drawCalls; tris += info.triangles;
        }
        label.textContent = `Тест скорости: ${name} — ${Math.max(0, Math.ceil(WARMUP + MEASURE - t))} с`;
        if (t > WARMUP + MEASURE) done();
      };
    });
    const sorted = [...times].sort((a, b) => a - b), n = sorted.length;
    const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))] ?? 0;
    const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const worst = sorted.slice(Math.floor(n * 0.99));
    const size = game.gfx.renderer.getDrawingBufferSize(new THREE.Vector2());
    rows.push({
      preset: name, frames: n, fps: 1000 / mean, low1: 1000 / (worst.reduce((a, b) => a + b, 0) / Math.max(1, worst.length)),
      p50: q(0.5), p95: q(0.95), max: sorted[n - 1] ?? 0, draws: draws / Math.max(1, n), tris: tris / Math.max(1, n), res: `${size.x}×${size.y}`
    });
  }
  game.cameraOverride = null; game.onFrame = prevFrame; game.fpsCap = prevCap;
  label.remove();
  showResults(game, rows);
  console.log('[bench]', JSON.stringify(rows));
  return rows;
}

function overlay(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:70;'
    + 'font:14px ui-monospace,Menlo,monospace;color:#e8f5d8;background:rgba(0,0,0,.65);padding:6px 12px;border-radius:6px';
  d.textContent = text;
  document.body.appendChild(d);
  return d;
}

function showResults(game: Game, rows: Row[]): void {
  const r = game.gfx;
  const dev = `${r.backend.toUpperCase()} · ${r.gpuName || 'GPU ?'} · ${screen.width}×${screen.height} @${devicePixelRatio} · ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}`;
  const f = (v: number, d = 0) => v.toFixed(d);
  const el = document.createElement('div');
  el.className = 'bench-result';
  el.style.cssText = 'position:fixed;inset:auto 0 0 0;top:calc(10px + env(safe-area-inset-top));margin:auto;max-width:min(96vw,760px);height:fit-content;z-index:80;'
    + 'background:rgba(12,12,10,.92);color:#e9e4d0;font:13px/1.4 ui-monospace,Menlo,monospace;padding:14px 16px;border-radius:10px;border:1px solid #6b6248;overflow:auto;max-height:90dvh';
  el.innerHTML = `<b style="font-size:15px">Тест скорости — результат</b><div style="opacity:.75;margin:4px 0 8px">${dev}</div>
    <table style="width:100%;border-collapse:collapse;text-align:right">
    <tr style="opacity:.7"><th style="text-align:left">Пресет</th><th>FPS</th><th>1% худш.</th><th>мс медиана</th><th>мс 95%</th><th>мс макс</th><th>draw</th><th>треуг.</th><th>разрешение</th></tr>
    ${rows.map((x) => `<tr><td style="text-align:left">${x.preset}</td><td><b>${f(x.fps)}</b></td><td>${f(x.low1)}</td><td>${f(x.p50, 1)}</td><td>${f(x.p95, 1)}</td><td>${f(x.max, 1)}</td><td>${f(x.draws)}</td><td>${f(x.tris / 1000)}k</td><td>${x.res}</td></tr>`).join('')}
    </table>
    <p style="opacity:.7;margin:8px 0">Если FPS упирается в 60 (или 120) — это частота экрана; тогда важнее «мс 95%» и «1% худш.».</p>
    <button data-copy style="font:inherit;padding:6px 10px;margin-right:8px">Скопировать</button><button data-again style="font:inherit;padding:6px 10px">Ещё раз</button>`;
  el.querySelector('[data-copy]')?.addEventListener('click', () => void navigator.clipboard?.writeText(JSON.stringify({ dev, rows })));
  el.querySelector('[data-again]')?.addEventListener('click', () => { el.remove(); void runBench(game); });
  document.body.appendChild(el);
}
