import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface ToastItem {
  id: string;
  sessionName: string;
  sessionId: string;
  status: 'completed' | 'error';
  summary: string;
  timestamp: number;
}

const AUTO_DISMISS_MS = 8000;

function ToastCard({
  toast,
  onDismiss,
  onFocus,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onFocus: (sessionId: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, onDismiss]);

  const isError = toast.status === 'error';

  return (
    <motion.div
      className={`flex items-start gap-2.5 px-3.5 py-3 bg-card border rounded-xl cursor-pointer pointer-events-auto shadow-lg transition-colors hover:bg-accent/50 ${
        isError ? 'border-red-500/20' : 'border-green-500/20'
      }`}
      onClick={() => onFocus(toast.sessionId)}
      initial={{ opacity: 0, y: -12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${
        isError
          ? 'bg-red-500/15 text-red-500'
          : 'bg-green-500/15 text-green-500'
      }`}>
        {isError ? '✗' : '✓'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-foreground truncate">{toast.sessionName}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{toast.summary}</div>
      </div>
      <button
        className="w-5 h-5 min-h-5 min-w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 text-sm"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
      >
        ×
      </button>
    </motion.div>
  );
}

export function ToastOverlay({
  toasts,
  dismissToast,
  focusSession,
}: {
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
  focusSession: (sessionId: string) => void;
}) {
  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-[340px]">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
            onFocus={focusSession}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
