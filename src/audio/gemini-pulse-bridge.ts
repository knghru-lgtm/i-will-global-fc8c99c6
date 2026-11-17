import { execSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { writeSarahState } from '../watchdog/sarah-watchdog.ts';

export const VOICE_PROFILE = 'Vindemiatrix' as const;
export const CALLER_SINK = 'gv_speaker'; // Chromium outputs caller voice here (16kHz)
export const SARAH_OUT_SINK = 'gv_mic_sink'; // Gemini writes Vindemiatrix voice here (24kHz)
export const SARAH_VIRTUAL_MIC = 'sarah_virtual_mic'; // Chromium reads mic input from here
export const MIN_OPENING_SCRIPT_PCM_BYTES = 96000; // >= 2.0s of 24kHz 16-bit mono PCM audio
export const INITIAL_BARGE_IN_GUARD_MS = 6000; // 6s immunity against connection static/click barge-in

const AFTER_HOURS_CLOSED_GREETING =
  'Thank you for calling I Will Global. Our office is currently closed. Our regular business hours are Monday through Saturday from 9 AM to 7 PM Arizona time. Please call us back during normal business hours. Have a wonderful day.';

const BUSINESS_HOURS_OPENING_GREETING =
  'Thank you for calling I Will Global Insurance and Financial Services. This is Sarah speaking. Whom do I have the pleasure of speaking with, and how may I help you today?';

function hydrateDotEnv(): void {
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(thisDir, '..', '..');
    for (const p of [path.join(repoRoot, '.env'), path.join(repoRoot, 'server', '.env')]) {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[k] === undefined) process.env[k] = v;
      }
    }
  } catch {}
}
hydrateDotEnv();

function pulseEnv(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  return {
    ...process.env,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
    PULSE_SINK: CALLER_SINK,
    PULSE_SOURCE: SARAH_VIRTUAL_MIC,
    PULSE_LATENCY_MSEC: '10',
  };
}

function isArizonaBusinessHoursNow(): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Phoenix',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const wk = parts.find((p) => p.type === 'weekday')?.value || '';
    const hr = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    if (wk === 'Sun') return false;
    return hr >= 9 && hr < 19;
  } catch {
    return true;
  }
}

export function setupZeroLagPulseAudioTopology(): void {
  if (process.platform !== 'linux') return;
  const env = pulseEnv();
  try {
    execSync(
      'pulseaudio --check 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --realtime=true --system=false --disallow-module-loading=false 2>/dev/null || true',
      { stdio: 'ignore', env }
    );

    const existingModules = execSync('pactl list short modules', { env }).toString();
    for (const line of existingModules.split('\n')) {
      if (
        line.includes(CALLER_SINK) ||
        line.includes(SARAH_OUT_SINK) ||
        line.includes(SARAH_VIRTUAL_MIC) ||
        line.includes('virtual_speaker') ||
        line.includes('SarahCloudNullSink')
      ) {
        const modId = line.trim().split(/\s+/)[0];
        if (modId) {
          try {
            execSync(`pactl unload-module ${modId}`, { stdio: 'ignore', env });
          } catch {}
        }
      }
    }

    execSync(
      `pactl load-module module-null-sink sink_name=${CALLER_SINK} rate=16000 channels=1 sink_properties=device.description="Caller_From_GoogleVoice"`,
      { env }
    );
    execSync(
      `pactl load-module module-null-sink sink_name=${SARAH_OUT_SINK} rate=24000 channels=1 sink_properties=device.description="Sarah_Vindemiatrix_Output"`,
      { env }
    );
    execSync(
      `pactl load-module module-remap-source master=${SARAH_OUT_SINK}.monitor source_name=${SARAH_VIRTUAL_MIC} source_properties=device.description="Sarah_Virtual_Mic"`,
      { env }
    );

    execSync(`pactl set-sink-mute ${CALLER_SINK} 0 && pactl set-sink-volume ${CALLER_SINK} 65536`, {
      env,
    });
    execSync(
      `pactl set-sink-mute ${SARAH_OUT_SINK} 0 && pactl set-sink-volume ${SARAH_OUT_SINK} 65536`,
      { env }
    );
    execSync(
      `pactl set-source-mute ${SARAH_VIRTUAL_MIC} 0 && pactl set-source-volume ${SARAH_VIRTUAL_MIC} 65536`,
      { env }
    );

    execSync(`pactl set-default-sink ${CALLER_SINK}`, { env });
    execSync(`pactl set-default-source ${SARAH_VIRTUAL_MIC}`, { env });
    process.env.PULSE_SINK = CALLER_SINK;
    process.env.PULSE_SOURCE = SARAH_VIRTUAL_MIC;
    process.env.PULSE_LATENCY_MSEC = '10';

    console.log(
      `[PulseAudio] Zero-lag topology locked: ${CALLER_SINK}.monitor (16kHz) <-> ${SARAH_VIRTUAL_MIC} (24kHz ${VOICE_PROFILE})`
    );
  } catch (err: any) {
    console.error('[PulseAudio Setup Error]', err.message);
  }
}

export function enforceChromiumPulseBinding(): void {
  if (process.platform !== 'linux') return;
  const env = pulseEnv();
  try {
    const sinkInputsRaw = execSync('pactl list sink-inputs', { env }).toString();
    const sinkBlocks = sinkInputsRaw.split(/Sink Input #/);
    for (const blk of sinkBlocks) {
      const idMatch = blk.match(/^(\d+)/);
      if (!idMatch) continue;
      if (/pacat|parec|PulseAudio Volume Control/i.test(blk)) continue;
      execSync(`pactl move-sink-input ${idMatch[1]} ${CALLER_SINK}`, { stdio: 'ignore', env });
    }

    const sourceOutputsRaw = execSync('pactl list source-outputs', { env }).toString();
    const srcBlocks = sourceOutputsRaw.split(/Source Output #/);
    for (const blk of srcBlocks) {
      const idMatch = blk.match(/^(\d+)/);
      if (!idMatch) continue;
      if (/pacat|parec|PulseAudio Volume Control/i.test(blk)) continue;
      execSync(`pactl move-source-output ${idMatch[1]} ${SARAH_VIRTUAL_MIC}`, {
        stdio: 'ignore',
        env,
      });
    }
  } catch {}
}

export class GeminiVindemiatrixCallBridge {
  private ws: WebSocket | null = null;
  private parecProc: ChildProcessWithoutNullStreams | null = null;
  private pacatProc: ChildProcessWithoutNullStreams | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private drainTimer: NodeJS.Timeout | null = null;

  private isRunning = false;
  private isSpeaking = false;
  private playbackDrainUntilMs = 0;
  private callStartedAtMs = 0;
  private pcmBytesSentToMic = 0;
  private scriptCompleted = false;
  private openingTurnFinished = false;
  private sessionResumptionHandle: string | null = null;
  private reconnectAttempts = 0;
  private lastTelemetryFlushMs = 0;
  private onEndCallRequest?: () => void;

  constructor(opts?: { onEndCallRequest?: () => void }) {
    this.onEndCallRequest = opts?.onEndCallRequest;
  }

  public getBridgeStatus(): {
    isRunning: boolean;
    isSpeaking: boolean;
    pcmBytesSentToMic: number;
    scriptCompleted: boolean;
  } {
    return {
      isRunning: this.isRunning,
      isSpeaking: this.isSpeaking || Date.now() < this.playbackDrainUntilMs,
      pcmBytesSentToMic: this.pcmBytesSentToMic,
      scriptCompleted: this.scriptCompleted,
    };
  }

  private spawnPacatPlayback(forceFlush = false): void {
    // PLAYBACK DRAIN GUARD: Never kill pacat while Vindemiatrix PCM frames are actively draining unless explicitly forced after script completion
    if (
      this.pacatProc &&
      this.pacatProc.stdin.writable &&
      !forceFlush &&
      (this.isSpeaking || Date.now() < this.playbackDrainUntilMs)
    ) {
      return;
    }
    try {
      this.pacatProc?.kill('SIGKILL');
    } catch {}
    this.pacatProc = spawn(
      'pacat',
      [
        '--playback',
        '-d',
        SARAH_OUT_SINK,
        '--rate=24000',
        '--format=s16le',
        '--channels=1',
        '--raw',
        '--latency-msec=10',
      ],
      { env: pulseEnv() }
    );
  }

  private ensureParecCapture(): void {
    if (this.parecProc && !this.parecProc.killed) return;
    this.parecProc = spawn(
      'parec',
      [
        '-d',
        `${CALLER_SINK}.monitor`,
        '--rate=16000',
        '--format=s16le',
        '--channels=1',
        '--raw',
        '--latency-msec=10',
        '--fragsize=1024',
      ],
      { env: pulseEnv() }
    );

    this.parecProc.stdout.on('data', (pcmChunk: Buffer) => {
      if (!this.isRunning || this.ws?.readyState !== WebSocket.OPEN) return;

      // 6-SECOND INITIAL BARGE-IN GUARD: Gate line static / connection clicks to silence while Sarah delivers her opening reception greeting
      const inOpeningImmunityWindow =
        Date.now() - this.callStartedAtMs < INITIAL_BARGE_IN_GUARD_MS && !this.openingTurnFinished;
      const outboundPcm = inOpeningImmunityWindow ? Buffer.alloc(pcmChunk.length) : pcmChunk;

      try {
        this.ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: 'audio/pcm;rate=16000',
                data: outboundPcm.toString('base64'),
              },
            },
          })
        );
      } catch {}
    });
  }

  private writePcmToSarahMic(pcm: Buffer): void {
    if (!pcm || pcm.length === 0) return;
    if (!this.pacatProc || !this.pacatProc.stdin.writable) {
      this.spawnPacatPlayback(true);
    }
    if (this.pacatProc?.stdin.writable) {
      this.pacatProc.stdin.write(pcm);
    }

    // 24kHz 16-bit mono = 48,000 bytes/sec
    const chunkDurationMs = Math.ceil((pcm.length / 48000) * 1000);
    const now = Date.now();
    this.playbackDrainUntilMs = Math.max(now, this.playbackDrainUntilMs) + chunkDurationMs;
    this.isSpeaking = true;
    this.pcmBytesSentToMic += pcm.length;

    if (this.pcmBytesSentToMic >= MIN_OPENING_SCRIPT_PCM_BYTES && !this.scriptCompleted) {
      this.scriptCompleted = true;
    }

    if (this.drainTimer) clearTimeout(this.drainTimer);
    const waitMs = Math.max(200, this.playbackDrainUntilMs - now + 220);
    this.drainTimer = setTimeout(() => {
      if (Date.now() >= this.playbackDrainUntilMs) {
        this.isSpeaking = false;
        if (this.isRunning) {
          writeSarahState({
            voiceSessionState: 'ACTIVE_LISTENING',
            pcmBytesSentToMic: this.pcmBytesSentToMic,
            scriptCompleted: this.scriptCompleted,
          });
        }
      }
    }, waitMs);

    if (now - this.lastTelemetryFlushMs > 500 || this.scriptCompleted) {
      this.lastTelemetryFlushMs = now;
      writeSarahState({
        voiceProfile: VOICE_PROFILE,
        sarahVoiceStreamActive: true,
        voiceSessionState: 'ACTIVE_SPEAKING',
        pcmBytesSentToMic: this.pcmBytesSentToMic,
        scriptCompleted: this.scriptCompleted,
      });
    }
  }

  private async waitForPlaybackDrain(maxWaitMs = 5000): Promise<void> {
    const remainingMs = this.playbackDrainUntilMs - Date.now();
    if (remainingMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(maxWaitMs, remainingMs + 250)));
    }
    this.isSpeaking = false;
  }

  private async playNeuralTtsToSarahMic(text: string): Promise<void> {
    if (!this.isRunning) return;
    try {
      const res = await fetch('http://127.0.0.1:4000/api/sarah/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: VOICE_PROFILE }),
      });
      if (!res.ok) return;
      const data: any = await res.json();
      if (!data?.audio_base64) return;
      const audioBuf = Buffer.from(data.audio_base64, 'base64');

      await new Promise<void>((resolve) => {
        const ff = spawn(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-f',
            's16le',
            '-ar',
            '24000',
            '-ac',
            '1',
            'pipe:1',
          ],
          { env: pulseEnv() }
        );
        ff.stdout.on('data', (pcm: Buffer) => {
          this.writePcmToSarahMic(pcm);
        });
        ff.on('close', () => resolve());
        ff.on('error', () => resolve());
        ff.stdin.write(audioBuf);
        ff.stdin.end();
      });
      await this.waitForPlaybackDrain(10000);
    } catch (err: any) {
      console.error('[Sarah Pulse TTS Fallback Error]', err?.message || err);
    }
  }

  private connectGeminiLiveSession(systemInstruction: string, isReconnect: boolean): void {
    if (!this.isRunning) return;

    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error(
        `[Gemini Live ${VOICE_PROFILE}] Missing GEMINI_API_KEY — using local neural bridge`
      );
      void this.playNeuralTtsToSarahMic(BUSINESS_HOURS_OPENING_GREETING);
      return;
    }

    let setupCompleted = false;
    let receivedLiveAudioThisSocket = false;
    const liveModel = process.env.GEMINI_LIVE_MODEL || 'models/gemini-3.8-live';
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (this.isRunning && ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {}
      }
    }, 15000);

    ws.on('open', () => {
      console.log(
        `[Gemini Live ${VOICE_PROFILE}] ${isReconnect ? 'Resumed' : 'Connected'} (${liveModel}). Streaming 24kHz ${VOICE_PROFILE} audio...`
      );

      const setupPayload: Record<string, any> = {
        model: liveModel,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: VOICE_PROFILE,
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        sessionResumption: this.sessionResumptionHandle
          ? { handle: this.sessionResumptionHandle }
          : {},
      };

      ws.send(JSON.stringify({ setup: setupPayload }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg?.sessionResumptionUpdate?.newHandle) {
          this.sessionResumptionHandle = String(msg.sessionResumptionUpdate.newHandle);
        }

        if (msg?.setupComplete && !setupCompleted) {
          setupCompleted = true;
          this.reconnectAttempts = 0;

          if (!isReconnect && this.pcmBytesSentToMic === 0) {
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: 'The caller just connected to (480) 331-9455. Deliver your complete, warm, unhurried Sarah reception greeting for I Will Global Insurance and Financial Services right now, ask for their name and how you can assist them today, and stay attentively on the line.',
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                },
              })
            );
          } else if (isReconnect && !this.scriptCompleted) {
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: 'Continue the live reception call smoothly as Sarah without repeating yourself unnecessarily, asking how you may assist the caller today.',
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                },
              })
            );
          }

          this.ensureParecCapture();
          return;
        }

        if (msg?.serverContent?.interrupted) {
          const elapsedMs = Date.now() - this.callStartedAtMs;
          // Disable premature barge-in buffer killing during the first 6s OR before opening script completes
          if (elapsedMs < INITIAL_BARGE_IN_GUARD_MS || !this.scriptCompleted) {
            return;
          }
          if (!this.isSpeaking) {
            this.spawnPacatPlayback(true);
          }
          return;
        }

        const parts = msg?.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          const b64Audio = part?.inlineData?.data;
          if (b64Audio) {
            receivedLiveAudioThisSocket = true;
            this.writePcmToSarahMic(Buffer.from(b64Audio, 'base64'));
          }
        }

        if (msg?.serverContent?.turnComplete) {
          this.openingTurnFinished = true;
          if (this.pcmBytesSentToMic >= MIN_OPENING_SCRIPT_PCM_BYTES) {
            this.scriptCompleted = true;
            writeSarahState({
              scriptCompleted: true,
              pcmBytesSentToMic: this.pcmBytesSentToMic,
            });
          }
        }
      } catch {}
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString('utf8') || '';
      if (!this.isRunning || this.ws !== ws) return;

      if (
        !receivedLiveAudioThisSocket &&
        this.pcmBytesSentToMic === 0 &&
        (code === 1011 || code === 1008) &&
        /credit|quota|billing|not found/i.test(reason)
      ) {
        console.warn(
          `[Gemini Live ${VOICE_PROFILE}] WebSocket closed (${code}: ${reason.slice(0, 80)}) — engaging Zero-Dead-Air Neural Fiduciary Bridge over sarah_virtual_mic.`
        );
        this.ws = null;
        void this.playNeuralTtsToSarahMic(BUSINESS_HOURS_OPENING_GREETING);
        return;
      }

      // Automatic mid-call WebSocket session resumption if a transient frame or GoAway drops mid-call
      if (this.isRunning && code !== 1000 && this.reconnectAttempts < 6) {
        this.reconnectAttempts += 1;
        const backoffMs = Math.min(1500, 300 * this.reconnectAttempts);
        console.warn(
          `[Gemini Live ${VOICE_PROFILE}] Transient WebSocket close (${code}) mid-call — auto-resuming session in ${backoffMs}ms (attempt ${this.reconnectAttempts}/6)...`
        );
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connectGeminiLiveSession(systemInstruction, true);
        }, backoffMs);
      }
    });

    ws.on('error', (err) => {
      console.error(`[Gemini Live ${VOICE_PROFILE} Error]`, err.message);
    });
  }

  public startCallBridge(systemInstruction: string): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isSpeaking = false;
    this.playbackDrainUntilMs = 0;
    this.callStartedAtMs = Date.now();
    this.pcmBytesSentToMic = 0;
    this.scriptCompleted = false;
    this.openingTurnFinished = false;
    this.sessionResumptionHandle = null;
    this.reconnectAttempts = 0;

    enforceChromiumPulseBinding();
    this.spawnPacatPlayback(true);
    writeSarahState({
      voiceProfile: VOICE_PROFILE,
      sarahVoiceStreamActive: true,
      voiceSessionState: 'ACTIVE_SPEAKING',
      pcmBytesSentToMic: 0,
      scriptCompleted: false,
    });

    // Enforce strict Arizona After-Hours rule (7:00 PM – 8:59 AM MST Mon-Sat & Sundays)
    if (!isArizonaBusinessHoursNow()) {
      console.log(
        `[Sarah Bridge] After-hours call in Arizona — playing complete ${VOICE_PROFILE} closed greeting over sarah_virtual_mic...`
      );
      void this.playNeuralTtsToSarahMic(AFTER_HOURS_CLOSED_GREETING).then(async () => {
        this.scriptCompleted = true;
        writeSarahState({
          scriptCompleted: true,
          pcmBytesSentToMic: Math.max(this.pcmBytesSentToMic, MIN_OPENING_SCRIPT_PCM_BYTES),
        });
        await this.waitForPlaybackDrain(5000);
        setTimeout(() => {
          if (this.isRunning) {
            this.onEndCallRequest?.();
          }
        }, 900);
      });
      return;
    }

    this.connectGeminiLiveSession(systemInstruction, false);
  }

  public stopCallBridge(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(
      `[Gemini Live ${VOICE_PROFILE}] Call ended (pcmBytesSentToMic=${this.pcmBytesSentToMic}, scriptCompleted=${this.scriptCompleted}). Draining & closing audio streams.`
    );

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    try {
      this.parecProc?.kill('SIGKILL');
    } catch {}
    this.parecProc = null;

    try {
      this.ws?.close(1000, 'call_ended');
    } catch {}
    this.ws = null;

    // Drain any remaining PCM frames gracefully instead of truncating pacat mid-word
    const pacatRef = this.pacatProc;
    this.pacatProc = null;
    const drainDelayMs = Math.max(0, Math.min(2500, this.playbackDrainUntilMs - Date.now() + 150));
    this.isSpeaking = false;
    this.playbackDrainUntilMs = 0;

    if (pacatRef) {
      try {
        pacatRef.stdin.end();
      } catch {}
      setTimeout(() => {
        try {
          pacatRef.kill('SIGKILL');
        } catch {}
      }, drainDelayMs + 100);
    }

    writeSarahState({
      voiceProfile: VOICE_PROFILE,
      sarahVoiceStreamActive: false,
      voiceSessionState: 'IDLE',
      pcmBytesSentToMic: this.pcmBytesSentToMic,
      scriptCompleted: this.scriptCompleted,
    });
  }
}
