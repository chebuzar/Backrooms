// Пристрій гравця: платформа, форм-фактор і орієнтовна сила відеокарти.
// Від цього залежить стартовий профіль графіки; далі його уточнює вимірювання кадрів (quality.ts).

export type Platform = 'apple' | 'android' | 'other';
export type Form = 'phone' | 'tablet' | 'desktop';

export interface DeviceInfo {
  platform: Platform;
  form: Form;
  touch: boolean;
  dpr: number;
  cores: number;
  /** Назва відеокарти, якщо браузер її повідомляє (WebGPU adapter info). */
  gpu: string;
  /** Програмний рендер (контейнер, CI): графіку тримаємо мінімальною. */
  software: boolean;
}

export function detectDevice(gpu = ''): DeviceInfo {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1 || 'ontouchstart' in window;
  // iPadOS видає себе за Mac, але має сенсорний екран
  const apple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  const android = /Android/.test(ua);
  const platform: Platform = apple ? 'apple' : android ? 'android' : 'other';
  const minSide = Math.min(screen.width, screen.height);
  const form: Form = !touch ? 'desktop' : minSide < 600 ? 'phone' : 'tablet';
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  return {
    platform,
    form,
    touch,
    dpr: Math.min(window.devicePixelRatio || 1, 3),
    cores: navigator.hardwareConcurrency || 4,
    gpu,
    software
  };
}
