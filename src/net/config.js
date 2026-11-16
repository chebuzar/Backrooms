// Адрес сервера игры (аккаунты, облачные сохранения, отчёты, уведомления). Исходник сервера — server/ в репозитории,
// размещён на Ample. Адрес публичный — секретов здесь нет.
export const SERVER = ((import.meta.env && import.meta.env.VITE_SERVER_URL) || 'https://2x34tgfzwyad.ample.run').replace(/\/$/, '');
// Автотесты (Playwright: navigator.webdriver) и dev-сервер не шлют отчёты на настоящий сервер, если не попросить ?reports.
export const LIVE_REPORTS = !(navigator.webdriver || (import.meta.env && import.meta.env.DEV)) || /[?&]reports\b/.test(location.search);
