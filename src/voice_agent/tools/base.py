"""Base classes for voice agent tools."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from ..audio import AudioCapture, AudioPlayer


@dataclass
class ToolResult:
    """Result from a tool execution."""

    success: bool
    """Whether the tool executed successfully."""

    output: str
    """Text output to send back to the conversation."""

    audio_response: bytes | None = None
    """Optional pre-generated audio response (skips TTS if provided)."""

    skip_tts: bool = False
    """Skip TTS and let Realtime speak the result instead."""

    data: dict[str, Any] = field(default_factory=dict)
    """Additional structured data from the tool."""


class BaseTool(ABC):
    """Base class for all voice agent tools.

    Tools follow the pattern:
    1. Receive function call from realtime API with initial arguments
    2. Optionally capture additional audio input (STT via Whisper)
    3. Process with LLM or custom logic
    4. Return result (text for TTS or pre-generated audio)
    """

    name: str = ""
    """Tool name (used in function calling)."""

    description: str = ""
    """Description of what the tool does (for the model)."""

    parameters: dict[str, Any] = {}
    """JSON schema for tool parameters."""

    # Callbacks set by the agent
    on_status: Callable[[str], None] | None = None
    """Callback for status updates (shown to user)."""

    on_audio_output: Callable[[bytes], None] | None = None
    """Callback for streaming audio output."""

    # Shared audio capture from agent (set by registry)
    audio_capture: "AudioCapture | None" = None
    """Shared audio capture instance from the agent."""

    # Shared audio player from agent (set by registry)
    audio_player: "AudioPlayer | None" = None
    """Shared audio player instance from the agent."""

    @abstractmethod
    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Execute the tool with the given arguments.

        Args:
            arguments: Arguments from the function call

        Returns:
            ToolResult with output text and optional audio
        """
        pass

    def get_function_definition(self) -> dict[str, Any]:
        """Get the OpenAI function definition for this tool."""
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }

    def _status(self, message: str) -> None:
        """Send a status update."""
        if self.on_status:
            self.on_status(message)


class ToolRegistry:
    """Registry for managing available tools."""

    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        """Get a tool by name."""
        return self._tools.get(name)

    def get_all(self) -> list[BaseTool]:
        """Get all registered tools."""
        return list(self._tools.values())

    def get_function_definitions(self) -> list[dict[str, Any]]:
        """Get OpenAI function definitions for all tools."""
        return [tool.get_function_definition() for tool in self._tools.values()]

    def set_callbacks(
        self,
        on_status: Callable[[str], None] | None = None,
        on_audio_output: Callable[[bytes], None] | None = None,
    ) -> None:
        """Set callbacks on all registered tools."""
        for tool in self._tools.values():
            tool.on_status = on_status
            tool.on_audio_output = on_audio_output

    def set_audio_capture(self, audio_capture: "AudioCapture") -> None:
        """Set the shared audio capture on all registered tools."""
        for tool in self._tools.values():
            tool.audio_capture = audio_capture

    def set_audio_player(self, audio_player: "AudioPlayer") -> None:
        """Set the shared audio player on all registered tools."""
        for tool in self._tools.values():
            tool.audio_player = audio_player
