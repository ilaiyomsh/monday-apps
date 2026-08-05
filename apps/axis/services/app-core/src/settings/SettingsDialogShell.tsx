import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Logger } from '../logger';
import './SettingsDialogShell.css';

/**
 * Generic, framework-style settings dialog (standard #17). The shell owns the
 * modal frame, tab navigation, a DRAFT copy (edits apply only on Save), per-tab
 * error indicators, and optional JSON export/import. The app supplies tab content
 * (field selectors — render @vibe/core inside), validation, and i18n labels.
 *
 * Styling lives in SettingsDialogShell.css — token-driven (var(--token, fallback))
 * so it adopts the host app's design tokens and degrades gracefully without them.
 * app-core stays i18n-agnostic (labels passed in) and UI-lib-agnostic.
 */

/* Minimal inline icons (lucide-style strokes) — keeps app-core dependency-free. */
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const CloseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...STROKE} aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...STROKE} aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...STROKE} aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
);
const SaveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...STROKE} aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
);
const SpinnerIcon = () => <span className="axsd-spinner" aria-hidden="true" />;
export interface SettingsTabRenderCtx<T> {
  draft: T;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  setDraft: (updater: (d: T) => T) => void;
  errors: Record<string, string>;
}

export interface SettingsTabDef<T> {
  id: string;
  label: string;
  render: (ctx: SettingsTabRenderCtx<T>) => ReactNode;
  /** keys this tab owns — used to show the error dot on the tab. */
  fields?: (keyof T)[];
}

export interface SettingsDialogShellProps<T extends object> {
  isOpen: boolean;
  onClose: () => void;
  settings: T;
  onSave: (next: T) => Promise<boolean> | boolean;
  tabs: SettingsTabDef<T>[];
  title?: string;
  validate?: (draft: T) => Record<string, string>;
  labels?: { save?: string; cancel?: string; export?: string; import?: string; invalid?: string; saveError?: string };
  allowExportImport?: boolean;
  /**
   * Logger for save failures (standard #6/error-guard). Optional — defaults to a
   * no-op so app-core stays usable without wiring one, but every real consumer
   * should pass its app logger so save failures ship as ERROR records.
   */
  logger?: Pick<Logger, 'error'>;
}

const noopLogger: Pick<Logger, 'error'> = { error: () => undefined };

export function SettingsDialogShell<T extends object>(props: SettingsDialogShellProps<T>) {
  const { isOpen, onClose, settings, onSave, tabs, title = 'Settings', validate, labels = {}, allowExportImport, logger = noopLogger } = props;
  const [draft, setDraft] = useState<T>(settings);
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // reset draft each time the dialog opens
  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setActiveId(tabs[0]?.id);
      setSaveError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const errors = useMemo(() => (validate ? validate(draft) : {}), [validate, draft]);
  const isValid = Object.keys(errors).length === 0;

  // Stable identity — consumers put setField in effect dependency arrays; an
  // inline closure here re-triggers those effects on every draft update.
  const setField = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value })),
    []
  );

  if (!isOpen) return null;
  const tabHasError = (tab: SettingsTabDef<T>) => (tab.fields ?? []).some((f) => errors[f as string]);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await onSave(draft);
      if (ok) onClose();
    } catch (err) {
      // The app's own onSave may already have caught + displayed a known domain
      // error (e.g. day-off's PersonalTypeInUseError) and returned false instead
      // of throwing — that path never reaches here, so there is no double
      // display. Anything that DOES throw is unexpected: log it (the logger's
      // own log-once dedup keeps an already-logged/shipped error, e.g. a
      // MondayApiError from the API funnel, from double-shipping) and surface
      // one inline banner without closing the dialog.
      logger.error('SettingsDialogShell', 'save failed', err);
      setSaveError(labels.saveError ?? 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<T>;
        setDraft((d) => ({ ...d, ...parsed }));
      } catch {
        /* ignore malformed import */
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      className="axsd-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="axsd-modal">
        <header className="axsd-header">
          <button className="axsd-close" onClick={onClose} aria-label={labels.cancel ?? 'Close'} type="button">
            <CloseIcon />
          </button>
          <h2 className="axsd-title">{title}</h2>
          {allowExportImport && (
            <div className="axsd-header-actions">
              <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
              <button className="axsd-icon-btn" onClick={handleExport} type="button">
                <DownloadIcon /><span>{labels.export ?? 'Export'}</span>
              </button>
              <button className="axsd-icon-btn" onClick={() => fileRef.current?.click()} type="button">
                <UploadIcon /><span>{labels.import ?? 'Import'}</span>
              </button>
            </div>
          )}
        </header>

        <nav className="axsd-tabs">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              type="button"
              className={`axsd-tab${tab.id === activeId ? ' axsd-tab--active' : ''}`}
              onClick={() => setActiveId(tab.id)}
            >
              {`${i + 1}. ${tab.label}`}
              {tabHasError(tab) && <span className="axsd-tab-dot" />}
            </button>
          ))}
        </nav>

        <div className="axsd-content">
          {active?.render({ draft, setField, setDraft, errors })}
        </div>

        <footer className="axsd-footer">
          {saveError ? (
            <span className="axsd-save-error" role="alert">{saveError}</span>
          ) : (
            !isValid && <span className="axsd-invalid">{labels.invalid ?? 'Fix the highlighted fields'}</span>
          )}
          <button className="axsd-btn axsd-btn--secondary" onClick={onClose} type="button">
            {labels.cancel ?? 'Cancel'}
          </button>
          <button className="axsd-btn axsd-btn--save" onClick={handleSave} disabled={!isValid || saving} type="button">
            {saving ? <SpinnerIcon /> : <SaveIcon />}{labels.save ?? 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
