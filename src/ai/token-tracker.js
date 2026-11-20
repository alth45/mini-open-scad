/**
 * Token + rate-limit tracker untuk AI requests.
 *
 * Track:
 *   - Timestamps per request → rolling 60s / 3600s window (untuk rate limit)
 *   - Total requests, input tokens, output tokens, cost (lifetime)
 *   - Per-day breakdown (30 hari terakhir)
 *
 * Storage: localStorage `mini-openscad-ai-stats`.
 * Reset manual via `resetStats()`.
 */

const STORAGE_KEY = "mini-openscad-ai-stats";
const WINDOW_MIN_MS = 60 * 1000;
const WINDOW_HR_MS = 60 * 60 * 1000;
const DAY_RETENTION_DAYS = 30;

export const LIMITS = {
  perMin: 60, // TokenHarbor free tier
  perHour: 1800,
};

/** Per 1M tokens, USD. Tambahkan model berbayar di sini kalau switch. */
export const MODEL_PRICING = {
  "deepseek-v4.1-flash:free": { input: 0, output: 0 },
  "deepseek-v4.1-flash": { input: 0.3, output: 1.2 }, // contoh; verifikasi di dashboard TokenHarbor
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
};

const DEFAULT_STATS = {
  version: 1,
  requests: [], // timestamp ms — max 1 jam terakhir
  total: {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  },
  byDay: {}, // "YYYY-MM-DD" → { requests, inputTokens, outputTokens, cost }
};

let state = null;
const listeners = new Set();

/* ---------- Load / persist ---------- */
function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        state = {
          ...DEFAULT_STATS,
          ...parsed,
          total: { ...DEFAULT_STATS.total, ...(parsed.total || {}) },
          byDay: parsed.byDay || {},
          requests: Array.isArray(parsed.requests) ? parsed.requests : [],
        };
        return state;
      }
    }
  } catch (e) {
    console.warn("[token-tracker] load failed:", e);
  }
  state = JSON.parse(JSON.stringify(DEFAULT_STATS));
  return state;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[token-tracker] persist failed:", e);
  }
}

function notify() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (e) {
      console.error(e);
    }
  }
}

/* ---------- Pruning ---------- */
function pruneTimestamps() {
  const cutoff = Date.now() - WINDOW_HR_MS;
  const before = state.requests.length;
  state.requests = state.requests.filter((t) => t > cutoff);
  return state.requests.length !== before;
}

function pruneDays() {
  const cutoff = new Date(Date.now() - DAY_RETENTION_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  let changed = false;
  for (const k of Object.keys(state.byDay)) {
    if (k < cutoff) {
      delete state.byDay[k];
      changed = true;
    }
  }
  return changed;
}

/* ---------- Helpers ---------- */
function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function getOrCreateDay(ts) {
  const k = dayKey(ts);
  if (!state.byDay[k]) {
    state.byDay[k] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  }
  return state.byDay[k];
}

function computeCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model] || { input: 0, output: 0 };
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

/* ---------- Public API ---------- */

/**
 * Catat satu request AI.
 * @param {{ inputTokens?: number, outputTokens?: number, model?: string }} opts
 */
export function recordRequest({
  inputTokens = 0,
  outputTokens = 0,
  model = null,
} = {}) {
  load();
  const now = Date.now();
  const inTok = Math.max(0, Math.floor(inputTokens));
  const outTok = Math.max(0, Math.floor(outputTokens));
  const cost = computeCost(model, inTok, outTok);

  state.requests.push(now);
  pruneTimestamps();
  pruneDays();

  state.total.requests += 1;
  state.total.inputTokens += inTok;
  state.total.outputTokens += outTok;
  state.total.cost += cost;

  const day = getOrCreateDay(now);
  day.requests += 1;
  day.inputTokens += inTok;
  day.outputTokens += outTok;
  day.cost += cost;

  persist();
  notify();
}

export function getRateLimitCounts() {
  load();
  pruneTimestamps();
  const now = Date.now();
  const minCutoff = now - WINDOW_MIN_MS;
  const hrCutoff = now - WINDOW_HR_MS;
  let perMin = 0,
    perHour = 0;
  for (const t of state.requests) {
    if (t > minCutoff) perMin++;
    if (t > hrCutoff) perHour++;
  }
  return { perMin, perHour, limits: LIMITS };
}

export function snapshot() {
  load();
  const rate = getRateLimitCounts();
  return {
    rate,
    total: { ...state.total },
    byDay: { ...state.byDay },
  };
}

export function onStatsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetStats() {
  load();
  state = JSON.parse(JSON.stringify(DEFAULT_STATS));
  persist();
  notify();
}
