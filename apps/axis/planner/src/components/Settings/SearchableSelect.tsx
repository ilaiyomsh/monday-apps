import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../hooks/useLocale';

export interface SearchableSelectOption {
  id: string;
  name?: string;
  title?: string;
  // Custom data for rendering (e.g., availability percentage)
  meta?: {
    availability?: number; // 0-100+ current workload percentage
    projected?: number;    // projected workload after new allocation
    color?: string;
    [key: string]: any;
  };
}

interface SearchableSelectProps {
  options: Array<SearchableSelectOption>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  // Optional custom render function for options
  renderOption?: (option: SearchableSelectOption, isSelected: boolean) => React.ReactNode;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  isLoading = false,
  disabled = false,
  compact = false,
  renderOption
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevValueRef = useRef(value);

  // Safety check - ensure options is an array
  const safeOptions = Array.isArray(options) ? options : [];

  // Close dropdown when value changes externally (e.g., when parent modal resets form)
  useEffect(() => {
    if (prevValueRef.current !== value) {
      setIsOpen(false);
      prevValueRef.current = value;
    }
  }, [value]);

  const getLabel = (option: any) => option?.name || option?.title || '';

  const selectedOption = safeOptions.find(o => o?.id === value);

  // Sync searchTerm with selected value when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm(selectedOption ? getLabel(selectedOption) : '');
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Reset to selected value name
        setSearchTerm(selectedOption ? getLabel(selectedOption) : '');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedOption]);

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

  // Always filter based on searchTerm
  const filteredOptions = safeOptions.filter(option =>
    getLabel(option).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (optionId: string) => {
    onChange(optionId);
    setIsOpen(false);
    const selected = safeOptions.find(o => o?.id === optionId);
    setSearchTerm(selected ? getLabel(selected) : '');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleInputClick = () => {
    if (!disabled && !isLoading) {
      setIsOpen(true);
      // Select all text when opening to allow quick replacement
      if (inputRef.current) {
        inputRef.current.select();
      }
    }
  };

  const handleInputFocus = () => {
    if (!disabled && !isLoading) {
      setIsOpen(true);
      // Select all text when focusing
      if (inputRef.current) {
        inputRef.current.select();
      }
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
    setIsOpen(false);
  };

  const showClearButton = selectedOption && !disabled && !isLoading;

  return (
    <div className="relative" ref={containerRef} dir={locale.dir}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isLoading ? t('common.loading') : searchTerm}
          onChange={handleInputChange}
          onClick={handleInputClick}
          onFocus={handleInputFocus}
          disabled={disabled || isLoading}
          placeholder={resolvedPlaceholder}
          className={`w-full ${compact ? 'h-[40px] text-xs' : 'h-[48px] text-sm'} ps-3 ${showClearButton ? 'pe-16' : 'pe-10'} rounded-[6px] transition-all border ${
            disabled || isLoading
              ? 'border-transparent bg-bg-hover text-text-subtle cursor-not-allowed'
              : isOpen
              ? 'border-accent bg-bg-surface ring-2 ring-accent'
              : 'border-transparent bg-bg-emphasis hover:bg-border-default'
          } ${selectedOption || searchTerm ? 'text-text-secondary' : 'text-text-subtle'}`}
          dir={locale.dir}
        />
        {showClearButton && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute end-8 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-bg-emphasis transition-colors"
            title={t('common.clearSelection')}
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
          </button>
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
          className={`absolute end-3 top-1/2 -translate-y-1/2 transition-transform duration-200 pointer-events-none ${
            isOpen ? 'rotate-180 text-accent' : 'text-text-subtle'
          }`}
        >
          <path d="M2 4l4 4 4-4" />
        </svg>
      </div>

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
            {filteredOptions.length === 0 ? (
              <div className={`px-4 py-3 text-text-muted text-center ${compact ? 'text-xs' : 'text-sm'}`}>
                {t('common.noResults')}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between text-text-primary hover:bg-accent-bg-soft transition-colors group first:rounded-t-[4px] last:rounded-b-[4px] ${compact ? 'text-xs' : 'text-sm'}`}
                >
                  {renderOption ? (
                    renderOption(option, value === option.id)
                  ) : (
                    <>
                      <span className="font-normal">{getLabel(option)}</span>
                      {value === option.id && (
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
                    </>
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
