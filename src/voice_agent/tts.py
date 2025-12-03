"""Text-to-Speech using OpenAI TTS API."""

import asyncio
import os
from typing import AsyncIterator

from openai import AsyncOpenAI


# OpenAI TTS outputs 24kHz PCM by default with pcm format
TTS_SAMPLE_RATE = 24000


class TTSClient:
    """Client for OpenAI TTS API - much cheaper than realtime for tool outputs."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o-mini-tts",  # tts-1 is fast and cheap, tts-1-hd for quality
        voice: str = "echo",
        instructions: str = "Speak in a cheerful and positive tone.",
    ):
        """Initialize TTS client.

        Args:
            api_key: OpenAI API key (uses env var if not provided)
            model: TTS model (tts-1 or tts-1-hd)
            voice: Voice to use (alloy, echo, fable, onyx, nova, shimmer)
            instructions: Global instructions for speech style/tone
        """
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self._client: AsyncOpenAI | None = None

    @property
    def client(self) -> AsyncOpenAI:
        """Get or create the OpenAI client."""
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client

    async def synthesize(self, text: str) -> bytes:
        """Synthesize text to speech.

        Args:
            text: Text to synthesize

        Returns:
            PCM16 audio bytes at 24kHz
        """
        response = await self.client.audio.speech.create(
            model=self.model,
            voice=self.voice,
            input=text,
            instructions=self.instructions,
            response_format="pcm",  # Raw PCM16 at 24kHz
        )

        # Read all content
        return response.content

    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text to speech with streaming.

        Args:
            text: Text to synthesize

        Yields:
            PCM16 audio chunks at 24kHz
        """
        async with self.client.audio.speech.with_streaming_response.create(
            model=self.model,
            voice=self.voice,
            input=text,
            instructions=self.instructions,
            response_format="pcm",
        ) as response:
            async for chunk in response.iter_bytes(chunk_size=4096):
                yield chunk
