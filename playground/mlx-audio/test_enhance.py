"""
Test MossFormer2 SE speech enhancement on Qwen3 VoiceDesign TTS output.

Generates audio, then runs it through the enhancer to see if quality improves.

Usage:
    .venv/bin/python test_enhance.py --play
"""

import argparse
import time

import numpy as np
import soundfile as sf

from mlx_audio.tts.utils import load_model
from mlx_audio.sts.models.mossformer2_se import MossFormer2SEModel, save_audio


TTS_MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
SE_MODEL_ID = "starkdmi/MossFormer2-SE"

VOICE_DESIGN = (
    "A native German male voice assistant. Professional, clear articulation, "
    "natural German accent. Medium pitch, moderate speaking speed."
)

TEXT = "Guten Tag, mein Name ist ein Sprachassistent. Wie kann ich Ihnen heute behilflich sein?"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--play", action="store_true")
    args = parser.parse_args()

    # 1. Generate TTS audio
    print(f"Loading TTS model: {TTS_MODEL_ID}")
    tts = load_model(TTS_MODEL_ID)
    tts_sr = getattr(tts, "sample_rate", 24000)
    print(f"TTS loaded (sample_rate={tts_sr})")

    print(f"\nGenerating: \"{TEXT[:60]}...\"")
    t0 = time.perf_counter()
    chunks = []
    for result in tts.generate(
        text=TEXT,
        instruct=VOICE_DESIGN,
        lang_code="German",
        temperature=0.9,
    ):
        audio = np.array(result.audio, dtype=np.float32)
        if audio.ndim > 1:
            audio = audio.squeeze()
        chunks.append(audio)

    raw_audio = np.concatenate(chunks)
    t_tts = time.perf_counter() - t0
    print(f"TTS done in {t_tts:.2f}s  ({len(raw_audio)/tts_sr:.2f}s audio)")

    # save raw
    sf.write("/tmp/tts_raw.wav", raw_audio, tts_sr)
    print(f"Saved raw: /tmp/tts_raw.wav")

    # 2. Resample 24kHz -> 48kHz for enhancer
    print(f"\nLoading enhancer: {SE_MODEL_ID}")
    enhancer = MossFormer2SEModel.from_pretrained(SE_MODEL_ID)
    enhancer.warmup()

    # simple linear interpolation resample 24k -> 48k (2x)
    indices = np.linspace(0, len(raw_audio) - 1, len(raw_audio) * 2)
    audio_48k = np.interp(indices, np.arange(len(raw_audio)), raw_audio)

    print(f"Enhancing ({len(audio_48k)/48000:.2f}s at 48kHz) ...")
    t0 = time.perf_counter()
    enhanced = enhancer.enhance(audio_48k)
    t_enhance = time.perf_counter() - t0
    print(f"Enhancement done in {t_enhance:.2f}s")

    # save enhanced at 48kHz
    sf.write("/tmp/tts_enhanced_48k.wav", enhanced, 48000)
    print(f"Saved enhanced (48kHz): /tmp/tts_enhanced_48k.wav")

    # also downsample back to 24kHz for fair comparison
    enhanced_24k = enhanced[::2]  # simple decimation (good enough for A/B)
    sf.write("/tmp/tts_enhanced_24k.wav", enhanced_24k, 24000)
    print(f"Saved enhanced (24kHz): /tmp/tts_enhanced_24k.wav")

    # 3. A/B playback
    if args.play:
        import sounddevice as sd

        print(f"\n--- Playing RAW ({tts_sr}Hz, {len(raw_audio)/tts_sr:.2f}s) ---")
        sd.play(raw_audio, samplerate=tts_sr)
        sd.wait()

        print(f"\n--- Playing ENHANCED (48kHz, {len(enhanced)/48000:.2f}s) ---")
        sd.play(enhanced, samplerate=48000)
        sd.wait()

        print("\nDone. Compare the two.")
    else:
        print("\nRun with --play to hear A/B comparison.")
        print("Or compare files: /tmp/tts_raw.wav vs /tmp/tts_enhanced_48k.wav")


if __name__ == "__main__":
    main()
