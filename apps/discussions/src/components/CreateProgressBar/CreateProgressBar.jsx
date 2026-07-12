import React from 'react';
import { Check, X } from 'lucide-react';
import styles from './CreateProgressBar.module.css';

/**
 * Slim creation-progress indicator SHARED by the Topics-view decision- and
 * task-create-from-point flows (per-point "+" quick-create). Because the
 * quick-create modal closes immediately (fire-and-forget) and the real
 * create_item + relation writes take a few seconds, this makes that gap legible
 * right on the point row that started it. Driven by a single `status` string:
 *   'pending' → an indeterminate Twyst-gradient (indigo→magenta→peach) sweep,
 *               signalling the in-flight server create.
 *   'success' → the bar fills solid green and a ✓ + "נוצרה" pops (~1s) before
 *               the caller clears it and the row settles (counter bumps).
 *   'error'   → a red bar + "נכשל". The REAL monday error is surfaced by the
 *               round-49 logger sink / toast; this is only the inline state.
 * Renders nothing when `status` is falsy. Presentation-only — the CALLER owns
 * the timing/clearing (DiscussionCard's handleQuickCreate). `variant`
 * ('decision' | 'task') only tints the pending sweep's accent.
 */
export function CreateProgressBar({ status, variant = 'decision', className = '' }) {
  if (!status) return null;
  const isSuccess = status === 'success';
  const isError = status === 'error';
  // Round 54 — kind-specific PENDING wording, no ellipsis: the variant already
  // says whether a decision or a task is being created (TopicPointRow passes
  // variant="decision" / "task"), so the in-flight label reads "יוצר החלטה" or
  // "יוצר משימה" instead of the old generic "יוצר…". Success/error are unchanged.
  const pendingLabel = variant === 'task' ? 'יוצר משימה' : 'יוצר החלטה';
  const label = isSuccess ? 'נוצרה' : isError ? 'נכשל' : pendingLabel;
  const ariaLabel = isSuccess ? 'נוצרה בהצלחה' : isError ? 'שמירה נכשלה' : pendingLabel;
  return (
    <span
      className={`${styles.wrap} ${styles[status] || ''} ${className}`}
      data-variant={variant}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className={styles.track}>
        <span className={styles.fill} />
      </span>
      <span className={styles.badge}>
        {isSuccess && <Check size={12} strokeWidth={3} aria-hidden="true" />}
        {isError && <X size={12} strokeWidth={3} aria-hidden="true" />}
        <span className={styles.badgeText}>{label}</span>
      </span>
    </span>
  );
}

export default CreateProgressBar;
