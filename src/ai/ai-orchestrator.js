/**
 * Orchestrator: loop chat → tool_calls → execute → repeat
 * sampai AI kasih text (no tool_calls) atau maxRounds tercapai.
 */
const DEFAULT_MAX_ROUNDS = 4;
const MAX_TOOL_CALLS_TOTAL = 8;

export async function chatWithTools(
  client,
  {
    messages,
    tools,
    toolExecutor,
    maxRounds = DEFAULT_MAX_ROUNDS,
    onToken,
    onToolCall,
    onUsage,
    signal,
    maxTokens,
  },
) {
  let rounds = 0;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const toolTrace = [];
  let conversation = [...messages];
  let toolCallIdSeq = 0;

  while (rounds < maxRounds) {
    rounds++;

    let res;
    try {
      res = await client.chat(conversation, {
        stream: true,
        onToken,
        signal,
        tools,
        maxTokens,
      });
    } catch (e) {
      // Graceful fallback: tools tidak didukung API?
      if (rounds === 1 && /tool|400|invalid.?request/i.test(e.message || "")) {
        console.warn(
          "[orchestrator] tools rejected, falling back to plain chat:",
          e.message,
        );
        const plain = await client.chat(messages, {
          stream: true,
          onToken,
          signal,
          maxTokens,
        });
        return {
          content: plain.content || "",
          usage: plain.usage || totalUsage,
          toolTrace: [],
          rounds: 1,
          fallbackReason: "tools-unsupported",
        };
      }
      throw e;
    }

    if (res.usage) {
      totalUsage.prompt_tokens += res.usage.prompt_tokens || 0;
      totalUsage.completion_tokens += res.usage.completion_tokens || 0;
      totalUsage.total_tokens += res.usage.total_tokens || 0;
      onUsage?.(res.usage);
    }

    // No tool calls → final answer
    if (!res.toolCalls || res.toolCalls.length === 0) {
      return {
        content: res.content || "",
        usage: totalUsage,
        toolTrace,
        rounds,
      };
    }

    // Rate-limit check
    if (toolTrace.length + res.toolCalls.length > MAX_TOOL_CALLS_TOTAL) {
      return {
        content:
          (res.content || "") +
          `\n\n_⚠ Batas panggilan tool (${MAX_TOOL_CALLS_TOTAL}) tercapai._`,
        usage: totalUsage,
        toolTrace,
        rounds,
      };
    }

    // Append assistant turn with tool_calls
    conversation.push({
      role: "assistant",
      content: res.content || null,
      tool_calls: res.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        },
      })),
    });

    // Execute each tool
    for (const tc of res.toolCalls) {
      const callId = ++toolCallIdSeq;
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }

      onToolCall?.({
        id: callId,
        name: tc.function.name,
        args,
        status: "running",
      });

      let result;
      try {
        result = await toolExecutor(tc.function.name, args);
        onToolCall?.({
          id: callId,
          name: tc.function.name,
          args,
          status: "done",
          result,
        });
      } catch (e) {
        result = { error: e.message || String(e) };
        onToolCall?.({
          id: callId,
          name: tc.function.name,
          args,
          status: "error",
          result,
        });
      }

      toolTrace.push({ name: tc.function.name, args, result });

      conversation.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    content: `⚠ Maksimum ${maxRounds} putaran tool tercapai. Coba persempit pertanyaan.`,
    usage: totalUsage,
    toolTrace,
    rounds,
  };
}
