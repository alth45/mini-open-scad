/**
 * TokenHarbor API client — browser-native via fetch.
 * Docs: https://tokenharbor.ai/docs/api/curl
 *
 * Free tier: 60 req/min · 1.800 req/hour · 4 MB max request.
 * Model "deepseek-v4.1-flash:free" tidak memotong saldo.
 */
import { AI_CONFIG } from "../config.js";

export function createTokenHarborClient({
  getApiKey,
  model = AI_CONFIG.model,
} = {}) {
  function apiKey() {
    const k = getApiKey?.() || "";
    if (!k.startsWith("thk_")) {
      const err = new Error(
        "API key TokenHarbor belum diatur. Buka ⚙ AI Settings dan paste key (thk_live_…).",
      );
      err.name = "MissingApiKeyError";
      throw err;
    }
    return k;
  }

  async function chat(messages, opts = {}) {
    const {
      stream = true,
      onToken,
      signal,
      maxTokens = AI_CONFIG.maxTokens,
    } = opts;
    const key = apiKey();

    const body = JSON.stringify({
      model,
      messages,
      stream,
      max_tokens: maxTokens,
      temperature: 0.3,
    });

    // Free tier: request max 4 MB
    if (new TextEncoder().encode(body).byteLength > 4_000_000) {
      throw new Error(
        "Request terlalu besar (>4 MB). Pendekkan kode atau riwayat chat.",
      );
    }

    const res = await fetch(`${AI_CONFIG.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body,
      signal,
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j?.error?.message || j?.message || detail;
      } catch {
        /* ignore */
      }

      if (res.status === 401) {
        const e = new Error(
          "API key ditolak (401). Periksa kembali key di ⚙ AI Settings.",
        );
        e.name = "AuthError";
        throw e;
      }
      if (res.status === 429) {
        const e = new Error(
          "Rate limit TokenHarbor tercapai (60 req/menit free tier). Tunggu sebentar.",
        );
        e.name = "RateLimitError";
        throw e;
      }
      throw new Error(`TokenHarbor ${res.status}: ${detail}`);
    }

    if (!stream) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }
    return readSSE(res, onToken);
  }

  async function readSSE(res, onToken) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            onToken?.(delta);
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }
    return full;
  }

  return { chat, model };
}
