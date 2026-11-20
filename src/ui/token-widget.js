/**
 * Widget untuk menampilkan token/cost stats di AI modal footer.
 * Subscribe ke `onStatsChange()` → update otomatis.
 */
import {
  snapshot,
  onStatsChange,
  resetStats,
  LIMITS,
} from "../ai/token-tracker.js";

export function createTokenWidget(containerEl) {
  if (!containerEl) {
    console.warn("[token-widget] container kosong");
    return { refresh: () => {}, destroy: () => {} };
  }

  containerEl.innerHTML = `
    <div class="ai-stats-inner">
      <span class="ai-stat" data-key="min" title="Request dalam 60 detik terakhir">
        <span class="ai-stat-label">min</span>
        <span class="ai-stat-val" data-val="min">0/${LIMITS.perMin}</span>
      </span>
      <span class="ai-stat" data-key="hr" title="Request dalam 60 menit terakhir">
        <span class="ai-stat-label">hr</span>
        <span class="ai-stat-val" data-val="hr">0/${LIMITS.perHour}</span>
      </span>
      <span class="ai-stat" data-key="total" title="Total request sepanjang waktu">
        <span class="ai-stat-label">total</span>
        <span class="ai-stat-val" data-val="total">0</span>
      </span>
      <span class="ai-stat" data-key="tokens" title="Total input + output tokens">
        <span class="ai-stat-label">tok</span>
        <span class="ai-stat-val" data-val="tokens">0</span>
      </span>
      <span class="ai-stat" data-key="cost" title="Estimasi cost (0 untuk free tier)">
        <span class="ai-stat-val" data-val="cost">$0.00</span>
      </span>
      <button class="ai-stats-reset" title="Reset stats">↺</button>
    </div>
  `;

  const valMin = containerEl.querySelector('[data-val="min"]');
  const valHr = containerEl.querySelector('[data-val="hr"]');
  const valTotal = containerEl.querySelector('[data-val="total"]');
  const valTok = containerEl.querySelector('[data-val="tokens"]');
  const valCost = containerEl.querySelector('[data-val="cost"]');
  const statMin = containerEl.querySelector('[data-key="min"]');
  const statHr = containerEl.querySelector('[data-key="hr"]');

  function fmtNum(n) {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
  }

  function fmtCost(usd) {
    if (usd <= 0) return "$0.00";
    if (usd < 0.01) return "<$0.01";
    if (usd < 1) return "$" + usd.toFixed(3);
    return "$" + usd.toFixed(2);
  }

  function updateColors(el, pct) {
    el.classList.remove("ai-stat-warn", "ai-stat-danger");
    if (pct >= 0.9) el.classList.add("ai-stat-danger");
    else if (pct >= 0.7) el.classList.add("ai-stat-warn");
  }

  function render(snap) {
    const { rate, total } = snap;
    valMin.textContent = `${rate.perMin}/${rate.limits.perMin}`;
    valHr.textContent = `${rate.perHour}/${rate.limits.perHour}`;
    valTotal.textContent = fmtNum(total.requests);
    valTok.textContent = fmtNum(total.inputTokens + total.outputTokens);
    valCost.textContent = fmtCost(total.cost);

    updateColors(statMin, rate.perMin / rate.limits.perMin);
    updateColors(statHr, rate.perHour / rate.limits.perHour);

    // Tooltip breakdown di tokens
    const tokensEl = containerEl.querySelector('[data-key="tokens"]');
    if (tokensEl) {
      tokensEl.title =
        `Input: ${total.inputTokens.toLocaleString("id-ID")} tok\n` +
        `Output: ${total.outputTokens.toLocaleString("id-ID")} tok\n` +
        `Total: ${(total.inputTokens + total.outputTokens).toLocaleString("id-ID")} tok`;
    }
  }

  containerEl
    .querySelector(".ai-stats-reset")
    .addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("Reset semua stats AI (total requests, tokens, cost)?"))
        return;
      resetStats();
    });

  // Initial render + subscription
  render(snapshot());
  const unsubscribe = onStatsChange(render);

  return {
    refresh: () => render(snapshot()),
    destroy: () => unsubscribe(),
  };
}
