import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string | null | undefined;
  onChange: (id: string | undefined) => void;
  placeholder: string;
  searchPlaceholder: string;
  noResultsText: string;
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  clearText?: string;
  allowClear?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  noResultsText,
  loading = false,
  loadingText = '...',
  disabled = false,
  clearText,
  allowClear = false,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.find((opt) => String(opt.id) === String(value ?? '')) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.name.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="settings-select" ref={rootRef}>
      <button
        type="button"
        className="settings-select-trigger"
        disabled={disabled || loading}
        onClick={() => setOpen((p) => !p)}
      >
        <span className={`settings-select-text ${!selected ? 'is-placeholder' : ''}`}>
          {selected ? (
            <span className="settings-select-label">
              {selected.color && <span className="settings-select-color-dot" style={{ backgroundColor: selected.color }} />}
              {selected.name}
            </span>
          ) : (
            loading ? loadingText : placeholder
          )}
        </span>
        <span className="settings-select-chevron" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && !disabled && !loading && (
        <div className="settings-select-menu">
          <input
            autoFocus
            type="text"
            className="settings-select-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />

          <div className="settings-select-options">
            {allowClear && (
              <button
                type="button"
                className="settings-select-option"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {clearText}
              </button>
            )}

            {filtered.length === 0 ? (
              <small className="settings-select-empty">{noResultsText}</small>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`settings-select-option ${String(value ?? '') === String(opt.id) ? 'is-selected' : ''}`}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className="settings-select-label">
                    {opt.color && <span className="settings-select-color-dot" style={{ backgroundColor: opt.color }} />}
                    {opt.name}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

