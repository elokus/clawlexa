import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import { ModelPicker } from './ModelPicker';

export function PromptEditor() {
  const selectVersion = useUnifiedSessionsStore((s) => s.selectVersion);
  const setPromptContent = useUnifiedSessionsStore((s) => s.setPromptContent);
  const savePromptVersion = useUnifiedSessionsStore((s) => s.savePromptVersion);
  const setPromptActiveVersion = useUnifiedSessionsStore((s) => s.setPromptActiveVersion);
  const updatePromptMetadata = useUnifiedSessionsStore((s) => s.updatePromptMetadata);

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

  const [configDirty, setConfigDirty] = useState(false);
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [localMaxSteps, setLocalMaxSteps] = useState<number | null>(null);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId),
    [prompts, selectedPromptId]
  );

  const isActiveVersion = selectedPrompt?.activeVersion === selectedVersion;

  const effectiveModel = localModel ?? selectedPrompt?.metadata?.model ?? '';
  const effectiveMaxSteps = localMaxSteps ?? selectedPrompt?.metadata?.maxSteps ?? 3;

  useMemo(() => {
    setLocalModel(null);
    setLocalMaxSteps(null);
    setConfigDirty(false);
  }, [selectedPromptId]);

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

  const handleModelChange = useCallback((modelId: string) => {
    setLocalModel(modelId);
    setConfigDirty(true);
  }, []);

  const handleMaxStepsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      setLocalMaxSteps(val);
      setConfigDirty(true);
    }
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!selectedPromptId) return;
    const metadata: Record<string, unknown> = {};
    if (localModel !== null) metadata.model = localModel;
    if (localMaxSteps !== null) metadata.maxSteps = localMaxSteps;
    await updatePromptMetadata(selectedPromptId, metadata as { model?: string; maxSteps?: number });
    setConfigDirty(false);
    setLocalModel(null);
    setLocalMaxSteps(null);
  }, [selectedPromptId, localModel, localMaxSteps, updatePromptMetadata]);

  const isSubagent = selectedPrompt?.type === 'subagent';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30 shrink-0 flex-wrap">
        <span className="font-mono text-sm font-semibold text-foreground flex-1 min-w-[100px]">
          {selectedPrompt?.name || 'Prompt'}
        </span>

        <div className="flex items-center gap-2">
          {promptDirty && (
            <motion.div
              className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded text-[10px] font-mono text-orange-500"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              <span>Unsaved</span>
            </motion.div>
          )}

          {isActiveVersion && (
            <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 border border-green-500/30 rounded text-[10px] font-mono text-green-500">
              Active
            </div>
          )}

          <select
            className="px-2.5 py-1.5 bg-background border border-border rounded-md font-mono text-xs text-foreground cursor-pointer min-w-[80px] focus:outline-2 focus:outline-ring focus:outline-offset-1 focus:border-ring"
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

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 border border-primary/40 rounded-md font-mono text-[11px] font-medium text-primary cursor-pointer hover:bg-primary/25 hover:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            onClick={handleSave}
            disabled={promptsLoading || !promptDirty}
          >
            Save as New
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-md font-mono text-[11px] font-medium text-green-500 cursor-pointer hover:bg-green-500/15 hover:border-green-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            onClick={handleSetActive}
            disabled={promptsLoading || isActiveVersion}
          >
            Set Active
          </button>
        </div>
      </div>

      {/* Agent Config - only for subagent prompts */}
      {isSubagent && (
        <div className="px-4 py-3 border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Agent Config
            </span>
            {configDirty && (
              <motion.div
                className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded text-[10px] font-mono text-orange-500"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                <span>Unsaved</span>
              </motion.div>
            )}
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">Model</span>
              <ModelPicker
                value={effectiveModel}
                onChange={handleModelChange}
                disabled={promptsLoading}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">Max Steps</span>
              <input
                type="number"
                className="w-[60px] px-2.5 py-2 bg-background border border-border rounded-md font-mono text-xs text-foreground text-center focus:outline-2 focus:outline-ring focus:outline-offset-1 focus:border-ring"
                value={effectiveMaxSteps}
                onChange={handleMaxStepsChange}
                min={1}
                max={20}
                disabled={promptsLoading}
              />
            </div>
            <div className="shrink-0">
              <button
                className="flex items-center gap-1.5 px-3 py-2 bg-primary/15 border border-primary/40 rounded-md font-mono text-[11px] font-medium text-primary cursor-pointer hover:bg-primary/25 hover:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveConfig}
                disabled={promptsLoading || !configDirty}
              >
                Save Config
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {promptsError && (
        <div className="mx-4 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-md font-mono text-xs text-red-500">
          {promptsError}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {promptsLoading && !promptContent ? (
          <div className="flex items-center justify-center flex-1 font-mono text-xs text-muted-foreground">
            Loading...
          </div>
        ) : (
          <textarea
            className="flex-1 w-full p-4 bg-muted/30 border border-border rounded-lg font-mono text-[13px] leading-relaxed text-foreground resize-none focus:outline-2 focus:outline-ring focus:outline-offset-1 focus:border-ring placeholder:text-muted-foreground"
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
