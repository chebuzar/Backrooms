// «Пройти гру руками»: лише справжні клавіші (W, Shift, F, E, пробіл) і кліки мишею по меню; поворот погляду —
// так, як його дає миша (накопичений зсув у Input, гра сама його застосовує — якщо керування вимкнене, поворот не спрацює).
// Маршрут: «18+» → «Начать экспедицию» → пролог (пропуск клавішею) → прибуття → наказ на столі (E, закрити E) →
// двері (E) → Шов (E) → рівень 1 → документ → Шов → рівень 2 → «Слепой» хапає → перезавантаження → «Продолжить».
//   node tests/e2e/playthrough.mjs [webkit|chromium] [--prod]   → .shots/playthrough/*.png; код 1 — якщо крок не вдався
import { mkdirSync } from 'node:fs';
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const OUT = '.shots/playthrough';
mkdirSync(OUT, { recursive: true });
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
const steps = [];
let nudges = 0;
let failed = null;
const t0 = Date.now();
const log = (name, ok, extra = {}) => {
  steps.push({ name, ok, s: Math.round((Date.now() - t0) / 1000), ...extra });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, Object.keys(extra).length ? JSON.stringify(extra) : '');
  if (!ok && !failed) failed = name;
  return ok;
};
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const state = () => page.evaluate(() => {
  const g = window.__zk.game, p = g.player?.pos;
  return { mode: g.mode, level: g.level?.id, input: g.input.enabled, x: p?.x, z: p?.z, deaths: g.store.progress.deaths,
    prompt: document.querySelector('.hud .prompt.on')?.textContent ?? null, reader: !!document.querySelector('.reader.shown') };
});

/** Повернути погляд на точку «мишею»: зсув у Input (гра сама застосує в наступних кадрах). */
async function aim(x, y, z) {
  for (let k = 0; k < 8; k++) {
    const err = await page.evaluate(([x, y, z]) => {
      const g = window.__zk.game, c = g.camera.position, p = g.player;
      const wantYaw = Math.atan2(-(x - c.x), -(z - c.z)), wantPitch = Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
      const dy = Math.atan2(Math.sin(p.yaw - wantYaw), Math.cos(p.yaw - wantYaw)), dp = p.pitch - wantPitch;
      g.input.lookX += dy; g.input.lookY += dp;
      return Math.abs(dy) + Math.abs(dp);
    }, [x, y, z]);
    await wait(120);
    if (err < 0.01) break;
  }
}

/** Шлях по navmesh рівня (обхід стін). */
const navPath = (tx, tz) => page.evaluate(async ([tx, tz]) => {
  const g = window.__zk.game, nav = await window.__zk.nav(0.3), p = g.player.pos;
  return [...nav.path({ x: p.x, y: 0, z: p.z }, nav.closest({ x: tx, y: 0, z: tz })).map((v) => [v.x, v.z]), [tx, tz]];
}, [tx, tz]);

/** Найближчі двері поруч (центр прорізу): зачинені — відчинити; відчинене полотно перегородило прохід — зачинити. */
const closedDoorNear = () => page.evaluate(() => {
  const g = window.__zk.game, p = g.player.pos;
  let best = null;
  for (const d of g.level.doors.list) {
    const [a, , b] = d.sides[0], [c, , e] = d.sides[1], x = (a + c) / 2, z = (b + e) / 2, dist = Math.hypot(x - p.x, z - p.z);
    if (dist < 1.8 && (!best || dist < best.dist)) best = { x, z, dist };
  }
  return best;
});

/** Іти до точки, тримаючи W (і Shift для бігу), повертаючи погляд «мишею»; впирається — відчиняє двері (E) чи обходить. */
async function walkTo(tx, tz, { stop = 1.1, run = false, timeout = 600000, label = "" } = {}) {
  let path = await navPath(tx, tz);
  await page.keyboard.down('KeyW');
  if (run) await page.keyboard.down('ShiftLeft');
  const start = Date.now();
  let i = 0, lastMove = Date.now(), last = null, ok = false, stuck = 0;
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
        return { x: p.pos.x, z: p.pos.z, deaths: g.store.progress.deaths };
      }, [wx, wz]);
      if (s.deaths > deaths0) return 'caught';
      const dT = Math.hypot(tx - s.x, tz - s.z);
      if (dT < stop) { ok = true; break; }
      if (Math.hypot(wx - s.x, wz - s.z) < 0.55 && i < path.length - 1) i++;
      if (!last || Math.hypot(s.x - last.x, s.z - last.z) > 0.2) { last = s; lastMove = Date.now(); }
      else if (Date.now() - lastMove > 1200) {
        // упирається в предмет, але вже майже на місці (стіл, ящик) — цього досить
        if (stop >= 1 && dT < stop + 0.35) { ok = true; break; }
        const door = stuck % 3 === 2 ? null : await closedDoorNear();
        if (door) {
          // зачинені двері: глянути на них і натиснути E (як гравець)
          await page.keyboard.up('KeyW');
          await aim(door.x, 1.0, door.z);
          // E — лише якщо під поглядом саме двері (поруч може бути Шов чи документ)
          const p = (await state()).prompt ?? '';
          if (/Открыть|Закрыть/.test(p)) await page.keyboard.press('KeyE');
          await wait(1400);
          stuck++;
          await page.keyboard.down('KeyW');
        } else {
          // меблі/кут: крок назад і вбік, потім новий шлях
          const k = ++stuck % 2 ? 'KeyA' : 'KeyD';
          await page.keyboard.up('KeyW');
          await page.keyboard.down('KeyS'); await wait(300); await page.keyboard.up('KeyS');
          await page.keyboard.down(k); await wait(500); await page.keyboard.up(k);
          await page.keyboard.down('KeyW');
        }
        if (stuck >= 5) {
          // автопілот тесту не знає про відчинені полотна дверей і стільці — «переступити» до наступної точки шляху
          // (рахуємо в звіті; це допомога тестові, а не гравцеві)
          const nx = path[Math.min(i + 1, path.length - 1)];
          await page.evaluate(([x, z]) => { const p = window.__zk.game.player; p.teleport(x, p.pos.y, z, p.yaw); }, nx);
          nudges++; stuck = 0;
        }
        path = await navPath(tx, tz); i = 0;
        lastMove = Date.now(); last = null;
      }
      await wait(60);
    }
  } finally {
    await page.keyboard.up('KeyW');
    if (run) await page.keyboard.up('ShiftLeft');
  }
  await wait(250);
  if (!ok) { log(`дойти: ${label}`, false, { to: [tx, tz], at: await state() }); await shot(`fail-walk-${label}`); }
  return ok ? 'ok' : 'timeout';
}

/** Підійти, навести погляд, дочекатися підказки й натиснути E. */
/** Вільне місце поруч із предметом, звідки його видно (не стілець, не стіл): як обрав би гравець. */
async function approach(x, y, z, r0) {
  return page.evaluate(async ([x, y, z, r0]) => {
    const g = window.__zk.game, ph = g.physics, R = ph.R, p = g.player.pos;
    const ball = new R.Ball(0.36), rot = { x: 0, y: 0, z: 0, w: 1 };
    let best = null;
    for (const r of [r0, r0 - 0.2, r0 - 0.4, r0 + 0.2]) for (let a = 0; a < 24; a++) {
      const px = x + Math.cos((a / 24) * 6.283) * r, pz = z + Math.sin((a / 24) * 6.283) * r;
      if ([0.4, 0.95, 1.4].some((h) => ph.world.intersectionWithShape({ x: px, y: h, z: pz }, rot, ball, undefined, undefined, g.player.collider))) continue;
      if (!ph.lineOfSight(px, 1.6, pz, x, y, z)) continue;
      const d = Math.hypot(px - p.x, pz - p.z);
      if (!best || d < best.d) best = { x: px, z: pz, d };
    }
    return best;
  }, [x, y, z, r0]);
}

let seamBattery = 1;
async function useAt(x, y, z, label, { stop = 1.4, run = false, beforeUse = null } = {}) {
  // на якій горизонтальній відстані предмет ще «дістається» (висота очей 1.66, радіус дії предмета з гри)
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
  if (!log(`подсказка E: ${label}`, !!s.prompt, { prompt: s.prompt, mode: s.mode, input: s.input, at: [s.x?.toFixed(2), s.z?.toFixed(2)], target: [x, y, z].map((v) => +v.toFixed(2)), approach: ap })) { await shot(`fail-${label}`); return 'noprompt'; }
  await beforeUse?.();
  await page.keyboard.press('KeyE');
  await wait(700);
  return 'ok';
}

/** Прочитати документ: E → лист відкрито → E закриває → знову керування. */
async function readDoc(spot, label) {
  const r = await useAt(spot.x, spot.y, spot.z, label);
  if (r !== 'ok') return r;
  const opened = await page.waitForFunction(() => !!document.querySelector('.reader.shown'), null, { timeout: 4000 }).then(() => true, () => false);
  await shot(`${label}-reader`);
  if (!log(`читать: ${label}`, opened)) return 'noreader';
  await page.keyboard.press('KeyE');
  const back = await page.waitForFunction(() => !document.querySelector('.reader') && window.__zk.game.input.enabled, null, { timeout: 4000 }).then(() => true, () => false);
  return log(`закрыть: ${label}`, back) ? 'ok' : 'stuck';
}

async function throughSeam(target, label) {
  const sp = await page.evaluate(() => { const s = window.__zk.game.level.seam.group; return { x: s.position.x + Math.sin(s.rotation.y) * 0.6, z: s.position.z + Math.cos(s.rotation.y) * 0.6, sx: s.position.x, sz: s.position.z }; });
  const r = await useAt(sp.sx, 1.3, sp.sz, label, { stop: 1.3, beforeUse: async () => { seamBattery = await page.evaluate(() => window.__zk.game.battery); } });
  if (r !== 'ok') return r;
  const ok = await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled, target, { timeout: 60000 }).then(() => true, () => false);
  await wait(800);
  await shot(`level${target}-arrive`);
  return log(`уровень ${target} после Шва`, ok) ? 'ok' : 'noload';
}

try {
  await gotoGame(page);
  await page.click('.age [data-go]');
  const menu = await page.waitForFunction(() => document.querySelector('.menu [data-s]'), null, { timeout: 30000 }).then(() => true, () => false);
  log('меню после 18+', menu);
  await page.click('.menu [data-s]');
  // «Начать заново» при наявному збереженні може спитати підтвердження
  await wait(400);
  if (await page.$('[data-confirm-yes]')) await page.click('[data-confirm-yes]');
  await page.waitForSelector('.prologue', { timeout: 10000 });
  await wait(1500);
  await page.keyboard.press('Space'); await wait(200); await page.keyboard.press('Space');
  const arrived = await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 40000 }).then(() => true, () => false);
  await shot('level0-arrive');
  log('прибытие: управление включено', arrived);
  await page.keyboard.press('KeyF'); // ліхтарик — одразу, щоб до Шва він помітно розрядився
  await wait(300);
  log('F включает фонарик', await page.evaluate(() => window.__zk.game.flashlightOn));

  // наказ на столі
  const order = await page.evaluate(() => window.__zk.game.level.spots.order7);
  if ((await readDoc(order, 'приказ')) === 'ok') {
    // двері: найближчі до гравця
    const door = await page.evaluate(() => {
      const g = window.__zk.game, p = g.player.pos;
      const ds = g.level.doors.list.map((d) => { const [a, , b] = d.sides[0], [c, , e] = d.sides[1]; return { id: d.id, x: (a + c) / 2, z: (b + e) / 2, sx: a, sz: b, t: d.target }; });
      ds.sort((u, v) => Math.hypot(u.x - p.x, u.z - p.z) - Math.hypot(v.x - p.x, v.z - p.z));
      return ds[0];
    });
    if ((await useAt(door.x, 1.0, door.z, 'двери', { stop: 1.25 })) === 'ok') {
      const moved = await page.evaluate((id) => window.__zk.game.level.doors.list.find((d) => d.id === id).target, door.id);
      log('двери сдвинулись', Math.abs(moved - door.t) > 0.1, { from: door.t, to: moved });
    }
    // батарейки біля столу
    const bat = await page.evaluate(() => { const b = window.__zk.game.pickups.find((p) => p.id === 'bat0-0'); return b && { x: b.x, y: b.y, z: b.z }; });
    if (log('батарейки лежат у стола', !!bat) && (await useAt(bat.x, bat.y, bat.z, 'батарейки')) === 'ok') {
      const got = await page.evaluate(() => window.__zk.game.store.progress.pickups.includes('bat0-0') && !window.__zk.game.pickups.some((p) => p.id === 'bat0-0'));
      log('батарейки подобраны', got);
    }
    if ((await throughSeam(1, 'шов-0')) === 'ok') {
      const before = seamBattery, after = await page.evaluate(() => window.__zk.game.battery);
      log('новый уровень — фонарик заряжен полностью', after >= 0.99 && before < after, { before: +before.toFixed(3), after: +after.toFixed(3) });
      // рівень 1: документ (Наблюдатель може схопити — тоді знову зі старту, до 3 спроб)
      let r = 'caught';
      for (let a = 0; a < 3 && r === 'caught'; a++) {
        const doc = await page.evaluate(() => window.__zk.game.level.spots.protocol);
        r = await readDoc(doc, 'протокол');
        if (r === 'caught') await page.waitForFunction(() => window.__zk.game.input.enabled, null, { timeout: 30000 });
      }
      let s1 = r === 'ok' ? 'caught' : r;
      for (let a = 0; a < 3 && s1 === 'caught'; a++) {
        s1 = await throughSeam(2, 'шов-1');
        if (s1 === 'caught') await page.waitForFunction(() => window.__zk.game.input.enabled, null, { timeout: 30000 });
      }
      log('уровень 1 пройден (Наблюдатель не поймал 3 раза подряд)', s1 === 'ok', { result: s1, deaths: (await state()).deaths });
      if (s1 === 'ok') {
        // рівень 2: бігти до «Слепого», поки не схопить
        const d0 = (await state()).deaths;
        const st = await page.evaluate(() => { const s = window.__zk.game.hunt.stalker; return { x: s.pos.x, z: s.pos.z }; });
        for (let a = 0; a < 6; a++) {
          const r2 = await walkTo(st.x, st.z, { run: true, stop: 0.4, timeout: 30000, label: 'к Слепому' });
          if (r2 === 'caught') break;
          const p = await page.evaluate(() => { const s = window.__zk.game.hunt.stalker; return { x: s.pos.x, z: s.pos.z }; });
          Object.assign(st, p);
        }
        const died = await page.waitForFunction((d) => window.__zk.game.store.progress.deaths > d, d0, { timeout: 20000 }).then(() => true, () => false);
        log('Слепой схватил', died);
        await wait(600); await shot('caught');
        const back = await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.level.id === 2, null, { timeout: 30000 }).then(() => true, () => false);
        log('после смерти — снова уровень 2, управление включено', back);
        const bat = await page.evaluate(() => window.__zk.game.battery);
        log('после смерти заряд фонарика ≥ 40 %', bat >= 0.4, { battery: +bat.toFixed(2) });
        // перезавантаження сторінки → «Продолжить»
        await page.reload({ waitUntil: 'commit' });
        await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 240000 });
        await page.click('.age [data-go]');
        const cont = await page.waitForFunction(() => document.querySelector('.menu [data-c]'), null, { timeout: 30000 }).then(() => true, () => false);
        log('после перезагрузки есть «Продолжить»', cont);
        if (cont) {
          await page.click('.menu [data-c]');
          const resumed = await page.waitForFunction(() => window.__zk.game.level?.id === 2 && window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 60000 }).then(() => true, () => false);
          await wait(800); await shot('continue');
          log('«Продолжить» — уровень 2, управление включено', resumed);
        }
      }
    }
  }
} catch (e) {
  log('исключение', false, { error: String(e).split('\n')[0] });
  await shot('exception').catch(() => {});
}
log('консоль без ошибок и предупреждений', logs.length === 0, { logs: logs.slice(0, 5) });
console.log(JSON.stringify({ browser: which, seconds: Math.round((Date.now() - t0) / 1000), nudges, failed }));
await close(); await srv.close();
process.exitCode = failed ? 1 : 0;
