"""
Quick client to test the fast TTS server.

Usage:
    .venv/bin/python client.py                           # default German text
    .venv/bin/python client.py "Wie geht es dir heute?"  # custom text
    .venv/bin/python client.py --lang en "Hello world"   # English
    .venv/bin/python client.py --no-play                 # just print metrics
"""

import argparse
import io
import sys
import time

import numpy as np
import requests
import sounddevice as sd
import soundfile as sf


DEFAULT_TEXT = (
    "Guten Tag, mein Name ist ein Sprachassistent. "
    "Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen. "
    "Wie kann ich Ihnen heute behilflich sein?"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?", default=DEFAULT_TEXT)
    parser.add_argument("--url", default="http://localhost:8080/tts")
    parser.add_argument("--lang", default="de")
    parser.add_argument("--no-play", action="store_true")
    args = parser.parse_args()

    print(f"Text: {args.text[:80]}...")
    print(f"Lang: {args.lang}\n")

    t0 = time.perf_counter()
    resp = requests.post(args.url, json={
        "text": args.text,
        "lang_code": args.lang,
    })
    t_request = time.perf_counter() - t0

    if resp.status_code != 200:
        print(f"ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)

    ttfab = resp.headers.get("X-TTFAB-Ms", "?")
    gen_time = resp.headers.get("X-Gen-Time-Ms", "?")
    audio_dur = resp.headers.get("X-Audio-Duration-Ms", "?")
    rtf = resp.headers.get("X-RTF", "?")

    print(f"Server TTFAB:         {ttfab} ms")
    print(f"Server gen time:      {gen_time} ms")
    print(f"Audio duration:       {audio_dur} ms")
    print(f"RTF:                  {rtf}x")
    print(f"Round-trip (network): {t_request*1000:.0f} ms")

    if not args.no_play:
        audio_data, sr = sf.read(io.BytesIO(resp.content))
        print(f"\nPlaying ({sr} Hz) ...")
        sd.play(audio_data, samplerate=sr)
        sd.wait()
        print("Done.")


if __name__ == "__main__":
    main()
