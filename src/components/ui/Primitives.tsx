import React, { useState } from 'react';
import { X, Download, WifiOff, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOnlineStatus, usePWAInstall } from '../../lib/usePWA';
import { useI18n } from '../../context/I18nContext';
import { TRANSLATIONS } from '../../i18n/translations';
import type { Language } from '../../types';

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
  }
> = ({ variant = 'primary', size = 'md', className, children, ...props }) => {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:opacity-50 disabled:pointer-events-none cursor-pointer';
  const variants = {
    primary: 'bg-[#2563EB] text-white hover:bg-blue-700',
    secondary:
      'bg-white dark:bg-[#111827] text-[#151922] dark:text-gray-100 border border-[#E7EAF0] dark:border-gray-700 hover:bg-[#F6F7F9] dark:hover:bg-gray-800',
    ghost: 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white hover:bg-[#F0F2F6] dark:hover:bg-gray-800',
    danger: 'bg-[#DC4545] text-white hover:bg-red-700',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs min-h-[36px]',
    md: 'px-4 py-2 text-sm min-h-[40px]',
  };
  return (
    <button type="button" className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div
    className={cn(
      'rounded-xl border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827]',
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export const FieldLabel: React.FC<{ htmlFor?: string; required?: boolean; children: React.ReactNode }> = ({
  htmlFor,
  required,
  children,
}) => (
  <label
    htmlFor={htmlFor}
    className="block text-xs font-medium text-[#151922] dark:text-gray-200 mb-1.5"
  >
    {children}
    {required && <span className="text-[#DC4545] ml-0.5">*</span>}
  </label>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] px-3 py-2 text-sm text-[#151922] dark:text-gray-100 placeholder:text-[#7A8290] focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-h-[40px]',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] px-3 py-2 text-sm text-[#151922] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-h-[40px]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] px-3 py-2 text-sm text-[#151922] dark:text-gray-100 placeholder:text-[#7A8290] focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, maxWidth = 'max-w-2xl', children }) => {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
    >
      <div
        className={cn(
          'w-full rounded-xl border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] shadow-lg max-h-[90vh] flex flex-col',
          maxWidth
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7EAF0] dark:border-gray-800 shrink-0">
          <h2 className="text-base font-semibold text-[#151922] dark:text-gray-100 font-display">{title}</h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7A8290] hover:text-[#151922] dark:hover:text-white hover:bg-[#F6F7F9] dark:hover:bg-gray-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
}> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
}) => {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <p className="text-sm text-[#7A8290] dark:text-gray-300 leading-relaxed">{message}</p>
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel || t('common.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
          {confirmLabel || t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
};

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-6">
    {icon && <div className="mb-3 text-[#7A8290]">{icon}</div>}
    <h3 className="text-base font-semibold text-[#151922] dark:text-gray-100 font-display">{title}</h3>
    <p className="mt-1 text-sm text-[#7A8290] max-w-md">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-3 p-5" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-10 rounded-lg bg-[#F0F2F6] dark:bg-gray-800 animate-pulse"
      />
    ))}
  </div>
);

/**
 * Semantic status text without pill-badge clutter (Zero-Pill discipline).
 */
export const StatusLabel: React.FC<{ tone: 'blue' | 'green' | 'amber' | 'red' | 'neutral'; label: string }> = ({
  tone,
  label,
}) => {
  const colors = {
    blue: 'text-[#2563EB]',
    green: 'text-[#16A36A]',
    amber: 'text-[#D97706]',
    red: 'text-[#DC4545]',
    neutral: 'text-[#7A8290]',
  };
  return <span className={cn('text-xs font-medium whitespace-nowrap', colors[tone])}>{label}</span>;
};

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const { t } = useI18n();
  const [showIOS, setShowIOS] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <Button variant="secondary" size="sm" onClick={install}>
        <Download className="w-3.5 h-3.5" />
        {t('pwa.installApp')}
      </Button>
    );
  }

  if (isIOS) {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={() => setShowIOS(true)}>
          <Download className="w-3.5 h-3.5" />
          {t('pwa.installIos')}
        </Button>
        <Modal open={showIOS} onClose={() => setShowIOS(false)} title={t('pwa.iosTitle')} maxWidth="max-w-sm">
          <p className="text-sm text-[#7A8290] leading-relaxed">
            1. {t('pwa.iosStep1')}
            <br />
            2. {t('pwa.iosStep2')}
          </p>
        </Modal>
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const online = useOnlineStatus();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-[#F59E0B] px-3 py-2 text-xs font-medium text-white shadow">
      <WifiOff className="w-3.5 h-3.5" />
      {t('pwa.offline')}
    </div>
  );
};

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message };
  }

  render() {
    if (this.state.hasError) {
      let lang: Language = 'fr';
      try {
        const saved = localStorage.getItem('hexavo_lang');
        if (saved === 'fr' || saved === 'ru' || saved === 'en') lang = saved;
      } catch {
        // ignore
      }
      const dict = TRANSLATIONS[lang];
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9] p-6">
          <Card className="max-w-md w-full p-6 text-center">
            <AlertCircle className="w-8 h-8 text-[#DC4545] mx-auto mb-3" />
            <h2 className="text-base font-semibold text-[#151922] font-display">
              {dict['err.displayTitle']}
            </h2>
            <p className="mt-2 text-sm text-[#7A8290]">{this.state.errorMsg}</p>
            <Button className="mt-5" onClick={() => window.location.reload()}>
              {dict['err.reloadApp']}
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
