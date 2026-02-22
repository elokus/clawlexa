import { jsonSchema, tool } from 'ai';
import type { ToolCallHandler, ToolCallResult, ToolDefinition } from '@voiceclaw/ai-core/tools';

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function normalizeToolResult(
  result: Awaited<ReturnType<ToolCallHandler>>
): { output: unknown; isError: boolean } {
  if (typeof result === 'string') {
    return { output: result, isError: false };
  }

  return {
    output: (result as ToolCallResult).result,
    isError: (result as ToolCallResult).isError === true,
  };
}

export function buildAiSdkToolSet(input: {
  providerId: string;
  model: string;
  definitions?: ToolDefinition[];
  toolHandler?: ToolCallHandler;
  legacyTools?: unknown;
}): Record<string, unknown> | undefined {
  if (input.legacyTools) {
    return input.legacyTools as Record<string, unknown>;
  }

  const tools = input.definitions;
  if (!tools || tools.length === 0) return undefined;

  if (!input.toolHandler) {
    throw new Error(
      'context.tools was provided but toolHandler is missing for llm-runtime execution'
    );
  }

  const toolSet: Record<string, unknown> = {};
  for (const definition of tools) {
    const parameters =
      definition.parameters && typeof definition.parameters === 'object'
        ? definition.parameters
        : { type: 'object', properties: {}, additionalProperties: true };

    toolSet[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(parameters),
      execute: async (toolInput, callOptions) => {
        const normalizedInput = normalizeToolInput(toolInput);
        const callId = callOptions.toolCallId ?? '';
        const result = await input.toolHandler?.(
          definition.name,
          normalizedInput,
          {
            providerId: input.providerId,
            callId,
            invocationId: callId,
            metadata: {
              model: input.model,
            },
          }
        );

        const normalizedResult = normalizeToolResult(
          result ?? { invocationId: callId, result: '' }
        );
        if (normalizedResult.isError) {
          throw new Error(
            typeof normalizedResult.output === 'string'
              ? normalizedResult.output
              : JSON.stringify(normalizedResult.output)
          );
        }
        return normalizedResult.output;
      },
    });
  }

  return toolSet;
}
