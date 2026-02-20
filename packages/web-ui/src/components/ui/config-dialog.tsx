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
      if (event.key === 'Escape') {
        onClose();
      }
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
    <>
      <style>{`
        .cfg-dialog-overlay {
          position: fixed;
          inset: 0;
          z-index: 350;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(2, 3, 8, 0.78);
          backdrop-filter: blur(8px);
        }

        .cfg-dialog-panel {
          width: min(1080px, calc(100vw - 40px));
          max-height: min(860px, calc(100vh - 40px));
          border-radius: 16px;
          border: 1px solid rgba(56, 189, 248, 0.22);
          background: linear-gradient(155deg, rgba(11, 14, 24, 0.98), rgba(7, 10, 18, 0.98));
          box-shadow: 0 26px 70px rgba(0, 0, 0, 0.55);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .cfg-dialog-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(56, 189, 248, 0.14);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .cfg-dialog-title-wrap {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .cfg-dialog-title {
          margin: 0;
          color: var(--color-text-bright);
          font-family: var(--font-display);
          font-size: 15px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          line-height: 1.25;
        }

        .cfg-dialog-subtitle {
          margin: 0;
          color: var(--color-text-normal);
          font-family: var(--font-ui);
          font-size: 13px;
          line-height: 1.5;
        }

        .cfg-dialog-header-close {
          min-width: unset;
          min-height: unset;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: var(--color-text-normal);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }

        .cfg-dialog-header-close:hover {
          border-color: rgba(56, 189, 248, 0.45);
          color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.08);
        }

        .cfg-dialog-body {
          padding: 20px 24px;
          overflow-y: auto;
          display: grid;
          gap: 14px;
          align-content: start;
        }

        .cfg-dialog-footer {
          padding: 14px 24px 18px;
          border-top: 1px solid rgba(56, 189, 248, 0.14);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .cfg-dialog-status {
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.5;
          color: var(--color-text-ghost);
        }

        .cfg-dialog-status.success {
          color: var(--color-emerald);
        }

        .cfg-dialog-status.error {
          color: var(--color-rose);
        }

        .cfg-dialog-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .cfg-dialog-btn {
          min-height: unset;
          min-width: unset;
          border-radius: 9px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          padding: 9px 14px;
          color: var(--color-text-normal);
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 0.02em;
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease, opacity 0.2s ease;
        }

        .cfg-dialog-btn:hover:not(:disabled) {
          border-color: rgba(56, 189, 248, 0.45);
          color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.08);
        }

        .cfg-dialog-btn.primary {
          border-color: rgba(56, 189, 248, 0.5);
          color: var(--color-cyan);
          background: rgba(56, 189, 248, 0.14);
        }

        .cfg-dialog-btn.primary:hover:not(:disabled) {
          border-color: rgba(56, 189, 248, 0.78);
          background: rgba(56, 189, 248, 0.2);
        }

        .cfg-dialog-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cfg-section {
          border: 1px solid rgba(56, 189, 248, 0.12);
          border-radius: 12px;
          padding: 14px;
          background: rgba(255, 255, 255, 0.02);
          display: grid;
          gap: 10px;
        }

        .cfg-section-title {
          margin: 0;
          color: var(--color-text-bright);
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          line-height: 1.3;
        }

        .cfg-section-description {
          margin: 0;
          color: var(--color-text-dim);
          font-family: var(--font-ui);
          font-size: 12px;
          line-height: 1.5;
        }

        .cfg-section-grid {
          display: grid;
          gap: 12px;
          align-items: start;
        }

        .cfg-field {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .cfg-field.full-width {
          grid-column: 1 / -1;
        }

        .cfg-field-label {
          color: var(--color-text-normal);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          line-height: 1.3;
        }

        .cfg-field-hint {
          color: var(--color-text-ghost);
          font-family: var(--font-ui);
          font-size: 11px;
          line-height: 1.4;
        }

        .cfg-field-control > select,
        .cfg-field-control > input,
        .cfg-field-control > textarea {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 8px;
          background: rgba(10, 12, 20, 0.92);
          color: var(--color-text-bright);
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.4;
          padding: 10px 11px;
        }

        .cfg-field-control > textarea {
          resize: vertical;
          min-height: 78px;
        }

        .cfg-field-control > select:focus,
        .cfg-field-control > input:focus,
        .cfg-field-control > textarea:focus {
          outline: 2px solid rgba(56, 189, 248, 0.3);
          border-color: rgba(56, 189, 248, 0.55);
          outline-offset: 1px;
        }

        .cfg-note {
          margin: 0;
          color: var(--color-text-ghost);
          font-family: var(--font-ui);
          font-size: 12px;
          line-height: 1.5;
        }

        .cfg-key-value {
          margin: 0;
          color: var(--color-text-ghost);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
        }

        @media (max-width: 980px) {
          .cfg-dialog-overlay {
            padding: 12px;
          }

          .cfg-dialog-panel {
            width: 100%;
            max-height: calc(100vh - 24px);
          }

          .cfg-dialog-header,
          .cfg-dialog-body,
          .cfg-dialog-footer {
            padding-left: 14px;
            padding-right: 14px;
          }

          .cfg-section-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }

        @media (max-width: 720px) {
          .cfg-dialog-header {
            padding-top: 14px;
            padding-bottom: 12px;
          }

          .cfg-dialog-title {
            font-size: 13px;
            letter-spacing: 0.08em;
          }

          .cfg-dialog-subtitle,
          .cfg-dialog-status,
          .cfg-note {
            font-size: 11px;
          }

          .cfg-dialog-footer {
            flex-direction: column;
            align-items: stretch;
          }

          .cfg-dialog-actions {
            width: 100%;
            justify-content: flex-end;
          }
        }
      `}</style>

      <div className="cfg-dialog-overlay" onClick={onClose}>
        <div
          className="cfg-dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="cfg-dialog-header">
            <div className="cfg-dialog-title-wrap">
              <h2 className="cfg-dialog-title">{title}</h2>
              {subtitle ? <p className="cfg-dialog-subtitle">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              className="cfg-dialog-header-close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              {closeLabel}
            </button>
          </header>

          <div className="cfg-dialog-body">{children}</div>

          <footer className="cfg-dialog-footer">
            <div className={`cfg-dialog-status ${statusTone === 'error' ? 'error' : statusTone === 'success' ? 'success' : ''}`}>
              {statusText || ' '}
            </div>
            <div className="cfg-dialog-actions">
              <button type="button" className="cfg-dialog-btn" onClick={onClose}>
                {closeLabel}
              </button>
              {onSave ? (
                <button
                  type="button"
                  className="cfg-dialog-btn primary"
                  onClick={onSave}
                  disabled={saveDisabled || saving}
                >
                  {saving ? 'Saving...' : saveLabel}
                </button>
              ) : null}
            </div>
          </footer>
        </div>
      </div>
    </>,
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
    <section className="cfg-section">
      <h3 className="cfg-section-title">{title}</h3>
      {description ? <p className="cfg-section-description">{description}</p> : null}
      <div className="cfg-section-grid" style={{ gridTemplateColumns: sectionGrid(columns) }}>
        {children}
      </div>
    </section>
  );
}

export function ConfigField({ label, hint, fullWidth = false, children }: ConfigFieldProps) {
  return (
    <label className={`cfg-field ${fullWidth ? 'full-width' : ''}`}>
      <span className="cfg-field-label">{label}</span>
      {hint ? <span className="cfg-field-hint">{hint}</span> : null}
      <div className="cfg-field-control">{children}</div>
    </label>
  );
}
