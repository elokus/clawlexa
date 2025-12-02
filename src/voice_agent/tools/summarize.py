"""Summarize Requirements Tool - Captures braindump and summarizes via LLM."""

import asyncio
import io
import os
import tempfile
import wave
from typing import Any

from openai import AsyncOpenAI

from .base import BaseTool, ToolResult
from ..audio import DEVICE_SAMPLE_RATE, CHANNELS


# Stop words that end the braindump capture (German + English)
STOP_WORDS = [
    "fertig",
    "das war's",
    "das wars",
    "ende",
    "zusammenfassen",
    "done",
    "that's it",
    "summarize",
    "finish",
]

# Silence detection settings
SILENCE_THRESHOLD_SECONDS = 3.0  # End after 3 seconds of silence
MAX_RECORDING_SECONDS = 120.0  # Maximum recording time


class SummarizeRequirementsTool(BaseTool):
    """Tool for capturing and summarizing requirements/braindumps.

    Flow:
    1. User triggers tool via realtime API function call
    2. Tool captures audio until stop word or long silence
    3. Audio is transcribed via Whisper
    4. Transcription is summarized via GPT-4
    5. Summary is returned for TTS output
    """

    name = "summarize_requirements"
    description = (
        "Capture and summarize requirements or ideas. "
        "User can speak freely (braindump) and the tool will create a structured summary. "
        "Use when user wants to dump thoughts, requirements, or ideas that need organization."
    )
    parameters = {
        "type": "object",
        "properties": {
            "context": {
                "type": "string",
                "description": "Optional context about what kind of summary is needed (e.g., 'project requirements', 'meeting notes', 'feature ideas')",
            },
            "language": {
                "type": "string",
                "description": "Language for the summary output (default: same as input)",
                "enum": ["german", "english", "auto"],
            },
        },
        "required": [],
    }

    def __init__(
        self,
        api_key: str | None = None,
        summary_model: str = "gpt-4o-mini",
        whisper_model: str = "whisper-1",
    ):
        """Initialize the summarize tool.

        Args:
            api_key: OpenAI API key (uses env var if not provided)
            summary_model: Model for summarization
            whisper_model: Model for transcription
        """
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.summary_model = summary_model
        self.whisper_model = whisper_model
        self._client: AsyncOpenAI | None = None

    @property
    def client(self) -> AsyncOpenAI:
        """Get or create the OpenAI client."""
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Execute the summarize requirements tool.

        Args:
            arguments: Tool arguments (context, language)

        Returns:
            ToolResult with the summarized text
        """
        context = arguments.get("context", "general requirements")
        language = arguments.get("language", "auto")

        self._status("Starting braindump capture. Speak freely, say 'fertig' or 'done' when finished...")

        # Capture audio
        try:
            audio_data = await self._capture_audio()
        except Exception as e:
            return ToolResult(
                success=False,
                output=f"Error capturing audio: {e}",
            )

        if not audio_data:
            return ToolResult(
                success=False,
                output="No audio captured. Please try again.",
            )

        self._status("Transcribing...")

        # Transcribe with Whisper
        try:
            transcript = await self._transcribe(audio_data)
        except Exception as e:
            return ToolResult(
                success=False,
                output=f"Error transcribing: {e}",
            )

        if not transcript.strip():
            return ToolResult(
                success=False,
                output="Could not transcribe any speech. Please try again.",
            )

        self._status("Summarizing...")

        # Summarize with LLM
        try:
            summary = await self._summarize(transcript, context, language)
        except Exception as e:
            return ToolResult(
                success=False,
                output=f"Error summarizing: {e}",
            )

        return ToolResult(
            success=True,
            output=summary,
            data={
                "transcript": transcript,
                "summary": summary,
                "context": context,
            },
        )

    async def _capture_audio(self) -> bytes:
        """Capture audio until stop word or silence.

        Uses the shared audio capture from the agent (already running).

        Returns:
            Raw PCM16 audio bytes
        """
        from ..audio import get_audio_level

        if self.audio_capture is None:
            raise RuntimeError("No audio capture available. Tool must be registered with agent.")

        audio_chunks: list[bytes] = []
        silence_start: float | None = None
        recording_start = asyncio.get_event_loop().time()

        while True:
            current_time = asyncio.get_event_loop().time()
            elapsed = current_time - recording_start

            # Check max recording time
            if elapsed > MAX_RECORDING_SECONDS:
                self._status("Maximum recording time reached.")
                break

            # Read audio chunk from shared capture
            chunk = self.audio_capture.read(timeout=0.1)
            if not chunk:
                await asyncio.sleep(0.01)
                continue

            audio_chunks.append(chunk)

            # Check audio level for silence detection
            level = get_audio_level(chunk)

            if level < 0.01:  # Silence threshold
                if silence_start is None:
                    silence_start = current_time
                elif current_time - silence_start > SILENCE_THRESHOLD_SECONDS:
                    self._status("Silence detected, ending capture.")
                    break
            else:
                silence_start = None

            await asyncio.sleep(0.001)

        return b"".join(audio_chunks)

    async def _transcribe(self, audio_data: bytes) -> str:
        """Transcribe audio using Whisper.

        Args:
            audio_data: PCM16 audio at device sample rate

        Returns:
            Transcribed text
        """
        # Create a WAV file in memory
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(CHANNELS)
            wav_file.setsampwidth(2)  # 16-bit = 2 bytes
            wav_file.setframerate(DEVICE_SAMPLE_RATE)
            wav_file.writeframes(audio_data)

        wav_buffer.seek(0)

        # Transcribe with Whisper
        response = await self.client.audio.transcriptions.create(
            model=self.whisper_model,
            file=("audio.wav", wav_buffer, "audio/wav"),
            response_format="text",
        )

        return response

    async def _summarize(
        self,
        transcript: str,
        context: str,
        language: str,
    ) -> str:
        """Summarize the transcript using GPT-4.

        Args:
            transcript: Raw transcript text
            context: Context for the summary
            language: Output language preference

        Returns:
            Structured summary
        """
        language_instruction = ""
        if language == "german":
            language_instruction = "Respond in German."
        elif language == "english":
            language_instruction = "Respond in English."
        else:
            language_instruction = "Respond in the same language as the input."

        system_prompt = f"""You are an expert at organizing and summarizing unstructured thoughts and requirements.

Your task is to take a raw transcript of someone's braindump/thoughts and create a clear, structured summary.

Context for this summary: {context}

{language_instruction}

Guidelines:
- Extract key points and requirements
- Organize into logical sections if appropriate
- Keep it concise but comprehensive
- Highlight any action items or decisions needed
- If there are unclear parts, note them as "needs clarification"

Format the output in a way that's easy to read aloud (will be converted to speech)."""

        response = await self.client.chat.completions.create(
            model=self.summary_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Please summarize this braindump:\n\n{transcript}"},
            ],
            temperature=0.3,
        )

        return response.choices[0].message.content or "Could not generate summary."
