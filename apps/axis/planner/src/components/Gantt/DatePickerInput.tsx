import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { DatePicker } from "@vibe/core/next";
import { LayerProvider } from "@vibe/core";
import { useLocale } from '../../hooks/useLocale';

interface DatePickerInputProps {
  label: string;
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
}

export const DatePickerInput: React.FC<DatePickerInputProps> = ({
  label,
  date,
  onDateChange
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; openAbove: boolean }>({ top: 0, left: 0, openAbove: false });

  // Compute dropdown position and clamp to viewport
  const computePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const calendarHeight = 340;
    const calendarWidth = 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < calendarHeight && rect.top > calendarHeight;

    let top = openAbove ? rect.top - calendarHeight - 4 : rect.bottom + 4;
    let left = rect.right - calendarWidth;

    // Clamp to viewport
    top = Math.max(4, Math.min(top, window.innerHeight - calendarHeight - 4));
    left = Math.max(4, Math.min(left, window.innerWidth - calendarWidth - 4));

    setDropdownPos({ top, left, openAbove });
  }, []);

  // Fix Popper positioning for month/year dropdowns inside our container.
  // LayerProvider makes vibe's Dialog portal inside layerRef, but Popper's
  // flip modifier incorrectly repositions the dropdown to the side.
  // This observer detects Popper elements and repositions them below the trigger.
  useEffect(() => {
    if (!isOpen) return;
    const layer = layerRef.current;
    if (!layer) return;

    const fixPopperPositions = () => {
      const wrappers = layer.querySelectorAll<HTMLElement>('.monday-style-dialog-content-wrapper');
      if (!wrappers.length) return;

      const layerRect = layer.getBoundingClientRect();

      wrappers.forEach(wrapper => {
        // Find the active trigger button (aria-expanded="true" set by downshift)
        const activeTrigger = layer.querySelector<HTMLElement>('[aria-expanded="true"]');
        if (!activeTrigger) return;

        const triggerRect = activeTrigger.getBoundingClientRect();
        const top = triggerRect.bottom - layerRect.top + 4;
        const right = layerRect.right - triggerRect.right;

        wrapper.style.setProperty('position', 'absolute', 'important');
        wrapper.style.setProperty('transform', 'none', 'important');
        wrapper.style.setProperty('inset', 'auto', 'important');
        wrapper.style.setProperty('top', `${top}px`, 'important');
        wrapper.style.setProperty('right', `${right}px`, 'important');
        wrapper.style.setProperty('width', 'auto', 'important');
      });
    };

    const observer = new MutationObserver(fixPopperPositions);
    observer.observe(layer, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    computePosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;

      const el = target as HTMLElement;
      if (
        el.closest?.('.monday-style-dialog-content-wrapper') ||
        el.closest?.('.monday-style-menu-dialog-container') ||
        el.closest?.('[data-testid="datepicker-popup-container"]')
      ) return;

      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', computePosition, true);
    window.addEventListener('resize', computePosition);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', computePosition, true);
      window.removeEventListener('resize', computePosition);
    };
  }, [isOpen, computePosition]);

  const handleDateChange = (newDate: Date | undefined) => {
    onDateChange(newDate);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="text-xs font-medium text-text-muted block mb-0.5">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-[34px] px-2.5 flex items-center justify-between rounded-[6px] bg-bg-emphasis text-sm hover:bg-neutral-250 transition-colors"
      >
        <span className="text-text-secondary">
          {date ? format(date, 'dd/MM/yyyy') : t('datePicker.placeholder')}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-subtle">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>

      {isOpen && createPortal(
        <div
          dir="ltr"
          ref={dropdownRef}
          className="bg-bg-surface rounded-lg shadow-xl border border-border-subtle p-2 text-left"
          style={{
            position: 'fixed',
            zIndex: 10000,
            top: dropdownPos.top,
            left: dropdownPos.left,
            direction: 'ltr',
          }}
          data-testid="datepicker-popup-container"
        >
          <div ref={layerRef} style={{ position: 'relative', overflow: 'visible' }}>
            <LayerProvider layerRef={layerRef as React.RefObject<HTMLElement>}>
              <DatePicker
                mode="single"
                locale={locale.dateFnsLocale}
                date={date}
                onDateChange={handleDateChange}
                dialogContainerSelector='[data-testid="datepicker-popup-container"]'
              />
            </LayerProvider>
          </div>
          <button
            type="button"
            onClick={() => handleDateChange(startOfDay(new Date()))}
            className="w-full mt-1 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 rounded-md transition-colors"
          >
            {t('gantt.toolbar.today')}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};