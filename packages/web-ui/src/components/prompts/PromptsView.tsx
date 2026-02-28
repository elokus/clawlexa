import { useEffect } from 'react';
import { useUnifiedSessionsStore, usePromptsState } from '../../stores';
import { PromptsSidebar } from './PromptsSidebar';
import { PromptEditor } from './PromptEditor';

export function PromptsView() {
  const loadPrompts = useUnifiedSessionsStore((s) => s.loadPrompts);
  const { promptsLoading, promptsError, selectedPromptId } = usePromptsState();

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  return (
    <div className="grid grid-cols-[280px_1fr] h-full overflow-hidden bg-card rounded-xl border border-border max-[900px]:grid-cols-[220px_1fr] max-[700px]:grid-cols-1">
      {/* Sidebar */}
      <div className="h-full overflow-hidden border-r border-border bg-muted/30 max-[700px]:hidden">
        <PromptsSidebar />
      </div>

      {/* Editor */}
      <div className="h-full overflow-hidden flex flex-col">
        {promptsLoading && !selectedPromptId ? (
          <div className="flex items-center justify-center h-full font-mono text-xs text-muted-foreground">
            Loading prompts...
          </div>
        ) : promptsError ? (
          <div className="flex items-center justify-center h-full font-mono text-xs text-red-500">
            {promptsError}
          </div>
        ) : selectedPromptId ? (
          <PromptEditor />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <span className="text-5xl opacity-20">=</span>
            <span className="font-mono text-[13px]">Select a prompt to edit</span>
          </div>
        )}
      </div>
    </div>
  );
}
