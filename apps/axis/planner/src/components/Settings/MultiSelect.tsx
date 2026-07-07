import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../hooks/useLocale';

interface MultiSelectProps {
  options: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  isLoading = false,
  disabled = false
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevValueRef = useRef(value);

  // Close dropdown when value changes externally (e.g., when parent modal resets form)
  useEffect(() => {
    const valueChanged = JSON.stringify(prevValueRef.current) !== JSON.stringify(value);
    if (valueChanged) {
      setIsOpen(false);
      prevValueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate dropdown position when opened
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 240; // max-h-[240px]
      const padding = 8;
      
      // Check if there's enough space below
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Determine if dropdown should open upward or downward
      const shouldOpenUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      
      // Calculate top position
      const top = shouldOpenUpward 
        ? rect.top - Math.min(dropdownHeight, spaceAbove - padding)
        : rect.bottom + 4;
      
      // Ensure dropdown doesn't overflow horizontally
      let left = rect.left;
      const dropdownWidth = rect.width;
      
      // Check right edge
      if (left + dropdownWidth > window.innerWidth) {
        left = window.innerWidth - dropdownWidth - padding;
      }
      
      // Check left edge
      if (left < padding) {
        left = padding;
      }
      
      setDropdownPosition({
        top,
        left,
        width: rect.width
      });
    } else {
      setDropdownPosition(null);
    }
  }, [isOpen]);

  // Safety check - ensure options is an array
  const safeOptions = Array.isArray(options) ? options : [];
  
  const filteredOptions = safeOptions.filter(option =>
    option?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOptions = safeOptions.filter(o => value.includes(o.id));

  const handleToggle = (optionId: string) => {
    if (value.includes(optionId)) {
      onChange(value.filter(id => id !== optionId));
    } else {
      onChange([...value, optionId]);
    }
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
    setIsOpen(false);
  };

  const showClearButton = selectedOptions.length > 0 && !disabled && !isLoading;

  return (
    <div className="relative" ref={containerRef} dir={locale.dir}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`w-full min-h-[40px] px-3 py-2 flex items-center justify-between rounded-[6px] text-sm transition-all border ${
          disabled || isLoading
            ? 'border-transparent bg-bg-hover text-text-subtle cursor-not-allowed'
            : isOpen
            ? 'border-accent bg-bg-surface shadow-[var(--shadow-focus-ring)]'
            : 'border-transparent bg-bg-emphasis hover:bg-border-default'
        }`}
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {selectedOptions.length === 0 ? (
            <span className="text-text-subtle">{resolvedPlaceholder}</span>
          ) : (
            selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-bg-badge text-accent-text-strong rounded text-xs"
              >
                {option.name}
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(option.id);
                  }}
                  className="hover:text-accent-text-strong cursor-pointer"
                >
                  ×
                </span>
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-1">
          {showClearButton && (
            <span
              role="button"
              onClick={handleClearAll}
              className="p-1 rounded-full hover:bg-bg-emphasis transition-colors cursor-pointer"
              title={t('common.clearAll')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-text-subtle hover:text-text-muted"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-accent' : 'text-text-subtle'
            }`}
          >
            <path d="M2 4l4 4 4-4" />
          </svg>
        </div>
      </button>

      {isOpen && !disabled && dropdownPosition && (
        <>
          <div
            className="fixed inset-0 z-[110]"
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="fixed bg-bg-surface rounded-[8px] py-1 shadow-xl z-[9999] border border-border-subtle animate-in fade-in zoom-in-95 duration-100 origin-top max-h-[240px] overflow-y-auto"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`
            }}
            dir={locale.dir}
          >
            <div className="px-3 py-2 border-b border-border-subtle">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('common.searchVerb')}
                className="w-full h-[32px] px-3 bg-bg-section border border-border-default rounded text-text-primary placeholder-text-subtle text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                autoFocus
                dir={locale.dir}
              />
            </div>
            {filteredOptions.length === 0 ? (
              <div className="px-4 py-3 text-text-muted text-sm text-center">
                {t('common.noResults')}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleToggle(option.id)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-text-primary text-sm hover:bg-accent-bg-soft transition-colors group"
                >
                  <span className="font-normal">{option.name}</span>
                  {value.includes(option.id) && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-accent"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
