import React from 'react';
import { IconButton } from '@vibe/core';
import { Collapse, Expand } from '@vibe/icons';

// Shared collapse/expand-all toolbar button used by TasksTab, PreviousTasksTab
// and TopicsTab. It renders inside DiscussionCard's `.body` (overflow-y:auto),
// so the @vibe Tooltip is portalled to document.body via `tooltipProps.getContainer`
// — otherwise the tooltip is clipped at the scroll boundary.
export function CollapseAllButton({
  collapsed,
  onClick,
  style,
  collapseLabel = 'קפל הכל',
  expandLabel = 'פתח הכל',
}) {
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <IconButton
      icon={collapsed ? Expand : Collapse}
      onClick={onClick}
      size="small"
      kind="tertiary"
      style={style}
      ariaLabel={label}
      tooltipContent={label}
      // Sits at the very top of the scrollable body, so open the tooltip DOWNWARD
      // (default 'top' pops it up into the header divider and gets clipped).
      tooltipProps={{ getContainer: () => document.body, position: 'bottom' }}
    />
  );
}
