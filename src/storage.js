import { CONFIG } from './config.js';

export function saveToStorage(code, autoRender, paramValues = {}) {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify({ code, autoRender, paramValues }));
  } catch { /* private mode */ }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.code !== 'string') return null;
    return {
      code: data.code,
      autoRender: typeof data.autoRender === 'boolean' ? data.autoRender : true,
      paramValues: (data.paramValues && typeof data.paramValues === 'object')
        ? data.paramValues : {}
    };
  } catch {
    return null;
  }
}