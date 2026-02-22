import type { LlmEvent } from '../types.js';

export type OpenRouterUiMessagePart =
  | {
      type: 'step-start';
    }
  | {
      type: 'reasoning';
      text?: string;
      reasoning?: string;
    }
  | {
      type: 'text';
      text: string;
    }
  | {
      type: `tool-${string}`;
      toolCallId: string;
      state: 'input-available' | 'output-available' | 'output-error' | string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };

export interface OpenRouterUiMessage {
  parts: OpenRouterUiMessagePart[];
}

export interface OpenRouterEventMapperState {
  previousText: string;
  previousReasoning: string;
  emittedToolCalls: Set<string>;
  emittedToolResults: Set<string>;
}

export function createOpenRouterEventMapperState(): OpenRouterEventMapperState {
  return {
    previousText: '',
    previousReasoning: '',
    emittedToolCalls: new Set<string>(),
    emittedToolResults: new Set<string>(),
  };
}

function computeDelta(previous: string, current: string): string {
  if (!current) return '';
  if (!previous) return current;
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }
  return current;
}

function mapToolPartToEvents(
  part: Extract<OpenRouterUiMessagePart, { type: `tool-${string}` }>,
  state: OpenRouterEventMapperState
): LlmEvent[] {
  const events: LlmEvent[] = [];
  const toolName = part.type.replace('tool-', '');
  const toolCallId = part.toolCallId;
  if (!toolCallId) return events;

  if (part.state === 'input-available' && !state.emittedToolCalls.has(toolCallId)) {
    events.push({
      type: 'tool-call',
      toolName,
      toolCallId,
      input: part.input,
    });
    state.emittedToolCalls.add(toolCallId);
  }

  if (part.state === 'output-available' && !state.emittedToolResults.has(toolCallId)) {
    events.push({
      type: 'tool-result',
      toolName,
      toolCallId,
      output: part.output,
      isError: false,
    });
    state.emittedToolResults.add(toolCallId);
  }

  if (part.state === 'output-error' && !state.emittedToolResults.has(toolCallId)) {
    events.push({
      type: 'tool-result',
      toolName,
      toolCallId,
      output: part.errorText ?? 'Tool execution failed',
      isError: true,
    });
    state.emittedToolResults.add(toolCallId);
  }

  return events;
}

export function mapOpenRouterUiMessageToEvents(
  uiMessage: OpenRouterUiMessage,
  state: OpenRouterEventMapperState
): LlmEvent[] {
  const events: LlmEvent[] = [];

  for (const part of uiMessage.parts) {
    if (part.type === 'step-start') {
      events.push({ type: 'start-step' });
      continue;
    }

    if (part.type === 'reasoning') {
      const currentReasoning = part.text ?? part.reasoning ?? '';
      const reasoningDelta = computeDelta(state.previousReasoning, currentReasoning);
      if (reasoningDelta) {
        events.push({
          type: 'reasoning-delta',
          text: reasoningDelta,
        });
        state.previousReasoning = currentReasoning;
      }
      continue;
    }

    if (part.type === 'text') {
      const textDelta = computeDelta(state.previousText, part.text);
      if (textDelta) {
        events.push({
          type: 'text-delta',
          textDelta,
        });
        state.previousText = part.text;
      }
      continue;
    }

    if (part.type.startsWith('tool-')) {
      events.push(
        ...mapToolPartToEvents(
          part as Extract<OpenRouterUiMessagePart, { type: `tool-${string}` }>,
          state
        )
      );
    }
  }

  return events;
}
