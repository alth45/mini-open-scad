import {
  buildSystemPrompt,
  buildUserMessage,
  buildGeneratorSystemPrompt,
  buildGeneratorUserMessage,
  buildExplainerSystemPrompt,
  buildExplainerUserMessage,
} from "./ai-context.js";

// Tangkap ```scad, ```openscad, atau ``` (bare)
const SCAD_BLOCK_RE = /```(?:scad|openscad)?\s*\n([\s\S]*?)```/g;

/** Ambil blok kode terakhir (biasanya versi final). */
export function extractScadBlock(text) {
  const blocks = [];
  let m;
  SCAD_BLOCK_RE.lastIndex = 0;
  while ((m = SCAD_BLOCK_RE.exec(text)) !== null) blocks.push(m[1]);
  return blocks.length ? blocks[blocks.length - 1].trim() + "\n" : null;
}

/**
 * Satu ronde percakapan dengan AI.
 * @returns {Promise<{ reply: string, proposedCode: string|null }>}
 */
export async function askFixer(
  client,
  { code, error, question, history, onToken, signal },
) {
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...(history || []),
    { role: "user", content: buildUserMessage({ code, error, question }) },
  ];

  const { content, usage } = await client.chat(messages, {
    stream: true,
    onToken,
    signal,
    maxTokens: 8192,
  });

  return { reply: content, proposedCode: extractScadBlock(content), usage };
}

/**
 * Generate kode dari deskripsi (bukan fix error).
 * @returns {Promise<{ reply: string, proposedCode: string|null }>}
 */
export async function askGenerator(
  client,
  { prompt, existingCode, history, onToken, signal },
) {
  const messages = [
    { role: "system", content: buildGeneratorSystemPrompt() },
    ...(history || []),
    {
      role: "user",
      content: buildGeneratorUserMessage({ prompt, existingCode }),
    },
  ];

  const { content, usage } = await client.chat(messages, {
    stream: true,
    onToken,
    signal,
    maxTokens: 8192,
  });

  return { reply: content, proposedCode: extractScadBlock(content), usage };
}

/**
 * Explain kode ke user dengan bahasa awam (mode edukasi).
 * @returns {Promise<{ reply: string }>}  — tidak mengekstrak code block
 */
export async function askExplainer(
  client,
  { code, question, history, onToken, signal },
) {
  const messages = [
    { role: "system", content: buildExplainerSystemPrompt() },
    ...(history || []),
    { role: "user", content: buildExplainerUserMessage({ code, question }) },
  ];

  const { content, usage } = await client.chat(messages, {
    stream: true,
    onToken,
    signal,
    maxTokens: 4096,
  });

  return { reply: content, usage };
}
