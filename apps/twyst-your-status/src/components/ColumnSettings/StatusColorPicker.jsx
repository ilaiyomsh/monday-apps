import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from '@vibe/core';
import {
  fromVibeColorName,
  resolveStatusColorHex,
  toVibeColorName,
  VIBE_STATUS_COLOR_NAMES,
} from '../../domain/statusColors';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import logger from '../../utils/logger';
import { clampOverlayLeft } from '../../utils/overlayPlacement';
import './StatusColorPicker.css';

/**
 * monday-style color circle + Vibe ColorPicker popover (same pattern as
 * discussions TemplateManagerModal type color).
 */
export default function StatusColorPicker({
  colorValue,
  hex: storedHex,
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

  useDismissOnOutside(open, [popoverRef, triggerRef], () => setOpen(false));

  const openPicker = () => {
    if (disabled) return;
    try {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverWidth = 220;
      const left = clampOverlayLeft(rect.left, popoverWidth, window.innerWidth);
      setPos({ top: rect.bottom + 6, left });
      setOpen(true);
    } catch (err) {
      logger.error('StatusColorPicker', 'Failed to open color picker', err);
    }
  };

  /*
   * The hex monday STORED wins over one re-derived from the colour enum. They can
   * disagree: the platform overrides some colours server-side (a label in the reserved
   * id-5 slot renders grey whatever enum was sent), and re-deriving showed the enum's
   * own colour instead — the same label reading orange in settings and grey on the
   * board. The enum is still the write value; this is display only.
   */
  const hex = storedHex || resolveStatusColorHex(colorValue) || '#c4c4c4';

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
