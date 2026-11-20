/**
 * AI Tools — 8 read-only tools untuk inspect state aplikasi.
 * Semua tool return JSON-serializable object.
 */
import { parseParams } from "../core/params.js";
import { tokenize } from "../core/tokenizer.js";
import { Parser } from "../core/parser.js";
import { listFiles } from "../files/file-store.js";
import { SNIPPETS } from "../ui/snippets-data.js";

export function getToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "get_model_stats",
        description:
          "Statistik model 3D aktif. Return: bbox_mm {x,y,z} (BATAS, bukan volume), bbox_volume_mm3 (x×y×z upper bound), volume_mm3 + volume_cm3 + volume_display (volume AKTUAL signed tetrahedron sum), surfaceArea_mm2/cm2, fill_ratio (volume/bbox_volume), triangles/vertices/meshes, pla_weight_g, filament_175mm_m. WAJIB pakai volume_display saat jawab user (sudah diformat).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_render_error",
        description:
          "Error render terakhir (kalau ada). Return { error: null } kalau render sukses terakhir.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_current_code",
        description: "Kode OpenSCAD yang saat ini dibuka di editor.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_param_values",
        description:
          "Nilai parameter saat ini (slider, checkbox, enum, string).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_param_definitions",
        description:
          "Daftar @param yang didefinisikan di kode (name, type, default, min/max, options).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_imported_files",
        description:
          "Daftar file di IndexedDB (STL meshes + SCAD libraries). Return { files: [{ name, size, type }] }.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "list_snippets",
        description:
          "Daftar snippet library yang tersedia (id, name, category, description).",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "validate_code",
        description:
          "Cek syntax OpenSCAD (parse only, tidak render). Return { ok: true, nodeCount } atau { ok: false, error, line, col, hint }.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Kode OpenSCAD yang ingin divalidasi",
            },
          },
          required: ["code"],
        },
      },
    },
  ];
}

export function createToolExecutor(deps) {
  const { getEditorValue, getLastError, viewer, store } = deps;

  return async function executeTool(name, args) {
    try {
      switch (name) {
        case "get_model_stats": {
          const stats = viewer?.getModelStats?.();
          if (!stats || (stats.triangles === 0 && stats.meshes === 0)) {
            return { hasModel: false };
          }
          const bboxVol = stats.size.x * stats.size.y * stats.size.z;
          const fillRatio = bboxVol > 0 ? stats.volume / bboxVol : 0;
          const volCm3 = stats.volume / 1000;

          return {
            hasModel: true,
            // ── BBOX (BATAS, bukan volume aktual) ──
            bbox_mm: {
              x: +stats.size.x.toFixed(2),
              y: +stats.size.y.toFixed(2),
              z: +stats.size.z.toFixed(2),
            },
            bbox_formatted: `${stats.size.x.toFixed(1)} × ${stats.size.y.toFixed(1)} × ${stats.size.z.toFixed(1)} mm`,
            bbox_volume_mm3: +bboxVol.toFixed(2),
            // ⚠ bbox_volume_mm3 = x×y×z (upper bound), BUKAN volume aktual

            // ── VOLUME AKTUAL (signed tetrahedron sum) ──
            volume_mm3: +stats.volume.toFixed(2),
            volume_cm3: +volCm3.toFixed(3),
            volume_display: `${volCm3.toFixed(2)} cm³ (${Math.round(stats.volume).toLocaleString("en-US")} mm³)`,
            // ℹ volume_display sudah disambiguasi — pakai string ini saat menjawab user

            // ── SURFACE ──
            surfaceArea_mm2: +stats.area.toFixed(2),
            surfaceArea_cm2: +(stats.area / 100).toFixed(2),

            // ── FILL RATIO (sanity check) ──
            fill_ratio: +fillRatio.toFixed(3),
            // ℹ volume/bbox_volume. Solid part ≈ 0.9-1.0, berlubang 0.3-0.9,
            //   hollow tipis <0.3. Kalau >1.05 atau <0.01 → suspected bug.

            // ── COMPLEXITY ──
            triangles: stats.triangles,
            vertices: stats.vertices,
            meshes: stats.meshes,

            // ── PRINT ESTIMATES (solid, tanpa infill) ──
            pla_weight_g: +stats.weightGrams.toFixed(2),
            pla_weight_display: `${stats.weightGrams.toFixed(1)} g`,
            filament_175mm_m: +stats.filamentMeters.toFixed(2),
            filament_display: `${stats.filamentMeters.toFixed(2)} m`,
          };
        }

        case "get_render_error": {
          const err = getLastError?.() || null;
          return { error: err };
        }

        case "get_current_code": {
          const code = getEditorValue?.() || "";
          return { code, length: code.length };
        }

        case "get_param_values": {
          const values = store?.getState?.().paramValues || {};
          return { values, count: Object.keys(values).length };
        }

        case "get_param_definitions": {
          const code = getEditorValue?.() || "";
          const params = parseParams(code);
          return {
            params: params.map((p) => {
              const base = {
                name: p.name,
                label: p.label,
                type: p.type,
                default: p.default,
              };
              if (p.type === "slider") {
                base.min = p.min;
                base.max = p.max;
                base.step = p.step;
              }
              if (p.type === "enum") {
                base.options = p.options;
                if (p.optionLabels) base.optionLabels = p.optionLabels;
              }
              if (p.group) base.group = p.group;
              return base;
            }),
          };
        }

        case "get_imported_files": {
          const files = await listFiles();
          return {
            files: files.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type,
            })),
            count: files.length,
          };
        }

        case "list_snippets": {
          return {
            snippets: SNIPPETS.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
              description: s.description,
            })),
            count: SNIPPETS.length,
          };
        }

        case "validate_code": {
          const code = String(args?.code || "");
          if (!code.trim()) {
            return { ok: false, error: "Kode kosong" };
          }
          try {
            const tokens = tokenize(code);
            const ast = new Parser(tokens).parseProgram();
            return { ok: true, nodeCount: ast.body.length };
          } catch (e) {
            return {
              ok: false,
              error: e.message || String(e),
              line: e.line || 0,
              col: e.col || 0,
              hint: e.hint || null,
            };
          }
        }

        default:
          return { error: `Tool '${name}' tidak dikenal` };
      }
    } catch (e) {
      return { error: e.message || String(e) };
    }
  };
}
