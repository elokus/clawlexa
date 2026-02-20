# Test Audio Files

Pre-recorded audio snippets for testing voice provider integrations. Each file corresponds to a test scenario from the [Provider Integration Guide](../docs/PROVIDER_INTEGRATION_GUIDE.md#4-multi-turn-test-scenarios).

## Format

All files are **PCM16 mono signed-integer little-endian at 16kHz** (`.raw` extension). This is the canonical input format for all voice providers.

## Recording

Use the helper script:

```bash
# Record a single scenario
bun packages/voice-runtime/test-audio/record.ts 01-greeting

# This will:
# 1. Start recording from your default mic
# 2. Press Ctrl+C to stop
# 3. Save as test-audio/01-greeting.raw
```

Or record manually with sox:

```bash
# Record (Ctrl+C to stop)
sox -d -r 16000 -c 1 -b 16 -e signed-integer packages/voice-runtime/test-audio/01-greeting.raw

# Verify playback
play -r 16000 -b 16 -c 1 -e signed-integer packages/voice-runtime/test-audio/01-greeting.raw

# Convert existing audio
ffmpeg -i input.wav -ar 16000 -ac 1 -f s16le packages/voice-runtime/test-audio/01-greeting.raw
```

## Scenarios

| File | Scenario | What to Say |
|------|----------|-------------|
| `01-greeting.raw` | Basic greeting | "Hello, can you hear me?" |
| `02a-my-name.raw` | Context setup | "My name is Alex." |
| `02b-what-is-my-name.raw` | Context recall | "What is my name?" |
| `03a-long-story.raw` | Trigger long response | "Tell me a long story about a dragon." |
| `03b-interrupt-stop.raw` | Interruption | "Stop. What color was the dragon?" |
| `04-weather-berlin.raw` | Tool trigger | "What's the weather in Berlin?" |
| `05a-count.raw` | Rapid turn 1 | "Count to three." |
| `05b-backwards.raw` | Rapid turn 2 | "Now count backwards." |
| `05c-middle.raw` | Rapid turn 3 | "What number is in the middle?" |
| `06-silence-pause.raw` | Silence handling | "Let me think..." (5s pause) "...okay, what is two plus two?" |
| `07-explain-thermo.raw` | Long response | "Explain the three laws of thermodynamics in simple terms." |
| `08a-german-hello.raw` | German greeting | "Hallo, wie geht es dir?" |
| `08b-german-joke.raw` | German follow-up | "Kannst du mir einen Witz erzählen?" |

## Using in Tests

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

const AUDIO_DIR = resolve(__dirname, '../test-audio');
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

function loadScenario(name: string): Buffer {
  return readFileSync(resolve(AUDIO_DIR, `${name}.raw`));
}

function chunkAudio(audio: Buffer, chunkMs: number): Buffer[] {
  const chunkBytes = (SAMPLE_RATE * BYTES_PER_SAMPLE * chunkMs) / 1000;
  const chunks: Buffer[] = [];
  for (let i = 0; i < audio.length; i += chunkBytes) {
    chunks.push(audio.subarray(i, Math.min(i + chunkBytes, audio.length)));
  }
  return chunks;
}

// Example: send greeting audio in 100ms chunks
const greeting = loadScenario('01-greeting');
const chunks = chunkAudio(greeting, 100);
for (const chunk of chunks) {
  // send to provider...
}
```
