// ═══════════════════════════════════════════════════════════════════════════
// Tools Overlay - Modal showing available tools grid
// ═══════════════════════════════════════════════════════════════════════════

import { motion, AnimatePresence } from 'framer-motion';
import { useStageStore } from '../../stores/stage';

const TOOLS = [
  { name: 'add_todo', desc: 'Add a new task to your list', icon: '◈', color: 'var(--color-violet)' },
  { name: 'view_todos', desc: 'List all tasks', icon: '◈', color: 'var(--color-violet)' },
  { name: 'delete_todo', desc: 'Remove a task', icon: '◈', color: 'var(--color-violet)' },
  { name: 'set_timer', desc: 'Set a timer or reminder', icon: '⧖', color: 'var(--color-amber)' },
  { name: 'list_timers', desc: 'View active timers', icon: '⧖', color: 'var(--color-amber)' },
  { name: 'cancel_timer', desc: 'Cancel a timer', icon: '⧖', color: 'var(--color-amber)' },
  { name: 'web_search', desc: 'Search the web for information', icon: '⌘', color: 'var(--color-cyan)' },
  { name: 'control_light', desc: 'Control smart lights', icon: '◉', color: 'var(--color-emerald)' },
  { name: 'deep_thinking', desc: 'Complex analysis and reasoning', icon: '◇', color: 'var(--color-violet)' },
  { name: 'developer_session', desc: 'Start a coding session on Mac', icon: '▣', color: 'var(--color-cyan)' },
];

export function ToolsOverlay() {
  const activeOverlay = useStageStore((s) => s.activeOverlay);
  const setActiveOverlay = useStageStore((s) => s.setActiveOverlay);

  const isOpen = activeOverlay === 'tools';
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
            className="tools-overlay"
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

              .tools-overlay {
                position: fixed;
                left: 260px;
                top: 80px;
                bottom: 80px;
                width: 360px;
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

              .tools-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid var(--color-border);
                background: rgba(5, 5, 10, 0.5);
              }

              .tools-title {
                display: flex;
                align-items: center;
                gap: 10px;
              }

              .tools-title-icon {
                font-size: 16px;
                color: var(--color-violet);
              }

              .tools-title-text {
                font-family: var(--font-display);
                font-size: 12px;
                letter-spacing: 0.15em;
                color: var(--color-text-normal);
                text-transform: uppercase;
              }

              .tools-count {
                font-family: var(--font-mono);
                font-size: 10px;
                color: var(--color-text-ghost);
                padding: 2px 8px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
              }

              .tools-close-btn {
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

              .tools-close-btn:hover {
                border-color: var(--color-cyan-dim);
                color: var(--color-cyan);
              }

              .tools-grid {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                align-content: start;
              }

              .tools-grid::-webkit-scrollbar {
                width: 6px;
              }

              .tools-grid::-webkit-scrollbar-track {
                background: transparent;
              }

              .tools-grid::-webkit-scrollbar-thumb {
                background: var(--color-border);
                border-radius: 3px;
              }

              .tool-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 16px 12px;
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid var(--color-border);
                border-radius: 12px;
                transition: all 0.2s ease;
              }

              .tool-card:hover {
                border-color: var(--color-cyan-dim);
                background: rgba(56, 189, 248, 0.03);
              }

              .tool-icon {
                font-size: 22px;
                transition: transform 0.2s ease;
              }

              .tool-card:hover .tool-icon {
                transform: scale(1.1);
              }

              .tool-info {
                text-align: center;
              }

              .tool-name {
                font-family: var(--font-mono);
                font-size: 10px;
                color: var(--color-text-bright);
                margin-bottom: 4px;
              }

              .tool-desc {
                font-family: var(--font-ui);
                font-size: 10px;
                color: var(--color-text-ghost);
                line-height: 1.4;
              }

              .tool-status {
                font-family: var(--font-mono);
                font-size: 8px;
                padding: 3px 8px;
                border-radius: 4px;
                background: rgba(52, 211, 153, 0.1);
                color: var(--color-emerald);
                border: 1px solid rgba(52, 211, 153, 0.2);
              }
            `}</style>

            <div className="tools-header">
              <div className="tools-title">
                <span className="tools-title-icon">◇</span>
                <span className="tools-title-text">Tools</span>
                <span className="tools-count">{TOOLS.length}</span>
              </div>
              <button className="tools-close-btn" onClick={handleClose}>
                Close
              </button>
            </div>

            <div className="tools-grid">
              {TOOLS.map((tool, index) => (
                <motion.div
                  key={tool.name}
                  className="tool-card"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <span className="tool-icon" style={{ color: tool.color }}>
                    {tool.icon}
                  </span>
                  <div className="tool-info">
                    <div className="tool-name">{tool.name}</div>
                    <div className="tool-desc">{tool.desc}</div>
                  </div>
                  <span className="tool-status">Ready</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
