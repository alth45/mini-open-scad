import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ARCH_DOC = path.resolve(process.cwd(), "docs-md/architecture.md");

// Modul baru yang WAJIB muncul di dokumentasi
const REQUIRED_IN_DOC = [
  "error-boundary.js",
  "render-controller.js",
  "app-store.js",
  "worker-client.js",
  "manifold-engine.js",
  "contract",
];

describe("Docs Sync", () => {
  it("architecture.md harus menyebut semua modul penting", () => {
    if (!fs.existsSync(ARCH_DOC)) {
      throw new Error(
        "File architecture.md tidak ditemukan. Pastikan path benar.",
      );
    }
    const doc = fs.readFileSync(ARCH_DOC, "utf-8");
    for (const mod of REQUIRED_IN_DOC) {
      expect(doc, `architecture.md tidak menyebut '${mod}'`).toContain(mod);
    }
  });

  it("tidak boleh ada file test yang ter-import di production code", () => {
    const srcDir = path.resolve(process.cwd(), "src");
    const files = fs
      .readdirSync(srcDir, { recursive: true })
      .filter((f) => f.endsWith(".js") && !f.includes(".test."));
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");
      if (content.includes(".test.js")) {
        throw new Error(`File '${file}' meng-import file test!`);
      }
    }
  });
});
