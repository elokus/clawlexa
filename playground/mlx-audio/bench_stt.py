"""
Benchmark mlx-audio STT (Parakeet) for German speech recognition.

Uses the German test WAV files from packages/voice-runtime/data/test/.

Measures:
  - Model load time
  - Warm-up time (first inference, JIT compilation)
  - Transcription time per file
  - Real-time factor (RTF = transcription_time / audio_duration)
  - Word Error Rate (approximate, vs known transcript)

Usage:
    cd playground/mlx-audio
    uv run python bench_stt.py
    uv run python bench_stt.py --model mlx-community/parakeet-tdt-0.6b-v3
"""

import argparse
import json
import sys
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "packages" / "voice-runtime" / "data" / "test"

DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v3"

# ─── ANSI colors ─────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RED = "\033[31m"
GRAY = "\033[90m"


def load_test_turns() -> list[dict]:
    """Load test turn metadata from turns.json."""
    turns_file = DATA_DIR / "turns.json"
    if not turns_file.exists():
        print(f"{RED}Error: {turns_file} not found{RESET}")
        sys.exit(1)

    with open(turns_file) as f:
        data = json.load(f)

    turns = []
    for turn in data["turns"]:
        wav_path = DATA_DIR / turn["file_wav"]
        if wav_path.exists():
            turns.append({
                "id": turn["id"],
                "wav_path": str(wav_path),
                "transcript": turn["transcript"],
                "duration_sec": turn["duration_sec"],
            })
        else:
            print(f"{YELLOW}Warning: {wav_path} not found, skipping{RESET}")

    return turns


def simple_wer(reference: str, hypothesis: str) -> float:
    """Simple word error rate (no alignment, just word overlap)."""
    ref_words = reference.lower().strip().split()
    hyp_words = hypothesis.lower().strip().split()

    if not ref_words:
        return 0.0 if not hyp_words else 1.0

    # Simple Levenshtein at word level
    n = len(ref_words)
    m = len(hyp_words)
    dp = [[0] * (m + 1) for _ in range(n + 1)]

    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    return dp[n][m] / n


def run_benchmark(model_id: str):
    from mlx_audio.stt.utils import load_model

    turns = load_test_turns()
    if not turns:
        print(f"{RED}No test files found!{RESET}")
        sys.exit(1)

    print(f"\n{BOLD}{'=' * 70}{RESET}")
    print(f"{BOLD}  STT Benchmark: mlx-audio + Parakeet{RESET}")
    print(f"{BOLD}{'=' * 70}{RESET}")
    print(f"  {CYAN}Model:{RESET}      {model_id}")
    print(f"  {CYAN}Test files:{RESET} {len(turns)} German turns from voice-runtime")
    print(f"  {CYAN}Backend:{RESET}    mlx-audio (Apple MLX)")
    print(f"{BOLD}{'─' * 70}{RESET}\n")

    # ── Load model ──
    print(f"[1/3] Loading model...")
    t_load_start = time.perf_counter()
    model = load_model(model_id)
    t_load = time.perf_counter() - t_load_start
    print(f"  Model loaded in {t_load:.2f}s")

    # ── Warm-up (first inference is slow due to MLX JIT) ──
    print(f"\n[2/3] Warming up (first inference, JIT compilation)...")
    warmup_path = turns[0]["wav_path"]
    t_warmup_start = time.perf_counter()
    _ = model.generate(warmup_path)
    t_warmup = time.perf_counter() - t_warmup_start
    print(f"  Warm-up done in {t_warmup:.2f}s")

    # ── Benchmark each turn ──
    print(f"\n[3/3] Benchmarking {len(turns)} turns...\n")

    results = []
    for turn in turns:
        turn_id = turn["id"]
        wav_path = turn["wav_path"]
        expected = turn["transcript"]
        audio_dur = turn["duration_sec"]

        t_start = time.perf_counter()
        result = model.generate(wav_path)
        t_elapsed = time.perf_counter() - t_start

        hypothesis = result.text.strip()
        rtf = t_elapsed / audio_dur if audio_dur > 0 else float("inf")
        wer = simple_wer(expected, hypothesis)

        results.append({
            "turn_id": turn_id,
            "audio_dur": audio_dur,
            "transcribe_time": t_elapsed,
            "rtf": rtf,
            "wer": wer,
            "expected": expected,
            "hypothesis": hypothesis,
        })

        # Print result
        rtf_color = GREEN if rtf < 1.0 else RED
        wer_color = GREEN if wer < 0.15 else YELLOW if wer < 0.3 else RED

        print(f"  {BOLD}{turn_id}{RESET}")
        print(f"    Expected:    {DIM}{expected}{RESET}")
        print(f"    Transcribed: {hypothesis}")
        print(f"    Duration:    {audio_dur:.2f}s")
        print(f"    Transcribe:  {t_elapsed*1000:.0f}ms")
        print(f"    RTF:         {rtf_color}{rtf:.3f}x{RESET} {'(faster than real-time)' if rtf < 1 else '(slower than real-time)'}")
        print(f"    WER:         {wer_color}{wer:.1%}{RESET}")
        print()

    # ── Summary ──
    avg_rtf = sum(r["rtf"] for r in results) / len(results)
    avg_wer = sum(r["wer"] for r in results) / len(results)
    total_audio = sum(r["audio_dur"] for r in results)
    total_transcribe = sum(r["transcribe_time"] for r in results)

    print(f"{BOLD}{'─' * 70}{RESET}")
    print(f"{BOLD}  Summary{RESET}")
    print(f"{BOLD}{'─' * 70}{RESET}")
    print(f"  Model:                 {model_id}")
    print(f"  Backend:               mlx-audio (MLX)")
    print(f"  Model load time:       {t_load:.2f}s")
    print(f"  Warm-up time:          {t_warmup:.2f}s")
    print(f"  Total audio:           {total_audio:.2f}s")
    print(f"  Total transcribe time: {total_transcribe*1000:.0f}ms")
    print(f"  Average RTF:           {avg_rtf:.3f}x")
    print(f"  Average WER:           {avg_wer:.1%}")
    print(f"{BOLD}{'=' * 70}{RESET}\n")


def main():
    parser = argparse.ArgumentParser(description="Benchmark mlx-audio STT (Parakeet) for German")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"HuggingFace model ID (default: {DEFAULT_MODEL})",
    )
    args = parser.parse_args()
    run_benchmark(args.model)


if __name__ == "__main__":
    main()
