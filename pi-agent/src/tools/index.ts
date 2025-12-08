/**
 * Tools Index - Export all available tools for the voice agent.
 */

export { webSearchTool } from './web-search.js';
export { addTodoTool, viewTodosTool, deleteTodoTool } from './todo.js';
export { controlLightTool } from './govee.js';
export { reasoningTool } from './reasoning.js';

// Tool registry by name for easy lookup
import { webSearchTool } from './web-search.js';
import { addTodoTool, viewTodosTool, deleteTodoTool } from './todo.js';
import { controlLightTool } from './govee.js';
import { reasoningTool } from './reasoning.js';

export const toolsByName = {
  web_search: webSearchTool,
  add_todo: addTodoTool,
  view_todos: viewTodosTool,
  delete_todo: deleteTodoTool,
  control_light: controlLightTool,
  deep_thinking: reasoningTool,
} as const;

export type ToolName = keyof typeof toolsByName;

export function getToolsByNames(names: ToolName[]) {
  return names.map((name) => toolsByName[name]);
}
