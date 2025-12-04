"""Todo List Tools - Simple JSON-based task management."""

import json
import os
from datetime import datetime
from typing import Any
from pathlib import Path

from .base import BaseTool, ToolResult


# Default path for the todo list JSON file
TODO_FILE = Path.home() / "todos.json"


def _load_todos() -> list[dict]:
    """Load todos from JSON file."""
    if not TODO_FILE.exists():
        return []
    try:
        with open(TODO_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_todos(todos: list[dict]) -> None:
    """Save todos to JSON file."""
    with open(TODO_FILE, "w", encoding="utf-8") as f:
        json.dump(todos, f, indent=2, ensure_ascii=False)


def _get_next_id(todos: list[dict]) -> int:
    """Get the next available ID."""
    if not todos:
        return 1
    return max(t.get("id", 0) for t in todos) + 1


class AddTodoTool(BaseTool):
    """Tool for adding a new todo item."""

    name = "add_todo"
    description = (
        "Add a new task to the todo list. Use this when the user wants to create "
        "a new task, reminder, or todo item."
    )
    parameters = {
        "type": "object",
        "properties": {
            "task": {
                "type": "string",
                "description": "The task description or name.",
            },
            "due_date": {
                "type": "string",
                "description": "Optional due date in format YYYY-MM-DD.",
            },
            "assignee": {
                "type": "string",
                "enum": ["Lukasz", "Hannah"],
                "description": "Who is assigned to this task. Defaults to Lukasz.",
            },
        },
        "required": ["task"],
    }

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Add a new todo item."""
        task = arguments.get("task", "").strip()
        if not task:
            return ToolResult(
                success=False,
                output="Keine Aufgabe angegeben.",
                skip_tts=True,
            )

        due_date = arguments.get("due_date")
        assignee = arguments.get("assignee", "Lukasz")

        # Validate assignee
        if assignee not in ["Lukasz", "Hannah"]:
            assignee = "Lukasz"

        # Validate due_date format if provided
        if due_date:
            try:
                datetime.strptime(due_date, "%Y-%m-%d")
            except ValueError:
                due_date = None  # Invalid format, ignore

        todos = _load_todos()
        new_id = _get_next_id(todos)

        new_todo = {
            "id": new_id,
            "task": task,
            "assignee": assignee,
            "created_at": datetime.now().isoformat(),
        }
        if due_date:
            new_todo["due_date"] = due_date

        todos.append(new_todo)
        _save_todos(todos)

        self._status(f"Added todo #{new_id}: {task}")

        # Build response
        response = f"Aufgabe #{new_id} erstellt: {task}"
        if due_date:
            response += f", fällig am {due_date}"
        response += f", zugewiesen an {assignee}."

        return ToolResult(
            success=True,
            output=response,
            skip_tts=True,
            data={"id": new_id, "todo": new_todo},
        )


class ViewTodosTool(BaseTool):
    """Tool for viewing and querying the todo list."""

    name = "view_todos"
    description = (
        "View or query the todo list. Use this when the user wants to see their "
        "tasks, check what's due, or filter by assignee."
    )
    parameters = {
        "type": "object",
        "properties": {
            "assignee": {
                "type": "string",
                "enum": ["Lukasz", "Hannah"],
                "description": "Filter by assignee. If not provided, shows all tasks.",
            },
            "show_all": {
                "type": "boolean",
                "description": "If true, show all tasks. Default is true.",
            },
        },
        "required": [],
    }

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """View todos, optionally filtered."""
        assignee = arguments.get("assignee")

        todos = _load_todos()

        if not todos:
            return ToolResult(
                success=True,
                output="Die Todo-Liste ist leer. Keine Aufgaben vorhanden.",
                skip_tts=True,
            )

        # Filter by assignee if specified
        if assignee:
            todos = [t for t in todos if t.get("assignee") == assignee]
            if not todos:
                return ToolResult(
                    success=True,
                    output=f"Keine Aufgaben für {assignee} gefunden.",
                    skip_tts=True,
                )

        self._status(f"Found {len(todos)} todos")

        # Build response
        lines = []
        for t in todos:
            line = f"#{t['id']}: {t['task']} ({t['assignee']})"
            if t.get("due_date"):
                line += f" - fällig: {t['due_date']}"
            lines.append(line)

        if assignee:
            header = f"Aufgaben für {assignee}:"
        else:
            header = "Alle Aufgaben:"

        response = f"{header} " + "; ".join(lines)

        return ToolResult(
            success=True,
            output=response,
            skip_tts=True,
            data={"count": len(todos), "todos": todos},
        )


class DeleteTodoTool(BaseTool):
    """Tool for deleting a todo item."""

    name = "delete_todo"
    description = (
        "Delete a task from the todo list by its ID. Use this when the user wants "
        "to remove or complete a task."
    )
    parameters = {
        "type": "object",
        "properties": {
            "id": {
                "type": "integer",
                "description": "The ID of the task to delete.",
            },
        },
        "required": ["id"],
    }

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Delete a todo by ID."""
        todo_id = arguments.get("id")
        if todo_id is None:
            return ToolResult(
                success=False,
                output="Keine Aufgaben-ID angegeben.",
                skip_tts=True,
            )

        todos = _load_todos()

        # Find the todo
        todo_to_delete = None
        for t in todos:
            if t.get("id") == todo_id:
                todo_to_delete = t
                break

        if not todo_to_delete:
            return ToolResult(
                success=False,
                output=f"Aufgabe #{todo_id} nicht gefunden.",
                skip_tts=True,
            )

        # Remove the todo
        todos = [t for t in todos if t.get("id") != todo_id]
        _save_todos(todos)

        self._status(f"Deleted todo #{todo_id}")

        response = f"Aufgabe #{todo_id} gelöscht: {todo_to_delete['task']}"

        return ToolResult(
            success=True,
            output=response,
            skip_tts=True,
            data={"deleted": todo_to_delete},
        )
