/**
 * Project color system — hashes a project id to a consistent color.
 *
 * The palette itself lives in `src/styles/tokens.css` as CSS variables
 * (`--project-color-vibrant-1..24`, `--project-color-neutral-1..9`,
 *  `--project-color-fallback`). This file reads them once via
 * `getComputedStyle` and caches the result. YIQ contrast math stays here
 * (numeric output, not a design value — exempt from the no-hex rule).
 */

const VIBRANT_COUNT = 24;
const NEUTRAL_COUNT = 9;

let cachedPalette: string[] | null = null;
let cachedFallback: string | null = null;

const readVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

const loadPalette = (): string[] => {
  if (cachedPalette) return cachedPalette;
  const colors: string[] = [];
  for (let i = 1; i <= VIBRANT_COUNT; i++) {
    colors.push(readVar(`--project-color-vibrant-${i}`, ''));
  }
  for (let i = 1; i <= NEUTRAL_COUNT; i++) {
    colors.push(readVar(`--project-color-neutral-${i}`, ''));
  }
  cachedPalette = colors.filter(Boolean);
  return cachedPalette;
};

const getFallbackColor = (): string => {
  if (cachedFallback) return cachedFallback;
  cachedFallback = readVar('--project-color-fallback', '#c4c4c4');
  return cachedFallback;
};

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

/**
 * Darkens a color until YIQ luminance falls below `threshold`, so white
 * text remains readable on it. Hex math — exempt from the no-hex rule.
 */
export const ensureDarkEnough = (hexColor: string, threshold = 150): string => {
  if (!hexColor) return getFallbackColor();

  const hex = hexColor.replace('#', '');
  const fullHex = hex.length === 3
    ? hex.split('').map(char => char + char).join('')
    : hex;

  let r = parseInt(fullHex.substr(0, 2), 16);
  let g = parseInt(fullHex.substr(2, 2), 16);
  let b = parseInt(fullHex.substr(4, 2), 16);

  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;

  if (yiq > threshold) {
    const darkenFactor = threshold / yiq;
    r = Math.floor(r * darkenFactor);
    g = Math.floor(g * darkenFactor);
    b = Math.floor(b * darkenFactor);
  }

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

/**
 * Maps a project id to a consistent color from the Monday Vibe palette.
 * 80% chance of a vibrant color, 20% chance of a neutral.
 */
export const getProjectColor = (projectId: string | number | undefined): string => {
  if (!projectId) return ensureDarkEnough(readVar('--project-color-vibrant-5', '#579bfc'));

  const palette = loadPalette();
  if (palette.length === 0) return getFallbackColor();

  const hash = hashString(projectId.toString());
  const goldenRatio = 0.618033988749895;

  const useVibrant = (hash % 100) < 80;
  const colorPool = useVibrant ? Math.min(VIBRANT_COUNT, palette.length) : palette.length;

  const colorIndex = Math.floor((hash * goldenRatio % 1) * colorPool);

  return ensureDarkEnough(palette[colorIndex]);
};

/**
 * Chooses black or white text for legibility against `hexColor`.
 * Hex math — exempt from the no-hex rule.
 */
export const getContrastColor = (hexColor: string): string => {
  if (!hexColor) return '#ffffff';

  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#000000' : '#ffffff';
};

/**
 * How far project bar fills are lightened toward white — a softer, more
 * "delicate" shade of the same hue. 0 = original color, 1 = white.
 * Single tuning knob: raise for gentler bars, lower for more saturated.
 */
export const PROJECT_BAR_SOFTEN = 0.3;

/**
 * Returns a softer/more delicate shade of `hexColor` by mixing it toward white
 * by `amount` (0..1) — same hue, lighter tone. Hex math — exempt from the
 * no-hex rule. Pair with getContrastColor() so text stays legible as the fill
 * lightens. */
export const softenColor = (hexColor: string, amount: number = PROJECT_BAR_SOFTEN): string => {
  if (!hexColor) return getFallbackColor();

  const hex = hexColor.replace('#', '');
  const fullHex = hex.length === 3
    ? hex.split('').map(char => char + char).join('')
    : hex;

  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix(parseInt(fullHex.substr(0, 2), 16));
  const g = mix(parseInt(fullHex.substr(2, 2), 16));
  const b = mix(parseInt(fullHex.substr(4, 2), 16));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};
