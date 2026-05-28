import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'border-forge-green/40 bg-forge-green/10 text-forge-green',
  error: 'border-forge-red/40 bg-forge-red/10 text-forge-red',
  warning: 'border-forge-yellow/40 bg-forge-yellow/10 text-forge-yellow',
  info: 'border-forge-cyan/40 bg-forge-cyan/10 text-forge-cyan',
};

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3.5 rounded-xl border backdrop-blur-xl animate-slide-up ${colorMap[toast.type]}`}
          >
            <Icon size={18} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm flex-1">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
