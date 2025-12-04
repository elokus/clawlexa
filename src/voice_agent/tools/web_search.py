"""Web Search Tool - Uses OpenAI Responses API with web_search."""

import os
from typing import Any

from openai import OpenAI

from .base import BaseTool, ToolResult


class WebSearchTool(BaseTool):
    """Tool for searching the web using OpenAI's web_search capability.

    Uses the Responses API with gpt-4.1-mini for cost-efficient web searches.
    The Realtime API passes a query, and this tool returns search results.
    """

    name = "web_search"
    description = (
        "Search the web for current information. Use this when the user asks about "
        "recent news, current events, live data, or anything that requires up-to-date "
        "information from the internet."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up on the web.",
            },
        },
        "required": ["query"],
    }

    def __init__(self):
        """Initialize the web search tool."""
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI:
        """Lazy-load the OpenAI client."""
        if self._client is None:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY not set")
            self._client = OpenAI(api_key=api_key)
        return self._client

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Execute a web search.

        Args:
            arguments: Must contain "query" key with the search query.

        Returns:
            ToolResult with the search results as output text.
        """
        query = arguments.get("query", "")
        if not query:
            return ToolResult(
                success=False,
                output="Keine Suchanfrage angegeben.",
                data={"error": "No query provided"},
            )

        self._status(f"Searching the web for: {query}")

        try:
            # Use Responses API with web_search tool
            # Run in thread to avoid blocking async loop
            import asyncio

            response = await asyncio.to_thread(
                self.client.responses.create,
                model="gpt-4.1-mini",
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Du bist ein fokussierter Recherche-Assistent. "
                            "Nutze die Web-Suche um Fragen präzise zu beantworten. "
                            "Antworte auf Deutsch. Halte die Antwort kurz und prägnant, "
                            "maximal 2-3 Sätze. Nenne wichtige Quellen wenn relevant."
                        ),
                    },
                    {
                        "role": "user",
                        "content": query,
                    },
                ],
                tools=[{"type": "web_search"}],
                tool_choice="auto",
            )

            # Extract the text output
            result_text = response.output_text or "Keine Ergebnisse gefunden."

            self._status("Web search completed")

            return ToolResult(
                success=True,
                output=result_text,
                skip_tts=True,  # Let Realtime speak the result
                data={
                    "query": query,
                    "response_id": response.id,
                },
            )

        except Exception as e:
            error_msg = f"Web search failed: {str(e)}"
            self._status(error_msg)
            return ToolResult(
                success=False,
                output=f"Die Websuche ist fehlgeschlagen: {str(e)}",
                data={"error": str(e), "query": query},
            )
