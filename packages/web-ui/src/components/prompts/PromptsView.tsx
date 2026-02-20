// ═══════════════════════════════════════════════════════════════════════════
// Prompts View - Main container for prompt management
// Two-panel layout: sidebar (280px) + editor (flex)
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import { PromptsSidebar } from './PromptsSidebar';
import { PromptEditor } from './PromptEditor';

const SIDEBAR_WIDTH = 280;

export function PromptsView() {
  const loadPrompts = useUnifiedSessionsStore((s) => s.loadPrompts);
  const { promptsLoading, promptsError, selectedPromptId } = usePromptsState();

  // Load prompts on mount
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  return (
    <div className="prompts-view">
      <style>{`
        .prompts-view {
          display: grid;
          grid-template-columns: ${SIDEBAR_WIDTH}px 1fr;
          height: 100%;
          gap: 0;
          overflow: hidden;
          background: var(--color-abyss);
          border-radius: 12px;
          border: 1px solid var(--color-glass-border);
        }

        .prompts-sidebar-container {
          height: 100%;
          overflow: hidden;
          border-right: 1px solid var(--color-glass-border);
          background: rgba(3, 3, 8, 0.4);
        }

        .prompts-editor-container {
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .prompts-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;
          color: var(--color-text-ghost);
        }

        .prompts-empty-icon {
          font-size: 48px;
          opacity: 0.5;
        }

        .prompts-empty-text {
          font-family: var(--font-mono);
          font-size: 13px;
        }

        .prompts-loading,
        .prompts-error {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-family: var(--font-mono);
          font-size: 12px;
        }

        .prompts-loading {
          color: var(--color-text-dim);
        }

        .prompts-error {
          color: var(--color-rose);
        }

        @media (max-width: 900px) {
          .prompts-view {
            grid-template-columns: 220px 1fr;
          }
        }

        @media (max-width: 700px) {
          .prompts-view {
            grid-template-columns: 1fr;
          }

          .prompts-sidebar-container {
            display: none;
          }
        }
      `}</style>

      {/* Sidebar - Prompt list */}
      <div className="prompts-sidebar-container">
        <PromptsSidebar />
      </div>

      {/* Editor - Main content area */}
      <div className="prompts-editor-container">
        {promptsLoading && !selectedPromptId ? (
          <div className="prompts-loading">Loading prompts...</div>
        ) : promptsError ? (
          <div className="prompts-error">{promptsError}</div>
        ) : selectedPromptId ? (
          <PromptEditor />
        ) : (
          <div className="prompts-empty-state">
            <span className="prompts-empty-icon">=</span>
            <span className="prompts-empty-text">Select a prompt to edit</span>
          </div>
        )}
      </div>
    </div>
  );
}
