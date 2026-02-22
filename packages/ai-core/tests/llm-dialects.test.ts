import { describe, expect, it } from 'bun:test';
import {
  assertGoogleOptions,
  assertOpenRouterOptions,
  buildAnthropicProviderOverrides,
  buildGoogleProviderOverrides,
  buildOpenAiProviderOverrides,
  buildOpenRouterProviderOverrides,
  LlmDialectValidationError,
} from '../src/llm/dialects.js';

describe('ai-core llm dialects', () => {
  it('maps openrouter reasoning options into provider overrides', () => {
    const overrides = buildOpenRouterProviderOverrides('openai/gpt-5', {
      reasoning: {
        enabled: true,
        effort: 'high',
        maxTokens: 1024,
      },
      providerOverrides: {
        route: 'fallback',
      },
    });

    expect(overrides).toEqual({
      route: 'fallback',
      reasoning: {
        enabled: true,
        effort: 'high',
        max_tokens: 1024,
      },
    });
  });

  it('rejects unsupported reasoning.effort for anthropic upstream via openrouter', () => {
    expect(() =>
      assertOpenRouterOptions('anthropic/claude-sonnet-4', {
        reasoning: {
          effort: 'high',
        },
      })
    ).toThrow(LlmDialectValidationError);
  });

  it('accepts reasoning.effort for openai upstream via openrouter', () => {
    expect(() =>
      assertOpenRouterOptions('openai/gpt-5', {
        reasoning: {
          effort: 'high',
        },
      })
    ).not.toThrow();
  });

  it('maps openai reasoning config to ai-sdk openai provider option keys', () => {
    const overrides = buildOpenAiProviderOverrides('gpt-5', {
      reasoning: {
        enabled: true,
        effort: 'high',
        summary: 'concise',
      },
      maxCompletionTokens: 640,
      serviceTier: 'priority',
      providerOverrides: {
        user: 'voiceclaw-test',
      },
    });

    expect(overrides).toEqual({
      user: 'voiceclaw-test',
      reasoningEffort: 'high',
      reasoningSummary: 'concise',
      maxCompletionTokens: 640,
      serviceTier: 'priority',
    });
  });

  it('maps openai reasoning.enabled=false to reasoningEffort=none', () => {
    const overrides = buildOpenAiProviderOverrides('gpt-5', {
      reasoning: {
        enabled: false,
      },
    });

    expect(overrides).toEqual({
      reasoningEffort: 'none',
    });
  });

  it('maps anthropic adaptive thinking config with effort', () => {
    const overrides = buildAnthropicProviderOverrides('claude-sonnet-4-6', {
      thinking: {
        enabled: true,
        effort: 'max',
      },
    });

    expect(overrides).toEqual({
      thinking: {
        type: 'adaptive',
      },
      effort: 'max',
    });
  });

  it('maps anthropic budget-based thinking config', () => {
    const overrides = buildAnthropicProviderOverrides('claude-sonnet-4-5', {
      thinkingBudgetTokens: 2048,
    });

    expect(overrides).toEqual({
      thinking: {
        type: 'enabled',
        budgetTokens: 2048,
      },
    });
  });

  it('maps google thinking config to ai-sdk thinkingConfig keys', () => {
    const overrides = buildGoogleProviderOverrides('gemini-2.5-flash', {
      thinking: {
        enabled: true,
        level: 'high',
      },
    });

    expect(overrides).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: 'high',
      },
    });
  });

  it('maps google budget thinking config with includeThoughts override', () => {
    const overrides = buildGoogleProviderOverrides('gemini-2.5-flash', {
      thinking: {
        enabled: true,
        budgetTokens: 1024,
        includeThoughts: false,
      },
    });

    expect(overrides).toEqual({
      thinkingConfig: {
        includeThoughts: false,
        thinkingBudget: 1024,
      },
    });
  });

  it('rejects conflicting google thinking level and budget', () => {
    expect(() =>
      assertGoogleOptions('gemini-2.5-flash', {
        thinking: {
          enabled: true,
          level: 'high',
          budgetTokens: 1024,
        },
      })
    ).toThrow(LlmDialectValidationError);
  });
});
