// Що за збірка запущена: коміт і час збірки (vite.config.ts → define). Йде в кожен відгук гравця.
declare const __BUILD__: { commit: string; date: string };

export const BUILD: { commit: string; date: string } = typeof __BUILD__ === 'object' ? __BUILD__ : { commit: 'unknown', date: '' };
