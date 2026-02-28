"""
Streaming WebSocket client for Qwen3-TTS server.

Receives PCM16 audio chunks over WebSocket and plays them as they arrive,
measuring TTFAB (time to first audio byte) at the client level.

Usage:
    .venv/bin/python client_stream.py                              # default German text
    .venv/bin/python client_stream.py "Wie spät ist es?"
    .venv/bin/python client_stream.py --lang en "Hello world"
    .venv/bin/python client_stream.py --no-play                    # just print metrics
    .venv/bin/python client_stream.py --interval 0.5               # smaller chunks, lower TTFAB
"""

import argparse
import json
import sys
import time
import threading

import numpy as np
import sounddevice as sd

try:
    from websockets.sync.client import connect
except ImportError:
    print("Install websockets:  pip install websockets")
    sys.exit(1)


DEFAULT_TEXT = (
    "Guten Tag, mein Name ist ein Sprachassistent. "
    "Ich wurde entwickelt, um Ihnen bei verschiedenen Aufgaben zu helfen. "
    "Wie kann ich Ihnen heute behilflich sein?"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?", default=DEFAULT_TEXT)
    parser.add_argument("--url", default="ws://localhost:8081/ws/tts")
    parser.add_argument("--voice", default="aiden")
    parser.add_argument("--lang", default="de")
    parser.add_argument("--interval", type=float, default=1.0,
                        help="Streaming interval in seconds (lower = smaller chunks, lower TTFAB)")
    parser.add_argument("--no-play", action="store_true")
    args = parser.parse_args()

    display_text = args.text[:80] + "..." if len(args.text) > 80 else args.text
    print(f"Text: {display_text}")
    print(f"Voice: {args.voice}  Language: {args.lang}  Interval: {args.interval}s\n")

    t_connect = time.perf_counter()

    with connect(args.url) as ws:
        # send request
        ws.send(json.dumps({
            "text": args.text,
            "voice": args.voice,
            "lang_code": args.lang,
            "streaming_interval": args.interval,
        }))

        t_sent = time.perf_counter()
        t_first_audio = None
        sample_rate = 24000
        chunks: list[np.ndarray] = []
        chunk_times: list[float] = []

        while True:
            msg = ws.recv()

            if isinstance(msg, str):
                data = json.loads(msg)

                if data["type"] == "meta":
                    sample_rate = data["sample_rate"]

                elif data["type"] == "done":
                    # print server-side metrics
                    print(f"Server TTFAB:         {data['ttfab_ms']} ms")
                    print(f"Server total:         {data['total_ms']} ms")
                    print(f"Audio duration:       {data['audio_duration_ms']} ms")
                    print(f"Chunks:               {data['chunks']}")
                    print(f"RTF:                  {data.get('rtf', '?')}x")
                    break

                elif data["type"] == "error":
                    print(f"ERROR: {data['message']}")
                    sys.exit(1)

            elif isinstance(msg, bytes):
                now = time.perf_counter()
                if t_first_audio is None:
                    t_first_audio = now - t_sent
                chunk_times.append(now - t_sent)

                pcm16 = np.frombuffer(msg, dtype=np.int16)
                audio = pcm16.astype(np.float32) / 32767.0
                chunks.append(audio)

                chunk_dur = len(pcm16) / sample_rate
                print(f"  chunk {len(chunks):2d}: {len(pcm16):6d} samples ({chunk_dur:.2f}s)  "
                      f"@ {chunk_times[-1]*1000:.0f}ms")

    t_total = time.perf_counter() - t_sent

    print(f"\nClient TTFAB:         {t_first_audio*1000:.0f} ms" if t_first_audio else "")
    print(f"Client total:         {t_total*1000:.0f} ms")

    if chunks and not args.no_play:
        full_audio = np.concatenate(chunks)
        total_dur = len(full_audio) / sample_rate
        print(f"\nPlaying ({sample_rate} Hz, {total_dur:.2f}s) ...")
        sd.play(full_audio, samplerate=sample_rate)
        sd.wait()
        print("Done.")


if __name__ == "__main__":
    main()
