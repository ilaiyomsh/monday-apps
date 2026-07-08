import React, { memo } from 'react';
import { useGantt } from '../../../hooks/useGantt';

/**
 * A thin horizontal band used to visually split sections (e.g. roles ↔
 * employees) in the Employees tab. Sticky-aligned to keep the sidebar half
 * matching the row's full-width band even while the gantt scrolls.
 */
export const SeparatorRow: React.FC = memo(() => {
  const { sidebarWidth } = useGantt();
  return (
    <div className="flex h-full bg-bg-emphasis border-y border-border-default">
      <div
        className="sticky left-0 z-30 bg-bg-emphasis border-r border-border-default h-full"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      />
      <div className="flex-1 bg-bg-emphasis" />
    </div>
  );
});

SeparatorRow.displayName = 'SeparatorRow';
