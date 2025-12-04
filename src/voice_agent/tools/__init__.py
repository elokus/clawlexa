"""Voice Agent Tools - Base classes and registry for tool handoff system."""

from .base import BaseTool, ToolResult, ToolRegistry
from .summarize import SummarizeRequirementsTool
from .web_search import WebSearchTool
from .todo import AddTodoTool, ViewTodosTool, DeleteTodoTool

__all__ = [
    "BaseTool",
    "ToolResult",
    "ToolRegistry",
    "SummarizeRequirementsTool",
    "WebSearchTool",
    "AddTodoTool",
    "ViewTodosTool",
    "DeleteTodoTool",
]
