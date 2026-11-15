// Smoke-тест: собранная игра открывается, движок стартует, меню работает, в консоли нет ошибок.
// Запуск: npm run build && npm run smoke
// Браузеры: SMOKE_BROWSERS=chromium,webkit (по умолчанию оба; webkit = движок Safari).
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const shots = process.env.SHOTS_DIR;
const BROWSERS = (process.env.SMOKE_BROWSERS || 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);
const LAUNCH = {
  chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  webkit: {}
};

const server = await preview({ preview: { port: 4179, strictPort: true } });
const base = server.resolvedUrls?.local?.[0] || 'http://localhost:4179/';
let failed = false;

for (const bname of BROWSERS) {
const browser = await pw[bname].launch(LAUNCH[bname]);
for (const lang of ['ru', 'uk', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(base + '?lang=' + lang);
  try {
    await page.waitForFunction(() => window.__zkReady === true, null, { timeout: 45000 });
    await page.click('#splash');
    await page.waitForSelector('#menu.on, #menu:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const title = await page.title();
    const newGame = await page.textContent('#bNew');
    console.log(`[${bname}/${lang}] ok — title "${title}", button "${newGame}"`);
    if (shots) await page.screenshot({ path: `${shots}/menu-${bname}-${lang}.png` });
    if (lang === 'ru') {
      // Полный старт уровня 0: пролог, карточка уровня, несколько секунд движения.
      await page.click('#bNew');
      await page.waitForTimeout(600);
      await page.mouse.click(640, 360); // пропустить пролог
      await page.waitForSelector('#hud.on', { timeout: 90000 });
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
      await page.keyboard.press('KeyF'); await page.waitForTimeout(1500);
      console.log(`[${bname}/${lang}] level 0 started, objective: "${(await page.textContent('#obj')).trim()}"`);
      if (shots) await page.screenshot({ path: `${shots}/play-${bname}-${lang}.png` });
    }
  } catch (e) {
    failed = true;
    console.log(`[${bname}/${lang}] FAIL: ${e.message}; loadMsg: ${await page.textContent('#loadMsg').catch(() => '?')}`);
  }
  if (errors.length) { failed = true; console.log(`[${bname}/${lang}] errors:\n  ` + errors.join('\n  ')); }
  await page.close();
}

// WebAudio и WebGL иногда держат headless-браузер открытым — не ждём больше 5 с.
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}
server.httpServer.closeAllConnections?.();
server.httpServer.close();
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
