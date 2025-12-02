"""Audio capture and playback using PyAudio."""

import base64
import queue
import sys
import threading

import numpy as np
import pyaudio


def _log(msg: str) -> None:
    """Print with immediate flush."""
    print(msg, file=sys.stderr, flush=True)


# Jabra Speak2 55 operates at 16kHz
DEVICE_SAMPLE_RATE = 16000
# OpenAI Realtime API expects 24kHz PCM16 mono
API_SAMPLE_RATE = 24000
CHANNELS = 1
# 100ms chunks at device rate
CHUNK_SIZE = 1600  # 100ms at 16kHz
FORMAT = pyaudio.paInt16


def resample_audio(audio_data: bytes, from_rate: int, to_rate: int) -> bytes:
    """
    Resample audio data from one sample rate to another.

    Args:
        audio_data: PCM16 audio bytes
        from_rate: Source sample rate
        to_rate: Target sample rate

    Returns:
        Resampled PCM16 audio bytes
    """
    if from_rate == to_rate:
        return audio_data

    # Convert to numpy array
    samples = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32)

    # Calculate new length
    new_length = int(len(samples) * to_rate / from_rate)

    # Simple linear interpolation resampling
    indices = np.linspace(0, len(samples) - 1, new_length)
    resampled = np.interp(indices, np.arange(len(samples)), samples)

    # Convert back to int16 bytes
    return resampled.astype(np.int16).tobytes()


class AudioCapture:
    """Captures audio from microphone and provides PCM16 chunks."""

    def __init__(
        self,
        device_sample_rate: int = DEVICE_SAMPLE_RATE,
        api_sample_rate: int = API_SAMPLE_RATE,
        channels: int = CHANNELS,
        chunk_size: int = CHUNK_SIZE,
    ):
        self.device_sample_rate = device_sample_rate
        self.api_sample_rate = api_sample_rate
        self.channels = channels
        self.chunk_size = chunk_size
        self.audio = pyaudio.PyAudio()
        self.stream = None
        self._running = False
        self._buffer = queue.Queue()

    def _find_jabra_device(self) -> int | None:
        """Find Jabra speaker device index."""
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if "jabra" in info["name"].lower() and info["maxInputChannels"] > 0:
                return i
        return None

    def start(self) -> None:
        """Start capturing audio."""
        if self._running:
            return

        device_index = self._find_jabra_device()
        if device_index is not None:
            _log(f"Using Jabra device (index {device_index})")
        else:
            _log("Jabra not found, using default input device")

        self.stream = self.audio.open(
            format=FORMAT,
            channels=self.channels,
            rate=self.device_sample_rate,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=self.chunk_size,
            stream_callback=self._audio_callback,
        )
        self._running = True
        self.stream.start_stream()

    def _audio_callback(self, in_data, frame_count, time_info, status):
        """Callback for audio stream - puts data in buffer."""
        if self._running:
            self._buffer.put(in_data)
        return (None, pyaudio.paContinue)

    def read(self, timeout: float = 0.1) -> bytes | None:
        """Read a chunk of audio data at device sample rate."""
        try:
            return self._buffer.get(timeout=timeout)
        except queue.Empty:
            return None

    def read_for_api(self, timeout: float = 0.1) -> bytes | None:
        """Read a chunk and resample to API sample rate (24kHz)."""
        data = self.read(timeout)
        if data:
            return resample_audio(data, self.device_sample_rate, self.api_sample_rate)
        return None

    def read_base64(self, timeout: float = 0.1) -> str | None:
        """Read a chunk, resample to 24kHz, and return as base64."""
        data = self.read_for_api(timeout)
        if data:
            return base64.b64encode(data).decode("ascii")
        return None

    def stop(self) -> None:
        """Stop capturing audio."""
        self._running = False
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None
        # Clear buffer
        while not self._buffer.empty():
            try:
                self._buffer.get_nowait()
            except queue.Empty:
                break

    def close(self) -> None:
        """Clean up resources."""
        self.stop()
        self.audio.terminate()


class AudioPlayer:
    """Plays PCM16 audio through speakers."""

    def __init__(
        self,
        device_sample_rate: int = DEVICE_SAMPLE_RATE,
        api_sample_rate: int = API_SAMPLE_RATE,
        channels: int = CHANNELS,
    ):
        self.device_sample_rate = device_sample_rate
        self.api_sample_rate = api_sample_rate
        self.channels = channels
        self.audio = pyaudio.PyAudio()
        self.stream = None
        self._buffer = queue.Queue()
        self._running = False
        self._thread = None

    def _find_jabra_device(self) -> int | None:
        """Find Jabra speaker device index."""
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if "jabra" in info["name"].lower() and info["maxOutputChannels"] > 0:
                return i
        return None

    def start(self) -> None:
        """Start the audio player."""
        if self._running:
            return

        device_index = self._find_jabra_device()
        if device_index is not None:
            _log(f"Using Jabra for playback (index {device_index})")
        else:
            _log("Jabra not found, using default output device")

        self.stream = self.audio.open(
            format=FORMAT,
            channels=self.channels,
            rate=self.device_sample_rate,
            output=True,
            output_device_index=device_index,
            frames_per_buffer=CHUNK_SIZE,
        )
        self._running = True
        self._thread = threading.Thread(target=self._playback_loop, daemon=True)
        self._thread.start()

    def _playback_loop(self) -> None:
        """Background thread for audio playback."""
        while self._running:
            try:
                data = self._buffer.get(timeout=0.1)
                if self.stream and self._running:
                    self.stream.write(data)
            except queue.Empty:
                continue

    def play(self, audio_data: bytes) -> None:
        """Queue audio data for playback (resamples from API rate to device rate)."""
        # Resample from 24kHz (API) to 16kHz (device)
        resampled = resample_audio(audio_data, self.api_sample_rate, self.device_sample_rate)
        self._buffer.put(resampled)

    def play_base64(self, base64_audio: str) -> None:
        """Queue base64-encoded audio for playback."""
        audio_data = base64.b64decode(base64_audio)
        self.play(audio_data)

    def clear(self) -> None:
        """Clear the playback buffer (for interruptions)."""
        while not self._buffer.empty():
            try:
                self._buffer.get_nowait()
            except queue.Empty:
                break

    def stop(self) -> None:
        """Stop playback."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None

    def close(self) -> None:
        """Clean up resources."""
        self.stop()
        self.audio.terminate()


def get_audio_level(audio_data: bytes) -> float:
    """Calculate RMS audio level from PCM16 data."""
    if not audio_data:
        return 0.0
    # Convert bytes to int16 array
    samples = np.frombuffer(audio_data, dtype=np.int16)
    if len(samples) == 0:
        return 0.0
    # Calculate RMS
    rms = np.sqrt(np.mean(samples.astype(np.float32) ** 2))
    # Normalize to 0-1 range
    return min(rms / 32768.0, 1.0)
