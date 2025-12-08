/**
 * Todo List Tools - JSON-based task management.
 *
 * Data stored in ~/todos.json
 * Each task has: id, task, assignee, created_at, due_date (optional)
 */

import { tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const TODO_FILE = join(homedir(), 'todos.json');

interface Todo {
  id: number;
  task: string;
  assignee: string;
  created_at: string;
  due_date?: string;
}

function loadTodos(): Todo[] {
  if (!existsSync(TODO_FILE)) {
    return [];
  }
  try {
    const data = readFileSync(TODO_FILE, 'utf-8');
    return JSON.parse(data) as Todo[];
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]): void {
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf-8');
}

function getNextId(todos: Todo[]): number {
  if (todos.length === 0) return 1;
  return Math.max(...todos.map((t) => t.id)) + 1;
}

export const addTodoTool = tool({
  name: 'add_todo',
  description:
    'Add a new task to the todo list. Use this when the user wants to create ' +
    'a new task, reminder, or todo item.',
  parameters: z.object({
    task: z.string().describe('The task description or name.'),
    due_date: z
      .string()
      .nullable()
      .describe('Optional due date in format YYYY-MM-DD. Pass null if not specified.'),
    assignee: z
      .enum(['Lukasz', 'Hannah'])
      .nullable()
      .describe('Who is assigned to this task. Defaults to Lukasz if null.'),
  }),
  async execute({ task, due_date, assignee }) {
    if (!task.trim()) {
      return 'Keine Aufgabe angegeben.';
    }

    // Use defaults for null values
    const actualAssignee = assignee ?? 'Lukasz';
    let actualDueDate = due_date;

    // Validate due_date format if provided
    if (actualDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(actualDueDate)) {
      actualDueDate = null;
    }

    const todos = loadTodos();
    const newId = getNextId(todos);

    const newTodo: Todo = {
      id: newId,
      task: task.trim(),
      assignee: actualAssignee,
      created_at: new Date().toISOString(),
    };
    if (actualDueDate) {
      newTodo.due_date = actualDueDate;
    }

    todos.push(newTodo);
    saveTodos(todos);

    console.log(`[Todo] Added #${newId}: ${task}`);

    let response = `Aufgabe Nummer ${newId} erstellt: ${task}`;
    if (actualDueDate) {
      response += `, fällig am ${actualDueDate}`;
    }
    response += `, zugewiesen an ${actualAssignee}.`;

    return response;
  },
});

export const viewTodosTool = tool({
  name: 'view_todos',
  description:
    'View or query the todo list. Use this when the user wants to see their ' +
    'tasks, check what is due, or filter by assignee.',
  parameters: z.object({
    assignee: z
      .enum(['Lukasz', 'Hannah'])
      .nullable()
      .describe('Filter by assignee. Pass null to show all tasks.'),
  }),
  async execute({ assignee }) {
    let todos = loadTodos();

    if (todos.length === 0) {
      return 'Die Todo-Liste ist leer. Keine Aufgaben vorhanden.';
    }

    // Filter by assignee if specified
    if (assignee) {
      todos = todos.filter((t) => t.assignee === assignee);
      if (todos.length === 0) {
        return `Keine Aufgaben für ${assignee} gefunden.`;
      }
    }

    console.log(`[Todo] Found ${todos.length} todos`);

    // Build response for speech
    const lines = todos.map((t) => {
      let line = `Nummer ${t.id}: ${t.task}, zugewiesen an ${t.assignee}`;
      if (t.due_date) {
        line += `, fällig am ${t.due_date}`;
      }
      return line;
    });

    const header = assignee ? `Aufgaben für ${assignee}:` : 'Alle Aufgaben:';
    return `${header} ${lines.join('. ')}.`;
  },
});

export const deleteTodoTool = tool({
  name: 'delete_todo',
  description:
    'Delete a task from the todo list by its ID. Use this when the user wants ' +
    'to remove or complete a task.',
  parameters: z.object({
    id: z.number().describe('The ID of the task to delete.'),
  }),
  async execute({ id }) {
    const todos = loadTodos();

    const todoToDelete = todos.find((t) => t.id === id);
    if (!todoToDelete) {
      return `Aufgabe Nummer ${id} nicht gefunden.`;
    }

    const remaining = todos.filter((t) => t.id !== id);
    saveTodos(remaining);

    console.log(`[Todo] Deleted #${id}: ${todoToDelete.task}`);

    return `Aufgabe Nummer ${id} gelöscht: ${todoToDelete.task}`;
  },
});
