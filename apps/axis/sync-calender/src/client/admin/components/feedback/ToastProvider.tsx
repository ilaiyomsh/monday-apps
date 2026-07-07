import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Toast } from '@vibe/core';

type ToastType = 'positive' | 'negative' | 'normal';

interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
}

interface PillMessage {
  id: number;
  text: string;
}

interface ToastContextValue {
  notify(text: string, type?: ToastType): void;
  success(text: string): void;
  error(text: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pills, setPills] = useState<PillMessage[]>([]);

  const notify = useCallback((text: string, type: ToastType = 'normal') => {
    counter += 1;
    const id = counter;
    setToasts((prev) => [...prev, { id, text, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Success is non-urgent (save confirmations). Render a small corner pill
  // instead of a full banner so it doesn't cover page content.
  const success = useCallback((text: string) => {
    counter += 1;
    const id = counter;
    setPills((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setPills((prev) => prev.filter((p) => p.id !== id));
    }, 1800);
  }, []);
  const error = useCallback((text: string) => notify(text, 'negative'), [notify]);

  const ctx = useMemo(() => ({ notify, success, error }), [notify, success, error]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <Toast
            key={t.id}
            open
            type={t.type}
            autoHideDuration={4000}
            onClose={() => setToasts((prev) => prev.filter((p) => p.id !== t.id))}
          >
            {t.text}
          </Toast>
        ))}
        {pills.map((p) => (
          <div
            key={p.id}
            style={{
              background: '#e6f7ed',
              color: '#15884c',
              border: '1px solid #b7e7c9',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-end',
            }}
          >
            <span style={{ fontSize: 11 }}>✓</span>
            {p.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
