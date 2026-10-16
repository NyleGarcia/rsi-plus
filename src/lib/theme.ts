/**
 * Hub + popup appearance: dark (RSI+'s own palette), light, or follow the system, plus an accent colour. Stored in
 * `localStorage` `rsiplus:theme` (the extension pages share one origin, so the popup picks up what the hub set) and
 * applied as `data-theme` / `data-accent` on `<html>` — `app.css` maps those to the shadcn tokens. Nothing here
 * touches RSI's own pages.
 */
export type ThemeMode = 'dark' | 'light' | 'system';
export const MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: "RSI+'s own dark palette" },
  { id: 'light', label: 'Light', hint: 'Light surfaces, same accents' },
  { id: 'system', label: 'System', hint: 'Follow the OS setting' },
];
/** Accent → swatch (the dark-mode primary; light mode uses a deeper shade of the same hue, see app.css). */
export const ACCENTS = {
  cyan: '#3cc8ff',
  green: '#3ddc97',
  amber: '#ffd166',
  orange: '#ff9f43',
  rose: '#ff6b9d',
  violet: '#a78bfa',
} as const;
export type Accent = keyof typeof ACCENTS;
/** Surface palettes (background / card / popover / sidebar …), per mode; `swatch` = [background, card] for the picker. */
export const PALETTES = [
  { id: 'rsi', mode: 'dark', label: 'RSI+', hint: 'Near-black blue, the default', swatch: ['#0b0c10', '#14161c'] },
  { id: 'slate', mode: 'dark', label: 'Slate', hint: 'Blue-grey, like CCU Game', swatch: ['#0f172a', '#1e293b'] },
  { id: 'black', mode: 'dark', label: 'Black', hint: 'Pure black for OLED', swatch: ['#000000', '#0c0c0e'] },
  { id: 'graphite', mode: 'dark', label: 'Graphite', hint: 'Neutral grey', swatch: ['#141414', '#1d1d1f'] },
  { id: 'ember', mode: 'dark', label: 'Ember', hint: 'Warm brown-black', swatch: ['#15110f', '#1f1915'] },
  { id: 'light', mode: 'light', label: 'Light', hint: 'Cool white, the default', swatch: ['#f4f5f8', '#ffffff'] },
  { id: 'paper', mode: 'light', label: 'Paper', hint: 'Warm off-white', swatch: ['#f7f3ec', '#fffdf9'] },
  { id: 'cool', mode: 'light', label: 'Cool', hint: 'Blue-grey white', swatch: ['#eef2f7', '#ffffff'] },
] as const;
export type Palette = (typeof PALETTES)[number]['id'];
export interface ThemePrefs {
  mode: ThemeMode;
  accent: Accent;
  /** Surfaces for dark and for light, each remembered so switching modes keeps both choices. */
  dark: Palette;
  light: Palette;
}
export const DEFAULT_THEME: ThemePrefs = { mode: 'dark', accent: 'cyan', dark: 'rsi', light: 'light' };
const paletteOf = (id: unknown, mode: 'dark' | 'light'): Palette => {
  const p = PALETTES.find((x) => x.id === id && x.mode === mode);
  return p ? p.id : mode === 'dark' ? 'rsi' : 'light';
};
const KEY = 'rsiplus:theme';

export function readTheme(): ThemePrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ThemePrefs>;
    return {
      mode: p.mode && MODES.some((m) => m.id === p.mode) ? p.mode : 'dark',
      accent: p.accent && p.accent in ACCENTS ? p.accent : 'cyan',
      dark: paletteOf(p.dark, 'dark'),
      light: paletteOf(p.light, 'light'),
    };
  } catch {
    return DEFAULT_THEME;
  }
}

/** Resolve `system` against the OS. */
export const resolveMode = (mode: ThemeMode): 'dark' | 'light' => (mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode);

export function applyTheme(p: ThemePrefs, doc: Document = document) {
  const mode = resolveMode(p.mode);
  doc.documentElement.dataset.theme = mode;
  doc.documentElement.dataset.accent = p.accent;
  doc.documentElement.dataset.palette = mode === 'dark' ? p.dark : p.light;
}

export function saveTheme(p: ThemePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode — applies for this page anyway */
  }
  applyTheme(p);
}

/** Apply the saved prefs before the first paint and follow the OS while `system` is chosen. */
export function initTheme(): ThemePrefs {
  const p = readTheme();
  applyTheme(p);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(readTheme()));
  return p;
}
