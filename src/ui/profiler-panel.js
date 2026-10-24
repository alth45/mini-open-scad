import { escapeHtml } from '../utils.js';
import { profiler } from '../profiler.js';

const COLOR_OK = 'var(--ok)';
const COLOR_WARN = 'var(--warn)';
const COLOR_ERR = 'var(--err)';
const COLOR_ACC = 'var(--accent-hi)';

function fmt(ms) {
    if (ms == null) return '—';
    if (ms < 1) return ms.toFixed(2) + ' ms';
    if (ms < 10) return ms.toFixed(1) + ' ms';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
}
function fmtInt(n) {
    return (n | 0).toLocaleString('id-ID');
}
function timeAgo(ts) {
    const dt = Date.now() - ts;
    if (dt < 1000) return 'baru saja';
    if (dt < 60_000) return Math.floor(dt / 1000) + 's lalu';
    if (dt < 3_600_000) return Math.floor(dt / 60_000) + 'm lalu';
    return Math.floor(dt / 3_600_000) + 'h lalu';
}
function totalColor(ms) {
    if (ms < 300) return COLOR_OK;
    if (ms < 1500) return COLOR_WARN;
    return COLOR_ERR;
}

export function createProfilerPanel(panelEl) {
    let activeTab = 'current';

    panelEl.innerHTML = `
    <div class="prof-head">
      <span class="prof-title">📊 Profiler</span>
      <div class="prof-tabs">
        <button class="prof-tab active" data-tab="current">Current</button>
        <button class="prof-tab" data-tab="history">History</button>
        <button class="prof-tab" data-tab="hotspots">Hotspots</button>
      </div>
      <div class="spacer"></div>
      <button class="prof-btn" id="profClear" title="Clear history">🗑</button>
      <button class="prof-btn" id="profCollapse" title="Collapse / expand">▾</button>
      <button class="prof-btn" id="profClose" title="Close (Esc)">✕</button>
    </div>
    <div class="prof-body" id="profBody"></div>
  `;

    const bodyEl = panelEl.querySelector('#profBody');

    /* --- tabs --- */
    panelEl.querySelectorAll('.prof-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTab = btn.dataset.tab;
            panelEl.querySelectorAll('.prof-tab').forEach(b =>
                b.classList.toggle('active', b === btn));
            render();
        });
    });

    /* --- buttons --- */
    panelEl.querySelector('#profClose').addEventListener('click', hide);
    panelEl.querySelector('#profCollapse').addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
    });
    panelEl.querySelector('#profClear').addEventListener('click', () => {
        profiler.clear();
    });

    /* --- subscribe --- */
    profiler.onChange(() => {
        if (panelEl.classList.contains('hidden')) return;
        render();
    });

    /* --- render --- */
    function render() {
        if (activeTab === 'current') renderCurrent();
        else if (activeTab === 'history') renderHistory();
        else if (activeTab === 'hotspots') renderHotspots();
    }

    function renderCurrent() {
        const e = profiler.latest();
        if (!e) {
            bodyEl.innerHTML = `<div class="prof-empty">Belum ada render. Jalankan Render (Ctrl+Enter).</div>`;
            return;
        }
        const b = e.breakdown || {};
        const parts = [
            { name: 'tokenize', ms: b.tokenize },
            { name: 'parse', ms: b.parse },
            { name: 'eval', ms: b.eval },
            { name: 'stats', ms: b.stats },
            { name: 'serialize', ms: b.serialize },
            { name: 'deserialize', ms: b.deserialize }
        ].filter(p => p.ms != null);
        const workerTime = e.workerRoundtrip ?? 0;

        bodyEl.innerHTML = `
      <div class="prof-metrics">
        <div class="prof-metric">
          <div class="prof-metric-label">Total</div>
          <div class="prof-metric-value" style="color:${e.error ? COLOR_ERR : totalColor(e.totalMs)}">
            ${fmt(e.totalMs)}
          </div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Worker roundtrip</div>
          <div class="prof-metric-value">${fmt(workerTime)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Mesh</div>
          <div class="prof-metric-value">${fmtInt(e.meshCount)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Triangle</div>
          <div class="prof-metric-value">${fmtInt(e.triCount)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Vertex</div>
          <div class="prof-metric-value">${fmtInt(e.vertexCount)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Status</div>
          <div class="prof-metric-value" style="color:${e.error ? COLOR_ERR : COLOR_OK}">
            ${e.error ? 'Error' : 'OK'}
          </div>
        </div>
      </div>

      ${parts.length > 0 ? `
        <div class="prof-breakdown">
          ${renderBreakdownBars(parts, e.error ? 0 : e.totalMs)}
        </div>
      ` : ''}

      ${renderOpsTable(e.opTimings, 'Ops di render terakhir')}
    `;
    }

    function renderBreakdownBars(parts, total) {
        const maxMs = Math.max(...parts.map(p => p.ms || 0), 1);
        return parts.map(p => {
            const pct = Math.max(2, (p.ms / maxMs) * 100);
            return `
        <div class="prof-bar-row">
          <div class="prof-bar-label">${p.name}</div>
          <div class="prof-bar-track">
            <div class="prof-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="prof-bar-value">${fmt(p.ms)}</div>
          <div class="prof-bar-pct">${total > 0 ? Math.round((p.ms / total) * 100) : 0}%</div>
        </div>
      `;
        }).join('');
    }

    function renderOpsTable(opTimings, title) {
        if (!opTimings) return '';
        const entries = Object.entries(opTimings)
            .map(([name, s]) => ({ name, ...s }))
            .sort((a, b) => b.total - a.total);
        if (entries.length === 0) return '';

        const maxTotal = Math.max(...entries.map(e => e.total), 1);
        return `
      <div class="prof-ops-title">${escapeHtml(title || 'Ops')}</div>
      <div class="prof-ops">
        ${entries.map(e => `
          <div class="prof-op-row">
            <div class="prof-op-name">${escapeHtml(e.name)}</div>
            <div class="prof-bar-track" style="flex:1">
              <div class="prof-bar-fill" style="width:${(e.total / maxTotal) * 100}%"></div>
            </div>
            <div class="prof-op-value">${fmt(e.total)}</div>
            <div class="prof-op-count">×${e.count}</div>
            <div class="prof-op-max">max ${fmt(e.max)}</div>
          </div>
        `).join('')}
      </div>
    `;
    }

    function renderHistory() {
        const hist = profiler.history;
        if (hist.length === 0) {
            bodyEl.innerHTML = `<div class="prof-empty">Belum ada history.</div>`;
            return;
        }
        const s = profiler.stats();
        bodyEl.innerHTML = `
      <div class="prof-metrics">
        <div class="prof-metric">
          <div class="prof-metric-label">Renders</div>
          <div class="prof-metric-value">${s.count}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Avg</div>
          <div class="prof-metric-value">${fmt(s.avgMs)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Min</div>
          <div class="prof-metric-value" style="color:${COLOR_OK}">${fmt(s.minMs)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Max</div>
          <div class="prof-metric-value" style="color:${totalColor(s.maxMs)}">${fmt(s.maxMs)}</div>
        </div>
        <div class="prof-metric">
          <div class="prof-metric-label">Error rate</div>
          <div class="prof-metric-value">${Math.round(s.errorRate * 100)}%</div>
        </div>
      </div>
      <table class="prof-table">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Total</th>
            <th>Eval</th>
            <th>Mesh</th>
            <th>Tri</th>
            <th>Status</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          ${hist.map(e => `
            <tr class="${e.error ? 'prof-row-err' : ''}">
              <td>${timeAgo(e.timestamp)}</td>
              <td style="color:${totalColor(e.totalMs)}">${fmt(e.totalMs)}</td>
              <td>${fmt((e.breakdown || {}).eval)}</td>
              <td>${fmtInt(e.meshCount)}</td>
              <td>${fmtInt(e.triCount)}</td>
              <td>${e.error
                ? `<span style="color:${COLOR_ERR}">✖</span>`
                : `<span style="color:${COLOR_OK}">✔</span>`}</td>
              <td class="prof-preview">${escapeHtml(e.preview || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    }

    function renderHotspots() {
        const hs = profiler.hotspots(15);
        if (hs.length === 0) {
            bodyEl.innerHTML = `<div class="prof-empty">Belum ada data op. Render beberapa kali untuk melihat hotspot.</div>`;
            return;
        }
        const maxTotal = Math.max(...hs.map(h => h.total), 1);
        bodyEl.innerHTML = `
      <div class="prof-ops-title">Hotspots (agregat ${profiler.history.length} render terakhir)</div>
      <div class="prof-ops">
        ${hs.map(h => `
          <div class="prof-op-row">
            <div class="prof-op-name">${escapeHtml(h.name)}</div>
            <div class="prof-bar-track" style="flex:1">
              <div class="prof-bar-fill" style="width:${(h.total / maxTotal) * 100}%"></div>
            </div>
            <div class="prof-op-value">${fmt(h.total)}</div>
            <div class="prof-op-count">×${h.count}</div>
            <div class="prof-op-max">max ${fmt(h.max)}</div>
          </div>
        `).join('')}
      </div>
    `;
    }

    /* --- public API --- */
    function show() {
        panelEl.classList.remove('hidden');
        render();
    }
    function hide() {
        panelEl.classList.add('hidden');
    }
    function toggle() {
        if (panelEl.classList.contains('hidden')) show();
        else hide();
    }
    function isVisible() {
        return !panelEl.classList.contains('hidden');
    }

    return { show, hide, toggle, isVisible, render };
}