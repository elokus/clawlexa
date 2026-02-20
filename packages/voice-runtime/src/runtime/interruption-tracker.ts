import type { AudioFrame, InterruptionContext } from '../types.js';

interface SpokenSegment {
  text: string;
  audioStartMs: number;
  audioEndMs: number;
}

/**
 * Tracks assistant text/audio alignment at session level so interruptions can
 * resolve "what the user actually heard" even for providers without native
 * truncation support.
 */
export class InterruptionTracker {
  private currentItemId: string | null = null;
  private fullText = '';
  private pendingText = '';
  private segments: SpokenSegment[] = [];
  private cumulativeAudioMs = 0;

  beginAssistantItem(itemId?: string): void {
    if (!itemId) return;
    if (this.currentItemId && this.currentItemId !== itemId) {
      this.reset();
    }
    this.currentItemId = itemId;
  }

  trackAssistantDelta(delta: string, itemId?: string): void {
    if (!delta) return;
    this.beginAssistantItem(itemId);
    this.pendingText += delta;
    this.fullText += delta;
  }

  trackAssistantTranscript(text: string, itemId?: string): void {
    if (!text) return;
    this.beginAssistantItem(itemId);
    this.fullText = text;
  }

  trackAssistantAudio(frame: AudioFrame): void {
    const chunkDurationMs = this.computeAudioDurationMs(frame);
    if (this.pendingText) {
      this.segments.push({
        text: this.pendingText,
        audioStartMs: this.cumulativeAudioMs,
        audioEndMs: this.cumulativeAudioMs + chunkDurationMs,
      });
      this.pendingText = '';
    }
    this.cumulativeAudioMs += chunkDurationMs;
  }

  hasActiveAssistantOutput(): boolean {
    return (
      this.currentItemId !== null ||
      this.fullText.length > 0 ||
      this.pendingText.length > 0 ||
      this.cumulativeAudioMs > 0
    );
  }

  resolve(playbackPositionMs?: number): InterruptionContext | null {
    if (!this.currentItemId && !this.fullText && this.cumulativeAudioMs === 0) {
      return null;
    }

    const rawPlaybackMs = playbackPositionMs ?? this.cumulativeAudioMs;
    const clampedPlaybackMs = Math.max(
      0,
      Math.min(rawPlaybackMs, this.cumulativeAudioMs || rawPlaybackMs)
    );

    let spokenText = this.segments
      .filter((segment) => segment.audioStartMs < clampedPlaybackMs)
      .map((segment) => segment.text)
      .join('');

    // Fallback for providers that do not align deltas tightly to audio chunks.
    if (!spokenText && this.fullText && clampedPlaybackMs > 0) {
      const ratio =
        this.cumulativeAudioMs > 0 ? clampedPlaybackMs / this.cumulativeAudioMs : 0;
      const chars = Math.max(
        0,
        Math.min(this.fullText.length, Math.floor(this.fullText.length * ratio))
      );
      spokenText = this.fullText.slice(0, chars);
    }

    if (spokenText.length > this.fullText.length && this.fullText) {
      spokenText = spokenText.slice(0, this.fullText.length);
    }

    return {
      itemId: this.currentItemId ?? undefined,
      fullText: this.fullText,
      spokenText,
      playbackPositionMs: clampedPlaybackMs,
      truncated: spokenText !== this.fullText,
    };
  }

  reset(): void {
    this.currentItemId = null;
    this.fullText = '';
    this.pendingText = '';
    this.segments = [];
    this.cumulativeAudioMs = 0;
  }

  private computeAudioDurationMs(frame: AudioFrame): number {
    if (frame.sampleRate <= 0) return 0;
    const sampleCount = frame.data.byteLength / 2;
    return (sampleCount / frame.sampleRate) * 1000;
  }
}
