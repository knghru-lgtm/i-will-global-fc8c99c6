/**
 * Audio Recorder for Gemini Live API
 * Captures microphone audio, downsamples/converts to 16-bit mono linear PCM at 16kHz,
 * and streams base64-encoded chunks.
 */

export interface AudioRecorderOptions {
  sampleRate?: number;
  bufferSize?: number;
  onAudioData: (base64Pcm: string) => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (err: Error) => void;
}

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private isRecording = false;
  private isMuted = false;
  private options: AudioRecorderOptions;

  constructor(options: AudioRecorderOptions) {
    this.options = options;
  }

  public async start(): Promise<void> {
    if (this.isRecording) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Prefer 16000 Hz context if supported; otherwise downsample
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;

      // 4096 buffer size at 16kHz = ~256ms per chunk
      const bufferSize = this.options.bufferSize || 2048;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRecording || this.isMuted) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);
        const targetRate = 16000;
        const currentRate = this.audioContext?.sampleRate || 16000;

        let pcmData: Int16Array;

        if (currentRate === targetRate) {
          // Direct 16-bit PCM conversion
          pcmData = new Int16Array(inputBuffer.length);
          for (let i = 0; i < inputBuffer.length; i++) {
            const s = Math.max(-1, Math.min(1, inputBuffer[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        } else {
          // Linear downsampling to 16kHz
          const ratio = currentRate / targetRate;
          const newLength = Math.round(inputBuffer.length / ratio);
          pcmData = new Int16Array(newLength);
          for (let i = 0; i < newLength; i++) {
            const index = Math.min(Math.round(i * ratio), inputBuffer.length - 1);
            const s = Math.max(-1, Math.min(1, inputBuffer[index]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        }

        // Convert PCM Int16Array to base64
        const uint8 = new Uint8Array(pcmData.buffer);
        let binary = '';
        for (let i = 0; i < uint8.byteLength; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        this.options.onAudioData(base64);
      };

      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isRecording = true;
      this.startVolumeMonitoring();
    } catch (err: any) {
      if (this.options.onError) {
        this.options.onError(err);
      } else {
        console.error('AudioRecorder start failed:', err);
      }
      this.stop();
      throw err;
    }
  }

  private startVolumeMonitoring(): void {
    if (!this.analyserNode) return;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const checkVolume = () => {
      if (!this.isRecording) return;
      if (this.analyserNode && !this.isMuted) {
        this.analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(1, avg / 128);
        this.options.onVolumeChange?.(normalized);
      } else {
        this.options.onVolumeChange?.(0);
      }
      this.animFrameId = requestAnimationFrame(checkVolume);
    };

    this.animFrameId = requestAnimationFrame(checkVolume);
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public stop(): void {
    this.isRecording = false;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.options.onVolumeChange?.(0);
  }
}

