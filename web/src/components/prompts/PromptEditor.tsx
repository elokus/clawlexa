// ═══════════════════════════════════════════════════════════════════════════
// Prompt Editor - Toolbar + Markdown Textarea
// Features: version dropdown, save as new version, set as active, dirty indicator
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';

export function PromptEditor() {
  const selectVersion = useUnifiedSessionsStore((s) => s.selectVersion);
  const setPromptContent = useUnifiedSessionsStore((s) => s.setPromptContent);
  const savePromptVersion = useUnifiedSessionsStore((s) => s.savePromptVersion);
  const setPromptActiveVersion = useUnifiedSessionsStore((s) => s.setPromptActiveVersion);

  const {
    prompts,
    selectedPromptId,
    selectedVersion,
    promptContent,
    promptVersions,
    promptsLoading,
    promptsError,
    promptDirty,
  } = usePromptsState();

  // Get selected prompt info
  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId),
    [prompts, selectedPromptId]
  );

  // Check if selected version is active
  const isActiveVersion = selectedPrompt?.activeVersion === selectedVersion;

  const handleVersionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      selectVersion(e.target.value);
    },
    [selectVersion]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPromptContent(e.target.value);
    },
    [setPromptContent]
  );

  const handleSave = useCallback(() => {
    savePromptVersion();
  }, [savePromptVersion]);

  const handleSetActive = useCallback(() => {
    if (selectedVersion) {
      setPromptActiveVersion(selectedVersion);
    }
  }, [selectedVersion, setPromptActiveVersion]);

  return (
    <div className="prompt-editor">
      <style>{`
        .prompt-editor {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .prompt-editor-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-glass-border);
          background: rgba(3, 3, 8, 0.4);
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .prompt-editor-title {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-normal);
          flex: 1;
          min-width: 100px;
        }

        .prompt-editor-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .prompt-version-select {
          padding: 6px 10px;
          background: rgba(10, 10, 15, 0.8);
          border: 1px solid var(--color-glass-border);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-normal);
          cursor: pointer;
          outline: none;
          min-width: 80px;
        }

        .prompt-version-select:hover {
          border-color: var(--color-cyan-dim);
        }

        .prompt-version-select:focus {
          border-color: var(--color-cyan);
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.1);
        }

        .prompt-version-select option {
          background: var(--color-abyss);
          color: var(--color-text-normal);
        }

        .prompt-editor-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          color: var(--color-cyan);
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .prompt-editor-btn:hover:not(:disabled) {
          background: rgba(56, 189, 248, 0.15);
          border-color: var(--color-cyan);
        }

        .prompt-editor-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .prompt-editor-btn.primary {
          background: rgba(56, 189, 248, 0.2);
          border-color: var(--color-cyan);
        }

        .prompt-editor-btn.success {
          background: rgba(52, 211, 153, 0.1);
          border-color: rgba(52, 211, 153, 0.3);
          color: var(--color-emerald);
        }

        .prompt-editor-btn.success:hover:not(:disabled) {
          background: rgba(52, 211, 153, 0.15);
          border-color: var(--color-emerald);
        }

        .prompt-dirty-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-amber);
        }

        .prompt-dirty-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-amber);
        }

        .prompt-active-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: rgba(52, 211, 153, 0.1);
          border: 1px solid rgba(52, 211, 153, 0.3);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-emerald);
        }

        .prompt-editor-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 16px;
        }

        .prompt-editor-textarea {
          flex: 1;
          width: 100%;
          padding: 16px;
          background: rgba(10, 10, 15, 0.6);
          border: 1px solid var(--color-glass-border);
          border-radius: 8px;
          font-family: var(--font-mono);
          font-size: 13px;
          line-height: 1.6;
          color: var(--color-text-normal);
          resize: none;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .prompt-editor-textarea:hover {
          border-color: var(--color-cyan-dim);
        }

        .prompt-editor-textarea:focus {
          border-color: var(--color-cyan);
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.1);
        }

        .prompt-editor-textarea::placeholder {
          color: var(--color-text-ghost);
        }

        .prompt-editor-textarea::-webkit-scrollbar {
          width: 8px;
        }

        .prompt-editor-textarea::-webkit-scrollbar-track {
          background: transparent;
        }

        .prompt-editor-textarea::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.2);
          border-radius: 4px;
        }

        .prompt-editor-textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(56, 189, 248, 0.3);
        }

        .prompt-editor-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-dim);
        }

        .prompt-editor-error {
          padding: 12px 16px;
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.3);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-rose);
          margin: 16px;
        }
      `}</style>

      {/* Toolbar */}
      <div className="prompt-editor-toolbar">
        <span className="prompt-editor-title">{selectedPrompt?.name || 'Prompt'}</span>

        <div className="prompt-editor-controls">
          {/* Dirty indicator */}
          {promptDirty && (
            <motion.div
              className="prompt-dirty-indicator"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span className="prompt-dirty-dot" />
              <span>Unsaved</span>
            </motion.div>
          )}

          {/* Active version badge */}
          {isActiveVersion && (
            <div className="prompt-active-badge">Active</div>
          )}

          {/* Version dropdown */}
          <select
            className="prompt-version-select"
            value={selectedVersion || ''}
            onChange={handleVersionChange}
            disabled={promptsLoading}
          >
            {promptVersions.map((version) => (
              <option key={version} value={version}>
                {version}
                {selectedPrompt?.activeVersion === version ? ' (active)' : ''}
              </option>
            ))}
          </select>

          {/* Save as new version */}
          <button
            className="prompt-editor-btn primary"
            onClick={handleSave}
            disabled={promptsLoading || !promptDirty}
          >
            Save as New
          </button>

          {/* Set as active */}
          <button
            className="prompt-editor-btn success"
            onClick={handleSetActive}
            disabled={promptsLoading || isActiveVersion}
          >
            Set Active
          </button>
        </div>
      </div>

      {/* Error message */}
      {promptsError && (
        <div className="prompt-editor-error">{promptsError}</div>
      )}

      {/* Content area */}
      <div className="prompt-editor-content">
        {promptsLoading && !promptContent ? (
          <div className="prompt-editor-loading">Loading...</div>
        ) : (
          <textarea
            className="prompt-editor-textarea"
            value={promptContent}
            onChange={handleContentChange}
            placeholder="Enter prompt content in markdown..."
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
