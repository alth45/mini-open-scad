import { describe, it, expect, vi } from "vitest";
import { store } from "./app-store.js";

describe("AppStore", () => {
  it("harus mengembalikan snapshot yang frozen (immutable)", () => {
    const snapshot = store.getState();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.section)).toBe(true);
  });

  it("harus mengubah state via dispatch dan memberi notifikasi ke subscriber", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "SET_AUTO_RENDER", payload: false });

    expect(store.getState().autoRender).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.dispatch({ type: "SET_AUTO_RENDER", payload: true });
    expect(listener).toHaveBeenCalledTimes(1); // Tidak bertambah
  });

  it("harus mengabaikan action yang tidak dikenal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initialState = store.getState();

    store.dispatch({ type: "UNKNOWN_ACTION", payload: "x" });

    // State tidak berubah
    expect(store.getState().autoRender).toBe(initialState.autoRender);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Action tidak dikenal"),
    );
    warn.mockRestore();
  });

  it("harus menangani SET_SECTION dengan merge (bukan replace)", () => {
    store.dispatch({ type: "SET_SECTION", payload: { axis: "x" } });
    const s = store.getState().section;
    expect(s.axis).toBe("x");
    expect(s.enabled).toBe(false); // Nilai lama tetap ada
  });

  it("harus menangani SET_LAST_2D_SHAPES", () => {
    const mockShapes = [{ outer: [], holes: [] }];
    store.dispatch({ type: "SET_LAST_2D_SHAPES", payload: mockShapes });
    expect(store.getState().last2dShapes.length).toBe(1);
  });
});
