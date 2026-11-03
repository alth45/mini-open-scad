import { describe, it, expect } from "vitest";
import { tokenize } from "../src/core/tokenizer.js";

describe("Tokenizer", () => {
  it("harus memecah kode dasar menjadi token", () => {
    const tokens = tokenize("cube(10);");

    // Harus ada 5 token: cube, (, 10, ), ;, eof
    expect(tokens.length).toBe(6);
    expect(tokens[0]).toMatchObject({ type: "ident", value: "cube" });
    expect(tokens[1]).toMatchObject({ type: "op", value: "(" });
    expect(tokens[2]).toMatchObject({ type: "number", value: 10 });
    expect(tokens[3]).toMatchObject({ type: "op", value: ")" });
    expect(tokens[4]).toMatchObject({ type: "op", value: ";" });
    expect(tokens[5]).toMatchObject({ type: "eof" });
  });

  it("harus mengabaikan komentar", () => {
    const code = `
      // Ini komentar
      cube(10); /* Ini blok komentar */
    `;
    const tokens = tokenize(code);
    // Token hanya cube ( 10 ) ;
    expect(tokens.length).toBe(6);
    expect(tokens[0].value).toBe("cube");
  });

  it("harus mendeteksi modifier dengan benar", () => {
    const tokens = tokenize("%cube(10);");
    expect(tokens[0]).toMatchObject({ type: "op", value: "%" });
    expect(tokens[1]).toMatchObject({ type: "ident", value: "cube" });
  });

  it("harus mendeteksi notasi ilmiah (scientific)", () => {
    const tokens = tokenize("x = -1.5e2;");

    // Cari token number
    const numToken = tokens.find((t) => t.type === "number");
    // Tokenizer hanya mengambil angka '1.5e2' → 150 (tanda minus adalah operator terpisah)
    expect(numToken.value).toBe(150);

    // Verifikasi tanda minus adalah token operator terpisah
    const minusToken = tokens.find((t) => t.type === "op" && t.value === "-");
    expect(minusToken).toBeDefined();

    // Verifikasi titik desimal dan huruf 'e'
    const intTokens = tokenize("3.14;");
    expect(intTokens[0].value).toBe(3.14);
  });
});
