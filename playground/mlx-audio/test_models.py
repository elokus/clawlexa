"""
Test Chatterbox Turbo and Spark TTS models before serving.

Usage:
    .venv/bin/python test_models.py
    .venv/bin/python test_models.py --model chatterbox-turbo
    .venv/bin/python test_models.py --model spark
    .venv/bin/python test_models.py --play   # play audio after generation
"""

import argparse
import io
import time
import sys

import mlx.core as mx
import numpy as np
import soundfile as sf

from mlx_audio.tts.utils import load_model


MODELS = {
    "chatterbox-turbo": "mlx-community/chatterbox-turbo-fp16",
    "spark": "mlx-community/Spark-TTS-0.5B-bf16",
}

TESTS = {
    "chatterbox-turbo": [
        # (description, kwargs)
        ("short DE text", {
            "text": "Wie spät ist es?",
            "temperature": 0.8,
        }),
        ("short EN text", {
            "text": "Hello, how are you?",
            "temperature": 0.8,
        }),
        ("long DE text", {
            "text": "Guten Tag, mein Name ist ein Sprachassistent. Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen.",
            "temperature": 0.8,
        }),
        ("streaming short", {
            "text": "Wie spät ist es?",
            "stream": True,
            "streaming_interval": 1.0,
        }),
        ("streaming long", {
            "text": "Guten Tag, mein Name ist ein Sprachassistent. Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen.",
            "stream": True,
            "streaming_interval": 1.0,
        }),
    ],
    "spark": [
        ("male moderate", {
            "text": "Wie spät ist es?",
            "gender": "male",
            "pitch": 1.0,
            "speed": 1.0,
        }),
        ("female moderate", {
            "text": "Wie spät ist es?",
            "gender": "female",
            "pitch": 1.0,
            "speed": 1.0,
        }),
        ("male EN", {
            "text": "Hello, how are you?",
            "gender": "male",
        }),
        ("long DE male", {
            "text": "Guten Tag, mein Name ist ein Sprachassistent. Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen.",
            "gender": "male",
        }),
    ],
}


def test_model(model_key: str, play: bool = False):
    model_id = MODELS[model_key]
    print(f"\n{'='*60}")
    print(f"  Loading: {model_id}")
    print(f"{'='*60}")

    t0 = time.perf_counter()
    model = load_model(model_id)
    load_time = time.perf_counter() - t0
    sr = getattr(model, "sample_rate", 24000)
    print(f"  Loaded in {load_time:.2f}s  (sample_rate={sr})")

    # warmup
    print("  Warming up ...")
    t0 = time.perf_counter()
    warmup_kwargs = TESTS[model_key][0][1].copy()
    warmup_kwargs["text"] = "Hi."
    try:
        for _ in model.generate(**warmup_kwargs):
            pass
        print(f"  Warmup done in {time.perf_counter() - t0:.2f}s")
    except Exception as e:
        print(f"  Warmup FAILED: {e}")
        # continue to tests anyway

    print()
    results = []

    for desc, kwargs in TESTS[model_key]:
        print(f"  Test: {desc}")
        print(f"    kwargs: { {k: v for k, v in kwargs.items() if k != 'text'} }")
        print(f"    text: \"{kwargs['text'][:60]}...\"" if len(kwargs.get('text','')) > 60 else f"    text: \"{kwargs.get('text','')}\"")

        t_start = time.perf_counter()
        t_first = None
        chunks = []
        chunk_count = 0
        is_streaming = kwargs.get("stream", False)

        try:
            for result in model.generate(**kwargs):
                if t_first is None:
                    t_first = time.perf_counter() - t_start

                audio = np.array(result.audio, dtype=np.float32)
                if audio.ndim > 1:
                    audio = audio.squeeze()
                chunks.append(audio)
                chunk_count += 1

                if is_streaming:
                    chunk_dur = len(audio) / sr
                    elapsed = (time.perf_counter() - t_start) * 1000
                    print(f"      chunk {chunk_count}: {len(audio)} samples ({chunk_dur:.2f}s) @ {elapsed:.0f}ms")

            t_total = time.perf_counter() - t_start

            if chunks:
                full_audio = np.concatenate(chunks)
                audio_dur = len(full_audio) / sr
                print(f"    OK  TTFAB={t_first*1000:.0f}ms  total={t_total*1000:.0f}ms  "
                      f"audio={audio_dur:.2f}s  chunks={chunk_count}  "
                      f"RTF={t_total/audio_dur:.3f}x")
                results.append((desc, True, full_audio, sr))

                if play:
                    import sounddevice as sd
                    print(f"    Playing ({sr} Hz) ...")
                    sd.play(full_audio, samplerate=sr)
                    sd.wait()
            else:
                print(f"    FAIL  No audio generated")
                results.append((desc, False, None, sr))

        except Exception as e:
            t_total = time.perf_counter() - t_start
            print(f"    FAIL  ({t_total*1000:.0f}ms) {type(e).__name__}: {e}")
            results.append((desc, False, None, sr))

        print()

    # summary
    print(f"\n{'─'*60}")
    print(f"  Summary: {model_key} ({model_id})")
    print(f"{'─'*60}")
    passed = sum(1 for _, ok, _, _ in results if ok)
    failed = sum(1 for _, ok, _, _ in results if not ok)
    for desc, ok, _, _ in results:
        print(f"    {'PASS' if ok else 'FAIL'}  {desc}")
    print(f"\n  {passed} passed, {failed} failed")

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=list(MODELS.keys()), default=None,
                        help="Test specific model (default: test all)")
    parser.add_argument("--play", action="store_true", help="Play audio after each test")
    args = parser.parse_args()

    models_to_test = [args.model] if args.model else list(MODELS.keys())

    all_results = {}
    for m in models_to_test:
        all_results[m] = test_model(m, play=args.play)

    if len(all_results) > 1:
        print(f"\n{'='*60}")
        print(f"  Overall Summary")
        print(f"{'='*60}")
        for m, results in all_results.items():
            passed = sum(1 for _, ok, _, _ in results if ok)
            total = len(results)
            print(f"  {m}: {passed}/{total} passed")


if __name__ == "__main__":
    main()
