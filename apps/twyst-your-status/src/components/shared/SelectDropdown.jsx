import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import logger from '../../utils/logger';
import { clampOverlayLeft } from '../../utils/overlayPlacement';

/** Custom dropdown — matches settings field chrome (not native <select>). */
function SelectDropdown({
  id,
  value,
  options,
  disabled,
  onChange,
  placeholder = 'בחירה',
  emptyText = 'אין אפשרויות',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const label = selected?.label || placeholder;

  useDismissOnOutside(open, [menuRef, triggerRef], () => setOpen(false));

  const openMenu = () => {
    if (disabled) return;
    try {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 200);
      const left = clampOverlayLeft(rect.left, width, window.innerWidth);
      setPos({ top: rect.bottom + 4, left, width });
      setOpen(true);
    } catch (err) {
      logger.error('SelectDropdown', 'Failed to open dropdown', err);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`twyst-select-trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className={`twyst-select-value${!selected ? ' is-placeholder' : ''}`}>{label}</span>
        <span className="twyst-select-chevron" aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="twyst-select-menu"
          role="listbox"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 10000,
          }}
        >
          {options.length === 0 ? (
            <div className="twyst-select-empty">{emptyText}</div>
          ) : (
            options.map((option) => {
              const isActive = String(option.value) === String(value);
              return (
                <button
                  key={String(option.value) || '__none__'}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`twyst-select-option${isActive ? ' is-active' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export default SelectDropdown;
