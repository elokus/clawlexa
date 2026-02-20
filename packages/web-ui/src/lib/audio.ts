/**
 * Audio Controller - Manages browser microphone capture and audio playback.
 *
 * - Captures microphone audio via AudioWorklet
 * - Resamples to 24kHz PCM16 for OpenAI Realtime API
 * - Plays back PCM16 24kHz audio from the agent
 */

export type AudioSendFn = (data: ArrayBuffer) => void;

export interface AudioControllerConfig {
  onAudio?: AudioSendFn;
  onError?: (error: Error) => void;
}

const TARGET_SAMPLE_RATE = 24000;

export class AudioController {
  private context: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private onAudio: AudioSendFn | null = null;
  private onError: ((error: Error) => void) | null = null;

  // Playback
  private playbackContext: AudioContext | null = null;
  private playbackQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private playbackStartTime = 0;
  private samplesScheduled = 0;

  constructor(config: AudioControllerConfig = {}) {
    this.onAudio = config.onAudio || null;
    this.onError = config.onError || null;
  }

  /**
   * Set the callback for sending audio data to the server.
   */
  setOnAudio(fn: AudioSendFn): void {
    this.onAudio = fn;
  }

  /**
   * Start microphone capture.
   */
  async start(): Promise<void> {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
        },
        video: false,
      });

      // Create AudioContext
      this.context = new AudioContext({
        sampleRate: 48000, // Browser typically supports 44100 or 48000
      });

      // Load AudioWorklet
      await this.context.audioWorklet.addModule('/audio-processor.js');

      // Create source node from microphone
      this.sourceNode = this.context.createMediaStreamSource(this.mediaStream);

      // Create worklet node
      this.workletNode = new AudioWorkletNode(this.context, 'audio-processor');

      // Handle processed audio from worklet
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio' && this.onAudio) {
          this.onAudio(event.data.data);
        }
      };

      // Connect: microphone -> worklet (no output, we just capture)
      this.sourceNode.connect(this.workletNode);

      // Initialize playback context
      this.playbackContext = new AudioContext({
        sampleRate: TARGET_SAMPLE_RATE,
      });

      console.log('[Audio] Capture started');
    } catch (error) {
      console.error('[Audio] Failed to start capture:', error);
      if (this.onError) {
        this.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Stop microphone capture and clean up resources.
   */
  stop(): void {
    // Stop capture
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.context) {
      this.context.close();
      this.context = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Stop playback and reset scheduling state
    // CRITICAL: Must reset playbackStartTime and samplesScheduled so that
    // the next session doesn't schedule audio far in the future based on
    // stale values from the previous session
    this.playbackQueue = [];
    this.isPlaying = false;
    this.playbackStartTime = 0;
    this.samplesScheduled = 0;

    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }

    console.log('[Audio] Stopped');
  }

  /**
   * Queue PCM16 24kHz audio for playback.
   */
  playAudio(data: ArrayBuffer): void {
    // Validate input
    if (!data || data.byteLength === 0) {
      return;
    }

    try {
      if (!this.playbackContext || this.playbackContext.state === 'closed') {
        // Lazy init playback context if capture wasn't started or context was closed
        this.playbackContext = new AudioContext({
          sampleRate: TARGET_SAMPLE_RATE,
        });
      }

      // Resume context if suspended (required for autoplay policy)
      if (this.playbackContext.state === 'suspended') {
        this.playbackContext.resume();
      }

      // Add to queue
      this.playbackQueue.push(data);

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.processPlaybackQueue();
      }
    } catch (err) {
      console.error('[Audio] Error queueing playback:', err);
    }
  }

  /**
   * Process the playback queue, scheduling audio buffers.
   */
  private processPlaybackQueue(): void {
    if (!this.playbackContext || this.playbackQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;

    // Process all queued buffers
    while (this.playbackQueue.length > 0) {
      const data = this.playbackQueue.shift()!;
      this.scheduleAudioBuffer(data);
    }
  }

  /**
   * Schedule an audio buffer for playback.
   */
  private scheduleAudioBuffer(data: ArrayBuffer): void {
    if (!this.playbackContext || this.playbackContext.state === 'closed') return;

    try {
      // Convert PCM16 to Float32
      const pcm16 = new Int16Array(data);
      if (pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);

      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 0x8000;
      }

      // Create audio buffer
      const audioBuffer = this.playbackContext.createBuffer(
        1, // mono
        float32.length,
        TARGET_SAMPLE_RATE
      );
      audioBuffer.getChannelData(0).set(float32);

      // Create buffer source
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);

      // Calculate when to start this buffer
      const currentTime = this.playbackContext.currentTime;

      // Check if we've fallen behind: compare END of scheduled audio vs current time
      // This prevents resetting during rapid buffer processing in a loop
      const scheduledEndTime = this.playbackStartTime + (this.samplesScheduled / TARGET_SAMPLE_RATE);
      if (this.samplesScheduled === 0 || scheduledEndTime < currentTime) {
        // First buffer or we've actually fallen behind - start immediately
        this.playbackStartTime = currentTime;
        this.samplesScheduled = 0;
      }

      const startOffset = this.samplesScheduled / TARGET_SAMPLE_RATE;
      const startTime = this.playbackStartTime + startOffset;

      source.start(startTime);
      this.samplesScheduled += float32.length;

      // When this buffer ends, check for more
      source.onended = () => {
        if (this.playbackQueue.length > 0) {
          this.processPlaybackQueue();
        } else {
          this.isPlaying = false;
        }
      };
    } catch (err) {
      console.error('[Audio] Error scheduling audio buffer:', err);
      this.isPlaying = false;
    }
  }

  /**
   * Interrupt current playback.
   */
  interrupt(): void {
    this.playbackQueue = [];
    this.samplesScheduled = 0;
    this.playbackStartTime = 0;
    this.isPlaying = false;

    // Create new context to immediately stop all scheduled audio
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = new AudioContext({
        sampleRate: TARGET_SAMPLE_RATE,
      });
    }
  }

  /**
   * Check if capture is active.
   */
  isCapturing(): boolean {
    return this.context !== null && this.context.state === 'running';
  }
}
