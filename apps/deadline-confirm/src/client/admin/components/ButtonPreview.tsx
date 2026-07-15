// Visual approximation of the email button for live editing feedback. The
// AUTHORITATIVE HTML always comes from the server (/api/snippet,
// /api/email-template) — this mirrors the same style rules for preview only.

import type { ActionButton, ButtonSize } from '../types';

const SIZE_STYLES: Record<ButtonSize, { fontSize: number; padding: string }> = {
  sm: { fontSize: 13, padding: '8px 20px' },
  md: { fontSize: 16, padding: '12px 32px' },
  lg: { fontSize: 20, padding: '16px 40px' },
};

export function ButtonPreview({ button }: { button: ActionButton }) {
  const size = SIZE_STYLES[button.style.size] ?? SIZE_STYLES.md;
  const text = button.style.icon ? `${button.style.icon} ${button.name}` : button.name;
  return (
    <span
      style={{
        display: 'inline-block',
        backgroundColor: button.style.color,
        color: '#ffffff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 'bold',
        fontSize: size.fontSize,
        padding: size.padding,
        borderRadius: 8,
        whiteSpace: 'nowrap',
      }}
    >
      {text || 'כפתור'}
    </span>
  );
}
