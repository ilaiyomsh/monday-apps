/**
 * AppErrorBoundary ג€” the render-phase catch layer for the error-guard standard.
 *
 * Built on the `react-error-boundary` package (declare it as a peer dependency:
 * `pnpm add react-error-boundary`). We do NOT hand-roll a class boundary here ג€”
 * the package already gives us the `onError(error, info)` logging hook and the
 * `useErrorBoundary().showBoundary(err)` funnel for async / event-handler errors.
 * The only things this template adds on top are: the logger wiring, the Hebrew
 * fallback UI, and the chunk-load-vs-render distinction.
 *
 * WHY a boundary is not enough on its own (see references/research-2026-07.md):
 * an Error Boundary catches ONLY render-phase throws of the tree below it. It does
 * NOT catch event handlers, async callbacks / setTimeout, unresolved promises, or
 * throws inside the boundary itself. Those are covered by the global handlers
 * (setupGlobalErrorHandlers) and by routing caught async errors back in through
 * `useAppErrorFunnel().showBoundary(err)`.
 *
 * Display contract (one error = one surface): render throws are shown by THIS
 * fallback screen, so the UI toast sink must skip records whose module starts
 * with 'ErrorBoundary:' to avoid a double surface. `onError` still emits the
 * canonical logger.error record (module 'ErrorBoundary:<scope>') for buffer /
 * remote sink; it just must not also toast.
 */

import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';
import logger from '../../utils/logger';
import { dismissBootLoader } from '../../utils/bootLoader';

/**
 * Chunk-load detection. A failed dynamic import / stale-deploy asset fetch is NOT
 * an application bug ג€” a reload usually fixes it (new bundle, dropped network, or
 * the CDN served index.html with the wrong MIME type). We branch the fallback UI
 * on this so the user gets a "reload" affordance instead of a generic retry that
 * cannot possibly recover a missing chunk.
 *
 * If the host app already has an `isChunkLoadError` helper (e.g. in a lazyRetry
 * util), import that instead of this inline copy and delete this block.
 */
const CHUNK_LOAD_ERROR_PATTERNS = [
    /ChunkLoadError/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
    /error loading dynamically imported module/i,
    /is not a valid JavaScript MIME type/i,
    /expected a JavaScript-or-Wasm module script/i,
    /Failed to load module script/i, // Chrome
    /NetworkError when attempting to fetch resource/i, // Firefox
    /Failed to fetch/i, // Chrome network failure
    /Load failed/i, // iOS Safari
    /The network connection was lost/i, // iOS connection drop
    /Unable to preload CSS/i, // Vite CSS preloader
];

const isChunkLoadError = (error) => {
    const message = error?.message || String(error || '');
    return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const btnStyle = {
    padding: '8px 24px',
    borderRadius: '4px',
    border: '1px solid var(--color-border, #c3c6d4)',
    background: 'var(--color-bg-primary, #ffffff)',
    cursor: 'pointer',
    fontSize: '14px',
};

/**
 * Default Hebrew fallback UI. `direction: 'inherit'` keeps the RTL/LTR direction
 * of the host document instead of forcing one.
 * `error` and `resetErrorBoundary` are injected by react-error-boundary.
 */
const DefaultFallback = ({ error, resetErrorBoundary }) => {
    // --- Chunk-load failure: offer a hard reload (remount cannot fetch a missing chunk). ---
    if (isChunkLoadError(error)) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', direction: 'inherit' }} role="alert">
                {/* User-facing Hebrew */}
                <h2>׳˜׳¢׳™׳ ׳× ׳¨׳›׳™׳‘ ׳ ׳›׳©׳׳”</h2>
                <p>׳™׳™׳×׳›׳ ׳©׳™׳¦׳׳” ׳’׳¨׳¡׳” ׳—׳“׳©׳” ׳׳• ׳©׳׳™׳ ׳—׳™׳‘׳•׳¨ ׳׳¨׳©׳×. ׳¨׳¢׳ ׳ ׳׳× ׳”׳“׳£ ׳›׳“׳™ ׳׳”׳׳©׳™׳.</p>
                <button
                    type="button"
                    onClick={() => {
                        if (typeof window !== 'undefined') window.location.reload();
                    }}
                    style={btnStyle}
                >
                    ׳¨׳¢׳ ׳ ׳׳× ׳”׳“׳£
                </button>
            </div>
        );
    }

    // --- Real render crash: friendly message + retry via resetErrorBoundary (remounts the tree). ---
    return (
        <div style={{ padding: '20px', textAlign: 'center', direction: 'inherit' }} role="alert">
            {/* User-facing Hebrew */}
            <h2>׳׳©׳”׳• ׳”׳©׳×׳‘׳©</h2>
            <p>׳׳™׳¨׳¢׳” ׳©׳’׳™׳׳” ׳‘׳׳×׳™ ׳¦׳₪׳•׳™׳”. ׳ ׳¡׳” ׳©׳•׳‘, ׳•׳׳ ׳”׳‘׳¢׳™׳” ׳—׳•׳–׳¨׳× ׳¨׳¢׳ ׳ ׳׳× ׳”׳“׳£.</p>
            <button type="button" onClick={resetErrorBoundary} style={btnStyle}>
                ׳ ׳¡׳” ׳©׳•׳‘
            </button>
        </div>
    );
};

/**
 * AppErrorBoundary ג€” wrap any subtree (and the root ג€” see the entry templates).
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} props.scope - a stable label for this boundary (e.g. 'root',
 *   'settings-dialog'). It becomes the logger module 'ErrorBoundary:<scope>' so
 *   the UI toast sink can skip it and so records are attributable per subtree.
 * @param {React.ComponentType} [props.FallbackComponent] - override the default
 *   Hebrew fallback if a subtree needs its own screen.
 * @param {Function} [props.onReset] - forwarded to react-error-boundary; runs
 *   when resetErrorBoundary() fires (clear the state that caused the throw).
 */
export const AppErrorBoundary = ({ children, scope = 'root', FallbackComponent, onReset }) => {
    const handleError = (error, info) => {
        // The boot overlay is opaque and covers everything. If the tree crashed
        // before whoever owns the overlay got to release it, the fallback screen
        // below would render invisibly and the user would watch a spinner
        // forever. Take it down first, then log.
        dismissBootLoader();
        // Canonical render-throw record. Pass the component stack in context so a
        // remote sink can attribute the crash; do NOT also toast here ג€” the
        // fallback screen is the single user-facing surface for render throws.
        // componentStack rides the ERROR record's context — the sink maps it to
        // component_stack. It used to be a separate DEBUG record, which never ships
        // (default policy is WARN/ERROR only), so the stack was collected then dropped.
        logger.error(`ErrorBoundary:${scope}`, 'React render error caught', error, {
            componentStack: info?.componentStack,
        });
    };

    return (
        <ErrorBoundary
            FallbackComponent={FallbackComponent || DefaultFallback}
            onError={handleError}
            onReset={onReset}
        >
            {children}
        </ErrorBoundary>
    );
};

/**
 * useAppErrorFunnel ג€” re-export of react-error-boundary's useErrorBoundary.
 *
 * Error Boundaries do NOT catch errors thrown in async code or event handlers.
 * To route those into the nearest AppErrorBoundary (one funnel for render and
 * non-render errors), call showBoundary(err) from a catch:
 *
 *   const { showBoundary } = useAppErrorFunnel();
 *   const onSave = async () => {
 *       try {
 *           await saveToApi();
 *       } catch (err) {
 *           // Re-route into the boundary instead of swallowing ג€” this satisfies
 *           // the "no silent catch" rule AND shows the fallback screen.
 *           showBoundary(err);
 *       }
 *   };
 *
 * Note: for user-initiated actions you often want a toast (via the UI sink /
 * showErrorWithDetails) rather than replacing the whole subtree with a fallback
 * screen ג€” reserve showBoundary for errors that leave the subtree unusable.
 */
export const useAppErrorFunnel = useErrorBoundary;

export default AppErrorBoundary;

