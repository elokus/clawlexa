// ═══════════════════════════════════════════════════════════════════════════
// Agent Stage - Unified component for all agent types (voice, subagent)
// Uses AI Elements (Conversation, Message) from Vercel AI SDK
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { SpokenTextHighlight } from '@/components/ai-elements/spoken-highlight';
import { Loader } from '@/components/ai-elements/loader';
import { cn } from '@/lib/utils';
import {
  useUnifiedSessionsStore,
  useVoiceTimeline,
  useVoiceState,
  useFocusedSessionChildren,
  type Message as StoreMessage,
  type MessagePart,
  type SessionState,
  type TimelineItem,
  type TranscriptItem,
  type ToolItem,
} from '@/stores';
import type { StageItem, SessionTreeNode } from '@/types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface AgentStageProps {
  stage: StageItem;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
  ttfbMs?: number;
  audioRoundtripMs?: number;
  sttMs?: number;
  llmMs?: number;
  pending?: boolean;
  /** Full LLM-generated text (for spoken highlighting) */
  generatedText?: string;
  /** Spoken word count from server events */
  spokenWords?: number;
  /** Total audio duration in ms (TTS audio bytes) */
  playbackMs?: number;
  /** Whether the spoken stream is finalized */
  spokenFinalized?: boolean;
  /** Runtime canonical word cues (preferred over heuristic highlighting) */
  wordCues?: Array<{
    word: string;
    startMs: number;
    endMs: number;
    source: 'provider' | 'synthetic';
    timeBase: 'utterance';
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Convert voice timeline to display messages */
function timelineToMessages(timeline: TimelineItem[]): DisplayMessage[] {
  const messages: DisplayMessage[] = [];

  for (const item of timeline) {
    if (item.type === 'transcript') {
      const transcript = item as TranscriptItem;
      messages.push({
        id: transcript.id,
        role: transcript.role === 'user' ? 'user' : 'assistant',
        parts: [{ type: 'text', text: transcript.content }],
        timestamp: transcript.timestamp,
        ttfbMs: transcript.ttfbMs,
        audioRoundtripMs: transcript.audioRoundtripMs,
        sttMs: transcript.sttMs,
        llmMs: transcript.llmMs,
        pending: transcript.pending,
        generatedText: transcript.generatedContent,
        spokenWords: transcript.spokenWords,
        playbackMs: transcript.playbackMs,
        spokenFinalized: transcript.spokenFinalized,
        wordCues: transcript.wordCues,
      });
    } else if (item.type === 'tool') {
      const tool = item as ToolItem;
      // Add tool as assistant message with tool-call and tool-result parts
      const parts: MessagePart[] = [
        {
          type: 'tool-call',
          toolName: tool.name,
          toolCallId: tool.id,
          args: tool.args || {},
        },
      ];
      if (tool.result !== undefined) {
        parts.push({
          type: 'tool-result',
          toolName: tool.name,
          toolCallId: tool.id,
          result: tool.result,
        });
      }
      messages.push({
        id: tool.id,
        role: 'assistant',
        parts,
        timestamp: tool.timestamp,
        pending: tool.status === 'running',
      });
    }
  }

  return messages;
}

/** Convert session messages to display messages */
function sessionToMessages(session: SessionState | undefined): DisplayMessage[] {
  if (!session?.messages) return [];
  return session.messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    parts: msg.parts,
    timestamp: msg.createdAt,
    ttfbMs: msg.ttfbMs,
    audioRoundtripMs: msg.audioRoundtripMs,
    sttMs: msg.sttMs,
    llmMs: msg.llmMs,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Part Renderers
// ═══════════════════════════════════════════════════════════════════════════

function TextPart({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <MessageResponse>{text}</MessageResponse>
      {pending && <TypingIndicator />}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

function ReasoningPart({
  text,
  pending,
}: {
  text: string;
  pending?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!text.trim()) return null;

  return (
    <details
      className={cn(
        'rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden',
        pending && 'animate-pulse'
      )}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="px-3 py-2 cursor-pointer text-xs font-mono text-purple-500 dark:text-purple-400 flex items-center gap-2">
        <span className="text-[10px]">{isOpen ? '▼' : '▶'}</span>
        <span>{pending ? 'Thinking...' : 'Reasoning'}</span>
        {pending && <Loader size={12} className="text-purple-400" />}
      </summary>
      <div className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap border-t border-purple-500/10">
        {text}
      </div>
    </details>
  );
}

interface ToolPartProps {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
  pending?: boolean;
  childSessions?: SessionTreeNode[];
  onNavigateToSession?: (sessionId: string) => void;
}

function ToolPart({
  toolName,
  toolCallId,
  args,
  result,
  pending,
  childSessions,
  onNavigateToSession,
}: ToolPartProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Find linked session for session-creating tools
  const linkedSession = childSessions?.find(
    (child) => child.tool_call_id === toolCallId
  );

  const toolConfig: Record<string, { label: string; icon: string; color: string }> = {
    view_todos: { label: 'Checking tasks', icon: '◈', color: 'text-purple-500 dark:text-purple-400' },
    add_todo: { label: 'Adding task', icon: '◈', color: 'text-purple-500 dark:text-purple-400' },
    delete_todo: { label: 'Removing task', icon: '◈', color: 'text-purple-500 dark:text-purple-400' },
    set_timer: { label: 'Setting timer', icon: '⧖', color: 'text-orange-500 dark:text-orange-400' },
    list_timers: { label: 'Checking timers', icon: '⧖', color: 'text-orange-500 dark:text-orange-400' },
    cancel_timer: { label: 'Canceling timer', icon: '⧖', color: 'text-orange-500 dark:text-orange-400' },
    web_search: { label: 'Searching web', icon: '⌘', color: 'text-blue-500 dark:text-blue-400' },
    control_light: { label: 'Adjusting lights', icon: '◉', color: 'text-green-500 dark:text-green-400' },
    deep_thinking: { label: 'Deep analysis', icon: '◇', color: 'text-purple-500 dark:text-purple-400' },
    developer_session: { label: 'Dev Session', icon: '▣', color: 'text-blue-500 dark:text-blue-400' },
    start_headless_session: { label: 'Headless Session', icon: '▣', color: 'text-blue-500 dark:text-blue-400' },
    start_interactive_session: { label: 'Interactive Session', icon: '▣', color: 'text-blue-500 dark:text-blue-400' },
    check_coding_session: { label: 'Session Status', icon: '◆', color: 'text-blue-500 dark:text-blue-400' },
    send_session_feedback: { label: 'Sending Feedback', icon: '◆', color: 'text-blue-500 dark:text-blue-400' },
    stop_coding_session: { label: 'Stopping Session', icon: '◆', color: 'text-red-500 dark:text-red-400' },
    view_past_sessions: { label: 'Past Sessions', icon: '◆', color: 'text-purple-500 dark:text-purple-400' },
  };

  const config = toolConfig[toolName] || { label: toolName, icon: '◆', color: 'text-muted-foreground' };

  return (
    <details
      className={cn(
        'rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden',
        pending && 'border-blue-500/40'
      )}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="px-3 py-2 cursor-pointer text-xs font-mono flex items-center gap-2">
        <span className={cn('text-sm', config.color)}>{config.icon}</span>
        <span className={cn('flex-1', config.color)}>{config.label}</span>
        {pending ? (
          <Loader size={12} className="text-blue-400" />
        ) : (
          <span className="text-green-500 text-[10px]">✓</span>
        )}
        {result !== undefined && !isOpen && (
          <span className="text-[10px] text-green-500/60 ml-auto truncate max-w-[200px] font-normal">
            {typeof result === 'string' ? result.split('\n')[0]!.slice(0, 60) : 'Done'}
          </span>
        )}
        {linkedSession && onNavigateToSession && (
          <button
            type="button"
            className="px-2 py-0.5 text-[10px] rounded border border-blue-500/30 bg-blue-500/10 text-blue-500 dark:text-blue-400 hover:bg-blue-500/20"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToSession(linkedSession.id);
            }}
          >
            View
          </button>
        )}
      </summary>
      <div className="border-t border-blue-500/10">
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Arguments</div>
          <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 overflow-auto max-h-32">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
        {result !== undefined && (
          <div className="px-3 py-2 border-t border-blue-500/10">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Result</div>
            <pre className="text-xs font-mono text-green-600 dark:text-green-400/80 bg-green-500/5 rounded p-2 overflow-auto max-h-32">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Block Component
// ═══════════════════════════════════════════════════════════════════════════

interface MessageBlockProps {
  message: DisplayMessage;
  isLatest?: boolean;
  childSessions?: SessionTreeNode[];
  onNavigateToSession?: (sessionId: string) => void;
}

function MessageBlock({ message, isLatest, childSessions, onNavigateToSession }: MessageBlockProps) {
  const isUser = message.role === 'user';

  const timestamp = new Date(message.timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <Message from={message.role} className={cn(isLatest && 'is-latest')}>
      <div className={cn(
        'flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider mb-1',
        isUser ? 'justify-end text-blue-500/60 dark:text-blue-400/60' : 'text-green-500/60 dark:text-green-400/60'
      )}>
        <span>{isUser ? 'You' : 'Agent'}</span>
        <span className="text-muted-foreground">{timestamp}</span>
      </div>
      <MessageContent className={cn(
        isUser && 'bg-secondary/50',
        !isUser && 'border-l-2 border-blue-500/30 pl-3'
      )}>
        {message.parts.map((part, idx) => {
          const key = `${message.id}-part-${idx}`;
          switch (part.type) {
            case 'text': {
              // Highlight the currently active assistant voice turn.
              // Keep SpokenTextHighlight mounted after spoken-final (pending=false)
              // as long as word cues exist — audio may still be playing in the
              // browser's AudioContext buffer.  SpokenTextHighlight handles the
              // endgame internally (force-complete when AudioContext drains).
              const isActiveVoiceTurn =
                !isUser &&
                !!isLatest &&
                typeof message.generatedText === 'string' &&
                message.generatedText.length > 0 &&
                (!!message.pending || (Array.isArray(message.wordCues) && message.wordCues.length > 0));

              if (isActiveVoiceTurn) {
                return (
                  <SpokenTextHighlight
                    key={key}
                    generatedText={message.generatedText!}
                    spokenFinalized={message.spokenFinalized ?? false}
                    pending={message.pending && idx === message.parts.length - 1}
                    turnKey={message.id}
                    wordCues={message.wordCues}
                    spokenWords={message.spokenWords}
                  />
                );
              }
              return (
                <TextPart
                  key={key}
                  text={part.text}
                  pending={message.pending && idx === message.parts.length - 1}
                />
              );
            }
            case 'reasoning':
              return (
                <ReasoningPart
                  key={key}
                  text={part.text}
                  pending={message.pending}
                />
              );
            case 'tool-call': {
              // Find matching result in same message
              const resultPart = message.parts.find(
                (p) => p.type === 'tool-result' && p.toolCallId === part.toolCallId
              ) as { type: 'tool-result'; result: unknown } | undefined;
              return (
                <ToolPart
                  key={key}
                  toolName={part.toolName}
                  toolCallId={part.toolCallId}
                  args={part.args}
                  result={resultPart?.result}
                  pending={!resultPart && message.pending}
                  childSessions={childSessions}
                  onNavigateToSession={onNavigateToSession}
                />
              );
            }
            case 'tool-result':
              // Already handled with tool-call
              return null;
            default:
              return null;
          }
        })}
      </MessageContent>
      {!isUser &&
        (typeof message.ttfbMs === 'number' ||
          typeof message.audioRoundtripMs === 'number' ||
          typeof message.sttMs === 'number' ||
          typeof message.llmMs === 'number') && (
        <div className="mt-1 pl-3 text-[10px] font-mono text-muted-foreground/70">
          {typeof message.ttfbMs === 'number' ? `TTFB ${message.ttfbMs} ms` : null}
          {typeof message.ttfbMs === 'number' &&
          typeof message.audioRoundtripMs === 'number'
            ? ' · '
            : null}
          {typeof message.audioRoundtripMs === 'number'
            ? `Audio RTT ${message.audioRoundtripMs} ms`
            : null}
          {typeof message.ttfbMs !== 'number' &&
          typeof message.audioRoundtripMs !== 'number' &&
          (typeof message.sttMs === 'number' || typeof message.llmMs === 'number')
            ? 'Pipeline'
            : null}
          {(typeof message.sttMs === 'number' || typeof message.llmMs === 'number') && (
            <span
              className="ml-2 cursor-help rounded border border-border/60 px-1 text-[9px] text-muted-foreground"
              title={
                `STT: ${
                  typeof message.sttMs === 'number' ? `${message.sttMs} ms` : 'n/a'
                }\nLLM: ${
                  typeof message.llmMs === 'number' ? `${message.llmMs} ms` : 'n/a'
                }`
              }
            >
              i
            </span>
          )}
        </div>
      )}
    </Message>
  );
}

export function AgentStage({ stage }: AgentStageProps) {
  // Determine if this is a voice session or subagent/orchestrator
  const isVoiceSession = stage.type === 'chat' || stage.id === 'root';
  const sessionId = isVoiceSession ? null : stage.id;
  const { voiceState } = useVoiceState();

  // Get data based on session type
  const timeline = useVoiceTimeline();
  const session = useUnifiedSessionsStore((s) => sessionId ? s.sessions.get(sessionId) : undefined);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const focusedChildren = useFocusedSessionChildren();

  // Text input state for subagent sessions
  const { sendSessionInput } = useWebSocket();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!inputValue.trim() || isSubmitting) return;
    setIsSubmitting(true);
    sendSessionInput(inputValue.trim());
    setInputValue('');
    // Reset submitting state after a short delay
    setTimeout(() => setIsSubmitting(false), 500);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Convert to display messages
  const messages = useMemo(() => {
    if (isVoiceSession) {
      return timelineToMessages(timeline);
    }
    // For subagent sessions, use session messages from handleStreamChunk()
    // Note: The old activities system is deprecated - all content now comes via stream_chunk
    return sessionToMessages(session);
  }, [isVoiceSession, timeline, session]);

  // Determine title and subtitle
  const title = isVoiceSession ? 'Realtime Agent' : (stage.data?.agentName || stage.title);
  const icon = isVoiceSession ? '◎' : '◇';

  return (
    <motion.div
      className="flex flex-col h-full overflow-hidden bg-background"
      layoutId={`stage-${stage.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
    >
      <Conversation className="flex-1 min-h-0 pr-[320px]">
        <ConversationContent
          className={cn(
            messages.length === 0 ? 'h-full p-0' : 'gap-6 py-4 px-4'
          )}
        >
          {messages.length === 0 ? (
            isVoiceSession ? (
              <div className="h-full flex flex-col items-center justify-center gap-4">
                <div className="text-center">
                  <div className="text-sm font-medium text-foreground/60 mb-1">
                    {voiceState === 'idle' ? 'Awaiting Input' :
                     voiceState === 'listening' ? 'Listening...' :
                     voiceState === 'thinking' ? 'Processing...' : 'Speaking...'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Say "Jarvis" or "Computer" to start
                  </div>
                </div>
              </div>
            ) : (
              <ConversationEmptyState
                title="Waiting for activity"
                description={`${title} is initializing...`}
                icon={
                  <div className="w-16 h-16 flex items-center justify-center text-4xl text-muted-foreground/30 animate-pulse">
                    {icon}
                  </div>
                }
              />
            )
          ) : (
            messages.map((msg, idx) => (
              <MessageBlock
                key={msg.id}
                message={msg}
                isLatest={idx === messages.length - 1}
                childSessions={focusedChildren}
                onNavigateToSession={focusSession}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Text input for all sessions (voice + subagent) */}
      <div className="border-t border-border/40 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isVoiceSession ? 'Message Realtime Agent...' : `Message ${title}...`}
            rows={1}
            disabled={isSubmitting}
            className={cn(
              'flex-1 resize-none bg-muted/40 border border-border/50 rounded-lg px-3 py-2',
              'text-sm text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'max-h-32 overflow-y-auto'
            )}
            style={{ minHeight: '40px' }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isSubmitting}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              inputValue.trim() && !isSubmitting
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            Send
          </button>
        </div>
      </div>
    </motion.div>
  );
}
