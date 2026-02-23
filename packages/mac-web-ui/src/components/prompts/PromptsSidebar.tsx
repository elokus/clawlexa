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
    <div className="mb-4 last:mb-0">
      <div className="px-4 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {prompts.map((prompt) => {
          const isSelected = selectedId === prompt.id;
          return (
            <motion.button
              key={prompt.id}
              className={`flex flex-col items-start gap-1 px-4 py-2.5 bg-transparent border-none border-l-2 cursor-pointer text-left w-full transition-colors ${
                isSelected
                  ? 'bg-accent border-l-primary'
                  : 'border-l-transparent hover:bg-accent/50 hover:border-l-border'
              }`}
              onClick={() => onSelect(prompt.id)}
              whileHover={{ x: 2 }}
              transition={{ duration: 0.1 }}
            >
              <div className="flex items-center gap-2 w-full">
                <span className={`font-mono text-[13px] font-medium flex-1 min-w-0 truncate ${
                  isSelected ? 'text-primary' : 'text-foreground'
                }`}>
                  {prompt.name}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                  isSelected
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {prompt.activeVersion}
                </span>
              </div>
              {prompt.description && (
                <span className="font-mono text-[11px] text-muted-foreground truncate w-full">
                  {prompt.description}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function PromptsSidebar() {
  const selectPrompt = useUnifiedSessionsStore((s) => s.selectPrompt);
  const { prompts, selectedPromptId, promptsLoading } = usePromptsState();

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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Prompts
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {promptsLoading && prompts.length === 0 ? (
          <div className="flex items-center justify-center h-full font-mono text-xs text-muted-foreground">
            Loading...
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex items-center justify-center h-full font-mono text-xs text-muted-foreground">
            No prompts found
          </div>
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
