/**
 * Tools Index - Export all available tools for the voice agent.
 */

export { webSearchTool } from '../subagents/web-search/index.js';
export { addTodoTool, viewTodosTool, deleteTodoTool } from './todo.js';
export { controlLightTool } from './govee.js';
export { reasoningTool } from './reasoning.js';
export { setTimerTool, listTimersTool, cancelTimerTool } from './timer.js';
export {
  createDeveloperSessionTool,
  checkSessionTool,
  sendFeedbackTool,
  stopSessionTool,
  viewPastSessionsTool,
} from './developer-session.js';
export { createBackgroundTaskTool } from './background-task.js';
export { createDirectTerminalTools } from './direct-terminal.js';

// Tool registry by name for easy lookup
import { webSearchTool } from '../subagents/web-search/index.js';
import { addTodoTool, viewTodosTool, deleteTodoTool } from './todo.js';
import { controlLightTool } from './govee.js';
import { reasoningTool } from './reasoning.js';
import { setTimerTool, listTimersTool, cancelTimerTool } from './timer.js';
import {
  createDeveloperSessionTool,
  checkSessionTool,
  sendFeedbackTool,
  stopSessionTool,
  viewPastSessionsTool,
} from './developer-session.js';
import { createBackgroundTaskTool } from './background-task.js';
import { createDirectTerminalTools, type DirectTerminalToolName } from './direct-terminal.js';
import type { VoiceAgent } from '../agent/voice-agent.js';

// Static tools that don't need session context
const staticToolsByName = {
  web_search: webSearchTool,
  add_todo: addTodoTool,
  view_todos: viewTodosTool,
  delete_todo: deleteTodoTool,
  control_light: controlLightTool,
  deep_thinking: reasoningTool,
  set_timer: setTimerTool,
  list_timers: listTimersTool,
  cancel_timer: cancelTimerTool,
  // Session management tools (these don't need the voice session ID)
  check_coding_session: checkSessionTool,
  send_session_feedback: sendFeedbackTool,
  stop_coding_session: stopSessionTool,
  view_past_sessions: viewPastSessionsTool,
} as const;

// Type includes both static tools and factory-created tools
export type ToolName =
  | keyof typeof staticToolsByName
  | 'developer_session'
  | 'background_task'
  | DirectTerminalToolName;

export interface ToolCatalogEntry {
  name: string;
  label: string;
  description: string;
  source: 'core' | 'manifest';
  selectable: boolean;
}

function coreTool(name: ToolName, label: string, description: string): ToolCatalogEntry {
  return {
    name,
    label,
    description,
    source: 'core',
    selectable: true,
  };
}

export const CORE_TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  coreTool('web_search', 'Web Search', 'Search the web for current information.'),
  coreTool('add_todo', 'Add Todo', 'Create a new todo item.'),
  coreTool('view_todos', 'View Todos', 'List todo items.'),
  coreTool('delete_todo', 'Delete Todo', 'Remove a todo item by ID.'),
  coreTool('control_light', 'Control Light', 'Control smart lights (power, brightness, color).'),
  coreTool('deep_thinking', 'Deep Thinking', 'Delegate complex planning and analysis.'),
  coreTool('set_timer', 'Set Timer', 'Set a timer or reminder.'),
  coreTool('list_timers', 'List Timers', 'Show active timers.'),
  coreTool('cancel_timer', 'Cancel Timer', 'Cancel an active timer.'),
  coreTool('check_coding_session', 'Check Coding Session', 'Check status of coding sessions.'),
  coreTool('send_session_feedback', 'Send Session Feedback', 'Send feedback/instructions to a coding session.'),
  coreTool('stop_coding_session', 'Stop Coding Session', 'Stop a coding session.'),
  coreTool('view_past_sessions', 'View Past Sessions', 'Review completed coding sessions.'),
  coreTool('developer_session', 'Developer Session', 'Start a delegated coding workflow.'),
  coreTool('background_task', 'Background Task', 'Run a long-running delegated task in the background.'),
  coreTool('open_claude', 'Open Claude', 'Open a direct Claude terminal session.'),
  coreTool('open_codex', 'Open Codex', 'Open a direct Codex terminal session.'),
  coreTool('dictate_to_session', 'Dictate to Session', 'Send input to an existing terminal session.'),
  coreTool('read_session', 'Read Session', 'Read output from an existing terminal session.'),
  coreTool('close_session', 'Close Session', 'Close a terminal session.'),
  coreTool('arrange_window', 'Arrange Window', 'Arrange a session window on screen.'),
] as const;

/**
 * Options for creating tools with injected dependencies.
 */
export interface ToolCreationOptions {
  /** Voice session ID for parent-child tracking */
  sessionId: string;
  /** Voice agent reference for completion notifications (needed by background_task) */
  voiceAgent?: VoiceAgent;
}

/**
 * Get tools for a session, instantiating factory tools with the session ID.
 * This allows tools like developer_session to access the voice session ID
 * without polluting the conversation context.
 *
 * @param names - Tool names to instantiate
 * @param options - Session ID and optional voice agent reference
 */
export function getToolsForSession(names: ToolName[], options: ToolCreationOptions | string) {
  // Support legacy signature (sessionId string) for backwards compatibility
  const { sessionId, voiceAgent } = typeof options === 'string'
    ? { sessionId: options, voiceAgent: undefined }
    : options;
  const directToolsByName = createDirectTerminalTools(sessionId);

  return names.map((name) => {
    // Factory tool: developer_session needs sessionId + voiceAgent for HandoffPacket
    if (name === 'developer_session') {
      return createDeveloperSessionTool(sessionId, voiceAgent);
    }
    // Factory tool: background_task needs sessionId AND voiceAgent
    if (name === 'background_task') {
      if (!voiceAgent) {
        console.warn('[Tools] background_task requires voiceAgent - tool may not notify on completion');
      }
      return createBackgroundTaskTool(voiceAgent!, sessionId);
    }
    // Factory tools: direct voice-to-terminal tools need voice session ID scoping
    if (name in directToolsByName) {
      return directToolsByName[name as DirectTerminalToolName];
    }
    // Static tools
    if (name in staticToolsByName) {
      return staticToolsByName[name as keyof typeof staticToolsByName];
    }
    throw new Error(`Unknown tool: ${name}`);
  });
}
