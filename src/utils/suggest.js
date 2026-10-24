/* ============================================================
   Suggest nama mirip (Levenshtein distance)
   ============================================================ */

/** Classic Levenshtein — O(min(a,b)) space, O(a·b) time. */
export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    if (a.length < b.length) [a, b] = [b, a];

    const bLen = b.length;
    let prev = new Array(bLen + 1);
    let cur = new Array(bLen + 1);
    for (let j = 0; j <= bLen; j++) prev[j] = j;

    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= bLen; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(
                prev[j] + 1,        // hapus
                cur[j - 1] + 1,     // insert
                prev[j - 1] + cost  // substitusi
            );
        }
        [prev, cur] = [cur, prev];
    }
    return prev[bLen];
}

/** Threshold adaptif berdasarkan panjang input. */
function threshold(len) {
    if (len <= 3) return 1;
    if (len <= 6) return 2;
    return 3;
}

/**
 * Cari kandidat terdekat.
 * @param {string} input
 * @param {Iterable<string>} candidates
 * @returns {string|null}
 */
export function suggestName(input, candidates) {
    if (!input || typeof input !== 'string') return null;
    const lower = input.toLowerCase();
    const t = threshold(lower.length);

    let best = null;
    let bestDist = Infinity;

    for (const c of candidates) {
        if (typeof c !== 'string' || c === input) continue;
        const dist = levenshtein(lower, c.toLowerCase());
        if (dist < bestDist && dist <= t) {
            bestDist = dist;
            best = c;
        }
    }
    return best;
}