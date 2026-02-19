import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderDescriptor,
  SessionInput,
  VoiceProviderId,
  VoiceRuntime,
  VoiceSession,
} from '../types.js';
import { VoiceSessionImpl } from './voice-session.js';

export interface ProviderRegistration {
  id: VoiceProviderId;
  label: string;
  createAdapter: () => ProviderAdapter;
  capabilities?: ProviderCapabilities;
}

interface ResolvedProviderRegistration {
  id: VoiceProviderId;
  label: string;
  createAdapter: () => ProviderAdapter;
  capabilities: ProviderCapabilities;
}

export class VoiceRuntimeImpl implements VoiceRuntime {
  private readonly providers = new Map<VoiceProviderId, ResolvedProviderRegistration>();

  constructor(registrations: ProviderRegistration[]) {
    for (const registration of registrations) {
      this.register(registration);
    }
  }

  listProviders(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      label: provider.label,
      capabilities: provider.capabilities,
    }));
  }

  async createSession(input: SessionInput): Promise<VoiceSession> {
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw new Error(`Provider not registered: ${input.provider}`);
    }

    const adapter = provider.createAdapter();
    if (adapter.id !== input.provider) {
      throw new Error(
        `Adapter id mismatch: expected ${input.provider}, got ${adapter.id}`
      );
    }

    return new VoiceSessionImpl(adapter, input);
  }

  private register(registration: ProviderRegistration): void {
    const capabilities =
      registration.capabilities ?? registration.createAdapter().capabilities();

    this.providers.set(registration.id, {
      id: registration.id,
      label: registration.label,
      createAdapter: registration.createAdapter,
      capabilities,
    });
  }
}

export function createVoiceRuntime(registrations: ProviderRegistration[]): VoiceRuntime {
  return new VoiceRuntimeImpl(registrations);
}
