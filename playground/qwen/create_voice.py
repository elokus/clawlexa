"""
Create a reference voice using VoiceDesign, then save as WAV for clone use.

Generates a cheerful, excited voice via natural language description,
then writes it to a WAV file that can be used as ref_audio for the Base model.

Usage:
    uv run python create_voice.py
    uv run python create_voice.py --instruct "A warm, deep male voice with calm tone."
    uv run python create_voice.py --output my_voice.wav --text "Custom reference text"
"""

import argparse
import time

import mlx.core as mx
import numpy as np
import soundfile as sf

from mlx_audio.tts.utils import load_model


DEFAULT_INSTRUCT = (
    "A cheerful, excited young female voice with high pitch, "
    "energetic and enthusiastic tone, and slightly fast speaking pace. "
    "Bright and expressive with a warm, friendly quality."
)

DEFAULT_REF_TEXT = (
    "Oh wow, this is so exciting! I can't believe how amazing this turned out. "
    "Every single detail is just perfect, and I'm absolutely thrilled to share "
    "this with you today!"
)

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit"


def main():
    parser = argparse.ArgumentParser(description="Create a reference voice via VoiceDesign")
    parser.add_argument("--model", default=MODEL_ID, help=f"Model ID (default: {MODEL_ID})")
    parser.add_argument("--instruct", default=DEFAULT_INSTRUCT, help="Voice description")
    parser.add_argument("--text", default=DEFAULT_REF_TEXT, help="Text to speak for reference")
    parser.add_argument("--language", default="English", help="Language (default: English)")
    parser.add_argument("--output", default="ref_voice.wav", help="Output WAV path")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--temperature", type=float, default=0.7, help="Sampling temperature")
    args = parser.parse_args()

    print(f"[load] Loading {args.model} ...")
    t0 = time.perf_counter()
    model = load_model(args.model)
    sample_rate = getattr(model, "sample_rate", 24000)
    print(f"[load] Done in {time.perf_counter() - t0:.2f}s (sample_rate={sample_rate})")

    print(f"\n[design] Instruct: {args.instruct}")
    print(f"[design] Text: {args.text[:80]}...")
    print(f"[design] Language: {args.language}  Seed: {args.seed}  Temp: {args.temperature}")

    mx.random.seed(args.seed)

    t_start = time.perf_counter()
    chunks: list[np.ndarray] = []

    for result in model.generate_voice_design(
        text=args.text,
        instruct=args.instruct,
        language=args.language,
        temperature=args.temperature,
    ):
        chunk = np.array(result.audio, dtype=np.float32)
        if chunk.ndim > 1:
            chunk = chunk.squeeze()
        chunks.append(chunk)

    t_total = time.perf_counter() - t_start

    if not chunks:
        print("[error] No audio generated!")
        return

    audio = np.concatenate(chunks)
    duration_s = len(audio) / sample_rate

    # Normalize
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.9

    sf.write(args.output, audio, sample_rate, format="WAV")

    print(f"\n{'─'*50}")
    print(f"Output:         {args.output}")
    print(f"Duration:       {duration_s:.2f}s")
    print(f"Gen time:       {t_total:.2f}s")
    print(f"RTF:            {t_total / duration_s:.3f}x")
    print(f"Sample rate:    {sample_rate} Hz")
    print(f"\nUse as clone reference:")
    print(f"  uv run python server_clone_stream.py --ref-audio {args.output} --ref-text \"{args.text}\"")


if __name__ == "__main__":
    main()
