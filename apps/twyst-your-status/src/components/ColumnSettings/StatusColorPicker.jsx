import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from '@vibe/core';
import {
  fromVibeColorName,
  resolveStatusColorHex,
  toVibeColorName,
  VIBE_STATUS_COLOR_NAMES,
} from '../../domain/statusColors';
import logger from '../../utils/logger';
import './StatusColorPicker.css';

/**
 * monday-style color circle + Vibe ColorPicker popover (same pattern as
 * discussions TemplateManagerModal type color).
 */
export default function StatusColorPicker({
  colorValue,
  usedColorEnums = [],
  disabled = false,
  onChange,
  ariaLabel = 'בחירת צבע',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const vibeValue = toVibeColorName(colorValue);
  const usedVibe = new Set(
    (usedColorEnums ?? [])
      .map((value) => toVibeColorName(value))
      .filter(Boolean),
  );
  const colorsList = VIBE_STATUS_COLOR_NAMES.filter(
    (name) => name === vibeValue || !usedVibe.has(name),
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (popoverRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    try {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverWidth = 220;
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - popoverWidth - 8),
      );
      setPos({ top: rect.bottom + 6, left });
      setOpen(true);
    } catch (err) {
      logger.error('StatusColorPicker', 'Failed to open color picker', err);
    }
  };

  const hex = resolveStatusColorHex(colorValue) || '#c4c4c4';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="twyst-color-circle"
        style={{ background: hex }}
        onClick={openPicker}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      />
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="twyst-color-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
        >
          <ColorPicker
            value={[vibeValue]}
            onSave={(vals) => {
              try {
                if (!vals || !vals[0]) return;
                const nextEnum = fromVibeColorName(vals[0]);
                if (!nextEnum) {
                  logger.warn('StatusColorPicker', 'Unsupported vibe color selection', { vibe: vals[0] });
                  return;
                }
                onChange?.(nextEnum);
                setOpen(false);
              } catch (err) {
                logger.error('StatusColorPicker', 'Failed to apply color selection', err);
              }
            }}
            colorsList={colorsList.length > 0 ? colorsList : VIBE_STATUS_COLOR_NAMES}
            isBlackListMode={false}
            colorShape="circle"
            colorSize="medium"
            numberOfColorsInLine={5}
            focusOnMount={false}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
