import React from 'react';
import { PICKER_VISIBLE_LABELS } from '../../utils/pickerDialogSize';

/**
 * Monday-style shimmer placeholders matching status-option pills.
 * No copy — only the bars — so the cell dialog never flashes loading text.
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
    <main className="status-picker-dialog status-picker-skeleton" aria-busy="true" dir="rtl">
      <div className="status-menu" role="presentation">
        {bars}
      </div>
    </main>
  );
}

export default StatusPickerSkeleton;
