import React from 'react';
import { IconButton } from '@vibe/core';
import { Collapse, Expand, Bookmark } from '@vibe/icons';

// Shared collapse/expand-all toolbar button used by TasksTab, PreviousTasksTab
// and TopicsTab. It renders inside DiscussionCard's `.body` (overflow-y:auto),
// so the @vibe Tooltip is portalled to document.body via `tooltipProps.getContainer`
// — otherwise the tooltip is clipped at the scroll boundary.
//
// round105: when `onSave` is provided (owner with the saveViewDefaults capability),
// a small bookmark button appears beside the toggle. Clicking it saves the CURRENT
// all-collapsed / all-expanded state as the LOAD-TIME default for every user of the
// view — exactly like the Filter / Group-by builders' "save to this view".
export function CollapseAllButton({
  collapsed,
  onClick,
  onSave = null,
  style,
  collapseLabel = 'קפל הכל',
  expandLabel = 'פתח הכל',
  saveLabel = 'שמור מצב קיפול כברירת מחדל לכל המשתמשים',
}) {
  const label = collapsed ? expandLabel : collapseLabel;
  const toggle = (
    <IconButton
      icon={collapsed ? Expand : Collapse}
      onClick={onClick}
      size="small"
      kind="tertiary"
      style={onSave ? undefined : style}
      ariaLabel={label}
      tooltipContent={label}
      // Sits at the very top of the scrollable body, so open the tooltip DOWNWARD
      // (default 'top' pops it up into the header divider and gets clipped).
      tooltipProps={{ getContainer: () => document.body, position: 'bottom' }}
    />
  );
  if (!onSave) return toggle;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      {toggle}
      <IconButton
        icon={Bookmark}
        onClick={onSave}
        size="small"
        kind="tertiary"
        ariaLabel={saveLabel}
        tooltipContent={saveLabel}
        tooltipProps={{ getContainer: () => document.body, position: 'bottom' }}
      />
    </span>
  );
}
