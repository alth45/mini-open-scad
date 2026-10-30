const OLD_KEY = 'mini-openscad-v1';
const NEW_KEY = 'mini-openscad-v2';

export function saveTabs(tabs, activeId, previewMode = true) {
  try {
    localStorage.setItem(NEW_KEY, JSON.stringify({ tabs, activeId, previewMode }));
  } catch { /* quota / private */ }
}

export function loadTabs() {
  try {
    const raw = localStorage.getItem(NEW_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.tabs) && data.tabs.length > 0) {
        return {
          tabs: data.tabs,
          activeId: data.activeId,
          previewMode: typeof data.previewMode === 'boolean' ? data.previewMode : true
        };
      }
    }

    /* migrasi dari v1 (single project) */
    const oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      if (typeof old.code === 'string') {
        const id = 'tab_migrated_' + Date.now().toString(36);
        const migrated = {
          tabs: [{
            id,
            name: 'Project 1',
            code: old.code,
            paramValues: (old.paramValues && typeof old.paramValues === 'object')
              ? old.paramValues : {},
            autoRender: typeof old.autoRender === 'boolean' ? old.autoRender : true
          }],
          activeId: id,
          previewMode: true
        };
        localStorage.removeItem(OLD_KEY);
        localStorage.setItem(NEW_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }

    return null;
  } catch {
    return null;
  }
}

const THEME_KEY = 'mini-openscad-theme';

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* quota / private */ }
}

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return (t === 'light' || t === 'dark') ? t : 'dark';
  } catch {
    return 'dark';
  }
}