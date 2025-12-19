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
export type ToolName = keyof typeof staticToolsByName | 'developer_session';

/**
 * Get tools for a session, instantiating factory tools with the session ID.
 * This allows tools like developer_session to access the voice session ID
 * without polluting the conversation context.
 */
export function getToolsForSession(names: ToolName[], sessionId: string) {
  return names.map((name) => {
    // Factory tool: developer_session needs sessionId injected
    if (name === 'developer_session') {
      return createDeveloperSessionTool(sessionId);
    }
    // Static tools
    if (name in staticToolsByName) {
      return staticToolsByName[name as keyof typeof staticToolsByName];
    }
    throw new Error(`Unknown tool: ${name}`);
  });
}
