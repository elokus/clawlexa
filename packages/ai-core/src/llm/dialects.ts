import type {
  AnthropicLlmOptions,
  GoogleLlmOptions,
  LlmModelRef,
  LlmOptionsForProvider,
  OpenAiLlmOptions,
  OpenRouterLlmOptions,
  RuntimeProviderId,
} from './types.js';

export type OpenRouterUpstreamProviderId = string & {};

export interface OpenRouterReasoningSupport {
  enabled: boolean;
  effort: boolean;
  maxTokens: boolean;
}

export interface OpenRouterDialectProfile {
  upstreamProvider: OpenRouterUpstreamProviderId;
  reasoning: OpenRouterReasoningSupport;
}

const OPENROUTER_DEFAULT_REASONING_SUPPORT: OpenRouterReasoningSupport = {
  enabled: true,
  effort: true,
  maxTokens: true,
};

const OPENROUTER_REASONING_SUPPORT_BY_UPSTREAM: Record<
  string,
  OpenRouterReasoningSupport
> = {
  anthropic: {
    enabled: true,
    effort: false,
    maxTokens: true,
  },
  google: {
    enabled: true,
    effort: false,
    maxTokens: true,
  },
  openai: {
    enabled: true,
    effort: true,
    maxTokens: true,
  },
  'x-ai': {
    enabled: true,
    effort: true,
    maxTokens: true,
  },
};

export class LlmDialectValidationError extends Error {
  readonly code = 'unsupported_option';
  readonly provider: RuntimeProviderId;
  readonly model: string;
  readonly option: string;

  constructor(input: {
    provider: RuntimeProviderId;
    model: string;
    option: string;
    message?: string;
  }) {
    super(
      input.message ??
        `Option "${input.option}" is not supported for ${input.provider}:${input.model}`
    );
    this.name = 'LlmDialectValidationError';
    this.provider = input.provider;
    this.model = input.model;
    this.option = input.option;
  }
}

export function getOpenRouterUpstreamProviderId(
  model: string
): OpenRouterUpstreamProviderId {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0) return 'unknown' as OpenRouterUpstreamProviderId;
  return model.slice(0, slashIndex).toLowerCase() as OpenRouterUpstreamProviderId;
}

export function getOpenRouterDialectProfile(
  model: string
): OpenRouterDialectProfile {
  const upstreamProvider = getOpenRouterUpstreamProviderId(model);
  const reasoning =
    OPENROUTER_REASONING_SUPPORT_BY_UPSTREAM[upstreamProvider] ??
    OPENROUTER_DEFAULT_REASONING_SUPPORT;

  return {
    upstreamProvider,
    reasoning,
  };
}

export function assertOpenRouterOptions(
  model: string,
  options?: OpenRouterLlmOptions
): void {
  const reasoning = options?.reasoning;
  if (!reasoning) return;

  const profile = getOpenRouterDialectProfile(model);

  if (typeof reasoning.enabled === 'boolean' && !profile.reasoning.enabled) {
    throw new LlmDialectValidationError({
      provider: 'openrouter',
      model,
      option: 'reasoning.enabled',
    });
  }

  if (typeof reasoning.effort === 'string' && !profile.reasoning.effort) {
    throw new LlmDialectValidationError({
      provider: 'openrouter',
      model,
      option: 'reasoning.effort',
    });
  }

  if (
    typeof reasoning.maxTokens === 'number' &&
    !profile.reasoning.maxTokens
  ) {
    throw new LlmDialectValidationError({
      provider: 'openrouter',
      model,
      option: 'reasoning.maxTokens',
    });
  }
}

export function buildOpenRouterProviderOverrides(
  model: string,
  options?: OpenRouterLlmOptions
): Record<string, unknown> | undefined {
  assertOpenRouterOptions(model, options);

  const overrides: Record<string, unknown> = {
    ...(options?.providerOverrides ?? {}),
  };

  const reasoning = options?.reasoning;
  if (reasoning) {
    const currentReasoning =
      typeof overrides.reasoning === 'object' && overrides.reasoning !== null
        ? (overrides.reasoning as Record<string, unknown>)
        : {};

    const nextReasoning: Record<string, unknown> = {
      ...currentReasoning,
    };

    if (typeof reasoning.enabled === 'boolean') {
      nextReasoning.enabled = reasoning.enabled;
    }

    if (typeof reasoning.effort === 'string') {
      nextReasoning.effort = reasoning.effort;
    }

    if (typeof reasoning.maxTokens === 'number') {
      nextReasoning.max_tokens = reasoning.maxTokens;
    }

    if (Object.keys(nextReasoning).length > 0) {
      overrides.reasoning = nextReasoning;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function assertOpenAiOptions(
  model: string,
  options?: OpenAiLlmOptions
): void {
  const reasoning = options?.reasoning;
  if (reasoning) {
    if (reasoning.enabled === false && reasoning.effort && reasoning.effort !== 'none') {
      throw new LlmDialectValidationError({
        provider: 'openai',
        model,
        option: 'reasoning.effort',
        message: 'reasoning.effort cannot be set when reasoning.enabled is false',
      });
    }

    if (reasoning.enabled === true && reasoning.effort === 'none') {
      throw new LlmDialectValidationError({
        provider: 'openai',
        model,
        option: 'reasoning.effort',
        message: 'reasoning.effort="none" conflicts with reasoning.enabled=true',
      });
    }
  }

  const maxCompletionTokens =
    options?.maxCompletionTokens ?? reasoning?.maxOutputTokens;
  if (
    maxCompletionTokens !== undefined &&
    (!Number.isFinite(maxCompletionTokens) || maxCompletionTokens <= 0)
  ) {
    throw new LlmDialectValidationError({
      provider: 'openai',
      model,
      option: 'maxCompletionTokens',
      message: 'maxCompletionTokens must be a positive number',
    });
  }
}

function resolveOpenAiReasoningEffort(
  options?: OpenAiLlmOptions
): OpenAiLlmOptions['reasoningEffort'] | undefined {
  if (typeof options?.reasoningEffort === 'string') {
    return options.reasoningEffort;
  }

  const reasoning = options?.reasoning;
  if (!reasoning) return undefined;

  if (typeof reasoning.effort === 'string') return reasoning.effort;
  if (reasoning.enabled === false) return 'none';
  if (reasoning.enabled === true) return 'medium';
  return undefined;
}

function resolveOpenAiReasoningSummary(
  options?: OpenAiLlmOptions
): OpenAiLlmOptions['reasoningSummary'] | undefined {
  if (options?.reasoningSummary !== undefined) return options.reasoningSummary;
  return options?.reasoning?.summary;
}

function resolveOpenAiMaxCompletionTokens(
  options?: OpenAiLlmOptions
): number | undefined {
  if (typeof options?.maxCompletionTokens === 'number') {
    return options.maxCompletionTokens;
  }
  if (typeof options?.reasoning?.maxOutputTokens === 'number') {
    return options.reasoning.maxOutputTokens;
  }
  return undefined;
}

interface ResolvedAnthropicThinkingOptions {
  enabled?: boolean;
  budgetTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'max';
}

function resolveAnthropicThinking(
  options?: AnthropicLlmOptions
): ResolvedAnthropicThinkingOptions {
  return {
    enabled: options?.thinking?.enabled ?? options?.thinkingEnabled,
    budgetTokens:
      options?.thinking?.budgetTokens ?? options?.thinkingBudgetTokens,
    effort: options?.thinking?.effort ?? options?.effort,
  };
}

export function assertAnthropicOptions(
  model: string,
  options?: AnthropicLlmOptions
): void {
  const thinking = resolveAnthropicThinking(options);

  if (
    thinking.budgetTokens !== undefined &&
    (!Number.isFinite(thinking.budgetTokens) || thinking.budgetTokens < 0)
  ) {
    throw new LlmDialectValidationError({
      provider: 'anthropic',
      model,
      option: 'thinking.budgetTokens',
      message: `Option "thinking.budgetTokens" must be a non-negative number for anthropic:${model}`,
    });
  }

  if (
    typeof thinking.budgetTokens === 'number' &&
    thinking.enabled === false
  ) {
    throw new LlmDialectValidationError({
      provider: 'anthropic',
      model,
      option: 'thinking.enabled',
      message:
        'Option "thinking.enabled=false" cannot be combined with thinking.budgetTokens',
    });
  }

  if (typeof thinking.effort === 'string' && thinking.enabled === false) {
    throw new LlmDialectValidationError({
      provider: 'anthropic',
      model,
      option: 'effort',
      message: 'effort cannot be set when thinking is disabled',
    });
  }

  if (
    typeof thinking.effort === 'string' &&
    typeof thinking.budgetTokens === 'number'
  ) {
    throw new LlmDialectValidationError({
      provider: 'anthropic',
      model,
      option: 'thinking',
      message:
        'effort (adaptive thinking) and budgetTokens (budgeted thinking) are mutually exclusive',
    });
  }
}

export function assertGoogleOptions(
  model: string,
  options?: GoogleLlmOptions
): void {
  const thinking = options?.thinking;
  if (!thinking) return;

  if (
    thinking.budgetTokens !== undefined &&
    (!Number.isFinite(thinking.budgetTokens) || thinking.budgetTokens < 0)
  ) {
    throw new LlmDialectValidationError({
      provider: 'google',
      model,
      option: 'thinking.budgetTokens',
      message: `Option "thinking.budgetTokens" must be a non-negative number for google:${model}`,
    });
  }

  if (
    typeof thinking.budgetTokens === 'number' &&
    thinking.budgetTokens > 0 &&
    thinking.enabled === false
  ) {
    throw new LlmDialectValidationError({
      provider: 'google',
      model,
      option: 'thinking.enabled',
      message:
        'Option "thinking.enabled=false" cannot be combined with thinking.budgetTokens',
    });
  }

  if (thinking.includeThoughts === true && thinking.enabled === false) {
    throw new LlmDialectValidationError({
      provider: 'google',
      model,
      option: 'thinking.includeThoughts',
      message:
        'Option "thinking.includeThoughts=true" requires thinking.enabled=true',
    });
  }

  if (
    typeof thinking.level === 'string' &&
    typeof thinking.budgetTokens === 'number'
  ) {
    throw new LlmDialectValidationError({
      provider: 'google',
      model,
      option: 'thinking',
      message:
        'thinking.level and thinking.budgetTokens are mutually exclusive',
    });
  }
}

export function buildOpenAiProviderOverrides(
  model: string,
  options?: OpenAiLlmOptions
): Record<string, unknown> | undefined {
  assertOpenAiOptions(model, options);

  const overrides: Record<string, unknown> = {
    ...(options?.providerOverrides ?? {}),
  };

  const reasoningEffort = resolveOpenAiReasoningEffort(options);
  const reasoningSummary = resolveOpenAiReasoningSummary(options);
  const maxCompletionTokens = resolveOpenAiMaxCompletionTokens(options);

  if (typeof reasoningEffort === 'string') {
    overrides.reasoningEffort = reasoningEffort;
  }

  if (typeof reasoningSummary === 'string') {
    overrides.reasoningSummary = reasoningSummary;
  }

  if (typeof options?.serviceTier === 'string') {
    overrides.serviceTier = options.serviceTier;
  }

  if (typeof options?.strictJsonSchema === 'boolean') {
    overrides.strictJsonSchema = options.strictJsonSchema;
  }

  if (typeof maxCompletionTokens === 'number') {
    overrides.maxCompletionTokens = maxCompletionTokens;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function buildAnthropicProviderOverrides(
  model: string,
  options?: AnthropicLlmOptions
): Record<string, unknown> | undefined {
  assertAnthropicOptions(model, options);

  const overrides: Record<string, unknown> = {
    ...(options?.providerOverrides ?? {}),
  };

  const thinking = resolveAnthropicThinking(options);
  const hasThinkingInput =
    thinking.enabled !== undefined ||
    thinking.budgetTokens !== undefined ||
    thinking.effort !== undefined;

  if (hasThinkingInput) {
    if (thinking.enabled === false) {
      overrides.thinking = { type: 'disabled' };
      delete overrides.effort;
    } else if (typeof thinking.effort === 'string') {
      // Aligns with pi-mono adaptive mode semantics.
      overrides.thinking = { type: 'adaptive' };
      overrides.effort = thinking.effort;
    } else {
      const nextThinking: Record<string, unknown> = { type: 'enabled' };
      if (typeof thinking.budgetTokens === 'number' && thinking.budgetTokens > 0) {
        nextThinking.budgetTokens = thinking.budgetTokens;
      }
      overrides.thinking = nextThinking;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function buildGoogleProviderOverrides(
  model: string,
  options?: GoogleLlmOptions
): Record<string, unknown> | undefined {
  assertGoogleOptions(model, options);

  const overrides: Record<string, unknown> = {
    ...(options?.providerOverrides ?? {}),
  };

  const thinking = options?.thinking;
  if (thinking) {
    if (thinking.enabled === false) {
      // Disable by omitting thinking config, matching pi-mono semantics.
      delete overrides.thinkingConfig;
    } else if (
      thinking.enabled === true ||
      thinking.level !== undefined ||
      thinking.budgetTokens !== undefined ||
      thinking.includeThoughts !== undefined
    ) {
      const currentThinkingConfig =
        typeof overrides.thinkingConfig === 'object' &&
        overrides.thinkingConfig !== null
          ? (overrides.thinkingConfig as Record<string, unknown>)
          : {};

      const nextThinkingConfig: Record<string, unknown> = {
        ...currentThinkingConfig,
        includeThoughts: thinking.includeThoughts ?? true,
      };

      if (typeof thinking.level === 'string') {
        nextThinkingConfig.thinkingLevel = thinking.level;
      } else if (typeof thinking.budgetTokens === 'number') {
        nextThinkingConfig.thinkingBudget = thinking.budgetTokens;
      }

      overrides.thinkingConfig = nextThinkingConfig;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function assertLlmOptions<P extends RuntimeProviderId>(
  model: LlmModelRef<P>,
  options?: LlmOptionsForProvider<P>
): void {
  if (model.provider === 'openrouter') {
    assertOpenRouterOptions(model.model, options as OpenRouterLlmOptions);
    return;
  }

  if (model.provider === 'openai') {
    assertOpenAiOptions(model.model, options as OpenAiLlmOptions);
    return;
  }

  if (model.provider === 'anthropic') {
    assertAnthropicOptions(model.model, options as AnthropicLlmOptions);
    return;
  }

  if (model.provider === 'google') {
    assertGoogleOptions(model.model, options as GoogleLlmOptions);
  }
}
