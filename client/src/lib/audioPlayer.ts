/**
 * Audio Player for Gemini Live API
 * Receives 24kHz 16-bit mono linear PCM base64 chunks and plays them seamlessly
 * through the Web Audio API with interruption handling and RMS volume metering.
 */

export interface AudioPlayerOptions {
  sampleRate?: number; // Default 24000
  onVolumeChange?: (volume: number) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private sampleRate: number;
  private isPlaying = false;
  private options: AudioPlayerOptions;

  constructor(options?: AudioPlayerOptions) {
    this.options = options || {};
    this.sampleRate = this.options.sampleRate || 24000;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.connect(this.audioContext.destination);
      this.startVolumeMonitoring();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  /**
   * Enqueue a base64-encoded 24kHz 16-bit linear PCM chunk to play seamlessly.
   */
  public enqueueChunk(base64Data: string): void {
    const ctx = this.ensureContext();

    // Decode base64 to byte array
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Convert Int16 PCM to Float32 [-1.0, 1.0]
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
    }

    // Create AudioBuffer
    const audioBuffer = ctx.createBuffer(1, float32Array.length, this.sampleRate);
    audioBuffer.copyToChannel(float32Array, 0);

    // Schedule playback seamlessly
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;

    if (this.analyserNode) {
      sourceNode.connect(this.analyserNode);
    } else {
      sourceNode.connect(ctx.destination);
    }

    const currentTime = ctx.currentTime;
    // Add small 20ms safety margin if buffer underran
    const startTime = Math.max(currentTime, this.nextStartTime);
    sourceNode.start(startTime);

    this.nextStartTime = startTime + audioBuffer.duration;
    this.activeSources.push(sourceNode);

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.options.onPlaybackStateChange?.(true);
    }

    sourceNode.onended = () => {
      const idx = this.activeSources.indexOf(sourceNode);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0 && ctx.currentTime >= this.nextStartTime - 0.05) {
        this.isPlaying = false;
        this.options.onPlaybackStateChange?.(false);
        this.options.onVolumeChange?.(0);
      }
    };
  }

  /**
   * Immediately stops all currently playing and queued audio buffers (for interruptions).
   */
  public stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.options.onPlaybackStateChange?.(false);
    this.options.onVolumeChange?.(0);
  }

  private startVolumeMonitoring(): void {
    if (!this.analyserNode) return;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const checkVolume = () => {
      if (this.analyserNode && this.isPlaying) {
        this.analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(1, avg / 128);
        this.options.onVolumeChange?.(normalized);
      } else if (!this.isPlaying) {
        this.options.onVolumeChange?.(0);
      }
      this.animFrameId = requestAnimationFrame(checkVolume);
    };

    this.animFrameId = requestAnimationFrame(checkVolume);
  }

  public destroy(): void {
    this.stop();
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

