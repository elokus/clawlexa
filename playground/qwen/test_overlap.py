"""
Test different decoder overlap sizes to find artifact-free streaming.
"""

import types
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
import soundfile as sf

from mlx_audio.tts.utils import load_model

VOICES_DIR = Path(__file__).parent.parent / "mlx-audio" / "voices"
REF_VOICE = str(VOICES_DIR / "ref_male_warm.wav")
REF_TEXT = (
    "Willkommen bei unserem Service. Mein Name ist Jarvis und ich bin hier, "
    "um Ihnen bei allen Fragen weiterzuhelfen. Fragen Sie mich einfach."
)
TEXT = (
    "Guten Tag, mein Name ist ein Sprachassistent. "
    "Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen. "
    "Wie kann ich Ihnen heute behilflich sein?"
)

SEED = 42
TEMP = 0.5

print("Loading model...")
model = load_model("mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16")
sr = model.sample_rate

# warmup
mx.random.seed(SEED)
for _ in model.generate(text="Hallo.", ref_audio=REF_VOICE, ref_text=REF_TEXT, lang_code="German", split_pattern=""):
    pass
print("Warmup done.\n")

# 1. Generate reference (non-streaming)
mx.random.seed(SEED)
ref_chunks = []
for r in model.generate(text=TEXT, ref_audio=REF_VOICE, ref_text=REF_TEXT,
                        lang_code="German", temperature=TEMP, split_pattern="", stream=False):
    ref_chunks.append(np.array(r.audio, dtype=np.float32).squeeze())
ref_audio = np.concatenate(ref_chunks)
sf.write("ref_nonstream.wav", ref_audio / max(np.max(np.abs(ref_audio)), 1e-6) * 0.9, sr)
print(f"Reference (non-stream): {len(ref_audio)} samples ({len(ref_audio)/sr:.2f}s)\n")


def make_patched_streaming_decode(speech_tok, left_ctx_size):
    """Create a patched streaming_decode with custom left_context_size."""
    def streaming_decode(audio_codes, chunk_tokens=100):
        codes = mx.transpose(audio_codes, (0, 2, 1))
        total_tokens = codes.shape[-1]
        start_index = 0
        while start_index < total_tokens:
            end_index = min(start_index + chunk_tokens, total_tokens)
            ctx = left_ctx_size if start_index - left_ctx_size > 0 else start_index
            codes_chunk = codes[..., start_index - ctx:end_index]
            wav_chunk = speech_tok.decoder(codes_chunk)
            wav_chunk = wav_chunk[..., ctx * speech_tok.decoder.total_upsample:]
            wav_chunk = wav_chunk.squeeze(1)
            mx.eval(wav_chunk)
            yield wav_chunk
            mx.clear_cache()
            start_index = end_index
    return streaming_decode


# Save original
orig_streaming_decode = model.speech_tokenizer.streaming_decode

print("Testing decoder left_context_size (gen context stays at 25):")
print(f"{'ctx':>5s}  {'chunks':>6s}  {'max_diff':>9s}  {'mean_diff':>11s}  {'>0.01':>7s}  {'>0.05':>7s}  {'time':>6s}")
print("-" * 70)

for ctx in [25, 50, 75, 100, 150]:
    # Patch
    model.speech_tokenizer.streaming_decode = make_patched_streaming_decode(
        model.speech_tokenizer, ctx
    )

    mx.random.seed(SEED)
    t0 = time.perf_counter()
    stream_chunks = []
    for r in model.generate(text=TEXT, ref_audio=REF_VOICE, ref_text=REF_TEXT,
                            lang_code="German", temperature=TEMP, split_pattern="",
                            stream=True, streaming_interval=2.0):
        audio = np.array(r.audio, dtype=np.float32).squeeze()
        stream_chunks.append(audio)
    elapsed = time.perf_counter() - t0

    stream_audio = np.concatenate(stream_chunks)

    # Compare
    min_len = min(len(ref_audio), len(stream_audio))
    diff = np.abs(ref_audio[:min_len] - stream_audio[:min_len])
    max_diff = np.max(diff)
    mean_diff = np.mean(diff)
    pct_001 = np.sum(diff > 0.01) / min_len * 100
    pct_005 = np.sum(diff > 0.05) / min_len * 100

    print(f"{ctx:5d}  {len(stream_chunks):6d}  {max_diff:9.4f}  {mean_diff:11.6f}  {pct_001:6.1f}%  {pct_005:6.1f}%  {elapsed:5.1f}s")

    fname = f"stream_ctx{ctx}.wav"
    sf.write(fname, stream_audio / max(np.max(np.abs(stream_audio)), 1e-6) * 0.9, sr)

# Restore
model.speech_tokenizer.streaming_decode = orig_streaming_decode
print("\nDone. Listen to the WAV files to compare.")
