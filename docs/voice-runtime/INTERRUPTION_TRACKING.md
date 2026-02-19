# Interruption Tracking

## Problem

When a user interrupts assistant speech, context should include what was actually heard, not the full generated response.

## Runtime Strategy

Interruption handling is centralized in `VoiceSessionImpl` and `InterruptionTracker`.

1. Track assistant text:
- `transcriptDelta` and `transcript` events update full/pending assistant text.

2. Track assistant audio timeline:
- Audio chunks advance cumulative playback duration.
- Pending text is associated with emitted audio windows.

3. Resolve interruption context:
- On `interrupt()`, session reads `ClientTransport.getPlaybackPositionMs()` when available.
- Tracker resolves `spokenText` vs `fullText`.
- Session emits `interruptionResolved`.

4. Apply truncation policy:
- If provider supports native truncation (`nativeTruncation` + `truncateOutput`), delegate provider truncation.
- Otherwise truncate local assistant history item and mark it interrupted.

## Key Files

- `packages/voice-runtime/src/runtime/interruption-tracker.ts`
- `packages/voice-runtime/src/runtime/voice-session.ts`
- `.plan/research/framework-interruption-tracking.md`

## Current Limits

- Text/audio alignment is chunk-based and approximate.
- Accuracy depends on transport playback position quality.
- Providers without item identifiers may limit exact history patching.

