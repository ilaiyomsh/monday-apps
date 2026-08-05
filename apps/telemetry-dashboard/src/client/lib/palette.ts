// The dashboard's color system. Values come straight from the data-viz skill's
// validated reference palette (references/palette.md) — an accessible 7-app
// categorical set (slot 8 = red, reserved for "Other"), a reserved status
// palette for latency state, and per-mode chart chrome. Categorical hues are
// assigned to apps in a FIXED order and never cycled: color follows the app,
// not its rank, so re-filtering never repaints a series.

/** The seven apps, in fixed categorical-slot order. */
export const APP_ORDER = [
  'deadline-confirm',
  'sync-calender',
  'discussions',
  'team-people-column',
  'planner',
  'tracker',
  'day-off',
] as const;

export type AppName = (typeof APP_ORDER)[number] | 'Other';

// 8 categorical slots (blue, green, magenta, yellow, aqua, orange, violet, red).
const CATEGORICAL_LIGHT = [
  '#2a78d6',
  '#008300',
  '#e87ba4',
  '#eda100',
  '#1baf7a',
  '#eb6834',
  '#4a3aa7',
  '#e34948',
];
const CATEGORICAL_DARK = [
  '#3987e5',
  '#008300',
  '#d55181',
  '#c98500',
  '#199e70',
  '#d95926',
  '#9085e9',
  '#e66767',
];

const OTHER_LIGHT = '#898781';
const OTHER_DARK = '#898781';

/** Stable color for an app in the given mode. "Other" → muted gray. */
export function appColor(app: string, isDark: boolean): string {
  if (app === 'Other') return isDark ? OTHER_DARK : OTHER_LIGHT;
  const idx = (APP_ORDER as readonly string[]).indexOf(app);
  const ramp = isDark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  if (idx < 0) return isDark ? OTHER_DARK : OTHER_LIGHT;
  return ramp[idx % ramp.length];
}

/** Reserved status palette (never themed away; distinct from categorical). */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** api_latency buckets → status semantics. fast/ok/slow/very_slow. */
export const LATENCY_ORDER = ['fast', 'ok', 'slow', 'very_slow'] as const;
export type LatencyBucket = (typeof LATENCY_ORDER)[number];
export const LATENCY_COLORS: Record<LatencyBucket, string> = {
  fast: STATUS.good,
  ok: '#7aa9d9',
  slow: STATUS.warning,
  very_slow: STATUS.critical,
};
export const LATENCY_LABELS: Record<LatencyBucket, string> = {
  fast: 'Fast',
  ok: 'OK',
  slow: 'Slow',
  very_slow: 'Very slow',
};

/** Per-mode chart chrome + ink (data-viz reference chrome table). */
export interface Chrome {
  surface: string;
  plane: string;
  textPrimary: string;
  textSecondary: string;
  muted: string;
  grid: string;
  baseline: string;
  border: string;
  sequential: string;
}

export function chrome(isDark: boolean): Chrome {
  return isDark
    ? {
        surface: '#1a1a19',
        plane: '#0d0d0d',
        textPrimary: '#ffffff',
        textSecondary: '#c3c2b7',
        muted: '#898781',
        grid: '#2c2c2a',
        baseline: '#383835',
        border: 'rgba(255,255,255,0.10)',
        sequential: '#3987e5',
      }
    : {
        surface: '#fcfcfb',
        plane: '#f9f9f7',
        textPrimary: '#0b0b0b',
        textSecondary: '#52514e',
        muted: '#898781',
        grid: '#e1e0d9',
        baseline: '#c3c2b7',
        border: 'rgba(11,11,11,0.10)',
        sequential: '#2a78d6',
      };
}
