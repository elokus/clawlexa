from __future__ import annotations

from .types import TtsGenerationPlan

QWEN_MODEL_PRESETS: dict[str, str] = {
    "qwen3-0.6b": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "qwen3-0.6b-8bit": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
    "qwen3-0.6b-4bit": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    "qwen3-1.7b": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "qwen3-1.7b-vd": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
}

# Derived from the provided log sample:
# total audio = (6 * 0.96s + 0.48s) = 6.24s
# words = 16
# ms/word = 6240 / 16 = 390ms
QWEN_SYNTHETIC_WORD_MS_PER_WORD = 390


def resolve_qwen_model_id(model_id: str) -> str:
    key = model_id.strip().lower()
    return QWEN_MODEL_PRESETS.get(key, model_id)


def is_voice_design_model(model_id: str) -> bool:
    value = model_id.lower()
    return "voicedesign" in value or "voice-design" in value


def normalize_qwen_language(language: str) -> str:
    value = language.strip().lower()
    if value in {"de", "de-de", "german", "deutsch"}:
        return "German"
    if value in {"en", "en-us", "english"}:
        return "English"
    return language


def build_plan(
    *,
    model_id: str,
    text: str,
    voice: str | None,
    language: str,
    temperature: float,
    instruct: str | None,
    qwen_ref_audio: str | None,
    qwen_ref_text: str,
    qwen_voice_design_instruct: str,
) -> TtsGenerationPlan:
    normalized_language = normalize_qwen_language(language)

    if is_voice_design_model(model_id):
        prompt = (
            (instruct or "").strip()
            or (voice or "").strip()
            or qwen_voice_design_instruct
        )
        return {
            "method": "generate_voice_design",
            "kwargs": {
                "text": text,
                "instruct": prompt,
                "language": normalized_language,
                "temperature": temperature,
            },
        }

    kwargs: dict[str, object] = {
        "text": text,
        "lang_code": normalized_language,
        "temperature": temperature,
        "split_pattern": "",
    }
    if qwen_ref_audio:
        kwargs["ref_audio"] = qwen_ref_audio
        kwargs["ref_text"] = qwen_ref_text

    return {
        "method": "generate",
        "kwargs": kwargs,
    }
