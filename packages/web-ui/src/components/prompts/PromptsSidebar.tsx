// ═══════════════════════════════════════════════════════════════════════════
// Prompts Sidebar - Prompt list grouped by type (Voice / Subagent)
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import type { PromptInfo } from '../../lib/prompts-api';

interface PromptGroupProps {
  title: string;
  prompts: PromptInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function PromptGroup({ title, prompts, selectedId, onSelect }: PromptGroupProps) {
  if (prompts.length === 0) return null;

  return (
    <div className="prompt-group">
      <div className="prompt-group-header">{title}</div>
      <div className="prompt-group-list">
        {prompts.map((prompt) => (
          <motion.button
            key={prompt.id}
            className={`prompt-item ${selectedId === prompt.id ? 'selected' : ''}`}
            onClick={() => onSelect(prompt.id)}
            whileHover={{ x: 2 }}
            transition={{ duration: 0.1 }}
          >
            <div className="prompt-item-content">
              <span className="prompt-item-name">{prompt.name}</span>
              <span className="prompt-item-badge">{prompt.activeVersion}</span>
            </div>
            {prompt.description && (
              <span className="prompt-item-description">{prompt.description}</span>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export function PromptsSidebar() {
  const selectPrompt = useUnifiedSessionsStore((s) => s.selectPrompt);
  const { prompts, selectedPromptId, promptsLoading } = usePromptsState();

  // Group prompts by type
  const groupedPrompts = useMemo(() => {
    const voice: PromptInfo[] = [];
    const subagent: PromptInfo[] = [];

    for (const prompt of prompts) {
      if (prompt.type === 'voice') {
        voice.push(prompt);
      } else {
        subagent.push(prompt);
      }
    }

    return { voice, subagent };
  }, [prompts]);

  const handleSelect = (id: string) => {
    selectPrompt(id);
  };

  return (
    <div className="prompts-sidebar">
      <style>{`
        .prompts-sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .prompts-sidebar-header {
          padding: 16px 16px 12px 16px;
          border-bottom: 1px solid var(--color-glass-border);
          flex-shrink: 0;
        }

        .prompts-sidebar-title {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-text-dim);
        }

        .prompts-sidebar-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px 0;
        }

        .prompts-sidebar-content::-webkit-scrollbar {
          width: 4px;
        }

        .prompts-sidebar-content::-webkit-scrollbar-track {
          background: transparent;
        }

        .prompts-sidebar-content::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.2);
          border-radius: 2px;
        }

        .prompt-group {
          margin-bottom: 16px;
        }

        .prompt-group:last-child {
          margin-bottom: 0;
        }

        .prompt-group-header {
          padding: 4px 16px 8px 16px;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-ghost);
        }

        .prompt-group-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .prompt-item {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 10px 16px;
          background: transparent;
          border: none;
          border-left: 2px solid transparent;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
          width: 100%;
        }

        .prompt-item:hover {
          background: rgba(56, 189, 248, 0.05);
          border-left-color: rgba(56, 189, 248, 0.3);
        }

        .prompt-item.selected {
          background: rgba(56, 189, 248, 0.1);
          border-left-color: var(--color-cyan);
        }

        .prompt-item-content {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }

        .prompt-item-name {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-normal);
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .prompt-item.selected .prompt-item-name {
          color: var(--color-cyan);
        }

        .prompt-item-badge {
          padding: 2px 6px;
          background: rgba(56, 189, 248, 0.15);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-cyan-dim);
          flex-shrink: 0;
        }

        .prompt-item.selected .prompt-item-badge {
          background: rgba(56, 189, 248, 0.25);
          color: var(--color-cyan);
        }

        .prompt-item-description {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-ghost);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          width: 100%;
        }

        .prompts-sidebar-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--color-text-ghost);
        }
      `}</style>

      <div className="prompts-sidebar-header">
        <span className="prompts-sidebar-title">Prompts</span>
      </div>

      <div className="prompts-sidebar-content">
        {promptsLoading && prompts.length === 0 ? (
          <div className="prompts-sidebar-empty">Loading...</div>
        ) : prompts.length === 0 ? (
          <div className="prompts-sidebar-empty">No prompts found</div>
        ) : (
          <>
            <PromptGroup
              title="Voice Profiles"
              prompts={groupedPrompts.voice}
              selectedId={selectedPromptId}
              onSelect={handleSelect}
            />
            <PromptGroup
              title="Subagents"
              prompts={groupedPrompts.subagent}
              selectedId={selectedPromptId}
              onSelect={handleSelect}
            />
          </>
        )}
      </div>
    </div>
  );
}
