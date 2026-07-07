import React, { memo } from 'react';
import type { ProjectClassification } from '../../../types/gantt.types';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';
import { getToken } from '../../../styles/tokenAccess';

interface SectionHeaderRowProps {
  classification: ProjectClassification;
  label: string;
  isExpanded: boolean;
  count: number;
  accentColor?: string;
}

// was: '#94a3b8' (slate-400) — now resolved from --color-neutral-650
// Lazy getter so the token is read after stylesheets are applied.
const fallbackAccent = (): string =>
  // eslint-disable-next-line no-restricted-syntax -- SSR/test fallback for --color-neutral-650
  getToken('--color-neutral-650', '#94a3b8');

/**
 * SectionHeaderRow — collapsible header that buckets project groups by
 * internal/external classification. Click anywhere on the row to toggle.
 */
export const SectionHeaderRow: React.FC<SectionHeaderRowProps> = memo(({ classification, label, isExpanded, count, accentColor }) => {
  const { toggleSection, sidebarWidth, totalWidth, selectedProjectId, setSelectedProjectId } = useGantt();
  const locale = useLocale();

  const accent = accentColor || fallbackAccent();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // During project focus the section collapse state is overridden, so a manual
    // toggle would appear to do nothing — exit focus first so the user's intent
    // applies to the real (un-overridden) collapse state.
    if (selectedProjectId !== null) {
      setSelectedProjectId(null);
      return;
    }
    toggleSection(classification);
  };

  return (
    <div
      className="flex h-full border-b-2 border-border-default bg-bg-section cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={handleClick}
    >
      {/* Sidebar */}
      <div
        className="sticky left-0 z-40 border-r border-border-default h-full flex items-center px-4 gap-2 relative shadow-[var(--shadow-sticky-col)] bg-bg-section"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        dir="ltr"
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
          style={{ backgroundColor: accent }}
        />
        {/* Flush-left cluster: label, count, chevron — trailing spacer keeps them
            pinned to the left while the label can still truncate. */}
        <span
          className="font-bold text-text-primary text-sm truncate min-w-0"
          dir={locale.dir}
          style={{ textAlign: 'left' }}
        >
          {label}
        </span>
        <span className="text-sm font-semibold text-text-muted bg-bg-surface border border-border-subtle rounded-full px-2 py-0.5 flex-shrink-0">
          {count}
        </span>
        <div className={`w-4 h-4 flex items-center justify-center transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
          <svg className="w-3.5 h-3.5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
        <div className="flex-1" />
      </div>

      {/* Timeline filler — keeps the row spanning full width without extra content */}
      <div
        className="flex-1 h-full bg-bg-section"
        style={{ minWidth: totalWidth }}
      />
    </div>
  );
});

SectionHeaderRow.displayName = 'SectionHeaderRow';
