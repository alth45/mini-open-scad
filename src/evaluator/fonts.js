import { Font } from 'three/addons/loaders/FontLoader.js';
import helvetikerRegular from '../assets/fonts/helvetiker_regular.typeface.json';
import helvetikerBold from '../assets/fonts/helvetiker_bold.typeface.json';

/* Alias map — semua lowercase untuk matching case-insensitive */
const FONT_DATA = {
    'helvetiker': helvetikerRegular,
    'helvetiker:regular': helvetikerRegular,
    'helvetiker_regular': helvetikerRegular,
    'helvetiker:bold': helvetikerBold,
    'helvetiker_bold': helvetikerBold,
};

const cache = new Map();

export const DEFAULT_FONT = 'helvetiker';

export function getFont(name) {
    const raw = String(name || DEFAULT_FONT).toLowerCase().trim();

    /* exact match */
    if (FONT_DATA[raw]) {
        if (!cache.has(raw)) cache.set(raw, new Font(FONT_DATA[raw]));
        return cache.get(raw);
    }

    /* fuzzy: 'helvetiker bold' → 'helvetiker:bold' */
    const normalized = raw.replace(/\s+/g, ':');
    if (FONT_DATA[normalized]) {
        if (!cache.has(normalized)) cache.set(normalized, new Font(FONT_DATA[normalized]));
        return cache.get(normalized);
    }

    /* fallback ke default */
    if (!cache.has(DEFAULT_FONT)) cache.set(DEFAULT_FONT, new Font(FONT_DATA[DEFAULT_FONT]));
    return cache.get(DEFAULT_FONT);
}

export function availableFonts() {
    return Object.keys(FONT_DATA).filter(k => !k.includes(':') && !k.includes('_'));
}