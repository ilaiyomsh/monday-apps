import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuOption {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
  options: ContextMenuOption[];
}

/**
 * Lightweight context menu component for right-click actions
 * Renders as a portal to avoid z-index issues
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  onClose,
  options,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Small delay to avoid immediate close from the same click
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Calculate position to keep menu in viewport
  const menuWidth = 160;
  const menuHeight = options.length * 40 + 8; // Approximate height

  let left = position.x;
  let top = position.y;

  // Adjust if menu would overflow right edge
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 8;
  }

  // Adjust if menu would overflow bottom edge
  if (top + menuHeight > window.innerHeight) {
    top = window.innerHeight - menuHeight - 8;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed bg-bg-surface border border-border-subtle rounded-lg shadow-xl z-[9999] py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-150"
      style={{ left: `${left}px`, top: `${top}px` }}
      dir="rtl"
    >
      {options.map((option, index) => (
        <button
          key={index}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            option.onClick();
            onClose();
          }}
          className={`w-full px-4 py-2.5 text-sm font-medium text-right flex items-center gap-3 transition-all duration-150 ${
            option.danger
              ? 'text-danger hover:bg-danger-soft'
              : 'text-text-secondary hover:bg-bg-hover'
          }`}
        >
          {option.icon && (
            <span className="w-4 h-4 flex-shrink-0">{option.icon}</span>
          )}
          <span>{option.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
};
