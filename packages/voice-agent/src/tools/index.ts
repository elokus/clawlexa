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
