# Provider Adapters

The runtime currently supports five adapters.

| Provider ID | Transport Style | Notes |
|---|---|---|
| `openai-sdk` | SDK / WS | OpenAI Agents Realtime SDK encapsulation. |
| `ultravox-ws` | WS | Native Ultravox REST-create plus websocket-join flow. |
| `gemini-live` | WS | Gemini Live websocket with setup/config handshake. |
| `decomposed` | HTTP pipeline | Runtime-controlled STT/LLM/TTS orchestration. |
| `pipecat-rtvi` | WS (transport-first) | RTVI protocol adapter with action/config handshake, keepalive ping, reconnect, and turn dedupe. |

## Shared Adapter Responsibilities

- Report `ProviderCapabilities`.
- Emit normalized `VoiceSessionEvents`.
- Convert provider-specific tool calls into normalized `toolStart` and `toolEnd`.
- Provide negotiated audio rates through `AudioNegotiation`.
- Normalize provider-specific ordering/role/transcript quirks so higher layers stay provider-agnostic.

## Testing Boundary

- Shared contract and live integration tests validate unified runtime behavior, not provider-specific message shapes.
- Provider-specific assertions belong in adapter-level tests under `packages/voice-runtime/tests/*adapter*.test.ts`.
- If a provider fails shared ordering/lifecycle expectations, fix the adapter/runtime normalization path.

## Capability Patterns

- `openai-sdk`: strongest native truncation path, usage metrics, tool approval path.
- `ultravox-ws`: server-side tool features (`precomputable`, `reaction`, `stage` semantics).
- `gemini-live`: scheduling/cancellation semantics and context compression features.
- `decomposed`: full pipeline control, predictable turn policy hooks.
- `pipecat-rtvi`: broad delegated provider support via RTVI protocol with websocket-first production path.

## Pipecat Production Notes

- Handshake: `client-ready` + `describe-actions` + `describe-config` + bootstrap message.
- Keepalive: periodic `client-message` ping after `bot-ready`.
- Reconnect: bounded exponential backoff on unexpected close.
- Turn lifecycle: deduped `turnComplete` event even when provider emits overlapping completion signals.

## Extension Pattern

To add a provider:

1. **Start with the [Provider Integration Guide](PROVIDER_INTEGRATION_GUIDE.md)** — research checklist, exploration pipeline, multi-turn test scenarios, and implementation checklist.
2. Implement `ProviderAdapter` in `packages/voice-runtime/src/adapters/`.
3. Define explicit capabilities in one constant object.
4. Emit normalized events only (do not leak wire protocol types).
5. Register in runtime host creation (`createVoiceRuntime` call site in app integration).
6. Document in `docs/providers/<PROVIDER>.md` following existing format.
