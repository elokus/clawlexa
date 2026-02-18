/**
 * AudioWorklet Processor - Resamples audio from browser rate (44.1/48kHz) to API rate (24kHz)
 *
 * Converts Float32 samples to PCM16 (Int16) for transmission.
 * Posts processed audio chunks to the main thread.
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Target sample rate for OpenAI Realtime API
    this.targetSampleRate = 24000;

    // Buffer for accumulating samples before sending
    this.buffer = [];
    this.bufferSize = 960; // 40ms at 24kHz for lower round-trip latency
  }

  /**
   * Process audio data from the microphone.
   * @param {Float32Array[][]} inputs - Input audio data
   * @param {Float32Array[][]} outputs - Output audio data (not used)
   * @param {Object} parameters - Processor parameters
   * @returns {boolean} - Return true to keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    // Get mono channel (use first channel if stereo)
    const inputData = input[0];

    // Resample from source rate to 24kHz
    const resampled = this.resample(inputData, sampleRate, this.targetSampleRate);

    // Add to buffer
    this.buffer.push(...resampled);

    // Send when buffer is full enough
    if (this.buffer.length >= this.bufferSize) {
      // Convert to PCM16
      const pcm16 = this.floatToPCM16(this.buffer.slice(0, this.bufferSize));

      // Post to main thread
      this.port.postMessage({
        type: 'audio',
        data: pcm16.buffer,
      }, [pcm16.buffer]);

      // Keep remaining samples
      this.buffer = this.buffer.slice(this.bufferSize);
    }

    return true;
  }

  /**
   * Resample audio from source rate to target rate using linear interpolation.
   * @param {Float32Array} data - Source audio data
   * @param {number} fromRate - Source sample rate
   * @param {number} toRate - Target sample rate
   * @returns {number[]} - Resampled audio data
   */
  resample(data, fromRate, toRate) {
    if (fromRate === toRate) {
      return Array.from(data);
    }

    const ratio = fromRate / toRate;
    const newLength = Math.floor(data.length / ratio);
    const result = [];

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      // Linear interpolation
      const value = data[srcIndexFloor] * (1 - fraction) + data[srcIndexCeil] * fraction;
      result.push(value);
    }

    return result;
  }

  /**
   * Convert Float32 samples (-1 to 1) to PCM16 (Int16).
   * @param {number[]} samples - Float32 audio samples
   * @returns {Int16Array} - PCM16 audio data
   */
  floatToPCM16(samples) {
    const pcm16 = new Int16Array(samples.length);

    for (let i = 0; i < samples.length; i++) {
      // Clamp to -1..1 and scale to Int16 range
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return pcm16;
  }
}

registerProcessor('audio-processor', AudioProcessor);
