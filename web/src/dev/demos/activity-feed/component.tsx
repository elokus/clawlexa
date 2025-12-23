// ═══════════════════════════════════════════════════════════════════════════
// Activity Feed Demo Component
// Wraps the real ActivityFeed with demo state management
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { ActivityFeed } from '../../../components/ActivityFeed';
import type { DemoProps, StreamEvent } from '../../registry';
import type {
  ActivityBlock,
  ReasoningBlock,
  ToolBlock,
  SubagentActivityPayload,
} from '../../../types';

/**
 * Converts stream events to activity blocks for the ActivityFeed component.
 * This mirrors the logic in the agent store's handleSubagentActivity.
 */
function eventsToBlocks(events: StreamEvent[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = [];
  let currentReasoningBlock: ReasoningBlock | null = null;

  for (const event of events) {
    if (event.type !== 'subagent_activity') continue;

    const { agent, type: eventType, payload: eventPayload } = event.payload as SubagentActivityPayload;
    const payload = eventPayload as Record<string, unknown>;
    const timestamp = Date.now();

    switch (eventType) {
      case 'reasoning_start': {
        currentReasoningBlock = {
          id: `block_${blocks.length}`,
          timestamp,
          agent,
          type: 'reasoning',
          content: '',
          isComplete: false,
        };
        blocks.push(currentReasoningBlock);
        break;
      }

      case 'reasoning_delta': {
        if (currentReasoningBlock) {
          currentReasoningBlock.content += (payload.delta as string) || '';
        }
        break;
      }

      case 'reasoning_end': {
        if (currentReasoningBlock) {
          currentReasoningBlock.isComplete = true;
          currentReasoningBlock.durationMs = (payload.durationMs as number) || 0;
        }
        currentReasoningBlock = null;
        break;
      }

      case 'tool_call': {
        const toolBlock: ToolBlock = {
          id: `block_${blocks.length}`,
          timestamp,
          agent,
          type: 'tool',
          toolName: (payload.toolName as string) || 'unknown',
          toolCallId: (payload.toolCallId as string) || '',
          args: (payload.args as Record<string, unknown>) || {},
          isComplete: false,
        };
        blocks.push(toolBlock);
        break;
      }

      case 'tool_result': {
        const toolCallId = payload.toolCallId as string;
        const result = (payload.result as string) || '';
        // Find and update matching tool block
        const toolBlock = blocks.find(
          (b) => b.type === 'tool' && (b as ToolBlock).toolCallId === toolCallId
        ) as ToolBlock | undefined;
        if (toolBlock) {
          toolBlock.result = result;
          toolBlock.isComplete = true;
        }
        break;
      }

      case 'response': {
        const text = (payload.text as string) || '';
        if (text) {
          blocks.push({
            id: `block_${blocks.length}`,
            timestamp,
            agent,
            type: 'content',
            text,
          });
        }
        break;
      }

      case 'error': {
        blocks.push({
          id: `block_${blocks.length}`,
          timestamp,
          agent,
          type: 'error',
          message: (payload.message as string) || 'Unknown error',
        });
        break;
      }

      case 'complete':
        // No block to add, just marks end of stream
        break;
    }
  }

  return blocks;
}

export function ActivityFeedDemo({ events, isPlaying, onReset }: DemoProps) {
  // Convert events to blocks
  const blocks = useMemo(() => eventsToBlocks(events), [events]);

  // Check if subagent is active (no 'complete' event yet)
  const isActive = useMemo(() => {
    const lastEvent = events[events.length - 1];
    if (!lastEvent || lastEvent.type !== 'subagent_activity') return isPlaying;
    const payload = lastEvent.payload as SubagentActivityPayload;
    return payload.type !== 'complete';
  }, [events, isPlaying]);

  return (
    <ActivityFeed
      blocks={blocks}
      isActive={isActive}
      onClear={onReset}
    />
  );
}
