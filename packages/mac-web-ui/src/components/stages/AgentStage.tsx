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

interface AgentStageProps {
  stage: StageItem;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
  pending?: boolean;
}

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
        pending: transcript.pending,
      });
    } else if (item.type === 'tool') {
      const tool = item as ToolItem;
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

function sessionToMessages(session: SessionState | undefined): DisplayMessage[] {
  if (!session?.messages) return [];
  return session.messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    parts: msg.parts,
    timestamp: msg.createdAt,
  }));
}

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

function ReasoningPart({ text, pending }: { text: string; pending?: boolean }) {
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

function ToolPart({ toolName, toolCallId, args, result, pending, childSessions, onNavigateToSession }: ToolPartProps) {
  const [isOpen, setIsOpen] = useState(false);

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
            case 'text':
              return (
                <TextPart
                  key={key}
                  text={part.text}
                  pending={message.pending && idx === message.parts.length - 1}
                />
              );
            case 'reasoning':
              return <ReasoningPart key={key} text={part.text} pending={message.pending} />;
            case 'tool-call': {
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
              return null;
            default:
              return null;
          }
        })}
      </MessageContent>
    </Message>
  );
}

interface HUDHeaderProps {
  title: string;
  subtitle?: string;
  status: { label: string; color: string; pulse: boolean };
  icon?: string;
  onBack?: () => void;
}

function HUDHeader({ title, subtitle, status, icon = '◎', onBack }: HUDHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
      <div className="flex items-center gap-3">
        <span className="text-base text-muted-foreground">{icon}</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="text-[11px] font-mono text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase"
          style={{ color: status.color }}
        >
          <span
            className={cn('w-1.5 h-1.5 rounded-full', status.pulse && 'animate-pulse')}
            style={{ background: status.color }}
          />
          {status.label}
        </div>
        {onBack && (
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={onBack}
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

export function AgentStage({ stage }: AgentStageProps) {
  const isVoiceSession = stage.type === 'chat' || stage.id === 'root';
  const sessionId = isVoiceSession ? null : stage.id;

  const timeline = useVoiceTimeline();
  const { voiceState, voiceProfile } = useVoiceState();
  const session = useUnifiedSessionsStore((s) => sessionId ? s.sessions.get(sessionId) : undefined);
  const clearFocusedSession = useUnifiedSessionsStore((s) => s.clearFocusedSession);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const focusedChildren = useFocusedSessionChildren();

  const { sendSessionInput } = useWebSocket();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!inputValue.trim() || isSubmitting) return;
    setIsSubmitting(true);
    sendSessionInput(inputValue.trim());
    setInputValue('');
    setTimeout(() => setIsSubmitting(false), 500);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const messages = useMemo(() => {
    if (isVoiceSession) return timelineToMessages(timeline);
    return sessionToMessages(session);
  }, [isVoiceSession, timeline, session]);

  const status = useMemo(() => {
    if (isVoiceSession) {
      const stateLabels: Record<string, { label: string; color: string; pulse: boolean }> = {
        idle: { label: 'Standby', color: 'var(--muted-foreground)', pulse: false },
        listening: { label: 'Listening', color: '#0A84FF', pulse: true },
        thinking: { label: 'Processing', color: '#BF5AF2', pulse: true },
        speaking: { label: 'Speaking', color: '#30D158', pulse: true },
      };
      return stateLabels[voiceState] || stateLabels.idle;
    }
    const isActive = session?.status === 'running';
    return isActive
      ? { label: 'Processing', color: '#BF5AF2', pulse: true }
      : { label: 'Complete', color: '#30D158', pulse: false };
  }, [isVoiceSession, voiceState, session?.status]);

  const title = isVoiceSession ? 'Realtime Agent' : (stage.data?.agentName || stage.title);
  const subtitle = isVoiceSession ? (voiceProfile || 'Voice Interface') : 'Subagent Activity';
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
      <HUDHeader
        title={title}
        subtitle={subtitle}
        status={status}
        icon={icon}
        onBack={!isVoiceSession ? clearFocusedSession : undefined}
      />

      <Conversation className="flex-1 min-h-0">
        <ConversationContent
          className={cn(
            messages.length === 0 ? 'h-full p-0' : 'gap-6 py-4 px-4'
          )}
        >
          {messages.length === 0 ? (
            <ConversationEmptyState
              title={isVoiceSession ? 'Awaiting Input' : 'Waiting for activity'}
              description={
                isVoiceSession
                  ? 'Say "Jarvis" or "Computer" to start a conversation'
                  : `${title} is initializing...`
              }
              icon={
                <div className="w-16 h-16 flex items-center justify-center text-4xl text-muted-foreground/30 animate-pulse">
                  {icon}
                </div>
              }
            />
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

      {/* Text input */}
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
