// ═══════════════════════════════════════════════════════════════════════════
// Settings: Agents - Voice agent profiles, prompts, wake words, tools
// Combines agent management + prompt editing in one unified view
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate } from '../../hooks/useRouter';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import { SettingsSection, SettingsField } from './SettingsSection';
import { AgentVoicePipeline } from './AgentVoicePipeline';
import {
  fetchPromptSettingsCatalog,
  type PromptInfo,
  type PromptSettingsCatalog,
} from '../../lib/prompts-api';

function AgentCard({
  agent,
  isSelected,
  onSelect,
}: {
  agent: PromptInfo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isVoice = agent.type === 'voice';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`agent-card ${isSelected ? 'selected' : ''} ${isVoice ? 'voice' : 'subagent'}`}
    >
      <div className="agent-card-icon">
        {isVoice ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        )}
      </div>
      <div className="agent-card-body">
        <div className="agent-card-name">{agent.name}</div>
        <div className="agent-card-meta">
          {agent.metadata?.wakeWord && (
            <span className="agent-card-tag">
              &ldquo;{agent.metadata.wakeWord}&rdquo;
            </span>
          )}
          <span className="agent-card-version">v{agent.activeVersion}</span>
        </div>
      </div>
      <div className={`agent-card-type ${agent.type}`}>
        {agent.type === 'voice' ? 'Voice' : 'Agent'}
      </div>
    </button>
  );
}

function AgentDetailEditor({
  agent,
  catalog,
}: {
  agent: PromptInfo;
  catalog: PromptSettingsCatalog | null;
}) {
  const selectVersion = useUnifiedSessionsStore((s) => s.selectVersion);
  const setPromptContent = useUnifiedSessionsStore((s) => s.setPromptContent);
  const savePromptVersion = useUnifiedSessionsStore((s) => s.savePromptVersion);
  const setPromptActiveVersion = useUnifiedSessionsStore((s) => s.setPromptActiveVersion);
  const updatePromptName = useUnifiedSessionsStore((s) => s.updatePromptName);
  const updatePromptMetadata = useUnifiedSessionsStore((s) => s.updatePromptMetadata);

  const {
    selectedVersion,
    promptContent,
    promptVersions,
    promptsLoading,
    promptDirty,
  } = usePromptsState();

  const [nameDraft, setNameDraft] = useState(agent.name);
  const [toolToAdd, setToolToAdd] = useState('');

  useEffect(() => {
    setNameDraft(agent.name);
  }, [agent.id, agent.name]);

  const isActiveVersion = agent.activeVersion === selectedVersion;
  const isVoice = agent.type === 'voice';

  const handleMetadataChange = useCallback(
    (key: string, value: string | string[]) => {
      const updated = { ...agent.metadata, [key]: value };
      void updatePromptMetadata(agent.id, updated);
    },
    [agent.id, agent.metadata, updatePromptMetadata]
  );

  const fallbackWakeWords = ['hey_jarvis', 'computer', 'hey_openclaw'];
  const wakeWordOptions = useMemo(() => {
    const values = new Set<string>(fallbackWakeWords);
    (catalog?.wakeWords ?? []).forEach((wakeWord) => {
      if (wakeWord) values.add(wakeWord);
    });
    if (agent.metadata?.wakeWord) {
      values.add(agent.metadata.wakeWord);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [catalog?.wakeWords, agent.metadata?.wakeWord]);

  const selectedTools = agent.metadata?.tools ?? [];
  const toolCatalog = useMemo(() => {
    const merged = new Map<string, { name: string; label: string; source: 'core' | 'manifest'; selectable: boolean }>();
    (catalog?.tools ?? []).forEach((tool) => {
      merged.set(tool.name, tool);
    });

    selectedTools.forEach((toolName) => {
      if (!merged.has(toolName)) {
        merged.set(toolName, {
          name: toolName,
          label: toolName,
          source: 'manifest',
          selectable: false,
        });
      }
    });

    return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog?.tools, selectedTools]);

  const selectableTools = useMemo(
    () => toolCatalog.filter((tool) => tool.selectable),
    [toolCatalog]
  );

  const addableTools = useMemo(
    () => selectableTools.filter((tool) => !selectedTools.includes(tool.name)),
    [selectableTools, selectedTools]
  );

  useEffect(() => {
    if (addableTools.length === 0) {
      setToolToAdd('');
      return;
    }
    if (!addableTools.some((tool) => tool.name === toolToAdd)) {
      setToolToAdd(addableTools[0]!.name);
    }
  }, [addableTools, toolToAdd]);

  const toolLabelByName = useMemo(
    () => new Map(toolCatalog.map((tool) => [tool.name, tool.label])),
    [toolCatalog]
  );

  const discoveredManifestTools = useMemo(
    () => toolCatalog.filter((tool) => tool.source === 'manifest'),
    [toolCatalog]
  );

  const commitName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(agent.name);
      return;
    }
    if (trimmed === agent.name) {
      return;
    }
    await updatePromptName(agent.id, trimmed);
  }, [agent.id, agent.name, nameDraft, updatePromptName]);

  const addTool = useCallback(() => {
    if (!toolToAdd) return;
    if (selectedTools.includes(toolToAdd)) return;
    handleMetadataChange('tools', [...selectedTools, toolToAdd]);
  }, [handleMetadataChange, selectedTools, toolToAdd]);

  const removeTool = useCallback(
    (toolName: string) => {
      handleMetadataChange('tools', selectedTools.filter((tool) => tool !== toolName));
    },
    [handleMetadataChange, selectedTools]
  );

  return (
    <div className="agent-detail">
      {/* Agent Properties */}
      <SettingsSection
        title="Profile"
        description={`Configure ${agent.name} profile metadata.`}
        columns={2}
      >
        <SettingsField label="Name" hint="Display name used in the UI.">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              void commitName();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
          />
        </SettingsField>

        {isVoice && (
          <SettingsField label="Wake Word" hint="Activation keyword used by the selected profile.">
            <select
              value={agent.metadata?.wakeWord ?? ''}
              onChange={(e) => handleMetadataChange('wakeWord', e.target.value)}
            >
              {wakeWordOptions.map((wakeWord) => (
                <option key={wakeWord} value={wakeWord}>
                  {wakeWord}
                </option>
              ))}
            </select>
          </SettingsField>
        )}
      </SettingsSection>

      {/* Tools */}
      <SettingsSection
        title="Tools"
        description="Select enabled tools for this profile. Add tools from catalog and remove them using chips."
        columns={1}
      >
        <SettingsField label="Tool Catalog" hint="Only core tools are selectable right now.">
          <div className="agent-tool-picker-row">
            <select
              value={toolToAdd}
              onChange={(e) => setToolToAdd(e.target.value)}
              disabled={addableTools.length === 0}
            >
              {addableTools.length === 0 ? (
                <option value="">No more tools to add</option>
              ) : (
                addableTools.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.label}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="agent-tool-btn"
              onClick={addTool}
              disabled={!toolToAdd}
            >
              Add Tool
            </button>
          </div>
        </SettingsField>

        <SettingsField label="Enabled Tools" hint="Click × on a chip to remove a tool.">
          {selectedTools.length > 0 ? (
            <div className="agent-tool-chip-list">
              {selectedTools.map((toolName) => (
                <span key={toolName} className="agent-tool-chip">
                  <span className="agent-tool-chip-label">{toolLabelByName.get(toolName) ?? toolName}</span>
                  <button
                    type="button"
                    className="agent-tool-chip-remove"
                    onClick={() => removeTool(toolName)}
                    aria-label={`Remove ${toolName}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="agent-tool-empty">No tools enabled for this profile.</div>
          )}
        </SettingsField>

        {discoveredManifestTools.length > 0 && (
          <div className="agent-tool-discovery-note">
            Discovered {discoveredManifestTools.length} manifest tool(s) from
            <code> .voiceclaw/tools/*/manifest.json</code>. Runtime execution wiring is not enabled yet.
          </div>
        )}

        <div className="agent-tool-actions">
          <button
            type="button"
            className="agent-tool-generator-btn"
            onClick={() => navigate('/settings/tool-generator')}
          >
            Open Tool Generator
          </button>
        </div>
      </SettingsSection>

      {/* Prompt Version Control */}
      <SettingsSection
        title="System Prompt"
        description="Edit the agent's system prompt. Save creates a new version."
        columns={1}
      >
        <div className="agent-prompt-toolbar">
          <select
            value={selectedVersion || ''}
            onChange={(e) => selectVersion(e.target.value)}
            disabled={promptsLoading}
          >
            {promptVersions.map((version) => (
              <option key={version} value={version}>
                v{version}{agent.activeVersion === version ? ' (active)' : ''}
              </option>
            ))}
          </select>

          {isActiveVersion && (
            <span className="agent-prompt-badge active">Active</span>
          )}
          {promptDirty && (
            <span className="agent-prompt-badge dirty">Modified</span>
          )}

          <div className="agent-prompt-actions">
            <button
              type="button"
              className="agent-prompt-btn save"
              onClick={() => savePromptVersion()}
              disabled={promptsLoading || !promptDirty}
            >
              Save New Version
            </button>
            <button
              type="button"
              className="agent-prompt-btn activate"
              onClick={() => selectedVersion && setPromptActiveVersion(selectedVersion)}
              disabled={promptsLoading || isActiveVersion}
            >
              Set Active
            </button>
          </div>
        </div>

        <textarea
          className="agent-prompt-editor"
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
          placeholder="Enter system prompt..."
          spellCheck={false}
        />
      </SettingsSection>

      {/* Voice Pipeline (voice agents only) */}
      {isVoice && <AgentVoicePipeline agentName={agent.name} />}
    </div>
  );
}

export function SettingsAgents() {
  const loadPrompts = useUnifiedSessionsStore((s) => s.loadPrompts);
  const selectPrompt = useUnifiedSessionsStore((s) => s.selectPrompt);
  const { prompts, selectedPromptId, promptsLoading, promptsError } = usePromptsState();

  const [filter, setFilter] = useState<'all' | 'voice' | 'subagent'>('all');
  const [settingsCatalog, setSettingsCatalog] = useState<PromptSettingsCatalog | null>(null);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    let cancelled = false;

    fetchPromptSettingsCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setSettingsCatalog(catalog);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsCatalog(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPrompts = useMemo(() => {
    if (filter === 'all') return prompts;
    return prompts.filter((p) => p.type === filter);
  }, [prompts, filter]);

  const selectedAgent = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId]
  );

  const handleSelect = useCallback(
    (id: string) => {
      void selectPrompt(id);
    },
    [selectPrompt]
  );

  if (promptsLoading && prompts.length === 0) {
    return <div className="settings-loading">Loading agents...</div>;
  }

  if (promptsError) {
    return (
      <SettingsSection title="Error" columns={1}>
        <div style={{ color: 'var(--color-red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {promptsError}
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      <style>{`
        .agent-filter-bar {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
          padding: 3px;
          background: var(--muted);
          border-radius: 8px;
          width: fit-content;
        }

        .agent-filter-btn {
          padding: 5px 14px;
          border-radius: 6px;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          color: var(--muted-foreground);
          cursor: pointer;
          transition: all 0.15s ease;
          background: none;
          border: none;
          min-height: auto;
          min-width: auto;
        }

        .agent-filter-btn:hover {
          color: var(--foreground);
        }

        .agent-filter-btn.active {
          background: var(--background);
          color: var(--foreground);
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .agent-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 10px;
          margin-bottom: 20px;
        }

        .agent-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--card);
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
          width: 100%;
          min-height: auto;
        }

        .agent-card:hover {
          border-color: var(--color-blue);
          background: color-mix(in oklch, var(--color-blue) 4%, var(--card));
        }

        .agent-card.selected {
          border-color: var(--color-blue);
          background: color-mix(in oklch, var(--color-blue) 8%, var(--card));
          box-shadow: 0 0 0 1px var(--color-blue);
        }

        .agent-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .agent-card.voice .agent-card-icon {
          background: var(--color-green-muted);
          color: var(--color-green);
        }

        .agent-card.subagent .agent-card-icon {
          background: var(--color-purple-muted);
          color: var(--color-purple);
        }

        .agent-card-body {
          flex: 1;
          min-width: 0;
        }

        .agent-card-name {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          color: var(--foreground);
          margin-bottom: 2px;
        }

        .agent-card-meta {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .agent-card-tag {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted-foreground);
        }

        .agent-card-version {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted-foreground);
          opacity: 0.7;
        }

        .agent-card-type {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 999px;
          flex-shrink: 0;
        }

        .agent-card-type.voice {
          background: var(--color-green-muted);
          color: var(--color-green);
        }

        .agent-card-type.subagent {
          background: var(--color-purple-muted);
          color: var(--color-purple);
        }

        .agent-detail {
          margin-top: 8px;
        }

        .agent-tool-picker-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
        }

        .agent-tool-btn,
        .agent-tool-generator-btn {
          min-height: auto;
          min-width: auto;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .agent-tool-btn:hover:not(:disabled),
        .agent-tool-generator-btn:hover {
          background: var(--accent);
        }

        .agent-tool-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .agent-tool-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .agent-tool-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          background: color-mix(in oklch, var(--color-blue) 12%, var(--muted));
          color: var(--foreground);
          border: 1px solid color-mix(in oklch, var(--color-blue) 30%, transparent);
          padding: 4px 8px;
        }

        .agent-tool-chip-label {
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
        }

        .agent-tool-chip-remove {
          min-height: auto;
          min-width: auto;
          border: none;
          background: transparent;
          color: var(--muted-foreground);
          font-size: 14px;
          line-height: 1;
          padding: 0;
          cursor: pointer;
        }

        .agent-tool-chip-remove:hover {
          color: var(--foreground);
        }

        .agent-tool-empty {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--muted-foreground);
        }

        .agent-tool-discovery-note {
          font-family: var(--font-sans);
          font-size: 11px;
          line-height: 1.5;
          color: var(--muted-foreground);
          background: color-mix(in oklch, var(--muted) 50%, transparent);
          border: 1px dashed var(--border);
          border-radius: 6px;
          padding: 10px 12px;
        }

        .agent-tool-discovery-note code {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--foreground);
        }

        .agent-tool-actions {
          display: flex;
          justify-content: flex-start;
        }

        .agent-tool-generator-btn {
          background: var(--color-blue-muted);
          color: var(--color-blue);
          border-color: color-mix(in oklch, var(--color-blue) 30%, transparent);
        }

        .agent-prompt-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        .agent-prompt-toolbar select {
          padding: 6px 10px;
          background: var(--input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--foreground);
          font-family: var(--font-mono);
          font-size: 12px;
          cursor: pointer;
        }

        .agent-prompt-badge {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 4px;
        }

        .agent-prompt-badge.active {
          background: var(--color-green-muted);
          color: var(--color-green);
        }

        .agent-prompt-badge.dirty {
          background: var(--color-orange-muted);
          color: var(--color-orange);
        }

        .agent-prompt-actions {
          margin-left: auto;
          display: flex;
          gap: 6px;
        }

        .agent-prompt-btn {
          padding: 6px 12px;
          border-radius: 6px;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--foreground);
          min-height: auto;
          min-width: auto;
        }

        .agent-prompt-btn:hover:not(:disabled) {
          background: var(--accent);
        }

        .agent-prompt-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .agent-prompt-btn.save {
          background: var(--color-blue-muted);
          color: var(--color-blue);
          border-color: color-mix(in oklch, var(--color-blue) 30%, transparent);
        }

        .agent-prompt-btn.save:hover:not(:disabled) {
          background: color-mix(in oklch, var(--color-blue) 15%, transparent);
        }

        .agent-prompt-btn.activate {
          background: var(--color-green-muted);
          color: var(--color-green);
          border-color: color-mix(in oklch, var(--color-green) 30%, transparent);
        }

        .agent-prompt-btn.activate:hover:not(:disabled) {
          background: color-mix(in oklch, var(--color-green) 15%, transparent);
        }

        .agent-prompt-editor {
          width: 100%;
          min-height: 280px;
          padding: 14px 16px;
          background: var(--input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--foreground);
          font-family: var(--font-mono);
          font-size: 13px;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .agent-prompt-editor:focus {
          border-color: var(--color-blue);
          box-shadow: 0 0 0 1px var(--color-blue);
        }

        .agent-empty {
          text-align: center;
          padding: 40px 20px;
          color: var(--muted-foreground);
          font-size: 13px;
        }

        .agent-empty-icon {
          font-size: 32px;
          opacity: 0.3;
          margin-bottom: 12px;
        }

        @media (max-width: 700px) {
          .agent-tool-picker-row {
            grid-template-columns: 1fr;
          }

          .agent-prompt-actions {
            margin-left: 0;
          }
        }
      `}</style>

      {/* Filter tabs */}
      <div className="agent-filter-bar">
        {(['all', 'voice', 'subagent'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`agent-filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'voice' ? 'Voice Agents' : 'Subagents'}
          </button>
        ))}
      </div>

      {/* Agent cards */}
      {filteredPrompts.length > 0 ? (
        <div className="agent-cards-grid">
          {filteredPrompts.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedPromptId === agent.id}
              onSelect={() => handleSelect(agent.id)}
            />
          ))}
        </div>
      ) : (
        <div className="agent-empty">
          <div className="agent-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </div>
          No agents found. Add agent prompts to the prompts directory.
        </div>
      )}

      {/* Selected agent detail */}
      {selectedAgent && <AgentDetailEditor agent={selectedAgent} catalog={settingsCatalog} />}
    </>
  );
}
