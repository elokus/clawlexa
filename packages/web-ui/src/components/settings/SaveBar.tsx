// ═══════════════════════════════════════════════════════════════════════════
// Save Bar - Sticky bottom bar with save/discard and dirty indicator
// ═══════════════════════════════════════════════════════════════════════════

import { useConfigStore } from '../../stores/config-store';

export function SaveBar() {
  const isDirty = useConfigStore((s) => s.isDirty);
  const isAuthDirty = useConfigStore((s) => s.isAuthDirty);
  const saving = useConfigStore((s) => s.saving);
  const authSaving = useConfigStore((s) => s.authSaving);
  const configError = useConfigStore((s) => s.configError);
  const authError = useConfigStore((s) => s.authError);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const discardConfig = useConfigStore((s) => s.discardConfig);
  const saveAuth = useConfigStore((s) => s.saveAuth);
  const discardAuth = useConfigStore((s) => s.discardAuth);

  const anyDirty = isDirty || isAuthDirty;
  const anySaving = saving || authSaving;
  const error = configError || authError;

  const handleSave = async () => {
    if (isDirty) await saveConfig();
    if (isAuthDirty) await saveAuth();
  };

  const handleDiscard = () => {
    if (isDirty) discardConfig();
    if (isAuthDirty) discardAuth();
  };

  return (
    <div className={`save-bar ${anyDirty ? 'dirty' : ''}`}>
      <style>{`
        .save-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px;
          background: rgba(5, 5, 10, 0.95);
          border-top: 1px solid var(--color-glass-border);
          backdrop-filter: blur(12px);
          flex-shrink: 0;
          min-height: 48px;
          transition: border-color 0.2s ease;
        }

        .save-bar.dirty {
          border-color: rgba(56, 189, 248, 0.2);
        }

        .save-bar-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .save-bar-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-text-ghost);
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .save-bar.dirty .save-bar-dot {
          background: var(--color-amber);
          box-shadow: 0 0 6px var(--color-amber);
        }

        .save-bar-text {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .save-bar-error {
          color: var(--color-rose);
        }

        .save-bar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .save-bar-btn {
          padding: 6px 16px;
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid transparent;
          background: none;
        }

        .save-bar-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .save-bar-btn.discard {
          color: var(--color-text-dim);
          border-color: rgba(255, 255, 255, 0.08);
        }

        .save-bar-btn.discard:hover:not(:disabled) {
          border-color: rgba(255, 255, 255, 0.15);
          color: var(--color-text-normal);
        }

        .save-bar-btn.save {
          background: rgba(56, 189, 248, 0.12);
          border-color: rgba(56, 189, 248, 0.25);
          color: var(--color-cyan);
        }

        .save-bar-btn.save:hover:not(:disabled) {
          background: rgba(56, 189, 248, 0.2);
          border-color: rgba(56, 189, 248, 0.4);
        }
      `}</style>

      <div className="save-bar-left">
        <span className="save-bar-dot" />
        <span className={`save-bar-text ${error ? 'save-bar-error' : ''}`}>
          {error
            ? error
            : anyDirty
              ? 'Unsaved changes'
              : 'Settings apply to the next voice session'}
        </span>
      </div>

      <div className="save-bar-actions">
        <button
          type="button"
          className="save-bar-btn discard"
          disabled={!anyDirty || anySaving}
          onClick={handleDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          className="save-bar-btn save"
          disabled={!anyDirty || anySaving}
          onClick={() => void handleSave()}
        >
          {anySaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
