import type { ReactNode } from 'react';

interface SectionProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  hint?: string;
}

export function Section({ title, action, hint, children }: SectionProps) {
  return (
    <section
      style={{
        background: 'transparent',
        border: 0,
        borderTop: '1px solid #e6e9ef',
        borderRadius: 0,
        padding: '16px 0',
        marginBottom: 0,
      }}
    >
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {title && <h2 style={{ margin: 0, fontSize: 15, color: '#323338' }}>{title}</h2>}
          {action}
        </div>
      )}
      {hint && <p style={{ margin: '0 0 12px 0', color: '#676879', fontSize: 13 }}>{hint}</p>}
      {children}
    </section>
  );
}
