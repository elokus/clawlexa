"""Voice Agent - Main application."""

import asyncio
import json
import sys
from enum import Enum, auto

from dotenv import load_dotenv


def log(msg: str) -> None:
    """Print with immediate flush."""
    print(msg, flush=True)

from .audio import AudioCapture, AudioPlayer, DEVICE_SAMPLE_RATE, API_SAMPLE_RATE, resample_audio
from .led import StatusLED
from .wakeword import WakeWordDetector, WAKEWORD_SAMPLE_RATE
from .realtime import RealtimeClient, FunctionCall
from .tts import TTSClient
from .tools import ToolRegistry, SummarizeRequirementsTool


class AgentState(Enum):
    """Voice agent states."""
    LISTENING_FOR_WAKEWORD = auto()
    CONNECTING = auto()
    CONVERSATION = auto()
    SPEAKING = auto()
    TOOL_EXECUTING = auto()  # Tool is running (audio capture paused for realtime)


# Stop phrases that end the conversation (German)
STOP_PHRASES = [
    "konversation beenden",
    "gespräch beenden",
    "auf wiedersehen",
    "tschüss jarvis",
    "danke jarvis",
    "das wäre alles",
    "das war's",
    "ende",
]


class VoiceAgent:
    """Real-time voice agent with wake word activation and tool support."""

    def __init__(
        self,
        wake_word: str = "hey_jarvis",
        wake_word_threshold: float = 0.5,
        instructions: str = "You are Jarvis, a helpful voice assistant. Be concise and friendly.",
        voice: str = "alloy",
        model: str = "mini",
        conversation_timeout: float = 30.0,
        stop_phrases: list[str] | None = None,
    ):
        """
        Initialize the voice agent.

        Args:
            wake_word: Wake word to listen for (hey_jarvis, alexa, etc.)
            wake_word_threshold: Detection threshold (0-1)
            instructions: System instructions for the assistant
            voice: Voice to use (alloy, ash, ballad, coral, echo, sage, shimmer, verse)
            model: Realtime model to use ("mini" for cost-effective routing, "default" for full)
            conversation_timeout: Seconds of silence before returning to wake word mode
            stop_phrases: Phrases that end the conversation (default: goodbye, bye jarvis, etc.)
        """
        load_dotenv()

        self.state = AgentState.LISTENING_FOR_WAKEWORD
        self.conversation_timeout = conversation_timeout
        self.stop_phrases = stop_phrases or STOP_PHRASES
        self._last_activity_time = 0.0
        self._running = False
        self._pending_disconnect = False
        self._pending_function_call: FunctionCall | None = None

        # Initialize tool registry and register tools
        self.tool_registry = ToolRegistry()
        self._register_tools()

        # Initialize components
        self.wake_detector = WakeWordDetector(
            wake_word=wake_word,
            threshold=wake_word_threshold,
        )
        self.audio_capture = AudioCapture()
        self.audio_player = AudioPlayer()
        self.led = StatusLED()
        self.realtime_client = RealtimeClient(
            instructions=instructions,
            voice=voice,
            model=model,
            tools=self.tool_registry.get_function_definitions(),
        )
        self.tts_client = TTSClient(voice=voice)  # For tool output (cheaper than realtime)

        # Store config for reconnection after tool execution
        self._instructions = instructions
        self._voice = voice
        self._model = model

        # Wire up callbacks
        self.realtime_client.on_audio_delta = self._on_audio_delta
        self.realtime_client.on_response_done = self._on_response_done
        self.realtime_client.on_speech_started = self._on_speech_started
        self.realtime_client.on_speech_stopped = self._on_speech_stopped
        self.realtime_client.on_function_call = self._on_function_call

        # Set tool callbacks
        self.tool_registry.set_callbacks(
            on_status=self._on_tool_status,
            on_audio_output=self._on_audio_delta,
        )

    def _register_tools(self) -> None:
        """Register available tools."""
        self.tool_registry.register(SummarizeRequirementsTool())

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
        # Clear playback buffer on interruption
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
        """Execute a tool with cost-efficient handoff.

        Flow:
        1. Disconnect realtime session (stop paying for it)
        2. Execute tool (Whisper STT + GPT-4 - much cheaper)
        3. Use TTS API to speak the result (cheaper than realtime)
        4. Reconnect realtime for continued conversation
        """
        tool = self.tool_registry.get(func_call.name)
        if not tool:
            log(f"\n❌ Unknown tool: {func_call.name}")
            return

        # Mark state as tool executing
        self.state = AgentState.TOOL_EXECUTING
        self.led.start_blink(0.05, 0.05)  # Very fast blink = tool running

        try:
            # === DISCONNECT REALTIME (stop paying) ===
            log(f"\n🔌 Disconnecting realtime for tool execution...")
            await self.realtime_client.disconnect()

            # === EXECUTE TOOL (Whisper + GPT-4) ===
            log(f"\n🔧 Executing tool: {func_call.name}")
            result = await tool.execute(func_call.arguments)

            # === SPEAK RESULT WITH TTS (cheaper than realtime) ===
            if result.success:
                log(f"\n✅ Tool completed: {func_call.name}")
                log(f"\n🔊 Speaking result via TTS...")
                await self._speak_with_tts(result.output)
            else:
                log(f"\n❌ Tool failed: {func_call.name}")
                await self._speak_with_tts(f"Tool error: {result.output}")

        except Exception as e:
            log(f"\n❌ Tool error: {e}")
            try:
                await self._speak_with_tts(f"An error occurred: {str(e)}")
            except Exception:
                pass  # Don't fail if TTS also fails

        finally:
            # === RECONNECT REALTIME ===
            log(f"\n🔌 Reconnecting realtime...")
            try:
                await self.realtime_client.connect()
                self.state = AgentState.CONVERSATION
                self.led.start_blink(0.1, 0.1)  # Back to normal blink
                log("💬 Back to conversation mode")
            except Exception as e:
                log(f"\n❌ Failed to reconnect: {e}")
                self.state = AgentState.LISTENING_FOR_WAKEWORD
                self.led.heartbeat()

            self._last_activity_time = asyncio.get_event_loop().time()

    async def _speak_with_tts(self, text: str) -> None:
        """Speak text using OpenAI TTS API (cheaper than realtime).

        Args:
            text: Text to speak
        """
        self.state = AgentState.SPEAKING

        try:
            # Stream TTS audio to player
            # TTS outputs 24kHz PCM, AudioPlayer.play() handles resampling to 16kHz
            async for audio_chunk in self.tts_client.synthesize_stream(text):
                self.audio_player.play(audio_chunk)

            # Wait for playback buffer to drain
            # Estimate: ~150 words/min, ~5 chars/word
            estimated_duration = len(text) / 5 / 150 * 60
            await asyncio.sleep(max(estimated_duration + 0.5, 1.5))

        except Exception as e:
            log(f"\n❌ TTS error: {e}")
            raise

    def _check_stop_phrase(self, transcript: str) -> bool:
        """Check if transcript contains a stop phrase."""
        text = transcript.lower().strip()
        for phrase in self.stop_phrases:
            if phrase in text:
                return True
        return False

    async def _disconnect_conversation(self) -> None:
        """Disconnect from the conversation and return to wake word mode."""
        log("\n👋 Ending conversation. Say 'Hey Jarvis' to wake me up!")
        self.audio_player.clear()
        await self.realtime_client.disconnect()
        self.state = AgentState.LISTENING_FOR_WAKEWORD
        self._pending_disconnect = False
        self.led.heartbeat()  # Back to heartbeat = listening

    async def _process_wake_word(self, audio_chunk: bytes) -> bool:
        """
        Process audio for wake word detection.

        Args:
            audio_chunk: Audio at device sample rate (16kHz)

        Returns:
            True if wake word detected
        """
        # Device is already 16kHz, same as wake word detector expects
        return self.wake_detector.detected(audio_chunk)

    async def _audio_capture_loop(self) -> None:
        """Background task for capturing and processing audio."""
        while self._running:
            # When tool is executing, it reads audio directly - we skip
            if self.state == AgentState.TOOL_EXECUTING:
                await asyncio.sleep(0.05)
                continue

            audio_chunk = self.audio_capture.read(timeout=0.1)
            if not audio_chunk:
                await asyncio.sleep(0.01)
                continue

            if self.state == AgentState.LISTENING_FOR_WAKEWORD:
                # Check for wake word
                if await self._process_wake_word(audio_chunk):
                    log("\n🎤 Wake word detected! Connecting...")
                    self.state = AgentState.CONNECTING
                    self.led.on()  # Solid = connecting
                    self.wake_detector.reset()

                    # Connect to OpenAI Realtime API
                    try:
                        await self.realtime_client.connect()
                        self.state = AgentState.CONVERSATION
                        self._last_activity_time = asyncio.get_event_loop().time()
                        self.led.start_blink(0.1, 0.1)  # Fast blink = conversation active
                        log("💬 Listening... (speak your request)")
                    except Exception as e:
                        log(f"❌ Connection failed: {e}")
                        self.state = AgentState.LISTENING_FOR_WAKEWORD
                        self.led.heartbeat()  # Back to heartbeat

            elif self.state in (AgentState.CONVERSATION, AgentState.SPEAKING):
                # Send audio to OpenAI Realtime API (resample from 16kHz to 24kHz)
                # Only send if WebSocket is still connected
                if self.realtime_client.ws is not None:
                    api_audio = resample_audio(audio_chunk, DEVICE_SAMPLE_RATE, API_SAMPLE_RATE)
                    try:
                        await self.realtime_client.send_audio(api_audio)
                    except Exception:
                        # WebSocket closed, go back to wake word mode
                        self.state = AgentState.LISTENING_FOR_WAKEWORD

            await asyncio.sleep(0.001)  # Yield to other tasks

    async def _timeout_monitor(self) -> None:
        """Monitor for conversation timeout."""
        while self._running:
            if self.state == AgentState.CONVERSATION:
                current_time = asyncio.get_event_loop().time()
                if current_time - self._last_activity_time > self.conversation_timeout:
                    log("\n⏰ Conversation timeout. Say 'Hey Jarvis' to wake me up!")
                    await self.realtime_client.disconnect()
                    self.state = AgentState.LISTENING_FOR_WAKEWORD

            await asyncio.sleep(1.0)

    async def _event_listener(self) -> None:
        """Listen for events from the Realtime API."""
        while self._running:
            if self.state in (AgentState.CONVERSATION, AgentState.SPEAKING, AgentState.TOOL_EXECUTING):
                try:
                    async for event in self.realtime_client.listen():
                        if not self._running:
                            break

                        # Check if we have a pending function call to execute
                        if self._pending_function_call is not None:
                            func_call = self._pending_function_call
                            self._pending_function_call = None
                            await self._execute_tool(func_call)
                            continue

                        # Check if we need to disconnect after response
                        if self._pending_disconnect and self.state == AgentState.CONVERSATION:
                            await self._disconnect_conversation()
                            break  # Break inner loop, outer loop continues

                        # Events are handled by callbacks
                        event_type = event.get("type", "")
                        if event_type == "response.audio_transcript.done":
                            transcript = event.get("transcript", "")
                            if transcript:
                                log(f"\n🤖 Assistant: {transcript}")
                        elif event_type == "conversation.item.input_audio_transcription.completed":
                            transcript = event.get("transcript", "")
                            if transcript:
                                log(f"\n👤 You: {transcript}")
                                # Check for stop phrase in user input
                                if self._check_stop_phrase(transcript):
                                    log("\n🛑 Stop phrase detected...")
                                    self._pending_disconnect = True
                except Exception:
                    # Connection closed or error - just continue the loop
                    # Will wait for wake word or reconnect
                    pass
            else:
                await asyncio.sleep(0.1)

    async def run(self) -> None:
        """Run the voice agent."""
        log("=" * 50)
        log("🚀 Voice Agent Starting")
        log("=" * 50)
        log("Wake word: 'Hey Jarvis'")
        log("Stop: 'Konversation beenden' oder 'Ende'")
        log(f"Timeout: {self.conversation_timeout}s of silence")
        log("=" * 50)
        log("\n👂 Listening for wake word...")

        self._running = True

        # Start audio capture/playback
        self.audio_capture.start()
        self.audio_player.start()
        self.led.heartbeat()  # Heartbeat = listening for wake word

        # Pass shared audio capture to tools
        self.tool_registry.set_audio_capture(self.audio_capture)

        try:
            # Run all tasks concurrently
            await asyncio.gather(
                self._audio_capture_loop(),
                self._timeout_monitor(),
                self._event_listener(),
            )
        except KeyboardInterrupt:
            log("\n\n👋 Shutting down...")
        finally:
            self._running = False
            await self.realtime_client.disconnect()
            self.audio_capture.close()
            self.audio_player.close()
            self.led.restore()  # Restore original LED state
            log("Goodbye!")

    def stop(self) -> None:
        """Stop the agent."""
        self._running = False


async def main():
    """Main entry point."""
    agent = VoiceAgent(
        wake_word="hey_jarvis",
        wake_word_threshold=0.5,
        instructions=(
            "Du bist Jarvis, ein hilfreicher Sprachassistent auf einem Raspberry Pi. "
            "Antworte auf Deutsch. Sei präzise, freundlich und hilfreich. "
            "Halte Antworten kurz, außer es wird nach Details gefragt.\n\n"
            "Du hast Zugang zu Tools:\n"
            "- summarize_requirements: Nutze dieses Tool wenn der Benutzer Anforderungen, "
            "Ideen oder Gedanken sammeln und zusammenfassen möchte. Der Benutzer kann "
            "frei sprechen (Braindump) und das Tool erstellt eine strukturierte Zusammenfassung.\n\n"
            "Wenn der Benutzer sagt er möchte Anforderungen aufnehmen, Ideen sammeln, "
            "oder einen Braindump machen, nutze das summarize_requirements Tool."
        ),
        voice="echo",
        model="mini",  # Use mini model for cost-effective routing
        conversation_timeout=60.0,  # Longer timeout for tool usage
    )
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
