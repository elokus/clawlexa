"""
Real-time streaming client — plays audio chunks AS they arrive.

Unlike client_stream.py (which collects all chunks then plays),
this client starts playback on the first chunk, giving true low-latency feel.

Usage:
    .venv/bin/python client_stream_rt.py "Wie spät ist es?"
    .venv/bin/python client_stream_rt.py --interval 0.5 "Hello how are you?"
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
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()

    display_text = args.text[:80] + "..." if len(args.text) > 80 else args.text
    print(f"Text: {display_text}")
    print(f"Voice: {args.voice}  Language: {args.lang}  Interval: {args.interval}s\n")

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
                    audio_queue.put(None)  # signal end
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

    with connect(args.url) as ws:
        ws.send(json.dumps({
            "text": args.text,
            "voice": args.voice,
            "lang_code": args.lang,
            "streaming_interval": args.interval,
        }))

        t_start = time.perf_counter()

        # start receiver in background thread
        rx_thread = threading.Thread(target=receive_loop, args=(ws,), daemon=True)
        rx_thread.start()

        # play chunks as they arrive using sounddevice blocking writes
        stream = sd.OutputStream(samplerate=sample_rate, channels=1, dtype="float32")
        stream.start()

        total_samples = 0
        playing = True

        while playing:
            chunk = audio_queue.get()
            if chunk is None:
                break
            stream.write(chunk.reshape(-1, 1))
            total_samples += len(chunk)

        # drain remaining audio in stream buffer
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
