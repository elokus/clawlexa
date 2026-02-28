"""
A/B benchmark: Kokoro ONNX-CPU vs CoreML/ANE.

Downloads model files on first run. Runs the same text through both
backends and compares TTFAB, total time, and RTF.

Usage:
    uv run python bench.py
    uv run python bench.py "Custom text to synthesize"
    uv run python bench.py --voice af_bella --rounds 5
    uv run python bench.py --engine coreml  # single engine only
"""

import argparse
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

SAMPLE_RATE = 24000

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

DEFAULT_TEXT = (
    "Hello, my name is a voice assistant. "
    "I was designed to help you with various tasks. "
    "How can I help you today?"
)


def download_if_missing(url: str, dest: Path):
    if dest.exists():
        return
    print(f"[download] {dest.name} ...")
    urllib.request.urlretrieve(url, dest)
    print(f"[download] {dest.name} done ({dest.stat().st_size / 1e6:.1f} MB)")


def create_model(model_path: str, voices_path: str, engine: str) -> Kokoro:
    """Create Kokoro model with specified backend."""
    if engine == "coreml":
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    else:
        providers = ["CPUExecutionProvider"]

    session = ort.InferenceSession(model_path, providers=providers)
    model = Kokoro.from_session(session, voices_path)

    actual = model.sess.get_providers()
    print(f"  [{engine}] Active providers: {actual}")
    return model


def bench_single(model: Kokoro, text: str, voice: str, speed: float, lang: str):
    """Run one inference and return timing dict."""
    t_start = time.perf_counter()

    samples, sr = model.create(text, voice=voice, speed=speed, lang=lang)

    t_total = time.perf_counter() - t_start

    audio = np.array(samples, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.squeeze()

    duration_s = len(audio) / sr
    rtf = t_total / duration_s if duration_s > 0 else float("inf")

    return {
        "total_ms": round(t_total * 1000),
        "audio_duration_ms": round(duration_s * 1000),
        "rtf": round(rtf, 3),
        "samples": len(audio),
        "audio": audio,
        "sr": sr,
    }


def bench_streaming(model: Kokoro, text: str, voice: str, speed: float, lang: str):
    """Run one streaming inference and return timing dict."""
    import asyncio

    async def _run():
        t_start = time.perf_counter()
        t_first = None
        total_samples = 0
        chunks = 0

        stream = model.create_stream(text, voice=voice, speed=speed, lang=lang)
        async for samples, sr in stream:
            if t_first is None:
                t_first = time.perf_counter() - t_start
            audio = np.array(samples, dtype=np.float32)
            if audio.ndim > 1:
                audio = audio.squeeze()
            total_samples += len(audio)
            chunks += 1

        t_total = time.perf_counter() - t_start
        duration_s = total_samples / SAMPLE_RATE

        return {
            "ttfab_ms": round((t_first or t_total) * 1000),
            "total_ms": round(t_total * 1000),
            "audio_duration_ms": round(duration_s * 1000),
            "rtf": round(t_total / duration_s, 3) if duration_s > 0 else None,
            "chunks": chunks,
        }

    return asyncio.run(_run())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?", default=DEFAULT_TEXT)
    parser.add_argument(
        "--engine",
        default="both",
        choices=["both", "onnx-cpu", "coreml"],
    )
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--lang", default="en-us")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--save-audio", action="store_true", help="Save output WAVs")
    parser.add_argument("--stream", action="store_true", help="Benchmark streaming mode")
    args = parser.parse_args()

    model_dir = Path(__file__).parent
    model_path = model_dir / "kokoro-v1.0.onnx"
    voices_path = model_dir / "voices-v1.0.bin"

    download_if_missing(MODEL_URL, model_path)
    download_if_missing(VOICES_URL, voices_path)

    print(f"\nAvailable ONNX providers: {ort.get_available_providers()}")
    print(f"Text: {args.text[:80]}{'...' if len(args.text) > 80 else ''}")
    print(f"Voice: {args.voice}  Lang: {args.lang}  Rounds: {args.rounds}")
    if args.stream:
        print("Mode: streaming")
    print()

    engines = (
        ["onnx-cpu", "coreml"] if args.engine == "both" else [args.engine]
    )

    # check CoreML availability
    if "coreml" in engines and "CoreMLExecutionProvider" not in ort.get_available_providers():
        print("CoreMLExecutionProvider not available in this onnxruntime build.")
        print("Install with: pip install onnxruntime  (arm64 macOS includes CoreML EP)")
        if args.engine == "both":
            engines = ["onnx-cpu"]
        else:
            return

    results: dict[str, list[dict]] = {}

    for engine in engines:
        print(f"{'='*60}")
        print(f"Engine: {engine}")
        print(f"{'='*60}")

        model = create_model(str(model_path), str(voices_path), engine)

        # warmup
        print("  [warmup] ...", end="", flush=True)
        _ = model.create("Hi.", voice=args.voice, speed=1.0, lang=args.lang)
        print(" done")

        engine_results = []
        for i in range(args.rounds):
            if args.stream:
                r = bench_streaming(model, args.text, args.voice, args.speed, args.lang)
                print(
                    f"  round {i+1}: TTFAB={r['ttfab_ms']}ms  "
                    f"total={r['total_ms']}ms  "
                    f"audio={r['audio_duration_ms']}ms  "
                    f"RTF={r['rtf']}x  "
                    f"chunks={r['chunks']}"
                )
            else:
                r = bench_single(model, args.text, args.voice, args.speed, args.lang)
                print(
                    f"  round {i+1}: total={r['total_ms']}ms  "
                    f"audio={r['audio_duration_ms']}ms  "
                    f"RTF={r['rtf']}x"
                )
                if args.save_audio and i == 0:
                    out_file = f"output_{engine}.wav"
                    sf.write(out_file, r["audio"], r["sr"])
                    print(f"    saved: {out_file}")

            engine_results.append(r)

        results[engine] = engine_results
        del model
        print()

    # summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")

    for engine, rounds in results.items():
        if args.stream:
            ttfabs = [r["ttfab_ms"] for r in rounds]
            totals = [r["total_ms"] for r in rounds]
            rtfs = [r["rtf"] for r in rounds if r["rtf"] is not None]
            print(f"\n  {engine}:")
            print(f"    TTFAB:  min={min(ttfabs)}ms  avg={sum(ttfabs)//len(ttfabs)}ms  max={max(ttfabs)}ms")
            print(f"    Total:  min={min(totals)}ms  avg={sum(totals)//len(totals)}ms  max={max(totals)}ms")
            if rtfs:
                print(f"    RTF:    min={min(rtfs)}x  avg={round(sum(rtfs)/len(rtfs), 3)}x  max={max(rtfs)}x")
        else:
            totals = [r["total_ms"] for r in rounds]
            rtfs = [r["rtf"] for r in rounds]
            print(f"\n  {engine}:")
            print(f"    Total:  min={min(totals)}ms  avg={sum(totals)//len(totals)}ms  max={max(totals)}ms")
            print(f"    RTF:    min={min(rtfs)}x  avg={round(sum(rtfs)/len(rtfs), 3)}x  max={max(rtfs)}x")

    if len(results) == 2:
        e1, e2 = list(results.keys())
        avg1 = sum(r["total_ms"] for r in results[e1]) / len(results[e1])
        avg2 = sum(r["total_ms"] for r in results[e2]) / len(results[e2])
        faster = e1 if avg1 < avg2 else e2
        speedup = max(avg1, avg2) / min(avg1, avg2)
        print(f"\n  {faster} is {speedup:.1f}x faster")


if __name__ == "__main__":
    main()
