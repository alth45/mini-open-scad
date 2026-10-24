export class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.vars = new Map();
        this.modules = new Map();
        this.funcs = new Map();
        this.childrenContext = null;
    }
    get(name) {
        let s = this;
        while (s) { if (s.vars.has(name)) return s.vars.get(name); s = s.parent; }
        return undefined;
    }
    set(name, v) { this.vars.set(name, v); }
    getModule(name) {
        let s = this;
        while (s) { if (s.modules.has(name)) return s.modules.get(name); s = s.parent; }
        return null;
    }
    getFunc(name) {
        let s = this;
        while (s) { if (s.funcs.has(name)) return s.funcs.get(name); s = s.parent; }
        return null;
    }

}

/**
 * Cari childrenContext terdekat di rantai scope.
 * @param {Scope} scope
 * @returns {{ children: any[], callerScope: Scope } | null}
 */
export function findChildrenContext(scope) {
    let s = scope;
    while (s) {
        if (s.childrenContext) return s.childrenContext;
        s = s.parent;
    }
    return null;
}