const initialState = {
  autoRender: true,
  previewMode: true,
  theme: "dark",
  lastSuccess: null,
  last2dShapes: [], // Eksplisit (menutup temuan 2.7)
  paramValues: {},
  paramsPanelShownOnce: false,
  section: {
    enabled: false,
    axis: "z",
    position: 0,
    flipped: false,
  },
};

class AppStore {
  constructor() {
    this._state = JSON.parse(JSON.stringify(initialState));
    this._listeners = new Set();
  }

  getState() {
    // Snapshot dibekukan (frozen) agar tidak bisa dimutasi dari luar
    return Object.freeze({
      ...this._state,
      section: Object.freeze({ ...this._state.section }),
      last2dShapes: this._state.last2dShapes
        ? [...this._state.last2dShapes]
        : [],
    });
  }

  dispatch(action) {
    switch (action.type) {
      case "SET_AUTO_RENDER":
        this._state.autoRender = action.payload;
        break;
      case "SET_PREVIEW_MODE":
        this._state.previewMode = action.payload;
        break;
      case "SET_THEME":
        this._state.theme = action.payload;
        break;
      case "SET_LAST_SUCCESS":
        this._state.lastSuccess = action.payload;
        break;
      case "SET_LAST_2D_SHAPES":
        this._state.last2dShapes = action.payload;
        break;
      case "SET_PARAMS":
        this._state.paramValues = action.payload;
        break;
      case "SET_SECTION":
        this._state.section = { ...this._state.section, ...action.payload };
        break;
      case "SET_PARAMS_PANEL_SHOWN":
        this._state.paramsPanelShownOnce = action.payload;
        break;
      default:
        console.warn(`[store] Action tidak dikenal: ${action.type}`);
        return;
    }
    this._notify();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    const snapshot = this.getState();
    for (const fn of this._listeners) {
      try {
        fn(snapshot);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export const store = new AppStore();
