import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SearchablePicker.module.css';

export function SearchablePicker({
  options,
  value,
  onChange,
  placeholder,
  isLoading = false,
  disabled = false,
  showSearch = true,
  // multi-select mode: `value` is an array of ids, `onChange` receives the new
  // array. The menu stays open on pick so several options can be toggled.
  multiple = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  const selected = useMemo(
    () => options.find((opt) => String(opt.id) === String(value)) || null,
    [options, value]
  );

  // multi-select bookkeeping (ignored in single mode).
  const valueList = useMemo(
    () => (Array.isArray(value) ? value.map(String) : []),
    [value]
  );
  const selectedList = useMemo(
    () => options.filter((opt) => valueList.includes(String(opt.id))),
    [options, valueList]
  );
  const hasSelection = multiple ? selectedList.length > 0 : !!selected;
  const triggerLabel = multiple
    ? (selectedList.length ? selectedList.map((o) => o.name).join(', ') : (isLoading ? 'טוען' : placeholder))
    : (selected ? selected.name : (isLoading ? 'טוען' : placeholder));

  const filteredOptions = useMemo(() => {
    if (!showSearch || !searchTerm.trim()) return options;
    const q = searchTerm.trim().toLowerCase();
    return options.filter((opt) => opt.name.toLowerCase().includes(q));
  }, [options, showSearch, searchTerm]);

  const updateDropdownPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPos();

    const onScroll = () => updateDropdownPos();
    const onResize = () => updateDropdownPos();
    const onMouseDown = (event) => {
      // The dropdown is portaled to <body> (outside containerRef), so check it
      // too — otherwise clicking an option closes the menu before the click
      // registers and nothing gets selected.
      const inContainer = containerRef.current && containerRef.current.contains(event.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(event.target);
      if (!inContainer && !inDropdown) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, updateDropdownPos]);

  const handleSelect = (opt) => {
    if (multiple) {
      const idStr = String(opt.id);
      const next = valueList.includes(idStr)
        ? selectedList.filter((o) => String(o.id) !== idStr).map((o) => o.id)
        : [...selectedList.map((o) => o.id), opt.id];
      onChange(next);
      return; // keep the menu open + search intact for further toggling
    }
    onChange(opt.id);
    setIsOpen(false);
    setSearchTerm('');
  };

  const clearSelection = (e) => {
    e.stopPropagation();
    onChange(multiple ? [] : '');
    setSearchTerm('');
    setIsOpen(false);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={`${styles.trigger} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={() => {
          if (disabled || isLoading) return;
          setIsOpen((prev) => !prev);
        }}
      >
        <span className={`${styles.triggerText} ${!hasSelection ? styles.placeholder : ''}`}>
          {triggerLabel}
        </span>
        {/* Clear the mapping. A <span> (not <button>) since the trigger is itself
            a button — nesting buttons is invalid HTML. stopPropagation so it
            clears instead of toggling the dropdown. */}
        {hasSelection && !disabled && (
          <span
            role="button"
            tabIndex={0}
            className={styles.clearBtn}
            aria-label="נקה בחירה"
            title="נקה שדה"
            onClick={clearSelection}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearSelection(e); } }}
          >
            ×
          </span>
        )}
        <span className={styles.chevron}>{isOpen ? '▴' : '▾'}</span>
      </button>

      {isOpen && !disabled && createPortal(
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          style={{
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            width: `${dropdownPos.width}px`,
          }}
        >
          {showSearch && (
            <div className={styles.searchWrap}>
              <input
                autoFocus
                className={styles.searchInput}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="חיפוש"
              />
            </div>
          )}
          <div className={styles.options}>
            {filteredOptions.length === 0 ? (
              <div className={styles.empty}>אין תוצאות</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSel = multiple
                  ? valueList.includes(String(opt.id))
                  : String(value) === String(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${styles.option} ${isSel ? styles.selected : ''}`}
                    onClick={() => handleSelect(opt)}
                  >
                    {multiple && <span className={styles.optionCheck} aria-hidden="true">{isSel ? '✓' : ''}</span>}
                    {opt.name}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default SearchablePicker;
