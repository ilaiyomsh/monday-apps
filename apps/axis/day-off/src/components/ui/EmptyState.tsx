/**
 * EmptyState — centered icon + title + optional subtitle. Ported from the prototype.
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon?: string;
  title?: ReactNode;
  sub?: ReactNode;
}

export function EmptyState({ icon = 'inbox', title, sub }: EmptyStateProps) {
  return (
    <div className="empty">
      <Icon name={icon} size={44} strokeWidth={1.25} />
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}
