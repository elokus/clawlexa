export type {
  ToolCallContext,
  ToolCallHandler,
  ToolCallResult,
  ToolDefinition,
  ToolReaction,
} from './tools/types.js';

export type {
  ConfigFieldDescriptor,
  ConfigFieldOption,
  ConfigFieldType,
  DecomposedProviderConfig,
  GeminiProviderConfig,
  OpenAIProviderConfig,
  PipecatProviderConfig,
  ProviderConfigSchema,
  ProviderVoiceEntry,
  UltravoxProviderConfig,
  VoiceHistoryItem,
  VoiceProviderId,
} from './voice/types.js';

export {
  parseDecomposedProviderConfig,
  parseGeminiProviderConfig,
  parseOpenAIProviderConfig,
  parsePipecatProviderConfig,
  parseProviderConfig,
  parseUltravoxProviderConfig,
  type ProviderConfigById,
} from './voice/provider-config.js';

export {
  createDefaultRuntimeAuthProfiles,
  fetchRuntimeProviderCatalog,
  fetchRuntimeProviderCatalogFromAuthProfiles,
  resolveRuntimeAuthKeySet,
  resolveRuntimeApiKey,
  runtimeAuthKeySetToProviderMap,
  testRuntimeProviderCredentials,
  RUNTIME_AUTH_PROVIDERS,
  type RuntimeAuthKeyByProvider,
  type RuntimeAuthKeySet,
  type RuntimeAuthProfile,
  type RuntimeAuthProfilesDocument,
  type RuntimeAuthProvider,
  type RuntimeCatalogEntry,
  type RuntimeProviderCatalog,
} from './voice/auth-catalog.js';

export type {
  LlmCompleteResult,
  LlmContext,
  LlmEvent,
  LlmFinishReason,
  LlmOptionsByProvider,
  LlmOptionsForProvider,
  LlmResponseSpec,
  LlmRuntime,
  LlmRuntimeRequest,
  LlmMessage,
  LlmModelRef,
  LlmOptions,
  OpenAiLlmOptions,
  AnthropicLlmOptions,
  GoogleLlmOptions,
  LlmReasoningEffort,
  LlmReasoningOptions,
  ModelModality,
  ModelRef,
  OpenRouterLlmOptions,
  RuntimeProviderId,
} from './llm/types.js';

export {
  assertLlmOptions,
  assertAnthropicOptions,
  assertGoogleOptions,
  assertOpenAiOptions,
  assertOpenRouterOptions,
  buildAnthropicProviderOverrides,
  buildGoogleProviderOverrides,
  buildOpenAiProviderOverrides,
  buildOpenRouterProviderOverrides,
  getOpenRouterDialectProfile,
  getOpenRouterUpstreamProviderId,
  LlmDialectValidationError,
} from './llm/dialects.js';
