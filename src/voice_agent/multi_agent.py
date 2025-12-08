"""Multi-Profile Voice Agent - Different agents based on wake word."""

import asyncio
import json
from enum import Enum, auto

from dotenv import load_dotenv


def log(msg: str) -> None:
    """Print with immediate flush."""
    print(msg, flush=True)


from .audio import AudioCapture, AudioPlayer, DEVICE_SAMPLE_RATE, API_SAMPLE_RATE, resample_audio
from .led import StatusLED
from .wakeword import MultiWakeWordDetector
from .realtime import RealtimeClient, FunctionCall
from .tts import TTSClient
from .tools import (
    ToolRegistry,
    BaseTool,
    SummarizeRequirementsTool,
    WebSearchTool,
    AddTodoTool,
    ViewTodosTool,
    DeleteTodoTool,
    GoveeLightTool,
)
from .profiles import AgentProfile, DEFAULT_PROFILES


class AgentState(Enum):
    """Voice agent states."""
    LISTENING_FOR_WAKEWORD = auto()
    CONNECTING = auto()
    CONVERSATION = auto()
    SPEAKING = auto()
    TOOL_EXECUTING = auto()


# Stop phrases that end the conversation (German)
STOP_PHRASES = [
    "konversation beenden",
    "gespräch beenden",
    "auf wiedersehen",
    "tschüss",
    "danke",
    "das wäre alles",
    "das war's",
    "das war alles",
    "ende",
]

# All available tools mapped by name
ALL_TOOLS: dict[str, type[BaseTool]] = {
    "summarize_requirements": SummarizeRequirementsTool,
    "web_search": WebSearchTool,
    "add_todo": AddTodoTool,
    "view_todos": ViewTodosTool,
    "delete_todo": DeleteTodoTool,
    "control_light": GoveeLightTool,
}


class MultiProfileVoiceAgent:
    """Voice agent that supports multiple profiles based on wake word.

    Different wake words activate different assistant personas with
    their own prompts, voices, and available tools.
    """

    def __init__(
        self,
        profiles: dict[str, AgentProfile] | None = None,
        wake_word_threshold: float = 0.5,
        conversation_timeout: float = 60.0,
        stop_phrases: list[str] | None = None,
    ):
        """
        Initialize the multi-profile voice agent.

        Args:
            profiles: Dict mapping wake words to AgentProfile configs.
                     If None, uses DEFAULT_PROFILES.
            wake_word_threshold: Detection threshold (0-1)
            conversation_timeout: Seconds of silence before returning to wake word mode
            stop_phrases: Phrases that end the conversation
        """
        load_dotenv()

        self.profiles = profiles or DEFAULT_PROFILES
        self.conversation_timeout = conversation_timeout
        self.stop_phrases = stop_phrases or STOP_PHRASES

        self.state = AgentState.LISTENING_FOR_WAKEWORD
        self._last_activity_time = 0.0
        self._running = False
        self._pending_disconnect = False
        self._pending_function_call: FunctionCall | None = None

        # Current active profile (set when wake word detected)
        self._active_profile: AgentProfile | None = None

        # Initialize multi-wake-word detector
        wake_words = list(self.profiles.keys())
        self.wake_detector = MultiWakeWordDetector(
            wake_words=wake_words,
            threshold=wake_word_threshold,
        )

        # Initialize shared components
        self.audio_capture = AudioCapture()
        self.audio_player = AudioPlayer()
        self.led = StatusLED()

        # Tool registry and realtime client are created per-profile
        self.tool_registry: ToolRegistry | None = None
        self.realtime_client: RealtimeClient | None = None
        self.tts_client: TTSClient | None = None

    def _create_tool_registry(self, profile: AgentProfile) -> ToolRegistry:
        """Create a tool registry with only the tools for this profile."""
        registry = ToolRegistry()
        for tool_name in profile.tools:
            if tool_name in ALL_TOOLS:
                registry.register(ALL_TOOLS[tool_name]())
        return registry

    def _create_realtime_client(self, profile: AgentProfile) -> RealtimeClient:
        """Create a realtime client configured for this profile."""
        tool_definitions = self.tool_registry.get_function_definitions() if self.tool_registry else []

        client = RealtimeClient(
            voice=profile.voice,
            tools=tool_definitions,
            prompt_id=profile.prompt_id,
            prompt_version=profile.prompt_version,
        )

        # Wire up callbacks
        client.on_audio_delta = self._on_audio_delta
        client.on_response_done = self._on_response_done
        client.on_speech_started = self._on_speech_started
        client.on_speech_stopped = self._on_speech_stopped
        client.on_function_call = self._on_function_call

        return client

    def _activate_profile(self, wake_word: str) -> None:
        """Activate the profile for the given wake word."""
        profile = self.profiles.get(wake_word)
        if not profile:
            log(f"❌ No profile for wake word: {wake_word}")
            return

        self._active_profile = profile
        log(f"\n🎭 Activating profile: {profile.name}")

        # Create tool registry for this profile
        self.tool_registry = self._create_tool_registry(profile)
        self.tool_registry.set_callbacks(
            on_status=self._on_tool_status,
            on_audio_output=self._on_audio_delta,
        )
        self.tool_registry.set_audio_capture(self.audio_capture)
        self.tool_registry.set_audio_player(self.audio_player)

        # Create realtime client for this profile
        self.realtime_client = self._create_realtime_client(profile)

        # Create TTS client with profile's voice
        self.tts_client = TTSClient(voice=profile.voice)

        log(f"   Voice: {profile.voice}")
        log(f"   Tools: {', '.join(profile.tools)}")

    def _on_tool_status(self, message: str) -> None:
        """Handle status updates from tools."""
        log(f"\n🔧 Tool: {message}")

    def _on_audio_delta(self, audio_bytes: bytes) -> None:
        """Handle audio output from the model."""
        self.state = AgentState.SPEAKING
        self.audio_player.play(audio_bytes)

    def _on_response_done(self) -> None:
        """Handle response completion."""
        self._last_activity_time = asyncio.get_event_loop().time()
        if self.state == AgentState.SPEAKING:
            self.state = AgentState.CONVERSATION
        log("\n[Assistant finished speaking]")

    def _on_speech_started(self) -> None:
        """Handle user speech start (interruption)."""
        log("\n[User speaking - interrupting]")
        self.audio_player.clear()
        self.state = AgentState.CONVERSATION
        self._last_activity_time = asyncio.get_event_loop().time()

    def _on_speech_stopped(self) -> None:
        """Handle user speech stop."""
        self._last_activity_time = asyncio.get_event_loop().time()

    def _on_function_call(self, func_call: FunctionCall) -> None:
        """Handle function call from the model."""
        log(f"\n🔧 Function call received: {func_call.name}")
        self._pending_function_call = func_call

    async def _execute_tool(self, func_call: FunctionCall) -> None:
        """Execute a tool."""
        if not self.tool_registry or not self.realtime_client:
            return

        tool = self.tool_registry.get(func_call.name)
        if not tool:
            log(f"\n❌ Unknown tool: {func_call.name}")
            await self.realtime_client.send_function_result(
                func_call.call_id,
                json.dumps({"error": f"Unknown tool: {func_call.name}"}),
            )
            return

        self.state = AgentState.TOOL_EXECUTING
        self.led.start_blink(0.05, 0.05)

        if self.audio_player.is_playing():
            log("\n⏳ Waiting for assistant speech to finish...")
            await asyncio.to_thread(self.audio_player.wait_until_done, 10.0)
            await asyncio.sleep(0.3)

        result_summary = "Tool execution failed."
        tool_success = False
        skip_tts = False

        try:
            log(f"\n🔧 Executing tool: {func_call.name}")
            result = await tool.execute(func_call.arguments)
            tool_success = result.success
            skip_tts = result.skip_tts

            if result.success:
                log(f"\n✅ Tool completed: {func_call.name}")
                if result.skip_tts:
                    log(f"\n📤 Returning result to Realtime (skip TTS)")
                    result_summary = result.output
                else:
                    log(f"\n🔊 Speaking result via TTS...")
                    await self._speak_with_tts(result.output)
                    result_summary = f"Tool erfolgreich. Zusammenfassung: {result.output}"
            else:
                log(f"\n❌ Tool failed: {func_call.name}")
                if not result.skip_tts:
                    await self._speak_with_tts(f"Es gab einen Fehler: {result.output}")
                result_summary = f"Tool fehlgeschlagen: {result.output}"

        except Exception as e:
            log(f"\n❌ Tool error: {e}")
            try:
                await self._speak_with_tts(f"Ein Fehler ist aufgetreten: {str(e)}")
            except Exception:
                pass
            result_summary = f"Tool error: {str(e)}"
            tool_success = False

        finally:
            log(f"\n📤 Sending tool result back to realtime...")
            try:
                if skip_tts:
                    note = "Sprich dieses Ergebnis dem Benutzer vor. Fasse es kurz zusammen."
                else:
                    note = "Result was already spoken to user via TTS. Just acknowledge briefly."

                await self.realtime_client.send_function_result(
                    func_call.call_id,
                    json.dumps({
                        "success": tool_success,
                        "result": result_summary,
                        "note": note,
                    }),
                )
            except Exception as e:
                log(f"\n⚠️ Could not send result to realtime: {e}")

            self.state = AgentState.CONVERSATION
            self.led.start_blink(0.1, 0.1)
            self._last_activity_time = asyncio.get_event_loop().time()
            log("💬 Back to conversation mode")

    async def _speak_with_tts(self, text: str) -> None:
        """Speak text using TTS API."""
        if not self.tts_client:
            return

        previous_state = self.state
        self.state = AgentState.SPEAKING

        try:
            async for audio_chunk in self.tts_client.synthesize_stream(text):
                self.audio_player.play(audio_chunk)

            log(f"\n⏳ Waiting for TTS playback to finish...")
            await asyncio.to_thread(self.audio_player.wait_until_done, 30.0)
            await asyncio.sleep(0.3)
            log(f"\n✅ TTS playback complete")

        except Exception as e:
            log(f"\n❌ TTS error: {e}")
            raise
        finally:
            if previous_state == AgentState.TOOL_EXECUTING:
                self.state = previous_state

    def _check_stop_phrase(self, transcript: str) -> bool:
        """Check if transcript contains a stop phrase."""
        text = transcript.lower().strip()
        for phrase in self.stop_phrases:
            if phrase in text:
                return True
        return False

    async def _disconnect_conversation(self) -> None:
        """Disconnect and return to wake word mode."""
        profile_name = self._active_profile.name if self._active_profile else "Assistant"
        log(f"\n👋 {profile_name} signing off. Say a wake word to start again!")
        self.audio_player.clear()
        if self.realtime_client:
            await self.realtime_client.disconnect()
        self.state = AgentState.LISTENING_FOR_WAKEWORD
        self._pending_disconnect = False
        self._active_profile = None
        self.led.heartbeat()

    async def _audio_capture_loop(self) -> None:
        """Background task for capturing and processing audio."""
        while self._running:
            if self.state == AgentState.TOOL_EXECUTING:
                await asyncio.sleep(0.05)
                continue

            audio_chunk = self.audio_capture.read(timeout=0.1)
            if not audio_chunk:
                await asyncio.sleep(0.01)
                continue

            if self.state == AgentState.LISTENING_FOR_WAKEWORD:
                # Check for any wake word
                detected_wake_word = self.wake_detector.detected(audio_chunk)
                if detected_wake_word:
                    log(f"\n🎤 Wake word detected: {detected_wake_word}")
                    self.state = AgentState.CONNECTING
                    self.led.on()
                    self.wake_detector.reset()

                    # Activate the profile for this wake word
                    self._activate_profile(detected_wake_word)

                    if not self.realtime_client:
                        log("❌ Failed to create realtime client")
                        self.state = AgentState.LISTENING_FOR_WAKEWORD
                        self.led.heartbeat()
                        continue

                    # Connect to OpenAI Realtime API
                    try:
                        await self.realtime_client.connect()
                        self.state = AgentState.CONVERSATION
                        self._last_activity_time = asyncio.get_event_loop().time()
                        self.led.start_blink(0.1, 0.1)
                        log("💬 Connected! Triggering greeting...")

                        # Trigger the model to greet the user
                        greeting = self._active_profile.greeting_trigger if self._active_profile else ""
                        if greeting:
                            await self.realtime_client.send_user_message(greeting)
                    except Exception as e:
                        log(f"❌ Connection failed: {e}")
                        self.state = AgentState.LISTENING_FOR_WAKEWORD
                        self.led.heartbeat()

            elif self.state in (AgentState.CONVERSATION, AgentState.SPEAKING):
                if self.realtime_client and self.realtime_client.ws is not None:
                    api_audio = resample_audio(audio_chunk, DEVICE_SAMPLE_RATE, API_SAMPLE_RATE)
                    try:
                        await self.realtime_client.send_audio(api_audio)
                    except Exception:
                        self.state = AgentState.LISTENING_FOR_WAKEWORD

            await asyncio.sleep(0.001)

    async def _timeout_monitor(self) -> None:
        """Monitor for conversation timeout."""
        while self._running:
            if self.state == AgentState.CONVERSATION:
                current_time = asyncio.get_event_loop().time()
                if current_time - self._last_activity_time > self.conversation_timeout:
                    log("\n⏰ Conversation timeout.")
                    await self._disconnect_conversation()

            await asyncio.sleep(1.0)

    async def _event_listener(self) -> None:
        """Listen for events from the Realtime API."""
        while self._running:
            if self.state in (AgentState.CONVERSATION, AgentState.SPEAKING, AgentState.TOOL_EXECUTING):
                if not self.realtime_client:
                    await asyncio.sleep(0.1)
                    continue

                try:
                    async for event in self.realtime_client.listen():
                        if not self._running:
                            break

                        if self._pending_function_call is not None:
                            func_call = self._pending_function_call
                            self._pending_function_call = None
                            await self._execute_tool(func_call)
                            continue

                        if self._pending_disconnect and self.state == AgentState.CONVERSATION:
                            await self._disconnect_conversation()
                            break

                        event_type = event.get("type", "")
                        if event_type == "response.audio_transcript.done":
                            transcript = event.get("transcript", "")
                            if transcript:
                                log(f"\n🤖 Assistant: {transcript}")
                        elif event_type == "conversation.item.input_audio_transcription.completed":
                            transcript = event.get("transcript", "")
                            if transcript:
                                log(f"\n👤 You: {transcript}")
                                if self._check_stop_phrase(transcript):
                                    log("\n🛑 Stop phrase detected...")
                                    self._pending_disconnect = True
                except Exception:
                    if self.realtime_client and self.realtime_client.ws is None:
                        log("\n🔌 Connection lost. Say a wake word to reconnect.")
                        self.state = AgentState.LISTENING_FOR_WAKEWORD
                        self.led.heartbeat()
            else:
                await asyncio.sleep(0.1)

    async def run(self) -> None:
        """Run the multi-profile voice agent."""
        wake_words = list(self.profiles.keys())
        profile_names = [p.name for p in self.profiles.values()]

        log("=" * 50)
        log("🚀 Multi-Profile Voice Agent Starting")
        log("=" * 50)
        log(f"Profiles: {', '.join(profile_names)}")
        log(f"Wake words: {', '.join(wake_words)}")
        log(f"Timeout: {self.conversation_timeout}s of silence")
        log("=" * 50)
        log("\n👂 Listening for wake words...")

        self._running = True

        self.audio_capture.start()
        self.audio_player.start()
        self.led.heartbeat()

        try:
            await asyncio.gather(
                self._audio_capture_loop(),
                self._timeout_monitor(),
                self._event_listener(),
            )
        except KeyboardInterrupt:
            log("\n\n👋 Shutting down...")
        finally:
            self._running = False
            if self.realtime_client:
                await self.realtime_client.disconnect()
            self.audio_capture.close()
            self.audio_player.close()
            self.led.restore()
            log("Goodbye!")

    def stop(self) -> None:
        """Stop the agent."""
        self._running = False


async def main():
    """Main entry point for multi-profile agent."""
    agent = MultiProfileVoiceAgent()
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
