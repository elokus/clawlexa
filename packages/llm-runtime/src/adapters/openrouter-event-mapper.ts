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
  emittedStepStarts: number;
}

export function createOpenRouterEventMapperState(): OpenRouterEventMapperState {
  return {
    previousText: '',
    previousReasoning: '',
    emittedToolCalls: new Set<string>(),
    emittedToolResults: new Set<string>(),
    emittedStepStarts: 0,
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

function selectBestSnapshot(candidates: string[], previous: string): string {
  if (candidates.length === 0) return '';

  let longest = '';
  let bestGrowing = '';

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate.length > longest.length) {
      longest = candidate;
    }

    if (candidate.startsWith(previous) && candidate.length >= previous.length) {
      if (candidate.length > bestGrowing.length) {
        bestGrowing = candidate;
      }
    }
  }

  return bestGrowing || longest;
}

function getStepStartCount(uiMessage: OpenRouterUiMessage): number {
  let count = 0;
  for (const part of uiMessage.parts) {
    if (part.type === 'step-start') {
      count += 1;
    }
  }
  return count;
}

function getTextSnapshotCandidates(uiMessage: OpenRouterUiMessage): string[] {
  const segments: string[] = [];
  for (const part of uiMessage.parts) {
    if (part.type === 'text' && part.text) {
      segments.push(part.text);
    }
  }
  if (segments.length > 1) {
    segments.push(segments.join(''));
  }
  return segments;
}

function getReasoningSnapshotCandidates(uiMessage: OpenRouterUiMessage): string[] {
  const segments: string[] = [];
  for (const part of uiMessage.parts) {
    if (part.type !== 'reasoning') continue;
    const text = part.text ?? part.reasoning ?? '';
    if (text) segments.push(text);
  }
  if (segments.length > 1) {
    segments.push(segments.join(''));
  }
  return segments;
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

  const stepStartCount = getStepStartCount(uiMessage);
  let pendingStepStarts = Math.max(0, stepStartCount - state.emittedStepStarts);
  if (stepStartCount > state.emittedStepStarts) {
    state.emittedStepStarts = stepStartCount;
  }

  let reasoningDelta = '';
  const reasoningCandidates = getReasoningSnapshotCandidates(uiMessage);
  if (reasoningCandidates.length > 0) {
    const currentReasoning = selectBestSnapshot(reasoningCandidates, state.previousReasoning);
    reasoningDelta = computeDelta(state.previousReasoning, currentReasoning);
    state.previousReasoning = currentReasoning;
  }

  let textDelta = '';
  const textCandidates = getTextSnapshotCandidates(uiMessage);
  if (textCandidates.length > 0) {
    const currentText = selectBestSnapshot(textCandidates, state.previousText);
    textDelta = computeDelta(state.previousText, currentText);
    state.previousText = currentText;
  }

  let emittedReasoning = false;
  let emittedText = false;

  for (const part of uiMessage.parts) {
    if (part.type === 'step-start') {
      if (pendingStepStarts > 0) {
        events.push({ type: 'start-step' });
        pendingStepStarts -= 1;
      }
      continue;
    }

    if (part.type === 'reasoning') {
      if (!emittedReasoning && reasoningDelta) {
        events.push({
          type: 'reasoning-delta',
          text: reasoningDelta,
        });
        emittedReasoning = true;
      }
      continue;
    }

    if (part.type === 'text') {
      if (!emittedText && textDelta) {
        events.push({
          type: 'text-delta',
          textDelta,
        });
        emittedText = true;
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

  while (pendingStepStarts > 0) {
    events.push({ type: 'start-step' });
    pendingStepStarts -= 1;
  }

  if (!emittedReasoning && reasoningDelta) {
    events.push({
      type: 'reasoning-delta',
      text: reasoningDelta,
    });
  }

  if (!emittedText && textDelta) {
    events.push({
      type: 'text-delta',
      textDelta,
    });
  }

  return events;
}
