"""
Real-time streaming client for kokoro-onnx server — plays audio chunks AS they arrive.

Same protocol as mlx-audio/client_stream_rt.py for direct comparison.

Usage:
    uv run python client_stream_rt.py "Hello, how are you today?"
    uv run python client_stream_rt.py --voice af_bella "Testing voice quality"
    uv run python client_stream_rt.py --lang ja "こんにちは"
    uv run python client_stream_rt.py --port 8082 "Hello test"
"""

import argparse
import json
import queue
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
    "Hello, my name is a voice assistant. "
    "I was designed to help you with various tasks. "
    "How can I help you today?"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?", default=DEFAULT_TEXT)
    parser.add_argument("--url", default=None)
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--lang", default="en-us")
    parser.add_argument("--speed", type=float, default=1.0)
    args = parser.parse_args()

    url = args.url or f"ws://localhost:{args.port}/ws/tts"

    display_text = args.text[:80] + "..." if len(args.text) > 80 else args.text
    print(f"Text: {display_text}")
    print(f"Voice: {args.voice}  Language: {args.lang}  Speed: {args.speed}x\n")

    audio_queue: queue.Queue[np.ndarray | None] = queue.Queue()
    sample_rate = 24000
    t_first_audio = None
    server_done = {}

    def receive_loop(ws):
        nonlocal sample_rate, t_first_audio
        t_sent = time.perf_counter()
        chunk_count = 0

        while True:
            msg = ws.recv()

            if isinstance(msg, str):
                data = json.loads(msg)
                if data["type"] == "meta":
                    sample_rate = data["sample_rate"]
                elif data["type"] == "done":
                    server_done.update(data)
                    audio_queue.put(None)
                    break
                elif data["type"] == "error":
                    print(f"ERROR: {data['message']}")
                    audio_queue.put(None)
                    break

            elif isinstance(msg, bytes):
                now = time.perf_counter()
                if t_first_audio is None:
                    t_first_audio = now - t_sent
                    print(f"  >> first audio chunk @ {t_first_audio*1000:.0f}ms")

                pcm16 = np.frombuffer(msg, dtype=np.int16)
                audio = pcm16.astype(np.float32) / 32767.0
                audio_queue.put(audio)
                chunk_count += 1

                chunk_dur = len(pcm16) / sample_rate
                elapsed = (now - t_sent) * 1000
                print(f"  chunk {chunk_count:2d}: {chunk_dur:.2f}s audio  @ {elapsed:.0f}ms")

    with connect(url) as ws:
        ws.send(json.dumps({
            "text": args.text,
            "voice": args.voice,
            "lang": args.lang,
            "speed": args.speed,
        }))

        t_start = time.perf_counter()

        rx_thread = threading.Thread(target=receive_loop, args=(ws,), daemon=True)
        rx_thread.start()

        stream = sd.OutputStream(samplerate=sample_rate, channels=1, dtype="float32")
        stream.start()

        total_samples = 0

        while True:
            chunk = audio_queue.get()
            if chunk is None:
                break
            stream.write(chunk.reshape(-1, 1))
            total_samples += len(chunk)

        stream.stop()
        stream.close()

        rx_thread.join(timeout=2)

    t_total = time.perf_counter() - t_start

    print(f"\n{'─'*50}")
    if t_first_audio is not None:
        print(f"Client TTFAB:         {t_first_audio*1000:.0f} ms")
    print(f"Client total:         {t_total*1000:.0f} ms")
    print(f"Audio duration:       {total_samples / sample_rate * 1000:.0f} ms")
    if server_done:
        print(f"Server TTFAB:         {server_done.get('ttfab_ms', '?')} ms")
        print(f"Server total:         {server_done.get('total_ms', '?')} ms")
        print(f"Chunks:               {server_done.get('chunks', '?')}")
        print(f"RTF:                  {server_done.get('rtf', '?')}x")
    print("Done.")


if __name__ == "__main__":
    main()
