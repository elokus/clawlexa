"""
Benchmark mlx-audio TTS models for German speech.

Measures:
  - Time to first audio byte (TTFAB)
  - Total generation time
  - Real-time factor (RTF)

Plays each result so you can judge quality by ear.
"""

import time
import sys

import numpy as np
import sounddevice as sd

from mlx_audio.tts.utils import load_model


GERMAN_TEXT = (
    "Guten Tag, mein Name ist ein Sprachassistent. "
    "Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen. "
    "Wie kann ich Ihnen heute behilflich sein?"
)

MODELS: list[dict] = [
    {
        "name": "Qwen3-TTS-0.6B",
        "model_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16",
        "gen_kwargs": {
            "text": GERMAN_TEXT,
            "voice": "serena",
            "language": "German",
        },
    },
    {
        "name": "Chatterbox",
        "model_id": "mlx-community/chatterbox-fp16",
        "gen_kwargs": {
            "text": GERMAN_TEXT,
        },
    },
]


def run_benchmark(cfg: dict) -> None:
    name = cfg["name"]
    print(f"\n{'='*60}")
    print(f"  Model: {name}")
    print(f"  Text:  {cfg['gen_kwargs']['text'][:80]}...")
    print(f"{'='*60}\n")

    # --- Load model ---
    print(f"[{name}] Loading model: {cfg['model_id']} ...")
    t_load_start = time.perf_counter()
    model = load_model(cfg["model_id"])
    t_load = time.perf_counter() - t_load_start
    print(f"[{name}] Model loaded in {t_load:.2f}s")

    sample_rate = getattr(model, "sample_rate", 24000)
    print(f"[{name}] Sample rate: {sample_rate} Hz")

    # --- Generate ---
    print(f"[{name}] Generating ...")
    t_gen_start = time.perf_counter()
    t_first_byte = None
    audio_chunks: list[np.ndarray] = []

    for result in model.generate(**cfg["gen_kwargs"]):
        if t_first_byte is None:
            t_first_byte = time.perf_counter() - t_gen_start

        chunk = np.array(result.audio, dtype=np.float32)
        if chunk.ndim > 1:
            chunk = chunk.squeeze()
        audio_chunks.append(chunk)

    t_gen_total = time.perf_counter() - t_gen_start

    if not audio_chunks:
        print(f"[{name}] ERROR: No audio generated!")
        return

    audio = np.concatenate(audio_chunks)
    duration_s = len(audio) / sample_rate
    rtf = t_gen_total / duration_s if duration_s > 0 else float("inf")

    # --- Report ---
    print(f"\n[{name}] Results:")
    print(f"  Time to first audio byte: {t_first_byte*1000:.0f} ms")
    print(f"  Total generation time:    {t_gen_total:.2f} s")
    print(f"  Audio duration:           {duration_s:.2f} s")
    print(f"  Real-time factor (RTF):   {rtf:.3f}x  {'(faster than real-time)' if rtf < 1 else '(slower than real-time)'}")

    # --- Playback ---
    print(f"\n[{name}] Playing audio ...")
    # Normalize to prevent clipping
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.9

    sd.play(audio, samplerate=int(sample_rate))
    sd.wait()
    print(f"[{name}] Done.\n")


def main():
    selected = sys.argv[1] if len(sys.argv) > 1 else None

    for cfg in MODELS:
        if selected and selected.lower() not in cfg["name"].lower():
            continue
        try:
            run_benchmark(cfg)
        except Exception as e:
            print(f"\n[{cfg['name']}] FAILED: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
