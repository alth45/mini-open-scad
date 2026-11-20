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
      tools,
    } = opts;
    const key = apiKey();

    const body = JSON.stringify({
      model,
      messages,
      stream,
      max_tokens: maxTokens,
      temperature: 0.3,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(Array.isArray(tools) && tools.length > 0
        ? { tools, tool_choice: "auto" }
        : {}),
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
      const msg = data.choices?.[0]?.message || {};
      return {
        content: msg.content || "",
        usage: data.usage || null,
        toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : null,
      };
    }
    return readSSE(res, onToken, messages);
  }

  async function readSSE(res, onToken, originalMessages) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage = null;
    const toolCallsByIndex = new Map();

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
          if (json.usage) usage = json.usage;

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          // Accumulate text
          const textDelta = delta?.content || "";
          if (textDelta) {
            full += textDelta;
            onToken?.(textDelta);
          }

          // Accumulate tool_calls (streamed incrementally)
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              if (!toolCallsByIndex.has(i)) {
                toolCallsByIndex.set(i, {
                  id: tc.id || "",
                  type: "function",
                  function: { name: "", arguments: "" },
                });
              }
              const entry = toolCallsByIndex.get(i);
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.function.name += tc.function.name;
              if (tc.function?.arguments)
                entry.function.arguments += tc.function.arguments;
            }
          }
        } catch {
          /* skip malformed */
        }
      }
    }

    // Fallback usage estimation
    if (!usage) {
      const inputText = (originalMessages || [])
        .map((m) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        )
        .join("\n");
      usage = {
        prompt_tokens: Math.ceil(inputText.length / 4),
        completion_tokens: Math.ceil(full.length / 4),
        total_tokens: Math.ceil((inputText.length + full.length) / 4),
        estimated: true,
      };
    }

    const toolCalls =
      toolCallsByIndex.size > 0
        ? Array.from(toolCallsByIndex.entries())
            .sort((a, b) => a[0] - b[0])
            .map((e) => e[1])
        : null;

    return { content: full, usage, toolCalls };
  }

  return { chat, model };
}
