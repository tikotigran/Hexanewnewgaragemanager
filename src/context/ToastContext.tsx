import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {items.map((item) => {
          const icon =
            item.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#16A36A] shrink-0" />
            ) : item.variant === 'error' ? (
              <XCircle className="w-4 h-4 text-[#DC4545] shrink-0" />
            ) : item.variant === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-[#2563EB] shrink-0" />
            );
          return (
            <div
              key={item.id}
              role="status"
              className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] px-4 py-3 shadow-sm text-sm text-[#151922] dark:text-gray-100"
            >
              {icon}
              <span className="flex-1">{item.message}</span>
              <button
                type="button"
                aria-label="Fermer la notification"
                onClick={() => dismiss(item.id)}
                className="text-[#7A8290] hover:text-[#151922] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
