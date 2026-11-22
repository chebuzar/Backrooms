// «Гравець-бот»: ходить лише клавішами (W/S/A/D, Shift, C, F, E) і «мишею» (зсув погляду в Input), маршрути — по navmesh
// рівня. Знає тактики проти мисливців так, як їх дізнається гравець із записок:
// • «Наблюдатель» (рівень 1) — коли він близько, обернутися й тримати його поглядом;
// • «Слепой» (рівень 2) — не бігати, коли він поруч — пригнутися;
// • «Улыбака» (рівень 3) — ліхтарик увімкнений, світити їй в обличчя, коли наближається;
// • «Утопленник» (рівень 4) — не бігати; у калюжах — пригнутися (тихіше).
// Збирає метрики: час, смерті, «підштовхування» (коли автопілот застряг), погоні, мінімальна відстань до мисливця.
import { wait } from './lib.mjs';

export function makeBot(page, { log, shot }) {
  const m = { nudges: 0, chaseS: 0, minDist: Infinity, draws: {}, faced: 0 };
  let tactic = true;

  const state = () => page.evaluate(() => {
    const g = window.__zk.game, p = g.player?.pos;
    return { mode: g.mode, level: g.level?.id, input: g.input.enabled, x: p?.x, z: p?.z, deaths: g.store.progress.deaths,
      prompt: document.querySelector('.hud .prompt.on')?.textContent ?? null, reader: !!document.querySelector('.reader.shown') };
  });

  async function aim(x, y, z) {
    for (let k = 0; k < 8; k++) {
      const err = await page.evaluate(([x, y, z]) => {
        const g = window.__zk.game, c = g.camera.position, p = g.player;
        const wantYaw = Math.atan2(-(x - c.x), -(z - c.z)), wantPitch = Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
        const dy = Math.atan2(Math.sin(p.yaw - wantYaw), Math.cos(p.yaw - wantYaw)), dp = p.pitch - wantPitch;
        g.input.lookX += dy; g.input.lookY += dp;
        return Math.abs(dy) + Math.abs(dp);
      }, [x, y, z]);
      await wait(110);
      if (err < 0.01) break;
    }
  }

  const navPath = (tx, tz) => page.evaluate(async ([tx, tz]) => {
    const g = window.__zk.game, nav = await window.__zk.nav(0.3), p = g.player.pos;
    return [...nav.path({ x: p.x, y: 0, z: p.z }, nav.closest({ x: tx, y: 0, z: tz })).map((v) => [v.x, v.z]), [tx, tz]];
  }, [tx, tz]);

  const doorNear = () => page.evaluate(() => {
    const g = window.__zk.game, p = g.player.pos;
    let best = null;
    for (const d of g.level.doors.list) {
      const [a, , b] = d.sides[0], [c, , e] = d.sides[1], x = (a + c) / 2, z = (b + e) / 2, dist = Math.hypot(x - p.x, z - p.z);
      if (dist < 1.8 && (!best || dist < best.dist)) best = { x, z, dist };
    }
    return best;
  });

  /** Що робить мисливець: позиція, стан, відстань, чи гравець у воді. */
  const threat = () => page.evaluate(() => {
    const g = window.__zk.game, s = g.hunt.stalker, p = g.player.pos;
    if (!s) return null;
    return { kind: s.kind, x: s.pos.x, z: s.pos.z, st: s.brain.state, d: Math.hypot(s.pos.x - p.x, s.pos.z - p.z), sub: s.sub ?? 0,
      wet: !!g.level.water?.wetAt(p.x, p.z), flash: g.flashlightOn, bat: g.battery };
  });

  /** Тактика проти мисливця (повертає true, якщо цей крок зайнятий нею). */
  async function react(t, dt) {
    if (!t || !tactic) return false;
    const hunting = t.st === 'chase' || t.st === 'investigate';
    if (t.st === 'chase') m.chaseS += dt;
    if (t.sub < 0.5) m.minDist = Math.min(m.minDist, t.d);
    if ((t.kind === 'watcher' && t.d < 9 && t.st !== 'patrol') || (t.kind === 'smiler' && t.d < 7 && hunting)) {
      // обернутися й тримати поглядом (і ліхтариком) ~1.5 с
      if (t.kind === 'smiler' && !t.flash) await page.keyboard.press('KeyF');
      await page.keyboard.up('KeyW');
      await aim(t.x, 1.6, t.z);
      await wait(1500);
      m.faced++;
      await page.keyboard.down('KeyW');
      return true;
    }
    const crouch = (t.kind === 'blind' && t.d < 10) || (t.kind === 'drowned' && t.wet);
    const held = await page.evaluate(() => window.__zk.game.player.crouched);
    if (crouch !== held) { if (crouch) await page.keyboard.down('KeyC'); else await page.keyboard.up('KeyC'); }
    return false;
  }

  /** Іти до точки (W, повороти «мишею»); застряг — двері (E) або крок убік; після 5 спроб — «переступити» (рахується). */
  async function walkTo(tx, tz, { stop = 1.1, run = false, timeout = 600000, label = '', quiet = false } = {}) {
    let path = await navPath(tx, tz);
    await page.keyboard.down('KeyW');
    if (run) await page.keyboard.down('ShiftLeft');
    const start = Date.now();
    let i = 0, lastMove = Date.now(), last = null, ok = false, stuck = 0, prevT = Date.now();
    const deaths0 = (await state()).deaths;
    try {
      while (Date.now() - start < timeout) {
        const [wx, wz] = path[Math.min(i, path.length - 1)];
        const s = await page.evaluate(([wx, wz]) => {
          const g = window.__zk.game, p = g.player;
          const want = Math.atan2(-(wx - p.pos.x), -(wz - p.pos.z));
          const d = Math.atan2(Math.sin(p.yaw - want), Math.cos(p.yaw - want));
          g.input.lookX += Math.max(-0.35, Math.min(0.35, d));
          g.input.lookY += p.pitch * 0.5;
          return { x: p.pos.x, z: p.pos.z, deaths: g.store.progress.deaths, lv: g.level.id, draw: g.gfx.renderer.info.render.drawCalls, input: g.input.enabled };
        }, [wx, wz]);
        if (s.deaths > deaths0) return 'caught';
        (m.draws[s.lv] ??= []).push(s.draw);
        const now = Date.now(), dt = (now - prevT) / 1000; prevT = now;
        if (await react(await threat(), dt)) { path = await navPath(tx, tz); i = 0; last = null; lastMove = Date.now(); continue; }
        const dT = Math.hypot(tx - s.x, tz - s.z);
        if (dT < stop) { ok = true; break; }
        if (Math.hypot(wx - s.x, wz - s.z) < 0.55 && i < path.length - 1) i++;
        if (!s.input) { lastMove = Date.now(); await wait(200); continue; } // читає/кат-сцена
        if (!last || Math.hypot(s.x - last.x, s.z - last.z) > 0.2) { last = s; lastMove = Date.now(); }
        else if (Date.now() - lastMove > 1400) {
          if (stop >= 1 && dT < stop + 0.35) { ok = true; break; }
          const door = stuck % 3 === 2 ? null : await doorNear();
          if (door) {
            await page.keyboard.up('KeyW');
            await aim(door.x, 1.0, door.z);
            const p = (await state()).prompt ?? '';
            if (/Открыть|Закрыть/.test(p)) await page.keyboard.press('KeyE');
            await wait(1400);
            stuck++;
            await page.keyboard.down('KeyW');
          } else {
            const k = ++stuck % 2 ? 'KeyA' : 'KeyD';
            await page.keyboard.up('KeyW');
            await page.keyboard.down('KeyS'); await wait(300); await page.keyboard.up('KeyS');
            await page.keyboard.down(k); await wait(500); await page.keyboard.up(k);
            await page.keyboard.down('KeyW');
          }
          if (stuck >= 5) {
            const nx = path[Math.min(i + 1, path.length - 1)];
            await page.evaluate(([x, z]) => { const p = window.__zk.game.player; p.teleport(x, p.pos.y, z, p.yaw); }, nx);
            m.nudges++; stuck = 0;
          }
          path = await navPath(tx, tz); i = 0;
          lastMove = Date.now(); last = null;
        }
        await wait(60);
      }
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyC');
      if (run) await page.keyboard.up('ShiftLeft');
    }
    await wait(250);
    if (!ok && !quiet) { log(`дойти: ${label}`, false, { to: [tx, tz], at: await state() }); await shot(`fail-walk-${label}`); }
    return ok ? 'ok' : 'timeout';
  }

  async function approach(x, y, z, r0) {
    return page.evaluate(async ([x, y, z, r0]) => {
      const g = window.__zk.game, ph = g.physics, R = ph.R, p = g.player.pos;
      const ball = new R.Ball(0.36), rot = { x: 0, y: 0, z: 0, w: 1 };
      let best = null;
      for (const r of [r0, r0 - 0.2, r0 - 0.4, r0 + 0.2]) for (let a = 0; a < 24; a++) {
        const px = x + Math.cos((a / 24) * 6.283) * r, pz = z + Math.sin((a / 24) * 6.283) * r;
        if ([0.4, 0.95, 1.4].some((h) => ph.world.intersectionWithShape({ x: px, y: h, z: pz }, rot, ball, undefined, undefined, g.player.collider))) continue;
        if (!ph.lineOfSight(px, 1.6, pz, x, y, z)) continue;
        // не ставати в чашу басейну
        if (g.level.layout.pools.some((q) => Math.abs(px - q.x) < q.w / 2 + 0.2 && Math.abs(pz - q.z) < q.d / 2 + 0.2)) continue;
        const d = Math.hypot(px - p.x, pz - p.z);
        if (!best || d < best.d) best = { x: px, z: pz, d };
      }
      return best;
    }, [x, y, z, r0]);
  }

  /** Підійти до речі, навести погляд, дочекатися підказки й натиснути E. */
  async function useAt(x, y, z, label, { stop = 1.4, run = false } = {}) {
    const reach = await page.evaluate(([x, z]) => {
      const it = window.__zk.game.interact?.items.find((i) => Math.hypot(i.x - x, i.z - z) < 0.05);
      return it ? it.reach : 1.7;
    }, [x, z]);
    const rMax = Math.sqrt(Math.max(0.2, (reach - 0.2) ** 2 - (1.66 - y) ** 2));
    const ap = await approach(x, y, z, Math.min(1.1, stop, rMax));
    const r = ap ? await walkTo(ap.x, ap.z, { stop: 0.3, run, label }) : await walkTo(x, z, { stop, run, label });
    if (r !== 'ok') return r;
    await aim(x, y, z);
    await wait(300);
    const s = await state();
    if (!log(`подсказка E: ${label}`, !!s.prompt, { prompt: s.prompt, at: [s.x?.toFixed(2), s.z?.toFixed(2)], target: [x, y, z].map((v) => +v.toFixed(2)) })) { await shot(`fail-${label}`); return 'noprompt'; }
    await page.keyboard.press('KeyE');
    await wait(700);
    return 'ok';
  }

  /** E на документі → лист відкритий → E закриває. Плівка: E — слухати (без листа), просто йдемо далі. */
  async function take(it, label) {
    const r = await useAt(it.x, it.y, it.z, label);
    if (r !== 'ok') return r;
    const opened = await page.waitForFunction(() => !!document.querySelector('.reader.shown'), null, { timeout: 2500 }).then(() => true, () => false);
    if (opened) {
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => !document.querySelector('.reader') && window.__zk.game.input.enabled, null, { timeout: 4000 }).catch(() => {});
    }
    return 'ok';
  }

  /** Усі записи рівня (документ на столі, записки, плівки) і батарейки — у порядку найближчого сусіда. */
  async function collect(label) {
    for (let guard = 0; guard < 20; guard++) {
      const left = await page.evaluate(() => {
        const g = window.__zk.game, P = g.store.progress, have = new Set([...P.docs, ...P.notes, ...P.tapes]), p = g.player.pos;
        const list = [...Object.values(g.level.spots).map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z })),
          ...g.findings.map((f) => ({ id: f.id, x: f.x, y: f.y, z: f.z })),
          ...g.pickups.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, bat: true }))]
          .filter((i) => (i.bat ? !P.pickups.includes(i.id) : !have.has(i.id)) && g.interact.items.some((t) => t.id === i.id));
        list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        return list[0] ?? null;
      });
      if (!left) return 'ok';
      const r = await take(left, `${label}-${left.id}`);
      if (r === 'caught') return r;
      if (r !== 'ok') { // не дістався — прибрати з маршруту, щоб не зациклитися
        await page.evaluate((id) => { const g = window.__zk.game; g.interact.remove(id); }, left.id);
      }
    }
    return 'ok';
  }

  async function doTasks(label) {
    const its = await page.evaluate(() => window.__zk.game.interact.items.filter((i) => i.id.startsWith('task-') && i.id !== 'task-radio')
      .map((i) => ({ id: i.id, x: i.x, y: i.y, z: i.z })).sort((a, b) => (a.id === 'task-gate') - (b.id === 'task-gate')));
    for (const it of its) {
      if (await page.evaluate(() => window.__zk.game.tasks.gateOpen)) break;
      const r = await useAt(it.x, it.y, it.z, `${label}-${it.id}`);
      if (r !== 'ok') return r;
      await wait(1200);
    }
    const open = await page.evaluate(() => window.__zk.game.tasks.gateOpen);
    await shot(`${label}-gate`);
    return log(`задание уровня: ${label}`, open) ? 'ok' : 'gate';
  }

  async function seam(target, label) {
    const sp = await page.evaluate(() => { const s = window.__zk.game.level.seam.group; return { x: s.position.x, z: s.position.z }; });
    const r = await useAt(sp.x, 1.3, sp.z, label, { stop: 1.3 });
    if (r !== 'ok') return r;
    if (target === 5) return 'ok';
    const ok = await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled, target, { timeout: 90000 }).then(() => true, () => false);
    await wait(800);
    return ok ? 'ok' : 'noload';
  }

  return { m, state, aim, walkTo, useAt, collect, doTasks, seam, threat, setTactic: (v) => { tactic = v; } };
}
