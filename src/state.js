import { store } from "./store/app-store.js";

/**
 * @deprecated Gunakan `store.dispatch()` dan `store.getState()` secara langsung.
 * Facade ini dipertahankan sementara selama migrasi Fase 2.
 */
export const state = new Proxy(
  {},
  {
    get(target, prop) {
      return store.getState()[prop];
    },
    set(target, prop, value) {
      if (prop === "section") {
        store.dispatch({ type: "SET_SECTION", payload: value });
      } else if (prop === "paramValues") {
        store.dispatch({ type: "SET_PARAMS", payload: value });
      } else if (prop === "autoRender") {
        store.dispatch({ type: "SET_AUTO_RENDER", payload: value });
      } else if (prop === "previewMode") {
        store.dispatch({ type: "SET_PREVIEW_MODE", payload: value });
      } else if (prop === "theme") {
        store.dispatch({ type: "SET_THEME", payload: value });
      } else if (prop === "lastSuccess") {
        store.dispatch({ type: "SET_LAST_SUCCESS", payload: value });
      } else if (prop === "last2dShapes") {
        store.dispatch({ type: "SET_LAST_2D_SHAPES", payload: value });
      } else if (prop === "paramsPanelShownOnce") {
        store.dispatch({ type: "SET_PARAMS_PANEL_SHOWN", payload: value });
      } else {
        // Fallback untuk properti yang belum masuk skema
        store._state[prop] = value;
      }
      return true;
    },
  },
);
