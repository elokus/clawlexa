"""
Real-time streaming client for Qwen3-TTS clone server — plays audio chunks AS they arrive.

Same protocol as client_stream_rt.py but defaults to the clone server port (8085).

Usage:
    uv run python client_clone_stream_rt.py "Hello, how are you today?"
    uv run python client_clone_stream_rt.py --seed 123 "This is a test."
    uv run python client_clone_stream_rt.py --port 8085 --lang English "Good morning!"
    uv run python client_clone_stream_rt.py --interval 1.0 "Short chunks for lower latency."
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
    parser.add_argument("--port", type=int, default=8085)
    parser.add_argument("--lang", default="English")
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--save", default=None, help="Save received audio to WAV file")
    args = parser.parse_args()

    url = args.url or f"ws://localhost:{args.port}/ws/tts"

    display_text = args.text[:80] + "..." if len(args.text) > 80 else args.text
    print(f"Text: {display_text}")
    print(f"Language: {args.lang}  Temperature: {args.temperature}  Interval: {args.interval}s")
    print(f"Server: {url}\n")

    audio_queue: queue.Queue[np.ndarray | None] = queue.Queue()
    sample_rate = 24000
    t_first_audio = None
    server_done = {}
    all_chunks: list[np.ndarray] = []

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
                all_chunks.append(audio)
                chunk_count += 1

                chunk_dur = len(pcm16) / sample_rate
                elapsed = (now - t_sent) * 1000
                print(f"  chunk {chunk_count:2d}: {chunk_dur:.2f}s audio  @ {elapsed:.0f}ms")

    with connect(url) as ws:
        payload = {
            "text": args.text,
            "lang_code": args.lang,
            "temperature": args.temperature,
            "streaming_interval": args.interval,
        }
        if args.seed is not None:
            payload["seed"] = args.seed

        ws.send(json.dumps(payload))

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

    # Save to file if requested
    if args.save and all_chunks:
        import soundfile as sf
        full_audio = np.concatenate(all_chunks)
        sf.write(args.save, full_audio, sample_rate, format="WAV")
        print(f"Saved:                {args.save}")

    print("Done.")


if __name__ == "__main__":
    main()
