import type { AgentProfile } from '../agent/profiles.js';
import type { VoiceAgent } from '../agent/voice-agent.js';
import {
  createVoiceRuntime as createPackageVoiceRuntime,
  DecomposedAdapter,
  GeminiLiveAdapter,
  OpenAISdkAdapter,
  PipecatRtviAdapter,
  type SessionInput as PackageSessionInput,
  type ToolCallHandler as PackageToolCallHandler,
  type ToolDefinition as PackageToolDefinition,
  UltravoxWsAdapter,
} from '@voiceclaw/voice-runtime';
import type { FunctionTool } from '@openai/agents-core';
import { RunContext } from '@openai/agents-core';
import { resolveVoiceRuntimeConfig } from './config.js';
import { PackageBackedVoiceRuntime } from './package-backed-runtime.js';
import { getToolsForSession } from '../tools/index.js';
import type { VoiceProviderName, VoiceRuntime } from './types.js';

type ResolvedRuntimeConfig = ReturnType<typeof resolveVoiceRuntimeConfig>;

function providerIdForRuntime(
  provider: VoiceProviderName
): PackageSessionInput['provider'] {
  if (provider === 'ultravox-realtime') return 'ultravox-ws';
  if (provider === 'gemini-live') return 'gemini-live';
  if (provider === 'pipecat-rtvi') return 'pipecat-rtvi';
  if (provider === 'decomposed') return 'decomposed';
  return 'openai-sdk';
}

function modelForProvider(
  provider: VoiceProviderName,
  runtimeConfig: ResolvedRuntimeConfig
): string {
  if (provider === 'ultravox-realtime') return runtimeConfig.ultravoxModel;
  if (provider === 'gemini-live') return runtimeConfig.geminiModel;
  if (provider === 'pipecat-rtvi') return runtimeConfig.model;
  if (provider === 'decomposed') return runtimeConfig.decomposedLlmModel;
  return runtimeConfig.model;
}

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

function providerConfigFor(
  provider: VoiceProviderName,
  runtimeConfig: ResolvedRuntimeConfig
): Record<string, unknown> {
  if (provider === 'ultravox-realtime') {
    return {
      apiKey: runtimeConfig.auth.ultravoxApiKey,
      model: runtimeConfig.ultravoxModel,
      voice: runtimeConfig.voice,
    };
  }

  if (provider === 'gemini-live') {
    return {
      apiKey: runtimeConfig.auth.googleApiKey,
      enableInputTranscription: true,
      enableOutputTranscription: true,
      contextWindowCompressionTokens: 10000,
      proactivity: false,
    };
  }

  if (provider === 'decomposed') {
    return {
      openaiApiKey: runtimeConfig.auth.openaiApiKey,
      openrouterApiKey: runtimeConfig.auth.openrouterApiKey,
      deepgramApiKey: runtimeConfig.auth.deepgramApiKey,
      sttProvider: runtimeConfig.decomposedSttProvider,
      sttModel: runtimeConfig.decomposedSttModel,
      llmProvider: runtimeConfig.decomposedLlmProvider,
      llmModel: runtimeConfig.decomposedLlmModel,
      ttsProvider: runtimeConfig.decomposedTtsProvider,
      ttsModel: runtimeConfig.decomposedTtsModel,
      ttsVoice: runtimeConfig.decomposedTtsVoice,
      turn: runtimeConfig.turn,
    };
  }

  if (provider === 'pipecat-rtvi') {
    return {
      serverUrl: runtimeConfig.pipecatServerUrl,
      transport: runtimeConfig.pipecatTransport,
      botId: runtimeConfig.pipecatBotId,
      inputSampleRate: 24000,
      outputSampleRate: 24000,
      autoToolExecution: true,
    };
  }

  return {
    apiKey: runtimeConfig.auth.openaiApiKey,
    language: runtimeConfig.language,
    turnDetection: 'semantic_vad',
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
  const packageProviderId = providerIdForRuntime(runtimeConfig.provider);

  const runtimeHost = createPackageVoiceRuntime([
    {
      id: 'openai-sdk',
      label: 'openai-realtime',
      createAdapter: () => new OpenAISdkAdapter(),
    },
    {
      id: 'ultravox-ws',
      label: 'ultravox-realtime',
      createAdapter: () => new UltravoxWsAdapter(),
    },
    {
      id: 'gemini-live',
      label: 'gemini-live',
      createAdapter: () => new GeminiLiveAdapter(),
    },
    {
      id: 'decomposed',
      label: 'decomposed',
      createAdapter: () => new DecomposedAdapter(),
    },
    {
      id: 'pipecat-rtvi',
      label: 'pipecat-rtvi',
      createAdapter: () => new PipecatRtviAdapter(),
    },
  ]);

  const sessionInput: PackageSessionInput = {
    provider: packageProviderId,
    instructions: profile.instructions,
    voice: runtimeConfig.voice,
    model: modelForProvider(runtimeConfig.provider, runtimeConfig),
    language: runtimeConfig.language,
    tools,
    toolHandler,
    providerConfig: providerConfigFor(runtimeConfig.provider, runtimeConfig),
  };

  return new PackageBackedVoiceRuntime({
    mode: runtimeConfig.mode,
    provider: runtimeConfig.provider,
    inputSampleRateHz: 24000,
    sessionFactory: () => runtimeHost.createSession(sessionInput),
  });
}
