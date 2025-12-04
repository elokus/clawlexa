"""Agent profiles for different wake words and tool configurations."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentProfile:
    """Configuration profile for a voice agent persona.

    Each profile defines a unique assistant with its own:
    - Wake word trigger
    - Name and voice
    - Remote prompt configuration
    - Available tools
    """

    name: str
    """Display name of the assistant (e.g., 'Jarvis', 'Marvin')."""

    wake_word: str
    """Wake word that activates this profile (e.g., 'hey_jarvis')."""

    prompt_id: str
    """OpenAI remote prompt ID."""

    prompt_version: str | None = None
    """Version of the remote prompt to use. None = always use latest."""

    voice: str = "echo"
    """Voice to use (alloy, ash, ballad, coral, echo, sage, shimmer, verse)."""

    tools: list[str] = field(default_factory=list)
    """List of tool names to enable for this profile."""

    greeting_trigger: str = ""
    """Message sent to trigger the assistant's greeting."""


# Predefined profiles
JARVIS_PROFILE = AgentProfile(
    name="Jarvis",
    wake_word="hey_jarvis",
    prompt_id="pmpt_693042aafdcc8194bfd305307bcda48f0aace211731a2053",
    voice="echo",
    tools=["web_search", "add_todo", "view_todos", "delete_todo"],
    greeting_trigger="[Conversation started - user just said the wake word 'Hey Jarvis']",
)

MARVIN_PROFILE = AgentProfile(
    name="Marvin",
    wake_word="hey_marvin",
    prompt_id="pmpt_693042aafdcc8194bfd305307bcda48f0aace211731a2053",  # Update with Marvin's prompt
    voice="ash",
    tools=["summarize_requirements", "add_todo", "view_todos", "delete_todo"],
    greeting_trigger="[Conversation started - user just said the wake word 'Hey Marvin']",
)

# Default profiles mapping
DEFAULT_PROFILES = {
    "hey_jarvis": JARVIS_PROFILE,
    "hey_marvin": MARVIN_PROFILE,
}
