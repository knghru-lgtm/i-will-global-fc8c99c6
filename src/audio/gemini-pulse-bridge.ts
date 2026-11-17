import { execSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { writeSarahState } from '../watchdog/sarah-watchdog.ts';

export const CALLER_SINK = 'gv_speaker'; // Chromium outputs caller voice here (16kHz)
export const SARAH_OUT_SINK = 'gv_mic_sink'; // Gemini writes Aoede voice here (24kHz)
export const SARAH_VIRTUAL_MIC = 'sarah_virtual_mic'; // Chromium reads mic input from here

const AFTER_HOURS_CLOSED_GREETING =
  'Thank you for calling I Will Global. Our office is currently closed. Our regular business hours are Monday through Saturday from 9 AM to 7 PM Arizona time. Please call us back during normal business hours. Have a wonderful day.';

const BUSINESS_HOURS_OPENING_GREETING =
  'Thank you for calling I Will Global Insurance and Financial Services. This is Sarah speaking. How may I help you today?';

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
      `pactl load-module module-null-sink sink_name=${SARAH_OUT_SINK} rate=24000 channels=1 sink_properties=device.description="Sarah_Aoede_Output"`,
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
      `[PulseAudio] Zero-lag topology locked: ${CALLER_SINK}.monitor (16kHz) <-> ${SARAH_VIRTUAL_MIC} (24kHz Aoede)`
    );
  } catch (err: any) {
    console.error('[PulseAudio Setup Error]', err.message);
  }
}

export function enforceChromiumPulseBinding(): void {
  if (process.platform !== 'linux') return;
  const env = pulseEnv();
  try {
    // Only move Chromium/WebRTC streams — do NOT move our own pacat/parec bridge streams!
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

export class GeminiAoedeCallBridge {
  private ws: WebSocket | null = null;
  private parecProc: ChildProcessWithoutNullStreams | null = null;
  private pacatProc: ChildProcessWithoutNullStreams | null = null;
  private isRunning = false;
  private onEndCallRequest?: () => void;

  constructor(opts?: { onEndCallRequest?: () => void }) {
    this.onEndCallRequest = opts?.onEndCallRequest;
  }

  private spawnPacatPlayback(): void {
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

  private async playNeuralTtsToSarahMic(text: string): Promise<void> {
    if (!this.isRunning) return;
    try {
      const res = await fetch('http://127.0.0.1:4000/api/sarah/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const data: any = await res.json();
      if (!data?.audio_base64) return;
      const audioBuf = Buffer.from(data.audio_base64, 'base64');

      await new Promise<void>((resolve) => {
        const ff = spawn(
          'ffmpeg',
          ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'],
          { env: pulseEnv() }
        );
        ff.stdout.on('data', (pcm: Buffer) => {
          if (this.pacatProc?.stdin.writable) {
            this.pacatProc.stdin.write(pcm);
          }
        });
        ff.on('close', () => resolve());
        ff.on('error', () => resolve());
        ff.stdin.write(audioBuf);
        ff.stdin.end();
      });
    } catch (err: any) {
      console.error('[Sarah Pulse TTS Fallback Error]', err?.message || err);
    }
  }

  public startCallBridge(systemInstruction: string): void {
    if (this.isRunning) return;
    this.isRunning = true;

    enforceChromiumPulseBinding();
    this.spawnPacatPlayback();
    writeSarahState({
      sarahVoiceStreamActive: true,
      voiceSessionState: 'ACTIVE_SPEAKING',
    });

    // Enforce strict Arizona After-Hours rule (7:00 PM – 8:59 AM MST Mon-Sat & Sundays)
    if (!isArizonaBusinessHoursNow()) {
      console.log('[Sarah Bridge] After-hours call in Arizona — playing closed greeting over sarah_virtual_mic...');
      void this.playNeuralTtsToSarahMic(AFTER_HOURS_CLOSED_GREETING).then(() => {
        setTimeout(() => {
          this.onEndCallRequest?.();
        }, 1200);
      });
      return;
    }

    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('[Gemini Live Aoede] Missing GEMINI_API_KEY — using local neural bridge');
      void this.playNeuralTtsToSarahMic(BUSINESS_HOURS_OPENING_GREETING);
      return;
    }

    let receivedLiveAudio = false;
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('[Gemini Live Aoede] Connected. Streaming 24kHz Aoede audio...');

      this.ws?.send(
        JSON.stringify({
          setup: {
            model: 'models/gemini-2.0-flash-exp',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Aoede',
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
          },
        })
      );

      this.ws?.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'The caller just connected. Greet them warmly right now as Sarah from I Will Global.',
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        })
      );

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
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: 'audio/pcm;rate=16000',
                    data: pcmChunk.toString('base64'),
                  },
                ],
              },
            })
          );
        }
      });
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.serverContent?.interrupted) {
          this.spawnPacatPlayback();
          return;
        }
        const parts = msg?.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          const b64Audio = part?.inlineData?.data;
          if (b64Audio && this.pacatProc?.stdin.writable) {
            receivedLiveAudio = true;
            this.pacatProc.stdin.write(Buffer.from(b64Audio, 'base64'));
          }
        }
      } catch {}
    });

    this.ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString('utf8') || '';
      if (this.isRunning && !receivedLiveAudio && (code === 1011 || code === 1008)) {
        console.warn(
          `[Gemini Live Aoede] WebSocket closed (${code}: ${reason.slice(0, 80)}) — engaging Zero-Dead-Air Neural Fiduciary Bridge over sarah_virtual_mic.`
        );
        try {
          this.parecProc?.kill('SIGKILL');
        } catch {}
        this.parecProc = null;
        this.ws = null;
        void this.playNeuralTtsToSarahMic(BUSINESS_HOURS_OPENING_GREETING);
        return;
      }
    });

    this.ws.on('error', (err) => {
      console.error('[Gemini Live Aoede Error]', err.message);
    });
  }

  public stopCallBridge(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log('[Gemini Live Aoede] Call ended. Closing audio streams.');
    try {
      this.parecProc?.kill('SIGKILL');
      this.pacatProc?.kill('SIGKILL');
      this.ws?.close();
    } catch {}
    this.parecProc = null;
    this.pacatProc = null;
    this.ws = null;
    writeSarahState({
      sarahVoiceStreamActive: false,
      voiceSessionState: 'IDLE',
    });
  }
}
