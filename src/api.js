/**
 * Public API Mini OpenSCAD
 *
 * Modul ini adalah entry point yang STABIL untuk:
 * - Unit testing
 * - Integrasi eksternal (misal CLI wrapper, embedding)
 *
 * JANGAN memanggil fungsi dari internal modules secara langsung.
 * Semua yang perlu dipakai dari luar harus lewat file ini.
 */

// Core Language
export { tokenize } from "./core/tokenizer.js";
export { Parser } from "./core/parser.js";

// Model Building
export {
  buildModel,
  deserializeModel,
  serializeModel,
} from "./viewer/model.js";

// Format
export { formatScad } from "./format.js";

// Share
export { encodeShareTab, decodeShareTab } from "./share.js";

// Params
export { parseParams, mergeParamValues } from "./core/params.js";

// Contract
export {
  STORAGE_SCHEMA_VERSION,
  SHARE_SCHEMA_VERSION,
  WORKER_PROTOCOL_VERSION,
} from "./contract/schemas.js";
