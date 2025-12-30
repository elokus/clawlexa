// ═══════════════════════════════════════════════════════════════════════════
// Events Overlay - Modal showing real-time event stream
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEvents, useOverlayState, useUnifiedSessionsStore } from '../../stores';
import type { RealtimeEvent } from '../../types';

const EVENT_COLORS: Record<string, string> = {
  state_change: 'var(--color-cyan)',
  transcript: 'var(--color-emerald)',
  audio_start: 'var(--color-cyan)',
  audio_end: 'var(--color-cyan)',
  tool_start: 'var(--color-violet)',
  tool_end: 'var(--color-violet)',
  error: 'var(--color-rose)',
  session_started: 'var(--color-amber)',
  session_ended: 'var(--color-amber)',
  cli_session_created: 'var(--color-cyan)',
  cli_session_update: 'var(--color-cyan)',
  subagent_activity: 'var(--color-violet)',
  welcome: 'var(--color-emerald)',
  master_changed: 'var(--color-amber)',
};

export function EventsOverlay() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = useEvents();
  const clearEvents = useUnifiedSessionsStore((s) => s.clearEvents);
  const { activeOverlay, setActiveOverlay } = useOverlayState();

  const isOpen = activeOverlay === 'events';

  // Auto-scroll on new events
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
          {/* Backdrop */}
          <motion.div
            className="overlay-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Panel */}
          <motion.div
            className="events-overlay"
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <style>{`
              .overlay-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(4px);
                z-index: 100;
              }

              .events-overlay {
                position: fixed;
                left: 260px;
                top: 80px;
                bottom: 80px;
                width: 420px;
                max-width: calc(100vw - 300px);
                background: rgba(10, 10, 15, 0.95);
                backdrop-filter: blur(20px);
                border: 1px solid var(--color-border);
                border-radius: 16px;
                z-index: 101;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
              }

              .events-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid var(--color-border);
                background: rgba(5, 5, 10, 0.5);
              }

              .events-title {
                display: flex;
                align-items: center;
                gap: 10px;
              }

              .events-title-icon {
                font-size: 16px;
                color: var(--color-cyan);
              }

              .events-title-text {
                font-family: var(--font-display);
                font-size: 12px;
                letter-spacing: 0.15em;
                color: var(--color-text-normal);
                text-transform: uppercase;
              }

              .events-count {
                font-family: var(--font-mono);
                font-size: 10px;
                color: var(--color-text-ghost);
                padding: 2px 8px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
              }

              .events-actions {
                display: flex;
                align-items: center;
                gap: 8px;
              }

              .events-btn {
                padding: 6px 12px;
                background: transparent;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                color: var(--color-text-dim);
                font-family: var(--font-mono);
                font-size: 10px;
                cursor: pointer;
                transition: all 0.2s ease;
              }

              .events-btn:hover {
                border-color: var(--color-cyan-dim);
                color: var(--color-cyan);
              }

              .events-btn.danger:hover {
                border-color: var(--color-rose);
                color: var(--color-rose);
              }

              .events-list {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
              }

              .events-list::-webkit-scrollbar {
                width: 6px;
              }

              .events-list::-webkit-scrollbar-track {
                background: transparent;
              }

              .events-list::-webkit-scrollbar-thumb {
                background: var(--color-border);
                border-radius: 3px;
              }

              .event-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 12px;
                margin-bottom: 6px;
                background: rgba(255, 255, 255, 0.02);
                border-radius: 8px;
                animation: event-appear 0.15s ease;
              }

              @keyframes event-appear {
                from {
                  opacity: 0;
                  transform: translateY(4px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }

              .event-time {
                flex-shrink: 0;
                font-family: var(--font-mono);
                font-size: 10px;
                color: var(--color-text-ghost);
                width: 55px;
              }

              .event-type {
                flex-shrink: 0;
                font-family: var(--font-mono);
                font-size: 9px;
                padding: 3px 8px;
                border-radius: 4px;
              }

              .event-data {
                flex: 1;
                font-family: var(--font-mono);
                font-size: 10px;
                color: var(--color-text-dim);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
              }

              .events-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                padding: 48px 24px;
                text-align: center;
              }

              .events-empty-icon {
                font-size: 32px;
                color: var(--color-text-ghost);
                opacity: 0.3;
                margin-bottom: 16px;
              }

              .events-empty-text {
                font-family: var(--font-mono);
                font-size: 12px;
                color: var(--color-text-ghost);
              }
            `}</style>

            <div className="events-header">
              <div className="events-title">
                <span className="events-title-icon">⚡</span>
                <span className="events-title-text">Events</span>
                <span className="events-count">{events.length}</span>
              </div>
              <div className="events-actions">
                {events.length > 0 && (
                  <button className="events-btn danger" onClick={clearEvents}>
                    Clear
                  </button>
                )}
                <button className="events-btn" onClick={handleClose}>
                  Close
                </button>
              </div>
            </div>

            <div className="events-list" ref={scrollRef}>
              {events.length === 0 ? (
                <div className="events-empty">
                  <div className="events-empty-icon">⚡</div>
                  <div className="events-empty-text">No events yet</div>
                </div>
              ) : (
                events.map((event) => {
                  const color = EVENT_COLORS[event.type] || 'var(--color-text-dim)';
                  return (
                    <div key={event.id} className="event-item">
                      <span className="event-time">
                        {new Date(event.timestamp).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span
                        className="event-type"
                        style={{
                          color,
                          background: `color-mix(in srgb, ${color} 15%, transparent)`,
                        }}
                      >
                        {event.type}
                      </span>
                      <span className="event-data">
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
