// Фізика речей у грі (Назар 23.11: «повноцінна фізика»): узяти річ, нести, крутити, кинути (монстр чує, куди впала),
// настільна лампа б'ється об підлогу, кинута річ розбиває плафон на стелі (лампа гасне), книги знімаються з полиці,
// стіл штовхається. Консоль — чиста.
//   node tests/e2e/physics.mjs [webkit|chromium] [--prod]   → .shots/physics-*.png; код 1 — якщо щось не так
import { startServer, openPage, gotoGame } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
const waitGame = async (s) => { const t = await page.evaluate(() => window.__zk.game.time); await page.waitForFunction((t) => window.__zk.game.time > t, t + s, { timeout: 180000 }); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.waitForFunction(() => window.__zk.game.dressed?.length > 0, null, { timeout: 180000 });
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.input.enabled, null, { timeout: 120000 });
await waitGame(1.0);
// шум для монстра — записуємо, щоб перевірити, що кинута річ «кличе» його туди, де впала
await page.evaluate(() => {
  const g = window.__zk.game, orig = g.hunt.noise.bind(g.hunt);
  window.__noises = [];
  g.hunt.noise = (x, y, z, l) => { window.__noises.push({ x, y, z, l, t: g.time }); return orig(x, y, z, l); };
  // помічник: поставити гравця за d м від речі так, щоб між ними нічого не було, і дивитись на неї
  window.__face = (it, d = 1.15) => {
    const c = it.body.worldCom(), p = g.physics;
    for (let a = 0; a < 24; a++) {
      const ang = a * Math.PI / 12, dx = Math.sin(ang), dz = Math.cos(ang);
      const sx = c.x + dx * d, sz = c.z + dz * d;
      // точка стоянки вільна (капсула 0.3 м) і промінь від очей до речі влучає в неї саму
      let free = true;
      for (let k = 0; k < 8 && free; k++) { const b = k * Math.PI / 4; if ((p.raycast(sx, 0.9, sz, Math.sin(b), 0, Math.cos(b), 0.36, 1 | 8 | 16) ?? 1) < 0.36) free = false; }
      if (!free) continue;
      const ex = sx, ey = 1.66, ez = sz, vx = c.x - ex, vy = c.y - ey, vz = c.z - ez, l = Math.hypot(vx, vy, vz);
      const hit = p.castCollider(ex, ey, ez, vx / l, vy / l, vz / l, 3, 1 | 8 | 16);
      if (!hit || g.physics.knock.itemOf(hit.collider) !== it) continue;
      g.player.teleport(sx, 0, sz, Math.atan2(-vx, -vz));
      g.player.pitch = Math.atan2(vy, Math.hypot(vx, vz));
      return true;
    }
    return false;
  };
});

const stats = await page.evaluate(() => {
  const k = window.__zk.game.physics.knock, by = {};
  for (const it of k.list) by[it.file] = (by[it.file] ?? 0) + 1;
  return { total: k.count, grab: k.list.filter((i) => i.grab).length, by };
});
check('на рівні 0 рухомих речей багато (стільці, столи, лампи, книги, папери)', stats.total > 80 && stats.grab > 40 && stats.by['desk-lamp'] > 0 && stats.by.books > 0 && stats.by.desk > 0, stats);

// 1) узяти стілець, понести, повернутися — річ іде за поглядом, не провалюється
const grab = await page.evaluate(() => {
  const g = window.__zk.game, k = g.physics.knock;
  const it = k.list.filter((i) => i.file === 'chair' && i.body.isSleeping()).sort((a, b) => {
    const p = g.player.pos, ta = a.body.translation(), tb = b.body.translation();
    return Math.hypot(ta.x - p.x, ta.z - p.z) - Math.hypot(tb.x - p.x, tb.z - p.z);
  }).find((i) => window.__face(i));
  if (!it) return null;
  window.__it = it;
  return { id: it.id, file: it.file };
});
check('є стілець, до якого можна підійти', !!grab, grab);
if (grab) {
  await waitGame(0.3);
  const tgt = await page.evaluate(() => ({ target: window.__zk.game.props.carry.target?.id ?? null, prompt: document.querySelector('.prompt')?.textContent ?? '' }));
  check('погляд на річ — підказка «Взять»', tgt.target === grab.id && /Взять/.test(tgt.prompt), tgt);
  await page.keyboard.press('e');
  await waitGame(0.8);
  const held = await page.evaluate(() => {
    const g = window.__zk.game, it = window.__it, c = it.body.worldCom(), cam = g.camera.position;
    return { held: g.props.carry.held?.id === it.id, d: Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z), y: c.y, prompt: document.querySelector('.prompt')?.textContent ?? '' };
  });
  check('стілець у руках: перед очима, підказка «Положить · ЛКМ — бросить»', held.held && held.d > 0.4 && held.d < 1.6 && held.y > 0.6 && /Положить/.test(held.prompt), held);
  await page.screenshot({ path: '.shots/physics-hold.png' });
  // поворот на 90° за пів секунди — річ іде за поглядом
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { window.__zk.game.player.yaw += Math.PI / 20; }); await waitGame(0.05); }
  await waitGame(0.6);
  const follow = await page.evaluate(() => {
    const g = window.__zk.game, it = window.__it, c = it.body.worldCom(), p = g.player, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const vx = c.x - p.pos.x, vz = c.z - p.pos.z, l = Math.hypot(vx, vz);
    return { held: g.props.carry.held?.id === it.id, cos: (vx * fx + vz * fz) / l };
  });
  check('повернувся — стілець перед очима (або випав, якщо вперся в стіну)', !follow.held || follow.cos > 0.8, follow);
  if (!follow.held) await page.evaluate(() => { const g = window.__zk.game; window.__face(window.__it); g.props.carry.grab(window.__it, g.props.eye(g.player)); });
  await waitGame(0.5);
  // 2) кинути вздовж найдовшого вільного напрямку: летить, гримить — монстр чує там, де впало
  const before = await page.evaluate(() => {
    const g = window.__zk.game, p = g.player.pos;
    let best = 0, yaw = 0;
    for (let a = 0; a < 24; a++) { const y = a * Math.PI / 12, d = g.physics.raycast(p.x, 1.4, p.z, -Math.sin(y), 0, -Math.cos(y), 12, 1 | 8 | 16) ?? 12; if (d > best) { best = d; yaw = y; } }
    g.player.yaw = yaw; g.player.pitch = 0.15;
    window.__noises.length = 0;
    return { open: best };
  });
  await waitGame(0.7);
  const start = await page.evaluate(() => { const t = window.__it.body.translation(); return { x: t.x, z: t.z, held: !!window.__zk.game.props.carry.held }; });
  await page.evaluate(() => window.__zk.game.input.press('throw'));
  await waitGame(2.2);
  const thrown = await page.evaluate((b) => {
    const g = window.__zk.game, t = window.__it.body.translation();
    const ns = window.__noises.filter((n) => Math.hypot(n.x - t.x, n.z - t.z) < 3);
    return { held: !!g.props.carry.held, moved: Math.hypot(t.x - b.x, t.z - b.z), noises: ns.length, loud: Math.max(0, ...ns.map((n) => n.l)) };
  }, start);
  check('кинутий стілець відлетів і гримнув (шум там, де впав)', start.held && !thrown.held && thrown.moved > 1.2 && thrown.noises > 0 && thrown.loud > 0.4, { ...before, ...thrown });
}

// 3) настільна лампа падає зі столу на підлогу — скло дзвенить, друзки
const lamp = await page.evaluate(() => {
  const g = window.__zk.game, k = g.physics.knock, it = k.list.find((i) => i.file === 'desk-lamp' && !i.cracked);
  if (!it) return null;
  const t = it.body.translation();
  it.body.setTranslation({ x: t.x, y: 1.6, z: t.z }, true);
  it.body.setLinvel({ x: 0, y: -6.5, z: 0 }, true);
  window.__lamp = it;
  return { id: it.id };
});
await waitGame(1.0);
const lampRes = await page.evaluate(() => {
  const it = window.__lamp, sh = window.__zk.game.props.shards.filter((s) => s.body).length;
  return { cracked: it?.cracked ?? false, shards: sh };
});
check('настільна лампа впала — скло розбилось на друзки', !!lamp && lampRes.cracked && lampRes.shards > 0, lampRes);

// 4) кинута річ влучає в плафон — лампа гасне назавжди
const ceil = await page.evaluate(() => {
  const g = window.__zk.game, L = g.level, k = g.physics.knock, lamps = L.lamps;
  const i = L.layout.lights.findIndex((p, j) => lamps.levelOf(j) > 0.5);
  const p = L.layout.lights[i];
  const it = k.list.find((x) => x.grab && !x.held && x.file !== 'desk-lamp' && x !== window.__it);
  it.body.setTranslation({ x: p.x, y: L.layout.height - 1.2, z: p.z }, true);
  it.body.setLinvel({ x: 0, y: 7, z: 0 }, true);
  it.thrown = 2;
  window.__lampI = i;
  return { i, file: it.file };
});
await waitGame(1.2);
const ceilRes = await page.evaluate(() => ({ level: window.__zk.game.level.lamps.levelOf(window.__lampI) }));
check('кинута річ розбила плафон — лампа погасла', ceilRes.level < 0.01, { ...ceil, ...ceilRes });

// 5) книги з полиці: узяти й відійти — книги в руках, полиця не виштовхує їх
const books = await page.evaluate(() => {
  const g = window.__zk.game, k = g.physics.knock;
  const it = k.list.filter((i) => i.file === 'books').find((i) => window.__face(i, 1.0));
  if (!it) return null;
  window.__books = it;
  const t = it.body.translation();
  return { id: it.id, y: t.y, sleeping: it.body.isSleeping() };
});
check('книги стоять на полиці спокійно (не вилітають на старті)', !!books && books.sleeping, books);
if (books) {
  await waitGame(0.3);
  await page.keyboard.press('e');
  await waitGame(0.4);
  await page.evaluate(() => { const p = window.__zk.game.player; p.teleport(p.pos.x + Math.sin(p.yaw) * 0.5, 0, p.pos.z + Math.cos(p.yaw) * 0.5, p.yaw); });
  await waitGame(0.8);
  const br = await page.evaluate((b) => {
    const g = window.__zk.game, it = window.__books, t = it.body.translation(), v = it.body.linvel();
    return { held: g.props.carry.held?.id === it.id, dy: t.y - b.y, speed: Math.hypot(v.x, v.y, v.z) };
  }, books);
  check('книги зняті з полиці й у руках', br.held && br.speed < 4, br);
  await page.screenshot({ path: '.shots/physics-books.png' });
  await page.keyboard.press('e');
}

// 6) дерев'яна парта штовхається, коли в неї врізаєшся
const table = await page.evaluate(() => {
  const g = window.__zk.game, k = g.physics.knock;
  const it = k.list.filter((i) => i.file === 'school-desk').find((i) => window.__face(i, 1.6));
  if (!it) return null;
  window.__table = it;
  g.player.pitch = 0;
  const t = it.body.translation();
  return { x: t.x, z: t.z };
});
if (table) {
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  await waitGame(1.4);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await waitGame(0.6);
  const tr = await page.evaluate((b) => { const t = window.__table.body.translation(); return { moved: Math.hypot(t.x - b.x, t.z - b.z) }; }, table);
  check('парту можна посунути тілом', tr.moved > 0.05, tr);
} else check('є парта на рівні 0', false);

const perf = await page.evaluate(() => ({ moving: window.__zk.game.physics.knock.moving, bodies: window.__zk.game.physics.world.bodies.len() }));
console.log('фізика:', JSON.stringify(perf));
check('консоль без ошибок и предупреждений', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
