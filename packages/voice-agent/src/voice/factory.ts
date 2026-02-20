import type { AgentProfile } from '../agent/profiles.js';
import type { VoiceAgent } from '../agent/voice-agent.js';
import {
  createVoiceRuntime as createPackageVoiceRuntime,
  getBuiltInProviderRegistry,
  resolveRuntimeSessionInput,
  type ToolCallHandler as PackageToolCallHandler,
  type ToolDefinition as PackageToolDefinition,
} from '@voiceclaw/voice-runtime';
import type { FunctionTool } from '@openai/agents-core';
import { RunContext } from '@openai/agents-core';
import { resolveVoiceRuntimeConfig } from './config.js';
import { PackageBackedVoiceRuntime } from './package-backed-runtime.js';
import { getToolsForSession } from '../tools/index.js';
import type { VoiceRuntime } from './types.js';

function normalizeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function buildTooling(
  profile: AgentProfile,
  sessionId: string,
  voiceAgent?: VoiceAgent
): {
  tools: PackageToolDefinition[];
  toolHandler: PackageToolCallHandler;
} {
  const functionTools = getToolsForSession(profile.tools, {
    sessionId,
    voiceAgent,
  }).filter((tool): tool is FunctionTool<any, any, any> => tool.type === 'function');

  const toolMap = new Map(functionTools.map((tool) => [tool.name, tool]));

  return {
    tools: functionTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: (tool.parameters ?? {}) as Record<string, unknown>,
    })),
    toolHandler: async (name, args, context) => {
      const tool = toolMap.get(name);
      if (!tool) {
        return {
          invocationId: context.invocationId,
          result: `Tool ${name} is not available in this profile.`,
          isError: true,
        };
      }

      const output = await tool.invoke(
        new RunContext({
          history: context.history as unknown as never[],
        }),
        JSON.stringify(args)
      );
      return {
        invocationId: context.invocationId,
        result: normalizeToolOutput(output),
      };
    },
  };
}

export function createVoiceRuntime(
  profile: AgentProfile,
  sessionId: string,
  voiceAgent?: VoiceAgent
): VoiceRuntime {
  const runtimeConfig = resolveVoiceRuntimeConfig(profile);
  console.log(
    `[VoiceRuntime] profile=${profile.name} mode=${runtimeConfig.mode} provider=${runtimeConfig.provider}` +
      ` stt=${runtimeConfig.decomposedSttProvider}/${runtimeConfig.decomposedSttModel}` +
      ` llm=${runtimeConfig.decomposedLlmProvider}/${runtimeConfig.decomposedLlmModel}` +
      ` tts=${runtimeConfig.decomposedTtsProvider}/${runtimeConfig.decomposedTtsModel}`
  );

  const { tools, toolHandler } = buildTooling(profile, sessionId, voiceAgent);
  const runtimeHost = createPackageVoiceRuntime(getBuiltInProviderRegistry());

  const sessionInput = resolveRuntimeSessionInput({
    instructions: profile.instructions,
    language: runtimeConfig.language,
    voice: runtimeConfig.voice,
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    geminiModel: runtimeConfig.geminiModel,
    ultravoxModel: runtimeConfig.ultravoxModel,
    pipecatServerUrl: runtimeConfig.pipecatServerUrl,
    pipecatTransport: runtimeConfig.pipecatTransport,
    pipecatBotId: runtimeConfig.pipecatBotId,
    decomposedSttProvider: runtimeConfig.decomposedSttProvider,
    decomposedSttModel: runtimeConfig.decomposedSttModel,
    decomposedLlmProvider: runtimeConfig.decomposedLlmProvider,
    decomposedLlmModel: runtimeConfig.decomposedLlmModel,
    decomposedTtsProvider: runtimeConfig.decomposedTtsProvider,
    decomposedTtsModel: runtimeConfig.decomposedTtsModel,
    decomposedTtsVoice: runtimeConfig.decomposedTtsVoice,
    turn: runtimeConfig.turn,
    providerSettings: runtimeConfig.providerSettings,
    auth: runtimeConfig.auth,
    tools,
    toolHandler,
  });

  return new PackageBackedVoiceRuntime({
    mode: runtimeConfig.mode,
    provider: runtimeConfig.provider,
    inputSampleRateHz: 24000,
    sessionFactory: () => runtimeHost.createSession(sessionInput),
  });
}
