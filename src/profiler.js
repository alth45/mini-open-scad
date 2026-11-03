/* ============================================================
   Profiler — rekam & analisa data render
   ============================================================ */

const MAX_HISTORY = 100;

export class Profiler {
  constructor() {
    this.history = [];
    this.listeners = new Set();
  }

  record(entry) {
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
    this.listeners.forEach((fn) => fn(entry));
  }

  clear() {
    this.history = [];
    this.listeners.forEach((fn) => fn(null));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  latest() {
    return this.history[0] || null;
  }

  /** Agregasi per-op dari N render terakhir. */
  hotspots(limit = 15) {
    const agg = new Map();
    for (const e of this.history) {
      if (!e.opTimings) continue;
      for (const [name, stat] of Object.entries(e.opTimings)) {
        const cur = agg.get(name) || {
          name,
          total: 0,
          count: 0,
          max: 0,
          calls: 0,
        };
        cur.total += stat.total;
        cur.count += stat.count;
        cur.max = Math.max(cur.max, stat.max || 0);
        cur.calls += 1;
        agg.set(name, cur);
      }
    }
    return [...agg.values()].sort((a, b) => b.total - a.total).slice(0, limit);
  }

  /** Statistik ringkas. */
  stats() {
    if (this.history.length === 0) return null;
    const times = this.history.map((e) => e.totalMs);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      count: this.history.length,
      avgMs: avg,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
      errorRate: this.history.filter((e) => e.error).length / times.length,
    };
  }

  exportReport() {
    const report = {
      exportedAt: new Date().toISOString(),
      app: "Mini OpenSCAD",
      version: 1,
      stats: this.stats(),
      history: this.history,
      hotspots: this.hotspots(15),
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `render-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export const profiler = new Profiler();
