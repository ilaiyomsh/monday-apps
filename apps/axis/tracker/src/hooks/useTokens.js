import { useEffect, useState, useMemo } from 'react';
import logger from '../utils/logger';

/**
 * useTokens — read design tokens from CSS variables for use in JS contexts
 * (Recharts props, inline styles, SVG fills, etc.) that can't accept `var(...)` directly.
 *
 * Source of truth: tokens.css. The hook resolves CSS variables at runtime via
 * getComputedStyle(document.documentElement), so theme switching via
 * `data-theme="..."` on <html> propagates automatically.
 *
 * Usage:
 *   const t = useTokens();
 *   <Bar fill={t.primary} />
 *   <text fill={t.textSecondary}>...</text>
 */

// Map of logical name -> CSS variable name. Add tokens here as JS needs them.
const TOKEN_MAP = {
    primary: '--color-primary',
    primaryHover: '--color-primary-hover',
    secondary: '--color-secondary',
    accent: '--color-accent',
    success: '--color-success',
    approvalGreen: '--color-approval-green',
    warning: '--color-warning',
    pctWarning: '--color-pct-warning',
    danger: '--color-danger',
    dangerStrong: '--color-danger-strong',
    info: '--color-info',
    infoBg: '--color-info-bg',
    infoBorder: '--color-info-border',
    text: '--color-text',
    textSecondary: '--color-text-secondary',
    textMedium: '--color-text-medium',
    textPlaceholder: '--color-text-placeholder',
    textInverse: '--color-text-inverse',
    textDisabledSoft: '--color-text-disabled-soft',
    bgPrimary: '--color-bg-primary',
    bgTertiary: '--color-bg-tertiary',
    bgNeutralLight: '--color-bg-neutral-light',
    bgHoverNeutral: '--color-bg-hover-neutral',
    border: '--color-border',
    borderMedium: '--color-border-medium',
    borderInput: '--color-border-input',
    eventReserves: '--color-event-reserves',
    eventMultiple: '--color-event-multiple',
    projectExternal: '--color-project-external',
    projectRoutine: '--color-project-routine',
    eventOrange: '--color-event-orange',
    loaderDark: '--color-loader-dark',
    loaderAccent: '--color-loader-accent',
};

function readTokens() {
    if (typeof window === 'undefined' || !document?.documentElement) {
        return {};
    }
    const styles = getComputedStyle(document.documentElement);
    const result = {};
    for (const [key, varName] of Object.entries(TOKEN_MAP)) {
        result[key] = styles.getPropertyValue(varName).trim();
    }
    return result;
}

export default function useTokens() {
    const [snapshot, setSnapshot] = useState(() => readTokens());

    useEffect(() => {
        // Refresh tokens when theme attribute changes on <html>.
        const root = document.documentElement;
        const observer = new MutationObserver(() => {
            try {
                setSnapshot(readTokens());
            } catch (error) {
                logger.error('useTokens', 'theme MutationObserver failed', error);
            }
        });
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => observer.disconnect();
    }, []);

    return useMemo(() => snapshot, [snapshot]);
}

/** Default palette for pie/donut charts — sourced from CSS at first read. */
export function useChartPalette() {
    const t = useTokens();
    return useMemo(() => [
        t.primary,
        t.projectExternal,
        t.projectRoutine,
        t.danger,
        t.eventMultiple,
        t.eventReserves,
        t.eventOrange,
    ].filter(Boolean), [t]);
}
