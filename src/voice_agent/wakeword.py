"""Wake word detection using openwakeword."""

import os

import numpy as np
import openwakeword
from openwakeword.model import Model

# openwakeword expects 16kHz audio
WAKEWORD_SAMPLE_RATE = 16000
WAKEWORD_CHUNK_SIZE = 1280  # 80ms at 16kHz (recommended by openwakeword)

# Map wake word names to model files
WAKE_WORD_MODELS = {
    "alexa": "alexa_v0.1.onnx",
    "hey_jarvis": "hey_jarvis_v0.1.onnx",
    "hey_mycroft": "hey_mycroft_v0.1.onnx",
    "hey_marvin": "hey_marvin_v0.1.onnx",
    "timer": "timer_v0.1.onnx",
    "weather": "weather_v0.1.onnx",
}


def get_model_path(wake_word: str) -> str:
    """Get the full path to a wake word model file."""
    pkg_dir = os.path.dirname(openwakeword.__file__)
    models_dir = os.path.join(pkg_dir, "resources", "models")
    model_file = WAKE_WORD_MODELS.get(wake_word)
    if not model_file:
        raise ValueError(f"Unknown wake word: {wake_word}. Options: {list(WAKE_WORD_MODELS.keys())}")
    return os.path.join(models_dir, model_file)


class WakeWordDetector:
    """Detects wake words using openwakeword."""

    def __init__(
        self,
        wake_word: str = "hey_jarvis",
        threshold: float = 0.5,
    ):
        """
        Initialize wake word detector.

        Args:
            wake_word: Wake word to detect. Options: alexa, hey_mycroft,
                       hey_jarvis, hey_marvin, timer, weather
            threshold: Detection threshold (0-1). Higher = fewer false positives.
        """
        self.wake_word = wake_word
        self.threshold = threshold
        model_path = get_model_path(wake_word)
        self.model = Model(wakeword_model_paths=[model_path])
        # The model key is based on filename without extension
        self._model_key = os.path.splitext(os.path.basename(model_path))[0]

    def process_audio(self, audio_chunk: bytes) -> float:
        """
        Process audio chunk and return wake word confidence score.

        Args:
            audio_chunk: PCM16 audio bytes at 16kHz

        Returns:
            Confidence score (0-1) for wake word detection
        """
        # Convert bytes to int16 numpy array
        audio_data = np.frombuffer(audio_chunk, dtype=np.int16)

        # Run prediction
        prediction = self.model.predict(audio_data)

        # Get score for our wake word (key is model filename without extension)
        score = prediction.get(self._model_key, 0.0)
        return score

    def detected(self, audio_chunk: bytes) -> bool:
        """
        Check if wake word was detected in audio chunk.

        Args:
            audio_chunk: PCM16 audio bytes at 16kHz

        Returns:
            True if wake word detected above threshold
        """
        score = self.process_audio(audio_chunk)
        return score >= self.threshold

    def reset(self) -> None:
        """Reset the detector state."""
        self.model.reset()


class MultiWakeWordDetector:
    """Detects multiple wake words simultaneously using openwakeword."""

    def __init__(
        self,
        wake_words: list[str],
        threshold: float = 0.5,
    ):
        """
        Initialize multi-wake-word detector.

        Args:
            wake_words: List of wake words to detect. Options: alexa, hey_mycroft,
                       hey_jarvis, hey_marvin, timer, weather
            threshold: Detection threshold (0-1). Higher = fewer false positives.
        """
        self.wake_words = wake_words
        self.threshold = threshold

        # Load all models
        model_paths = [get_model_path(ww) for ww in wake_words]
        self.model = Model(wakeword_model_paths=model_paths)

        # Map model keys to wake word names
        self._key_to_wake_word = {}
        for ww in wake_words:
            model_file = WAKE_WORD_MODELS[ww]
            model_key = os.path.splitext(model_file)[0]
            self._key_to_wake_word[model_key] = ww

    def process_audio(self, audio_chunk: bytes) -> dict[str, float]:
        """
        Process audio chunk and return confidence scores for all wake words.

        Args:
            audio_chunk: PCM16 audio bytes at 16kHz

        Returns:
            Dict mapping wake word names to confidence scores (0-1)
        """
        # Convert bytes to int16 numpy array
        audio_data = np.frombuffer(audio_chunk, dtype=np.int16)

        # Run prediction
        prediction = self.model.predict(audio_data)

        # Map model keys back to wake word names
        scores = {}
        for model_key, score in prediction.items():
            if model_key in self._key_to_wake_word:
                scores[self._key_to_wake_word[model_key]] = score

        return scores

    def detected(self, audio_chunk: bytes) -> str | None:
        """
        Check if any wake word was detected in audio chunk.

        Args:
            audio_chunk: PCM16 audio bytes at 16kHz

        Returns:
            Name of detected wake word, or None if none detected
        """
        scores = self.process_audio(audio_chunk)

        # Find the highest scoring wake word above threshold
        best_word = None
        best_score = self.threshold

        for wake_word, score in scores.items():
            if score >= best_score:
                best_score = score
                best_word = wake_word

        return best_word

    def reset(self) -> None:
        """Reset the detector state."""
        self.model.reset()


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
