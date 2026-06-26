// Toast — ported from gg-app.jsx. `useToast().notify(node)` shows a single
// bottom-center toast that auto-dismisses after ~3.4s. Accepts rich nodes
// (e.g. <>Seated <b>RIG-01</b></>).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastState {
  notify: (node: ReactNode) => void;
}

const ToastContext = createContext<ToastState | null>(null);
const AUTO_DISMISS_MS = 3400;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ReactNode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((node: ReactNode) => {
    setToast(node);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast !== null && (
        <div className="toast">
          <span className="d" />
          {toast}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
