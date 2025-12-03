"""OpenAI Realtime API WebSocket client."""

import asyncio
import base64
import json
import os
import sys
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

import websockets
from websockets.asyncio.client import ClientConnection


def _log(msg: str) -> None:
    """Print with immediate flush."""
    print(msg, file=sys.stderr, flush=True)


# Available realtime models - mini is cheaper for routing
REALTIME_MODELS = {
    "default": "gpt-realtime",
    "mini": "gpt-realtime-mini",
}

REALTIME_URL_BASE = "wss://api.openai.com/v1/realtime?model="


@dataclass
class FunctionCall:
    """Represents a function call from the model."""

    call_id: str
    name: str
    arguments: dict[str, Any]

# Audio format: 24kHz PCM16 mono
SAMPLE_RATE = 24000


class RealtimeClient:
    """Client for OpenAI Realtime API over WebSocket."""

    def __init__(
        self,
        api_key: str | None = None,
        instructions: str = "You are a helpful voice assistant. Be concise.",
        voice: str = "alloy",
        model: str = "mini",
        tools: list[dict[str, Any]] | None = None,
    ):
        """
        Initialize the Realtime client.

        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.
            instructions: System instructions for the assistant.
            voice: Voice to use for responses (alloy, ash, ballad, coral, echo, sage, shimmer, verse).
            model: Model to use ("mini" for routing, "default" for full capability).
            tools: List of tool definitions for function calling.
        """
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not set")

        self.instructions = instructions
        self.voice = voice
        self.model = REALTIME_MODELS.get(model, model)
        self.tools = tools or []
        self.ws: ClientConnection | None = None
        self._response_in_progress = False

        # Callbacks
        self.on_audio_delta: Callable[[bytes], None] | None = None
        self.on_transcript_delta: Callable[[str], None] | None = None
        self.on_response_done: Callable[[], None] | None = None
        self.on_speech_started: Callable[[], None] | None = None
        self.on_speech_stopped: Callable[[], None] | None = None
        self.on_error: Callable[[str], None] | None = None
        self.on_function_call: Callable[[FunctionCall], None] | None = None

    async def connect(self) -> None:
        """Connect to the Realtime API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "OpenAI-Beta": "realtime=v1",
        }

        url = f"{REALTIME_URL_BASE}{self.model}"
        self.ws = await websockets.connect(
            url,
            additional_headers=headers,
        )
        _log(f"Connected to OpenAI Realtime API (model: {self.model})")

        # Wait for session.created
        message = await self.ws.recv()
        event = json.loads(message)
        if event["type"] == "session.created":
            _log(f"Session created: {event['session']['id']}")

        # Configure the session
        await self._configure_session()

    async def _configure_session(self) -> None:
        """Configure the session with our settings."""
        session_config = {
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "voice": self.voice,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {
                    "model": "gpt-4o-transcribe",
                    "language": "de",
                },
                "turn_detection": {
                    "type": "semantic_vad",
                },
                # Use remote prompt from OpenAI
                "prompt": {
                    "id": "pmpt_693042aafdcc8194bfd305307bcda48f0aace211731a2053",
                    "version": "2",
                },
            },
        }

        # Add tools if configured
        if self.tools:
            session_config["session"]["tools"] = self.tools
            session_config["session"]["tool_choice"] = "auto"

        await self._send(session_config)

    def update_tools(self, tools: list[dict[str, Any]]) -> None:
        """Update the tools list (will take effect on next session config)."""
        self.tools = tools

    async def _send(self, event: dict) -> None:
        """Send an event to the server."""
        if self.ws:
            await self.ws.send(json.dumps(event))

    async def send_audio(self, audio_data: bytes) -> None:
        """
        Send audio data to the API.

        Args:
            audio_data: PCM16 audio bytes at 24kHz
        """
        base64_audio = base64.b64encode(audio_data).decode("ascii")
        event = {
            "type": "input_audio_buffer.append",
            "audio": base64_audio,
        }
        await self._send(event)

    async def commit_audio(self) -> None:
        """Commit the audio buffer (used when VAD is disabled)."""
        await self._send({"type": "input_audio_buffer.commit"})

    async def create_response(self) -> None:
        """Request a response from the model (used when VAD is disabled)."""
        await self._send({"type": "response.create"})

    async def send_user_message(self, text: str) -> None:
        """Send a text message as the user and trigger a response.

        This is useful for triggering the model to speak first (e.g., greeting).

        Args:
            text: The text message to send as user input
        """
        # Add a user message to the conversation
        event = {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": text,
                    }
                ],
            },
        }
        await self._send(event)
        # Trigger the model to respond
        await self.create_response()

    async def cancel_response(self) -> None:
        """Cancel an in-progress response."""
        if self._response_in_progress:
            await self._send({"type": "response.cancel"})

    async def clear_audio_buffer(self) -> None:
        """Clear the input audio buffer."""
        await self._send({"type": "input_audio_buffer.clear"})

    async def truncate_response(self, item_id: str, audio_end_ms: int) -> None:
        """
        Truncate a response at a specific point.

        Args:
            item_id: The ID of the response item to truncate
            audio_end_ms: Milliseconds of audio to keep
        """
        event = {
            "type": "conversation.item.truncate",
            "item_id": item_id,
            "content_index": 0,
            "audio_end_ms": audio_end_ms,
        }
        await self._send(event)

    async def send_function_result(self, call_id: str, output: str) -> None:
        """Send the result of a function call back to the model.

        Args:
            call_id: The call_id from the function call
            output: The result to send back (usually JSON string)
        """
        event = {
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": output,
            },
        }
        await self._send(event)
        # Trigger a response after providing function output
        await self._send({"type": "response.create"})

    async def add_context(self, context: str, role: str = "assistant") -> None:
        """Add context to the conversation without triggering a response.

        Useful for restoring conversation state after reconnection.

        Args:
            context: Text to add as context
            role: Role for the message ("user" or "assistant")
        """
        event = {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": role,
                "content": [
                    {
                        "type": "input_text" if role == "user" else "text",
                        "text": context,
                    }
                ],
            },
        }
        await self._send(event)

    async def listen(self) -> AsyncIterator[dict]:
        """
        Listen for events from the server.

        Yields:
            Server events as dictionaries
        """
        if not self.ws:
            return

        try:
            async for message in self.ws:
                event = json.loads(message)
                event_type = event.get("type", "")

                # Handle specific events
                if event_type == "response.audio.delta":
                    self._response_in_progress = True
                    if self.on_audio_delta and "delta" in event:
                        audio_bytes = base64.b64decode(event["delta"])
                        self.on_audio_delta(audio_bytes)

                elif event_type == "response.audio_transcript.delta":
                    if self.on_transcript_delta and "delta" in event:
                        self.on_transcript_delta(event["delta"])

                elif event_type == "response.done":
                    self._response_in_progress = False

                    # Check for function calls in the response
                    response = event.get("response", {})
                    output_items = response.get("output", [])
                    for item in output_items:
                        if item.get("type") == "function_call":
                            call_id = item.get("call_id", "")
                            name = item.get("name", "")
                            arguments_str = item.get("arguments", "{}")
                            try:
                                arguments = json.loads(arguments_str)
                            except json.JSONDecodeError:
                                arguments = {}

                            func_call = FunctionCall(
                                call_id=call_id,
                                name=name,
                                arguments=arguments,
                            )
                            _log(f"Function call: {name}({arguments})")
                            if self.on_function_call:
                                self.on_function_call(func_call)

                    if self.on_response_done:
                        self.on_response_done()

                elif event_type == "input_audio_buffer.speech_started":
                    if self.on_speech_started:
                        self.on_speech_started()

                elif event_type == "input_audio_buffer.speech_stopped":
                    if self.on_speech_stopped:
                        self.on_speech_stopped()

                elif event_type == "error":
                    error_msg = event.get("error", {}).get("message", "Unknown error")
                    _log(f"Error from API: {error_msg}")
                    if self.on_error:
                        self.on_error(error_msg)

                yield event

        except websockets.exceptions.ConnectionClosed:
            _log("WebSocket connection closed")

    async def disconnect(self) -> None:
        """Disconnect from the API."""
        if self.ws:
            await self.ws.close()
            self.ws = None
            _log("Disconnected from OpenAI Realtime API")
