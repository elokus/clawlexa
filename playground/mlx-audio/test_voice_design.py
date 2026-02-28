"""
Test Qwen3-TTS VoiceDesign model with German voice descriptions.

Usage:
    .venv/bin/python test_voice_design.py
    .venv/bin/python test_voice_design.py --play
"""

import argparse
import time

import numpy as np

from mlx_audio.tts.utils import load_model

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"

# Voice design prompts to test — describing a German native speaker
VOICE_DESIGNS = [
    (
        "DE male warm",
        "A native German male speaker with a warm, calm baritone voice. "
        "Natural German pronunciation with moderate pace.",
    ),
    (
        "DE female friendly",
        "A native German female speaker with a friendly, clear voice. "
        "Natural German pronunciation, slightly upbeat tone.",
    ),
    (
        "DE male assistant",
        "A native German male voice assistant. Professional, clear articulation, "
        "natural German accent. Medium pitch, moderate speaking speed.",
    ),
    (
        "DE female assistant",
        "A native German female voice assistant with a warm, professional tone. "
        "Clear pronunciation, natural German accent, calm and helpful.",
    ),
]

TEXTS = [
    ("short DE", "Wie spät ist es?"),
    ("medium DE", "Guten Tag, mein Name ist ein Sprachassistent. Wie kann ich Ihnen helfen?"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--play", action="store_true")
    parser.add_argument("--model", default=MODEL_ID)
    args = parser.parse_args()

    print(f"Loading {args.model} ...")
    t0 = time.perf_counter()
    model = load_model(args.model)
    sr = getattr(model, "sample_rate", 24000)
    print(f"Loaded in {time.perf_counter() - t0:.2f}s  (sample_rate={sr})\n")

    # warmup
    print("Warming up ...")
    t0 = time.perf_counter()
    for _ in model.generate(
        text="Hi.",
        instruct="A male voice.",
        lang_code="auto",
    ):
        pass
    print(f"Warmup done in {time.perf_counter() - t0:.2f}s\n")

    if args.play:
        import sounddevice as sd

    for voice_name, voice_desc in VOICE_DESIGNS:
        print(f"{'='*60}")
        print(f"  Voice: {voice_name}")
        print(f"  Desc:  {voice_desc[:70]}...")
        print(f"{'='*60}")

        for text_name, text in TEXTS:
            print(f"\n  [{text_name}] \"{text}\"")

            t_start = time.perf_counter()
            t_first = None
            chunks = []
            chunk_count = 0

            try:
                for result in model.generate(
                    text=text,
                    instruct=voice_desc,
                    lang_code="German",
                    stream=True,
                    streaming_interval=1.0,
                    temperature=0.9,
                ):
                    if t_first is None:
                        t_first = time.perf_counter() - t_start

                    audio = np.array(result.audio, dtype=np.float32)
                    if audio.ndim > 1:
                        audio = audio.squeeze()
                    chunks.append(audio)
                    chunk_count += 1

                t_total = time.perf_counter() - t_start
                full_audio = np.concatenate(chunks)
                dur = len(full_audio) / sr

                print(f"    OK  TTFAB={t_first*1000:.0f}ms  total={t_total*1000:.0f}ms  "
                      f"audio={dur:.2f}s  chunks={chunk_count}")

                if args.play:
                    print(f"    Playing ...")
                    sd.play(full_audio, samplerate=sr)
                    sd.wait()

            except Exception as e:
                print(f"    FAIL  {type(e).__name__}: {e}")

        print()


if __name__ == "__main__":
    main()
