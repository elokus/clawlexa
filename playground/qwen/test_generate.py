"""
Generate full audio and save to WAV for inspection.

Usage:
    uv run python test_generate.py
    uv run python test_generate.py --text "Kurzer Test"
    uv run python test_generate.py --no-ref    # without voice cloning (speaker embed only)
"""

import argparse
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
import soundfile as sf

from mlx_audio.tts.utils import load_model

SCRIPT_DIR = Path(__file__).parent
VOICES_DIR = SCRIPT_DIR.parent / "mlx-audio" / "voices"
DEFAULT_REF_VOICE = VOICES_DIR / "ref_male_warm.wav"
DEFAULT_REF_TEXT = (
    "Willkommen bei unserem Service. Mein Name ist Jarvis und ich bin hier, "
    "um Ihnen bei allen Fragen weiterzuhelfen. Fragen Sie mich einfach."
)

DEFAULT_TEXT = (
    "Guten Tag, mein Name ist ein Sprachassistent. "
    "Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen. "
    "Wie kann ich Ihnen heute behilflich sein?"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--model", default="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16")
    parser.add_argument("--ref-voice", default=str(DEFAULT_REF_VOICE))
    parser.add_argument("--ref-text", default=DEFAULT_REF_TEXT)
    parser.add_argument("--no-ref", action="store_true", help="Skip voice cloning (no ref audio)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--temperature", type=float, default=0.5)
    parser.add_argument("--stream", action="store_true", help="Use streaming mode")
    parser.add_argument("--interval", type=float, default=2.0, help="Streaming interval (seconds)")
    parser.add_argument("--output", default="output.wav")
    parser.add_argument("--play", action="store_true")
    args = parser.parse_args()

    print(f"Loading model: {args.model}")
    t0 = time.perf_counter()
    model = load_model(args.model)
    sr = getattr(model, "sample_rate", 24000)
    print(f"Loaded in {time.perf_counter() - t0:.2f}s  (sample_rate={sr})")

    # warmup
    mx.random.seed(args.seed)
    kwargs = dict(text="Hallo.", lang_code="German", split_pattern="")
    if not args.no_ref:
        kwargs["ref_audio"] = args.ref_voice
        kwargs["ref_text"] = args.ref_text
    for _ in model.generate(**kwargs):
        pass
    print("Warmup done.\n")

    # generate
    mx.random.seed(args.seed)
    gen_kwargs = dict(
        text=args.text,
        lang_code="German",
        temperature=args.temperature,
        split_pattern="",
        stream=args.stream,
        streaming_interval=args.interval,
    )
    if not args.no_ref:
        gen_kwargs["ref_audio"] = args.ref_voice
        gen_kwargs["ref_text"] = args.ref_text

    mode = "streaming" if args.stream else "non-streaming"
    print(f"Generating ({mode}): {args.text[:80]}...")
    t_start = time.perf_counter()

    chunks = []
    for i, result in enumerate(model.generate(**gen_kwargs)):
        audio = np.array(result.audio, dtype=np.float32)
        if audio.ndim > 1:
            audio = audio.squeeze()
        chunks.append(audio)
        dur = len(audio) / sr
        print(f"  chunk {i}: {len(audio)} samples ({dur:.2f}s)  "
              f"segment_idx={result.segment_idx}  "
              f"is_streaming={result.is_streaming_chunk}  "
              f"is_final={result.is_final_chunk}")

    t_total = time.perf_counter() - t_start
    print(f"\nGeneration: {t_total:.2f}s, {len(chunks)} chunk(s)")

    if not chunks:
        print("No audio generated!")
        return

    # concatenate and analyze
    full_audio = np.concatenate(chunks)
    total_dur = len(full_audio) / sr
    peak = np.max(np.abs(full_audio))
    rms = np.sqrt(np.mean(full_audio**2))

    print(f"\nAudio analysis:")
    print(f"  Duration:    {total_dur:.2f}s ({len(full_audio)} samples)")
    print(f"  Peak:        {peak:.4f}")
    print(f"  RMS:         {rms:.4f}")
    print(f"  RTF:         {t_total / total_dur:.3f}x")

    # check for silence gaps (potential interruptions)
    window_ms = 20
    window_samples = int(sr * window_ms / 1000)
    silence_threshold = 0.005
    silent_regions = []
    in_silence = False
    silence_start = 0

    for i in range(0, len(full_audio) - window_samples, window_samples):
        window = full_audio[i:i + window_samples]
        window_rms = np.sqrt(np.mean(window**2))
        if window_rms < silence_threshold:
            if not in_silence:
                in_silence = True
                silence_start = i
        else:
            if in_silence:
                silence_end = i
                gap_ms = (silence_end - silence_start) / sr * 1000
                if gap_ms > 100:  # only report gaps > 100ms
                    silent_regions.append((silence_start / sr, silence_end / sr, gap_ms))
                in_silence = False

    if in_silence:
        silence_end = len(full_audio)
        gap_ms = (silence_end - silence_start) / sr * 1000
        if gap_ms > 100:
            silent_regions.append((silence_start / sr, silence_end / sr, gap_ms))

    if silent_regions:
        print(f"\n  Silence gaps > 100ms:")
        for start_s, end_s, gap_ms in silent_regions:
            print(f"    {start_s:.2f}s - {end_s:.2f}s  ({gap_ms:.0f}ms)")
    else:
        print(f"\n  No silence gaps > 100ms found")

    # if multiple chunks, show boundaries
    if len(chunks) > 1:
        print(f"\n  Chunk boundaries:")
        offset = 0
        for i, chunk in enumerate(chunks):
            boundary_s = offset / sr
            print(f"    chunk {i} starts at {boundary_s:.3f}s ({offset} samples)")
            offset += len(chunk)

    # normalize and save
    if peak > 0:
        full_audio = full_audio / peak * 0.9

    sf.write(args.output, full_audio, sr)
    print(f"\nSaved to {args.output}")

    if args.play:
        import sounddevice as sd
        print(f"Playing ({sr} Hz, {total_dur:.2f}s) ...")
        sd.play(full_audio, samplerate=sr)
        sd.wait()
        print("Done.")


if __name__ == "__main__":
    main()
