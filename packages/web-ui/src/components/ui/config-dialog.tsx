import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type StatusTone = 'neutral' | 'success' | 'error';

export interface ConfigDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  statusText?: string;
  statusTone?: StatusTone;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  closeLabel?: string;
  onClose: () => void;
  onSave?: () => void;
  children: ReactNode;
}

interface ConfigSectionProps {
  title: string;
  description?: string;
  columns?: 1 | 2 | 3;
  children: ReactNode;
}

interface ConfigFieldProps {
  label: string;
  hint?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

function sectionGrid(columns: 1 | 2 | 3): string {
  if (columns === 1) return 'minmax(0, 1fr)';
  if (columns === 3) return 'repeat(3, minmax(0, 1fr))';
  return 'repeat(2, minmax(0, 1fr))';
}

export function ConfigDialog({
  open,
  title,
  subtitle,
  statusText,
  statusTone = 'neutral',
  saving = false,
  saveDisabled = false,
  saveLabel = 'Save',
  closeLabel = 'Close',
  onClose,
  onSave,
  children,
}: ConfigDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[350] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm max-sm:p-3"
      onClick={onClose}
    >
      <div
        className="w-[min(1080px,calc(100vw-40px))] max-h-[min(860px,calc(100vh-40px))] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden max-sm:w-full max-sm:max-h-[calc(100vh-24px)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between gap-4 max-sm:px-3.5">
          <div className="grid gap-1.5 min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle ? <p className="text-[13px] text-muted-foreground leading-relaxed">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-border text-muted-foreground font-mono text-[11px] tracking-wide hover:text-foreground hover:bg-accent transition-colors"
            onClick={onClose}
            aria-label={closeLabel}
          >
            {closeLabel}
          </button>
        </header>

        <div className="px-6 py-5 overflow-y-auto grid gap-3.5 content-start max-sm:px-3.5">{children}</div>

        <footer className="px-6 py-3.5 border-t border-border flex items-center justify-between gap-4 max-sm:px-3.5 max-sm:flex-col max-sm:items-stretch">
          <div className={`font-mono text-xs leading-relaxed ${
            statusTone === 'error' ? 'text-red-500' : statusTone === 'success' ? 'text-green-500' : 'text-muted-foreground'
          }`}>
            {statusText || '\u00a0'}
          </div>
          <div className="flex items-center gap-2.5 shrink-0 max-sm:w-full max-sm:justify-end">
            <button
              type="button"
              className="px-3.5 py-2 rounded-lg border border-border text-muted-foreground font-mono text-xs hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
            >
              {closeLabel}
            </button>
            {onSave ? (
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg border border-primary/50 bg-primary/10 text-primary font-mono text-xs hover:bg-primary/20 hover:border-primary/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={onSave}
                disabled={saveDisabled || saving}
              >
                {saving ? 'Saving...' : saveLabel}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export function ConfigSection({
  title,
  description,
  columns = 2,
  children,
}: ConfigSectionProps) {
  return (
    <section className="border border-border rounded-[10px] p-5 bg-card grid gap-3">
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      {description ? <p className="text-[12px] text-muted-foreground leading-relaxed">{description}</p> : null}
      <div className="grid gap-3 items-stretch max-sm:!grid-cols-1" style={{ gridTemplateColumns: sectionGrid(columns) }}>
        {children}
      </div>
    </section>
  );
}

export function ConfigField({ label, hint, fullWidth = false, children }: ConfigFieldProps) {
  return (
    <label className={`flex flex-col gap-1.5 min-w-0 ${fullWidth ? 'col-span-full' : ''}`}>
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      {hint ? <span className="text-[11px] text-muted-foreground leading-relaxed">{hint}</span> : null}
      <div className="cfg-control mt-auto">{children}</div>
    </label>
  );
}
