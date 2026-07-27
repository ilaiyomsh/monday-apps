import React from 'react';
import { PICKER_VISIBLE_LABELS } from '../../utils/pickerDialogSize';

/**
 * Monday-style shimmer placeholders matching status-option pills.
 * Shown on first paint while context / labels load.
 */
function StatusPickerSkeleton({ count = PICKER_VISIBLE_LABELS }) {
  const bars = Array.from({ length: count }, (_, index) => (
    <div
      key={index}
      className="status-option-skeleton"
      aria-hidden="true"
    />
  ));

  return (
    <main
      className="status-picker-dialog status-picker-skeleton"
      aria-busy="true"
      aria-label="טוען סטטוסים"
      dir="rtl"
    >
      <div className="status-menu" role="presentation">
        {bars}
      </div>
    </main>
  );
}

export default StatusPickerSkeleton;
