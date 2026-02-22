import { createLlmRuntime } from '../src/runtime.js';

const provider = (process.argv[2] ?? 'openrouter').trim();
const model = (process.argv[3] ?? 'openai/gpt-4o-mini').trim();
const prompt = (process.argv[4] ?? 'Reply with: SCRATCH_OK').trim();

async function main(): Promise<void> {
  const runtime = createLlmRuntime();
  const events = runtime.stream({
    model: {
      provider,
      model,
      modality: 'llm',
    },
    context: {
      messages: [{ role: 'user', content: prompt }],
    },
  });

  for await (const event of events) {
    if (event.type === 'text-delta') {
      process.stdout.write(event.textDelta);
      continue;
    }

    if (event.type === 'error') {
      process.stderr.write(`\n[error] ${event.error}\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write('\n');
}

void main();
