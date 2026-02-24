/**
 * Buffers LLM token deltas into speakable word chunks for Deepgram streaming.
 *
 * Responsibilities:
 * - keep token parsing state (`tokenBuffer`) separate from pre-audio buffering
 * - preserve original word order while audio hasn't started yet
 * - emit trailing non-space remainder on explicit flush
 */
export class DecomposedSpokenWordBuffer {
  private tokenBuffer = '';
  private preAudioBuffer = '';
  private audioStarted = false;

  ingestDelta(delta: string): string | null {
    if (!delta) {
      return null;
    }
    this.tokenBuffer += delta;
    const lastSpaceIdx = this.tokenBuffer.lastIndexOf(' ');
    if (lastSpaceIdx <= 0) {
      return null;
    }
    const completeWords = this.tokenBuffer.slice(0, lastSpaceIdx + 1);
    this.tokenBuffer = this.tokenBuffer.slice(lastSpaceIdx + 1);
    return this.bufferOrEmit(completeWords);
  }

  markAudioStarted(): string | null {
    if (this.audioStarted) {
      return null;
    }
    this.audioStarted = true;
    if (!this.preAudioBuffer) {
      return null;
    }
    const buffered = this.preAudioBuffer;
    this.preAudioBuffer = '';
    return buffered;
  }

  flushRemainder(): string | null {
    const remainder = this.tokenBuffer;
    this.tokenBuffer = '';
    if (!remainder.trim()) {
      return null;
    }
    return this.bufferOrEmit(remainder);
  }

  private bufferOrEmit(value: string): string | null {
    if (!value) {
      return null;
    }
    if (!this.audioStarted) {
      this.preAudioBuffer += value;
      return null;
    }
    return value;
  }
}
