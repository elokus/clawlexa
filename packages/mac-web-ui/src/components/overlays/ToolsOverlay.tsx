import { motion, AnimatePresence } from 'framer-motion';
import { useOverlayState } from '../../stores';

const TOOLS = [
  { name: 'add_todo', desc: 'Add a new task to your list', icon: '◈', color: 'text-purple-500' },
  { name: 'view_todos', desc: 'List all tasks', icon: '◈', color: 'text-purple-500' },
  { name: 'delete_todo', desc: 'Remove a task', icon: '◈', color: 'text-purple-500' },
  { name: 'set_timer', desc: 'Set a timer or reminder', icon: '⧖', color: 'text-orange-500' },
  { name: 'list_timers', desc: 'View active timers', icon: '⧖', color: 'text-orange-500' },
  { name: 'cancel_timer', desc: 'Cancel a timer', icon: '⧖', color: 'text-orange-500' },
  { name: 'web_search', desc: 'Search the web for information', icon: '⌘', color: 'text-blue-500' },
  { name: 'control_light', desc: 'Control smart lights', icon: '◉', color: 'text-green-500' },
  { name: 'deep_thinking', desc: 'Complex analysis and reasoning', icon: '◇', color: 'text-purple-500' },
  { name: 'developer_session', desc: 'Start a coding session on Mac', icon: '▣', color: 'text-blue-500' },
];

export function ToolsOverlay() {
  const { activeOverlay, setActiveOverlay } = useOverlayState();

  const isOpen = activeOverlay === 'tools';
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
            className="fixed left-[260px] top-20 bottom-20 w-[360px] max-w-[calc(100vw-300px)] bg-card rounded-xl z-[101] flex flex-col overflow-hidden shadow-2xl"
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2.5">
                <span className="text-base">◇</span>
                <span className="text-sm font-semibold text-foreground">Tools</span>
                <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 bg-muted rounded">
                  {TOOLS.length}
                </span>
              </div>
              <button
                className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={handleClose}
              >
                Close
              </button>
            </div>

            {/* Tools grid */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2.5 content-start">
              {TOOLS.map((tool, index) => (
                <motion.div
                  key={tool.name}
                  className="flex flex-col items-center gap-2 p-4 bg-muted/30 rounded-xl hover:bg-accent/50 transition-colors"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <span className={`text-xl ${tool.color}`}>{tool.icon}</span>
                  <div className="text-center">
                    <div className="text-[11px] font-mono font-medium text-foreground mb-1">{tool.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-snug">{tool.desc}</div>
                  </div>
                  <span className="text-[8px] font-mono font-medium text-green-600 dark:text-green-400 px-2 py-0.5 bg-green-500/10 rounded">
                    Ready
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
