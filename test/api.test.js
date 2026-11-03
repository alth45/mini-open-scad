import { describe, it, expect } from "vitest";
import * as api from "../src/api.js";

describe("Public API Contract", () => {
  it("harus mengekspor fungsi inti untuk testing", () => {
    expect(typeof api.tokenize).toBe("function");
    expect(typeof api.Parser).toBe("function");
    expect(typeof api.buildModel).toBe("function");
    expect(typeof api.deserializeModel).toBe("function");
    expect(typeof api.formatScad).toBe("function");
    expect(typeof api.parseParams).toBe("function");
    expect(typeof api.encodeShareTab).toBe("function");
    expect(typeof api.decodeShareTab).toBe("function");
  });

  it("harus mengekspor konstanta versi", () => {
    expect(typeof api.STORAGE_SCHEMA_VERSION).toBe("number");
    expect(typeof api.SHARE_SCHEMA_VERSION).toBe("number");
    expect(typeof api.WORKER_PROTOCOL_VERSION).toBe("number");
  });
});
