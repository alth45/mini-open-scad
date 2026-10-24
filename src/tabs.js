let nextTabId = 1;

export function createTab(name = 'Untitled', code = '', paramValues = {}, autoRender = true) {
    return {
        id: 'tab_' + Date.now().toString(36) + '_' + (nextTabId++).toString(36),
        name,
        code,
        paramValues,
        autoRender
    };
}

export class TabManager {
    constructor({ onListChange, onActiveChange } = {}) {
        this.tabs = [];
        this.activeId = null;
        this.onListChange = onListChange;
        this.onActiveChange = onActiveChange;
    }

    get active() {
        return this.tabs.find(t => t.id === this.activeId) || null;
    }

    /** Bootstrap: data { tabs, activeId } | null */
    load(data) {
        if (data && Array.isArray(data.tabs) && data.tabs.length > 0) {
            this.tabs = data.tabs;
            this.activeId = (data.activeId && data.tabs.find(t => t.id === data.activeId))
                ? data.activeId
                : data.tabs[0].id;
        } else {
            const tab = createTab('Project 1');
            this.tabs = [tab];
            this.activeId = tab.id;
        }
        this._notifyList();
        this._notifyActive();
    }

    add(tab, { switchTo = true } = {}) {
        this.tabs.push(tab);
        this._notifyList();
        if (switchTo) this.setActive(tab.id);
    }

    remove(id) {
        if (this.tabs.length <= 1) return false;
        const idx = this.tabs.findIndex(t => t.id === id);
        if (idx === -1) return false;
        this.tabs.splice(idx, 1);
        if (this.activeId === id) {
            this.activeId = this.tabs[Math.min(idx, this.tabs.length - 1)].id;
            this._notifyList();
            this._notifyActive();
        } else {
            this._notifyList();
        }
        return true;
    }

    rename(id, name) {
        const t = this.tabs.find(x => x.id === id);
        if (!t) return;
        t.name = (name || '').trim() || 'Untitled';
        this._notifyList();
    }

    setActive(id) {
        if (this.activeId === id) return;
        if (!this.tabs.find(t => t.id === id)) return;
        this.activeId = id;
        this._notifyList();
        this._notifyActive();
    }

    /** Update data tab aktif tanpa trigger notifikasi (untuk onChange). */
    updateActiveSilent(fields) {
        const t = this.active;
        if (!t) return;
        Object.assign(t, fields);
    }

    _notifyList() { this.onListChange?.(this.tabs, this.activeId); }
    _notifyActive() { this.onActiveChange?.(this.active); }
}