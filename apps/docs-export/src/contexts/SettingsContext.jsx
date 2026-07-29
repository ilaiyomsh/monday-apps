/**
 * SettingsContext — the per-instance settings blob, and the gate it guards.
 *
 * @module contexts/SettingsContext
 *
 * Ported from `apps/discussions/src/contexts/SettingsContext.jsx`, keeping the two
 * subtleties that app paid for in production and dropping everything else:
 *
 *  1. **The loaded key is tracked in a REF, not a boolean latch.** `MondayProvider`
 *     installs `{}` after a 4s watchdog, which resolves to the `_default` storage
 *     key. When the real `instanceId` lands afterwards the key CHANGES and the blob
 *     must be re-read; a "have I loaded yet" boolean would leave a configured
 *     instance permanently on empty default settings (that exact bug shipped an
 *     onboarding wizard to configured Axis Planner instances).
 *  2. **`updateSettings` is a GUARDED deep merge.** The panel saves one section at a
 *     time, so a partial write must merge role maps key-by-key while REPLACING
 *     arrays and scalars — and it must not invent nested keys the blob does not
 *     carry. See `mergeSettingsPatch`.
 *
 * Division of labour with the layers underneath:
 *   - `utils/settingsStore` owns storage (keys, timeouts, the false-empty re-read,
 *     the read-back that proves a write persisted). It is schema-agnostic.
 *   - `domain/settingsSchema` owns SHAPE (`normalizeSettings`, `isConfigured`).
 *   - this module owns REACT: when to load, what the app may render, and how a
 *     partial update reaches both storage and the live tree.
 *
 * `settings` is `null` until the first load settles, so `isLoading` and "nothing
 * stored" are never confused; after that it is always a complete normalized blob.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Flex, Heading, Loader, Text } from '@vibe/core';
import { useMonday } from './MondayContext.jsx';
import { useIsOwner } from '../hooks/useIsOwner.js';
import { SettingsPanel } from '../components/SettingsPanel';
import { loadSettings, saveSettings, settingsKeyCandidates } from '../utils/settingsStore.js';
import { isConfigured as computeIsConfigured, normalizeSettings } from '../domain/settingsSchema.js';
import logger from '../utils/logger.js';

// Exported so a lightweight consumer or test can inject a value without mounting
// the provider (mirrors MondayContext).
export const SettingsContext = createContext(null);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Apply a PARTIAL settings update to a blob, one level deep.
 *
 * Rules, and why each one is the way it is:
 *   - a nested plain object (`columns`, `headers`) MERGES key-by-key — the panel
 *     saves one role at a time and must not wipe the other four;
 *   - an array (`blocks`) REPLACES — merging would resurrect a deleted block;
 *   - a scalar REPLACES;
 *   - `undefined` is SKIPPED, never written — a control that has not been touched
 *     yet hands us `undefined`, and treating that as "clear it" silently blanks a
 *     stored value;
 *   - a patch that is not a plain object is ignored entirely rather than spread
 *     (spreading an array would add numeric keys to the blob).
 *
 * Pure: neither argument is mutated.
 *
 * @param {Object} base - the current (normalized) blob
 * @param {Object} partial - the fields to change
 * @returns {Object} a new blob
 */
export function mergeSettingsPatch(base, partial) {
  const current = isPlainObject(base) ? base : {};
  if (!isPlainObject(partial)) return { ...current };

  const next = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    next[key] =
      isPlainObject(value) && isPlainObject(current[key])
        ? { ...current[key], ...value }
        : value;
  }
  return next;
}

/** The value handed to consumers rendered outside a provider (see useSettings). */
const NO_PROVIDER = {
  settings: null,
  isLoading: false,
  isConfigured: false,
  updateSettings: async () => null,
};

let missingProviderReported = false;

export function SettingsProvider({ children }) {
  const { context } = useMonday();
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // The storage key we last loaded under — a ref, not a boolean (see the module
  // header, subtlety 1).
  const loadedKeyRef = useRef(null);

  useEffect(() => {
    // context === null: MondayProvider has neither resolved the context nor fired
    // its watchdog. Loading under the 'default' key now would read the wrong blob
    // and (worse) look authoritative.
    if (!context) return;

    const [key] = settingsKeyCandidates(context);
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    let cancelled = false;
    setIsLoading(true);

    // `loadSettings` never throws (a boot-path read degrades to "nothing stored"),
    // so the catch here exists only for an unexpected failure — without it the app
    // would sit on the gate's spinner forever.
    // The chain deliberately ENDS on .catch (no trailing .finally): a settled-state
    // update must happen on both paths, and a chain whose last link is .finally is
    // an unhandled rejection waiting to happen.
    loadSettings(context)
      .then((raw) => {
        if (cancelled) return;
        setSettings(normalizeSettings(raw));
        setIsLoading(false);
      })
      .catch((err) => {
        logger.error('SettingsContext', 'טעינת ההגדרות נכשלה — האפליקציה תיפתח כלא-מוגדרת', err, {
          key,
        });
        if (cancelled) return;
        setSettings(normalizeSettings(null));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context]);

  const updateSettings = useCallback(
    async (partial) => {
      // A first-time write starts from the defaults, not from `{}` — otherwise the
      // single table block DEFAULT_SETTINGS guarantees would be missing from the
      // blob the panel just saved.
      const base = settings ?? normalizeSettings(null);
      const next = normalizeSettings(mergeSettingsPatch(base, partial));

      // Optimistic: a storage round-trip here is a read + write + read-back, and
      // the panel must not feel frozen while it happens.
      setSettings(next);

      try {
        // The PARTIAL goes to storage, not `next`: settingsStore merges against
        // what is actually stored, which is the only way two surfaces editing
        // different sections do not overwrite each other.
        await saveSettings(context, partial);
      } catch (err) {
        // saveSettings already logged (and therefore raised a toast). Roll the
        // optimistic value back so nobody keeps configuring on top of a mapping
        // that never persisted, and rethrow so the panel can stay open.
        setSettings(base);
        throw err;
      }

      return next;
    },
    [settings, context]
  );

  const value = useMemo(
    () => ({
      settings,
      isLoading,
      isConfigured: computeIsConfigured(settings),
      updateSettings,
    }),
    [settings, isLoading, updateSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * @returns {{settings: Object|null, isLoading: boolean, isConfigured: boolean,
 *   updateSettings: (partial: Object) => Promise<Object|null>}}
 */
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    if (!missingProviderReported) {
      // A missing provider is a wiring bug, not a user error — report it once
      // (deduped by the flag, since this runs on every render of the offender).
      logger.error(
        'SettingsContext',
        'useSettings נקרא ללא SettingsProvider — ההגדרות ייחשבו כלא-מוגדרות'
      );
      missingProviderReported = true;
    }
    return NO_PROVIDER;
  }
  return ctx;
}

/** A centred spinner — the gate's "we do not know yet" state. */
function GateLoading() {
  return (
    <Flex justify="center" align="center" style={{ height: '100svh' }} data-testid="settings-loading">
      <Loader size={32} />
    </Flex>
  );
}

/**
 * Blocks render until the settings blob is known, and forces configuration when it
 * is unusable.
 *
 * This is the app's safety interlock, not a convenience: every query needs
 * `settings.boardId` plus the five column ids, and monday answers a query built
 * from empty ids with an EMPTY LIST rather than an error — so a premature render
 * does not crash, it silently reports "no items" forever.
 *
 * Settings are owner-only, so a non-owner facing an unconfigured instance gets a
 * Hebrew explanation instead of the panel. The ownership answer is awaited before
 * choosing between the two, or the wrong surface flashes.
 *
 * ON AN UNCONFIGURED INSTANCE THE GATE OPENS WHEN OWNERSHIP IS UNDETERMINED.
 * `useIsOwner` reports a tri-state (see `services/owners.js`), and here only a
 * PROVEN non-owner (`determined && !isOwner`) is turned away. When the check could
 * not be answered at all — most often the app missing the `boards:read` scope, but
 * equally a nulled board or a network failure — we render the configuration panel
 * anyway.
 *
 * That is deliberate, and it fixes a dead end that shipped: collapsing "not an
 * owner" together with "could not tell" showed the board owner a screen telling them
 * to ask the board owner, and configuring was the only exit, so the instance could
 * never become usable. An unconfigured instance holds NOTHING to protect — no board
 * id, no column mapping, no uploaded template — so refusing buys no security and
 * costs the app entirely. Once `isConfigured` is true the gate is strict again and
 * only a proven owner sees the settings affordance.
 */
export function SettingsGate({ children }) {
  const { settings, isLoading, isConfigured, updateSettings } = useSettings();
  const { isOwner, isLoading: isOwnerLoading, determined } = useIsOwner();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  if (isLoading) return <GateLoading />;

  if (!isConfigured) {
    if (isOwnerLoading) return <GateLoading />;

    // Only a PROVEN non-owner is refused. Undetermined falls through to the panel.
    if (determined && !isOwner) {
      return (
        <Flex
          direction="column"
          gap={12}
          justify="center"
          align="center"
          style={{ height: '100svh', padding: 'var(--content-gutter, 16px)', textAlign: 'center' }}
          data-testid="settings-not-configured"
        >
          <Heading type="h3">האפליקציה עדיין לא הוגדרה</Heading>
          <Text type="text2" color="secondary">
            בעל הלוח צריך להגדיר את לוח היעד ואת מיפוי העמודות לפני שניתן להפיק דוחות.
          </Text>
        </Flex>
      );
    }

    // Owner (or ownership undetermined) + unusable settings: the panel is the ONLY
    // thing that renders. It is not dismissible here — closing it would leave a
    // surface that cannot work.
    return (
      <SettingsPanel
        forced
        settings={settings}
        updateSettings={updateSettings}
        ownershipUnverified={!determined}
      />
    );
  }

  return (
    <>
      {isOwner ? (
        <Flex justify="end" style={{ padding: '4px var(--content-gutter, 16px) 0' }}>
          <Button
            kind="tertiary"
            size="small"
            onClick={() => setIsPanelOpen(true)}
            data-testid="open-settings"
          >
            הגדרות
          </Button>
        </Flex>
      ) : null}
      {children}
      {isPanelOpen ? (
        <SettingsPanel
          settings={settings}
          updateSettings={updateSettings}
          onClose={() => setIsPanelOpen(false)}
        />
      ) : null}
    </>
  );
}

export default SettingsContext;
