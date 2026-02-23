import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEvents, useOverlayState, useUnifiedSessionsStore } from '../../stores';
import type { RealtimeEvent } from '../../types';

const EVENT_COLORS: Record<string, string> = {
  state_change: 'text-blue-500',
  transcript: 'text-green-500',
  audio_start: 'text-blue-500',
  audio_end: 'text-blue-500',
  tool_start: 'text-purple-500',
  tool_end: 'text-purple-500',
  error: 'text-red-500',
  session_started: 'text-orange-500',
  session_ended: 'text-orange-500',
  cli_session_created: 'text-blue-500',
  cli_session_update: 'text-blue-500',
  subagent_activity: 'text-purple-500',
  welcome: 'text-green-500',
  master_changed: 'text-orange-500',
};

const EVENT_BG: Record<string, string> = {
  state_change: 'bg-blue-500/10',
  transcript: 'bg-green-500/10',
  audio_start: 'bg-blue-500/10',
  audio_end: 'bg-blue-500/10',
  tool_start: 'bg-purple-500/10',
  tool_end: 'bg-purple-500/10',
  error: 'bg-red-500/10',
  session_started: 'bg-orange-500/10',
  session_ended: 'bg-orange-500/10',
  cli_session_created: 'bg-blue-500/10',
  cli_session_update: 'bg-blue-500/10',
  subagent_activity: 'bg-purple-500/10',
  welcome: 'bg-green-500/10',
  master_changed: 'bg-orange-500/10',
};

export function EventsOverlay() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = useEvents();
  const clearEvents = useUnifiedSessionsStore((s) => s.clearEvents);
  const { activeOverlay, setActiveOverlay } = useOverlayState();

  const isOpen = activeOverlay === 'events';

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isOpen]);

  const handleClose = () => setActiveOverlay(null);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            className="fixed left-[260px] top-20 bottom-20 w-[420px] max-w-[calc(100vw-300px)] bg-card rounded-xl z-[101] flex flex-col overflow-hidden shadow-2xl"
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2.5">
                <span className="text-base">⚡</span>
                <span className="text-sm font-semibold text-foreground">Events</span>
                <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 bg-muted rounded">
                  {events.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {events.length > 0 && (
                  <button
                    className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-red-500 transition-colors"
                    onClick={clearEvents}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Events list */}
            <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-12 text-center">
                  <div className="text-3xl text-muted-foreground/20 mb-4">⚡</div>
                  <div className="text-sm text-muted-foreground">No events yet</div>
                </div>
              ) : (
                events.map((event) => {
                  const colorClass = EVENT_COLORS[event.type] || 'text-muted-foreground';
                  const bgClass = EVENT_BG[event.type] || 'bg-muted';
                  return (
                    <div key={event.id} className="flex items-start gap-2.5 px-3 py-2.5 mb-1.5 rounded-lg hover:bg-accent/50 transition-colors">
                      <span className="shrink-0 text-[10px] font-mono text-muted-foreground w-[55px]">
                        {new Date(event.timestamp).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span className={`shrink-0 text-[9px] font-mono font-medium px-2 py-0.5 rounded ${colorClass} ${bgClass}`}>
                        {event.type}
                      </span>
                      <span className="flex-1 text-[10px] font-mono text-muted-foreground truncate min-w-0">
                        {JSON.stringify(event.data)?.slice(0, 40) || '(empty)'}...
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
