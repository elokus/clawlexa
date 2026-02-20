/**
 * Scratch file to explore Vercel AI SDK v5 streaming events with OpenRouter
 *
 * Testing:
 * 1. Which events are emitted during streaming
 * 2. Tool call events
 * 3. Reasoning/thinking events (if model supports extended thinking)
 * 4. Text delta events
 *
 * Run: npx tsx src/scratch-stream-test.ts [1|2|3|4]
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { streamText, generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const OPENROUTER_API_KEY = process.env.OPEN_ROUTER_API || process.env.OPEN_ROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('OPEN_ROUTER_API or OPEN_ROUTER_API_KEY not found in .env');
  process.exit(1);
}

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
});

// ==================== TOOLS ====================
// Using tool() helper with inputSchema as per AI SDK v5

const weatherTool = tool({
  description: 'Get the current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('The city and country'),
  }),
  execute: async ({ location }) => {
    console.log(`\n  ========================================`);
    console.log(`  [TOOL EXECUTE] weather called with:`);
    console.log(`    location = "${location}"`);
    console.log(`    type = ${typeof location}`);
    console.log(`  ========================================\n`);
    const result = { temperature: 22, condition: 'sunny', location };
    console.log(`  [TOOL EXECUTE] returning:`, JSON.stringify(result));
    return result;
  },
});

const calculatorTool = tool({
  description: 'Perform a math calculation',
  inputSchema: z.object({
    expression: z.string().describe('The math expression to evaluate, e.g. "25 * 4"'),
  }),
  execute: async ({ expression }) => {
    console.log(`  [TOOL EXECUTING] calculator: ${expression}`);
    try {
      const result = eval(expression);
      return { expression, result };
    } catch {
      return { expression, error: 'Invalid expression' };
    }
  },
});

// ==================== MODELS (Limited set) ====================
const MODELS = {
  // Primary: grok-code-fast-1 (already used in cli-agent.ts)
  grok: openrouter.chat('x-ai/grok-code-fast-1'),
  // Reasoning model
  deepseek: openrouter.chat('deepseek/deepseek-r1'),
  // Claude
  claude: openrouter.chat('anthropic/claude-sonnet-4'),
};

// ==================== STREAM TEST ====================
async function testStreamText(
  modelKey: keyof typeof MODELS,
  prompt: string,
  withTools = false
) {
  console.log('\n' + '='.repeat(60));
  console.log(`streamText | Model: ${modelKey} | Tools: ${withTools}`);
  console.log(`Prompt: "${prompt}"`);
  console.log('='.repeat(60));

  const model = MODELS[modelKey];

  try {
    const result = streamText({
      model,
      prompt,
      ...(withTools && {
        tools: { weather: weatherTool, calculator: calculatorTool },
        maxSteps: 3,
      }),
    });

    console.log('\n--- Streaming events ---\n');

    for await (const event of result.fullStream) {
      switch (event.type) {
        // Stream lifecycle
        case 'start':
          console.log('[start] Stream started');
          break;
        case 'start-step':
          console.log('[start-step] New step beginning');
          break;

        // Reasoning events (for thinking models)
        case 'reasoning-start':
          console.log(`[reasoning-start] id: ${(event as any).id}`);
          break;
        case 'reasoning-delta':
          process.stdout.write(`[reasoning] ${(event as any).text}`);
          break;
        case 'reasoning-end':
          console.log('\n[reasoning-end]');
          break;

        // Text generation events
        case 'text-start':
          console.log('[text-start]');
          break;
        case 'text-delta':
          process.stdout.write((event as any).textDelta || '');
          break;
        case 'text-end':
          console.log('\n[text-end]');
          break;

        // Tool calling events
        case 'tool-input-start':
          console.log(`[tool-input-start] ${(event as any).toolName} (id: ${(event as any).id})`);
          break;
        case 'tool-input-delta':
          console.log(`[tool-input-delta] args: ${(event as any).delta}`);
          break;
        case 'tool-input-end':
          console.log('[tool-input-end]');
          break;
        case 'tool-call':
          console.log(`[tool-call] toolName: ${event.toolName}`);
          console.log(`  event.args: ${JSON.stringify(event.args)}`);
          console.log(`  event keys: ${Object.keys(event).join(', ')}`);
          console.log(`  full event:`, event);
          break;
        case 'tool-result':
          console.log(`[tool-result] toolName: ${event.toolName}`);
          console.log(`  event.result: ${JSON.stringify(event.result)}`);
          console.log(`  event keys: ${Object.keys(event).join(', ')}`);
          console.log(`  full event:`, event);
          break;

        // Step/stream finish
        case 'finish-step':
          console.log(`[finish-step] reason: ${(event as any).finishReason}`);
          console.log(`  usage: ${JSON.stringify((event as any).usage)}`);
          break;
        case 'finish':
          console.log(`[finish] reason: ${event.finishReason}`);
          break;

        case 'error':
          console.log(`[error] ${JSON.stringify(event.error)}`);
          break;

        default:
          console.log(`[${event.type}]`, event);
      }
    }

    const finalText = await result.text;
    console.log(`\n--- Final text (${finalText.length} chars) ---`);
    console.log(finalText.substring(0, 300) + (finalText.length > 300 ? '...' : ''));

  } catch (error) {
    console.error('Error:', error);
  }
}

// ==================== GENERATE TEXT TEST ====================
async function testGenerateText(
  modelKey: keyof typeof MODELS,
  prompt: string,
  withTools = false
) {
  console.log('\n' + '='.repeat(60));
  console.log(`generateText | Model: ${modelKey} | Tools: ${withTools}`);
  console.log(`Prompt: "${prompt}"`);
  console.log('='.repeat(60));

  const model = MODELS[modelKey];

  try {
    const result = await generateText({
      model,
      prompt,
      ...(withTools && {
        tools: { weather: weatherTool, calculator: calculatorTool },
        maxSteps: 3,
        onStepFinish: ({ stepType, text, toolCalls, toolResults, finishReason, usage }) => {
          console.log(`\n[onStepFinish] stepType: ${stepType}, reason: ${finishReason}`);
          console.log(`  usage: ${JSON.stringify(usage)}`);
          if (toolCalls?.length) {
            toolCalls.forEach((tc) =>
              console.log(`  toolCall: ${tc.toolName}(${JSON.stringify(tc.args)})`)
            );
          }
          if (toolResults?.length) {
            toolResults.forEach((tr) =>
              console.log(`  toolResult: ${tr.toolName} => ${JSON.stringify(tr.result)}`)
            );
          }
          if (text) console.log(`  text: "${text.substring(0, 100)}..."`);
        },
      }),
    });

    console.log('\n--- Result ---');
    console.log(`text: "${result.text.substring(0, 300)}${result.text.length > 300 ? '...' : ''}"`);
    console.log(`steps: ${result.steps.length}`);
    console.log(`finishReason: ${result.finishReason}`);
    console.log(`usage: ${JSON.stringify(result.usage)}`);

    // Check for reasoning content
    const reasoning = (result as any).reasoning;
    if (reasoning) {
      const reasoningText = typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning);
      console.log(`reasoning: ${reasoningText.substring(0, 200)}...`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// ==================== MAIN ====================
async function main() {
  console.log('Vercel AI SDK v5 - Stream Events Explorer');
  console.log('==========================================\n');
  console.log('Available tests:');
  console.log('  1 - grok simple streaming (no tools)');
  console.log('  2 - grok streaming WITH tools');
  console.log('  3 - deepseek-r1 reasoning model');
  console.log('  4 - generateText with tools + onStepFinish');
  console.log('  5 - Claude streaming WITH tools');
  console.log('');

  const testNum = process.argv[2] || '1';

  switch (testNum) {
    case '1':
      await testStreamText('grok', 'Say hello in 3 languages, one per line. Be brief.');
      break;

    case '2':
      await testStreamText(
        'grok',
        'What is the weather in Berlin? Also calculate 25 * 4 for me.',
        true
      );
      break;

    case '3':
      await testStreamText(
        'deepseek',
        'Think step by step: If I have 3 boxes with 4 apples each and give away 5, how many left?'
      );
      break;

    case '4':
      await testGenerateText(
        'grok',
        'What is the weather in Tokyo? Also calculate 15 * 7.',
        true
      );
      break;

    case '5':
      await testStreamText(
        'claude',
        'What is the weather in Paris? Also calculate 12 * 8 for me.',
        true
      );
      break;

    default:
      console.log('Usage: npx tsx src/scratch-stream-test.ts [1|2|3|4|5]');
  }
}

main().catch(console.error);
