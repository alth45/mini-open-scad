/**
 * Line-based diff via LCS (Longest Common Subsequence).
 * Pure data — tidak render HTML. Untuk render, lihat ai-ui.js.
 *
 * Output: array of ops:
 *   { type: "ctx",  text, oldNum, newNum }
 *   { type: "del",  text, oldNum }
 *   { type: "add",  text, newNum }
 *   { type: "skip", count }                // untuk collapse context
 */

const MAX_CELLS = 4_000_000; // ~8 MB Uint16 — cukup untuk file <2000 baris

export function diffLines(oldText, newText) {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  const m = a.length;
  const n = b.length;

  // Fallback untuk file sangat besar — tandai semua berubah
  if ((m + 1) * (n + 1) > MAX_CELLS) {
    const out = [];
    for (let i = 0; i < m; i++)
      out.push({ type: "del", text: a[i], oldNum: i + 1 });
    for (let j = 0; j < n; j++)
      out.push({ type: "add", text: b[j], newNum: j + 1 });
    return out;
  }

  // DP table LCS
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= n; j++) {
      if (ai === b[j - 1]) row[j] = prev[j - 1] + 1;
      else row[j] = row[j - 1] > prev[j] ? row[j - 1] : prev[j];
    }
  }

  // Backtrack
  const out = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: "ctx", text: a[i - 1], oldNum: i, newNum: j });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ type: "del", text: a[i - 1], oldNum: i });
      i--;
    } else {
      out.push({ type: "add", text: b[j - 1], newNum: j });
      j--;
    }
  }
  while (i > 0) {
    out.push({ type: "del", text: a[i - 1], oldNum: i });
    i--;
  }
  while (j > 0) {
    out.push({ type: "add", text: b[j - 1], newNum: j });
    j--;
  }

  return out.reverse();
}

export function diffStats(ops) {
  let add = 0,
    del = 0;
  for (const op of ops) {
    if (op.type === "add") add++;
    else if (op.type === "del") del++;
  }
  return { add, del };
}

/**
 * Lipat run context panjang jadi { type: "skip", count }.
 * Default: simpan 3 baris context di setiap sisi.
 */
export function collapseContext(ops, contextLines = 3) {
  const out = [];
  let buf = [];

  const flush = (atEnd) => {
    if (buf.length === 0) return;
    if (buf.length <= contextLines * 2 + 1 || atEnd) {
      if (buf.length <= contextLines * 2) {
        out.push(...buf);
      } else {
        out.push(...buf.slice(0, contextLines));
        out.push({ type: "skip", count: buf.length - contextLines * 2 });
        out.push(...buf.slice(-contextLines));
      }
    } else {
      out.push(...buf.slice(0, contextLines));
      out.push({ type: "skip", count: buf.length - contextLines * 2 });
      out.push(...buf.slice(-contextLines));
    }
    buf = [];
  };

  for (const op of ops) {
    if (op.type === "ctx") buf.push(op);
    else {
      flush(false);
      out.push(op);
    }
  }
  // Flush terakhir: kalau ada context di ujung, cukup simpan trailing `contextLines`
  if (buf.length > contextLines) {
    out.push({ type: "skip", count: buf.length - contextLines });
    out.push(...buf.slice(-contextLines));
  } else {
    out.push(...buf);
  }
  buf = [];

  return out;
}
