// ═══════════════════════════════════════════════════════════════════════════
// Toast Overlay - Process completion/error notifications
//
// Positioned at top-right of the stage container. Toasts auto-dismiss
// after 8 seconds. Click a toast to focus its session.
// ═══════════════════════════════════════════════════════════════════════════

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
      className={`toast-card ${isError ? 'is-error' : 'is-completed'}`}
      onClick={() => onFocus(toast.sessionId)}
      initial={{ opacity: 0, y: -12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="toast-icon">
        {isError ? '\u2717' : '\u2713'}
      </div>
      <div className="toast-body">
        <div className="toast-name">{toast.sessionName}</div>
        <div className="toast-summary">{toast.summary}</div>
      </div>
      <button
        className="toast-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
      >
        \u00d7
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
    <div className="toast-container">
      <style>{`
        .toast-container {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 50;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          max-width: 340px;
        }

        .toast-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          background: rgba(5, 5, 10, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          cursor: pointer;
          pointer-events: auto;
          transition: border-color 0.15s ease, background 0.15s ease;
        }

        .toast-card:hover {
          background: rgba(5, 5, 10, 0.95);
          border-color: rgba(255, 255, 255, 0.12);
        }

        .toast-card.is-completed {
          border-color: rgba(52, 211, 153, 0.2);
        }

        .toast-card.is-error {
          border-color: rgba(244, 63, 94, 0.2);
        }

        .toast-icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .toast-card.is-completed .toast-icon {
          background: rgba(52, 211, 153, 0.15);
          color: var(--color-emerald);
          box-shadow: 0 0 8px rgba(52, 211, 153, 0.2);
        }

        .toast-card.is-error .toast-icon {
          background: rgba(244, 63, 94, 0.15);
          color: var(--color-rose);
          box-shadow: 0 0 8px rgba(244, 63, 94, 0.2);
        }

        .toast-body {
          flex: 1;
          min-width: 0;
        }

        .toast-name {
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-bright);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .toast-summary {
          font-family: var(--font-ui);
          font-size: 11px;
          font-weight: 400;
          color: var(--color-text-dim);
          margin-top: 2px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .toast-dismiss {
          width: 20px;
          height: 20px;
          min-height: 20px;
          min-width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: var(--color-text-ghost);
          font-size: 14px;
          cursor: pointer;
          flex-shrink: 0;
          transition: color 0.15s ease, background 0.15s ease;
        }

        .toast-dismiss:hover {
          color: var(--color-text-normal);
          background: rgba(255, 255, 255, 0.06);
        }
      `}</style>

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
