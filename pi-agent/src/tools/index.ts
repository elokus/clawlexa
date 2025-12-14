/**
 * Tools Index - Export all available tools for the voice agent.
 */

export { webSearchTool } from '../subagents/web-search/index.js';
export { addTodoTool, viewTodosTool, deleteTodoTool } from './todo.js';
export { controlLightTool } from './govee.js';
export { reasoningTool } from './reasoning.js';
export { setTimerTool, listTimersTool, cancelTimerTool } from './timer.js';
export {
  developerSessionTool,
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
  developerSessionTool,
  checkSessionTool,
  sendFeedbackTool,
  stopSessionTool,
  viewPastSessionsTool,
} from './developer-session.js';

export const toolsByName = {
  web_search: webSearchTool,
  add_todo: addTodoTool,
  view_todos: viewTodosTool,
  delete_todo: deleteTodoTool,
  control_light: controlLightTool,
  deep_thinking: reasoningTool,
  set_timer: setTimerTool,
  list_timers: listTimersTool,
  cancel_timer: cancelTimerTool,
  // Developer/CLI session tools
  developer_session: developerSessionTool,
  check_coding_session: checkSessionTool,
  send_session_feedback: sendFeedbackTool,
  stop_coding_session: stopSessionTool,
  view_past_sessions: viewPastSessionsTool,
} as const;

export type ToolName = keyof typeof toolsByName;

export function getToolsByNames(names: ToolName[]) {
  return names.map((name) => toolsByName[name]);
}
