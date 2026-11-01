import { numArg } from "../utils.js";
import { DEG } from "../utils.js";

// Helper untuk rands (Linear Congruential Generator untuk seed)
function mulberry32(a) {
  return function () {
    var t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BUILTIN_FUNCTIONS = {
  abs: (v) => Math.abs(numArg(v)),
  sign: (v) => Math.sign(numArg(v)),
  sin: (v) => Math.sin(numArg(v) * DEG),
  cos: (v) => Math.cos(numArg(v) * DEG),
  tan: (v) => Math.tan(numArg(v) * DEG),
  asin: (v) => Math.asin(numArg(v)) / DEG,
  acos: (v) => Math.acos(numArg(v)) / DEG,
  atan: (v) => Math.atan(numArg(v)) / DEG,
  atan2: (a, b) => Math.atan2(numArg(a), numArg(b)) / DEG,
  floor: (v) => Math.floor(numArg(v)),
  ceil: (v) => Math.ceil(numArg(v)),
  round: (v) => Math.round(numArg(v)),
  sqrt: (v) => Math.sqrt(Math.max(0, numArg(v))),
  pow: (a, b) => Math.pow(numArg(a), numArg(b)),
  exp: (v) => Math.exp(numArg(v)),
  ln: (v) => Math.log(Math.max(1e-300, numArg(v))),
  log: (v) => Math.log10(Math.max(1e-300, numArg(v))),
  min: (...a) =>
    a.length === 1 && Array.isArray(a[0])
      ? Math.min(...a[0])
      : Math.min(...a.map((x) => numArg(x))),
  max: (...a) =>
    a.length === 1 && Array.isArray(a[0])
      ? Math.max(...a[0])
      : Math.max(...a.map((x) => numArg(x))),
  len: (v) =>
    Array.isArray(v) ? v.length : typeof v === "string" ? v.length : 0,
  norm: (v) =>
    Math.hypot(...(Array.isArray(v) ? v.map((x) => numArg(x)) : [numArg(v)])),
  concat: (...a) => a.flat(),
  str: (...a) =>
    a
      .map((x) =>
        Array.isArray(x)
          ? "[" + x.map((y) => String(y)).join(", ") + "]"
          : String(x),
      )
      .join(""),

  /* ==========================================
     FUNGSI MATEMATIKA & DATA BARU
     ========================================== */
  cross: (v1, v2) => {
    if (
      !Array.isArray(v1) ||
      v1.length !== 3 ||
      !Array.isArray(v2) ||
      v2.length !== 3
    ) {
      return [0, 0, 0]; // Return dummy jika input tidak valid
    }
    return [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ];
  },

  rands: (min, max, count, seed) => {
    const lo = numArg(min, 0);
    const hi = numArg(max, 1);
    const n = Math.max(1, Math.floor(numArg(count, 1)));
    const useSeed = seed !== undefined && seed !== null;
    const rand = useSeed ? mulberry32(numArg(seed)) : Math.random;

    const res = [];
    for (let i = 0; i < n; i++) {
      res.push(lo + rand() * (hi - lo));
    }
    return res;
  },

  chr: (v) => String.fromCharCode(Math.floor(numArg(v, 0))),

  ord: (v) => {
    if (typeof v !== "string" || v.length === 0) return 0;
    return v.charCodeAt(0);
  },

  search: (find, list) => {
    if (!Array.isArray(list)) return [];
    const results = [];
    // Pencarian 1D sederhana (bisa dikembangkan untuk 2D jika perlu)
    for (let i = 0; i < list.length; i++) {
      if (list[i] === find) results.push(i);
    }
    return results;
  },

  /* ==========================================
     TIPE DATA (is_*)
     ========================================== */
  is_num: (v) => typeof v === "number" && Number.isFinite(v),
  is_string: (v) => typeof v === "string",
  is_bool: (v) => typeof v === "boolean",
  is_list: (v) => Array.isArray(v),
  is_undef: (v) => v === undefined || v === null,
  is_function: (v) =>
    typeof v === "function" ||
    (v !== null && typeof v === "object" && v.__isFunction === true),
  is_range: (v) => v !== null && typeof v === "object" && v.__range === true,
  is_object: (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v) && !v.__range,
};
